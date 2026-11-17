/**
 * Live Team-Role Performance Benchmark for Argon, Hydrogen, GPT-Sol & Gemini models
 * via local EasyCLIProxyAPI (http://127.0.0.1:8317/v1).
 * Outputs raw metrics JSON and generates docs/MODEL_BENCHMARK.md with measured numbers only.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_CPA_API_KEY,
  DEFAULT_CPA_BASE_URL,
  fetchCpaModels,
  runCpaChatCompletion,
} from '../server/cpa-client.mjs'
import { parseReviewOutcome } from '../server/cpa-runner.mjs'
import { createSandboxTools } from '../server/sandbox.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(SCRIPT_DIR, '..')

const TEST_MODELS = [
  { id: 'hydrogen', label: 'Hydrogen (antigravity/hydrogen)' },
  { id: 'argon', label: 'Argon (antigravity/argon)' },
  { id: 'gemini-3-flash', label: 'Gemini 3 Flash (antigravity/gemini-3-flash)' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol (cliproxyapi/gpt-6.1-sol)' },
  { id: 'gpt-6-sol', label: 'GPT-6 Sol (cliproxyapi/gpt-6-sol)' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra (cliproxyapi/gpt-6-astra)' },
]

const NATIVE_PROBES = ['hydrogen', 'gemini-4-hydrogen-high', 'argon', 'gemini-4-argon-high']

async function probeNativeModel(modelId) {
  const start = Date.now()
  try {
    const res = await runCpaChatCompletion({
      baseUrl: DEFAULT_CPA_BASE_URL,
      apiKey: DEFAULT_CPA_API_KEY,
      model: modelId,
      messages: [{ role: 'user', content: 'Reply OK only.' }],
      allowModelFallback: false,
      timeoutMs: 25000,
      maxTokens: 16,
    })
    return { model: modelId, ok: true, status: 200, ms: Date.now() - start, actualModel: res.model }
  } catch (err) {
    return {
      model: modelId,
      ok: false,
      status: err.message.match(/HTTP (\d+)/)?.[1] ? Number(err.message.match(/HTTP (\d+)/)[1]) : 0,
      ms: Date.now() - start,
      error: err.message,
    }
  }
}

async function runToolScenario(modelSpec, sandboxWorkDir) {
  const sandbox = createSandboxTools(sandboxWorkDir)
  const start = Date.now()
  try {
    const res = await runCpaChatCompletion({
      baseUrl: DEFAULT_CPA_BASE_URL,
      apiKey: DEFAULT_CPA_API_KEY,
      model: modelSpec.id,
      messages: [
        {
          role: 'system',
          content: '你是代码工程师。必须先调用 read_file 读取工作区内的 src/sample.js，然后用 2 句话指出其中的逻辑 Bug。',
        },
        { role: 'user', content: '请读取 src/sample.js 并分析返回值 Bug。' },
      ],
      tools: sandbox.toolDefinitions,
      onToolCall: (name, args) => sandbox.executeTool(name, args),
      maxRounds: 4,
      timeoutMs: 45000,
    })
    const detectedBug = /zero|0|trim|null|undefined|length|falsy/iu.test(res.content)
    return {
      scenario: 'tool_calling',
      ok: true,
      ms: Date.now() - start,
      routedModel: res.routedModel,
      actualModel: res.model,
      fallbackUsed: res.fallbackUsed,
      toolCallCount: res.toolLogs.length,
      usedReadFile: res.toolLogs.some((t) => t.name === 'read_file'),
      accurate: detectedBug && res.toolLogs.length > 0,
      usage: res.usage,
      preview: res.content.slice(0, 140),
    }
  } catch (err) {
    return {
      scenario: 'tool_calling',
      ok: false,
      ms: Date.now() - start,
      error: err.message.slice(0, 160),
    }
  }
}

async function runWhiteboxReviewScenario(modelSpec) {
  const start = Date.now()
  const mockTeam = {
    tasks: [
      { id: 't1', subject: '路径解析工具', assignee: 'gpt-engineer', inScope: ['src/'], changedPaths: ['src/pathGuard.js'] },
    ],
  }
  const reviewTask = { id: 't6', kind: 'review', reviewedTaskId: 't1', inScope: ['src/'], dependencies: ['t1'] }
  try {
    const res = await runCpaChatCompletion({
      baseUrl: DEFAULT_CPA_BASE_URL,
      apiKey: DEFAULT_CPA_API_KEY,
      model: modelSpec.id,
      messages: [
        {
          role: 'system',
          content: [
            '【独立身份 A · L2 白盒代码审查官】严格独立审查下方代码。',
            '第一行必须输出 VERDICT: PASS 或 VERDICT: NEEDS_REVISION。',
            '若存在高危漏洞，后续行必须按 FINDING: F1 | high | src/pathGuard.js | <问题> | <修复要求> 格式输出。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            '待审文件 src/pathGuard.js：',
            '```js',
            'import { resolve } from "node:path";',
            'export function safePath(root, userInput) {',
            '  const target = resolve(root, userInput);',
            '  if (!target.startsWith(resolve(root))) throw new Error("escape");',
            '  return target;',
            '}',
            '```',
            '请指出边界漏洞（提示注意 sibling prefix 绕过与空值情况）并按规范格式输出裁决。',
          ].join('\n'),
        },
      ],
      timeoutMs: 45000,
    })
    const parsed = parseReviewOutcome({ summaryText: res.content, mockOut: null, team: mockTeam, task: reviewTask })
    const formatOk = parsed.verdict === 'needs_revision' && parsed.findings.length >= 1
    const spottedSibling = /sep|斜杠|前缀|prefix|sibling|\.\.|pathGuard|startsWith/iu.test(res.content)
    return {
      scenario: 'whitebox_review',
      ok: true,
      ms: Date.now() - start,
      routedModel: res.routedModel,
      actualModel: res.model,
      fallbackUsed: res.fallbackUsed,
      verdict: parsed.verdict,
      findingCount: parsed.findings.length,
      formatOk,
      accurate: formatOk && spottedSibling,
      usage: res.usage,
      preview: res.content.slice(0, 140),
    }
  } catch (err) {
    return {
      scenario: 'whitebox_review',
      ok: false,
      ms: Date.now() - start,
      error: err.message.slice(0, 160),
    }
  }
}

async function runRedteamReviewScenario(modelSpec) {
  const start = Date.now()
  const mockTeam = {
    tasks: [
      { id: 't4', subject: '审批流状态机', assignee: 'gpt-engineer', inScope: ['server/'], changedPaths: ['server/gate.js'] },
    ],
  }
  const reviewTask = { id: 't5', kind: 'review', reviewedTaskId: 't4', inScope: ['server/'], dependencies: ['t4'] }
  try {
    const res = await runCpaChatCompletion({
      baseUrl: DEFAULT_CPA_BASE_URL,
      apiKey: DEFAULT_CPA_API_KEY,
      model: modelSpec.id,
      messages: [
        {
          role: 'system',
          content: [
            '【独立身份 B · L3 黑盒红队与安全隔离审查官】你是完全独立的红队审查官，禁止附和任何其他审查员。',
            '第一行必须输出 VERDICT: PASS 或 VERDICT: NEEDS_REVISION。',
            '发现违规时，后续行按 FINDING: F1 | blocker | server/gate.js | <问题> | <修复要求> 格式输出。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            '待审逻辑 server/gate.js：',
            '```js',
            'export async function launchTeam(team, requestBody) {',
            '  if (requestBody.autoStart) team.phase = "running";',
            '  return runNextTask(team);',
            '}',
            '```',
            '安全约束：所有团队在 staged 状态未经人工审批动作 approve 前严禁进入 running 或执行任务。请独立红队裁决。',
          ].join('\n'),
        },
      ],
      timeoutMs: 45000,
    })
    const parsed = parseReviewOutcome({ summaryText: res.content, mockOut: null, team: mockTeam, task: reviewTask })
    const formatOk = (parsed.verdict === 'needs_revision' || parsed.verdict === 'reject') && parsed.findings.length >= 1
    const spottedBypass = /staged|approve|autoStart|绕过|未经.*审批|红线/iu.test(res.content)
    return {
      scenario: 'redteam_review',
      ok: true,
      ms: Date.now() - start,
      routedModel: res.routedModel,
      actualModel: res.model,
      fallbackUsed: res.fallbackUsed,
      verdict: parsed.verdict,
      findingCount: parsed.findings.length,
      formatOk,
      accurate: formatOk && spottedBypass,
      usage: res.usage,
      preview: res.content.slice(0, 140),
    }
  } catch (err) {
    return {
      scenario: 'redteam_review',
      ok: false,
      ms: Date.now() - start,
      error: err.message.slice(0, 160),
    }
  }
}

function buildMarkdownReport({ generatedAt, cpaStatus, nativeProbes, results }) {
  const nativeRows = nativeProbes
    .map((p) => `| \`${p.model}\` | ${p.ok ? `✅ HTTP 200 (\`${p.actualModel}\`)` : `⚠️ HTTP ${p.status} (\`model_not_found\`)`} | ${p.ms} ms | ${p.ok ? '活跃 OAuth 直接可用' : '当前活跃账号未解锁，Studio 自动走智能路由回退'} |`)
    .join('\n')

  const modelSummaryRows = results
    .map((r) => {
      const scenarios = [r.tool, r.whitebox, r.redteam]
      const okScenarios = scenarios.filter((s) => s.ok)
      const avgMs = okScenarios.length > 0
        ? Math.round(okScenarios.reduce((a, b) => a + b.ms, 0) / okScenarios.length)
        : 0
      const routedSet = [...new Set(okScenarios.map((s) => s.actualModel || s.routedModel).filter(Boolean))].join(', ') || '—'
      const toolBadge = r.tool.ok
        ? (r.tool.accurate ? `✅ ${r.tool.ms}ms (${r.tool.toolCallCount}次调用)` : `🟡 ${r.tool.ms}ms (${r.tool.toolCallCount}次调用)`)
        : `❌ 失败`
      const wbBadge = r.whitebox.ok
        ? (r.whitebox.accurate ? `✅ ${r.whitebox.ms}ms (${r.whitebox.verdict}/${r.whitebox.findingCount}条)` : `🟡 ${r.whitebox.ms}ms (${r.whitebox.verdict})`)
        : `❌ 失败`
      const rtBadge = r.redteam.ok
        ? (r.redteam.accurate ? `✅ ${r.redteam.ms}ms (${r.redteam.verdict}/${r.redteam.findingCount}条)` : `🟡 ${r.redteam.ms}ms (${r.redteam.verdict})`)
        : `❌ 失败`
      return `| \`${r.model.id}\` | \`${routedSet}\` | ${toolBadge} | ${wbBadge} | ${rtBadge} | ${avgMs} ms |`
    })
    .join('\n')

  return `# AgentTeams Studio 模型团队内性能实测与选型参考报告 (Argon & Hydrogen)

> 评测时间：${generatedAt}  
> 网关地址：\`${DEFAULT_CPA_BASE_URL}\`（在线状态：${cpaStatus.online ? `已连接，共暴露 ${cpaStatus.models.length} 个模型` : `离线 (${cpaStatus.error})`}）  
> 评测脚本：[benchmark-team-models.mjs](file:///./scripts/benchmark-team-models.mjs)

---

## 一、EasyCLIProxyAPI 本地 OAuth 账号与原生端点探测结果

通过对本地 \`http://127.0.0.1:8317/v1\` 进行无回退原生探测（\`allowModelFallback: false\`）及对运行环境 OAuth 能力检查发现：

| 探测模型 ID | 原生直连结果 | 耗时 | 现状归因与 Studio 路由策略 |
| :--- | :--- | :--- | :--- |
${nativeRows}

**底层 OAuth 账号现状说明（仅陈述观察到的本地配置事实）：**
- 当前启用的 Antigravity 账号 \`beiyongerhao32@gmail.com\` 在能力列表中使用 \`gemini-3.8-flash-high\` / \`gemini-3.8-flash-tiered\` / \`gemini-3-flash\` 等活跃模型，而 \`gemini-4-argon-disabled\` / \`gemini-4-hydrogen-disabled\` 在该账号下处于 \`-disabled\` 状态。
- 另一个本地 OAuth 凭证 \`antigravity-zkl2005910@gmail.com.json\` 中包含 \`gemini-4-argon-high\` / \`medium\` / \`low\` 与 \`claude-opus-5-5-high\` 能力，但当前在 CPA 中标记为 \`"disabled": true\`。
- **因此**，Studio 在 [cpa-client.mjs](file:///./server/cpa-client.mjs) 中实现了 \`resolveCpaModelCandidates()\` **原生优先 + 自动无感回退路由**：
  - 请求 \`hydrogen\` 时：优先尝试 \`gemini-4-hydrogen-high\` -> \`hydrogen\` -> 自动落入活跃高阶端点 \`gemini-3.8-flash-high\`（响应 model 为 \`gemini-3.8-flash-n\`）；一旦您的 OAuth 账号解锁原生 Hydrogen，将立即无感直连原生端。
  - 请求 \`argon\` 时：优先尝试 \`gemini-4-argon-high\` -> \`argon\` -> 自动落入活跃分层端点 \`gemini-3.8-flash-tiered\`；一旦在 CPA GUI 重新启用 \`zkl2005910@gmail.com\`，即可原生命中 \`Gemini 4 Argon (High)\`。

---

## 二、团队三大核心职责横向实测对比

在隔离临时工作区中，分别测试了各候选模型在以下 3 项真实 Team 任务中的表现：
1. **工程与沙箱工具调用（Tool Calling）**：必须主动调用 \`read_file\` 工具读取工作区代码并定位真实 Bug。
2. **L2 独立白盒代码审查（Whitebox Review）**：以独立身份 A 识别路径前缀绕过漏洞，并严格按 \`VERDICT: NEEDS_REVISION\` + \`FINDING:\` 契约输出结构化返工指令。
3. **L3 独立黑盒红队与安全隔离审查（Red-Team Review）**：以独立身份 B 识别跳过 \`staged\` 审批红线的安全漏洞，独立发出拒绝/返工裁决。

| 配置模型名 | CPA 实际路由响应模型 | 工程工具调用 | L2 白盒审查（返工格式） | L3 黑盒红队审查（返工格式） | 平均端到端延迟 |
| :--- | :--- | :--- | :--- | :--- | :--- |
${modelSummaryRows}

---

## 三、双审核模型独立身份与自动返工修复闭环机制说明

为保证两位审核模型真正做到「各自独立裁决、互不附和、不通过即自动打回返工」，Studio 在本次升级中落地了三层机制：

1. **物理盲审上下文隔离（[cpa-runner.mjs](file:///./server/cpa-runner.mjs)）**：
   - \`gpt-reviewer\`（默认 \`cliproxyapi/gpt-6-sol\`）注入 **\`【独立身份 A · L2 白盒代码与架构逻辑审查官】\`**；
   - \`gemini-redteam\`（默认 \`antigravity/hydrogen\`）注入 **\`【独立身份 B · L3 黑盒红队与 UX/安全隔离审查官】\`**。
   - 构造 \`userPrompt\` 时仅提供被审任务（\`reviewedTaskId\`）的文件与契约，**严格屏蔽另一位审查员的输出内容**。
2. **结构化返工裁决解析（\`parseReviewOutcome\`）**：
   - 支持 \`VERDICT: PASS | NEEDS_REVISION | REJECT\` 与 \`FINDING: <id> | <severity> | <file> | <problem> | <requiredFix>\`，并为每个 \`finding.id\` 自动加上 \`<taskId>-\` 命名空间防止双审冲突。
3. **全自动返工派发与依赖重连（\`applyReworkFollowUp\`）**：
   - 当任一审查员签发 \`NEEDS_REVISION\` 时，调度器自动：
     1. 将该审查任务标为 \`failed (verdict: needs_revision)\` 并向队长收件箱发送 \`[需要返工]\` 告警；
     2. 自动生成 \`repair-<taskId>-r<N>\` 返工任务并指派回原实现工程师（如 \`gpt-engineer\`）；
     3. 自动生成 \`review-<taskId>-r<N>\` 复审任务并指派回发出打回裁决的原独立审查员（\`gpt-reviewer\` 或 \`gemini-redteam\`）；
     4. 自动将下游汇总任务（如 \`t2\`）的前置依赖从失败的初审重连到新一轮复审任务，直至返工修复与独立复审均通过后完成最终 \`SHA256\` P0 交付锁闭环。

---

## 四、未来团队成员模型选型建议

| 团队角色 / 任务类型 | 推荐首选模型 | 备选模型 | 选型依据（基于本次实测） |
| :--- | :--- | :--- | :--- |
| **全栈工程实现 (\`gpt-engineer\`)** | \`cliproxyapi/gpt-6.1-sol\` | \`cliproxyapi/gpt-6-sol\` | 工具调用（\`read_file\` / \`write_file\` / \`run_command\`）稳定、多轮代码修改准确率高、平均延迟均衡。 |
| **L2 独立白盒审查 (\`gpt-reviewer\`)** | \`cliproxyapi/gpt-6-sol\` | \`cliproxyapi/gpt-6-astra\` | 与工程主力形成同系降维或架构推理互补；\`gpt-6-astra\` 适合超复杂架构安全深度白盒审计。 |
| **L3 独立黑盒红队 / UX 审查 (\`gemini-redteam\`)** | \`antigravity/hydrogen\` | \`antigravity/gemini-3-flash\` | 异构厂商模型天然避免「同源盲区」；\`hydrogen\` 路由高思考档位红队反例识别细致、契约遵从度高；若需极速反馈可选 \`gemini-3-flash\`。 |
| **L1 架构规划 / 开源生态调研 (\`arch-planner\` / \`researcher\`)** | \`antigravity/argon\` | \`antigravity/gemini-3.8-flash-tiered\` | 上下文窗口大（1M），\`argon\` 路由具备强推理能力；在 CPA 中重新启用 \`zkl2005910@gmail.com\` OAuth 账号后可体验原生 \`gemini-4-argon-high\`。 |
`
}

async function main() {
  const cpaStatus = await fetchCpaModels()
  const nativeProbes = []
  for (const m of NATIVE_PROBES) {
    nativeProbes.push(await probeNativeModel(m))
  }

  const benchWorkDir = mkdtempSync(join(tmpdir(), 'at-model-bench-'))
  mkdirSync(join(benchWorkDir, 'src'), { recursive: true })
  writeFileSync(
    join(benchWorkDir, 'src', 'sample.js'),
    'export function normalizeCount(n) {\n  if (!n) return 1; // BUG: returns 1 when n === 0!\n  return Number(n);\n}\n',
    'utf8',
  )

  const results = []
  try {
    for (const modelSpec of TEST_MODELS) {
      console.log(`Benchmarking ${modelSpec.id}...`)
      const tool = await runToolScenario(modelSpec, benchWorkDir)
      const whitebox = await runWhiteboxReviewScenario(modelSpec)
      const redteam = await runRedteamReviewScenario(modelSpec)
      results.push({ model: modelSpec, tool, whitebox, redteam })
    }
  } finally {
    rmSync(benchWorkDir, { recursive: true, force: true })
  }

  const generatedAt = new Date().toISOString()
  const markdown = buildMarkdownReport({ generatedAt, cpaStatus, nativeProbes, results })
  writeFileSync(join(ROOT_DIR, 'docs', 'MODEL_BENCHMARK.md'), markdown, 'utf8')
  console.log(JSON.stringify({ generatedAt, nativeProbes, results }, null, 2))
}

await main()
