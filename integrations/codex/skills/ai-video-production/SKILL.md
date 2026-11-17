---
name: ai-video-production
description: 多智能体 AI 视频与图形生成全流程技能（B站/YouTube 工业级 7 步首尾帧锁角色流水线 + GitHub ViMax/AgentCut 架构）。默认由 Gemini 负责导演、分镜与 WebCodecs/FFmpeg 视频代码合成，GPT (gpt-image-2.6) 负责高一致性角色三视图、首尾关键帧与图形资产生成，同时支持接入本地 ComfyUI/Wan2.1/FLUX.1 模型。
---

# 多智能体 AI 视频与图形生成工坊技能 (AI Video & Graphic Production SOP)

当用户要求制作 AI 视频、动画短片、歌词 MV、科普漫剧，或生成角色三视图、项目主视觉海报、游戏像素精灵图集时，激活本技能。

## 1. 核心模型分工准则（User Preference）

1. **视频制作模式 (`🎬 Video Mode`)**：
   - **Gemini 主导编导与合成** (`antigravity/gemini-3.8-flash-tiered`, `gemini-3.8-flash-high`, `hydrogen`)：负责故事三幕剧弧线、分镜时间轴 (`storyboard.json`)、Canvas2D/WebGL/WebCodecs 动效运镜代码编写、FFmpeg 音画混流以及 N-1 独立抽帧质检。
   - **GPT 主导视觉生图** (`cliproxyapi/gpt-image-2.6`, `gpt-image-1.5`)：负责角色正/侧/背三视图立绘、透明底精灵图集与各镜头首尾关键帧（Start/End Keyframes）高清生成。
2. **图形制作模式 (`🎨 Graphic Mode`)**：
   - **GPT 绝对主力** (`gpt-image-2.6` + `gpt-6.1-sol`)：负责角色设定集三视图、品牌主视觉 Banner、3D 液态玻璃图标、16-Bit 游戏资产图集生成。
3. **本地开源模型可选接入 (`📦 Local Models`)**：
   - **本地生图**：`FLUX.1-dev / schnell (FP8)`、`Kolors (快手可图)`、`SDXL`（通过 ComfyUI `http://127.0.0.1:8188` 或 SD-WebUI Forge `http://127.0.0.1:7860`）。
   - **本地生视频**：`Wan2.1 (通义万相 1.3B 8G显存版 / 14B 旗舰版)`、`HunyuanVideo (腾讯混元)`、`LTX-Video`。

---

## 2. B站 / YouTube 工业级 AI 短片 7 步标准工作流 (7-Step SOP)

在执行视频生成任务时，严格遵循以下 7 步防崩脸、防穿帮工业流水线：

1. **Step 1 · 黄金前 3 秒钩子与三幕剧剧本 (`director` / Gemini)**
   - 输出 `video-plan.md`：包含核心冲突、前 3 秒视觉奇观钩子、全片色彩母题（Color Bible）与 BPM 节奏点。
2. **Step 2 · 角色三视图与固定外貌锚点 (`gpt-char-designer` / GPT Image 2.6)**
   - 先生成主角正/侧/背三视图（Turnaround Sheet），提炼固定不变的 `Character Anchor Prompt`（发色、瞳色、服饰材质、标志性配饰），杜绝跨镜头换脸。
3. **Step 3 · 电影景别与首尾关键帧分镜表 (`gemini-storyboarder` / Gemini)**
   - 输出结构化 `storyboard.json`：为每个镜头定义景别（ECU 特写 / MS 中景 / WS 远景）、运镜方式（Dolly In / Pan / Orbit）以及 **首帧 (Start Frame)** 与 **尾帧 (End Frame)** 的精确画面描述。
4. **Step 4 · 首尾关键帧批量生图 (`gpt-keyframe-artist` / GPT Image 2.6)**
   - 将 Step 2 的角色锚点词拼接到每个分镜 Prompt，调用 `gpt-image-2.6` 批量生成所有镜头的首帧与尾帧高清图，写入 `assets/manifest.json`。
5. **Step 5 · 动态运镜与视差合成 (`gemini-motion-engine` / Gemini 或本地 Wan2.1)**
   - 使用 WebCodecs + Canvas2D/WebGL（或本地 ComfyUI `Wan2.1-I2V` 首尾帧图生视频）将静态关键帧合成为 60fps 动态视频片段，加入 2.5D 景深视差与粒子光影。
6. **Step 6 · 配音配乐、卡点剪辑与动态字幕 (`gemini-sound-editor` / Gemini)**
   - 使用 FFmpeg 混流语音、Foley 环境音效与 BGM，渲染无重叠双语动态字幕。
7. **Step 7 · 独立抽帧拼图质检 (`film-qa-supervisor` / Gemini Hydrogen)**
   - 遵循 N-1 非作者独立审查原则，将关键帧拼成 Contact Sheet 检查是否存在裁切、文字重叠或角色穿帮。

---

## 3. AgentTeams Studio 快捷调用方式

- **Web / 桌面端 GUI**：打开 `http://127.0.0.1:4317/` -> 切换至顶栏 **「🎬 AI 视频与图形工坊」** -> 顶部自由切换 **「🎬 视频生成模式」**、**「🎨 图形生成模式 (GPT 主导)」** 或 **「📦 本地模型下载与接入向导」**。
- **API 端点**：
  - `GET /api/video-pipelines`：获取内置视频流水线、图形流水线与本地模型指南
  - `POST /api/video-studio/spawn`：根据选定流水线与创意主题一键生成 `staged` 待审批团队
  - `POST /api/video-studio/generate-image`：使用 `gpt-image-2.6` 或本地模型直接生成图形资产
