# AgentTeams Studio v2.2 🐾✨

> **Apple 18 Liquid Glass Multi-Agent All-in-One Platform for Google Antigravity, OpenAI Codex, EasyCLIProxyAPI (CPA), DSH, DeepSeek Harness, xAI Grok & Domestic LLMs**
>
> 专为拥有 **Google Antigravity（反重力）**、**OpenAI Codex**、**EasyCLIProxyAPI (CPA)**、**DSH AgentTeams**、**DeepSeek Harness**、**xAI Grok (`grok-build`)** 与 **国内主流大模型（通义千问 / 智谱 GLM / Kimi K2 / 字节豆包 / 硅基流动）** 的开发者打造的综合多智能体协同平台（Web + Windows 原生 WebView2 桌面端）。

---

## ✨ v2.2 核心亮点

### 1. 🎨 Apple 18 液态 & 固态玻璃 UI + 18 款主题画廊 + 全屏多模块与字体工作台
- **Apple 18 双层玻璃材质体系**：外层采用高饱和度折射液态玻璃，内层嵌套温润固态磨砂玻璃卡片（`.at-solid-glass-card`）与水滴透镜高光控制舱（`.at-liquid-lens-dock`），并在原生桌面端移除传统黑底工具栏；
- **18 款内置高定风格画廊（1:1 复刻「纯色与渐变」9 款 +「光影与风景」9 款，持久化至 `theme-selection.json`）**；
- **全屏自适应多栏 Bento 布局 & 按钮/字体放大工作台**：
  - 全面移除窄幅居中限制，各模块采用双栏/三栏全屏铺满设计，零空间浪费；
  - 顶栏导航、按钮与输入框全面加大（`clamp(...)` 响应式流体字号 + 默认 `108%` 舒适放大）；
  - 内置 **6 套高定预设字体栈**（`Apple SF & 苹方清晰体`、`HarmonyOS 超清黑体`、`圆润元气体`、`人文书卷宋体`、`温润楷书体`、`JetBrains Mono 极客等宽体`）+ **后期自定义本机字体输入** + **全局字号无极缩放 (`90% ~ 132%`)**。

### 2. 🎬 多智能体 AI 视频 & 🎨 AI 图形创作工坊 + 本地模型下载向导 (`VideoStudioView`)
- **一键切换「🎬 做视频」或「🎨 做图形」或「📦 本地模型向导」**：
  - **🎬 AI 视频制作模式**：融合 GitHub 开源多 Agent 视频框架（`HKUDS/ViMax`、`calderbuild/agentcut`、`MovieAgent`、`world-execute-me-lyric-mv`）与 **B站/YouTube 工业级 7 步首尾帧锁角色流水线**。默认由 **Gemini** 执掌导演、分镜与 WebCodecs/FFmpeg 视频合成，**GPT (`gpt-image-2.6`)** 负责角色三视图与首尾关键帧生图；同时沉淀为标准技能 `ai-video-production/SKILL.md`；
  - **🎨 AI 图形与视觉创作模式（GPT 绝对主力）**：内置 **GPT Image 2.6 即时生图画板 (`POST /api/video/generate-image`)** 与 3 套多智能体图形流水线（角色正侧背三视图设定集、品牌海报与 Apple 18 图标套件、16-Bit 游戏精灵图集）；
  - **📦 本地视频/图片模型下载与自定义接入向导**：提供硬件显存分档指南、国内魔搭社区 (`ModelScope`) / `HuggingFace` 一键下载命令（`Wan2.1 通义万相 1.3B/14B`、`HunyuanVideo 腾讯混元`、`FLUX.1`、`Kolors 可图`、`LTX-Video`），并支持绑定本地 **ComfyUI (`:8188`)** 或 **SD-WebUI Forge (`:7860`)**。

### 3. 📡 AI 情报抓手 (3 级分流) + ⚡ 内置 `@Grok Bot` & `xai-org/grok-build` 中枢 (`AiNewsRadarView`)
- **AI 官方最新动态与社区热榜 3 级筛选**：支持按 **🌱 新手级 (`beginner`)**、**⚡ 老手级 (`power-user`)**、**🛠️ 开发级 (`developer`)** 与 **🏛️ 官方发布 / 🔥 社区热门** 精准过滤，每张卡片直观呈现 **【💎 价值评分】**、**【💡 核心价值 Why It Matters】** 与 **【📝 一句话内容简介】**；
- **内置自研 `@Grok Bot` 引擎 (`channels/grokbot/grok-bot-service.mjs`)**：完美适配开源 `xai-org/grok-build`、`xAI Grok-3` 与本地 CPA / DeepSeek 自动降级路由，支持 **⚖️ `@grok` 事实核查 (Fact-Check)**、**🔎 DeepSearch 全网深搜**、**🌶️ 毒舌红队锐评 (Roast)** 与 **🛠️ Grok-Build 原子任务拆解**。

### 4. 🚴 底部 `AgentSpeed` 实时速率底栏 + 💾 Git 版本时光机 (`AgentSpeedBar`) + `BV1rPWd6nEpP` 规范
- **系统底部常驻 `AgentSpeed` 速率条与悬浮仪表盘**：实时显示当前推理速度 (`tok/s`)、活跃生成/工具数、`1分 / 2分 / 5分` 实时曲线、今日均速 (`69 tok/s`)、峰值 (`252 tok/s`)、输出/输入(含缓存) Token 与 API 等值费用 (`≥US$`)；
- **深度集成 B站 UP主 oil欧呦 `BV1rPWd6nEpP`《如何用 AI 长期开发一个复杂项目》方法论**：内置 `bv1rpwd6nepp-long-horizon` 知识库与底栏 **「💾 Git 保存版本」** 按钮，每次更新一键创建 Git 快照并支持复制回退命令。

### 5. 🤖 全景模型与供应商中心 (`ModelCatalogView` · 支持中转站一键拉取)
- 独立一级导航 **「🤖 模型与供应商」**，一眼看清当前默认路由、活跃团队成员正在使用的模型以及 **20+ 内置供应商与中转站**：
  - **五大 Agent 宿主生态**：`Google Antigravity (反重力)`、`OpenAI Codex`、`DSH`、`ZCode`、`OpenCode (Zen 终端路由)`；
  - **主流中转站与聚合网关**：`EasyCLIProxyAPI (CPA)`、`NewAPI / OneAPI / VoAPI`、`OpenRouter`、`AiHubMix`、`硅基流动 SiliconFlow` 及任意自定义中转站；
  - 支持填入中转站 `Base URL` 与 `API Key` 后 **「🔄 一键从 `/models` 自动拉取全站模型」**、单模型 **「⚡ 测速连通 (Ping)」**、一键设为默认或建队，并支持任意供应商与单模型的自由增删与一键恢复。

### 6. 📊 独立 CPA 模型消耗与团队遥测中心 (`CpaUsageView`)
- 作为独立一级功能模块，同时直连本机 EasyCLIProxyAPI `usage-records/usage.db` 与 Studio 团队级计量账本：
  - 精确追踪 **每个团队 (`teamName`)、每个成员 (`member`)、每个任务 (`task`)** 的 Input / Output / Reasoning / Cached / Total Tokens、缓存命中率与响应延迟；
  - 支持 `24h / 7d / 30d / 全部` 时间范围切换、全渠道模型消耗排行榜与实时请求事件流水表。

### 6. 🧩 可扩展知识库与自定义模块中心 (`OpsManualView` & `MobileApprovalView`)
- 支持用户在界面上直接新增、编辑、删除自定义知识库手册、核心规格指标卡、SOP 排障卡片与跨端自定义快捷模块，设置触发关键词后在团队任务执行时自动注入 Prompt，UI 自动适配渲染。

### 2. 🌐 四大生态双向全能适配（Antigravity + Codex + CPA 渠道 + DSH）
| 生态 / 渠道 | 作为宿主挂载 Studio (MCP + Skills) | 在 Studio 内调度执行任务 |
| :--- | :--- | :--- |
| **🔌 内置 CPA 渠道 (`channels/cpa/`)** | 内置零依赖 Node.js 版 `cpa-mcp-server.mjs` + Python 版 `easycli_mcp_server.py`，提供 `ask_gpt`、`generate_image`、`list_available_gpt_models` | 聚合 **Antigravity OAuth** 与 **Codex OAuth** 账号，支持一键探测/唤醒 `:8317` 内核与打开 `/management.html` 管理台 |
| **🪐 Google Antigravity (反重力)** | 一键同步 `agent-teams-studio` 与 `dsh-agent-teams`（含 7 大角色 Agent 与 `@cpa-gpt`）至 `~/.gemini/config/plugins/` | 原生支持 Gemini 3.8 Flash（哈吉米人设）、Hydrogen 独立黑盒红队、Argon 旗舰推理及自动无感降级 |
| **🧠 OpenAI Codex (`@openai/codex`)** | 自动向 `~/.codex/config.toml` 幂等注入三大 MCP 服务，并安装 `~/.codex/skills/agent-teams-studio` | 支持 **API 网关模式**（CPA / OpenAI BaseURL）与 **本机 `codex exec` CLI 桥接模式** |
| **🐉 DSH AgentTeams** | 100% 兼容 `/plugins/dsh-agent-teams/*` 全部 REST 接口契约 | 实时双向互通工作区 `.agent-teams/` 状态目录、P0 质量门、N-1 异体独立审查与 SHA256 产物校验 |

### 3. 🛡️ 强制执行前审批 (`staged` -> `running`) + N-1 独立裁判 + 10s 看门狗自愈
- **先审批后执行**：所有通过向导、MCP 或 `@快捷模式` 创建的团队均停留在 `staged` 阶段，经用户在看板点击【确认并启动团队】后才正式派生执行；
- **N-1 异体审查与自动返工闭环**：强制拦截同人自审；当审查官输出 `VERDICT: NEEDS_REVISION` 时，自动生成 `repair` 返工任务退回原作者修复并复审；
- **Git Worktree 分支隔离 + 跨设备手机端远程审批 (`/?view=mobile`)**。

---

## 🚀 快速开始 (Quickstart)

### 1. 克隆并安装依赖

```bash
git clone https://github.com/fool415/agent-teams-studio.git
cd agent-teams-studio
npm install
```

### 2. 一键挂载到 Antigravity / Codex / DSH

```bash
# 自动检测并将插件、Skills 与 MCP 服务注册到 ~/.gemini、~/.codex 与当前工作区
npm run setup

# 或者使用 CLI 指定安装目标：
node ./bin/agent-teams-studio.mjs install --target antigravity,codex,dsh

# 运行全生态健康体检：
npm run doctor
```

### 3. 启动 Web 工作台或编译 Windows 原生桌面端

```bash
# 方式 A：构建前端并启动跨平台 Web 服务端 (macOS / Linux / Windows 通用)
# 访问 http://127.0.0.1:4317 (镜像端口 http://127.0.0.1:4318)
npm run build
npm start

# 方式 B（Windows 专属）：一键编译无黑框 WebView2 原生桌面端 AgentTeamsStudio.exe 并组装便携包
npm run build:desktop
./AgentTeamsStudio.exe
```

### 4. 运行全量自动化测试

```bash
npm test
```

---

## 📂 项目目录结构

```text
agent-teams-studio/
├── bin/
│   └── agent-teams-studio.mjs          # CLI 启动器 + install / doctor / cpa-start 工具
├── channels/
│   └── cpa/                            # 内置 EasyCLIProxyAPI (CPA) 渠道套件
│       ├── cpa-channel-manager.mjs     # CPA 内核探测、OAuth 统计与伴随启动器
│       ├── cpa-mcp-server.mjs          # 零依赖 Node.js 版 easycli-gpt MCP Server
│       ├── easycli_mcp_server.py       # Python 版 easycli-gpt MCP Server
│       ├── config.example.toml         # 脱敏版 CPA 桌面端配置模板
│       └── cpa-core/                   # CPA 内核配置模板与 OAuth 管理台静态资源
├── integrations/                       # 三大宿主生态开箱即用集成资产
│   ├── plugins/
│   │   ├── agent-teams-studio/         # Antigravity Studio 快捷插件
│   │   └── dsh-agent-teams/            # 完整 DSH 7 角色智能体 + @cpa-gpt + Hooks + Skills
│   └── codex/                          # OpenAI Codex Skills 与 AGENTS.md 协作规范
├── server/
│   ├── index.mjs                       # HTTP/SSE 主服务 + DSH 兼容路由 + 多生态/主题 API
│   ├── ecosystem-installer.mjs         # Antigravity / Codex / DSH 自动检测与安装引擎
│   ├── desktop-manager.mjs             # config.toml 与 theme-selection.json 持久化管理
│   ├── cpa-client.mjs                  # 多渠道 OpenAI/Gemini 兼容客户端与无感降级
│   ├── cpa-runner.mjs                  # DAG 调度器、N-1 质量门与自动返工引擎
│   └── studio-mcp-server.mjs           # Studio 原生 MCP Server
├── src/
│   ├── App.tsx                         # 主工作台 + Liquid Glass 主题画廊 + 多生态控制中心
│   ├── styles.css                      # Apple Liquid Glass & 6 大预设主题样式系统
│   └── client/
│       └── theme-registry.ts           # EasyCLIProxyAPI 多风格切换与持久化引擎
├── desktop/                            # Windows C# + Edge WebView2 原生桌面端源码
├── tests/
│   └── studio.test.mjs                 # 全量端到端单元测试套件
├── config.toml                         # 默认服务与多渠道配置文件
├── theme-selection.json                # 1:1 对标 EasyCLIProxyAPI 的主题状态文件
└── LICENSE                             # MIT 开源许可证
```

---

## 📚 进阶文档导航

- 📘 [【桌面端交付报告与架构复盘】](./docs/DELIVERY_REPORT.md)
- 📗 [【用户操作指南与配置手册】](./docs/USER_GUIDE.md)
- 📙 [【CPA 桌面端架构与纯净模型库规格说明书】](./docs/CPA_DESKTOP_SPEC.md)
- 🎨 [【UI 高定审美设计规范指南】](./docs/UI_AESTHETIC_GUIDE.md)

---

## 📄 License

本项目基于 [MIT License](./LICENSE) 开源发布。
