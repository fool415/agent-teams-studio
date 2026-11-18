/**
 * Model & Provider Directory Store + Relay Station Auto-Discovery + Live Ping Probe
 * (`server/model-providers-store.mjs`).
 *
 * Covers 4 distinct ecosystem categories requested by the user:
 *   1. `agent-platform`: Antigravity (反重力), OpenAI Codex, DSH, ZCode, OpenCode
 *   2. `relay-station`: EasyCLIProxyAPI (CPA), OpenRouter, NewAPI / OneAPI / VoAPI, AiHubMix, SiliconFlow & Custom Relays
 *   3. `official-cloud`: OpenAI, Anthropic, DeepSeek, xAI Grok, Alibaba Qwen, Zhipu GLM, Moonshot Kimi, Doubao, MiniMax
 *   4. `local`: Ollama / vLLM / LM Studio
 */

import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const meta = (icon, category, region, protocol, defaultBaseUrl, website, badge, description) => ({
  icon,
  category,
  region,
  protocol,
  defaultBaseUrl,
  website,
  badge,
  description,
})

export const PROVIDER_META = {
  // ==================== 1. 核心 Agent 宿主与编码平台 (Agent Platforms) ====================
  antigravity: meta(
    '🪐',
    'agent-platform',
    'global',
    'openai',
    'http://127.0.0.1:8317/v1',
    'https://antigravity.google/',
    '反重力 · 哈吉米主力',
    'Google Antigravity 反重力生态：搭载 Gemini 3.8 Flash / Hydrogen / Argon 哈吉米审美与红队审查体系',
  ),
  codex: meta(
    '💻',
    'agent-platform',
    'global',
    'openai',
    'http://127.0.0.1:8317/v1',
    'https://openai.com/codex',
    'Codex 编码与白盒审查',
    'OpenAI Codex 编程智能体生态：支持 API 兼容路由与本机 codex exec CLI 双模式驱动',
  ),
  dsh: meta(
    '🐉',
    'agent-platform',
    'domestic',
    'openai',
    'http://127.0.0.1:8317/v1',
    'https://github.com/fool415/agent-teams-studio',
    'DSH 原生多智能体',
    'DSH (DeepSeek Harness / AgentTeams) 生态：100% 兼容 .agent-teams 状态契约与自定义网关接入',
  ),
  zcode: meta(
    '⚡',
    'agent-platform',
    'domestic',
    'openai',
    'https://open.bigmodel.cn/api/coding/paas/v4',
    'https://zcode.ai',
    'ZCode 极速编码生态',
    'ZCode IDE / 智谱编码代理生态 (zai-coding-cn 兼容协议)：支持 ZCode Coding Plan 与专属中转接入',
  ),
  opencode: meta(
    '🧩',
    'agent-platform',
    'global',
    'openai',
    'https://opencode.ai/zen/v1',
    'https://opencode.ai',
    'OpenCode Zen & 终端路由',
    '开源终端编码智能体 OpenCode 官方 Zen 聚合网关及本地 OpenCode Server 兼容接口',
  ),

  // ==================== 2. 主流中转站与多模型聚合网关 (Relay Stations) ====================
  cliproxyapi: meta(
    '🔀',
    'relay-station',
    'local',
    'openai',
    'http://127.0.0.1:8317/v1',
    'https://github.com/router-for-me/CLIProxyAPI',
    '内置 CPA 本地总中转',
    '本机内置 EasyCLIProxyAPI 统一中转渠道：免 Key 聚合 OAuth 订阅账号与多平台模型',
  ),
  newapi: meta(
    '🏮',
    'relay-station',
    'domestic',
    'openai',
    'https://your-newapi-relay.example.com/v1',
    'https://github.com/Calcium-Ion/new-api',
    'NewAPI / OneAPI 通用中转站',
    '国内最主流的 NewAPI / OneAPI / VoAPI 公益站与商业中转站标准协议，填入地址与 sk- 令牌即可一键拉取全部模型',
  ),
  openrouter: meta(
    '🌐',
    'relay-station',
    'global',
    'openai',
    'https://openrouter.ai/api/v1',
    'https://openrouter.ai',
    '全球最大模型中转站',
    'OpenRouter 统一 API 中转网关：一个 Key 畅调 Claude、GPT、Gemini、DeepSeek 等 300+ 模型',
  ),
  aihubmix: meta(
    '🚀',
    'relay-station',
    'domestic',
    'openai',
    'https://aihubmix.com/v1',
    'https://aihubmix.com',
    '国内全模型商业中转',
    'AiHubMix 国内直连免翻中转站：支持全系海外旗舰与生图模型高速调用',
  ),
  siliconflow: meta(
    '💎',
    'relay-station',
    'domestic',
    'openai',
    'https://api.siliconflow.cn/v1',
    'https://siliconflow.cn',
    '硅基流动高速聚合',
    'SiliconFlow 硅基流动：国内高速推理聚合平台，涵盖 DeepSeek-R1/V3、Qwen、FLUX 等全系模型',
  ),

  // ==================== 3. 国内外主流官方大模型平台 (Official Cloud) ====================
  openai: meta(
    '🧠',
    'official-cloud',
    'global',
    'openai',
    'https://api.openai.com/v1',
    'https://platform.openai.com',
    'OpenAI 官方直连',
    'OpenAI 官方 API 平台：支持 GPT-4o / o3 / GPT-Image 系列官方密钥直连',
  ),
  anthropic: meta(
    '🎭',
    'official-cloud',
    'global',
    'openai',
    'https://api.anthropic.com/v1',
    'https://console.anthropic.com',
    'Anthropic Claude',
    'Anthropic Claude Sonnet 4.6 / Opus 4.6 架构与长上下文旗舰模型渠道',
  ),
  deepseek: meta(
    '🐋',
    'official-cloud',
    'domestic',
    'openai',
    'https://api.deepseek.com/v1',
    'https://platform.deepseek.com',
    '深度求索官方',
    'DeepSeek 官方开放平台：DeepSeek-V3 (deepseek-chat) 与 DeepSeek-R1 (deepseek-reasoner)',
  ),
  grok: meta(
    '✳️',
    'official-cloud',
    'global',
    'openai',
    'https://api.x.ai/v1',
    'https://console.x.ai',
    'xAI Grok 官方',
    'xAI 官方平台：Grok-3 / Grok-3-Mini 实时深搜、事实核查与 grok-build 极客编码模型',
  ),
  qwen: meta(
    '☁️',
    'official-cloud',
    'domestic',
    'openai',
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'https://bailian.console.aliyun.com',
    '阿里云百炼 / 通义',
    '阿里云百炼 DashScope 兼容接口：Qwen3-Max / Qwen-Coder-Plus / QwQ 深度推理',
  ),
  zhipu: meta(
    '🔮',
    'official-cloud',
    'domestic',
    'openai',
    'https://open.bigmodel.cn/api/paas/v4',
    'https://open.bigmodel.cn',
    '智谱清言 BigModel',
    '智谱开放平台：GLM-4.5 / GLM-4-Plus / GLM-Zero 智能体与工程模型',
  ),
  kimi: meta(
    '🌙',
    'official-cloud',
    'domestic',
    'openai',
    'https://api.moonshot.cn/v1',
    'https://platform.moonshot.cn',
    '月之暗面 Kimi',
    'Moonshot AI 官方平台：Kimi-K2 万亿参数 MoE 与长文本代码重构',
  ),
  doubao: meta(
    '🫘',
    'official-cloud',
    'domestic',
    'openai',
    'https://ark.cn-beijing.volces.com/api/v3',
    'https://console.volcengine.com/ark',
    '字节火山方舟',
    '字节跳动火山方舟大模型平台：Doubao-1.5-Pro / Seed-1.6 高并发推理',
  ),
  minimax: meta(
    '🌊',
    'official-cloud',
    'domestic',
    'openai',
    'https://api.minimax.chat/v1',
    'https://platform.minimaxi.com',
    'MiniMax 稀宇科技',
    'MiniMax 开放平台：MiniMax-M1 / MiniMax-Text-01 百万长上下文模型',
  ),

  // ==================== 4. 本地私有部署引擎 (Local Self-Hosted) ====================
  ollama: meta(
    '🦙',
    'local',
    'local',
    'openai',
    'http://127.0.0.1:11434/v1',
    'https://ollama.com',
    '本地离线推理',
    'Ollama / vLLM / LM Studio / LocalAI 本机私有大模型 OpenAI 兼容网关',
  ),
}

const filePath = (root) => join(resolve(root || process.cwd()), '.agent-teams', 'custom-providers.json')
const text = (value) => (typeof value === 'string' ? value.trim() : '')

function readStore(root) {
  try {
    const raw = readFileSync(filePath(root), 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data.filter((p) => p && typeof p.id === 'string') : []
  } catch {
    return []
  }
}

function writeStore(root, data) {
  const dir = join(resolve(root || process.cwd()), '.agent-teams')
  mkdirSync(dir, { recursive: true })
  const temp = join(dir, `.custom-providers-${randomUUID()}.tmp`)
  try {
    writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    renameSync(temp, filePath(root))
  } finally {
    try {
      unlinkSync(temp)
    } catch {}
  }
}

function normalizeModel(model) {
  if (!model || !text(model.id)) throw new Error('模型 ID 不能为空')
  const cw = Number(model.contextWindow)
  return {
    id: text(model.id),
    name: text(model.name) || text(model.id),
    description: text(model.description),
    contextWindow: Number.isFinite(cw) && cw > 0 ? Math.round(cw) : 128000,
  }
}

function publicProvider(p) {
  const secret = typeof p.apiKey === 'string' ? p.apiKey : ''
  const defaults = Object.hasOwn(PROVIDER_META, p.id) ? PROVIDER_META[p.id] : {}
  return {
    id: p.id,
    name: p.name,
    icon: p.icon || defaults.icon || '🔀',
    category: p.category || defaults.category || 'relay-station',
    region: p.region || defaults.region || 'global',
    protocol: p.protocol || 'openai',
    baseUrl: p.baseUrl || '',
    website: p.website || defaults.website || '',
    badge: p.badge || defaults.badge || '自定义中转站',
    description: p.description || defaults.description || '用户自定义接入的 OpenAI 兼容中转站 / 供应商',
    isCustom: !Object.hasOwn(PROVIDER_META, p.id),
    hidden: Boolean(p.hidden),
    hasApiKey: Boolean(secret),
    apiKeyMasked: secret ? `••••••••${secret.length > 4 ? secret.slice(-4) : ''}` : '',
    models: Array.isArray(p.models) ? p.models.map(normalizeModel) : [],
    removedModelIds: Array.isArray(p.removedModelIds)
      ? p.removedModelIds.map((m) => String(m)).filter(Boolean)
      : [],
    updatedAt: p.updatedAt || null,
  }
}

export function listCustomProviders(workspaceRoot = process.cwd()) {
  return readStore(workspaceRoot).map(publicProvider)
}

export function getProviderRawConfig(workspaceRoot = process.cwd(), providerId = '') {
  return readStore(workspaceRoot).find((p) => p.id === providerId) || null
}

export function saveCustomProvider(workspaceRoot = process.cwd(), payload = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('无效的供应商配置数据')
  const providers = readStore(workspaceRoot)
  let rawId = text(payload.id)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  if (!rawId) {
    rawId = `relay-${randomUUID().slice(0, 6)}`
  } else if (!Object.hasOwn(PROVIDER_META, rawId) && !/^(custom-|relay-)/iu.test(rawId)) {
    rawId = `relay-${rawId}`
  }
  const id = rawId
  const index = providers.findIndex((p) => p.id === id)
  const previous = index < 0 ? {} : providers[index]
  const defaults = Object.hasOwn(PROVIDER_META, id) ? PROVIDER_META[id] : {}

  const regionCandidate = text(payload.region) || previous.region || defaults.region || 'domestic'
  const region = ['global', 'domestic', 'local'].includes(regionCandidate) ? regionCandidate : 'domestic'

  const catCandidate = text(payload.category) || previous.category || defaults.category || 'relay-station'
  const category = ['agent-platform', 'relay-station', 'official-cloud', 'local'].includes(catCandidate)
    ? catCandidate
    : 'relay-station'

  const modelMap = new Map(
    payload.replaceModels
      ? []
      : (previous.models || []).map((m) => [m.id, normalizeModel(m)]),
  )
  if (Array.isArray(payload.models)) {
    for (const m of payload.models) {
      if (m && text(m.id)) {
        const normalized = normalizeModel(m)
        modelMap.set(normalized.id, normalized)
      }
    }
  }

  const nextApiKey =
    payload.apiKey === undefined || payload.apiKey === 'KEEP_EXISTING'
      ? previous.apiKey || ''
      : text(payload.apiKey)

  const provider = {
    id,
    name: text(payload.name) || previous.name || id,
    icon: text(payload.icon) || previous.icon || defaults.icon || '🏮',
    category,
    region,
    protocol: text(payload.protocol) || previous.protocol || defaults.protocol || 'openai',
    baseUrl: text(payload.baseUrl ?? previous.baseUrl ?? defaults.defaultBaseUrl).replace(/\/+$/u, ''),
    website: text(payload.website ?? previous.website ?? defaults.website),
    badge: text(payload.badge) || previous.badge || defaults.badge || 'API 中转站',
    description:
      text(payload.description) ||
      previous.description ||
      defaults.description ||
      '用户自定义接入的 OpenAI / OneAPI / NewAPI / OpenCode 兼容中转站',
    hidden: false,
    apiKey: nextApiKey,
    models: [...modelMap.values()],
    removedModelIds: Array.isArray(previous.removedModelIds)
      ? previous.removedModelIds.filter((rm) => !modelMap.has(rm))
      : [],
    updatedAt: new Date().toISOString(),
  }

  if (index < 0) providers.push(provider)
  else providers[index] = provider
  writeStore(workspaceRoot, providers)
  return publicProvider(provider)
}

export function deleteCustomProvider(workspaceRoot = process.cwd(), id = '') {
  const providers = readStore(workspaceRoot)
  const isBuiltin = Object.hasOwn(PROVIDER_META, id)
  if (!isBuiltin) {
    const remaining = providers.filter((p) => p.id !== id)
    if (remaining.length === providers.length) return false
    writeStore(workspaceRoot, remaining)
    return true
  }
  const idx = providers.findIndex((p) => p.id === id)
  const defaults = PROVIDER_META[id]
  if (idx >= 0) {
    providers[idx] = { ...providers[idx], hidden: true, updatedAt: new Date().toISOString() }
  } else {
    providers.push({
      id,
      name: id,
      icon: defaults.icon,
      category: defaults.category,
      region: defaults.region,
      protocol: defaults.protocol,
      baseUrl: defaults.defaultBaseUrl,
      hidden: true,
      models: [],
      removedModelIds: [],
      updatedAt: new Date().toISOString(),
    })
  }
  writeStore(workspaceRoot, providers)
  return true
}

export function deleteModelFromProvider(workspaceRoot = process.cwd(), providerId = '', modelId = '') {
  const providers = readStore(workspaceRoot)
  const idx = providers.findIndex((p) => p.id === providerId)
  const isBuiltin = Object.hasOwn(PROVIDER_META, providerId)
  if (idx < 0 && !isBuiltin) return false
  if (idx >= 0) {
    const cur = providers[idx]
    const nextModels = (cur.models || []).filter((m) => m.id !== modelId)
    const removedSet = new Set(cur.removedModelIds || [])
    removedSet.add(modelId)
    providers[idx] = {
      ...cur,
      models: nextModels,
      removedModelIds: [...removedSet],
      updatedAt: new Date().toISOString(),
    }
  } else {
    const defaults = PROVIDER_META[providerId]
    providers.push({
      id: providerId,
      name: providerId,
      icon: defaults.icon,
      category: defaults.category,
      region: defaults.region,
      protocol: defaults.protocol,
      baseUrl: defaults.defaultBaseUrl,
      models: [],
      removedModelIds: [modelId],
      updatedAt: new Date().toISOString(),
    })
  }
  writeStore(workspaceRoot, providers)
  return true
}

export function restoreHiddenProviders(workspaceRoot = process.cwd()) {
  const providers = readStore(workspaceRoot).map((p) => ({
    ...p,
    hidden: false,
    removedModelIds: [],
  }))
  writeStore(workspaceRoot, providers)
  return providers.map(publicProvider)
}

/**
 * Auto-discover models from any OpenAI / NewAPI / OneAPI / OpenRouter / OpenCode / ZCode `/models` endpoint!
 */
export async function discoverProviderModels({ baseUrl, apiKey, timeoutMs = 7000 } = {}) {
  const started = performance.now()
  const controller = new AbortController()
  const latency = () => Math.max(1, Math.round(performance.now() - started))
  let timer
  try {
    const cleanBase = text(baseUrl).replace(/\/+$/u, '')
    if (!cleanBase) {
      return { ok: true, reachable: false, latencyMs: latency(), models: [], error: '请先填写中转站 / 供应商 Base URL' }
    }
    const url = new URL(`${cleanBase}/models`)
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { ok: true, reachable: false, latencyMs: latency(), models: [], error: '仅支持 HTTP/HTTPS 协议' }
    }
    timer = setTimeout(() => controller.abort(), Math.max(300, Number(timeoutMs) || 7000))
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    })
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      return {
        ok: true,
        reachable: false,
        latencyMs: latency(),
        models: [],
        error: `拉取 /models 返回 HTTP ${res.status}`,
      }
    }
    const data = await res.json()
    const rawList = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : []
    const seen = new Set()
    const models = []
    for (const item of rawList) {
      const mid = text(typeof item === 'string' ? item : item?.id || item?.name)
      if (!mid || seen.has(mid)) continue
      seen.add(mid)
      models.push({
        id: mid,
        name: text(item?.name) || mid,
        description: item?.owned_by ? `来源: ${item.owned_by}` : '从接口实时拉取',
        contextWindow: Number(item?.context_length || item?.contextWindow) || 128000,
      })
    }
    return {
      ok: true,
      reachable: true,
      latencyMs: latency(),
      models,
    }
  } catch (err) {
    return {
      ok: true,
      reachable: false,
      latencyMs: latency(),
      models: [],
      error: controller.signal.aborted ? '拉取 /models 超时' : (err?.message || '无法连接该中转站地址'),
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function pingModelEndpoint({ baseUrl, apiKey, model, timeoutMs = 6000 } = {}) {
  const started = performance.now()
  const controller = new AbortController()
  const latency = () => Math.max(1, Math.round(performance.now() - started))
  let timer
  try {
    const cleanBase = text(baseUrl).replace(/\/+$/u, '')
    if (!cleanBase) {
      return { ok: true, reachable: false, latencyMs: latency(), error: '未配置供应商 Base URL' }
    }
    const url = new URL(`${cleanBase}/chat/completions`)
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { ok: true, reachable: false, latencyMs: latency(), error: '仅支持 HTTP/HTTPS 协议' }
    }
    timer = setTimeout(() => controller.abort(), Math.max(200, Number(timeoutMs) || 6000))
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with a short OK.' }],
        max_tokens: 12,
      }),
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return {
        ok: true,
        reachable: false,
        latencyMs: latency(),
        error: `HTTP ${response.status}`,
      }
    }
    const data = await response.json()
    const reply = String(data?.choices?.[0]?.message?.content ?? 'OK').trim().slice(0, 80)
    return {
      ok: true,
      reachable: true,
      latencyMs: latency(),
      reply: reply || 'OK',
    }
  } catch (err) {
    return {
      ok: true,
      reachable: false,
      latencyMs: latency(),
      error: controller.signal.aborted ? '请求超时' : (err?.message || '连接未响应'),
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
