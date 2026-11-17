import { PROMPT_TEMPLATES } from "./prompt-templates.js";
/**
 * Built-in team presets shipped with the plugin.
 *
 * Rules enforced globally per Owner instructions:
 * 1. DS (DeepSeek/WorkBuddy) and ZCode (zai-coding-cn/GLM) models are completely removed.
 * 2. Report / documentation writing (`doc-writer`) always uses Gemini 3.8 Flash (`antigravity/gemini-3.8-flash-tiered`) with 哈吉米 persona.
 * 3. Gemini Flash and Gemini Pro models load the 哈吉米 (Hajimi) persona.
 * 4. Every team preset includes or supports the permanent `ui-aesthetics` (审美成员) role powered by Gemini 3.8 Flash (`antigravity/gemini-3.8-flash-tiered`).
 */
export const DEFAULT_TEAM_PROFILES = {
    'chatgpt-crew': {
        description: 'CPA GPT + Gemini 3.8 Flash（哈吉米）敏捷工程与审美团队：Gemini 3.8 Flash 负责调研、UI 审美优化与报告撰写，CPA GPT-6.1-Sol 负责全栈核心工程落地。',
        taskPlanning: 'seed',
        reviewPolicy: {
            requirementsMaxRounds: 2,
            codeMaxRounds: 2,
            maxRepairAttempts: 2,
        },
        members: [
            {
                name: 'ui-aesthetics',
                role: '调研 + UI审美优化 + 报告（哈吉米）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                fallback: { provider: 'cliproxyapi', model: 'gpt-6.1-sol' },
                executionPrompt: PROMPT_TEMPLATES.aestheticDesigner,
            },
            {
                name: 'engineer',
                role: '后端 + 全栈核心工程',
                provider: 'cliproxyapi',
                model: 'gpt-6.1-sol',
                executionPrompt: PROMPT_TEMPLATES.engineer,
            },
        ],
        tasks: [
            {
                id: 'requirements',
                subject: '澄清需求、同类标杆软件审美参考与验收标准',
                assignee: 'ui-aesthetics',
            },
            {
                id: 'frontend',
                subject: 'UI/UX 审美打磨与客户端界面交互实现',
                assignee: 'ui-aesthetics',
                dependencies: ['requirements'],
            },
            {
                id: 'backend',
                subject: '实现后端/服务端与工程落地（核心逻辑、数据与接口）',
                assignee: 'engineer',
                dependencies: ['requirements'],
            },
            {
                id: 'integration',
                subject: '前后端联调、集成验证与交付报告汇编',
                assignee: 'ui-aesthetics',
                dependencies: ['frontend', 'backend'],
            },
        ],
    },
    'heterogeneous-cross-review': {
        description: '标准六角异构研发与高定审美团队：CPA GPT-6.1-Sol 负责架构与核心工程，Gemini 3.8 Flash（哈吉米）执掌 UI/UX 审美设计、L3 黑盒红队监督与报告撰写，CPA GPT-6-Sol 负责 L2 白盒审查。',
        taskPlanning: 'seed',
        reviewPolicy: {
            requirementsMaxRounds: 2,
            codeMaxRounds: 2,
            maxRepairAttempts: 2,
        },
        members: [
            {
                name: 'arch-planner',
                role: '需求澄清与架构设计',
                provider: 'cliproxyapi',
                model: 'gpt-6.1-sol',
                executionPrompt: PROMPT_TEMPLATES.architect,
            },
            {
                name: 'ui-aesthetics',
                role: 'UI/UX 审美与视觉交互设计官（哈吉米）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                executionPrompt: PROMPT_TEMPLATES.aestheticDesigner,
            },
            {
                name: 'core-engineer',
                role: '后端工程与核心代码落地',
                provider: 'cliproxyapi',
                model: 'gpt-6.1-sol',
                fallback: { provider: 'cliproxyapi', model: 'gpt-6-sol' },
                executionPrompt: PROMPT_TEMPLATES.engineer,
            },
            {
                name: 'audit-gpt',
                role: '独立L2白盒审查与缺陷自闭环修复',
                provider: 'cliproxyapi',
                model: 'gpt-6-sol',
                executionPrompt: PROMPT_TEMPLATES.gptReviewer,
            },
            {
                name: 'audit-gemini',
                role: '独立L3黑盒红队监督官与反向证伪实测（哈吉米）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                executionPrompt: PROMPT_TEMPLATES.geminiSupervisor,
            },
            {
                name: 'doc-writer',
                role: '交付报告汇编与规范提炼（哈吉米 · Gemini Flash）',
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
                id: 'ui-aesthetic-design',
                subject: '联网调研同类软件视觉范式与 UI 审美优化升级',
                assignee: 'ui-aesthetics',
                dependencies: ['spec-clarification'],
            },
            {
                id: 'core-implementation',
                subject: '核心逻辑编码实现与单测自测覆盖',
                assignee: 'core-engineer',
                dependencies: ['spec-clarification', 'ui-aesthetic-design'],
            },
            {
                id: 'gpt-whitebox-review',
                subject: 'GPT独立白盒逻辑走查与自闭环修复',
                assignee: 'audit-gpt',
                dependencies: ['core-implementation'],
            },
            {
                id: 'gemini-blackbox-supervision',
                subject: 'Gemini独立黑盒监督、沙箱穿透与反向证伪终测',
                assignee: 'audit-gemini',
                dependencies: ['core-implementation'],
            },
            {
                id: 'delivery-synthesis',
                subject: '全量交付报告汇编、文档规范与自测指南（Gemini Flash 哈吉米）',
                assignee: 'doc-writer',
                dependencies: ['gpt-whitebox-review', 'gemini-blackbox-supervision'],
            },
            {
                id: 'team-retrospective',
                subject: '团队全流程实战复盘与长效机制沉淀报告（Gemini Flash 哈吉米）',
                assignee: 'audit-gemini',
                dependencies: ['delivery-synthesis'],
            },
        ],
    },
    'ai-radar-squad': {
        description: '重型开源调研、高定审美与研发评估编队：CPA GPT-6.1-Sol 负责架构与核心工程，Gemini 3.8 Flash（哈吉米）分别执掌开源情报调研、UI 审美设计、L3 黑盒红队监督与白皮书报告撰写，CPA GPT-6-Sol 负责 L2 白盒审查。',
        taskPlanning: 'seed',
        reviewPolicy: {
            requirementsMaxRounds: 2,
            codeMaxRounds: 2,
            maxRepairAttempts: 2,
        },
        members: [
            {
                name: 'arch-planner',
                role: '系统架构与需求规格设计师（CPA GPT-6.1-Sol）',
                provider: 'cliproxyapi',
                model: 'gpt-6.1-sol',
                executionPrompt: PROMPT_TEMPLATES.architect,
            },
            {
                name: 'researcher',
                role: '开源生态调研与技术选型专家（哈吉米 · Gemini Flash）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                executionPrompt: PROMPT_TEMPLATES.researcher,
            },
            {
                name: 'ui-aesthetics',
                role: 'UI/UX 审美与视觉交互设计官（哈吉米 · Gemini 3.8 Flash）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                executionPrompt: PROMPT_TEMPLATES.aestheticDesigner,
            },
            {
                name: 'core-engineer',
                role: '核心工程与调度实现专家（CPA GPT-6.1-Sol）',
                provider: 'cliproxyapi',
                model: 'gpt-6.1-sol',
                fallback: { provider: 'cliproxyapi', model: 'gpt-6-sol' },
                executionPrompt: PROMPT_TEMPLATES.engineer,
            },
            {
                name: 'audit-gpt',
                role: '独立L2白盒审查与自闭环修复（CPA GPT-6-Sol）',
                provider: 'cliproxyapi',
                model: 'gpt-6-sol',
                executionPrompt: PROMPT_TEMPLATES.gptReviewer,
            },
            {
                name: 'audit-gemini',
                role: '独立L3黑盒监督官与反向证伪实测（哈吉米 · Gemini 3.8 Flash）',
                provider: 'antigravity',
                model: 'gemini-3.8-flash-tiered',
                executionPrompt: PROMPT_TEMPLATES.geminiSupervisor,
            },
            {
                name: 'doc-writer',
                role: '技术白皮书与报告撰写师（哈吉米 · Gemini 3.8 Flash）',
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
                subject: '全网开源生态与同类标杆软件调研报告',
                assignee: 'researcher',
                dependencies: ['task-1-spec'],
            },
            {
                id: 'task-2b-aesthetics',
                subject: '联网参考同类软件审美与 UI 视觉交互优化',
                assignee: 'ui-aesthetics',
                dependencies: ['task-1-spec'],
            },
            {
                id: 'task-3-architecture',
                subject: '系统核心工程实现与模块集成',
                assignee: 'core-engineer',
                dependencies: ['task-2-survey', 'task-2b-aesthetics'],
            },
            {
                id: 'task-4-review-gpt',
                subject: 'GPT独立白盒审查与自闭环修复（席位A-GPT）',
                assignee: 'audit-gpt',
                dependencies: ['task-3-architecture'],
            },
            {
                id: 'task-5-review-gemini',
                subject: 'Gemini独立黑盒监督与反向证伪终测（席位B-Gemini）',
                assignee: 'audit-gemini',
                dependencies: ['task-3-architecture'],
            },
            {
                id: 'task-6-final-doc',
                subject: '项目白皮书与交付报告汇编（Gemini Flash 哈吉米）',
                assignee: 'doc-writer',
                dependencies: ['task-4-review-gpt', 'task-5-review-gemini'],
            },
            {
                id: 'task-7-retrospective',
                subject: '团队全流程实战复盘与长效机制沉淀报告（Gemini Flash 哈吉米）',
                assignee: 'audit-gemini',
                dependencies: ['task-6-final-doc'],
            },
        ],
    },
};

export function withDefaultProfiles(ownerProfiles) {
    return { ...DEFAULT_TEAM_PROFILES, ...(ownerProfiles ?? {}) };
}
