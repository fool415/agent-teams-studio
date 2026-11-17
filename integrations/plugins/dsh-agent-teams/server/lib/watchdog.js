import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readTeam, writeTeam, withTeamLock, teamLockKey, invalidateTaskAttempt } from "./state.js";
export function stateRootOf(workspace, config) {
    return join(workspace, config?.stateDir ?? '.agent-teams');
}
export function unsatisfiedDeps(tasks, deps) {
    return (deps ?? []).filter(id => tasks.find(task => task.id === id)?.status !== 'completed');
}
export const DEFAULT_STALL_THRESHOLD_MS = 5 * 60 * 1000;
export const DEFAULT_WATCHDOG_INTERVAL_MS = 20 * 1000;
export const DEFAULT_READY_TIMEOUT_MS = 30 * 1000;
/** Initial dispatch plus at most one automatic retry/fallback, shared across restarts. */
export const DEFAULT_MAX_AUTOMATIC_ATTEMPTS = 2;
// Process-local only: restart loses suspicion, never accelerates a destructive recovery.
const absentOwners = new Map();
export async function inspectAndHealTeam(stateRoot, teamId, options = {}) {
    if (teamId !== teamId.toLowerCase())
        throw new Error('CASE_COLLISION: watchdog team id must be lowercase');
    const now = options.now ?? Date.now();
    const threshold = options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
    const readyTimeout = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    const prefix = `${resolve(stateRoot)}\u0000${teamId}\u0000`;
    return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const team = await readTeam(stateRoot, teamId);
        if (team !== undefined)
            await options.authorize?.(team);
        const actions = [], diagnostics = [];
        let modified = false, blocked = false, attention = false, healedCount = 0, needsKick = false;
        const report = (status) => ({
            teamId, timestamp: now, status, healedCount, needsKick, actions, diagnostics,
            summary: `[Watchdog ${status}] 团队 "${teamId}"：已持久化恢复 ${healedCount} 项；调度请求 ${needsKick ? '待执行（非成功证明）' : '无'}。${diagnostics.length ? '\n' + diagnostics.join('\n') : ' 未发现已确认异常。'}`,
        });
        if (team === undefined || team.halted === true || team.phase !== 'running' || team.restoredFrom !== undefined) {
            for (const key of absentOwners.keys())
                if (key.startsWith(prefix))
                    absentOwners.delete(key);
            diagnostics.push('跳过 skipped：团队不存在、已暂停 halted、非运行阶段或为只读恢复副本。');
            return report('skipped');
        }
        const observedKeys = new Set();
        for (const task of team.tasks) {
            const key = prefix + task.id;
            if (!['pending', 'claimed', 'in_progress'].includes(task.status))
                continue;
            if (task.holdReason !== undefined) {
                blocked = true;
                diagnostics.push(`${task.id}: blocked/hold 挂起：${task.holdReason}；须由授权恢复路径处理。`);
                continue;
            }
            const member = team.members.find(candidate => candidate.name === task.assignee && candidate.status !== 'removed');
            if (task.assignee !== undefined && task.assignee !== 'captain' && member === undefined) {
                blocked = true;
                diagnostics.push(`${task.id}: blocked 成员不存在或已移除；需要队长重派。`);
                continue;
            }
            if (task.status === 'claimed' || task.status === 'in_progress') {
                const activity = member === undefined ? 'unknown' : options.activityOf?.(member) ?? 'unknown';
                if (member === undefined || options.isParked?.(member, task) || activity !== 'absent') {
                    absentOwners.delete(key);
                    if (activity !== 'running' || now - task.updatedAt > threshold) {
                        attention = true;
                        diagnostics.push(`${task.id}: ${activity}，保留 attempt；无持续失联证据，不能仅凭任务时间戳误杀。`);
                    }
                    continue;
                }
                observedKeys.add(key);
                const fingerprint = `${member.id}\u0000${task.attemptId ?? ''}\u0000${task.attempt ?? 0}\u0000${task.updatedAt}`;
                let observation = absentOwners.get(key);
                // An interrupted scanner cannot claim continuous observation across an arbitrary gap.
                if (observation === undefined || observation.fingerprint !== fingerprint || now < observation.seen || now - observation.seen > Math.max(threshold, DEFAULT_WATCHDOG_INTERVAL_MS * 3)) {
                    observation = { fingerprint, since: now, seen: now };
                    absentOwners.set(key, observation);
                }
                observation.seen = now;
                if (now - observation.since < threshold || now - task.updatedAt < threshold) {
                    attention = true;
                    diagnostics.push(`${task.id}: absent，持续观测失联中，尚未达到恢复窗口。`);
                    continue;
                }
                const previous = task.assignee;
                if ((task.attempt ?? 0) >= DEFAULT_MAX_AUTOMATIC_ATTEMPTS) {
                    // Keep the last output/evidence and capability for an explicit captain decision.
                    task.holdReason = `watchdog retry limit reached (${DEFAULT_MAX_AUTOMATIC_ATTEMPTS} attempts); captain intervention required`;
                    task.updatedAt = now;
                    blocked = true;
                    actions.push({ taskId: task.id, taskSubject: task.subject, action: 'retry_exhausted', reason: task.holdReason, timestamp: now });
                }
                else {
                    const fallback = member.fallback;
                    const target = fallback === undefined ? undefined : team.members.find(candidate => candidate.status !== 'removed'
                        && candidate.name !== member.name && candidate.provider === fallback.provider && candidate.model === fallback.model
                        && !team.tasks.some(other => other.assignee === candidate.name && (other.status === 'claimed' || other.status === 'in_progress')));
                    invalidateTaskAttempt(task, target?.name ?? previous, false);
                    task.updatedAt = now;
                    needsKick = true;
                    healedCount++;
                    actions.push({ taskId: task.id, taskSubject: task.subject, action: target ? 'reassigned_fallback' : 'reassigned_retry',
                        fromAssignee: previous, toAssignee: task.assignee, reason: '连续观测到真实 driver 缺失且任务无更新，已有界回收；后续执行尚待调度验证。', timestamp: now });
                }
                diagnostics.push(`${task.id}: ${actions[actions.length - 1].reason}`);
                modified = true;
                absentOwners.delete(key);
                continue;
            }
            const unmet = unsatisfiedDeps(team.tasks, task.dependencies);
            if (unmet.length > 0) {
                blocked = true;
                diagnostics.push(`${task.id}: blocked，未完成依赖 ${unmet.join(', ')}。`);
            }
            else if ((task.deferredUntil ?? 0) > now) {
                attention = true;
                diagnostics.push(`${task.id}: deferred 至 ${task.deferredUntil}；保留门禁。`);
            }
            else if (now - task.updatedAt > readyTimeout) {
                attention = true;
                if (task.assignee === 'captain') {
                    diagnostics.push(`${task.id}: 等待队长执行，不自动派给成员。`);
                }
                else {
                    needsKick = true;
                    actions.push({ taskId: task.id, taskSubject: task.subject, action: 'kicked_ready', reason: '请求调度唤醒；尚未证明成功执行。', timestamp: now });
                    diagnostics.push(`${task.id}: ready，已请求调度（非修复成功证明）。`);
                }
            }
        }
        for (const key of absentOwners.keys())
            if (key.startsWith(prefix) && !observedKeys.has(key))
                absentOwners.delete(key);
        if (modified)
            await writeTeam(stateRoot, team);
        return report(blocked ? 'blocked' : healedCount > 0 ? 'repaired' : attention ? 'attention' : 'healthy');
    });
}
/** One serialized scanner for registered roots, live session roots and headless cwd. */
export function startTeamWatchdogDaemon(ctx, scheduler, config, intervalMs = DEFAULT_WATCHDOG_INTERVAL_MS, hooks = {}) {
    let stopped = false, scanning = false;
    const inspectTeam = (workspace, teamId, options = {}) => inspectAndHealTeam(stateRootOf(workspace, config), teamId, {
        ...options, ...hooks,
        activityOf: member => {
            const agent = ctx.agents.get(member.id);
            return agent === undefined ? 'absent' : agent.status === 'running' ? 'running' : 'idle';
        },
    });
    const scan = async () => {
        if (stopped || scanning)
            return;
        scanning = true;
        try {
            const registry = (ctx.get('workspaceRegistry') ?? ctx.get('workspace'));
            const roots = new Map();
            const add = (path) => {
                const resolved = resolve(path);
                roots.set(process.platform === 'win32' ? resolved.toLowerCase() : resolved, resolved);
            };
            add(process.cwd());
            for (const workspace of registry?.list() ?? [])
                add(workspace.path);
            for (const agent of ctx.agents.list())
                if (agent.session.header.cwd)
                    add(agent.session.header.cwd);
            for (const workspace of roots.values()) {
                if (stopped)
                    break;
                let entries;
                try {
                    entries = await readdir(stateRootOf(workspace, config), { withFileTypes: true });
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        ctx.logger.warn(`[Watchdog] Cannot scan ${workspace}: ${String(error)}`);
                    continue;
                }
                for (const entry of entries) {
                    if (stopped)
                        break;
                    if (!entry.isDirectory() || entry.name === 'archive' || entry.name.startsWith('.'))
                        continue;
                    try {
                        const result = await inspectTeam(workspace, entry.name);
                        if (stopped)
                            break;
                        if (result.actions.length > 0)
                            ctx.logger.info(result.summary);
                        // No team lock is held during scheduling: avoid recursive lock deadlocks.
                        if (result.needsKick)
                            await scheduler.kickTeam(workspace, entry.name);
                    }
                    catch (error) {
                        ctx.logger.warn(`[Watchdog] Error inspecting ${workspace}/${entry.name}: ${String(error)}`);
                    }
                }
            }
        }
        catch (error) {
            ctx.logger.warn(`[Watchdog] Cycle error: ${String(error)}`);
        }
        finally {
            scanning = false;
        }
    };
    const timer = setInterval(() => { void scan(); }, intervalMs);
    timer.unref();
    return { scan, inspectTeam, stop() { stopped = true; clearInterval(timer); } };
}
