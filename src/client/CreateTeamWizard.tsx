/**
 * CreateTeamWizard: 4-step wizard modal for creating and staging AgentTeams.
 *
 * Implements:
 * 1. Step 1: Team Profile & Goal (name sanitation, character limit)
 * 2. Step 2: Presets & Templates (B2 template layer, one-click apply)
 * 3. Step 3: Member Configuration with CandidateModels:
 *    - Full Antigravity 23-model catalog support
 *    - Pinned Gemini 3.8 Flash series (low/medium/high/tiered)
 *    - Static 3-state health check (GR-04)
 *    - Capabilities & No-assign tag pills
 * 4. Step 4: Topology, Cost Guard & 6-state Async Submission
 *
 * @module dsh-agent-teams/client/create-team-wizard
 */

import { useState, useCallback, useId, useEffect, useRef, type FormEvent } from 'react'
import type { SessionId } from './dsh-shims.ts'
import {
  ALL_CANDIDATE_MODELS,
  ANTIGRAVITY_CANDIDATE_MODELS,
  validateMemberLlmSelections,
  type CandidateModel,
} from './candidate-models.ts'
import type { AgentTeamsTranslate } from './locales.ts'
import css from './CreateTeamWizard.module.css'
import { normalizeTeamName, teamRequest, reconcileTeam, OutcomeUnknown, type OperationState } from './team-management.ts'
import { PROMPT_TEMPLATES } from '../prompt-templates.ts'

export interface MemberDraft {
  readonly id: string
  name: string
  role: string
  provider: string
  model: string
  reasoningEffort: string
  capabilities: string[]
  noAssign: string[]
  executionPrompt?: string
}

export interface PresetTask {
  readonly id: string
  readonly subject: string
  readonly assignee: string
  readonly dependencies?: readonly string[]
}

export interface PresetTemplate {
  readonly id: string
  readonly name: string
  readonly desc: string
  readonly icon: string
  readonly members: readonly Omit<MemberDraft, 'id'>[]
  readonly tasks?: readonly PresetTask[]
}

export const BUILTIN_TEMPLATES: readonly PresetTemplate[] = [
  {
    id: 'chatgpt-crew',
    name: '敏捷多模工程组 (CPA GPT-Sol + 哈吉米审美/调研)',
    desc: 'researcher (哈吉米调研与前端) + ui-aesthetics (哈吉米常驻审美官) + engineer (CPA gpt-6.1-sol) + doc-writer (哈吉米撰稿官)',
    icon: '⚙️',
    members: [
      {
        name: 'researcher',
        role: '调研分析与前端交互开发（哈吉米调研官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'medium',
        capabilities: ['research', 'frontend', 'hajimi-persona'],
        noAssign: ['backend-db-migration'],
        executionPrompt: PROMPT_TEMPLATES.researcher,
      },
      {
        name: 'ui-aesthetics',
        role: '常驻审美成员（哈吉米审美官 · 联网参考同类软件审美与 UI 优化）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['ui-aesthetics', 'design-system', 'benchmark-search', 'hajimi-persona'],
        noAssign: ['backend-db-migration', 'git-push-force'],
        executionPrompt: PROMPT_TEMPLATES.uiAesthetics,
      },
      {
        name: 'engineer',
        role: '后端核心实现与集成验证（CPA GPT-6.1-Sol）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        reasoningEffort: 'high',
        capabilities: ['backend', 'testing', 'architecture'],
        noAssign: ['git-push-force'],
        executionPrompt: PROMPT_TEMPLATES.engineer,
      },
      {
        name: 'doc-writer',
        role: '报告与交付规范撰写（哈吉米撰稿官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'medium',
        capabilities: ['documentation', 'report-writing', 'hajimi-persona'],
        noAssign: ['git-push-force'],
        executionPrompt: PROMPT_TEMPLATES.docWriter,
      },
    ],
    tasks: [
      { id: 'research', subject: '需求拆解与技术方案调研', assignee: 'researcher' },
      { id: 'aesthetics', subject: '联网参考同类标杆软件审美与 UI 交互优化设计', assignee: 'ui-aesthetics', dependencies: ['research'] },
      { id: 'build', subject: '核心工程实现与测试验证', assignee: 'engineer', dependencies: ['research', 'aesthetics'] },
      { id: 'report', subject: '交付验收报告与使用指南汇编', assignee: 'doc-writer', dependencies: ['build'] },
    ],
  },
  {
    id: 'heterogeneous-cross-review',
    name: '标准异构多模型双审队 (CPA GPT-Sol + 哈吉米全阵容)',
    desc: 'Argon哈吉米架构 + CPA GPT-6.1-Sol核心攻坚与L2白盒自修 + 哈吉米常驻审美官 + 哈吉米黑盒反向证伪与报告汇编',
    icon: '🏆',
    members: [
      {
        name: 'arch-planner',
        role: '需求澄清与架构设计（哈吉米架构官）',
        provider: 'antigravity',
        model: 'hydrogen',
        reasoningEffort: 'high',
        capabilities: ['architecture', 'spec', 'planning', 'hajimi-persona'],
        noAssign: ['direct-commit'],
        executionPrompt: PROMPT_TEMPLATES.architect,
      },
      {
        name: 'core-engineer',
        role: '底层核心工程实现（CPA GPT-6.1-Sol）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        reasoningEffort: 'high',
        capabilities: ['backend', 'storage', 'concurrency'],
        noAssign: ['git-push-force'],
        executionPrompt: PROMPT_TEMPLATES.engineer,
      },
      {
        name: 'ui-aesthetics',
        role: '常驻审美成员（哈吉米审美官 · 联网参考同类软件审美与 UI 优化）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['ui-aesthetics', 'design-system', 'ux-polish', 'hajimi-persona'],
        noAssign: ['production-write', 'git-push-force'],
        executionPrompt: PROMPT_TEMPLATES.uiAesthetics,
      },
      {
        name: 'audit-gpt',
        role: 'L2 独立白盒审查与自闭环修复（CPA GPT-6.1-Sol）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        reasoningEffort: 'high',
        capabilities: ['code-review', 'formal-verification', 'bugfix'],
        noAssign: ['production-write'],
        executionPrompt: PROMPT_TEMPLATES.gptReviewer,
      },
      {
        name: 'audit-gemini',
        role: 'L3 黑盒监督官与反向证伪实测（哈吉米红队督察官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['red-team', 'sandbox-audit', 'testing', 'hajimi-persona'],
        noAssign: ['production-write', 'git-push-force'],
        executionPrompt: PROMPT_TEMPLATES.geminiSupervisor,
      },
      {
        name: 'doc-writer',
        role: '技术白皮书与交付汇编（哈吉米撰稿官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['documentation', 'summary', 'hajimi-persona'],
        noAssign: ['code-execution'],
        executionPrompt: PROMPT_TEMPLATES.docWriter,
      },
    ],
    tasks: [
      { id: 'spec', subject: '需求澄清、架构拓扑与接口契约设计', assignee: 'arch-planner' },
      { id: 'impl', subject: '核心逻辑编码实现与单测自测覆盖', assignee: 'core-engineer', dependencies: ['spec'] },
      { id: 'ui-polish', subject: '联网参考同类软件审美与 UI/UX 交互优化', assignee: 'ui-aesthetics', dependencies: ['spec'] },
      { id: 'review-gpt', subject: 'GPT独立白盒逻辑走查与自闭环修复', assignee: 'audit-gpt', dependencies: ['impl'] },
      { id: 'review-gemini', subject: 'Gemini哈吉米独立黑盒监督、沙箱穿透与反向证伪终测', assignee: 'audit-gemini', dependencies: ['impl', 'ui-polish'] },
      { id: 'delivery', subject: '全量交付物汇编、文档规范与自测指南', assignee: 'doc-writer', dependencies: ['review-gpt', 'review-gemini'] },
      { id: 'retrospective', subject: '团队全流程实战复盘与长效机制沉淀报告', assignee: 'audit-gemini', dependencies: ['delivery'] },
    ],
  },
  {
    id: 'ai-radar-squad',
    name: 'AI 资讯雷达与评估团队 (CPA + 哈吉米编队)',
    desc: '全网多渠道定时抓取 + 内容清洗去重 + 哈吉米审美对标 + 主机契合度评分 + 哈吉米撰稿与复盘',
    icon: '📡',
    members: [
      {
        name: 'arch-planner',
        role: '系统架构与需求规格设计师（哈吉米架构官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['architecture', 'spec', 'hajimi-persona'],
        noAssign: ['direct-commit'],
        executionPrompt: PROMPT_TEMPLATES.architect,
      },
      {
        name: 'researcher',
        role: '开源生态调研与技术选型专家（哈吉米调研官）',
        provider: 'antigravity',
        model: 'hydrogen',
        reasoningEffort: 'high',
        capabilities: ['research', 'audit', 'hajimi-persona'],
        noAssign: ['production-write'],
        executionPrompt: PROMPT_TEMPLATES.researcher,
      },
      {
        name: 'core-engineer',
        role: '核心抓取与分析流水线工程师（CPA GPT-6.1-Sol）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        reasoningEffort: 'high',
        capabilities: ['crawler', 'scoring-engine', 'scheduler'],
        noAssign: ['git-push-force'],
        executionPrompt: PROMPT_TEMPLATES.engineer,
      },
      {
        name: 'ui-aesthetics',
        role: '常驻审美成员（哈吉米审美官 · 联网参考同类软件审美与 UI 优化）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['ui-aesthetics', 'design-system', 'hajimi-persona'],
        noAssign: ['production-write'],
        executionPrompt: PROMPT_TEMPLATES.uiAesthetics,
      },
      {
        name: 'audit-gpt',
        role: '独立L2白盒审查与自修复专家（CPA GPT-6.1-Sol）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        reasoningEffort: 'high',
        capabilities: ['code-review', 'bugfix'],
        noAssign: ['production-write'],
        executionPrompt: PROMPT_TEMPLATES.gptReviewer,
      },
      {
        name: 'audit-gemini',
        role: '独立L3黑盒监督与反向证伪实测（哈吉米督察官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['red-team', 'testing', 'hajimi-persona'],
        noAssign: ['production-write'],
        executionPrompt: PROMPT_TEMPLATES.geminiSupervisor,
      },
      {
        name: 'doc-writer',
        role: '技术白皮书与规范文档撰写师（哈吉米撰稿官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['documentation', 'summary', 'hajimi-persona'],
        noAssign: ['code-execution'],
        executionPrompt: PROMPT_TEMPLATES.docWriter,
      },
    ],
    tasks: [
      { id: 'spec', subject: '需求完善与系统功能规格说明书编制', assignee: 'arch-planner' },
      { id: 'survey', subject: '全网开源生态调研与技术选型对比报告', assignee: 'researcher', dependencies: ['spec'] },
      { id: 'architecture', subject: '系统核心架构与详细模块接口设计', assignee: 'core-engineer', dependencies: ['survey'] },
      { id: 'ui-aesthetics', subject: '联网参考同类标杆软件审美与界面优化方案', assignee: 'ui-aesthetics', dependencies: ['survey'] },
      { id: 'review-gpt', subject: 'GPT独立白盒审查与自闭环修复', assignee: 'audit-gpt', dependencies: ['architecture'] },
      { id: 'review-gemini', subject: 'Gemini哈吉米独立黑盒监督与反向证伪终测', assignee: 'audit-gemini', dependencies: ['architecture', 'ui-aesthetics'] },
      { id: 'final-doc', subject: '项目立项白皮书与首期实施方案汇编', assignee: 'doc-writer', dependencies: ['review-gpt', 'review-gemini'] },
      { id: 'retrospective', subject: '团队全流程实战复盘与长效机制沉淀报告', assignee: 'audit-gemini', dependencies: ['final-doc'] },
    ],
  },
  {
    id: 'novixlink-ops',
    name: 'NovixLink VPS 运维与排障组 (zkl & v4.3)',
    desc: '内置 VPS 统一监控主控中心 v4.3 手册上下文：双账号 RBAC、×2 计费、两级限速解限与 @VpsPingBellBot SOP',
    icon: '📡',
    members: [
      {
        name: 'ops-diagnostician',
        role: 'NovixLink 运维诊断官（哈吉米 · v4.3 SOP）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['vps-ops', 'diagnostics', 'hajimi-persona'],
        noAssign: ['root-credential-leak'],
        executionPrompt: PROMPT_TEMPLATES.researcher,
      },
      {
        name: 'ops-engineer',
        role: 'VPS 排障与脚本工程师（CPA GPT-6.1-Sol）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        reasoningEffort: 'high',
        capabilities: ['vps-ops', 'network-analysis', 'runbook'],
        noAssign: ['blind-password-retry'],
        executionPrompt: PROMPT_TEMPLATES.engineer,
      },
      {
        name: 'audit-gemini',
        role: 'RBAC 边界与排障结论独立复核官（Hydrogen 哈吉米）',
        provider: 'antigravity',
        model: 'hydrogen',
        reasoningEffort: 'high',
        capabilities: ['rbac-audit', 'red-team', 'hajimi-persona'],
        noAssign: ['production-write'],
        executionPrompt: PROMPT_TEMPLATES.geminiSupervisor,
      },
    ],
    tasks: [
      { id: 'triage', subject: '对照 v4.3 手册梳理症状与诊断路径', assignee: 'ops-diagnostician' },
      { id: 'remediate', subject: '输出可执行的 TG / Web 排障方案', assignee: 'ops-engineer', dependencies: ['triage'] },
      { id: 'verify-rbac', subject: '独立复核 RBAC 边界与防爆破规则', assignee: 'audit-gemini', dependencies: ['remediate'] },
    ],
  },
  {
    id: 'gemini-flash-squad',
    name: 'Gemini 3.8 哈吉米极速协作队',
    desc: '全员搭载【哈吉米人设】与反重力 1M 长上下文，含常驻审美官 ui-aesthetics 与哈吉米撰稿官 doc-writer',
    icon: '⚡',
    members: [
      {
        name: 'gemini-lead-worker',
        role: '核心实现与综合分析（哈吉米主工）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'medium',
        capabilities: ['typescript', 'architecture', 'refactor', 'hajimi-persona'],
        noAssign: ['production-database-write', 'git-push-force'],
        executionPrompt: PROMPT_TEMPLATES.architect,
      },
      {
        name: 'ui-aesthetics',
        role: '常驻审美成员（哈吉米审美官 · 联网参考同类软件审美与 UI 优化）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['ui-aesthetics', 'design-system', 'hajimi-persona'],
        noAssign: ['production-database-write'],
        executionPrompt: PROMPT_TEMPLATES.uiAesthetics,
      },
      {
        name: 'gemini-speed-reviewer',
        role: '极速代码规范走查（哈吉米督察官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-high',
        reasoningEffort: 'high',
        capabilities: ['code-review', 'ast-analysis', 'hajimi-persona'],
        noAssign: ['production-database-write'],
        executionPrompt: PROMPT_TEMPLATES.geminiSupervisor,
      },
      {
        name: 'doc-writer',
        role: '报告与文档汇编（哈吉米撰稿官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'medium',
        capabilities: ['documentation', 'hajimi-persona'],
        noAssign: ['production-database-write'],
        executionPrompt: PROMPT_TEMPLATES.docWriter,
      },
    ],
  },
  {
    id: 'code-review-team',
    name: '代码规范与审美双审队',
    desc: 'GPT-6.1 Sol 白盒审查 + 哈吉米红队监督 + 哈吉米常驻审美官 UI 对标走查',
    icon: '🛡️',
    members: [
      {
        name: 'gpt-reviewer',
        role: 'L2 独立白盒逻辑走查（CPA GPT-6.1-Sol）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        reasoningEffort: 'high',
        capabilities: ['code-review', 'formal-verification'],
        noAssign: ['direct-commit', 'production-write'],
        executionPrompt: PROMPT_TEMPLATES.gptReviewer,
      },
      {
        name: 'ui-aesthetics',
        role: '常驻审美成员（哈吉米审美官 · 联网参考同类软件审美与 UI 优化）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['ui-aesthetics', 'ux-audit', 'hajimi-persona'],
        noAssign: ['direct-commit', 'production-write'],
        executionPrompt: PROMPT_TEMPLATES.uiAesthetics,
      },
      {
        name: 'gemini-reviewer',
        role: 'L3 黑盒合规与反向证伪实测（哈吉米督察官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['red-team', 'sandbox-audit', 'testing', 'hajimi-persona'],
        noAssign: ['production-write', 'git-push-force'],
        executionPrompt: PROMPT_TEMPLATES.geminiSupervisor,
      },
    ],
  },
  {
    id: 'fullstack-dev-team',
    name: '全栈特性与高定审美研发队',
    desc: '哈吉米前端专家 + 哈吉米常驻审美官 + CPA GPT-6.1-Sol 后端专家 + 哈吉米撰稿官',
    icon: '🚀',
    members: [
      {
        name: 'frontend-dev',
        role: '前端交互与组件落地（哈吉米前端官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-medium',
        reasoningEffort: 'medium',
        capabilities: ['ui-design', 'react', 'css', 'hajimi-persona'],
        noAssign: ['backend-db-migration'],
        executionPrompt: PROMPT_TEMPLATES.researcher,
      },
      {
        name: 'ui-aesthetics',
        role: '常驻审美成员（哈吉米审美官 · 联网参考同类软件审美与 UI 优化）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['ui-aesthetics', 'design-system', 'hajimi-persona'],
        noAssign: ['backend-db-migration'],
        executionPrompt: PROMPT_TEMPLATES.uiAesthetics,
      },
      {
        name: 'backend-dev',
        role: '服务端与持久化工程（CPA GPT-6.1-Sol）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        reasoningEffort: 'high',
        capabilities: ['backend', 'storage', 'concurrency'],
        noAssign: ['git-push-force'],
        executionPrompt: PROMPT_TEMPLATES.engineer,
      },
      {
        name: 'doc-writer',
        role: '交付文档与报告撰写（哈吉米撰稿官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'medium',
        capabilities: ['documentation', 'hajimi-persona'],
        noAssign: ['git-push-force'],
        executionPrompt: PROMPT_TEMPLATES.docWriter,
      },
    ],
  },
  {
    id: 'research-squad',
    name: '深度技术调研与审美研报队',
    desc: '哈吉米检索专家 + 哈吉米常驻审美官 + 哈吉米撰稿官，快速生成深度对比白皮书',
    icon: '📚',
    members: [
      {
        name: 'lead-researcher',
        role: '文献检索与横向对比（哈吉米调研官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-low',
        reasoningEffort: 'low',
        capabilities: ['research', 'literature-review', 'hajimi-persona'],
        noAssign: ['code-execution'],
        executionPrompt: PROMPT_TEMPLATES.researcher,
      },
      {
        name: 'ui-aesthetics',
        role: '常驻审美成员（哈吉米审美官 · 联网参考同类软件审美与 UI 优化）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['ui-aesthetics', 'benchmark-search', 'hajimi-persona'],
        noAssign: ['code-execution'],
        executionPrompt: PROMPT_TEMPLATES.uiAesthetics,
      },
      {
        name: 'doc-writer',
        role: '研究报告与白皮书撰写（哈吉米撰稿官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'medium',
        capabilities: ['documentation', 'summary', 'hajimi-persona'],
        noAssign: ['code-execution'],
        executionPrompt: PROMPT_TEMPLATES.docWriter,
      },
    ],
  },
]

export interface CreateTeamWizardProps {
  readonly open: boolean
  readonly sessionId?: SessionId
  readonly onClose: () => void
  readonly onTeamCreated?: (teamId: string) => void
  readonly t?: AgentTeamsTranslate
  readonly maxMembers?: number
}

export function CreateTeamWizard({
  open,
  sessionId: rawSessionId,
  onClose,
  onTeamCreated,
  maxMembers = 8,
}: CreateTeamWizardProps) {
  const [catalogs, setCatalogs] = useState<Record<string, { id: string; name?: string }[]>>({})
  const [runtimeProviders, setRuntimeProviders] = useState<
    readonly { id: string; name: string; icon?: string; models: { id: string; name?: string }[] }[]
  >([])
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [teamName, setTeamName] = useState('')
  const [goal, setGoal] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(BUILTIN_TEMPLATES[0]?.id ?? 'heterogeneous-cross-review')
  const [templateTasks, setTemplateTasks] = useState<readonly PresetTask[] | null>(
    BUILTIN_TEMPLATES[0]?.tasks ?? null,
  )
  const [members, setMembers] = useState<MemberDraft[]>(() =>
    (BUILTIN_TEMPLATES[0]?.members ?? []).map((m, idx) => ({
      ...m,
      id: `m-init-${idx}`,
      capabilities: [...m.capabilities],
      noAssign: [...m.noAssign],
    })),
  )

  useEffect(() => {
    if (!open) return
    let current = true
    void fetch('/api/models', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!current || !data?.providers) return
        setRuntimeProviders(data.providers)
        const nextMap: Record<string, { id: string; name?: string }[]> = {}
        for (const p of data.providers) {
          nextMap[p.id] = p.models ?? []
        }
        setCatalogs((prev) => ({ ...prev, ...nextMap }))
      })
      .catch(() => {})
    for (const provider of new Set(members.map(member => member.provider))) {
      void teamRequest(`/plugins/dsh-agent-teams/teams/catalog?provider=${encodeURIComponent(provider)}`).then(data => {
        if (current) setCatalogs(previous => ({ ...previous, [provider]: data.models }))
      }).catch(() => {})
    }
    return () => { current = false }
  }, [open, members.map(member => member.provider).join(',')])

  // New tag draft state keyed by member id
  const [newCapDraft, setNewCapDraft] = useState<Record<string, string>>({})
  const [newNoAssignDraft, setNewNoAssignDraft] = useState<Record<string, string>>({})

  // Form submission state
  const [operation, setOperation] = useState<OperationState>('idle')
  const submitting = operation === 'validating' || operation === 'submitting'
  const busy = useRef(false)
  const sessionId = rawSessionId ?? 'antigravity-captain'
  const context = useRef(sessionId)
  context.current = sessionId
  const [sanitizedTeamId, setSanitizedTeamId] = useState('')
  useEffect(() => { let current = true; void normalizeTeamName(teamName).then(id => { if (current) setSanitizedTeamId(id) }); return () => { current = false } }, [teamName])
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [open, onClose])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)

  const applyTemplate = (tmpl: PresetTemplate) => {
    setSelectedTemplate(tmpl.id)
    setTemplateTasks(tmpl.tasks ? [...tmpl.tasks] : null)
    setMembers(
      tmpl.members.map((m, idx) => ({
        ...m,
        id: `m-${Date.now()}-${idx}`,
        capabilities: [...m.capabilities],
        noAssign: [...m.noAssign],
      })),
    )
  }

  const addMember = () => {
    if (members.length >= maxMembers) return
    const newIdx = members.length + 1
    setMembers([
      ...members,
      {
        id: `m-${Date.now()}-${newIdx}`,
        name: `worker-${newIdx}`,
        role: '特性开发（哈吉米特工）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'medium',
        capabilities: ['typescript', 'hajimi-persona'],
        noAssign: ['production-write'],
      },
    ])
  }

  const addAestheticMember = () => {
    if (members.length >= maxMembers) return
    const exists = members.some((m) => m.name === 'ui-aesthetics')
    const name = exists ? `ui-aesthetics-${members.length + 1}` : 'ui-aesthetics'
    setMembers([
      ...members,
      {
        id: `m-${Date.now()}-ui`,
        name,
        role: '常驻审美成员（哈吉米审美官 · 联网参考同类软件审美与 UI 优化）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        reasoningEffort: 'high',
        capabilities: ['ui-aesthetics', 'design-system', 'benchmark-search', 'hajimi-persona'],
        noAssign: ['production-write', 'git-push-force'],
        executionPrompt: PROMPT_TEMPLATES.uiAesthetics,
      },
    ])
  }

  const removeMember = (id: string) => {
    if (members.length <= 1) return
    setMembers(members.filter((m) => m.id !== id))
  }

  const updateMember = (id: string, patch: Partial<MemberDraft>) => {
    setMembers(members.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  const addCapability = (memberId: string) => {
    const val = (newCapDraft[memberId] ?? '').trim()
    if (!val) return
    const mem = members.find((m) => m.id === memberId)
    if (mem && !mem.capabilities.includes(val)) {
      updateMember(memberId, { capabilities: [...mem.capabilities, val] })
    }
    setNewCapDraft((prev) => ({ ...prev, [memberId]: '' }))
  }

  const removeCapability = (memberId: string, cap: string) => {
    const mem = members.find((m) => m.id === memberId)
    if (mem) {
      updateMember(memberId, { capabilities: mem.capabilities.filter((c) => c !== cap) })
    }
  }

  const addNoAssign = (memberId: string) => {
    const val = (newNoAssignDraft[memberId] ?? '').trim()
    if (!val) return
    const mem = members.find((m) => m.id === memberId)
    if (mem && !mem.noAssign.includes(val)) {
      updateMember(memberId, { noAssign: [...mem.noAssign, val] })
    }
    setNewNoAssignDraft((prev) => ({ ...prev, [memberId]: '' }))
  }

  const removeNoAssign = (memberId: string, item: string) => {
    const mem = members.find((m) => m.id === memberId)
    if (mem) {
      updateMember(memberId, { noAssign: mem.noAssign.filter((na) => na !== item) })
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy.current || operation === 'outcome_unknown' || operation === 'succeeded') return

    if (!teamName.trim()) {
      setSubmitError('请输入团队名称')
      setStep(1)
      return
    }

    if (!goal.trim()) {
      setSubmitError('请输入团队核心目标')
      setStep(1)
      return
    }

    if (!sessionId) { setSubmitError('请先选择一个主会话作为队长'); return }
    busy.current = true
    const boundSession = sessionId
    setOperation('validating')
    setSubmitError(null)

    const payload = {
      name: teamName.trim(),
      goal: goal.trim(),
      approval: 'required',
      reuseSessionId: sessionId,
      members: members.map((m) => ({
        name: m.name.trim(),
        role: m.role.trim(),
        provider: m.provider.trim(),
        model: m.model.trim(),
        reasoningEffort: m.reasoningEffort,
        ...(m.executionPrompt ? { executionPrompt: m.executionPrompt } : {}),
        ...(m.capabilities.length ? { capabilities: m.capabilities } : {}),
        ...(m.noAssign.length ? { noAssign: m.noAssign } : {}),
      })),
      tasks: (templateTasks && templateTasks.length > 0)
        ? templateTasks.map((t) => ({
            id: t.id,
            subject: t.subject,
            assignee: members.some((m) => m.name === t.assignee) ? t.assignee : (members[0]?.name || 'worker-1'),
            dependencies: t.dependencies ? [...t.dependencies] : [],
          }))
        : [
            {
              id: 'task-1',
              subject: '需求与任务拆解',
              assignee: members[0]?.name || 'worker-1',
              dependencies: [],
            },
          ],
      ...(selectedTemplate === 'novixlink-ops' ? { knowledgeIds: ['vps-zkl-novixlink'] } : {}),
    }

    try {
      setOperation('submitting')
      const resData = await teamRequest('/plugins/dsh-agent-teams/teams', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (context.current !== boundSession) return
      setOperation('succeeded')
      setSubmitSuccess('方案已提交待人工审阅；成员尚未启动。')
      onTeamCreated?.(resData.teamId)
    } catch (err: unknown) {
      if (context.current !== boundSession) return
      if (err instanceof OutcomeUnknown) {
        setOperation('outcome_unknown')
        setSubmitError(err.message + ' 正在查询最新状态…')
        try {
          const team = await reconcileTeam(await normalizeTeamName(payload.name))
          if (context.current !== boundSession) return
          if (team?.captainSessionId === boundSession && team.phase === 'staged') {
            setOperation('succeeded'); setSubmitError(null); setSubmitSuccess('已查询确认方案提交成功。'); onTeamCreated?.(team.id)
          } else setSubmitError('结果仍未知，请刷新侧边栏核对；不会自动重发。')
        } catch { setSubmitError('状态查询失败，保留草稿；请刷新核对，勿重复提交。') }
      } else {
        setOperation('failed')
        setSubmitError(err instanceof Error ? err.message : String(err))
      }
    } finally { busy.current = false }
  }

  if (!open) return null

  return (
    <div className={css.wizardBackdrop} onClick={onClose} role="dialog" aria-modal="true" aria-label="新建协作团队">
      <div className={css.wizardModal} onClick={(e) => e.stopPropagation()}>
        {/* Step Indicator Bar */}
        <div className={css.stepBar}>
          <button
            type="button"
            className={css.stepItem}
            data-active={step === 1}
            data-completed={step > 1}
            onClick={() => setStep(1)}
          >
            <span className={css.stepNumber}>1</span>
            <span>团队档案</span>
          </button>
          <button
            type="button"
            className={css.stepItem}
            data-active={step === 2}
            data-completed={step > 2}
            onClick={() => setStep(2)}
          >
            <span className={css.stepNumber}>2</span>
            <span>方案选型</span>
          </button>
          <button
            type="button"
            className={css.stepItem}
            data-active={step === 3}
            data-completed={step > 3}
            onClick={() => setStep(3)}
          >
            <span className={css.stepNumber}>3</span>
            <span>成员与模型</span>
          </button>
          <button
            type="button"
            className={css.stepItem}
            data-active={step === 4}
            data-completed={step > 4}
            onClick={() => setStep(4)}
          >
            <span className={css.stepNumber}>4</span>
            <span>成本与提审</span>
          </button>
        </div>

        {/* Content Area */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div className={css.stepContentArea}>
            {step === 1 && (
              <>
                <div className={css.formGroup}>
                  <label className={css.formLabel}>
                    <span>团队名称 (Team Name)</span>
                    {sanitizedTeamId && (
                      <span className={css.formHint}>系统标识: {sanitizedTeamId}</span>
                    )}
                  </label>
                  <input
                    type="text"
                    className={css.formInput}
                    placeholder="例如: gemini-speed-squad"
                    maxLength={48}
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    required
                  />
                  <span className={css.formHint}>由小写字母、数字及下划线组成，创建后不可更改</span>
                </div>

                <div className={css.formGroup}>
                  <label className={css.formLabel}>
                    <span>团队核心目标 (Goal)</span>
                    <span className={css.formHint}>{goal.length} / 1000</span>
                  </label>
                  <textarea
                    className={css.formTextarea}
                    placeholder="在此输入本团队要解决的问题、核心交付物要求或验收边界..."
                    maxLength={1000}
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    required
                  />
                </div>

                <div className={css.formGroup}>
                  <label className={css.formLabel}>
                    <span>领队会话绑定 (Captain Session)</span>
                  </label>
                  <input
                    type="text"
                    className={css.formInput}
                    value={sessionId ?? '当前活动会话 (自动绑定)'}
                    readOnly
                    disabled
                  />
                  <span className={css.formHint}>所有子 Agent 将由当前会话统一调度，上下文与沙箱严格受限</span>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className={css.formGroup}>
                  <label className={css.formLabel}>
                    <span>推荐预设模板（一键应用）</span>
                  </label>
                  <div className={css.templateGrid}>
                    {BUILTIN_TEMPLATES.map((tmpl) => (
                      <div
                        key={tmpl.id}
                        className={css.templateCard}
                        data-selected={selectedTemplate === tmpl.id}
                        onClick={() => applyTemplate(tmpl)}
                      >
                        <div className={css.templateTitle}>
                          <span>{tmpl.icon}</span>
                          <span>{tmpl.name}</span>
                        </div>
                        <div className={css.templateDesc}>{tmpl.desc}</div>
                        <div className={css.templateMeta}>预设成员: {tmpl.members.length} 人</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>团队成员配置 ({members.length}/{maxMembers})</span>
                  {members.length < 8 && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className={css.btnSecondary} onClick={addAestheticMember}>
                        + 添加哈吉米审美官 (ui-aesthetics)
                      </button>
                      <button type="button" className={css.btnSecondary} onClick={addMember}>
                        + 添加成员
                      </button>
                    </div>
                  )}
                </div>

                <div className={css.memberCardsStack}>
                  {members.map((mem, idx) => {
                    const health = validateMemberLlmSelections(mem.provider, mem.model, catalogs[mem.provider])
                    const isAntigravity = mem.provider.toLowerCase() === 'antigravity'
                    const isTopRanked = ANTIGRAVITY_CANDIDATE_MODELS.some(
                      (m) => m.id === mem.model && m.isTopRanked,
                    )

                    return (
                      <div key={mem.id} className={css.memberCard}>
                        <div className={css.memberHeader}>
                          <span className={css.memberIndex}>
                            成员 #{idx + 1} {isTopRanked && <span className={css.topRankedBadge}>✨ Gemini 3.8 · 哈吉米置顶推荐</span>}
                          </span>
                          {members.length > 1 && (
                            <button
                              type="button"
                              className={css.removeMemberBtn}
                              onClick={() => removeMember(mem.id)}
                            >
                              移除
                            </button>
                          )}
                        </div>

                        <div className={css.memberRow}>
                          <div className={css.formGroup}>
                            <label className={css.formLabel}>成员名称</label>
                            <input
                              type="text"
                              className={css.formInput}
                              value={mem.name}
                              onChange={(e) => updateMember(mem.id, { name: e.target.value })}
                              required
                            />
                          </div>
                          <div className={css.formGroup}>
                            <label className={css.formLabel}>职责角色</label>
                            <input
                              type="text"
                              className={css.formInput}
                              value={mem.role}
                              onChange={(e) => updateMember(mem.id, { role: e.target.value })}
                              required
                            />
                          </div>
                        </div>

                        <div className={css.memberRow}>
                          <div className={css.formGroup}>
                            <label className={css.formLabel}>模型供应商 / 中转站</label>
                            <select
                              className={css.formSelect}
                              value={mem.provider}
                              onChange={(e) => {
                                const newP = e.target.value
                                const provEntry = runtimeProviders.find((p) => p.id === newP)
                                const firstM =
                                  provEntry?.models?.[0]?.id ||
                                  (newP === 'cliproxyapi'
                                    ? 'gpt-6.1-sol'
                                    : newP === 'antigravity'
                                      ? 'gemini-3.8-flash-tiered'
                                      : newP === 'zcode'
                                        ? 'glm-4.5'
                                        : newP === 'opencode'
                                          ? 'claude-sonnet-4-6'
                                          : 'gpt-6.1-sol')
                                updateMember(mem.id, { provider: newP, model: firstM })
                              }}
                            >
                              {runtimeProviders.length > 0 ? (
                                runtimeProviders.map((prov) => (
                                  <option key={prov.id} value={prov.id}>
                                    {prov.icon ? `${prov.icon} ` : ''}
                                    {prov.name} ({prov.models?.length ?? 0})
                                  </option>
                                ))
                              ) : (
                                <>
                                  <option value="cliproxyapi">🔀 EasyCLIProxyAPI (CPA 统一渠道)</option>
                                  <option value="antigravity">🪐 Google Antigravity (反重力 · 哈吉米)</option>
                                  <option value="codex">💻 OpenAI Codex</option>
                                  <option value="dsh">🐉 DSH AgentTeams</option>
                                  <option value="zcode">⚡ ZCode (智谱编码代理)</option>
                                  <option value="opencode">🧩 OpenCode (Zen 终端路由)</option>
                                  <option value="newapi">🏮 NewAPI / OneAPI 中转站</option>
                                  <option value="openrouter">🌐 OpenRouter 中转</option>
                                  <option value="anthropic">🎭 Anthropic Official</option>
                                </>
                              )}
                            </select>
                          </div>

                          <div className={css.formGroup}>
                            <label className={css.formLabel}>
                              <span>模型选择 (Model)</span>
                              {isAntigravity && <span className={css.topRankedBadge}>反重力 · 哈吉米人设</span>}
                            </label>
                            <select
                              className={css.formSelect}
                              value={mem.model}
                              onChange={(e) => updateMember(mem.id, { model: e.target.value })}
                            >
                              {isAntigravity ? (
                                <>
                                  <optgroup label="🌟 Gemini 3.8 Flash · 哈吉米系列（置顶首选 · 1M/64K）">
                                    <option value="gemini-3.8-flash-tiered">Gemini 3.8 Flash (Tiered · 哈吉米审美/撰稿主力)</option>
                                    <option value="gemini-3.8-flash-high">Gemini 3.8 Flash (High · 哈吉米高思考)</option>
                                    <option value="gemini-3.8-flash-medium">Gemini 3.8 Flash (Medium · 哈吉米中思考)</option>
                                    <option value="gemini-3.8-flash-low">Gemini 3.8 Flash (Low · 哈吉米轻量)</option>
                                    <option value="gemini-3.8-flash">Gemini 3.8 Flash (Standard · 哈吉米标准)</option>
                                    <option value="argon">Gemini 4 Argon Pro (哈吉米高推理旗舰)</option>
                                    <option value="hydrogen">Gemini Hydrogen (哈吉米独立黑盒审查)</option>
                                  </optgroup>
                                  <optgroup label="🚀 Claude 5.5 系列（1M 上下文，128K 输出）">
                                    <option value="claude-sonnet-5-5-high">Claude Sonnet 5.5 (High Reasoning)</option>
                                    <option value="claude-sonnet-5-5-medium">Claude Sonnet 5.5 (Medium Reasoning)</option>
                                    <option value="claude-sonnet-5-5-low">Claude Sonnet 5.5 (Low Reasoning)</option>
                                    <option value="claude-opus-5-5-high">Claude Opus 5.5 (High Reasoning)</option>
                                    <option value="claude-opus-5-5-medium">Claude Opus 5.5 (Medium Reasoning)</option>
                                    <option value="claude-opus-5-5-low">Claude Opus 5.5 (Low Reasoning)</option>
                                  </optgroup>
                                  <optgroup label="🛡️ Claude 4.6 系列">
                                    <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                                    <option value="claude-opus-4-6">Claude Opus 4.6</option>
                                  </optgroup>
                                  <optgroup label="⚡ Gemini 3.7 / 3.6 / 3.5 / 3.1 / 2.5 系列">
                                    <option value="gemini-3.7-flash-tiered">Gemini 3.7 Flash (Tiered)</option>
                                    <option value="gemini-3.7-flash">Gemini 3.7 Flash</option>
                                    <option value="gemini-3.6-flash-high">Gemini 3.6 Flash (High)</option>
                                    <option value="gemini-3.6-flash-medium">Gemini 3.6 Flash (Medium)</option>
                                    <option value="gemini-3.6-flash-low">Gemini 3.6 Flash (Low)</option>
                                    <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite</option>
                                    <option value="gemini-3.1-pro-high">Gemini 3.1 Pro (High)</option>
                                    <option value="gemini-3.1-pro-low">Gemini 3.1 Pro (Low)</option>
                                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                                  </optgroup>
                                  <optgroup label="🌐 开源与其他">
                                    <option value="gpt-oss-120b-medium">GPT-OSS 120B (Medium Reasoning)</option>
                                  </optgroup>
                                </>
                              ) : (
                                (() => {
                                  const staticModels = ALL_CANDIDATE_MODELS.filter(
                                    (m) => m.provider.toLowerCase() === mem.provider.toLowerCase(),
                                  )
                                  const seen = new Set(staticModels.map((m) => m.id))
                                  const dynamicModels = (catalogs[mem.provider] ?? []).filter((m) => !seen.has(m.id))
                                  return [
                                    ...staticModels.map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.name} {m.tag ? `[${m.tag}]` : ''}
                                      </option>
                                    )),
                                    ...dynamicModels.map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.id} [CPA/动态发现]
                                      </option>
                                    )),
                                  ]
                                })()
                              )}
                            </select>
                          </div>
                        </div>

                        <div className={css.memberRow}>
                          <div className={css.formGroup}>
                            <label className={css.formLabel}>思考深度 (Reasoning Effort)</label>
                            <select
                              className={css.formSelect}
                              value={mem.reasoningEffort}
                              onChange={(e) => updateMember(mem.id, { reasoningEffort: e.target.value })}
                            >
                              <option value="low">Low (轻量思考)</option>
                              <option value="medium">Medium (标准思考)</option>
                              <option value="high">High (深度思考)</option>
                              <option value="xhigh">XHigh / Max (极限思考)</option>
                            </select>
                          </div>

                          <div className={css.formGroup}>
                            <label className={css.formLabel}>模型静态健康检查 (GR-04)</label>
                            <div className={css.healthNotice} data-status={health.status}>
                              {health.message}
                            </div>
                          </div>
                        </div>

                        {/* Capabilities Tags */}
                        <div className={css.formGroup}>
                          <label className={css.formLabel}>专业能力标签 (Capabilities)</label>
                          <div className={css.tagList}>
                            {mem.capabilities.map((cap) => (
                              <span key={cap} className={`${css.tagPill} ${css.capPill}`}>
                                #{cap}
                                <button
                                  type="button"
                                  className={css.tagRemoveBtn}
                                  onClick={() => removeCapability(mem.id, cap)}
                                >
                                  ✕
                                </button>
                              </span>
                            ))}
                          </div>
                          <div className={css.addTagRow}>
                            <input
                              type="text"
                              className={css.addTagInput}
                              placeholder="添加专长标签，例如: typescript, red-team"
                              value={newCapDraft[mem.id] ?? ''}
                              onChange={(e) =>
                                setNewCapDraft({ ...newCapDraft, [mem.id]: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  addCapability(mem.id)
                                }
                              }}
                            />
                            <button
                              type="button"
                              className={css.addTagBtn}
                              onClick={() => addCapability(mem.id)}
                            >
                              添加
                            </button>
                          </div>
                        </div>

                        {/* No-Assign Tags */}
                        <div className={css.formGroup}>
                          <label className={css.formLabel}>禁派红线标签 (No-Assign 场景限制)</label>
                          <div className={css.tagList}>
                            {mem.noAssign.map((na) => (
                              <span key={na} className={`${css.tagPill} ${css.noAssignPill}`}>
                                🚫 {na}
                                <button
                                  type="button"
                                  className={css.tagRemoveBtn}
                                  onClick={() => removeNoAssign(mem.id, na)}
                                >
                                  ✕
                                </button>
                              </span>
                            ))}
                          </div>
                          <div className={css.addTagRow}>
                            <input
                              type="text"
                              className={css.addTagInput}
                              placeholder="添加禁派场景，例如: production-write, git-push-force"
                              value={newNoAssignDraft[mem.id] ?? ''}
                              onChange={(e) =>
                                setNewNoAssignDraft({ ...newNoAssignDraft, [mem.id]: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  addNoAssign(mem.id)
                                }
                              }}
                            />
                            <button
                              type="button"
                              className={css.addTagBtn}
                              onClick={() => addNoAssign(mem.id)}
                            >
                              添加
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <div className={css.costGuardCard}>
                  <div className={css.costTitle}>⚡ 成本护栏与并发资源预警</div>
                  <div className={css.costItem}>
                    ● 团队规模: <strong>{members.length} 位协作成员</strong>
                  </div>
                  <div className={css.costItem}>
                    ● 并发开销: 启动时将建立 <strong>{members.length} 个独立的 Worker 子会话</strong>
                  </div>
                  <div className={css.costItem}>
                    ● 上下文通道: 采用独立持久化信箱投射，不污染当前宿主主会话上下文
                  </div>
                </div>

                <div className={css.stagedNotice}>
                  <strong>两阶段提审规范（Staged Plan）：</strong>
                  <br />
                  点击下方按钮后，团队将以 <code>phase='staged'</code> 模式落盘保存，不会立即并发拉起模型。
                  随后您将在当前会话中审阅完整编排并手动批准，彻底杜绝未经审阅并发消耗 Token 的风险。
                </div>

                {submitError && (
                  <div className={css.healthNotice} data-status="error">
                    {submitError}
                  </div>
                )}

                {submitSuccess && (
                  <div className={css.healthNotice} data-status="ok">
                    {submitSuccess}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer Actions */}
          <div className={css.wizardActions}>
            <div>
              {step > 1 && (
                <button
                  type="button"
                  className={css.btnSecondary}
                  onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)}
                >
                  上一步
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className={css.btnSecondary} onClick={onClose}>
                取消
              </button>
              {step < 4 ? (
                <button
                  type="button"
                  className={css.btnPrimary}
                  onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3 | 4)}
                >
                  下一步
                </button>
              ) : (
                <button
                  type="submit"
                  className={css.btnPrimary}
                  disabled={submitting || operation === 'outcome_unknown' || operation === 'succeeded'}
                >
                  {submitting ? '正在提交待审阅方案...' : '生成待审阅方案 (Staged Plan)'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
