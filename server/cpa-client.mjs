/**
 * EasyCLIProxyAPI (CPA) OpenAI-compatible HTTP client.
 * Default endpoint: http://127.0.0.1:8317/v1 (Bearer sk-cliproxyapi-master-key)
 */

export const DEFAULT_CPA_BASE_URL = process.env.CPA_BASE_URL || 'http://127.0.0.1:8317/v1'
export const DEFAULT_CPA_API_KEY = process.env.CPA_API_KEY || 'sk-cliproxyapi-master-key'
export const DEFAULT_CPA_GPT_MODEL = process.env.CPA_DEFAULT_GPT_MODEL || 'gpt-6.1-sol'

export const EFFORT_LEVELS = Object.freeze(['off', 'low', 'medium', 'high', 'xhigh'])

const EFFORT_ALIASES = new Map([
  ['off', 'off'],
  ['none', 'off'],
  ['disable', 'off'],
  ['disabled', 'off'],
  ['关闭', 'off'],
  ['无', 'off'],
  ['minimal', 'low'],
  ['low', 'low'],
  ['低', 'low'],
  ['轻', 'low'],
  ['medium', 'medium'],
  ['mid', 'medium'],
  ['normal', 'medium'],
  ['中', 'medium'],
  ['均衡', 'medium'],
  ['high', 'high'],
  ['高', 'high'],
  ['深', 'high'],
  ['深度', 'high'],
  ['xhigh', 'xhigh'],
  ['max', 'xhigh'],
  ['极高', 'xhigh'],
  ['极致', 'xhigh'],
  ['满血', 'xhigh'],
  ['default', ''],
  ['默认', ''],
])

/**
 * 规范化思考程度枚举值；无法识别时返回 null。
 */
export function normalizeReasoningEffort(raw) {
  if (raw === undefined || raw === null) return ''
  const key = String(raw).trim().toLowerCase()
  if (key === '') return ''
  return EFFORT_ALIASES.has(key) ? EFFORT_ALIASES.get(key) : null
}

/**
 * 根据模型与期望思考程度生成 CPA 兼容参数与降级策略。
 */
export function resolveReasoningPlan(modelId, effort) {
  const normalized = normalizeReasoningEffort(effort)
  if (!normalized) {
    return {
      requestedEffort: 'default',
      effectiveEffort: 'default',
      payloadParams: {},
      fallbacks: [],
    }
  }
  const lowerModel = String(modelId || '').toLowerCase()
  if (normalized === 'off') {
    if (lowerModel.includes('-thinking') || lowerModel.includes('-xhigh')) {
      return {
        requestedEffort: 'off',
        effectiveEffort: 'default',
        payloadParams: {},
        fallbacks: [],
      }
    }
    return {
      requestedEffort: 'off',
      effectiveEffort: 'off',
      payloadParams: { reasoning_effort: 'none' },
      fallbacks: [{ effectiveEffort: 'default', payloadParams: {} }],
    }
  }
  if (normalized === 'xhigh') {
    return {
      requestedEffort: 'xhigh',
      effectiveEffort: 'xhigh',
      payloadParams: { reasoning_effort: 'xhigh' },
      fallbacks: [
        { effectiveEffort: 'high', payloadParams: { reasoning_effort: 'high' } },
        { effectiveEffort: 'default', payloadParams: {} },
      ],
    }
  }
  return {
    requestedEffort: normalized,
    effectiveEffort: normalized,
    payloadParams: { reasoning_effort: normalized },
    fallbacks: [{ effectiveEffort: 'default', payloadParams: {} }],
  }
}

export function isReasoningParamRejection(status, errText) {
  if (status !== 400 && status !== 422) return false
  return /reasoning|thinking|effort|unsupported_value|invalid_value|unknown field|unrecognized/iu.test(
    String(errText || ''),
  )
}

export const CPA_MODEL_ALIASES = Object.freeze({
  hydrogen: ['gemini-4-hydrogen-high', 'hydrogen', 'gemini-3.8-flash-high', 'gemini-3.8-flash-tiered', 'gemini-4-hydrogen-xhigh'],
  'gemini-4-hydrogen': ['gemini-4-hydrogen-high', 'hydrogen', 'gemini-3.8-flash-high', 'gemini-3.8-flash-tiered', 'gemini-4-hydrogen-xhigh'],
  'gemini-4-hydrogen-high': ['gemini-4-hydrogen-high', 'hydrogen', 'gemini-3.8-flash-high', 'gemini-3.8-flash-tiered', 'gemini-4-hydrogen-xhigh'],
  'gemini-4-hydrogen-xhigh': ['gemini-4-hydrogen-xhigh', 'gemini-4-hydrogen-high', 'hydrogen', 'gemini-3.8-flash-high', 'gemini-3.8-flash-tiered'],
  // When argon quota is exhausted or unavailable, automatically fall back to hydrogen -> gemini-3.8-flash-tiered
  argon: ['gemini-4-argon-high', 'argon', 'gemini-4-hydrogen-high', 'hydrogen', 'gemini-3.8-flash-tiered', 'gemini-4-hydrogen-xhigh'],
  'gemini-4-argon': ['gemini-4-argon-high', 'argon', 'gemini-4-hydrogen-high', 'hydrogen', 'gemini-3.8-flash-tiered', 'gemini-4-hydrogen-xhigh'],
  'gemini-4-argon-high': ['gemini-4-argon-high', 'argon', 'gemini-4-hydrogen-high', 'hydrogen', 'gemini-3.8-flash-tiered', 'gemini-4-hydrogen-xhigh'],
})

/**
 * Resolve ordered CPA model candidates for a requested model ID so Logical aliases
 * (e.g. `hydrogen`, `argon`) try native endpoints first and fall back cleanly if disabled or out of quota.
 */
export function resolveCpaModelCandidates(model, { allowFallback = true } = {}) {
  const raw = String(model || DEFAULT_CPA_GPT_MODEL).trim() || DEFAULT_CPA_GPT_MODEL
  const normalized = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1).trim() : raw
  if (!allowFallback) return [normalized]
  const aliasList = CPA_MODEL_ALIASES[normalized.toLowerCase()]
  if (!aliasList) return [normalized]
  const seen = new Set()
  const out = []
  for (const candidate of aliasList) {
    if (!seen.has(candidate)) {
      seen.add(candidate)
      out.push(candidate)
    }
  }
  return out
}

function isModelNotFoundResponse(status, errText) {
  if (status === 429 || status === 402 || status === 503) return true
  if (status !== 400 && status !== 403 && status !== 404 && status !== 500 && status !== 502) return false
  return /model_not_found|unknown provider for model|does not exist|quota|rate_limit|resource_exhausted|insufficient|exhausted|capacity/iu.test(errText)
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_CPA_BASE_URL).replace(/\/+$/u, '')
}

export async function fetchCpaModels({
  baseUrl = DEFAULT_CPA_BASE_URL,
  apiKey = DEFAULT_CPA_API_KEY,
  timeoutMs = 4000,
} = {}) {
  const root = normalizeBaseUrl(baseUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${root}/models`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      signal: controller.signal,
    })
    if (!res.ok) {
      return { online: false, baseUrl: root, models: [], error: `CPA HTTP ${res.status}` }
    }
    const body = await res.json()
    const rawList = Array.isArray(body?.data) ? body.data : []
    const models = rawList
      .map((item) => ({
        id: String(item?.id ?? '').trim(),
        ownedBy: String(item?.owned_by ?? ''),
      }))
      .filter((item) => item.id !== '')
    return { online: true, baseUrl: root, models }
  } catch (err) {
    return {
      online: false,
      baseUrl: root,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function postChatCompletionAttempt({
  root,
  apiKey,
  modelId,
  messages,
  tools,
  timeoutMs,
  maxTokens,
  temperature,
  extraPayload = {},
  signal,
}) {
  if (signal?.aborted) {
    return { ok: false, status: 499, errText: '任务已取消', aborted: true, userAborted: true }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
  try {
    const payload = {
      model: modelId,
      messages,
      temperature,
      ...extraPayload,
      ...(typeof maxTokens === 'number' && maxTokens > 0 ? { max_tokens: maxTokens } : {}),
    }
    if (tools.length > 0) {
      payload.tools = tools
      payload.tool_choice = 'auto'
    }
    const res = await fetch(`${root}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: combinedSignal,
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { ok: false, status: res.status, errText }
    }
    return { ok: true, body: await res.json() }
  } catch (err) {
    if (signal?.aborted) {
      return { ok: false, status: 499, errText: '任务已取消', aborted: true, userAborted: true }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 504, errText: msg, aborted: /aborted|timeout/iu.test(msg) }
  } finally {
    clearTimeout(timer)
  }
}

export async function runCpaChatCompletion({
  baseUrl = DEFAULT_CPA_BASE_URL,
  apiKey = DEFAULT_CPA_API_KEY,
  model = DEFAULT_CPA_GPT_MODEL,
  reasoningEffort = '',
  messages,
  tools = [],
  onToolCall,
  maxRounds = 8,
  timeoutMs = 180000,
  allowModelFallback = true,
  maxTokens,
  temperature = 0.2,
  signal,
} = {}) {
  const root = normalizeBaseUrl(baseUrl)
  const requestedModel = String(model || DEFAULT_CPA_GPT_MODEL).trim() || DEFAULT_CPA_GPT_MODEL
  const candidates = resolveCpaModelCandidates(requestedModel, { allowFallback: allowModelFallback })
  const conversation = Array.isArray(messages) ? [...messages] : []
  const toolLogs = []
  let activeModel = candidates[0] || requestedModel
  let modelLocked = false
  let reasoningPlan = resolveReasoningPlan(activeModel, reasoningEffort)
  let effectiveEffort = reasoningPlan.effectiveEffort
  let activeExtraPayload = reasoningPlan.payloadParams
  let effortFallbackUsed = false
  const startTime = Date.now()
  const totalUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    total_tokens: 0,
    requests: 0,
  }

  const recordRoundUsage = (usageObj, outText = '') => {
    totalUsage.requests += 1
    if (usageObj && typeof usageObj === 'object') {
      const prompt = Number(usageObj.prompt_tokens ?? usageObj.input_tokens ?? 0) || 0
      const completion = Number(usageObj.completion_tokens ?? usageObj.output_tokens ?? 0) || 0
      const reasoning =
        Number(
          usageObj.reasoning_tokens ??
            usageObj.completion_tokens_details?.reasoning_tokens ??
            usageObj.output_tokens_details?.reasoning_tokens ??
            0,
        ) || 0
      const cached =
        Number(
          usageObj.cached_tokens ??
            usageObj.cache_read_tokens ??
            usageObj.prompt_tokens_details?.cached_tokens ??
            0,
        ) || 0
      const total = Number(usageObj.total_tokens ?? prompt + completion) || prompt + completion
      totalUsage.prompt_tokens += prompt
      totalUsage.completion_tokens += completion
      totalUsage.reasoning_tokens += reasoning
      totalUsage.cached_tokens += cached
      totalUsage.total_tokens += total
    } else {
      const inChars = conversation.reduce((acc, m) => acc + String(m.content || '').length, 0)
      const estIn = Math.max(12, Math.ceil(inChars / 3.8))
      const estOut = Math.max(4, Math.ceil(String(outText || '').length / 3.8))
      totalUsage.prompt_tokens += estIn
      totalUsage.completion_tokens += estOut
      totalUsage.total_tokens += estIn + estOut
    }
  }

  const runAttemptWithReasoning = async (candidateModel) => {
    const candidatePlan = modelLocked
      ? { effectiveEffort, payloadParams: activeExtraPayload, fallbacks: [] }
      : resolveReasoningPlan(candidateModel, reasoningEffort)

    const attempts = [
      { effectiveEffort: candidatePlan.effectiveEffort, payloadParams: candidatePlan.payloadParams },
      ...candidatePlan.fallbacks,
    ]

    let lastAttempt = null
    for (let idx = 0; idx < attempts.length; idx++) {
      const step = attempts[idx]
      const attempt = await postChatCompletionAttempt({
        root,
        apiKey,
        modelId: candidateModel,
        messages: conversation,
        tools,
        timeoutMs,
        maxTokens,
        temperature,
        extraPayload: step.payloadParams,
        signal,
      })
      if (attempt.ok) {
        effectiveEffort = step.effectiveEffort
        activeExtraPayload = step.payloadParams
        if (idx > 0) effortFallbackUsed = true
        return attempt
      }
      lastAttempt = attempt
      if (!isReasoningParamRejection(attempt.status, attempt.errText)) {
        return attempt
      }
    }
    return lastAttempt
  }

  for (let round = 0; round < maxRounds; round++) {
    if (signal?.aborted) {
      throw new Error('任务已被用户取消')
    }
    let body
    if (!modelLocked) {
      let lastFailure = null
      for (const candidate of candidates) {
        const attempt = await runAttemptWithReasoning(candidate)
        if (attempt.ok) {
          body = attempt.body
          activeModel = candidate
          modelLocked = true
          break
        }
        lastFailure = attempt
        if (attempt.userAborted || !allowModelFallback || !isModelNotFoundResponse(attempt.status, attempt.errText)) {
          throw new Error(`CPA chat HTTP ${attempt.status}: ${attempt.errText.slice(0, 300)}`)
        }
      }
      if (!body) {
        const status = lastFailure?.status ?? 400
        const errText = lastFailure?.errText ?? 'model_not_found'
        throw new Error(`CPA chat HTTP ${status}: ${errText.slice(0, 300)}`)
      }
    } else {
      const attempt = await runAttemptWithReasoning(activeModel)
      if (!attempt.ok) {
        throw new Error(`CPA chat HTTP ${attempt.status}: ${attempt.errText.slice(0, 300)}`)
      }
      body = attempt.body
    }

    const choice = body?.choices?.[0]
    const msg = choice?.message ?? {}
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : []
    const rawContent = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((c) => c?.text ?? '').join('\n')
        : ''
    recordRoundUsage(body?.usage, rawContent)

    if (toolCalls.length === 0 || typeof onToolCall !== 'function') {
      return {
        requestedModel,
        routedModel: activeModel,
        fallbackUsed: activeModel !== requestedModel,
        requestedEffort: reasoningPlan.requestedEffort,
        effectiveEffort,
        effortFallbackUsed,
        model: body?.model || activeModel,
        usage: { ...totalUsage },
        elapsedMs: Date.now() - startTime,
        content: rawContent.trim(),
        toolLogs,
        rounds: round + 1,
      }
    }

    conversation.push({
      role: 'assistant',
      content: msg.content ?? null,
      tool_calls: toolCalls,
    })

    for (const tc of toolCalls) {
      if (signal?.aborted) {
        throw new Error('任务已被用户取消')
      }
      const fnName = tc?.function?.name || ''
      let fnArgs = {}
      try {
        fnArgs = tc?.function?.arguments ? JSON.parse(tc.function.arguments) : {}
      } catch {
        fnArgs = {}
      }
      let resultText
      try {
        const res = await onToolCall(fnName, fnArgs)
        resultText = typeof res === 'string' ? res : JSON.stringify(res)
      } catch (err) {
        resultText = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
      }
      toolLogs.push({ name: fnName, args: fnArgs, resultPreview: resultText.slice(0, 240) })
      conversation.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: resultText.slice(0, 12000),
      })
    }
  }

  return {
    requestedModel,
    routedModel: activeModel,
    fallbackUsed: activeModel !== requestedModel,
    requestedEffort: reasoningPlan.requestedEffort,
    effectiveEffort,
    effortFallbackUsed,
    model: activeModel,
    usage: { ...totalUsage },
    elapsedMs: Date.now() - startTime,
    content: '已完成最大工具交互轮次，请查看已执行命令与变更产物。',
    toolLogs,
    rounds: maxRounds,
  }
}
