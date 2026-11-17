---
name: agent-teams-studio
description: 在 OpenAI Codex CLI / Codex IDE Plugin / Antigravity / DSH 中启动并操控 AgentTeams Studio (http://127.0.0.1:4317/) 与内置 CPA 渠道网关 (http://127.0.0.1:8317/v1)。当用户提到 @studio、/studio、组队协作、多模型交叉审查或需要可视化 DAG 看板时激活。
---

# AgentTeams Studio × Codex / Antigravity / DSH 跨生态协作指南

## 1. 核心 MCP 工具

通过挂载 `agent-teams-studio`、`dsh-agent-teams` 与 `easycli-gpt` 三大 MCP 服务，你可以在任何会话中直接调用：

- `studio_quick_team`：使用 `@studio-default`、`@chatgpt-crew`、`@heterogeneous-cross-review`、`@ai-radar-squad` 快速生成处于 `staged` 阶段的待审批团队；
- `studio_status`：查看当前工作区所有团队的 DAG 进度、成员状态与交付门禁（`delivery.allowed`）；
- `studio_approve_team`：经用户确认后批准团队进入 `running` 阶段；
- `studio_run`：驱动下一就绪任务或启动全自动 DAG 调度（支持 CPA 渠道、Antigravity、Codex API/CLI、DSH 四大引擎）；
- `ask_gpt` (`easycli-gpt`)：直连内置 CPA 渠道网关 (`:8317`) 调用 `gpt-6.1-sol`、`codex-auto-review`、`gemini-3.8-flash-tiered` 等模型。

## 2. 强制审批门禁 (`staged` -> `running`)

1. 新建团队默认处于 `phase: "staged"`，请先向用户展示 GUI 看板地址 `http://127.0.0.1:4317/` 及任务拓扑；
2. 用户在 Web/桌面端 GUI 点击【确认并启动团队】或在对话中明确批准后，再执行 `studio_approve_team` 与 `studio_run`。
