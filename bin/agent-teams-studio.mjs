#!/usr/bin/env node
/**
 * AgentTeams Studio CLI Launcher & Multi-Ecosystem Setup Tool.
 *
 * Commands:
 *   agent-teams-studio [serve] [--port 4317] [--mirror-port 4318] [--workspace <dir>]
 *   agent-teams-studio install [--target all|antigravity|codex|dsh] [--dry-run]
 *   agent-teams-studio doctor
 *   agent-teams-studio cpa-start
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureCpaChannelRunning, probeCpaChannel } from '../channels/cpa/cpa-channel-manager.mjs'
import { DEFAULT_CPA_API_KEY, DEFAULT_CPA_BASE_URL } from '../server/cpa-client.mjs'
import { installEcosystemTargets, inspectEcosystemStatus } from '../server/ecosystem-installer.mjs'
import { createStudioServer } from '../server/index.mjs'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(MODULE_DIR, '..')

function parseArgs(argv) {
  const opts = {
    command: 'serve',
    port: Number(process.env.PORT || 4317),
    mirrorPort: process.env.MIRROR_PORT ? Number(process.env.MIRROR_PORT) : null,
    host: process.env.HOST || '127.0.0.1',
    workspaceRoot: process.env.STUDIO_WORKSPACE || process.cwd(),
    cpaBaseUrl: process.env.CPA_BASE_URL || DEFAULT_CPA_BASE_URL,
    cpaApiKey: process.env.CPA_API_KEY || DEFAULT_CPA_API_KEY,
    targets: ['all'],
    dryRun: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (i === 0 && ['serve', 'install', 'setup', 'doctor', 'cpa-start'].includes(arg)) {
      opts.command = arg === 'setup' ? 'install' : arg
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true
    } else if (arg === '--port' && argv[i + 1]) {
      opts.port = Number(argv[++i])
    } else if (arg === '--mirror-port' && argv[i + 1]) {
      opts.mirrorPort = Number(argv[++i])
    } else if (arg === '--host' && argv[i + 1]) {
      opts.host = argv[++i]
    } else if ((arg === '--workspace' || arg === '-w') && argv[i + 1]) {
      opts.workspaceRoot = argv[++i]
    } else if (arg === '--cpa-url' && argv[i + 1]) {
      opts.cpaBaseUrl = argv[++i]
    } else if ((arg === '--target' || arg === '--targets' || arg === '-t') && argv[i + 1]) {
      opts.targets = argv[++i]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (arg === '--dry-run') {
      opts.dryRun = true
    }
  }
  opts.workspaceRoot = resolve(opts.workspaceRoot)
  return opts
}

function printHelp() {
  console.log(`
AgentTeams Studio v2.0 — Multi-Ecosystem AI Team Workbench (Antigravity + Codex + CPA + DSH)

Usage:
  agent-teams-studio [serve] [options]        启动 Studio Web/Desktop 后台服务 (默认 :4317)
  agent-teams-studio install [options]        一键将插件、Skills 与 MCP 注册到 Antigravity / Codex / DSH
  agent-teams-studio doctor                   诊断 Antigravity / Codex / CPA 渠道 (:8317) / DSH 状态
  agent-teams-studio cpa-start                探测并拉起内置或本地 EasyCLIProxyAPI (CPA) 渠道服务

Options:
  --port <num>             主监听端口 (默认: 4317)
  --mirror-port <num>      镜像监听端口 (例如: 4318)
  --host <addr>            绑定地址 (默认: 127.0.0.1)
  -w, --workspace <dir>    目标工作区目录 (默认: 当前目录)
  -t, --target <list>      安装目标: all, antigravity, codex, dsh (逗号分隔)
  --dry-run                仅预览安装操作而不落盘写入
  -h, --help               显示本帮助信息
`)
}

const opts = parseArgs(process.argv.slice(2))

if (opts.help) {
  printHelp()
  process.exit(0)
}

if (opts.command === 'doctor') {
  const status = inspectEcosystemStatus({ projectRoot: PROJECT_ROOT, workspaceRoot: opts.workspaceRoot })
  const cpaProbe = await probeCpaChannel({ baseUrl: opts.cpaBaseUrl, apiKey: opts.cpaApiKey })
  console.log(
    JSON.stringify(
      {
        ok: true,
        projectRoot: PROJECT_ROOT,
        workspaceRoot: opts.workspaceRoot,
        antigravity: status.antigravity,
        codex: status.codex,
        dsh: status.dsh,
        cpa: {
          ...status.cpa,
          online: cpaProbe.online,
          baseUrl: cpaProbe.baseUrl,
          managementUrl: cpaProbe.managementUrl,
          modelCount: cpaProbe.modelCount,
        },
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

if (opts.command === 'install') {
  const res = installEcosystemTargets({
    projectRoot: PROJECT_ROOT,
    workspaceRoot: opts.workspaceRoot,
    targets: opts.targets,
    dryRun: opts.dryRun,
  })
  console.log(JSON.stringify(res, null, 2))
  process.exit(0)
}

if (opts.command === 'cpa-start') {
  const res = await ensureCpaChannelRunning({
    projectRoot: PROJECT_ROOT,
    baseUrl: opts.cpaBaseUrl,
    apiKey: opts.cpaApiKey,
    autoSpawn: true,
  })
  console.log(JSON.stringify(res, null, 2))
  process.exit(res.online ? 0 : 1)
}

const studio = createStudioServer({
  workspaceRoot: opts.workspaceRoot,
  packageRoot: PROJECT_ROOT,
  cpaBaseUrl: opts.cpaBaseUrl,
  cpaApiKey: opts.cpaApiKey,
})

const listenOn = (port) =>
  new Promise((resolveListen, rejectListen) => {
    const srv = studio.createHttpServer()
    srv.on('error', rejectListen)
    srv.listen(port, opts.host, () => resolveListen(srv))
  })

const primary = await listenOn(opts.port)
console.log(`AgentTeams Studio listening on http://${opts.host}:${opts.port} (workspace: ${opts.workspaceRoot})`)
await studio.startChannels?.()

const servers = [primary]
if (opts.mirrorPort && opts.mirrorPort !== opts.port) {
  try {
    const mirror = await listenOn(opts.mirrorPort)
    servers.push(mirror)
    console.log(`AgentTeams Studio mirror listening on http://${opts.host}:${opts.mirrorPort}`)
  } catch (err) {
    console.warn(`Mirror port ${opts.mirrorPort} unavailable: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const shutdown = () => {
  void studio.stopChannels?.().catch(() => {})
  for (const srv of servers) {
    try {
      srv.close()
    } catch {}
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
