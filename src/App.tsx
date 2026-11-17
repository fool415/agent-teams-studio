import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Badge } from '@astryxdesign/core/Badge'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import { LEAD_ART } from './client/artwork.ts'
import {
  ACTIVITY_STATE_URL,
  getActivitySnapshotsSnapshot,
  startActivityPolling,
  subscribeActivitySnapshots,
  updateActivitySnapshots,
  type ActivityTeam,
} from './client/activity-monitor.ts'
import {
  ALL_CANDIDATE_MODELS,
  CLIPROXYAPI_CANDIDATE_MODELS,
  enrichCandidateModelsWithCatalog,
  type CandidateModel,
} from './client/candidate-models.ts'
import { AgentSpeedBar } from './client/AgentSpeedBar.tsx'
import { AiNewsRadarView } from './client/AiNewsRadarView.tsx'
import { CpaUsageView } from './client/CpaUsageView.tsx'
import { CreateTeamWizard } from './client/CreateTeamWizard.tsx'
import { QqBotModalTab, type QqBotStatusResponse } from './client/QqBotModalTab.tsx'
import type {
  ModelDirectory,
  ModelDirectoryResolver,
  ModelDirectorySnapshot,
  SessionId,
} from './client/dsh-shims.ts'
import { zh, type AgentTeamsTranslate } from './client/locales.ts'
import { MobileApprovalView } from './client/MobileApprovalView.tsx'
import { OpsManualView } from './client/OpsManualView.tsx'
import type {
  AgentTeamsLayoutNavigator,
  AgentTeamsSessionNavigator,
} from './client/session-navigation.ts'
import { TeamsOverview } from './client/TeamsOverview.tsx'
import {
  applyThemeToDocument,
  readLocalThemeSelection,
  resolveThemePreset,
  selectThemeById,
  STUDIO_FONT_PRESETS,
  STUDIO_THEME_PRESETS,
  STUDIO_UI_SCALE_PRESETS,
  toggleThemeAppearance,
  writeLocalThemeSelection,
  type ThemeSelectionState,
} from './client/theme-registry.ts'
import { VideoStudioView } from './client/VideoStudioView.tsx'
import { createWorkspaceBridge, WorkspaceActivity } from './client/WorkspaceActivity.tsx'
import { createWorkspaceState } from './client/workspace-state.ts'

interface RuntimeModelsResponse {
  readonly cpaOnline: boolean
  readonly cpaBaseUrl: string
  readonly defaultGptModel: string
  readonly providers: readonly {
    readonly id: string
    readonly name: string
    readonly models: readonly {
      readonly id: string
      readonly name?: string
      readonly description?: string
      readonly reasoningEfforts?: readonly string[]
      readonly defaultEffort?: string
    }[]
  }[]
  readonly error?: string
}

interface TeamExecutionLogEntry {
  readonly id: string
  readonly timestamp: string
  readonly teamId: string
  readonly member?: string
  readonly taskId?: string
  readonly level: 'info' | 'success' | 'error'
  readonly message: string
}

interface QuickMentionOption {
  readonly token: string
  readonly kind: 'preset' | 'model' | 'member'
  readonly label: string
  readonly hint: string
}

const STATIC_QUICK_MENTION_OPTIONS: readonly QuickMentionOption[] = [
  { token: '@studio-default', kind: 'preset', label: '@studio-default', hint: '标准 3 人异构组 (GPT-6.1-Sol + Gemini)' },
  { token: '@video-studio', kind: 'preset', label: '@video-studio', hint: '🎬 AI 视频制作工坊 (Gemini 导演合成 + GPT 生图)' },
  { token: '@graphic-studio', kind: 'preset', label: '@graphic-studio', hint: '🎨 AI 图形制作工坊 (GPT Image 2.6 角色三视图与海报)' },
  { token: '@chatgpt-crew', kind: 'preset', label: '@chatgpt-crew', hint: '敏捷双人组 (Researcher + Engineer)' },
  { token: '@heterogeneous-cross-review', kind: 'preset', label: '@heterogeneous-cross-review', hint: 'L1~L3 五角异构交叉审查团队' },
  { token: '@ai-radar-squad', kind: 'preset', label: '@ai-radar-squad', hint: '六角技术调研与 Grok Bot 评估编队' },
  { token: '@novixlink-ops', kind: 'preset', label: '@novixlink-ops', hint: 'NovixLink VPS 运维排障组 (挂载 zkl v4.3 手册)' },
  { token: '@gpt-6.1-sol', kind: 'model', label: '@gpt-6.1-sol', hint: 'CPA 默认 GPT-6.1 Sol 模型路由' },
  { token: '@deepseek-chat', kind: 'model', label: '@deepseek-chat', hint: 'DeepSeek-V3 / DeepSeek Harness 路由' },
  { token: '@grok-3', kind: 'model', label: '@grok-3', hint: 'xAI Grok-3 实时核查与极客编码路由' },
  { token: '@qwen3-max', kind: 'model', label: '@qwen3-max', hint: '阿里通义千问 Qwen3-Max 路由' },
]

interface QuickCommandResponse {
  readonly ok?: boolean
  readonly mode?: string
  readonly teamId?: string
  readonly sessionId?: string
  readonly message?: string
  readonly error?: string
}

interface WatchdogStatusResponse {
  readonly ok: boolean
  readonly enabled?: boolean
  readonly intervalMs?: number
  readonly activeAutoRuns?: readonly string[]
  readonly scannedTeams?: number
  readonly healedCount?: number
  readonly activeRunsCount?: number
  readonly details?: readonly { teamId: string; actions: readonly string[] }[]
  readonly passed?: boolean
}

interface DesktopStatusResponse {
  readonly ok: boolean
  readonly portableApp?: {
    readonly application: string
    readonly version: string
    readonly platform: string
    readonly arch: string
  }
  readonly coreVersion?: string
  readonly config?: Record<string, string | number | boolean>
  readonly configPath?: string
  readonly cpaOnline?: boolean
  readonly cpaBaseUrl?: string
  readonly watchdog?: {
    readonly enabled?: boolean
    readonly intervalMs?: number
    readonly activeAutoRuns?: readonly string[]
    readonly scannedTeams?: number
    readonly healedCount?: number
  }
  readonly studioCore?: {
    readonly pid: number
    readonly uptimeSeconds: number
    readonly nodeVersion: string
  }
}

interface DesktopUsageResponse {
  readonly ok: boolean
  readonly summary?: {
    readonly totalTeams?: number
    readonly activeTeams?: number
    readonly archivedTeams?: number
    readonly totalTasks?: number
    readonly completedTasks?: number
  }
  readonly modelDistribution?: Record<string, number>
  readonly totalTeams?: number
  readonly activeTeams?: number
  readonly totalTasks?: number
  readonly completedTasks?: number
  readonly totalMessages?: number
  readonly totalCpaCalls?: number
  readonly modelsUsed?: readonly { readonly model: string; readonly count: number }[]
  readonly usageRecordsCount?: number
}

interface EcosystemStatusResponse {
  readonly ok: boolean
  readonly status?: {
    readonly antigravity?: {
      readonly geminiDir: string
      readonly studioPluginInstalled: boolean
      readonly dshPluginInstalled: boolean
      readonly mcpConfigPath: string
    }
    readonly codex?: {
      readonly codexDir: string
      readonly configTomlPath: string
      readonly mcpConfigured: boolean
      readonly skillInstalled: boolean
      readonly codexCliInstalled: boolean
    }
    readonly dsh?: {
      readonly teamsDir: string
      readonly installed: boolean
      readonly bridgeInstalled?: boolean
      readonly activeTeamCount: number
    }
    readonly cpa?: {
      readonly installed: boolean
      readonly binaryPath: string | null
      readonly source: string
      readonly online?: boolean
      readonly baseUrl?: string
      readonly managementUrl?: string
      readonly modelCount?: number
      readonly oauthCounts?: {
        readonly antigravity: number
        readonly codex: number
      }
    }
  }
}

function createTranslator(): AgentTeamsTranslate {
  return (key, params) => {
    const raw = zh[key] ?? String(key)
    if (!params) return raw
    return raw.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const val = params[name]
      return val === undefined ? `{${name}}` : String(val)
    })
  }
}

function buildDirectorySnapshot(runtime: RuntimeModelsResponse | null): ModelDirectorySnapshot {
  const discovered: { id: string; name?: string; provider?: string }[] = []
  if (runtime) {
    for (const p of runtime.providers) {
      for (const m of p.models) {
        discovered.push({ id: m.id, name: m.name ?? m.id, provider: p.id })
      }
    }
  }
  const merged: readonly CandidateModel[] = enrichCandidateModelsWithCatalog(
    ALL_CANDIDATE_MODELS,
    discovered,
  )

  const grouped = new Map<string, { id: string; name: string; models: CandidateModel[] }>()
  // Pin EasyCLIProxyAPI first so CPA GPT-6.1 Sol is immediately visible in StagingPlanEditor
  grouped.set('cliproxyapi', {
    id: 'cliproxyapi',
    name: 'EasyCLIProxyAPI (CPA · GPT-Sol)',
    models: [...CLIPROXYAPI_CANDIDATE_MODELS],
  })

  for (const model of merged) {
    let group = grouped.get(model.provider)
    if (!group) {
      group = { id: model.provider, name: model.providerName || model.provider, models: [] }
      grouped.set(model.provider, group)
    }
    if (!group.models.some((existing) => existing.id === model.id)) {
      group.models.push(model)
    }
  }

  return {
    status: 'ready',
    groups: [...grouped.values()].map((group) => ({
      id: group.id,
      name: group.name,
      models: group.models.map((m) => ({
        id: m.id,
        name: m.tag ? `${m.name} (${m.tag})` : m.name,
        description: m.description,
        reasoning: m.reasoningEfforts
          ? {
              defaultEffort: m.defaultEffort ?? 'medium',
              efforts: m.reasoningEfforts.map((effort) => ({
                id: effort,
                name: effort.toUpperCase(),
                description: `Reasoning: ${effort}`,
              })),
            }
          : undefined,
      })),
    })),
    failures: runtime && !runtime.cpaOnline && runtime.error ? [runtime.error] : [],
  }
}

function useStudioModelDirectory(): {
  resolver: ModelDirectoryResolver
  runtime: RuntimeModelsResponse | null
  reload: () => Promise<void>
} {
  const [runtime, setRuntime] = useState<RuntimeModelsResponse | null>(null)
  const snapshotRef = useRef<ModelDirectorySnapshot>(buildDirectorySnapshot(null))
  const listenersRef = useRef(new Set<() => void>())

  const publish = useCallback((nextRuntime: RuntimeModelsResponse | null) => {
    setRuntime(nextRuntime)
    snapshotRef.current = buildDirectorySnapshot(nextRuntime)
    for (const listener of listenersRef.current) listener()
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/models', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as RuntimeModelsResponse
      publish(data)
    } catch {
      // Keep static fallback models cleanly if offline
    }
  }, [publish])

  useEffect(() => {
    void load()
  }, [load])

  const resolver = useMemo<ModelDirectoryResolver>(() => {
    const dir: ModelDirectory = {
      store: {
        getSnapshot: () => snapshotRef.current,
        subscribe: (listener) => {
          listenersRef.current.add(listener)
          return () => { listenersRef.current.delete(listener) }
        },
      },
      load,
    }
    return {
      directoryFor: () => dir,
    }
  }, [load])

  return { resolver, runtime, reload: load }
}

const DEFAULT_SESSION_ID = 'antigravity-captain'

export function App() {
  const t = useMemo(() => createTranslator(), [])
  const [view, setView] = useState<'workspace' | 'video' | 'radar' | 'cpa-usage' | 'overview' | 'mobile' | 'knowledge'>(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      if (sp.get('view') === 'video' || window.location.hash === '#video') return 'video'
      if (sp.get('view') === 'radar' || window.location.hash === '#radar') return 'radar'
      if (sp.get('view') === 'cpa-usage' || window.location.hash === '#cpa-usage') return 'cpa-usage'
      if (sp.get('view') === 'mobile' || window.location.hash === '#mobile') return 'mobile'
      if (sp.get('view') === 'knowledge' || window.location.hash === '#knowledge') return 'knowledge'
    } catch {}
    return 'workspace'
  })
  const [themeSelection, setThemeSelection] = useState<ThemeSelectionState>(() =>
    readLocalThemeSelection(),
  )
  const activeThemePreset = useMemo(
    () => resolveThemePreset(themeSelection.selectedId),
    [themeSelection.selectedId],
  )
  const theme = activeThemePreset.appearance
  const [themeModalOpen, setThemeModalOpen] = useState(false)
  const [ecosystemStatus, setEcosystemStatus] = useState<EcosystemStatusResponse['status'] | null>(null)
  const [installingTarget, setInstallingTarget] = useState<string | null>(null)
  const [ensuringCpa, setEnsuringCpa] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [memberFilter, setMemberFilter] = useState<string | null>(null)
  const [logs, setLogs] = useState<TeamExecutionLogEntry[]>([])
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [quickSuccess, setQuickSuccess] = useState<string | null>(null)
  const [quickInput, setQuickInput] = useState('')
  const [quickMenuOpen, setQuickMenuOpen] = useState(false)
  const [quickMenuIndex, setQuickMenuIndex] = useState(0)
  const quickInputRef = useRef<HTMLInputElement | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<SessionId>(DEFAULT_SESSION_ID)

  const [watchdogStatus, setWatchdogStatus] = useState<WatchdogStatusResponse | null>(null)
  const [watchdogHealing, setWatchdogHealing] = useState(false)
  const [desktopModalOpen, setDesktopModalOpen] = useState(false)
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatusResponse | null>(null)
  const [desktopUsage, setDesktopUsage] = useState<DesktopUsageResponse | null>(null)
  const [desktopConfigDraft, setDesktopConfigDraft] = useState<Record<string, string | number | boolean>>({})
  const [ savingConfig, setSavingConfig ] = useState(false)
  const [configNotice, setConfigNotice] = useState<string | null>(null)
  const [desktopTab, setDesktopTab] = useState<'ecosystem' | 'qqbot' | 'status' | 'config' | 'usage'>('ecosystem')
  const [qqbotStatus, setQqbotStatus] = useState<QqBotStatusResponse | null>(null)

  const refreshQqbotStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/channels/qqbot/status', { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as QqBotStatusResponse
        setQqbotStatus(data)
      }
    } catch {}
  }, [])

  const refreshEcosystemStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/ecosystem/status', { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as EcosystemStatusResponse
        if (data.status) setEcosystemStatus(data.status)
      }
    } catch {}
  }, [])

  const applyAndPersistTheme = useCallback(async (nextSelection: ThemeSelectionState) => {
    setThemeSelection(nextSelection)
    applyThemeToDocument(nextSelection)
    writeLocalThemeSelection(nextSelection)
    try {
      await fetch('/api/desktop/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection: nextSelection }),
      })
    } catch {}
  }, [])

  useEffect(() => {
    applyThemeToDocument(themeSelection)
  }, [themeSelection])

  useEffect(() => {
    void refreshEcosystemStatus()
    void refreshQqbotStatus()
    void fetch('/api/desktop/theme', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { selection?: ThemeSelectionState } | null) => {
        if (data?.selection?.selectedId) {
          setThemeSelection(data.selection)
          applyThemeToDocument(data.selection)
          writeLocalThemeSelection(data.selection)
        }
      })
      .catch(() => {})
  }, [refreshEcosystemStatus, refreshQqbotStatus])

  const handleInstallEcosystem = useCallback(
    async (target: 'all' | 'antigravity' | 'codex' | 'dsh') => {
      setInstallingTarget(target)
      setConfigNotice(null)
      try {
        const res = await fetch('/api/ecosystem/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targets: target }),
        })
        const data = (await res.json()) as {
          ok?: boolean
          actions?: readonly string[]
          status?: EcosystemStatusResponse['status']
          error?: string
        }
        if (res.ok && data.ok) {
          if (data.status) setEcosystemStatus(data.status)
          const count = data.actions?.length ?? 0
          const msg = `✅ 已成功将 Studio + DSH + CPA 渠道一键挂载到 [${target.toUpperCase()}]（执行 ${count} 项同步）！`
          setConfigNotice(msg)
          setQuickSuccess(msg)
        } else {
          setConfigNotice(`❌ 安装失败: ${data.error ?? '未知错误'}`)
        }
      } catch (err) {
        setConfigNotice(`❌ 安装失败: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setInstallingTarget(null)
      }
    },
    [],
  )

  const handleEnsureCpaChannel = useCallback(async () => {
    setEnsuringCpa(true)
    setConfigNotice(null)
    try {
      const res = await fetch('/api/channels/cpa/ensure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSpawn: true }),
      })
      const data = (await res.json()) as {
        online?: boolean
        modelCount?: number
        startedByStudio?: boolean
        error?: string
      }
      await refreshEcosystemStatus()
      if (data.online) {
        const msg = `✅ CPA 渠道网关在线 (${data.modelCount ?? 0} 个模型就绪${data.startedByStudio ? '，已由 Studio 自动拉起' : ''})！`
        setConfigNotice(msg)
        setQuickSuccess(msg)
      } else {
        setConfigNotice(`⚠️ CPA 渠道暂未响应: ${data.error ?? '请确认已启动 EasyCLIProxyAPI 或配置自定义 BaseURL'}`)
      }
    } catch (err) {
      setConfigNotice(`❌ CPA 渠道检测异常: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setEnsuringCpa(false)
    }
  }, [refreshEcosystemStatus])

  const refreshWatchdogStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/watchdog/status', { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as WatchdogStatusResponse
        setWatchdogStatus(data)
      }
    } catch {}
  }, [])

  useEffect(() => {
    void refreshWatchdogStatus()
    const timer = setInterval(() => { void refreshWatchdogStatus() }, 10000)
    return () => clearInterval(timer)
  }, [refreshWatchdogStatus])

  const triggerWatchdogHeal = useCallback(async (teamId?: string) => {
    setWatchdogHealing(true)
    setActionError(null)
    try {
      const res = await fetch('/api/watchdog/heal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: teamId ?? '' }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        const msg = `🐕 看门狗自愈完成：巡检了 ${data.scannedTeams ?? 0} 个团队，触发自愈修复 ${data.healedCount ?? 0} 项动作`
        setQuickSuccess(msg)
        setWatchdogStatus(data)
        setLogs((prev) => [
          {
            id: `wd-${Date.now()}`,
            timestamp: new Date().toISOString(),
            teamId: teamId ?? 'global',
            level: 'success',
            message: msg,
          },
          ...prev,
        ])
      } else {
        setActionError(data.error ?? '看门狗自愈检查未完成')
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setWatchdogHealing(false)
    }
  }, [])

  const openDesktopModal = useCallback(async (initialTab?: 'ecosystem' | 'qqbot' | 'status' | 'config' | 'usage') => {
    if (initialTab) setDesktopTab(initialTab)
    setDesktopModalOpen(true)
    setConfigNotice(null)
    void refreshEcosystemStatus()
    void refreshQqbotStatus()
    try {
      const [statusRes, usageRes] = await Promise.all([
        fetch('/api/desktop/status', { cache: 'no-store' }),
        fetch('/api/desktop/usage', { cache: 'no-store' }),
      ])
      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as DesktopStatusResponse
        setDesktopStatus(statusData)
        if (statusData.config) {
          setDesktopConfigDraft({ ...statusData.config })
        }
      }
      if (usageRes.ok) {
        const usageData = (await usageRes.json()) as DesktopUsageResponse
        setDesktopUsage(usageData)
      }
    } catch (err) {
      setConfigNotice(`获取桌面端状态失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [refreshEcosystemStatus, refreshQqbotStatus])

  const saveDesktopConfig = useCallback(async () => {
    setSavingConfig(true)
    setConfigNotice(null)
    try {
      const res = await fetch('/api/desktop/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: desktopConfigDraft }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setConfigNotice('✅ 配置已实时写回 config.toml！')
        setQuickSuccess('桌面端配置已更新并持久化至 config.toml')
        if (data.config) {
          setDesktopConfigDraft(data.config)
        }
      } else {
        setConfigNotice(`❌ 保存失败: ${data.error ?? '未知错误'}`)
      }
    } catch (err) {
      setConfigNotice(`❌ 保存失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSavingConfig(false)
    }
  }, [desktopConfigDraft])

  const workspaceState = useMemo(() => createWorkspaceState(), [])
  const workspaceSnapshot = useSyncExternalStore(workspaceState.subscribe, workspaceState.getSnapshot)
  const activitySnapshots = useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot)
  const { resolver: modelDirectories, runtime: modelsRuntime } = useStudioModelDirectory()

  const allTeams: readonly ActivityTeam[] = useMemo(() => {
    const seen = new Set<string>()
    const combined: ActivityTeam[] = []
    for (const item of activitySnapshots.teams) {
      if (!seen.has(item.teamId)) {
        seen.add(item.teamId)
        combined.push(item)
      }
    }
    return combined
  }, [activitySnapshots.teams])

  const stagedTeamsCount = useMemo(
    () => allTeams.filter((team) => team.phase === 'staged').length,
    [allTeams],
  )

  const refreshAllSnapshots = useCallback(async () => {
    try {
      const res = await fetch(ACTIVITY_STATE_URL, { cache: 'no-store' })
      if (!res.ok) return
      const body = (await res.json()) as { teams?: readonly ActivityTeam[] }
      if (Array.isArray(body.teams)) {
        updateActivitySnapshots({ teams: body.teams })
      }
    } catch {}
  }, [])

  const allSelectableTeams: readonly ActivityTeam[] = useMemo(() => {
    const seen = new Set(allTeams.map((team) => team.teamId))
    const merged = [...allTeams]
    for (const archived of activitySnapshots.archivedTeams) {
      if (!seen.has(archived.teamId)) {
        seen.add(archived.teamId)
        merged.push(archived)
      }
    }
    return merged
  }, [allTeams, activitySnapshots.archivedTeams])

  const selectedTeam = useMemo(() => {
    const preferredTeamId = workspaceSnapshot.selected.get(activeSessionId)
    const sessionTeams = allSelectableTeams.filter((team) => team.captainSessionId === activeSessionId)
    return (
      sessionTeams.find((team) => team.teamId === preferredTeamId)
      ?? sessionTeams[0]
      ?? allSelectableTeams.find((team) => team.teamId === preferredTeamId)
      ?? allSelectableTeams[0]
    )
  }, [activeSessionId, allSelectableTeams, workspaceSnapshot.selected])

  // Keep activeSessionId aligned if initial snapshot arrives under a different sessionId
  useEffect(() => {
    if (allTeams.length === 0) return
    const hasMatch = allTeams.some((team) => team.captainSessionId === activeSessionId)
    if (!hasMatch) {
      const first = allTeams[0]
      setActiveSessionId(first.captainSessionId)
      workspaceState.select(first.captainSessionId, first.teamId)
    }
  }, [activeSessionId, allTeams, workspaceState])

  // Global activity poller + SSE real-time push
  useEffect(() => {
    const controller = startActivityPolling([], {
      discoverySessionId: activeSessionId,
      onStatus(status) {
        workspaceState.status(activeSessionId, status)
      },
      publishSnapshots(update) {
        updateActivitySnapshots(update)
      },
    })

    let es: EventSource | null = null
    try {
      es = new EventSource('/api/events')
      es.addEventListener('snapshot', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as {
            teams?: readonly ActivityTeam[]
            archivedTeams?: readonly ActivityTeam[]
          }
          if (payload.teams || payload.archivedTeams) {
            updateActivitySnapshots({
              ...(payload.teams ? { teams: payload.teams } : {}),
              ...(payload.archivedTeams ? { archivedTeams: payload.archivedTeams } : {}),
            })
            workspaceState.status(activeSessionId, 'ready')
          }
        } catch {}
      })
      es.addEventListener('log', (event) => {
        try {
          const entry = JSON.parse((event as MessageEvent<string>).data) as TeamExecutionLogEntry
          setLogs((prev) => [...prev.slice(-199), entry])
        } catch {}
      })
      es.addEventListener('qqbot', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as QqBotStatusResponse
          setQqbotStatus(data)
        } catch {}
      })
    } catch {}

    return () => {
      controller.stop()
      es?.close()
    }
  }, [activeSessionId, workspaceState])

  // Fetch team logs when selectedTeam changes
  useEffect(() => {
    if (!selectedTeam) {
      setLogs([])
      return
    }
    let active = true
    void fetch(`/api/teams/${encodeURIComponent(selectedTeam.teamId)}/logs`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { logs: [] }))
      .then((data: { logs?: TeamExecutionLogEntry[] }) => {
        if (active && Array.isArray(data.logs)) setLogs(data.logs)
      })
      .catch(() => {})
    return () => { active = false }
  }, [selectedTeam?.teamId])

  const useTabInfo = useCallback(
    () => ({
      tab: {
        visible: view === 'workspace',
        actions: {
          close: () => { setView('overview') },
        },
      },
    }),
    [view],
  )

  const openMember = useCallback(
    (_parentId: SessionId, childId: SessionId) => {
      setMemberFilter((prev) => (prev === childId ? null : childId))
      setLogsOpen(true)
    },
    [],
  )

  const sessionsNav = useMemo<AgentTeamsSessionNavigator>(
    () => ({
      open(sessionId: SessionId) {
        const targetTeam = allSelectableTeams.find(
          (team) => team.captainSessionId === sessionId || team.teamId === sessionId,
        )
        if (targetTeam) {
          setActiveSessionId(targetTeam.captainSessionId)
          workspaceState.select(targetTeam.captainSessionId, targetTeam.teamId)
        } else {
          setActiveSessionId(sessionId)
        }
        setView('workspace')
      },
    }),
    [allSelectableTeams, workspaceState],
  )

  const layoutNav = useMemo<AgentTeamsLayoutNavigator>(
    () => ({
      selectPanel: () => { setView('workspace') },
    }),
    [],
  )

  const bridge = useMemo(
    () => createWorkspaceBridge(),
    [],
  )

  const runTeamAction = async (mode: 'run-next' | 'auto-run') => {
    if (!selectedTeam) return
    setActionError(null)
    setBusyAction(mode)
    setLogsOpen(true)
    try {
      const res = await fetch(
        `/api/teams/${encodeURIComponent(selectedTeam.teamId)}/${mode}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      const body = (await res.json()) as { error?: string }
      if (!res.ok) {
        setActionError(body.error ?? `执行失败 (${res.status})`)
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  const visibleLogs = useMemo(() => {
    const filtered = selectedTeam
      ? logs.filter((item) => item.teamId === selectedTeam.teamId)
      : logs
    if (!memberFilter) return filtered
    return filtered.filter((item) => !item.member || item.member === memberFilter)
  }, [logs, memberFilter, selectedTeam])

  const canDispatchCpa =
    selectedTeam !== undefined && selectedTeam.phase === 'running' && !selectedTeam.halted

  const quickMentionOptions: readonly QuickMentionOption[] = useMemo(() => {
    const memberOptions: QuickMentionOption[] = (selectedTeam?.members ?? []).map((member) => ({
      token: `@${member.name}`,
      kind: 'member',
      label: `@${member.name}`,
      hint: `${member.role || '团队成员'} (${member.provider ? `${member.provider}/` : ''}${member.model || 'gpt-6.1-sol'})`,
    }))
    return [...STATIC_QUICK_MENTION_OPTIONS, ...memberOptions]
  }, [selectedTeam?.members])

  const activeMentionMatch = useMemo(() => {
    const match = quickInput.match(/(?:^|\s)(@[a-zA-Z0-9._-]*)$/u)
    return match ? match[1].toLowerCase() : null
  }, [quickInput])

  const filteredQuickMentions = useMemo(() => {
    const q = activeMentionMatch ?? ''
    if (!q || q === '@') return quickMentionOptions
    return quickMentionOptions.filter(
      (item) =>
        item.token.toLowerCase().includes(q)
        || item.hint.toLowerCase().includes(q.slice(1)),
    )
  }, [activeMentionMatch, quickMentionOptions])

  const insertQuickToken = useCallback((token: string) => {
    setQuickInput((prev) => {
      const next = /(?:^|\s)@[a-zA-Z0-9._-]*$/u.test(prev)
        ? prev.replace(/@[a-zA-Z0-9._-]*$/u, `${token} `)
        : `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${token} `
      return next
    })
    setQuickMenuOpen(false)
    setQuickMenuIndex(0)
    queueMicrotask(() => {
      quickInputRef.current?.focus()
    })
  }, [])

  const submitQuickCommand = async (overrideInput?: string) => {
    const trimmed = (overrideInput ?? quickInput).trim()
    if (!trimmed || busyAction !== null) return
    setActionError(null)
    setQuickSuccess(null)
    setBusyAction('quick-command')
    try {
      const res = await fetch('/api/quick-command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: trimmed,
          teamId: selectedTeam?.teamId,
          sessionId: activeSessionId,
        }),
      })
      const body = (await res.json()) as QuickCommandResponse
      if (!res.ok) {
        setActionError(body.error ?? `快捷指令执行失败 (${res.status})`)
        return
      }
      if (!overrideInput) setQuickInput('')
      setQuickMenuOpen(false)
      const targetSession = body.sessionId || activeSessionId
      if (body.teamId) {
        setActiveSessionId(targetSession)
        workspaceState.select(targetSession, body.teamId)
      }
      setView('workspace')
      setQuickSuccess(body.message ?? '已通过 @快捷模式 生成待审批计划')
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <Theme theme={neutralTheme} mode={theme}>
    <div className="studio-shell">
      <header className="studio-topbar">
        <div className="studio-topbar-left">
          <div className="studio-brand">
            <img src={LEAD_ART} alt="" aria-hidden />
            <span>AgentTeams Studio</span>
          </div>
          <nav className="studio-tabs" aria-label="视图切换">
            <button
              type="button"
              className="studio-tab"
              data-active={view === 'workspace'}
              onClick={() => setView('workspace')}
            >
              团队监控与审批
            </button>
            <button
              type="button"
              className="studio-tab"
              data-active={view === 'video'}
              onClick={() => setView('video')}
            >
              🎬 视频与图形工坊
            </button>
            <button
              type="button"
              className="studio-tab"
              data-active={view === 'radar'}
              onClick={() => setView('radar')}
            >
              📡 AI 情报抓手 &amp; Grok
            </button>
            <button
              type="button"
              className="studio-tab"
              data-active={view === 'cpa-usage'}
              onClick={() => setView('cpa-usage')}
            >
              📊 CPA 模型消耗
            </button>
            <button
              type="button"
              className="studio-tab"
              data-active={view === 'mobile'}
              onClick={() => setView('mobile')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <span>📱 跨端审批 &amp; Worktree</span>
              {stagedTeamsCount > 0 && <Badge variant="warning" label={stagedTeamsCount} />}
            </button>
            <button
              type="button"
              className="studio-tab"
              data-active={view === 'knowledge'}
              onClick={() => setView('knowledge')}
            >
              🧩 知识库与扩展
            </button>
            <button
              type="button"
              className="studio-tab"
              data-active={view === 'overview'}
              onClick={() => setView('overview')}
            >
              全部团队
            </button>
          </nav>

          {allSelectableTeams.length > 0 && (
            <select
              className="studio-team-select"
              aria-label="切换团队"
              value={selectedTeam?.teamId ?? ''}
              onChange={(e) => {
                const picked = allSelectableTeams.find((item) => item.teamId === e.target.value)
                if (!picked) return
                setActiveSessionId(picked.captainSessionId)
                workspaceState.select(picked.captainSessionId, picked.teamId)
                setView('workspace')
              }}
            >
              {allSelectableTeams.map((team) => (
                <option key={team.teamId} value={team.teamId}>
                  {team.name} · {team.phase === 'staged' ? '待审批' : team.halted ? '已暂停' : '运行中'}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="studio-topbar-right">
          {/* Figure 1 Top-Right Inspired Apple 18 Water-Drop Liquid Lens Control Capsule */}
          <div className="at-liquid-lens-dock" aria-label="液态玻璃内核与看门狗控制舱">
            <span
              className="at-liquid-lens-item"
              title={modelsRuntime?.cpaBaseUrl ?? 'http://127.0.0.1:8317/v1'}
              style={{ cursor: 'default' }}
            >
              <span className="studio-dot" data-online={modelsRuntime?.cpaOnline ? 'true' : 'false'} />
              <span>
                :4317 · CPA {modelsRuntime?.cpaOnline ? '在线' : '降级'}
              </span>
            </span>

            <button
              type="button"
              className="at-liquid-lens-item"
              data-active={watchdogHealing ? 'true' : 'false'}
              disabled={watchdogHealing}
              title={`看门狗 10s 自动守护 · 巡检 ${watchdogStatus?.scannedTeams ?? 0} 个团队 · 点击立即触发看门狗自愈`}
              onClick={() => { void triggerWatchdogHeal(selectedTeam?.teamId) }}
            >
              <span>🐕 {watchdogHealing ? '自愈中…' : '看门狗自愈'}</span>
            </button>

            <button
              type="button"
              className="at-liquid-lens-item"
              title="刷新工作台与实时快照"
              onClick={() => {
                void refreshAllSnapshots()
                void refreshWatchdogStatus()
              }}
            >
              🔄 刷新
            </button>

            <button
              type="button"
              className="at-liquid-lens-item"
              data-active="true"
              title="切换 Apple 18 液态玻璃 18 款主题风格、全局字体大小与预设字体样式"
              onClick={() => setThemeModalOpen(true)}
            >
              🎨 {activeThemePreset.name} · 字体 ({themeSelection.uiScale ?? 108}%)
            </button>

            <button
              type="button"
              className="at-liquid-lens-item"
              title="一键放大全局按钮与字体比例 (适合全屏高分屏)"
              onClick={() => {
                const cur = Number(themeSelection.uiScale ?? 108)
                const nextScale = cur >= 124 ? 100 : Math.min(128, cur + 6)
                void applyAndPersistTheme({ ...themeSelection, uiScale: nextScale })
              }}
            >
              🔍 字号 {themeSelection.uiScale ?? 108}%
            </button>

            <button
              type="button"
              className="at-liquid-lens-item"
              title="打开 Antigravity / Codex / CPA 渠道 / DSH / DeepSeek 多生态中心与桌面端设置"
              onClick={() => { void openDesktopModal('ecosystem') }}
            >
              🌐 生态与渠道
            </button>

            <button
              type="button"
              className="at-liquid-lens-item"
              data-active={qqbotStatus?.gateway?.state === 'online' ? 'true' : undefined}
              title="配置并连接官方 QQ 机器人，实现手机 QQ 远程布置任务与选模型/思考度"
              onClick={() => { void openDesktopModal('qqbot') }}
            >
              {qqbotStatus?.gateway?.state === 'online' ? '🟢 QQ 在线' : '🤖 QQ 远程'}
            </button>
          </div>

          <button
            type="button"
            className="studio-btn studio-btn-primary"
            onClick={() => setWizardOpen(true)}
          >
            + 新建团队
          </button>

          <button
            type="button"
            className="studio-btn"
            disabled={!canDispatchCpa || busyAction !== null}
            title={
              selectedTeam?.phase === 'staged'
                ? '需先在下方「执行前计划审查」点击「确认并启动团队」'
                : '使用 EasyCLIProxyAPI / 模型执行下一个就绪任务'
            }
            onClick={() => { void runTeamAction('run-next') }}
          >
            {busyAction === 'run-next' ? '调度中…' : '执行下一步'}
          </button>

          <button
            type="button"
            className="studio-btn"
            disabled={!canDispatchCpa || busyAction !== null}
            title={
              selectedTeam?.phase === 'staged'
                ? '需先在下方「执行前计划审查」点击「确认并启动团队」'
                : '自动按 DAG 顺序推进所有就绪任务'
            }
            onClick={() => { void runTeamAction('auto-run') }}
          >
            {busyAction === 'auto-run' ? '推进中…' : '自动推进'}
          </button>

          <button
            type="button"
            className="studio-btn"
            onClick={() => setLogsOpen((prev) => !prev)}
          >
            {logsOpen ? '收起日志' : `日志 (${visibleLogs.length})`}
          </button>

          <button
            type="button"
            className="studio-btn"
            title="在最近使用的深色与浅色玻璃风格之间一键快切"
            onClick={() => { void applyAndPersistTheme(toggleThemeAppearance(themeSelection)) }}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>
      </header>

      <section className="studio-quickbar" aria-label="@快捷模式">
        <div className="studio-quick-left">
          <span className="studio-quick-badge">⚡ @快捷模式</span>
          <div className="studio-quick-chips">
            {(['@studio-default', '@video-studio', '@graphic-studio', '@chatgpt-crew', '@heterogeneous-cross-review', '@novixlink-ops', '@gpt-6.1-sol', '@deepseek-chat', '@grok-3', '@hydrogen'] as const).map((tag) => (
              <button
                key={tag}
                type="button"
                className="studio-quick-chip"
                onClick={() => insertQuickToken(tag)}
              >
                {tag}
              </button>
            ))}
            {selectedTeam?.phase === 'staged'
              && selectedTeam.members.slice(0, 3).map((m) => (
                <button
                  key={m.name}
                  type="button"
                  className="studio-quick-chip studio-quick-chip-member"
                  title={`向待审团队「${selectedTeam.name}」的成员 ${m.name} 追加任务或改模型`}
                  onClick={() => insertQuickToken(`@${m.name}`)}
                >
                  @{m.name}
                </button>
              ))}
          </div>
        </div>

        <div className="studio-quick-input-wrap">
          <button
            type="button"
            className="studio-btn studio-quick-at-btn"
            title="展开 @ 预设与模型菜单"
            onClick={() => {
              setQuickMenuOpen((prev) => !prev)
              setQuickMenuIndex(0)
              quickInputRef.current?.focus()
            }}
          >
            @
          </button>
          <input
            ref={quickInputRef}
            type="text"
            className="studio-quick-input"
            value={quickInput}
            placeholder="输入 @预设 / @gpt-6.1-sol / @成员 + 任务目标，回车一键生成待审批计划…"
            aria-label="@快捷指令输入框"
            onChange={(e) => {
              const val = e.target.value
              setQuickInput(val)
              const hasActiveAt = /(?:^|\s)@[a-zA-Z0-9._-]*$/u.test(val)
              setQuickMenuOpen(hasActiveAt)
              setQuickMenuIndex(0)
            }}
            onKeyDown={(e) => {
              if (quickMenuOpen && filteredQuickMentions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setQuickMenuIndex((prev) => (prev + 1) % filteredQuickMentions.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setQuickMenuIndex(
                    (prev) => (prev - 1 + filteredQuickMentions.length) % filteredQuickMentions.length,
                  )
                  return
                }
                if (e.key === 'Tab' || e.key === 'Enter') {
                  e.preventDefault()
                  const picked = filteredQuickMentions[quickMenuIndex] ?? filteredQuickMentions[0]
                  if (picked) insertQuickToken(picked.token)
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setQuickMenuOpen(false)
                  return
                }
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                void submitQuickCommand()
              }
            }}
          />
          <button
            type="button"
            className="studio-btn studio-btn-primary"
            disabled={!quickInput.trim() || busyAction !== null}
            onClick={() => { void submitQuickCommand() }}
          >
            {busyAction === 'quick-command' ? '生成中…' : '⚡ 直接生成待审计划'}
          </button>

          {quickMenuOpen && filteredQuickMentions.length > 0 && (
            <div className="studio-quick-menu" role="listbox" aria-label="@快捷补全候选">
              {filteredQuickMentions.map((item, idx) => (
                <button
                  key={`${item.kind}-${item.token}`}
                  type="button"
                  role="option"
                  aria-selected={idx === quickMenuIndex}
                  className="studio-quick-item"
                  data-active={idx === quickMenuIndex}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    insertQuickToken(item.token)
                  }}
                >
                  <span className="studio-quick-item-token">{item.token}</span>
                  <span className="studio-quick-item-kind">{item.kind}</span>
                  <span className="studio-quick-item-hint">{item.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {quickSuccess && (
        <div className="studio-banner-success" role="status">
          <span>✅ {quickSuccess}</span>
          <button type="button" className="studio-btn" onClick={() => setQuickSuccess(null)}>
            关闭
          </button>
        </div>
      )}

      {selectedTeam?.phase === 'staged' && view === 'workspace' && (
        <div className="studio-banner-notice" role="status">
          <span>
            ⏸ 当前团队 <strong>{selectedTeam.name}</strong> 处于「待审批 (staged)」状态：可在下方审核/修改成员模型与任务依赖，点击右侧蓝色「<strong>确认并启动团队</strong>」按钮后才会正式创建成员并开始执行。
          </span>
        </div>
      )}

      {actionError && (
        <div className="studio-banner-error" role="alert">
          <span>{actionError}</span>
          <button type="button" className="studio-btn" onClick={() => setActionError(null)}>
            关闭
          </button>
        </div>
      )}

      <main className="studio-main">
        {view === 'workspace' ? (
          <WorkspaceActivity
            sessionId={activeSessionId}
            useTabInfo={useTabInfo}
            t={t}
            state={workspaceState}
            modelDirectories={modelDirectories}
            openMember={openMember}
          />
        ) : view === 'video' ? (
          <VideoStudioView
            activeSessionId={activeSessionId}
            onTeamLaunched={(teamId, sessionId, message) => {
              setActiveSessionId(sessionId)
              workspaceState.select(sessionId, teamId)
              setQuickSuccess(message)
              setView('workspace')
              void refreshAllSnapshots()
            }}
          />
        ) : view === 'radar' ? (
          <AiNewsRadarView
            onTeamLaunched={(teamId, message) => {
              workspaceState.select(activeSessionId, teamId)
              setQuickSuccess(message)
              setView('workspace')
              void refreshAllSnapshots()
            }}
            onStatusMessage={(msg) => setQuickSuccess(msg)}
          />
        ) : view === 'cpa-usage' ? (
          <CpaUsageView
            teams={allTeams}
            onOpenTeamWorkspace={(teamId) => {
              const target = allTeams.find((item) => item.teamId === teamId)
              if (target) {
                setActiveSessionId(target.captainSessionId)
                workspaceState.select(target.captainSessionId, target.teamId)
              }
              setView('workspace')
            }}
          />
        ) : view === 'mobile' ? (
          <MobileApprovalView
            teams={allTeams}
            onRefreshSnapshots={refreshAllSnapshots}
            onOpenDesktopTeam={(team) => {
              setActiveSessionId(team.captainSessionId)
              workspaceState.select(team.captainSessionId, team.teamId)
              setView('workspace')
            }}
            onQuickCommand={async (cmdText) => {
              await submitQuickCommand(cmdText)
            }}
          />
        ) : view === 'knowledge' ? (
          <OpsManualView
            onQuickDispatchOps={async (goalText) => {
              const trimmed = goalText.trim()
              const cmd = trimmed.startsWith('@') ? trimmed : `@novixlink-ops ${trimmed}`
              await submitQuickCommand(cmd)
            }}
          />
        ) : (
          <TeamsOverview
            t={t}
            sessions={sessionsNav}
            layout={layoutNav}
            bridge={bridge}
          />
        )}
      </main>

      <AgentSpeedBar onStatusMessage={(msg) => setQuickSuccess(msg)} />

      {logsOpen && (
        <section className="studio-log-drawer" aria-label="CPA 实时执行日志">
          <div className="studio-log-header">
            <span>
              CPA 实时执行日志
              {memberFilter ? ` · 筛选成员: ${memberFilter}` : ''}
            </span>
            <div>
              {memberFilter && (
                <button
                  type="button"
                  className="studio-btn"
                  onClick={() => setMemberFilter(null)}
                >
                  显示全部成员
                </button>
              )}
              <button
                type="button"
                className="studio-btn"
                style={{ marginLeft: 6 }}
                onClick={() => setLogsOpen(false)}
              >
                收起
              </button>
            </div>
          </div>
          <div className="studio-log-body">
            {visibleLogs.length === 0 ? (
              <div className="studio-log-row">
                <span>暂无执行日志。审批启动团队后点击「执行下一步 (CPA)」或「自动推进团队」即可看到实时调度记录。</span>
              </div>
            ) : (
              visibleLogs.map((entry) => (
                <div key={entry.id} className="studio-log-row" data-level={entry.level}>
                  <span className="studio-log-time">{entry.timestamp.slice(11, 19)}</span>
                  {entry.member && <span className="studio-log-member">[{entry.member}]</span>}
                  {entry.taskId && <span>({entry.taskId})</span>}
                  <span>{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      <CreateTeamWizard
        open={wizardOpen}
        sessionId={activeSessionId}
        onClose={() => setWizardOpen(false)}
        onTeamCreated={(teamId) => {
          setWizardOpen(false)
          workspaceState.select(activeSessionId, teamId)
          setView('workspace')
        }}
        t={t}
      />

      {themeModalOpen && (
        <div className="at-desktop-modal" onClick={() => setThemeModalOpen(false)}>
          <div
            className="at-desktop-modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 820, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 24px',
                borderBottom: '1px solid var(--at-border-hairline)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, fontSize: 18 }}>
                <span>🎨</span>
                <span>Apple 18 液态 &amp; 固态玻璃 · 18 款主题画廊与全局字体/字号定制中心</span>
              </div>
              <button
                type="button"
                className="studio-btn"
                onClick={() => setThemeModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '22px 26px', overflowY: 'auto', display: 'grid', gap: 26 }}>
              {/* Typography & Font Scale Studio Section */}
              <div
                style={{
                  padding: '18px 20px',
                  borderRadius: 18,
                  background: 'var(--at-glass-surface)',
                  border: '1px solid var(--at-glass-border)',
                  display: 'grid',
                  gap: 16,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800 }}>
                      🔤 全屏字号放大与字体样式工作台 (Typography &amp; UI Scale Studio)
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 }}>
                      针对窗口与 2K/4K 全屏自由调节按钮与文字缩放比例，内置 6 套高定预设字体并支持自定义字体名。
                    </div>
                  </div>
                  <span className="studio-tag" style={{ fontSize: 12.5 }}>
                    当前缩放: {themeSelection.uiScale ?? 108}%
                  </span>
                </div>

                {/* UI Scale Presets + Slider */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                    1. 全局界面与字体大小缩放 (UI &amp; Font Size Scale)
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {STUDIO_UI_SCALE_PRESETS.map((sp) => {
                      const active = (themeSelection.uiScale ?? 108) === sp.scale
                      return (
                        <button
                          key={sp.scale}
                          type="button"
                          className={`studio-btn ${active ? 'primary' : ''}`}
                          onClick={() =>
                            void applyAndPersistTheme({
                              ...themeSelection,
                              uiScale: sp.scale,
                            })
                          }
                        >
                          {sp.label}
                        </button>
                      )
                    })}
                    <input
                      type="range"
                      min={90}
                      max={132}
                      step={2}
                      value={themeSelection.uiScale ?? 108}
                      onChange={(e) =>
                        void applyAndPersistTheme({
                          ...themeSelection,
                          uiScale: Number(e.target.value),
                        })
                      }
                      style={{ width: 150, marginLeft: 8 }}
                    />
                  </div>
                </div>

                {/* 6 Preset Font Styles */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                    2. 预设字体样式切换 (6 款精选字体栈)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
                    {STUDIO_FONT_PRESETS.map((fp) => {
                      const active = (themeSelection.fontFamilyId || 'apple-sf') === fp.id
                      return (
                        <button
                          key={fp.id}
                          type="button"
                          className={`studio-btn ${active ? 'primary' : ''}`}
                          style={{
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            textAlign: 'left',
                            padding: '10px 14px',
                            height: 'auto',
                            fontFamily: fp.fontFamily,
                          }}
                          onClick={() =>
                            void applyAndPersistTheme({
                              ...themeSelection,
                              fontFamilyId: fp.id,
                            })
                          }
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontWeight: 800, fontSize: 14.5 }}>
                            <span>{fp.name}</span>
                            <span style={{ fontSize: 11.5, opacity: 0.85 }}>{fp.badge}</span>
                          </div>
                          <div style={{ fontSize: 12.5, opacity: 0.9, marginTop: 4 }}>{fp.sampleText}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Custom Font Family Input */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>3. 后期追加自定义本机字体：</span>
                  <input
                    type="text"
                    className="studio-quick-input"
                    style={{ flex: 1, minWidth: 240 }}
                    placeholder="输入你电脑安装的任意字体名（如：霞鹜文楷 / LXGW WenKai / Sarasa UI SC），留空使用上方预设..."
                    value={themeSelection.customFontFamily || ''}
                    onChange={(e) =>
                      void applyAndPersistTheme({
                        ...themeSelection,
                        customFontFamily: e.target.value,
                      })
                    }
                  />
                  {themeSelection.customFontFamily && (
                    <button
                      type="button"
                      className="studio-btn"
                      onClick={() =>
                        void applyAndPersistTheme({
                          ...themeSelection,
                          customFontFamily: '',
                        })
                      }
                    >
                      恢复预设字体
                    </button>
                  )}
                </div>
              </div>

              {(['solid-gradient', 'light-scenery'] as const).map((cat) => {
                const items = STUDIO_THEME_PRESETS.filter((p) => p.category === cat)
                return (
                  <div key={cat} style={{ display: 'grid', gap: 14 }}>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        fontFamily: '"STKaiti", "KaiTi", "Songti SC", Georgia, serif',
                        color: 'var(--dsw-alias-label-secondary)',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {cat === 'solid-gradient' ? '纯色与渐变' : '光影与风景'}
                    </div>

                    <div className="at-cpa-theme-gallery">
                      {items.map((preset) => {
                        const selected = preset.id === activeThemePreset.id
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            className="at-cpa-theme-item"
                            data-selected={selected ? 'true' : 'false'}
                            onClick={() => {
                              void applyAndPersistTheme(selectThemeById(themeSelection, preset.id))
                            }}
                          >
                            <div
                              className="at-cpa-theme-canvas"
                              style={{ background: preset.outerBg }}
                            >
                              <div
                                className="at-cpa-theme-inner-card"
                                style={{
                                  background: preset.innerCardBg,
                                  color: preset.innerTextColor,
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 12.5,
                                    fontWeight: 700,
                                    fontFamily: '"STKaiti", "KaiTi", "PingFang SC", serif',
                                  }}
                                >
                                  把喜欢的事，慢慢做好
                                </div>
                                <div style={{ display: 'grid', gap: 5, margin: '4px 0' }}>
                                  <div
                                    style={{
                                      height: 4,
                                      width: '82%',
                                      borderRadius: 99,
                                      background:
                                        preset.appearance === 'dark'
                                          ? 'rgba(255,255,255,0.22)'
                                          : 'rgba(15,23,42,0.16)',
                                    }}
                                  />
                                  <div
                                    style={{
                                      height: 4,
                                      width: '62%',
                                      borderRadius: 99,
                                      background:
                                        preset.appearance === 'dark'
                                          ? 'rgba(255,255,255,0.16)'
                                          : 'rgba(15,23,42,0.12)',
                                    }}
                                  />
                                </div>
                                <div
                                  style={{
                                    width: 44,
                                    height: 14,
                                    borderRadius: 999,
                                    background: preset.pillColor,
                                  }}
                                />
                              </div>
                            </div>

                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '0 4px',
                                fontSize: 15,
                                fontFamily: '"STKaiti", "KaiTi", "PingFang SC", serif',
                                fontWeight: selected ? 700 : 500,
                              }}
                            >
                              <span>{preset.name}</span>
                              {selected && <span style={{ fontWeight: 800 }}>✓</span>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {desktopModalOpen && (
        <div className="at-desktop-modal" onClick={() => setDesktopModalOpen(false)}>
          <div
            className="at-desktop-modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 760, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 22px',
                borderBottom: '1px solid var(--at-border-hairline)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 750, fontSize: 16 }}>
                <span>🌐</span>
                <span>多生态适配与桌面端控制中心</span>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 650,
                    padding: '2px 10px',
                    borderRadius: 999,
                    background: 'var(--at-accent-primary-subtle)',
                    color: 'var(--at-accent-primary)',
                  }}
                >
                  {desktopStatus?.portableApp?.version ? `v${desktopStatus.portableApp.version}` : 'v2.0.0'}
                </span>
              </div>
              <button
                type="button"
                className="studio-btn"
                onClick={() => setDesktopModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                padding: '10px 22px',
                borderBottom: '1px solid var(--at-border-hairline)',
              }}
            >
              <button
                type="button"
                className={`studio-btn ${desktopTab === 'ecosystem' ? 'studio-btn-primary' : ''}`}
                onClick={() => setDesktopTab('ecosystem')}
              >
                🌐 Antigravity / Codex / CPA / DSH 适配
              </button>
              <button
                type="button"
                className={`studio-btn ${desktopTab === 'qqbot' ? 'studio-btn-primary' : ''}`}
                onClick={() => setDesktopTab('qqbot')}
              >
                🤖 QQ 远程控制
              </button>
              <button
                type="button"
                className={`studio-btn ${desktopTab === 'config' ? 'studio-btn-primary' : ''}`}
                onClick={() => setDesktopTab('config')}
              >
                ⚙️ 渠道与配置 (config.toml)
              </button>
              <button
                type="button"
                className={`studio-btn ${desktopTab === 'status' ? 'studio-btn-primary' : ''}`}
                onClick={() => setDesktopTab('status')}
              >
                🖥️ 运行时状态
              </button>
              <button
                type="button"
                className={`studio-btn ${desktopTab === 'usage' ? 'studio-btn-primary' : ''}`}
                onClick={() => setDesktopTab('usage')}
              >
                📊 用量与统计
              </button>
            </div>

            <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1, fontSize: 13.5, lineHeight: 1.65 }}>
              {configNotice && (
                <div
                  style={{
                    marginBottom: 14,
                    padding: '10px 14px',
                    borderRadius: 12,
                    background: configNotice.startsWith('✅')
                      ? 'rgba(52, 211, 153, 0.14)'
                      : 'rgba(251, 113, 133, 0.14)',
                    border: `1px solid ${
                      configNotice.startsWith('✅')
                        ? 'rgba(52, 211, 153, 0.35)'
                        : 'rgba(251, 113, 133, 0.35)'
                    }`,
                  }}
                >
                  {configNotice}
                </div>
              )}

              {desktopTab === 'qqbot' && (
                <QqBotModalTab
                  status={qqbotStatus}
                  availableModelIds={[...new Set((modelsRuntime?.providers || []).flatMap((p) => p.models.map((m) => m.id)))]}
                  onRefresh={refreshQqbotStatus}
                  onNotice={(msg) => setConfigNotice(msg)}
                />
              )}

              {desktopTab === 'ecosystem' && (
                <div style={{ display: 'grid', gap: 16 }}>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '14px 18px',
                      borderRadius: 18,
                      background: 'var(--at-accent-primary-subtle)',
                      border: '1px solid var(--at-border-highlight)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        ⚡ 一键全生态挂载 (Antigravity + OpenAI Codex + DSH + CPA 渠道)
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 }}>
                        自动将内置插件、7 大角色 Agent、Skills 与 MCP 服务注册到本机开发环境。
                      </div>
                    </div>
                    <button
                      type="button"
                      className="studio-btn studio-btn-primary"
                      disabled={installingTarget !== null}
                      onClick={() => { void handleInstallEcosystem('all') }}
                    >
                      {installingTarget === 'all' ? '挂载中…' : '🚀 一键挂载全部生态'}
                    </button>
                  </div>

                  <div className="at-ecosystem-grid">
                    <div className="at-ecosystem-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: 15 }}>🔌 内置 CPA 渠道网关 (:8317)</strong>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 650,
                            color: ecosystemStatus?.cpa?.online ? 'var(--at-accent-success)' : 'var(--at-accent-warning)',
                          }}
                        >
                          {ecosystemStatus?.cpa?.online ? '🟢 在线运行中' : '🟡 待唤醒'}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>
                        聚合反重力与 Codex OAuth 凭证，提供统一 OpenAI 兼容接口与 <code>easycli-gpt</code> MCP。
                      </div>
                      <div style={{ fontSize: 12.5 }}>
                        <div>内核来源：<code>{ecosystemStatus?.cpa?.source ?? 'bundled'}</code> · 在线模型：<strong>{ecosystemStatus?.cpa?.modelCount ?? 0}</strong> 个</div>
                        <div>
                          已绑定 OAuth：Antigravity <strong>{ecosystemStatus?.cpa?.oauthCounts?.antigravity ?? 0}</strong> 个 · Codex <strong>{ecosystemStatus?.cpa?.oauthCounts?.codex ?? 0}</strong> 个
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="studio-btn"
                          disabled={ensuringCpa}
                          onClick={() => { void handleEnsureCpaChannel() }}
                        >
                          {ensuringCpa ? '唤醒中…' : '⚡ 探测/启动 CPA 内核'}
                        </button>
                        <a
                          href={ecosystemStatus?.cpa?.managementUrl || 'http://127.0.0.1:8317/management.html'}
                          target="_blank"
                          rel="noreferrer"
                          className="studio-btn"
                          style={{ textDecoration: 'none' }}
                        >
                          🔑 OAuth 账号管理台
                        </a>
                      </div>
                    </div>

                    <div className="at-ecosystem-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: 15 }}>🪐 Google Antigravity (反重力)</strong>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 650,
                            color: ecosystemStatus?.antigravity?.studioPluginInstalled
                              ? 'var(--at-accent-success)'
                              : 'var(--dsw-alias-label-tertiary)',
                          }}
                        >
                          {ecosystemStatus?.antigravity?.studioPluginInstalled ? '🟢 已安装插件' : '⚪ 未挂载'}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>
                        支持在反重力对话中使用 <code>@studio</code>、<code>/agent-teams</code> 与 <code>@cpa-gpt</code>。
                      </div>
                      <div style={{ fontSize: 12.5 }}>
                        <div>Studio 插件：{ecosystemStatus?.antigravity?.studioPluginInstalled ? '✓ 已就绪' : '未安装'}</div>
                        <div>DSH 7角色插件：{ecosystemStatus?.antigravity?.dshPluginInstalled ? '✓ 已就绪' : '未安装'}</div>
                      </div>
                      <div style={{ marginTop: 'auto' }}>
                        <button
                          type="button"
                          className="studio-btn"
                          disabled={installingTarget !== null}
                          onClick={() => { void handleInstallEcosystem('antigravity') }}
                        >
                          {installingTarget === 'antigravity' ? '同步中…' : '📥 同步到 Antigravity (~/.gemini)'}
                        </button>
                      </div>
                    </div>

                    <div className="at-ecosystem-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: 15 }}>🧠 OpenAI Codex CLI / IDE</strong>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 650,
                            color: ecosystemStatus?.codex?.mcpConfigured
                              ? 'var(--at-accent-success)'
                              : 'var(--dsw-alias-label-tertiary)',
                          }}
                        >
                          {ecosystemStatus?.codex?.mcpConfigured ? '🟢 已注入 MCP' : '⚪ 未配置'}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>
                        自动配置 <code>~/.codex/config.toml</code> MCP 服务与 <code>~/.codex/skills</code> 技能包。
                      </div>
                      <div style={{ fontSize: 12.5 }}>
                        <div>MCP 注册：{ecosystemStatus?.codex?.mcpConfigured ? '✓ 已配置' : '未配置'} · Skill：{ecosystemStatus?.codex?.skillInstalled ? '✓ 已安装' : '未安装'}</div>
                        <div>本机 Codex CLI：{ecosystemStatus?.codex?.codexCliInstalled ? '✓ 已检测到 codex 命令' : '通过 CPA/API 网关驱动'}</div>
                      </div>
                      <div style={{ marginTop: 'auto' }}>
                        <button
                          type="button"
                          className="studio-btn"
                          disabled={installingTarget !== null}
                          onClick={() => { void handleInstallEcosystem('codex') }}
                        >
                          {installingTarget === 'codex' ? '注入中…' : '📥 注入到 Codex (~/.codex)'}
                        </button>
                      </div>
                    </div>

                    <div className="at-ecosystem-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: 15 }}>🐉 DSH AgentTeams 原生桥接</strong>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 650,
                            color: ecosystemStatus?.dsh?.installed
                              ? 'var(--at-accent-success)'
                              : 'var(--dsw-alias-label-tertiary)',
                          }}
                        >
                          {ecosystemStatus?.dsh?.installed ? '🟢 状态目录互通' : '⚪ 待初始化'}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>
                        100% 兼容 <code>/plugins/dsh-agent-teams/*</code> 契约与工作区 <code>.agent-teams</code> 状态目录。
                      </div>
                      <div style={{ fontSize: 12.5 }}>
                        <div>当前工作区活跃团队：<strong>{ecosystemStatus?.dsh?.activeTeamCount ?? allTeams.length}</strong> 个</div>
                        <div>桥接配置：{ecosystemStatus?.dsh?.bridgeInstalled ? '✓ 已绑定' : '点击下方初始化'}</div>
                      </div>
                      <div style={{ marginTop: 'auto' }}>
                        <button
                          type="button"
                          className="studio-btn"
                          disabled={installingTarget !== null}
                          onClick={() => { void handleInstallEcosystem('dsh') }}
                        >
                          {installingTarget === 'dsh' ? '绑定中…' : '🔗 绑定 DSH 工作区桥接'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {desktopTab === 'status' && (
                <div style={{ display: 'grid', gap: 14 }}>
                  <div className="at-ecosystem-card">
                    <div style={{ fontWeight: 700, fontSize: 15 }}>📦 便携式桌面应用规格</div>
                    <div>应用标识：{desktopStatus?.portableApp?.application ?? 'AgentTeamsStudio'}</div>
                    <div>宿主平台：{desktopStatus?.portableApp?.platform ?? 'windows'} / {desktopStatus?.portableApp?.arch ?? 'amd64'}</div>
                    <div>内核版本：{desktopStatus?.coreVersion ?? '2.0.0'}</div>
                    <div>进程 PID：{desktopStatus?.studioCore?.pid ?? '未知'} · 运行时间：{desktopStatus?.studioCore?.uptimeSeconds ? `${desktopStatus.studioCore.uptimeSeconds}s` : '正常'}</div>
                  </div>

                  <div className="at-ecosystem-card">
                    <div style={{ fontWeight: 700, fontSize: 15 }}>🌐 网络与网关状态</div>
                    <div>主服务端口：<code>:{String(desktopStatus?.config?.port ?? 4317)}</code> · 镜像端口：<code>:{String(desktopStatus?.config?.['mirror-port'] ?? 4318)}</code></div>
                    <div>CPA 代理网关：{desktopStatus?.cpaOnline ? '🟢 已连接 (在线)' : '🟡 离线/降级模式'} ({desktopStatus?.cpaBaseUrl ?? 'http://127.0.0.1:8317/v1'})</div>
                    <div>默认 GPT 模型：<code>{String(desktopStatus?.config?.['default-gpt-model'] ?? 'gpt-6.1-sol')}</code></div>
                  </div>

                  <div className="at-ecosystem-card">
                    <div style={{ fontWeight: 700, fontSize: 15 }}>🐕 看门狗守护状态</div>
                    <div>守护开关：{desktopStatus?.watchdog?.enabled ? '🟢 已启用' : '🔴 已禁用'}</div>
                    <div>巡检周期：{desktopStatus?.watchdog?.intervalMs ? `${desktopStatus.watchdog.intervalMs / 1000} 秒` : '10 秒'}</div>
                    <div>活跃自动推进任务数：{desktopStatus?.watchdog?.activeAutoRuns?.length ?? 0}</div>
                  </div>
                </div>
              )}

              {desktopTab === 'config' && (
                <div style={{ display: 'grid', gap: 14 }}>
                  <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>
                    修改以下项后点击下方「保存配置」，将实时同步写回 <code>config.toml</code>（支持 CPA、Antigravity、Codex、DSH 自定义端点）。
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label style={{ display: 'grid', gap: 5 }}>
                      <span style={{ fontWeight: 600 }}>生态预设方案 (active-preset)</span>
                      <select
                        className="studio-team-select"
                        style={{ maxWidth: '100%' }}
                        value={String(desktopConfigDraft['active-preset'] ?? 'cpa-hajimi')}
                        onChange={(e) => setDesktopConfigDraft((prev) => ({ ...prev, 'active-preset': e.target.value }))}
                      >
                        <option value="cpa-hajimi">CPA + Antigravity 哈吉米 (推荐)</option>
                        <option value="antigravity-codex">Antigravity + OpenAI Codex 双核</option>
                        <option value="dsh-compat">DSH AgentTeams 原生兼容模式</option>
                        <option value="custom">自定义 OpenAI 兼容网关</option>
                      </select>
                    </label>

                    <label style={{ display: 'grid', gap: 5 }}>
                      <span style={{ fontWeight: 600 }}>Codex 驱动模式 (codex-mode)</span>
                      <select
                        className="studio-team-select"
                        style={{ maxWidth: '100%' }}
                        value={String(desktopConfigDraft['codex-mode'] ?? 'api')}
                        onChange={(e) => setDesktopConfigDraft((prev) => ({ ...prev, 'codex-mode': e.target.value }))}
                      >
                        <option value="api">API 网关路由 (CPA / OpenAI BaseURL)</option>
                        <option value="cli">本机 Codex CLI 桥接 (codex exec)</option>
                      </select>
                    </label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label style={{ display: 'grid', gap: 5 }}>
                      <span style={{ fontWeight: 600 }}>CPA 渠道网关地址 (cpa-base-url)</span>
                      <input
                        type="text"
                        className="studio-quick-input"
                        value={String(desktopConfigDraft['cpa-base-url'] ?? 'http://127.0.0.1:8317/v1')}
                        onChange={(e) => setDesktopConfigDraft((prev) => ({ ...prev, 'cpa-base-url': e.target.value }))}
                      />
                    </label>

                    <label style={{ display: 'grid', gap: 5 }}>
                      <span style={{ fontWeight: 600 }}>默认主力模型 (default-gpt-model)</span>
                      <input
                        type="text"
                        className="studio-quick-input"
                        value={String(desktopConfigDraft['default-gpt-model'] ?? 'gpt-6.1-sol')}
                        onChange={(e) => setDesktopConfigDraft((prev) => ({ ...prev, 'default-gpt-model': e.target.value }))}
                      />
                    </label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label style={{ display: 'grid', gap: 5 }}>
                      <span style={{ fontWeight: 600 }}>Codex 端点地址 (codex-base-url)</span>
                      <input
                        type="text"
                        className="studio-quick-input"
                        value={String(desktopConfigDraft['codex-base-url'] ?? 'http://127.0.0.1:8317/v1')}
                        onChange={(e) => setDesktopConfigDraft((prev) => ({ ...prev, 'codex-base-url': e.target.value }))}
                      />
                    </label>

                    <label style={{ display: 'grid', gap: 5 }}>
                      <span style={{ fontWeight: 600 }}>Antigravity 端点地址 (antigravity-base-url)</span>
                      <input
                        type="text"
                        className="studio-quick-input"
                        value={String(desktopConfigDraft['antigravity-base-url'] ?? 'http://127.0.0.1:8317/v1')}
                        onChange={(e) => setDesktopConfigDraft((prev) => ({ ...prev, 'antigravity-base-url': e.target.value }))}
                      />
                    </label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <label style={{ display: 'grid', gap: 5 }}>
                      <span style={{ fontWeight: 600 }}>主服务端口 (port)</span>
                      <input
                        type="number"
                        className="studio-quick-input"
                        value={Number(desktopConfigDraft.port ?? 4317)}
                        onChange={(e) => setDesktopConfigDraft((prev) => ({ ...prev, port: Number(e.target.value) }))}
                      />
                    </label>

                    <label style={{ display: 'grid', gap: 5 }}>
                      <span style={{ fontWeight: 600 }}>关闭行为 (close-behavior)</span>
                      <select
                        className="studio-team-select"
                        style={{ maxWidth: '100%' }}
                        value={String(desktopConfigDraft['close-behavior'] ?? 'ask')}
                        onChange={(e) => setDesktopConfigDraft((prev) => ({ ...prev, 'close-behavior': e.target.value }))}
                      >
                        <option value="ask">询问用户 (ask)</option>
                        <option value="tray">最小化到托盘 (tray)</option>
                        <option value="exit">直接退出 (exit)</option>
                      </select>
                    </label>

                    <label style={{ display: 'grid', gap: 5 }}>
                      <span style={{ fontWeight: 600 }}>看门狗巡检间隔 (秒)</span>
                      <input
                        type="number"
                        className="studio-quick-input"
                        value={Number(desktopConfigDraft['watchdog-interval-seconds'] ?? 10)}
                        onChange={(e) => setDesktopConfigDraft((prev) => ({ ...prev, 'watchdog-interval-seconds': Number(e.target.value) }))}
                      />
                    </label>
                  </div>

                  <div className="at-ecosystem-card" style={{ gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(desktopConfigDraft['cpa-auto-launch'] ?? true)}
                        onChange={(e) => setDesktopConfigDraft((prev) => ({ ...prev, 'cpa-auto-launch': e.target.checked }))}
                      />
                      <span>启动时自动探测并唤醒内置 CPA 渠道网关 (cpa-auto-launch)</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(desktopConfigDraft['dsh-sync-workspace'] ?? true)}
                        onChange={(e) => setDesktopConfigDraft((prev) => ({ ...prev, 'dsh-sync-workspace': e.target.checked }))}
                      />
                      <span>与宿主 DSH 工作区 .agent-teams 目录实时双向同步 (dsh-sync-workspace)</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(desktopConfigDraft['watchdog-enabled'] ?? true)}
                        onChange={(e) => setDesktopConfigDraft((prev) => ({ ...prev, 'watchdog-enabled': e.target.checked }))}
                      />
                      <span>启用 10s 看门狗守护自愈 (watchdog-enabled)</span>
                    </label>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button
                      type="button"
                      className="studio-btn studio-btn-primary"
                      disabled={savingConfig}
                      onClick={() => { void saveDesktopConfig() }}
                    >
                      {savingConfig ? '保存中…' : '💾 保存配置写回 config.toml'}
                    </button>
                  </div>
                </div>
              )}

              {desktopTab === 'usage' && (
                <div style={{ display: 'grid', gap: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    <div className="at-ecosystem-card" style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 780, color: 'var(--at-accent-primary)' }} className="at-tabular-nums">
                        {desktopUsage?.summary?.totalTeams ?? desktopUsage?.totalTeams ?? allTeams.length}
                      </div>
                      <div style={{ color: 'var(--dsw-alias-label-secondary)' }}>总团队数</div>
                    </div>
                    <div className="at-ecosystem-card" style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 780, color: 'var(--at-accent-success)' }} className="at-tabular-nums">
                        {desktopUsage?.summary?.completedTasks ?? desktopUsage?.completedTasks ?? 0}
                      </div>
                      <div style={{ color: 'var(--dsw-alias-label-secondary)' }}>已完成任务</div>
                    </div>
                    <div className="at-ecosystem-card" style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 780, color: 'var(--at-accent-warning)' }} className="at-tabular-nums">
                        {desktopUsage?.totalCpaCalls ?? 0}
                      </div>
                      <div style={{ color: 'var(--dsw-alias-label-secondary)' }}>CPA 调度调用</div>
                    </div>
                  </div>

                  {desktopUsage?.modelDistribution && Object.keys(desktopUsage.modelDistribution).length > 0 && (
                    <div className="at-ecosystem-card">
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>模型调用分布：</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {Object.entries(desktopUsage.modelDistribution).map(([model, count]) => (
                          <span
                            key={model}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 999,
                              background: 'var(--at-accent-primary-subtle)',
                              border: '1px solid var(--at-border-hairline)',
                              fontFamily: 'ui-monospace, monospace',
                              fontSize: 12.5,
                            }}
                          >
                            {model}: <strong>{count}</strong> 次
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    </Theme>
  )
}
