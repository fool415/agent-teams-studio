# AgentTeams Studio 全局快捷协议

当用户在任意对话中通过 `@agent-teams-studio`、`@studio.md`、`@[http://127.0.0.1:4317/]` 或 `/studio` 引用 AgentTeams Studio 时，遵循以下快捷模式协议：

1. **自动唤醒与快捷建队**：优先调用 MCP 服务 `agent-teams-studio` 的工具（`studio_quick_team` / `studio_status`）自动确保本地 `http://127.0.0.1:4317/`（镜像 `http://127.0.0.1:4318/`）服务在线，并默认将 GPT 执行节点路由至 EasyCLIProxyAPI 的 `cliproxyapi/gpt-6.1-sol`。
2. **强制启动前审批 (`staged` 红线)**：所有通过快捷模式生成的团队必须保持在 `phase: "staged"` 状态。未经用户明确在 GUI 点击【确认并启动团队】或在对话中明确授权批准前，严禁调用 `studio_approve_team` 或触发执行。
3. **预设模板直达**：
   - `@studio-default`：标准 3 人异构工作组（`gpt-engineer` + `gpt-reviewer` + `gemini-redteam`）
   - `@chatgpt-crew`：敏捷双人组（`researcher` + `engineer`）
   - `@heterogeneous-cross-review`：L1~L3 五角异构交叉审查编队
   - `@ai-radar-squad`：六角开源生态调研与评估编队
4. **始终返回可视化入口**：在回复中始终提供 GUI 地址 `http://127.0.0.1:4317/`（以及成员/任务进度摘要），方便用户随时查看与人工审批。
