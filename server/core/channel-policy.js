/**
 * Channel catalog and dispatch gating for cost-aware execution.
 *
 * Pure CPA + Antigravity (Hajimi) + Codex + Anthropic channel catalog.
 * All legacy DS / ZCode channels have been permanently removed.
 * @module dsh-agent-teams/channel-policy
 */
export const CHANNEL_CATALOG = [
    {
        id: 'cliproxyapi',
        label: 'EasyCLIProxyAPI (CPA)',
        costTier: 'standard',
        peakHoursUTC8: [],
        quota: 'known',
        transport: 'local-gateway',
        notes: 'Primary local unified gateway for GPT-6.1-Sol and Claude.',
    },
    {
        id: 'antigravity',
        label: 'Google Antigravity (Gemini · 哈吉米)',
        costTier: 'budget',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'Primary front-end, UI aesthetics (Hajimi), documentation, review and reasoning channel.',
    },
    {
        id: 'codex',
        label: 'OpenAI Codex',
        costTier: 'standard',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'White-box self-healing review and engineering channel.',
    },
    {
        id: 'openai-codex',
        label: 'OpenAI Codex (ChatGPT captain)',
        costTier: 'standard',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'Subscription plan; no time-of-day price difference known.',
    },
    {
        id: 'anthropic',
        label: 'Anthropic Official',
        costTier: 'standard',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'Claude official engineering and architecture channel.',
    },
    {
        id: 'dsh',
        label: 'DSH AgentTeams Native',
        costTier: 'standard',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'DSH native multi-agent compatible channel.',
    },
    {
        id: 'deepseek',
        label: 'DeepSeek (深度求索 / DeepSeek Harness)',
        costTier: 'budget',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'DeepSeek-V3 (deepseek-chat) and DeepSeek-R1 (deepseek-reasoner) & DeepSeek Harness channel.',
    },
    {
        id: 'deepseek-harness',
        label: 'DeepSeek Harness (多智能体工程套件)',
        costTier: 'budget',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'DeepSeek Harness multi-agent engineering workflow channel.',
    },
    {
        id: 'qwen',
        label: 'Alibaba Qwen (通义千问 / 百炼 DashScope)',
        costTier: 'budget',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'Qwen3-Max, Qwen-Coder-Plus and Wanx visual generation channel.',
    },
    {
        id: 'zhipu',
        label: 'Zhipu GLM (智谱清言 / BigModel)',
        costTier: 'budget',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'GLM-4.5, GLM-Zero-Preview and CogView-4 channel.',
    },
    {
        id: 'kimi',
        label: 'Moonshot Kimi (月之暗面)',
        costTier: 'standard',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'Kimi-K2 and Moonshot long-context engineering channel.',
    },
    {
        id: 'doubao',
        label: 'ByteDance Doubao (字节豆包 / 火山方舟)',
        costTier: 'budget',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'Doubao-1.5-Pro and Volcengine Ark models channel.',
    },
    {
        id: 'siliconflow',
        label: 'SiliconFlow (硅基流动国内聚合)',
        costTier: 'budget',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'SiliconFlow domestic open-weights & reasoning aggregation gateway.',
    },
    {
        id: 'ollama',
        label: 'Ollama / Local LLM',
        costTier: 'budget',
        peakHoursUTC8: [],
        quota: 'known',
        transport: 'local-gateway',
        notes: 'Local self-hosted LLM gateway.',
    },
    {
        id: 'grok',
        label: 'xAI Grok / Grok-Build (实时深搜与编码中枢)',
        costTier: 'standard',
        peakHoursUTC8: [],
        quota: 'known',
        notes: 'xAI Grok-3 / Grok-3-Mini / xai-org/grok-build agent harness and real-time fact-checking bot.',
    },
    {
        id: 'google',
        label: 'Google Gemini free tier',
        costTier: 'budget',
        peakHoursUTC8: [],
        quota: 'unknown',
        dataGovernance: {
            freeTierUsedToImprove: true,
            paidTierUsedToImprove: false,
            source: 'https://ai.google.dev/gemini-api/docs/pricing',
        },
        notes: 'Free tier content may be used to improve Google products; project code must not flow through the free tier.',
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
        { provider: 'anthropic', limit: 1000000, unit: 'requests', version: 'v1' },
        { provider: 'dsh', limit: 1000000, unit: 'requests', version: 'v1' },
        { provider: 'deepseek', limit: 1000000, unit: 'requests', version: 'v1' },
        { provider: 'deepseek-harness', limit: 1000000, unit: 'requests', version: 'v1' },
        { provider: 'qwen', limit: 1000000, unit: 'requests', version: 'v1' },
        { provider: 'zhipu', limit: 1000000, unit: 'requests', version: 'v1' },
        { provider: 'kimi', limit: 1000000, unit: 'requests', version: 'v1' },
        { provider: 'doubao', limit: 1000000, unit: 'requests', version: 'v1' },
        { provider: 'siliconflow', limit: 1000000, unit: 'requests', version: 'v1' },
        { provider: 'ollama', limit: 1000000, unit: 'requests', version: 'v1' },
        { provider: 'grok', limit: 1000000, unit: 'requests', version: 'v1' },
    ],
};
export function channelFamilyOf(provider, policy = DEFAULT_DISPATCH_POLICY) {
    if (provider == null || provider === '')
        return undefined;
    const family = provider.split('/', 1)[0] ?? provider;
    const catalog = policy.channelCatalog ?? CHANNEL_CATALOG;
    return catalog.find(entry => entry.id === provider) ?? catalog.find(entry => entry.id === family);
}
/** A local gateway is not free; this is an explicit owner no-approval policy exception. */
export function isLocalBudgetExempt(family, approvalMode) {
    return family?.transport === 'local-gateway' && approvalMode === 'never';
}
/**
 * Resolve a route (`family/model` or a bare family id) to its catalog family.
 * Unknown routes resolve to `undefined` — never a guess.
 */
export function describeChannel(provider) {
    return channelFamilyOf(provider);
}
export function isExemptKind(kind, policy = DEFAULT_DISPATCH_POLICY) {
    if (kind === undefined || kind === '')
        return false;
    return policy.exemptKinds.includes(kind);
}
/**
 * Runtime validation of a budget authorization: a concrete positive finite
 * limit + non-empty unit, a non-empty provider, and (when declared) an expiry
 * that is still in the future. A malformed or expired authorization is not
 * trusted — the gate treats it as absent and holds.
 */
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
