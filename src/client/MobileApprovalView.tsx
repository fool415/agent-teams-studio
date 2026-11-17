/**
 * MobileApprovalView v2.0 — Apple Liquid Glass Cross-Device Approval,
 * Git Worktree Isolation, CPA Team Model Telemetry & User-Extensible Widgets Hub.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ActivityTeam } from './activity-monitor.ts'

interface RemoteAccessInfo {
  readonly ok: boolean
  readonly localMobileUrl: string
  readonly lanMobileUrls: readonly string[]
  readonly isGitWorkspace: boolean
  readonly workspaceRoot: string
}

interface WorktreeItem {
  readonly taskId: string
  readonly subject: string
  readonly branch?: string
  readonly worktreePath?: string
  readonly ok?: boolean
  readonly exists?: boolean
  readonly statusShort?: string
  readonly diffStat?: string
  readonly diff?: string
  readonly truncated?: boolean
}

interface CustomWidgetItem {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly icon: string
  readonly description: string
  readonly actionType: 'quick-command' | 'link' | 'note'
  readonly payload: string
  readonly tags: readonly string[]
  readonly fields: readonly { readonly label: string; readonly value: string }[]
  readonly updatedAt: string
}

interface TeamMemberUsage {
  readonly name: string
  readonly role: string
  readonly provider: string
  readonly model: string
  readonly calls: number
  readonly completedTasks: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  readonly cachedTokens: number
  readonly totalTokens: number
  readonly avgLatencyMs: number
}

interface TeamModelUsage {
  readonly route: string
  readonly provider: string
  readonly model: string
  readonly calls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  readonly cachedTokens: number
  readonly totalTokens: number
}

interface TeamTaskUsage {
  readonly id: string
  readonly subject: string
  readonly assignee: string
  readonly status: string
  readonly provider: string
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  readonly cachedTokens: number
  readonly totalTokens: number
  readonly latencyMs: number
  readonly estimated?: boolean
}

interface TeamTelemetryItem {
  readonly teamId: string
  readonly teamName: string
  readonly goal: string
  readonly phase: string
  readonly isArchived: boolean
  readonly totalTasks: number
  readonly completedTasks: number
  readonly totalCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  readonly cachedTokens: number
  readonly totalTokens: number
  readonly avgLatencyMs: number
  readonly membersBreakdown: readonly TeamMemberUsage[]
  readonly modelsBreakdown: readonly TeamModelUsage[]
  readonly tasksBreakdown: readonly TeamTaskUsage[]
}

interface CpaNativeModelRow {
  readonly provider: string
  readonly model: string
  readonly calls: number
  readonly failedCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  readonly cachedTokens: number
  readonly totalTokens: number
  readonly avgLatencyMs: number
}

interface CpaNativeEventRow {
  readonly timestamp: string
  readonly provider: string
  readonly model: string
  readonly responseModel?: string
  readonly latencyMs: number
  readonly ttftMs?: number
  readonly failed: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  readonly cachedTokens: number
  readonly totalTokens: number
}

interface UsageTelemetryResponse {
  readonly ok: boolean
  readonly range?: string
  readonly summary?: {
    readonly totalTeams: number
    readonly activeTeams: number
    readonly archivedTeams: number
    readonly totalTasks: number
    readonly completedTasks: number
    readonly studioTotalCalls: number
    readonly studioInputTokens: number
    readonly studioOutputTokens: number
    readonly studioReasoningTokens: number
    readonly studioCachedTokens: number
    readonly studioTotalTokens: number
  }
  readonly teamsTelemetry?: readonly TeamTelemetryItem[]
  readonly cpaNativeTelemetry?: {
    readonly available: boolean
    readonly dbPath?: string | null
    readonly summary?: {
      readonly totalRequests: number
      readonly successRequests: number
      readonly failedRequests: number
      readonly inputTokens: number
      readonly outputTokens: number
      readonly reasoningTokens: number
      readonly cachedTokens: number
      readonly totalTokens: number
      readonly avgLatencyMs: number
      readonly cacheHitRate: number
    }
    readonly byModel?: readonly CpaNativeModelRow[]
    readonly recentEvents?: readonly CpaNativeEventRow[]
  }
}

interface MobileApprovalViewProps {
  readonly teams: readonly ActivityTeam[]
  readonly onRefreshSnapshots: () => Promise<void>
  readonly onOpenDesktopTeam: (team: ActivityTeam) => void
  readonly onQuickCommand?: (commandText: string) => Promise<void>
}

function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export function MobileApprovalView({
  teams,
  onRefreshSnapshots,
  onOpenDesktopTeam,
  onQuickCommand,
}: MobileApprovalViewProps) {
  const [remoteInfo, setRemoteInfo] = useState<RemoteAccessInfo | null>(null)
  const [worktreesByTeam, setWorktreesByTeam] = useState<Record<string, readonly WorktreeItem[]>>({})
  const [expandedDiffTeam, setExpandedDiffTeam] = useState<string | null>(null)
  const [expandedUsageTeam, setExpandedUsageTeam] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [bannerMsg, setBannerMsg] = useState<{ status: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  // CPA & Team Usage Telemetry State
  const [usageRange, setUsageRange] = useState<'24h' | '7d' | '30d' | 'all'>('all')
  const [telemetry, setTelemetry] = useState<UsageTelemetryResponse | null>(null)
  const [showGatewayEvents, setShowGatewayEvents] = useState(false)

  // User Extensible Custom Widgets State
  const [widgets, setWidgets] = useState<readonly CustomWidgetItem[]>([])
  const [addingWidget, setAddingWidget] = useState(false)
  const [widgetDraft, setWidgetDraft] = useState({
    title: '',
    category: '快捷工作流',
    icon: '⚡',
    description: '',
    actionType: 'quick-command' as 'quick-command' | 'link' | 'note',
    payload: '@studio-default @gpt-6.1-sol ',
    tagsText: 'CPA, 自动化',
    fieldsText: '目标模型=gpt-6.1-sol\n审查级别=L2+L3双审',
  })

  const loadAllData = useCallback(
    async (rangeOverride?: '24h' | '7d' | '30d' | 'all') => {
      const targetRange = rangeOverride ?? usageRange
      try {
        const [remRes, usageRes, widRes] = await Promise.all([
          fetch('/api/remote-access', { cache: 'no-store' }),
          fetch(`/api/desktop/usage?range=${encodeURIComponent(targetRange)}`, { cache: 'no-store' }),
          fetch('/api/extensions/widgets', { cache: 'no-store' }),
        ])
        if (remRes.ok) {
          setRemoteInfo((await remRes.json()) as RemoteAccessInfo)
        }
        if (usageRes.ok) {
          setTelemetry((await usageRes.json()) as UsageTelemetryResponse)
        }
        if (widRes.ok) {
          const wData = (await widRes.json()) as { widgets?: readonly CustomWidgetItem[] }
          setWidgets(wData.widgets ?? [])
        }
      } catch {
        // ignore offline probe errors
      }
    },
    [usageRange],
  )

  useEffect(() => {
    void loadAllData()
  }, [loadAllData])

  const loadTeamWorktrees = useCallback(async (teamId: string) => {
    try {
      const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/worktrees`, { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as { worktrees?: readonly WorktreeItem[] }
        setWorktreesByTeam((prev) => ({ ...prev, [teamId]: data.worktrees ?? [] }))
      }
    } catch {}
  }, [])

  const postAction = useCallback(
    async (key: string, url: string, body: unknown, successText: string, method = 'POST') => {
      setBusyKey(key)
      setBannerMsg(null)
      try {
        const res = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: method === 'DELETE' ? undefined : JSON.stringify(body),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        if (!res.ok) {
          throw new Error(data.error || data.message || `HTTP ${res.status}`)
        }
        setBannerMsg({ status: 'success', text: successText })
        await onRefreshSnapshots()
        await loadAllData()
      } catch (err) {
        setBannerMsg({
          status: 'error',
          text: err instanceof Error ? err.message : String(err),
        })
      } finally {
        setBusyKey(null)
      }
    },
    [onRefreshSnapshots, loadAllData],
  )

  const handleSaveWidget = useCallback(async () => {
    if (!widgetDraft.title.trim()) {
      setBannerMsg({ status: 'error', text: '请输入扩展卡片标题' })
      return
    }
    const tags = widgetDraft.tagsText
      .split(/[,，]/u)
      .map((s) => s.trim())
      .filter(Boolean)
    const fields = widgetDraft.fieldsText
      .split(/\r?\n/u)
      .map((line) => {
        const eq = line.indexOf('=')
        if (eq <= 0) return null
        return { label: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() }
      })
      .filter((item): item is { label: string; value: string } => item !== null && Boolean(item.label))

    try {
      const res = await fetch('/api/extensions/widgets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: widgetDraft.title.trim(),
          category: widgetDraft.category.trim() || '自定义扩展',
          icon: widgetDraft.icon.trim() || '🧩',
          description: widgetDraft.description.trim(),
          actionType: widgetDraft.actionType,
          payload: widgetDraft.payload.trim(),
          tags,
          fields,
        }),
      })
      if (res.ok) {
        setAddingWidget(false)
        setWidgetDraft((prev) => ({ ...prev, title: '', description: '' }))
        setBannerMsg({ status: 'success', text: '✅ 已新增自定义扩展卡片，UI 已自动适配渲染！' })
        await loadAllData()
      }
    } catch (err) {
      setBannerMsg({ status: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }, [widgetDraft, loadAllData])

  const handleDeleteWidget = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/extensions/widgets/${encodeURIComponent(id)}`, { method: 'DELETE' })
        if (res.ok) {
          await loadAllData()
          setBannerMsg({ status: 'info', text: '已移除该自定义扩展卡片' })
        }
      } catch {}
    },
    [loadAllData],
  )

  const copyLink = useCallback((url: string) => {
    navigator.clipboard?.writeText(url).catch(() => {})
    setCopiedUrl(url)
    setTimeout(() => setCopiedUrl((cur) => (cur === url ? null : cur)), 2000)
  }, [])

  const sortedTeams = useMemo(
    () =>
      [...teams].sort((a, b) => {
        if (a.phase === 'staged' && b.phase !== 'staged') return -1
        if (b.phase === 'staged' && a.phase !== 'staged') return 1
        return 0
      }),
    [teams],
  )

  const teamTelemetryMap = useMemo(() => {
    const map = new Map<string, TeamTelemetryItem>()
    for (const item of telemetry?.teamsTelemetry ?? []) {
      map.set(item.teamId, item)
    }
    return map
  }, [telemetry?.teamsTelemetry])

  const cpaSummary = telemetry?.cpaNativeTelemetry?.available
    ? telemetry.cpaNativeTelemetry.summary
    : undefined
  const studioSummary = telemetry?.summary

  const displayTotalRequests = cpaSummary
    ? cpaSummary.totalRequests
    : (studioSummary?.studioTotalCalls ?? 0)
  const displayTotalTokens = cpaSummary
    ? cpaSummary.totalTokens
    : (studioSummary?.studioTotalTokens ?? 0)
  const displayInputTokens = cpaSummary
    ? cpaSummary.inputTokens
    : (studioSummary?.studioInputTokens ?? 0)
  const displayOutputTokens = cpaSummary
    ? cpaSummary.outputTokens
    : (studioSummary?.studioOutputTokens ?? 0)
  const displayReasoningTokens = cpaSummary
    ? cpaSummary.reasoningTokens
    : (studioSummary?.studioReasoningTokens ?? 0)
  const displayCachedTokens = cpaSummary
    ? cpaSummary.cachedTokens
    : (studioSummary?.studioCachedTokens ?? 0)
  const displayCacheHitRate = cpaSummary
    ? cpaSummary.cacheHitRate
    : displayInputTokens > 0
      ? Math.round((displayCachedTokens / displayInputTokens) * 1000) / 10
      : 0

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px 72px', width: '100%' }}>
      <div style={{ width: '100%', maxWidth: '100%', margin: '0 auto', display: 'grid', gap: 20 }}>
        {bannerMsg && (
          <div
            className="at-glass-card"
            style={{
              padding: '14px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              borderColor:
                bannerMsg.status === 'error'
                  ? 'var(--at-accent-danger)'
                  : 'var(--at-border-highlight)',
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>{bannerMsg.text}</span>
            <button type="button" className="studio-btn" onClick={() => setBannerMsg(null)}>
              关闭
            </button>
          </div>
        )}

        {/* Section 1: CPA Model Consumption & Team Telemetry Dashboard */}
        <section className="at-glass-card" style={{ padding: '22px 24px', display: 'grid', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>📊</span>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 780, letterSpacing: '-0.02em' }}>
                  CPA 模型消耗与团队遥测中心 (Model Usage &amp; Team Telemetry)
                </h2>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 650,
                    padding: '3px 11px',
                    borderRadius: 999,
                    background: 'var(--at-accent-primary-subtle)',
                    color: 'var(--at-accent-primary)',
                    border: '1px solid var(--at-border-highlight)',
                  }}
                >
                  {telemetry?.cpaNativeTelemetry?.available
                    ? '🟢 已直连 CPA SQLite 账本 + 团队级计量'
                    : '🟢 Studio 团队级实时计量'}
                </span>
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 }}>
                对标 EasyCLIProxyAPI 原生用量看板：实时追踪每个团队、每个成员及网关各模型的 Input / Output / Reasoning / Cached Token 消耗与响应延迟。
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div className="studio-tabs">
                {(['24h', '7d', '30d', 'all'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="studio-tab"
                    data-active={usageRange === r}
                    onClick={() => {
                      setUsageRange(r)
                      void loadAllData(r)
                    }}
                  >
                    {r === 'all' ? '全部时间' : r.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="studio-btn"
                onClick={() => {
                  void onRefreshSnapshots()
                  void loadAllData()
                }}
              >
                🔄 刷新遥测
              </button>
            </div>
          </div>

          {/* 5 Liquid Glass KPI Metric Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(205px, 1fr))',
              gap: 14,
            }}
          >
            <div className="at-ecosystem-card" style={{ gap: 6 }}>
              <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 }}>
                ⚡ 总请求调用数 (Requests)
              </div>
              <div
                className="at-tabular-nums"
                style={{ fontSize: 25, fontWeight: 800, color: 'var(--at-accent-primary)' }}
              >
                {displayTotalRequests.toLocaleString()}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}>
                团队调度 {studioSummary?.studioTotalCalls ?? 0} 次 · 活跃团队 {studioSummary?.activeTeams ?? teams.length} 个
              </div>
            </div>

            <div className="at-ecosystem-card" style={{ gap: 6 }}>
              <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 }}>
                💎 总消耗 Tokens (Total)
              </div>
              <div
                className="at-tabular-nums"
                style={{ fontSize: 25, fontWeight: 800, color: 'var(--dsw-alias-label-primary)' }}
              >
                {formatCompactNumber(displayTotalTokens)}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}>
                精确总计：{displayTotalTokens.toLocaleString()} tokens
              </div>
            </div>

            <div className="at-ecosystem-card" style={{ gap: 6 }}>
              <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 }}>
                📥 输入 / 📤 输出 Tokens
              </div>
              <div
                className="at-tabular-nums"
                style={{ fontSize: 20, fontWeight: 780, color: 'var(--dsw-alias-label-primary)' }}
              >
                {formatCompactNumber(displayInputTokens)} <span style={{ opacity: 0.45 }}>/</span>{' '}
                <span style={{ color: 'var(--at-accent-success)' }}>{formatCompactNumber(displayOutputTokens)}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}>
                Prompt 输入与 Completion 生成明细
              </div>
            </div>

            <div className="at-ecosystem-card" style={{ gap: 6 }}>
              <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 }}>
                ♻️ 缓存命中 (Cached Tokens)
              </div>
              <div
                className="at-tabular-nums"
                style={{ fontSize: 24, fontWeight: 800, color: 'var(--at-accent-success)' }}
              >
                {formatCompactNumber(displayCachedTokens)}{' '}
                <span style={{ fontSize: 13.5, fontWeight: 650 }}>({displayCacheHitRate}%)</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}>
                大幅节省重复上下文 Token 成本
              </div>
            </div>

            <div className="at-ecosystem-card" style={{ gap: 6 }}>
              <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 }}>
                🧠 思考推理 / ⏱️ 平均延迟
              </div>
              <div
                className="at-tabular-nums"
                style={{ fontSize: 20, fontWeight: 780, color: 'var(--at-accent-warning)' }}
              >
                {formatCompactNumber(displayReasoningTokens)}{' '}
                <span style={{ fontSize: 13.5, color: 'var(--dsw-alias-label-secondary)' }}>
                  · {cpaSummary ? `${(cpaSummary.avgLatencyMs / 1000).toFixed(1)}s` : '—'}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}>
                Reasoning 思考链消耗与平均响应耗时
              </div>
            </div>
          </div>

          {/* Model Consumption Ranking Bar List (CPA Native + Studio) */}
          {telemetry?.cpaNativeTelemetry?.byModel && telemetry.cpaNativeTelemetry.byModel.length > 0 && (
            <div className="at-ecosystem-card" style={{ gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  🏆 各渠道模型消耗排行榜 (CPA Gateway Model Breakdown)
                </div>
                <button
                  type="button"
                  className="studio-btn"
                  onClick={() => setShowGatewayEvents((prev) => !prev)}
                >
                  {showGatewayEvents ? '收起最近请求流水' : '📜 查看最近请求事件明细'}
                </button>
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                {telemetry.cpaNativeTelemetry.byModel.slice(0, 8).map((row) => {
                  const maxTok = Math.max(1, telemetry.cpaNativeTelemetry?.byModel?.[0]?.totalTokens ?? 1)
                  const pct = Math.max(2, Math.min(100, Math.round((row.totalTokens / maxTok) * 100)))
                  return (
                    <div key={`${row.provider}-${row.model}`} style={{ display: 'grid', gap: 5 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 13.5 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 700,
                              background: 'var(--at-accent-primary-subtle)',
                              color: 'var(--at-accent-primary)',
                            }}
                          >
                            {row.provider || 'cpa'}
                          </span>
                          <strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: 14 }}>{row.model}</strong>
                        </div>
                        <div className="at-tabular-nums" style={{ display: 'flex', gap: 14, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>
                          <span>调用: <strong>{row.calls}</strong> 次</span>
                          <span>输入: <strong>{formatCompactNumber(row.inputTokens)}</strong></span>
                          <span>输出: <strong>{formatCompactNumber(row.outputTokens)}</strong></span>
                          {row.reasoningTokens > 0 && <span>思考: <strong>{formatCompactNumber(row.reasoningTokens)}</strong></span>}
                          <span>缓存: <strong>{formatCompactNumber(row.cachedTokens)}</strong></span>
                          <span style={{ color: 'var(--at-accent-primary)' }}>
                            总计: <strong>{formatCompactNumber(row.totalTokens)}</strong>
                          </span>
                          <span>延迟: {(row.avgLatencyMs / 1000).toFixed(1)}s</span>
                        </div>
                      </div>
                      <div style={{ height: 7, borderRadius: 999, background: 'rgba(148, 163, 184, 0.16)', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            borderRadius: 999,
                            background: 'linear-gradient(90deg, var(--at-accent-primary), var(--at-accent-secondary, var(--at-accent-primary)))',
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

              {showGatewayEvents && telemetry.cpaNativeTelemetry.recentEvents && (
                <div style={{ marginTop: 8, overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} className="at-tabular-nums">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--at-border-hairline)', textAlign: 'left', color: 'var(--dsw-alias-label-secondary)' }}>
                        <th style={{ padding: '8px 10px' }}>时间</th>
                        <th style={{ padding: '8px 10px' }}>渠道 / 模型</th>
                        <th style={{ padding: '8px 10px' }}>输入</th>
                        <th style={{ padding: '8px 10px' }}>输出</th>
                        <th style={{ padding: '8px 10px' }}>思考</th>
                        <th style={{ padding: '8px 10px' }}>缓存</th>
                        <th style={{ padding: '8px 10px' }}>总 Tokens</th>
                        <th style={{ padding: '8px 10px' }}>耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {telemetry.cpaNativeTelemetry.recentEvents.slice(0, 12).map((ev, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--at-border-hairline)' }}>
                          <td style={{ padding: '7px 10px', color: 'var(--dsw-alias-label-tertiary)' }}>
                            {String(ev.timestamp || '').slice(5, 19).replace('T', ' ')}
                          </td>
                          <td style={{ padding: '7px 10px', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>
                            {ev.provider}/{ev.model}
                          </td>
                          <td style={{ padding: '7px 10px' }}>{formatCompactNumber(ev.inputTokens)}</td>
                          <td style={{ padding: '7px 10px' }}>{formatCompactNumber(ev.outputTokens)}</td>
                          <td style={{ padding: '7px 10px' }}>{formatCompactNumber(ev.reasoningTokens)}</td>
                          <td style={{ padding: '7px 10px', color: 'var(--at-accent-success)' }}>{formatCompactNumber(ev.cachedTokens)}</td>
                          <td style={{ padding: '7px 10px', fontWeight: 700, color: 'var(--at-accent-primary)' }}>{formatCompactNumber(ev.totalTokens)}</td>
                          <td style={{ padding: '7px 10px' }}>{(ev.latencyMs / 1000).toFixed(2)}s</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Section 2: Cross-Device Remote Access + User-Extensible Custom Widgets */}
        <section className="at-glass-card" style={{ padding: '22px 24px', display: 'grid', gap: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>📱</span>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 780 }}>
                  跨端远程审批入口 &amp; 可扩展自定义模块 (Extensible Workspace Cards)
                </h2>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 650,
                    padding: '3px 10px',
                    borderRadius: 999,
                    background: remoteInfo?.isGitWorkspace ? 'rgba(52, 211, 153, 0.14)' : 'var(--at-accent-primary-subtle)',
                    color: remoteInfo?.isGitWorkspace ? 'var(--at-accent-success)' : 'var(--at-accent-primary)',
                  }}
                >
                  {remoteInfo?.isGitWorkspace ? '🌿 Git Worktree 分支隔离就绪' : '📁 标准工作区模式'}
                </span>
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 }}>
                支持手机/平板局域网审批，同时支持点击右侧按钮自由添加你自己的快捷动作、外部看板链接或自定义指标卡片，UI 自动适配布局。
              </div>
            </div>

            <button
              type="button"
              className="studio-btn studio-btn-primary"
              onClick={() => setAddingWidget((prev) => !prev)}
            >
              {addingWidget ? '✕ 取消添加' : '➕ 添加自定义扩展卡片'}
            </button>
          </div>

          {/* Remote URLs */}
          {remoteInfo && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
              {[remoteInfo.localMobileUrl, ...remoteInfo.lanMobileUrls].map((url, idx) => (
                <div
                  key={url}
                  className="at-ecosystem-card"
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 }}>
                      {idx === 0 ? '💻 本机跨端审批地址' : `📡 局域网移动设备入口 #${idx}`}
                    </div>
                    <div
                      style={{
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 13.5,
                        fontWeight: 650,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {url}
                    </div>
                  </div>
                  <button type="button" className="studio-btn" onClick={() => copyLink(url)}>
                    {copiedUrl === url ? '✓ 已复制' : '复制链接'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add Custom Widget Form */}
          {addingWidget && (
            <div className="at-ecosystem-card" style={{ gap: 14, border: '1.5px solid var(--at-accent-primary)' }}>
              <div style={{ fontWeight: 750, fontSize: 15.5 }}>
                🧩 新增自定义扩展模块（保存后自动生成 Liquid Glass 适配卡片）
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <label style={{ display: 'grid', gap: 5 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>卡片标题 *</span>
                  <input
                    type="text"
                    className="studio-quick-input"
                    placeholder="例如：一键发起全量交叉审查"
                    value={widgetDraft.title}
                    onChange={(e) => setWidgetDraft((p) => ({ ...p, title: e.target.value }))}
                  />
                </label>
                <label style={{ display: 'grid', gap: 5 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>分类标签</span>
                  <input
                    type="text"
                    className="studio-quick-input"
                    value={widgetDraft.category}
                    onChange={(e) => setWidgetDraft((p) => ({ ...p, category: e.target.value }))}
                  />
                </label>
                <label style={{ display: 'grid', gap: 5 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>图标 Emoji &amp; 动作类型</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      className="studio-quick-input"
                      style={{ width: 64, textAlign: 'center' }}
                      value={widgetDraft.icon}
                      onChange={(e) => setWidgetDraft((p) => ({ ...p, icon: e.target.value }))}
                    />
                    <select
                      className="studio-team-select"
                      style={{ flex: 1, maxWidth: '100%' }}
                      value={widgetDraft.actionType}
                      onChange={(e) =>
                        setWidgetDraft((p) => ({
                          ...p,
                          actionType: e.target.value as 'quick-command' | 'link' | 'note',
                        }))
                      }
                    >
                      <option value="quick-command">⚡ 触发 @快捷指令建队/派发</option>
                      <option value="link">🔗 打开外部 Web / 监控链接</option>
                      <option value="note">📌 纯信息指标展示卡</option>
                    </select>
                  </div>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ display: 'grid', gap: 5 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {widgetDraft.actionType === 'quick-command'
                      ? '执行的 @快捷指令内容'
                      : widgetDraft.actionType === 'link'
                        ? '目标 URL 地址'
                        : '备注说明'}
                  </span>
                  <input
                    type="text"
                    className="studio-quick-input"
                    value={widgetDraft.payload}
                    onChange={(e) => setWidgetDraft((p) => ({ ...p, payload: e.target.value }))}
                  />
                </label>
                <label style={{ display: 'grid', gap: 5 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>卡片简介说明</span>
                  <input
                    type="text"
                    className="studio-quick-input"
                    placeholder="简述该扩展模块的用途…"
                    value={widgetDraft.description}
                    onChange={(e) => setWidgetDraft((p) => ({ ...p, description: e.target.value }))}
                  />
                </label>
              </div>

              <label style={{ display: 'grid', gap: 5 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  自定义键值对字段（每行一个 `名称=数值`，UI 会自动渲染为自适应指标网格）
                </span>
                <textarea
                  className="studio-quick-input"
                  style={{ height: 74, padding: '8px 12px', resize: 'vertical' }}
                  value={widgetDraft.fieldsText}
                  onChange={(e) => setWidgetDraft((p) => ({ ...p, fieldsText: e.target.value }))}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="studio-btn" onClick={() => setAddingWidget(false)}>
                  取消
                </button>
                <button type="button" className="studio-btn studio-btn-primary" onClick={() => { void handleSaveWidget() }}>
                  💾 保存并渲染扩展卡片
                </button>
              </div>
            </div>
          )}

          {/* Rendered User Custom Widgets Grid */}
          {widgets.length > 0 && (
            <div className="at-ecosystem-grid">
              {widgets.map((w) => (
                <div key={w.id} className="at-ecosystem-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 18 }}>{w.icon || '🧩'}</span>
                      <strong style={{ fontSize: 15 }}>{w.title}</strong>
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        padding: '2px 9px',
                        borderRadius: 999,
                        background: 'var(--at-accent-primary-subtle)',
                        color: 'var(--at-accent-primary)',
                        fontWeight: 650,
                      }}
                    >
                      {w.category}
                    </span>
                  </div>
                  {w.description && (
                    <div style={{ fontSize: 13.5, color: 'var(--dsw-alias-label-secondary)' }}>{w.description}</div>
                  )}
                  {w.fields.length > 0 && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                        gap: 8,
                        padding: '8px 10px',
                        borderRadius: 12,
                        background: 'var(--at-canvas-input)',
                      }}
                    >
                      {w.fields.map((f, i) => (
                        <div key={i}>
                          <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>{f.label}</div>
                          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{f.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 4 }}>
                    {w.actionType === 'quick-command' && w.payload ? (
                      <button
                        type="button"
                        className="studio-btn studio-btn-primary"
                        onClick={() => {
                          if (onQuickCommand) void onQuickCommand(w.payload)
                        }}
                      >
                        ⚡ 一键执行指令
                      </button>
                    ) : w.actionType === 'link' && w.payload ? (
                      <a
                        href={w.payload}
                        target="_blank"
                        rel="noreferrer"
                        className="studio-btn studio-btn-primary"
                        style={{ textDecoration: 'none' }}
                      >
                        🔗 打开链接
                      </a>
                    ) : (
                      <span style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}>{w.payload}</span>
                    )}
                    <button
                      type="button"
                      className="studio-btn"
                      onClick={() => { void handleDeleteWidget(w.id) }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Section 3: Per-Team Approval, Git Worktree & Accurate Team Model Consumption Cards */}
        <section style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 780 }}>
              👑 团队审批、Git Worktree 隔离 &amp; 单团队模型消耗明细 ({sortedTeams.length})
            </h2>
          </div>

          {sortedTeams.length === 0 ? (
            <div className="at-glass-card" style={{ padding: '36px 28px', textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>当前暂无活跃团队</div>
              <div style={{ fontSize: 14, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 }}>
                可在上方 @快捷模式 输入指令或点击「+ 新建团队」，创建后即可在此查看每个团队的模型消耗明细并执行跨端审批。
              </div>
            </div>
          ) : (
            sortedTeams.map((team) => {
              const isStaged = team.phase === 'staged'
              const completedCount = team.tasks.filter((t) => t.state === 'completed').length
              const worktrees = worktreesByTeam[team.teamId] ?? []
              const diffOpen = expandedDiffTeam === team.teamId
              const usageOpen = expandedUsageTeam === team.teamId
              const tUsage = teamTelemetryMap.get(team.teamId)

              return (
                <div
                  key={team.teamId}
                  className="at-glass-card"
                  style={{ padding: '22px 24px', display: 'grid', gap: 16 }}
                >
                  {/* Header Row */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 18, fontWeight: 780 }}>{team.name}</strong>
                        <span
                          style={{
                            fontSize: 12.5,
                            fontWeight: 700,
                            padding: '3px 11px',
                            borderRadius: 999,
                            background: isStaged
                              ? 'rgba(251, 191, 36, 0.16)'
                              : team.halted
                                ? 'rgba(251, 113, 133, 0.16)'
                                : 'rgba(52, 211, 153, 0.16)',
                            color: isStaged
                              ? 'var(--at-accent-warning)'
                              : team.halted
                                ? 'var(--at-accent-danger)'
                                : 'var(--at-accent-success)',
                          }}
                        >
                          {isStaged ? '⏳ 待审批 (STAGED)' : team.halted ? '⏸ 已暂停' : '🟢 运行中 (RUNNING)'}
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>
                          进度 <strong>{completedCount}/{team.tasks.length}</strong> · 成员 <strong>{team.members.length}</strong> 人
                        </span>
                      </div>
                      {(tUsage?.goal || team.description) && (
                        <div style={{ fontSize: 14, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.55 }}>
                          目标：{tUsage?.goal || team.description}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {isStaged ? (
                        <button
                          type="button"
                          className="studio-btn studio-btn-primary"
                          disabled={busyKey !== null}
                          onClick={() => {
                            void postAction(
                              `approve-${team.teamId}`,
                              '/plugins/dsh-agent-teams/plan',
                              { teamId: team.teamId, action: 'approve', autoRun: true },
                              `✅ 已批准并启动团队「${team.name}」！`,
                            )
                          }}
                        >
                          ✅ 批准并启动团队
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="studio-btn studio-btn-primary"
                            disabled={busyKey !== null || team.halted}
                            onClick={() => {
                              void postAction(
                                `next-${team.teamId}`,
                                `/api/teams/${encodeURIComponent(team.teamId)}/run-next`,
                                {},
                                `⚡ 已触发「${team.name}」执行下一就绪任务`,
                              )
                            }}
                          >
                            ⚡ 执行下一步
                          </button>
                          <button
                            type="button"
                            className="studio-btn"
                            disabled={busyKey !== null || team.halted}
                            onClick={() => {
                              void postAction(
                                `auto-${team.teamId}`,
                                `/api/teams/${encodeURIComponent(team.teamId)}/auto-run`,
                                {},
                                `🚀 已完成「${team.name}」全自动 DAG 推进`,
                              )
                            }}
                          >
                            🚀 自动推进全部
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="studio-btn"
                        onClick={() => onOpenDesktopTeam(team)}
                      >
                        🖥️ 打开 2×2 看板
                      </button>
                    </div>
                  </div>

                  {/* Per-Team CPA Model Consumption Strip */}
                  <div
                    className="at-ecosystem-card"
                    style={{
                      padding: '14px 18px',
                      display: 'grid',
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }} className="at-tabular-nums">
                        <span style={{ fontWeight: 750, fontSize: 14.5 }}>
                          📊 本团队模型消耗统计：
                        </span>
                        <span style={{ fontSize: 13.5 }}>
                          总计 <strong style={{ color: 'var(--at-accent-primary)', fontSize: 15 }}>{formatCompactNumber(tUsage?.totalTokens ?? 0)}</strong> tokens
                        </span>
                        <span style={{ fontSize: 13.5, color: 'var(--dsw-alias-label-secondary)' }}>
                          输入 <strong>{formatCompactNumber(tUsage?.inputTokens ?? 0)}</strong> · 输出 <strong>{formatCompactNumber(tUsage?.outputTokens ?? 0)}</strong>
                        </span>
                        {(tUsage?.reasoningTokens ?? 0) > 0 && (
                          <span style={{ fontSize: 13.5, color: 'var(--at-accent-warning)' }}>
                            思考 <strong>{formatCompactNumber(tUsage?.reasoningTokens ?? 0)}</strong>
                          </span>
                        )}
                        <span style={{ fontSize: 13.5, color: 'var(--at-accent-success)' }}>
                          缓存命中 <strong>{formatCompactNumber(tUsage?.cachedTokens ?? 0)}</strong>
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' }}>
                          调用 {tUsage?.totalCalls ?? 0} 次 · 平均耗时 {tUsage?.avgLatencyMs ? `${(tUsage.avgLatencyMs / 1000).toFixed(1)}s` : '—'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="studio-btn"
                          onClick={() => setExpandedUsageTeam(usageOpen ? null : team.teamId)}
                        >
                          {usageOpen ? '收起成员/任务消耗明细' : '📈 展开成员与模型消耗详情'}
                        </button>
                        <button
                          type="button"
                          className="studio-btn"
                          onClick={() => {
                            if (diffOpen) {
                              setExpandedDiffTeam(null)
                            } else {
                              setExpandedDiffTeam(team.teamId)
                              void loadTeamWorktrees(team.teamId)
                            }
                          }}
                        >
                          {diffOpen ? '收起 Worktree' : '🌿 检视 Git Worktree'}
                        </button>
                      </div>
                    </div>

                    {/* Member & Model Chips */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {(tUsage?.membersBreakdown ?? team.members).map((m: any) => (
                        <span
                          key={m.name}
                          style={{
                            padding: '4px 11px',
                            borderRadius: 999,
                            fontSize: 12.5,
                            fontWeight: 600,
                            background: 'var(--at-canvas-input)',
                            border: '1px solid var(--at-border-hairline)',
                          }}
                          className="at-tabular-nums"
                        >
                          👤 {m.name} · <code>{m.provider || 'cpa'}/{m.model || 'gpt-6.1-sol'}</code>
                          {typeof m.totalTokens === 'number' && m.totalTokens > 0
                            ? ` · 💎 ${formatCompactNumber(m.totalTokens)} (${m.calls}次)`
                            : ''}
                        </span>
                      ))}
                    </div>

                    {/* Expanded Per-Team Detailed Breakdown Table */}
                    {usageOpen && tUsage && (
                      <div style={{ display: 'grid', gap: 12, marginTop: 4, paddingTop: 8, borderTop: '1px solid var(--at-border-hairline)' }}>
                        {tUsage.modelsBreakdown.length > 0 && (
                          <div style={{ display: 'grid', gap: 6 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--dsw-alias-label-secondary)' }}>
                              按模型汇总 (By Model)：
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                              {tUsage.modelsBreakdown.map((mb) => (
                                <div
                                  key={mb.route}
                                  style={{
                                    padding: '10px 14px',
                                    borderRadius: 12,
                                    background: 'var(--at-canvas-input)',
                                    border: '1px solid var(--at-border-hairline)',
                                  }}
                                  className="at-tabular-nums"
                                >
                                  <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 13.5, color: 'var(--at-accent-primary)' }}>
                                    {mb.route}
                                  </div>
                                  <div style={{ fontSize: 12.5, marginTop: 4, color: 'var(--dsw-alias-label-secondary)' }}>
                                    调用 {mb.calls} 次 · 总计 <strong>{formatCompactNumber(mb.totalTokens)}</strong> (入 {formatCompactNumber(mb.inputTokens)} / 出 {formatCompactNumber(mb.outputTokens)} / 缓 {formatCompactNumber(mb.cachedTokens)})
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} className="at-tabular-nums">
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--at-border-hairline)', textAlign: 'left', color: 'var(--dsw-alias-label-secondary)' }}>
                                <th style={{ padding: '6px 8px' }}>任务 ID &amp; 标题</th>
                                <th style={{ padding: '6px 8px' }}>执行成员</th>
                                <th style={{ padding: '6px 8px' }}>使用模型</th>
                                <th style={{ padding: '6px 8px' }}>状态</th>
                                <th style={{ padding: '6px 8px' }}>输入</th>
                                <th style={{ padding: '6px 8px' }}>输出</th>
                                <th style={{ padding: '6px 8px' }}>缓存</th>
                                <th style={{ padding: '6px 8px' }}>总计 Tokens</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tUsage.tasksBreakdown.map((tb) => (
                                <tr key={tb.id} style={{ borderBottom: '1px solid var(--at-border-hairline)' }}>
                                  <td style={{ padding: '7px 8px', fontWeight: 600 }}>
                                    [{tb.id}] {tb.subject}
                                  </td>
                                  <td style={{ padding: '7px 8px' }}>{tb.assignee}</td>
                                  <td style={{ padding: '7px 8px', fontFamily: 'ui-monospace, monospace' }}>
                                    {tb.provider}/{tb.model}
                                  </td>
                                  <td style={{ padding: '7px 8px' }}>{tb.status}</td>
                                  <td style={{ padding: '7px 8px' }}>{formatCompactNumber(tb.inputTokens)}</td>
                                  <td style={{ padding: '7px 8px' }}>{formatCompactNumber(tb.outputTokens)}</td>
                                  <td style={{ padding: '7px 8px', color: 'var(--at-accent-success)' }}>{formatCompactNumber(tb.cachedTokens)}</td>
                                  <td style={{ padding: '7px 8px', fontWeight: 700, color: 'var(--at-accent-primary)' }}>
                                    {formatCompactNumber(tb.totalTokens)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Expanded Git Worktree Inspector */}
                  {diffOpen && (
                    <div className="at-ecosystem-card" style={{ gap: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                        🌿 团队任务 Git Worktree 隔离分支列表
                      </div>
                      {worktrees.length === 0 ? (
                        <div style={{ fontSize: 13.5, color: 'var(--dsw-alias-label-secondary)' }}>
                          该团队当前暂无已创建的任务级 Git Worktree 分支。可为任意任务点击下方按钮创建独立分支隔离工作区：
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                            {team.tasks.slice(0, 5).map((task) => (
                              <button
                                key={task.id}
                                type="button"
                                className="studio-btn"
                                onClick={() => {
                                  void postAction(
                                    `wt-${team.teamId}-${task.id}`,
                                    `/api/teams/${encodeURIComponent(team.teamId)}/tasks/${encodeURIComponent(task.id)}/worktree/ensure`,
                                    {},
                                    `已为任务 ${task.id} 初始化隔离 Git Worktree`,
                                  ).then(() => loadTeamWorktrees(team.teamId))
                                }}
                              >
                                + 为 [{task.id}] 创建隔离 Worktree
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        worktrees.map((wt) => (
                          <div
                            key={wt.taskId}
                            style={{
                              padding: 12,
                              borderRadius: 12,
                              background: 'var(--at-canvas-input)',
                              border: '1px solid var(--at-border-hairline)',
                              display: 'grid',
                              gap: 8,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                              <div>
                                <strong>[{wt.taskId}] {wt.subject}</strong> · 分支 <code>{wt.branch}</code>
                              </div>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                  type="button"
                                  className="studio-btn studio-btn-primary"
                                  onClick={() => {
                                    void postAction(
                                      `merge-${team.teamId}-${wt.taskId}`,
                                      `/api/teams/${encodeURIComponent(team.teamId)}/tasks/${encodeURIComponent(wt.taskId)}/worktree/merge`,
                                      { commitMessage: `feat(${wt.taskId}): merge isolated task worktree` },
                                      `✅ 已将分支 ${wt.branch} 合并回主工作区`,
                                    ).then(() => loadTeamWorktrees(team.teamId))
                                  }}
                                >
                                  🔀 合并回主分支
                                </button>
                                <button
                                  type="button"
                                  className="studio-btn"
                                  onClick={() => {
                                    void postAction(
                                      `clean-${team.teamId}-${wt.taskId}`,
                                      `/api/teams/${encodeURIComponent(team.teamId)}/tasks/${encodeURIComponent(wt.taskId)}/worktree`,
                                      {},
                                      `🧹 已清理任务 ${wt.taskId} 的 Worktree`,
                                      'DELETE',
                                    ).then(() => loadTeamWorktrees(team.teamId))
                                  }}
                                >
                                  🧹 清理分支
                                </button>
                              </div>
                            </div>
                            {wt.diff && (
                              <pre
                                style={{
                                  margin: 0,
                                  padding: 10,
                                  borderRadius: 10,
                                  background: 'rgba(0,0,0,0.28)',
                                  fontSize: 12.5,
                                  maxHeight: 220,
                                  overflow: 'auto',
                                }}
                              >
                                {wt.diff}
                              </pre>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </section>
      </div>
    </div>
  )
}
