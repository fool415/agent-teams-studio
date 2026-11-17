// channels/qqbot/qq-remote-service.mjs
// Node.js 24 ESM — QQ 远程控制核心调度服务（指令路由 + 单兵沙箱执行 + 多智能体团队编排）

import { existsSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { resolveSafeWorkspacePath } from '../../server/sandbox.mjs'
import { normalizeReasoningEffort } from '../../server/cpa-client.mjs'
import { QQGateway, splitReplyText } from './qq-gateway.mjs'

const MAX_SENDFILE_BYTES = 20 * 1024 * 1024
const TEAM_PRESETS = new Set([
  'chatgpt-crew',
  'studio-default',
  'heterogeneous-cross-review',
  'ai-radar-squad',
  'video-studio',
  'novixlink-ops',
])

const MODEL_SHORT_ALIASES = new Map([
  ['sol', 'gpt-6.1-sol'],
  ['gpt', 'gpt-6.1-sol'],
  ['astra', 'gpt-6-astra'],
  ['terra', 'gpt-6.1-terra'],
  ['luna', 'gpt-6-luna'],
  ['hydrogen', 'gemini-4-hydrogen-xhigh'],
  ['argon', 'gemini-4-argon-high'],
  ['flash', 'gemini-3.8-flash-tiered'],
  ['hajimi', 'gemini-3.8-flash-tiered'],
  ['opus', 'claude-opus-4-6-thinking'],
  ['sonnet', 'claude-sonnet-5-5-high'],
])

const EFFORT_LABELS = new Map([
  ['off', '关闭思考 (off)'],
  ['low', '轻度思考 (low)'],
  ['medium', '均衡思考 (medium)'],
  ['high', '深度思考 (high)'],
  ['xhigh', '极致思考 (xhigh)'],
  ['default', '模型默认 (default)'],
])

const REPLY_DETAIL_ALIASES = new Map([
  ['concise', 'concise'],
  ['brief', 'concise'],
  ['short', 'concise'],
  ['clean', 'concise'],
  ['simple', 'concise'],
  ['off', 'concise'],
  ['false', 'concise'],
  ['简洁', 'concise'],
  ['精简', 'concise'],
  ['简略', 'concise'],
  ['纯内容', 'concise'],
  ['只看回答', 'concise'],
  ['关闭', 'concise'],
  ['verbose', 'verbose'],
  ['detail', 'verbose'],
  ['detailed', 'verbose'],
  ['full', 'verbose'],
  ['on', 'verbose'],
  ['true', 'verbose'],
  ['详细', 'verbose'],
  ['详情', 'verbose'],
  ['完整', 'verbose'],
  ['开启', 'verbose'],
])

export function normalizeReplyDetail(raw) {
  if (raw === undefined || raw === null) return null
  const key = String(raw).trim().toLowerCase()
  return REPLY_DETAIL_ALIASES.get(key) ?? null
}

function formatReplyDetail(detail) {
  return detail === 'concise' ? '简洁模式 (仅显示回答内容)' : '详细模式 (含接单/模型/Token/耗时)'
}

function isSensitiveSendfilePath(absPath, relPosix) {
  const normalizedRel = String(relPosix || '').replace(/\\/gu, '/').toLowerCase()
  const segments = normalizedRel.split('/').filter(Boolean)
  if (segments.some((seg) => seg === '.git' || seg === '.agent-teams' || seg === 'secrets' || seg === 'node_modules')) {
    return true
  }
  const fileBase = basename(absPath).toLowerCase()
  return (
    fileBase === '.env' ||
    fileBase.startsWith('.env.') ||
    fileBase === 'secrets.json' ||
    fileBase.endsWith('.pem') ||
    fileBase.endsWith('.key')
  )
}

function formatEffort(effort) {
  const key = String(effort || 'default').toLowerCase()
  return EFFORT_LABELS.get(key) || key
}

function sessionKeyFor(inbound) {
  const actor = inbound.senderId || 'anonymous'
  const target = inbound.replyTarget?.targetId || inbound.groupOpenid || actor
  return `${inbound.kind}:${target}:${actor}`
}

function shortTaskId(id) {
  return String(id || '').slice(0, 8)
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatUsageLine(usage) {
  if (!usage || typeof usage !== 'object') return ''
  const inTok = Number(usage.prompt_tokens ?? usage.inputTokens ?? 0) || 0
  const outTok = Number(usage.completion_tokens ?? usage.outputTokens ?? 0) || 0
  const reasTok = Number(usage.reasoning_tokens ?? usage.reasoningTokens ?? 0) || 0
  const totTok = Number(usage.total_tokens ?? usage.totalTokens ?? inTok + outTok) || (inTok + outTok)
  return `Token: 总 ${totTok} (输入 ${inTok} / 输出 ${outTok}${reasTok > 0 ? ` / 思考 ${reasTok}` : ''})`
}

function buildDirectSystemPrompt({ cwd, model, effort }) {
  return [
    '你是通过 QQ 远程控制界面与主人协同工作的 AgentTeams Studio 智能工程师。',
    `当前工作目录：${cwd}`,
    `当前执行配置：模型=${model}，思考程度=${effort || 'default'}。`,
    '工作准则：',
    '1. 所有关于当前目录、代码与命令结果的结论必须通过沙箱工具 (list_dir/read_file/write_file/run_command/scrapling_fetch) 实测核实，严禁编造或猜测未查看的文件/命令输出。',
    '2. 在需要改动代码或脚本时，使用 write_file 落盘并通过 run_command 验证测试/语法后再汇报。',
    '3. 回复面向手机 QQ 阅读，保持条理清晰、精炼准确，优先给出结论、关键改动文件与验证结果。',
    '4. 绝不输出任何本机密钥、Token 或 AppSecret。',
  ].join('\n')
}

export function extractInlineTaskOverrides(rawText, knownModels = []) {
  let text = String(rawText || '').trim()
  let mode = null
  let teamPreset = null
  let effort = null
  let model = null
  let autoApprove = false

  const modelIds = new Set(knownModels.map((m) => String(m.id).toLowerCase()))

  // 支持句首快捷标签：@team @direct @chatgpt-crew @xhigh @hydrogen --auto
  const tokens = text.split(/\s+/u)
  const kept = []
  let scanningPrefix = true

  for (const tok of tokens) {
    if (!scanningPrefix) {
      kept.push(tok)
      continue
    }
    const lower = tok.toLowerCase()
    if (lower === '--auto') {
      autoApprove = true
      continue
    }
    if (lower.startsWith('@')) {
      const bare = lower.slice(1)
      if (bare === 'direct' || bare === '单兵') {
        mode = 'direct'
        continue
      }
      if (bare === 'team' || bare === '团队') {
        mode = 'team'
        continue
      }
      if (TEAM_PRESETS.has(bare)) {
        mode = 'team'
        teamPreset = bare
        continue
      }
      const parsedEffort = normalizeReasoningEffort(bare)
      if (parsedEffort !== null && parsedEffort !== '') {
        effort = parsedEffort
        continue
      }
      const aliasTarget = MODEL_SHORT_ALIASES.get(bare)
      if (aliasTarget && modelIds.has(aliasTarget.toLowerCase())) {
        model = knownModels.find((m) => String(m.id).toLowerCase() === aliasTarget.toLowerCase())?.id || aliasTarget
        continue
      }
      if (modelIds.has(bare)) {
        model = knownModels.find((m) => String(m.id).toLowerCase() === bare)?.id || bare
        continue
      }
      if (aliasTarget) {
        model = aliasTarget
        continue
      }
    }
    scanningPrefix = false
    kept.push(tok)
  }

  return {
    mode,
    teamPreset,
    effort,
    model,
    autoApprove,
    prompt: kept.join(' ').trim(),
  }
}

export function matchModelChoice(query, models = []) {
  const q = String(query || '').trim()
  if (!q) return null

  if (/^\d+$/u.test(q)) {
    const idx = Number(q) - 1
    if (idx >= 0 && idx < models.length) return models[idx]
    return null
  }

  const lower = q.toLowerCase()
  const alias = MODEL_SHORT_ALIASES.get(lower)
  if (alias) {
    const aliased = models.find((m) => String(m.id).toLowerCase() === alias.toLowerCase())
    if (aliased) return aliased
  }

  const exact = models.find((m) => String(m.id).toLowerCase() === lower)
  if (exact) return exact

  if (alias) {
    return { id: alias, name: alias, provider: 'cliproxyapi' }
  }

  const prefix = models.find((m) => String(m.id).toLowerCase().startsWith(lower))
  if (prefix) return prefix

  const substringMatches = models.filter(
    (m) =>
      String(m.id).toLowerCase().includes(lower) ||
      String(m.name || '').toLowerCase().includes(lower),
  )
  return substringMatches[0] || null
}

export function createQQRemoteService({
  store,
  studioBridge,
  workspaceRoot,
  gatewayFactory = (opts) => new QQGateway(opts),
  onLog,
  onStatusChange,
  onTaskUpdate,
} = {}) {
  if (!store) throw new Error('QQRemoteService 缺少 store 实例')
  if (!studioBridge) throw new Error('QQRemoteService 缺少 studioBridge')

  const defaultRoot = resolve(workspaceRoot || process.cwd())
  let gateway = null
  let cachedModels = []
  let connectInFlight = null
  const sessionQueues = new Map()
  const sessionEpochs = new Map()
  const sessionModelMenus = new Map() // sessionKey -> { models, awaitingPick, createdAt }
  const approvingTeams = new Set()
  const activeDirectRuns = new Map() // taskId -> { abortController, sessionKey, startedAt }
  const activeTeamMonitors = new Map() // teamId -> { taskId, sessionKey, replyTarget, aborted }

  const log = (level, message, extra = {}) => {
    if (typeof onLog === 'function') {
      onLog({
        channel: 'qqbot',
        level,
        timestamp: new Date().toISOString(),
        message,
        ...extra,
      })
    }
  }

  const ensureWorkspaceDefaults = () => {
    const cfg = store.getPublicConfig()
    const patch = {}
    if (!cfg.defaultWorkspace) patch.defaultWorkspace = defaultRoot
    if (!Array.isArray(cfg.allowedWorkspaces) || cfg.allowedWorkspaces.length === 0) {
      patch.allowedWorkspaces = [defaultRoot]
    }
    if (Object.keys(patch).length > 0) {
      store.updateConfig(patch)
    }
  }

  ensureWorkspaceDefaults()

  const emitStatus = () => {
    if (typeof onStatusChange === 'function') {
      onStatusChange(getStatus())
    }
  }

  const getStatus = () => {
    const config = store.getPublicConfig()
    const pairing = store.getActivePairingStatus()
    const gw = gateway ? gateway.getStatus() : {
      state: 'offline',
      appId: config.appId || '',
      botUser: null,
      sessionId: null,
      lastConnectedAt: null,
      lastError: null,
      reconnectAttempt: 0,
    }
    return {
      ok: true,
      config,
      pairing,
      gateway: gw,
      activeDirectCount: activeDirectRuns.size,
      activeTeamCount: activeTeamMonitors.size,
      recentTasks: store.listTasks({ limit: 20 }),
    }
  }

  const refreshModelsCache = async () => {
    try {
      const res = await studioBridge.listModels()
      if (Array.isArray(res?.models) && res.models.length > 0) {
        cachedModels = res.models
      }
      return { cpaOnline: Boolean(res?.cpaOnline), models: cachedModels }
    } catch {
      return { cpaOnline: false, models: cachedModels }
    }
  }

  const sendChunkedReply = async (replyTarget, text, { taskId = null } = {}) => {
    const cfg = store.getPublicConfig()
    const chunks = splitReplyText(String(text || '').trim() || '（空响应）', 1600)
    const activeGw = gateway
    if (!activeGw) {
      if (taskId) store.updateTask(taskId, { undelivered: true })
      return { delivered: false, chunks: 0, reason: 'gateway_offline' }
    }

    try {
      for (let i = 0; i < chunks.length; i++) {
        const prefix = chunks.length > 1 ? `[${i + 1}/${chunks.length}]\n` : ''
        await activeGw.sendText(replyTarget, `${prefix}${chunks[i]}`, {
          msgId: replyTarget?.msgId || undefined,
          markdownSupport: Boolean(cfg.markdownSupport),
        })
      }
      return { delivered: true, chunks: chunks.length }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log('error', `QQ 消息发送失败: ${msg}`)
      if (taskId) store.updateTask(taskId, { undelivered: true })
      return { delivered: false, chunks: 0, reason: msg }
    }
  }

  const ensureSessionForInbound = (inbound) => {
    const key = sessionKeyFor(inbound)
    const existing = store.getSession(key)
    const cfg = store.getPublicConfig()
    if (existing) {
      if (!existing.cwd && cfg.defaultWorkspace) {
        return store.updateSession(key, { cwd: cfg.defaultWorkspace })
      }
      return existing
    }
    return store.updateSession(key, {
      scope: inbound.kind,
      targetId: String(inbound.replyTarget?.targetId || inbound.senderId || ''),
      actorId: String(inbound.senderId || ''),
      cwd: cfg.defaultWorkspace || defaultRoot,
    })
  }

  const resolveSessionCwd = (session) => {
    const cfg = store.getPublicConfig()
    try {
      return store.resolveAllowedCwd(session?.cwd || null, cfg.defaultWorkspace || defaultRoot)
    } catch {
      return store.resolveAllowedCwd(null, cfg.defaultWorkspace || defaultRoot)
    }
  }

  const resolveSessionReplyDetail = (session) => {
    const cfg = store.getPublicConfig()
    return normalizeReplyDetail(session?.replyDetail) || normalizeReplyDetail(cfg.defaultReplyDetail) || 'verbose'
  }

  const deliverUndeliveredResults = async (sessionKey, replyTarget, session) => {
    const pending = store.listUndelivered(sessionKey)
    if (pending.length === 0) return
    const concise = resolveSessionReplyDetail(session) === 'concise'
    const deliveredIds = []
    for (const t of pending) {
      const header = t.status === 'completed' ? '📬 补发已完成任务结果' : '📬 补发任务状态更新'
      const body = concise && t.status === 'completed' && t.summary
        ? t.summary
        : [
            `${header} #${shortTaskId(t.id)}`,
            `模型: ${t.model} | 思考: ${formatEffort(t.effort)}`,
            t.summary || t.error || `状态: ${t.status}`,
          ].join('\n')
      const res = await sendChunkedReply(replyTarget, body)
      if (res.delivered) deliveredIds.push(t.id)
    }
    if (deliveredIds.length > 0) {
      store.markDelivered(deliveredIds)
    }
  }

  const buildHelpText = (session, cwd) => {
    const replyDetail = resolveSessionReplyDetail(session)
    return [
      '🐾 AgentTeams Studio · QQ 远程控制中心',
      '',
      `当前会话配置：`,
      `- 模式：${session.mode === 'team' ? `多智能体团队 (${session.teamPreset})` : '单兵直达 (direct)'}`,
      `- 模型：${session.model}`,
      `- 思考：${formatEffort(session.effort)}`,
      `- 回复：${formatReplyDetail(replyDetail)}`,
      `- 目录：${cwd}`,
      session.pendingTeamId ? `- 待审批团队：${session.pendingTeamId}（发送 /approve 确认启动）` : '',
      '',
      '常用控制指令：',
      '/model — 列出全部可用模型并可回复数字序号直接切换（也支持 /model <序号/名称>）',
      '/models [关键词] — 按关键词筛选模型并编号选择',
      '/think <off|low|medium|high|xhigh> — 调整思考程度',
      '/detail <concise|verbose> — 切换简洁模式（仅看回答）或详细模式（也支持 /简洁 /详细）',
      '/mode <direct|team> [预设] — 切换单兵或团队模式',
      '/cwd [路径] — 查看或切换授权工作目录',
      '/direct <需求> — 强制单兵直达执行需求',
      '/team [预设] [--auto] <需求> — 布置多智能体团队任务',
      '/approve [teamId] · /reject [teamId] — 审批或取消待启动团队',
      '/status — 查看运行中与最近任务进度',
      '/cancel — 中止当前任务并终止子进程',
      '/sendfile <相对路径> — 回传工作区文件到 QQ',
      '/new — 清空当前单兵上下文（保留模型/思考/目录）',
      '',
      '💡 直接发送需求文本，即按当前模型与思考程度自动开干！也支持在句首附带 @hydrogen @xhigh @team 等标签临时覆盖。',
    ]
      .filter((line) => line !== '')
      .join('\n')
  }

  const enqueueSessionWork = (sessionKey, runner, onSkipped) => {
    const epoch = sessionEpochs.get(sessionKey) ?? 0
    const prev = sessionQueues.get(sessionKey) ?? Promise.resolve()
    const next = prev
      .catch(() => {})
      .then(() => {
        if ((sessionEpochs.get(sessionKey) ?? 0) !== epoch) {
          return typeof onSkipped === 'function' ? onSkipped() : undefined
        }
        return runner()
      })
      .finally(() => {
        if (sessionQueues.get(sessionKey) === next) {
          sessionQueues.delete(sessionKey)
        }
      })
    sessionQueues.set(sessionKey, next)
    return next
  }

  const runDirectTask = async ({ inbound, session, prompt, model, effort, cwd }) => {
    const task = store.createTask({
      sessionKey: session.sessionKey,
      actorId: String(inbound.senderId || ''),
      scope: inbound.kind,
      targetId: String(inbound.replyTarget?.targetId || ''),
      mode: 'direct',
      model,
      effort,
      cwd,
      prompt,
      status: 'running',
      startedAt: Date.now(),
    })
    onTaskUpdate?.(task)

    const abortController = new AbortController()
    activeDirectRuns.set(task.id, {
      abortController,
      sessionKey: session.sessionKey,
      startedAt: Date.now(),
    })

    const isConcise = resolveSessionReplyDetail(session) === 'concise'

    if (inbound.kind === 'c2c' && gateway) {
      void gateway.sendTyping(inbound.senderId, inbound.messageId, 60)
    }

    if (!isConcise) {
      await sendChunkedReply(
        inbound.replyTarget,
        [
          `⏳ 已接单 #${shortTaskId(task.id)}（单兵直达）`,
          `模型：${model} | 思考：${formatEffort(effort)}`,
          `目录：${cwd}`,
          `需求：${prompt.slice(0, 140)}${prompt.length > 140 ? '…' : ''}`,
        ].join('\n'),
      )
    }

    try {
      const sandbox = studioBridge.createSandbox(cwd, { signal: abortController.signal })
      const historyTurns = Array.isArray(session.history) ? session.history.slice(-12) : []
      const messages = [
        { role: 'system', content: buildDirectSystemPrompt({ cwd, model, effort }) },
        ...historyTurns.map((turn) => ({
          role: turn.role === 'assistant' ? 'assistant' : 'user',
          content: String(turn.content || ''),
        })),
        { role: 'user', content: prompt },
      ]

      const result = await studioBridge.runDirectModel({
        model,
        reasoningEffort: effort,
        messages,
        tools: sandbox.toolDefinitions,
        signal: abortController.signal,
        onToolCall: (fnName, fnArgs) => sandbox.executeTool(fnName, fnArgs),
      })

      if (abortController.signal.aborted) {
        throw new Error('任务已被用户取消')
      }

      const changedPaths = sandbox.getChangedPaths()
      const commandsRun = sandbox.getCommandsRun()
      const finalText = String(result?.content || '任务已执行完成。').trim()
      const effectiveEffort = result?.effectiveEffort || effort || 'default'
      const routedModel = result?.model || result?.routedModel || model

      store.appendHistory(session.sessionKey, [
        { role: 'user', content: prompt },
        { role: 'assistant', content: finalText.slice(0, 4000) },
      ])

      const completed = store.updateTask(task.id, {
        status: 'completed',
        summary: finalText.slice(0, 4000),
        changedPaths,
        usage: {
          ...(result?.usage || {}),
          routedModel,
          effectiveEffort,
          elapsedMs: result?.elapsedMs || 0,
          rounds: result?.rounds || 1,
        },
        finishedAt: Date.now(),
      })
      onTaskUpdate?.(completed)

      const outboundText = isConcise
        ? finalText
        : [
            `✅ 任务完成 #${shortTaskId(task.id)}`,
            `实际模型：${routedModel}${result?.fallbackUsed ? `（由 ${model} 自动适配）` : ''}`,
            `思考档位：${formatEffort(effectiveEffort)}${result?.effortFallbackUsed ? `（请求 ${effort} 已兼容降级）` : ''}`,
            changedPaths.length > 0 ? `变更文件 (${changedPaths.length})：${changedPaths.slice(0, 8).join(', ')}` : '',
            commandsRun.length > 0
              ? `命令验证：${commandsRun.map((c) => `${c.command} (exit=${c.exitCode})`).slice(0, 4).join('；')}`
              : '',
            [formatUsageLine(result?.usage), `耗时 ${formatDuration(result?.elapsedMs)}`].filter(Boolean).join(' · '),
            '──────────',
            finalText,
          ]
            .filter(Boolean)
            .join('\n')

      await sendChunkedReply(inbound.replyTarget, outboundText, { taskId: task.id })
    } catch (err) {
      const cancelled = abortController.signal.aborted || /取消/u.test(String(err?.message || ''))
      const msg = err instanceof Error ? err.message : String(err)
      const updated = store.updateTask(task.id, {
        status: cancelled ? 'cancelled' : 'failed',
        error: msg.slice(0, 1000),
        finishedAt: Date.now(),
      })
      onTaskUpdate?.(updated)
      await sendChunkedReply(
        inbound.replyTarget,
        cancelled
          ? `🛑 任务 #${shortTaskId(task.id)} 已中止。`
          : `❌ 任务 #${shortTaskId(task.id)} 执行失败：\n${msg}`,
        { taskId: task.id },
      )
    } finally {
      activeDirectRuns.delete(task.id)
      emitStatus()
    }
  }

  const formatTeamPreview = (teamId, team, preset, model, effort) => {
    const members = (team?.members || [])
      .map((m) => `- ${m.name} (${m.role}) -> ${m.model} [${formatEffort(m.reasoningEffort || 'default')}]`)
      .join('\n')
    const tasks = (team?.tasks || [])
      .map((t) => `- ${t.id}: ${t.subject}（负责人: ${t.assignee || '待定'}）`)
      .join('\n')
    return [
      `🐉 已生成待审批团队 [${teamId}]`,
      `预设：${preset} | 主模型：${model} | 思考：${formatEffort(effort)}`,
      `目标：${team?.goal || team?.description || ''}`,
      '',
      '👥 团队成员：',
      members || '（无）',
      '',
      '📋 任务计划 (DAG)：',
      tasks || '（无）',
      '',
      `👉 回复 /approve ${teamId} 确认并启动执行，或 /reject ${teamId} 放弃。`,
    ].join('\n')
  }

  const launchTeamApprovalAndMonitor = async ({ inbound, session, teamId, taskRecord }) => {
    const monitorState = {
      taskId: taskRecord.id,
      sessionKey: session.sessionKey,
      replyTarget: inbound.replyTarget,
      aborted: false,
    }
    activeTeamMonitors.set(teamId, monitorState)
    store.updateTask(taskRecord.id, { status: 'running', startedAt: Date.now() })
    onTaskUpdate?.(store.getTask(taskRecord.id))

    const isConcise = resolveSessionReplyDetail(session) === 'concise'
    let lastPushAt = 0
    try {
      const outcome = await studioBridge.approveAndRunTeam({
        teamId,
        onProgress: async (progressText) => {
          if (monitorState.aborted || isConcise) return
          const now = Date.now()
          if (now - lastPushAt < 4000) return
          lastPushAt = now
          await sendChunkedReply(inbound.replyTarget, `📡 [${teamId}] ${progressText}`)
        },
      })

      const teamSnap = await studioBridge.getTeamStatus(teamId).catch(() => null)
      const completedCount = (teamSnap?.tasks || []).filter((t) => t.status === 'completed').length
      const totalCount = (teamSnap?.tasks || []).length
      const summaryLines = [
        `🎉 团队 [${teamId}] 执行阶段结束！`,
        `完成进度：${completedCount}/${totalCount} 项任务`,
        teamSnap?.delivery?.allowed !== undefined
          ? `交付门禁：${teamSnap.delivery.allowed ? '✅ 通过 (delivery.allowed=true)' : '⚠️ 待核查'}`
          : '',
        ...(teamSnap?.tasks || []).slice(0, 8).map(
          (t) => `- ${t.id} [${t.status}] ${t.subject}`,
        ),
        outcome?.message ? `\n结论：${outcome.message}` : '',
      ]
        .filter(Boolean)
        .join('\n')

      const done = store.updateTask(taskRecord.id, {
        status: teamSnap?.halted ? 'cancelled' : 'completed',
        summary: summaryLines.slice(0, 4000),
        finishedAt: Date.now(),
      })
      onTaskUpdate?.(done)
      const replyText = isConcise && outcome?.message
        ? outcome.message
        : isConcise
          ? `团队 [${teamId}] 已完成 (${completedCount}/${totalCount})。`
          : summaryLines
      await sendChunkedReply(inbound.replyTarget, replyText, { taskId: taskRecord.id })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const failed = store.updateTask(taskRecord.id, {
        status: 'failed',
        error: msg.slice(0, 1000),
        finishedAt: Date.now(),
      })
      onTaskUpdate?.(failed)
      await sendChunkedReply(
        inbound.replyTarget,
        `❌ 团队 [${teamId}] 启动或调度失败：\n${msg}`,
        { taskId: taskRecord.id },
      )
    } finally {
      activeTeamMonitors.delete(teamId)
      emitStatus()
    }
  }

  const runTeamTask = async ({
    inbound,
    session,
    prompt,
    preset,
    model,
    effort,
    cwd,
    autoApprove,
  }) => {
    const created = await studioBridge.createAndPreviewTeam({
      preset,
      model,
      effort,
      goal: prompt,
      cwd,
      sessionId: session.sessionKey,
    })

    const teamId = created.teamId
    const taskRecord = store.createTask({
      sessionKey: session.sessionKey,
      actorId: String(inbound.senderId || ''),
      scope: inbound.kind,
      targetId: String(inbound.replyTarget?.targetId || ''),
      mode: 'team',
      model,
      effort,
      cwd,
      prompt,
      teamId,
      status: autoApprove ? 'running' : 'awaiting_approval',
    })
    onTaskUpdate?.(taskRecord)

    if (!autoApprove) {
      store.updateSession(session.sessionKey, { pendingTeamId: teamId })
      await sendChunkedReply(
        inbound.replyTarget,
        formatTeamPreview(teamId, created.team, preset, model, effort),
        { taskId: taskRecord.id },
      )
      emitStatus()
      return
    }

    await sendChunkedReply(
      inbound.replyTarget,
      `🚀 已自动创建并确认启动团队 [${teamId}]（预设: ${preset}，主模型: ${model}，思考: ${formatEffort(effort)}），正在按 DAG 推进执行…`,
    )
    await launchTeamApprovalAndMonitor({ inbound, session, teamId, taskRecord })
  }

  const showModelPicker = async (inbound, session, filterKeyword = '') => {
    const { cpaOnline, models } = await refreshModelsCache()
    const kw = String(filterKeyword || '').trim().toLowerCase()
    const filtered = kw
      ? models.filter(
          (m) =>
            String(m.id).toLowerCase().includes(kw) ||
            String(m.name || '').toLowerCase().includes(kw) ||
            String(m.provider || '').toLowerCase().includes(kw),
        )
      : models

    if (filtered.length === 0) {
      await sendChunkedReply(inbound.replyTarget, `未找到匹配「${filterKeyword}」的模型。`)
      return
    }

    sessionModelMenus.set(session.sessionKey, {
      models: filtered,
      awaitingPick: true,
      createdAt: Date.now(),
    })

    const lines = filtered.map((m, idx) => {
      const provTag = m.provider ? `[${m.provider}] ` : ''
      const friendly = m.name && m.name !== m.id ? ` (${m.name})` : ''
      const mark = m.id === session.model ? ' ⭐当前' : ''
      return `${idx + 1}. ${provTag}${m.id}${friendly}${mark}`
    })

    await sendChunkedReply(
      inbound.replyTarget,
      [
        `🤖 ${kw ? `筛选「${filterKeyword}」模型` : '全部可用模型'}（CPA ${cpaOnline ? '在线' : '离线缓存'} · 共 ${filtered.length} 个 | 当前：${session.model}）：`,
        ...lines,
        '',
        '👉 直接回复数字序号（如 1）或发送 /model <序号或模型名> 即可切换；回复 0 取消选择。',
      ].join('\n'),
    )
  }

  const applyModelSelection = async (inbound, session, query) => {
    const q = String(query || '').trim()
    if (q === '0' || q === '取消') {
      sessionModelMenus.delete(session.sessionKey)
      await sendChunkedReply(inbound.replyTarget, `已取消模型选择，当前仍为：${session.model}`)
      return
    }

    const menu = sessionModelMenus.get(session.sessionKey)
    const { models } = await refreshModelsCache()
    const numericPool =
      menu && Date.now() - menu.createdAt < 10 * 60_000 && Array.isArray(menu.models) && menu.models.length > 0
        ? menu.models
        : models

    if (/^\d+$/u.test(q)) {
      const idx = Number(q) - 1
      if (idx < 0 || idx >= numericPool.length) {
        await sendChunkedReply(
          inbound.replyTarget,
          `⚠️ 序号「${q}」超出范围（有效范围：1 ~ ${numericPool.length}），请重新回复数字，或发送 0 取消。`,
        )
        return
      }
      const picked = numericPool[idx]
      sessionModelMenus.delete(session.sessionKey)
      store.updateSession(session.sessionKey, { model: picked.id })
      await sendChunkedReply(
        inbound.replyTarget,
        `✅ 已切换为 [${q}] ${picked.id}${picked.name && picked.name !== picked.id ? ` (${picked.name})` : ''}`,
      )
      return
    }

    const matched = matchModelChoice(q, models)
    if (!matched) {
      sessionModelMenus.delete(session.sessionKey)
      await sendChunkedReply(
        inbound.replyTarget,
        `未匹配到模型「${q}」，请发送 /model 查看全部可用模型列表。`,
      )
      return
    }
    sessionModelMenus.delete(session.sessionKey)
    store.updateSession(session.sessionKey, { model: matched.id })
    await sendChunkedReply(
      inbound.replyTarget,
      `✅ 已切换当前模型为：${matched.id}${matched.name && matched.name !== matched.id ? ` (${matched.name})` : ''}`,
    )
  }

  const handleAuthorizedCommand = async (inbound, session, rawText) => {
    const trimmed = rawText.trim()
    const spaceIdx = trimmed.search(/\s/u)
    const cmd = (spaceIdx >= 0 ? trimmed.slice(0, spaceIdx) : trimmed).toLowerCase()
    const arg = spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1).trim() : ''
    const cwd = resolveSessionCwd(session)

    if (cmd !== '/model' && cmd !== '/模型' && cmd !== '/models' && cmd !== '/模型列表') {
      const menu = sessionModelMenus.get(session.sessionKey)
      if (menu?.awaitingPick) {
        sessionModelMenus.set(session.sessionKey, { ...menu, awaitingPick: false })
      }
    }

    if (cmd === '/help' || cmd === '/bot-help' || cmd === '/菜单') {
      await sendChunkedReply(inbound.replyTarget, buildHelpText(session, cwd))
      return
    }

    if (cmd === '/models' || cmd === '/模型列表') {
      await showModelPicker(inbound, session, arg)
      return
    }

    if (cmd === '/model' || cmd === '/模型') {
      if (!arg) {
        await showModelPicker(inbound, session, '')
        return
      }
      await applyModelSelection(inbound, session, arg)
      return
    }

    if (cmd === '/think' || cmd === '/effort' || cmd === '/思考') {
      if (!arg) {
        await sendChunkedReply(
          inbound.replyTarget,
          `当前思考程度：${formatEffort(session.effort)}\n可选档位：off（关闭）、low（轻度）、medium（均衡）、high（深度）、xhigh（极致）、default（默认）。\n示例：/think xhigh`,
        )
        return
      }
      const normalized = normalizeReasoningEffort(arg)
      if (normalized === null) {
        await sendChunkedReply(
          inbound.replyTarget,
          `无法识别思考程度「${arg}」。可选：off / low / medium / high / xhigh / default（或中文：关闭 / 低 / 中 / 高 / 极高）。`,
        )
        return
      }
      const savedEffort = normalized || 'default'
      store.updateSession(session.sessionKey, { effort: savedEffort })
      await sendChunkedReply(
        inbound.replyTarget,
        `✅ 已切换思考程度为：${formatEffort(savedEffort)}`,
      )
      return
    }

    if (cmd === '/mode' || cmd === '/模式') {
      if (!arg) {
        await sendChunkedReply(
          inbound.replyTarget,
          `当前模式：${session.mode === 'team' ? `多智能体团队 (${session.teamPreset})` : '单兵直达 (direct)'}\n切换示例：/mode direct 或 /mode team chatgpt-crew`,
        )
        return
      }
      const parts = arg.split(/\s+/u)
      const rawMode = parts[0].toLowerCase()
      const nextMode =
        rawMode === 'team' || rawMode === '团队' || rawMode === '编排'
          ? 'team'
          : rawMode === 'direct' || rawMode === '单兵' || rawMode === '直达'
            ? 'direct'
            : null
      if (!nextMode) {
        await sendChunkedReply(
          inbound.replyTarget,
          `不支持的模式「${parts[0]}」，请使用：/mode direct 或 /mode team [预设名]`,
        )
        return
      }
      const patch = { mode: nextMode }
      if (parts[1]) {
        const preset = parts[1].toLowerCase()
        if (!TEAM_PRESETS.has(preset)) {
          await sendChunkedReply(
            inbound.replyTarget,
            `未知团队预设「${parts[1]}」，可选：${[...TEAM_PRESETS].join(', ')}`,
          )
          return
        }
        patch.teamPreset = preset
      }
      const updated = store.updateSession(session.sessionKey, patch)
      await sendChunkedReply(
        inbound.replyTarget,
        `✅ 已切换模式为：${updated.mode === 'team' ? `多智能体团队 (${updated.teamPreset})` : '单兵直达 (direct)'}`,
      )
      return
    }

    if (cmd === '/preset' || cmd === '/预设') {
      if (!arg) {
        await sendChunkedReply(
          inbound.replyTarget,
          `当前团队预设：${session.teamPreset}\n可选预设：${[...TEAM_PRESETS].join(', ')}`,
        )
        return
      }
      const preset = arg.toLowerCase()
      if (!TEAM_PRESETS.has(preset)) {
        await sendChunkedReply(
          inbound.replyTarget,
          `未知团队预设「${arg}」，可选：${[...TEAM_PRESETS].join(', ')}`,
        )
        return
      }
      store.updateSession(session.sessionKey, { teamPreset: preset })
      await sendChunkedReply(inbound.replyTarget, `✅ 已设置默认团队预设为：${preset}`)
      return
    }

    if (cmd === '/cwd' || cmd === '/workspace' || cmd === '/目录') {
      const cfg = store.getPublicConfig()
      if (!arg) {
        await sendChunkedReply(
          inbound.replyTarget,
          [
            `当前工作目录：${cwd}`,
            `授权根目录：${(cfg.allowedWorkspaces || []).join(' ; ') || '未配置'}`,
            '切换示例：/cwd <目录路径或相对子目录>',
          ].join('\n'),
        )
        return
      }
      try {
        const resolvedCwd = store.resolveAllowedCwd(arg, cwd)
        store.updateSession(session.sessionKey, { cwd: resolvedCwd })
        await sendChunkedReply(inbound.replyTarget, `✅ 工作目录已切换为：${resolvedCwd}`)
      } catch (err) {
        await sendChunkedReply(
          inbound.replyTarget,
          `🚫 切换目录失败：${err instanceof Error ? err.message : String(err)}`,
        )
      }
      return
    }

    if (cmd === '/new' || cmd === '/reset' || cmd === '/新会话') {
      store.resetHistory(session.sessionKey)
      await sendChunkedReply(
        inbound.replyTarget,
        `🆕 已清空单兵历史上下文（保留配置：模型 ${session.model} / 思考 ${formatEffort(session.effort)} / 目录 ${cwd}）。`,
      )
      return
    }

    if (
      cmd === '/detail' ||
      cmd === '/details' ||
      cmd === '/verbose' ||
      cmd === '/brief' ||
      cmd === '/concise' ||
      cmd === '/详细' ||
      cmd === '/详情' ||
      cmd === '/简洁'
    ) {
      const targetArg =
        cmd === '/简洁' || cmd === '/brief' || cmd === '/concise'
          ? (arg || 'concise')
          : cmd === '/详细' || cmd === '/verbose'
            ? (arg || 'verbose')
            : arg
      if (!targetArg) {
        const currentDetail = resolveSessionReplyDetail(session)
        await sendChunkedReply(
          inbound.replyTarget,
          [
            `当前回复风格：${formatReplyDetail(currentDetail)}`,
            '切换方式：',
            '- /detail 简洁（或直接发 /简洁）：只显示模型回答正文，不发接单/Token/耗时卡片',
            '- /detail 详细（或直接发 /详细）：显示完整接单回执、模型、思考档位、文件变更与 Token 耗时',
          ].join('\n'),
        )
        return
      }
      const normalizedDetail = normalizeReplyDetail(targetArg)
      if (!normalizedDetail) {
        await sendChunkedReply(
          inbound.replyTarget,
          `无法识别回复风格「${targetArg}」，可选：concise（简洁）或 verbose（详细）。`,
        )
        return
      }
      store.updateSession(session.sessionKey, { replyDetail: normalizedDetail })
      await sendChunkedReply(
        inbound.replyTarget,
        `✅ 已切换为：${formatReplyDetail(normalizedDetail)}`,
      )
      return
    }

    if (cmd === '/status' || cmd === '/状态') {
      const recent = store.listTasks({ sessionKey: session.sessionKey, limit: 5 })
      const lines = [
        '📊 远程控制状态总览',
        `模式：${session.mode === 'team' ? `团队 (${session.teamPreset})` : '单兵'} | 模型：${session.model} | 思考：${formatEffort(session.effort)}`,
        `回复：${formatReplyDetail(resolveSessionReplyDetail(session))}`,
        `工作目录：${cwd}`,
        session.pendingTeamId ? `待审批团队：${session.pendingTeamId}` : '',
        '',
        '最近任务：',
        ...(recent.length > 0
          ? recent.map((t) => `- #${shortTaskId(t.id)} [${t.status}] (${t.mode}/${t.model}) ${t.prompt.slice(0, 36)}`)
          : ['（暂无任务记录）']),
      ].filter((line) => line !== '')
      await sendChunkedReply(inbound.replyTarget, lines.join('\n'))
      return
    }

    if (cmd === '/cancel' || cmd === '/stop' || cmd === '/取消') {
      const targetIdPrefix = arg.trim()
      let stopped = false

      if (!targetIdPrefix) {
        const hadQueue = sessionQueues.has(session.sessionKey)
        sessionEpochs.set(session.sessionKey, (sessionEpochs.get(session.sessionKey) ?? 0) + 1)
        if (hadQueue) stopped = true
      }

      for (const [tid, run] of activeDirectRuns.entries()) {
        if (run.sessionKey !== session.sessionKey) continue
        if (targetIdPrefix && !tid.startsWith(targetIdPrefix)) continue
        run.abortController.abort()
        stopped = true
      }

      for (const [teamId, mon] of activeTeamMonitors.entries()) {
        if (mon.sessionKey !== session.sessionKey) continue
        if (targetIdPrefix && teamId !== targetIdPrefix && !mon.taskId.startsWith(targetIdPrefix)) continue
        mon.aborted = true
        await studioBridge.haltTeam(teamId).catch(() => {})
        stopped = true
      }

      await sendChunkedReply(
        inbound.replyTarget,
        stopped
          ? '🛑 已发送中止信号，正在终止当前模型请求与子进程…'
          : '当前会话没有正在运行中的任务。',
      )
      return
    }

    if (cmd === '/approve' || cmd === '/确认') {
      const targetTeamId = arg || session.pendingTeamId
      if (!targetTeamId) {
        await sendChunkedReply(inbound.replyTarget, '当前没有待审批的团队，请先使用 /team <需求> 生成计划。')
        return
      }
      if (approvingTeams.has(targetTeamId) || activeTeamMonitors.has(targetTeamId)) {
        await sendChunkedReply(inbound.replyTarget, `⏳ 团队 [${targetTeamId}] 已在审批或执行中，请勿重复启动。`)
        return
      }
      approvingTeams.add(targetTeamId)
      const existingTask = store.listTasks({ sessionKey: session.sessionKey, limit: 20 })
        .find((t) => t.teamId === targetTeamId && t.status === 'awaiting_approval')
      if (session.pendingTeamId === targetTeamId) {
        store.updateSession(session.sessionKey, { pendingTeamId: null })
      }
      const taskRecord = existingTask || store.createTask({
        sessionKey: session.sessionKey,
        actorId: String(inbound.senderId || ''),
        scope: inbound.kind,
        targetId: String(inbound.replyTarget?.targetId || ''),
        mode: 'team',
        model: session.model,
        effort: session.effort,
        cwd,
        prompt: `审批启动团队 ${targetTeamId}`,
        teamId: targetTeamId,
        status: 'running',
      })
      await sendChunkedReply(inbound.replyTarget, `✅ 已确认启动团队 [${targetTeamId}]，正在推进任务…`)
      void enqueueSessionWork(
        session.sessionKey,
        () => launchTeamApprovalAndMonitor({ inbound, session, teamId: targetTeamId, taskRecord })
          .finally(() => { approvingTeams.delete(targetTeamId) }),
        () => { approvingTeams.delete(targetTeamId) },
      )
      return
    }

    if (cmd === '/reject' || cmd === '/discard' || cmd === '/取消团队') {
      const targetTeamId = arg || session.pendingTeamId
      if (!targetTeamId) {
        await sendChunkedReply(inbound.replyTarget, '当前没有待审批的团队。')
        return
      }
      await studioBridge.discardTeam(targetTeamId).catch(() => {})
      if (session.pendingTeamId === targetTeamId) {
        store.updateSession(session.sessionKey, { pendingTeamId: null })
      }
      const existingTask = store.listTasks({ sessionKey: session.sessionKey, limit: 20 })
        .find((t) => t.teamId === targetTeamId && t.status === 'awaiting_approval')
      if (existingTask) {
        store.updateTask(existingTask.id, { status: 'cancelled', finishedAt: Date.now() })
      }
      await sendChunkedReply(inbound.replyTarget, `🗑️ 已作废待审批团队 [${targetTeamId}]。`)
      return
    }

    if (cmd === '/sendfile' || cmd === '/发文件') {
      if (!arg) {
        await sendChunkedReply(inbound.replyTarget, '用法：/sendfile <相对工作区文件路径>')
        return
      }
      try {
        const { absPath, relPosix } = resolveSafeWorkspacePath(cwd, arg)
        if (isSensitiveSendfilePath(absPath, relPosix)) {
          await sendChunkedReply(inbound.replyTarget, `🚫 安全拦截：禁止通过 QQ 发送敏感凭证或内部文件 (${relPosix})`)
          return
        }
        if (!existsSync(absPath)) {
          await sendChunkedReply(inbound.replyTarget, `文件不存在：${relPosix}`)
          return
        }
        const st = statSync(absPath)
        if (st.isDirectory()) {
          await sendChunkedReply(inbound.replyTarget, `目标是目录而非文件：${relPosix}`)
          return
        }
        if (st.size > MAX_SENDFILE_BYTES) {
          await sendChunkedReply(inbound.replyTarget, `文件过大 (${(st.size / 1024 / 1024).toFixed(1)}MB > 20MB 限制)：${relPosix}`)
          return
        }
        if (!gateway) throw new Error('QQ 网关未连接')
        await gateway.sendFile(inbound.replyTarget, absPath, { msgId: inbound.messageId || undefined })
        await sendChunkedReply(inbound.replyTarget, `📎 已发送文件：${basename(absPath)}`)
      } catch (err) {
        await sendChunkedReply(
          inbound.replyTarget,
          `❌ 发送文件失败：${err instanceof Error ? err.message : String(err)}`,
        )
      }
      return
    }

    if (cmd === '/direct' || cmd === '/单兵') {
      if (!arg) {
        await sendChunkedReply(inbound.replyTarget, '用法：/direct <任务需求>')
        return
      }
      const { models } = await refreshModelsCache()
      const parsed = extractInlineTaskOverrides(arg, models)
      const runModel = parsed.model || session.model
      const runEffort = parsed.effort || session.effort
      const prompt = parsed.prompt || arg
      void enqueueSessionWork(session.sessionKey, () =>
        runDirectTask({ inbound, session, prompt, model: runModel, effort: runEffort, cwd }),
      )
      return
    }

    if (cmd === '/team' || cmd === '/团队') {
      if (!arg) {
        await sendChunkedReply(
          inbound.replyTarget,
          `用法：/team [预设名] [--auto] <任务需求>\n可选预设：${[...TEAM_PRESETS].join(', ')}`,
        )
        return
      }
      const tokens = arg.split(/\s+/u)
      let preset = session.teamPreset || 'chatgpt-crew'
      let autoApprove = false
      const rest = []
      let checkingHeader = true
      for (const tok of tokens) {
        if (checkingHeader) {
          const lower = tok.toLowerCase()
          if (lower === '--auto') {
            autoApprove = true
            continue
          }
          if (TEAM_PRESETS.has(lower)) {
            preset = lower
            continue
          }
          checkingHeader = false
        }
        rest.push(tok)
      }
      const prompt = rest.join(' ').trim()
      if (!prompt) {
        await sendChunkedReply(inbound.replyTarget, '请附上具体的团队任务需求，例如：/team chatgpt-crew 为接口补充单元测试')
        return
      }
      void enqueueSessionWork(session.sessionKey, () =>
        runTeamTask({
          inbound,
          session,
          prompt,
          preset,
          model: session.model,
          effort: session.effort,
          cwd,
          autoApprove,
        }),
      )
      return
    }

    await sendChunkedReply(
      inbound.replyTarget,
      `未知指令：${cmd}\n发送 /help 查看全部可用命令。`,
    )
  }

  const handleInbound = async (inbound) => {
    if (!inbound || inbound.rawEventType === 'INTERACTION_CREATE') return
    const content = String(inbound.content || '').trim()
    if (!content) return
    if (inbound.kind !== 'c2c' && inbound.kind !== 'group') return

    const cfg = store.getPublicConfig()
    if (inbound.kind === 'group' && cfg.requireMentionInGroup) {
      // QQ 开放平台群聊默认由 GROUP_AT_MESSAGE_CREATE 触发；若收到非 @ 的普通群消息可按策略过滤
      if (inbound.rawEventType === 'GROUP_MESSAGE_CREATE') return
    }

    const dedupeKey = `${cfg.appId || 'qq'}:${inbound.rawEventType}:${inbound.messageId || randomKeyFallback(inbound)}`
    if (!store.tryRecordInbound(dedupeKey)) {
      return
    }

    // 处理 /pair 配对（在授权校验之前允许，但仍受 c2c/group disabled 限制）
    const pairMatch = content.match(/^\/pair\s+([a-zA-Z0-9]+)$/iu)
    if (pairMatch) {
      if (
        (inbound.kind === 'c2c' && cfg.c2cPolicy === 'disabled') ||
        (inbound.kind === 'group' && cfg.groupPolicy === 'disabled')
      ) {
        return
      }
      const res = store.consumePairingCode({
        code: pairMatch[1],
        senderId: String(inbound.senderId || ''),
        groupOpenid: inbound.kind === 'group' ? inbound.groupOpenid : undefined,
      })
      if (!res.ok) {
        await sendChunkedReply(
          inbound.replyTarget,
          '❌ 配对码无效或已过期，请在本地 AgentTeams Studio「QQ 远程控制」面板重新生成。',
        )
        return
      }
      const session = ensureSessionForInbound(inbound)
      const cwd = resolveSessionCwd(session)
      emitStatus()
      await sendChunkedReply(
        inbound.replyTarget,
        [
          '🎉 QQ 远程控制配对成功！',
          `已绑定操作者 OpenID：${res.senderId}`,
          res.groupOpenid ? `已加入群白名单：${res.groupOpenid}` : '',
          '',
          buildHelpText(session, cwd),
        ]
          .filter((l) => l !== '')
          .join('\n'),
      )
      return
    }

    const auth = store.authorizeActor({
      kind: inbound.kind,
      senderId: inbound.senderId,
      groupOpenid: inbound.groupOpenid,
    })
    if (!auth.allowed) {
      log('info', `拦截未授权 QQ 请求 (${auth.reason})`)
      if (auth.reason === 'user_not_allowed' || auth.reason === 'group_not_allowed') {
        await sendChunkedReply(
          inbound.replyTarget,
          '🔒 当前 QQ 尚未授权。\n请在本地 AgentTeams Studio「QQ 远程控制」面板点击生成配对码后，发送：/pair <配对码>',
        )
      }
      return
    }

    const session = ensureSessionForInbound(inbound)
    await deliverUndeliveredResults(session.sessionKey, inbound.replyTarget, session)

    if (content.startsWith('/')) {
      await handleAuthorizedCommand(inbound, session, content)
      return
    }

    const activeMenu = sessionModelMenus.get(session.sessionKey)
    if (activeMenu?.awaitingPick && Date.now() - activeMenu.createdAt < 10 * 60_000) {
      if (/^\d+$/u.test(content) || content === '取消') {
        await applyModelSelection(inbound, session, content)
        return
      }
      sessionModelMenus.set(session.sessionKey, { ...activeMenu, awaitingPick: false })
    }

    const { models } = await refreshModelsCache()
    const overrides = extractInlineTaskOverrides(content, models)
    const prompt = overrides.prompt || content
    const effectiveModel = overrides.model || session.model
    const effectiveEffort = overrides.effort || session.effort
    const effectiveMode = overrides.mode || session.mode
    const effectivePreset = overrides.teamPreset || session.teamPreset
    const cwd = resolveSessionCwd(session)

    if (effectiveMode === 'team') {
      void enqueueSessionWork(session.sessionKey, () =>
        runTeamTask({
          inbound,
          session,
          prompt,
          preset: effectivePreset,
          model: effectiveModel,
          effort: effectiveEffort,
          cwd,
          autoApprove: overrides.autoApprove,
        }),
      )
      return
    }

    void enqueueSessionWork(session.sessionKey, () =>
      runDirectTask({
        inbound,
        session,
        prompt,
        model: effectiveModel,
        effort: effectiveEffort,
        cwd,
      }),
    )
  }

  const randomKeyFallback = (inbound) =>
    `${inbound.senderId || 'anon'}:${inbound.timestamp || Date.now()}:${String(inbound.content || '').slice(0, 32)}`

  const connect = async () => {
    if (connectInFlight) return connectInFlight
    connectInFlight = (async () => {
      const cfg = store.getPublicConfig()
      const secret = store.getAppSecret()
      if (!cfg.appId || !secret) {
        throw new Error('请先配置 QQ 机器人的 AppID 与 AppSecret')
      }
      if (gateway) {
        gateway.stop()
        gateway = null
      }
      const gw = gatewayFactory({
        appId: cfg.appId,
        clientSecret: secret,
      })
      gw.on('ready', () => {
        log('success', `QQ 机器人网关已上线 (${cfg.appId})`)
        emitStatus()
      })
      gw.on('resumed', () => {
        log('info', 'QQ 机器人网关会话已恢复 (RESUMED)')
        emitStatus()
      })
      gw.on('error', (err) => {
        log('error', `QQ 网关警告: ${err.message}`)
        emitStatus()
      })
      gw.on('fatal', ({ code, reason }) => {
        log('error', `QQ 网关致命关闭 (${code}): ${reason || ''}`)
        emitStatus()
      })
      gw.on('inbound', (inbound) => {
        void handleInbound(inbound).catch((err) => {
          log('error', `处理 QQ 入站消息失败: ${err instanceof Error ? err.message : String(err)}`)
        })
      })
      gateway = gw
      store.updateConfig({ enabled: true })
      await gw.start()
      emitStatus()
      return getStatus()
    })().finally(() => {
      connectInFlight = null
    })
    return connectInFlight
  }

  const disconnect = async ({ disable = true } = {}) => {
    if (gateway) {
      gateway.stop()
      gateway = null
    }
    if (disable) {
      store.updateConfig({ enabled: false })
    }
    emitStatus()
    return getStatus()
  }

  const start = async () => {
    const cfg = store.getPublicConfig()
    const secret = store.getAppSecret()
    if (cfg.enabled && cfg.appId && secret) {
      void connect().catch((err) => {
        log('error', `QQ 机器人自动启动失败: ${err instanceof Error ? err.message : String(err)}`)
      })
    }
  }

  const stopSync = () => {
    for (const run of activeDirectRuns.values()) {
      run.abortController.abort()
    }
    activeDirectRuns.clear()
    if (gateway) {
      gateway.stop()
      gateway = null
    }
  }

  const stop = async () => {
    stopSync()
    emitStatus()
  }

  const updateConfig = async (patch = {}) => {
    const { appSecret, ...rest } = patch
    if (typeof appSecret === 'string' && appSecret.trim() !== '') {
      store.setAppSecret(appSecret.trim())
    }
    if (Object.keys(rest).length > 0) {
      store.updateConfig(rest)
    }
    emitStatus()
    return getStatus()
  }

  const cancelTask = async (taskId) => {
    const direct = activeDirectRuns.get(taskId)
    if (direct) {
      direct.abortController.abort()
      return { ok: true, cancelled: true }
    }
    const t = store.getTask(taskId)
    if (t?.teamId && activeTeamMonitors.has(t.teamId)) {
      const mon = activeTeamMonitors.get(t.teamId)
      mon.aborted = true
      await studioBridge.haltTeam(t.teamId).catch(() => {})
      return { ok: true, cancelled: true }
    }
    return { ok: false, cancelled: false }
  }

  return {
    start,
    stop,
    stopSync,
    connect,
    disconnect,
    getStatus,
    updateConfig,
    createPairingCode: () => {
      const code = store.createPairingCode()
      emitStatus()
      return code
    },
    listTasks: (filter) => store.listTasks(filter),
    cancelTask,
    handleInboundForTest: handleInbound,
    setGatewayForTest: (gw) => {
      gateway = gw
    },
  }
}

export default createQQRemoteService
