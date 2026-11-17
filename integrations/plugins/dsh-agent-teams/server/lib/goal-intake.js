/**
 * Deterministic goal-to-roster recommendation for the workbench intake.
 *
 * Pure CPA + Antigravity (Gemini) routing:
 * - Zero DS (DeepSeek/WorkBuddy) and zero ZCode (zai-coding-cn/GLM) models.
 * - Includes permanent `ui-aesthetics` (UI/UX 审美官) and `doc-writer` (报告撰稿官) powered by Gemini 3.8 Flash (哈吉米人设).
 * @module dsh-agent-teams/goal-intake
 */
const STRONG_ENGINEERING = { provider: 'cliproxyapi', model: 'gpt-6.1-sol' };
const LIGHT_ENGINEERING = { provider: 'cliproxyapi', model: 'gpt-5.6-sol' };
const AESTHETIC_DESIGNER = { provider: 'antigravity', model: 'gemini-3.8-flash-tiered' };
const RESEARCH_SEARCH = { provider: 'antigravity', model: 'gemini-3.8-flash-tiered' };
const REVIEWER_GPT = { provider: 'cliproxyapi', model: 'gpt-6-sol' };
const REVIEWER_GEMINI = { provider: 'antigravity', model: 'gemini-3.8-flash-tiered' };
const DOC_WRITER_GEMINI = { provider: 'antigravity', model: 'gemini-3.8-flash-tiered' };
const CAPTAIN_FAMILIES = ['cliproxyapi', 'openai-codex', 'codex', 'chatgpt', 'antigravity', 'google'];

export function validateCaptainRoute(route) {
    if (route === undefined || route.provider === undefined || route.provider === '') {
        return { ok: false, reason: 'no captain session attached: the captain route could not be read' };
    }
    const family = route.provider.split('/', 1)[0] ?? route.provider;
    if (!CAPTAIN_FAMILIES.includes(family)) {
        return { ok: false, provider: route.provider, model: route.model, reason: `captain route ${route.provider} is not an authorized captain family route; refusing to relabel it` };
    }
    return { ok: true, provider: route.provider, model: route.model };
}

export function buildGoalRecommendation(query) {
    const goal = query.goal.trim();
    const light = /轻量|简单|lint|格式化|文档|注释|lightweight|docs?|typo/i.test(goal);
    const research = /调研|检索|搜索|参考|research|survey|investigat/i.test(goal);
    const members = [
        {
            name: 'engineer',
            role: 'implementation',
            provider: light ? LIGHT_ENGINEERING.provider : STRONG_ENGINEERING.provider,
            model: light ? LIGHT_ENGINEERING.model : STRONG_ENGINEERING.model,
            reason: light
                ? '轻量任务：调用 CPA GPT-5.6-Sol 高效完成'
                : '复杂工程：调用 CPA GPT-6.1-Sol 强力全栈工程实现',
        },
        {
            name: 'ui-aesthetics',
            role: 'aesthetics',
            provider: AESTHETIC_DESIGNER.provider,
            model: AESTHETIC_DESIGNER.model,
            reason: '常驻审美官（哈吉米）：调用 Gemini 3.8 Flash 联网参考同类标杆软件并主导 UI/UX 审美升级',
        },
        ...(research
            ? [{
                    name: 'navigator',
                    role: 'navigator',
                    provider: RESEARCH_SEARCH.provider,
                    model: RESEARCH_SEARCH.model,
                    reason: '哈吉米情报官：Gemini 3.8 Flash 快速资料扫描与结构化提炼',
                }]
            : []),
        {
            name: 'gpt-reviewer',
            role: 'review',
            provider: REVIEWER_GPT.provider,
            model: REVIEWER_GPT.model,
            reason: '第一道交叉审查防线：CPA GPT-6-Sol 独立白盒逻辑走查与自闭环修复',
        },
        {
            name: 'gemini-reviewer',
            role: 'verification',
            provider: REVIEWER_GEMINI.provider,
            model: REVIEWER_GEMINI.model,
            reason: '第二道交叉审查防线（哈吉米督察）：Gemini 3.8 Flash 独立黑盒红队打假与沙箱合规实测',
        },
        {
            name: 'doc-writer',
            role: 'integration',
            provider: DOC_WRITER_GEMINI.provider,
            model: DOC_WRITER_GEMINI.model,
            reason: '终局报告收口（哈吉米撰稿官）：Gemini 3.8 Flash 编写研究/交付报告与归档',
        },
    ];
    const dependencies = [
        { task: 'aesthetics', dependsOn: [] },
        { task: 'implementation', dependsOn: ['ui-aesthetics'] },
        { task: 'verification', dependsOn: ['engineer'] },
        { task: 'review', dependsOn: ['engineer'] },
        { task: 'integration', dependsOn: ['gemini-reviewer', 'gpt-reviewer'] },
    ];
    return {
        goal,
        members,
        dependencies,
        executionWindow: {
            deferPeak: false,
            note: 'Pure CPA + Antigravity (Gemini) model catalog; DS and ZCode models have been permanently removed.',
        },
        captainRoute: validateCaptainRoute(query.captainRoute),
        notes: [
            'heuristic roster: 启发式名单，主人可在批准前修改',
            'human approval required: launching only stages the plan; nothing dispatches before approval',
            'model catalog policy: 已彻底剔除 DS 与 ZCode 模型；Gemini Flash/Pro 默认搭载哈吉米人设；常驻审美成员与报告撰写固定采用 Gemini 3.8 Flash',
        ],
    };
}

export function recommendationToInlinePlan(rec) {
    if (typeof rec !== 'object' || rec === null || Array.isArray(rec))
        return undefined;
    const record = rec;
    if (!Array.isArray(record['members']) || record['members'].length === 0)
        return undefined;
    const members = [];
    for (const entry of record['members']) {
        if (typeof entry !== 'object' || entry === null)
            return undefined;
        const member = entry;
        const name = typeof member['name'] === 'string' ? member['name'].trim() : '';
        const role = typeof member['role'] === 'string' ? member['role'].trim() : '';
        const provider = typeof member['provider'] === 'string' ? member['provider'].trim() : '';
        const model = typeof member['model'] === 'string' ? member['model'].trim() : '';
        if (name === '' || role === '' || provider === '' || model === '')
            return undefined;
        members.push({ name, role, provider, model });
    }
    const roleByName = new Map(members.map(item => [item.name, item.role]));
    const edges = Array.isArray(record['dependencies']) ? record['dependencies'] : [];
    const tasks = members.map((item) => {
        const edge = edges.find((entry) => {
            if (typeof entry !== 'object' || entry === null)
                return false;
            return entry['task'] === item.role;
        });
        const dependsOn = [];
        if (edge !== undefined && Array.isArray(edge['dependsOn'])) {
            for (const name of edge['dependsOn']) {
                if (typeof name === 'string')
                    dependsOn.push(roleByName.get(name.trim()) ?? name.trim());
            }
        }
        return { id: item.role, subject: item.role, assignee: item.name, dependencies: dependsOn };
    });
    return { members, tasks, taskPlanning: 'seed' };
}
