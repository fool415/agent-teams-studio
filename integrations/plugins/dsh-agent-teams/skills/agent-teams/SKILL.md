---
name: agent-teams
description: 使用 DSH AgentTeams 多智能体编排体系执行复杂研发、UI审美优化、调研或交叉审查任务：含目标推荐、阶段审批 (staged -> running)、DAG 任务调度、7 大角色子智能体派生（含常驻哈吉米审美官 at-aesthetic-designer）、P0 质量门与归档闭环。Use when 用户要求使用 agent-teams、/agent-teams、组队开发、chatgpt-crew、heterogeneous-cross-review、ai-radar-squad 或多模型交叉审查。
---

# DSH AgentTeams 多智能体编排指南（Antigravity 版）

本技能指导你作为 **Captain（队长）** 驾驶 `dsh-agent-teams` MCP 服务（20 个工具）与插件内置的 7 位角色子智能体（`at-*`）完成高可靠性多智能体协作。

> **全局铁律**：
> 1. **剔除 DS 与 ZCode 模型**：严禁使用 `deepseek`/`workbuddy` 与 `zai-coding-cn`/`glm` 模型，全量采用 CPA (`cliproxyapi`) 与 Antigravity (`antigravity`)。
> 2. **Gemini Flash / Pro 强制加载【哈吉米（Hajimi）人设】**。
> 3. **常驻审美官 (`ui-aesthetics` / `at-aesthetic-designer`)**：固定采用 `antigravity/gemini-3.8-flash-tiered`（哈吉米人设），负责联网参考同类标杆软件视觉体系并执行 UI 审美重构。
> 4. **报告撰稿 (`doc-writer` / `at-doc-writer`)**：固定采用 `antigravity/gemini-3.8-flash-tiered`（哈吉米人设）编写报告与文档。

---

## 标准五步执行闭环

### 第一步：目标评估与建队（Staged）

1. 若用户未明确指定团队结构，可先调用 `agent_teams_recommend_goal` 传入 `goal` 获取智能推荐方案（含成员角色与依赖 DAG）。
2. 调用 `agent_teams_create` 创建团队：
   - **预设模式**：传入 `profile`（可选 `"chatgpt-crew"`、`"heterogeneous-cross-review"`、`"ai-radar-squad"`）与 `name`、`description`。
   - **自定义模式**：传入内联 `plan: { members: [...], tasks: [...] }`。
   - **审批策略**：默认为 `approval: "required"`（创建 `phase: "staged"` 草稿，严禁在同回合私自审批或派生执行；向主人简短展示阵容与 DAG 等待确认）。仅当主人明确指示“直接执行/免审批”时传 `approval: "automatic"`。

### 第二步：审批激活或原子修订

- 若主人要求调整人员或任务依赖，调用 `agent_teams_edit_plan`（支持 `operations` 原子批次或 `staged` 下整体更新 `members`/`tasks`）。
- 收到主人确认后，调用 `agent_teams_approve` 将团队由 `staged` 激活为 `running`，返回中会列出首批可立即执行的 `ready_tasks`。

### 第三步：认领与并发派生子智能体

1. 对 `ready_tasks` 中的每项待办任务，先调用 `agent_teams_claim_task`（传入 `team_id`, `task_id`, `memberName`）签发 `attempt_id`（对于 `review`/`verification` 任务，系统会自动校验 `judgeConflictFor` 阻断原作者自审，并自动抓取工作区 `verdictStartSnapshot`）。
2. 根据成员职责，使用 `invoke_subagent` 派生对应子智能体并发或有序执行：
   - 架构/需求规划 -> `TypeName: "dsh-agent-teams:at-architect"`
   - **UI/UX 审美与视觉交互设计（哈吉米 · Gemini 3.8 Flash）** -> `TypeName: "dsh-agent-teams:at-aesthetic-designer"`（优先调用 `search_web` 联网参考同类优秀软件审美并优化 UI）
   - 核心编码/修复 -> `TypeName: "dsh-agent-teams:at-engineer"`
   - 调研/取证（哈吉米 · Gemini 3.8 Flash） -> `TypeName: "dsh-agent-teams:at-researcher"`
   - L2 白盒审查与自修 -> `TypeName: "dsh-agent-teams:at-gpt-reviewer"`（提示其可用 `easycli-gpt` 的 `ask_gpt` 交叉复核代码 diff）
   - L3 黑盒红队终审/复盘（哈吉米 · Gemini Flash/Pro） -> `TypeName: "dsh-agent-teams:at-gemini-supervisor"`
   - 报告与技术文档汇编（哈吉米 · Gemini 3.8 Flash） -> `TypeName: "dsh-agent-teams:at-doc-writer"`
3. 若需队员之间或队长对队员下达补充指引，使用 `agent_teams_send_message` 写入持久信箱。

### 第四步：质量门验真与契约闭环

收到子智能体执行成果后，核验其证据并调用 `agent_teams_update_task`：

- **普通任务 (`kind: "work"`)**：传入 `status: "completed"`, `output`。
- **实现/修复任务 (`kind: "implementation" | "repair"`)**：必须提供：
  - `changedPaths`（相对工作区的 POSIX 路径，必须在 `inScope` 且不在 `outOfScope`/默认排除路径内）
  - `acceptanceResults`（逐条 `{ criterion, status: "passed"|"failed", evidence }`）
  - `commandsRun`（逐条 `{ command, status: "passed"|"failed", exitCode: <整数>, evidence: "<真实输出摘要>" }`，严禁 `<placeholder>` 占位文本！）
- **独立审查/验证任务 (`kind: "review" | "verification"`)**：
  - 审查通过：传 `status: "completed", verdict: "pass", output`，底层将自动把产物绑定至工作区 `sha256` 指纹。
  - 审查退回：传 `status: "failed", verdict: "needs_revision" | "reject"` 及结构化 `findings`（含 `id, severity, problem, requiredFix, file`）。

### 第五步：交付门终检与归档

1. 调用 `agent_teams_status` 查看最终状态，**只有当 `delivery.allowed === true` 时才允许向主人宣告交付完成**！
2. 遵循四段式超精简风格（`<= 150` 词）向主人汇报：【状态】、【核心结论】、【产物路径】、【门禁证据】。
3. 交付完结或主人确认结束时，调用 `agent_teams_delete` 将活跃团队干净归档至 `.agent-teams/archive/<teamId>-<ts>/`。
