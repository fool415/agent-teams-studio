/** Left-navigation entry: every AgentTeams team across the workspace registry. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from './dsh-shims.ts'
import type { SessionId } from './dsh-shims.ts'
import { ACTIVITY_STATE_URL, type ActivityTeam } from './activity-monitor.ts'
import type { AgentTeamsLayoutNavigator, AgentTeamsSessionNavigator } from './session-navigation.ts'
import { TEAM_TAB_KIND, createWorkspaceBridge } from './WorkspaceActivity.tsx'
import type { AgentTeamsTranslate } from './locales.ts'
import { CreateTeamWizard } from './CreateTeamWizard.tsx'
import { DeleteTeamModal } from './DeleteTeamModal.tsx'
import css from './TeamsOverview.module.css'
import { QualityBadges } from './QualityBadges.tsx'

/** Shared by the sidebar list entry and the main-panel page. */
export const AGENT_TEAMS_PANEL_ID = 'agent-teams'
/** Nav order: plugins 0, task board 20, agents 30, ssh 40. */
export const AGENT_TEAMS_PANEL_ORDER = 50
/** The per-session pane polls at 1s; a cross-workspace board is cheaper. */
export const OVERVIEW_POLL_MS = 5000
/** Give the shell's own session switch up to ~1.5s to bind the right rail. */
const TAB_OPEN_ATTEMPTS = 25
const TAB_OPEN_DELAY_MS = 60

export interface AgentTeamsPanelInjected {
  readonly sessions: AgentTeamsSessionNavigator
  readonly layout?: AgentTeamsLayoutNavigator
  readonly bridge: ReturnType<typeof createWorkspaceBridge>
}

export type TeamsOverviewProps = PropsLocale<'agentTeams'> & AgentTeamsPanelInjected

/**
 * Nav-rail icon. The host passes the owner's entry props, so the glyph scales
 * with the rail and carries its own id as the panel identity attribute.
 */
export function TeamsNavIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return (
    <svg
      data-dsh-panel-entry={AGENT_TEAMS_PANEL_ID}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="5.5" r="2.2" />
      <path d="M2.2 13.2c0-2.1 1.7-3.6 3.8-3.6s3.8 1.5 3.8 3.6" />
      <circle cx="11.4" cy="6.6" r="1.6" />
      <path d="M11 9.8c1.6.1 2.8 1.3 2.8 3" />
    </svg>
  )
}

type Phase = 'staged' | 'running' | 'halted'
type View = 'live' | 'archived'
type Status = 'loading' | 'ready' | 'error'

const PHASE_LABEL: Record<Phase, 'overview.staged' | 'overview.running' | 'overview.halted'> = {
  staged: 'overview.staged',
  running: 'overview.running',
  halted: 'overview.halted',
}

function phaseOf(team: ActivityTeam): Phase {
  if (team.halted === true) return 'halted'
  return team.phase
}

function taskProgress(team: ActivityTeam): { done: number; total: number } {
  let done = 0
  for (const task of team.tasks) if (task.state === 'completed') done += 1
  return { done, total: team.tasks.length }
}

/** One `/state` read; archived history is the same route with a query flag. */
async function readTeams(signal: AbortSignal, archived: boolean): Promise<readonly ActivityTeam[]> {
  const url = archived ? `${ACTIVITY_STATE_URL}?archived=1` : ACTIVITY_STATE_URL
  const response = await fetch(url, { signal, cache: 'no-store', credentials: 'same-origin', headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`agent-teams state ${response.status}`)
  const payload = (await response.json()) as { teams?: readonly ActivityTeam[] }
  return Array.isArray(payload.teams) ? payload.teams : []
}

/**
 * All-workspace team board. Root scope means no session binding, so this page
 * fetches the shared state route itself and navigates into a captain session on
 * demand instead of reusing the session-scoped right-rail pane.
 */
export function TeamsOverview({ t, sessions, layout, bridge }: TeamsOverviewProps) {
  const [view, setView] = useState<View>('live')
  const [status, setStatus] = useState<Status>('loading')
  const [live, setLive] = useState<readonly ActivityTeam[]>([])
  const [archived, setArchived] = useState<readonly ActivityTeam[]>([])
  const [round, setRound] = useState(0)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ActivityTeam | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let stopped = false
    const load = async (): Promise<void> => {
      // A hidden page costs nothing and refetches as soon as it is visible again.
      if (document.visibilityState === 'hidden') return
      try {
        const [current, history] = await Promise.all([
          readTeams(controller.signal, false),
          readTeams(controller.signal, true),
        ])
        if (stopped) return
        setLive(current)
        setArchived(history)
        setStatus('ready')
      } catch (error: unknown) {
        if (stopped || (error as { name?: unknown } | null)?.name === 'AbortError') return
        setStatus('error')
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, OVERVIEW_POLL_MS)
    return () => { stopped = true; controller.abort(); window.clearInterval(timer) }
  }, [round])

  const rows = view === 'live' ? live : archived
  const groups = useMemo(() => {
    const buckets = new Map<string, ActivityTeam[]>()
    for (const team of rows) {
      const bucket = buckets.get(team.workspace)
      if (bucket === undefined) buckets.set(team.workspace, [team])
      else bucket.push(team)
    }
    return [...buckets.entries()].sort((left, right) => left[0].localeCompare(right[0]))
  }, [rows])

  const openTeam = useCallback((team: ActivityTeam): void => {
    if (team.captainSessionId === '') return
    const sessionId = team.captainSessionId as unknown as SessionId
    sessions.open?.(sessionId)
    layout?.selectPanel?.(null)
    if (bridge.getSnapshot() === undefined) return
    let attempts = 0
    const bind = (): void => {
      const sidebar = bridge.getSnapshot()
      if (sidebar === undefined) return
      if (sidebar.mounted.getSnapshot() === sessionId) { sidebar.openTab(TEAM_TAB_KIND); return }
      attempts += 1
      if (attempts > TAB_OPEN_ATTEMPTS) return
      window.setTimeout(bind, TAB_OPEN_DELAY_MS)
    }
    window.setTimeout(bind, TAB_OPEN_DELAY_MS)
  }, [bridge, layout, sessions])

  const refresh = (): void => { setRound(value => value + 1) }

  return (
    <div className={css.root}>
      <div className={css.content}>
        <header className={css.heading}>
          <svg viewBox="0 0 16 16" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="6" cy="5.5" r="2.2" />
            <path d="M2.2 13.2c0-2.1 1.7-3.6 3.8-3.6s3.8 1.5 3.8 3.6" />
            <circle cx="11.4" cy="6.6" r="1.6" />
            <path d="M11 9.8c1.6.1 2.8 1.3 2.8 3" />
          </svg>
          <h2>
            {t('nav.title')}
            <span>{t('overview.subtitle')}</span>
          </h2>
          <div className={css.toolbar}>
            <button
              type="button"
              className={css.createBtn}
              onClick={() => { setWizardOpen(true) }}
              title="创建自定义团队"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '5px' }}>
                <line x1="8" y1="3" x2="8" y2="13" />
                <line x1="3" y1="8" x2="13" y2="8" />
              </svg>
              新建团队
            </button>
            <div className={css.segmented} role="tablist" aria-label={t('nav.title')}>
              <button type="button" role="tab" aria-selected={view === 'live'} onClick={() => { setView('live') }}>
                {t('overview.live')}
                <span>{live.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={view === 'archived'} onClick={() => { setView('archived') }}>
                {t('overview.archived')}
                <span>{archived.length}</span>
              </button>
            </div>
            <button type="button" className={css.refresh} onClick={refresh}>{t('overview.refresh')}</button>
            <button
              type="button"
              className={css.exitBtn}
              onClick={() => { layout?.selectPanel?.(null) }}
              title="退出智能体团队，返回主工作区"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                <path d="M6 3H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3" />
                <polyline points="10 11 13 8 10 5" />
                <line x1="13" y1="8" x2="5" y2="8" />
              </svg>
              退出
            </button>
          </div>
        </header>

        {/* Memory System (dsh-mnemon) Style: System Overview Stat Cards Banner */}
        <div className={css.overviewStatsGrid}>
          <div className={css.statCard}>
            <div className={css.statHeader}>
              <span className={css.statDot} />
              <span className={css.statLabel}>团队协同引擎</span>
            </div>
            <div className={css.statValue}>{status === 'ready' ? '已连接' : status === 'error' ? '连接异常' : '连接中'}</div>
            <div className={css.statDesc}>仅表示团队快照接口状态，不代表沙箱健康</div>
          </div>
          <div className={css.statCard}>
            <div className={css.statHeader}>
              <span className={css.statDot} />
              <span className={css.statLabel}>运行团队</span>
            </div>
            <div className={css.statValue}>{live.length} <span className={css.statUnit}>支活跃</span></div>
            <div className={css.statDesc}>多 Agent 实时协作中</div>
          </div>
          <div className={css.statCard}>
            <div className={css.statHeader}>
              <span className={`${css.statDot} ${css.statDotArchived}`} />
              <span className={css.statLabel}>历史归档</span>
            </div>
            <div className={css.statValue}>{archived.length} <span className={css.statUnit}>份代际</span></div>
            <div className={css.statDesc}>归档历史 · 可申请恢复</div>
          </div>
          <div className={css.statCard}>
            <div className={css.statHeader}>
              <span className={css.statDot} />
              <span className={css.statLabel}>动态容灾调度</span>
            </div>
            <div className={css.statValue}>按配置启用</div>
            <div className={css.statDesc}>按职能队列 · 请求边界受控回切</div>
          </div>
        </div>

        {status === 'error'
          ? (
            <div className={css.error} role="status">
              <span>{t('overview.error')}</span>
              <button type="button" onClick={refresh}>{t('overview.retry')}</button>
            </div>
          )
          : null}

        {status === 'loading' && rows.length === 0
          ? <div className={css.skeleton} aria-hidden="true"><i /><i /><i /></div>
          : null}

        {status === 'ready' && rows.length === 0
          ? (
            <div className={css.empty}>
              <div className={css.emptyMark} aria-hidden="true">{view === 'live' ? '\u{1F4CB}' : '\u{1F5C4}'}</div>
              <h3>{view === 'live' ? t('overview.emptyLive') : t('overview.emptyArchived')}</h3>
              <p>{t('overview.emptyHint')}</p>
            </div>
          )
          : null}

        {groups.map(([workspace, teams]) => (
          <section key={workspace} className={css.group}>
            <div className={css.groupHead}>
              <h3>{workspace === '' ? t('overview.unassigned') : workspace}</h3>
            </div>
            <div className={css.list}>
              {teams.map(team => (
                <TeamRow
                  key={`${team.workspace}/${team.teamId}`}
                  team={team}
                  t={t}
                  isArchived={view === 'archived'}
                  onOpen={openTeam}
                  onDelete={(target) => { setDeleteTarget(target) }}
                  onRestore={async (target) => {
                    try {
                      const resp = await fetch(`/plugins/dsh-agent-teams/teams/${encodeURIComponent(target.teamId)}/restore`, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                      })
                      if (resp.ok) {
                        refresh()
                      } else {
                        alert('恢复团队失败')
                      }
                    } catch {
                      alert('网络错误')
                    }
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <CreateTeamWizard
        open={wizardOpen}
        onClose={() => { setWizardOpen(false) }}
        onTeamCreated={() => {
          refresh()
          setWizardOpen(false)
        }}
        t={t}
      />

      {deleteTarget && (
        <DeleteTeamModal
          open={true}
          teamId={deleteTarget.teamId}
          teamName={deleteTarget.name || deleteTarget.teamId}
          sessionId={deleteTarget.captainSessionId as unknown as SessionId}
          onClose={() => { setDeleteTarget(null) }}
          onDeleted={() => {
            setDeleteTarget(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function TeamRow({ team, t, isArchived, onOpen, onDelete, onRestore }: {
  team: ActivityTeam
  t: AgentTeamsTranslate
  isArchived: boolean
  onOpen: (team: ActivityTeam) => void
  onDelete: (team: ActivityTeam) => void
  onRestore: (team: ActivityTeam) => void
}) {
  const phase = phaseOf(team)
  const { done, total } = taskProgress(team)
  const unread = team.captainInbox.length
  return (
    <article
      className={css.row}
      title={team.description === undefined || team.description === '' ? team.teamId : team.description}
    >
      <span className={css.rowMain}>
        <span className={css.rowName}>{team.name === '' ? team.teamId : team.name}</span>
        <span className={css.rowMeta}>
          <span className={css.identity}>{team.teamId}</span>
          <span className={css.dot} aria-hidden="true">·</span>
          <span>{t('overview.members', { count: team.members.length })}</span>
          {total === 0
            ? null
            : (
              <>
                <span className={css.dot} aria-hidden="true">·</span>
                <span>{t('overview.tasks', { completed: done, total })}</span>
              </>
            )}
          {unread === 0
            ? null
            : (
              <>
                <span className={css.dot} aria-hidden="true">·</span>
                <span className={css.unread}>{t('overview.unread', { count: unread })}</span>
              </>
            )}
        </span>
        <QualityBadges badges={team.qualityBadges} />
      </span>
      <span className={css.badge} data-phase={phase}>
        {phase === 'running' && <span className={css.pulseIndicator} aria-hidden="true" />}
        {t(PHASE_LABEL[phase])}
      </span>
      <div className={css.actionBtnGroup}>
        <button
          type="button"
          className={css.actionFocusBtn}
          title="聚焦进入工作台"
          onClick={(e) => {
            e.stopPropagation()
            onOpen(team)
          }}
        >
          聚焦工作台
        </button>
        {isArchived ? (
          <button
            type="button"
            className={css.actionRestoreBtn}
            title="恢复此归档团队"
            onClick={(e) => {
              e.stopPropagation()
              onRestore(team)
            }}
          >
            还原团队
          </button>
        ) : (
          <button
            type="button"
            className={css.actionDeleteBtn}
            title="删除归档此团队"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(team)
            }}
          >
            删除并归档
          </button>
        )}
      </div>
      <span className={css.open} aria-hidden="true">{t('overview.open')}</span>
    </article>
  )
}
