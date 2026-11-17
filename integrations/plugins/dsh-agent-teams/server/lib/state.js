/**
 * Team state persistence and pure team-logic rules.
 *
 * State lives on disk under `<workspace>/<stateDir>/<teamId>/`:
 * - `team.json` — the durable {@link TeamState} record
 * - `inbox/<agentKey>.jsonl` — one JSONL mailbox per agent (`captain` or a
 *   member name), mirroring the Claude Code AgentTeams mailbox layout
 *
 * All mutations run through an in-process per-team queue so read-modify-write
 * stays serial; `fs/promises` is used directly because the plugin owns this
 * bookkeeping (host-plane state, like session persistence) and the abstract
 * `fs` service offers no directory deletion.
 * @module dsh-agent-teams/state
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { appendFile, copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { FINDING_SEVERITIES, REVIEW_VERDICTS, TASK_KINDS, TERMINAL_TASK_STATUSES } from "./types.js";
import { hasValidQualityTaskFields, isReviewPolicy, isValidFindingLine, normalizeBlankOptionalTaskFields } from "./quality-gates.js";
import { teamLeadMatch } from "./lineage.js";
export { amendTaskContract, buildCoverageMatrix, canDeclareDelivery, classifyChangedPath, collectChangedPaths, defaultQualityDeliveryGraph, describeQualityLoop, evaluateQualityCompletion, hasValidQualityTaskFields, isQualityKind, isTaskRevision, isValidFindingLine, judgeConflictFor, normalizeBlankOptionalTaskFields, resolveEscalationState, normalizeSentinelNumericTaskFields, pathMatchesScope, planQualityFollowUp, qualityPlanningPrompt, resumeTeamState, sanitizeReviewAcceptance, sanitizeReviewObjective, taskKindOf, validateCreateTask, } from "./quality-gates.js";
/** Mailbox key of the captain. */
export const CAPTAIN_KEY = 'captain';
/** A crashed live-delivery attempt becomes retryable after this interval. */
const MAILBOX_DELIVERY_LEASE_MS = 60_000;
/** Durable deny-list for AgentTeams members that must never be resumed. */
const RETIRED_MEMBERS_FILE = 'retired-members.json';
/** In-process per-team mutation queues (promise chains). */
const locks = new Map();
/**
 * Serialize mutations of one team across the whole process.
 * @param key - the team id (or any mutation scope).
 * @param fn - the mutation to run exclusively.
 * @returns the mutation's result.
 */
export async function withTeamLock(key, fn) {
    const previous = locks.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    locks.set(key, tail);
    await previous;
    try {
        return await fn();
    }
    finally {
        release();
        // Drop this key's queue entry once we are still its tail, so settled
        // teams do not leave one resolved promise chained forever (the same
        // cleanup discipline as the scheduler's serializeMember). A successor
        // that already appended itself owns the map slot; keep its entry.
        if (locks.get(key) === tail)
            locks.delete(key);
    }
}
/**
 * Keys with an in-process lock queue (held or waiting), snapshot for
 * diagnostics and leak checks. The queue promises themselves stay private.
 */
export function teamLockQueueKeys() {
    return [...locks.keys()];
}
/**
 * Process-local lock key scoped by workspace state root and team id.
 *
 * XR-04: the id is lower-cased defensively so a caller that somehow passes a
 * non-normalized spelling still serializes onto the same queue as the
 * normalized id — on case-insensitive filesystems (NTFS) two case variants
 * of one id are the same directory and must never hold two locks.
 */
export function teamLockKey(stateRoot, teamId) {
    return `team:${stateRoot}:${teamId.toLowerCase()}`;
}
/**
 * Team ids whose delete flow is currently running in THIS process (GR-02).
 * The boot-time {@link resumeCancellingTeams} skips them, so a reload during
 * an in-flight delete cannot race the live flow between its two lock
 * sections. The registry is process-local by design: a crashed process is
 * exactly the case the boot resume covers.
 */
const cancellingInFlight = new Set();
/** Mark one team's delete flow as in-flight in this process (GR-02). */
export function markCancellingInFlight(stateRoot, teamId) {
    cancellingInFlight.add(teamLockKey(stateRoot, teamId));
}
/** Clear the in-flight mark of one team's delete flow (GR-02). */
export function unmarkCancellingInFlight(stateRoot, teamId) {
    cancellingInFlight.delete(teamLockKey(stateRoot, teamId));
}
/** Whether one team's delete flow is running in this process (GR-02). */
export function isCancellingInFlight(stateRoot, teamId) {
    return cancellingInFlight.has(teamLockKey(stateRoot, teamId));
}
/**
 * GR-02 mutation guard: a team in `cancelling` accepts no further work.
 * Central chokepoint used by the fresh-state admission in the tools layer.
 */
export function ensureNotCancelling(team) {
    if (team.restoredFrom !== undefined)
        throw new Error(`team "${team.name}" is read-only restored history`);
    if (team.phase === 'cancelling') {
        throw new Error(`team "${team.name}" is cancelling (delete already in progress); its tasks and mailboxes are being archived — retry once the team is gone`);
    }
}
/**
 * XR-04 case-collision probe: group directory names by their lower-case
 * folding and report every group holding more than one distinct spelling.
 * On case-sensitive filesystems such a pair is one NTFS team twice and
 * would split the in-process mutex; callers must fail loudly (never
 * silently pick one).
 * @param names - directory names (team ids) found under a state root.
 * @returns lower-cased key → the distinct spellings that collided.
 */
export function caseCollisions(names) {
    const byLower = new Map();
    for (const name of names) {
        const lower = name.toLowerCase();
        const group = byLower.get(lower) ?? [];
        group.push(name);
        byLower.set(lower, group);
    }
    const collisions = new Map();
    for (const [lower, group] of byLower) {
        if (group.length > 1)
            collisions.set(lower, group);
    }
    return collisions;
}
/** Longest key emitted before truncating and appending a digest. */
const MAX_KEY_LENGTH = 48;
/** Short stable digest, used to keep otherwise-colliding keys distinct. */
function keyDigest(name) {
    return createHash('sha256').update(name).digest('hex').slice(0, 8);
}
/**
 * Fold a free-form name into a safe path/key segment.
 *
 * Unicode letters and digits survive, so CJK/Cyrillic/Greek names stay
 * distinct and readable; everything else — spaces, punctuation, path
 * separators, control characters — folds to `-`. An ASCII-only whitelist
 * mapped *every* non-Latin name onto one shared fallback, which silently
 * merged their mailboxes and rejected the second such member as a duplicate.
 *
 * A name with no letters or digits at all (pure emoji or punctuation) cannot
 * yield a readable key, so it gets a digest rather than a shared constant.
 * Over-long names are truncated with a digest appended, so names sharing a
 * long prefix stay distinct and the result stays within filesystem limits
 * (CJK costs 3 bytes per character in UTF-8).
 *
 * @param name - any user-supplied name.
 * @returns a non-empty key safe as a single path segment.
 */
export function sanitizeKey(name) {
    const normalized = name.normalize('NFC').trim().toLowerCase();
    const cleaned = normalized
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '');
    if (cleaned === '')
        return `k-${keyDigest(normalized)}`;
    const points = [...cleaned];
    if (points.length > MAX_KEY_LENGTH) {
        return `${points.slice(0, MAX_KEY_LENGTH).join('')}-${keyDigest(normalized)}`;
    }
    return cleaned;
}
/**
 * Whether `dependencies` are all satisfied (every named task exists and
 * completed) for the given task list.
 * @param tasks - the team's tasks.
 * @param dependencies - task ids the candidate depends on.
 * @returns the ids that are still unsatisfied, empty when claimable.
 */
export function unsatisfiedDependencies(tasks, dependencies) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return dependencies.filter((id) => byId.get(id)?.status !== 'completed');
}
/**
 * The allowed task status transitions, keyed by current status.
 * Terminal statuses have no outgoing transitions.
 */
export const TASK_TRANSITIONS = {
    pending: ['claimed', 'cancelled'],
    claimed: ['in_progress', 'failed', 'cancelled'],
    in_progress: ['completed', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
};
/**
 * Validate one task status transition.
 * @param current - the task's current status.
 * @param next - the requested status.
 * @returns the transition error, or undefined when allowed.
 */
export function transitionError(current, next) {
    if (current === next)
        return undefined;
    if (!TASK_TRANSITIONS[current].includes(next)) {
        return `task status cannot move from "${current}" to "${next}"`;
    }
    return undefined;
}
/** Execution results belong to one attempt; a retry must produce its own evidence. */
function clearAttemptResult(task) {
    task.output = undefined;
    task.verdict = undefined;
    task.findings = undefined;
    task.changedPaths = undefined;
    task.acceptanceResults = undefined;
    task.commandsRun = undefined;
}
/** Activate the task's current generation for one owner and return its capability id. */
export function activateTaskAttempt(task, assignee) {
    const attemptId = randomUUID();
    task.status = 'claimed';
    task.assignee = assignee;
    task.attemptId = attemptId;
    task.handoffId = undefined;
    task.reassigning = false;
    clearAttemptResult(task);
    task.updatedAt = Date.now();
    return attemptId;
}
/** Start a fresh task generation for one owner. */
export function beginTaskAttempt(task, assignee) {
    task.attempt = (task.attempt ?? 0) + 1;
    return activateTaskAttempt(task, assignee);
}
/**
 * Pause one in-flight task when the team is halted. Unlike cancellation this
 * is reversible: the task returns to the ready pool as `pending` (claimable
 * again after an explicit resume) and keeps its written output and attempt
 * generation. The current attempt capability is dropped so an aborted
 * member's late `update_task` cannot mutate the task after the halt; the
 * assignee is preserved so a planned role still routes the task on resume.
 * Terminal tasks are left alone, so a manually cancelled task is never
 * resurrected.
 */
export function pauseTaskForHalt(task) {
    if (TERMINAL_TASK_STATUSES.includes(task.status))
        return;
    task.status = 'pending';
    task.attemptId = undefined;
    task.handoffId = undefined;
    task.reassigning = false;
    task.holdReason = undefined;
    task.deferReason = undefined;
    task.deferredUntil = undefined;
    task.deferRetries = undefined;
    task.updatedAt = Date.now();
}
export function invalidateTaskAttempt(task, nextAssignee, reassigning = false) {
    task.attemptId = undefined;
    task.handoffId = randomUUID();
    task.status = 'pending';
    task.assignee = nextAssignee;
    task.reassigning = reassigning;
    task.holdReason = undefined;
    task.deferReason = undefined;
    task.deferredUntil = undefined;
    task.deferRetries = undefined;
    clearAttemptResult(task);
    task.updatedAt = Date.now();
}
/**
 * Create the team directory structure and the initial team record.
 * @param stateRoot - resolved absolute state root directory.
 * @param state - the initial team record.
 */
export async function createTeamDir(stateRoot, state) {
    if (state.id === 'archive' || /[\\/]/.test(state.id) || state.id === '.' || state.id === '..')
        throw new Error('reserved or unsafe team id');
    const dir = join(stateRoot, state.id);
    await mkdir(join(dir, 'inbox'), { recursive: true });
    await atomicWriteText(join(dir, 'team.json'), JSON.stringify(state, null, 2));
}
/**
 * Read one team record from an explicit directory; `undefined` when absent.
 * The record's `id` must equal `expectedId`, so archived generations can be
 * read by their original team id even though their directory name differs.
 * @param dir - the directory holding the record file.
 * @param expectedId - the sanitized id the record must carry.
 * @param file - the record file name (default `team.json`).
 */
export async function readTeamRecordFrom(dir, expectedId, file = 'team.json') {
    try {
        const raw = await readFile(join(dir, file), 'utf8');
        const value = JSON.parse(stripLeadingBom(raw));
        const team = coerceTeamState(value, expectedId);
        if (team === undefined) {
            throw new Error(`invalid AgentTeams state in team "${expectedId}" (${file}): ${describeTeamStateDefect(value, expectedId)}`);
        }
        return team;
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}
/**
 * Read one team record; `undefined` when absent.
 *
 * GR-01 recovery: when the durable `team.json` is damaged (torn degraded
 * write), the `.bak` snapshot taken before every degraded direct write is
 * the recovery point — it is served as-is, without repairing the live file
 * (a concurrent writer may already hold a newer record; the next locked
 * write heals it). Only when both copies fail does the original defect
 * surface, now annotated with the `.bak` outcome; nothing is ever silently
 * invented.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team's sanitized id.
 */
export async function readTeam(stateRoot, teamId) {
    const dir = join(stateRoot, teamId);
    let primaryError;
    try {
        const primary = await readTeamRecordFrom(dir, teamId);
        if (primary !== undefined)
            return primary;
    }
    catch (error) {
        primaryError = error;
    }
    try {
        const recovered = await readTeamRecordFrom(dir, teamId, 'team.json.bak');
        if (recovered !== undefined)
            return recovered;
    }
    catch (bakError) {
        primaryError = new Error(`${String(primaryError instanceof Error ? primaryError.message : primaryError)}; team.json.bak recovery also failed: ${String(bakError instanceof Error ? bakError.message : bakError)}`, { cause: primaryError });
    }
    if (primaryError !== undefined)
        throw primaryError;
    return undefined;
}
/**
 * Synchronously read one team record while a continuable child is being
 * composed. Harness requires child setup contributions to be synchronous;
 * this narrow boundary lets a cold-resumed member restore its durable model
 * selection before its first request can be published.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team's sanitized id.
 * @returns the team record, or `undefined` when absent.
 */
export function readTeamSync(stateRoot, teamId) {
    const dir = join(stateRoot, teamId);
    const readRecord = (file) => {
        try {
            const raw = readFileSync(join(dir, file), 'utf8');
            const value = JSON.parse(stripLeadingBom(raw));
            const team = coerceTeamState(value, teamId);
            if (team === undefined) {
                throw new Error(`invalid AgentTeams state in team "${teamId}" (${file}): ${describeTeamStateDefect(value, teamId)}`);
            }
            return team;
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                return undefined;
            }
            throw error;
        }
    };
    let primaryError;
    try {
        const primary = readRecord('team.json');
        if (primary !== undefined)
            return primary;
    }
    catch (error) {
        primaryError = error;
    }
    try {
        const backup = readRecord('team.json.bak');
        if (backup !== undefined)
            return backup;
    }
    catch (error) {
        throw new AggregateError([primaryError, error], 'team.json.bak recovery also failed');
    }
    if (primaryError !== undefined)
        throw primaryError;
    return undefined;
}
/**
 * Persist one team record (inside the caller's lock).
 * @param stateRoot - resolved absolute state root directory.
 * @param state - the record to persist.
 */
export async function writeTeam(stateRoot, state) {
    await atomicWriteText(join(stateRoot, state.id, 'team.json'), JSON.stringify(state, null, 2));
}
/** Read the durable set of member session ids retired by remove/delete. */
function parseRetiredMemberIds(raw) {
    const parsed = JSON.parse(stripLeadingBom(raw));
    if (!Array.isArray(parsed) || parsed.some(value => typeof value !== 'string' || value === '')) {
        throw new Error('invalid AgentTeams retired member index');
    }
    return new Set(parsed);
}
/** Synchronous role hydration before the host's first prompt assembly. */
export function readRetiredMemberIdsSync(stateRoot) {
    try {
        return parseRetiredMemberIds(readFileSync(join(stateRoot, RETIRED_MEMBERS_FILE), 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return new Set();
        throw error;
    }
}
export async function readRetiredMemberIds(stateRoot) {
    try {
        return parseRetiredMemberIds(await readFile(join(stateRoot, RETIRED_MEMBERS_FILE), 'utf8'));
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return new Set();
        }
        throw error;
    }
}
/** Atomically add session ids to the durable retired-member deny-list. */
export async function recordRetiredMemberIds(stateRoot, memberIds) {
    const additions = memberIds.filter(id => id !== '');
    if (additions.length === 0)
        return;
    await withTeamLock(`retired-members:${stateRoot}`, async () => {
        const retired = await readRetiredMemberIds(stateRoot);
        for (const id of additions)
            retired.add(id);
        await mkdir(stateRoot, { recursive: true });
        await atomicWriteText(join(stateRoot, RETIRED_MEMBERS_FILE), `${JSON.stringify([...retired].sort(), null, 2)}\n`);
    });
}
/**
 * Find the team owned by one captain session (at most one per captain).
 * @param stateRoot - resolved absolute state root directory.
 * @param captainSessionId - the owning session id.
 * @param lead - durable lead identity of the calling session, when it may lead
 *   through a fork chain; omitted keeps the exact-id contract.
 * @returns the team record, or undefined when the captain leads no team.
 */
export async function findTeamByCaptain(stateRoot, captainSessionId, lead) {
    let entries;
    try {
        entries = await readdir(stateRoot, { withFileTypes: true });
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
    let found;
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const team = await readTeam(stateRoot, entry.name);
        if (team !== undefined && team.restoredFrom === undefined && (team.captainSessionId === captainSessionId
            || (lead !== undefined && teamLeadMatch(team, lead)))) {
            if (found !== undefined && found.id !== team.id) {
                throw new Error(`captain session leads multiple active teams ("${found.id}", "${team.id}"); archive one before continuing`);
            }
            found = team;
        }
    }
    return found;
}
/**
 * Find the team in which one session is an active participant.
 * Captains match `captainSessionId` — including a lead session that inherited
 * it through a fork — and members match their durable child session id.
 * Removed members no longer have access to team-scoped tools.
 * @param stateRoot - resolved absolute state root directory.
 * @param agentSessionId - calling captain/member session id.
 * @param lead - durable lead identity of the calling session, when available.
 * @returns the team record, or undefined when the caller belongs to no team.
 */
export async function findTeamByParticipant(stateRoot, agentSessionId, lead) {
    let entries;
    try {
        entries = await readdir(stateRoot, { withFileTypes: true });
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
    let found;
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const team = await readTeam(stateRoot, entry.name);
        const participates = team !== undefined && team.restoredFrom === undefined && (team.captainSessionId === agentSessionId
            || (lead !== undefined && teamLeadMatch(team, lead))
            || team.members.some((member) => member.id === agentSessionId && member.status !== 'removed'));
        if (participates && team !== undefined) {
            if (found !== undefined && found.id !== team.id) {
                throw new Error(`agent session belongs to multiple active teams ("${found.id}", "${team.id}"); the target team is ambiguous`);
            }
            found = team;
        }
    }
    return found;
}
/**
 * Whether a calling session's lineage passes through any member — active or
 * retired — of any team in this workspace. A top-level fork of a member still
 * reports `inheritsLead === true`, so the launch gate must reject it explicitly
 * on the full ancestry: descending from a member is never lead identity.
 * @param stateRoot - resolved absolute state root directory.
 * @param lead - durable lead identity of the calling session.
 */
export async function sessionDescendsFromMember(stateRoot, lead) {
    if (lead.ancestry.length === 0)
        return false;
    const ancestry = new Set(lead.ancestry);
    const retired = await readRetiredMemberIds(stateRoot);
    if ([...ancestry].some(id => retired.has(id)))
        return true;
    let entries;
    try {
        entries = await readdir(stateRoot, { withFileTypes: true });
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const team = await readTeam(stateRoot, entry.name);
        if (team === undefined)
            continue;
        if (team.members.some(member => ancestry.has(member.id)))
            return true;
    }
    return false;
}
/** Build a fresh message record. */
export function createMessage(from, to, content) {
    return { id: randomUUID(), from, to, content, ts: Date.now() };
}
/**
 * Append one message to an agent's mailbox (JSONL).
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @param agentKey - `captain` or a member name.
 * @param message - the message to append.
 */
export async function appendMailbox(stateRoot, teamId, agentKey, message) {
    const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`);
    await mkdir(join(stateRoot, teamId, 'inbox'), { recursive: true });
    let existing = '';
    try {
        existing = await readFile(file, 'utf8');
    }
    catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
            throw error;
        }
    }
    const separator = existing !== '' && !existing.endsWith('\n') ? '\n' : '';
    await atomicWriteText(file, `${existing}${separator}${JSON.stringify(message)}\n`);
}
/**
 * Read one agent's whole mailbox, oldest first.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @param agentKey - `captain` or a member name.
 * @param onMalformedLine - optional diagnostic hook; malformed records are
 * skipped so one manually damaged line cannot make the whole team unreadable.
 * @returns the messages, empty when the mailbox does not exist yet.
 */
export async function readMailbox(stateRoot, teamId, agentKey, onMalformedLine) {
    const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`);
    try {
        const raw = await readFile(file, 'utf8');
        const messages = [];
        for (const [index, rawLine] of raw.split('\n').entries()) {
            const line = stripLeadingBom(rawLine);
            if (line.trim() === '')
                continue;
            let value;
            try {
                value = JSON.parse(line);
            }
            catch {
                onMalformedLine?.(index + 1, new Error('invalid JSON'));
                continue;
            }
            if (!isTeamMessage(value)) {
                onMalformedLine?.(index + 1, new Error('invalid message shape'));
                continue;
            }
            messages.push(value);
        }
        return messages;
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
/** Read only messages that have not been acknowledged by their recipient. */
export async function readUnreadMailbox(stateRoot, teamId, agentKey, onMalformedLine) {
    return (await readMailbox(stateRoot, teamId, agentKey, onMalformedLine))
        .filter(message => message.readAt === undefined && message.discardedAt === undefined);
}
/** Pending delivery is distinct from delivered-but-not-yet-read input. */
export async function readPendingMailbox(stateRoot, teamId, agentKey) {
    const now = Date.now();
    return (await readUnreadMailbox(stateRoot, teamId, agentKey))
        .filter(message => message.deliveredAt === undefined
        && (message.deliveryClaimedAt === undefined
            || now - message.deliveryClaimedAt >= MAILBOX_DELIVERY_LEASE_MS));
}
async function mutateMailbox(stateRoot, teamId, agentKey, messageIds, mutate) {
    if (messageIds.length === 0)
        return;
    const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`);
    let raw;
    try {
        raw = await readFile(file, 'utf8');
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            return;
        throw error;
    }
    const selected = new Set(messageIds);
    const lines = raw.split('\n').map((rawLine) => {
        const line = stripLeadingBom(rawLine);
        if (line.trim() === '')
            return rawLine;
        try {
            const value = JSON.parse(line);
            if (!isTeamMessage(value) || !selected.has(value.id))
                return rawLine;
            return JSON.stringify(mutate(value));
        }
        catch {
            return rawLine;
        }
    });
    await atomicWriteText(file, lines.join('\n'));
}
/** Lease selected fallback messages to one delivery path. */
export async function claimMailboxDelivery(stateRoot, teamId, agentKey, messageIds) {
    const now = Date.now();
    await mutateMailbox(stateRoot, teamId, agentKey, messageIds, message => ({
        ...message,
        deliveryClaimedAt: now,
    }));
}
/** Release a failed delivery lease so the scheduler can retry it later. */
export async function releaseMailboxDelivery(stateRoot, teamId, agentKey, messageIds) {
    await mutateMailbox(stateRoot, teamId, agentKey, messageIds, (message) => {
        const { deliveryClaimedAt: _claimed, ...released } = message;
        return released;
    });
}
/**
 * Mark selected durable mailbox records delivered/read while preserving
 * malformed lines for diagnostics. Callers serialize this with the team lock.
 */
export async function acknowledgeMailbox(stateRoot, teamId, agentKey, messageIds) {
    const now = Date.now();
    await mutateMailbox(stateRoot, teamId, agentKey, messageIds, (message) => {
        const { deliveryClaimedAt: _claimed, ...rest } = message;
        return {
            ...rest,
            deliveredAt: message.deliveredAt ?? now,
            readAt: message.readAt ?? now,
        };
    });
}
/** Acceptance by Harness is not evidence that a model step consumed input. */
export async function markMailboxDelivered(stateRoot, teamId, agentKey, ids) {
    await mutateMailbox(stateRoot, teamId, agentKey, ids, (message) => {
        const { deliveryClaimedAt: _claimed, ...rest } = message;
        return { ...rest, deliveredAt: message.deliveredAt ?? Date.now() };
    });
}
export async function discardMailboxMessages(stateRoot, teamId, agentKey, ids) {
    await mutateMailbox(stateRoot, teamId, agentKey, ids, message => ({ ...message, discardedAt: message.discardedAt ?? Date.now() }));
}
/** Remove the optional UTF-8 BOM some editors prepend to JSON text. */
function stripLeadingBom(value) {
    return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
}
/** Rename attempts before falling back to a direct overwrite. */
const ATOMIC_RENAME_RETRIES = 3;
/** Pause between rename attempts, giving a briefly-locking owner time to finish. */
const ATOMIC_RENAME_RETRY_DELAY_MS = 50;
/**
 * Rename error codes worth retrying before the direct-write fallback. On
 * Windows, replacing an existing file whose target is momentarily held open
 * without FILE_SHARE_DELETE surfaces as EPERM (or EACCES/EBUSY variants);
 * EEXIST/ENOTEMPTY cover other "target busy" edge shapes.
 */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST', 'ENOTEMPTY']);
function isRetryableRenameError(error) {
    return error instanceof Error
        && 'code' in error
        && RETRYABLE_RENAME_CODES.has(error.code ?? '');
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Replace `file` with `content`, preferring an atomic same-directory rename of
 * an already-written temp file.
 *
 * On Windows, `rename(tmp, file)` over an existing target throws EPERM while
 * any other process keeps the target open without FILE_SHARE_DELETE (editors,
 * indexers, antivirus scans, preview panes). By that point the payload has
 * already been fully written to the temp file, so a direct overwrite of the
 * target is a content-equivalent degraded path: retry the rename a few times
 * (transient locks clear quickly), then write the target in place. Every path
 * removes the temp file; when both the atomic rename and the direct write
 * fail, the combined error surfaces as an {@link AggregateError}.
 *
 * @returns nothing once the file has been replaced by one of the two paths.
 */
export async function replaceFileAtomicOrDirect(temporary, file, content, primitives, options = {}) {
    const retries = options.retries ?? ATOMIC_RENAME_RETRIES;
    const retryDelayMs = options.retryDelayMs ?? ATOMIC_RENAME_RETRY_DELAY_MS;
    for (let attempt = 0;; attempt += 1) {
        try {
            await primitives.rename(temporary, file);
            return;
        }
        catch (error) {
            if (isRetryableRenameError(error) && attempt < retries) {
                await sleep(retryDelayMs);
                continue;
            }
            let fallbackError;
            // Never destroy an existing record if its recovery point cannot be saved.
            try {
                await primitives.backup?.(file);
            }
            catch (backupError) {
                if (backupError.code !== 'ENOENT') {
                    await primitives.remove(temporary).catch(() => undefined);
                    throw new AggregateError([error, backupError], `backup failed before replacing "${file}"`, { cause: backupError });
                }
            }
            try {
                await primitives.writeFile(file, content);
            }
            catch (writeError) {
                fallbackError = writeError;
            }
            await primitives.remove(temporary).catch(() => undefined);
            if (fallbackError !== undefined) {
                throw new AggregateError([error, fallbackError], `failed to replace "${file}" atomically (${String(error)}) or by direct write (${String(fallbackError)})`);
            }
            return;
        }
    }
}
/**
 * Atomically replace one UTF-8 state file from a same-directory temp file,
 * degrading to a direct overwrite when the atomic rename cannot proceed
 * (see {@link replaceFileAtomicOrDirect} for the Windows EPERM rationale).
 */
async function atomicWriteText(file, content) {
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    }
    catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    }
    await replaceFileAtomicOrDirect(temporary, file, content, {
        rename: (from, to) => rename(from, to),
        writeFile: (target, payload) => writeFile(target, payload, 'utf8'),
        remove: (path) => rm(path, { force: true }),
        // GR-01: the `.bak` snapshot of the last full record; readTeam's
        // recovery path reads exactly this sibling.
        backup: async (target) => {
            if (target.endsWith('team.json')) {
                const dir = dirname(target);
                const id = basename(dir);
                try {
                    const primary = await readTeamRecordFrom(dir, id);
                    if (primary === undefined)
                        return;
                }
                catch (error) {
                    // A recovered writer must not replace its sole good backup with torn bytes.
                    if (await readTeamRecordFrom(dir, id, 'team.json.bak') !== undefined)
                        return;
                    throw error;
                }
            }
            const snapshot = `${target}.${randomUUID()}.bak.tmp`;
            try {
                await copyFile(target, snapshot);
                await rename(snapshot, `${target}.bak`);
            }
            finally {
                await rm(snapshot, { force: true }).catch(() => undefined);
            }
        },
    });
}
/** Whether a parsed JSON value is a plain record. */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Whether a value is an optional string. */
function isOptionalString(value) {
    return value === undefined || typeof value === 'string';
}
/** Whether a value is a non-empty (non-blank) string. */
function nonemptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}
/** Whether a value is an absent or non-blank string (a persisted id/name). */
function isOptionalNonBlankString(value) {
    return value === undefined || (typeof value === 'string' && value.trim() !== '');
}
/** Whether a value is a non-empty list of non-blank tool names. */
function isToolNameList(value) {
    return Array.isArray(value)
        && value.length > 0
        && value.every(name => typeof name === 'string' && name.trim() !== '');
}
/**
 * Validate one persisted effective tool filter (#59). `deny` is part of the
 * contract and never empty (the captain-only deny list is always included); an
 * `allow` list, when present, is non-empty for the same reason. A wrong-typed
 * or empty list is rejected instead of being silently accepted at the durable
 * boundary — the same class of drift #188 fixed for team records.
 */
function isMemberToolFilter(value) {
    if (!isRecord(value))
        return false;
    const allow = value['allow'];
    const deny = value['deny'];
    if (allow !== undefined && !isToolNameList(allow))
        return false;
    return isToolNameList(deny);
}
/**
 * Whether a value is an absent or non-blank string list. An empty list is
 * accepted: the Web wizard lets a user clear every tag again, and persisting
 * `[]` must round-trip exactly like an omitted field.
 */
function isOptionalStringList(value) {
    return value === undefined
        || (Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim() !== ''));
}
/** Whether a value is a finite timestamp/counter number. */
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
/** Validate one member record at the durable JSON boundary. */
function isTeamMember(value) {
    if (!isRecord(value))
        return false;
    return typeof value['id'] === 'string'
        && typeof value['name'] === 'string'
        && value['name'].trim() !== ''
        && isOptionalString(value['role'])
        && (value['stopping'] === undefined || typeof value['stopping'] === 'boolean')
        && isOptionalString(value['provider'])
        && isOptionalString(value['model'])
        && isOptionalString(value['reasoningEffort'])
        && isOptionalString(value['activeProvider'])
        && isOptionalString(value['activeModel'])
        && isOptionalString(value['spawnError'])
        && (value['executionPrompt'] === undefined || typeof value['executionPrompt'] === 'string')
        && (value['fallback'] === undefined || (isRecord(value['fallback']) && typeof value['fallback']['provider'] === 'string' && typeof value['fallback']['model'] === 'string'))
        && (value['fallbackActive'] === undefined || typeof value['fallbackActive'] === 'boolean')
        // A member without a policy keeps the legacy shape: both fields stay absent.
        && isOptionalNonBlankString(value['toolPolicy'])
        && (value['toolFilter'] === undefined || isMemberToolFilter(value['toolFilter']))
        && (value['runtimeSetup'] === undefined || (isRecord(value['runtimeSetup'])
            && typeof value['runtimeSetup']['persona'] === 'string'
            && isMemberToolFilter(value['runtimeSetup']['toolFilter'])))
        // Roster tags are descriptive metadata: absent (legacy) or a list of
        // non-blank strings, never a silently coerced scalar.
        && isOptionalStringList(value['capabilities'])
        && isOptionalStringList(value['noAssign'])
        && isFiniteNumber(value['joinedAt'])
        && (value['status'] === 'idle' || value['status'] === 'working' || value['status'] === 'removed');
}
/** Validate one task record at the durable JSON boundary. */
function isTeamProfileSnapshot(value) {
    return isRecord(value)
        && typeof value['name'] === 'string'
        && value['name'].trim() !== ''
        && isOptionalString(value['description'])
        && isOptionalString(value['protocol'])
        && (value['executionPrompt'] === undefined || typeof value['executionPrompt'] === 'string')
        && (value['fallback'] === undefined || (isRecord(value['fallback']) && typeof value['fallback']['provider'] === 'string' && typeof value['fallback']['model'] === 'string'))
        && (value['taskPlanning'] === undefined || value['taskPlanning'] === 'captain' || value['taskPlanning'] === 'seed')
        && (value['reviewPolicy'] === undefined || isReviewPolicy(value['reviewPolicy']));
}
function coerceProfileSnapshot(value) {
    if (typeof value === 'string') {
        const name = value.trim();
        return name === '' ? undefined : { name };
    }
    if (!isRecord(value))
        return undefined;
    if (!isTeamProfileSnapshot(value))
        return undefined;
    return {
        name: value.name.trim(),
        ...value.description === undefined ? {} : { description: value.description },
        ...value.protocol === undefined ? {} : { protocol: value.protocol },
        ...value.taskPlanning === undefined ? {} : { taskPlanning: value.taskPlanning },
    };
}
function coerceTeamState(value, expectedId) {
    if (!isRecord(value))
        return undefined;
    if (value['profile'] !== undefined && !isTeamProfileSnapshot(value['profile']) && typeof value['profile'] !== 'string') {
        const next = { ...value };
        delete next['profile'];
        value = next;
    }
    else if (typeof value['profile'] === 'string') {
        const upgraded = coerceProfileSnapshot(value['profile']);
        value = upgraded === undefined
            ? (() => {
                const next = { ...value };
                delete next['profile'];
                return next;
            })()
            : { ...value, profile: upgraded };
    }
    if (!isRecord(value) || !Array.isArray(value['tasks'])) {
        return isTeamState(value, expectedId) ? value : undefined;
    }
    const tasks = value['tasks'].map((task) => {
        if (!isRecord(task))
            return task;
        // Tolerate legacy dirty records instead of bricking the whole team on
        // reload: blank optional fields written by older builds (or by models that
        // materialize optionals as "") are normalized to omitted, matching the
        // profileSeedId handling below and the tool-input normalization. The same
        // pass drops out-of-contract numeric sentinels such as `line: -1`
        // (issue #188), so an already-written bad record self-heals on read.
        const cleaned = normalizeBlankOptionalTaskFields(task);
        if (cleaned['profileSeedId'] !== undefined && (typeof cleaned['profileSeedId'] !== 'string' || cleaned['profileSeedId'].trim() === '')) {
            const next = { ...cleaned };
            delete next['profileSeedId'];
            return next;
        }
        return cleaned;
    });
    const coerced = { ...value, tasks };
    return isTeamState(coerced, expectedId) ? coerced : undefined;
}
/**
 * Name the first durable defect in a record `coerceTeamState` rejected. Before
 * this, a rejected `team.json` surfaced only as
 * `invalid AgentTeams state in team "x"` — no task, no field, no value — while
 * every AgentTeams tool (read *and* write) failed at once, leaving an operator
 * to bisect the file by hand (issue #188). The detail is computed only on the
 * failure path, so the happy path keeps its existing cost.
 * @param raw - the parsed record as read from disk, before coercion.
 * @param expectedId - the team id the record was read for.
 * @returns a `task "t2": findings[0].line -1 must be ...` style detail.
 */
export function describeTeamStateDefect(raw, expectedId) {
    if (!isRecord(raw))
        return 'record must be a JSON object';
    if (!Array.isArray(raw['tasks'])) {
        return raw['tasks'] === undefined ? 'tasks is missing' : `tasks must be an array (got ${typeof raw['tasks']})`;
    }
    const tasks = raw['tasks'].map((task) => isRecord(task) ? normalizeBlankOptionalTaskFields(task) : task);
    for (const [index, task] of tasks.entries()) {
        if (!isRecord(task))
            return `tasks[${index}] must be an object`;
        const label = typeof task['id'] === 'string' && task['id'] !== '' ? `task "${task['id']}"` : `tasks[${index}]`;
        const detail = describeTaskDefect(task);
        if (detail === undefined)
            continue;
        return `${label}: ${detail}`;
    }
    const ids = tasks.filter(isRecord).map((task) => task['id']);
    if (ids.some((id) => typeof id !== 'string' || id === ''))
        return 'a task id must be a non-empty string';
    const seen = new Set();
    for (const id of ids) {
        if (seen.has(id))
            return `task "${id}": duplicated task id`;
        seen.add(id);
    }
    if (raw['id'] !== expectedId)
        return `id ${JSON.stringify(raw['id'])} must equal "${expectedId}"`;
    if (typeof raw['name'] !== 'string' || raw['name'].trim() === '')
        return 'name must be a non-empty string';
    if (!isOptionalString(raw['description']))
        return 'description must be a string';
    if (raw['profile'] !== undefined && !isTeamProfileSnapshot(raw['profile']))
        return 'profile is not a valid profile snapshot';
    if (typeof raw['captainSessionId'] !== 'string' || raw['captainSessionId'] === '')
        return 'captainSessionId must be a non-empty string';
    if (!isFiniteNumber(raw['createdAt']))
        return 'createdAt must be a finite number';
    if (!Array.isArray(raw['members']))
        return 'members must be an array';
    const memberKeys = new Set();
    const memberIds = new Set();
    for (const [index, member] of raw['members'].entries()) {
        if (!isTeamMember(member))
            return `members[${index}] is not a valid member record`;
        const key = sanitizeKey(member.name);
        if (key === CAPTAIN_KEY)
            return `members[${index}]: name "${member.name}" is reserved for the captain`;
        if (memberKeys.has(key))
            return `members[${index}]: name "${member.name}" is already used by another member`;
        memberKeys.add(key);
        if (member.id === '')
            continue;
        if (memberIds.has(member.id))
            return `members[${index}]: id "${member.id}" is duplicated`;
        memberIds.add(member.id);
    }
    if (!Number.isSafeInteger(raw['taskSeq']) || raw['taskSeq'] < 0)
        return 'taskSeq must be an integer >= 0';
    if (raw['phase'] !== undefined && raw['phase'] !== 'staged' && raw['phase'] !== 'running' && raw['phase'] !== 'cancelling') {
        return `phase ${JSON.stringify(raw['phase'])} must be "staged", "running" or "cancelling"`;
    }
    if (raw['planReviewState'] !== undefined
        && raw['planReviewState'] !== 'awaiting_review'
        && raw['planReviewState'] !== 'awaiting_feedback') {
        return `planReviewState ${JSON.stringify(raw['planReviewState'])} is invalid`;
    }
    for (const key of ['approvedAt', 'haltedAt']) {
        if (raw[key] !== undefined && !isFiniteNumber(raw[key]))
            return `${key} must be a finite number`;
    }
    if (raw['halted'] !== undefined && typeof raw['halted'] !== 'boolean')
        return 'halted must be a boolean';
    if (raw['reviewPolicy'] !== undefined && !isReviewPolicy(raw['reviewPolicy']))
        return 'reviewPolicy is invalid';
    if (raw['escalated'] !== undefined && typeof raw['escalated'] !== 'boolean')
        return 'escalated must be a boolean';
    return 'record does not satisfy the durable team contract';
}
/** The first task-contract violation, or `undefined` when the task is valid. */
function describeTaskDefect(task) {
    if (typeof task['id'] !== 'string')
        return 'id must be a string';
    if (!isOptionalString(task['profileSeedId']))
        return 'profileSeedId must be a string';
    if (typeof task['profileSeedId'] === 'string' && task['profileSeedId'].trim() === '')
        return 'profileSeedId must not be blank';
    if (typeof task['subject'] !== 'string')
        return 'subject must be a string';
    if (!isOptionalString(task['description']))
        return 'description must be a string';
    const statuses = ['pending', 'claimed', 'in_progress', 'completed', 'failed', 'cancelled'];
    if (!statuses.includes(task['status']))
        return `status ${JSON.stringify(task['status'])} is invalid`;
    if (!isOptionalString(task['assignee']))
        return 'assignee must be a string';
    if (!Array.isArray(task['dependencies']))
        return 'dependencies must be an array';
    if (!task['dependencies'].every((dependency) => typeof dependency === 'string'))
        return 'dependencies must contain only strings';
    if (!isOptionalString(task['output']))
        return 'output must be a string';
    if (task['attempt'] !== undefined && !(Number.isSafeInteger(task['attempt']) && task['attempt'] >= 0)) {
        return `attempt ${JSON.stringify(task['attempt'])} must be an integer >= 0`;
    }
    if (!isOptionalString(task['attemptId']))
        return 'attemptId must be a string';
    if (!isOptionalString(task['handoffId']))
        return 'handoffId must be a string';
    if (!isOptionalString(task['handoffFromMemberId']))
        return 'handoffFromMemberId must be a string';
    if (task['reassigning'] !== undefined && typeof task['reassigning'] !== 'boolean')
        return 'reassigning must be a boolean';
    if (!isFiniteNumber(task['createdAt']))
        return 'createdAt must be a finite number';
    if (!isFiniteNumber(task['updatedAt']))
        return 'updatedAt must be a finite number';
    return describeQualityTaskDefect(task);
}
/** Mirror of `hasValidQualityTaskFields`, reporting the first failing field. */
function describeQualityTaskDefect(task) {
    if (task['kind'] !== undefined && !TASK_KINDS.includes(task['kind'])) {
        return `kind ${JSON.stringify(task['kind'])} is invalid`;
    }
    if (task['verdict'] !== undefined && !REVIEW_VERDICTS.includes(task['verdict'])) {
        return `verdict ${JSON.stringify(task['verdict'])} is invalid`;
    }
    if (task['round'] !== undefined && !(Number.isSafeInteger(task['round']) && task['round'] >= 1)) {
        return `round ${JSON.stringify(task['round'])} must be an integer >= 1`;
    }
    for (const key of ['objective', 'reviewedTaskId', 'sourceTaskId']) {
        if (task[key] !== undefined && !nonemptyString(task[key]))
            return `${key} must be a non-empty string`;
    }
    if (task['reviewedAttempt'] !== undefined
        && !(Number.isSafeInteger(task['reviewedAttempt']) && task['reviewedAttempt'] >= 0)) {
        return `reviewedAttempt ${JSON.stringify(task['reviewedAttempt'])} must be an integer >= 0`;
    }
    const stringLists = ['inScope', 'outOfScope', 'acceptance', 'verify', 'deliverables', 'nonGoals', 'changedPaths', 'sourceFindingIds', 'coverageOf'];
    for (const key of stringLists) {
        const value = task[key];
        if (value === undefined)
            continue;
        if (!Array.isArray(value))
            return `${key} must be an array`;
        const badIndex = value.findIndex((item) => !nonemptyString(item));
        if (badIndex >= 0)
            return `${key}[${badIndex}] must be a non-empty string`;
    }
    if (task['findings'] !== undefined) {
        const findings = task['findings'];
        if (!Array.isArray(findings))
            return 'findings must be an array';
        for (const [index, finding] of findings.entries()) {
            const detail = describeFindingDefect(finding);
            if (detail !== undefined)
                return `findings[${index}].${detail}`;
        }
        const ids = findings.map((finding) => finding.id);
        if (new Set(ids).size !== ids.length)
            return 'findings ids must be unique';
    }
    if (task['acceptanceResults'] !== undefined) {
        const results = task['acceptanceResults'];
        if (!Array.isArray(results))
            return 'acceptanceResults must be an array';
        for (const [index, result] of results.entries()) {
            if (!isRecord(result))
                return `acceptanceResults[${index}] must be an object`;
            if (!nonemptyString(result['criterion']))
                return `acceptanceResults[${index}].criterion must be a non-empty string`;
            if (result['status'] !== 'passed' && result['status'] !== 'failed')
                return `acceptanceResults[${index}].status must be "passed" or "failed"`;
            if (result['evidence'] !== undefined && typeof result['evidence'] !== 'string')
                return `acceptanceResults[${index}].evidence must be a string`;
        }
    }
    if (task['commandsRun'] !== undefined) {
        const commands = task['commandsRun'];
        if (!Array.isArray(commands))
            return 'commandsRun must be an array';
        for (const [index, command] of commands.entries()) {
            if (!isRecord(command))
                return `commandsRun[${index}] must be an object`;
            if (!nonemptyString(command['command']))
                return `commandsRun[${index}].command must be a non-empty string`;
            if (command['status'] !== 'passed' && command['status'] !== 'failed')
                return `commandsRun[${index}].status must be "passed" or "failed"`;
        }
    }
    return undefined;
}
/** The first finding-contract violation, or `undefined` when the finding is valid. */
function describeFindingDefect(finding) {
    if (!isRecord(finding))
        return 'must be an object';
    if (!nonemptyString(finding['id']))
        return 'id must be a non-empty string';
    if (!FINDING_SEVERITIES.includes(finding['severity'])) {
        return `severity ${JSON.stringify(finding['severity'])} is invalid`;
    }
    if (!nonemptyString(finding['problem']))
        return 'problem must be a non-empty string';
    if (!nonemptyString(finding['requiredFix']))
        return 'requiredFix must be a non-empty string';
    if (finding['file'] !== undefined && !nonemptyString(finding['file']))
        return 'file must be a non-empty string';
    if (finding['line'] !== undefined && !isValidFindingLine(finding['line'])) {
        return `line ${JSON.stringify(finding['line'])} must be an integer >= 0 (omit it when there is no line number)`;
    }
    if (finding['resolved'] !== undefined && typeof finding['resolved'] !== 'boolean')
        return 'resolved must be a boolean';
    return undefined;
}
export function isTeamTask(value) {
    if (!isRecord(value))
        return false;
    return typeof value['id'] === 'string'
        && isOptionalString(value['profileSeedId'])
        && (value['profileSeedId'] === undefined || value['profileSeedId'].trim() !== '')
        && typeof value['subject'] === 'string'
        && isOptionalString(value['description'])
        && (value['status'] === 'pending'
            || value['status'] === 'claimed'
            || value['status'] === 'in_progress'
            || value['status'] === 'completed'
            || value['status'] === 'failed'
            || value['status'] === 'cancelled')
        && isOptionalString(value['assignee'])
        && Array.isArray(value['dependencies'])
        && value['dependencies'].every((dependency) => typeof dependency === 'string')
        && isOptionalString(value['output'])
        && (value['attempt'] === undefined
            || (Number.isSafeInteger(value['attempt']) && value['attempt'] >= 0))
        && isOptionalString(value['attemptId'])
        && isOptionalString(value['handoffId'])
        && isOptionalString(value['handoffFromMemberId'])
        && (value['reassigning'] === undefined || typeof value['reassigning'] === 'boolean')
        && isFiniteNumber(value['createdAt'])
        && isFiniteNumber(value['updatedAt'])
        && hasValidQualityTaskFields(value);
}
/** Validate the full team record before it can participate in authorization. */
function isTeamState(value, expectedId) {
    if (!isRecord(value))
        return false;
    const validShape = value['id'] === expectedId
        && typeof value['name'] === 'string'
        && value['name'].trim() !== ''
        && isOptionalString(value['description'])
        && (value['profile'] === undefined || isTeamProfileSnapshot(value['profile']))
        && typeof value['captainSessionId'] === 'string'
        && value['captainSessionId'] !== ''
        && isFiniteNumber(value['createdAt'])
        && Array.isArray(value['members'])
        && value['members'].every(isTeamMember)
        && Array.isArray(value['tasks'])
        && value['tasks'].every(isTeamTask)
        && Number.isSafeInteger(value['taskSeq'])
        && value['taskSeq'] >= 0
        && (value['phase'] === undefined
            || value['phase'] === 'staged'
            || value['phase'] === 'running'
            || value['phase'] === 'cancelling')
        && (value['planReviewState'] === undefined
            || value['planReviewState'] === 'awaiting_review'
            || value['planReviewState'] === 'awaiting_feedback')
        && isOptionalString(value['restoredFrom'])
        && isOptionalString(value['deletionOperationId'])
        && (value['approvedAt'] === undefined || isFiniteNumber(value['approvedAt']))
        && (value['halted'] === undefined || typeof value['halted'] === 'boolean')
        && (value['haltedAt'] === undefined || isFiniteNumber(value['haltedAt']))
        && (value['reviewPolicy'] === undefined || isReviewPolicy(value['reviewPolicy']))
        && (value['escalated'] === undefined || typeof value['escalated'] === 'boolean');
    if (!validShape)
        return false;
    const members = value['members'];
    const tasks = value['tasks'];
    const memberIds = new Set();
    const memberKeys = new Set();
    for (const member of members) {
        const key = sanitizeKey(member.name);
        if (key === CAPTAIN_KEY || memberKeys.has(key))
            return false;
        if (member.id !== '') {
            if (memberIds.has(member.id))
                return false;
            memberIds.add(member.id);
        }
        memberKeys.add(key);
    }
    const taskIds = new Set();
    for (const task of tasks) {
        if (task.id === '' || taskIds.has(task.id))
            return false;
        taskIds.add(task.id);
    }
    return true;
}
/** Validate a mailbox record so later rendering cannot crash on `{}`/`null`. */
function isTeamMessage(value) {
    if (!isRecord(value))
        return false;
    return typeof value['id'] === 'string'
        && typeof value['from'] === 'string'
        && typeof value['to'] === 'string'
        && typeof value['content'] === 'string'
        && isFiniteNumber(value['ts'])
        && (value['deliveryClaimedAt'] === undefined || isFiniteNumber(value['deliveryClaimedAt']))
        && (value['deliveredAt'] === undefined || isFiniteNumber(value['deliveredAt']))
        && (value['readAt'] === undefined || isFiniteNumber(value['readAt']))
        && (value['discardedAt'] === undefined || isFiniteNumber(value['discardedAt']))
        && (value['taskId'] === undefined || typeof value['taskId'] === 'string')
        && (value['attemptId'] === undefined || typeof value['attemptId'] === 'string')
        && (value['sourceTaskId'] === undefined || typeof value['sourceTaskId'] === 'string')
        && (value['sourceAttemptId'] === undefined || typeof value['sourceAttemptId'] === 'string')
        && (value['sourceTaskStatus'] === undefined || ['pending', 'claimed', 'in_progress', 'completed', 'failed', 'cancelled'].includes(value['sourceTaskStatus']));
}
/**
 * Remove a team's whole directory (members should be interrupted first).
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export async function removeTeamDir(stateRoot, teamId) {
    await rm(join(stateRoot, teamId), { recursive: true, force: true });
}
/** Total wall-clock budget for one archive move before giving up (XR-05). */
const ARCHIVE_RENAME_TOTAL_TIMEOUT_MS = 3000;
/**
 * XR-05: the archive move stayed blocked past its total budget — a Windows
 * delete-sharing lock held by a member process that has not fully exited.
 * The source directory is untouched; the team keeps its `cancelling` phase
 * so a later delete/resume can finish it. REST surfaces this as HTTP 409
 * (`archive_busy` / `EPERM_RESOURCE_LOCKED`).
 */
export class ArchiveResourceLockedError extends Error {
    code = 'EPERM_RESOURCE_LOCKED';
    constructor(from, to, timeoutMs, cause) {
        super(`archive_busy: moving "${from}" to "${to}" stayed locked for ${timeoutMs}ms — a member process may not have fully exited yet; the source was left untouched, retry shortly (HTTP 409 EPERM_RESOURCE_LOCKED)`, { cause });
        this.name = 'ArchiveResourceLockedError';
    }
}
/**
 * `rename` with a bounded retry policy: a short-lived delete-sharing lock on
 * any file below the renamed path is retried a few times, but the whole
 * operation is capped by a total wall-clock budget (XR-05). When the budget
 * expires while the move is still lock-blocked, the typed
 * {@link ArchiveResourceLockedError} surfaces instead of an infinite retry
 * loop, and the source is never damaged.
 * @param from - source path.
 * @param to - destination path.
 * @param primitives - injectable `rename` for tests.
 * @param options - retry/timeout tuning.
 */
export async function renameWithRetry(from, to, primitives = { rename: (src, dst) => rename(src, dst) }, options = {}) {
    const retries = options.retries ?? ATOMIC_RENAME_RETRIES;
    const retryDelayMs = options.retryDelayMs ?? ATOMIC_RENAME_RETRY_DELAY_MS;
    const totalTimeoutMs = options.totalTimeoutMs ?? ARCHIVE_RENAME_TOTAL_TIMEOUT_MS;
    const deadline = Date.now() + totalTimeoutMs;
    for (let attempt = 0;; attempt += 1) {
        try {
            await primitives.rename(from, to);
            return;
        }
        catch (error) {
            if (isRetryableRenameError(error)) {
                const remaining = deadline - Date.now();
                if (attempt < retries && remaining > 0) {
                    await sleep(Math.min(retryDelayMs, remaining));
                    continue;
                }
                // XR-05: retrying forever while another process holds the lock
                // deadlocks the caller; surface a typed, 409-mappable failure with
                // the source exactly where it was.
                throw new ArchiveResourceLockedError(from, to, totalTimeoutMs, error);
            }
            throw error;
        }
    }
}
/** Archive generation directory naming: `<teamId>__<epochMs>_<random6>`. */
const ARCHIVE_GENERATION_PATTERN = /^(.+)__(\d+)_([a-z0-9]{4,8})$/;
/** Random short id suffix keeping same-millisecond generations distinct. */
function archiveGenerationSuffix() {
    return randomUUID().replace(/-/g, '').slice(0, 6);
}
/**
 * Parse one archive directory name into its generation identity (GR-03).
 * Sanitized team ids fold every non-alphanumeric run to `-`, so a literal
 * `__` separator can never occur inside a team id — the split is unambiguous.
 */
function parseArchiveGeneration(name) {
    const match = ARCHIVE_GENERATION_PATTERN.exec(name);
    if (match === null)
        return undefined;
    const teamId = match[1] ?? '';
    if (teamId === '')
        return undefined;
    return { archiveId: name, teamId, archivedAt: Number(match[2]) };
}
/**
 * Generation index cache (`archive/index.json`, GR-03). The directory scan
 * stays authoritative: a missing or corrupt index degrades to an empty list
 * and is rebuilt by the next archive append.
 */
async function readArchiveIndex(archiveRoot) {
    try {
        const raw = await readFile(join(archiveRoot, 'index.json'), 'utf8');
        const value = JSON.parse(stripLeadingBom(raw));
        if (!isRecord(value) || !Array.isArray(value['generations']))
            return [];
        return value['generations'].filter((entry) => isRecord(entry)
            && typeof entry['archiveId'] === 'string' && entry['archiveId'] !== ''
            && typeof entry['teamId'] === 'string' && entry['teamId'] !== ''
            && isFiniteNumber(entry['archivedAt'])
            && (entry['phase'] === undefined || typeof entry['phase'] === 'string'));
    }
    catch {
        return [];
    }
}
/** Rewrite the generation index under its own lock (best-effort cache, GR-03). */
async function writeArchiveIndex(archiveRoot, generations) {
    await atomicWriteText(join(archiveRoot, 'index.json'), `${JSON.stringify({ version: 1, generations }, null, 2)}\n`);
}
/**
 * Archive a team instead of deleting it: the whole directory (team.json with
 * tasks and dependency graph, plus the mailboxes) moves under
 * `<stateRoot>/archive/` for later review. GR-03: every archive lands in an
 * immutable generation directory `<teamId>__<epochMs>_<random6>` — same-name
 * teams never overwrite or displace previous generations, and no previous
 * generation is ever physically deleted (`rm(previous)` is abolished). The
 * generation index (`archive/index.json`) is appended best-effort; the
 * directory scan stays authoritative.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @returns the new generation id (`archiveId`).
 */
export async function archiveTeamDir(stateRoot, teamId) {
    const archiveRoot = join(stateRoot, 'archive');
    await mkdir(archiveRoot, { recursive: true });
    const source = join(stateRoot, teamId);
    // Snapshot generation metadata before the move so the index describes what
    // was archived even if the record is later inspected or purged.
    const team = await readTeam(stateRoot, teamId).catch(() => undefined);
    const archiveId = `${teamId}__${Date.now()}_${archiveGenerationSuffix()}`;
    const target = join(archiveRoot, archiveId);
    // XR-05: the move is bounded by a total timeout; a lock-blocked move
    // throws the typed ArchiveResourceLockedError and leaves the source team
    // exactly where it was (still `cancelling`, resumable).
    await renameWithRetry(source, target);
    const meta = {
        archiveId,
        teamId,
        archivedAt: Date.now(),
        ...(team?.phase !== undefined ? { phase: team.phase } : {}),
        memberCount: team?.members.length ?? 0,
        taskCount: team?.tasks.length ?? 0,
    };
    await withTeamLock(`archive-index:${archiveRoot}`, async () => {
        const generations = await readArchiveIndex(archiveRoot);
        generations.push(meta);
        await writeArchiveIndex(archiveRoot, generations);
    }).catch(() => undefined);
    return archiveId;
}
/**
 * List every archive generation on disk, newest first (GR-03). The scan is
 * the authoritative source of generations; `archive/index.json` only adds
 * display metadata via {@link readArchiveIndex}.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - restrict to one team's generations, when given.
 */
export async function listArchivedTeamGenerations(stateRoot, teamId) {
    let entries;
    try {
        entries = await readdir(join(stateRoot, 'archive'), { withFileTypes: true });
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const generations = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.'))
            continue;
        const generation = parseArchiveGeneration(entry.name);
        if (generation === undefined)
            continue;
        if (teamId !== undefined && generation.teamId !== teamId)
            continue;
        generations.push(generation);
    }
    generations.sort((a, b) => b.archivedAt - a.archivedAt);
    return generations;
}
/**
 * Read one archived team's newest generation, or its legacy pre-generation
 * `archive/<teamId>` directory; undefined when it was never archived.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export async function readArchivedTeam(stateRoot, teamId, archiveId) {
    if (archiveId !== undefined) {
        const refs = await listArchivedTeamGenerations(stateRoot, teamId);
        if (!refs.some(ref => ref.archiveId === archiveId) && archiveId !== teamId)
            return undefined;
        const directory = join(stateRoot, 'archive', archiveId);
        try {
            const primary = await readTeamRecordFrom(directory, teamId);
            if (primary !== undefined)
                return primary;
        }
        catch (error) {
            const backup = await readTeamRecordFrom(directory, teamId, 'team.json.bak');
            if (backup !== undefined)
                return backup;
            throw error;
        }
        return readTeamRecordFrom(directory, teamId, 'team.json.bak');
    }
    const archiveRoot = join(stateRoot, 'archive');
    for (const generation of await listArchivedTeamGenerations(stateRoot, teamId)) {
        // The record inside keeps its original team id; the generation directory
        // name only namespaces it (GR-03).
        const state = await readArchivedTeam(stateRoot, teamId, generation.archiveId);
        if (state !== undefined)
            return state;
    }
    return readTeamRecordFrom(join(archiveRoot, teamId), teamId);
}
/**
 * List every archived team id under the state root: one id per team, taken
 * from generation directories and legacy pre-generation archives alike.
 * @param stateRoot - resolved absolute state root directory.
 * @returns the archived team ids, empty when the archive does not exist.
 */
export async function listArchivedTeamIds(stateRoot) {
    let entries;
    try {
        entries = await readdir(join(stateRoot, 'archive'), { withFileTypes: true });
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const ids = new Set();
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.'))
            continue;
        const generation = parseArchiveGeneration(entry.name);
        ids.add(generation?.teamId ?? entry.name);
    }
    return [...ids].sort();
}
/** Team ids are sanitized directory names; anything else is refused before it
 * can become a path. */
const ARCHIVE_TEAM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/**
 * Permanently delete one archived team's history — every GR-03 generation
 * directory of the team plus its legacy pre-generation `archive/<teamId>`
 * directory when present. Only `<stateRoot>/archive/` entries are ever
 * touched, and only after every guard passes: the id must be a plain
 * directory-name component (no traversal, no hidden component), a live team
 * with the same id must not exist, and every archive entry to remove must be
 * a real directory rather than a reparse point, so a forged archive entry
 * cannot make this delete somebody else's data. Each purge is appended to
 * `archive/.purge-log.jsonl` and the generation index is rebuilt from the
 * remaining directories (the scan stays authoritative).
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the archived team id.
 * @param meta - who authorized the purge (captain identity, for the log).
 */
export async function purgeArchivedTeam(stateRoot, teamId, meta) {
    if (typeof teamId !== 'string' || !ARCHIVE_TEAM_ID_PATTERN.test(teamId) || teamId.includes('..')) {
        throw new Error(`invalid archived team id ${JSON.stringify(teamId)}; refusing to purge`);
    }
    const live = await lstat(join(stateRoot, teamId)).then(() => true, (error) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            return false;
        throw error;
    });
    if (live) {
        throw new Error(`team "${teamId}" is still an active team; end and archive it before deleting its history`);
    }
    const archiveRoot = join(stateRoot, 'archive');
    const targets = (await listArchivedTeamGenerations(stateRoot, teamId)).map(ref => ref.archiveId);
    const legacy = join(archiveRoot, teamId);
    if (await lstat(legacy).then(() => true, () => false))
        targets.push(teamId);
    if (targets.length === 0) {
        const candidates = await listArchivedTeamIds(stateRoot);
        throw new Error(`no archived team "${teamId}"; archived teams: ${candidates.length > 0 ? candidates.join(', ') : '(none)'}`);
    }
    let entries = 0;
    for (const target of targets) {
        const directory = join(archiveRoot, target);
        const stat = await lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
            throw new Error(`archive entry "${target}" is not a plain directory (reparse point or file); refusing to purge through it`);
        }
        entries += await readdir(directory).then(items => items.length, () => 0);
    }
    for (const target of targets) {
        await rm(join(archiveRoot, target), { recursive: true, force: false });
    }
    // Best-effort index rebuild from the surviving directories (GR-03: the
    // scan stays authoritative, so a failed rewrite only costs display meta).
    await withTeamLock(`archive-index:${archiveRoot}`, async () => {
        const remaining = [];
        for (const ref of await listArchivedTeamGenerations(stateRoot)) {
            const record = await readArchivedTeam(stateRoot, ref.teamId, ref.archiveId).catch(() => undefined);
            remaining.push({
                archiveId: ref.archiveId,
                teamId: ref.teamId,
                archivedAt: ref.archivedAt,
                ...(record?.phase !== undefined ? { phase: record.phase } : {}),
                memberCount: record?.members.length ?? 0,
                taskCount: record?.tasks.length ?? 0,
            });
        }
        await writeArchiveIndex(archiveRoot, remaining);
    }).catch(() => undefined);
    await mkdir(archiveRoot, { recursive: true });
    await appendFile(join(archiveRoot, '.purge-log.jsonl'), `${JSON.stringify({ teamId, at: Date.now(), by: meta.by, entries, targets })}\n`, 'utf8');
    return { teamId, purged: true, entries };
}
/**
 * The visual state of one task: `claimed` after assignment, `running` only
 * after the explicit in_progress update, `completed`
 * when done, `failed`/`cancelled` when terminal without success, `blocked`
 * while any dependency is unfinished, else `open`.
 */
export function taskVisualState(status, dependencies, tasks) {
    if (status === 'completed')
        return 'completed';
    if (status === 'failed')
        return 'failed';
    if (status === 'cancelled')
        return 'cancelled';
    if (status === 'in_progress')
        return 'running';
    if (status === 'claimed')
        return 'claimed';
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const openDependency = dependencies.some((dependencyId) => {
        const dependency = byId.get(dependencyId);
        return dependency !== undefined && dependency.status !== 'completed';
    });
    return openDependency ? 'blocked' : 'open';
}
/**
 * Longest dependency path depth per task id (each depth = one lane column).
 */
export function taskDepthsById(tasks) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const depths = new Map();
    const visiting = new Set();
    const depthOf = (taskId) => {
        const cached = depths.get(taskId);
        if (cached !== undefined)
            return cached;
        if (visiting.has(taskId))
            return 0;
        const task = byId.get(taskId);
        if (task === undefined)
            return 0;
        visiting.add(taskId);
        const dependencies = task.dependencies
            .filter((dependencyId) => byId.has(dependencyId))
            .sort();
        const depth = dependencies.length === 0
            ? 0
            : 1 + Math.max(...dependencies.map(depthOf));
        visiting.delete(taskId);
        depths.set(taskId, depth);
        return depth;
    };
    for (const task of tasks)
        depthOf(task.id);
    return depths;
}
/**
 * GR-02 crash recovery: finish the archive step for every live team stuck in
 * `phase='cancelling'` — the delete state machine writes that phase to disk
 * before doing its off-lock work, so a crash between the mark and the
 * archive move would otherwise leave an undeletable ghost team forever.
 * Runs at boot (before deferred-task rescans); each candidate is re-checked
 * under its own team lock, and teams whose archive move stays
 * resource-locked (XR-05) are left in `cancelling` for the next boot or an
 * explicit retry rather than corrupting history.
 * @param stateRoot - resolved absolute state root directory.
 * @returns ids of teams whose archive was completed by this pass.
 */
export async function resumeCancellingTeams(stateRoot, resume) {
    let entries;
    try {
        entries = await readdir(stateRoot, { withFileTypes: true });
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const resumed = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'archive')
            continue;
        const teamId = entry.name;
        const team = await readTeam(stateRoot, teamId).catch(() => undefined);
        if (team?.phase !== 'cancelling' || isCancellingInFlight(stateRoot, teamId))
            continue;
        if (resume !== undefined) {
            try {
                await resume(team);
                resumed.push(teamId);
            }
            catch (error) {
                console.warn(`[agent-teams] resume of "${teamId}" failed: ${String(error)}`);
            }
            continue;
        }
        await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
            // Re-read under the lock: a concurrent delete may have finished or
            // advanced the team between the directory scan and here.
            const fresh = await readTeam(stateRoot, teamId).catch(() => undefined);
            if (fresh?.phase !== 'cancelling' || isCancellingInFlight(stateRoot, teamId))
                return;
            try {
                await recordRetiredMemberIds(stateRoot, fresh.members.map(member => member.id));
                await archiveTeamDir(stateRoot, teamId);
                resumed.push(teamId);
            }
            catch (error) {
                // XR-05 archive_busy and other transient failures keep the team in
                // `cancelling`; history is intact and the next boot retries.
                console.warn(`[agent-teams] resume of cancelling team "${teamId}" failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
    return resumed;
}
