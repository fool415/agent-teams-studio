/**
 * dsh-team-guard —— AgentTeams 防死循环三道闸
 *
 *  闸一 boundary  ：往系统提示注入 autonomy scope / stop conditions（边界定义）
 *  闸二 tripwire  ：同一动作连击 + 推理文本自重复 → 硬拦截（运行时护栏）
 *  闸三 budget    ：单 turn 的 step / tool-call / 时长硬上限（轮次预算）
 *
 * 设计约束：本插件是独立本地模块，不依赖任何宿主专有内核包，
 * 只依赖 node: 内置模块，全部逻辑挂在 ctx.on 钩子上，任何宿主版本都能加载。
 *
 * 算法出处：
 *  - 推理重复率检测移植自 PrismLean/dsh-run-guard（MIT）的 createReasoningGuard
 *  - 相同工具调用的规范化比较思路取自 dsh-repeat-tool-reminder（它只提醒不拦截，
 *    这里升级为可拒绝的 tripwire）
 */

import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** 稳定失败码，写进 llm/stream 的 error finish。 */
export const REASONING_GUARD_CODE = 'REASONING_GUARD';

/** 被护栏拦下的工具调用统一前缀，方便日志检索。 */
const DENY_PREFIX = '[team-guard]';

const DEFAULTS = {
  enabled: true,
  boundary: {
    enabled: true,
    promptOrder: 118,
    sections: [
      'Autonomy scope (AgentTeams): pursue only the sub-goals the user named. Do not widen the goal, add adjacent work, or start a new cycle of work after a reasonable deliverable exists. Every extra round must be justified by a named, still-open requirement.',
      'Stop conditions (any one is sufficient to end the run): the user goal is satisfied and reported; a required gate passed; the remaining work needs user input, a credential, or a decision only the user can make; the turn budget is exhausted. When a stop condition holds, report the result instead of starting another review or repair cycle.',
    ],
  },
  tripwire: {
    enabled: true,
    identicalCallLimit: 3,
    escalateAfterBlocks: 2,
    reasoningRepeatRatio: 0.82,
    reasoningWindowChars: 4000,
    reasoningSubstrLen: 48,
    reasoningCheckEvery: 4,
    reasoningMaxBlocks: 0,
    reasoningMaxChars: 120000,
    exemptTools: ['agent_teams_status', 'agent_teams_claim_task', 'read', 'grep', 'glob'],
  },
  budget: {
    enabled: true,
    // 轮次预算只管「正在跑的 AgentTeams 团队」里的 agent（队长与成员），
    // 普通会话不受 step / tool-call / 时长上限约束。'all' 可恢复旧的全局限额。
    scope: 'team',
    // 团队状态目录（相对 workspace 根）；成员与队长的归属从 <stateDir>/<teamId>/team.json 读。
    teamStateDir: '.agent-teams',
    // 归属查询缓存（毫秒）；每步都读盘太浪费，缓存短一点足够。
    teamCacheMs: 2000,
    maxStepsPerTurn: 120,
    maxToolCallsPerTurn: 300,
    maxTurnSeconds: 1800,
  },
  auditLog: '.agent-teams/team-guard.jsonl',
};

// ---------------------------------------------------------------- 配置

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneSection(base) {
  const out = {};
  for (const [key, value] of Object.entries(base)) out[key] = Array.isArray(value) ? [...value] : value;
  return out;
}

/** 浅合并一层嵌套组，缺字段回落到默认值；类型不对就用默认值而不是抛错。 */
function mergeSection(base, override) {
  const out = cloneSection(base);
  if (!isPlainObject(override)) return out;
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) out[key] = [...value];
    else if (isPlainObject(value) && isPlainObject(out[key])) out[key] = { ...out[key], ...value };
    else out[key] = value;
  }
  return out;
}

function resolveConfig(raw) {
  const input = isPlainObject(raw) ? raw : {};
  return {
    enabled: input.enabled !== false,
    boundary: mergeSection(DEFAULTS.boundary, input.boundary),
    tripwire: mergeSection(DEFAULTS.tripwire, input.tripwire),
    budget: mergeSection(DEFAULTS.budget, input.budget),
    auditLog: typeof input.auditLog === 'string' ? input.auditLog : DEFAULTS.auditLog,
  };
}

function positiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function ratio(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1) return fallback;
  return n;
}

// ---------------------------------------------------------------- 审计

function makeAudit(config) {
  const target = config.auditLog;
  if (typeof target !== 'string' || target.length === 0) return () => undefined;
  const abs = isAbsolute(target) ? target : resolve(process.cwd(), target);
  return (record) => {
    try {
      mkdirSync(dirname(abs), { recursive: true });
      appendFileSync(abs, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`, 'utf8');
    } catch {
      // 审计写不进去绝不能影响主流程。
    }
  };
}

// ---------------------------------------------------------------- 工具

/** 深度键排序后再序列化，让 {a:1,b:2} 与 {b:2,a:1} 得到同一个 key。 */
function canonicalize(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function agentKey(agent) {
  const id = agent?.id ?? agent?.session?.id;
  return typeof id === 'string' ? id : 'unknown-agent';
}

// ------------------------------------------------- AgentTeams 归属（预算作用域）

/** agent 所在的 workspace 根：优先用会话记录的 cwd，退回落进程 cwd。 */
function agentWorkspace(agent) {
  const candidates = [agent?.session?.header?.cwd, agent?.session?.cwd, agent?.cwd];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return process.cwd();
}

/**
 * 要查归属的 workspace 根列表：会话 cwd 优先，再看进程 cwd。
 * 宿主的进程 cwd 有时不在会话工作区里（实测 team-guard 的审计日志写进了
 * profiles\desktop），所以两处都查，避免队长被漏判成普通会话。
 */
function workspaceRoots(agent) {
  const roots = [agentWorkspace(agent)];
  const hostCwd = process.cwd();
  if (!roots.includes(hostCwd)) roots.push(hostCwd);
  return roots;
}

/**
 * 列出 `<workspace>/.agent-teams/<teamId>/team.json` 里的团队记录。
 * 读不到（目录不存在 / 文件损坏 / 正在写）就当没有团队：宁可少管，绝不误杀普通会话。
 */
function readTeamRecords(root, stateDir) {
  const base = isAbsolute(stateDir) ? stateDir : resolve(root, stateDir);
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const teams = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = readFileSync(join(base, entry.name, 'team.json'), 'utf8');
      const team = JSON.parse(raw);
      if (isPlainObject(team)) teams.push(team);
    } catch {
      // 没有 team.json / JSON 半截 / 权限不足：跳过这一份。
    }
  }
  return teams;
}

/** 这个 agent 是否是某个「运行中」团队的队长或成员；是则返回那份团队记录。 */
function findRunningTeam(agent, roots, stateDir) {
  const id = agentKey(agent);
  if (id === 'unknown-agent') return undefined;
  for (const root of roots) {
    for (const team of readTeamRecords(root, stateDir)) {
      if (team.halted === true) continue;
      if (team.phase !== 'running') continue;
      if (team.captainSessionId === id) return team;
      const members = Array.isArray(team.members) ? team.members : [];
      if (members.some((member) => member?.id === id)) return team;
    }
  }
  return undefined;
}

/**
 * 推理死循环检测器（移植自 dsh-run-guard，MIT）。
 * 一个实例只服务一次模型调用，counter 天然是按调用隔离的。
 */
export function createReasoningGuard(config) {
  const substrLen = positiveInt(config.reasoningSubstrLen, 48);
  const windowChars = Math.max(positiveInt(config.reasoningWindowChars, 4000), substrLen + 1);
  const repeatRatio = ratio(config.reasoningRepeatRatio, 0.82);
  const checkEvery = positiveInt(config.reasoningCheckEvery, 4);
  // 网络分片大小由 provider 决定，默认不能用分片数判定推理死循环。
  const maxBlocks = Number(config.reasoningMaxBlocks) > 0
    ? positiveInt(config.reasoningMaxBlocks, Infinity)
    : Infinity;
  const maxChars = positiveInt(config.reasoningMaxChars, 120000);

  let window = '';
  const freq = new Map();
  let totalSubstrs = 0;
  let blocks = 0;
  let chars = 0;
  let sinceCheck = 0;

  function addSubstrs(text) {
    const combined = window + text;
    const start = Math.max(0, window.length - substrLen + 1);
    for (let i = start; i + substrLen <= combined.length; i += 1) {
      const piece = combined.slice(i, i + substrLen);
      freq.set(piece, (freq.get(piece) ?? 0) + 1);
      totalSubstrs += 1;
    }
    window = combined;
  }

  function trimWindow() {
    while (window.length > windowChars) {
      // 窗口短于子串长度时窗口内没有完整子串，不能去减 freq（否则 undefined-NaN）。
      if (window.length >= substrLen) {
        const piece = window.slice(0, substrLen);
        const next = freq.get(piece) - 1;
        if (next <= 0) freq.delete(piece);
        else freq.set(piece, next);
        totalSubstrs -= 1;
      }
      window = window.slice(1);
    }
  }

  function check() {
    const base = { triggered: false, blocks, chars };
    if (totalSubstrs >= substrLen * 2) {
      const current = 1 - freq.size / totalSubstrs;
      if (current >= repeatRatio) return { ...base, triggered: true, reason: 'repeat', ratio: current };
    }
    if (blocks >= maxBlocks) return { ...base, triggered: true, reason: 'blocks' };
    if (chars >= maxChars) return { ...base, triggered: true, reason: 'chars' };
    return base;
  }

  return {
    push(text) {
      const delta = typeof text === 'string' ? text : '';
      blocks += 1;
      chars += delta.length;
      addSubstrs(delta);
      trimWindow();
      sinceCheck += 1;
      if (sinceCheck >= checkEvery) {
        sinceCheck = 0;
        return check();
      }
      // 硬上限不能等去抖窗口，每块都要兜一次。
      if (blocks >= maxBlocks) return check();
      if (chars >= maxChars) return check();
      return null;
    },
    stats() {
      return { blocks, chars, totalSubstrs, unique: freq.size };
    },
  };
}

function guardMessage(verdict) {
  const cause =
    verdict.reason === 'repeat'
      ? '模型在持续输出高度重复的推理内容（疑似推理死循环）'
      : verdict.reason === 'blocks'
        ? '单次调用推理块数超过上限'
        : '单次调用推理字符数超过上限';
  const detail =
    verdict.ratio === undefined ? '' : `，窗口重复率 ${verdict.ratio.toFixed(3)}`;
  return [
    '推理输出疑似死循环，已被 team-guard 推理护栏中断。',
    `原因：${cause}`,
    `触发时状态：${verdict.blocks} 个推理块 / ${verdict.chars} 字符${detail}`,
    '这是保护性中断：模型在空转烧 token。可直接继续对话或换个说法重试。',
  ].join('\n');
}

// ---------------------------------------------------------------- 插件

function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig ?? ctx?.config ?? {});
  if (!config.enabled) return;

  const audit = makeAudit(config);
  const log = (message) => {
    try {
      ctx.logger?.warn(`${DENY_PREFIX} ${message}`);
    } catch {
      // logger 不可用就算了。
    }
  };

  // ---- 每 agent / 每 turn 的运行时状态 -------------------------------
  /** agentKey -> { turn, toolCalls, startedAt, lastKey, streak, blocks } */
  const states = new Map();
  const fallbackState = { turn: 0, toolCalls: 0, startedAt: Date.now(), lastKey: '', streak: 0, blocks: 0 };

  function stateFor(agent) {
    // 没有 agent 引用的调用（例如手工构造的 exec）统一落到一个兜底状态，
    // 否则 pre-execute 与 pre-step 会各自记账，预算就漏了。
    if (agent === undefined || agent === null) return fallbackState;
    const key = agentKey(agent);
    let state = states.get(key);
    if (state === undefined) {
      state = { turn: 0, toolCalls: 0, startedAt: Date.now(), lastKey: '', streak: 0, blocks: 0 };
      states.set(key, state);
    }
    return state;
  }

  function beginTurn(agent, turn) {
    const state = agent === undefined ? fallbackState : stateFor(agent);
    if (state.turn !== turn) {
      state.turn = turn;
      state.toolCalls = 0;
      state.startedAt = Date.now();
      state.lastKey = '';
      state.streak = 0;
      state.blocks = 0;
    }
    return state;
  }

  const exempt = new Set(
    (Array.isArray(config.tripwire.exemptTools) ? config.tripwire.exemptTools : []).filter(
      (item) => typeof item === 'string',
    ),
  );
  const identicalCallLimit = positiveInt(config.tripwire.identicalCallLimit, 3);
  const escalateAfterBlocks = positiveInt(config.tripwire.escalateAfterBlocks, 2);
  const maxStepsPerTurn = positiveInt(config.budget.maxStepsPerTurn, DEFAULTS.budget.maxStepsPerTurn);
  const maxToolCallsPerTurn = positiveInt(config.budget.maxToolCallsPerTurn, DEFAULTS.budget.maxToolCallsPerTurn);
  const maxTurnSeconds = Number(config.budget.maxTurnSeconds);
  // 预算作用域：默认 'team'（只有运行中的团队受限），'all' 恢复旧的全局限额。
  const budgetGlobalScope = String(config.budget.scope ?? 'team').toLowerCase() === 'all';
  const teamStateDir =
    typeof config.budget.teamStateDir === 'string' && config.budget.teamStateDir.length > 0
      ? config.budget.teamStateDir
      : DEFAULTS.budget.teamStateDir;
  const teamCacheMs = Math.max(0, Number(config.budget.teamCacheMs) || 0);
  /** `${workspace}::${agentId}` -> { at, team }；团队状态由 agent-teams 持久化，缓存只为省盘 IO。 */
  const teamCache = new Map();

  function runningTeamFor(agent) {
    const id = agentKey(agent);
    if (id === 'unknown-agent') return undefined;
    const roots = workspaceRoots(agent);
    const key = `${roots[0]}\u0000${id}`;
    const now = Date.now();
    const cached = teamCache.get(key);
    if (cached !== undefined && now - cached.at < teamCacheMs) return cached.team;
    const team = findRunningTeam(agent, roots, teamStateDir);
    teamCache.set(key, { at: now, team });
    return team;
  }

  // ---- 闸一：边界定义 ------------------------------------------------
  if (config.boundary.enabled && config.boundary.sections.length > 0) {
    const text = [
      '## Loop discipline (enforced by dsh-team-guard)',
      '',
      ...config.boundary.sections.map((section) => `- ${section}`),
      '',
    ].join('\n');
    const order = Number.isFinite(Number(config.boundary.promptOrder))
      ? Number(config.boundary.promptOrder)
      : DEFAULTS.boundary.promptOrder;
    try {
      ctx.systemPrompt.section({ name: 'dsh-team-guard:boundary', order, text });
    } catch (error) {
      log(`边界条款注入失败（继续运行其余两道闸）：${error?.message ?? error}`);
    }
  }

  // ---- 闸二 a：推理死循环 --------------------------------------------
  if (config.tripwire.enabled) {
    ctx.on('llm/stream', (options, next) => {
      const stream = next();
      /** 每次模型调用一个检测器；异常或已触发后置 null 表示降级透传。 */
      let guard = createReasoningGuard(config.tripwire);
      return (async function* guarded() {
        for await (const chunk of stream) {
          if (guard !== null && chunk?.type === 'reasoning-delta') {
            try {
              const verdict = guard.push(chunk.text);
              if (verdict?.triggered) {
                const stats = guard.stats();
                log(
                  `推理护栏中断 reason=${verdict.reason} blocks=${stats.blocks} chars=${stats.chars}` +
                    (verdict.ratio === undefined ? '' : ` ratio=${verdict.ratio.toFixed(3)}`),
                );
                audit({
                  gate: 'tripwire',
                  kind: 'reasoning',
                  reason: verdict.reason,
                  blocks: stats.blocks,
                  chars: stats.chars,
                  ratio: verdict.ratio,
                });
                yield {
                  type: 'finish',
                  reason: {
                    kind: 'error',
                    failure: { message: guardMessage(verdict), code: REASONING_GUARD_CODE },
                  },
                };
                guard = null;
                return;
              }
            } catch (error) {
              // 检测器自身的 bug 绝不能打断健康的模型流。
              log(`推理检测器异常，降级为透传：${error?.message ?? error}`);
              guard = null;
            }
          }
          yield chunk;
        }
      })();
    });
  }

  // ---- 闸二 b / 闸三：工具连击拦截 + 调用预算 -------------------------
  if (config.tripwire.enabled || config.budget.enabled) {
    ctx.on('tools/pre-execute', async (exec, next) => {
      const agent = exec?.agent;
      const state = stateFor(agent);
      const toolName = typeof exec?.name === 'string' ? exec.name : 'unknown';

      // 预算：累计工具调用数（同样只管运行中的团队）
      state.toolCalls += 1;
      const budgetInScope = config.budget.enabled && (budgetGlobalScope || runningTeamFor(agent) !== undefined);
      if (budgetInScope && state.toolCalls > maxToolCallsPerTurn) {
        const reason =
          `${DENY_PREFIX} 本 turn 的工具调用已达硬上限 ${maxToolCallsPerTurn} 次，` +
          `第 ${state.toolCalls} 次「${toolName}」被拒绝。请立即停止扩张，改用已有结果作答；` +
          `如确有必要继续，需由用户显式放行。`;
        log(`工具调用预算耗尽 agent=${agentKey(agent)} calls=${state.toolCalls}`);
        audit({ gate: 'budget', kind: 'tool-calls', agent: agentKey(agent), tool: toolName, calls: state.toolCalls });
        return { kind: 'deny', reason, info: { guard: 'dsh-team-guard', gate: 'budget' } };
      }

      // 连击检测
      if (config.tripwire.enabled && !exempt.has(toolName)) {
        const key = `${toolName}\u0000${canonicalize(exec?.arguments)}`;
        if (key === state.lastKey) {
          state.streak += 1;
        } else {
          state.lastKey = key;
          state.streak = 1;
        }
        if (state.streak >= identicalCallLimit) {
          state.blocks += 1;
          const reason =
            `${DENY_PREFIX} 你已连续 ${state.streak} 次用完全相同的参数调用「${toolName}」，` +
            `这是死循环信号，本次调用被硬拦截（本 turn 第 ${state.blocks} 次拦截）。` +
            `不要再重复同一动作：要么换参数/换工具，要么直接基于已有信息汇报结论。`;
          log(
            `连击拦截 agent=${agentKey(agent)} tool=${toolName} streak=${state.streak} blocks=${state.blocks}`,
          );
          audit({
            gate: 'tripwire',
            kind: 'identical-call',
            agent: agentKey(agent),
            tool: toolName,
            streak: state.streak,
            blocks: state.blocks,
          });
          return { kind: 'deny', reason, info: { guard: 'dsh-team-guard', gate: 'tripwire' } };
        }
      }

      return next();
    });
  }

  // ---- 前置预算检查（唯一能硬终止 turn 的钩子） -----------------------
  ctx.on('agent/pre-step', async (payload, next) => {
    const agent = payload?.agent;
    const turn = Number.isFinite(Number(payload?.turn)) ? Number(payload.turn) : 0;
    const step = Number.isFinite(Number(payload?.step)) ? Number(payload.step) : 0;
    const state = beginTurn(agent, turn);

    // 连击拦截超限 → 终止本 turn
    if (config.tripwire.enabled && escalateAfterBlocks > 0 && state.blocks >= escalateAfterBlocks) {
      log(`连击拦截累计 ${state.blocks} 次，终止 turn agent=${agentKey(agent)} turn=${turn}`);
      audit({ gate: 'tripwire', kind: 'turn-reject', agent: agentKey(agent), turn, blocks: state.blocks });
      return { kind: 'reject' };
    }

    // 预算（作用域受限：默认只管正在跑的 AgentTeams 团队）
    if (config.budget.enabled) {
      const team = budgetGlobalScope ? undefined : runningTeamFor(agent);
      const budgetApplies = budgetGlobalScope || team !== undefined;
      if (!budgetApplies) return next();

      const teamTag = team === undefined ? '' : ` team=${team.id ?? '?'}`;
      if (step >= maxStepsPerTurn) {
        log(`step 预算耗尽 agent=${agentKey(agent)} turn=${turn} step=${step}/${maxStepsPerTurn}${teamTag}`);
        audit({
          gate: 'budget',
          kind: 'steps',
          agent: agentKey(agent),
          turn,
          step,
          limit: maxStepsPerTurn,
          team: team?.id,
        });
        return { kind: 'reject' };
      }
      if (state.toolCalls >= maxToolCallsPerTurn) {
        log(`工具调用预算耗尽（pre-step）agent=${agentKey(agent)} calls=${state.toolCalls}${teamTag}`);
        audit({
          gate: 'budget',
          kind: 'tool-calls-step',
          agent: agentKey(agent),
          turn,
          calls: state.toolCalls,
          team: team?.id,
        });
        return { kind: 'reject' };
      }
      if (Number.isFinite(maxTurnSeconds) && maxTurnSeconds > 0) {
        const elapsed = (Date.now() - state.startedAt) / 1000;
        if (elapsed >= maxTurnSeconds) {
          log(`时长预算耗尽 agent=${agentKey(agent)} turn=${turn} elapsed=${elapsed.toFixed(0)}s${teamTag}`);
          audit({
            gate: 'budget',
            kind: 'seconds',
            agent: agentKey(agent),
            turn,
            elapsed: Math.round(elapsed),
            team: team?.id,
          });
          return { kind: 'reject' };
        }
      }
    }

    return next();
  });

  // ---- turn 结束清理 --------------------------------------------------
  ctx.on(
    'session/event',
    (session, event) => {
      if (event?.type !== 'turn/end') return;
      const key = typeof session?.id === 'string' ? session.id : undefined;
      if (key === undefined) return;
      states.delete(key);
    },
    { global: true },
  );

  ctx.effect?.(
    () => () => {
      states.clear();
      teamCache.clear();
    },
    'dsh-team-guard: state',
  );

  log(
    `已装载：boundary=${config.boundary.enabled} tripwire=${config.tripwire.enabled}(连击 ${identicalCallLimit} 次/升级 ${escalateAfterBlocks} 次) ` +
      `budget=${config.budget.enabled}(scope ${budgetGlobalScope ? 'all' : 'team-only'}, steps ${maxStepsPerTurn}, calls ${maxToolCallsPerTurn}, ${maxTurnSeconds}s)`,
  );
}

export { apply, resolveConfig };
export default { name: 'dsh-team-guard', inject: ['systemPrompt'], apply };
