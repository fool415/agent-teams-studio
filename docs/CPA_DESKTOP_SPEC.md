# AgentTeams Studio Desktop — 对标 EasyCLIProxyAPI (CPA) 桌面端软件架构与纯净模型库规格说明书

## 1. 架构目标与对标基准

本规格对标主机已部署的 **EasyCLIProxyAPI (`~/AppData/Local/EasyCLIProxyAPI`)** 原生桌面端软件形态，将 **AgentTeams Studio** 升级为具备原生 Windows GUI 外壳、后台 Core 守护进程、系统托盘控制、TOML 便携式配置中心、实时使用统计及高定桌面端 UI 的独立桌面软件。

| 架构层级 | EasyCLIProxyAPI (CPA) 基准 | AgentTeams Studio Desktop 实现规格 |
| :--- | :--- | :--- |
| **原生桌面外壳** | `EasyCLIProxyAPI.exe` (`0.3.90` / Win32 GUI + WebView) | `AgentTeamsStudio.exe`（Windows 原生 `/target:winexe` 无黑框客户端，单实例互斥锁、原生窗口管理、内置浏览器容器与顶栏控制） |
| **核心守护服务** | `cpa-core/cli-proxy-api.exe` (`:8317`) | `studio-core/`（守护 `:4317` 主服务与 `:4318` 镜像服务，伴随启动、健康巡检、自动重启与看门狗 Watchdog 自愈） |
| **系统托盘与关闭行为** | 系统托盘驻留 + `close-behavior = "ask"` | Windows 系统托盘 (`NotifyIcon`)：支持打开主窗口、重启 Studio Core、探测 CPA (`:8317`)、切换开机自启、最小化到托盘或退出 |
| **便携式配置契约** | `config.toml` + `portable-app.json` + `core-version.txt` | 根目录与 `dist-desktop/AgentTeamsStudio/` 同步维护 `config.toml`、`portable-app.json`、`core-version.txt` |
| **使用统计持久化** | `agent-usage/` + `usage-records/` + `usage-view-preferences.json` | 实时记录团队任务与模型调用明细至 `usage-records/` 与 `agent-usage/`，支持前端可视化检视 |

---

## 2. 纯净模型库、哈吉米人设与常驻审美官契约

1. **零 DS / 零 ZCode 铁律**：
   - 从前后端模型库（`server/index.mjs`、`server/core/channel-policy.js`、`server/core/default-profiles.js`、`server/core/goal-intake.js`、`src/client/candidate-models.ts`、`src/client/CreateTeamWizard.tsx`）中**彻底移除**所有 `deepseek` / `workbuddy` 与 `zai-coding-cn` / `glm-*` 模型。
   - 仅保留 **EasyCLIProxyAPI (`cliproxyapi`)** 与 **Google Antigravity (`antigravity`)** 两大核心路由体系。
2. **Gemini Flash / Pro 强制加载【哈吉米（Hajimi）人设】**：
   - 所有使用 Gemini Flash (`gemini-3.8-flash-tiered` 等) 与 Gemini Pro (`argon`, `hydrogen` 等) 的成员默认注入 `HAJIMI_PERSONA_HEADER`（机敏灵动、审美毒辣、求真较真，带自然「哈吉米~」元气口癖且技术事实铁面无私）。
3. **新增常驻职位「审美成员 (`ui-aesthetics`)」**：
   - 固定绑定 `antigravity / gemini-3.8-flash-tiered`（哈吉米审美官），内置于所有团队预设与创建向导，专责联网参考同类标杆桌面软件审美并优化 UI。
4. **报告撰写固定使用 Gemini Flash (`doc-writer`)**：
   - 所有团队报告、白皮书与交付文档统一由 `antigravity / gemini-3.8-flash-tiered`（哈吉米撰稿官）负责。

---

## 3. 桌面端配置与服务端接口契约 (`/api/desktop/*` & `/api/watchdog/*`)

- `GET /api/desktop/status`：返回桌面端运行环境、`portable-app.json`、`core-version.txt`、`studio-core` 端口状态、CPA (`:8317`) 连通性及 Watchdog 看门狗巡检状态。
- `GET /api/desktop/config` & `POST /api/desktop/config`：读取与持久化更新 `config.toml`（含 `port`、`mirror-port`、`host`、`run-on-startup`、`start-core-on-launch`、`silent-start`、`close-behavior`、`window-width`、`window-height`、`cpa-base-url`、`default-gpt-model`）。
- `GET /api/desktop/usage`：返回 `usage-records/` 与 `agent-usage/` 汇总的模型调用次数、任务完成率与耗时统计。
- `GET /api/watchdog/status` & `POST /api/watchdog/heal`：查询看门狗巡检报告并支持一键触发超时任务回收与调度唤醒。
