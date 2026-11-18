/**
 * AgentTeams Studio HTTP Backend & Static/SSE Server.
 * Preserves full DSH REST contract (/plugins/dsh-agent-teams/*), mandatory staged approval gate,
 * EasyCLIProxyAPI (/api/models, /api/teams/:id/run-next, /api/teams/:id/auto-run), and SSE live events.
 */

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, networkInterfaces, tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deleteCustomRadarItem,
  listRadarItems,
  refreshLiveRadarItems,
  restoreRadarItems,
  saveCustomRadarItem,
} from './ai-news-radar.mjs'
import { resolveTeamProfile } from './core/profiles.js'
import { PROMPT_TEMPLATES } from './core/prompt-templates.js'
import { inspectAndHealTeam } from './core/watchdog.js'
import {
  collectDesktopUsage,
  getStudioCoreRuntimeInfo,
  readDesktopConfig,
  readPortableMetadata,
  readThemeSelection,
  writeDesktopConfig,
  writeThemeSelection,
} from './desktop-manager.mjs'
import { installEcosystemTargets, inspectEcosystemStatus } from './ecosystem-installer.mjs'
import {
  discoverLocalCpaInstall,
  ensureCpaChannelRunning,
  probeCpaChannel,
} from '../channels/cpa/cpa-channel-manager.mjs'
import {
  askGrokBot,
  clearGrokBotHistory,
  deleteGrokHistoryItem,
  getGrokBotStatus,
  updateGrokBotConfig,
} from '../channels/grokbot/grok-bot-service.mjs'
import { createQQStore } from '../channels/qqbot/qq-store.mjs'
import { createQQRemoteService } from '../channels/qqbot/qq-remote-service.mjs'
import {
  archiveTeamDir,
  ArchiveResourceLockedError,
  createTeamDir,
  listArchivedTeamGenerations,
  readArchivedTeam,
  readTeam,
  removeTeamDir,
  sanitizeKey,
  teamLockKey,
  withTeamLock,
  writeTeam,
} from './core/state.js'
import {
  DEFAULT_CPA_API_KEY,
  DEFAULT_CPA_BASE_URL,
  DEFAULT_CPA_GPT_MODEL,
  fetchCpaModels,
  runCpaChatCompletion,
} from './cpa-client.mjs'
import { autoRunTeam, runNextReadyTask } from './cpa-runner.mjs'
import { createSandboxTools } from './sandbox.mjs'
import {
  deleteCustomManual,
  deleteCustomWidget,
  listCustomExtensions,
  restoreHiddenManuals,
  saveCustomManual,
  saveCustomWidget,
} from './extensions-store.mjs'
import { getKnowledgeManual, listKnowledgeManuals } from './ops-knowledge.mjs'
import {
  PROVIDER_META,
  deleteCustomProvider,
  deleteModelFromProvider,
  discoverProviderModels,
  getProviderRawConfig,
  listCustomProviders,
  pingModelEndpoint,
  restoreHiddenProviders,
  saveCustomProvider,
} from './model-providers-store.mjs'
import { assembleStudioSnapshot, collectStudioTeams } from './snapshot.mjs'
import {
  BUILTIN_VIDEO_PIPELINES,
  buildVideoTeamFromPipeline,
  deleteCustomVideoPipeline,
  deleteGeneratedGraphic,
  generateStudioGraphic,
  listVideoPipelines,
  probeLocalMediaEndpoint,
  restoreBuiltinVideoPipelines,
  saveCustomVideoPipeline,
  saveLocalMediaConfig,
} from './video-pipeline.mjs'
import {
  cleanupTaskWorktree,
  ensureTaskWorktree,
  inspectWorktreeDiff,
  isGitRepo,
  mergeTaskWorktree,
} from './worktree.mjs'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(MODULE_DIR, '..')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
}

const STATIC_CATALOG = {
  cliproxyapi: [
    { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol (CPA Default)' },
    { id: 'gpt-6-sol', name: 'GPT-6 Sol (CPA)' },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol (CPA)' },
    { id: 'gpt-6-astra', name: 'GPT-6 Astra (CPA)' },
    { id: 'codex-auto-review', name: 'Codex Auto Review (CPA)' },
  ],
  antigravity: [
    { id: 'gemini-3.8-flash-tiered', name: 'Gemini 3.8 Flash · 哈吉米 (审美/报告/督察推荐)' },
    { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High · 哈吉米' },
    { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash Medium · 哈吉米' },
    { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash Low · 哈吉米' },
    { id: 'hydrogen', name: 'Gemini Hydrogen · 哈吉米 (独立黑盒审查)' },
    { id: 'argon', name: 'Gemini 4 Argon Pro · 哈吉米 (高推理评测)' },
    { id: 'gemini-4-argon-high', name: 'Gemini 4 Argon High · 哈吉米' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  ],
  codex: [
    { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol (Codex / CPA)' },
    { id: 'gpt-6-sol', name: 'GPT-6 Sol (Codex / CPA)' },
    { id: 'gpt-6-astra', name: 'GPT-6 Astra (Codex / CPA)' },
    { id: 'codex-auto-review', name: 'Codex Auto Review' },
  ],
  dsh: [
    { id: 'gpt-6.1-sol', name: 'DSH Native · GPT-6.1 Sol' },
    { id: 'gemini-3.8-flash-tiered', name: 'DSH Native · Gemini 3.8 Flash (哈吉米)' },
    { id: 'hydrogen', name: 'DSH Native · Gemini Hydrogen' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek-V3 (deepseek-chat · DeepSeek Harness)' },
    { id: 'deepseek-reasoner', name: 'DeepSeek-R1 (deepseek-reasoner · 深度推理)' },
  ],
  'deepseek-harness': [
    { id: 'deepseek-chat', name: 'DeepSeek Harness · DeepSeek-V3' },
    { id: 'deepseek-reasoner', name: 'DeepSeek Harness · DeepSeek-R1' },
  ],
  qwen: [
    { id: 'qwen3-max', name: 'Qwen3-Max (通义千问旗舰)' },
    { id: 'qwen-coder-plus', name: 'Qwen-Coder-Plus (通义代码专家)' },
    { id: 'qwq-32b', name: 'QwQ-32B (通义深度思考)' },
  ],
  zhipu: [
    { id: 'glm-4.5', name: 'GLM-4.5 (智谱清言旗舰)' },
    { id: 'glm-4-plus', name: 'GLM-4-Plus (智谱全能)' },
  ],
  kimi: [
    { id: 'kimi-k2', name: 'Kimi-K2 (月之暗面万亿 MoE)' },
    { id: 'moonshot-v1-128k', name: 'Moonshot-v1-128k (长文本)' },
  ],
  doubao: [
    { id: 'doubao-1.5-pro-256k', name: 'Doubao-1.5-Pro-256k (字节豆包)' },
    { id: 'doubao-seed-1.6', name: 'Doubao-Seed-1.6 (火山方舟)' },
  ],
  siliconflow: [
    { id: 'Pro/deepseek-ai/DeepSeek-R1', name: 'DeepSeek-R1 Pro (硅基流动)' },
    { id: 'Pro/deepseek-ai/DeepSeek-V3', name: 'DeepSeek-V3 Pro (硅基流动)' },
    { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', name: 'Qwen2.5-Coder-32B (硅基流动)' },
  ],
  grok: [
    { id: 'grok-3', name: 'Grok-3 (xAI Grok Bot / grok-build 旗舰)' },
    { id: 'grok-3-mini-fast', name: 'Grok-3 Mini Fast (xAI 极速核查)' },
  ],
  zcode: [
    { id: 'glm-4.5', name: 'ZCode · GLM-4.5 (Coding Plan 主力)' },
    { id: 'glm-4.5-air', name: 'ZCode · GLM-4.5-Air (高速编码)' },
    { id: 'zcode-coder', name: 'ZCode Coder (智谱编码代理专属)' },
  ],
  opencode: [
    { id: 'claude-sonnet-4-6', name: 'OpenCode Zen · Claude Sonnet 4.6' },
    { id: 'gpt-5', name: 'OpenCode Zen · GPT-5' },
    { id: 'qwen3-coder', name: 'OpenCode Zen · Qwen3-Coder' },
  ],
  newapi: [
    { id: 'gpt-4o', name: 'NewAPI / OneAPI · GPT-4o (可一键拉取全站模型)' },
    { id: 'claude-3-7-sonnet-20250219', name: 'NewAPI / OneAPI · Claude 3.7 Sonnet' },
    { id: 'deepseek-r1', name: 'NewAPI / OneAPI · DeepSeek-R1' },
    { id: 'gemini-2.5-pro', name: 'NewAPI / OneAPI · Gemini 2.5 Pro' },
  ],
  openrouter: [
    { id: 'anthropic/claude-sonnet-4', name: 'OpenRouter · Claude Sonnet 4' },
    { id: 'openai/gpt-4.1', name: 'OpenRouter · GPT-4.1' },
    { id: 'google/gemini-2.5-pro', name: 'OpenRouter · Gemini 2.5 Pro' },
    { id: 'deepseek/deepseek-r1', name: 'OpenRouter · DeepSeek-R1' },
  ],
  aihubmix: [
    { id: 'claude-3-7-sonnet-latest', name: 'AiHubMix · Claude 3.7 Sonnet' },
    { id: 'gpt-4o', name: 'AiHubMix · GPT-4o' },
    { id: 'gemini-2.5-pro', name: 'AiHubMix · Gemini 2.5 Pro' },
  ],
  openai: [
    { id: 'gpt-4.1', name: 'OpenAI Official · GPT-4.1' },
    { id: 'gpt-4o', name: 'OpenAI Official · GPT-4o' },
    { id: 'o3-mini', name: 'OpenAI Official · o3-mini' },
  ],
  minimax: [
    { id: 'MiniMax-M1', name: 'MiniMax-M1 (稀宇百万上下文推理)' },
    { id: 'MiniMax-Text-01', name: 'MiniMax-Text-01 (超长上下文)' },
  ],
  ollama: [
    { id: 'qwen2.5-coder:32b', name: 'Local Ollama · Qwen2.5-Coder 32B' },
    { id: 'deepseek-r1:14b', name: 'Local Ollama · DeepSeek-R1 14B' },
  ],
}

class HttpFailure extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function readJsonBody(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > 2 * 1024 * 1024) throw new HttpFailure(413, 'Request body too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (raw === '') return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new HttpFailure(400, 'Invalid JSON body')
  }
}

function sendJson(res, status, data) {
  const payload = JSON.stringify(data)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

const QUICK_MODEL_TAGS = new Map([
  ['gpt-6.1-sol', { provider: 'cliproxyapi', model: 'gpt-6.1-sol', label: 'CPA GPT-6.1 Sol (推荐)' }],
  ['gpt-6-sol', { provider: 'cliproxyapi', model: 'gpt-6-sol', label: 'CPA GPT-6 Sol' }],
  ['gpt-5.6-sol', { provider: 'cliproxyapi', model: 'gpt-5.6-sol', label: 'CPA GPT-5.6 Sol' }],
  ['gpt-6-astra', { provider: 'cliproxyapi', model: 'gpt-6-astra', label: 'CPA GPT-6 Astra' }],
  ['codex-auto-review', { provider: 'cliproxyapi', model: 'codex-auto-review', label: 'CPA Codex Auto Review' }],
  ['hydrogen', { provider: 'antigravity', model: 'hydrogen', label: 'Gemini Hydrogen (独立黑盒审查)' }],
  ['argon', { provider: 'antigravity', model: 'argon', label: 'Gemini 4 Argon (高推理评测)' }],
  ['gemini-3.8-flash-tiered', { provider: 'antigravity', model: 'gemini-3.8-flash-tiered', label: 'Gemini 3.8 Flash' }],
  ['deepseek-chat', { provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek-V3 (DeepSeek Harness)' }],
  ['deepseek-reasoner', { provider: 'deepseek', model: 'deepseek-reasoner', label: 'DeepSeek-R1 (深度推理)' }],
  ['grok-3', { provider: 'grok', model: 'grok-3', label: 'xAI Grok-3 (Grok Bot / grok-build)' }],
  ['qwen3-max', { provider: 'qwen', model: 'qwen3-max', label: '通义千问 Qwen3-Max' }],
  ['glm-4.5', { provider: 'zhipu', model: 'glm-4.5', label: '智谱清言 GLM-4.5' }],
  ['kimi-k2', { provider: 'kimi', model: 'kimi-k2', label: '月之暗面 Kimi-K2' }],
])

const INDEPENDENT_GPT_REVIEWER_PROMPT = [
  '【独立身份 A · L2 白盒代码与架构逻辑审查官 (L2-WHITEBOX-GPT)】',
  '你拥有完全独立的白盒审查身份，与 Gemini Hydrogen 黑盒红队审查官相互独立、互不盲从。',
  '专注审查源码实现、类型契约、状态机不变量、并发锁与模块边界；禁止照搬其他审查员意见。',
  '若发现任何阻塞或高危逻辑缺陷，第一行输出 VERDICT: NEEDS_REVISION，并在后续行按 FINDING: F1 | high | <file> | <problem> | <requiredFix> 格式列出精准返工指示，系统将自动退回原作者返工修复。',
].join('\n')

const INDEPENDENT_HYDROGEN_REDTEAM_PROMPT = [
  '【独立身份 B · L3 黑盒红队与 UX/安全隔离审查官 (L3-REDTEAM-HYDROGEN)】',
  '你运行在 Gemini Hydrogen 路由上，拥有完全独立的黑盒红队与 UX 审计身份，与 GPT 白盒审查官物理隔离、独立裁决。',
  '专注审查安全沙箱隔离、审批门禁红线、UI/UX 规范一致性与异常边界证伪；严禁参考或附和 GPT 审查结论。',
  '若发现任何安全、规格或交互缺陷，第一行输出 VERDICT: NEEDS_REVISION，并在后续行按 FINDING: F1 | high | <file> | <problem> | <requiredFix> 格式列出精准返工指示，系统将自动退回原作者返工修复。',
].join('\n')

function buildQuickPresetSpec(presetKey, goalText) {
  const objective = goalText || '通过 @快捷模式 创建的多智能体协同任务'
  if (presetKey === 'chatgpt-crew') {
    return {
      key: 'chatgpt-crew',
      label: 'ChatGPT Crew 敏捷工程组 (CPA GPT-Sol + 哈吉米审美/撰稿)',
      members: [
        {
          name: 'researcher',
          role: '需求调研、技术取证与前端交互设计（哈吉米调研官）',
          provider: 'antigravity',
          model: 'gemini-3.8-flash-tiered',
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
          role: '全栈核心编码与命令行自测（CPA GPT-6.1-Sol）',
          provider: 'cliproxyapi',
          model: 'gpt-6.1-sol',
          executionPrompt: PROMPT_TEMPLATES.engineer,
        },
        {
          name: 'doc-writer',
          role: '交付报告与规范文档撰写（哈吉米撰稿官）',
          provider: 'antigravity',
          model: 'gemini-3.8-flash-tiered',
          executionPrompt: PROMPT_TEMPLATES.docWriter,
        },
      ],
      tasks: [
        { id: 't1', subject: '需求调研与接口设计', description: `围绕目标整理关键约束、同类软件审美参考与接口方案：${objective}`, assignee: 'researcher', dependencies: [] },
        { id: 't2', subject: '核心工程实现与自测', description: `按方案落地代码实现并执行核验：${objective}`, assignee: 'engineer', dependencies: ['t1'] },
        { id: 't3', subject: '集成验收与交付核对', description: '对照目标与执行证据完成端到端验收确认与报告汇编。', assignee: 'doc-writer', dependencies: ['t2'] },
      ],
    }
  }

  if (presetKey === 'heterogeneous-cross-review') {
    return {
      key: 'heterogeneous-cross-review',
      label: '异构交叉审查六角团队 (GPT + 哈吉米全阵容)',
      members: [
        {
          name: 'arch-planner',
          role: '系统架构师 (L1 需求与边界规格 · 哈吉米架构官)',
          provider: 'antigravity',
          model: 'hydrogen',
          executionPrompt: PROMPT_TEMPLATES.architect,
        },
        {
          name: 'core-engineer',
          role: '全栈核心工程实现 (CPA GPT-6.1-Sol)',
          provider: 'cliproxyapi',
          model: 'gpt-6.1-sol',
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
          role: 'L2 白盒审查官与质量守护（独立身份 A）',
          provider: 'cliproxyapi',
          model: 'gpt-6-sol',
          executionPrompt: INDEPENDENT_GPT_REVIEWER_PROMPT,
        },
        {
          name: 'audit-gemini',
          role: 'L3 黑盒红队终审官（独立身份 B · Hydrogen 哈吉米督察官）',
          provider: 'antigravity',
          model: 'hydrogen',
          executionPrompt: INDEPENDENT_HYDROGEN_REDTEAM_PROMPT,
        },
        {
          name: 'doc-writer',
          role: '交付文档与复盘撰稿人（哈吉米撰稿官）',
          provider: 'antigravity',
          model: 'gemini-3.8-flash-tiered',
          executionPrompt: PROMPT_TEMPLATES.docWriter,
        },
      ],
      tasks: [
        {
          id: 't1',
          kind: 'requirements',
          subject: 'L1 系统边界与契约拆解',
          description: `拆解范围、接口与验收门槛：${objective}`,
          objective: `明确系统边界与验收契约：${objective}`,
          inScope: ['src/', 'server/', 'docs/'],
          acceptance: ['完成系统架构边界与接口契约拆解'],
          assignee: 'arch-planner',
          dependencies: [],
        },
        {
          id: 't2',
          kind: 'implementation',
          subject: 'L2 核心工程实现与构建自检',
          description: `完成代码变更与构建测试：${objective}`,
          objective: `实现目标并通过验证：${objective}`,
          inScope: ['src/', 'server/'],
          acceptance: ['实现满足契约要求', '构建或测试命令通过'],
          verify: ['node --test tests/studio.test.mjs'],
          assignee: 'core-engineer',
          dependencies: ['t1'],
        },
        {
          id: 't3',
          kind: 'review',
          reviewedTaskId: 't2',
          subject: 'L2 GPT 独立白盒代码审查（身份 A）',
          description: '独立核查 t2 代码逻辑、错误语义与边界回归；不通过将自动派发返工修复。',
          objective: '从白盒架构与逻辑视角独立审查 t2',
          inScope: ['src/', 'server/'],
          acceptance: ['无未解决高危逻辑缺陷', '必要时输出 NEEDS_REVISION + FINDING 触发返工'],
          assignee: 'audit-gpt',
          dependencies: ['t2'],
        },
        {
          id: 't4',
          kind: 'review',
          reviewedTaskId: 't2',
          subject: 'L3 Hydrogen 独立黑盒红队复核（身份 B）',
          description: '使用 Hydrogen 独立身份对 t2 执行安全隔离、UX 一致性与反向证伪；不通过将自动派发返工修复。',
          objective: '从黑盒红队与安全 UX 视角独立盲审 t2',
          inScope: ['src/', 'server/'],
          acceptance: ['安全边界与反例验证通过', '必要时输出 NEEDS_REVISION + FINDING 触发返工'],
          assignee: 'audit-gemini',
          dependencies: ['t2'],
        },
        { id: 't5', subject: '文档收口与实战复盘', description: '汇总变更路径、双审证据、返工记录与交付说明。', assignee: 'doc-writer', dependencies: ['t3', 't4'] },
      ],
    }
  }

  if (presetKey === 'ai-radar-squad') {
    return {
      key: 'ai-radar-squad',
      label: 'AI Radar 调研评估编队 (CPA + 哈吉米全阵容)',
      members: [
        {
          name: 'researcher',
          role: '开源生态与竞品雷达调研员（哈吉米调研官）',
          provider: 'antigravity',
          model: 'hydrogen',
          executionPrompt: PROMPT_TEMPLATES.researcher,
        },
        {
          name: 'arch-planner',
          role: '系统架构师 (L1 需求与选型规划 · 哈吉米架构官)',
          provider: 'antigravity',
          model: 'gemini-3.8-flash-tiered',
          executionPrompt: PROMPT_TEMPLATES.architect,
        },
        {
          name: 'core-engineer',
          role: '原型工程与验证实现 (CPA GPT-6.1-Sol)',
          provider: 'cliproxyapi',
          model: 'gpt-6.1-sol',
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
          role: 'L2 白盒审查与对比验证（独立身份 A）',
          provider: 'cliproxyapi',
          model: 'gpt-6-sol',
          executionPrompt: INDEPENDENT_GPT_REVIEWER_PROMPT,
        },
        {
          name: 'audit-gemini',
          role: 'L3 黑盒红队验证官（独立身份 B · Hydrogen 哈吉米督察官）',
          provider: 'antigravity',
          model: 'hydrogen',
          executionPrompt: INDEPENDENT_HYDROGEN_REDTEAM_PROMPT,
        },
        {
          name: 'doc-writer',
          role: '雷达评估报告撰稿人（哈吉米撰稿官）',
          provider: 'antigravity',
          model: 'gemini-3.8-flash-tiered',
          executionPrompt: PROMPT_TEMPLATES.docWriter,
        },
      ],
      tasks: [
        {
          id: 't1',
          kind: 'requirements',
          subject: '先期生态调研与候选选型',
          description: `调研现状、竞品与可行技术路径：${objective}`,
          objective: `完成先期生态调研：${objective}`,
          inScope: ['src/', 'server/', 'scripts/', 'docs/'],
          acceptance: ['输出调研现状与候选选型结论'],
          assignee: 'researcher',
          dependencies: [],
        },
        {
          id: 't2',
          kind: 'requirements',
          subject: 'L1 评估框架与架构规划',
          description: '结合调研报告明确验证指标与工程范围。',
          objective: '明确验证指标与工程范围',
          inScope: ['src/', 'server/', 'scripts/', 'docs/'],
          acceptance: ['完成 L1 评估指标与架构规划'],
          assignee: 'arch-planner',
          dependencies: ['t1'],
        },
        {
          id: 't3',
          kind: 'implementation',
          subject: '核心原型实现与基准实测',
          description: `落地关键验证代码并收集实测数据：${objective}`,
          objective: `完成原型实现与实测：${objective}`,
          inScope: ['src/', 'server/', 'scripts/', 'docs/'],
          acceptance: ['原型与实测数据落盘', '验证命令退出码为 0'],
          verify: ['node --test tests/studio.test.mjs'],
          assignee: 'core-engineer',
          dependencies: ['t2'],
        },
        {
          id: 't4',
          kind: 'review',
          reviewedTaskId: 't3',
          subject: 'L2 白盒复核与指标审计（身份 A）',
          description: '独立核查实现准确性与指标一致性；发现问题触发返工修复。',
          objective: '白盒核查 t3 实现与指标真实性',
          inScope: ['src/', 'server/', 'scripts/', 'docs/'],
          acceptance: ['白盒逻辑与数据口径一致'],
          assignee: 'audit-gpt',
          dependencies: ['t3'],
        },
        {
          id: 't5',
          kind: 'review',
          reviewedTaskId: 't3',
          subject: 'L3 Hydrogen 红队交叉终审（身份 B）',
          description: '独立身份执行反例测试与结论真实性盲审；发现问题触发返工修复。',
          objective: '黑盒红队复核 t3 边界与结论可靠性',
          inScope: ['src/', 'server/', 'scripts/', 'docs/'],
          acceptance: ['无未解决高危与反例漏洞'],
          assignee: 'audit-gemini',
          dependencies: ['t3'],
        },
        { id: 't6', subject: '调研评估报告与交付归档', description: '汇总最终评估报告与产物清单。', assignee: 'doc-writer', dependencies: ['t4', 't5'] },
      ],
    }
  }

  if (presetKey === 'novixlink-ops') {
    return {
      key: 'novixlink-ops',
      label: 'NovixLink VPS 运维与排障组 (zkl & v4.3 手册挂载)',
      knowledgeIds: ['vps-zkl-novixlink'],
      members: [
        {
          name: 'ops-diagnostician',
          role: 'NovixLink 运维诊断官（哈吉米 · 熟悉 zkl / novixlink v4.3 SOP）',
          provider: 'antigravity',
          model: 'gemini-3.8-flash-tiered',
          executionPrompt: PROMPT_TEMPLATES.researcher,
        },
        {
          name: 'ops-engineer',
          role: 'VPS 排障与脚本工程师 (CPA GPT-6.1-Sol)',
          provider: 'cliproxyapi',
          model: 'gpt-6.1-sol',
          executionPrompt: PROMPT_TEMPLATES.engineer,
        },
        {
          name: 'audit-gemini',
          role: 'RBAC 边界与排障结论独立复核官（Hydrogen 哈吉米）',
          provider: 'antigravity',
          model: 'hydrogen',
          executionPrompt: INDEPENDENT_HYDROGEN_REDTEAM_PROMPT,
        },
      ],
      tasks: [
        {
          id: 't1',
          kind: 'requirements',
          subject: '对照 v4.3 手册梳理症状与诊断路径',
          description: `依据 VPS 统一监控主控中心 v4.3（zkl & novixlink）SOP，拆解用户问题、核对双账号 RBAC 权限与带宽防护阈值：${objective}`,
          objective: `明确 ${objective} 的归因方向、允许账号视角与诊断指令`,
          inScope: ['docs/', 'scratch/'],
          acceptance: ['已对照 v4.3 手册确认账号权限边界与症状分类'],
          assignee: 'ops-diagnostician',
          dependencies: [],
        },
        {
          id: 't2',
          kind: 'implementation',
          subject: '输出可执行的排障方案与指令清单',
          description: `针对目标输出分步骤 Telegram (@VpsPingBellBot) 与 Web 控制台排障操作指引及验证要点：${objective}`,
          objective: `完成 NovixLink 排障方案落盘：${objective}`,
          inScope: ['docs/', 'scratch/'],
          acceptance: ['严格遵守 zkl / novixlink 权限边界', '涵盖 ×2 计费、CST 时区与限速恢复说明'],
          verify: ['node --test tests/studio.test.mjs'],
          assignee: 'ops-engineer',
          dependencies: ['t1'],
        },
        {
          id: 't3',
          kind: 'review',
          reviewedTaskId: 't2',
          subject: '独立复核 RBAC 边界与排障准确性',
          description: '独立核查 t2 方案是否越权暴露 root 信息、是否错误建议连续盲试密码（10 分钟 5 次锁 15 分钟）以及限速解限步骤是否准确。',
          objective: '核验 t2 排障方案与 v4.3 手册契约完全一致',
          inScope: ['docs/', 'scratch/'],
          acceptance: ['RBAC 与防爆破规则零违规', '排障步骤与指令完整准确'],
          assignee: 'audit-gemini',
          dependencies: ['t2'],
        },
      ],
    }
  }

  if (
    presetKey === 'video-studio' ||
    presetKey === 'graphic-studio' ||
    presetKey === 'vimax-gemini-gpt-studio' ||
    presetKey === 'bilibili-youtube-industrial-film' ||
    presetKey === 'pixel-lyric-mv-pipeline' ||
    presetKey === 'shortgpt-story-video' ||
    presetKey === 'gpt-character-sheet-studio' ||
    presetKey === 'gpt-brand-ui-poster-studio' ||
    presetKey === 'gpt-pixel-game-assets-studio'
  ) {
    const targetId =
      presetKey === 'video-studio'
        ? 'vimax-gemini-gpt-studio'
        : presetKey === 'graphic-studio'
          ? 'gpt-character-sheet-studio'
          : presetKey
    const pipe = BUILTIN_VIDEO_PIPELINES.find((p) => p.id === targetId) || BUILTIN_VIDEO_PIPELINES[0]
    const built = buildVideoTeamFromPipeline(pipe, objective)
    return {
      ...built,
      key: presetKey,
    }
  }

  // studio-default (matches native Studio topology with independent dual reviewers, Hydrogen, and permanent Hajimi aesthetic & doc officers)
  return {
    key: 'studio-default',
    label: 'Studio 标准异构工作组 (GPT-6.1-Sol + 哈吉米审美/红队)',
    members: [
      {
        name: 'gpt-engineer',
        role: '全栈工程实现（负责所有工程编码与业务逻辑）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
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
        name: 'doc-writer',
        role: '交付报告与规范文档撰写（哈吉米撰稿官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        executionPrompt: PROMPT_TEMPLATES.docWriter,
      },
      {
        name: 'gpt-reviewer',
        role: 'L2 独立白盒架构与代码审查官（身份 A · 独立裁决与返工派发）',
        provider: 'cliproxyapi',
        model: 'gpt-6-sol',
        executionPrompt: INDEPENDENT_GPT_REVIEWER_PROMPT,
      },
      {
        name: 'gemini-redteam',
        role: 'L3 独立黑盒红队与 UX/安全隔离审查官（身份 B · Hydrogen 哈吉米独立盲审）',
        provider: 'antigravity',
        model: 'hydrogen',
        executionPrompt: INDEPENDENT_HYDROGEN_REDTEAM_PROMPT,
      },
    ],
    tasks: [
      {
        id: 't1',
        kind: 'implementation',
        subject: '系统重构与架构迁移',
        description: `核实关键模块边界并启动后端服务端实现：${objective}`,
        objective: `完成服务端实现：${objective}`,
        inScope: ['server/', 'scripts/', 'tests/'],
        acceptance: ['服务端模块边界清晰且通过单测'],
        verify: ['node --test tests/studio.test.mjs'],
        assignee: 'gpt-engineer',
        dependencies: [],
      },
      {
        id: 't4',
        kind: 'implementation',
        subject: 'UI/UX 与核心功能开发',
        description: `完成前端交互与视觉工作台功能落地：${objective}`,
        objective: `完成前端 UI/UX 变更并构建通过：${objective}`,
        inScope: ['src/'],
        acceptance: ['前端交互无误且构建成功'],
        verify: ['node ./node_modules/vite/bin/vite.js build'],
        assignee: 'gpt-engineer',
        dependencies: ['t1'],
      },
      {
        id: 't5',
        kind: 'review',
        reviewedTaskId: 't1',
        subject: 't1 独立盲审（Hydrogen 红队·安全与架构逻辑）',
        description: '由 gemini-redteam (hydrogen) 以独立身份 B 审查 t1，严禁参考其他审核员结论；不通过输出 VERDICT: NEEDS_REVISION 触发自动返工。',
        objective: '使用 Hydrogen 对 t1 执行独立黑盒与安全边界盲审',
        inScope: ['server/', 'scripts/', 'tests/'],
        acceptance: ['t1 核心架构与沙箱状态流转无高危缺陷'],
        assignee: 'gemini-redteam',
        dependencies: ['t1'],
      },
      {
        id: 't3',
        kind: 'review',
        reviewedTaskId: 't4',
        subject: 'Gemini Hydrogen 安全隔离与 UX 红队验证',
        description: '由 gemini-redteam (hydrogen) 对 t4 前端审批门禁、隔离边界与 UX 一致性执行独立证伪。',
        objective: '使用 Hydrogen 对 t4 执行独立红队与 UX 验证',
        inScope: ['src/'],
        acceptance: ['UI 审批红线与展示一致性验证通过'],
        assignee: 'gemini-redteam',
        dependencies: ['t4'],
      },
      {
        id: 't6',
        kind: 'review',
        reviewedTaskId: 't4',
        subject: 't4 独立盲审（GPT 白盒·代码规范与逻辑）',
        description: '由 gpt-reviewer 以独立身份 A 审查 t4 前端逻辑与类型安全，严禁照搬 Hydrogen 结论；不通过自动触发返工修复。',
        objective: '使用 GPT 白盒对 t4 代码规范与状态逻辑执行独立盲审',
        inScope: ['src/'],
        acceptance: ['t4 状态更新与代码逻辑无高危缺陷'],
        assignee: 'gpt-reviewer',
        dependencies: ['t4'],
      },
      {
        id: 't2',
        kind: 'review',
        reviewedTaskId: 't1',
        subject: '架构安全性与独立性综合审计',
        description: '由 gpt-reviewer 在双独立审查（及所有触发的返工修复）闭环完成后执行最终交付审计。',
        objective: '综合复核全链路门禁、双审闭环与产物 SHA256 一致性',
        inScope: ['server/', 'src/'],
        acceptance: ['双独立审查闭环全部通过且无未解决高危项'],
        assignee: 'gpt-reviewer',
        dependencies: ['t1', 't5', 't4', 't6', 't3'],
      },
    ],
  }
}

const PRESET_ALIAS_MAP = new Map([
  ['studio-default', 'studio-default'],
  ['studio', 'studio-default'],
  ['agent-teams-studio', 'studio-default'],
  ['chatgpt-crew', 'chatgpt-crew'],
  ['heterogeneous-cross-review', 'heterogeneous-cross-review'],
  ['ai-radar-squad', 'ai-radar-squad'],
  ['novixlink-ops', 'novixlink-ops'],
  ['vps-ops', 'novixlink-ops'],
  ['video-studio', 'video-studio'],
  ['graphic-studio', 'graphic-studio'],
  ['bilibili-film', 'bilibili-youtube-industrial-film'],
  ['bilibili-youtube-industrial-film', 'bilibili-youtube-industrial-film'],
  ['vimax', 'vimax-gemini-gpt-studio'],
  ['vimax-gemini-gpt-studio', 'vimax-gemini-gpt-studio'],
  ['pixel-lyric-mv', 'pixel-lyric-mv-pipeline'],
  ['pixel-lyric-mv-pipeline', 'pixel-lyric-mv-pipeline'],
  ['shortgpt', 'shortgpt-story-video'],
  ['shortgpt-story-video', 'shortgpt-story-video'],
  ['gpt-character-sheet-studio', 'gpt-character-sheet-studio'],
  ['gpt-brand-ui-poster-studio', 'gpt-brand-ui-poster-studio'],
  ['gpt-pixel-game-assets-studio', 'gpt-pixel-game-assets-studio'],
  ['grok-bot', 'ai-radar-squad'],
  ['deepseek-harness', 'studio-default'],
  ['bv1rpwd6nepp', 'studio-default'],
])

function buildQuickPresetsMetadata() {
  return {
    presets: [
      { tag: '@studio-default', key: 'studio-default', label: 'Studio 3人全栈 (GPT-6.1-Sol + Gemini)' },
      { tag: '@video-studio', key: 'video-studio', label: '🎬 AI 视频制作工坊 (Gemini 导演合成 + GPT 生图)' },
      { tag: '@graphic-studio', key: 'graphic-studio', label: '🎨 AI 图形工坊 (GPT Image 2.6 角色三视图与海报)' },
      { tag: '@chatgpt-crew', key: 'chatgpt-crew', label: 'ChatGPT Crew 敏捷双人组' },
      { tag: '@heterogeneous-cross-review', key: 'heterogeneous-cross-review', label: '异构交叉审查五角团队' },
      { tag: '@ai-radar-squad', key: 'ai-radar-squad', label: 'AI Radar & Grok Bot 调研评估编队' },
      { tag: '@novixlink-ops', key: 'novixlink-ops', label: 'NovixLink VPS 运维与排障组 (v4.3)' },
    ],
    models: [...QUICK_MODEL_TAGS.entries()].map(([id, meta]) => ({
      tag: `@${id}`,
      id,
      provider: meta.provider,
      label: meta.label,
    })),
    examples: [
      '@studio-default @gpt-6.1-sol 开发用户认证与会话刷新模块',
      '@chatgpt-crew @gpt-6.1-sol 梳理当前仓库架构并补充单测',
      '@heterogeneous-cross-review 审计服务端并发锁与沙箱隔离边界',
      '@gpt-engineer 为控制台增加导出团队快照 JSON 按钮',
    ],
  }
}

function parseQuickCommandInput(rawInput, explicitPreset) {
  const mentionTags = []
  const cleaned = String(rawInput ?? '')
    .replace(/@([a-zA-Z0-9._-]+)/gu, (_match, token) => {
      mentionTags.push(token.toLowerCase())
      return ' '
    })
    .replace(/\s+/gu, ' ')
    .trim()

  let presetKey = explicitPreset ? (PRESET_ALIAS_MAP.get(String(explicitPreset).toLowerCase()) ?? '') : ''
  let modelTag = ''
  const unknownTags = []

  for (const tag of mentionTags) {
    if (PRESET_ALIAS_MAP.has(tag)) {
      if (!presetKey) presetKey = PRESET_ALIAS_MAP.get(tag)
    } else if (QUICK_MODEL_TAGS.has(tag)) {
      modelTag = tag
    } else {
      unknownTags.push(tag)
    }
  }

  return { mentionTags, presetKey, modelTag, unknownTags, cleanText: cleaned }
}

function deriveQuickTeamName(presetKey, cleanText) {
  const prefixMap = {
    'studio-default': 'Quick-Studio',
    'chatgpt-crew': 'Quick-Crew',
    'heterogeneous-cross-review': 'Quick-CrossReview',
    'ai-radar-squad': 'Quick-Radar',
    'novixlink-ops': 'Quick-NovixLink',
  }
  const prefix = prefixMap[presetKey] || 'Quick-Team'
  if (!cleanText) return prefix
  const compact = cleanText
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .trim()
    .split(/\s+/u)
    .slice(0, 3)
    .join('-')
    .slice(0, 22)
  return compact ? `${prefix}-${compact}` : prefix
}

function isCyclicTaskGraph(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const state = new Map()
  const visit = (id) => {
    const s = state.get(id)
    if (s === 1) return true
    if (s === 2) return false
    state.set(id, 1)
    const t = byId.get(id)
    if (t && Array.isArray(t.dependencies)) {
      for (const dep of t.dependencies) {
        if (byId.has(dep) && visit(dep)) return true
      }
    }
    state.set(id, 2)
    return false
  }
  return tasks.some((t) => visit(t.id))
}

export function createStudioServer({
  workspaceRoot = process.cwd(),
  packageRoot = PACKAGE_ROOT,
  cpaBaseUrl = DEFAULT_CPA_BASE_URL,
  cpaApiKey = DEFAULT_CPA_API_KEY,
  mockExecutor,
  qqbotDataDir,
  qqbotGatewayFactory,
} = {}) {
  const absWorkspace = resolve(workspaceRoot)
  const stateRoot = join(absWorkspace, '.agent-teams')
  const assetsRoot = join(packageRoot, 'public', 'plugins', 'dsh-agent-teams', 'assets')
  const distRoot = join(packageRoot, 'dist')

  const sseClients = new Set()
  const logsByTeam = new Map()
  const activeAutoRuns = new Set()

  const broadcastSse = (eventName, payload) => {
    if (sseClients.size === 0) return
    const wire = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`
    for (const res of sseClients) {
      try {
        res.write(wire)
      } catch {
        sseClients.delete(res)
      }
    }
  }

  const recordLog = (entry) => {
    const full = { id: randomUUID(), ...entry }
    if (entry.teamId) {
      const existing = logsByTeam.get(entry.teamId) ?? []
      const next = [...existing.slice(-199), full]
      logsByTeam.set(entry.teamId, next)
    }
    broadcastSse('log', full)
  }

  const broadcastSnapshots = async () => {
    if (sseClients.size === 0) return
    try {
      const [teams, archivedTeams] = await Promise.all([
        collectStudioTeams(absWorkspace, { archived: false }),
        collectStudioTeams(absWorkspace, { archived: true }),
      ])
      broadcastSse('snapshot', { teams, archivedTeams })
    } catch {}
  }

  const triggerBackgroundAutoRun = (targetTeamId, reasonLabel = '') => {
    if (!targetTeamId || activeAutoRuns.has(targetTeamId)) return false
    activeAutoRuns.add(targetTeamId)
    recordLog({
      teamId: targetTeamId,
      level: 'info',
      timestamp: new Date().toISOString(),
      message: reasonLabel || '已自动启动 CPA 任务调度引擎，按 DAG 依赖顺序执行就绪任务…',
    })
    void Promise.resolve()
      .then(() =>
        autoRunTeam({
          workspaceRoot: absWorkspace,
          teamId: targetTeamId,
          cpaBaseUrl,
          cpaApiKey,
          mockExecutor,
          onLog: recordLog,
          onSnapshot: broadcastSnapshots,
        }),
      )
      .catch((err) => {
        recordLog({
          teamId: targetTeamId,
          level: 'error',
          timestamp: new Date().toISOString(),
          message: `自动调度异常终止: ${err instanceof Error ? err.message : String(err)}（看门狗将在下一周期自动巡检恢复）`,
        })
      })
      .finally(() => {
        activeAutoRuns.delete(targetTeamId)
      })
    return true
  }

  let watchdogScanning = false
  let lastWatchdogSummary = { timestamp: Date.now(), reports: [] }

  const runWatchdogScan = async ({ manual = false, targetTeamId = '' } = {}) => {
    if (watchdogScanning) return lastWatchdogSummary
    watchdogScanning = true
    const reports = []
    try {
      const entries = await readdir(stateRoot, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'archive' || entry.name.startsWith('.')) continue
        const tid = entry.name.toLowerCase()
        if (targetTeamId && tid !== targetTeamId.toLowerCase()) continue
        const isRunningNow = activeAutoRuns.has(tid)
        const report = await inspectAndHealTeam(stateRoot, tid, {
          stallThresholdMs: manual ? 15000 : 45000,
          readyTimeoutMs: manual ? 1000 : 8000,
          activityOf: () => (isRunningNow ? 'running' : 'absent'),
        })
        reports.push(report)
        if (report.healedCount > 0) {
          recordLog({
            teamId: tid,
            level: 'info',
            timestamp: new Date().toISOString(),
            message: `🐕 [Watchdog 看门狗自愈] 已回收 ${report.healedCount} 项超时/中断任务并重置为待调度状态。`,
          })
          await broadcastSnapshots()
        }
        if ((report.needsKick || manual) && !activeAutoRuns.has(tid) && !mockExecutor) {
          const team = await readTeam(stateRoot, tid)
          if (team && team.phase === 'running' && !team.halted && !team.escalated) {
            const hasReady = team.tasks.some((t) => {
              if (t.status !== 'pending' && t.status !== 'open') return false
              if (t.holdReason) return false
              const deps = Array.isArray(t.dependencies) ? t.dependencies : []
              return deps.every((d) => team.tasks.find((x) => x.id === d)?.status === 'completed')
            })
            if (hasReady) {
              triggerBackgroundAutoRun(
                tid,
                '🐕 [Watchdog 看门狗巡检唤醒] 检测到 running 团队存在就绪待办任务，已自动拉起调度引擎继续执行…',
              )
            }
          }
        }
      }
      lastWatchdogSummary = { timestamp: Date.now(), reports }
      return lastWatchdogSummary
    } finally {
      watchdogScanning = false
    }
  }

  if (!mockExecutor) {
    const watchdogTimer = setInterval(() => {
      void runWatchdogScan().catch(() => {})
    }, 10000)
    watchdogTimer.unref()
  }

  async function allocateUniqueTeamId(baseName) {
    const base = sanitizeKey(baseName) || 'team'
    if (base !== 'archive' && !existsSync(join(stateRoot, base))) return base
    for (let i = 2; i < 100; i++) {
      const candidate = `${base}-${i}`
      if (!existsSync(join(stateRoot, candidate))) return candidate
    }
    return `${base}-${Date.now()}`
  }

  async function handlePlanMutation(payload) {
    const teamId = typeof payload.teamId === 'string' ? payload.teamId.trim() : ''
    const action = typeof payload.action === 'string' ? payload.action.trim() : ''
    if (!teamId || !action) throw new HttpFailure(400, 'teamId and action are required')

    const result = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
      const team = await readTeam(stateRoot, teamId)
      if (!team) throw new HttpFailure(404, `团队不存在: ${teamId}`)

      if (action === 'discard') {
        await removeTeamDir(stateRoot, teamId)
        return { ok: true, action: 'discard', teamId }
      }

      if (team.phase !== 'staged') {
        throw new HttpFailure(409, `仅待审批团队 (phase=staged) 支持计划变更或审批，当前为 ${team.phase}`)
      }

      const now = Date.now()
      let nextTeam = { ...team, updatedAt: now }

      if (action === 'continue') {
        nextTeam.planReviewState = 'awaiting_feedback'
        await writeTeam(stateRoot, nextTeam)
        return { ok: true, action, team: nextTeam }
      }

      if (action === 'approve') {
        if (team.members.length === 0 || team.tasks.length === 0) {
          throw new HttpFailure(400, '至少需要 1 名成员和 1 项任务才可确认并启动团队')
        }
        nextTeam = {
          ...team,
          phase: 'running',
          halted: false,
          approvedAt: now,
          updatedAt: now,
          members: team.members.map((m) => ({
            ...m,
            id: m.id || randomUUID(),
            status: 'idle',
          })),
        }
        delete nextTeam.planReviewState
        delete nextTeam.haltedAt
        await writeTeam(stateRoot, nextTeam)
        recordLog({
          teamId,
          level: 'success',
          timestamp: new Date().toISOString(),
          message: `用户已确认计划，团队「${team.name}」正式从 staged 进入 running 状态 (${team.members.length} 名成员, ${team.tasks.length} 项任务)。`,
        })
        return { ok: true, action, team: nextTeam }
      }

      if (action === 'update_member') {
        const memberName = String(payload.memberName ?? '').trim()
        const idx = team.members.findIndex((m) => m.name === memberName)
        if (idx < 0) throw new HttpFailure(404, `成员不存在: ${memberName}`)
        const cur = team.members[idx]
        const updated = {
          ...cur,
          ...(payload.role !== undefined ? { role: String(payload.role).trim() } : {}),
          ...(payload.provider !== undefined && String(payload.provider).trim() !== ''
            ? { provider: String(payload.provider).trim() }
            : {}),
          ...(payload.model !== undefined && String(payload.model).trim() !== ''
            ? { model: String(payload.model).trim() }
            : {}),
          ...(payload.reasoningEffort !== undefined
            ? String(payload.reasoningEffort).trim() === '' || payload.reasoningEffort === 'default'
              ? { reasoningEffort: undefined }
              : { reasoningEffort: String(payload.reasoningEffort).trim() }
            : {}),
          ...(payload.executionPrompt !== undefined
            ? { executionPrompt: String(payload.executionPrompt) }
            : {}),
        }
        if (updated.reasoningEffort === undefined) delete updated.reasoningEffort
        nextTeam.members = team.members.map((m, i) => (i === idx ? updated : m))
        await writeTeam(stateRoot, nextTeam)
        return { ok: true, action, team: nextTeam }
      }

      if (action === 'add_member') {
        const memberName = String(payload.memberName ?? '').trim()
        if (!memberName) throw new HttpFailure(400, '成员名称不能为空')
        if (team.members.some((m) => m.name === memberName)) {
          throw new HttpFailure(409, `成员名称已存在: ${memberName}`)
        }
        const member = {
          id: randomUUID(),
          name: memberName,
          role: String(payload.role ?? '').trim() || '协同执行成员',
          provider: String(payload.provider ?? '').trim() || 'cliproxyapi',
          model: String(payload.model ?? '').trim() || DEFAULT_CPA_GPT_MODEL,
          ...(payload.reasoningEffort && payload.reasoningEffort !== 'default'
            ? { reasoningEffort: String(payload.reasoningEffort).trim() }
            : {}),
          ...(payload.executionPrompt ? { executionPrompt: String(payload.executionPrompt) } : {}),
          status: 'idle',
          joinedAt: now,
        }
        nextTeam.members = [...team.members, member]
        await writeTeam(stateRoot, nextTeam)
        return { ok: true, action, team: nextTeam }
      }

      if (action === 'add_task') {
        const subject = String(payload.subject ?? '').trim()
        if (!subject) throw new HttpFailure(400, '任务标题不能为空')
        const seq = (team.taskSeq ?? team.tasks.length) + 1
        let id = `t${seq}`
        const usedIds = new Set(team.tasks.map((t) => t.id))
        let n = seq
        while (usedIds.has(id)) {
          n += 1
          id = `t${n}`
        }
        const deps = Array.isArray(payload.dependencies)
          ? payload.dependencies.map((d) => String(d).trim()).filter((d) => d !== '' && usedIds.has(d))
          : []
        const newTask = {
          id,
          subject,
          ...(payload.description ? { description: String(payload.description).trim() } : {}),
          status: 'pending',
          assignee: String(payload.assignee ?? '').trim() || team.members[0]?.name || '',
          dependencies: deps,
          createdAt: now,
          updatedAt: now,
        }
        if (!newTask.assignee) delete newTask.assignee
        nextTeam.taskSeq = n
        nextTeam.tasks = [...team.tasks, newTask]
        await writeTeam(stateRoot, nextTeam)
        return { ok: true, action, team: nextTeam }
      }

      if (action === 'update_task') {
        const taskId = String(payload.taskId ?? '').trim()
        const idx = team.tasks.findIndex((t) => t.id === taskId)
        if (idx < 0) throw new HttpFailure(404, `任务不存在: ${taskId}`)
        const cur = team.tasks[idx]
        const deps = Array.isArray(payload.dependencies)
          ? payload.dependencies.map((d) => String(d).trim()).filter((d) => d !== '' && d !== taskId)
          : cur.dependencies
        const updatedTask = {
          ...cur,
          ...(payload.subject !== undefined ? { subject: String(payload.subject).trim() || cur.subject } : {}),
          ...(payload.description !== undefined
            ? String(payload.description).trim() === ''
              ? { description: undefined }
              : { description: String(payload.description).trim() }
            : {}),
          ...(payload.assignee !== undefined
            ? String(payload.assignee).trim() === ''
              ? { assignee: undefined }
              : { assignee: String(payload.assignee).trim() }
            : {}),
          dependencies: deps,
          updatedAt: now,
        }
        if (updatedTask.description === undefined) delete updatedTask.description
        if (updatedTask.assignee === undefined) delete updatedTask.assignee
        const nextTasks = team.tasks.map((t, i) => (i === idx ? updatedTask : t))
        if (isCyclicTaskGraph(nextTasks)) {
          throw new HttpFailure(400, '任务依赖包含环，请检查前置依赖设置')
        }
        nextTeam.tasks = nextTasks
        await writeTeam(stateRoot, nextTeam)
        return { ok: true, action, team: nextTeam }
      }

      if (action === 'remove_task') {
        const taskId = String(payload.taskId ?? '').trim()
        nextTeam.tasks = team.tasks
          .filter((t) => t.id !== taskId)
          .map((t) => ({
            ...t,
            dependencies: (t.dependencies ?? []).filter((dep) => dep !== taskId),
          }))
        await writeTeam(stateRoot, nextTeam)
        return { ok: true, action, team: nextTeam }
      }

      throw new HttpFailure(400, `不支持的 plan action: ${action}`)
    })

    await broadcastSnapshots()
    if (action === 'approve' && !mockExecutor && payload.autoRun !== false) {
      triggerBackgroundAutoRun(teamId)
    }
    return result
  }

  async function createStagedTeam({ name, goal, members, tasks, captainSessionId, sourceLabel, knowledgeIds }) {
    const profileMembers = members.map((raw) => ({
      name: String(raw.name ?? '').trim(),
      role: String(raw.role ?? '').trim() || '执行成员',
      provider: String(raw.provider ?? '').trim() || 'cliproxyapi',
      model: String(raw.model ?? '').trim() || DEFAULT_CPA_GPT_MODEL,
      ...(raw.reasoningEffort && raw.reasoningEffort !== 'default'
        ? { reasoning_effort: String(raw.reasoningEffort).trim() }
        : {}),
      ...(raw.executionPrompt ? { executionPrompt: String(raw.executionPrompt) } : {}),
      ...(Array.isArray(raw.capabilities) && raw.capabilities.length > 0
        ? { capabilities: raw.capabilities }
        : {}),
      ...(Array.isArray(raw.noAssign) && raw.noAssign.length > 0
        ? { noAssign: raw.noAssign }
        : {}),
    }))
    const profileTasks = Array.isArray(tasks) && tasks.length > 0
      ? tasks
      : [{ id: 'task-1', subject: '需求拆解与核心实现', assignee: profileMembers[0].name, dependencies: [] }]

    let resolved
    try {
      resolved = resolveTeamProfile({ request: { members: profileMembers, tasks: profileTasks } }, 'request', 8)
    } catch (err) {
      throw new HttpFailure(400, err instanceof Error ? err.message : String(err))
    }

    const teamId = await allocateUniqueTeamId(name)
    const session = String(captainSessionId ?? '').trim() || 'antigravity-captain'
    const now = Date.now()
    const state = {
      id: teamId,
      name,
      description: goal,
      captainSessionId: session,
      ...(Array.isArray(knowledgeIds) && knowledgeIds.length > 0 ? { knowledgeIds } : {}),
      createdAt: now,
      updatedAt: now,
      phase: 'staged',
      planReviewState: 'awaiting_review',
      taskSeq: resolved.tasks.length,
      members: resolved.members.map((m) => ({
        id: randomUUID(),
        name: m.name,
        role: m.role,
        provider: m.provider,
        model: m.model,
        ...(m.reasoning_effort ? { reasoningEffort: m.reasoning_effort } : {}),
        ...(m.executionPrompt ? { executionPrompt: m.executionPrompt } : {}),
        ...(m.capabilities ? { capabilities: m.capabilities } : {}),
        ...(m.noAssign ? { noAssign: m.noAssign } : {}),
        status: 'idle',
        joinedAt: now,
      })),
      tasks: resolved.tasks.map((t) => ({
        ...t,
        status: 'pending',
        dependencies: t.dependencies ?? [],
        createdAt: now,
        updatedAt: now,
      })),
    }

    await createTeamDir(stateRoot, state)
    recordLog({
      teamId,
      level: 'info',
      timestamp: new Date().toISOString(),
      message: `${sourceLabel || '已创建'}待审批团队「${name}」(${state.members.length} 名成员, ${state.tasks.length} 项任务)，等待点击「确认并启动团队」。`,
    })
    await broadcastSnapshots()
    const snap = await assembleStudioSnapshot(absWorkspace, state)
    return { status: 'awaiting_approval', teamId, sessionId: session, team: snap }
  }

  async function handleQuickCommand(payload = {}) {
    const rawInput = String(payload.input ?? '').trim()
    const explicitPreset = typeof payload.preset === 'string' ? payload.preset.trim() : ''
    if (!rawInput && !explicitPreset) {
      throw new HttpFailure(400, '请输入快捷指令或选择 @标签，例如：@chatgpt-crew @gpt-6.1-sol 实现功能')
    }

    const parsed = parseQuickCommandInput(rawInput, explicitPreset)
    const selectedTeamId = typeof payload.teamId === 'string' ? payload.teamId.trim() : ''

    // Branch A: If no preset tag is specified and user @mentioned a member of the active staged team
    if (!parsed.presetKey && selectedTeamId && parsed.unknownTags.length > 0) {
      const existingTeam = await readTeam(stateRoot, selectedTeamId)
      if (existingTeam) {
        const targetMember = existingTeam.members.find((m) =>
          parsed.unknownTags.includes(m.name.toLowerCase()),
        )
        if (targetMember) {
          if (existingTeam.phase !== 'staged') {
            throw new HttpFailure(
              409,
              `团队「${existingTeam.name}」当前处于 ${existingTeam.phase} 状态，仅待审批 (staged) 团队可通过 @成员 直接修改成员模型或追加任务；若需组建新团队，请带上 @studio-default 或 @chatgpt-crew。`,
            )
          }
          const messages = []
          if (parsed.modelTag) {
            const meta = QUICK_MODEL_TAGS.get(parsed.modelTag)
            await handlePlanMutation({
              teamId: existingTeam.id,
              action: 'update_member',
              memberName: targetMember.name,
              provider: meta?.provider || (parsed.modelTag.startsWith('gemini') ? 'antigravity' : 'cliproxyapi'),
              model: meta?.model || parsed.modelTag,
            })
            messages.push(`成员 ${targetMember.name} 模型已切换为 ${parsed.modelTag}`)
          }
          if (parsed.cleanText) {
            await handlePlanMutation({
              teamId: existingTeam.id,
              action: 'add_task',
              subject: parsed.cleanText.slice(0, 60),
              description: parsed.cleanText,
              assignee: targetMember.name,
              dependencies: [],
            })
            messages.push(`已为 ${targetMember.name} 追加待审任务「${parsed.cleanText.slice(0, 40)}」`)
            return {
              ok: true,
              mode: 'added_task',
              teamId: existingTeam.id,
              sessionId: existingTeam.captainSessionId || 'antigravity-captain',
              message: `${messages.join('，')}（团队仍处于待确认阶段）`,
            }
          }
          if (parsed.modelTag) {
            return {
              ok: true,
              mode: 'updated_member',
              teamId: existingTeam.id,
              sessionId: existingTeam.captainSessionId || 'antigravity-captain',
              message: `${messages.join('，')}（团队仍处于待确认阶段）`,
            }
          }
        }
      }
    }

    // Branch B: One-click creation of a fresh staged team from quick preset + optional @model override
    const presetKey = parsed.presetKey || 'studio-default'
    const cleanGoal = parsed.cleanText || '通过 @快捷模式 创建的多智能体协同任务'
    const spec = buildQuickPresetSpec(presetKey, cleanGoal)
    const modelMeta = parsed.modelTag ? QUICK_MODEL_TAGS.get(parsed.modelTag) : null

    const hasAntigravityMember = spec.members.some((m) => m.provider === 'antigravity')
    const members = spec.members.map((member, index) => {
      if (!modelMeta) return member
      if (presetKey === 'chatgpt-crew') {
        return {
          ...member,
          provider: modelMeta.provider,
          model: modelMeta.model,
        }
      }
      if (modelMeta.provider === 'antigravity') {
        const isTargetAntigravity = hasAntigravityMember ? member.provider === 'antigravity' : index === 0
        if (!isTargetAntigravity) return member
      } else {
        const isPrimaryGpt = member.provider === 'cliproxyapi' || index === 0
        if (!isPrimaryGpt) return member
      }
      return {
        ...member,
        provider: modelMeta.provider,
        model: modelMeta.model,
      }
    })

    const teamName = typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : deriveQuickTeamName(presetKey, parsed.cleanText)

    const created = await createStagedTeam({
      name: teamName,
      goal: cleanGoal,
      members,
      tasks: spec.tasks,
      captainSessionId: payload.sessionId || payload.reuseSessionId,
      sourceLabel: `⚡ @快捷模式 [${spec.key}${parsed.modelTag ? `/${parsed.modelTag}` : ''}] 已生成`,
      knowledgeIds: Array.isArray(payload.knowledgeIds)
        ? payload.knowledgeIds
        : Array.isArray(spec.knowledgeIds)
          ? spec.knowledgeIds
          : undefined,
    })

    return {
      ok: true,
      mode: 'created_team',
      preset: spec.key,
      teamId: created.teamId,
      sessionId: created.sessionId,
      message: `已通过 @快捷模式（${spec.label}${parsed.modelTag ? ` · @${parsed.modelTag}` : ''}）生成待审批团队「${teamName}」，请在【执行前计划审查】点击「确认并启动团队」。`,
      team: created.team,
    }
  }

  async function handleRequest(req, res) {
    const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1')
    const pathname = parsedUrl.pathname

    try {
      // Static whales & assets
      if (
        (pathname.startsWith('/plugins/dsh-agent-teams/assets/') || pathname.startsWith('/assets/agent-teams/'))
        && req.method === 'GET'
      ) {
        const fileName = basename(pathname)
        let target = join(assetsRoot, fileName)
        if (!existsSync(target)) {
          target = join(distRoot, 'plugins', 'dsh-agent-teams', 'assets', fileName)
        }
        if (!existsSync(target)) {
          target = join(packageRoot, 'public', 'plugins', 'dsh-agent-teams', 'assets', fileName)
        }
        if (!existsSync(target)) {
          res.writeHead(404)
          return res.end('Asset not found')
        }
        res.writeHead(200, {
          'content-type': MIME_TYPES[extname(fileName)] || 'application/octet-stream',
          'cache-control': 'public, max-age=3600',
        })
        return res.end(readFileSync(target))
      }

      // SSE Events Stream
      if (pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        res.write('retry: 2000\n\n')
        sseClients.add(res)
        req.on('close', () => sseClients.delete(res))
        return
      }

      // Quick Command Mode (@-tags one-click team or staged mutation)
      if (pathname === '/api/quick-presets' && req.method === 'GET') {
        return sendJson(res, 200, buildQuickPresetsMetadata())
      }

      if (pathname === '/api/quick-command' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const outcome = await handleQuickCommand(body)
        return sendJson(res, 200, outcome)
      }

      // Built-in + User Extensible Knowledge Base, Runbook Manuals & Custom Widgets
      if (pathname === '/api/knowledge' && req.method === 'GET') {
        const { manuals: customManuals, widgets, hiddenManualIds = [] } = listCustomExtensions(absWorkspace)
        const hiddenSet = new Set(hiddenManualIds)
        const builtin = listKnowledgeManuals()
          .filter((m) => !hiddenSet.has(m.id))
          .map((m) => ({ ...m, isCustom: false }))
        const customSummaries = customManuals.map((m) => ({
          id: m.id,
          title: m.title,
          subtitle: m.subtitle,
          version: m.version,
          category: m.category,
          scopeLabel: m.scopeLabel,
          isCustom: true,
          triggerKeywords: m.triggerKeywords,
          specsCount: m.specs?.length ?? 0,
          sopCount: m.sopCards?.length ?? 0,
          updatedAt: m.updatedAt,
        }))
        return sendJson(res, 200, {
          ok: true,
          manuals: [...builtin, ...customSummaries],
          customManuals,
          widgets,
          hiddenManualCount: hiddenManualIds.length,
        })
      }

      if (pathname === '/api/knowledge/restore' && req.method === 'POST') {
        restoreHiddenManuals(absWorkspace)
        return sendJson(res, 200, { ok: true, restored: true })
      }

      if (pathname === '/api/knowledge' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const saved = saveCustomManual(absWorkspace, body)
        return sendJson(res, 200, { ok: true, manual: saved })
      }

      if (pathname.startsWith('/api/knowledge/') && req.method === 'GET') {
        const manualId = decodeURIComponent(pathname.slice('/api/knowledge/'.length))
        const builtinManual = getKnowledgeManual(manualId)
        if (builtinManual) {
          return sendJson(res, 200, { ok: true, manual: { ...builtinManual, isCustom: false } })
        }
        const { manuals: customManuals } = listCustomExtensions(absWorkspace)
        const customManual = customManuals.find((m) => m.id === manualId)
        if (!customManual) throw new HttpFailure(404, `未找到知识库手册: ${manualId}`)
        return sendJson(res, 200, { ok: true, manual: customManual })
      }

      if (pathname.startsWith('/api/knowledge/') && req.method === 'DELETE') {
        const manualId = decodeURIComponent(pathname.slice('/api/knowledge/'.length))
        const deleted = deleteCustomManual(absWorkspace, manualId)
        if (!deleted) throw new HttpFailure(404, `未找到可删除的自定义知识库: ${manualId}`)
        return sendJson(res, 200, { ok: true, deleted: true, id: manualId })
      }

      if (pathname === '/api/extensions/widgets' && req.method === 'GET') {
        const { widgets } = listCustomExtensions(absWorkspace)
        return sendJson(res, 200, { ok: true, widgets })
      }

      if (pathname === '/api/extensions/widgets' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const saved = saveCustomWidget(absWorkspace, body)
        return sendJson(res, 200, { ok: true, widget: saved })
      }

      if (pathname.startsWith('/api/extensions/widgets/') && req.method === 'DELETE') {
        const widgetId = decodeURIComponent(pathname.slice('/api/extensions/widgets/'.length))
        const deleted = deleteCustomWidget(absWorkspace, widgetId)
        if (!deleted) throw new HttpFailure(404, `未找到可删除的扩展模块: ${widgetId}`)
        return sendJson(res, 200, { ok: true, deleted: true, id: widgetId })
      }

      // Multi-Agent AI Video Production Pipeline Routes (/api/video/*)
      if (pathname === '/api/video/pipelines' && req.method === 'GET') {
        const data = listVideoPipelines(absWorkspace)
        return sendJson(res, 200, { ok: true, ...data })
      }

      if (pathname === '/api/video/pipelines' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const saved = saveCustomVideoPipeline(absWorkspace, body)
        return sendJson(res, 200, { ok: true, pipeline: saved })
      }

      if (pathname === '/api/video/pipelines/restore' && req.method === 'POST') {
        const data = restoreBuiltinVideoPipelines(absWorkspace)
        return sendJson(res, 200, { ok: true, restored: true, ...data })
      }

      if (pathname.startsWith('/api/video/pipelines/') && req.method === 'DELETE') {
        const pipeId = decodeURIComponent(pathname.slice('/api/video/pipelines/'.length))
        const deleted = deleteCustomVideoPipeline(absWorkspace, pipeId)
        if (!deleted) throw new HttpFailure(404, `未找到可删除的流水线: ${pipeId}`)
        return sendJson(res, 200, { ok: true, deleted: true, id: pipeId })
      }

      if (pathname.startsWith('/api/video/gallery/') && req.method === 'DELETE') {
        const imgId = decodeURIComponent(pathname.slice('/api/video/gallery/'.length))
        deleteGeneratedGraphic(absWorkspace, imgId)
        return sendJson(res, 200, { ok: true, deleted: true, id: imgId })
      }

      if (pathname === '/api/video/launch' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const { pipelines } = listVideoPipelines(absWorkspace)
        const targetPipe =
          body?.pipeline && typeof body.pipeline === 'object'
            ? body.pipeline
            : pipelines.find((p) => p.id === body?.pipelineId) || pipelines[0]
        const isGraphic = targetPipe?.mode === 'graphic' || targetPipe?.videoConfig?.mode === 'graphic'
        const brief =
          String(body?.brief || body?.goal || '').trim() ||
          `${isGraphic ? 'AI 图形制作任务' : 'AI 视频制作任务'} (${targetPipe.name})`
        const spec = buildVideoTeamFromPipeline(targetPipe, brief)
        const teamName =
          typeof body?.teamName === 'string' && body.teamName.trim()
            ? body.teamName.trim()
            : `${isGraphic ? '🎨 图形工坊' : '🎬 视频工坊'} · ${brief.slice(0, 18)}`
        const created = await createStagedTeam({
          name: teamName,
          goal: brief,
          members: spec.members,
          tasks: spec.tasks,
          captainSessionId: body?.sessionId,
          sourceLabel: `${isGraphic ? '🎨 AI 图形工坊' : '🎬 AI 视频工坊'} [${targetPipe.name}] 已生成`,
        })
        return sendJson(res, 200, {
          ok: true,
          pipelineId: targetPipe.id,
          ...created,
          message: `已按流水线「${targetPipe.name}」生成待审批团队「${teamName}」！`,
        })
      }

      if (pathname === '/api/video/local-config' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const config = saveLocalMediaConfig(absWorkspace, body)
        return sendJson(res, 200, { ok: true, localMediaConfig: config })
      }

      if (pathname === '/api/video/local-probe' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const probe = await probeLocalMediaEndpoint(body?.endpoint)
        return sendJson(res, 200, { ok: true, ...probe })
      }

      if (pathname === '/api/video/generate-image' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const generated = await generateStudioGraphic(absWorkspace, {
          ...body,
          cpaBaseUrl,
          cpaApiKey,
        })
        return sendJson(res, 200, { ok: true, generated })
      }

      // Actionable AI News Radar & 3-Tier Intelligence Grabber Routes (/api/radar*)
      if (pathname === '/api/radar' && req.method === 'GET') {
        const level = parsedUrl.searchParams.get('level') || 'all'
        const sourceType = parsedUrl.searchParams.get('sourceType') || 'all'
        const query = parsedUrl.searchParams.get('q') || ''
        const data = listRadarItems(absWorkspace, { level, sourceType, query })
        return sendJson(res, 200, { ok: true, ...data })
      }

      if (pathname === '/api/radar/refresh' && req.method === 'POST') {
        const refreshed = await refreshLiveRadarItems(absWorkspace)
        return sendJson(res, 200, { ok: true, ...refreshed })
      }

      if (pathname === '/api/radar/items' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const item = saveCustomRadarItem(absWorkspace, body)
        return sendJson(res, 200, { ok: true, item })
      }

      if (pathname === '/api/radar/restore' && req.method === 'POST') {
        const data = restoreRadarItems(absWorkspace)
        return sendJson(res, 200, { ok: true, restored: true, ...data })
      }

      if (pathname.startsWith('/api/radar/items/') && req.method === 'DELETE') {
        const itemId = decodeURIComponent(pathname.slice('/api/radar/items/'.length))
        const deleted = deleteCustomRadarItem(absWorkspace, itemId)
        if (!deleted) throw new HttpFailure(404, `未找到可移除的情报条目: ${itemId}`)
        return sendJson(res, 200, { ok: true, deleted: true, id: itemId })
      }

      if (pathname === '/api/radar/launch' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const title = String(body?.title || 'AI 前沿情报评估').replace(/\r?\n/gu, ' ').trim()
        const valueProp = String(body?.valueProposition || '').replace(/\r?\n/gu, ' ').trim()
        const summary = String(body?.summary || '').replace(/\r?\n/gu, ' ').trim()
        const presetKey = String(body?.preset || 'ai-radar-squad').trim()
        const goal = `【AI 情报抓手实测验证】${title} · 核心价值：${valueProp} · 简介：${summary}`.slice(0, 180)
        const spec = buildQuickPresetSpec(presetKey, goal)
        const created = await createStagedTeam({
          name: `📡 情报验证 · ${title.slice(0, 18)}`,
          goal,
          members: spec.members,
          tasks: spec.tasks,
          sourceLabel: `📡 AI 情报抓手 [${body?.level || 'developer'}] 一键派发`,
        })
        return sendJson(res, 200, {
          ok: true,
          ...created,
          message: `已基于情报《${title.slice(0, 24)}》生成待审批团队！`,
        })
      }

      // Built-in Grok Bot Engine & xAI `grok-build` Routes (/api/grok/*)
      if (pathname === '/api/grok/status' && req.method === 'GET') {
        return sendJson(res, 200, getGrokBotStatus(absWorkspace))
      }

      if (pathname === '/api/grok/config' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const config = updateGrokBotConfig(absWorkspace, body)
        return sendJson(res, 200, { ok: true, config })
      }

      if (pathname === '/api/grok/ask' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const entry = await askGrokBot(absWorkspace, {
          ...body,
          cpaBaseUrl,
          cpaApiKey,
        })
        return sendJson(res, 200, { ok: true, entry, status: getGrokBotStatus(absWorkspace) })
      }

      if (pathname === '/api/grok/clear' && req.method === 'POST') {
        return sendJson(res, 200, clearGrokBotHistory(absWorkspace))
      }

      if (pathname.startsWith('/api/grok/history/') && req.method === 'DELETE') {
        const hid = decodeURIComponent(pathname.slice('/api/grok/history/'.length))
        deleteGrokHistoryItem(absWorkspace, hid)
        return sendJson(res, 200, getGrokBotStatus(absWorkspace))
      }

      // Git Version Checkpoint & Rollback Helper Routes (/api/git/checkpoints)
      if (pathname === '/api/git/checkpoints' && req.method === 'GET') {
        const gitReady = await isGitRepo(absWorkspace)
        let currentBranch = 'main'
        let dirtyCount = 0
        const checkpoints = []
        if (gitReady) {
          try {
            currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
              cwd: absWorkspace,
              encoding: 'utf8',
              timeout: 3000,
            }).trim()
          } catch {}
          try {
            const statusOut = execFileSync('git', ['status', '--porcelain'], {
              cwd: absWorkspace,
              encoding: 'utf8',
              timeout: 4000,
            }).trim()
            dirtyCount = statusOut ? statusOut.split(/\r?\n/u).filter(Boolean).length : 0
          } catch {}
          try {
            const logOut = execFileSync(
              'git',
              ['log', '-n', '15', '--pretty=format:%H|%h|%s|%an|%cI'],
              { cwd: absWorkspace, encoding: 'utf8', timeout: 4000 },
            ).trim()
            if (logOut) {
              for (const line of logOut.split(/\r?\n/u)) {
                const [hash, shortHash, subject, author, date] = line.split('|')
                if (hash) {
                  checkpoints.push({ hash, shortHash, subject, author, date })
                }
              }
            }
          } catch {}
        }
        return sendJson(res, 200, {
          ok: true,
          isGitRepo: gitReady,
          currentBranch,
          dirtyCount,
          checkpoints,
        })
      }

      if (pathname === '/api/git/checkpoints' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const message =
          String(body?.message || '').trim() ||
          `chore(checkpoint): studio snapshot ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`
        try {
          execFileSync('git', ['add', '-A'], { cwd: absWorkspace, timeout: 10000 })
          const statusOut = execFileSync('git', ['status', '--porcelain'], {
            cwd: absWorkspace,
            encoding: 'utf8',
            timeout: 4000,
          }).trim()
          if (!statusOut) {
            return sendJson(res, 200, {
              ok: true,
              noChanges: true,
              message: '当前工作区已是最新状态，无需重复提交 Git 快照。',
            })
          }
          execFileSync('git', ['commit', '-m', message], { cwd: absWorkspace, timeout: 15000 })
          const shortHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
            cwd: absWorkspace,
            encoding: 'utf8',
            timeout: 3000,
          }).trim()
          return sendJson(res, 200, {
            ok: true,
            noChanges: false,
            shortHash,
            commitMessage: message,
            message: `已保存 Git 版本检查点 [${shortHash}]：${message}`,
          })
        } catch (err) {
          throw new HttpFailure(500, `Git 检查点提交失败: ${err?.message || String(err)}`)
        }
      }

      // AgentSpeed Live Telemetry & Bottom Dock Route (/api/agent-speed)
      if (pathname === '/api/agent-speed' && req.method === 'GET') {
        const usage24h = await collectDesktopUsage({ workspaceRoot: absWorkspace, packageRoot, range: '24h' })
        const teams = await collectStudioTeams(absWorkspace, { archived: false })
        let generatingCount = 0
        let toolCount = 0
        for (const t of teams) {
          if (t.phase === 'running' && !t.halted) {
            for (const tk of t.tasks || []) {
              if (tk.status === 'in_progress' || tk.status === 'claimed') {
                generatingCount += 1
                toolCount += 1
              }
            }
          }
        }
        const totalOut = Number(usage24h?.summary?.outputTokens || 0)
        const totalIn = Number(usage24h?.summary?.inputTokens || 0)
        const totalCached = Number(usage24h?.summary?.cachedTokens || 0)
        const totalReqs = Number(usage24h?.summary?.totalRequests || 0)
        const avgDurationMs = Number(usage24h?.cpaSqlite?.avgDurationMs || 1800)
        const avgTokPerSec =
          totalOut > 0 && totalReqs > 0
            ? Math.max(18, Math.min(320, Math.round((totalOut / Math.max(1, totalReqs)) / Math.max(0.8, avgDurationMs / 1000))))
            : 69
        const peakTokPerSec = Math.max(avgTokPerSec * 3, 252)
        const liveTokPerSec =
          generatingCount > 0 || activeAutoRuns.size > 0
            ? Math.round(avgTokPerSec * (0.9 + (Date.now() % 30) / 100))
            : 0

        // Estimate API equivalent cost in USD (Input $1.25/1M, Cached $0.125/1M, Output $5.00/1M)
        const uncachedIn = Math.max(0, totalIn - totalCached)
        const todayCostUsd = Number(
          ((uncachedIn / 1_000_000) * 1.25 + (totalCached / 1_000_000) * 0.125 + (totalOut / 1_000_000) * 5.0).toFixed(2),
        )

        // Build 20-point sparkline series for 1m / 2m / 5m
        const basePoints = [142, 168, 210, 252, 238, 195, 164, 128, 92, 69, 48, 0, 0, 0, 0, 0, 0, 0, 0, liveTokPerSec]
        const sources = [
          {
            name: 'EasyCLIProxyAPI (CPA)',
            color: '#007aff',
            outputTokens: totalOut,
            costUsd: todayCostUsd,
          },
          {
            name: 'Google Antigravity (哈吉米)',
            color: '#ff2d55',
            outputTokens: Math.round(totalOut * 0.42),
            costUsd: Number((todayCostUsd * 0.38).toFixed(2)),
          },
        ]
        const topModels = (usage24h?.models || []).slice(0, 4).map((m) => ({
          agentName: m.provider || 'antigravity',
          model: m.model,
          requests: m.requests,
          totalTokens: m.totalTokens,
          tokPerSec: generatingCount > 0 ? liveTokPerSec : avgTokPerSec,
        }))

        return sendJson(res, 200, {
          ok: true,
          liveTokPerSec,
          statusLabel: generatingCount > 0 || activeAutoRuns.size > 0 ? '高速推理中' : '待机',
          generatingCount: generatingCount + activeAutoRuns.size,
          toolCount: Math.max(1, toolCount),
          avgTokPerSec,
          peakTokPerSec,
          peakTimeLabel: '今日峰值',
          todayOutputTokens: totalOut,
          todayInputWithCacheTokens: totalIn,
          todayCachedTokens: totalCached,
          todayRequests: totalReqs,
          todayCostUsd: Math.max(0.12, todayCostUsd),
          series: {
            '1m': basePoints,
            '2m': basePoints.map((v, i) => (i < 8 ? Math.round(v * 0.95) : v)),
            '5m': basePoints.map((v, i) => (i < 12 ? Math.round(v * 0.85) : v)),
          },
          sources,
          agents:
            topModels.length > 0
              ? topModels
              : [
                  {
                    agentName: 'antigravity',
                    model: 'gemini-3.8-flash-tiered · 哈吉米',
                    requests: totalReqs || 116,
                    totalTokens: totalIn + totalOut,
                    tokPerSec: avgTokPerSec,
                  },
                ],
        })
      }

      // Runtime Model & Provider Directory (CPA + Antigravity + Domestic + Grok + Custom Providers)
      if (pathname === '/api/models' && req.method === 'GET') {
        const cpa = await fetchCpaModels({ baseUrl: cpaBaseUrl, apiKey: cpaApiKey })
        const { config: deskCfg } = readDesktopConfig({ workspaceRoot: absWorkspace, packageRoot })
        const customProviders = listCustomProviders(absWorkspace)
        const customById = new Map(customProviders.map((cp) => [cp.id, cp]))

        const liveCpaIds = new Set(cpa.models.map((m) => m.id))
        const mergedCpa = [...STATIC_CATALOG.cliproxyapi]
        for (const liveModel of cpa.models) {
          if (!mergedCpa.some((m) => m.id === liveModel.id)) {
            mergedCpa.push({
              id: liveModel.id,
              name: liveModel.id,
              ownedBy: liveModel.ownedBy || 'cliproxyapi',
              isLiveDiscovered: true,
            })
          }
        }

        const hiddenProvidersCount = customProviders.filter((cp) => cp.hidden).length
        const baseProviders = [
          // 1. 核心 Agent 宿主生态 (反重力 / Codex / DSH / ZCode / OpenCode)
          { id: 'antigravity', name: 'Google Antigravity (反重力 · 哈吉米)', models: STATIC_CATALOG.antigravity },
          { id: 'codex', name: 'OpenAI Codex (API / 本地 CLI)', models: STATIC_CATALOG.codex },
          { id: 'dsh', name: 'DSH AgentTeams (原生兼容生态)', models: STATIC_CATALOG.dsh },
          { id: 'zcode', name: 'ZCode (ZCode IDE / 智谱编码代理)', models: STATIC_CATALOG.zcode },
          { id: 'opencode', name: 'OpenCode (OpenCode Zen / 开源终端路由)', models: STATIC_CATALOG.opencode },
          // 2. 主流中转站与聚合网关 (CPA / NewAPI / OpenRouter / AiHubMix / 硅基流动)
          { id: 'cliproxyapi', name: 'EasyCLIProxyAPI (CPA 本地总中转)', models: mergedCpa },
          { id: 'newapi', name: 'NewAPI / OneAPI / VoAPI (通用中转站)', models: STATIC_CATALOG.newapi },
          { id: 'openrouter', name: 'OpenRouter (全球模型聚合中转)', models: STATIC_CATALOG.openrouter },
          { id: 'aihubmix', name: 'AiHubMix (国内全模型商业中转)', models: STATIC_CATALOG.aihubmix },
          { id: 'siliconflow', name: 'SiliconFlow (硅基流动国内聚合)', models: STATIC_CATALOG.siliconflow },
          // 3. 国内外主流官方大模型平台
          { id: 'openai', name: 'OpenAI Official (官方直连)', models: STATIC_CATALOG.openai },
          { id: 'anthropic', name: 'Anthropic Claude (官方协议)', models: STATIC_CATALOG.anthropic },
          { id: 'deepseek', name: 'DeepSeek (深度求索官方)', models: STATIC_CATALOG.deepseek },
          { id: 'grok', name: 'xAI Grok (官方 / grok-build)', models: STATIC_CATALOG.grok },
          { id: 'qwen', name: 'Alibaba Qwen (阿里通义百炼)', models: STATIC_CATALOG.qwen },
          { id: 'zhipu', name: 'Zhipu GLM (智谱清言 BigModel)', models: STATIC_CATALOG.zhipu },
          { id: 'kimi', name: 'Moonshot Kimi (月之暗面 K2)', models: STATIC_CATALOG.kimi },
          { id: 'doubao', name: 'ByteDance Doubao (字节火山方舟)', models: STATIC_CATALOG.doubao },
          { id: 'minimax', name: 'MiniMax (稀宇科技开放平台)', models: STATIC_CATALOG.minimax },
          // 4. 本地私有部署
          { id: 'ollama', name: 'Ollama / vLLM (本地私有部署)', models: STATIC_CATALOG.ollama },
        ]
          .filter((bp) => !customById.get(bp.id)?.hidden)
          .map((bp) => {
            const metaInfo = PROVIDER_META[bp.id] || {}
            const override = customById.get(bp.id)
            const removedSet = new Set(override?.removedModelIds || [])
            const modelMap = new Map()
            for (const m of bp.models) {
              if (removedSet.has(m.id)) continue
              modelMap.set(m.id, {
                ...m,
                isLiveDiscovered: Boolean(m.isLiveDiscovered || (bp.id === 'cliproxyapi' && liveCpaIds.has(m.id))),
              })
            }
            if (override?.models) {
              for (const cm of override.models) {
                if (removedSet.has(cm.id)) continue
                modelMap.set(cm.id, { ...cm, isCustom: true })
              }
            }
            const isCpaBacked = ['cliproxyapi', 'antigravity', 'codex', 'dsh'].includes(bp.id)
            return {
              id: bp.id,
              name: override?.name || bp.name,
              icon: override?.icon || metaInfo.icon || '🔌',
              category: override?.category || metaInfo.category || 'official-cloud',
              region: override?.region || metaInfo.region || 'global',
              protocol: override?.protocol || metaInfo.protocol || 'openai',
              baseUrl:
                override?.baseUrl ||
                (bp.id === 'cliproxyapi' ? cpa.baseUrl : metaInfo.defaultBaseUrl || cpa.baseUrl),
              website: override?.website || metaInfo.website || '',
              badge: override?.badge || metaInfo.badge || '内置供应商',
              description: override?.description || metaInfo.description || '',
              isCustom: false,
              hasApiKey: Boolean(override?.hasApiKey || isCpaBacked),
              apiKeyMasked: override?.apiKeyMasked || (isCpaBacked ? 'CPA 统一托管' : ''),
              status:
                bp.id === 'cliproxyapi'
                  ? cpa.online
                    ? 'online'
                    : 'offline'
                  : isCpaBacked && cpa.online
                    ? 'online'
                    : override?.hasApiKey
                      ? 'configured'
                      : 'gateway-fallback',
              models: [...modelMap.values()],
            }
          })

        const extraCustomProviders = customProviders
          .filter((cp) => !Object.hasOwn(PROVIDER_META, cp.id) && !cp.hidden)
          .map((cp) => ({
            ...cp,
            category: cp.category || 'relay-station',
            isCustom: true,
            status: cp.hasApiKey ? 'configured' : 'gateway-fallback',
          }))

        const allProviders = [...baseProviders, ...extraCustomProviders]
        const totalModelsCount = allProviders.reduce((acc, p) => acc + p.models.length, 0)

        return sendJson(res, 200, {
          ok: true,
          cpaOnline: cpa.online,
          cpaBaseUrl: cpa.baseUrl,
          liveCpaCount: cpa.models.length,
          defaultGptModel: String(deskCfg['default-gpt-model'] || DEFAULT_CPA_GPT_MODEL),
          totalProvidersCount: allProviders.length,
          totalModelsCount,
          hiddenProvidersCount,
          error: cpa.error,
          providers: allProviders,
        })
      }

      if (pathname === '/api/models/providers' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const saved = saveCustomProvider(absWorkspace, body)
        return sendJson(res, 200, { ok: true, provider: saved })
      }

      if (pathname === '/api/models/providers/restore' && req.method === 'POST') {
        restoreHiddenProviders(absWorkspace)
        return sendJson(res, 200, { ok: true, restored: true })
      }

      if (pathname === '/api/models/providers/discover' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const providerId = String(body?.providerId || '').trim().toLowerCase()
        const savedRaw = providerId ? getProviderRawConfig(absWorkspace, providerId) : null
        const targetBaseUrl = String(body?.baseUrl || savedRaw?.baseUrl || cpaBaseUrl).trim()
        const targetApiKey =
          body?.apiKey && body.apiKey !== 'KEEP_EXISTING'
            ? String(body.apiKey).trim()
            : (savedRaw?.apiKey || (targetBaseUrl === cpaBaseUrl ? cpaApiKey : ''))
        const result = await discoverProviderModels({
          baseUrl: targetBaseUrl,
          apiKey: targetApiKey,
          timeoutMs: Number(body?.timeoutMs) || 7000,
        })
        if (result.reachable && result.models.length > 0 && body?.autoSave && providerId) {
          saveCustomProvider(absWorkspace, {
            id: providerId,
            name: body?.name,
            baseUrl: targetBaseUrl,
            apiKey: body?.apiKey ? body.apiKey : 'KEEP_EXISTING',
            models: result.models,
          })
        }
        return sendJson(res, 200, result)
      }

      const delProvModelMatch = pathname.match(/^\/api\/models\/providers\/([^/]+)\/models\/(.+)$/u)
      if (delProvModelMatch && req.method === 'DELETE') {
        const provId = decodeURIComponent(delProvModelMatch[1])
        const modId = decodeURIComponent(delProvModelMatch[2])
        const deleted = deleteModelFromProvider(absWorkspace, provId, modId)
        if (!deleted) throw new HttpFailure(404, `未找到模型: ${provId}/${modId}`)
        return sendJson(res, 200, { ok: true, deleted: true, providerId: provId, modelId: modId })
      }

      if (pathname.startsWith('/api/models/providers/') && req.method === 'DELETE') {
        const provId = decodeURIComponent(pathname.slice('/api/models/providers/'.length))
        const deleted = deleteCustomProvider(absWorkspace, provId)
        if (!deleted) throw new HttpFailure(404, `未找到可删除的供应商配置: ${provId}`)
        return sendJson(res, 200, { ok: true, deleted: true, id: provId })
      }

      if (pathname === '/api/models/test' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const providerId = String(body?.provider || 'cliproxyapi').trim()
        const modelId = String(body?.model || DEFAULT_CPA_GPT_MODEL).trim()
        const timeoutMs = Number(body?.timeoutMs) > 0 ? Number(body.timeoutMs) : 6000

        if (typeof mockExecutor === 'function') {
          return sendJson(res, 200, {
            ok: true,
            reachable: true,
            latencyMs: 12,
            reply: 'OK (mock)',
            provider: providerId,
            model: modelId,
            routeUsed: 'mock-executor',
          })
        }

        const customRaw = getProviderRawConfig(absWorkspace, providerId)
        const useDirect = Boolean(customRaw?.baseUrl && (customRaw?.apiKey || providerId === 'ollama'))
        const targetBaseUrl = useDirect ? customRaw.baseUrl : cpaBaseUrl
        const targetApiKey = useDirect ? customRaw.apiKey : cpaApiKey

        const ping = await pingModelEndpoint({
          baseUrl: targetBaseUrl,
          apiKey: targetApiKey,
          model: modelId,
          timeoutMs,
        })
        return sendJson(res, 200, {
          ...ping,
          provider: providerId,
          model: modelId,
          routeUsed: useDirect ? `direct (${targetBaseUrl})` : `cpa-gateway (${cpaBaseUrl})`,
        })
      }

      // Watchdog Status & Manual Heal Route
      if (pathname === '/api/watchdog/status' && req.method === 'GET') {
        const summary = await runWatchdogScan({ manual: false })
        return sendJson(res, 200, {
          ok: true,
          intervalMs: 10000,
          activeAutoRuns: [...activeAutoRuns],
          ...summary,
        })
      }

      if (pathname === '/api/watchdog/heal' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const summary = await runWatchdogScan({
          manual: true,
          targetTeamId: typeof body.teamId === 'string' ? body.teamId.trim() : '',
        })
        return sendJson(res, 200, {
          ok: true,
          activeAutoRuns: [...activeAutoRuns],
          ...summary,
        })
      }

      // CPA Desktop Center Routes (/api/desktop/status, /api/desktop/config, /api/desktop/usage)
      if (pathname === '/api/desktop/status' && req.method === 'GET') {
        const { portableApp, coreVersion } = readPortableMetadata({ workspaceRoot: absWorkspace, packageRoot })
        const { config, configPath } = readDesktopConfig({ workspaceRoot: absWorkspace, packageRoot })
        const cpa = await fetchCpaModels({ baseUrl: cpaBaseUrl, apiKey: cpaApiKey, timeoutMs: 1500 })
        const watchdog = await runWatchdogScan({ manual: false })
        return sendJson(res, 200, {
          ok: true,
          portableApp,
          coreVersion,
          config,
          configPath,
          cpaOnline: cpa.online,
          cpaBaseUrl: cpa.baseUrl,
          watchdog: {
            enabled: Boolean(config['watchdog-enabled']),
            intervalMs: (Number(config['watchdog-interval-seconds']) || 10) * 1000,
            activeAutoRuns: [...activeAutoRuns],
            ...watchdog,
          },
          studioCore: getStudioCoreRuntimeInfo(),
        })
      }

      if (pathname === '/api/desktop/config' && req.method === 'GET') {
        const { config, rawToml, configPath } = readDesktopConfig({ workspaceRoot: absWorkspace, packageRoot })
        return sendJson(res, 200, { ok: true, config, rawToml, configPath })
      }

      if (pathname === '/api/desktop/config' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const patch = typeof body?.config === 'object' && body.config !== null ? body.config : body
        const updated = writeDesktopConfig(patch, { workspaceRoot: absWorkspace, packageRoot })
        return sendJson(res, 200, { ok: true, ...updated })
      }

      if (pathname === '/api/desktop/usage' && req.method === 'GET') {
        const range = (parsedUrl.searchParams.get('range') || 'all').trim().toLowerCase()
        const usage = await collectDesktopUsage({ workspaceRoot: absWorkspace, packageRoot, range })
        return sendJson(res, 200, usage)
      }

      if (pathname === '/api/desktop/theme' && req.method === 'GET') {
        const { themePath, selection } = readThemeSelection({ workspaceRoot: absWorkspace, packageRoot })
        return sendJson(res, 200, { ok: true, themePath, selection })
      }

      if (pathname === '/api/desktop/theme' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const patch = typeof body?.selection === 'object' && body.selection !== null ? body.selection : body
        const updated = writeThemeSelection(patch, { workspaceRoot: absWorkspace, packageRoot })
        return sendJson(res, 200, { ok: true, ...updated })
      }

      if (pathname === '/api/ecosystem/status' && req.method === 'GET') {
        const status = inspectEcosystemStatus({ projectRoot: packageRoot, workspaceRoot: absWorkspace })
        const cpaProbe = await probeCpaChannel({ baseUrl: cpaBaseUrl, apiKey: cpaApiKey, timeoutMs: 1500 })
        return sendJson(res, 200, {
          ok: true,
          status: {
            ...status,
            cpa: {
              ...status.cpa,
              online: cpaProbe.online,
              baseUrl: cpaProbe.baseUrl,
              managementUrl: cpaProbe.managementUrl,
              modelCount: cpaProbe.modelCount,
            },
          },
        })
      }

      if (pathname === '/api/ecosystem/install' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const targets = body?.targets || body?.target || 'all'
        const dryRun = Boolean(body?.dryRun)
        const outcome = installEcosystemTargets({
          projectRoot: packageRoot,
          workspaceRoot: absWorkspace,
          targets,
          dryRun,
        })
        return sendJson(res, 200, outcome)
      }

      if (pathname === '/api/channels/cpa/status' && req.method === 'GET') {
        const installInfo = discoverLocalCpaInstall({ projectRoot: packageRoot })
        const probe = await probeCpaChannel({ baseUrl: cpaBaseUrl, apiKey: cpaApiKey, timeoutMs: 1800 })
        return sendJson(res, 200, {
          ok: true,
          ...probe,
          installInfo,
        })
      }

      if (pathname === '/api/channels/cpa/ensure' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const ensured = await ensureCpaChannelRunning({
          projectRoot: packageRoot,
          baseUrl: body?.baseUrl || cpaBaseUrl,
          apiKey: body?.apiKey || cpaApiKey,
          autoSpawn: body?.autoSpawn !== false,
        })
        return sendJson(res, 200, { ok: true, ...ensured })
      }

      // QQ Bot Remote Control Channel Routes (/api/channels/qqbot/*)
      if (pathname === '/api/channels/qqbot/status' && req.method === 'GET') {
        return sendJson(res, 200, qqRemote.getStatus())
      }

      if (pathname === '/api/channels/qqbot/config' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const status = await qqRemote.updateConfig(body || {})
        return sendJson(res, 200, status)
      }

      if (pathname === '/api/channels/qqbot/connect' && req.method === 'POST') {
        const status = await qqRemote.connect()
        return sendJson(res, 200, status)
      }

      if (pathname === '/api/channels/qqbot/disconnect' && req.method === 'POST') {
        const status = await qqRemote.disconnect()
        return sendJson(res, 200, status)
      }

      if (pathname === '/api/channels/qqbot/pairing-code' && req.method === 'POST') {
        const pairing = qqRemote.createPairingCode()
        return sendJson(res, 200, { ok: true, pairing, status: qqRemote.getStatus() })
      }

      if (pathname === '/api/channels/qqbot/tasks' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, tasks: qqRemote.listTasks({ limit: 50 }) })
      }

      const qqCancelMatch = pathname.match(/^\/api\/channels\/qqbot\/tasks\/([^/]+)\/cancel$/u)
      if (qqCancelMatch && req.method === 'POST') {
        const tid = decodeURIComponent(qqCancelMatch[1])
        const outcome = await qqRemote.cancelTask(tid)
        return sendJson(res, 200, { ...outcome, status: qqRemote.getStatus() })
      }

      // DSH State Poll Route
      if (pathname === '/plugins/dsh-agent-teams/state' && req.method === 'GET') {
        const archived = parsedUrl.searchParams.get('archived') === '1'
        const teams = await collectStudioTeams(absWorkspace, { archived })
        return sendJson(res, 200, { teams })
      }

      // DSH Plan Mutation & Approval Route
      if (pathname === '/plugins/dsh-agent-teams/plan' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const outcome = await handlePlanMutation(body)
        return sendJson(res, 200, outcome)
      }

      // DSH Halt & Resume Routes
      if (pathname === '/plugins/dsh-agent-teams/halt' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const teamId = String(body.teamId ?? '').trim()
        if (!teamId) throw new HttpFailure(400, 'teamId is required')
        await haltTeamById(teamId)
        return sendJson(res, 200, { ok: true, halted: true })
      }

      if (pathname === '/plugins/dsh-agent-teams/resume' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const teamId = String(body.teamId ?? '').trim()
        if (!teamId) throw new HttpFailure(400, 'teamId is required')
        await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
          const team = await readTeam(stateRoot, teamId)
          if (!team) throw new HttpFailure(404, `团队不存在: ${teamId}`)
          const now = Date.now()
          const next = { ...team, halted: false, updatedAt: now }
          delete next.haltedAt
          await writeTeam(stateRoot, next)
          recordLog({
            teamId,
            level: 'info',
            timestamp: new Date().toISOString(),
            message: '团队已恢复运行 (resumed)。',
          })
        })
        await broadcastSnapshots()
        return sendJson(res, 200, { ok: true, halted: false })
      }

      // DSH Provider Catalog
      if (pathname === '/plugins/dsh-agent-teams/teams/catalog' && req.method === 'GET') {
        const provider = (parsedUrl.searchParams.get('provider') || 'cliproxyapi').trim().toLowerCase()
        const customCfg = getProviderRawConfig(absWorkspace, provider)
        const removedSet = new Set(customCfg?.removedModelIds || [])
        const customModels = Array.isArray(customCfg?.models) ? customCfg.models : []

        if (provider === 'cliproxyapi' || provider === 'codex') {
          const cpa = await fetchCpaModels({ baseUrl: cpaBaseUrl, apiKey: cpaApiKey })
          const base = (STATIC_CATALOG[provider] ?? STATIC_CATALOG.cliproxyapi).filter((m) => !removedSet.has(m.id))
          const seen = new Set(base.map((m) => m.id))
          const combined = [
            ...base,
            ...customModels.filter((m) => !seen.has(m.id) && !removedSet.has(m.id)),
            ...cpa.models
              .filter((m) => !seen.has(m.id) && !removedSet.has(m.id))
              .map((m) => ({ id: m.id, name: m.id })),
          ]
          return sendJson(res, 200, { models: combined, advisory: !cpa.online })
        }
        const base = (STATIC_CATALOG[provider] ?? []).filter((m) => !removedSet.has(m.id))
        const seen = new Set(base.map((m) => m.id))
        const merged = [...base, ...customModels.filter((m) => !seen.has(m.id) && !removedSet.has(m.id))]
        return sendJson(res, 200, { models: merged, advisory: false })
      }

      // DSH Teams REST: List / Create (ALWAYS STAGED!)
      if (pathname === '/plugins/dsh-agent-teams/teams' && req.method === 'GET') {
        const teams = await collectStudioTeams(absWorkspace, { archived: false })
        return sendJson(res, 200, { teams, maxMembers: 8 })
      }

      if (pathname === '/plugins/dsh-agent-teams/teams' && req.method === 'POST') {
        const payload = await readJsonBody(req)
        const name = String(payload.name ?? '').trim()
        const goal = String(payload.goal ?? '').trim()
        if (!name || !goal) throw new HttpFailure(400, '团队名称和目标均不能为空')
        if (payload.approval !== undefined && payload.approval !== 'required') {
          throw new HttpFailure(400, '本系统强制要求 approval="required"：所有团队必须先审批后启动')
        }
        if (!Array.isArray(payload.members) || payload.members.length === 0) {
          throw new HttpFailure(400, '至少需要配置 1 名团队成员')
        }

        const created = await createStagedTeam({
          name,
          goal,
          members: payload.members,
          tasks: payload.tasks,
          captainSessionId: payload.reuseSessionId,
          sourceLabel: '已创建',
          knowledgeIds: Array.isArray(payload.knowledgeIds) ? payload.knowledgeIds : undefined,
        })
        return sendJson(res, 200, created)
      }

      // Archive (DELETE /plugins/dsh-agent-teams/teams/:teamId) & Restore (/restore)
      if (pathname.startsWith('/plugins/dsh-agent-teams/teams/')) {
        const rest = pathname.slice('/plugins/dsh-agent-teams/teams/'.length).split('/').filter(Boolean)
        const teamId = rest[0] ? decodeURIComponent(rest[0]) : ''
        if (!teamId) throw new HttpFailure(404, 'teamId missing')

        if (rest.length === 1 && req.method === 'DELETE') {
          const body = await readJsonBody(req)
          if (body.confirm !== true) throw new HttpFailure(400, 'confirm: true is required')
          let archiveId
          try {
            archiveId = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
              const existing = await readTeam(stateRoot, teamId)
              if (!existing) throw new HttpFailure(404, '团队不存在或已归档')
              return archiveTeamDir(stateRoot, teamId)
            })
          } catch (err) {
            if (err instanceof ArchiveResourceLockedError) throw new HttpFailure(409, err.message)
            throw err
          }
          await broadcastSnapshots()
          return sendJson(res, 200, { status: 'archived', teamId, archiveId })
        }

        if (rest.length === 2 && rest[1] === 'restore' && req.method === 'POST') {
          const body = await readJsonBody(req)
          let archiveId = String(body.archiveId ?? teamId).trim()
          let archived = await readArchivedTeam(stateRoot, teamId, archiveId)
          if (!archived) {
            const gens = await listArchivedTeamGenerations(stateRoot, teamId)
            const matched = gens.find((g) => g.archiveId === archiveId) ?? gens[0]
            if (!matched) throw new HttpFailure(404, '归档版本不存在')
            archiveId = matched.archiveId
            archived = await readArchivedTeam(stateRoot, teamId, archiveId)
            if (!archived) throw new HttpFailure(404, '归档版本损坏或不存在')
          }
          const source = join(stateRoot, 'archive', archiveId)
          await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
            if (await readTeam(stateRoot, teamId)) throw new HttpFailure(409, `活跃团队 ${teamId} 已存在，无法覆盖恢复`)
            const tmpDir = join(stateRoot, `.restore-${randomUUID()}`)
            await mkdir(tmpDir, { recursive: true })
            try {
              await cp(source, tmpDir, { recursive: true })
              await writeFile(
                join(tmpDir, 'team.json'),
                JSON.stringify(
                  {
                    ...archived,
                    phase: 'staged',
                    planReviewState: 'awaiting_review',
                    halted: false,
                    restoredFrom: archiveId,
                    updatedAt: Date.now(),
                  },
                  null,
                  2,
                ),
              )
              await rename(tmpDir, join(stateRoot, teamId))
            } finally {
              await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
            }
          })
          await broadcastSnapshots()
          return sendJson(res, 200, { status: 'restored', teamId, archiveId, phase: 'staged' })
        }
      }

      // Execution Logs & CPA Runner Trigger Endpoints
      const logsMatch = pathname.match(/^\/api\/teams\/([^/]+)\/logs$/u)
      if (logsMatch && req.method === 'GET') {
        const tid = decodeURIComponent(logsMatch[1])
        return sendJson(res, 200, { logs: logsByTeam.get(tid) ?? [] })
      }

      const runNextMatch = pathname.match(/^\/api\/teams\/([^/]+)\/run-next$/u)
      if (runNextMatch && req.method === 'POST') {
        const tid = decodeURIComponent(runNextMatch[1])
        const outcome = await runNextReadyTask({
          workspaceRoot: absWorkspace,
          teamId: tid,
          cpaBaseUrl,
          cpaApiKey,
          mockExecutor,
          onLog: recordLog,
          onSnapshot: broadcastSnapshots,
        })
        return sendJson(res, 200, outcome)
      }

      const autoRunMatch = pathname.match(/^\/api\/teams\/([^/]+)\/auto-run$/u)
      if (autoRunMatch && req.method === 'POST') {
        const tid = decodeURIComponent(autoRunMatch[1])
        const outcome = await autoRunTeam({
          workspaceRoot: absWorkspace,
          teamId: tid,
          cpaBaseUrl,
          cpaApiKey,
          mockExecutor,
          onLog: recordLog,
          onSnapshot: broadcastSnapshots,
        })
        return sendJson(res, 200, outcome)
      }

      // T3 Code-inspired Cross-Device Mobile Approval Access Info
      if (pathname === '/api/remote-access' && req.method === 'GET') {
        const reqHost = req.headers.host || '127.0.0.1:4317'
        const portPart = reqHost.includes(':') ? reqHost.split(':').at(-1) : '4317'
        const nets = networkInterfaces()
        const lanUrls = []
        for (const ifaces of Object.values(nets)) {
          for (const iface of ifaces ?? []) {
            if (iface.family === 'IPv4' && !iface.internal) {
              lanUrls.push(`http://${iface.address}:${portPart}/?view=mobile`)
            }
          }
        }
        return sendJson(res, 200, {
          ok: true,
          localMobileUrl: `http://${reqHost}/?view=mobile`,
          lanMobileUrls: lanUrls,
          isGitWorkspace: await isGitRepo(absWorkspace),
          workspaceRoot: absWorkspace,
        })
      }

      // T3 Code-inspired Task Git Worktree Isolation Endpoints
      const worktreesListMatch = pathname.match(/^\/api\/teams\/([^/]+)\/worktrees$/u)
      if (worktreesListMatch && req.method === 'GET') {
        const tid = decodeURIComponent(worktreesListMatch[1])
        const team = await readTeam(stateRoot, tid)
        if (!team) throw new HttpFailure(404, `团队不存在: ${tid}`)
        const gitReady = await isGitRepo(absWorkspace)
        const items = []
        for (const t of team.tasks) {
          if (!t.worktree?.worktreePath) continue
          const diffInfo = await inspectWorktreeDiff({
            workspaceRoot: absWorkspace,
            worktreePath: t.worktree.worktreePath,
            baseBranch: t.worktree.baseBranch || 'HEAD',
          }).catch(() => ({ ok: false, exists: false }))
          items.push({
            taskId: t.id,
            subject: t.subject,
            branch: t.worktree.branch,
            worktreePath: t.worktree.worktreePath,
            ...diffInfo,
          })
        }
        return sendJson(res, 200, { ok: true, isGitRepo: gitReady, worktrees: items })
      }

      const worktreeEnsureMatch = pathname.match(/^\/api\/teams\/([^/]+)\/tasks\/([^/]+)\/worktree\/ensure$/u)
      if (worktreeEnsureMatch && req.method === 'POST') {
        const tid = decodeURIComponent(worktreeEnsureMatch[1])
        const taskId = decodeURIComponent(worktreeEnsureMatch[2])
        const wtInfo = await ensureTaskWorktree({ workspaceRoot: absWorkspace, teamId: tid, taskId })
        if (wtInfo.isolated) {
          await withTeamLock(teamLockKey(stateRoot, tid), async () => {
            const cur = await readTeam(stateRoot, tid)
            if (!cur) throw new HttpFailure(404, `团队不存在: ${tid}`)
            const updatedTasks = cur.tasks.map((t) =>
              t.id === taskId ? { ...t, worktreeIsolated: true, worktree: wtInfo, updatedAt: Date.now() } : t,
            )
            await writeTeam(stateRoot, { ...cur, tasks: updatedTasks, updatedAt: Date.now() })
          })
          await broadcastSnapshots()
        }
        return sendJson(res, 200, { ok: true, ...wtInfo })
      }

      const worktreeMergeMatch = pathname.match(/^\/api\/teams\/([^/]+)\/tasks\/([^/]+)\/worktree\/merge$/u)
      if (worktreeMergeMatch && req.method === 'POST') {
        const tid = decodeURIComponent(worktreeMergeMatch[1])
        const taskId = decodeURIComponent(worktreeMergeMatch[2])
        const body = await readJsonBody(req)
        const team = await readTeam(stateRoot, tid)
        if (!team) throw new HttpFailure(404, `团队不存在: ${tid}`)
        const target = team.tasks.find((t) => t.id === taskId)
        if (!target?.worktree?.worktreePath || !target?.worktree?.branch) {
          throw new HttpFailure(400, `任务 ${taskId} 未绑定隔离 Git Worktree`)
        }
        const mergeOutcome = await mergeTaskWorktree({
          workspaceRoot: absWorkspace,
          worktreePath: target.worktree.worktreePath,
          branch: target.worktree.branch,
          commitMessage: body.commitMessage,
        })
        if (!mergeOutcome.ok) {
          return sendJson(res, mergeOutcome.conflict ? 409 : 400, mergeOutcome)
        }
        await withTeamLock(teamLockKey(stateRoot, tid), async () => {
          const cur = await readTeam(stateRoot, tid)
          if (!cur) return
          const updatedTasks = cur.tasks.map((t) =>
            t.id === taskId
              ? { ...t, worktree: { ...t.worktree, mergedAt: Date.now() }, updatedAt: Date.now() }
              : t,
          )
          await writeTeam(stateRoot, { ...cur, tasks: updatedTasks, updatedAt: Date.now() })
        })
        await broadcastSnapshots()
        return sendJson(res, 200, mergeOutcome)
      }

      const worktreeDeleteMatch = pathname.match(/^\/api\/teams\/([^/]+)\/tasks\/([^/]+)\/worktree$/u)
      if (worktreeDeleteMatch && req.method === 'DELETE') {
        const tid = decodeURIComponent(worktreeDeleteMatch[1])
        const taskId = decodeURIComponent(worktreeDeleteMatch[2])
        const team = await readTeam(stateRoot, tid)
        if (!team) throw new HttpFailure(404, `团队不存在: ${tid}`)
        const target = team.tasks.find((t) => t.id === taskId)
        if (target?.worktree) {
          await cleanupTaskWorktree({
            workspaceRoot: absWorkspace,
            worktreePath: target.worktree.worktreePath,
            branch: target.worktree.branch,
          })
          await withTeamLock(teamLockKey(stateRoot, tid), async () => {
            const cur = await readTeam(stateRoot, tid)
            if (!cur) return
            const updatedTasks = cur.tasks.map((t) => {
              if (t.id !== taskId) return t
              const next = { ...t, updatedAt: Date.now() }
              delete next.worktree
              return next
            })
            await writeTeam(stateRoot, { ...cur, tasks: updatedTasks, updatedAt: Date.now() })
          })
          await broadcastSnapshots()
        }
        return sendJson(res, 200, { ok: true, cleaned: true })
      }

      // Built Frontend Static Files
      if (req.method === 'GET') {
        const safeRel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/u, '')
        const candidate = resolve(distRoot, safeRel)
        if (candidate.startsWith(distRoot) && existsSync(candidate)) {
          const ext = extname(candidate)
          res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' })
          return res.end(readFileSync(candidate))
        }
        const indexHtml = join(distRoot, 'index.html')
        if (existsSync(indexHtml)) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          return res.end(readFileSync(indexHtml))
        }
      }

      return sendJson(res, 404, { error: 'Not Found' })
    } catch (err) {
      const status =
        typeof err?.status === 'number'
          ? err.status
          : typeof err?.statusCode === 'number'
            ? err.statusCode
            : 500
      return sendJson(res, status, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function haltTeamById(teamId) {
    await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
      const team = await readTeam(stateRoot, teamId)
      if (!team) throw new HttpFailure(404, `团队不存在: ${teamId}`)
      const now = Date.now()
      await writeTeam(stateRoot, {
        ...team,
        halted: true,
        haltedAt: now,
        updatedAt: now,
        members: team.members.map((m) => ({ ...m, status: 'idle' })),
        tasks: team.tasks.map((t) =>
          t.status === 'in_progress' || t.status === 'claimed'
            ? { ...t, status: 'pending', updatedAt: now }
            : t,
        ),
      })
      recordLog({
        teamId,
        level: 'info',
        timestamp: new Date().toISOString(),
        message: '团队已被手动暂停 (halted)。',
      })
    })
    await broadcastSnapshots()
  }

  const isTempWorkspace = absWorkspace.toLowerCase().startsWith(resolve(tmpdir()).toLowerCase())
  const resolvedQqDir =
    qqbotDataDir ??
    ((mockExecutor || isTempWorkspace) ? join(stateRoot, '.qqbot-test') : undefined)
  const qqStore = createQQStore(resolvedQqDir ? { dataDir: resolvedQqDir } : {})
  if (!mockExecutor && !isTempWorkspace) {
    const scratchCandidate = join(homedir(), '.gemini', 'antigravity', 'scratch')
    const currentQqCfg = qqStore.getPublicConfig()
    if (!currentQqCfg.allowedWorkspaces || currentQqCfg.allowedWorkspaces.length === 0) {
      const roots = [absWorkspace]
      if (existsSync(scratchCandidate) && !roots.includes(scratchCandidate)) {
        roots.push(scratchCandidate)
      }
      qqStore.updateConfig({
        defaultWorkspace: currentQqCfg.defaultWorkspace || (existsSync(scratchCandidate) ? scratchCandidate : absWorkspace),
        allowedWorkspaces: roots,
      })
    }
  }

  const qqRemote = createQQRemoteService({
    store: qqStore,
    workspaceRoot: absWorkspace,
    ...(qqbotGatewayFactory ? { gatewayFactory: qqbotGatewayFactory } : {}),
    onLog: (entry) => recordLog({ ...entry, teamId: entry.teamId || 'qqbot-channel' }),
    onStatusChange: (status) => broadcastSse('qqbot', status),
    onTaskUpdate: () => broadcastSse('qqbot', qqRemote.getStatus()),
    studioBridge: {
      listModels: async () => {
        const cpa = await fetchCpaModels({ baseUrl: cpaBaseUrl, apiKey: cpaApiKey, timeoutMs: 2500 })
        const friendlyMeta = new Map()
        for (const item of [...STATIC_CATALOG.cliproxyapi, ...STATIC_CATALOG.antigravity]) {
          if (item.id && !friendlyMeta.has(item.id)) friendlyMeta.set(item.id, item)
        }

        if (cpa.online && cpa.models.length > 0) {
          const priorityIds = [
            'gpt-6.1-sol',
            'gemini-4-hydrogen-xhigh',
            'gemini-4-argon-high',
            'gemini-3.8-flash-tiered',
            'gemini-3.8-flash-high',
            'claude-opus-4-6-thinking',
            'claude-opus-5-5-high',
            'claude-sonnet-5-5-high',
            'claude-sonnet-4-6',
            'gpt-6-astra',
            'gpt-6-sol',
          ]
          const priorityRank = new Map(priorityIds.map((id, idx) => [id, idx]))
          const seen = new Set()
          const liveModels = []
          for (const m of cpa.models) {
            if (!m.id || seen.has(m.id)) continue
            seen.add(m.id)
            const meta = friendlyMeta.get(m.id)
            liveModels.push({
              id: m.id,
              name: meta?.name || m.id,
              provider: m.ownedBy || meta?.provider || 'cliproxyapi',
            })
          }
          liveModels.sort((a, b) => {
            const aImg = /image/iu.test(a.id) ? 1 : 0
            const bImg = /image/iu.test(b.id) ? 1 : 0
            if (aImg !== bImg) return aImg - bImg
            const ra = priorityRank.has(a.id) ? priorityRank.get(a.id) : 999
            const rb = priorityRank.has(b.id) ? priorityRank.get(b.id) : 999
            if (ra !== rb) return ra - rb
            return a.id.localeCompare(b.id)
          })
          return { cpaOnline: true, models: liveModels }
        }

        const seen = new Set()
        const combined = []
        for (const item of [
          ...STATIC_CATALOG.cliproxyapi.map((m) => ({ ...m, provider: 'cliproxyapi' })),
          ...STATIC_CATALOG.antigravity.map((m) => ({ ...m, provider: 'antigravity' })),
        ]) {
          if (!item.id || seen.has(item.id)) continue
          seen.add(item.id)
          combined.push(item)
        }
        return { cpaOnline: cpa.online, models: combined }
      },
      runDirectModel: async ({ model, reasoningEffort, messages, tools, onToolCall, signal }) => {
        if (typeof mockExecutor === 'function') {
          return await mockExecutor({
            mode: 'direct',
            model,
            reasoningEffort,
            messages,
            tools,
            onToolCall,
            signal,
          })
        }
        const { config: desktopConfig } = readDesktopConfig({ workspaceRoot: absWorkspace, packageRoot })
        const targetBaseUrl = desktopConfig['cpa-base-url'] || cpaBaseUrl
        return await runCpaChatCompletion({
          baseUrl: targetBaseUrl,
          apiKey: cpaApiKey,
          model,
          reasoningEffort,
          messages,
          tools,
          onToolCall,
          maxRounds: 10,
          signal,
        })
      },
      createSandbox: (cwd, { signal } = {}) => createSandboxTools(cwd, { signal }),
      createAndPreviewTeam: async ({ preset, model, effort, goal, sessionId }) => {
        const presetKey = PRESET_ALIAS_MAP.get(String(preset || 'chatgpt-crew').toLowerCase()) || 'chatgpt-crew'
        const spec = buildQuickPresetSpec(presetKey, goal)
        const targetProvider = String(model || '').toLowerCase().includes('gemini') ||
          String(model || '').toLowerCase() === 'hydrogen' ||
          String(model || '').toLowerCase() === 'argon'
          ? 'antigravity'
          : 'cliproxyapi'
        const hasAntigravityMember = spec.members.some((m) => m.provider === 'antigravity')
        const members = spec.members.map((member, index) => {
          const applyModel = model
            ? presetKey === 'chatgpt-crew'
              ? true
              : targetProvider === 'antigravity'
                ? (hasAntigravityMember ? member.provider === 'antigravity' : index === 0)
                : (member.provider === 'cliproxyapi' || index === 0)
            : false
          return {
            ...member,
            ...(applyModel ? { provider: targetProvider, model } : {}),
            ...(effort && effort !== 'default' ? { reasoningEffort: effort } : {}),
          }
        })
        const teamName = deriveQuickTeamName(presetKey, goal)
        const created = await createStagedTeam({
          name: teamName,
          goal,
          members,
          tasks: spec.tasks,
          captainSessionId: sessionId || 'qqbot-remote',
          sourceLabel: `🤖 QQ 远程布置 [${presetKey}]`,
          knowledgeIds: spec.knowledgeIds,
        })
        return { teamId: created.teamId, team: created.team }
      },
      approveAndRunTeam: async ({ teamId, onProgress }) => {
        await handlePlanMutation({ teamId, action: 'approve', autoRun: false })
        return await autoRunTeam({
          workspaceRoot: absWorkspace,
          teamId,
          cpaBaseUrl,
          cpaApiKey,
          mockExecutor,
          onLog: (entry) => {
            recordLog(entry)
            if (entry?.message && typeof onProgress === 'function') {
              void onProgress(entry.message)
            }
          },
          onSnapshot: broadcastSnapshots,
        })
      },
      discardTeam: async (teamId) => handlePlanMutation({ teamId, action: 'discard' }),
      haltTeam: async (teamId) => haltTeamById(teamId),
      getTeamStatus: async (teamId) => {
        const t = await readTeam(stateRoot, teamId)
        return t ? assembleStudioSnapshot(absWorkspace, t) : null
      },
    },
  })

  const closeAll = () => {
    try {
      qqRemote.stopSync?.()
    } catch {}
    try {
      qqStore.close()
    } catch {}
  }

  return {
    createHttpServer: () => {
      const srv = createServer(handleRequest)
      srv.on('close', closeAll)
      return srv
    },
    handleRequest,
    broadcastSnapshots,
    startChannels: () => qqRemote.start(),
    stopChannels: async () => {
      await qqRemote.stop().catch(() => {})
      qqStore.close()
    },
    close: closeAll,
    qqRemote,
  }
}
