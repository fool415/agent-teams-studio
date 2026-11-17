# AgentTeams Studio Desktop 用户手册与操作指南

> **撰写角色**：`doc-writer`（Gemini 3.8 Flash · 哈吉米撰稿官）  
> **适用版本**：`AgentTeams Studio v1.0.0`（Windows 原生桌面端 & Web 双栖版）  
> **相关文档**：[【交付报告与复盘】](./DELIVERY_REPORT.md) · [【CPA 架构规格说明书】](./CPA_DESKTOP_SPEC.md) · [【UI 高定审美规范】](./UI_AESTHETIC_GUIDE.md) · [【项目 README】](../README.md)

`AgentTeams Studio` 是 1:1 对标 **EasyCLIProxyAPI (`~/AppData/Local/EasyCLIProxyAPI`)** 桌面端形态打造的独立 Windows 桌面端软件与多智能体协同工作台，内置纯净 **EasyCLIProxyAPI (`cliproxyapi`) + Google Antigravity (`antigravity`)** 模型库、10 秒看门狗自动自愈守护及 DSH 2×2 Bento Grid 监控面板。

---

## 1. 快速入口与启动方式

### 1.1 双击启动原生桌面端（首选推荐）
- **桌面快捷方式**：双击桌面上的 **`AgentTeams Studio.lnk`**（由构建流水线自动创建至桌面）；
- **根目录主程序**：双击根目录下编译生成的 [`AgentTeamsStudio.exe`](../AgentTeamsStudio.exe)；
- **便携版独立目录**：进入 [`dist-desktop/AgentTeamsStudio/`](../dist-desktop/AgentTeamsStudio/)，双击其内置的 `AgentTeamsStudio.exe`。

**原生桌面端运行机制**：
1. **单实例锁保障**：通过 Windows 内核互斥锁 `AgentTeamsStudio_SingleInstance_Mutex` 防止重复多开；二次双击时自动唤醒并置顶已有窗口，绝不制造孤儿进程；
2. **后台 Core 伴随启动**：若主端口 `:4317` 未处于运行状态且配置项 `start-core-on-launch = true`，自动在后台无黑框拉起 `studio-core` Node.js 服务；
3. **系统托盘驻留**：右下角常驻 Windows `NotifyIcon` 托盘，点击窗口叉号触发 `close-behavior` 保护，防止因误关闭导致任务中断。

### 1.2 浏览器直连访问（Web 镜像模式）
无需启动原生桌面外壳时，亦可直接使用任意现代浏览器直连后台服务：
- **主工作台入口**：[`http://127.0.0.1:4317/`](http://127.0.0.1:4317/)
- **镜像工作台入口**：[`http://127.0.0.1:4318/`](http://127.0.0.1:4318/)

---

## 2. Windows 桌面端核心操作与托盘菜单

### 2.1 托盘 5 大快捷菜单项
在 Windows 任务栏右下角找到 🐾 托盘图标，鼠标右键单击呼出原生控制菜单：

| 菜单项 | 对应底层动作 |
| :--- | :--- |
| **🖥️ 显示主界面** | 恢复最小化窗口，通过 `SW_RESTORE` 将工作台置于最前台显示 |
| **🐕 看门狗自愈** | 向 `http://127.0.0.1:4317/api/watchdog/heal` 发送 POST 请求，立即自愈回收超时任务 |
| **⚡ 重启内核** | 安全终结后台 Node.js Core 子进程，并重新拉起 `bin/agent-teams-studio.mjs` |
| **🌐 外部浏览器打开** | 启动系统默认浏览器直达 `http://127.0.0.1:4317/` |
| **❌ 退出程序** | 设置强制退出标志，终结所有后台守护进程与托盘图标并安全关闭 |

### 2.2 原生窗口顶栏操作
- **🐾 AgentTeams Studio**：高定蓝品牌标识与当前状态提示；
- **🟢 内核就绪 (:4317)**：实时监控后台端口连通性；
- **🔄 刷新**：重新加载内嵌网页工作台视图；
- **🐕 看门狗自愈**：一键强制巡检团队任务依赖图并唤醒停滞调度；
- **⚡ 重启内核**：一键热重启服务核心；
- **🌐 外部浏览器**：跨窗口调用系统外部浏览器打开；
- **📥 最小化到托盘**：一键收起窗口至任务栏托盘区。

---

## 3. 便携配置文件 `config.toml` 全字段指南

桌面端与服务端核心统一读取同目录的 [`config.toml`](../config.toml)，可通过顶栏 **【🖥️ 桌面端中心】** 弹窗可视化修改，亦可直接用文本编辑器编辑。配置支持以下全部 15 个字段：

| 字段名称 | 默认值 | 允许类型 / 范围 | 详细功能说明 |
| :--- | :---: | :---: | :--- |
| `locale` | `"zh-CN"` | string | 界面国际化语言标签 |
| `port` | `4317` | 1024 ~ 65535 | Studio Core 后台主服务 HTTP 端口 |
| `mirror-port` | `4318` | 1024 ~ 65535 | 备用全栈镜像访问端口 |
| `host` | `"127.0.0.1"` | string | 服务绑定的本地回环地址 |
| `run-on-startup` | `false` | bool | 是否将程序注册至 Windows 开机自启动注册表项 |
| `start-core-on-launch` | `true` | bool | 启动 `AgentTeamsStudio.exe` 时是否自动拉起后台服务 |
| `silent-start` | `false` | bool | 启动时是否静默隐藏主窗口，仅驻留系统托盘 |
| `close-behavior` | `"ask"` | `"ask"` \| `"tray"` \| `"exit"` | 点击右上角关闭叉号的行为：<br/>• `ask`：弹窗询问最小化或退出；<br/>• `tray`：无缝隐藏至托盘；<br/>• `exit`：直接彻底退出整个软件 |
| `window-width` | `1360` | 800 ~ 3840 | 原生窗口启动时的初始像素宽度 |
| `window-height` | `860` | 600 ~ 2160 | 原生窗口启动时的初始像素高度 |
| `cpa-base-url` | `"http://127.0.0.1:8317/v1"` | URL string | 本地 EasyCLIProxyAPI (CPA) 代理地址 |
| `default-gpt-model` | `"gpt-6.1-sol"` | string | 默认路由的 GPT 工程师/审查员模型名称 |
| `watchdog-enabled` | `true` | bool | 是否激活后台看门狗定时自动巡检守护 |
| `watchdog-interval-seconds` | `10` | 3 ~ 300 | 后台看门狗定时自愈巡检周期（秒） |
| `usage-statistics-enabled` | `true` | bool | 是否开启模型与任务调用统计持久化记录 |

---

## 4. 纯净模型库、哈吉米人设与自动降级机制

### 4.1 零 DS / 零 ZCode 纯净安全底线
- 软件全栈已彻底清除所有 `workbuddy / deepseek*` 与 `zai-coding-cn / glm*` 节点；
- 仅保留 **EasyCLIProxyAPI (`cliproxyapi`)** 与 **Google Antigravity (`antigravity`)** 两个正规可信模型池。

### 4.2 角色分工与常驻哈吉米人设
1. **哈吉米（Hajimi）人设核心**：所有接入 Gemini Flash/Pro 的智能体均激活哈吉米人设（机敏灵动、审美敏锐、严守 N-4 事实核铁律）；
2. **常驻审美成员 (`ui-aesthetics`)**：
   - 角色：哈吉米审美官
   - 路由：`antigravity / gemini-3.8-flash-tiered`
   - 功能：在团队预设（如 `@chatgpt-crew`、`@heterogeneous-cross-review`、`@ai-radar-squad`）与向导中常驻存在，负责联网参考同类标杆桌面软件视觉体系并审查优化 UI。
3. **交付报告撰写官 (`doc-writer`)**：
   - 角色：哈吉米撰稿官
   - 路由：`antigravity / gemini-3.8-flash-tiered`
   - 功能：负责自动梳理多智能体执行结果并撰写长文白皮书。

### 4.3 `argon -> hydrogen` 智能多级降级
为解决高推理模型在高并发下的额度受限问题，系统提供透明多级回退链：
```text
argon (gemini-4-argon-high)
  └─► 若遇 429 配额不足 / 资源耗尽
        └─► 自动无感降级至 gemini-4-hydrogen-high
              └─► 自动降级至 hydrogen (独立黑盒审查)
                    └─► 保底回退至 gemini-3.8-flash-tiered
```

---

## 5. 桌面端管理与看门狗 API 清单

除了标准 DSH 协议路由外，服务端扩展了以下桌面端管理与自愈接口：

| 方法 | 路由路径 | 作用描述 | 核心响应字段 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/desktop/status` | 查询桌面端运行态、配置及 CPA 状态 | `portableApp`, `coreVersion`, `config`, `cpaOnline`, `watchdog`, `studioCore` |
| `GET` | `/api/desktop/config` | 读取当前 `config.toml` 配置字典与原始文本 | `ok`, `config`, `rawToml`, `configPath` |
| `POST` | `/api/desktop/config` | 提交参数字典热更新并回写 `config.toml` | `ok`, `config`, `rawToml` |
| `GET` | `/api/desktop/usage` | 获取历史智能体与模型调用统计报表 | 模型调用频次、耗时及任务吞吐量 |
| `GET` | `/api/watchdog/status` | 查询看门狗最近一次巡检报告与活跃任务 | `ok`, `intervalMs: 10000`, `reports` |
| `POST` | `/api/watchdog/heal` | 手动触发看门狗立即对卡死团队执行自愈 | `ok`, `reports` (含 `healedCount`, `needsKick`) |

---

## 6. 标准 2×2 Bento Grid 界面指南

工作台遵循高定暗色与 2×2 黄金比例 Bento Grid 栅格：
- **行 0 通栏 (`grid-column: 1 / -1`)**：展示团队标题、当前执行阶段、L0~L3 质量门禁状态徽章（`[data-quality-badges]`）及 `staged` 计划确认栏；
- **行 1 列 1（左上卡片，宽度锁定 360~420px）**：`队长（拆解·派发·汇总）` 垂直一体卡片，集成总进度条、成员树折叠列表与模型路由 Chip；
- **行 1 列 2（右上卡片，自适应 1fr）**：`任务依赖拓扑` 水平 SVG DAG 图与任务详情抽屉；
- **行 2 列 1（左下卡片，宽度锁定 360~420px）**：`总进度` 环形统计与状态统计面板；
- **行 2 列 2（右下卡片，自适应 1fr）**：`队长收件箱` 智能体回传流水消息池。

---

## 7. 常用命令清单

```powershell
# 切换至工程根目录
Set-Location '.'

# 1. 编译前端并打包 Windows 原生桌面便携端
npm run build:desktop

# 2. 独立启动桌面端 GUI
.\AgentTeamsStudio.exe

# 3. 单独启动后台全栈服务（开发调试模式）
npm start

# 4. 运行全量单元测试（包含 Studio 核心与 QQ 远程控制测试）
node --test tests/studio.test.mjs tests/qqbot.test.mjs
```

---

## 8. 官方 QQ 机器人远程控制配置与指令指南

AgentTeams Studio 内置了零第三方依赖的 **腾讯 QQ 开放平台 WebSocket v2 + HTTP REST 网关 (`channels/qqbot/`)**，可实现在手机 QQ 端远程切换模型、调整思考程度、执行单兵沙箱任务与审批多智能体团队。

### 8.1 三步极速接入流程

1. **创建专用 QQ 机器人**：在 QQ 开放平台新建独立机器人并获取 `AppID` 与 `AppSecret`（注意：同一 `AppID` 同时仅允许一个客户端连接 WebSocket，建议与 DeepSeek Harness 区分使用不同机器人）。
2. **填入凭证并连接**：打开 Studio 顶栏 **`🤖 QQ 远程`**（或 `🌐 生态与渠道` → **`🤖 QQ 远程控制`**），填入 `AppID`、`AppSecret`、默认模型、默认思考程度与授权工作区根目录，点击 **`🔌 保存并连接 QQ`**。
3. **生成配对码绑定操作者**：点击 **`🔑 生成 6 位配对码`**，用你的个人 QQ 给机器人发送 `/pair <配对码>` 完成安全绑定。未绑定配对的陌生 QQ 默认全部拦截。

### 8.2 QQ 端常用控制指令

| 指令 | 作用说明 | 示例 |
| :--- | :--- | :--- |
| `/help` | 查看当前会话模型、思考程度、目录与全部指令 | `/help` |
| `/model` / `/models [关键词]` | 列出全部可用模型编号，并可直接回复数字序号切换（也支持 `/model <序号或名称>`） | `/model` 后回复 `2` |
| `/think <级别>` | 设置思考程度：`off` / `low` / `medium` / `high` / `xhigh` / `default` | `/think xhigh` |
| `/detail <concise\|verbose>` | 切换**简洁模式**（仅看回答内容，无接单/Token卡片）或**详细模式**（也支持 `/简洁`、`/详细`） | `/detail 简洁` |
| `/mode <模式> [预设]` | 切换单兵直达 (`direct`) 或多智能体团队 (`team`) | `/mode team chatgpt-crew` |
| `/cwd [路径]` | 查看或切换授权范围内的工作区目录 | `/cwd C:\Users\YourName\Projects\my-app` |
| `/direct <需求>` | 强制以单兵直达模式使用沙箱工具完成需求 | `/direct 排查 server/index.mjs 路由` |
| `/team [预设] [--auto] <需求>` | 布置多智能体团队（默认生成 `staged` 预案推送 QQ 审批，`--auto` 自动审批启动） | `/team chatgpt-crew 补充单测` |
| `/approve [teamId]` / `/reject [teamId]` | 在 QQ 端审批启动或作废待确认团队 | `/approve` |
| `/status` / `/cancel` | 查看任务进度或立即中止当前任务与子进程 | `/cancel` |
| `/sendfile <相对路径>` | 将工作区产物回传到 QQ（自动拦截 `.env`/`secrets.json`/`.git` 等敏感文件） | `/sendfile reports/summary.md` |
| `/new` | 清空单兵上下文记忆（保留模型、思考程度与工作目录配置） | `/new` |

