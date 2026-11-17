/**
 * Team activity snapshot assembly mirroring DSH native snapshot.ts.
 * Reuses server/core/state.js, quality-badges.js, quality-gates.js, and workspace-audit.js.
 */

import { readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { qualityBadgeStates } from './core/quality-badges.js'
import { canDeclareDelivery, describeQualityLoop, verdictAuditNotes } from './core/quality-gates.js'
import {
  CAPTAIN_KEY,
  listArchivedTeamGenerations,
  listArchivedTeamIds,
  readArchivedTeam,
  readTeam,
  readUnreadMailbox,
  taskDepthsById,
  taskVisualState,
} from './core/state.js'
import { auditTeamWorkspace } from './core/workspace-audit.js'

function memberModelRoute(member) {
  if (!member) return ''
  const provider = (member.provider ?? '').trim()
  const model = (member.model ?? '').trim()
  if (provider !== '' && model !== '') return `${provider}/${model}`
  return model
}

function currentTaskOf(memberName, tasks) {
  for (const task of tasks) {
    if (task.status === 'in_progress' && task.assignee === memberName) return task.id
  }
  return ''
}

export async function assembleStudioSnapshot(
  workspaceRoot,
  state,
  { archiveId, historic = false, mailboxTeamId } = {},
) {
  const absWorkspace = resolve(workspaceRoot)
  const stateRoot = join(absWorkspace, '.agent-teams')
  const workspaceName = basename(absWorkspace)
  const tasks = Array.isArray(state.tasks) ? state.tasks : []
  const depths = taskDepthsById(tasks)
  const roster = Array.isArray(state.members)
    ? state.members.filter((m) => historic || m.status !== 'removed')
    : []

  const effectiveTeamId = mailboxTeamId ?? state.id
  const unreadByMember = new Map()
  for (const member of roster) {
    try {
      const msgs = await readUnreadMailbox(stateRoot, effectiveTeamId, member.name)
      unreadByMember.set(member.name, msgs.length)
    } catch {
      unreadByMember.set(member.name, 0)
    }
  }

  let captainInboxRaw = []
  try {
    captainInboxRaw = await readUnreadMailbox(stateRoot, effectiveTeamId, CAPTAIN_KEY)
  } catch {
    captainInboxRaw = []
  }

  const members = roster.map((member) => {
    const owned = tasks.filter((task) => task.assignee === member.name)
    const done = owned.filter((task) => task.status === 'completed').length
    const isWorking = !historic && (member.status === 'working' || owned.some((t) => t.status === 'in_progress'))
    return {
      id: member.id || member.name,
      name: member.name,
      role: member.role ?? '',
      provider: (member.provider ?? '').trim(),
      model: (member.model ?? '').trim(),
      reasoningEffort: (member.reasoningEffort ?? member.reasoning_effort ?? '').trim(),
      executionPrompt: member.executionPrompt ?? '',
      status: member.status ?? 'active',
      activity: historic ? 'idle' : isWorking ? 'working' : 'idle',
      progress: owned.length === 0 ? 0 : Math.round((done / owned.length) * 100),
      done,
      total: owned.length,
      currentTask: currentTaskOf(member.name, tasks),
      unread: unreadByMember.get(member.name) ?? 0,
    }
  })

  const audit = auditTeamWorkspace(absWorkspace, state)
  const deliveryCheck = canDeclareDelivery(state, audit)
  const loop = describeQualityLoop(state, audit)
  const staleById = new Map()
  for (const note of verdictAuditNotes(state, audit)) {
    staleById.set(note.taskId, [...(staleById.get(note.taskId) ?? []), note.message])
  }

  const normalizedTasks = tasks.map((task) => ({
    id: task.id,
    subject: task.subject,
    description: task.description ?? '',
    status: task.status,
    state: taskVisualState(task.status, task.dependencies ?? [], tasks),
    assignee: task.assignee ?? '',
    model: memberModelRoute(roster.find((m) => m.name === task.assignee)),
    dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
    depth: depths.get(task.id) ?? 0,
    ...(task.kind === undefined ? {} : { kind: task.kind }),
    ...(task.round === undefined ? {} : { round: task.round }),
    ...(task.verdict === undefined ? {} : { verdict: task.verdict }),
    ...(task.summary === undefined ? {} : { summary: task.summary }),
    ...(task.usage === undefined ? {} : { usage: task.usage }),
    ...(staleById.get(task.id) === undefined
      ? {}
      : { verdictStale: staleById.get(task.id).join('; ') }),
    updatedAt: task.updatedAt ?? Date.now(),
  }))

  return {
    workspace: workspaceName,
    teamId: state.id,
    name: state.name,
    ...(state.description !== undefined ? { description: state.description } : state.goal !== undefined ? { description: state.goal } : {}),
    captainSessionId: state.captainSessionId || 'antigravity-captain',
    ...(archiveId ? { archiveId } : {}),
    phase: state.phase ?? 'running',
    ...(state.phase === 'staged'
      ? { planReviewState: state.planReviewState ?? 'awaiting_review' }
      : {}),
    ...(state.halted === true ? { halted: true } : {}),
    loopState: loop.state,
    deliverable: loop.deliverable,
    delivery: {
      ok: deliveryCheck.ok,
      blockers: [...deliveryCheck.blockers],
      warnings: [...deliveryCheck.warnings],
    },
    members,
    qualityBadges: qualityBadgeStates(
      tasks,
      new Set(state.phase === 'staged' ? tasks.map((t) => t.id) : staleById.keys()),
    ),
    tasks: normalizedTasks,
    messageCount:
      captainInboxRaw.length + members.reduce((acc, m) => acc + (m.unread || 0), 0),
    captainInbox: captainInboxRaw.slice(-5).map((m) => ({
      from: m.from,
      content: m.content,
    })),
  }
}

export async function collectStudioTeams(workspaceRoot, { archived = false } = {}) {
  const absWorkspace = resolve(workspaceRoot)
  const stateRoot = join(absWorkspace, '.agent-teams')

  if (!archived) {
    let entries = []
    try {
      entries = await readdir(stateRoot, { withFileTypes: true })
    } catch (err) {
      if (err && err.code === 'ENOENT') return []
      throw err
    }
    const snapshots = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'archive' || entry.name.startsWith('.')) continue
      try {
        const team = await readTeam(stateRoot, entry.name)
        if (!team) continue
        snapshots.push(await assembleStudioSnapshot(absWorkspace, team))
      } catch {
        continue
      }
    }
    snapshots.sort((a, b) => a.teamId.localeCompare(b.teamId))
    return snapshots
  }

  let generations = []
  let legacy = []
  try {
    generations = await listArchivedTeamGenerations(stateRoot)
    const ids = await listArchivedTeamIds(stateRoot)
    legacy = ids
      .filter((id) => !generations.some((g) => g.teamId === id))
      .map((id) => ({ teamId: id, archiveId: id }))
  } catch (err) {
    if (err && err.code === 'ENOENT') return []
    throw err
  }

  const snapshots = []
  for (const gen of [...generations, ...legacy]) {
    try {
      const team = await readArchivedTeam(stateRoot, gen.teamId, gen.archiveId)
      if (!team) continue
      snapshots.push(
        await assembleStudioSnapshot(absWorkspace, team, {
          archiveId: gen.archiveId,
          historic: true,
          mailboxTeamId: join('archive', gen.archiveId),
        }),
      )
    } catch {
      continue
    }
  }
  return snapshots
}
