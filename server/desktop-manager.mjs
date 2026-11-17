/**
 * AgentTeams Studio Desktop Configuration, Theme Selection & Usage Manager
 * (1:1 EasyCLIProxyAPI Desktop Benchmark + Multi-Ecosystem Channel Config).
 *
 * Manages:
 * - `config.toml` reading, validation, and TOML-preserving serialization
 * - `theme-selection.json` 1:1 CPA multi-style theme persistence (`selectedId`, `lastLightId`, `lastDarkId`)
 * - `portable-app.json` and `core-version.txt` metadata discovery
 * - `usage-records/` and `agent-usage/` snapshots + live workspace team/model statistics
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { collectStudioTeams } from './snapshot.mjs'

const require = createRequire(import.meta.url)

const PROCESS_STARTED_AT = new Date().toISOString()

export const DEFAULT_DESKTOP_CONFIG = Object.freeze({
  locale: 'zh-CN',
  port: 4317,
  'mirror-port': 4318,
  host: '127.0.0.1',
  'run-on-startup': false,
  'start-core-on-launch': true,
  'silent-start': false,
  'close-behavior': 'ask',
  'window-width': 1360,
  'window-height': 860,
  'cpa-base-url': 'http://127.0.0.1:8317/v1',
  'default-gpt-model': 'gpt-6.1-sol',
  'watchdog-enabled': true,
  'watchdog-interval-seconds': 10,
  'usage-statistics-enabled': true,
  'active-preset': 'cpa-hajimi',
  'codex-mode': 'api',
  'codex-base-url': 'http://127.0.0.1:8317/v1',
  'antigravity-base-url': 'http://127.0.0.1:8317/v1',
  'dsh-sync-workspace': true,
  'cpa-auto-launch': true,
})

export const DEFAULT_THEME_SELECTION = Object.freeze({
  version: 1,
  selectedId: 'liquid-glass-light',
  lastLightId: 'liquid-glass-light',
  lastDarkId: 'liquid-glass-dark',
  fontFamilyId: 'apple-sf',
  customFontFamily: '',
  uiScale: 108,
})

export const DEFAULT_PORTABLE_APP = Object.freeze({
  schemaVersion: 1,
  application: 'AgentTeamsStudio',
  version: '2.0.0',
  platform: 'windows',
  arch: 'amd64',
  autoUpdate: true,
})

const CONFIG_KEY_ORDER = [
  'locale',
  'port',
  'mirror-port',
  'host',
  'run-on-startup',
  'start-core-on-launch',
  'silent-start',
  'close-behavior',
  'window-width',
  'window-height',
  'cpa-base-url',
  'default-gpt-model',
  'watchdog-enabled',
  'watchdog-interval-seconds',
  'usage-statistics-enabled',
  'active-preset',
  'codex-mode',
  'codex-base-url',
  'antigravity-base-url',
  'dsh-sync-workspace',
  'cpa-auto-launch',
]

const CAMEL_TO_KEBAB = new Map([
  ['mirrorPort', 'mirror-port'],
  ['runOnStartup', 'run-on-startup'],
  ['startCoreOnLaunch', 'start-core-on-launch'],
  ['silentStart', 'silent-start'],
  ['closeBehavior', 'close-behavior'],
  ['windowWidth', 'window-width'],
  ['windowHeight', 'window-height'],
  ['cpaBaseUrl', 'cpa-base-url'],
  ['defaultGptModel', 'default-gpt-model'],
  ['watchdogEnabled', 'watchdog-enabled'],
  ['watchdogIntervalSeconds', 'watchdog-interval-seconds'],
  ['usageStatisticsEnabled', 'usage-statistics-enabled'],
  ['activePreset', 'active-preset'],
  ['codexMode', 'codex-mode'],
  ['codexBaseUrl', 'codex-base-url'],
  ['antigravityBaseUrl', 'antigravity-base-url'],
  ['dshSyncWorkspace', 'dsh-sync-workspace'],
  ['cpaAutoLaunch', 'cpa-auto-launch'],
])

export function parseConfigToml(rawText) {
  const out = { ...DEFAULT_DESKTOP_CONFIG }
  if (typeof rawText !== 'string' || !rawText.trim()) return out

  const lines = rawText.split(/\r?\n/u)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('[')) continue
    const eqIdx = line.indexOf('=')
    if (eqIdx <= 0) continue
    const key = line.slice(0, eqIdx).trim()
    let valPart = line.slice(eqIdx + 1).trim()
    if (!valPart.startsWith('"') && !valPart.startsWith("'")) {
      const hashIdx = valPart.indexOf('#')
      if (hashIdx >= 0) valPart = valPart.slice(0, hashIdx).trim()
    }
    if (
      (valPart.startsWith('"') && valPart.endsWith('"')) ||
      (valPart.startsWith("'") && valPart.endsWith("'"))
    ) {
      out[key] = valPart.slice(1, -1)
    } else if (valPart === 'true' || valPart === 'false') {
      out[key] = valPart === 'true'
    } else if (/^-?\d+(?:\.\d+)?$/u.test(valPart)) {
      out[key] = Number(valPart)
    } else {
      out[key] = valPart
    }
  }
  return normalizeDesktopConfig(out)
}

export function normalizeDesktopConfig(input = {}) {
  const merged = { ...DEFAULT_DESKTOP_CONFIG }
  if (typeof input === 'object' && input !== null) {
    for (const [rawKey, rawVal] of Object.entries(input)) {
      if (rawVal === undefined) continue
      const key = CAMEL_TO_KEBAB.get(rawKey) || rawKey
      merged[key] = rawVal
    }
  }

  const closeBehavior = String(merged['close-behavior'] || 'ask').trim().toLowerCase()
  const validClose = ['ask', 'tray', 'exit'].includes(closeBehavior) ? closeBehavior : 'ask'

  const codexMode = String(merged['codex-mode'] || 'api').trim().toLowerCase()
  const validCodexMode = ['api', 'cli'].includes(codexMode) ? codexMode : 'api'

  const clampInt = (val, fallback, min, max) => {
    const n = Number(val)
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, Math.round(n)))
  }

  const cpaBaseUrl =
    String(merged['cpa-base-url'] || 'http://127.0.0.1:8317/v1').trim() ||
    'http://127.0.0.1:8317/v1'

  return {
    locale: String(merged.locale || 'zh-CN').trim() || 'zh-CN',
    port: clampInt(merged.port, 4317, 1024, 65535),
    'mirror-port': clampInt(merged['mirror-port'], 4318, 1024, 65535),
    host: String(merged.host || '127.0.0.1').trim() || '127.0.0.1',
    'run-on-startup': Boolean(merged['run-on-startup']),
    'start-core-on-launch': Boolean(merged['start-core-on-launch']),
    'silent-start': Boolean(merged['silent-start']),
    'close-behavior': validClose,
    'window-width': clampInt(merged['window-width'], 1360, 800, 3840),
    'window-height': clampInt(merged['window-height'], 860, 600, 2160),
    'cpa-base-url': cpaBaseUrl,
    'default-gpt-model': String(merged['default-gpt-model'] || 'gpt-6.1-sol').trim() || 'gpt-6.1-sol',
    'watchdog-enabled': Boolean(merged['watchdog-enabled']),
    'watchdog-interval-seconds': clampInt(merged['watchdog-interval-seconds'], 10, 3, 300),
    'usage-statistics-enabled': Boolean(merged['usage-statistics-enabled']),
    'active-preset': String(merged['active-preset'] || 'cpa-hajimi').trim() || 'cpa-hajimi',
    'codex-mode': validCodexMode,
    'codex-base-url': String(merged['codex-base-url'] || cpaBaseUrl).trim() || cpaBaseUrl,
    'antigravity-base-url': String(merged['antigravity-base-url'] || cpaBaseUrl).trim() || cpaBaseUrl,
    'dsh-sync-workspace': merged['dsh-sync-workspace'] !== false,
    'cpa-auto-launch': merged['cpa-auto-launch'] !== false,
  }
}

export function serializeConfigToml(config) {
  const normalized = normalizeDesktopConfig(config)
  const lines = []
  for (const key of CONFIG_KEY_ORDER) {
    const val = normalized[key]
    if (typeof val === 'string') {
      lines.push(`${key} = ${JSON.stringify(val)}`)
    } else if (typeof val === 'boolean' || typeof val === 'number') {
      lines.push(`${key} = ${String(val)}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function resolveReadableFile(workspaceRoot, packageRoot, fileName) {
  const wsCandidate = join(resolve(workspaceRoot), fileName)
  if (existsSync(wsCandidate)) return wsCandidate
  const pkgCandidate = join(resolve(packageRoot), fileName)
  if (existsSync(pkgCandidate)) return pkgCandidate
  return wsCandidate
}

export function readDesktopConfig({ workspaceRoot = process.cwd(), packageRoot = process.cwd() } = {}) {
  const configPath = resolveReadableFile(workspaceRoot, packageRoot, 'config.toml')
  if (!existsSync(configPath)) {
    const config = { ...DEFAULT_DESKTOP_CONFIG }
    return { configPath, config, rawToml: serializeConfigToml(config) }
  }
  const rawToml = readFileSync(configPath, 'utf8')
  const config = parseConfigToml(rawToml)
  return { configPath, config, rawToml: serializeConfigToml(config) }
}

export function writeDesktopConfig(patch = {}, { workspaceRoot = process.cwd(), packageRoot = process.cwd() } = {}) {
  const current = readDesktopConfig({ workspaceRoot, packageRoot })
  const merged = normalizeDesktopConfig({ ...current.config, ...patch })
  const rawToml = serializeConfigToml(merged)
  const targetPath = join(resolve(workspaceRoot), 'config.toml')
  writeFileSync(targetPath, rawToml, 'utf8')
  return { configPath: targetPath, config: merged, rawToml }
}

export function readThemeSelection({ workspaceRoot = process.cwd(), packageRoot = process.cwd() } = {}) {
  const themePath = resolveReadableFile(workspaceRoot, packageRoot, 'theme-selection.json')
  if (!existsSync(themePath)) {
    return { themePath, selection: { ...DEFAULT_THEME_SELECTION } }
  }
  try {
    const parsed = JSON.parse(readFileSync(themePath, 'utf8'))
    return {
      themePath,
      selection: {
        version: 1,
        selectedId: String(parsed?.selectedId || DEFAULT_THEME_SELECTION.selectedId),
        lastLightId: String(parsed?.lastLightId || DEFAULT_THEME_SELECTION.lastLightId),
        lastDarkId: String(parsed?.lastDarkId || DEFAULT_THEME_SELECTION.lastDarkId),
        fontFamilyId: String(parsed?.fontFamilyId || DEFAULT_THEME_SELECTION.fontFamilyId || 'apple-sf'),
        customFontFamily: String(parsed?.customFontFamily || ''),
        uiScale: Number.isFinite(Number(parsed?.uiScale))
          ? Math.max(85, Math.min(140, Math.round(Number(parsed.uiScale))))
          : DEFAULT_THEME_SELECTION.uiScale,
      },
    }
  } catch {
    return { themePath, selection: { ...DEFAULT_THEME_SELECTION } }
  }
}

export function writeThemeSelection(patch = {}, { workspaceRoot = process.cwd(), packageRoot = process.cwd() } = {}) {
  const current = readThemeSelection({ workspaceRoot, packageRoot }).selection
  const next = {
    version: 1,
    selectedId: String(patch?.selectedId || current.selectedId || DEFAULT_THEME_SELECTION.selectedId),
    lastLightId: String(patch?.lastLightId || current.lastLightId || DEFAULT_THEME_SELECTION.lastLightId),
    lastDarkId: String(patch?.lastDarkId || current.lastDarkId || DEFAULT_THEME_SELECTION.lastDarkId),
    fontFamilyId: String(patch?.fontFamilyId ?? current.fontFamilyId ?? DEFAULT_THEME_SELECTION.fontFamilyId),
    customFontFamily: String(patch?.customFontFamily ?? current.customFontFamily ?? ''),
    uiScale:
      patch?.uiScale !== undefined && Number.isFinite(Number(patch.uiScale))
        ? Math.max(85, Math.min(140, Math.round(Number(patch.uiScale))))
        : current.uiScale || DEFAULT_THEME_SELECTION.uiScale,
  }
  const targetPath = join(resolve(workspaceRoot), 'theme-selection.json')
  writeFileSync(targetPath, `${JSON.stringify(next)}\n`, 'utf8')
  return { themePath: targetPath, selection: next }
}

export function readPortableMetadata({ workspaceRoot = process.cwd(), packageRoot = process.cwd() } = {}) {
  const portablePath = resolveReadableFile(workspaceRoot, packageRoot, 'portable-app.json')
  const versionPath = resolveReadableFile(workspaceRoot, packageRoot, 'core-version.txt')

  let portableApp = { ...DEFAULT_PORTABLE_APP }
  if (existsSync(portablePath)) {
    try {
      portableApp = { ...DEFAULT_PORTABLE_APP, ...JSON.parse(readFileSync(portablePath, 'utf8')) }
    } catch {}
  }

  let coreVersion = '2.0.0'
  if (existsSync(versionPath)) {
    try {
      coreVersion = readFileSync(versionPath, 'utf8').trim() || '2.0.0'
    } catch {}
  }

  return { portableApp, coreVersion }
}

function readCpaNativeSqliteTelemetry({ workspaceRoot = process.cwd(), packageRoot = process.cwd(), range = 'all' } = {}) {
  const home = homedir()
  const dbCandidates = [
    join(resolve(workspaceRoot), 'usage-records', 'usage.db'),
    join(resolve(packageRoot), 'usage-records', 'usage.db'),
    join(home, 'AppData', 'Local', 'EasyCLIProxyAPI', 'usage-records', 'usage.db'),
    join(home, '.local', 'share', 'EasyCLIProxyAPI', 'usage-records', 'usage.db'),
  ]
  const dbPath = dbCandidates.find((p) => existsSync(p))
  if (!dbPath) {
    return { available: false, dbPath: null }
  }

  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const nowMs = Date.now()
      const minMs =
        range === '24h'
          ? nowMs - 24 * 3600 * 1000
          : range === '7d'
            ? nowMs - 7 * 24 * 3600 * 1000
            : range === '30d'
              ? nowMs - 30 * 24 * 3600 * 1000
              : 0

      const summaryRow =
        db
          .prepare(
            `SELECT
              COUNT(*) AS totalRequests,
              SUM(CASE WHEN failed = 0 AND canceled = 0 THEN 1 ELSE 0 END) AS successRequests,
              SUM(CASE WHEN failed != 0 OR canceled != 0 THEN 1 ELSE 0 END) AS failedRequests,
              COALESCE(SUM(input_tokens), 0) AS inputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens,
              COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
              COALESCE(SUM(cached_tokens + cache_read_tokens), 0) AS cachedTokens,
              COALESCE(SUM(total_tokens), 0) AS totalTokens,
              COALESCE(AVG(latency_ms), 0) AS avgLatencyMs
            FROM usage_events
            WHERE timestamp_ms >= ?`,
          )
          .get(minMs) || {}

      const byModel = db
        .prepare(
          `SELECT
            provider,
            model,
            COUNT(*) AS calls,
            SUM(CASE WHEN failed != 0 THEN 1 ELSE 0 END) AS failedCalls,
            COALESCE(SUM(input_tokens), 0) AS inputTokens,
            COALESCE(SUM(output_tokens), 0) AS outputTokens,
            COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
            COALESCE(SUM(cached_tokens + cache_read_tokens), 0) AS cachedTokens,
            COALESCE(SUM(total_tokens), 0) AS totalTokens,
            ROUND(COALESCE(AVG(latency_ms), 0)) AS avgLatencyMs
          FROM usage_events
          WHERE timestamp_ms >= ?
          GROUP BY provider, model
          ORDER BY totalTokens DESC, calls DESC
          LIMIT 25`,
        )
        .all(minMs)
        .map((row) => ({ ...row }))

      const byProvider = db
        .prepare(
          `SELECT
            provider,
            COUNT(*) AS calls,
            COALESCE(SUM(total_tokens), 0) AS totalTokens,
            COALESCE(SUM(input_tokens), 0) AS inputTokens,
            COALESCE(SUM(output_tokens), 0) AS outputTokens,
            COALESCE(SUM(cached_tokens + cache_read_tokens), 0) AS cachedTokens
          FROM usage_events
          WHERE timestamp_ms >= ?
          GROUP BY provider
          ORDER BY totalTokens DESC`,
        )
        .all(minMs)
        .map((row) => ({ ...row }))

      const hourlySeries = db
        .prepare(
          `SELECT
            local_hour AS hour,
            COUNT(*) AS calls,
            COALESCE(SUM(total_tokens), 0) AS totalTokens,
            COALESCE(SUM(input_tokens), 0) AS inputTokens,
            COALESCE(SUM(output_tokens), 0) AS outputTokens
          FROM usage_events
          WHERE timestamp_ms >= ?
          GROUP BY local_hour
          ORDER BY local_hour DESC
          LIMIT 24`,
        )
        .all(minMs)
        .map((row) => ({ ...row }))
        .reverse()

      const recentEvents = db
        .prepare(
          `SELECT
            timestamp,
            provider,
            model,
            response_model AS responseModel,
            latency_ms AS latencyMs,
            ttft_ms AS ttftMs,
            failed,
            input_tokens AS inputTokens,
            output_tokens AS outputTokens,
            reasoning_tokens AS reasoningTokens,
            (cached_tokens + cache_read_tokens) AS cachedTokens,
            total_tokens AS totalTokens
          FROM usage_events
          WHERE timestamp_ms >= ?
          ORDER BY timestamp_ms DESC
          LIMIT 25`,
        )
        .all(minMs)
        .map((row) => ({ ...row }))

      const inTok = Number(summaryRow.inputTokens || 0)
      const cacheTok = Number(summaryRow.cachedTokens || 0)
      return {
        available: true,
        dbPath,
        range,
        summary: {
          totalRequests: Number(summaryRow.totalRequests || 0),
          successRequests: Number(summaryRow.successRequests || 0),
          failedRequests: Number(summaryRow.failedRequests || 0),
          inputTokens: inTok,
          outputTokens: Number(summaryRow.outputTokens || 0),
          reasoningTokens: Number(summaryRow.reasoningTokens || 0),
          cachedTokens: cacheTok,
          totalTokens: Number(summaryRow.totalTokens || 0),
          avgLatencyMs: Math.round(Number(summaryRow.avgLatencyMs || 0)),
          cacheHitRate: inTok > 0 ? Math.min(100, Math.round((cacheTok / inTok) * 1000) / 10) : 0,
        },
        byModel,
        byProvider,
        hourlySeries,
        recentEvents,
      }
    } finally {
      db.close()
    }
  } catch (err) {
    return {
      available: false,
      dbPath,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function collectDesktopUsage({
  workspaceRoot = process.cwd(),
  packageRoot = process.cwd(),
  range = 'all',
} = {}) {
  const absWorkspace = resolve(workspaceRoot)
  const [activeTeams, archivedTeams] = await Promise.all([
    collectStudioTeams(absWorkspace, { archived: false }).catch(() => []),
    collectStudioTeams(absWorkspace, { archived: true }).catch(() => []),
  ])

  const allTeams = [
    ...activeTeams.map((t) => ({ ...t, isArchived: false })),
    ...archivedTeams.map((t) => ({ ...t, isArchived: true })),
  ]

  const usageRecordsDir = existsSync(join(absWorkspace, 'usage-records'))
    ? join(absWorkspace, 'usage-records')
    : join(resolve(packageRoot), 'usage-records')
  const agentUsageDir = existsSync(join(absWorkspace, 'agent-usage'))
    ? join(absWorkspace, 'agent-usage')
    : join(resolve(packageRoot), 'agent-usage')

  const usageRecords = []
  const allLoggedEvents = []
  if (existsSync(usageRecordsDir)) {
    try {
      const files = readdirSync(usageRecordsDir).filter((f) => f.endsWith('.json')).slice(-30)
      for (const file of files) {
        try {
          const parsed = JSON.parse(readFileSync(join(usageRecordsDir, file), 'utf8'))
          usageRecords.push({ file, ...parsed })
          if (Array.isArray(parsed?.events)) {
            allLoggedEvents.push(...parsed.events)
          }
        } catch {}
      }
    } catch {}
  }

  const modelDistribution = {}
  const providerDistribution = {}
  let totalTasks = 0
  let completedTasks = 0
  let inProgressTasks = 0
  let pendingTasks = 0
  let studioTotalCalls = 0
  let studioInputTokens = 0
  let studioOutputTokens = 0
  let studioReasoningTokens = 0
  let studioCachedTokens = 0
  let studioTotalTokens = 0

  const teamsTelemetry = []

  for (const team of allTeams) {
    const teamKey = team.teamId || team.id || 'unknown-team'
    const memberByName = new Map((team.members ?? []).map((m) => [m.name, m]))
    const teamMembersStats = new Map()
    const teamModelsStats = new Map()
    const tasksBreakdown = []

    let teamCalls = 0
    let teamInput = 0
    let teamOutput = 0
    let teamReasoning = 0
    let teamCached = 0
    let teamTotal = 0
    let teamLatencySum = 0
    let teamCompletedCount = 0

    for (const member of team.members ?? []) {
      const prov = member.provider || 'cliproxyapi'
      const mod = member.model || 'gpt-6.1-sol'
      providerDistribution[prov] = (providerDistribution[prov] ?? 0) + 1
      modelDistribution[`${prov}/${mod}`] = (modelDistribution[`${prov}/${mod}`] ?? 0) + 1
      teamMembersStats.set(member.name, {
        name: member.name,
        role: member.role || '成员',
        provider: prov,
        model: mod,
        calls: 0,
        completedTasks: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
        avgLatencyMs: 0,
        _latSum: 0,
      })
    }

    for (const task of team.tasks ?? []) {
      totalTasks += 1
      const state = task.state || task.status || 'pending'
      if (state === 'completed') {
        completedTasks += 1
        teamCompletedCount += 1
      } else if (state === 'in_progress') {
        inProgressTasks += 1
      } else {
        pendingTasks += 1
      }

      const assignedMember = task.assignee ? memberByName.get(task.assignee) : team.members?.[0]
      const prov = task.usage?.provider || assignedMember?.provider || 'cliproxyapi'
      const mod = task.usage?.model || assignedMember?.model || 'gpt-6.1-sol'
      const routeKey = `${prov}/${mod}`

      if (task.assignee && memberByName.has(task.assignee)) {
        modelDistribution[routeKey] = (modelDistribution[routeKey] ?? 0) + 1
      }

      // Compute or extract task token telemetry
      const hasExplicitUsage = task.usage && typeof task.usage === 'object'
      const isExecuted = state === 'completed' || state === 'failed' || hasExplicitUsage
      let inTok = 0
      let outTok = 0
      let reasTok = 0
      let cacheTok = 0
      let totTok = 0
      let latMs = 0
      let estimated = false

      if (hasExplicitUsage) {
        inTok = Number(task.usage.inputTokens ?? 0)
        outTok = Number(task.usage.outputTokens ?? 0)
        reasTok = Number(task.usage.reasoningTokens ?? 0)
        cacheTok = Number(task.usage.cachedTokens ?? 0)
        totTok = Number(task.usage.totalTokens ?? inTok + outTok)
        latMs = Number(task.usage.latencyMs ?? 0)
      } else if (isExecuted) {
        // Fallback estimation for historical tasks completed before telemetry v2.0
        estimated = true
        const promptChars =
          String(task.subject || '').length +
          String(task.description || '').length +
          String(task.objective || '').length +
          1800
        const outChars = String(task.summary || '').length + 600
        inTok = Math.ceil(promptChars / 3.5)
        outTok = Math.ceil(outChars / 3.5)
        reasTok = /argon|hydrogen|thinking|sol/i.test(mod) ? Math.ceil(outTok * 0.35) : 0
        cacheTok = Math.ceil(inTok * 0.45)
        totTok = inTok + outTok + reasTok
        latMs = 3200
      }

      if (isExecuted) {
        teamCalls += 1
        teamInput += inTok
        teamOutput += outTok
        teamReasoning += reasTok
        teamCached += cacheTok
        teamTotal += totTok
        teamLatencySum += latMs

        const mStat = teamMembersStats.get(task.assignee || assignedMember?.name || 'unassigned')
        if (mStat) {
          mStat.calls += 1
          if (state === 'completed') mStat.completedTasks += 1
          mStat.inputTokens += inTok
          mStat.outputTokens += outTok
          mStat.reasoningTokens += reasTok
          mStat.cachedTokens += cacheTok
          mStat.totalTokens += totTok
          mStat._latSum += latMs
          mStat.avgLatencyMs = Math.round(mStat._latSum / mStat.calls)
        }

        const curMod = teamModelsStats.get(routeKey) || {
          route: routeKey,
          provider: prov,
          model: mod,
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cachedTokens: 0,
          totalTokens: 0,
        }
        curMod.calls += 1
        curMod.inputTokens += inTok
        curMod.outputTokens += outTok
        curMod.reasoningTokens += reasTok
        curMod.cachedTokens += cacheTok
        curMod.totalTokens += totTok
        teamModelsStats.set(routeKey, curMod)
      }

      tasksBreakdown.push({
        id: task.id,
        subject: task.subject,
        assignee: task.assignee || assignedMember?.name || '—',
        status: state,
        provider: prov,
        model: mod,
        inputTokens: inTok,
        outputTokens: outTok,
        reasoningTokens: reasTok,
        cachedTokens: cacheTok,
        totalTokens: totTok,
        latencyMs: latMs,
        estimated,
      })
    }

    studioTotalCalls += teamCalls
    studioInputTokens += teamInput
    studioOutputTokens += teamOutput
    studioReasoningTokens += teamReasoning
    studioCachedTokens += teamCached
    studioTotalTokens += teamTotal

    teamsTelemetry.push({
      teamId: teamKey,
      teamName: team.name || teamKey,
      goal: team.goal || team.description || '',
      phase: team.phase || 'running',
      isArchived: Boolean(team.isArchived),
      totalTasks: (team.tasks ?? []).length,
      completedTasks: teamCompletedCount,
      totalCalls: teamCalls,
      inputTokens: teamInput,
      outputTokens: teamOutput,
      reasoningTokens: teamReasoning,
      cachedTokens: teamCached,
      totalTokens: teamTotal,
      avgLatencyMs: teamCalls > 0 ? Math.round(teamLatencySum / teamCalls) : 0,
      membersBreakdown: [...teamMembersStats.values()].map(({ _latSum, ...rest }) => rest),
      modelsBreakdown: [...teamModelsStats.values()].sort((a, b) => b.totalTokens - a.totalTokens),
      tasksBreakdown,
    })
  }

  const agentUsageFiles = existsSync(agentUsageDir)
    ? readdirSync(agentUsageDir).filter((f) => !f.startsWith('.'))
    : []

  const cpaNativeTelemetry = readCpaNativeSqliteTelemetry({
    workspaceRoot: absWorkspace,
    packageRoot,
    range,
  })

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    range,
    summary: {
      totalTeams: allTeams.length,
      activeTeams: activeTeams.length,
      archivedTeams: archivedTeams.length,
      totalTasks,
      completedTasks,
      inProgressTasks,
      pendingTasks,
      studioTotalCalls,
      studioInputTokens,
      studioOutputTokens,
      studioReasoningTokens,
      studioCachedTokens,
      studioTotalTokens,
    },
    totalCpaCalls: cpaNativeTelemetry.available
      ? cpaNativeTelemetry.summary.totalRequests
      : studioTotalCalls,
    teamsTelemetry,
    cpaNativeTelemetry,
    modelDistribution,
    providerDistribution,
    usageRecords,
    recentStudioEvents: allLoggedEvents.slice(-30).reverse(),
    agentUsageFiles,
  }
}

export function recordUsageSnapshot({
  workspaceRoot = process.cwd(),
  teamId,
  teamName,
  taskId,
  taskSubject,
  member,
  provider,
  model,
  status = 'completed',
  usage = {},
} = {}) {
  try {
    const absWorkspace = resolve(workspaceRoot)
    const { config } = readDesktopConfig({ workspaceRoot: absWorkspace, packageRoot: absWorkspace })
    if (!config['usage-statistics-enabled']) return
    const recordsDir = join(absWorkspace, 'usage-records')
    const agentDir = join(absWorkspace, 'agent-usage')
    mkdirSync(recordsDir, { recursive: true })
    mkdirSync(agentDir, { recursive: true })
    const now = new Date()
    const dayKey = now.toISOString().slice(0, 10)
    const snapshotPath = join(recordsDir, `usage-${dayKey}.json`)
    let existing = {
      date: dayKey,
      totalCalls: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      byModel: {},
      byTeam: {},
      events: [],
    }
    if (existsSync(snapshotPath)) {
      try {
        existing = { ...existing, ...JSON.parse(readFileSync(snapshotPath, 'utf8')) }
      } catch {}
    }
    const routeKey = `${provider || 'cliproxyapi'}/${model || 'gpt-6.1-sol'}`
    const inTok = Number(usage?.inputTokens ?? 0)
    const outTok = Number(usage?.outputTokens ?? 0)
    const reasTok = Number(usage?.reasoningTokens ?? 0)
    const cacheTok = Number(usage?.cachedTokens ?? 0)
    const totTok = Number(usage?.totalTokens ?? inTok + outTok)

    existing.totalCalls = (existing.totalCalls || 0) + 1
    existing.inputTokens = (existing.inputTokens || 0) + inTok
    existing.outputTokens = (existing.outputTokens || 0) + outTok
    existing.reasoningTokens = (existing.reasoningTokens || 0) + reasTok
    existing.cachedTokens = (existing.cachedTokens || 0) + cacheTok
    existing.totalTokens = (existing.totalTokens || 0) + totTok

    existing.byModel = existing.byModel || {}
    existing.byModel[routeKey] = (existing.byModel[routeKey] ?? 0) + 1

    if (teamId) {
      existing.byTeam = existing.byTeam || {}
      const prevTeam = existing.byTeam[teamId] || { calls: 0, totalTokens: 0 }
      existing.byTeam[teamId] = {
        teamName: teamName || prevTeam.teamName || teamId,
        calls: (prevTeam.calls || 0) + 1,
        totalTokens: (prevTeam.totalTokens || 0) + totTok,
      }
    }

    existing.events = Array.isArray(existing.events) ? existing.events.slice(-99) : []
    existing.events.push({
      timestamp: now.toISOString(),
      teamId,
      teamName,
      taskId,
      taskSubject,
      member,
      route: routeKey,
      provider: provider || 'cliproxyapi',
      model: model || 'gpt-6.1-sol',
      inputTokens: inTok,
      outputTokens: outTok,
      reasoningTokens: reasTok,
      cachedTokens: cacheTok,
      totalTokens: totTok,
      latencyMs: Number(usage?.latencyMs ?? 0),
      status,
    })
    writeFileSync(snapshotPath, JSON.stringify(existing, null, 2), 'utf8')
  } catch {}
}

export function getStudioCoreRuntimeInfo() {
  return {
    pid: process.pid,
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: PROCESS_STARTED_AT,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  }
}
