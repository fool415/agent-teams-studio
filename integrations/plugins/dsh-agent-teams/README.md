# DSH 智能体团队 (dsh-agent-teams) — Antigravity 原生插件

本插件将 DeepSeek Harness (`dsh`) 中经过长期实战打磨的 `dsh-agent-teams` (`0.1.27-20261031-nav`)、`dsh-team-guard` 防死循环三道闸及 `agent-teams-cleanup` 归档清理技能完整迁入 Google Antigravity 原生插件体系。

## 架构映射总览

| DSH 原体系模块 | Antigravity 原生落点 | 作用说明 |
| :--- | :--- | :--- |
| 19 个业务工具 + `goal-intake` | `mcp_config.json` + `server/mcp-server.mjs` | 通过 stdio JSON-RPC 提供全部 20 个 `agent_teams_*` 工具，100% 复用 `state.js` / `quality-gates.js` / `watchdog.js` 等纯 Node 核心 |
| 三套内置团队预设 | `server/lib/default-profiles.js` | 开箱即用：`chatgpt-crew`、`heterogeneous-cross-review`、`ai-radar-squad` |
| 五维 P-P-C-G-R 成员模板 | `agents/at-*.md` (6 位子智能体) | `at-architect`, `at-engineer`, `at-researcher`, `at-gpt-reviewer`, `at-gemini-supervisor`, `at-doc-writer` |
| Captain 核心协同协议 | `rules/AGENTS.md` | 插件开启即生效：staged 审批流、Thin Router 纪律、P0 质量门与 `<=150` 词四段式汇报 |
| 编排与清场指南 | `skills/agent-teams/SKILL.md` + `skills/agent-teams-cleanup/SKILL.md` | 支持 `/agent-teams` 与 `/agent-teams-cleanup` |
| `dsh-team-guard` 三道闸 | `hooks.json` + `hooks/team-guard-hook.mjs` | `PreToolUse` 同参连击 3 次硬拦截 + 活跃团队单轮预算闸门；`Stop` 重置计数 |
| Web 团队状态看板 | `sidecars/team_board/` + `assets/agent-teams/*.png` | 基于 `sidecar_sdk` 的 Aux Pane 右侧辅助面板，含 15 张 V2 鲸鱼娘头像、DAG 与质量门视图 |

## 开关与回滚

- 插件目录：`~/.gemini/config/plugins/dsh-agent-teams/`
- 可在 Antigravity 插件管理页随时一键启用或禁用，不影响 `.dsh` 原工作区资产。
