/**
 * RolePriorityPolicy & Dynamic Preemption Scheduler.
 *
 * Pure CPA + Antigravity (Hajimi) + Codex priority queues.
 * @module dsh-agent-teams/role-priority
 */
export const DEFAULT_ROLE_PRIORITIES = {
    captain: [
        'cliproxyapi/gpt-6.1-sol',
        'antigravity/gemini-3.8-flash-tiered',
        'antigravity/hydrogen',
        'codex/gpt-6.1-sol',
    ],
    architect: [
        'antigravity/hydrogen',
        'cliproxyapi/gpt-6.1-sol',
        'antigravity/gemini-3.8-flash-tiered',
        'codex/gpt-6.1-sol',
    ],
    designer: [
        'antigravity/gemini-3.8-flash-tiered',
        'antigravity/gemini-3.8-flash-high',
        'antigravity/hydrogen',
        'cliproxyapi/gpt-6.1-sol',
    ],
    'ui-aesthetics': [
        'antigravity/gemini-3.8-flash-tiered',
        'antigravity/gemini-3.8-flash-high',
        'antigravity/hydrogen',
    ],
    'doc-writer': [
        'antigravity/gemini-3.8-flash-tiered',
        'antigravity/gemini-3.8-flash-high',
        'antigravity/hydrogen',
        'cliproxyapi/gpt-6.1-sol',
    ],
    reviewer: [
        'cliproxyapi/gpt-6.1-sol',
        'antigravity/hydrogen',
        'antigravity/gemini-3.8-flash-tiered',
        'codex/gpt-6.1-sol',
    ],
    researcher: [
        'antigravity/gemini-3.8-flash-tiered',
        'antigravity/hydrogen',
        'antigravity/gemini-3.8-flash-low',
    ],
};
export function validateRolePriorities(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input))
        throw new Error('rolePriorities must be a role-to-route map');
    const result = Object.create(null);
    for (const [role, routes] of Object.entries(input)) {
        if (role.trim() === '' || role !== role.trim() || ['__proto__', 'constructor', 'prototype', 'toString'].includes(role))
            throw new Error(`invalid priority role: ${role}`);
        if (!Array.isArray(routes) || routes.length === 0 || routes.some(route => typeof route !== 'string' || !/^[^/\s]+\/\S+$/.test(route)) || new Set(routes).size !== routes.length) {
            throw new Error(`role ${role} requires a non-empty unique provider/model queue`);
        }
        result[role] = [...routes];
    }
    return result;
}
export class RolePriorityScheduler {
    healthMap = new Map();
    customPriorities;
    probes = new Map();
    constructor(custom = {}) {
        this.customPriorities = validateRolePriorities(custom);
    }
    setRolePriorities(role, priorities) {
        const validated = validateRolePriorities({ [role]: priorities });
        this.customPriorities[role] = validated[role];
    }
    getRolePriorities(role) {
        const list = this.customPriorities[role] ?? (Object.hasOwn(DEFAULT_ROLE_PRIORITIES, role) ? DEFAULT_ROLE_PRIORITIES[role] : undefined);
        return [...list ?? []];
    }
    markModelFailure(modelRoute, cooldownDurationMs = 60000, error, now = Date.now()) {
        if (!Number.isFinite(now) || !Number.isFinite(cooldownDurationMs) || cooldownDurationMs < 0 || !Number.isFinite(now + cooldownDurationMs))
            throw new Error('invalid model cooldown');
        this.healthMap.set(modelRoute, { healthy: false, cooldownUntilMs: now + cooldownDurationMs, lastError: error });
    }
    markModelHealthy(modelRoute) {
        this.healthMap.set(modelRoute, { healthy: true, cooldownUntilMs: 0 });
    }
    /** Availability permits a trial after cooldown, not proof that a remote API is healthy. */
    isModelAvailable(modelRoute, now = Date.now()) {
        if (!Number.isFinite(now))
            return false;
        const entry = this.healthMap.get(modelRoute);
        return entry === undefined || entry.healthy || now >= entry.cooldownUntilMs;
    }
    resolveActiveModel(role, now = Date.now()) {
        return this.getRolePriorities(role).find(model => this.isModelAvailable(model, now));
    }
    checkPreemption(role, currentModel, now = Date.now()) {
        const queue = this.getRolePriorities(role);
        const index = queue.indexOf(currentModel);
        const higher = index < 0 ? queue : queue.slice(0, index);
        const candidate = higher.find(model => this.isModelAvailable(model, now));
        return candidate === undefined
            ? { shouldPreempt: false, preemptToModel: currentModel }
            : { shouldPreempt: true, preemptToModel: candidate, reason: `Higher priority model ${candidate} is eligible for a recovery trial` };
    }
    /** Single-flight metadata probes; a late success must not overwrite a newer failure. */
    async probeHigherPriority(role, currentModel, probe, now = Date.now()) {
        const queue = this.getRolePriorities(role);
        const index = queue.indexOf(currentModel);
        for (const candidate of index < 0 ? queue : queue.slice(0, index)) {
            if (!this.isModelAvailable(candidate, now))
                continue;
            let pending = this.probes.get(candidate);
            if (pending === undefined) {
                const previous = this.healthMap.get(candidate);
                pending = Promise.resolve().then(() => probe(candidate)).catch(() => false).then(healthy => {
                    if (this.healthMap.get(candidate) !== previous)
                        return false;
                    if (healthy)
                        this.markModelHealthy(candidate);
                    else
                        this.markModelFailure(candidate, 60000, 'route metadata probe failed', now);
                    return healthy;
                }).finally(() => { this.probes.delete(candidate); });
                this.probes.set(candidate, pending);
            }
            if (await pending && this.isModelAvailable(candidate, now))
                return candidate;
        }
        return undefined;
    }
}
