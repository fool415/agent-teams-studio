# AgentTeams Studio 项目交付与实战复盘

本文档记录 `AgentTeams Studio` 独立全栈应用在架构迁移、EasyCLIProxyAPI (CPA) 模型接入、独立白盒审查加固过程中的实测状态，以及协作基础设施暴露出的真实阻塞点。

---

## 1. 交付能力与完成范围

1. **1:1 DSH 原生工作台前端 (`src/client/` & `src/App.tsx`)**
   - 完整迁移并适配 `WorkspaceActivity`、`TeamsOverview`、`CreateTeamWizard`、`StagingPlanEditor`、`ActivityPanel`、`AgentTeamsCard` 与 `DeleteTeamModal`。
   - 支持顶部鲸鱼头栏、字体缩放 (`A- 130% A+`)、`L0`–`L3` 质量标签、【执行前计划审查】三步向导、`2×2` 工作台矩阵与实时日志抽屉。
   - 预置 `chatgpt-crew`、`heterogeneous-cross-review`、`ai-radar-squad` 与自定义组队模板。

2. **强审批门禁与实时状态同步 (`server/index.mjs` & `server/snapshot.mjs`)**
   - 所有新建团队统一落为 `phase: "staged"`、`planReviewState: "awaiting_review"`；未经用户在 GUI 点击【确认并启动团队】，调用 `run-next` 明确拦截并返回 `HTTP 409`。
   - 基于 SSE (`/api/events`) 与 1 秒轮询提供实时团队快照，并将质量门检查（`auditTeamWorkspace`、`canDeclareDelivery`、`verdictAuditNotes`）透传至 UI 的 `delivery` 与 `verdictStale`。

3. **EasyCLIProxyAPI (`cliproxyapi/gpt-6.1-sol`) 与沙箱执行引擎 (`server/cpa-client.mjs` / `server/cpa-runner.mjs` / `server/sandbox.mjs`)**
   - 直连本地 CPA OpenAI 兼容网关 (`http://127.0.0.1:8317/v1`)，默认将 GPT 角色路由至 `cliproxyapi/gpt-6.1-sol`（并实测网关返回 `gpt-6.1-sol OK` 及模型清单在线）。
   - 为模型配备 `list_dir`、`read_file`、`write_file`、`run_command` 四个工作区沙箱工具，强制阻断路径穿越、`.agent-teams/` 与 `.env` 写入，以及 `outOfScope` 越界修改。

---

## 2. L2 独立白盒审查发现与加固闭环

在独立白盒审查与 `/state` 接口容错排查后，团队完成了 3 项服务端关键加固，并再次通过 `easycli-gpt:ask_gpt`（模型 `gpt-6.1-sol`）复审：

### 已落地加固项
1. **单团队损坏隔离 (`server/snapshot.mjs`)**：在 `collectStudioTeams` 读取现役及归档目录的循环中为每个团队包裹 `try { ... } catch { continue }`，避免工作区中个别非标准或损坏的 `.agent-teams/<teamId>/team.json` 导致全站 `/plugins/dsh-agent-teams/state` 崩溃返回 `HTTP 500`。
2. **审查通过 SHA256 严格绑定 (`server/cpa-runner.mjs`)**：对 `kind === 'review'` 且 `verdict === 'pass'` 的结案增加前置校验——若 `verdictScopePatterns` 为空或覆盖范围内没有任何 `present === true` 的真实文件产物，立即返回 `HTTP 409` 拒绝签发未绑定 SHA256 的通过裁决。
3. **写文件软链接与工作目录二次加固 (`server/sandbox.mjs`)**：在 `write_file` 创建目录及写入前后通过 `realpathSync` 校验父目录与目标文件规范路径未逃逸出工作区根目录；`run_command` 显式锁定工作区规范根路径作为 `cwd`。

### L2 复审（`gpt-6.1-sol`）结论与残余风险记录
复审结论为 **`CONDITIONAL`**，明确指出以下仍需持续关注的工程边界：
- **静默跳过可见性**：`snapshot.mjs` `try/catch { continue }` 可有效保住 `/state` 接口可用性，但静默跳过坏目录会隐藏异常数据，后续版本建议增加非阻断告警字段。
- **范围完整性与竞态**：`cpa-runner.mjs`“至少一个产物存在”校验可防空过，但无法独立证明产物集合完整且内容合格，检查与绑定之间仍依赖单进程内串行互斥避免并发写入竞态。
- **文件系统 TOCTOU**：用户态 `write_file` 写前/写后 `realpathSync` 无法在事后撤回已产生的越界写，父目录检查与写入之间在理论上仍受 OS 级软链接替换竞态约束。
- **`judgeConflictFor` 字段耦合**：[`server/core/quality-gates.js`](../server/core/quality-gates.js) 中的 `judgeConflictFor` 仅比对 `assignee === memberName` 而未比对 `claimedBy`；当前 `cpa-runner.mjs` 认领时会同步写入 `assignee` 与 `claimedBy`，但若外部手动修改 `assignee` 且未同步 `claimedBy` 则存在理论绕过面。

---

## 3. 协作基础设施阻塞记录（客观事实说明）

在利用宿主 `dsh-agent-teams` MCP 服务编排本项目的收尾阶段（`agent-teams-studio` 团队）过程中，定位到一处宿主环境插件的持久化契约冲突：

- **现象**：在认领任务 `t3` 时，宿主运行中的 `dsh-agent-teams` MCP 进程向工作区 `.agent-teams/agent-teams-studio/team.json` 写入了 `"verdictStartSnapshot": { "takenAt": ..., "scope": [...], "artifacts": [...] }`。
- **根因**：持久化校验函数 `isArtifactSnapshot`（位于 `quality-gates.js`）要求时间戳字段为整数 `at` 而非 `takenAt`。因此写入后，后续针对 `agent-teams-studio` 的 `agent_teams_claim_task`、`agent_teams_update_task` 与 `agent_teams_status` 调用均被宿主 MCP 校验拒绝（报错 `record does not satisfy the durable team contract`）。
- **处理原则**：恪守不篡改外部受保护状态与宿主机插件目录的边界，团队未手工篡改 `.agent-teams/agent-teams-studio/team.json` 或终止宿主 MCP 进程，而是如实记录该阻塞点，并在独立版 `AgentTeams Studio` 的 `snapshot.mjs` 中做了单目录故障隔离，确保独立软件本身在同工作区下稳定提供服务。
