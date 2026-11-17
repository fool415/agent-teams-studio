/**
 * Channel catalog and dispatch gating (Pure CPA + Antigravity / Codex).
 * All DS (DeepSeek/WorkBuddy) and ZCode (zai-coding-cn/GLM) channels have been removed.
 * @module dsh-agent-teams/channel-policy
 */
export const CHANNEL_CATALOG = [
    {
        id: 'cliproxyapi',
        label: 'EasyCLIProxyAPI (CPA Local Gateway)',
        costTier: 'standard',
        peakHoursUTC8: [],
        quota: 'known',
        transport: 'local-gateway',
        notes: 'Primary multi-model local gateway (gpt-6.1-sol, gpt-6-sol, gpt-5.6-sol, gemini-3.8-flash, etc.).',
    },
    {
        id: 'antigravity',
        label: 'Google Antigravity (Gemini 3.8 Flash / Pro · 哈吉米)',
        costTier: 'budget',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'Primary UI aesthetics (审美官), report writing (报告撰稿官), research and L3 red-team supervision channel with Hajimi persona.',
    },
    {
        id: 'codex',
        label: 'OpenAI Codex',
        costTier: 'standard',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'White-box self-healing review channel.',
    },
    {
        id: 'openai-codex',
        label: 'OpenAI Codex (ChatGPT captain)',
        costTier: 'standard',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'Subscription plan; no time-of-day price difference known.',
    },
];

export const DEFAULT_DISPATCH_POLICY = {
    deferPeakForTiers: ['standard', 'premium', 'budget'],
    exemptKinds: ['verification', 'review', 'requirements', 'integration'],
    maxDeferRetries: 6,
    maxArmDelayMs: 60 * 60 * 1000,
    timezoneOffsetMinutes: 480,
    budgetAuthorizations: [
        { provider: 'cliproxyapi', limit: 1000000, unit: 'requests', version: 'v1' },
        { provider: 'antigravity', limit: 1000000, unit: 'requests', version: 'v1' },
        { provider: 'codex', limit: 1000000, unit: 'requests', version: 'v1' },
        { provider: 'openai-codex', limit: 1000000, unit: 'requests', version: 'v1' },
    ],
};

export function channelFamilyOf(provider, policy = DEFAULT_DISPATCH_POLICY) {
    if (provider == null || provider === '')
        return undefined;
    const family = provider.split('/', 1)[0] ?? provider;
    const catalog = policy.channelCatalog ?? CHANNEL_CATALOG;
    return catalog.find(entry => entry.id === provider) ?? catalog.find(entry => entry.id === family);
}

export function isLocalBudgetExempt(family, approvalMode) {
    return family?.transport === 'local-gateway' && approvalMode === 'never';
}

export function describeChannel(provider) {
    return channelFamilyOf(provider);
}

export function isExemptKind(kind, policy = DEFAULT_DISPATCH_POLICY) {
    if (kind === undefined || kind === '')
        return false;
    return policy.exemptKinds.includes(kind);
}

export function isTrustedBudgetAuthorization(auth, now) {
    if (typeof auth !== 'object' || auth === null)
        return false;
    const candidate = auth;
    if (typeof candidate.provider !== 'string' || candidate.provider.trim() === '')
        return false;
    if (typeof candidate.limit !== 'number' || !Number.isFinite(candidate.limit) || candidate.limit <= 0)
        return false;
    if (typeof candidate.unit !== 'string' || candidate.unit.trim() === '')
        return false;
    if (candidate.validUntil === undefined && candidate.version === undefined)
        return false;
    if (!Number.isFinite(now))
        return false;
    if (candidate.validUntil !== undefined && (typeof candidate.validUntil !== 'number' || !Number.isFinite(candidate.validUntil) || candidate.validUntil <= now))
        return false;
    if (candidate.version !== undefined && (typeof candidate.version !== 'string' || candidate.version.trim() === ''))
        return false;
    return true;
}

export function matchingBudgetAuthorization(policy, family, provider, now) {
    const auths = policy.budgetAuthorizations ?? [];
    return auths.find(auth => isTrustedBudgetAuthorization(auth, now)
        && (auth.provider === family.id || auth.provider === provider || (provider != null && provider !== '' && auth.provider === provider.split('/', 1)[0])));
}

function hasTrustedBudgetAuthorization(policy, family, provider, now) {
    return matchingBudgetAuthorization(policy, family, provider, now) !== undefined;
}

function localParts(now, offsetMinutes) {
    const shifted = new Date(now + offsetMinutes * 60_000);
    return { hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes(), weekday: shifted.getUTCDay() === 0 ? 7 : shifted.getUTCDay() };
}

function inPeakWindow(now, family, policy) {
    const { hour, minute, weekday } = localParts(now, policy.timezoneOffsetMinutes);
    const clock = hour + minute / 60;
    for (const window of family.peakHoursUTC8) {
        if (!window.weekdays.includes(weekday))
            continue;
        if (clock >= window.startHour && clock < window.endHour)
            return window;
    }
    return undefined;
}

function windowEndsAt(now, window, policy) {
    const local = new Date(now + policy.timezoneOffsetMinutes * 60_000);
    const localEnd = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), window.endHour, 0, 0, 0);
    return localEnd - policy.timezoneOffsetMinutes * 60_000;
}

export function evaluateDispatch(query) {
    const policy = query.policy ?? DEFAULT_DISPATCH_POLICY;
    if (isExemptKind(query.kind, policy))
        return { action: 'dispatch' };
    const family = channelFamilyOf(query.provider, policy);
    if (isLocalBudgetExempt(family, query.approvalMode))
        return { action: 'dispatch' };
    if (family === undefined) {
        return {
            action: 'hold',
            reason: `provider ${query.provider == null || query.provider === '' ? '(none)' : query.provider} is not a known channel; long work holds instead of dispatching an unclassified route`,
        };
    }
    const retries = query.deferRetries ?? 0;
    if (family.quota === 'unknown') {
        return {
            action: 'hold',
            reason: `channel ${family.id} has an unknown request quota; long work holds until a trusted quota/budget update or human authorization`,
        };
    }
    if (!hasTrustedBudgetAuthorization(policy, family, query.provider, query.now)) {
        return {
            action: 'hold',
            reason: `channel ${family.id} has no trusted bounded budget authorization; long work holds until a runtime budget authorization with a positive finite limit, unit and validity is supplied`,
        };
    }
    if (retries >= policy.maxDeferRetries) {
        return {
            action: 'hold',
            reason: `channel ${family.id} exhausted ${policy.maxDeferRetries} defers for this task; holding instead of failing open past the bound`,
        };
    }
    const window = inPeakWindow(query.now, family, policy);
    if (window === undefined || !policy.deferPeakForTiers.includes(family.costTier))
        return { action: 'dispatch' };
    const until = windowEndsAt(query.now, window, policy);
    return {
        action: 'defer',
        until: Math.max(until, query.now + 1),
        retry: retries + 1,
        reason: `channel ${family.id} is in its weekday peak window (${window.startHour}:00-${window.endHour}:00 UTC+8); deferring to the off-peak price`,
    };
}
