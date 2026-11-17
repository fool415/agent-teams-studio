#!/usr/bin/env node
/**
 * AgentTeams Studio MCP Server (Stdio JSON-RPC 2.0)
 * Allows any Antigravity conversation to @agent-teams-studio / @studio.md / /studio
 * to auto-start http://127.0.0.1:4317/, create staged teams routed to CPA gpt-6.1-sol,
 * check real-time progress, approve staged plans, and dispatch execution.
 */

import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const SERVER_NAME = 'agent-teams-studio'
const SERVER_VERSION = '1.0.0'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const STANDALONE_ROOT = resolve(MODULE_DIR, '..')
const STUDIO_PORT = Number(process.env.STUDIO_PORT || 4317)
const STUDIO_MIRROR_PORT = Number(process.env.STUDIO_MIRROR_PORT || 4318)
const STUDIO_BASE_URL = (process.env.STUDIO_BASE_URL || `http://127.0.0.1:${STUDIO_PORT}`).replace(/\/+$/u, '')
const WORKSPACE_ROOT = resolve(process.env.STUDIO_WORKSPACE || STANDALONE_ROOT)

function sendJsonRpc(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function sendError(id, code, message) {
  if (id === undefined || id === null) return
  sendJsonRpc({ jsonrpc: '2.0', id, error: { code, message } })
}

async function probeStudioOnline() {
  try {
    const res = await fetch(`${STUDIO_BASE_URL}/api/models`, {
      signal: AbortSignal.timeout(1200),
    })
    return res.ok
  } catch {
    return false
  }
}

async function ensureStudioServerRunning() {
  if (await probeStudioOnline()) return { startedByMcp: false, url: STUDIO_BASE_URL }

  const binPath = join(STANDALONE_ROOT, 'bin', 'agent-teams-studio.mjs')
  const child = spawn(
    process.execPath,
    [
      binPath,
      '--port',
      String(STUDIO_PORT),
      '--mirror-port',
      String(STUDIO_MIRROR_PORT),
      '--workspace',
      WORKSPACE_ROOT,
    ],
    {
      cwd: WORKSPACE_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  )
  child.unref()

  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await probeStudioOnline()) {
      return { startedByMcp: true, url: STUDIO_BASE_URL }
    }
    await delay(150)
  }

  throw new Error(`无法自动拉起 AgentTeams Studio 服务 (${STUDIO_BASE_URL})，请检查端口 ${STUDIO_PORT} 或工作区 ${WORKSPACE_ROOT}`)
}

async function studioFetchJson(path, init = {}) {
  const res = await fetch(`${STUDIO_BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(init.timeoutMs || 15000),
  })
  const text = await res.text()
  let body = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { raw: text }
  }
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`)
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

const TOOL_DEFS = [
  {
    name: 'studio_quick_team',
    description:
      '自动确保 AgentTeams Studio GUI (http://127.0.0.1:4317/) 在线，并按 @快捷模式 一键生成处于 staged (待审批) 状态的团队（默认接入 CPA gpt-6.1-sol）。支持 @studio-default、@chatgpt-crew、@heterogeneous-cross-review、@ai-radar-squad 及 @gpt-6.1-sol 等标签。',
    inputSchema: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: '快捷指令或任务目标，例如 "@chatgpt-crew @gpt-6.1-sol 开发数据导出功能"',
        },
        preset: {
          type: 'string',
          enum: ['studio-default', 'chatgpt-crew', 'heterogeneous-cross-review', 'ai-radar-squad'],
          description: '可选预设模板，缺省自动从 input 中的 @标签 解析（默认 studio-default）',
        },
        name: {
          type: 'string',
          description: '可选自定义团队名称',
        },
      },
      required: ['input'],
    },
    async execute(args = {}) {
      const serverInfo = await ensureStudioServerRunning()
      const outcome = await studioFetchJson('/api/quick-command', {
        method: 'POST',
        body: JSON.stringify({
          input: String(args.input ?? ''),
          ...(args.preset ? { preset: String(args.preset) } : {}),
          ...(args.name ? { name: String(args.name) } : {}),
        }),
      })
      return {
        ...outcome,
        guiUrl: `${STUDIO_BASE_URL}/`,
        mirrorUrl: `http://127.0.0.1:${STUDIO_MIRROR_PORT}/`,
        autoStarted: serverInfo.startedByMcp,
        note: '团队已创建在 phase="staged"（待审批），请在 GUI 点击「确认并启动团队」或等待用户明确批准后再调用 studio_approve_team。',
      }
    },
  },
  {
    name: 'studio_status',
    description:
      '获取 AgentTeams Studio 运行状态、CPA (gpt-6.1-sol) 在线状态、以及所有活跃团队的任务进度与成员状态。如服务未运行会自动拉起。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      const serverInfo = await ensureStudioServerRunning()
      const [models, state] = await Promise.all([
        studioFetchJson('/api/models'),
        studioFetchJson('/plugins/dsh-agent-teams/state'),
      ])
      return {
        guiUrl: `${STUDIO_BASE_URL}/`,
        mirrorUrl: `http://127.0.0.1:${STUDIO_MIRROR_PORT}/`,
        autoStarted: serverInfo.startedByMcp,
        cpaOnline: models.cpaOnline,
        cpaBaseUrl: models.cpaBaseUrl,
        defaultGptModel: models.defaultGptModel,
        teams: (state.teams || []).map((t) => ({
          teamId: t.teamId,
          name: t.name,
          phase: t.phase,
          halted: Boolean(t.halted),
          deliveryOk: Boolean(t.delivery?.ok),
          members: (t.members || []).map((m) => ({
            name: m.name,
            provider: m.provider,
            model: m.model,
            activity: m.activity,
            done: m.done,
            total: m.total,
          })),
          tasks: (t.tasks || []).map((task) => ({
            id: task.id,
            subject: task.subject,
            status: task.status,
            state: task.state,
            assignee: task.assignee,
            model: task.model,
          })),
        })),
      }
    },
  },
  {
    name: 'studio_approve_team',
    description:
      '仅在用户明确批准后使用：将处于 phase="staged" 的团队审批启动为 phase="running"。禁止未经用户确认擅自调用。',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: {
          type: 'string',
          description: '目标团队 ID（如 quick-studio-xxx 或 agentteams-standalone-dev）',
        },
      },
      required: ['teamId'],
    },
    async execute(args = {}) {
      const teamId = String(args.teamId ?? '').trim()
      if (!teamId) throw new Error('teamId 不能为空')
      await ensureStudioServerRunning()
      const outcome = await studioFetchJson('/plugins/dsh-agent-teams/plan', {
        method: 'POST',
        body: JSON.stringify({ teamId, action: 'approve' }),
      })
      return {
        ok: true,
        teamId,
        phase: outcome.team?.phase ?? 'running',
        guiUrl: `${STUDIO_BASE_URL}/`,
        message: `团队「${outcome.team?.name || teamId}」已批准启动，可在 GUI 或调用 studio_run 推进执行。`,
      }
    },
  },
  {
    name: 'studio_run',
    description:
      '推进已审批 (phase="running") 团队通过 CPA (gpt-6.1-sol 等) 执行下一步或自动按 DAG 推进全部就绪任务。对 staged 团队会自动返回 HTTP 409 拦截。',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: {
          type: 'string',
          description: '目标团队 ID',
        },
        mode: {
          type: 'string',
          enum: ['run-next', 'auto-run'],
          description: 'run-next（默认，单步执行就绪任务）或 auto-run（连续推进所有就绪任务）',
        },
      },
      required: ['teamId'],
    },
    async execute(args = {}) {
      const teamId = String(args.teamId ?? '').trim()
      if (!teamId) throw new Error('teamId 不能为空')
      const mode = args.mode === 'auto-run' ? 'auto-run' : 'run-next'
      await ensureStudioServerRunning()
      return await studioFetchJson(`/api/teams/${encodeURIComponent(teamId)}/${mode}`, {
        method: 'POST',
        body: '{}',
        timeoutMs: 120000,
      })
    },
  },
]

const TOOL_MAP = new Map(TOOL_DEFS.map((t) => [t.name, t]))

async function handleRpcMessage(msg) {
  const { id, method, params } = msg ?? {}

  if (method === 'initialize') {
    const protocolVersion = params?.protocolVersion || '2024-11-05'
    sendJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    })
    return
  }

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return

  if (method === 'ping') {
    sendJsonRpc({ jsonrpc: '2.0', id, result: {} })
    return
  }

  if (method === 'prompts/list') {
    sendJsonRpc({ jsonrpc: '2.0', id, result: { prompts: [] } })
    return
  }

  if (method === 'resources/list') {
    sendJsonRpc({ jsonrpc: '2.0', id, result: { resources: [] } })
    return
  }

  if (method === 'tools/list') {
    sendJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOL_DEFS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      },
    })
    return
  }

  if (method === 'tools/call') {
    const toolName = params?.name
    const tool = TOOL_MAP.get(toolName)
    if (!tool) {
      sendError(id, -32601, `Unknown tool: ${String(toolName)}`)
      return
    }
    try {
      const output = await tool.execute(params?.arguments ?? {})
      const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text }],
          isError: false,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `ERROR: ${message}` }],
          isError: true,
        },
      })
    }
    return
  }

  if (id !== undefined && id !== null) {
    sendError(id, -32601, `Method not supported: ${String(method)}`)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('Content-Length:') || trimmed.startsWith('Content-Type:')) return
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    process.stderr.write(`[agent-teams-studio mcp] invalid JSON line: ${String(err)}\n`)
    return
  }
  Promise.resolve(handleRpcMessage(parsed)).catch((err) => {
    process.stderr.write(`[agent-teams-studio mcp] unhandled RPC error: ${String(err)}\n`)
    sendError(parsed?.id, -32603, err instanceof Error ? err.message : String(err))
  })
})
