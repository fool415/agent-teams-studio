#!/usr/bin/env node
/**
 * EasyCLIProxyAPI (CPA) Channel MCP Server (Zero-Dependency Node.js Edition).
 * Bundled in AgentTeams Studio so Antigravity, Codex, and DSH users get instant
 * access to CPA / OpenAI / Gemini models (`ask_gpt`, `generate_image`, `edit_image`,
 * `list_available_gpt_models`) without external Python scripts.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const SERVER_NAME = 'easycli-gpt'
const SERVER_VERSION = '2.0.0'

const BASE_URL = String(
  process.env.EASYCLI_BASE_URL || process.env.CPA_BASE_URL || 'http://127.0.0.1:8317/v1',
).replace(/\/+$/u, '')

const API_KEYS = process.env.EASYCLI_API_KEY || process.env.CPA_API_KEY
  ? [process.env.EASYCLI_API_KEY || process.env.CPA_API_KEY]
  : ['sk-cliproxyapi-master-key', '123456']

const DEFAULT_TEXT_MODEL = process.env.EASYCLI_DEFAULT_MODEL || 'gpt-6.1-sol'
const DEFAULT_IMAGE_MODEL = process.env.EASYCLI_DEFAULT_IMAGE_MODEL || 'gpt-image-1.5'
const DEFAULT_IMAGE_DIR =
  process.env.EASYCLI_IMAGE_OUTPUT_DIR || join(homedir(), 'Pictures', 'easycli-images')

function sendJsonRpc(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function makeTextResult(text, isError = false) {
  return {
    content: [{ type: 'text', text: String(text) }],
    isError,
  }
}

function isImageModel(modelName) {
  if (!modelName) return false
  const lower = String(modelName).trim().toLowerCase().split('/').pop() || ''
  return (
    lower.startsWith('gpt-image-') ||
    lower.startsWith('dall-e-') ||
    lower.startsWith('imagen-') ||
    lower.startsWith('grok-imagine-image') ||
    lower.endsWith('-image') ||
    lower.endsWith('-image-preview')
  )
}

async function cpaFetch(endpoint, init = {}, timeoutMs = 120000) {
  let lastError = null
  for (const key of API_KEYS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(init.headers || {}),
        },
        signal: controller.signal,
      })
      const text = await res.text()
      let data = {}
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = { raw: text }
      }
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          lastError = new Error(`CPA Auth HTTP ${res.status}: ${text.slice(0, 200)}`)
          continue
        }
        throw new Error(data?.error?.message || data?.error || `CPA HTTP ${res.status}: ${text.slice(0, 240)}`)
      }
      return data
    } catch (err) {
      lastError = err
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError || new Error('CPA request failed')
}

const TOOLS = [
  {
    name: 'ask_gpt',
    description:
      '向本地 EasyCLIProxyAPI (CPA) 或兼容渠道运行的模型提问、发送代码或请求生成内容（支持 gpt-6.1-sol, gpt-6-astra, codex-auto-review, gemini-3.8-flash-tiered 等）。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '要发送给模型的具体问题或指令' },
        model: {
          type: 'string',
          description: '可选模型名称（默认 gpt-6.1-sol）',
        },
        system_prompt: { type: 'string', description: '可选系统设定' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'list_available_gpt_models',
    description: '列出当前 CPA 渠道网关在线可用的全部模型列表（含 Antigravity、Codex、OpenAI、Claude 等）。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'generate_image',
    description: '通过 CPA 渠道调用图像生成模型（如 gpt-image-2.6, gpt-image-1.5, gemini-3.1-flash-image）生成图片并保存到本地。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片描述提示词' },
        model: { type: 'string', description: '生图模型名，默认 gpt-image-1.5' },
        size: { type: 'string', description: '尺寸，如 1024x1024' },
        output_path: { type: 'string', description: '可选保存路径' },
      },
      required: ['prompt'],
    },
  },
]

async function handleToolCall(name, args = {}) {
  if (name === 'list_available_gpt_models') {
    const body = await cpaFetch('/models', { method: 'GET' }, 8000)
    const list = Array.isArray(body?.data) ? body.data : []
    const formatted = list.map((m) => `- ${m.id} (${m.owned_by || 'cpa'})`).join('\n')
    return makeTextResult(`当前 CPA 渠道 (${BASE_URL}) 共在线 ${list.length} 个模型：\n${formatted}`)
  }

  if (name === 'generate_image' || (name === 'ask_gpt' && isImageModel(args.model))) {
    const model = String(args.model || DEFAULT_IMAGE_MODEL).trim()
    const prompt = String(args.prompt || '').trim()
    const size = String(args.size || '1024x1024').trim()
    const body = await cpaFetch(
      '/images/generations',
      {
        method: 'POST',
        body: JSON.stringify({ model, prompt, n: 1, size, response_format: 'b64_json' }),
      },
      120000,
    )
    const item = body?.data?.[0] || {}
    if (item.b64_json) {
      mkdirSync(DEFAULT_IMAGE_DIR, { recursive: true })
      const outPath = args.output_path || join(DEFAULT_IMAGE_DIR, `cpa-${Date.now()}.png`)
      writeFileSync(outPath, Buffer.from(item.b64_json, 'base64'))
      return makeTextResult(`图片已生成并保存至: ${outPath}`)
    }
    if (item.url) {
      return makeTextResult(`图片已生成，URL: ${item.url}`)
    }
    return makeTextResult(JSON.stringify(body, null, 2))
  }

  if (name === 'ask_gpt') {
    const model = String(args.model || DEFAULT_TEXT_MODEL).trim()
    const messages = []
    if (args.system_prompt) {
      messages.push({ role: 'system', content: String(args.system_prompt) })
    }
    messages.push({ role: 'user', content: String(args.prompt || '') })
    const body = await cpaFetch(
      '/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({ model, messages, temperature: 0.2 }),
      },
      150000,
    )
    const content = body?.choices?.[0]?.message?.content || ''
    return makeTextResult(content || JSON.stringify(body))
  }

  return makeTextResult(`未知工具: ${name}`, true)
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return
  }
  const { id, method, params } = msg
  try {
    if (method === 'initialize') {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      })
    } else if (method === 'tools/list') {
      sendJsonRpc({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    } else if (method === 'tools/call') {
      const result = await handleToolCall(params?.name, params?.arguments || {})
      sendJsonRpc({ jsonrpc: '2.0', id, result })
    } else if (id !== undefined && id !== null) {
      sendJsonRpc({ jsonrpc: '2.0', id, result: {} })
    }
  } catch (err) {
    if (id !== undefined && id !== null) {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: makeTextResult(err instanceof Error ? err.message : String(err), true),
      })
    }
  }
})
