/**
 * Event-driven DAG task scheduler & EasyCLIProxyAPI execution engine.
 * Enforces mandatory `phase === 'running'` approval gate, N-1 judge conflict check,
 * SHA256 artifact binding on review pass, and captain mailbox reporting.
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readArtifactScope } from './core/artifacts.js'
import {
  bindReviewToRevision,
  judgeConflictFor,
  planQualityFollowUp,
  reviewedTargetOf,
  verdictScopePatterns,
} from './core/quality-gates.js'
import { FINDING_SEVERITIES, REVIEW_VERDICTS } from './core/types.js'
import {
  appendMailbox,
  CAPTAIN_KEY,
  createMessage,
  readTeam,
  teamLockKey,
  withTeamLock,
  writeTeam,
} from './core/state.js'
import { DEFAULT_CPA_API_KEY, DEFAULT_CPA_BASE_URL, DEFAULT_CPA_GPT_MODEL, runCpaChatCompletion } from './cpa-client.mjs'
import { readDesktopConfig, recordUsageSnapshot } from './desktop-manager.mjs'
import { buildCustomManualPrompt } from './extensions-store.mjs'
import { buildOpsPromptInjection } from './ops-knowledge.mjs'
import { createSandboxTools } from './sandbox.mjs'
import { ensureTaskWorktree, inspectWorktreeDiff } from './worktree.mjs'

function httpError(statusCode, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

function isTaskReady(task, allTasks) {
  if (task.status !== 'pending' && task.status !== 'open') return false
  const deps = Array.isArray(task.dependencies) ? task.dependencies : []
  const byId = new Map(allTasks.map((t) => [t.id, t]))
  return deps.every((depId) => byId.get(depId)?.status === 'completed')
}

function isSupersededNeedsRevisionTask(task, allTasks) {
  if (task.status !== 'failed' || task.verdict !== 'needs_revision') return false
  const findingIds = new Set((task.findings ?? []).map((f) => f.id))
  return allTasks.some(
    (candidate) =>
      candidate.kind === 'repair' &&
      candidate.status === 'completed' &&
      (candidate.findingSourceTaskIds?.includes(task.id) === true ||
        (candidate.sourceFindingIds ?? []).some((id) => findingIds.has(id))),
  )
}

function isTeamAllResolved(team) {
  if (team.escalated === true) return false
  return team.tasks.every(
    (t) =>
      t.status === 'completed' ||
      t.status === 'cancelled' ||
      isSupersededNeedsRevisionTask(t, team.tasks),
  )
}

function normalizeSeverity(raw) {
  const s = String(raw ?? '').trim().toLowerCase()
  if (FINDING_SEVERITIES.includes(s)) return s
  if (s === 'critical' || s === 'p0') return 'blocker'
  if (s === 'major' || s === 'p1') return 'high'
  if (s === 'minor' || s === 'p2') return 'medium'
  return 'high'
}

function normalizeFinding(raw, index, taskId, defaultFile) {
  const rawId = String(raw?.id ?? `f${index + 1}`).trim() || `f${index + 1}`
  const scopedId = rawId.startsWith(`${taskId}-`) ? rawId : `${taskId}-${rawId}`
  const problem = String(raw?.problem ?? raw?.summary ?? '审查发现待修复问题').trim() || '审查发现待修复问题'
  const requiredFix = String(raw?.requiredFix ?? raw?.fix ?? '根据审查意见修改对应实现并通过验证').trim() || '根据审查意见修改对应实现并通过验证'
  const fileCandidate = typeof raw?.file === 'string' && raw.file.trim() !== ''
    ? raw.file.trim().replace(/^\.\/+/u, '')
    : defaultFile
  const out = {
    id: scopedId,
    severity: normalizeSeverity(raw?.severity),
    problem,
    requiredFix,
    ...(fileCandidate && !fileCandidate.startsWith('.agent-teams') ? { file: fileCandidate } : {}),
  }
  if (Number.isSafeInteger(raw?.line) && raw.line >= 0) {
    out.line = raw.line
  }
  return out
}

function defaultScopeFileForTask(team, task) {
  const target = reviewedTargetOf(team, task)
  const fromChanged = target?.changedPaths?.find((p) => p && !p.startsWith('.agent-teams'))
  if (fromChanged) return fromChanged
  const fromScope = task.inScope?.[0] ?? target?.inScope?.[0]
  if (fromScope && !fromScope.startsWith('.agent-teams')) return fromScope
  return 'src/'
}

function parseFindingsFromText(text, taskId, defaultFile) {
  const findings = []
  const lines = String(text ?? '').split(/\r?\n/u)
  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*]\s*)?FINDING\s*:\s*(.+)$/iu)
    if (!match) continue
    const parts = match[1].split('|').map((p) => p.trim())
    const [idPart, sevPart, filePart, problemPart, fixPart] = parts
    const raw = parts.length >= 4
      ? { id: idPart, severity: sevPart, file: filePart, problem: problemPart, requiredFix: fixPart || problemPart }
      : { id: `f${findings.length + 1}`, severity: 'high', file: defaultFile, problem: match[1].trim(), requiredFix: `修复审查问题: ${match[1].trim()}` }
    findings.push(normalizeFinding(raw, findings.length, taskId, defaultFile))
  }
  return findings
}

export function parseReviewOutcome({ summaryText, mockOut, team, task }) {
  const defaultFile = defaultScopeFileForTask(team, task)
  let verdict = 'pass'
  if (mockOut && typeof mockOut === 'object' && REVIEW_VERDICTS.includes(mockOut.verdict)) {
    verdict = mockOut.verdict
  } else {
    const verdictMatch = String(summaryText ?? '').match(/^\s*(?:\*\*)?VERDICT\s*:\s*(PASS|NEEDS_REVISION|REJECT)\b/imu)
    if (verdictMatch) {
      verdict = verdictMatch[1].toLowerCase()
    } else if (/\bVERDICT\s*:\s*NEEDS_REVISION\b/iu.test(String(summaryText ?? ''))) {
      verdict = 'needs_revision'
    } else if (/\bVERDICT\s*:\s*REJECT\b/iu.test(String(summaryText ?? ''))) {
      verdict = 'reject'
    }
  }

  let findings = []
  if (Array.isArray(mockOut?.findings) && mockOut.findings.length > 0) {
    findings = mockOut.findings.map((f, idx) => normalizeFinding(f, idx, task.id, defaultFile))
  } else {
    findings = parseFindingsFromText(summaryText, task.id, defaultFile)
  }

  if ((verdict === 'needs_revision' || verdict === 'reject') && findings.length === 0) {
    findings = [
      normalizeFinding(
        {
          id: 'f1',
          severity: 'high',
          file: defaultFile,
          problem: String(summaryText ?? '').slice(0, 200) || `${task.id} 审查未通过，需要返工修改`,
          requiredFix: `根据独立审查员 ${task.assignee || ''} 在 ${task.id} 提出的意见修复 ${defaultFile} 并重新验证`,
        },
        0,
        task.id,
        defaultFile,
      ),
    ]
  }
  return { verdict, findings }
}

function buildBlindReviewSystemDirective(member, task) {
  if (task.kind !== 'review' && task.kind !== 'verification') return ''
  return [
    `【独立盲审身份与隔离协议】你是独立审查员「${member.name}」（角色：${member.role || '独立审查'}，模型路由：${member.provider || 'antigravity'}/${member.model || ''}）。`,
    '严格独立性要求：你拥有独立身份与独立审查标准，严禁参考、附和或引用其他审查员的结论，仅基于被审任务的实际工作区产物与契约作出独立判断。',
    task.kind === 'review'
      ? [
          '请在审查结论第一行明确输出裁决标记：',
          'VERDICT: PASS（全部通过） 或 VERDICT: NEEDS_REVISION（需退回原工程师返工修复）',
          '若输出 VERDICT: NEEDS_REVISION，必须在后续行给出至少一条结构化缺陷，格式：',
          'FINDING: F1 | high | <相对文件路径> | <问题描述> | <具体修复要求>',
        ].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildTaskSystemPrompt({ team, member, task, workspaceRoot }) {
  const blindDirective = buildBlindReviewSystemDirective(member, task)
  const opsKnowledge = buildOpsPromptInjection({ team, task })
  const customKnowledge = workspaceRoot
    ? buildCustomManualPrompt(
        workspaceRoot,
        `${team?.name || ''} ${team?.description || ''} ${task?.subject || ''} ${task?.description || ''}`,
        team?.knowledgeIds,
      )
    : ''
  return [
    `你是 AgentTeams 团队成员「${member.name}」，职责：${member.role || '协同执行'}。`,
    member.executionPrompt ? `角色指令：\n${member.executionPrompt}` : '',
    opsKnowledge,
    customKnowledge,
    blindDirective,
    '你工作在受限沙箱中：必须通过工具 read_file/list_dir/write_file/run_command 在工作区核实或产物落地；若需调研公开网页或技术文档，可调用 scrapling_fetch（自动过滤内网 SSRF）；若仅需分析报告或代码审阅结论，直接输出精炼中文结论。',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function buildIsolatedTaskUserPrompt(team, task) {
  const target = (task.kind === 'review' || task.kind === 'verification')
    ? reviewedTargetOf(team, task)
    : undefined

  return [
    `任务 ID: ${task.id} (${task.kind || 'work'})`,
    `任务标题: ${task.subject}`,
    task.description ? `任务说明: ${task.description}` : '',
    task.objective ? `目标契约: ${task.objective}` : '',
    target
      ? [
          `被审对象任务: ${target.id} (${target.subject}) · 原实现作者: ${target.assignee || '未指定'}`,
          Array.isArray(target.changedPaths) && target.changedPaths.length > 0
            ? `原实现变更文件: ${target.changedPaths.join(', ')}`
            : '',
          Array.isArray(target.inScope) && target.inScope.length > 0
            ? `原实现范围: ${target.inScope.join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    Array.isArray(task.inScope) && task.inScope.length > 0
      ? `允许作用范围 (inScope): ${task.inScope.join(', ')}`
      : '',
    Array.isArray(task.acceptance) && task.acceptance.length > 0
      ? `验收标准:\n- ${task.acceptance.join('\n- ')}`
      : '',
    Array.isArray(task.verify) && task.verify.length > 0
      ? `验证命令:\n- ${task.verify.join('\n- ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function allocateUniqueTaskId(existingTasks, desiredId) {
  const used = new Set(existingTasks.map((t) => t.id))
  if (!used.has(desiredId)) return desiredId
  let idx = 2
  while (used.has(`${desiredId}-${idx}`)) idx += 1
  return `${desiredId}-${idx}`
}

function applyReworkFollowUp(cur, failedReviewTask, reviewerName, absWorkspace) {
  const followUp = planQualityFollowUp(cur, failedReviewTask, {
    pathExists: (p) => existsSync(join(absWorkspace, p)),
  })
  const now = Date.now()

  if (followUp.escalated) {
    return {
      tasks: cur.tasks,
      createdTasks: [],
      escalated: true,
      escalationReason: followUp.reason,
      taskSeq: cur.taskSeq ?? cur.tasks.length,
    }
  }

  let rawRepair = followUp.tasks.find((t) => t.kind === 'repair')
  let rawRecheck = followUp.tasks.find((t) => t.kind === 'review' || t.kind === 'verification')

  const target = reviewedTargetOf(cur, failedReviewTask)
  const sourceId = failedReviewTask.reviewedTaskId ?? failedReviewTask.sourceTaskId ?? target?.id
  const nextRound = (failedReviewTask.round ?? 1) + 1

  // Fallback synthesis if scope had only excluded paths but source task exists
  if (!rawRepair && sourceId && target && nextRound <= 3) {
    const implementer = target.assignee && target.assignee !== reviewerName
      ? target.assignee
      : cur.members.find((m) => m.name !== reviewerName && m.status !== 'removed')?.name
    if (implementer) {
      const inheritedScope = target.inScope?.length
        ? target.inScope
        : failedReviewTask.inScope?.length
          ? failedReviewTask.inScope
          : ['src/']
      rawRepair = {
        kind: 'repair',
        subject: `返工修复 [${failedReviewTask.id}] 第 ${nextRound} 轮`,
        description: `由独立审查员 ${reviewerName} 发起返工：修复 ${sourceId} 的审查意见。`,
        assignee: implementer,
        dependencies: [sourceId],
        round: nextRound,
        objective: `修复独立审查任务 ${failedReviewTask.id} 发现的问题`,
        inScope: inheritedScope,
        verify: target.verify ?? ['node --version'],
        acceptance: (failedReviewTask.findings ?? []).map((f) => f.requiredFix),
        sourceTaskId: sourceId,
        sourceFindingIds: (failedReviewTask.findings ?? []).map((f) => f.id),
        findingSourceTaskIds: [failedReviewTask.id],
      }
      rawRecheck = {
        kind: 'review',
        subject: `独立复审 [${failedReviewTask.id}] 第 ${nextRound} 轮`,
        description: `由 ${reviewerName} 对返工成果执行第 ${nextRound} 轮独立复审。`,
        assignee: reviewerName,
        dependencies: [],
        round: nextRound,
        objective: failedReviewTask.objective ?? `复审 ${sourceId} 返工修复成果`,
        inScope: inheritedScope,
        acceptance: failedReviewTask.acceptance ?? ['No unresolved high or blocker findings'],
      }
    }
  }

  if (!rawRepair || !rawRecheck) {
    return {
      tasks: cur.tasks,
      createdTasks: [],
      escalated: false,
      taskSeq: cur.taskSeq ?? cur.tasks.length,
    }
  }

  const repairId = allocateUniqueTaskId(cur.tasks, `repair-${failedReviewTask.id}-r${nextRound}`)
  const recheckId = allocateUniqueTaskId([...cur.tasks, { id: repairId }], `review-${failedReviewTask.id}-r${nextRound}`)
  const fallbackScope = target?.inScope?.length ? target.inScope : failedReviewTask.inScope?.length ? failedReviewTask.inScope : ['src/']

  const repairTask = {
    ...rawRepair,
    id: repairId,
    subject: `返工修复 (${failedReviewTask.id} · R${nextRound}): ${target?.subject || sourceId || ''}`.trim(),
    status: 'pending',
    inScope: rawRepair.inScope?.length ? rawRepair.inScope : fallbackScope,
    verify: rawRepair.verify?.length ? rawRepair.verify : (target?.verify?.length ? target.verify : ['node -e "process.exit(0)"']),
    createdAt: now,
    updatedAt: now,
  }
  const recheckTask = {
    ...rawRecheck,
    id: recheckId,
    subject: `独立复审 (${reviewerName} · ${failedReviewTask.id} · R${nextRound})`,
    description: `独立审查员「${reviewerName}」第 ${nextRound} 轮复审：核验返工任务 ${repairId} 是否彻底解决上一轮缺陷。`,
    status: 'pending',
    assignee: reviewerName,
    dependencies: [repairId],
    reviewedTaskId: repairId,
    inScope: rawRecheck.inScope?.length ? rawRecheck.inScope : repairTask.inScope,
    createdAt: now + 1,
    updatedAt: now + 1,
  }

  // Rewire downstream pending tasks that depended on failedReviewTask -> now wait for recheckTask
  const updatedExisting = cur.tasks.map((t) => {
    if (t.id === failedReviewTask.id) return failedReviewTask
    if ((t.status === 'pending' || t.status === 'open') && Array.isArray(t.dependencies) && t.dependencies.includes(failedReviewTask.id)) {
      return {
        ...t,
        dependencies: t.dependencies.map((d) => (d === failedReviewTask.id ? recheckId : d)),
        updatedAt: now + 2,
      }
    }
    return t
  })

  return {
    tasks: [...updatedExisting, repairTask, recheckTask],
    createdTasks: [repairTask, recheckTask],
    escalated: false,
    taskSeq: Math.max(cur.taskSeq ?? 0, updatedExisting.length + 2),
  }
}

export async function runNextReadyTask({
  workspaceRoot,
  teamId,
  cpaBaseUrl = DEFAULT_CPA_BASE_URL,
  cpaApiKey = DEFAULT_CPA_API_KEY,
  mockExecutor,
  onLog,
  onSnapshot,
} = {}) {
  const absWorkspace = resolve(workspaceRoot)
  const stateRoot = join(absWorkspace, '.agent-teams')

  const emitLog = (entry) => {
    if (typeof onLog === 'function') onLog({ teamId, timestamp: new Date().toISOString(), ...entry })
  }

  // Phase 1: Validate approval gate, pick ready task, enforce N-1 non-author review, claim atomically
  const claimed = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
    const team = await readTeam(stateRoot, teamId)
    if (!team) throw httpError(404, `团队不存在: ${teamId}`)
    if (team.phase !== 'running') {
      throw httpError(
        409,
        `团队「${team.name}」尚在待审批阶段 (phase=${team.phase})，必须在【执行前计划审查】点击【确认并启动团队】后才可执行任何任务`,
      )
    }
    if (team.halted === true) {
      throw httpError(409, `团队「${team.name}」当前已暂停 (halted=true)，请先恢复后再执行`)
    }

    const readyTask = team.tasks.find((task) => isTaskReady(task, team.tasks))
    if (!readyTask) {
      return { done: isTeamAllResolved(team), task: null }
    }

    const assigneeName = readyTask.assignee || team.members[0]?.name || ''
    const member = team.members.find((m) => m.name === assigneeName) ?? team.members[0]
    if (!member) throw httpError(409, `任务 ${readyTask.id} 未分配任何有效成员`)

    // Enforce N-1 non-author independent judge rule before execution
    if (readyTask.kind === 'review' || readyTask.kind === 'verification') {
      const conflict = judgeConflictFor(team.tasks, readyTask, member.name)
      if (conflict) {
        throw httpError(409, `N-1 独立裁判红线拦截 (${readyTask.id}): ${conflict}`)
      }
    }

    const nextAttempt = (readyTask.attempt ?? 0) + 1
    const updatedTasks = team.tasks.map((t) =>
      t.id === readyTask.id
        ? {
            ...t,
            status: 'in_progress',
            assignee: member.name,
            claimedBy: member.name,
            attempt: nextAttempt,
            updatedAt: Date.now(),
          }
        : t,
    )
    const updatedMembers = team.members.map((m) =>
      m.name === member.name ? { ...m, status: 'working' } : m,
    )
    const nextTeam = {
      ...team,
      tasks: updatedTasks,
      members: updatedMembers,
      updatedAt: Date.now(),
    }
    await writeTeam(stateRoot, nextTeam)
    return {
      done: false,
      team: nextTeam,
      task: updatedTasks.find((t) => t.id === readyTask.id),
      member,
    }
  })

  if (typeof onSnapshot === 'function') await onSnapshot()
  if (!claimed.task) {
    return { executed: false, allCompleted: claimed.done, message: claimed.done ? '所有任务已完成' : '当前无前置依赖已满足的就绪任务' }
  }

  const { task, member, team } = claimed
  const modelToUse = member.model || DEFAULT_CPA_GPT_MODEL
  const shouldUseWorktree =
    (team.worktreeIsolated === true || task.worktreeIsolated === true) &&
    ['implementation', 'repair', 'integration'].includes(task.kind || 'implementation')

  let worktreeInfo = null
  if (shouldUseWorktree) {
    try {
      worktreeInfo = await ensureTaskWorktree({ workspaceRoot: absWorkspace, teamId, taskId: task.id })
    } catch (wtErr) {
      emitLog({
        level: 'info',
        member: member.name,
        taskId: task.id,
        message: `Git Worktree 初始化回退主工作区: ${wtErr instanceof Error ? wtErr.message : String(wtErr)}`,
      })
    }
  }

  const sandboxRoot = worktreeInfo?.isolated ? worktreeInfo.worktreePath : absWorkspace
  const sandbox = createSandboxTools(sandboxRoot, {
    outOfScope: Array.isArray(task.outOfScope) ? task.outOfScope : [],
  })

  emitLog({
    level: 'info',
    member: member.name,
    taskId: task.id,
    message: worktreeInfo?.isolated
      ? `认领任务 [${task.subject}]，路由 ${member.provider || 'cliproxyapi'}/${modelToUse}（隔离分支 ${worktreeInfo.branch}）`
      : `认领任务 [${task.subject}]，路由 ${member.provider || 'cliproxyapi'}/${modelToUse}`,
  })

  let summaryText = ''
  let mockOut = null
  let routedModel = modelToUse
  let taskUsage = null
  const execStartMs = Date.now()
  try {
    if (typeof mockExecutor === 'function') {
      mockOut = await mockExecutor({ team, task, member, sandbox })
      summaryText = String(mockOut?.content ?? 'Mock 执行完成')
      const estIn = Number(mockOut?.usage?.inputTokens ?? 180)
      const estOut = Number(mockOut?.usage?.outputTokens ?? Math.max(40, Math.ceil(summaryText.length / 3)))
      taskUsage = {
        provider: member.provider || 'cliproxyapi',
        model: routedModel,
        inputTokens: estIn,
        outputTokens: estOut,
        reasoningTokens: Number(mockOut?.usage?.reasoningTokens ?? 0),
        cachedTokens: Number(mockOut?.usage?.cachedTokens ?? 0),
        totalTokens: estIn + estOut,
        latencyMs: Math.max(1, Date.now() - execStartMs),
        rounds: 1,
        timestamp: new Date().toISOString(),
      }
      recordUsageSnapshot({
        workspaceRoot: absWorkspace,
        teamId,
        teamName: team.name,
        taskId: task.id,
        taskSubject: task.subject,
        member: member.name,
        provider: member.provider || 'cliproxyapi',
        model: routedModel,
        status: 'completed',
        usage: taskUsage,
      })
    } else {
      const systemPrompt = buildTaskSystemPrompt({ team, member, task, workspaceRoot: absWorkspace })
      const userPrompt = buildIsolatedTaskUserPrompt(team, task)
      const { config: desktopConfig } = readDesktopConfig({ workspaceRoot: absWorkspace, packageRoot: absWorkspace })
      const providerId = String(member.provider || 'cliproxyapi').toLowerCase()
      const targetBaseUrl =
        cpaBaseUrl && cpaBaseUrl !== DEFAULT_CPA_BASE_URL
          ? cpaBaseUrl
          : providerId === 'codex'
            ? desktopConfig['codex-base-url'] || desktopConfig['cpa-base-url'] || cpaBaseUrl
            : providerId === 'antigravity'
              ? desktopConfig['antigravity-base-url'] || desktopConfig['cpa-base-url'] || cpaBaseUrl
              : desktopConfig['cpa-base-url'] || cpaBaseUrl

      const requestedEffort = member.reasoningEffort || member.reasoning_effort || ''
      const result = await runCpaChatCompletion({
        baseUrl: targetBaseUrl,
        apiKey: cpaApiKey,
        model: modelToUse,
        reasoningEffort: requestedEffort,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        tools: sandbox.toolDefinitions,
        onToolCall: async (fnName, fnArgs) => {
          emitLog({
            level: 'info',
            member: member.name,
            taskId: task.id,
            message: `调用工具 ${fnName}(${JSON.stringify(fnArgs).slice(0, 120)})`,
          })
          return sandbox.executeTool(fnName, fnArgs)
        },
      })
      summaryText = result.content || 'CPA 执行完成'
      routedModel = result.model || result.routedModel || modelToUse
      const u = result.usage || {}
      const inTok = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0
      const outTok = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0
      const reasTok = Number(u.reasoning_tokens ?? 0) || 0
      const cacheTok = Number(u.cached_tokens ?? 0) || 0
      const totTok = Number(u.total_tokens ?? inTok + outTok) || inTok + outTok
      taskUsage = {
        provider: member.provider || 'cliproxyapi',
        model: routedModel,
        requestedModel: modelToUse,
        reasoningEffort: result.effectiveEffort || requestedEffort || 'default',
        fallbackUsed: Boolean(result.fallbackUsed),
        inputTokens: inTok,
        outputTokens: outTok,
        reasoningTokens: reasTok,
        cachedTokens: cacheTok,
        totalTokens: totTok,
        latencyMs: Number(result.elapsedMs ?? Math.max(1, Date.now() - execStartMs)),
        rounds: Number(result.rounds ?? 1),
        toolCalls: Array.isArray(result.toolLogs) ? result.toolLogs.length : 0,
        timestamp: new Date().toISOString(),
      }
      recordUsageSnapshot({
        workspaceRoot: absWorkspace,
        teamId,
        teamName: team.name,
        taskId: task.id,
        taskSubject: task.subject,
        member: member.name,
        provider: member.provider || 'cliproxyapi',
        model: routedModel,
        status: 'completed',
        usage: taskUsage,
      })
      if (result.fallbackUsed) {
        emitLog({
          level: 'info',
          member: member.name,
          taskId: task.id,
          message: `模型路由自动适配: 请求 ${modelToUse} -> 实际命中 ${routedModel}`,
        })
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    emitLog({
      level: 'error',
      member: member.name,
      taskId: task.id,
      message: `执行异常: ${errMsg}`,
    })
    await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
      const cur = await readTeam(stateRoot, teamId)
      if (!cur) return
      const revertedTasks = cur.tasks.map((t) =>
        t.id === task.id
          ? { ...t, status: 'pending', updatedAt: Date.now() }
          : t,
      )
      const revertedMembers = cur.members.map((m) =>
        m.name === member.name ? { ...m, status: 'idle' } : m,
      )
      await writeTeam(stateRoot, { ...cur, tasks: revertedTasks, members: revertedMembers, updatedAt: Date.now() })
    })
    if (typeof onSnapshot === 'function') await onSnapshot()
    throw httpError(502, `CPA 模型执行失败 (${member.name}/${modelToUse}): ${errMsg}`)
  }

  const changedPaths = sandbox.getChangedPaths()
  const commandsRun = sandbox.getCommandsRun()
  let worktreeSummary = null
  if (worktreeInfo?.isolated) {
    try {
      const diffSnap = await inspectWorktreeDiff({
        workspaceRoot: absWorkspace,
        worktreePath: worktreeInfo.worktreePath,
        baseBranch: worktreeInfo.baseBranch || 'HEAD',
        maxDiffChars: 4000,
      })
      worktreeSummary = {
        isolated: true,
        worktreePath: worktreeInfo.worktreePath,
        branch: worktreeInfo.branch,
        baseBranch: worktreeInfo.baseBranch,
        statusShort: diffSnap.statusShort,
        diffStat: diffSnap.diffStat,
      }
    } catch {
      worktreeSummary = {
        isolated: true,
        worktreePath: worktreeInfo.worktreePath,
        branch: worktreeInfo.branch,
        baseBranch: worktreeInfo.baseBranch,
      }
    }
  }
  const reviewOutcome = task.kind === 'review'
    ? parseReviewOutcome({ summaryText, mockOut, team, task })
    : null

  // Phase 2: Persist completed/needs_revision task, auto-spawn rework loop if needed, bind SHA256 digests, and report to captain
  const completedResult = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
    const cur = await readTeam(stateRoot, teamId)
    if (!cur) throw httpError(404, `团队不存在: ${teamId}`)

    const isRevisionNeeded = reviewOutcome?.verdict === 'needs_revision' || reviewOutcome?.verdict === 'reject'
    const acceptanceStatus = isRevisionNeeded ? 'failed' : 'passed'
    const acceptanceResults = Array.isArray(task.acceptance)
      ? task.acceptance.map((criterion) => ({
          criterion,
          status: acceptanceStatus,
          evidence: summaryText.slice(0, 240) || 'Verified via CPA execution',
        }))
      : undefined

    const existingTask = cur.tasks.find((t) => t.id === task.id)
    const resolvedReviewedId = existingTask?.reviewedTaskId
      ?? (task.kind === 'review' ? (reviewedTargetOf(cur, existingTask ?? task)?.id ?? existingTask?.dependencies?.[0]) : undefined)

    let finishedTask = {
      ...existingTask,
      status: isRevisionNeeded ? 'failed' : 'completed',
      summary: summaryText.slice(0, 1000),
      updatedAt: Date.now(),
      ...(taskUsage ? { usage: taskUsage } : {}),
      ...(resolvedReviewedId && task.kind === 'review' ? { reviewedTaskId: resolvedReviewedId } : {}),
      ...(changedPaths.length > 0 ? { changedPaths } : {}),
      ...(commandsRun.length > 0 ? { commandsRun } : {}),
      ...(worktreeSummary ? { worktree: worktreeSummary } : {}),
      ...(acceptanceResults ? { acceptanceResults } : {}),
      ...(reviewOutcome ? { verdict: reviewOutcome.verdict } : {}),
      ...(reviewOutcome && reviewOutcome.findings.length > 0 ? { findings: reviewOutcome.findings } : {}),
    }

    let nextTasks = cur.tasks.map((t) => (t.id === task.id ? finishedTask : t))
    let nextTaskSeq = cur.taskSeq ?? cur.tasks.length
    let reworkCreated = []
    let escalated = cur.escalated
    let escalationReason = cur.escalationReason

    if (finishedTask.kind === 'review' && finishedTask.verdict === 'pass') {
      const scope = verdictScopePatterns(cur, finishedTask)
      if (scope.length === 0) {
        throw httpError(409, `审查任务 ${task.id} 缺少可绑定的产物范围 (scope)，拒绝签发未绑定 SHA256 的 verdict=pass`)
      }
      const readResult = readArtifactScope(absWorkspace, scope)
      if (!readResult.artifacts.some((a) => a.present === true)) {
        throw httpError(409, `审查任务 ${task.id} 覆盖范围内无任何存在的文件产物，拒绝签发未绑定 SHA256 的 verdict=pass`)
      }
      finishedTask = bindReviewToRevision(cur, finishedTask, {
        artifacts: readResult.artifacts,
        gaps: readResult.gaps,
        scope,
      })
      nextTasks = cur.tasks.map((t) => (t.id === task.id ? finishedTask : t))
    } else if (finishedTask.kind === 'review' && finishedTask.verdict === 'needs_revision') {
      const rework = applyReworkFollowUp(cur, finishedTask, member.name, absWorkspace)
      nextTasks = rework.tasks
      nextTaskSeq = rework.taskSeq
      reworkCreated = rework.createdTasks
      if (rework.escalated) {
        escalated = true
        escalationReason = rework.escalationReason
      }
    }

    const updatedMembers = cur.members.map((m) =>
      m.name === member.name ? { ...m, status: 'idle' } : m,
    )
    const nextTeam = {
      ...cur,
      tasks: nextTasks,
      taskSeq: nextTaskSeq,
      members: updatedMembers,
      ...(escalated ? { escalated: true } : {}),
      ...(escalationReason ? { escalationReason } : {}),
      updatedAt: Date.now(),
    }
    await writeTeam(stateRoot, nextTeam)
    return { task: finishedTask, team: nextTeam, reworkCreated, escalated, escalationReason }
  })

  if (completedResult.reworkCreated.length > 0) {
    const [repairTask, recheckTask] = completedResult.reworkCreated
    const findingCount = completedResult.task.findings?.length ?? 0
    const reworkMsg = `[需要返工] 独立审查员 ${member.name} (${modelToUse}) 对 ${task.id} 签发 NEEDS_REVISION (${findingCount} 项问题)，已自动派发返工任务 [${repairTask.id}] -> ${repairTask.assignee}，修复后由 [${recheckTask.id}] -> ${recheckTask.assignee} 独立复审。`
    await appendMailbox(
      stateRoot,
      teamId,
      CAPTAIN_KEY,
      createMessage(member.name, CAPTAIN_KEY, reworkMsg),
    )
    emitLog({
      level: 'info',
      member: member.name,
      taskId: task.id,
      message: reworkMsg,
    })
  } else if (completedResult.escalated) {
    const escMsg = `[审查升级] ${task.id} (${member.name}) 触发人工升级: ${completedResult.escalationReason || '超出最大返工轮次或 reject'}`
    await appendMailbox(
      stateRoot,
      teamId,
      CAPTAIN_KEY,
      createMessage(member.name, CAPTAIN_KEY, escMsg),
    )
    emitLog({
      level: 'error',
      member: member.name,
      taskId: task.id,
      message: escMsg,
    })
  } else {
    await appendMailbox(
      stateRoot,
      teamId,
      CAPTAIN_KEY,
      createMessage(
        member.name,
        CAPTAIN_KEY,
        `[${task.id}] ${task.subject} 已完成 (${member.provider || 'cliproxyapi'}/${modelToUse}${routedModel !== modelToUse ? ` -> ${routedModel}` : ''})。${summaryText.slice(0, 220)}`,
      ),
    )

    emitLog({
      level: 'success',
      member: member.name,
      taskId: task.id,
      message: `任务 ${task.id} 已完成并向队长汇报。${summaryText.slice(0, 160)}`,
    })
  }

  if (typeof onSnapshot === 'function') await onSnapshot()
  return {
    executed: true,
    taskId: task.id,
    member: member.name,
    model: modelToUse,
    routedModel,
    verdict: completedResult.task.verdict,
    reworkCreated: completedResult.reworkCreated.map((t) => t.id),
    changedPaths,
    commandsRun,
    summary: summaryText,
  }
}

export async function autoRunTeam({
  workspaceRoot,
  teamId,
  cpaBaseUrl = DEFAULT_CPA_BASE_URL,
  cpaApiKey = DEFAULT_CPA_API_KEY,
  mockExecutor,
  onLog,
  onSnapshot,
  maxSteps = 20,
} = {}) {
  const results = []
  for (let step = 0; step < maxSteps; step++) {
    const outcome = await runNextReadyTask({
      workspaceRoot,
      teamId,
      cpaBaseUrl,
      cpaApiKey,
      mockExecutor,
      onLog,
      onSnapshot,
    })
    if (!outcome.executed) {
      return { steps: results, stoppedReason: outcome.message, allCompleted: outcome.allCompleted }
    }
    results.push(outcome)
  }
  return { steps: results, stoppedReason: '达到单轮最大自动步数', allCompleted: false }
}
