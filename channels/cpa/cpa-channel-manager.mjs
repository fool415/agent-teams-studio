/**
 * EasyCLIProxyAPI (CPA) Bundled & System Channel Manager.
 * Generated with EasyCLIProxyAPI (gpt-6.1-sol) and integrated into AgentTeams Studio.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const isFile = (p) => {
  try {
    return !!p && fs.statSync(p).isFile()
  } catch {
    return false
  }
}

const isDir = (p) => {
  try {
    return !!p && fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

const firstFile = (paths) => paths.find(isFile) || null
const normalizeBase = (value) => String(value || 'http://127.0.0.1:8317/v1').replace(/\/+$/u, '')
const managementUrl = (base) => {
  try {
    return new URL('/management.html', base).href
  } catch {
    return 'http://127.0.0.1:8317/management.html'
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function discoverLocalCpaInstall({ projectRoot = process.cwd() } = {}) {
  const home = os.homedir()
  const root = path.resolve(projectRoot)
  const windowsHome = path.join(home, 'AppData', 'Local', 'EasyCLIProxyAPI')
  const linuxHome = path.join(home, '.local', 'share', 'EasyCLIProxyAPI')
  const macHome = path.join(home, 'Library', 'Application Support', 'EasyCLIProxyAPI')

  const candidates = [
    ['env', process.env.CPA_BIN_PATH && path.resolve(process.env.CPA_BIN_PATH)],
    ['bundled', path.join(root, 'channels', 'cpa', 'cpa-core', 'cli-proxy-api.exe')],
    ['bundled', path.join(root, 'channels', 'cpa', 'cpa-core', 'cli-proxy-api')],
    ['bundled', path.join(root, 'channels', 'cpa', 'bin', 'cli-proxy-api.exe')],
    ['bundled', path.join(root, 'channels', 'cpa', 'bin', 'cli-proxy-api')],
    ['system', path.join(windowsHome, 'cpa-core', 'cli-proxy-api.exe')],
    ['system', path.join(linuxHome, 'cpa-core', 'cli-proxy-api')],
    ['system', path.join(macHome, 'cpa-core', 'cli-proxy-api')],
    ['system', '/usr/local/bin/cli-proxy-api'],
  ]

  const found = candidates.find(([, filename]) => isFile(filename))
  const binaryPath = found?.[1] || null
  const configDir = binaryPath
    ? path.dirname(binaryPath)
    : isDir(path.join(root, 'channels', 'cpa', 'cpa-core'))
      ? path.join(root, 'channels', 'cpa', 'cpa-core')
      : null
  const installDir = configDir ? path.dirname(configDir) : null

  const guiExePath = firstFile([
    configDir && path.join(configDir, 'EasyCLIProxyAPI.exe'),
    installDir && path.join(installDir, 'EasyCLIProxyAPI.exe'),
    path.join(windowsHome, 'EasyCLIProxyAPI.exe'),
  ])

  const managementHtmlPath = firstFile([
    configDir && path.join(configDir, 'static', 'management.html'),
    path.join(root, 'channels', 'cpa', 'cpa-core', 'static', 'management.html'),
    installDir && path.join(installDir, 'cpa-core', 'static', 'management.html'),
    path.join(windowsHome, 'cpa-core', 'static', 'management.html'),
  ])

  const oauthDirs = [
    installDir && path.join(installDir, 'oauth'),
    configDir && path.join(configDir, 'oauth'),
    path.join(windowsHome, 'oauth'),
    path.join(home, '.cli-proxy-api'),
    configDir && path.join(configDir, 'auths'),
  ].filter(isDir)

  const oauthCounts = { antigravity: 0, codex: 0 }
  const seenFiles = new Set()
  for (const dir of oauthDirs) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || seenFiles.has(entry.name)) continue
        seenFiles.add(entry.name)
        for (const provider of Object.keys(oauthCounts)) {
          if (entry.name.startsWith(`${provider}-`) && entry.name.endsWith('.json')) {
            oauthCounts[provider]++
          }
        }
      }
    } catch {
      // Ignore inaccessible directories
    }
  }

  return {
    installed: Boolean(binaryPath),
    binaryPath,
    guiExePath,
    configDir,
    managementHtmlPath,
    oauthCounts,
    source: found?.[0] || 'none',
  }
}

export async function probeCpaChannel({
  baseUrl = 'http://127.0.0.1:8317/v1',
  apiKey = 'sk-cliproxyapi-master-key',
  timeoutMs = 2000,
} = {}) {
  const normalized = normalizeBase(baseUrl)
  const result = {
    online: false,
    baseUrl: normalized,
    managementUrl: managementUrl(normalized),
    modelCount: 0,
    models: [],
    error: null,
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    const response = await fetch(`${normalized}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json()
    if (!Array.isArray(body?.data)) throw new Error('Invalid models response')
    const models = body.data
      .map((item) => ({
        id: String(item?.id ?? '').trim(),
        ownedBy: String(item?.owned_by ?? ''),
      }))
      .filter((item) => item.id !== '')
    return {
      ...result,
      online: true,
      models,
      modelCount: models.length,
    }
  } catch (error) {
    return {
      ...result,
      error: controller.signal.aborted
        ? 'Request timed out'
        : error instanceof Error
          ? error.message
          : String(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function ensureCpaChannelRunning({
  projectRoot = process.cwd(),
  baseUrl = 'http://127.0.0.1:8317/v1',
  apiKey = 'sk-cliproxyapi-master-key',
  autoSpawn = true,
} = {}) {
  const installInfo = discoverLocalCpaInstall({ projectRoot })
  let result = await probeCpaChannel({ baseUrl, apiKey })
  if (result.online || !autoSpawn) {
    return { ...result, startedByStudio: false, installInfo }
  }
  const { binaryPath } = installInfo
  if (!binaryPath) {
    return { ...result, startedByStudio: false, installInfo }
  }
  let spawnError = null
  try {
    const child = spawn(binaryPath, [], {
      cwd: path.dirname(binaryPath),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', (error) => {
      spawnError = error
    })
    child.unref()
  } catch (error) {
    return {
      ...result,
      startedByStudio: false,
      installInfo,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  const deadline = Date.now() + 3500
  while (Date.now() < deadline) {
    await sleep(Math.min(180, Math.max(10, deadline - Date.now())))
    if (spawnError) {
      return {
        ...result,
        startedByStudio: false,
        installInfo,
        error: spawnError instanceof Error ? spawnError.message : String(spawnError),
      }
    }
    if (Date.now() >= deadline) break
    result = await probeCpaChannel({
      baseUrl,
      apiKey,
      timeoutMs: Math.min(800, Math.max(200, deadline - Date.now())),
    })
    if (result.online) {
      return { ...result, startedByStudio: true, installInfo }
    }
  }
  return { ...result, startedByStudio: false, installInfo }
}
