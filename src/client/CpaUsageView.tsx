/**
 * CpaUsageView.tsx — Standalone CPA Model Consumption & Team Telemetry Center.
 * Styled with Apple 18 Liquid Glass (outer refractive shell) + Solid Glass (inner frosted cards)
 * inspired by Lumina / Apple 18 UI & EasyCLIProxyAPI Usage Analytics.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ActivityTeam } from './activity-monitor.ts'

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

interface CpaNativeProviderRow {
  readonly provider: string
  readonly calls: number
  readonly totalTokens: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedTokens: number
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
    readonly byProvider?: readonly CpaNativeProviderRow[]
    readonly recentEvents?: readonly CpaNativeEventRow[]
  }
}

interface CpaUsageViewProps {
  readonly teams: readonly ActivityTeam[]
  readonly onOpenTeamWorkspace: (teamId: string) => void
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export function CpaUsageView({ teams, onOpenTeamWorkspace }: CpaUsageViewProps) {
  const [range, setRange] = useState<'24h' | '7d' | '30d' | 'all'>('all')
  const [focusMode, setFocusMode] = useState<'teams' | 'models' | 'events'>('teams')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [telemetry, setTelemetry] = useState<UsageTelemetryResponse | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<string>('all')
  const [searchFilter, setSearchFilter] = useState('')

  const loadTelemetry = useCallback(
    async (targetRange?: '24h' | '7d' | '30d' | 'all') => {
      const r = targetRange ?? range
      try {
        const res = await fetch(`/api/desktop/usage?range=${encodeURIComponent(r)}`, { cache: 'no-store' })
        if (res.ok) {
          setTelemetry((await res.json()) as UsageTelemetryResponse)
        }
      } catch {}
    },
    [range],
  )

  useEffect(() => {
    void loadTelemetry()
    if (!autoRefresh) return
    const timer = setInterval(() => {
      void loadTelemetry()
    }, 8000)
    return () => clearInterval(timer)
  }, [loadTelemetry, autoRefresh])

  const cpaSummary = telemetry?.cpaNativeTelemetry?.available
    ? telemetry.cpaNativeTelemetry.summary
    : undefined
  const studioSummary = telemetry?.summary

  const teamsList = useMemo(() => {
    const raw = telemetry?.teamsTelemetry ?? []
    const q = searchFilter.trim().toLowerCase()
    return raw.filter((item) => {
      if (selectedTeamId !== 'all' && item.teamId !== selectedTeamId) return false
      if (!q) return true
      return (
        item.teamName.toLowerCase().includes(q) ||
        item.teamId.toLowerCase().includes(q) ||
        item.modelsBreakdown.some((m) => m.route.toLowerCase().includes(q)) ||
        item.membersBreakdown.some((m) => m.name.toLowerCase().includes(q))
      )
    })
  }, [telemetry?.teamsTelemetry, selectedTeamId, searchFilter])

  const focusedTeam = useMemo(
    () => teamsList[0] ?? telemetry?.teamsTelemetry?.[0] ?? null,
    [teamsList, telemetry?.teamsTelemetry],
  )

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px 72px', width: '100%' }}>
      <div style={{ width: '100%', maxWidth: '100%', margin: '0 auto', display: 'grid', gap: 18 }}>
        {/* Figure 1 Style Top 3 Horizontal Liquid/Solid Glass Stage Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 14,
          }}
        >
          <button
            type="button"
            className="at-apple18-stage-card"
            data-active={focusMode === 'teams' ? 'true' : 'false'}
            onClick={() => setFocusMode('teams')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span style={{ fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'ui-monospace, monospace' }}>
                #1 · team-telemetry
              </span>
              <span className="at-apple18-stage-pill" data-state="done">
                {telemetry?.teamsTelemetry?.length ?? teams.length} 个团队
              </span>
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 760, marginTop: 6 }}>
              团队级模型消耗账本、成员配额与单任务 Token 透视
            </div>
          </button>

          <button
            type="button"
            className="at-apple18-stage-card"
            data-active={focusMode === 'models' ? 'true' : 'false'}
            onClick={() => setFocusMode('models')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span style={{ fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'ui-monospace, monospace' }}>
                #2 · cpa-gateway
              </span>
              <span className="at-apple18-stage-pill" data-state="running">
                {telemetry?.cpaNativeTelemetry?.byModel?.length ?? 0} 款活跃模型
              </span>
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 760, marginTop: 6 }}>
              CPA 渠道模型消耗排行、缓存命中率与响应延迟分析
            </div>
          </button>

          <button
            type="button"
            className="at-apple18-stage-card"
            data-active={focusMode === 'events' ? 'true' : 'false'}
            onClick={() => setFocusMode('events')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span style={{ fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'ui-monospace, monospace' }}>
                #3 · live-events
              </span>
              <span className="at-apple18-stage-pill" data-state="pending">
                实时流水
              </span>
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 760, marginTop: 6 }}>
              网关与团队实时请求事件流、TTFT 延迟与 Token 审计
            </div>
          </button>
        </div>

        {/* Control Bar with Apple 18 Liquid Lens Capsule */}
        <section
          className="at-glass-card"
          style={{
            padding: '16px 22px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 18, fontWeight: 800 }}>📊 CPA 模型消耗与团队遥测中心</span>
            <select
              className="studio-team-select"
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
            >
              <option value="all">全部团队 ({telemetry?.teamsTelemetry?.length ?? 0})</option>
              {(telemetry?.teamsTelemetry ?? []).map((t) => (
                <option key={t.teamId} value={t.teamId}>
                  {t.teamName} ({fmtNum(t.totalTokens)} tokens)
                </option>
              ))}
            </select>
            <input
              type="text"
              className="studio-quick-input"
              style={{ width: 240 }}
              placeholder="🔍 筛选团队、成员或模型名…"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
          </div>

          {/* Figure 1 Top-Right Inspired Liquid Lens Pill */}
          <div className="at-liquid-lens-dock">
            {(['24h', '7d', '30d', 'all'] as const).map((r) => (
              <button
                key={r}
                type="button"
                className="at-liquid-lens-item"
                data-active={range === r ? 'true' : 'false'}
                onClick={() => {
                  setRange(r)
                  void loadTelemetry(r)
                }}
              >
                {r === 'all' ? '全部' : r.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              className="at-liquid-lens-item"
              data-active={autoRefresh ? 'true' : 'false'}
              onClick={() => setAutoRefresh((p) => !p)}
            >
              <span className="studio-dot" data-online={autoRefresh ? 'true' : 'false'} />
              <span>自动刷新</span>
            </button>
          </div>
        </section>

        {/* 5 Apple 18 Solid-in-Liquid KPI Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
          }}
        >
          <div className="at-solid-glass-card">
            <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 650 }}>
              团队总消耗 Tokens (Studio Teams)
            </div>
            <div className="at-tabular-nums" style={{ fontSize: 26, fontWeight: 820, color: 'var(--at-accent-primary)', marginTop: 4 }}>
              {fmtNum(studioSummary?.studioTotalTokens ?? 0)}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 }}>
              团队任务调用 <strong>{studioSummary?.studioTotalCalls ?? 0}</strong> 次 · 精确值 {(studioSummary?.studioTotalTokens ?? 0).toLocaleString()}
            </div>
          </div>

          <div className="at-solid-glass-card">
            <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 650 }}>
              CPA 网关总吞吐 (Gateway Total)
            </div>
            <div className="at-tabular-nums" style={{ fontSize: 26, fontWeight: 820, marginTop: 4 }}>
              {fmtNum(cpaSummary?.totalTokens ?? studioSummary?.studioTotalTokens ?? 0)}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 }}>
              网关总请求 <strong>{(cpaSummary?.totalRequests ?? studioSummary?.studioTotalCalls ?? 0).toLocaleString()}</strong> 次
            </div>
          </div>

          <div className="at-solid-glass-card">
            <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 650 }}>
              输入 Prompt / 输出 Completion
            </div>
            <div className="at-tabular-nums" style={{ fontSize: 21, fontWeight: 780, marginTop: 6 }}>
              {fmtNum(cpaSummary?.inputTokens ?? studioSummary?.studioInputTokens ?? 0)}{' '}
              <span style={{ opacity: 0.4 }}>/</span>{' '}
              <span style={{ color: 'var(--at-accent-success)' }}>
                {fmtNum(cpaSummary?.outputTokens ?? studioSummary?.studioOutputTokens ?? 0)}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 }}>
              团队入 {fmtNum(studioSummary?.studioInputTokens ?? 0)} · 团队出 {fmtNum(studioSummary?.studioOutputTokens ?? 0)}
            </div>
          </div>

          <div className="at-solid-glass-card">
            <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 650 }}>
              缓存命中 Tokens &amp; 命中率
            </div>
            <div className="at-tabular-nums" style={{ fontSize: 24, fontWeight: 820, color: 'var(--at-accent-success)', marginTop: 4 }}>
              {fmtNum(cpaSummary?.cachedTokens ?? studioSummary?.studioCachedTokens ?? 0)}{' '}
              <span style={{ fontSize: 14 }}>({cpaSummary?.cacheHitRate ?? 0}%)</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 }}>
              团队级缓存命中：{fmtNum(studioSummary?.studioCachedTokens ?? 0)} tokens
            </div>
          </div>

          <div className="at-solid-glass-card">
            <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 650 }}>
              思考 Reasoning &amp; 平均响应耗时
            </div>
            <div className="at-tabular-nums" style={{ fontSize: 22, fontWeight: 780, color: 'var(--at-accent-warning)', marginTop: 6 }}>
              {fmtNum(cpaSummary?.reasoningTokens ?? studioSummary?.studioReasoningTokens ?? 0)}{' '}
              <span style={{ fontSize: 14, color: 'var(--dsw-alias-label-secondary)' }}>
                · {cpaSummary ? `${(cpaSummary.avgLatencyMs / 1000).toFixed(1)}s` : '—'}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 }}>
              深度推理链消耗与请求平均延迟
            </div>
          </div>
        </div>

        {/* Main Split Workbench (Figure 1 Layout: Left Liquid Glass Inspector + Right Detail Stage) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(380px, 460px) minmax(0, 1fr)',
            gap: 18,
            alignItems: 'start',
          }}
        >
          {/* Left Column: Figure 1 Style Liquid Glass Outer Card with Solid Glass Inner Rows */}
          <section className="at-glass-card" style={{ padding: '20px 20px', display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 16.5, fontWeight: 780 }}>
                团队消耗总览列表 ({teamsList.length})
              </strong>
              <span className="at-apple18-stage-pill" data-state="running">
                cpa-ledger
              </span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <span className="at-solid-chip">team-token-audit</span>
              <span className="at-solid-chip">member-attribution</span>
              <span className="at-solid-chip">cache-hit-metrics</span>
            </div>

            <div style={{ display: 'grid', gap: 10, maxHeight: 560, overflowY: 'auto', paddingRight: 4 }}>
              {teamsList.map((team) => {
                const isSelected = focusedTeam?.teamId === team.teamId
                return (
                  <button
                    key={team.teamId}
                    type="button"
                    className="at-solid-list-item"
                    data-selected={isSelected ? 'true' : 'false'}
                    onClick={() => {
                      setSelectedTeamId(team.teamId === selectedTeamId ? 'all' : team.teamId)
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <strong style={{ fontSize: 14.5, fontWeight: 740 }}>{team.teamName}</strong>
                      <span
                        className="at-tabular-nums"
                        style={{ fontSize: 13.5, fontWeight: 780, color: 'var(--at-accent-primary)' }}
                      >
                        {fmtNum(team.totalTokens)} tokens
                      </span>
                    </div>
                    <div
                      className="at-tabular-nums"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        width: '100%',
                        fontSize: 12.5,
                        color: 'var(--dsw-alias-label-secondary)',
                        marginTop: 4,
                      }}
                    >
                      <span>
                        调用 {team.totalCalls} 次 · 任务 {team.completedTasks}/{team.totalTasks}
                      </span>
                      <span>
                        入 {fmtNum(team.inputTokens)} / 出 {fmtNum(team.outputTokens)} / 缓 {fmtNum(team.cachedTokens)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {team.modelsBreakdown.slice(0, 3).map((m) => (
                        <code
                          key={m.route}
                          style={{
                            fontSize: 11.5,
                            padding: '1px 7px',
                            borderRadius: 6,
                            background: 'var(--at-accent-primary-subtle)',
                            color: 'var(--at-accent-primary)',
                          }}
                        >
                          {m.route}: {fmtNum(m.totalTokens)}
                        </code>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Right Column: Detailed Per-Team / Gateway Model Stage */}
          <section className="at-glass-card" style={{ padding: '22px 24px', display: 'grid', gap: 18 }}>
            {focusMode === 'teams' && focusedTeam ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <h3 style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>
                        👑 {focusedTeam.teamName} · 模型消耗深度账单
                      </h3>
                      <span className="at-apple18-stage-pill" data-state="done">
                        {focusedTeam.phase.toUpperCase()}
                      </span>
                    </div>
                    {focusedTeam.goal && (
                      <div style={{ fontSize: 13.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 }}>
                        团队目标：{focusedTeam.goal}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="studio-btn studio-btn-primary"
                    onClick={() => onOpenTeamWorkspace(focusedTeam.teamId)}
                  >
                    🖥️ 跳转该团队 2×2 监控台
                  </button>
                </div>

                {/* Focused Team 4 Metric Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 12 }}>
                  <div className="at-solid-glass-card" style={{ padding: '12px 16px' }}>
                    <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' }}>本团队总消耗</div>
                    <div className="at-tabular-nums" style={{ fontSize: 22, fontWeight: 800, color: 'var(--at-accent-primary)' }}>
                      {fmtNum(focusedTeam.totalTokens)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
                      精确：{focusedTeam.totalTokens.toLocaleString()}
                    </div>
                  </div>
                  <div className="at-solid-glass-card" style={{ padding: '12px 16px' }}>
                    <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' }}>输入 / 输出 Tokens</div>
                    <div className="at-tabular-nums" style={{ fontSize: 18, fontWeight: 760, marginTop: 2 }}>
                      {fmtNum(focusedTeam.inputTokens)} / {fmtNum(focusedTeam.outputTokens)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
                      调用 {focusedTeam.totalCalls} 次
                    </div>
                  </div>
                  <div className="at-solid-glass-card" style={{ padding: '12px 16px' }}>
                    <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' }}>缓存命中 / 思考</div>
                    <div className="at-tabular-nums" style={{ fontSize: 18, fontWeight: 760, color: 'var(--at-accent-success)', marginTop: 2 }}>
                      {fmtNum(focusedTeam.cachedTokens)} / {fmtNum(focusedTeam.reasoningTokens)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
                      平均耗时 {(focusedTeam.avgLatencyMs / 1000).toFixed(1)}s
                    </div>
                  </div>
                </div>

                {/* Member Breakdown */}
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ fontWeight: 750, fontSize: 15 }}>
                    👥 团队成员模型分配与 Token 消耗占比
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                    {focusedTeam.membersBreakdown.map((m) => {
                      const pct = focusedTeam.totalTokens > 0
                        ? Math.round((m.totalTokens / focusedTeam.totalTokens) * 100)
                        : 0
                      return (
                        <div key={m.name} className="at-solid-glass-card" style={{ padding: '13px 16px', display: 'grid', gap: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong style={{ fontSize: 14.5 }}>👤 {m.name}</strong>
                            <span className="at-tabular-nums" style={{ fontWeight: 780, color: 'var(--at-accent-primary)' }}>
                              {fmtNum(m.totalTokens)} ({pct}%)
                            </span>
                          </div>
                          <div style={{ fontSize: 12.5, fontFamily: 'ui-monospace, monospace', color: 'var(--dsw-alias-label-secondary)' }}>
                            {m.provider}/{m.model}
                          </div>
                          <div className="at-tabular-nums" style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}>
                            调用 {m.calls} 次 · 入 {fmtNum(m.inputTokens)} · 出 {fmtNum(m.outputTokens)} · 缓 {fmtNum(m.cachedTokens)}
                          </div>
                          <div style={{ height: 6, borderRadius: 999, background: 'rgba(148,163,184,0.18)', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${Math.max(4, pct)}%`,
                                height: '100%',
                                borderRadius: 999,
                                background: 'var(--at-accent-primary)',
                              }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Tasks Token Ledger Table */}
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ fontWeight: 750, fontSize: 15 }}>
                    📋 团队单任务模型消耗明细表 ({focusedTeam.tasksBreakdown.length})
                  </div>
                  <div className="at-solid-glass-card" style={{ padding: 0, overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }} className="at-tabular-nums">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--at-border-hairline)', textAlign: 'left', color: 'var(--dsw-alias-label-secondary)' }}>
                          <th style={{ padding: '10px 14px' }}>任务</th>
                          <th style={{ padding: '10px 14px' }}>成员</th>
                          <th style={{ padding: '10px 14px' }}>模型路由</th>
                          <th style={{ padding: '10px 14px' }}>输入</th>
                          <th style={{ padding: '10px 14px' }}>输出</th>
                          <th style={{ padding: '10px 14px' }}>思考</th>
                          <th style={{ padding: '10px 14px' }}>缓存</th>
                          <th style={{ padding: '10px 14px' }}>总计</th>
                        </tr>
                      </thead>
                      <tbody>
                        {focusedTeam.tasksBreakdown.map((t) => (
                          <tr key={t.id} style={{ borderBottom: '1px solid var(--at-border-hairline)' }}>
                            <td style={{ padding: '9px 14px', fontWeight: 650 }}>
                              [{t.id}] {t.subject}
                            </td>
                            <td style={{ padding: '9px 14px' }}>{t.assignee}</td>
                            <td style={{ padding: '9px 14px', fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>
                              {t.provider}/{t.model}
                            </td>
                            <td style={{ padding: '9px 14px' }}>{fmtNum(t.inputTokens)}</td>
                            <td style={{ padding: '9px 14px' }}>{fmtNum(t.outputTokens)}</td>
                            <td style={{ padding: '9px 14px' }}>{fmtNum(t.reasoningTokens)}</td>
                            <td style={{ padding: '9px 14px', color: 'var(--at-accent-success)' }}>{fmtNum(t.cachedTokens)}</td>
                            <td style={{ padding: '9px 14px', fontWeight: 780, color: 'var(--at-accent-primary)' }}>
                              {fmtNum(t.totalTokens)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : focusMode === 'models' ? (
              <div style={{ display: 'grid', gap: 14 }}>
                <div style={{ fontWeight: 800, fontSize: 18 }}>
                  🏆 CPA 网关全渠道模型消耗排行榜
                </div>
                {(telemetry?.cpaNativeTelemetry?.byModel ?? []).map((row) => {
                  const maxTok = Math.max(1, telemetry?.cpaNativeTelemetry?.byModel?.[0]?.totalTokens ?? 1)
                  const pct = Math.max(3, Math.round((row.totalTokens / maxTok) * 100))
                  return (
                    <div key={`${row.provider}-${row.model}`} className="at-solid-glass-card" style={{ display: 'grid', gap: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="at-apple18-stage-pill" data-state="running">{row.provider}</span>
                          <strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: 15 }}>{row.model}</strong>
                        </div>
                        <div className="at-tabular-nums" style={{ display: 'flex', gap: 14, fontSize: 13.5 }}>
                          <span>调用 <strong>{row.calls}</strong> 次</span>
                          <span>入 <strong>{fmtNum(row.inputTokens)}</strong></span>
                          <span>出 <strong>{fmtNum(row.outputTokens)}</strong></span>
                          <span>缓 <strong style={{ color: 'var(--at-accent-success)' }}>{fmtNum(row.cachedTokens)}</strong></span>
                          <span style={{ color: 'var(--at-accent-primary)', fontWeight: 800 }}>总计 {fmtNum(row.totalTokens)}</span>
                        </div>
                      </div>
                      <div style={{ height: 8, borderRadius: 999, background: 'rgba(148,163,184,0.16)', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: 'var(--at-accent-primary)' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                <div style={{ fontWeight: 800, fontSize: 18 }}>
                  📜 CPA 网关最近实时请求事件流水
                </div>
                <div className="at-solid-glass-card" style={{ padding: 0, overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }} className="at-tabular-nums">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--at-border-hairline)', textAlign: 'left', color: 'var(--dsw-alias-label-secondary)' }}>
                        <th style={{ padding: '10px 12px' }}>时间</th>
                        <th style={{ padding: '10px 12px' }}>渠道 / 模型</th>
                        <th style={{ padding: '10px 12px' }}>输入</th>
                        <th style={{ padding: '10px 12px' }}>输出</th>
                        <th style={{ padding: '10px 12px' }}>思考</th>
                        <th style={{ padding: '10px 12px' }}>缓存</th>
                        <th style={{ padding: '10px 12px' }}>总 Tokens</th>
                        <th style={{ padding: '10px 12px' }}>延迟</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(telemetry?.cpaNativeTelemetry?.recentEvents ?? []).map((ev, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--at-border-hairline)' }}>
                          <td style={{ padding: '8px 12px', color: 'var(--dsw-alias-label-tertiary)' }}>
                            {String(ev.timestamp || '').slice(5, 19).replace('T', ' ')}
                          </td>
                          <td style={{ padding: '8px 12px', fontFamily: 'ui-monospace, monospace', fontWeight: 650 }}>
                            {ev.provider}/{ev.model}
                          </td>
                          <td style={{ padding: '8px 12px' }}>{fmtNum(ev.inputTokens)}</td>
                          <td style={{ padding: '8px 12px' }}>{fmtNum(ev.outputTokens)}</td>
                          <td style={{ padding: '8px 12px' }}>{fmtNum(ev.reasoningTokens)}</td>
                          <td style={{ padding: '8px 12px', color: 'var(--at-accent-success)' }}>{fmtNum(ev.cachedTokens)}</td>
                          <td style={{ padding: '8px 12px', fontWeight: 780, color: 'var(--at-accent-primary)' }}>{fmtNum(ev.totalTokens)}</td>
                          <td style={{ padding: '8px 12px' }}>{(ev.latencyMs / 1000).toFixed(2)}s</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
