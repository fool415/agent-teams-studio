import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runCpaChatCompletion } from '../server/cpa-client.mjs'
import { buildTaskSystemPrompt } from '../server/cpa-runner.mjs'
import { buildOpsPromptInjection } from '../server/ops-knowledge.mjs'
import { createSandboxTools, resolveSafeWorkspacePath } from '../server/sandbox.mjs'
import { createStudioServer } from '../server/index.mjs'
import {
  cleanupTaskWorktree,
  ensureTaskWorktree,
  inspectWorktreeDiff,
  isGitRepo,
  mergeTaskWorktree,
} from '../server/worktree.mjs'

async function startTempServer(opts) {
  const studio = createStudioServer(opts)
  const server = studio.createHttpServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function apiJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  return { status: res.status, ok: res.ok, body }
}

test('mandatory staged approval gate blocks execution until approved, then CPA runner completes & populates inbox', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-studio-gate-'))
  let cpaMockCalls = 0
  const srv = await startTempServer({
    workspaceRoot: workDir,
    mockExecutor: async ({ task, member, sandbox }) => {
      cpaMockCalls += 1
      if (task.id === 't1') {
        await sandbox.executeTool('write_file', {
          path: 'src/hello.js',
          content: 'export const greeting = "hello studio";\n',
        })
        await sandbox.executeTool('run_command', {
          command: 'node -e "process.exit(0)"',
        })
        return { content: `${member.name} 已完成代码写入` }
      }
      return { content: `${member.name} 审查通过` }
    },
  })

  try {
    // 1. Create team -> MUST land in staged
    const createRes = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/teams`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'approval-gate-team',
        goal: '验证先审批后执行与 CPA gpt-6.1-sol 路由',
        approval: 'required',
        reuseSessionId: 'cap-1',
        members: [
          { name: 'dev-gpt', role: '核心开发', provider: 'codex', model: 'gpt-5' },
          { name: 'rev-gpt', role: '独立审查', provider: 'cliproxyapi', model: 'gpt-6.1-sol' },
        ],
        tasks: [
          {
            id: 't1',
            subject: '实现模块',
            assignee: 'dev-gpt',
            kind: 'implementation',
            objective: '写入 src/hello.js',
            inScope: ['src/'],
            acceptance: ['写入成功'],
            verify: ['node -e "process.exit(0)"'],
          },
          {
            id: 't2',
            subject: '独立审查',
            assignee: 'rev-gpt',
            dependencies: ['t1'],
            kind: 'review',
            reviewedTaskId: 't1',
            objective: '独立白盒审阅 t1',
            acceptance: ['结论通过'],
          },
        ],
      }),
    })
    assert.equal(createRes.status, 200)
    assert.equal(createRes.body.status, 'awaiting_approval')
    assert.equal(createRes.body.team.phase, 'staged')
    const teamId = createRes.body.teamId

    // 2. Execution MUST be blocked with 409 before user clicks approve
    const blockedRun = await apiJson(`${srv.baseUrl}/api/teams/${teamId}/run-next`, { method: 'POST', body: '{}' })
    assert.equal(blockedRun.status, 409)
    assert.equal(cpaMockCalls, 0)

    // 3. Plan edit (switch dev-gpt to cliproxyapi/gpt-6.1-sol)
    const editMember = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/plan`, {
      method: 'POST',
      body: JSON.stringify({
        teamId,
        action: 'update_member',
        memberName: 'dev-gpt',
        role: '主力 GPT-Sol 工程师',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
      }),
    })
    assert.equal(editMember.status, 200)

    // 4. Approve plan -> staged -> running
    const approveRes = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/plan`, {
      method: 'POST',
      body: JSON.stringify({ teamId, action: 'approve' }),
    })
    assert.equal(approveRes.status, 200)
    assert.equal(approveRes.body.team.phase, 'running')

    // 5. Auto-run ready tasks via runner
    const runRes = await apiJson(`${srv.baseUrl}/api/teams/${teamId}/auto-run`, { method: 'POST', body: '{}' })
    assert.equal(runRes.status, 200)
    assert.equal(runRes.body.allCompleted, true)
    assert.equal(cpaMockCalls, 2)

    const stateRes = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/state`)
    assert.equal(stateRes.status, 200)
    const teamSnap = stateRes.body.teams.find((t) => t.teamId === teamId)
    assert.equal(teamSnap.phase, 'running')
    assert.equal(teamSnap.tasks.every((t) => t.state === 'completed'), true)
    assert.equal(teamSnap.delivery.ok, true)
    assert.ok(teamSnap.captainInbox.length >= 2)
    assert.equal(teamSnap.members.find((m) => m.name === 'dev-gpt').model, 'gpt-6.1-sol')

    // 6. Mutating reviewed file after review pass triggers SHA256 verdictStale!
    writeFileSync(join(workDir, 'src/hello.js'), 'export const greeting = "tampered";\n', 'utf8')
    const staleStateRes = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/state`)
    const staleSnap = staleStateRes.body.teams.find((t) => t.teamId === teamId)
    const revTask = staleSnap.tasks.find((t) => t.id === 't2')
    assert.ok(revTask.verdictStale && revTask.verdictStale.length > 0)
    assert.equal(staleSnap.delivery.ok, false)

    // 7. Halt + Archive + Restore into staged
    const haltRes = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/halt`, {
      method: 'POST',
      body: JSON.stringify({ teamId }),
    })
    assert.equal(haltRes.status, 200)

    const delRes = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/teams/${teamId}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true, sessionId: 'cap-1' }),
    })
    assert.equal(delRes.status, 200)
    const archiveId = delRes.body.archiveId

    const archStateRes = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/state?archived=1`)
    assert.equal(archStateRes.body.teams.some((t) => t.teamId === teamId), true)

    const restoreRes = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/teams/${teamId}/restore`, {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'cap-1', archiveId }),
    })
    assert.equal(restoreRes.status, 200)
    assert.equal(restoreRes.body.phase, 'staged')
  } finally {
    await srv.close()
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('N-1 judgeConflictFor blocks self-review on the same author', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-studio-n1-'))
  const srv = await startTempServer({
    workspaceRoot: workDir,
    mockExecutor: async () => ({ content: 'ok' }),
  })
  try {
    // Creation-time N-1 self-review check
    const rejectedCreate = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/teams`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'n1-bad-create',
        goal: '验证 N-1 同人自审拦截',
        approval: 'required',
        reuseSessionId: 'cap-n1',
        members: [{ name: 'solo-dev', role: '全栈', provider: 'cliproxyapi', model: 'gpt-6.1-sol' }],
        tasks: [
          {
            id: 't1',
            subject: '编码',
            assignee: 'solo-dev',
            kind: 'implementation',
            objective: '编码',
            inScope: ['src/'],
            acceptance: ['ok'],
            verify: ['node -v'],
          },
          {
            id: 't2',
            subject: '自审（违规）',
            assignee: 'solo-dev',
            dependencies: ['t1'],
            kind: 'review',
            reviewedTaskId: 't1',
            objective: '自审',
            acceptance: ['ok'],
          },
        ],
      }),
    })
    assert.equal(rejectedCreate.status, 400)

    // Runtime N-1 check: create valid two-member team, reassign review task to author in staged plan, then run
    const createRes = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/teams`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'n1-conflict-team',
        goal: '验证运行时 N-1 同人自审拦截',
        approval: 'required',
        reuseSessionId: 'cap-n1',
        members: [
          { name: 'solo-dev', role: '全栈', provider: 'cliproxyapi', model: 'gpt-6.1-sol' },
          { name: 'other-rev', role: '审查', provider: 'antigravity', model: 'gemini-3.8-flash-tiered' },
        ],
        tasks: [
          {
            id: 't1',
            subject: '编码',
            assignee: 'solo-dev',
            kind: 'implementation',
            objective: '编码',
            inScope: ['src/'],
            acceptance: ['ok'],
            verify: ['node -v'],
          },
          {
            id: 't2',
            subject: '独立审查',
            assignee: 'other-rev',
            dependencies: ['t1'],
            kind: 'review',
            reviewedTaskId: 't1',
            objective: '审阅',
            acceptance: ['ok'],
          },
        ],
      }),
    })
    assert.equal(createRes.status, 200)
    const teamId = createRes.body.teamId
    const reassignRes = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/plan`, {
      method: 'POST',
      body: JSON.stringify({ teamId, action: 'update_task', taskId: 't2', assignee: 'solo-dev' }),
    })
    assert.equal(reassignRes.status, 200)

    await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/plan`, {
      method: 'POST',
      body: JSON.stringify({ teamId, action: 'approve' }),
    })
    // t1 passes
    const step1 = await apiJson(`${srv.baseUrl}/api/teams/${teamId}/run-next`, { method: 'POST', body: '{}' })
    assert.equal(step1.status, 200)
    // t2 MUST be rejected by N-1 judgeConflictFor with 409!
    const step2 = await apiJson(`${srv.baseUrl}/api/teams/${teamId}/run-next`, { method: 'POST', body: '{}' })
    assert.equal(step2.status, 409)
    assert.match(step2.body.error, /N-1|different|同一|author|assignee/i)
  } finally {
    await srv.close()
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('sandbox strictly blocks traversal, .agent-teams writes, .env writes, and outOfScope files', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-studio-sandbox-'))
  try {
    mkdirSync(join(workDir, '.agent-teams'), { recursive: true })
    assert.throws(() => resolveSafeWorkspacePath(workDir, '../escape.txt', { forWrite: false }))
    assert.throws(() => resolveSafeWorkspacePath(workDir, '.agent-teams/foo/team.json', { forWrite: true }))
    assert.throws(() => resolveSafeWorkspacePath(workDir, '.env.local', { forWrite: true }))
    assert.throws(() => resolveSafeWorkspacePath(workDir, 'secrets/api.key', { forWrite: true }))

    const tools = createSandboxTools(workDir, { outOfScope: ['docs/'] })
    await assert.rejects(() => tools.executeTool('write_file', { path: 'docs/locked.md', content: 'no' }))
    const writeOk = await tools.executeTool('write_file', { path: 'src/ok.txt', content: 'safe content' })
    assert.equal(writeOk.ok, true)
    assert.equal(readFileSync(join(workDir, 'src/ok.txt'), 'utf8'), 'safe content')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('OpenAI/EasyCLIProxyAPI client handles /models and tool-calling chat completions', async () => {
  let reqCount = 0
  const mockCpa = createServer(async (req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: [{ id: 'gpt-6.1-sol', owned_by: 'cliproxyapi' }] }))
    }
    if (req.url === '/v1/chat/completions') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      reqCount += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      if (reqCount === 1) {
        assert.equal(body.model, 'gpt-6.1-sol')
        return res.end(
          JSON.stringify({
            model: 'gpt-6.1-sol',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'list_dir', arguments: '{"path":"."}' },
                    },
                  ],
                },
              },
            ],
          }),
        )
      }
      return res.end(
        JSON.stringify({
          model: 'gpt-6.1-sol',
          choices: [{ message: { role: 'assistant', content: 'GPT-6.1 Sol Tool Loop OK' } }],
        }),
      )
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((resolve) => mockCpa.listen(0, '127.0.0.1', resolve))
  const port = mockCpa.address().port
  const workDir = mkdtempSync(join(tmpdir(), 'at-studio-cpa-'))
  try {
    const res = await runCpaChatCompletion({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'sk-test',
      model: 'gpt-6.1-sol',
      messages: [{ role: 'user', content: 'check dir' }],
      tools: createSandboxTools(workDir).toolDefinitions,
      onToolCall: async (name, args) => createSandboxTools(workDir).executeTool(name, args),
    })
    assert.equal(res.model, 'gpt-6.1-sol')
    assert.equal(res.content, 'GPT-6.1 Sol Tool Loop OK')
    assert.equal(res.toolLogs.length, 1)
  } finally {
    await new Promise((resolve) => mockCpa.close(resolve))
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('quick-command @-mode creates staged team routed to gpt-6.1-sol and appends member tasks cleanly', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-studio-quick-'))
  const srv = await startTempServer({
    workspaceRoot: workDir,
    mockExecutor: async () => ({ content: 'ok' }),
  })
  try {
    const presetsRes = await apiJson(`${srv.baseUrl}/api/quick-presets`)
    assert.equal(presetsRes.status, 200)
    assert.equal(presetsRes.body.presets.some((p) => p.key === 'chatgpt-crew'), true)
    assert.equal(presetsRes.body.models.some((m) => m.id === 'gpt-6.1-sol'), true)

    const createRes = await apiJson(`${srv.baseUrl}/api/quick-command`, {
      method: 'POST',
      body: JSON.stringify({ input: '@chatgpt-crew @gpt-6.1-sol 实现快捷模式验证', sessionId: 'quick-sess' }),
    })
    assert.equal(createRes.status, 200)
    assert.equal(createRes.body.ok, true)
    assert.equal(createRes.body.mode, 'created_team')
    assert.equal(createRes.body.team.phase, 'staged')
    assert.equal(createRes.body.team.members.every((m) => m.provider === 'cliproxyapi' && m.model === 'gpt-6.1-sol'), true)

    const teamId = createRes.body.teamId
    const appendRes = await apiJson(`${srv.baseUrl}/api/quick-command`, {
      method: 'POST',
      body: JSON.stringify({ input: '@engineer 新增快捷任务节点', teamId, sessionId: 'quick-sess' }),
    })
    assert.equal(appendRes.status, 200)
    assert.equal(appendRes.body.ok, true)
    assert.equal(appendRes.body.mode, 'added_task')

    const stateRes = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/state`)
    const snap = stateRes.body.teams.find((t) => t.teamId === teamId)
    assert.equal(snap.phase, 'staged')
    assert.equal(snap.tasks.length, 4)
    assert.equal(snap.tasks.some((t) => t.subject.includes('新增快捷任务节点') && t.assignee === 'engineer'), true)

    // Verify @hydrogen and @argon tags exist and route cleanly
    assert.equal(presetsRes.body.models.some((m) => m.id === 'hydrogen'), true)
    assert.equal(presetsRes.body.models.some((m) => m.id === 'argon'), true)
  } finally {
    await srv.close()
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('runCpaChatCompletion resolves hydrogen and argon aliases with clean fallback on model_not_found', async () => {
  const seenModels = []
  const mockCpa = createServer(async (req, res) => {
    if (req.url === '/v1/chat/completions') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      seenModels.push(body.model)
      if (body.model === 'gemini-4-hydrogen-high' || body.model === 'hydrogen' || body.model === 'gemini-4-argon-high' || body.model === 'argon') {
        res.writeHead(400, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({
          error: { message: `unknown provider for model ${body.model}`, code: 'model_not_found' },
        }))
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({
        model: body.model,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        choices: [{ message: { role: 'assistant', content: `ROUTED_TO:${body.model}` } }],
      }))
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((resolve) => mockCpa.listen(0, '127.0.0.1', resolve))
  const port = mockCpa.address().port
  try {
    const hRes = await runCpaChatCompletion({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'sk-test',
      model: 'hydrogen',
      messages: [{ role: 'user', content: 'hi' }],
    })
    assert.equal(hRes.requestedModel, 'hydrogen')
    assert.equal(hRes.routedModel, 'gemini-3.8-flash-high')
    assert.equal(hRes.fallbackUsed, true)
    assert.equal(hRes.content, 'ROUTED_TO:gemini-3.8-flash-high')

    const aRes = await runCpaChatCompletion({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'sk-test',
      model: 'argon',
      messages: [{ role: 'user', content: 'hi' }],
    })
    assert.equal(aRes.requestedModel, 'argon')
    assert.equal(aRes.routedModel, 'gemini-3.8-flash-tiered')
    assert.equal(aRes.fallbackUsed, true)
    assert.ok(seenModels.includes('gemini-4-hydrogen-high'))
    assert.ok(seenModels.includes('gemini-4-argon-high'))
  } finally {
    await new Promise((resolve) => mockCpa.close(resolve))
  }
})

test('dual independent reviewers trigger automatic rework/repair loop on NEEDS_REVISION and re-verify to delivery ok', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-studio-rework-'))
  const execLog = []
  const srv = await startTempServer({
    workspaceRoot: workDir,
    mockExecutor: async ({ task, member, sandbox }) => {
      execLog.push({ taskId: task.id, member: member.name, model: member.model, kind: task.kind, prompt: member.executionPrompt || '' })
      if (task.id === 't1') {
        await sandbox.executeTool('write_file', {
          path: 'server/app.js',
          content: 'export function handle(x) { return x.trim(); }\n',
        })
        await sandbox.executeTool('run_command', { command: 'node -e "process.exit(0)"' })
        return { content: '初版 server/app.js 已实现' }
      }
      if (task.id === 't4') {
        assert.equal(member.name, 'gpt-engineer')
        await sandbox.executeTool('write_file', {
          path: 'src/ui.js',
          content: 'export const badge = "ok";\n',
        })
        await sandbox.executeTool('run_command', { command: 'node -e "process.exit(0)"' })
        return { content: '前端 src/ui.js 已实现' }
      }
      if (task.id === 't5') {
        assert.equal(member.name, 'gemini-redteam')
        assert.equal(member.model, 'hydrogen')
        return {
          content: [
            'VERDICT: NEEDS_REVISION',
            'FINDING: F1 | high | server/app.js | handle 未检查 null/undefined 输入 | 在 handle(x) 开头增加空值防御处理',
          ].join('\n'),
        }
      }
      if (task.id === 't3') {
        assert.equal(member.name, 'gemini-redteam')
        assert.equal(member.model, 'hydrogen')
        return { content: 'VERDICT: PASS\nHydrogen 红队 UX/安全隔离独立验证通过。' }
      }
      if (task.kind === 'repair') {
        assert.equal(member.name, 'gpt-engineer')
        await sandbox.executeTool('write_file', {
          path: 'server/app.js',
          content: 'export function handle(x) { if (!x) return ""; return String(x).trim(); }\n',
        })
        await sandbox.executeTool('run_command', { command: 'node -e "process.exit(0)"' })
        return { content: '已根据 Hydrogen 审查意见完成空值防御返工修复' }
      }
      if (task.id.startsWith('review-t5-')) {
        assert.equal(member.name, 'gemini-redteam')
        return { content: 'VERDICT: PASS\n复审确认 server/app.js 空值防御已修复。' }
      }
      // gpt-reviewer independent review tasks (t6 / t2)
      assert.equal(member.name, 'gpt-reviewer')
      return { content: 'VERDICT: PASS\nGPT 白盒独立审查通过。' }
    },
  })

  try {
    const createRes = await apiJson(`${srv.baseUrl}/api/quick-command`, {
      method: 'POST',
      body: JSON.stringify({ input: '@studio-default 验证双独立审查与自动返工闭环', sessionId: 'cap-rework' }),
    })
    assert.equal(createRes.status, 200)
    const teamId = createRes.body.teamId
    const redteam = createRes.body.team.members.find((m) => m.name === 'gemini-redteam')
    const gptRev = createRes.body.team.members.find((m) => m.name === 'gpt-reviewer')
    assert.equal(redteam.model, 'hydrogen')
    assert.match(redteam.executionPrompt, /独立身份 B/)
    assert.match(gptRev.executionPrompt, /独立身份 A/)

    // Remove t4 & t3 or keep minimal graph? No, run full preset cleanly!
    const approveRes = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/plan`, {
      method: 'POST',
      body: JSON.stringify({ teamId, action: 'approve', autoRun: false }),
    })
    assert.equal(approveRes.status, 200)

    const autoRes = await apiJson(`${srv.baseUrl}/api/teams/${teamId}/auto-run`, { method: 'POST', body: '{}' })
    assert.equal(autoRes.status, 200)
    assert.equal(autoRes.body.allCompleted, true)

    const stateRes = await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/state`)
    const snap = stateRes.body.teams.find((t) => t.teamId === teamId)
    const t5 = snap.tasks.find((t) => t.id === 't5')
    const repairT5 = snap.tasks.find((t) => t.id === 'repair-t5-r2')
    const recheckT5 = snap.tasks.find((t) => t.id === 'review-t5-r2')
    assert.equal(t5.status, 'failed')
    assert.equal(t5.verdict, 'needs_revision')
    assert.ok(repairT5 && repairT5.status === 'completed' && repairT5.assignee === 'gpt-engineer')
    assert.ok(recheckT5 && recheckT5.status === 'completed' && recheckT5.verdict === 'pass' && recheckT5.assignee === 'gemini-redteam')
    assert.equal(snap.tasks.find((t) => t.id === 't2').status, 'completed')
    assert.equal(snap.delivery.ok, true)
    const fullInboxText = readFileSync(join(workDir, '.agent-teams', teamId, 'inbox', 'captain.jsonl'), 'utf8')
    assert.match(fullInboxText, /NEEDS_REVISION/)
    assert.match(fullInboxText, /repair-t5-r2/)
  } finally {
    await srv.close()
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('pure model roster contract: zero DS/ZCode and permanent Hajimi aesthetic officer preset', async () => {
  const { DEFAULT_TEAM_PROFILES } = await import('../server/core/default-profiles.js')
  const { PROMPT_TEMPLATES } = await import('../server/core/prompt-templates.js')

  // 1. Zero DS / Zero ZCode verification across all profiles
  const forbiddenPatterns = [/deepseek/i, /workbuddy/i, /zai-coding-cn/i, /glm-/i]
  for (const [profileKey, profile] of Object.entries(DEFAULT_TEAM_PROFILES)) {
    for (const member of profile.members) {
      for (const pat of forbiddenPatterns) {
        assert.equal(
          pat.test(member.model),
          false,
          `Profile ${profileKey} member ${member.name} contains forbidden model: ${member.model}`
        )
        assert.equal(
          pat.test(member.provider),
          false,
          `Profile ${profileKey} member ${member.name} contains forbidden provider: ${member.provider}`
        )
      }
    }
  }

  // 2. Permanent Hajimi aesthetic officer preset in team profiles
  const chatgptCrew = DEFAULT_TEAM_PROFILES['chatgpt-crew']
  assert.ok(chatgptCrew, 'chatgpt-crew profile must exist')
  const aestheticOfficer = chatgptCrew.members.find((m) => m.name === 'ui-aesthetics')
  assert.ok(aestheticOfficer, 'ui-aesthetics member must exist')
  assert.equal(aestheticOfficer.provider, 'antigravity')
  assert.equal(aestheticOfficer.model, 'gemini-3.8-flash-tiered')
  assert.match(aestheticOfficer.role, /哈吉米/)
  assert.match(PROMPT_TEMPLATES.uiAesthetics, /哈吉米/)
})

test('desktop center APIs (/api/desktop/* & /api/watchdog/*) manage config.toml and watchdog heal cycle', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-desktop-api-'))
  // Prepare temporary config.toml and portable-app.json
  writeFileSync(join(workDir, 'config.toml'), 'port = 4317\nclose-behavior = "ask"\nwatchdog-enabled = true\n')
  writeFileSync(join(workDir, 'portable-app.json'), JSON.stringify({ application: 'AgentTeamsStudio', version: '1.0.0', platform: 'windows', arch: 'amd64' }))
  writeFileSync(join(workDir, 'core-version.txt'), '1.0.0\n')

  const srv = await startTempServer({ workspaceRoot: workDir })

  try {
    // 1. GET /api/desktop/status
    const statusRes = await apiJson(`${srv.baseUrl}/api/desktop/status`)
    assert.equal(statusRes.status, 200)
    assert.equal(statusRes.body.ok, true)
    assert.equal(statusRes.body.portableApp.application, 'AgentTeamsStudio')
    assert.equal(statusRes.body.watchdog.enabled, true)
    assert.ok(typeof statusRes.body.studioCore?.pid === 'number')

    // 2. GET & POST /api/desktop/config
    const configGet = await apiJson(`${srv.baseUrl}/api/desktop/config`)
    assert.equal(configGet.status, 200)
    assert.equal(configGet.body.config.port, 4317)
    assert.equal(configGet.body.config['close-behavior'], 'ask')

    const configPost = await apiJson(`${srv.baseUrl}/api/desktop/config`, {
      method: 'POST',
      body: JSON.stringify({
        config: {
          ...configGet.body.config,
          'window-width': 1440,
          'close-behavior': 'tray',
        },
      }),
    })
    assert.equal(configPost.status, 200)
    assert.equal(configPost.body.ok, true)
    assert.equal(configPost.body.config['window-width'], 1440)
    assert.equal(configPost.body.config['close-behavior'], 'tray')

    // Verify written to disk
    const onDiskToml = readFileSync(join(workDir, 'config.toml'), 'utf8')
    assert.match(onDiskToml, /window-width\s*=\s*1440/)
    assert.match(onDiskToml, /close-behavior\s*=\s*"tray"/)

    // 3. GET /api/desktop/usage
    const usageRes = await apiJson(`${srv.baseUrl}/api/desktop/usage`)
    assert.equal(usageRes.status, 200)
    assert.equal(usageRes.body.ok, true)
    assert.ok(typeof usageRes.body.summary?.totalTeams === 'number')

    // 4. GET /api/watchdog/status & POST /api/watchdog/heal
    const wdStatus = await apiJson(`${srv.baseUrl}/api/watchdog/status`)
    assert.equal(wdStatus.status, 200)
    assert.equal(wdStatus.body.ok, true)
    assert.equal(wdStatus.body.intervalMs, 10000)

    const wdHeal = await apiJson(`${srv.baseUrl}/api/watchdog/heal`, {
      method: 'POST',
      body: JSON.stringify({ teamId: '' }),
    })
    assert.equal(wdHeal.status, 200)
    assert.equal(wdHeal.body.ok, true)
    assert.ok(Array.isArray(wdHeal.body.reports))
  } finally {
    await srv.close()
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('sandbox scrapling_fetch tool enforces protocol and SSRF boundaries', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-studio-scrapling-'))
  try {
    const sandbox = createSandboxTools(workDir)
    const scraplingDef = sandbox.toolDefinitions.find((t) => t.function?.name === 'scrapling_fetch')
    assert.ok(scraplingDef, 'scrapling_fetch tool definition should exist')

    await assert.rejects(
      () => sandbox.executeTool('scrapling_fetch', { url: 'file:///C:/Windows/win.ini' }),
      /仅允许 http\/https 协议/u,
    )
    await assert.rejects(
      () => sandbox.executeTool('scrapling_fetch', { url: 'http://127.0.0.1:4317/' }),
      /安全拦截/u,
    )
    await assert.rejects(
      () => sandbox.executeTool('scrapling_fetch', { url: 'http://localhost:8317/' }),
      /安全拦截/u,
    )
    await assert.rejects(
      () => sandbox.executeTool('scrapling_fetch', { url: 'http://192.168.1.1/' }),
      /安全拦截/u,
    )
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('T3 Code-inspired Git Worktree isolation: graceful fallback and full ensure->diff->merge->cleanup lifecycle', async () => {
  const plainDir = mkdtempSync(join(tmpdir(), 'at-studio-nongit-'))
  const gitDir = mkdtempSync(join(tmpdir(), 'at-studio-gitwt-'))
  try {
    // 1. Non-git workspace falls back gracefully
    assert.equal(await isGitRepo(plainDir), false)
    const fallback = await ensureTaskWorktree({ workspaceRoot: plainDir, teamId: 't-plain', taskId: 't1' })
    assert.equal(fallback.isolated, false)
    assert.equal(fallback.reason, 'not-git-repo')

    // 2. Real git repository isolation lifecycle
    execFileSync('git', ['init'], { cwd: gitDir, windowsHide: true })
    execFileSync('git', ['config', 'user.email', 'studio@example.com'], { cwd: gitDir, windowsHide: true })
    execFileSync('git', ['config', 'user.name', 'Studio Bot'], { cwd: gitDir, windowsHide: true })
    writeFileSync(join(gitDir, 'README.md'), '# base\n', 'utf8')
    execFileSync('git', ['add', 'README.md'], { cwd: gitDir, windowsHide: true })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: gitDir, windowsHide: true })

    assert.equal(await isGitRepo(gitDir), true)
    const wt = await ensureTaskWorktree({ workspaceRoot: gitDir, teamId: 'team/../evil', taskId: 't1' })
    assert.equal(wt.isolated, true)
    assert.ok(wt.branch.startsWith('agent-teams/'))
    assert.ok(!wt.worktreePath.includes('..'))

    // Edit file inside isolated worktree without polluting primary workspace
    writeFileSync(join(wt.worktreePath, 'README.md'), '# base\n+isolated edit\n', 'utf8')
    assert.equal(readFileSync(join(gitDir, 'README.md'), 'utf8'), '# base\n')

    const diffInfo = await inspectWorktreeDiff({
      workspaceRoot: gitDir,
      worktreePath: wt.worktreePath,
      baseBranch: wt.baseBranch,
    })
    assert.equal(diffInfo.ok, true)
    assert.match(diffInfo.diff, /\+isolated edit/)

    // Merge back to primary workspace
    const merged = await mergeTaskWorktree({
      workspaceRoot: gitDir,
      worktreePath: wt.worktreePath,
      branch: wt.branch,
      commitMessage: 'feat: apply isolated task change',
    })
    assert.equal(merged.ok, true)
    assert.match(readFileSync(join(gitDir, 'README.md'), 'utf8'), /isolated edit/)

    // Cleanup worktree and temporary branch
    const cleaned = await cleanupTaskWorktree({
      workspaceRoot: gitDir,
      worktreePath: wt.worktreePath,
      branch: wt.branch,
    })
    assert.equal(cleaned.ok, true)
  } finally {
    rmSync(plainDir, { recursive: true, force: true })
    rmSync(gitDir, { recursive: true, force: true })
  }
})

test('remote-access and worktree HTTP APIs expose mobile URLs and handle team worktree endpoints', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-studio-remote-'))
  const srv = await startTempServer({ workspaceRoot: workDir })
  try {
    const remoteRes = await apiJson(`${srv.baseUrl}/api/remote-access`)
    assert.equal(remoteRes.status, 200)
    assert.equal(remoteRes.body.ok, true)
    assert.match(remoteRes.body.localMobileUrl, /\?view=mobile$/)
    assert.ok(Array.isArray(remoteRes.body.lanMobileUrls))
    assert.equal(remoteRes.body.isGitWorkspace, false)

    const createRes = await apiJson(`${srv.baseUrl}/api/quick-command`, {
      method: 'POST',
      body: JSON.stringify({ input: '@chatgpt-crew 验证远程审批接口' }),
    })
    assert.equal(createRes.status, 200)

    const wtListRes = await apiJson(`${srv.baseUrl}/api/teams/${encodeURIComponent(createRes.body.teamId)}/worktrees`)
    assert.equal(wtListRes.status, 200)
    assert.equal(wtListRes.body.ok, true)
    assert.equal(wtListRes.body.isGitRepo, false)
    assert.deepEqual(wtListRes.body.worktrees, [])
  } finally {
    await srv.close()
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('ops knowledge APIs, @novixlink-ops preset, and prompt injection integrate v4.3 manual completely', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-studio-ops-kb-'))
  const srv = await startTempServer({ workspaceRoot: workDir })
  try {
    // 1. /api/knowledge & /api/knowledge/vps-zkl-novixlink
    const listRes = await apiJson(`${srv.baseUrl}/api/knowledge`)
    assert.equal(listRes.status, 200)
    assert.equal(listRes.body.ok, true)
    assert.ok(listRes.body.manuals.some((m) => m.id === 'vps-zkl-novixlink'))

    const detailRes = await apiJson(`${srv.baseUrl}/api/knowledge/vps-zkl-novixlink`)
    assert.equal(detailRes.status, 200)
    assert.equal(detailRes.body.ok, true)
    const manual = detailRes.body.manual
    assert.equal(manual.nodeSpec.nodeId, 'us-la-novixlink')
    assert.equal(manual.nodeSpec.trafficMultiplier, 2)
    assert.equal(manual.nodeSpec.zklQuotaGb, 750)
    assert.equal(manual.nodeSpec.nodeCapGb, 1000)
    assert.equal(manual.accounts.length, 2)
    assert.ok(manual.telegramBot.commands.length >= 10)
    assert.ok(manual.sopScenarios.length === 4)
    assert.match(manual.rawMarkdown, /stage2_100kb/)

    const missingRes = await apiJson(`${srv.baseUrl}/api/knowledge/nonexistent-manual`)
    assert.equal(missingRes.status, 404)

    // 2. @novixlink-ops quick command creates staged team with knowledgeIds & zero DS/ZCode
    const quickRes = await apiJson(`${srv.baseUrl}/api/quick-command`, {
      method: 'POST',
      body: JSON.stringify({ input: '@novixlink-ops 排查晚高峰只有 100 KB/s 的限速问题' }),
    })
    assert.equal(quickRes.status, 200)
    assert.equal(quickRes.body.ok, true)
    assert.equal(quickRes.body.preset, 'novixlink-ops')
    assert.equal(quickRes.body.team.phase, 'staged')
    for (const m of quickRes.body.team.members) {
      assert.ok(!/deepseek|workbuddy|zai-coding|glm/i.test(`${m.provider}/${m.model}`))
    }

    // Verify knowledgeIds persisted in team.json
    const teamJson = JSON.parse(
      readFileSync(join(workDir, '.agent-teams', quickRes.body.teamId, 'team.json'), 'utf8'),
    )
    assert.deepEqual(teamJson.knowledgeIds, ['vps-zkl-novixlink'])

    // 3. Prompt injection triggers for NovixLink context and skips unrelated tasks
    const injectedPrompt = buildTaskSystemPrompt({
      team: teamJson,
      member: teamJson.members[0],
      task: teamJson.tasks[0],
    })
    assert.match(injectedPrompt, /VPS 统一监控主控中心 v4\.3/)
    assert.match(injectedPrompt, /stage2_100kb/)
    assert.match(injectedPrompt, /750 GB/)

    const unrelatedInjection = buildOpsPromptInjection({
      team: { name: 'refactor-ui', description: 'Optimize CSS tokens' },
      task: { subject: 'Polish button border radius', description: 'Adjust CSS padding' },
    })
    assert.equal(unrelatedInjection, '')
  } finally {
    await srv.close()
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('v2.0 multi-ecosystem hub, CPA channel APIs, 4-provider model catalog, and theme-selection.json persistence', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-studio-v2-eco-'))
  const fakeHome = mkdtempSync(join(tmpdir(), 'at-studio-home-'))
  const srv = await startTempServer({ workspaceRoot: workDir })

  try {
    // 1. /api/models exposes all 4 providers (cliproxyapi, antigravity, codex, dsh)
    const modelsRes = await apiJson(`${srv.baseUrl}/api/models`)
    assert.equal(modelsRes.status, 200)
    const providerIds = modelsRes.body.providers.map((p) => p.id)
    assert.ok(providerIds.includes('cliproxyapi'))
    assert.ok(providerIds.includes('antigravity'))
    assert.ok(providerIds.includes('codex'))
    assert.ok(providerIds.includes('dsh'))

    // 2. /api/desktop/theme reads and persists CPA-compatible theme-selection.json
    const themeGet = await apiJson(`${srv.baseUrl}/api/desktop/theme`)
    assert.equal(themeGet.status, 200)
    assert.equal(themeGet.body.ok, true)
    assert.equal(themeGet.body.selection.version, 1)

    const themePost = await apiJson(`${srv.baseUrl}/api/desktop/theme`, {
      method: 'POST',
      body: JSON.stringify({
        selection: {
          version: 1,
          selectedId: 'warm-sand-light',
          lastLightId: 'warm-sand-light',
          lastDarkId: 'liquid-glass-dark',
        },
      }),
    })
    assert.equal(themePost.status, 200)
    assert.equal(themePost.body.selection.selectedId, 'warm-sand-light')
    const savedThemeJson = JSON.parse(readFileSync(join(workDir, 'theme-selection.json'), 'utf8'))
    assert.equal(savedThemeJson.selectedId, 'warm-sand-light')
    assert.equal(savedThemeJson.lastDarkId, 'liquid-glass-dark')

    // 3. /api/ecosystem/status & /api/channels/cpa/status
    const ecoStatus = await apiJson(`${srv.baseUrl}/api/ecosystem/status`)
    assert.equal(ecoStatus.status, 200)
    assert.equal(ecoStatus.body.ok, true)
    assert.ok(ecoStatus.body.status.antigravity)
    assert.ok(ecoStatus.body.status.codex)
    assert.ok(ecoStatus.body.status.dsh)
    assert.ok(ecoStatus.body.status.cpa)

    const cpaStatus = await apiJson(`${srv.baseUrl}/api/channels/cpa/status`)
    assert.equal(cpaStatus.status, 200)
    assert.equal(cpaStatus.body.ok, true)
    assert.ok(cpaStatus.body.installInfo)

    // 4. Isolated installEcosystemTargets writes Antigravity plugins, Codex config.toml & DSH bridge
    const { installEcosystemTargets } = await import('../server/ecosystem-installer.mjs')
    const installRes = installEcosystemTargets({
      projectRoot: process.cwd(),
      workspaceRoot: workDir,
      homeDir: fakeHome,
      targets: ['antigravity', 'codex', 'dsh'],
      dryRun: false,
    })
    assert.equal(installRes.ok, true)
    assert.equal(installRes.status.antigravity.studioPluginInstalled, true)
    assert.equal(installRes.status.antigravity.dshPluginInstalled, true)
    assert.equal(installRes.status.codex.mcpConfigured, true)
    assert.equal(installRes.status.codex.skillInstalled, true)
    assert.equal(installRes.status.dsh.bridgeInstalled, true)

    const codexToml = readFileSync(join(fakeHome, '.codex', 'config.toml'), 'utf8')
    assert.match(codexToml, /\[mcp_servers\.agent_teams_studio\]/)
    assert.match(codexToml, /\[mcp_servers\.dsh_agent_teams\]/)
    assert.match(codexToml, /\[mcp_servers\.easycli_gpt\]/)
  } finally {
    await srv.close()
    rmSync(workDir, { recursive: true, force: true })
    rmSync(fakeHome, { recursive: true, force: true })
  }
})

test('extensible custom knowledge manuals, custom widgets, and CPA per-team token telemetry work end-to-end', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-studio-ext-telemetry-'))
  const srv = await startTempServer({
    workspaceRoot: workDir,
    mockExecutor: async () => ({
      content: '已完成自定义知识库驱动任务',
      usage: { inputTokens: 1200, outputTokens: 450, reasoningTokens: 150, cachedTokens: 800 },
    }),
  })

  try {
    // 1. Create custom extensible knowledge manual via POST /api/knowledge
    const createManual = await apiJson(`${srv.baseUrl}/api/knowledge`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'custom-liquid-glass-spec',
        title: 'Apple Liquid Glass 规范手册',
        subtitle: '自定义透明玻璃视觉与令牌规范',
        version: 'v2.0',
        triggerKeywords: ['liquid-glass', '毛玻璃'],
        specs: [{ label: '圆角半径', value: '22px', badge: '旗舰' }],
        sopCards: [
          {
            id: 'sop-glass',
            icon: '🎨',
            symptom: '升级玻璃卡片',
            quickPrompt: '@chatgpt-crew 升级毛玻璃卡片',
            steps: ['检查 backdrop-filter', '验证 Specular 边线'],
            relatedCommands: ['npm test'],
          },
        ],
        rawMarkdown: '# Liquid Glass Custom Spec\nUse blur(30px) saturate(200%).',
      }),
    })
    assert.equal(createManual.status, 200)
    assert.equal(createManual.body.ok, true)
    assert.equal(createManual.body.manual.id, 'custom-liquid-glass-spec')

    // Verify GET /api/knowledge lists both built-in and custom manuals
    const kbList = await apiJson(`${srv.baseUrl}/api/knowledge`)
    assert.equal(kbList.status, 200)
    assert.ok(kbList.body.manuals.some((m) => m.id === 'vps-zkl-novixlink'))
    assert.ok(kbList.body.manuals.some((m) => m.id === 'custom-liquid-glass-spec' && m.isCustom === true))

    // Verify auto-prompt injection for matching keyword
    const promptText = buildTaskSystemPrompt({
      team: { name: 'ui-team', description: '打磨 liquid-glass 视觉' },
      member: { name: 'ui-aesthetics', role: '哈吉米审美官' },
      task: { id: 't1', subject: '实现毛玻璃卡片' },
      workspaceRoot: workDir,
    })
    assert.match(promptText, /Apple Liquid Glass 规范手册/)
    assert.match(promptText, /22px/)

    // 2. Create custom extensible widget via POST /api/extensions/widgets
    const createWidget = await apiJson(`${srv.baseUrl}/api/extensions/widgets`, {
      method: 'POST',
      body: JSON.stringify({
        title: '一键回归测试卡',
        category: 'CI/CD',
        icon: '🚀',
        actionType: 'quick-command',
        payload: '@studio-default 执行回归验证',
        fields: [{ label: '目标分支', value: 'main' }],
      }),
    })
    assert.equal(createWidget.status, 200)
    assert.equal(createWidget.body.ok, true)
    const widgetId = createWidget.body.widget.id

    const widgetsGet = await apiJson(`${srv.baseUrl}/api/extensions/widgets`)
    assert.equal(widgetsGet.body.widgets.length, 1)
    assert.equal(widgetsGet.body.widgets[0].id, widgetId)

    // 3. Create team, approve, run task, and verify CPA per-team token telemetry
    const quickTeam = await apiJson(`${srv.baseUrl}/api/quick-command`, {
      method: 'POST',
      body: JSON.stringify({ input: '@chatgpt-crew @gpt-6.1-sol 验证团队级模型消耗计量' }),
    })
    const teamId = quickTeam.body.teamId
    await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/plan`, {
      method: 'POST',
      body: JSON.stringify({ teamId, action: 'approve', autoRun: false }),
    })
    const runStep = await apiJson(`${srv.baseUrl}/api/teams/${teamId}/run-next`, {
      method: 'POST',
      body: '{}',
    })
    assert.equal(runStep.status, 200)

    const usageRes = await apiJson(`${srv.baseUrl}/api/desktop/usage?range=24h`)
    assert.equal(usageRes.status, 200)
    assert.equal(usageRes.body.ok, true)
    assert.ok(Array.isArray(usageRes.body.teamsTelemetry))
    const teamTel = usageRes.body.teamsTelemetry.find((t) => t.teamId === teamId)
    assert.ok(teamTel, 'team telemetry entry must exist')
    assert.equal(teamTel.totalCalls, 1)
    assert.equal(teamTel.inputTokens, 1200)
    assert.equal(teamTel.outputTokens, 450)
    assert.equal(teamTel.reasoningTokens, 150)
    assert.equal(teamTel.cachedTokens, 800)
    assert.equal(teamTel.totalTokens, 1650)
    assert.ok(teamTel.modelsBreakdown.some((m) => m.route === 'cliproxyapi/gpt-6.1-sol' && m.totalTokens === 1650))

    // 4. Delete custom widget & custom manual cleanly
    const delWidget = await apiJson(`${srv.baseUrl}/api/extensions/widgets/${widgetId}`, { method: 'DELETE' })
    assert.equal(delWidget.status, 200)
    const delManual = await apiJson(`${srv.baseUrl}/api/knowledge/custom-liquid-glass-spec`, { method: 'DELETE' })
    assert.equal(delManual.status, 200)
  } finally {
    await srv.close()
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('multi-agent AI video production studio (/api/video/* & @video-studio) supports Gemini director/synthesizer + GPT image artist and custom pipelines', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-studio-video-'))
  const executedStages = []
  const srv = await startTempServer({
    workspaceRoot: workDir,
    mockExecutor: async ({ task, member, sandbox }) => {
      executedStages.push({ taskId: task.id, member: member.name, provider: member.provider, model: member.model })
      if (task.kind !== 'review') {
        await sandbox.executeTool('write_file', {
          path: `video-projects/${task.id}.json`,
          content: JSON.stringify({ stage: task.id, agent: member.name }),
        })
        await sandbox.executeTool('run_command', { command: 'node -e "process.exit(0)"' })
      }
      return {
        content: `VERDICT: PASS\n视频阶段 ${task.id} (${member.name}) 已完成`,
        usage: { inputTokens: 800, outputTokens: 320, reasoningTokens: 80, cachedTokens: 400 },
      }
    },
  })

  try {
    // 1. GET /api/video/pipelines returns built-in ViMax/AgentCut + Pixel MV + ShortGPT templates
    const pipeList = await apiJson(`${srv.baseUrl}/api/video/pipelines`)
    assert.equal(pipeList.status, 200)
    assert.equal(pipeList.body.ok, true)
    assert.ok(pipeList.body.pipelines.length >= 3)
    const vimax = pipeList.body.pipelines.find((p) => p.id === 'vimax-gemini-gpt-studio')
    assert.ok(vimax)
    assert.equal(vimax.videoConfig.imageModel, 'gpt-image-2.6')
    assert.equal(vimax.stages[0].provider, 'antigravity')
    assert.ok(vimax.stages.some((s) => s.name === 'gpt-visual-artist' && s.provider === 'cliproxyapi'))

    // 2. Save custom video pipeline with user-customized stages and models
    const savePipe = await apiJson(`${srv.baseUrl}/api/video/pipelines`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'custom-anime-pv',
        name: '自定义赛博番剧 PV 流水线',
        videoConfig: {
          aspectRatio: '16:9',
          resolution: '3840x2160',
          fps: 60,
          renderer: 'webcodecs-ffmpeg',
          imageModel: 'gpt-image-2.6',
          directorModel: 'gemini-3.8-flash-tiered',
        },
        stages: [
          {
            id: 's1-director',
            name: 'gemini-director',
            role: 'Gemini 总导演与分镜设计',
            provider: 'antigravity',
            model: 'gemini-3.8-flash-tiered',
            kind: 'requirements',
            dependencies: [],
            subject: '分镜脚本规划',
            prompt: '使用 Gemini 制定分镜',
          },
          {
            id: 's2-gpt-img',
            name: 'gpt-artist',
            role: 'GPT 2.6 原画生图师',
            provider: 'cliproxyapi',
            model: 'gpt-6.1-sol',
            imageModel: 'gpt-image-2.6',
            kind: 'implementation',
            dependencies: ['s1-director'],
            subject: '生成分镜关键帧',
            prompt: '调用 gpt-image-2.6 生图',
          },
          {
            id: 's3-gemini-synth',
            name: 'gemini-synthesizer',
            role: 'Gemini 视频合成师',
            provider: 'antigravity',
            model: 'gemini-3.8-flash-tiered',
            kind: 'implementation',
            dependencies: ['s2-gpt-img'],
            subject: '合成 4K 60fps 视频',
            prompt: '编写 WebCodecs + FFmpeg 合成代码',
          },
          {
            id: 's4-qa',
            name: 'hydrogen-qa',
            role: 'Hydrogen 成片审查官',
            provider: 'antigravity',
            model: 'hydrogen',
            kind: 'review',
            reviewedTaskId: 's3-gemini-synth',
            dependencies: ['s3-gemini-synth'],
            subject: '独立抽帧终审',
            prompt: '审查视频产物',
          },
        ],
      }),
    })
    assert.equal(savePipe.status, 200)
    assert.equal(savePipe.body.pipeline.id, 'custom-anime-pv')

    // 3. Launch custom video pipeline into staged team, approve, and auto-run all 4 stages to completion
    const launchRes = await apiJson(`${srv.baseUrl}/api/video/launch`, {
      method: 'POST',
      body: JSON.stringify({
        pipelineId: 'custom-anime-pv',
        brief: '制作哈吉米液态玻璃星际漫游 4K PV',
      }),
    })
    assert.equal(launchRes.status, 200)
    assert.equal(launchRes.body.ok, true)
    assert.equal(launchRes.body.team.phase, 'staged')
    const videoTeamId = launchRes.body.teamId

    await apiJson(`${srv.baseUrl}/plugins/dsh-agent-teams/plan`, {
      method: 'POST',
      body: JSON.stringify({ teamId: videoTeamId, action: 'approve', autoRun: false }),
    })

    const autoRes = await apiJson(`${srv.baseUrl}/api/teams/${videoTeamId}/auto-run`, {
      method: 'POST',
      body: '{}',
    })
    assert.equal(autoRes.status, 200)
    assert.equal(autoRes.body.allCompleted, true)
    assert.equal(executedStages.length, 4)
    assert.equal(executedStages[0].provider, 'antigravity')
    assert.equal(executedStages[1].provider, 'cliproxyapi')
    assert.equal(executedStages[2].provider, 'antigravity')

    // 4. Delete custom video pipeline cleanly
    const delPipe = await apiJson(`${srv.baseUrl}/api/video/pipelines/custom-anime-pv`, {
      method: 'DELETE',
    })
    assert.equal(delPipe.status, 200)
  } finally {
    await srv.close()
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('Graphic Generation Studio, Local Media Models Guide, AI News Radar 3-Tier Grabber, Built-in @Grok Bot, AgentSpeed, BV1rPWd6nEpP & Typography Scale', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'at-studio-v22-'))
  const srv = await startTempServer({ workspaceRoot: workDir })
  try {
    // 1. Graphic Pipelines + Local Media Models Guide + Instant GPT Image Generation
    const pipeRes = await apiJson(`${srv.baseUrl}/api/video/pipelines`)
    assert.equal(pipeRes.status, 200)
    const graphicPipes = pipeRes.body.pipelines.filter((p) => p.mode === 'graphic')
    assert.ok(graphicPipes.length >= 3, 'Should include at least 3 built-in GPT graphic pipelines')
    assert.ok(Array.isArray(pipeRes.body.localModelsGuide) && pipeRes.body.localModelsGuide.length >= 4)

    const genImgRes = await apiJson(`${srv.baseUrl}/api/video/generate-image`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: '哈吉米猫耳少女正侧背三视图设定集',
        model: 'gpt-image-2.6',
        size: '1536x1024',
        stylePreset: 'character-turnaround-sheet',
        timeoutMs: 150,
      }),
    })
    assert.equal(genImgRes.status, 200)
    assert.equal(genImgRes.body.ok, true)
    assert.equal(genImgRes.body.generated.model, 'gpt-image-2.6')
    assert.ok(genImgRes.body.generated.imageUrl.startsWith('data:image/'))

    const localCfgRes = await apiJson(`${srv.baseUrl}/api/video/local-config`, {
      method: 'POST',
      body: JSON.stringify({
        enabled: true,
        providerType: 'comfyui',
        imageEndpoint: 'http://127.0.0.1:8188',
        imageModelName: 'flux1-schnell-fp8.safetensors',
        videoModelName: 'Wan2.1-T2V-1.3B',
      }),
    })
    assert.equal(localCfgRes.status, 200)
    assert.equal(localCfgRes.body.localMediaConfig.enabled, true)

    // 2. AI News Radar 3-Tier Filtering (beginner / power-user / developer) + Value Proposition
    const radarAll = await apiJson(`${srv.baseUrl}/api/radar`)
    assert.equal(radarAll.status, 200)
    assert.ok(radarAll.body.counts.beginner >= 2)
    assert.ok(radarAll.body.counts.powerUser >= 2)
    assert.ok(radarAll.body.counts.developer >= 2)
    assert.ok(radarAll.body.items.every((it) => it.valueScore > 0 && it.valueProposition && it.summary))

    const radarBeginner = await apiJson(`${srv.baseUrl}/api/radar?level=beginner`)
    assert.equal(radarBeginner.status, 200)
    assert.ok(radarBeginner.body.items.every((it) => it.level === 'beginner'))

    const radarLaunch = await apiJson(`${srv.baseUrl}/api/radar/launch`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'BV1rPWd6nEpP 原子任务流验证',
        valueProposition: '提升长周期项目稳定性',
        summary: '文档驱动开发与高频 Git 检查点',
        level: 'power-user',
      }),
    })
    assert.equal(radarLaunch.status, 200)
    assert.equal(radarLaunch.body.team.phase, 'staged')

    // 3. Built-in @Grok Bot Engine (/api/grok/status & /api/grok/ask)
    const grokStatus = await apiJson(`${srv.baseUrl}/api/grok/status`)
    assert.equal(grokStatus.status, 200)
    assert.ok(grokStatus.body.openSourceProjects.some((p) => p.repo === 'xai-org/grok-build'))

    const grokAsk = await apiJson(`${srv.baseUrl}/api/grok/ask`, {
      method: 'POST',
      body: JSON.stringify({
        query: '核查 BV1rPWd6nEpP 长期复杂项目开发工作流的真实工程价值',
        mode: 'fact-check',
        offlineFallback: true,
      }),
    })
    assert.equal(grokAsk.status, 200)
    assert.equal(grokAsk.body.ok, true)
    assert.ok(grokAsk.body.entry.answer.includes('@Grok'))

    // 4. AgentSpeed Live Telemetry (/api/agent-speed) & BV1rPWd6nEpP Knowledge Manual
    const speedRes = await apiJson(`${srv.baseUrl}/api/agent-speed`)
    assert.equal(speedRes.status, 200)
    assert.equal(speedRes.body.ok, true)
    assert.ok(typeof speedRes.body.avgTokPerSec === 'number')
    assert.ok(typeof speedRes.body.peakTokPerSec === 'number')
    assert.ok(Array.isArray(speedRes.body.series['2m']))

    const bvManual = await apiJson(`${srv.baseUrl}/api/knowledge/bv1rpwd6nepp-long-horizon-dev`)
    assert.equal(bvManual.status, 200)
    assert.match(bvManual.body.manual.title, /BV1rPWd6nEpP/)

    // 5. Domestic Models & DeepSeek Harness + Grok in /api/models
    const modelsRes = await apiJson(`${srv.baseUrl}/api/models`)
    assert.equal(modelsRes.status, 200)
    const provIds = modelsRes.body.providers.map((p) => p.id)
    for (const expectedProv of ['cliproxyapi', 'antigravity', 'codex', 'dsh', 'deepseek', 'grok', 'qwen', 'zhipu', 'kimi', 'doubao', 'siliconflow']) {
      assert.ok(provIds.includes(expectedProv), `Missing provider ${expectedProv} in /api/models`)
    }

    // 6. Typography & UI Scale Persistence in /api/desktop/theme
    const themeRes = await apiJson(`${srv.baseUrl}/api/desktop/theme`, {
      method: 'POST',
      body: JSON.stringify({
        selection: {
          selectedId: 'clear-sky-glaze',
          lastLightId: 'clear-sky-glaze',
          lastDarkId: 'liquid-glass-dark',
          fontFamilyId: 'harmony-modern',
          customFontFamily: 'LXGW WenKai',
          uiScale: 116,
        },
      }),
    })
    assert.equal(themeRes.status, 200)
    assert.equal(themeRes.body.selection.fontFamilyId, 'harmony-modern')
    assert.equal(themeRes.body.selection.customFontFamily, 'LXGW WenKai')
    assert.equal(themeRes.body.selection.uiScale, 116)
  } finally {
    await srv.close()
    rmSync(workDir, { recursive: true, force: true })
  }
})




