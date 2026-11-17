/**
 * dsh-team-guard Hook for Antigravity (PreToolUse + Stop)
 *
 * 迁移自 DeepSeek Harness 插件 dsh-team-guard：
 * - 闸一 (Boundary)  ：配合 rules/AGENTS.md 与 PreInvocation 边界纪律防止无休止扩散
 * - 闸二 (Tripwire)  ：非豁免工具相同参数连续调用 >= 3 次触发硬熔断 deny
 * - 闸三 (Budget)    ：存在活跃 .agent-teams 团队时单轮工具调用上限 300 次 / 1800s 预算硬熔断
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const MAX_IDENTICAL_STREAK = 3;
const MAX_TOOL_CALLS_PER_TURN = 300;
const MAX_TURN_SECONDS = 1800;

const EXEMPT_TOOLS = new Set([
  'agent_teams_status',
  'agent_teams_claim_task',
  'read',
  'grep',
  'glob',
  'read_file',
  'manage_task',
  'manage_subagents',
  'list_resources',
  'read_resource',
  'list_plugin_accounts',
]);

function canonicalize(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

function readAllStdin() {
  try {
    return readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

function stateFileFor(sessionId) {
  const dir = join(tmpdir(), 'dsh-team-guard-agy');
  mkdirSync(dir, { recursive: true });
  const safeId = String(sessionId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96);
  return join(dir, `${safeId}.json`);
}

function readState(file) {
  try {
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

function writeState(file, state) {
  try {
    writeFileSync(file, JSON.stringify(state), 'utf-8');
  } catch {
    // 忽略临时状态写入错误，不能因临时目录问题阻断正常工具运行
  }
}

function findActiveTeamsRoot(payload) {
  const candidates = [];
  if (typeof payload.cwd === 'string' && payload.cwd.trim()) {
    candidates.push(resolve(payload.cwd.trim()));
  }
  if (Array.isArray(payload.workspacePaths)) {
    for (const wp of payload.workspacePaths) {
      if (typeof wp === 'string' && wp.trim()) {
        const abs = resolve(wp.trim());
        if (!candidates.includes(abs)) candidates.push(abs);
      }
    }
  }
  const argWs = payload?.toolCall?.args?.workspace ?? payload?.tool_input?.workspace;
  if (typeof argWs === 'string' && argWs.trim()) {
    const abs = resolve(argWs.trim());
    if (!candidates.includes(abs)) candidates.unshift(abs);
  }

  for (const root of candidates) {
    const stateDir = join(root, '.agent-teams');
    if (!existsSync(stateDir)) continue;
    try {
      const entries = readdirSync(stateDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'archive' || entry.name.startsWith('.')) continue;
        const teamFile = join(stateDir, entry.name, 'team.json');
        if (!existsSync(teamFile)) continue;
        try {
          const team = JSON.parse(readFileSync(teamFile, 'utf-8'));
          if (team && team.halted !== true && (team.phase === 'running' || team.phase === undefined)) {
            return { workspace: root, stateDir, activeTeam: team };
          }
        } catch {
          // 跳过半写或损坏文件
        }
      }
    } catch {
      // 忽略目录不可读
    }
  }
  return null;
}

function appendAudit(teamCtx, record) {
  if (!teamCtx?.stateDir) return;
  try {
    const logPath = join(teamCtx.stateDir, 'team-guard.jsonl');
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`, 'utf-8');
  } catch {
    // 审计写失败绝不影响主流程
  }
}

function normalizeToolName(raw) {
  const s = String(raw || '');
  // 支持 MCP 工具全名如 mcp_dsh-agent-teams_agent_teams_status 提取尾段或保留匹配
  const idx = s.lastIndexOf('agent_teams_');
  return idx >= 0 ? s.slice(idx) : s;
}

function handleStopReset(payload) {
  const convId = payload.conversationId ?? payload.session_id ?? 'default';
  const file = stateFileFor(convId);
  writeState(file, {
    lastUserInput: '',
    turnStartedAt: Date.now(),
    toolCalls: 0,
    lastFingerprint: '',
    streak: 0,
  });
  process.stdout.write('{"decision":"allow"}\n');
}

function main() {
  const isReset = process.argv.includes('--reset');
  const rawInput = readAllStdin().trim();
  let payload = {};
  if (rawInput) {
    try {
      payload = JSON.parse(rawInput);
    } catch {
      process.stdout.write(isReset ? '{"decision":"allow"}\n' : '{"decision":"allow"}\n');
      return;
    }
  }

  if (isReset || payload.hookEventName === 'Stop') {
    handleStopReset(payload);
    return;
  }

  const convId = payload.conversationId ?? payload.session_id ?? 'default';
  const toolName = payload.toolCall?.name ?? payload.tool_name ?? '';
  const toolArgs = payload.toolCall?.args ?? payload.tool_input ?? {};
  const normalizedName = normalizeToolName(toolName);
  const turnMarker = typeof payload.lastUserInput === 'string' ? payload.lastUserInput : '';

  const stateFile = stateFileFor(convId);
  const now = Date.now();
  let state = readState(stateFile) || {
    lastUserInput: turnMarker,
    turnStartedAt: now,
    toolCalls: 0,
    lastFingerprint: '',
    streak: 0,
  };

  // 若进入新的用户输入轮次，自动重置单轮预算与连击窗口
  if (turnMarker && state.lastUserInput && state.lastUserInput !== turnMarker) {
    state = {
      lastUserInput: turnMarker,
      turnStartedAt: now,
      toolCalls: 0,
      lastFingerprint: '',
      streak: 0,
    };
  } else if (!state.lastUserInput && turnMarker) {
    state.lastUserInput = turnMarker;
  }

  state.toolCalls = (state.toolCalls || 0) + 1;

  const teamCtx = findActiveTeamsRoot(payload);

  // 闸三：仅在存在活跃 .agent-teams 团队时启用单轮工具调用上限与时长预算
  if (teamCtx) {
    const elapsedSec = (now - (state.turnStartedAt || now)) / 1000;
    if (state.toolCalls > MAX_TOOL_CALLS_PER_TURN) {
      const reason = `[team-guard] 活跃团队单轮工具调用已超预算上限 (${state.toolCalls}/${MAX_TOOL_CALLS_PER_TURN})，强制收口！请立即总结当前进展、已通过的验证证据及剩余未决问题并向主人汇报。`;
      appendAudit(teamCtx, { event: 'budget_deny_calls', convId, toolName, toolCalls: state.toolCalls });
      writeState(stateFile, state);
      process.stdout.write(`${JSON.stringify({ decision: 'deny', reason })}\n`);
      return;
    }
    if (elapsedSec > MAX_TURN_SECONDS) {
      const reason = `[team-guard] 活跃团队单轮执行时长已超预算 (${Math.round(elapsedSec)}s/${MAX_TURN_SECONDS}s)，强制收敛并汇报当前阶段状态。`;
      appendAudit(teamCtx, { event: 'budget_deny_seconds', convId, toolName, elapsedSec });
      writeState(stateFile, state);
      process.stdout.write(`${JSON.stringify({ decision: 'deny', reason })}\n`);
      return;
    }
  }

  // 闸二：非豁免工具连续 3 次完全相同参数调用触发防死循环硬熔断
  if (!EXEMPT_TOOLS.has(toolName) && !EXEMPT_TOOLS.has(normalizedName)) {
    const fingerprint = `${toolName}:${canonicalize(toolArgs)}`;
    if (state.lastFingerprint === fingerprint) {
      state.streak = (state.streak || 1) + 1;
    } else {
      state.lastFingerprint = fingerprint;
      state.streak = 1;
    }

    if (state.streak >= MAX_IDENTICAL_STREAK) {
      const reason = `[team-guard] 检测到工具 "${toolName}" 使用完全相同的参数已连续调用 ${state.streak} 次（阈值 ${MAX_IDENTICAL_STREAK}），触发防死循环熔断！请勿继续盲试同一动作，应立即换用排查路径或向主人说明阻塞点。`;
      appendAudit(teamCtx, { event: 'tripwire_identical_streak', convId, toolName, streak: state.streak });
      writeState(stateFile, state);
      process.stdout.write(`${JSON.stringify({ decision: 'deny', reason })}\n`);
      return;
    }
  } else {
    // 插入了非重复观测后不立即清零但也不计入重复连击；仅不同签名才刷新连击
  }

  writeState(stateFile, state);
  process.stdout.write('{"decision":"allow"}\n');
}

main();
