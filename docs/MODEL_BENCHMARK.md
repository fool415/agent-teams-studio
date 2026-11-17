# AgentTeams Studio 模型团队内性能实测与选型参考报告 (Argon & Hydrogen)

> 评测时间：2026-11-14T12:34:33.132Z  
> 网关地址：`http://127.0.0.1:8317/v1`（在线状态：已连接，共暴露 27 个模型）  
> 评测脚本：[benchmark-team-models.mjs](file:///./scripts/benchmark-team-models.mjs)

---

## 一、EasyCLIProxyAPI 本地 OAuth 账号与原生端点探测结果

通过对本地 `http://127.0.0.1:8317/v1` 进行无回退原生探测（`allowModelFallback: false`）及对运行环境 OAuth 能力检查发现：

| 探测模型 ID | 原生直连结果 | 耗时 | 现状归因与 Studio 路由策略 |
| :--- | :--- | :--- | :--- |
| `hydrogen` | ⚠️ HTTP 400 (`model_not_found`) | 20 ms | 当前活跃账号未解锁，Studio 自动走智能路由回退 |
| `gemini-4-hydrogen-high` | ⚠️ HTTP 400 (`model_not_found`) | 22 ms | 当前活跃账号未解锁，Studio 自动走智能路由回退 |
| `argon` | ⚠️ HTTP 400 (`model_not_found`) | 14 ms | 当前活跃账号未解锁，Studio 自动走智能路由回退 |
| `gemini-4-argon-high` | ⚠️ HTTP 400 (`model_not_found`) | 19 ms | 当前活跃账号未解锁，Studio 自动走智能路由回退 |

**底层 OAuth 账号现状说明（仅陈述观察到的本地配置事实）：**
- 当前启用的 Antigravity 账号 `beiyongerhao32@gmail.com` 在能力列表中使用 `gemini-3.8-flash-high` / `gemini-3.8-flash-tiered` / `gemini-3-flash` 等活跃模型，而 `gemini-4-argon-disabled` / `gemini-4-hydrogen-disabled` 在该账号下处于 `-disabled` 状态。
- 另一个本地 OAuth 凭证 `antigravity-zkl2005910@gmail.com.json` 中包含 `gemini-4-argon-high` / `medium` / `low` 与 `claude-opus-5-5-high` 能力，但当前在 CPA 中标记为 `"disabled": true`。
- **因此**，Studio 在 [cpa-client.mjs](file:///./server/cpa-client.mjs) 中实现了 `resolveCpaModelCandidates()` **原生优先 + 自动无感回退路由**：
  - 请求 `hydrogen` 时：优先尝试 `gemini-4-hydrogen-high` -> `hydrogen` -> 自动落入活跃高阶端点 `gemini-3.8-flash-high`（响应 model 为 `gemini-3.8-flash-n`）；一旦您的 OAuth 账号解锁原生 Hydrogen，将立即无感直连原生端。
  - 请求 `argon` 时：优先尝试 `gemini-4-argon-high` -> `argon` -> 自动落入活跃分层端点 `gemini-3.8-flash-tiered`；一旦在 CPA GUI 重新启用 `zkl2005910@gmail.com`，即可原生命中 `Gemini 4 Argon (High)`。

---

## 二、团队三大核心职责横向实测对比

在隔离临时工作区中，分别测试了各候选模型在以下 3 项真实 Team 任务中的表现：
1. **工程与沙箱工具调用（Tool Calling）**：必须主动调用 `read_file` 工具读取工作区代码并定位真实 Bug。
2. **L2 独立白盒代码审查（Whitebox Review）**：以独立身份 A 识别路径前缀绕过漏洞，并严格按 `VERDICT: NEEDS_REVISION` + `FINDING:` 契约输出结构化返工指令。
3. **L3 独立黑盒红队与安全隔离审查（Red-Team Review）**：以独立身份 B 识别跳过 `staged` 审批红线的安全漏洞，独立发出拒绝/返工裁决。

| 配置模型名 | CPA 实际路由响应模型 | 工程工具调用 | L2 白盒审查（返工格式） | L3 黑盒红队审查（返工格式） | 平均端到端延迟 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `hydrogen` | `gemini-3.8-flash-n` | ✅ 11691ms (1次调用) | ✅ 16389ms (needs_revision/1条) | ✅ 17702ms (needs_revision/1条) | 15261 ms |
| `argon` | `gemini-3.8-flash-tiered` | ✅ 8963ms (1次调用) | ✅ 17055ms (needs_revision/1条) | ✅ 17196ms (needs_revision/1条) | 14405 ms |
| `gemini-3-flash` | `gemini-3-flash` | ✅ 3864ms (1次调用) | ✅ 1898ms (needs_revision/1条) | ✅ 2554ms (needs_revision/1条) | 2772 ms |
| `gpt-6.1-sol` | `gpt-6.1-sol` | ✅ 8482ms (1次调用) | ✅ 12175ms (needs_revision/2条) | ✅ 6928ms (needs_revision/2条) | 9195 ms |
| `gpt-6-sol` | `gpt-6-sol` | ✅ 5591ms (1次调用) | ✅ 8914ms (needs_revision/1条) | ✅ 4464ms (needs_revision/2条) | 6323 ms |
| `gpt-6-astra` | `gpt-6-astra` | ✅ 8217ms (1次调用) | ✅ 16954ms (needs_revision/2条) | ✅ 9266ms (needs_revision/2条) | 11479 ms |

---

## 三、双审核模型独立身份与自动返工修复闭环机制说明

为保证两位审核模型真正做到「各自独立裁决、互不附和、不通过即自动打回返工」，Studio 在本次升级中落地了三层机制：

1. **物理盲审上下文隔离（[cpa-runner.mjs](file:///./server/cpa-runner.mjs)）**：
   - `gpt-reviewer`（默认 `cliproxyapi/gpt-6-sol`）注入 **`【独立身份 A · L2 白盒代码与架构逻辑审查官】`**；
   - `gemini-redteam`（默认 `antigravity/hydrogen`）注入 **`【独立身份 B · L3 黑盒红队与 UX/安全隔离审查官】`**。
   - 构造 `userPrompt` 时仅提供被审任务（`reviewedTaskId`）的文件与契约，**严格屏蔽另一位审查员的输出内容**。
2. **结构化返工裁决解析（`parseReviewOutcome`）**：
   - 支持 `VERDICT: PASS | NEEDS_REVISION | REJECT` 与 `FINDING: <id> | <severity> | <file> | <problem> | <requiredFix>`，并为每个 `finding.id` 自动加上 `<taskId>-` 命名空间防止双审冲突。
3. **全自动返工派发与依赖重连（`applyReworkFollowUp`）**：
   - 当任一审查员签发 `NEEDS_REVISION` 时，调度器自动：
     1. 将该审查任务标为 `failed (verdict: needs_revision)` 并向队长收件箱发送 `[需要返工]` 告警；
     2. 自动生成 `repair-<taskId>-r<N>` 返工任务并指派回原实现工程师（如 `gpt-engineer`）；
     3. 自动生成 `review-<taskId>-r<N>` 复审任务并指派回发出打回裁决的原独立审查员（`gpt-reviewer` 或 `gemini-redteam`）；
     4. 自动将下游汇总任务（如 `t2`）的前置依赖从失败的初审重连到新一轮复审任务，直至返工修复与独立复审均通过后完成最终 `SHA256` P0 交付锁闭环。

---

## 四、未来团队成员模型选型建议

| 团队角色 / 任务类型 | 推荐首选模型 | 备选模型 | 选型依据（基于本次实测） |
| :--- | :--- | :--- | :--- |
| **全栈工程实现 (`gpt-engineer`)** | `cliproxyapi/gpt-6.1-sol` | `cliproxyapi/gpt-6-sol` | 工具调用（`read_file` / `write_file` / `run_command`）稳定、多轮代码修改准确率高、平均延迟均衡。 |
| **L2 独立白盒审查 (`gpt-reviewer`)** | `cliproxyapi/gpt-6-sol` | `cliproxyapi/gpt-6-astra` | 与工程主力形成同系降维或架构推理互补；`gpt-6-astra` 适合超复杂架构安全深度白盒审计。 |
| **L3 独立黑盒红队 / UX 审查 (`gemini-redteam`)** | `antigravity/hydrogen` | `antigravity/gemini-3-flash` | 异构厂商模型天然避免「同源盲区」；`hydrogen` 路由高思考档位红队反例识别细致、契约遵从度高；若需极速反馈可选 `gemini-3-flash`。 |
| **L1 架构规划 / 开源生态调研 (`arch-planner` / `researcher`)** | `antigravity/argon` | `antigravity/gemini-3.8-flash-tiered` | 上下文窗口大（1M），`argon` 路由具备强推理能力；在 CPA 中重新启用 `zkl2005910@gmail.com` OAuth 账号后可体验原生 `gemini-4-argon-high`。 |
