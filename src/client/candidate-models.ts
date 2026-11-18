/**
 * Candidate models catalog and validation for AgentTeams UI components.
 * Pure CPA + Antigravity (Hajimi) + Codex + Anthropic catalog.
 * All Gemini Flash / Pro models carry the 【哈吉米（Hajimi）人设】 by default.
 *
 * @module dsh-agent-teams/client/candidate-models
 */

export interface CandidateModel {
  readonly id: string
  readonly name: string
  readonly provider: string
  readonly providerName: string
  readonly description?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
  readonly reasoningEfforts?: readonly ('low' | 'medium' | 'high' | 'xhigh' | 'max')[]
  readonly defaultEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  readonly isRecommended?: boolean
  readonly isTopRanked?: boolean
  readonly tag?: string
}

export type ModelValidationStatus = 'ok' | 'warn' | 'error'

export interface ModelValidationResult {
  readonly status: ModelValidationStatus
  readonly message: string
}

/**
 * 23 Models from Google Antigravity (Cloud Code Assist) route.
 * Gemini Flash / Pro series default to 【哈吉米（Hajimi）人设】 and are pinned at the top.
 */
export const ANTIGRAVITY_CANDIDATE_MODELS: readonly CandidateModel[] = [
  // === Gemini Hydrogen / Argon 独立审查与旗舰系列（默认搭载哈吉米人设）===
  {
    id: 'hydrogen',
    name: 'Gemini Hydrogen · 哈吉米 (Independent Reviewer)',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：Antigravity Hydrogen 独立黑盒红队与 UX/安全审查模型',
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'high',
    isRecommended: true,
    isTopRanked: true,
    tag: '哈吉米 · 独立黑盒审查',
  },
  {
    id: 'argon',
    name: 'Gemini 4 Argon Pro · 哈吉米 (High Reasoning)',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：Gemini 4 Argon Pro 高推理旗舰架构与评测型号',
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'high',
    isRecommended: true,
    isTopRanked: true,
    tag: '哈吉米 · 旗舰推理 Argon',
  },
  {
    id: 'gemini-4-argon-high',
    name: 'Gemini 4 Argon High · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：Gemini 4 Argon High 显式 OAuth 端点',
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'high',
    isRecommended: true,
    tag: '哈吉米 · Gemini 4 Argon',
  },

  // === Gemini 3.8 Flash 系列（置顶推荐首选：1M 上下文，64K 输出，默认搭载哈吉米人设）===
  {
    id: 'gemini-3.8-flash-tiered',
    name: 'Gemini 3.8 Flash (Tiered) · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米（Hajimi）人设】：常驻审美成员(ui-aesthetics)与撰稿官(doc-writer)首选端点，1M/64K',
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
    isRecommended: true,
    isTopRanked: true,
    tag: '哈吉米置顶首选 · 审美/撰稿/督察',
  },
  {
    id: 'gemini-3.8-flash-high',
    name: 'Gemini 3.8 Flash (High Reasoning) · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：深度思考档位，复杂逻辑与长上下文首选',
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ['high'],
    defaultEffort: 'high',
    isRecommended: true,
    isTopRanked: true,
    tag: '哈吉米 · 高思考 1M/64K',
  },
  {
    id: 'gemini-3.8-flash-medium',
    name: 'Gemini 3.8 Flash (Medium Reasoning) · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：平衡档位，前端 UI 审美与快速决策最佳效费比',
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ['medium'],
    defaultEffort: 'medium',
    isRecommended: true,
    isTopRanked: true,
    tag: '哈吉米 · 中思考 1M/64K',
  },
  {
    id: 'gemini-3.8-flash-low',
    name: 'Gemini 3.8 Flash (Low Reasoning) · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：轻量思考档位，快速响应与高吞吐调研任务',
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ['low'],
    defaultEffort: 'low',
    isRecommended: true,
    isTopRanked: true,
    tag: '哈吉米 · 低思考 1M/64K',
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash (Standard) · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：标准路由别名，自动映射至原生反重力端点',
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
    isRecommended: true,
    isTopRanked: true,
    tag: '哈吉米 · 标准 1M/64K',
  },

  // === Claude 5.5 系列（1M 上下文，128K 输出）===
  {
    id: 'claude-sonnet-5-5-high',
    name: 'Claude Sonnet 5.5 (High Reasoning)',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: 'Claude 5.5 架构长文审查，1M 上下文 / 128K 输出',
    contextWindow: 1048576,
    maxTokens: 131072,
    reasoningEfforts: ['high'],
    defaultEffort: 'high',
    isRecommended: true,
    tag: '1M/128K',
  },
  {
    id: 'claude-sonnet-5-5-medium',
    name: 'Claude Sonnet 5.5 (Medium Reasoning)',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: 'Claude 5.5 平衡档位，高质量全栈研发',
    contextWindow: 1048576,
    maxTokens: 131072,
    reasoningEfforts: ['medium'],
    defaultEffort: 'medium',
    isRecommended: true,
    tag: '1M/128K',
  },
  {
    id: 'claude-sonnet-5-5-low',
    name: 'Claude Sonnet 5.5 (Low Reasoning)',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: 'Claude 5.5 低延迟档位',
    contextWindow: 1048576,
    maxTokens: 131072,
    reasoningEfforts: ['low'],
    defaultEffort: 'low',
    tag: '1M/128K',
  },
  {
    id: 'claude-opus-5-5-high',
    name: 'Claude Opus 5.5 (High Reasoning)',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: 'Claude 5.5 旗舰思考模型，超复杂架构与理论论证',
    contextWindow: 1048576,
    maxTokens: 131072,
    reasoningEfforts: ['high'],
    defaultEffort: 'high',
    isRecommended: true,
    tag: '旗舰架构',
  },
  {
    id: 'claude-opus-5-5-medium',
    name: 'Claude Opus 5.5 (Medium Reasoning)',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: 'Claude 5.5 Opus 适中档位',
    contextWindow: 1048576,
    maxTokens: 131072,
    reasoningEfforts: ['medium'],
    defaultEffort: 'medium',
    tag: '旗舰',
  },
  {
    id: 'claude-opus-5-5-low',
    name: 'Claude Opus 5.5 (Low Reasoning)',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: 'Claude 5.5 Opus 快速档位',
    contextWindow: 1048576,
    maxTokens: 131072,
    reasoningEfforts: ['low'],
    defaultEffort: 'low',
    tag: '旗舰',
  },

  // === Claude 4.6 系列 ===
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '高质量工程实现与代码重构',
    contextWindow: 200000,
    maxTokens: 64000,
    reasoningEfforts: ['high'],
    defaultEffort: 'high',
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '高难度逻辑分析与系统建模',
    contextWindow: 250000,
    maxTokens: 64000,
    reasoningEfforts: ['high'],
    defaultEffort: 'high',
  },

  // === Gemini 3.7 / 3.6 / 3.5 / 3.1 / 2.5 系列（默认搭载哈吉米人设）===
  {
    id: 'gemini-3.7-flash-tiered',
    name: 'Gemini 3.7 Flash (Tiered) · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：3.7 代主力端点',
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：3.7 代标准路由',
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
  },
  {
    id: 'gemini-3.6-flash-high',
    name: 'Gemini 3.6 Flash (High Reasoning) · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：3.6 代高思考档位',
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ['high'],
    defaultEffort: 'high',
  },
  {
    id: 'gemini-3.6-flash-medium',
    name: 'Gemini 3.6 Flash (Medium Reasoning) · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：3.6 代中思考档位',
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ['medium'],
    defaultEffort: 'medium',
  },
  {
    id: 'gemini-3.6-flash-low',
    name: 'Gemini 3.6 Flash (Low Reasoning) · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：3.6 代轻量快速档位',
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ['low'],
    defaultEffort: 'low',
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：极速轻量，高吞吐批量任务首选',
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ['low'],
    defaultEffort: 'low',
    tag: '哈吉米 · 轻量快速',
  },
  {
    id: 'gemini-3.1-pro-high',
    name: 'Gemini 3.1 Pro (High Reasoning) · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：3.1 Pro 高性能专业版',
    contextWindow: 1048576,
    maxTokens: 65535,
    reasoningEfforts: ['high'],
    defaultEffort: 'high',
    tag: '哈吉米 Pro',
  },
  {
    id: 'gemini-3.1-pro-low',
    name: 'Gemini 3.1 Pro (Low Reasoning) · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：3.1 Pro 快速专业版',
    contextWindow: 1048576,
    maxTokens: 65535,
    reasoningEfforts: ['low'],
    defaultEffort: 'low',
    tag: '哈吉米 Pro',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro · 哈吉米',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '默认搭载【哈吉米人设】：成熟稳定专业版本，长文档与数据分析',
    contextWindow: 1048576,
    maxTokens: 65536,
    tag: '哈吉米 Pro',
  },

  // === GPT-OSS 系列 ===
  {
    id: 'gpt-oss-120b-medium',
    name: 'GPT-OSS 120B (Medium Reasoning)',
    provider: 'antigravity',
    providerName: 'Google Antigravity (哈吉米)',
    description: '开源百亿大模型中思考档位，安全合规首选',
    contextWindow: 131072,
    maxTokens: 32768,
    reasoningEfforts: ['medium'],
    defaultEffort: 'medium',
    tag: '开源百亿',
  },
]

/**
 * EasyCLIProxyAPI (CPA) 本地统一网关候选模型，默认推荐 gpt-6.1-sol。
 */
export const CLIPROXYAPI_CANDIDATE_MODELS: readonly CandidateModel[] = [
  {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol (CPA Default)',
    provider: 'cliproxyapi',
    providerName: 'EasyCLIProxyAPI (CPA)',
    description: 'EasyCLIProxyAPI 路由主力 GPT-Sol 模型，代码实现与白盒审查首选',
    contextWindow: 200000,
    maxTokens: 32768,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'high',
    isRecommended: true,
    isTopRanked: true,
    tag: 'CPA 主力 · GPT-Sol',
  },
  {
    id: 'gpt-6-sol',
    name: 'GPT-6 Sol (CPA)',
    provider: 'cliproxyapi',
    providerName: 'EasyCLIProxyAPI (CPA)',
    description: 'EasyCLIProxyAPI GPT-6 Sol 通用工程与审查模型',
    contextWindow: 200000,
    maxTokens: 32768,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
    isRecommended: true,
    tag: 'CPA · GPT-Sol',
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol (CPA)',
    provider: 'cliproxyapi',
    providerName: 'EasyCLIProxyAPI (CPA)',
    description: 'EasyCLIProxyAPI 轻量高速 GPT-5.6 Sol',
    contextWindow: 128000,
    maxTokens: 16384,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
    tag: 'CPA · 高速',
  },
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra (CPA)',
    provider: 'cliproxyapi',
    providerName: 'EasyCLIProxyAPI (CPA)',
    description: 'EasyCLIProxyAPI 复杂系统架构推理模型',
    contextWindow: 200000,
    maxTokens: 32768,
    reasoningEfforts: ['medium', 'high'],
    defaultEffort: 'high',
    tag: 'CPA · 架构',
  },
  {
    id: 'codex-auto-review',
    name: 'Codex Auto Review (CPA)',
    provider: 'cliproxyapi',
    providerName: 'EasyCLIProxyAPI (CPA)',
    description: 'EasyCLIProxyAPI 自动代码审计路由',
    contextWindow: 200000,
    maxTokens: 32768,
    reasoningEfforts: ['high'],
    defaultEffort: 'high',
    tag: 'CPA · 审计',
  },
]

export const OTHER_CANDIDATE_MODELS: readonly CandidateModel[] = [
  ...CLIPROXYAPI_CANDIDATE_MODELS,

  // OpenAI / Codex
  {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    provider: 'codex',
    providerName: 'OpenAI Codex',
    description: '独立代码与架构交叉审查专家',
    contextWindow: 200000,
    maxTokens: 32768,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'high',
    isRecommended: true,
    tag: '白盒审查',
  },
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    provider: 'codex',
    providerName: 'OpenAI Codex',
    description: '多功能通用主力模型',
    contextWindow: 200000,
    maxTokens: 32768,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    providerName: 'OpenAI Official',
    description: '经典通用多模态旗舰',
    contextWindow: 128000,
    maxTokens: 16384,
  },

  // Anthropic Official
  {
    id: 'claude-3-7-sonnet-latest',
    name: 'Claude 3.7 Sonnet',
    provider: 'anthropic',
    providerName: 'Anthropic Official',
    description: '官方直连 Sonnet 模型，全功能代码与思考',
    contextWindow: 200000,
    maxTokens: 64000,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'high',
  },
]

export const DOMESTIC_AND_HARNESS_CANDIDATE_MODELS: readonly CandidateModel[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek-V3 (deepseek-chat · DeepSeek Harness)',
    provider: 'deepseek',
    providerName: 'DeepSeek (深度求索 / Harness)',
    description: 'DeepSeek-V3 旗舰通用与工程编码模型，支持 DeepSeek Harness 多智能体协作',
    contextWindow: 128000,
    maxTokens: 16384,
    isRecommended: true,
    tag: 'DeepSeek Harness',
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek-R1 (deepseek-reasoner · 深度思考)',
    provider: 'deepseek',
    providerName: 'DeepSeek (深度求索 / Harness)',
    description: 'DeepSeek-R1 强推理模型，适合架构推演、白盒审查与复杂算法攻坚',
    contextWindow: 128000,
    maxTokens: 32768,
    reasoningEfforts: ['high'],
    defaultEffort: 'high',
    isRecommended: true,
    tag: 'DeepSeek R1',
  },
  {
    id: 'qwen3-max',
    name: 'Qwen3-Max (阿里通义千问旗舰)',
    provider: 'qwen',
    providerName: 'Alibaba Qwen (通义千问 / 百炼)',
    description: '阿里云百炼 Qwen3-Max 旗舰大模型，支持超长上下文与多智能体工具调用',
    contextWindow: 1000000,
    maxTokens: 32768,
    isRecommended: true,
    tag: '国内旗舰 · 千问',
  },
  {
    id: 'qwen-coder-plus',
    name: 'Qwen-Coder-Plus (通义代码专家)',
    provider: 'qwen',
    providerName: 'Alibaba Qwen (通义千问 / 百炼)',
    description: '专为全栈工程与代码审查优化的通义代码大模型',
    contextWindow: 131072,
    maxTokens: 16384,
    isRecommended: true,
    tag: '代码专家',
  },
  {
    id: 'glm-4.5',
    name: 'GLM-4.5 (智谱清言旗舰)',
    provider: 'zhipu',
    providerName: 'Zhipu GLM (智谱 BigModel)',
    description: '智谱开放平台新一代高智能 Agent 与工程基座模型',
    contextWindow: 128000,
    maxTokens: 16384,
    isRecommended: true,
    tag: '智谱旗舰',
  },
  {
    id: 'kimi-k2',
    name: 'Kimi-K2 (月之暗面长文本工程)',
    provider: 'kimi',
    providerName: 'Moonshot Kimi (月之暗面)',
    description: 'Kimi K2 万亿参数 MoE 架构，擅长长文档研发、代码重构与 Agent 工具链',
    contextWindow: 256000,
    maxTokens: 32768,
    isRecommended: true,
    tag: 'Kimi K2',
  },
  {
    id: 'doubao-1.5-pro-256k',
    name: 'Doubao-1.5-Pro-256k (字节豆包 / 火山方舟)',
    provider: 'doubao',
    providerName: 'ByteDance Doubao (火山方舟)',
    description: '字节跳动火山方舟高吞吐低延迟全能主力模型',
    contextWindow: 256000,
    maxTokens: 16384,
    isRecommended: true,
    tag: '字节火山',
  },
  {
    id: 'Pro/deepseek-ai/DeepSeek-R1',
    name: 'DeepSeek-R1 Pro (硅基流动 SiliconFlow)',
    provider: 'siliconflow',
    providerName: 'SiliconFlow (硅基流动聚合)',
    description: '硅基流动高速国内聚合网关，一键接入开源与国产全系模型',
    contextWindow: 128000,
    maxTokens: 32768,
    isRecommended: true,
    tag: '硅基流动',
  },
  {
    id: 'grok-3',
    name: 'Grok-3 (xAI Grok Bot / grok-build 旗舰)',
    provider: 'grok',
    providerName: 'xAI Grok / Grok-Build',
    description: 'xAI Grok-3 旗舰深搜、事实核查与极客编码模型，兼容 xai-org/grok-build 与 OpenAI 协议',
    contextWindow: 131072,
    maxTokens: 32768,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'high',
    isRecommended: true,
    tag: 'Grok Bot · 实时深搜',
  },
  {
    id: 'grok-3-mini-fast',
    name: 'Grok-3 Mini Fast (xAI 极速核查与推理)',
    provider: 'grok',
    providerName: 'xAI Grok / Grok-Build',
    description: 'xAI Grok-3 Mini 高速思考模型，适合 @grok 事实核查、红队锐评与敏捷编码',
    contextWindow: 131072,
    maxTokens: 16384,
    reasoningEfforts: ['low', 'high'],
    defaultEffort: 'high',
    isRecommended: true,
    tag: 'Grok Mini · 极速',
  },
  {
    id: 'glm-4.5',
    name: 'ZCode · GLM-4.5 (Coding Plan 主力)',
    provider: 'zcode',
    providerName: 'ZCode (智谱编码代理生态)',
    description: 'ZCode IDE / zai-coding-cn 编码代理主力模型',
    contextWindow: 128000,
    maxTokens: 16384,
    isRecommended: true,
    tag: 'ZCode 生态',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'OpenCode Zen · Claude Sonnet 4.6',
    provider: 'opencode',
    providerName: 'OpenCode (Zen 终端路由)',
    description: 'OpenCode 官方 Zen 聚合路由全栈编码旗舰',
    contextWindow: 200000,
    maxTokens: 64000,
    isRecommended: true,
    tag: 'OpenCode Zen',
  },
  {
    id: 'gpt-4o',
    name: 'NewAPI / OneAPI 中转站 · GPT-4o',
    provider: 'newapi',
    providerName: 'NewAPI / OneAPI (通用中转站)',
    description: '标准 OneAPI / NewAPI 中转站协议模型，支持一键自动同步全站模型',
    contextWindow: 128000,
    maxTokens: 16384,
    isRecommended: true,
    tag: '中转站主力',
  },
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'OpenRouter · Claude Sonnet 4',
    provider: 'openrouter',
    providerName: 'OpenRouter (全球中转聚合)',
    description: 'OpenRouter 全球统一 API 中转路由',
    contextWindow: 200000,
    maxTokens: 64000,
    isRecommended: true,
    tag: 'OpenRouter',
  },
]

/** Full merged candidate models list with Antigravity (Hajimi), CPA GPT-6.1-Sol, DeepSeek Harness & Domestic LLMs */
export const ALL_CANDIDATE_MODELS: readonly CandidateModel[] = [
  ...ANTIGRAVITY_CANDIDATE_MODELS,
  ...OTHER_CANDIDATE_MODELS,
  ...DOMESTIC_AND_HARNESS_CANDIDATE_MODELS,
]

/**
 * Automatically merges dynamic catalog models discovered by host subscriptions at runtime.
 */
export function enrichCandidateModelsWithCatalog(
  baseModels: readonly CandidateModel[],
  discoveredCatalog?: readonly { id: string; name?: string; provider?: string }[],
): readonly CandidateModel[] {
  if (!discoveredCatalog || discoveredCatalog.length === 0) {
    return baseModels
  }

  const existingIds = new Set(baseModels.map((m) => `${(m.provider || '').toLowerCase()}:${m.id.toLowerCase()}`))
  const dynamicAdditions: CandidateModel[] = []

  for (const item of discoveredCatalog) {
    const idLower = item.id.toLowerCase()
    const provLower = (item.provider || 'cliproxyapi').toLowerCase()
    if (existingIds.has(`${provLower}:${idLower}`)) continue
    const isAntigravity = provLower.includes('antigravity')
    const isGemini = idLower.includes('gemini') || idLower === 'hydrogen' || idLower === 'argon'
    const isCpa = provLower === 'cliproxyapi'
    const isFlashOrPro = idLower.includes('flash') || idLower.includes('pro')

    const provider =
      item.provider ||
      (isCpa || idLower.includes('sol')
        ? 'cliproxyapi'
        : isAntigravity || isGemini
          ? 'antigravity'
          : 'codex')
    const providerName =
      provider === 'cliproxyapi'
        ? 'EasyCLIProxyAPI (CPA)'
        : isAntigravity || isGemini
          ? 'Google Antigravity (哈吉米)'
          : provider === 'deepseek'
            ? 'DeepSeek (深度求索 / Harness)'
            : provider === 'qwen'
              ? 'Alibaba Qwen (通义千问)'
              : provider === 'zhipu'
                ? 'Zhipu GLM (智谱清言)'
                : provider === 'kimi'
                  ? 'Moonshot Kimi (月之暗面)'
                  : provider === 'doubao'
                    ? 'ByteDance Doubao (字节豆包)'
                    : provider === 'siliconflow'
                      ? 'SiliconFlow (硅基流动)'
                      : 'OpenAI Codex / Compatible'
    const isTopRanked = isGemini && isFlashOrPro

    dynamicAdditions.push({
      id: item.id,
      name: isGemini ? `${item.name || item.id} · 哈吉米` : (item.name || item.id),
      provider,
      providerName,
      description: isGemini
        ? `默认搭载【哈吉米人设】动态发现模型 (${providerName})`
        : `宿主动态发现新上架模型 (${providerName})`,
      contextWindow: 1048576,
      maxTokens: 65536,
      isRecommended: true,
      isTopRanked,
      tag: isTopRanked ? '哈吉米 · 自动推荐' : '新模型',
    })
  }

  const topNew = dynamicAdditions.filter((m) => m.isTopRanked)
  const otherNew = dynamicAdditions.filter((m) => !m.isTopRanked)

  return [...topNew, ...baseModels, ...otherNew]
}

/**
 * Filter models by provider, query text, or recommendation status.
 */
export function filterCandidateModels(
  models: readonly CandidateModel[],
  options: {
    readonly provider?: string
    readonly query?: string
    readonly onlyRecommended?: boolean
    readonly onlyTopRanked?: boolean
  } = {},
): readonly CandidateModel[] {
  let result = models

  if (options.provider && options.provider.trim() !== '') {
    const p = options.provider.trim().toLowerCase()
    result = result.filter((m) => m.provider.toLowerCase() === p)
  }

  if (options.onlyTopRanked) {
    result = result.filter((m) => m.isTopRanked)
  } else if (options.onlyRecommended) {
    result = result.filter((m) => m.isRecommended)
  }

  if (options.query && options.query.trim() !== '') {
    const q = options.query.trim().toLowerCase()
    result = result.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.providerName.toLowerCase().includes(q) ||
        (m.description && m.description.toLowerCase().includes(q)),
    )
  }

  return result
}

/**
 * Static 3-state health check for member LLM selections.
 * Aligns with GR-04 honest boundary: Static verification without fabricated latency.
 */
export function validateMemberLlmSelections(
  provider: string,
  model: string,
  catalog?: readonly { id: string }[],
): ModelValidationResult {
  const normProvider = (provider ?? '').trim().toLowerCase()
  const normModel = (model ?? '').trim().toLowerCase()

  if (normProvider === '' || normModel === '') {
    return {
      status: 'error',
      message: '请选择供应商和模型',
    }
  }

  if (catalog === undefined || catalog.length === 0) return {
    status: 'warn', message: '🟡 空目录或目录未加载：未验证，仅候选推荐，不代表账号配置或推理连通。',
  }
  return catalog.some(candidate => candidate.id === model) ? {
    status: 'ok', message: '目录已就绪（仅本地目录命中，不代表推理连通）',
  } : { status: 'error', message: '未配置模型：当前供应商目录中未找到此型号。' }
}
