/**
 * DSH Agent Teams Sidecar Board (Aux Pane Web UI)
 *
 * 实时扫描 Antigravity / DSH 工作区下的 `.agent-teams/` 活跃与归档团队，
 * 复用质量门 (canDeclareDelivery)、质量徽章 (qualityBadgeStates) 与 DAG 深度计算
 * 在右侧辅助面板渲染团队阵容、V2 鲸鱼娘头像、任务依赖图与成员信箱。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';

import { qualityBadgeStates } from '../../server/lib/quality-badges.js';
import { canDeclareDelivery, describeQualityLoop, taskKindOf } from '../../server/lib/quality-gates.js';
import {
  CAPTAIN_KEY,
  sanitizeKey,
  taskDepthsById,
  taskVisualState,
} from '../../server/lib/state.js';
import { auditTeamWorkspace } from '../../server/lib/workspace-audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..', '..');
const ASSETS_DIR = join(PLUGIN_ROOT, 'assets', 'agent-teams');

const DEFAULT_SCAN_ROOTS = [
  join(homedir(), '.gemini', 'antigravity', 'scratch'),
  join(homedir(), 'Documents', 'deepseek-harness', 'default-workspace'),
  join(homedir(), 'Documents', 'deepseek-harness', 'target-workspace'),
];

function safeReadJson(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeReadJsonl(filePath, limit = 20) {
  if (!existsSync(filePath)) return [];
  try {
    const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/).filter((l) => l.trim());
    const parsed = [];
    for (const line of lines.slice(-limit)) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // 跳过损坏单行
      }
    }
    return parsed;
  } catch {
    return [];
  }
}

function discoverStateRoots(extraRoots = []) {
  const candidateParents = new Set();
  const addParent = (p) => {
    if (typeof p !== 'string' || !p.trim()) return;
    const abs = resolve(p.trim());
    if (existsSync(abs)) candidateParents.add(abs);
  };

  addParent(process.env.AGY_WORKSPACE_DIR);
  for (const r of DEFAULT_SCAN_ROOTS) addParent(r);
  for (const r of extraRoots) addParent(r);

  // 支持 ANTIGRAVITY_WORKSPACE_PATHS 传入的 JSON 或分号分隔工作区路径
  const wsEnv = process.env.ANTIGRAVITY_WORKSPACE_PATHS;
  if (typeof wsEnv === 'string' && wsEnv.trim()) {
    try {
      const parsed = JSON.parse(wsEnv);
      if (Array.isArray(parsed)) parsed.forEach(addParent);
    } catch {
      wsEnv.split(';').forEach(addParent);
    }
  }

  const stateRoots = new Map();
  const registerStateDir = (wsPath, stateDir) => {
    const key = process.platform === 'win32' ? stateDir.toLowerCase() : stateDir;
    if (!stateRoots.has(key) && existsSync(stateDir)) {
      stateRoots.set(key, { workspace: wsPath, stateDir });
    }
  };

  for (const parent of candidateParents) {
    registerStateDir(parent, join(parent, '.agent-teams'));
    try {
      const subDirs = readdirSync(parent, { withFileTypes: true });
      for (const sub of subDirs) {
        if (!sub.isDirectory() || sub.name.startsWith('.') || sub.name === 'node_modules') continue;
        const subWs = join(parent, sub.name);
        registerStateDir(subWs, join(subWs, '.agent-teams'));
      }
    } catch {
      // 忽略无权限目录
    }
  }

  return [...stateRoots.values()];
}

function avatarForMember(member) {
  const text = `${member?.name ?? ''} ${member?.role ?? ''}`.toLowerCase();
  if (/architect|arch|designer|spec|规划|架构/.test(text)) return 'member-designer-v2.png';
  if (/gpt|security|whitebox|audit-gpt|审查/.test(text)) return 'member-security-v2.png';
  if (/gemini|qa|supervisor|verif|blackbox|监督|红队|测试/.test(text)) return 'member-qa-v2.png';
  if (/research|navigator|survey|调研|情报/.test(text)) return 'member-researcher-v2.png';
  if (/doc|writer|文档|白皮书/.test(text)) return 'member-docs-v2.png';
  if (/data|radar|分析/.test(text)) return 'member-data-v2.png';
  if (/engineer|core|backend|frontend|implement|repair|工程/.test(text)) return 'member-engineer-v2.png';
  return 'member-operator-v2.png';
}

function summarizeTeamRecord(workspace, teamDir, team, isArchived, archiveId = '') {
  const tasks = Array.isArray(team.tasks) ? team.tasks : [];
  const members = Array.isArray(team.members) ? team.members : [];
  const depths = taskDepthsById(tasks);
  let badgesMap = {};
  let delivery = { ok: true, blockers: [], warnings: [] };
  let loop = { state: team.phase ?? 'running', summary: '', deliverable: false };

  try {
    const audit = isArchived ? {} : auditTeamWorkspace(workspace, team);
    delivery = canDeclareDelivery(team, audit);
    loop = describeQualityLoop(team, audit);
    const rawBadges = qualityBadgeStates(tasks);
    badgesMap = rawBadges instanceof Map ? Object.fromEntries(rawBadges) : rawBadges ?? {};
  } catch {
    // 兼容早期历史不完整 team.json 的展示降级
  }

  const inboxMessages = [];
  const inboxDir = join(teamDir, 'inbox');
  if (existsSync(inboxDir)) {
    try {
      for (const f of readdirSync(inboxDir)) {
        if (!f.endsWith('.jsonl')) continue;
        const msgs = safeReadJsonl(join(inboxDir, f), 10);
        inboxMessages.push(...msgs);
      }
      inboxMessages.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    } catch {
      // 忽略
    }
  }

  return {
    id: team.id,
    archiveId,
    name: team.name ?? team.id,
    description: team.description ?? '',
    workspace,
    profile: team.profile?.name ?? null,
    phase: isArchived ? 'archived' : (team.phase ?? 'running'),
    archived: isArchived,
    halted: team.halted === true,
    escalated: team.escalated === true,
    createdAt: team.createdAt ?? 0,
    loop,
    delivery,
    members: members.map((m) => ({
      name: m.name,
      role: m.role ?? 'member',
      provider: m.activeProvider ?? m.provider ?? '',
      model: m.activeModel ?? m.model ?? '',
      status: m.status ?? 'idle',
      avatar: `/assets/agent-teams/${avatarForMember(m)}`,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      subject: t.subject,
      kind: taskKindOf(t),
      status: t.status,
      visualState: taskVisualState(t.status, t.dependencies ?? [], tasks),
      depth: depths.get(t.id) ?? 0,
      assignee: t.assignee ?? '',
      dependencies: t.dependencies ?? [],
      verdict: t.verdict ?? null,
      holdReason: t.holdReason ?? null,
      badges: badgesMap[t.id] ?? null,
      commandsCount: Array.isArray(t.commandsRun) ? t.commandsRun.length : 0,
      findingsCount: Array.isArray(t.findings) ? t.findings.length : 0,
      output: typeof t.output === 'string' ? t.output.slice(0, 240) : '',
    })),
    inbox: inboxMessages.slice(0, 15).map((m) => ({
      from: m.from ?? '?',
      to: m.to ?? '?',
      content: String(m.content ?? '').slice(0, 240),
      ts: m.ts ?? 0,
    })),
  };
}

export function collectAllTeamsState(extraRoots = []) {
  const roots = discoverStateRoots(extraRoots);
  const active = [];
  const archived = [];

  for (const { workspace, stateDir } of roots) {
    let entries = [];
    try {
      entries = readdirSync(stateDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (entry.name === 'archive') {
        const archiveRoot = join(stateDir, 'archive');
        try {
          const archEntries = readdirSync(archiveRoot, { withFileTypes: true });
          for (const arch of archEntries) {
            if (!arch.isDirectory() || arch.name.startsWith('.')) continue;
            const archDir = join(archiveRoot, arch.name);
            const rec = safeReadJson(join(archDir, 'team.json'));
            if (rec) {
              archived.push(summarizeTeamRecord(workspace, archDir, rec, true, arch.name));
            }
          }
        } catch {
          // 忽略不可读归档目录
        }
        continue;
      }

      const teamDir = join(stateDir, entry.name);
      const rec = safeReadJson(join(teamDir, 'team.json'));
      if (rec) {
        active.push(summarizeTeamRecord(workspace, teamDir, rec, false));
      }
    }
  }

  active.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  archived.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return {
    generatedAt: Date.now(),
    scannedRoots: roots.map((r) => r.workspace),
    counts: {
      active: active.length,
      archived: archived.length,
    },
    active,
    archived: archived.slice(0, 30),
  };
}

export function renderBoardHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>DSH 智能体团队看板</title>
<script src="/preload.js"></script>
<style>
  :root {
    --bg: #0b1120;
    --surface: #111827;
    --surface-2: #1e293b;
    --border: rgba(148, 163, 184, 0.18);
    --text: #f1f5f9;
    --muted: #94a3b8;
    --accent: #38bdf8;
    --ok: #34d399;
    --warn: #fbbf24;
    --err: #fb7185;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 14px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: var(--bg); color: var(--text); font-size: 13px; line-height: 1.5;
  }
  .header {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding-bottom: 12px; border-bottom: 1px solid var(--border); margin-bottom: 12px;
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { width: 32px; height: 32px; border-radius: 8px; }
  .brand h1 { font-size: 15px; margin: 0; font-weight: 600; }
  .brand small { color: var(--muted); font-size: 11px; display: block; }
  .btn {
    background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
    padding: 5px 10px; border-radius: 6px; cursor: pointer; font-size: 12px;
  }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .tabs { display: flex; gap: 6px; margin-bottom: 12px; }
  .tab {
    padding: 5px 12px; border-radius: 999px; border: 1px solid var(--border);
    background: transparent; color: var(--muted); cursor: pointer; font-size: 12px;
  }
  .tab.active { background: rgba(56, 189, 248, 0.15); color: var(--accent); border-color: var(--accent); }
  .team-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    padding: 12px; margin-bottom: 12px;
  }
  .team-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .team-title { font-weight: 600; font-size: 14px; margin: 0 0 2px 0; }
  .team-meta { color: var(--muted); font-size: 11px; word-break: break-all; }
  .badge {
    display: inline-block; padding: 2px 7px; border-radius: 999px; font-size: 11px; font-weight: 500;
    background: var(--surface-2); border: 1px solid var(--border); white-space: nowrap;
  }
  .badge.ok { color: var(--ok); border-color: rgba(52, 211, 153, 0.35); background: rgba(52, 211, 153, 0.1); }
  .badge.warn { color: var(--warn); border-color: rgba(251, 191, 36, 0.35); background: rgba(251, 191, 36, 0.1); }
  .badge.err { color: var(--err); border-color: rgba(251, 113, 133, 0.35); background: rgba(251, 113, 133, 0.1); }
  .section-label { font-size: 11px; font-weight: 600; color: var(--muted); margin: 10px 0 6px 0; text-transform: uppercase; letter-spacing: 0.04em; }
  .members-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
  .member-chip {
    display: flex; align-items: center; gap: 8px; padding: 6px 8px;
    background: var(--surface-2); border-radius: 8px; border: 1px solid var(--border);
  }
  .member-chip img { width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; }
  .member-info { min-width: 0; }
  .member-name { font-weight: 600; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .member-role { font-size: 10px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .task-item {
    padding: 7px 9px; margin-bottom: 5px; border-radius: 7px;
    background: var(--surface-2); border-left: 3px solid var(--muted);
  }
  .task-item.completed { border-left-color: var(--ok); }
  .task-item.running, .task-item.claimed { border-left-color: var(--accent); }
  .task-item.failed { border-left-color: var(--err); }
  .task-row { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
  .task-sub { font-weight: 500; font-size: 12px; }
  .task-detail { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .inbox-item { padding: 5px 8px; background: rgba(15, 23, 42, 0.6); border-radius: 6px; margin-bottom: 4px; font-size: 11px; }
  .empty { text-align: center; padding: 28px 12px; color: var(--muted); border: 1px dashed var(--border); border-radius: 10px; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <img src="/assets/agent-teams/team-lead-v2.png" alt="Captain" />
      <div>
        <h1>DSH 智能体团队看板</h1>
        <small id="sub-info">正在加载工作区状态…</small>
      </div>
    </div>
    <button class="btn" id="refresh-btn">刷新</button>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="active">活跃团队 (<span id="cnt-active">0</span>)</button>
    <button class="tab" data-tab="archived">历史归档 (<span id="cnt-archived">0</span>)</button>
  </div>
  <div id="content"></div>

<script>
  let currentTab = 'active';
  let latestData = null;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function phaseBadge(team) {
    if (team.archived) return '<span class="badge">已归档</span>';
    if (team.escalated) return '<span class="badge err">已升级熔断</span>';
    if (team.halted) return '<span class="badge warn">已暂停</span>';
    if (team.phase === 'staged') return '<span class="badge warn">待审批 (staged)</span>';
    return '<span class="badge ok">运行中</span>';
  }

  function renderTeam(team) {
    const doneCount = team.tasks.filter(t => t.status === 'completed').length;
    const deliveryHtml = !team.archived && team.delivery
      ? (team.delivery.ok
          ? '<span class="badge ok">交付门: 通过</span>'
          : '<span class="badge warn" title="' + esc((team.delivery.blockers || []).join('; ')) + '">交付门: ' + (team.delivery.blockers || []).length + ' 项待满足</span>')
      : '';

    const membersHtml = team.members.map(m =>
      '<div class="member-chip">' +
        '<img src="' + esc(m.avatar) + '" alt="' + esc(m.name) + '" />' +
        '<div class="member-info">' +
          '<div class="member-name">' + esc(m.name) + ' · ' + esc(m.status) + '</div>' +
          '<div class="member-role">' + esc(m.role) + (m.model ? ' · ' + esc(m.model) : '') + '</div>' +
        '</div>' +
      '</div>'
    ).join('');

    const tasksHtml = team.tasks.map(t => {
      const cls = esc(t.visualState || t.status);
      const verdictTxt = t.verdict ? ' · verdict:' + esc(t.verdict) : '';
      const depTxt = t.dependencies && t.dependencies.length ? ' · 依赖:' + esc(t.dependencies.join(',')) : '';
      return '<div class="task-item ' + cls + '">' +
        '<div class="task-row">' +
          '<span class="task-sub">' + esc(t.id) + ' [' + esc(t.kind) + '] ' + esc(t.subject) + '</span>' +
          '<span class="badge">' + esc(t.status) + '</span>' +
        '</div>' +
        '<div class="task-detail">负责人: ' + esc(t.assignee || '共享池') + depTxt + verdictTxt +
          (t.commandsCount ? ' · 命令证据:' + t.commandsCount : '') + '</div>' +
      '</div>';
    }).join('');

    const inboxHtml = (team.inbox || []).slice(0, 5).map(msg =>
      '<div class="inbox-item"><strong>' + esc(msg.from) + ' → ' + esc(msg.to) + '</strong>: ' + esc(msg.content) + '</div>'
    ).join('');

    return '<div class="team-card">' +
      '<div class="team-top">' +
        '<div>' +
          '<div class="team-title">' + esc(team.name) + (team.profile ? ' <span class="badge">' + esc(team.profile) + '</span>' : '') + '</div>' +
          '<div class="team-meta">' + esc(team.workspace) + (team.description ? '<br/>' + esc(team.description) : '') + '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">' + phaseBadge(team) + deliveryHtml + '</div>' +
      '</div>' +
      '<div class="section-label">成员阵容 (' + team.members.length + ')</div>' +
      '<div class="members-grid">' + (membersHtml || '<span class="team-meta">暂无成员</span>') + '</div>' +
      '<div class="section-label">任务 DAG (' + doneCount + '/' + team.tasks.length + ' 已完成)</div>' +
      (tasksHtml || '<div class="team-meta">暂无任务</div>') +
      (inboxHtml ? '<div class="section-label">最近邮箱通信</div>' + inboxHtml : '') +
    '</div>';
  }

  function render() {
    if (!latestData) return;
    document.getElementById('cnt-active').textContent = latestData.counts.active;
    document.getElementById('cnt-archived').textContent = latestData.counts.archived;
    document.getElementById('sub-info').textContent = '已扫描 ' + latestData.scannedRoots.length + ' 个工作区 · 自动刷新中';
    const list = currentTab === 'active' ? latestData.active : latestData.archived;
    const container = document.getElementById('content');
    if (!list || list.length === 0) {
      container.innerHTML = '<div class="empty">当前没有' + (currentTab === 'active' ? '活跃团队' : '归档记录') + '。<br/><small>可尝试用 /agent-teams 技能组建新团队。</small></div>';
      return;
    }
    container.innerHTML = list.map(renderTeam).join('');
  }

  async function refresh() {
    try {
      const resp = await fetch('/_api/state');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      latestData = await resp.json();
      render();
    } catch (err) {
      document.getElementById('sub-info').textContent = '读取失败: ' + err.message;
    }
  }

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      render();
    });
  });
  document.getElementById('refresh-btn').addEventListener('click', refresh);
  refresh();
  setInterval(refresh, 4000);
</script>
</body>
</html>`;
}

function startSidecarServer() {
  const app = new SidecarApp();
  app.page('/', () => new Response(renderBoardHtml(), { contentType: 'text/html; charset=utf-8' }));

  if (existsSync(ASSETS_DIR)) {
    for (const file of readdirSync(ASSETS_DIR)) {
      if (!file.endsWith('.png')) continue;
      const fullPath = join(ASSETS_DIR, file);
      app.page(`/assets/agent-teams/${file}`, () => {
        const buf = readFileSync(fullPath);
        return new Response(buf, { contentType: 'image/png' });
      });
    }
  }

  app.api('/_api/state', () => collectAllTeamsState(), 'GET');
  app.run().catch((err) => {
    console.error('[team_board sidecar] failed to start:', err);
    process.exit(1);
  });
}

const isEntrypoint = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint && process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) {
  startSidecarServer();
}
