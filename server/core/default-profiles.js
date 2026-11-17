import { PROMPT_TEMPLATES } from "./prompt-templates.js";
/**
 * Built-in team presets shipped with AgentTeams Studio.
 *
 * Pure CPA + Antigravity (Hajimi) model roster:
 * - Gemini Flash / Pro models carry the 哈吉米 (Hajimi) persona by default.
 * - Permanent aesthetic officer `ui-aesthetics` defaults to `antigravity / gemini-3.8-flash-tiered` (哈吉米审美官).
 * - Report / documentation officer `doc-writer` defaults to `antigravity / gemini-3.8-flash-tiered` (哈吉米撰稿官).
 */
export const DEFAULT_TEAM_PROFILES = {
    'chatgpt-crew': {
        description: 'ChatGPT / CPA 指挥的产品工程团队：Gemini 3.8 Flash（哈吉米人设）负责调研、前端与同类软件审美优化，CPA GPT-6.1-Sol 负责后端与核心工程。',
        taskPlanning: 'seed',
        reviewPolicy: {
            requirementsMaxRounds: 2,
            codeMaxRounds: 2,
            maxRepairAttempts: 2,
        },
        members: [
            {
                name: 'researcher',
                role: '调研 + 前端（哈吉米调研官）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                fallback: { provider: 'cliproxyapi', model: 'gpt-6-sol' },
                executionPrompt: PROMPT_TEMPLATES.researcher,
            },
            {
                name: 'ui-aesthetics',
                role: '常驻审美成员（哈吉米审美官 · 联网参考同类软件审美与 UI 优化）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                executionPrompt: PROMPT_TEMPLATES.uiAesthetics,
            },
            {
                name: 'engineer',
                role: '后端 + 工程（CPA GPT-6.1-Sol）',
                provider: 'cliproxyapi',
                model: 'gpt-6.1-sol',
                executionPrompt: PROMPT_TEMPLATES.engineer,
            },
            {
                name: 'doc-writer',
                role: '报告与交付文档撰写（哈吉米撰稿官）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                executionPrompt: PROMPT_TEMPLATES.docWriter,
            },
        ],
        tasks: [
            {
                id: 'requirements',
                subject: '澄清需求、目标与验收标准（结合本次目标细化）',
                assignee: 'researcher',
            },
            {
                id: 'ui-aesthetics-audit',
                subject: '联网参考同类标杆软件审美与界面交互优化设计',
                assignee: 'ui-aesthetics',
                dependencies: ['requirements'],
            },
            {
                id: 'frontend',
                subject: '实现前端/客户端交互与界面（若无前端需求，队长可在评审中删除本任务）',
                assignee: 'researcher',
                dependencies: ['requirements', 'ui-aesthetics-audit'],
            },
            {
                id: 'backend',
                subject: '实现后端/服务端与工程落地（核心逻辑、数据与接口）',
                assignee: 'engineer',
                dependencies: ['requirements'],
            },
            {
                id: 'integration',
                subject: '前端与后端联调、集成验证与交付报告汇编',
                assignee: 'doc-writer',
                dependencies: ['frontend', 'backend'],
            },
        ],
    },
    'heterogeneous-cross-review': {
        description: '标准异构多模型研发团队：Gemini 4 Argon（哈吉米架构官）负责架构，CPA GPT-6.1-Sol 负责核心实现与L2白盒自修，哈吉米审美官负责UI对标优化，Gemini 3.8 Flash（哈吉米监督官/撰稿官）负责L3黑盒监督与报告汇编。',
        taskPlanning: 'seed',
        reviewPolicy: {
            requirementsMaxRounds: 2,
            codeMaxRounds: 2,
            maxRepairAttempts: 2,
        },
        members: [
            {
                name: 'arch-planner',
                role: '需求澄清与架构设计（哈吉米架构官）',
                provider: 'antigravity',
                model: 'hydrogen',
                executionPrompt: PROMPT_TEMPLATES.architect,
            },
            {
                name: 'core-engineer',
                role: '后端工程与核心代码落地（CPA GPT-6.1-Sol）',
                provider: 'cliproxyapi',
                model: 'gpt-6.1-sol',
                fallback: { provider: 'codex', model: 'gpt-6.1-sol' },
                executionPrompt: PROMPT_TEMPLATES.engineer,
            },
            {
                name: 'ui-aesthetics',
                role: '常驻审美成员（哈吉米审美官 · 联网参考同类软件审美与 UI 优化）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                executionPrompt: PROMPT_TEMPLATES.uiAesthetics,
            },
            {
                name: 'audit-gpt',
                role: '独立L2白盒审查与缺陷自闭环修复',
                provider: 'cliproxyapi',
                model: 'gpt-6.1-sol',
                executionPrompt: PROMPT_TEMPLATES.gptReviewer,
            },
            {
                name: 'audit-gemini',
                role: '独立L3黑盒红队监督官与反向证伪实测（哈吉米督察官）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                executionPrompt: PROMPT_TEMPLATES.geminiSupervisor,
            },
            {
                name: 'doc-writer',
                role: '交付文档汇编与规范提炼（哈吉米撰稿官）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                executionPrompt: PROMPT_TEMPLATES.docWriter,
            },
        ],
        tasks: [
            {
                id: 'spec-clarification',
                subject: '需求澄清、架构拓扑与接口契约设计',
                assignee: 'arch-planner',
            },
            {
                id: 'core-implementation',
                subject: '核心逻辑编码实现与单测自测覆盖',
                assignee: 'core-engineer',
                dependencies: ['spec-clarification'],
            },
            {
                id: 'ui-aesthetics-polish',
                subject: '联网对标同类标杆软件审美与前端 UI/UX 视觉走查优化',
                assignee: 'ui-aesthetics',
                dependencies: ['spec-clarification'],
            },
            {
                id: 'gpt-whitebox-review',
                subject: 'GPT独立白盒逻辑走查与自闭环修复',
                assignee: 'audit-gpt',
                dependencies: ['core-implementation'],
            },
            {
                id: 'gemini-blackbox-supervision',
                subject: 'Gemini哈吉米独立黑盒监督、沙箱穿透与反向证伪终测',
                assignee: 'audit-gemini',
                dependencies: ['core-implementation', 'ui-aesthetics-polish'],
            },
            {
                id: 'delivery-synthesis',
                subject: '全量交付物汇编、文档规范与自测指南',
                assignee: 'doc-writer',
                dependencies: ['gpt-whitebox-review', 'gemini-blackbox-supervision'],
            },
            {
                id: 'team-retrospective',
                subject: '团队全流程实战复盘与长效机制沉淀报告',
                assignee: 'audit-gemini',
                dependencies: ['delivery-synthesis'],
            },
        ],
    },
    'ai-radar-squad': {
        description: '自动化AI资讯雷达与评估团队：哈吉米调研/审美/督察/撰稿全阵容 + CPA GPT-6.1-Sol 工程与白盒审查闭环。',
        taskPlanning: 'seed',
        reviewPolicy: {
            requirementsMaxRounds: 2,
            codeMaxRounds: 2,
            maxRepairAttempts: 2,
        },
        members: [
            {
                name: 'arch-planner',
                role: '系统架构与需求规格设计师（哈吉米架构官）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                executionPrompt: PROMPT_TEMPLATES.architect,
            },
            {
                name: 'researcher',
                role: '开源生态调研与技术选型专家（哈吉米调研官）',
                provider: 'antigravity',
                model: 'hydrogen',
                executionPrompt: PROMPT_TEMPLATES.researcher,
            },
            {
                name: 'core-engineer',
                role: '核心抓取、评分流水线与调度工程师（CPA GPT-6.1-Sol）',
                provider: 'cliproxyapi',
                model: 'gpt-6.1-sol',
                fallback: { provider: 'codex', model: 'gpt-6.1-sol' },
                executionPrompt: PROMPT_TEMPLATES.engineer,
            },
            {
                name: 'ui-aesthetics',
                role: '常驻审美成员（哈吉米审美官 · 联网参考同类软件审美与 UI 优化）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                executionPrompt: PROMPT_TEMPLATES.uiAesthetics,
            },
            {
                name: 'audit-gpt',
                role: '独立L2白盒审查与自闭环修复（CPA GPT-6.1-Sol）',
                provider: 'cliproxyapi',
                model: 'gpt-6.1-sol',
                executionPrompt: PROMPT_TEMPLATES.gptReviewer,
            },
            {
                name: 'audit-gemini',
                role: '独立L3黑盒监督官与反向证伪实测（哈吉米督察官）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                executionPrompt: PROMPT_TEMPLATES.geminiSupervisor,
            },
            {
                name: 'doc-writer',
                role: '技术白皮书与规范文档撰写师（哈吉米撰稿官）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                executionPrompt: PROMPT_TEMPLATES.docWriter,
            },
        ],
        tasks: [
            {
                id: 'task-1-spec',
                subject: '需求完善与系统功能规格说明书编制',
                assignee: 'arch-planner',
            },
            {
                id: 'task-2-survey',
                subject: '全网开源生态调研与技术选型对比报告',
                assignee: 'researcher',
                dependencies: ['task-1-spec'],
            },
            {
                id: 'task-3-architecture',
                subject: '系统核心架构与详细模块接口设计',
                assignee: 'core-engineer',
                dependencies: ['task-2-survey'],
            },
            {
                id: 'task-3b-aesthetics',
                subject: '联网对标同类雷达软件审美与交互界面优化设计',
                assignee: 'ui-aesthetics',
                dependencies: ['task-2-survey'],
            },
            {
                id: 'task-4-review-gpt',
                subject: 'GPT独立白盒审查与自闭环修复（席位A-GPT）',
                assignee: 'audit-gpt',
                dependencies: ['task-3-architecture'],
            },
            {
                id: 'task-5-review-gemini',
                subject: 'Gemini哈吉米独立黑盒监督与反向证伪终测（席位B-Gemini）',
                assignee: 'audit-gemini',
                dependencies: ['task-3-architecture', 'task-3b-aesthetics'],
            },
            {
                id: 'task-6-final-doc',
                subject: '项目立项白皮书与首期实施方案汇编',
                assignee: 'doc-writer',
                dependencies: ['task-4-review-gpt', 'task-5-review-gemini'],
            },
            {
                id: 'task-7-retrospective',
                subject: '团队全流程实战复盘与长效机制沉淀报告',
                assignee: 'audit-gemini',
                dependencies: ['task-6-final-doc'],
            },
        ],
    },
};
/**
 * Merge owner `profiles` config over the built-in presets.
 */
export function withDefaultProfiles(ownerProfiles) {
    return { ...DEFAULT_TEAM_PROFILES, ...(ownerProfiles ?? {}) };
}
