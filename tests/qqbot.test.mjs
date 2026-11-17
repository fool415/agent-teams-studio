import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { QQGateway, splitReplyText } from '../channels/qqbot/qq-gateway.mjs'
import { createQQStore } from '../channels/qqbot/qq-store.mjs'
import { createQQRemoteService, matchModelChoice } from '../channels/qqbot/qq-remote-service.mjs'
import { resolveReasoningPlan, runCpaChatCompletion } from '../server/cpa-client.mjs'
import { createStudioServer } from '../server/index.mjs'

class FakeWebSocket extends EventTarget {
  constructor(url) {
    super()
    this.url = url
    this.readyState = 1
    this.sent = []
    this.closedWith = null
  }
  send(data) {
    this.sent.push(JSON.parse(data))
  }
  close(code = 1000, reason = '') {
    this.readyState = 3
    this.closedWith = { code, reason }
  }
  emitServerPacket(packet) {
    const ev = new MessageEvent('message', { data: JSON.stringify(packet) })
    this.dispatchEvent(ev)
  }
  emitServerClose(code, reason = '') {
    this.readyState = 3
    const ev = new Event('close')
    ev.code = code
    ev.reason = reason
    this.dispatchEvent(ev)
  }
}

class FakeGatewayDouble extends EventEmitter {
  constructor({ appId = 'app-test' } = {}) {
    super()
    this.appId = appId
    this.state = 'offline'
    this.sentMessages = []
    this.typingCalls = []
  }
  getStatus() {
    return {
      state: this.state,
      appId: this.appId,
      botUser: { username: 'HajimiTestBot', id: 'bot-1' },
      sessionId: 'sess-1',
      lastConnectedAt: new Date().toISOString(),
      lastError: null,
      reconnectAttempt: 0,
    }
  }
  async start() {
    this.state = 'online'
    this.emit('ready', { session_id: 'sess-1', user: { username: 'HajimiTestBot' } })
  }
  stop() {
    this.state = 'offline'
  }
  async sendText(target, content, opts = {}) {
    this.sentMessages.push({ target, content, opts })
    return { id: `out-${this.sentMessages.length}` }
  }
  async sendTyping(openid, msgId, sec) {
    this.typingCalls.push({ openid, msgId, sec })
    return null
  }
  async sendFile(target, localPath, opts = {}) {
    this.sentMessages.push({ target, file: localPath, opts })
    return { id: `file-${this.sentMessages.length}` }
  }
}

async function apiJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  const text = await res.text()
  return { status: res.status, ok: res.ok, body: text ? JSON.parse(text) : {} }
}

test('splitReplyText preserves Unicode emojis and closes/reopens fenced code blocks cleanly', () => {
  const longCode = '前导说明🚀✨\n```js\n' + 'const x = 1234567890;\n'.repeat(12) + '```\n结尾说明'
  const chunks = splitReplyText(longCode, 120)
  assert.ok(chunks.length >= 2)
  for (const chunk of chunks) {
    assert.ok(Array.from(chunk).length <= 120, `chunk exceeded maxChars: ${Array.from(chunk).length}`)
    const fenceCount = (chunk.match(/```/g) || []).length
    assert.equal(fenceCount % 2, 0, `unbalanced code fence in chunk:\n${chunk}`)
  }
})

test('QQGateway handles token caching, HELLO->IDENTIFY->READY, inbound normalization, msg_seq, and fatal close', async () => {
  const wsInstances = []
  const apiCalls = []
  let tokenCalls = 0

  const fetchImpl = async (url, init = {}) => {
    const u = String(url)
    if (u.endsWith('/getAppAccessToken')) {
      tokenCalls += 1
      return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 7200 }), { status: 200 })
    }
    if (u.endsWith('/gateway')) {
      return new Response(JSON.stringify({ url: 'wss://mock.qq.test/ws' }), { status: 200 })
    }
    apiCalls.push({ url: u, method: init.method, body: init.body ? JSON.parse(init.body) : null })
    return new Response(JSON.stringify({ id: 'msg-out-1' }), { status: 200 })
  }

  const gw = new QQGateway({
    appId: '102030',
    clientSecret: 'secret-xyz',
    fetchImpl,
    wsFactory: (url) => {
      const ws = new FakeWebSocket(url)
      wsInstances.push(ws)
      return ws
    },
  })

  const inbounds = []
  let fatalEvent = null
  gw.on('inbound', (msg) => inbounds.push(msg))
  gw.on('fatal', (ev) => { fatalEvent = ev })

  await gw.start()
  assert.equal(wsInstances.length, 1)
  const ws = wsInstances[0]
  ws.emitServerPacket({ op: 10, d: { heartbeat_interval: 60000 } })
  assert.equal(ws.sent[0].op, 2)
  assert.equal(ws.sent[0].d.token, 'QQBot tok-1')

  ws.emitServerPacket({ op: 0, s: 1, t: 'READY', d: { session_id: 's-100', user: { username: 'BotA' } } })
  assert.equal(gw.getStatus().state, 'online')

  ws.emitServerPacket({
    op: 0,
    s: 2,
    t: 'GROUP_AT_MESSAGE_CREATE',
    d: {
      id: 'in-msg-1',
      group_openid: 'grp-1',
      content: ' <@!999>   /model hydrogen  ',
      author: { member_openid: 'usr-1', username: 'Alice' },
    },
  })

  assert.equal(inbounds.length, 1)
  assert.equal(inbounds[0].kind, 'group')
  assert.equal(inbounds[0].senderId, 'usr-1')
  assert.equal(inbounds[0].groupOpenid, 'grp-1')
  assert.equal(inbounds[0].content, '/model hydrogen  ')

  await gw.sendText(inbounds[0].replyTarget, 'hello 1')
  await gw.sendText(inbounds[0].replyTarget, 'hello 2')
  assert.equal(apiCalls.length, 2)
  assert.equal(apiCalls[0].body.msg_id, 'in-msg-1')
  assert.equal(apiCalls[0].body.msg_seq, 1)
  assert.equal(apiCalls[1].body.msg_id, 'in-msg-1')
  assert.equal(apiCalls[1].body.msg_seq, 2)
  assert.equal(tokenCalls, 1)

  ws.emitServerClose(4914, 'sandbox only')
  assert.ok(fatalEvent)
  assert.equal(gw.getStatus().state, 'fatal')
  gw.stop()
})

test('QQStore enforces secret masking, single-use pairing, strict group+user auth, dedupe, and workspace boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qq-store-test-'))
  const wsRoot = join(dir, 'workspace')
  const subDir = join(wsRoot, 'app')
  const outsideDir = join(dir, 'outside')
  mkdirSync(subDir, { recursive: true })
  mkdirSync(outsideDir, { recursive: true })

  const store = createQQStore({ dataDir: join(dir, 'db') })
  try {
    store.setAppSecret('super-secret-value-9999')
    store.updateConfig({
      appId: 'app-1',
      defaultWorkspace: wsRoot,
      allowedWorkspaces: [wsRoot],
    })
    const pub = store.getPublicConfig()
    assert.equal(pub.hasSecret, true)
    assert.equal(pub.secretPreview, '********')
    assert.equal(JSON.stringify(pub).includes('super-secret-value-9999'), false)

    // Pre-pairing authorization must deny
    assert.equal(store.authorizeActor({ kind: 'c2c', senderId: 'u1' }).allowed, false)

    const pair = store.createPairingCode()
    assert.equal(pair.code.length, 6)
    const consumed = store.consumePairingCode({ code: pair.code, senderId: 'u1', groupOpenid: 'g1' })
    assert.equal(consumed.ok, true)

    // Second consume must fail
    assert.equal(store.consumePairingCode({ code: pair.code, senderId: 'u2' }).ok, false)

    // Paired C2C user allowed; stranger in paired group still denied!
    assert.equal(store.authorizeActor({ kind: 'c2c', senderId: 'u1' }).allowed, true)
    assert.equal(store.authorizeActor({ kind: 'group', senderId: 'u1', groupOpenid: 'g1' }).allowed, true)
    assert.equal(store.authorizeActor({ kind: 'group', senderId: 'stranger', groupOpenid: 'g1' }).allowed, false)

    // Inbound dedupe
    assert.equal(store.tryRecordInbound('app-1:C2C:m1'), true)
    assert.equal(store.tryRecordInbound('app-1:C2C:m1'), false)

    // Workspace path guard
    const okPath = store.resolveAllowedCwd('app', wsRoot)
    assert.ok(okPath.endsWith('app'))
    assert.throws(() => store.resolveAllowedCwd(outsideDir, wsRoot), /不在授权范围内/)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runCpaChatCompletion passes reasoning_effort and cleanly falls back xhigh -> high only on parameter rejection', async () => {
  const seenPayloads = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    seenPayloads.push(body)

    if (body.reasoning_effort === 'xhigh') {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'unsupported_value for reasoning_effort: xhigh' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        model: body.model,
        choices: [{ message: { content: 'fallback ok' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    )
  })

  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  try {
    const plan = resolveReasoningPlan('gpt-6.1-sol', '极致')
    assert.equal(plan.effectiveEffort, 'xhigh')

    const res = await runCpaChatCompletion({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'gpt-6.1-sol',
      reasoningEffort: 'xhigh',
      messages: [{ role: 'user', content: 'ping' }],
    })
    assert.equal(res.content, 'fallback ok')
    assert.equal(res.effectiveEffort, 'high')
    assert.equal(res.effortFallbackUsed, true)
    assert.equal(seenPayloads.length, 2)
    assert.equal(seenPayloads[0].reasoning_effort, 'xhigh')
    assert.equal(seenPayloads[1].reasoning_effort, 'high')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('End-to-end QQ Remote Control via Studio HTTP API supports pairing, model/effort switching, direct sandbox, cancel, and team approval', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-qqbot-e2e-'))
  const subProject = join(workDir, 'subproj')
  mkdirSync(subProject, { recursive: true })

  let fakeGw = null
  let directResolveGate = null
  const recordedDirectCalls = []

  const studio = createStudioServer({
    workspaceRoot: workDir,
    cpaBaseUrl: 'http://127.0.0.1:1/v1',
    qqbotDataDir: join(workDir, '.qqbot-e2e'),
    qqbotGatewayFactory: (opts) => {
      fakeGw = new FakeGatewayDouble(opts)
      return fakeGw
    },
    mockExecutor: async (ctx) => {
      if (ctx.mode === 'direct') {
        recordedDirectCalls.push({ model: ctx.model, reasoningEffort: ctx.reasoningEffort })
        const lastUserMsg = [...ctx.messages].reverse().find((m) => m.role === 'user')?.content || ''
        if (lastUserMsg.includes('慢任务')) {
          return await new Promise((resolvePromise, rejectPromise) => {
            directResolveGate = resolvePromise
            ctx.signal?.addEventListener('abort', () => rejectPromise(new Error('任务已被用户取消')), { once: true })
          })
        }
        await ctx.onToolCall('write_file', { path: 'remote-output.txt', content: 'created via QQ\n' })
        return {
          content: '已在工作区落地 remote-output.txt',
          model: ctx.model,
          effectiveEffort: ctx.reasoningEffort || 'default',
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
          elapsedMs: 120,
          rounds: 1,
        }
      }
      // Team task mock
      return { content: `${ctx.member.name} 完成 ${ctx.task.id}` }
    },
  })

  const httpSrv = studio.createHttpServer()
  await new Promise((r) => httpSrv.listen(0, '127.0.0.1', r))
  const baseUrl = `http://127.0.0.1:${httpSrv.address().port}`

  try {
    // 1. Configure AppID & AppSecret + Workspace allowlist via HTTP API
    const cfgRes = await apiJson(`${baseUrl}/api/channels/qqbot/config`, {
      method: 'POST',
      body: JSON.stringify({
        appId: 'qq-app-998',
        appSecret: 'secret-token-abc123',
        defaultWorkspace: workDir,
        allowedWorkspaces: [workDir],
      }),
    })
    assert.equal(cfgRes.status, 200)
    assert.equal(cfgRes.body.config.hasSecret, true)
    assert.equal(JSON.stringify(cfgRes.body).includes('secret-token-abc123'), false)

    // 2. Connect Gateway & Generate Pairing Code
    const connRes = await apiJson(`${baseUrl}/api/channels/qqbot/connect`, { method: 'POST' })
    assert.equal(connRes.status, 200)
    assert.equal(connRes.body.gateway.state, 'online')
    assert.ok(fakeGw)

    const pairRes = await apiJson(`${baseUrl}/api/channels/qqbot/pairing-code`, { method: 'POST' })
    const code = pairRes.body.pairing.code
    assert.equal(code.length, 6)

    const makeInbound = (id, content) => ({
      rawEventType: 'C2C_MESSAGE_CREATE',
      kind: 'c2c',
      senderId: 'qq-owner-openid',
      messageId: id,
      content,
      replyTarget: { scope: 'c2c', targetId: 'qq-owner-openid', msgId: id, receivedAt: Date.now() },
    })

    // 3. Unauthorized message must be blocked
    await studio.qqRemote.handleInboundForTest(makeInbound('m1', '帮我删库'))
    assert.match(fakeGw.sentMessages.at(-1).content, /尚未授权/)

    // 4. Pair with one-time code
    await studio.qqRemote.handleInboundForTest(makeInbound('m2', `/pair ${code}`))
    assert.match(fakeGw.sentMessages.at(-1).content, /配对成功/)

    // 5. Select model, thinking level & cwd
    await studio.qqRemote.handleInboundForTest(makeInbound('m3', '/model hydrogen'))
    assert.match(fakeGw.sentMessages.at(-1).content, /hydrogen/)

    await studio.qqRemote.handleInboundForTest(makeInbound('m4', '/think xhigh'))
    assert.match(fakeGw.sentMessages.at(-1).content, /xhigh/)

    await studio.qqRemote.handleInboundForTest(makeInbound('m5', '/cwd subproj'))
    assert.match(fakeGw.sentMessages.at(-1).content, /subproj/)

    // 6. Execute Direct Mode task (natural language)
    await studio.qqRemote.handleInboundForTest(makeInbound('m6', '帮我生成一个文件'))
    await new Promise((r) => setTimeout(r, 80))
    const written = readFileSync(join(subProject, 'remote-output.txt'), 'utf8')
    assert.equal(written, 'created via QQ\n')
    assert.equal(recordedDirectCalls.at(-1).model, 'hydrogen')
    assert.equal(recordedDirectCalls.at(-1).reasoningEffort, 'xhigh')
    assert.match(fakeGw.sentMessages.at(-1).content, /任务完成/)

    // 7. Cancel running Direct task mid-flight
    await studio.qqRemote.handleInboundForTest(makeInbound('m7', '请执行慢任务'))
    await new Promise((r) => setTimeout(r, 40))
    await studio.qqRemote.handleInboundForTest(makeInbound('m8', '/cancel'))
    await new Promise((r) => setTimeout(r, 60))
    assert.ok(fakeGw.sentMessages.some((m) => m.content.includes('已中止')))
    void directResolveGate

    // 8. Switch to Team Mode, create staged team preview, and /approve
    await studio.qqRemote.handleInboundForTest(makeInbound('m9', '/mode team chatgpt-crew'))
    await studio.qqRemote.handleInboundForTest(makeInbound('m10', '构建远程状态面板'))
    await new Promise((r) => setTimeout(r, 60))
    const previewMsg = fakeGw.sentMessages.at(-1).content
    assert.match(previewMsg, /待审批团队/)
    const teamMatch = previewMsg.match(/\/approve\s+([^\s，。]+)/u)
    assert.ok(teamMatch, `expected /approve <teamId> in:\n${previewMsg}`)
    const createdTeamId = teamMatch[1]

    // Verify team stayed staged before /approve!
    const stateBefore = await apiJson(`${baseUrl}/plugins/dsh-agent-teams/state`)
    const stagedTeam = stateBefore.body.teams.find((t) => t.teamId === createdTeamId)
    assert.equal(stagedTeam.phase, 'staged')

    await studio.qqRemote.handleInboundForTest(makeInbound('m11', `/approve ${createdTeamId}`))
    await new Promise((r) => setTimeout(r, 200))
    assert.ok(fakeGw.sentMessages.some((m) => m.content.includes(`团队 [${createdTeamId}] 执行阶段结束`)))

    // 9. Sensitive files must be blocked by /sendfile
    await studio.qqRemote.handleInboundForTest(makeInbound('m12', '/sendfile .env'))
    assert.match(fakeGw.sentMessages.at(-1).content, /禁止通过 QQ 发送敏感凭证/)

    // 10. Prefer live CPA Antigravity model ID over abstract alias when both exist
    const picked = matchModelChoice('hydrogen', [
      { id: 'hydrogen', name: 'abstract' },
      { id: 'gemini-4-hydrogen-xhigh', name: 'gemini-4-hydrogen-xhigh' },
    ])
    assert.equal(picked?.id, 'gemini-4-hydrogen-xhigh')

    // 11. /model without args shows ALL models and allows direct numeric reply selection
    const callsBeforeMenu = recordedDirectCalls.length
    await studio.qqRemote.handleInboundForTest(makeInbound('m13', '/model'))
    const menuReply = fakeGw.sentMessages.at(-1).content
    assert.match(menuReply, /全部可用模型/)
    assert.match(menuReply, /1\.\s/)
    assert.match(menuReply, /直接回复数字序号/)

    // Out-of-range digit warns without executing a task
    await studio.qqRemote.handleInboundForTest(makeInbound('m14', '999'))
    assert.match(fakeGw.sentMessages.at(-1).content, /超出范围/)
    assert.equal(recordedDirectCalls.length, callsBeforeMenu)

    // Pure numeric reply '2' switches to model #2 without running a task
    await studio.qqRemote.handleInboundForTest(makeInbound('m15', '2'))
    assert.match(fakeGw.sentMessages.at(-1).content, /已切换为 \[2\]/)
    assert.equal(recordedDirectCalls.length, callsBeforeMenu)

    // Filtered /models + pure numeric reply picks from the filtered list
    await studio.qqRemote.handleInboundForTest(makeInbound('m16', '/models hydrogen'))
    assert.match(fakeGw.sentMessages.at(-1).content, /筛选「hydrogen」模型/)
    await studio.qqRemote.handleInboundForTest(makeInbound('m17', '1'))
    assert.match(fakeGw.sentMessages.at(-1).content, /已切换为 \[1\] hydrogen/)
    assert.equal(recordedDirectCalls.length, callsBeforeMenu)

    // /model followed by '0' cancels cleanly
    await studio.qqRemote.handleInboundForTest(makeInbound('m18', '/model'))
    await studio.qqRemote.handleInboundForTest(makeInbound('m19', '0'))
    assert.match(fakeGw.sentMessages.at(-1).content, /已取消模型选择/)
    assert.equal(recordedDirectCalls.length, callsBeforeMenu)

    // 12. Toggle replyDetail between concise (answer only, no ack/meta) and verbose
    await studio.qqRemote.handleInboundForTest(makeInbound('m19b', '/mode direct'))
    await studio.qqRemote.handleInboundForTest(makeInbound('m20', '/detail 简洁'))
    assert.match(fakeGw.sentMessages.at(-1).content, /简洁模式/)

    const msgCountBeforeConcise = fakeGw.sentMessages.length
    await studio.qqRemote.handleInboundForTest(makeInbound('m21', '简洁模式测试'))
    await new Promise((r) => setTimeout(r, 80))
    const conciseReplies = fakeGw.sentMessages.slice(msgCountBeforeConcise)
    assert.equal(conciseReplies.length, 1, 'concise mode should not send ack card before answer')
    assert.equal(conciseReplies[0].content, '已在工作区落地 remote-output.txt')

    await studio.qqRemote.handleInboundForTest(makeInbound('m22', '/详细'))
    assert.match(fakeGw.sentMessages.at(-1).content, /详细模式/)

    const msgCountBeforeVerbose = fakeGw.sentMessages.length
    await studio.qqRemote.handleInboundForTest(makeInbound('m23', '详细模式测试'))
    await new Promise((r) => setTimeout(r, 80))
    const verboseReplies = fakeGw.sentMessages.slice(msgCountBeforeVerbose)
    assert.equal(verboseReplies.length, 2, 'verbose mode should send ack card + detailed completion report')
    assert.match(verboseReplies[0].content, /已接单/)
    assert.match(verboseReplies[1].content, /任务完成/)
    assert.match(verboseReplies[1].content, /Token:/)
  } finally {
    await new Promise((r) => httpSrv.close(r))
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('/model lists >30 live CPA models without truncation and selects high index numbers', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-qqbot-models35-'))
  const mockModels = Array.from({ length: 35 }, (_, i) => ({
    id: `model-${String(i + 1).padStart(2, '0')}`,
    owned_by: i % 2 === 0 ? 'openai' : 'antigravity',
  }))
  const mockCpa = createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: mockModels }))
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((r) => mockCpa.listen(0, '127.0.0.1', r))
  const cpaPort = mockCpa.address().port

  let fakeGw = null
  const studio = createStudioServer({
    workspaceRoot: workDir,
    cpaBaseUrl: `http://127.0.0.1:${cpaPort}/v1`,
    qqbotDataDir: join(workDir, '.qqbot-m35'),
    qqbotGatewayFactory: (opts) => {
      fakeGw = new FakeGatewayDouble(opts)
      return fakeGw
    },
  })
  const httpSrv = studio.createHttpServer()
  await new Promise((r) => httpSrv.listen(0, '127.0.0.1', r))
  const baseUrl = `http://127.0.0.1:${httpSrv.address().port}`

  try {
    await apiJson(`${baseUrl}/api/channels/qqbot/config`, {
      method: 'POST',
      body: JSON.stringify({
        appId: 'qq-app-m35',
        appSecret: 'sec-m35',
        c2cPolicy: 'open',
        defaultWorkspace: workDir,
        allowedWorkspaces: [workDir],
      }),
    })
    await apiJson(`${baseUrl}/api/channels/qqbot/connect`, { method: 'POST' })
    const makeInbound = (id, content) => ({
      rawEventType: 'C2C_MESSAGE_CREATE',
      kind: 'c2c',
      senderId: 'qq-user-1',
      messageId: id,
      content,
      replyTarget: { scope: 'c2c', targetId: 'qq-user-1', msgId: id, receivedAt: Date.now() },
    })

    await studio.qqRemote.handleInboundForTest(makeInbound('a1', '/model'))
    const fullText = fakeGw.sentMessages.map((m) => m.content).join('\n')
    assert.match(fullText, /共 35 个/)
    assert.match(fullText, /35\. .*model-35/)

    await studio.qqRemote.handleInboundForTest(makeInbound('a2', '35'))
    assert.match(fakeGw.sentMessages.at(-1).content, /已切换为 \[35\] model-35/)
  } finally {
    await new Promise((r) => httpSrv.close(r))
    await new Promise((r) => mockCpa.close(r))
    rmSync(workDir, { recursive: true, force: true })
  }
})
