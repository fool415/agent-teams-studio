---
name: studio
description: 启动并操控 AgentTeams Studio GUI (http://127.0.0.1:4317/) 与 EasyCLIProxyAPI (cliproxyapi/gpt-6.1-sol) 快捷组队模式。Use when 用户提到 /studio、/agent-teams-studio、@agent-teams-studio、@studio.md、@[http://127.0.0.1:4317/] 或要求用 @快捷模式 生成待审批团队与查看实时任务进度。
---

# AgentTeams Studio 快捷编排技能 (`/studio` & `@agent-teams-studio`)

当你因为 `/studio`、`@agent-teams-studio`、`@studio.md` 或 `@[http://127.0.0.1:4317/]` 被激活时，按以下快捷流响应：

## 1. 仅查询状态 / 打开工作台

若用户仅想查看团队进度、确认服务是否在线或查看模型配置：
1. 调用 MCP 服务 `agent-teams-studio` 的 `studio_status` 工具（服务未启动时会自动后台拉起 `:4317` 与 `:4318`）。
2. 向用户展示当前 CPA (`gpt-6.1-sol`) 状态、团队数量与任务进度，并附带可打开地址：`http://127.0.0.1:4317/`（镜像 `http://127.0.0.1:4318/`）。

## 2. 快捷组建待审批团队

若用户给出具体任务目标，或包含 `@studio-default` / `@chatgpt-crew` / `@heterogeneous-cross-review` / `@ai-radar-squad` / `@gpt-6.1-sol` 等标签：
1. 调用 `studio_quick_team`，将用户输入原文传入 `input`（如有显式指定预设可同时传入 `preset`）。
2. 新创建的团队强制停留在 **`phase: "staged"`（待确认）** 状态，GPT 角色默认接入 `cliproxyapi/gpt-6.1-sol`。
3. 向用户简短汇报生成的 `teamId`、成员与模型路由、任务 DAG 列表，并引导用户在 GUI（`http://127.0.0.1:4317/`）点击 **【确认并启动团队】**（或在对话中明确答复“确认启动”）再执行。

## 3. 审批与推进边界

- **严禁私自审批**：未经用户明确确认，绝对不可自动调用 `studio_approve_team`。
- 只有用户明确确认启动后，才可调用 `studio_approve_team` 激活团队，随后按用户需求调用 `studio_run` (`mode: "run-next"` 或 `"auto-run"`) 由 CPA 模型执行或交由用户在 GUI 手动点击推进。
