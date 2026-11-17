# AgentTeams Studio — Codex / Antigravity / DSH 通用协作协议

1. **可视化看板入口**：默认运行于 `http://127.0.0.1:4317/`（镜像端口 `4318`），内置 Apple Liquid Glass 液态透明玻璃 UI 与 EasyCLIProxyAPI 多风格切换系统。
2. **四大渠道自适应路由**：
   - `cliproxyapi`：内置 CPA 渠道网关（`http://127.0.0.1:8317/v1`，聚合 Antigravity OAuth 与 Codex OAuth）；
   - `antigravity`：Google Antigravity / Gemini 渠道（含 `argon -> hydrogen -> gemini-3.8-flash-tiered` 自动无感降级）；
   - `codex`：支持 OpenAI Codex API 模式与本地 `codex exec` CLI 引擎直连模式；
   - `dsh`：100% 兼容 DSH `.agent-teams` 状态目录与 `/plugins/dsh-agent-teams/*` 契约。
3. **启动前审批红线**：所有新建团队必须经过 `staged` 阶段人工或显式指令审批后方可进入 `running` 执行。
