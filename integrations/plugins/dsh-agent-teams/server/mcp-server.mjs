/**
 * DSH Agent Teams MCP Server (migrated to Google Antigravity)
 *
 * Reuses the pure Node.js core modules from dsh-agent-teams 0.1.27-nav:
 * - State machine, locks, mailboxes & generational archive (state.js)
 * - P0 quality gates, sha256 artifact binding & delivery gate (quality-gates.js, artifacts.js, workspace-audit.js)
 * - Quality badges & task visual states (quality-badges.js)
 * - Profiles & P-P-C-G-R templates (default-profiles.js, profiles.js, prompt-templates.js)
 * - Goal intake & channel policies (goal-intake.js, channel-policy.js, role-priority.js)
 * - Watchdog self-healing & recovery approval (watchdog.js, recovery-approval.js)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { readArtifactScope, snapshotWorkspacePaths, workspacePathExists } from './lib/artifacts.js';
import { DEFAULT_DISPATCH_POLICY, channelFamilyOf, evaluateDispatch } from './lib/channel-policy.js';
import { withDefaultProfiles } from './lib/default-profiles.js';
import { buildGoalRecommendation, recommendationToInlinePlan } from './lib/goal-intake.js';
import { listConfiguredProfiles, resolveTeamProfile } from './lib/profiles.js';
import { qualityBadgeStates } from './lib/quality-badges.js';
import {
  amendTaskContract,
  appendTaskEvidence,
  artifactDrift,
  bindReviewToRevision,
  buildCoverageMatrix,
  canDeclareDelivery,
  describeQualityLoop,
  evaluateQualityCompletion,
  isQualityKind,
  judgeConflictFor,
  normalizeBlankOptionalTaskFields,
  planQualityFollowUp,
  resolveEscalationState,
  resumeTeamState,
  sanitizeReviewAcceptance,
  sanitizeReviewObjective,
  taskKindOf,
  validateCreateTask,
  verdictScopePatterns,
} from './lib/quality-gates.js';
import { consumeRecoveryGrant, requestRecoveryGrant } from './lib/recovery-approval.js';
import {
  CAPTAIN_KEY,
  acknowledgeMailbox,
  appendMailbox,
  archiveTeamDir,
  beginTaskAttempt,
  createMessage,
  createTeamDir,
  invalidateTaskAttempt,
  listArchivedTeamIds,
  purgeArchivedTeam,
  readMailbox,
  readTeam,
  readUnreadMailbox,
  recordRetiredMemberIds,
  sanitizeKey,
  teamLockKey,
  transitionError,
  unsatisfiedDependencies,
  withTeamLock,
  writeTeam,
} from './lib/state.js';
import { TERMINAL_TASK_STATUSES } from './lib/types.js';
import { inspectAndHealTeam } from './lib/watchdog.js';
import { auditTeamWorkspace } from './lib/workspace-audit.js';

const SERVER_NAME = 'dsh-agent-teams';
const SERVER_VERSION = '0.1.27';
const MAX_MEMBERS_CAP = 12;
const DEFAULT_FALLBACK_WORKSPACE = join(homedir(), '.gemini', 'antigravity', 'scratch', 'default-team-workspace');

// ---------------------------------------------------------------------------
// Workspace & state resolution
// ---------------------------------------------------------------------------

function isUnwritableSystemDir(dir) {
  const norm = resolve(dir).toLowerCase();
  return (
    norm === 'c:\\windows\\system32' ||
    norm === 'c:\\windows' ||
    norm === 'c:\\windows\\syswow64' ||
    norm === '/'
  );
}

function resolveWorkspace(args = {}) {
  const candidates = [
    typeof args.workspace === 'string' ? args.workspace.trim() : '',
    typeof process.env.AGY_WORKSPACE_DIR === 'string' ? process.env.AGY_WORKSPACE_DIR.trim() : '',
    process.cwd(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isUnwritableSystemDir(candidate)) continue;
    const abs = resolve(candidate);
    if (!existsSync(abs)) {
      mkdirSync(abs, { recursive: true });
    }
    return abs;
  }

  mkdirSync(DEFAULT_FALLBACK_WORKSPACE, { recursive: true });
  return DEFAULT_FALLBACK_WORKSPACE;
}

function stateRootOf(workspace) {
  return join(workspace, '.agent-teams');
}

function captainSessionId() {
  return (typeof process.env.ANTIGRAVITY_CONVERSATION_ID === 'string' && process.env.ANTIGRAVITY_CONVERSATION_ID.trim())
    ? process.env.ANTIGRAVITY_CONVERSATION_ID.trim()
    : 'antigravity-captain';
}

function loadProfiles(workspace) {
  let custom = {};
  const candidates = [
    join(workspace, '.agent-teams', 'profiles.json'),
    join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'profiles.json'),
  ];
  for (const file of candidates) {
    try {
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, 'utf-8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          custom = { ...custom, ...parsed };
        }
      }
    } catch {
      // Ignore malformed optional override files; built-ins stay authoritative.
    }
  }
  return withDefaultProfiles(custom);
}

function listLiveTeamDirs(stateRoot) {
  if (!existsSync(stateRoot)) return [];
  try {
    return readdirSync(stateRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'archive' && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

async function resolveTargetTeamId(stateRoot, rawTeamId) {
  const explicit = typeof rawTeamId === 'string' ? rawTeamId.trim() : '';
  if (explicit !== '') {
    if (explicit !== explicit.toLowerCase()) {
      throw new Error(
        `CASE_COLLISION: team id "${explicit}" must be lowercase (collides with "${explicit.toLowerCase()}" on case-insensitive filesystems)`
      );
    }
    return explicit;
  }

  const dirs = listLiveTeamDirs(stateRoot);
  if (dirs.length === 0) {
    throw new Error(`no active team found under ${stateRoot} — call agent_teams_create first`);
  }
  if (dirs.length === 1) {
    return dirs[0];
  }

  const cid = captainSessionId();
  const matched = [];
  for (const id of dirs) {
    const rec = await readTeam(stateRoot, id).catch(() => undefined);
    if (rec && rec.captainSessionId === cid) {
      matched.push(id);
    }
  }
  if (matched.length === 1) {
    return matched[0];
  }
  throw new Error(`multiple active teams exist (${dirs.join(', ')}); please specify team_id explicitly`);
}

async function requireFreshTeam(stateRoot, teamId, options = {}) {
  if (teamId !== teamId.toLowerCase()) {
    throw new Error(
      `CASE_COLLISION: team id "${teamId}" must be lowercase (collides with "${teamId.toLowerCase()}" on case-insensitive filesystems)`
    );
  }
  const team = await readTeam(stateRoot, teamId);
  if (!team) {
    throw new Error(`team "${teamId}" is no longer active under ${stateRoot}`);
  }
  if (team.phase === 'cancelling' && options.allowCancelling !== true) {
    throw new Error(`team "${teamId}" is cancelling (archive/delete in progress)`);
  }
  return team;
}

function requireMember(team, name) {
  const clean = String(name ?? '').trim();
  const member = team.members.find((m) => m.name === clean && m.status !== 'removed');
  if (!member) {
    throw new Error(`no active member named "${clean}" in team "${team.name}"`);
  }
  return member;
}

function requireTask(team, taskId) {
  const clean = String(taskId ?? '').trim();
  const task = team.tasks.find((t) => t.id === clean);
  if (!task) {
    throw new Error(`no task "${clean}" in team "${team.name}" — use agent_teams_status to list tasks`);
  }
  return task;
}

function requireStagedTeam(team) {
  if (team.phase !== 'staged') {
    throw new Error(`team "${team.name}" is already running; staged-only operation is not allowed`);
  }
  if (team.halted === true) {
    throw new Error(`team "${team.name}" is halted, not awaiting plan approval`);
  }
}

// ---------------------------------------------------------------------------
// Input normalization & parsers (ported with Antigravity compatibility)
// ---------------------------------------------------------------------------

function trimmedOptional(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function sanitizeRosterTags(value, pathLabel) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`${pathLabel} must be an array of strings`);
  const tags = [];
  for (let i = 0; i < value.length; i += 1) {
    if (typeof value[i] !== 'string') throw new Error(`${pathLabel}[${i}] must be a string`);
    const t = value[i].trim();
    if (t !== '' && !tags.includes(t)) tags.push(t);
  }
  return tags.length === 0 ? undefined : tags;
}

function normalizeStatus(status) {
  if (status === undefined) return undefined;
  const s = String(status).trim();
  if (s === 'in-progress') return 'in_progress';
  if (s === 'canceled') return 'cancelled';
  return s;
}

function normalizeVerdict(verdict) {
  if (verdict === undefined) return undefined;
  const v = String(verdict).trim();
  if (v === 'fail') return 'needs_revision';
  return v;
}

function normalizeTaskDraft(raw, index = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`tasks[${index}] must be an object`);
  }
  const kind = trimmedOptional(raw.kind);
  const subject = trimmedOptional(raw.subject) ?? trimmedOptional(raw.title);
  if (!subject) {
    throw new Error(`tasks[${index}] requires a non-empty subject (or title)`);
  }
  const id = trimmedOptional(raw.id) ?? `seed-${index + 1}`;
  const dependencies = raw.dependencies ?? raw.dependsOn ?? [];
  const reviewedTaskId =
    trimmedOptional(raw.reviewedTaskId) ??
    (kind === 'review' ? trimmedOptional(raw.subjectTaskId) : undefined);
  const sourceTaskId =
    trimmedOptional(raw.sourceTaskId) ??
    (kind === 'repair' ? trimmedOptional(raw.subjectTaskId) : undefined);
  const coverageOf =
    raw.coverageOf ??
    (kind === 'verification' && trimmedOptional(raw.subjectTaskId)
      ? [trimmedOptional(raw.subjectTaskId)]
      : undefined);

  return {
    id,
    subject,
    ...(trimmedOptional(raw.description) ? { description: trimmedOptional(raw.description) } : {}),
    ...(trimmedOptional(raw.assignee) ? { assignee: trimmedOptional(raw.assignee) } : {}),
    dependencies: Array.isArray(dependencies) ? dependencies.map((d) => String(d).trim()).filter(Boolean) : [],
    ...(kind ? { kind } : {}),
    ...(Number.isSafeInteger(raw.round) ? { round: raw.round } : {}),
    ...(trimmedOptional(raw.objective) ? { objective: trimmedOptional(raw.objective) } : {}),
    ...(Array.isArray(raw.inScope ?? raw.fileScope) ? { inScope: raw.inScope ?? raw.fileScope } : {}),
    ...(Array.isArray(raw.outOfScope) ? { outOfScope: raw.outOfScope } : {}),
    ...(Array.isArray(raw.acceptance ?? raw.acceptanceCriteria) ? { acceptance: raw.acceptance ?? raw.acceptanceCriteria } : {}),
    ...(Array.isArray(raw.verify ?? raw.verificationCommands) ? { verify: raw.verify ?? raw.verificationCommands } : {}),
    ...(Array.isArray(raw.deliverables ?? raw.expectedArtifacts) ? { deliverables: raw.deliverables ?? raw.expectedArtifacts } : {}),
    ...(Array.isArray(raw.nonGoals) ? { nonGoals: raw.nonGoals } : {}),
    ...(reviewedTaskId ? { reviewedTaskId } : {}),
    ...(sourceTaskId ? { sourceTaskId } : {}),
    ...(Array.isArray(raw.sourceFindingIds) ? { sourceFindingIds: raw.sourceFindingIds } : {}),
    ...(Array.isArray(coverageOf) ? { coverageOf } : {}),
  };
}

function normalizeCreateTaskArgs(args) {
  const kind = trimmedOptional(args.kind);
  const subject = trimmedOptional(args.subject) ?? trimmedOptional(args.title);
  const dependencies = args.dependencies ?? args.dependsOn;
  const inScope = args.inScope ?? args.fileScope;
  const acceptance = args.acceptance ?? args.acceptanceCriteria;
  const verify = args.verify ?? args.verificationCommands;
  const deliverables = args.deliverables ?? args.expectedArtifacts;
  const reviewedTaskId =
    trimmedOptional(args.reviewedTaskId) ??
    (kind === 'review' ? trimmedOptional(args.subjectTaskId) : undefined);
  const sourceTaskId =
    trimmedOptional(args.sourceTaskId) ??
    (kind === 'repair' ? trimmedOptional(args.subjectTaskId) : undefined);
  const coverageOf =
    args.coverageOf ??
    (kind === 'verification' && trimmedOptional(args.subjectTaskId)
      ? [trimmedOptional(args.subjectTaskId)]
      : undefined);

  return normalizeBlankOptionalTaskFields({
    ...args,
    subject,
    dependencies,
    inScope,
    acceptance,
    verify,
    deliverables,
    reviewedTaskId,
    sourceTaskId,
    coverageOf,
  });
}

function parseFindings(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('findings must be an array');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`findings[${index}] must be an object`);
    }
    const id = typeof item.id === 'string' && item.id.trim() !== '' ? item.id.trim() : `f-${index + 1}`;
    const severity = item.severity;
    if (!['low', 'medium', 'high', 'blocker'].includes(severity)) {
      throw new Error(`findings[${index}].severity is invalid (must be low|medium|high|blocker)`);
    }
    const problem = item.problem ?? item.description ?? item.message;
    const requiredFix = item.requiredFix ?? item.fix ?? item.suggestion;
    if (typeof problem !== 'string' || problem.trim() === '') {
      throw new Error(`findings[${index}].problem is required`);
    }
    if (typeof requiredFix !== 'string' || requiredFix.trim() === '') {
      throw new Error(`findings[${index}].requiredFix is required`);
    }
    return {
      id,
      severity,
      problem: problem.trim(),
      requiredFix: requiredFix.trim(),
      ...(typeof item.file === 'string' && item.file.trim() !== '' ? { file: item.file.trim() } : {}),
      ...(Number.isSafeInteger(item.line) && item.line >= 0 ? { line: item.line } : {}),
      ...(typeof item.resolved === 'boolean' ? { resolved: item.resolved } : {}),
    };
  });
}

function parseAcceptanceResults(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('acceptanceResults must be an array');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`acceptanceResults[${index}] must be an object`);
    }
    if (typeof item.criterion !== 'string' || item.criterion.trim() === '') {
      throw new Error(`acceptanceResults[${index}].criterion is required`);
    }
    if (item.status !== 'passed' && item.status !== 'failed') {
      throw new Error(`acceptanceResults[${index}].status must be passed or failed`);
    }
    return {
      criterion: item.criterion,
      status: item.status,
      ...(typeof item.evidence === 'string' ? { evidence: item.evidence } : {}),
    };
  });
}

function parseCommandResults(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('commandsRun must be an array');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`commandsRun[${index}] must be an object`);
    }
    const command = trimmedOptional(item.command) ?? trimmedOptional(item.cmd);
    if (!command) {
      throw new Error(`commandsRun[${index}].command is required`);
    }
    let status = item.status;
    if (status === undefined && typeof item.exitCode === 'number') {
      status = item.exitCode === 0 ? 'passed' : 'failed';
    }
    if (status !== 'passed' && status !== 'failed') {
      throw new Error(`commandsRun[${index}].status must be passed or failed`);
    }
    return {
      command,
      status,
      ...(typeof item.exitCode === 'number' ? { exitCode: item.exitCode } : {}),
      ...(typeof item.evidence === 'string' ? { evidence: item.evidence } : {}),
    };
  });
}

function validateStagedGraph(team, requireRunnable) {
  const members = team.members.filter((m) => m.status !== 'removed');
  if (requireRunnable && members.length === 0) {
    throw new Error('add at least one member before approving the plan');
  }
  if (requireRunnable && team.tasks.length === 0) {
    throw new Error('add at least one task before approving the plan');
  }
  const memberNames = new Set(members.map((m) => m.name));
  const taskIds = new Set(team.tasks.map((t) => t.id));
  for (const task of team.tasks) {
    if (task.subject.trim() === '') {
      throw new Error(`task "${task.id}" must have a subject`);
    }
    if (task.assignee !== undefined && task.assignee !== CAPTAIN_KEY && !memberNames.has(task.assignee)) {
      throw new Error(`task "${task.id}" assignee "${task.assignee}" is not an active member`);
    }
    for (const dep of task.dependencies) {
      if (dep === task.id) throw new Error(`task "${task.id}" cannot depend on itself`);
      if (!taskIds.has(dep)) throw new Error(`task "${task.id}" depends on unknown task "${dep}"`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(team.tasks.map((t) => [t.id, t]));
  const visit = (id) => {
    if (visiting.has(id)) throw new Error(`task dependency graph contains a cycle at "${id}"`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id)?.dependencies ?? []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of team.tasks) visit(task.id);
}

function buildMemberRecord(input, fallbackDefaults = {}) {
  const name = trimmedOptional(input.name);
  if (!name) throw new Error('member name must not be empty');
  const key = sanitizeKey(name);
  if (key === CAPTAIN_KEY) {
    throw new Error(`member name "${name}" is reserved for the captain`);
  }
  const provider = trimmedOptional(input.provider) ?? fallbackDefaults.provider ?? 'antigravity';
  const model = trimmedOptional(input.model) ?? fallbackDefaults.model ?? 'inherit';
  const reasoningEffort = trimmedOptional(input.reasoningEffort) ?? trimmedOptional(input.reasoning_effort);
  const executionPrompt = trimmedOptional(input.executionPrompt) ?? trimmedOptional(input.prompt);
  const capabilities = sanitizeRosterTags(input.capabilities, `member "${name}" capabilities`);
  const noAssign = sanitizeRosterTags(input.noAssign, `member "${name}" noAssign`);

  return {
    id: '',
    name,
    role: trimmedOptional(input.role),
    provider,
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(executionPrompt ? { executionPrompt } : {}),
    ...(input.fallback && typeof input.fallback === 'object' ? { fallback: input.fallback } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(noAssign ? { noAssign } : {}),
    joinedAt: Date.now(),
    status: 'idle',
  };
}

function seedDraftTasks(profile) {
  const seedToActual = new Map(profile.tasks.map((tpl, idx) => [tpl.id, `t${idx + 1}`]));
  const now = Date.now();
  return profile.tasks.map((tpl, idx) => ({
    id: `t${idx + 1}`,
    profileSeedId: tpl.id,
    subject: tpl.subject,
    ...(tpl.description !== undefined ? { description: tpl.description } : {}),
    status: 'pending',
    ...(tpl.assignee !== undefined ? { assignee: tpl.assignee } : {}),
    dependencies: (tpl.dependencies ?? []).map((dep) => seedToActual.get(dep) ?? dep),
    attempt: 0,
    ...(tpl.kind === undefined ? {} : { kind: tpl.kind }),
    ...(tpl.objective === undefined ? {} : { objective: tpl.objective }),
    ...(tpl.inScope === undefined ? {} : { inScope: [...tpl.inScope] }),
    ...(tpl.outOfScope === undefined ? {} : { outOfScope: [...tpl.outOfScope] }),
    ...(tpl.acceptance === undefined ? {} : { acceptance: [...tpl.acceptance] }),
    ...(tpl.verify === undefined ? {} : { verify: [...tpl.verify] }),
    ...(tpl.deliverables === undefined ? {} : { deliverables: [...tpl.deliverables] }),
    ...(tpl.nonGoals === undefined ? {} : { nonGoals: [...tpl.nonGoals] }),
    ...(tpl.reviewedTaskId === undefined
      ? {}
      : { reviewedTaskId: seedToActual.get(tpl.reviewedTaskId) ?? tpl.reviewedTaskId }),
    ...(tpl.sourceTaskId === undefined
      ? {}
      : { sourceTaskId: seedToActual.get(tpl.sourceTaskId) ?? tpl.sourceTaskId }),
    ...(tpl.sourceFindingIds === undefined ? {} : { sourceFindingIds: [...tpl.sourceFindingIds] }),
    ...(tpl.coverageOf === undefined
      ? {}
      : { coverageOf: tpl.coverageOf.map((c) => seedToActual.get(c) ?? c) }),
    createdAt: now,
    updatedAt: now,
  }));
}

// ---------------------------------------------------------------------------
// Quality gates & revision snapshots
// ---------------------------------------------------------------------------

function attachVerdictStartSnapshot(workspace, team, task) {
  const kind = taskKindOf(task);
  if (kind !== 'review' && kind !== 'requirements' && kind !== 'verification') return;
  const scope = verdictScopePatterns(team, task);
  if (scope.length === 0) {
    task.verdictStartSnapshot = undefined;
    return;
  }
  const snap = snapshotWorkspacePaths(workspace, scope);
  task.verdictStartSnapshot = {
    ...snap,
    at: snap.at ?? snap.takenAt ?? Date.now(),
  };
}

function bindClosingVerdict(workspace, team, task) {
  if (task.status === 'failed' || task.status === 'cancelled') {
    task.verdictStartSnapshot = undefined;
    return;
  }
  if (task.status !== 'completed') return;
  const kind = taskKindOf(task);
  if (kind !== 'review' && kind !== 'requirements' && kind !== 'verification') return;
  if ((kind === 'review' || kind === 'requirements') && task.verdict !== 'pass') return;
  const scope = verdictScopePatterns(team, task);
  if (scope.length === 0) return;
  const read = readArtifactScope(workspace, scope);
  const duringDrift =
    task.verdictStartSnapshot === undefined ? [] : artifactDrift(task.verdictStartSnapshot.artifacts, read.artifacts);
  const bound = bindReviewToRevision(team, task, {
    artifacts: read.artifacts,
    gaps: read.gaps,
    scope,
    duringDrift,
  });
  task.reviewedTaskId = bound.reviewedTaskId;
  task.reviewedAttempt = bound.reviewedAttempt;
  task.reviewedArtifacts = bound.reviewedArtifacts;
  task.reviewedGaps = bound.reviewedGaps;
  task.reviewedScope = bound.reviewedScope;
  task.reviewedDuringDrift = bound.reviewedDuringDrift;
  task.verdictStartSnapshot = undefined;
}

function applyQualityFollowUp(team, closed, snapshotPaths, pathExists) {
  const planned = planQualityFollowUp(team, closed, pathExists === undefined ? {} : { pathExists });
  if (planned.escalated === true) team.escalated = true;
  const created = [];
  const existing = [...team.tasks];
  const now = Date.now();
  const idBySubject = new Map();
  for (const draft of planned.created) {
    team.taskSeq += 1;
    const id = `t${team.taskSeq}`;
    if (draft.id !== undefined) idBySubject.set(draft.id, id);
    if (draft.subject !== undefined) idBySubject.set(draft.subject, id);
    const dependencies = (draft.dependencies ?? []).map((dep) =>
      team.tasks.some((item) => item.id === dep) ? dep : (idBySubject.get(dep) ?? dep)
    );
    const contractSnapshot =
      !draft.contractPaths || draft.contractPaths.length === 0 || !snapshotPaths
        ? undefined
        : snapshotPaths(draft.contractPaths);
    const next = {
      id,
      subject: draft.subject ?? `${draft.kind}-round-${draft.round ?? 1}`,
      status: 'pending',
      assignee: draft.assignee,
      dependencies,
      attempt: 0,
      createdAt: now,
      updatedAt: now,
      kind: draft.kind,
      ...(draft.description === undefined ? {} : { description: draft.description }),
      ...(draft.round === undefined ? {} : { round: draft.round }),
      ...(draft.objective === undefined ? {} : { objective: draft.objective }),
      ...(draft.inScope === undefined ? {} : { inScope: draft.inScope }),
      ...(draft.outOfScope === undefined ? {} : { outOfScope: draft.outOfScope }),
      ...(draft.acceptance === undefined ? {} : { acceptance: draft.acceptance }),
      ...(draft.verify === undefined ? {} : { verify: draft.verify }),
      ...(draft.sourceTaskId === undefined ? {} : { sourceTaskId: draft.sourceTaskId }),
      ...(draft.sourceFindingIds === undefined ? {} : { sourceFindingIds: draft.sourceFindingIds }),
      ...(draft.findingSourceTaskIds === undefined ? {} : { findingSourceTaskIds: draft.findingSourceTaskIds }),
      ...(draft.reviewedTaskId === undefined
        ? {}
        : { reviewedTaskId: idBySubject.get(draft.reviewedTaskId) ?? draft.reviewedTaskId }),
      ...(contractSnapshot === undefined ? {} : { contractSnapshot }),
    };
    team.tasks.push(next);
    created.push(next);
  }
  const replacement = created.at(-1);
  if (replacement !== undefined) {
    for (const task of existing) {
      if (task.status !== 'pending' || !task.dependencies.includes(closed.id)) continue;
      task.dependencies = task.dependencies.map((dep) => (dep === closed.id ? replacement.id : dep));
      task.updatedAt = now;
    }
  }
  return {
    created,
    escalated: planned.escalated === true,
    ...(planned.reason === undefined ? {} : { reason: planned.reason }),
    ...(planned.excludedFindings === undefined ? {} : { excludedFindings: planned.excludedFindings }),
  };
}

function syncMemberIdleStatus(team, memberName) {
  if (!memberName || memberName === CAPTAIN_KEY) return;
  const member = team.members.find((m) => m.name === memberName && m.status !== 'removed');
  if (!member) return;
  const stillBusy = team.tasks.some(
    (t) => t.assignee === memberName && (t.status === 'claimed' || t.status === 'in_progress')
  );
  member.status = stillBusy ? 'working' : 'idle';
}

async function issueLocalRecoveryGrant(team, toolName, reason, taskId) {
  const approvalService = {
    async request() {
      return 'allowed-once';
    },
  };
  return requestRecoveryGrant(approvalService, { id: captainSessionId() }, team, toolName, reason, undefined, taskId);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function readyTasksOf(team) {
  if (team.phase === 'staged' || team.halted === true) return [];
  return team.tasks.filter(
    (t) =>
      t.status === 'pending' &&
      !t.holdReason &&
      unsatisfiedDependencies(team.tasks, t.dependencies).length === 0
  );
}

function taskDetailsText(team, task) {
  const depOutputs = task.dependencies
    .map((depId) => team.tasks.find((t) => t.id === depId))
    .filter((dep) => dep && dep.output)
    .map((dep) => `- ${dep.id} (${dep.subject}): ${dep.output.slice(0, 600)}`)
    .join('\n');
  return [
    `${task.id}: ${task.subject}`,
    task.description ? `Description: ${task.description}` : '',
    `Kind: ${taskKindOf(task)}`,
    task.objective ? `Objective: ${task.objective}` : '',
    task.inScope?.length || task.outOfScope?.length
      ? `In scope: ${(task.inScope ?? []).join(', ')}; Out of scope: ${(task.outOfScope ?? []).join(', ')}`
      : '',
    task.acceptance?.length ? `Acceptance: ${task.acceptance.join('; ')}` : '',
    task.verify?.length ? `Verify: ${task.verify.join('; ')}` : '',
    depOutputs ? `Dependency results:\n${depOutputs}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Tool implementations (20 tools)
// ---------------------------------------------------------------------------

const TOOL_DEFS = [
  {
    name: 'agent_teams_recommend_goal',
    description:
      'Analyze a natural-language goal and recommend a staged AgentTeams roster, multi-model routing, and dependency DAG using DSH goal-intake rules + available profiles.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'The user goal or project objective to plan for.' },
        workspace: { type: 'string', description: 'Optional workspace root path.' },
      },
      required: ['goal'],
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const goal = trimmedOptional(args.goal);
      if (!goal) throw new Error('goal must be a non-empty string');
      const rec = buildGoalRecommendation({
        goal,
        captainRoute: { provider: 'antigravity', model: 'captain' },
      });
      const inlinePlan = recommendationToInlinePlan(rec);
      const profiles = listConfiguredProfiles(loadProfiles(workspace)).map((p) => ({
        name: p.name,
        description: p.config.description ?? '',
        members: (p.config.members ?? []).map((m) => `${m.name}(${m.role ?? m.model})`),
        tasks: (p.config.tasks ?? []).length,
      }));
      return {
        workspace,
        recommendation: rec,
        suggested_inline_plan: inlinePlan,
        available_profiles: profiles,
      };
    },
  },
  {
    name: 'agent_teams_create',
    description:
      'Create a new AgentTeams workspace state under <workspace>/.agent-teams/<teamId>. Supports built-in profiles (chatgpt-crew, heterogeneous-cross-review, ai-radar-squad) or inline plan ({ members, tasks }). approval=required (default) creates a staged plan for user review; approval=automatic starts immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Team name (lowercased/sanitized as stable team_id).' },
        description: { type: 'string', description: 'Team goal or mission description.' },
        profile: {
          type: 'string',
          description: 'Optional preset profile name: chatgpt-crew, heterogeneous-cross-review, or ai-radar-squad.',
        },
        approval: {
          type: 'string',
          enum: ['required', 'automatic'],
          description: 'required (default) stages the plan for review; automatic activates immediately.',
        },
        plan: {
          type: 'object',
          description: 'Optional inline plan { summary?, members, tasks }. Mutually exclusive with profile.',
        },
        members: { type: 'array', description: 'Optional shorthand members array if plan object is omitted.' },
        tasks: { type: 'array', description: 'Optional shorthand tasks array if plan object is omitted.' },
        workspace: { type: 'string', description: 'Optional workspace root path.' },
      },
      required: ['name'],
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamName = trimmedOptional(args.name);
      if (!teamName) throw new Error('team name must not be empty');
      const teamId = sanitizeKey(teamName);
      const profileName = trimmedOptional(args.profile);

      const rawPlan =
        args.plan && typeof args.plan === 'object' && !Array.isArray(args.plan)
          ? args.plan
          : Array.isArray(args.members) || Array.isArray(args.tasks)
            ? { members: args.members ?? [], tasks: args.tasks ?? [] }
            : undefined;

      const hasPlanContent =
        rawPlan !== undefined &&
        ((Array.isArray(rawPlan.members) && rawPlan.members.length > 0) ||
          (Array.isArray(rawPlan.tasks) && rawPlan.tasks.length > 0));

      if (profileName && hasPlanContent) {
        throw new Error('choose either profile or inline plan/members/tasks, not both');
      }

      const approvalMode = args.approval === 'automatic' ? 'automatic' : 'required';
      const staged = approvalMode === 'required';
      const now = Date.now();
      let draft;

      if (profileName) {
        const profiles = loadProfiles(workspace);
        const resolved = resolveTeamProfile(profiles, profileName, MAX_MEMBERS_CAP);
        draft = {
          name: teamName,
          id: teamId,
          ...(trimmedOptional(args.description) ? { description: trimmedOptional(args.description) } : {}),
          profile: {
            name: resolved.name,
            ...(resolved.description ? { description: resolved.description } : {}),
            ...(resolved.protocol ? { protocol: resolved.protocol } : {}),
            ...(resolved.executionPrompt ? { executionPrompt: resolved.executionPrompt } : {}),
            taskPlanning: resolved.taskPlanning,
            ...(resolved.reviewPolicy ? { reviewPolicy: resolved.reviewPolicy } : {}),
          },
          ...(resolved.reviewPolicy ? { reviewPolicy: resolved.reviewPolicy } : {}),
          captainSessionId: captainSessionId(),
          createdAt: now,
          ...(staged ? { phase: 'staged', planReviewState: 'awaiting_review' } : { phase: 'running', approvedAt: now }),
          members: resolved.members.map((tpl) =>
            buildMemberRecord(
              {
                name: tpl.name,
                role: tpl.role,
                provider: tpl.provider,
                model: tpl.model,
                reasoningEffort: tpl.reasoningEffort,
                executionPrompt: tpl.executionPrompt ?? resolved.executionPrompt,
                fallback: tpl.fallback ?? resolved.fallback,
                capabilities: tpl.capabilities,
                noAssign: tpl.noAssign,
              },
              {}
            )
          ),
          tasks: seedDraftTasks(resolved),
          taskSeq: resolved.tasks.length,
        };
      } else if (hasPlanContent) {
        const rawMembers = Array.isArray(rawPlan.members) ? rawPlan.members : [];
        if (rawMembers.length > MAX_MEMBERS_CAP) {
          throw new Error(`member count exceeds limit (${MAX_MEMBERS_CAP})`);
        }
        const rawTasks = Array.isArray(rawPlan.tasks) ? rawPlan.tasks : [];
        const normalizedTasks = rawTasks.map((t, idx) => normalizeTaskDraft(t, idx));
        const description =
          trimmedOptional(args.description) ?? trimmedOptional(rawPlan.summary) ?? trimmedOptional(rawPlan.description);

        const syntheticProfile = {
          tasks: normalizedTasks,
        };
        const seededTasks = seedDraftTasks(syntheticProfile);
        const syntheticTeam = {
          id: teamId,
          name: teamName,
          members: rawMembers.map((m) => buildMemberRecord(m)),
          tasks: [],
        };
        for (const task of seededTasks) {
          const gate = validateCreateTask(syntheticTeam, task);
          if (!gate.ok) {
            throw new Error(`plan task "${task.subject}" rejected by quality gates: ${gate.error}`);
          }
          syntheticTeam.tasks.push(task);
        }
        draft = {
          name: teamName,
          id: teamId,
          ...(description ? { description } : {}),
          captainSessionId: captainSessionId(),
          createdAt: now,
          ...(staged ? { phase: 'staged', planReviewState: 'awaiting_review' } : { phase: 'running', approvedAt: now }),
          members: syntheticTeam.members,
          tasks: seededTasks,
          taskSeq: seededTasks.length,
        };
        validateStagedGraph(draft, false);
      } else {
        draft = {
          name: teamName,
          id: teamId,
          ...(trimmedOptional(args.description) ? { description: trimmedOptional(args.description) } : {}),
          captainSessionId: captainSessionId(),
          createdAt: now,
          ...(staged ? { phase: 'staged', planReviewState: 'awaiting_review' } : { phase: 'running', approvedAt: now }),
          members: [],
          tasks: [],
          taskSeq: 0,
        };
      }

      await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const existing = await readTeam(stateRoot, teamId);
        if (existing) {
          throw new Error(`team "${teamId}" already exists under ${stateRoot}; pick another name or delete/archive it first`);
        }
        await createTeamDir(stateRoot, draft);
      });

      return {
        team_id: draft.id,
        team_name: draft.name,
        workspace,
        state_dir: join(stateRoot, draft.id),
        phase: draft.phase ?? 'running',
        ...(draft.profile ? { profile: draft.profile.name } : {}),
        members: draft.members.map((m) => ({
          name: m.name,
          role: m.role ?? '',
          provider: m.provider ?? '',
          model: m.model ?? '',
          status: m.status,
        })),
        tasks: draft.tasks.map((t) => ({
          id: t.id,
          seed_id: t.profileSeedId ?? '',
          subject: t.subject,
          kind: taskKindOf(t),
          status: t.status,
          assignee: t.assignee ?? 'unassigned',
          dependencies: t.dependencies,
        })),
        next_step:
          draft.phase === 'staged'
            ? 'Plan is STAGED for review. Present roster & task DAG to user and call agent_teams_approve once confirmed.'
            : 'Team is RUNNING. Claim ready tasks with agent_teams_claim_task and dispatch members.',
      };
    },
  },
  {
    name: 'agent_teams_approve',
    description: 'Approve a staged team plan and transition phase from staged -> running.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string', description: 'Team id (optional if only one active team exists in workspace).' },
        teamId: { type: 'string', description: 'Alias of team_id.' },
        confirmation: { type: 'string', description: 'Explicit approval note (defaults to "approved").' },
        workspace: { type: 'string', description: 'Optional workspace root path.' },
      },
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);

      const res = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId);
        if (fresh.phase !== 'staged') {
          return {
            status: 'already_running',
            team_id: fresh.id,
            members: fresh.members.filter((m) => m.status !== 'removed').length,
            tasks: fresh.tasks.length,
            ready_tasks: readyTasksOf(fresh).map((t) => ({ id: t.id, subject: t.subject, assignee: t.assignee ?? '' })),
          };
        }
        requireStagedTeam(fresh);
        fresh.members = fresh.members.filter((m) => m.status !== 'removed');
        validateStagedGraph(fresh, true);
        fresh.phase = 'running';
        delete fresh.planReviewState;
        fresh.approvedAt = Date.now();
        await writeTeam(stateRoot, fresh);
        return {
          status: 'running',
          team_id: fresh.id,
          members: fresh.members.length,
          tasks: fresh.tasks.length,
          ready_tasks: readyTasksOf(fresh).map((t) => ({ id: t.id, subject: t.subject, assignee: t.assignee ?? '' })),
        };
      });
      return res;
    },
  },
  {
    name: 'agent_teams_edit_plan',
    description:
      'Atomically edit a staged plan (or pending unstarted tasks of a running team). Supports ordered `operations` batch OR staged-plan replacement fields (`summary`, `members`, `tasks`).',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string', description: 'Team id (optional if single active team).' },
        teamId: { type: 'string' },
        operations: {
          type: 'array',
          description: 'Atomic edit operations: update_member, add_member, remove_member, update_task, add_task, remove_task.',
        },
        summary: { type: 'string', description: 'Optional updated plan summary (staged only).' },
        members: { type: 'array', description: 'Optional replacement roster (staged only).' },
        tasks: { type: 'array', description: 'Optional replacement tasks list (staged only).' },
        workspace: { type: 'string', description: 'Optional workspace root path.' },
      },
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);

      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId);
        const staged = fresh.phase === 'staged';
        if (fresh.halted === true) throw new Error('team is halted; resume before editing');

        if (Array.isArray(args.operations) && args.operations.length > 0) {
          if (!staged && args.operations.some((op) => op.action !== 'update_task')) {
            throw new Error('running teams only permit update_task on pending unstarted tasks; roster edits require staged plan');
          }
          for (const op of args.operations) {
            if (op.action === 'update_member') {
              const member = requireMember(fresh, op.member_name ?? op.memberName ?? op.name);
              if (op.role !== undefined) member.role = trimmedOptional(op.role);
              if (op.provider !== undefined) member.provider = trimmedOptional(op.provider) ?? member.provider;
              if (op.model !== undefined) member.model = trimmedOptional(op.model) ?? member.model;
              if (op.execution_prompt !== undefined || op.executionPrompt !== undefined) {
                member.executionPrompt = trimmedOptional(op.execution_prompt ?? op.executionPrompt);
              }
            } else if (op.action === 'add_member') {
              const name = trimmedOptional(op.member_name ?? op.memberName ?? op.name);
              const key = sanitizeKey(name ?? '');
              if (fresh.members.some((m) => sanitizeKey(m.name) === key)) {
                throw new Error(`member "${name}" already exists in team "${fresh.name}"`);
              }
              fresh.members.push(buildMemberRecord({ ...op, name }));
            } else if (op.action === 'remove_member') {
              const member = requireMember(fresh, op.member_name ?? op.memberName ?? op.name);
              const owned = fresh.tasks.filter((t) => t.assignee === member.name);
              if (owned.length > 0) {
                throw new Error(`member "${member.name}" still owns planned tasks: ${owned.map((t) => t.id).join(', ')}`);
              }
              fresh.members = fresh.members.filter((m) => m !== member);
            } else if (op.action === 'update_task') {
              const task = requireTask(fresh, op.task_id ?? op.taskId);
              if (task.status !== 'pending' || (task.attempt ?? 0) !== 0) {
                throw new Error(`task "${task.id}" has already started and cannot be edited`);
              }
              const nextSubject = trimmedOptional(op.subject ?? op.title) ?? task.subject;
              task.subject = nextSubject;
              if (op.description !== undefined) task.description = trimmedOptional(op.description);
              if (op.assignee !== undefined) task.assignee = trimmedOptional(op.assignee);
              if (Array.isArray(op.dependencies ?? op.dependsOn)) {
                task.dependencies = [...new Set((op.dependencies ?? op.dependsOn).map((d) => String(d).trim()).filter(Boolean))];
              }
              task.updatedAt = Date.now();
            } else if (op.action === 'add_task') {
              const norm = normalizeTaskDraft(op, fresh.taskSeq);
              fresh.taskSeq += 1;
              const now = Date.now();
              const newTask = {
                ...norm,
                id: `t${fresh.taskSeq}`,
                status: 'pending',
                attempt: 0,
                createdAt: now,
                updatedAt: now,
              };
              const gate = validateCreateTask(fresh, newTask);
              if (!gate.ok) throw new Error(gate.error);
              fresh.tasks.push(newTask);
            } else if (op.action === 'remove_task') {
              const task = requireTask(fresh, op.task_id ?? op.taskId);
              const depBy = fresh.tasks.find((c) => c.dependencies.includes(task.id));
              if (depBy) throw new Error(`task "${task.id}" is still required by "${depBy.id}"`);
              fresh.tasks = fresh.tasks.filter((c) => c.id !== task.id);
            } else {
              throw new Error(`unknown edit_plan action "${op.action}"`);
            }
          }
        } else {
          if (!staged) throw new Error('bulk summary/members/tasks replacement is only allowed while team phase is staged');
          if (args.summary !== undefined) fresh.description = trimmedOptional(args.summary);
          if (Array.isArray(args.members)) {
            fresh.members = args.members.map((m) => buildMemberRecord(m));
          }
          if (Array.isArray(args.tasks)) {
            const normalizedTasks = args.tasks.map((t, idx) => normalizeTaskDraft(t, idx));
            fresh.tasks = seedDraftTasks({ tasks: normalizedTasks });
            fresh.taskSeq = fresh.tasks.length;
          }
        }

        validateStagedGraph(fresh, false);
        if (staged) fresh.planReviewState = 'awaiting_review';
        await writeTeam(stateRoot, fresh);

        return {
          status: fresh.phase ?? 'running',
          team_id: fresh.id,
          members: fresh.members.filter((m) => m.status !== 'removed').length,
          tasks: fresh.tasks.length,
          graph: fresh.tasks.map(
            (t) => `${t.id}: ${t.subject} -> ${t.assignee || 'shared'} (deps: ${t.dependencies.join(',') || 'none'})`
          ),
        };
      });
    },
  },
  {
    name: 'agent_teams_add_member',
    description: 'Add a member to the team roster (works in staged or running phase).',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        member: { type: 'object', description: 'Optional member object { name, role, provider, model, prompt }.' },
        name: { type: 'string', description: 'Member name if not nested in member object.' },
        role: { type: 'string' },
        provider: { type: 'string' },
        model: { type: 'string' },
        executionPrompt: { type: 'string' },
        workspace: { type: 'string' },
      },
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);
      const spec = args.member && typeof args.member === 'object' ? args.member : args;

      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId);
        const liveMembers = fresh.members.filter((m) => m.status !== 'removed');
        if (liveMembers.length >= MAX_MEMBERS_CAP) {
          throw new Error(`team "${fresh.name}" is at member cap (${MAX_MEMBERS_CAP})`);
        }
        const record = buildMemberRecord(spec);
        const key = sanitizeKey(record.name);
        if (fresh.members.some((m) => sanitizeKey(m.name) === key)) {
          throw new Error(`member name "${record.name}" already used in team "${fresh.name}"`);
        }
        fresh.members.push(record);
        await writeTeam(stateRoot, fresh);
        return {
          team_id: fresh.id,
          member_name: record.name,
          role: record.role ?? '',
          provider: record.provider,
          model: record.model,
          status: record.status,
          phase: fresh.phase ?? 'running',
        };
      });
    },
  },
  {
    name: 'agent_teams_remove_member',
    description: 'Safely remove a member: mark status=removed and return their unfinished tasks to pending pool.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        name: { type: 'string' },
        memberName: { type: 'string' },
        member_name: { type: 'string' },
        workspace: { type: 'string' },
      },
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);
      const targetName = trimmedOptional(args.memberName ?? args.member_name ?? args.name);
      if (!targetName) throw new Error('member name is required');

      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId);
        const member = fresh.members.find((m) => m.name === targetName);
        if (!member) throw new Error(`no member "${targetName}" in team "${fresh.name}"`);

        const requeued = [];
        for (const task of fresh.tasks) {
          if (task.assignee !== member.name || task.status === 'completed') continue;
          if (TERMINAL_TASK_STATUSES.includes(task.status)) {
            task.assignee = undefined;
            continue;
          }
          const { holdReason, deferReason, deferredUntil, deferRetries } = task;
          invalidateTaskAttempt(task, undefined);
          if (holdReason !== undefined) task.holdReason = holdReason;
          if (deferReason !== undefined) task.deferReason = deferReason;
          if (deferredUntil !== undefined) task.deferredUntil = deferredUntil;
          if (deferRetries !== undefined) task.deferRetries = deferRetries;
          task.reassigning = false;
          requeued.push(task.id);
        }
        member.status = 'removed';
        await writeTeam(stateRoot, fresh);
        return {
          team_id: fresh.id,
          member_name: member.name,
          status: member.status,
          requeued_tasks: requeued,
        };
      });
    },
  },
  {
    name: 'agent_teams_hotswap_member',
    description:
      'Hotswap an idle member route/model/prompt/role in a running team without replacing member history; optionally requeue one failed task owned by this member.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        name: { type: 'string' },
        memberName: { type: 'string' },
        member_name: { type: 'string' },
        provider: { type: 'string' },
        model: { type: 'string' },
        role: { type: 'string' },
        prompt: { type: 'string' },
        executionPrompt: { type: 'string' },
        task_id: { type: 'string', description: 'Optional failed task id owned by this member to requeue.' },
        workspace: { type: 'string' },
      },
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);
      const targetName = trimmedOptional(args.memberName ?? args.member_name ?? args.name);
      if (!targetName) throw new Error('member name is required');

      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId);
        if (fresh.phase === 'staged' || fresh.halted) {
          throw new Error('hot-swap requires an unhalted running team');
        }
        const member = requireMember(fresh, targetName);
        if (member.status !== 'idle') {
          throw new Error('hot-swap requires an idle member; settle active work first');
        }
        if (fresh.tasks.some((t) => t.assignee === member.name && (t.status === 'claimed' || t.status === 'in_progress'))) {
          throw new Error('member still owns an open attempt; finish or reassign it first');
        }
        const provider = trimmedOptional(args.provider);
        const model = trimmedOptional(args.model);
        if (provider) member.activeProvider = provider;
        if (model) member.activeModel = model;
        if (provider || model) member.fallbackActive = true;
        if (args.role !== undefined) member.role = trimmedOptional(args.role);
        if (args.prompt !== undefined || args.executionPrompt !== undefined) {
          member.executionPrompt = trimmedOptional(args.executionPrompt ?? args.prompt);
        }

        let requeuedTask;
        const tid = trimmedOptional(args.task_id ?? args.taskId);
        if (tid) {
          const task = requireTask(fresh, tid);
          if (task.assignee !== member.name || task.status !== 'failed') {
            throw new Error('hot-swap may retry only a failed task owned by this member');
          }
          if (task.holdReason !== undefined) {
            throw new Error('held task requires agent_teams_reevaluate_hold');
          }
          invalidateTaskAttempt(task, member.name);
          requeuedTask = task.id;
        }
        await writeTeam(stateRoot, fresh);
        return {
          team_id: fresh.id,
          member_name: member.name,
          provider: member.activeProvider ?? member.provider ?? '',
          model: member.activeModel ?? member.model ?? '',
          ...(requeuedTask ? { requeued_task: requeuedTask } : {}),
        };
      });
    },
  },
  {
    name: 'agent_teams_create_task',
    description:
      'Create a task with P0 quality gate validation. Use kind=work for general work; quality kinds (implementation, repair, verification, review, requirements, integration) enforce full contract & independent judging rules.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        subject: { type: 'string', description: 'Task title (alias: title).' },
        title: { type: 'string' },
        description: { type: 'string' },
        assignee: { type: 'string' },
        dependencies: { type: 'array', items: { type: 'string' }, description: 'Alias: dependsOn.' },
        dependsOn: { type: 'array', items: { type: 'string' } },
        kind: {
          type: 'string',
          enum: ['work', 'requirements', 'implementation', 'verification', 'review', 'repair', 'integration'],
        },
        round: { type: 'number' },
        objective: { type: 'string' },
        inScope: { type: 'array', items: { type: 'string' }, description: 'Alias: fileScope.' },
        fileScope: { type: 'array', items: { type: 'string' } },
        outOfScope: { type: 'array', items: { type: 'string' } },
        acceptance: { type: 'array', items: { type: 'string' }, description: 'Alias: acceptanceCriteria.' },
        acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        verify: { type: 'array', items: { type: 'string' }, description: 'Alias: verificationCommands.' },
        verificationCommands: { type: 'array', items: { type: 'string' } },
        deliverables: { type: 'array', items: { type: 'string' }, description: 'Alias: expectedArtifacts.' },
        expectedArtifacts: { type: 'array', items: { type: 'string' } },
        nonGoals: { type: 'array', items: { type: 'string' } },
        reviewedTaskId: { type: 'string', description: 'Alias: subjectTaskId for review tasks.' },
        sourceTaskId: { type: 'string', description: 'Alias: subjectTaskId for repair tasks.' },
        subjectTaskId: { type: 'string' },
        sourceFindingIds: { type: 'array', items: { type: 'string' } },
        coverageOf: { type: 'array', items: { type: 'string' } },
        resume: { type: 'boolean' },
        resumeReason: { type: 'string' },
        workspace: { type: 'string' },
      },
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);
      const input = normalizeCreateTaskArgs(args);
      if (!input.subject) throw new Error('subject (or title) is required');

      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId);
        const gate = validateCreateTask(fresh, input);
        if (!gate.ok) {
          throw new Error(gate.error ?? 'create_task rejected by quality gates');
        }
        if (fresh.halted === true) {
          const resumed = resumeTeamState(fresh, input.resumeReason ?? '');
          if (resumed.status !== 'resumed') {
            throw new Error(resumed.error ?? 'team is halted; resume first or pass resume=true with resumeReason');
          }
          fresh.halted = false;
          fresh.haltedAt = undefined;
        }
        const deps = input.dependencies ?? [];
        for (const dep of deps) {
          if (!fresh.tasks.some((t) => t.id === dep)) {
            throw new Error(`dependency "${dep}" does not exist in team "${fresh.name}"`);
          }
        }
        if (input.assignee !== undefined && input.assignee !== CAPTAIN_KEY) {
          requireMember(fresh, input.assignee);
        }
        const kind = gate.kind ?? 'work';
        const objective =
          kind === 'review' || kind === 'requirements'
            ? sanitizeReviewObjective(input.objective)
            : input.objective;
        const acceptance =
          kind === 'review' || kind === 'requirements'
            ? sanitizeReviewAcceptance(input.acceptance)
            : input.acceptance;

        const now = Date.now();
        fresh.taskSeq += 1;
        const task = {
          id: `t${fresh.taskSeq}`,
          subject: input.subject,
          ...(input.description === undefined ? {} : { description: input.description }),
          status: 'pending',
          ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
          dependencies: deps,
          attempt: 0,
          createdAt: now,
          updatedAt: now,
          kind,
          ...(input.round === undefined ? {} : { round: input.round }),
          ...(objective === undefined ? {} : { objective }),
          ...(input.inScope === undefined ? {} : { inScope: input.inScope }),
          ...(input.outOfScope === undefined ? {} : { outOfScope: input.outOfScope }),
          ...(acceptance === undefined ? {} : { acceptance }),
          ...(input.verify === undefined ? {} : { verify: input.verify }),
          ...(input.deliverables === undefined ? {} : { deliverables: input.deliverables }),
          ...(input.nonGoals === undefined ? {} : { nonGoals: input.nonGoals }),
          ...(input.reviewedTaskId === undefined ? {} : { reviewedTaskId: input.reviewedTaskId }),
          ...(input.sourceTaskId === undefined ? {} : { sourceTaskId: input.sourceTaskId }),
          ...(input.sourceFindingIds === undefined ? {} : { sourceFindingIds: input.sourceFindingIds }),
          ...(input.coverageOf === undefined ? {} : { coverageOf: input.coverageOf }),
        };
        if (task.assignee !== undefined) {
          const conflict = judgeConflictFor(fresh.tasks, task, task.assignee);
          if (conflict !== undefined) {
            throw new Error(`task ${task.id} judges work that ${conflict}; an independent member must be assigned`);
          }
        }
        fresh.tasks.push(task);
        await writeTeam(stateRoot, fresh);
        return {
          team_id: fresh.id,
          task_id: task.id,
          subject: task.subject,
          status: task.status,
          kind: taskKindOf(task),
          ...(task.assignee ? { assignee: task.assignee } : {}),
          dependencies: task.dependencies,
        };
      });
    },
  },
  {
    name: 'agent_teams_reassign_task',
    description:
      'Atomically retry, reassign to another active member, or let "captain" take over an unfinished/failed task (revokes prior attempt_id and checks judge independence).',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        task_id: { type: 'string' },
        taskId: { type: 'string' },
        assignee: { type: 'string', description: 'Active member name or "captain".' },
        reason: { type: 'string' },
        workspace: { type: 'string' },
      },
      required: ['assignee'],
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);
      const taskId = trimmedOptional(args.task_id ?? args.taskId);
      const target = trimmedOptional(args.assignee);
      if (!taskId) throw new Error('task_id is required');
      if (!target) throw new Error('assignee must not be empty');

      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId);
        const task = requireTask(fresh, taskId);
        if (task.status === 'completed') {
          throw new Error(`completed task ${task.id} is immutable and cannot be reassigned`);
        }
        if (target !== CAPTAIN_KEY) requireMember(fresh, target);
        const conflict = judgeConflictFor(fresh.tasks, task, target);
        if (conflict !== undefined) {
          throw new Error(`task ${task.id} judges work that ${conflict}; an independent member must be assigned`);
        }
        if (target === CAPTAIN_KEY) {
          const unmet = unsatisfiedDependencies(fresh.tasks, task.dependencies);
          if (unmet.length > 0) {
            throw new Error(`task ${task.id} blocked by unfinished dependencies: ${unmet.join(', ')}`);
          }
          if (task.kind === 'implementation' || task.kind === 'repair') {
            throw new Error(`Thin Router policy: captain cannot take over ${task.kind} task ${task.id}; assign a member`);
          }
        }
        const previousAssignee = task.assignee ?? '';
        invalidateTaskAttempt(task, target, false);
        if (target === CAPTAIN_KEY) {
          beginTaskAttempt(task, CAPTAIN_KEY);
          task.status = 'in_progress';
          task.updatedAt = Date.now();
        }
        syncMemberIdleStatus(fresh, previousAssignee);
        await writeTeam(stateRoot, fresh);
        return {
          team_id: fresh.id,
          task_id: task.id,
          previous_assignee: previousAssignee,
          assignee: task.assignee,
          status: task.status,
          attempt: task.attempt ?? 0,
          ...(task.attemptId ? { attempt_id: task.attemptId } : {}),
        };
      });
    },
  },
  {
    name: 'agent_teams_claim_task',
    description:
      'Claim a ready pending task for a member, checking dependencies and judge independence (prevents author self-review). Captures verdictStartSnapshot for review/verification tasks and returns attempt_id.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        task_id: { type: 'string' },
        taskId: { type: 'string' },
        memberName: { type: 'string', description: 'Member claiming this task (aliases: member_name, assignee).' },
        member_name: { type: 'string' },
        assignee: { type: 'string' },
        workspace: { type: 'string' },
      },
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);
      const taskId = trimmedOptional(args.task_id ?? args.taskId);
      if (!taskId) throw new Error('task_id is required');
      const requested = trimmedOptional(args.memberName ?? args.member_name ?? args.assignee);

      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId);
        if (fresh.phase === 'staged') {
          throw new Error(`team "${fresh.name}" plan is staged; call agent_teams_approve first`);
        }
        if (fresh.halted === true) {
          throw new Error(`team "${fresh.name}" is halted; call agent_teams_resume first`);
        }
        const task = requireTask(fresh, taskId);
        const assignee = requested ?? task.assignee;
        if (!assignee) {
          throw new Error('claiming an unassigned task requires memberName / assignee');
        }
        if (task.assignee !== undefined && task.assignee !== assignee) {
          throw new Error(`task ${task.id} is assigned to "${task.assignee}", not "${assignee}"`);
        }
        if (assignee !== CAPTAIN_KEY) requireMember(fresh, assignee);

        // Judge independence guard (blocks author self-review & self-verification)
        const conflict = judgeConflictFor(fresh.tasks, task, assignee);
        if (conflict !== undefined) {
          throw new Error(`JUDGE_CONFLICT: task ${task.id} judges work that ${conflict}; an independent member must hold this task`);
        }

        if (task.status === 'claimed' || task.status === 'in_progress') {
          return {
            team_id: fresh.id,
            task_id: task.id,
            status: task.status,
            assignee,
            attempt: task.attempt ?? 0,
            attempt_id: task.attemptId,
            task_details: taskDetailsText(fresh, task),
          };
        }

        const unmet = unsatisfiedDependencies(fresh.tasks, task.dependencies);
        if (unmet.length > 0) {
          throw new Error(`task ${task.id} is blocked by unfinished dependencies: ${unmet.join(', ')}`);
        }
        const tErr = transitionError(task.status, 'claimed');
        if (tErr !== undefined) throw new Error(tErr);

        const attemptId = beginTaskAttempt(task, assignee);
        attachVerdictStartSnapshot(workspace, fresh, task);
        syncMemberIdleStatus(fresh, assignee);
        await writeTeam(stateRoot, fresh);

        return {
          team_id: fresh.id,
          task_id: task.id,
          status: task.status,
          assignee: task.assignee,
          attempt: task.attempt ?? 0,
          attempt_id: attemptId,
          task_details: taskDetailsText(fresh, task),
        };
      });
    },
  },
  {
    name: 'agent_teams_update_task',
    description:
      'Update task status/output/verdict with P0 quality gate verification, command evidence check, sha256 artifact binding, and automatic repair/re-review follow-up scheduling.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        task_id: { type: 'string' },
        taskId: { type: 'string' },
        attempt_id: { type: 'string' },
        actor: { type: 'string', description: 'Optional caller identity (member name or "captain").' },
        status: {
          type: 'string',
          enum: ['in_progress', 'completed', 'failed', 'cancelled', 'in-progress', 'canceled'],
        },
        output: { type: 'string', description: 'Task result summary (aliases: result, summary).' },
        result: { type: 'string' },
        summary: { type: 'string' },
        evidence_note: { type: 'string', description: 'Supplemental observation on already-terminal tasks.' },
        verdict: { type: 'string', enum: ['pass', 'needs_revision', 'reject'] },
        findings: { type: 'array' },
        changedPaths: { type: 'array', items: { type: 'string' }, description: 'Alias: filesTouched.' },
        filesTouched: { type: 'array', items: { type: 'string' } },
        acceptanceResults: { type: 'array' },
        commandsRun: { type: 'array' },
        workspace: { type: 'string' },
      },
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);
      const taskId = trimmedOptional(args.task_id ?? args.taskId);
      if (!taskId) throw new Error('task_id is required');

      const nextStatus = normalizeStatus(args.status);
      if (nextStatus === 'blocked') {
        throw new Error('DSH state contract uses status="failed" (with findings/output) or leaves status="in_progress", not "blocked".');
      }
      const nextOutput = trimmedOptional(args.output ?? args.result ?? args.summary);
      const nextVerdict = normalizeVerdict(args.verdict);
      const attemptId = trimmedOptional(args.attempt_id ?? args.attemptId);

      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId);
        const task = requireTask(fresh, taskId);
        const actor = trimmedOptional(args.actor) ?? task.assignee ?? CAPTAIN_KEY;

        if (actor !== CAPTAIN_KEY && task.assignee !== undefined && task.assignee !== actor) {
          throw new Error(`task ${task.id} is assigned to "${task.assignee}", not "${actor}"`);
        }
        if (attemptId !== undefined && task.attemptId !== undefined && attemptId !== task.attemptId && !TERMINAL_TASK_STATUSES.includes(task.status)) {
          throw new Error(`stale attempt_id for task ${task.id}; expected "${task.attemptId}"`);
        }

        const normArgs = normalizeBlankOptionalTaskFields({
          ...args,
          changedPaths: args.changedPaths ?? args.filesTouched,
        });
        const findings = parseFindings(args.findings);
        const acceptanceResults = parseAcceptanceResults(args.acceptanceResults);
        const commandsRun = parseCommandResults(args.commandsRun);

        if (TERMINAL_TASK_STATUSES.includes(task.status)) {
          const appended = appendTaskEvidence(
            task,
            {
              evidence_note: args.evidence_note,
              findings,
              changedPaths: normArgs.changedPaths,
              acceptanceResults,
              commandsRun,
            },
            actor
          );
          if (appended) await writeTeam(stateRoot, fresh);
          return {
            team_id: fresh.id,
            task_id: task.id,
            status: task.status,
            attempt: task.attempt ?? 0,
            evidence_count: task.supplementalEvidence?.length ?? 0,
            ...(task.output ? { output: task.output } : {}),
          };
        }

        if (trimmedOptional(args.evidence_note)) {
          throw new Error('evidence_note is only for terminal tasks; record active work with output/commandsRun/acceptanceResults');
        }

        const reviewedTask =
          task.reviewedTaskId === undefined ? undefined : fresh.tasks.find((t) => t.id === task.reviewedTaskId);
        const coveredIds =
          task.coverageOf && task.coverageOf.length > 0
            ? task.coverageOf
            : task.dependencies;
        const coveredTasks = coveredIds
          .map((id) => fresh.tasks.find((t) => t.id === id))
          .filter((t) => t !== undefined && !isQualityKind(taskKindOf(t)) ? true : t !== undefined && ['implementation', 'repair', 'work'].includes(taskKindOf(t)));

        const gate = evaluateQualityCompletion(
          task,
          {
            status: nextStatus,
            output: nextOutput,
            verdict: nextVerdict,
            findings,
            changedPaths: normArgs.changedPaths,
            acceptanceResults,
            commandsRun,
          },
          reviewedTask,
          coveredTasks
        );
        if (!gate.ok) {
          throw new Error(gate.error ?? 'update_task rejected by quality gates');
        }

        if (nextStatus !== undefined) {
          const tErr = transitionError(task.status, nextStatus);
          if (tErr !== undefined) throw new Error(tErr);
          task.status = nextStatus;
        }
        if (nextOutput !== undefined) task.output = nextOutput;
        if (nextVerdict !== undefined) task.verdict = nextVerdict;
        if (findings !== undefined) task.findings = findings;
        if (normArgs.changedPaths !== undefined) task.changedPaths = normArgs.changedPaths;
        if (acceptanceResults !== undefined) task.acceptanceResults = acceptanceResults;
        if (commandsRun !== undefined) task.commandsRun = commandsRun;

        bindClosingVerdict(workspace, fresh, task);
        task.updatedAt = Date.now();

        const followUp =
          task.status === 'failed' && isQualityKind(taskKindOf(task))
            ? applyQualityFollowUp(
                fresh,
                task,
                (paths) => snapshotWorkspacePaths(workspace, paths),
                (p) => workspacePathExists(workspace, p)
              )
            : undefined;

        syncMemberIdleStatus(fresh, task.assignee);
        await writeTeam(stateRoot, fresh);

        let followUpSummary;
        if (followUp && followUp.created.length > 0) {
          followUpSummary = `Automatic quality follow-up created: ${followUp.created
            .map((t) => `${t.id} (${t.kind}, owner=${t.assignee ?? 'unassigned'})`)
            .join('; ')}`;
          await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, createMessage(CAPTAIN_KEY, CAPTAIN_KEY, followUpSummary)).catch(() => {});
        }
        if (followUp?.escalated) {
          await appendMailbox(
            stateRoot,
            fresh.id,
            CAPTAIN_KEY,
            createMessage(CAPTAIN_KEY, CAPTAIN_KEY, `Quality loop escalated after ${task.id}: ${followUp.reason}`)
          ).catch(() => {});
        }

        return {
          team_id: fresh.id,
          task_id: task.id,
          status: task.status,
          attempt: task.attempt ?? 0,
          ...(task.verdict ? { verdict: task.verdict } : {}),
          ...(task.reviewedArtifacts ? { reviewed_artifacts: task.reviewedArtifacts.length } : {}),
          ...(followUpSummary ? { follow_up: followUpSummary } : {}),
          ...(followUp?.escalated ? { escalated: true, escalation_reason: followUp.reason } : {}),
        };
      });
    },
  },
  {
    name: 'agent_teams_amend_task',
    description:
      'Amend the quality contract of a non-terminal quality task (objective, acceptance, verify, inScope, outOfScope), appending an immutable entry to task.revisions.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        task_id: { type: 'string' },
        taskId: { type: 'string' },
        reason: { type: 'string' },
        objective: { type: 'string' },
        acceptance: { type: 'array', items: { type: 'string' }, description: 'Alias: acceptanceCriteria.' },
        acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        verify: { type: 'array', items: { type: 'string' }, description: 'Alias: verificationCommands.' },
        verificationCommands: { type: 'array', items: { type: 'string' } },
        inScope: { type: 'array', items: { type: 'string' }, description: 'Alias: fileScope.' },
        fileScope: { type: 'array', items: { type: 'string' } },
        outOfScope: { type: 'array', items: { type: 'string' } },
        actor: { type: 'string' },
        workspace: { type: 'string' },
      },
      required: ['reason'],
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);
      const taskId = trimmedOptional(args.task_id ?? args.taskId);
      const reason = trimmedOptional(args.reason);
      if (!taskId) throw new Error('task_id is required');
      if (!reason) throw new Error('reason is required');
      const actor = trimmedOptional(args.actor) ?? CAPTAIN_KEY;

      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId);
        const task = requireTask(fresh, taskId);
        const input = normalizeBlankOptionalTaskFields({
          ...(args.objective !== undefined ? { objective: args.objective } : {}),
          ...((args.acceptance ?? args.acceptanceCriteria) !== undefined
            ? { acceptance: args.acceptance ?? args.acceptanceCriteria }
            : {}),
          ...((args.verify ?? args.verificationCommands) !== undefined
            ? { verify: args.verify ?? args.verificationCommands }
            : {}),
          ...((args.inScope ?? args.fileScope) !== undefined
            ? { inScope: args.inScope ?? args.fileScope }
            : {}),
          ...(args.outOfScope !== undefined ? { outOfScope: args.outOfScope } : {}),
        });
        const amended = amendTaskContract(fresh, task, input, actor, reason);
        if (!amended.ok || !amended.task) {
          throw new Error(amended.error ?? 'amend_task rejected by quality gates');
        }
        Object.assign(task, amended.task);
        task.updatedAt = Date.now();
        await writeTeam(stateRoot, fresh);
        return {
          team_id: fresh.id,
          task_id: task.id,
          status: task.status,
          revised_fields: amended.revision?.fields ?? [],
          revision_count: task.revisions?.length ?? 0,
        };
      });
    },
  },
  {
    name: 'agent_teams_send_message',
    description: 'Send a durable message to <team>/inbox/<to>.jsonl ("captain" or an active member name).',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        from: { type: 'string', description: 'Sender name (defaults to "captain").' },
        to: { type: 'string', description: 'Recipient: "captain" or an active member name.' },
        content: { type: 'string' },
        workspace: { type: 'string' },
      },
      required: ['to', 'content'],
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);
      const to = trimmedOptional(args.to);
      const from = trimmedOptional(args.from) ?? CAPTAIN_KEY;
      const content = typeof args.content === 'string' ? args.content : '';
      if (!to) throw new Error('recipient "to" is required');
      if (content.trim() === '') throw new Error('message content must not be empty');

      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId);
        if (to !== CAPTAIN_KEY) requireMember(fresh, to);
        const recipientKey = to === CAPTAIN_KEY ? CAPTAIN_KEY : sanitizeKey(to);
        const msg = createMessage(from, to, content);
        await appendMailbox(stateRoot, fresh.id, recipientKey, msg);
        return {
          team_id: fresh.id,
          message_id: msg.id,
          from: msg.from,
          to: msg.to,
          delivered: 'mailbox',
        };
      });
    },
  },
  {
    name: 'agent_teams_status',
    description:
      'Inspect AgentTeams state: members, task DAG, ready_tasks, quality badges, canDeclareDelivery status, and mailboxes. When no team_id is passed and 0 or >1 teams exist, lists live & archived teams in workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        reader: { type: 'string', description: 'Optional member name or "captain" to acknowledge unread inbox messages.' },
        workspace: { type: 'string' },
      },
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const explicitId = trimmedOptional(args.team_id ?? args.teamId);

      if (!explicitId) {
        const live = listLiveTeamDirs(stateRoot);
        if (live.length === 0) {
          const archived = await listArchivedTeamIds(stateRoot).catch(() => []);
          return {
            workspace,
            state_dir: stateRoot,
            active_teams: [],
            archived_teams: archived,
            note: 'No active team in this workspace. Call agent_teams_create to start one.',
          };
        }
        if (live.length > 1) {
          const archived = await listArchivedTeamIds(stateRoot).catch(() => []);
          const summaries = [];
          for (const id of live) {
            const rec = await readTeam(stateRoot, id).catch(() => undefined);
            summaries.push({
              team_id: id,
              name: rec?.name ?? id,
              phase: rec?.phase ?? 'running',
              tasks: rec?.tasks.length ?? 0,
            });
          }
          return {
            workspace,
            state_dir: stateRoot,
            active_teams: summaries,
            archived_teams: archived,
            note: 'Multiple active teams exist; pass team_id to inspect details of a specific team.',
          };
        }
      }

      const teamId = await resolveTargetTeamId(stateRoot, explicitId);
      const team = await requireFreshTeam(stateRoot, teamId);
      const audit = auditTeamWorkspace(workspace, team);
      const deliveryCheck = canDeclareDelivery(team, audit);
      const loop = describeQualityLoop(team, audit);
      const badges = qualityBadgeStates(team.tasks);
      const coverage = buildCoverageMatrix([...new Set(team.tasks.flatMap((t) => t.coverageOf ?? []))], team.tasks);
      const ready = readyTasksOf(team);

      const captainInbox = await readMailbox(stateRoot, team.id, CAPTAIN_KEY).catch(() => []);
      const memberInboxes = {};
      for (const m of team.members.filter((item) => item.status !== 'removed')) {
        const key = sanitizeKey(m.name);
        const unread = await readUnreadMailbox(stateRoot, team.id, key).catch(() => []);
        const total = await readMailbox(stateRoot, team.id, key).catch(() => []);
        if (total.length > 0) {
          memberInboxes[m.name] = {
            total: total.length,
            unread: unread.length,
            latest: total[total.length - 1]?.content?.slice(0, 200) ?? '',
          };
        }
      }

      const reader = trimmedOptional(args.reader);
      let readerUnread = [];
      if (reader) {
        const key = reader === CAPTAIN_KEY ? CAPTAIN_KEY : sanitizeKey(reader);
        readerUnread = await readUnreadMailbox(stateRoot, team.id, key).catch(() => []);
        if (readerUnread.length > 0) {
          await acknowledgeMailbox(stateRoot, team.id, key, readerUnread.map((m) => m.id)).catch(() => {});
        }
      }

      return {
        workspace,
        team_id: team.id,
        team_name: team.name,
        description: team.description ?? '',
        phase: team.phase ?? 'running',
        halted: team.halted === true,
        escalated: team.escalated === true,
        loop_state: loop.state,
        loop_summary: loop.summary,
        deliverable: loop.deliverable,
        delivery: {
          allowed: deliveryCheck.ok,
          ok: deliveryCheck.ok,
          blockers: deliveryCheck.blockers,
          warnings: deliveryCheck.warnings,
        },
        coverage,
        quality_badges: Object.fromEntries(badges instanceof Map ? badges : Object.entries(badges ?? {})),
        members: team.members.map((m) => ({
          name: m.name,
          role: m.role ?? '',
          provider: m.provider ?? '',
          model: m.model ?? '',
          status: m.status,
          ...(m.activeModel ? { activeModel: m.activeModel } : {}),
        })),
        tasks: team.tasks.map((t) => ({
          id: t.id,
          subject: t.subject,
          kind: taskKindOf(t),
          status: t.status,
          assignee: t.assignee ?? '',
          dependencies: t.dependencies,
          attempt: t.attempt ?? 0,
          ...(t.attemptId ? { attempt_id: t.attemptId } : {}),
          ...(t.verdict ? { verdict: t.verdict } : {}),
          ...(t.holdReason ? { holdReason: t.holdReason } : {}),
          ...(t.output ? { output: t.output } : {}),
        })),
        ready_tasks: ready.map((t) => ({ id: t.id, subject: t.subject, assignee: t.assignee ?? '', kind: taskKindOf(t) })),
        captain_inbox: captainInbox.slice(-10).map((m) => ({ id: m.id, from: m.from, content: m.content, ts: m.ts })),
        member_inboxes: memberInboxes,
        ...(reader ? { reader_unread_acknowledged: readerUnread } : {}),
      };
    },
  },
  {
    name: 'agent_teams_resume',
    description: 'Explicitly resume a halted team with a non-empty reason and return currently ready tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        reason: { type: 'string' },
        workspace: { type: 'string' },
      },
      required: ['reason'],
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);
      const reason = trimmedOptional(args.reason);
      if (!reason) throw new Error('resume requires a non-empty reason');

      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId);
        const resumed = resumeTeamState(fresh, reason);
        if (resumed.status === 'rejected') {
          throw new Error(resumed.error ?? 'resume rejected');
        }
        if (resumed.status === 'resumed') {
          fresh.halted = false;
          fresh.haltedAt = undefined;
          await writeTeam(stateRoot, fresh);
        }
        return {
          status: resumed.status,
          team_id: fresh.id,
          reason,
          ready_tasks: readyTasksOf(fresh).map((t) => ({ id: t.id, subject: t.subject, assignee: t.assignee ?? '' })),
        };
      });
    },
  },
  {
    name: 'agent_teams_delete',
    description:
      'End an active team and move its state directory & mailboxes into generational archive (<workspace>/.agent-teams/archive/<teamId>-<ts>).',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        reason: { type: 'string' },
        workspace: { type: 'string' },
      },
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);

      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId, { allowCancelling: true });
        await recordRetiredMemberIds(
          stateRoot,
          fresh.members.map((m) => m.id).filter(Boolean)
        );
        const archiveId = await archiveTeamDir(stateRoot, fresh.id);
        return {
          deleted: true,
          archived: true,
          team_id: fresh.id,
          team_name: fresh.name,
          archive_id: archiveId,
          archive_dir: join(stateRoot, 'archive', archiveId),
          ...(trimmedOptional(args.reason) ? { reason: trimmedOptional(args.reason) } : {}),
        };
      });
    },
  },
  {
    name: 'agent_teams_delete_team_history',
    description:
      'Permanently delete archived history of one team (writes audit record to archive/.purge-log.jsonl). Refuses live teams; requires confirm=true or confirm="<team_id>".',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        confirm: {
          description: 'Must equal team_id string or boolean true to confirm destructive purge.',
        },
        reason: { type: 'string' },
        workspace: { type: 'string' },
      },
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = trimmedOptional(args.team_id ?? args.teamId);
      if (!teamId) throw new Error('team_id must name the archived team to purge');

      const confirmed = args.confirm === true || (typeof args.confirm === 'string' && args.confirm.trim() === teamId);
      if (!confirmed) {
        throw new Error(`deletion is target-bound: pass confirm="${teamId}" (or confirm=true) to confirm permanent purge`);
      }

      const res = await purgeArchivedTeam(stateRoot, teamId, {
        by: `${captainSessionId()}${trimmedOptional(args.reason) ? ` (${trimmedOptional(args.reason)})` : ''}`,
      });
      return {
        team_id: res.teamId,
        purged: res.purged,
        entries: res.entries,
        purge_log: join(stateRoot, 'archive', '.purge-log.jsonl'),
      };
    },
  },
  {
    name: 'agent_teams_reevaluate_hold',
    description:
      'Re-evaluate a channel-cost or retry-exhausted hold on one pending task using channel-policy dispatch gates.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        task_id: { type: 'string' },
        taskId: { type: 'string' },
        reason: { type: 'string', description: 'Non-empty reason for recovery (alias: note).' },
        note: { type: 'string' },
        workspace: { type: 'string' },
      },
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);
      const taskId = trimmedOptional(args.task_id ?? args.taskId);
      const reason = trimmedOptional(args.reason ?? args.note) ?? 'User-approved hold re-evaluation';
      if (!taskId) throw new Error('task_id is required');

      const snapshot = await requireFreshTeam(stateRoot, teamId);
      const targetTask = requireTask(snapshot, taskId);
      if (targetTask.status !== 'pending' || targetTask.holdReason === undefined) {
        return { team_id: snapshot.id, task_id: taskId, action: 'not-held' };
      }

      const grant = await issueLocalRecoveryGrant(snapshot, 'agent_teams_reevaluate_hold', reason, taskId);

      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId);
        const task = requireTask(fresh, taskId);
        if (task.status !== 'pending' || task.holdReason === undefined) {
          return { team_id: fresh.id, task_id: taskId, action: 'not-held' };
        }
        const receipt = consumeRecoveryGrant(grant, fresh, 'agent_teams_reevaluate_hold', taskId);
        if (!receipt) throw new Error('recovery target state changed concurrently; retry');

        const member = task.assignee ? fresh.members.find((m) => m.name === task.assignee) : undefined;
        const provider = member?.activeProvider ?? member?.provider ?? 'unknown';
        const previousRetries = task.deferRetries ?? 0;
        const cycle = (task.holdRecovery?.cycle ?? -1) + 1;

        task.deferRetries = 0;
        task.holdRecovery = {
          previousRetries,
          reason: receipt.reason,
          evidenceId: receipt.evidenceId,
          approvedAt: receipt.approvedAt,
          cycle,
        };

        const family = channelFamilyOf(provider, DEFAULT_DISPATCH_POLICY);
        if (family && fresh.channelDispatchCounts) {
          const counts = { ...fresh.channelDispatchCounts };
          delete counts[family.id];
          fresh.channelDispatchCounts = counts;
        }

        const decision = evaluateDispatch({
          now: Date.now(),
          provider,
          kind: task.kind ?? 'work',
          deferRetries: task.deferRetries,
          policy: DEFAULT_DISPATCH_POLICY,
        });

        if (decision.action === 'hold') {
          task.holdReason = decision.reason;
          task.updatedAt = Date.now();
          await writeTeam(stateRoot, fresh);
          return { team_id: fresh.id, task_id: taskId, action: 'still-held', reason: decision.reason };
        }

        delete task.holdReason;
        delete task.deferReason;
        if (decision.action === 'defer') {
          task.deferredUntil = decision.until;
          task.deferReason = decision.reason;
          task.updatedAt = Date.now();
          await writeTeam(stateRoot, fresh);
          return { team_id: fresh.id, task_id: taskId, action: 'deferred', reason: decision.reason };
        }

        delete task.deferredUntil;
        task.updatedAt = Date.now();
        await writeTeam(stateRoot, fresh);
        return { team_id: fresh.id, task_id: taskId, action: 'released' };
      });
    },
  },
  {
    name: 'agent_teams_resolve_escalation',
    description:
      'Resolve an escalated quality-gate loop after explicit human authorization, recording an immutable entry in escalationResolutions.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        reason: { type: 'string', description: 'Non-empty human-approved reason (alias: note).' },
        note: { type: 'string' },
        task_id: { type: 'string' },
        resolution: {
          type: 'string',
          enum: ['approve_override', 'amend_contract', 'reassign', 'cancel'],
        },
        workspace: { type: 'string' },
      },
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);
      const reason = trimmedOptional(args.reason ?? args.note);
      if (!reason) throw new Error('non-empty human reason is required to resolve escalation');

      const snapshot = await requireFreshTeam(stateRoot, teamId);
      if (snapshot.escalated !== true) {
        throw new Error(`team "${snapshot.name}" is not escalated`);
      }

      const grant = await issueLocalRecoveryGrant(snapshot, 'agent_teams_resolve_escalation', reason);

      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const fresh = await requireFreshTeam(stateRoot, teamId);
        const resolved = resolveEscalationState(fresh, { reason, grant });
        if (!resolved.ok || !resolved.team) {
          throw new Error(resolved.error ?? 'escalation recovery rejected');
        }
        await writeTeam(stateRoot, resolved.team);
        return {
          team_id: resolved.team.id,
          escalated: resolved.team.escalated === true,
          resolutions: resolved.team.escalationResolutions?.length ?? 0,
        };
      });
    },
  },
  {
    name: 'agent_teams_watchdog_heal',
    description:
      'Run bounded watchdog inspection on the team to detect stale/absent task owners and recover stuck tasks (with fallback failover if configured).',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        teamId: { type: 'string' },
        staleThresholdMs: {
          type: 'number',
          description: 'Optional threshold in milliseconds before considering an active attempt stale (defaults to 300000).',
        },
        treatAllClaimedAsAbsent: {
          type: 'boolean',
          description: 'Optional boolean for Antigravity manual/diagnostic healing when no live subagent handle exists.',
        },
        workspace: { type: 'string' },
      },
    },
    async execute(args) {
      const workspace = resolveWorkspace(args);
      const stateRoot = stateRootOf(workspace);
      const teamId = await resolveTargetTeamId(stateRoot, args.team_id ?? args.teamId);
      const team = await requireFreshTeam(stateRoot, teamId);
      const threshold = Number.isFinite(args.staleThresholdMs) ? args.staleThresholdMs : 300_000;
      const now = Date.now();

      const report = await inspectAndHealTeam(stateRoot, teamId, {
        stallThresholdMs: threshold,
        readyTimeoutMs: Math.min(threshold, 30_000),
        activityOf(member) {
          if (args.treatAllClaimedAsAbsent === true) return 'absent';
          const activeTask = team.tasks.find(
            (t) => t.assignee === member.name && (t.status === 'claimed' || t.status === 'in_progress')
          );
          if (!activeTask) return 'idle';
          return now - activeTask.updatedAt > threshold ? 'absent' : 'running';
        },
      });

      return {
        team_id: teamId,
        status: report.status,
        healed_count: report.healedCount,
        needs_kick: report.needsKick,
        diagnostics: report.diagnostics,
        summary: report.summary,
        actions: report.actions,
      };
    },
  },
];

const TOOL_MAP = new Map(TOOL_DEFS.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 over stdio transport
// ---------------------------------------------------------------------------

function sendJsonRpc(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sendError(id, code, message) {
  if (id === undefined || id === null) return;
  sendJsonRpc({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleRpcMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  const { id, method, params } = msg;

  if (method === 'initialize') {
    const protocolVersion =
      typeof params?.protocolVersion === 'string' && params.protocolVersion
        ? params.protocolVersion
        : '2024-11-05';
    sendJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    });
    return;
  }

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return;
  }

  if (method === 'ping') {
    sendJsonRpc({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  if (method === 'prompts/list') {
    sendJsonRpc({ jsonrpc: '2.0', id, result: { prompts: [] } });
    return;
  }

  if (method === 'resources/list') {
    sendJsonRpc({ jsonrpc: '2.0', id, result: { resources: [] } });
    return;
  }

  if (method === 'tools/list') {
    sendJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOL_DEFS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      },
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const tool = TOOL_MAP.get(toolName);
    if (!tool) {
      sendError(id, -32601, `Unknown tool: ${String(toolName)}`);
      return;
    }
    try {
      const output = await tool.execute(params?.arguments ?? {});
      const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text }],
          isError: false,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `ERROR: ${message}` }],
          isError: true,
        },
      });
    }
    return;
  }

  if (id !== undefined && id !== null) {
    sendError(id, -32601, `Method not supported: ${String(method)}`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('Content-Length:') || trimmed.startsWith('Content-Type:')) {
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    process.stderr.write(`[dsh-agent-teams mcp] invalid JSON line: ${String(err)}\n`);
    return;
  }
  Promise.resolve(handleRpcMessage(parsed)).catch((err) => {
    process.stderr.write(`[dsh-agent-teams mcp] unhandled RPC error: ${String(err)}\n`);
    sendError(parsed?.id, -32603, err instanceof Error ? err.message : String(err));
  });
});
