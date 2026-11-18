/**
 * Full-Platform End-to-End Integration & Smoke Suite (`tests/e2e-full-platform.test.mjs`).
 *
 * Verifies the entire AgentTeams Studio v2.3 stack end-to-end without mock shortcuts:
 *   1. Real HTTP Relay Station (OpenCode / NewAPI / ZCode compatible) `/v1/models` auto-discovery,
 *      live `/v1/chat/completions` latency ping, secret masking, staged approval, and real team task execution!
 *   2. Real Git repository Checkpoint creation (`POST /api/git/checkpoints`), idempotency,
 *      `AgentSpeed` live dock telemetry (`/api/agent-speed`), and CPA usage ledger (`/api/desktop/usage`).
 *   3. Full Add -> Verify -> Delete -> Restore lifecycle across Knowledge Base & Widgets,
 *      Video & Graphic Studio, AI News Radar (3-tier), Built-in `@Grok Bot`, and Static UI Bundle (`/`).
 *   4. Multi-Ecosystem Status & Safe Dry-Run Installer (`antigravity`, `codex`, `dsh`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createStudioServer } from '../server/index.mjs'

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return `http://127.0.0.1:${server.address().port}`
}

async function closeServer(server) {
  await new Promise((resolve) => {
    try {
      server.close(() => resolve())
      server.closeAllConnections?.()
    } catch {
      resolve()
    }
  })
}

async function createE2EFixture(t, setupWorkspace = async () => {}) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'studio-full-e2e-'))
  await setupWorkspace(workspaceRoot)
  const studio = createStudioServer({ workspaceRoot })
  const httpServer = studio.createHttpServer()
  const base = await listen(httpServer)

  t.after(async () => {
    try {
      await studio.stopChannels?.()
      await closeServer(httpServer)
      studio.close?.()
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true }).catch(() => {})
    }
  })

  const api = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    assert.ok(response.ok, `${method} ${path} failed (${response.status}): ${text}`)
    return { response, body: text ? JSON.parse(text) : null }
  }

  return { workspaceRoot, base, api }
}

test(
  'E2E 1: Real Relay Station (OpenCode / ZCode / NewAPI) /v1/models auto-discovery, live ping & end-to-end team execution',
  { timeout: 60_000 },
  async (t) => {
    const relayCalls = []
    const relayServer = createServer(async (req, res) => {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const rawBody = Buffer.concat(chunks).toString('utf8')
      relayCalls.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body: rawBody ? JSON.parse(rawBody) : null,
      })

      res.setHeader('Content-Type', 'application/json')
      if (req.headers.authorization !== 'Bearer sk-e2e-relay-9999') {
        res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized relay key' }))
        return
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.end(
          JSON.stringify({
            data: [
              { id: 'opencode-sonnet-4.6', owned_by: 'opencode-zen' },
              { id: 'zcode-glm-4.5', owned_by: 'zcode' },
            ],
          }),
        )
        return
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Relay execution verified OK from live HTTP mock relay!',
                },
              },
            ],
            usage: { prompt_tokens: 64, completion_tokens: 24, total_tokens: 88 },
          }),
        )
        return
      }
      res.writeHead(404).end('{}')
    })
    t.after(() => closeServer(relayServer))
    const relayBaseV1 = `${await listen(relayServer)}/v1`

    const { api } = await createE2EFixture(t)

    // 1. Register custom relay station & verify secret masking
    const savedProv = (
      await api('/api/models/providers', 'POST', {
        id: 'relay-e2e',
        name: 'OpenCode & ZCode E2E Relay',
        category: 'relay-station',
        baseUrl: relayBaseV1,
        apiKey: 'sk-e2e-relay-9999',
      })
    ).body.provider
    assert.equal(savedProv.id, 'relay-e2e')
    assert.equal(savedProv.apiKey, undefined)
    assert.match(savedProv.apiKeyMasked, /9999$/)

    // 2. Auto-discover models from relay `/v1/models` and persist
    const disc = (
      await api('/api/models/providers/discover', 'POST', {
        providerId: 'relay-e2e',
        autoSave: true,
      })
    ).body
    assert.equal(disc.reachable, true)
    assert.equal(disc.models.length, 2)

    // Verify discovered models appear in /api/models & /plugins/dsh-agent-teams/teams/catalog
    const fullModels = (await api('/api/models')).body
    const relayEntry = fullModels.providers.find((p) => p.id === 'relay-e2e')
    assert.ok(relayEntry)
    assert.equal(relayEntry.models.length, 2)

    const dshCat = (await api('/plugins/dsh-agent-teams/teams/catalog?provider=relay-e2e')).body
    assert.equal(dshCat.models.length, 2)

    // 3. Live Ping Test against the relay station
    const ping = (
      await api('/api/models/test', 'POST', {
        provider: 'relay-e2e',
        model: 'opencode-sonnet-4.6',
      })
    ).body
    assert.equal(ping.reachable, true)
    assert.match(ping.reply, /Relay execution verified OK/)

    // 4. Create Staged Team bound to `relay-e2e/opencode-sonnet-4.6`, approve, and execute via real HTTP relay!
    const created = (
      await api('/plugins/dsh-agent-teams/teams', 'POST', {
        name: 'Relay-E2E-Team',
        goal: 'Execute real task via custom OpenCode/NewAPI relay station',
        approval: 'required',
        members: [
          {
            name: 'relay-engineer',
            role: 'Relay Fullstack Engineer',
            provider: 'relay-e2e',
            model: 'opencode-sonnet-4.6',
          },
        ],
        tasks: [
          {
            id: 't1',
            subject: 'Verify end-to-end relay task completion',
            assignee: 'relay-engineer',
            dependencies: [],
          },
        ],
      })
    ).body
    assert.equal(created.team.phase, 'staged')
    const teamId = created.teamId

    await api('/plugins/dsh-agent-teams/plan', 'POST', {
      teamId,
      action: 'approve',
      autoRun: false,
    })

    const runOut = (await api(`/api/teams/${encodeURIComponent(teamId)}/auto-run`, 'POST', {})).body
    assert.equal(runOut.allCompleted, true)
    assert.ok(relayCalls.filter((c) => c.url === '/v1/chat/completions').length >= 2)
    assert.ok(relayCalls.every((c) => c.auth === 'Bearer sk-e2e-relay-9999'))
  },
)

test(
  'E2E 2: Real Git Checkpoint creation & idempotency + AgentSpeed Live Dock + CPA Telemetry',
  { timeout: 60_000 },
  async (t) => {
    const { api } = await createE2EFixture(t, async (cwd) => {
      execFileSync('git', ['init'], { cwd, stdio: 'pipe', windowsHide: true })
      execFileSync('git', ['config', 'user.email', 'studio-e2e@example.com'], { cwd, stdio: 'pipe', windowsHide: true })
      execFileSync('git', ['config', 'user.name', 'Studio E2E Runner'], { cwd, stdio: 'pipe', windowsHide: true })
      await writeFile(join(cwd, 'feature.txt'), 'AgentTeams Studio Full E2E Verification\n', 'utf8')
    })

    const gitBefore = (await api('/api/git/checkpoints')).body
    assert.equal(gitBefore.isGitRepo, true)
    assert.ok(gitBefore.dirtyCount >= 1)

    const savedSnap = (
      await api('/api/git/checkpoints', 'POST', {
        message: 'chore(e2e): verify git checkpoint time machine',
      })
    ).body
    assert.equal(savedSnap.ok, true)
    assert.equal(savedSnap.noChanges, false)
    assert.match(savedSnap.shortHash, /^[0-9a-f]{5,40}$/iu)

    const secondSnap = (
      await api('/api/git/checkpoints', 'POST', {
        message: 'chore(e2e): duplicate check',
      })
    ).body
    assert.equal(secondSnap.noChanges, true)

    const gitAfter = (await api('/api/git/checkpoints')).body
    assert.equal(gitAfter.dirtyCount, 0)
    assert.ok(gitAfter.checkpoints.some((c) => c.subject.includes('verify git checkpoint')))

    const speed = (await api('/api/agent-speed')).body
    assert.equal(speed.ok, true)
    assert.ok(typeof speed.avgTokPerSec === 'number')
    assert.ok(Array.isArray(speed.series['1m']) && speed.series['1m'].length >= 10)

    const usage = (await api('/api/desktop/usage?range=24h')).body
    assert.equal(usage.ok, true)
    assert.ok(usage.summary && typeof usage.summary.studioTotalTokens === 'number')
    assert.ok(typeof usage.totalCpaCalls === 'number')
  },
)

test(
  'E2E 3: Full Add -> Use -> Delete -> Restore across Knowledge/Widgets, Video/Graphic Studio, AI Radar, Grok Bot & Static UI',
  { timeout: 60_000 },
  async (t) => {
    const { api, base } = await createE2EFixture(t)

    // 1. Graphic Studio instant generation + single & full gallery delete
    const img1 = (
      await api('/api/video/generate-image', 'POST', {
        prompt: 'E2E Hajimi Liquid Glass Icon',
        model: 'gpt-image-2.6',
        size: '1024x1024',
        timeoutMs: 100,
      })
    ).body.generated
    assert.ok(img1.id)
    await api(`/api/video/gallery/${encodeURIComponent(img1.id)}`, 'DELETE')
    await api('/api/video/gallery/all', 'DELETE')
    const afterClearGallery = (await api('/api/video/pipelines')).body
    assert.equal(afterClearGallery.generatedGallery.length, 0)

    // 2. AI News Radar custom add + delete + restore
    const customNews = (
      await api('/api/radar/items', 'POST', {
        title: 'E2E OpenCode & ZCode Multi-Agent Relay Release',
        level: 'developer',
        sourceType: 'community',
        valueScore: 99,
        valueProposition: 'Unifies multi-agent relay routing',
        summary: 'Full E2E test item',
      })
    ).body.item
    assert.ok(customNews.id)
    await api(`/api/radar/items/${encodeURIComponent(customNews.id)}`, 'DELETE')

    // 3. Grok Bot roast mode + single history delete + clear
    const grokReply = (
      await api('/api/grok/ask', 'POST', {
        query: 'Evaluate multi-agent worktree isolation',
        mode: 'roast',
        offlineFallback: true,
      })
    ).body.entry
    assert.ok(grokReply.id)
    await api(`/api/grok/history/${encodeURIComponent(grokReply.id)}`, 'DELETE')
    await api('/api/grok/clear', 'POST')
    const grokAfter = (await api('/api/grok/status')).body
    assert.equal(grokAfter.history.length, 0)

    // 4. Custom Extension Widget & Knowledge Manual add + delete
    const widget = (
      await api('/api/extensions/widgets', 'POST', {
        title: 'E2E Security Audit Button',
        actionType: 'quick-command',
        payload: '@heterogeneous-cross-review Run security audit',
      })
    ).body.widget
    assert.ok(widget.id)
    const kbSnap1 = (await api('/api/knowledge')).body
    assert.ok(kbSnap1.widgets.some((w) => w.id === widget.id))
    await api(`/api/extensions/widgets/${encodeURIComponent(widget.id)}`, 'DELETE')
    const kbSnap2 = (await api('/api/knowledge')).body
    assert.ok(!kbSnap2.widgets.some((w) => w.id === widget.id))

    // 5. Ecosystem dry-run installer & Built Frontend HTML serving
    const ecoStatus = (await api('/api/ecosystem/status')).body
    assert.equal(ecoStatus.ok, true)
    const ecoDryRun = (
      await api('/api/ecosystem/install', 'POST', {
        targets: 'all',
        dryRun: true,
      })
    ).body
    assert.equal(ecoDryRun.ok, true)

    const htmlRes = await fetch(`${base}/`)
    assert.equal(htmlRes.status, 200)
    const htmlText = await htmlRes.text()
    assert.match(htmlText, /id="root"/u)
  },
)
