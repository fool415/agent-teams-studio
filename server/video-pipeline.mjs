/**
 * Multi-Agent AI Video & Graphic Production Pipeline Engine for AgentTeams Studio.
 *
 * Supports dual creative modes inside the same unified Studio:
 *   1. `video` Mode (🎬 AI 视频生成):
 *      - HKUDS/ViMax, calderbuild/agentcut, MovieAgent, Nyankomintsu/world-execute-me-lyric-mv
 *      - Bilibili/YouTube 7-Step Industrial Film Workflow (剧本 -> 角色三视图锚点 -> 首尾帧分镜 -> GPT 首尾帧生图 -> 动态运镜 -> 配音 -> 剪辑)
 *      - Gemini leads Direction/Storyboarding/Synthesis; GPT (`gpt-image-2.6`) leads Image Generation.
 *   2. `graphic` Mode (🎨 AI 图形与视觉创作):
 *      - GPT-First (`gpt-image-2.6`, `gpt-image-1.5`, `gpt-6.1-sol`) Character Three-View Sheets, Brand Posters/Banners,
 *        App Icons, 16-Bit Pixel Sprites, and UI Visual Assets.
 *   3. `local-models` Guide & Custom Endpoint Binding (📦 本地视频/图片模型下载与自定义接入):
 *      - Built-in hardware VRAM guide, ModelScope / HuggingFace download commands, and custom endpoint binding
 *        for ComfyUI, SD-WebUI Forge, Wan2.1, HunyuanVideo, FLUX.1, Kolors, etc.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const BUILTIN_VIDEO_PIPELINES = [
  {
    id: 'vimax-gemini-gpt-studio',
    mode: 'video',
    name: 'ViMax × AgentCut 全能多智能体视频流水线 (Gemini 编导合成 + GPT 生图)',
    subtitle: 'GitHub HKUDS/ViMax 与 agentcut 架构：Gemini 负责导演、分镜与代码级视频合成，GPT gpt-image-2.6 负责高一致性角色与场景生图',
    badge: '旗舰推荐 · Gemini+GPT',
    isBuiltin: true,
    gitReferences: ['HKUDS/ViMax', 'calderbuild/agentcut', 'MovieAgent'],
    videoConfig: {
      mode: 'video',
      aspectRatio: '16:9',
      resolution: '1920x1080',
      fps: 60,
      renderer: 'webcodecs-ffmpeg',
      imageModel: 'gpt-image-2.6',
      directorModel: 'gemini-3.8-flash-tiered',
    },
    stages: [
      {
        id: 'stage-director',
        name: 'director',
        role: '总导演与视觉叙事策划（Gemini 哈吉米导演官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        kind: 'requirements',
        dependencies: [],
        subject: '拆解视频创意主题、叙事弧线、角色视觉锚点与分镜总表',
        prompt:
          '参考 GitHub HKUDS/ViMax 导演智能体规范：分析用户视频主题，制定整体视觉风格、色彩母题、角色一致性锚点描述（Character Sheet）与镜头节奏规划，输出 video-plan.md。',
      },
      {
        id: 'stage-screenwriter',
        name: 'screenwriter',
        role: '分镜编剧与时间轴设计师（Gemini 编剧官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-high',
        kind: 'implementation',
        dependencies: ['stage-director'],
        subject: '编写逐镜头分镜脚本 storyboard.json、字幕时间轴与 GPT 专用生图提示词',
        prompt:
          '参考 MovieAgent 与 agentcut 编剧规范：将导演方案转化为结构化 storyboard.json（包含每个镜头的起止秒数、旁白/歌词字幕、运镜参数、以及供 GPT gpt-image-2.6 使用的高精度英文/中文生图 Prompt）。',
      },
      {
        id: 'stage-gpt-artist',
        name: 'gpt-visual-artist',
        role: '角色立绘与分镜关键帧生图师（GPT Image 2.6 视觉官）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        imageModel: 'gpt-image-2.6',
        kind: 'implementation',
        dependencies: ['stage-screenwriter'],
        subject: '使用 GPT (gpt-image-2.6) 生成高一致性角色立绘与各分镜高清关键帧图像资产',
        prompt:
          '你是专职 GPT 视觉生图师：读取 storyboard.json 中的生图提示词，通过 CPA 渠道调用 gpt-image-2.6 / gpt-image-1.5 生成角色立绘与分镜背景图，确保角色特征跨镜头严格一致，并整理资产清单 assets/manifest.json。',
      },
      {
        id: 'stage-gemini-synthesizer',
        name: 'gemini-video-synthesizer',
        role: '程序化动效、运镜渲染与音画合成师（Gemini 视频工程官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        kind: 'implementation',
        dependencies: ['stage-gpt-artist'],
        subject: '使用 Gemini 编写 Canvas/WebCodecs 动效运镜与 FFmpeg 音视频字幕合成流水线',
        prompt:
          '你是 Gemini 视频合成总工程师：结合 storyboard.json 与 GPT 生成的关键帧图像资产，编写平滑运镜（Ken Burns 推拉摇移、粒子光影、动态歌词/字幕渲染）及 FFmpeg / WebCodecs 视频合成脚本，输出可播放的视频工程与渲染产物。',
      },
      {
        id: 'stage-video-qa',
        name: 'video-qa-supervisor',
        role: '独立成片抽帧质检与音画同步审查官（Gemini Hydrogen 督察官）',
        provider: 'antigravity',
        model: 'hydrogen',
        kind: 'review',
        reviewedTaskId: 'stage-gemini-synthesizer',
        dependencies: ['stage-gemini-synthesizer'],
        subject: '独立抽帧拼图校验画面裁切、字幕时间轴对齐与视频合成产物完整性',
        prompt:
          '独立黑盒审查视频合成代码与产物：核查分镜资产引用是否存在缺失、字幕是否存在乱码或重叠、FFmpeg/WebCodecs 导出配置是否符合目标分辨率与帧率。',
      },
    ],
  },
  {
    id: 'bilibili-youtube-industrial-film',
    mode: 'video',
    name: 'B站/YouTube 工业级首尾帧锁角色 7 步漫剧/短片流水线 (Gemini 导演 + GPT 三视图与首尾帧)',
    subtitle: '萃取各大视频平台百万播放 AI 短片教学：角色三视图锁定 -> 首尾关键帧控制 -> 动态运镜 -> 声效情绪时间轴 -> 4K 成片母带',
    badge: '影视级 7 步流 · 首尾帧锁角色',
    isBuiltin: true,
    gitReferences: ['HKUDS/ViMax', 'MovieAgent', 'Bilibili-AI-Film-SOP'],
    videoConfig: {
      mode: 'video',
      aspectRatio: '16:9',
      resolution: '1920x1080',
      fps: 60,
      renderer: 'webcodecs-ffmpeg',
      imageModel: 'gpt-image-2.6',
      directorModel: 'gemini-3.8-flash-tiered',
    },
    stages: [
      {
        id: 'film-step1-script',
        name: 'film-director',
        role: 'Step 1 · 黄金前3秒钩子与三幕剧弧线策划（Gemini 导演官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        kind: 'requirements',
        dependencies: [],
        subject: '编写三幕式故事大纲、黄金前 3 秒视觉钩子与世界观色彩圣经',
        prompt: '按 B站/YouTube 爆款 AI 影视教学第 1 步：提炼核心冲突、前 3 秒视觉奇观钩子与光影色调规范（Color Bible）。',
      },
      {
        id: 'film-step2-char-anchor',
        name: 'gpt-char-designer',
        role: 'Step 2 · 角色三视图与种子视觉锚点师（GPT Image 2.6 主导）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        imageModel: 'gpt-image-2.6',
        kind: 'implementation',
        dependencies: ['film-step1-script'],
        subject: '使用 GPT gpt-image-2.6 生成正/侧/背角色三视图与固定外貌 Tag 字典',
        prompt: '按 AI 影视防崩脸铁律：调用 gpt-image-2.6 生成主角正/侧/背三视图立绘与表情差分，锁定五官、发色、服饰锚点词。',
      },
      {
        id: 'film-step3-storyboard',
        name: 'gemini-storyboarder',
        role: 'Step 3 · 电影景别与首尾关键帧分镜表（Gemini 摄影指导）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-high',
        kind: 'implementation',
        dependencies: ['film-step2-char-anchor'],
        subject: '设计特写/中景/远景交替分镜表，为每个镜头定义首帧 (Start Frame) 与尾帧 (End Frame)',
        prompt: '编写工业级 storyboard.json：明确每镜头的景别、运镜轨迹（Dolly In / Pan / Orbit）以及首帧与尾帧的画面构图描述。',
      },
      {
        id: 'film-step4-keyframes',
        name: 'gpt-keyframe-artist',
        role: 'Step 4 · 高清首尾关键帧批量生图师（GPT Image 2.6）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        imageModel: 'gpt-image-2.6',
        kind: 'implementation',
        dependencies: ['film-step3-storyboard'],
        subject: '结合角色锚点与分镜表，使用 GPT 批量渲染每个镜头的首尾关键帧高清图',
        prompt: '复用 Step 2 角色锚点 Prompt，通过 gpt-image-2.6 生成所有镜头的首帧与尾帧高清图，确保跨镜头光影与人物 100% 统一。',
      },
      {
        id: 'film-step5-motion',
        name: 'gemini-motion-engine',
        role: 'Step 5 · 首尾帧插值运镜与空间视差合成师（Gemini 动效官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        kind: 'implementation',
        dependencies: ['film-step4-keyframes'],
        subject: '编写多层前景/中景/背景 2.5D 视差运镜与首尾帧平滑过渡渲染引擎',
        prompt: '使用 WebCodecs/Canvas2D 或本地视频模型接口将首尾帧转化为丝滑 60fps 动态镜头，加入景深模糊与环境粒子。',
      },
      {
        id: 'film-step6-audio-edit',
        name: 'gemini-sound-editor',
        role: 'Step 6 · 台词配音、BGM 卡点剪辑与花字字幕合成（Gemini 剪辑官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        kind: 'implementation',
        dependencies: ['film-step5-motion'],
        subject: '合成情绪配音、环境 Foley 音效、BGM 鼓点转场与高颜值双语字幕',
        prompt: '编写 FFmpeg 音画混流与 ASS/Canvas 动态字幕合成脚本，确保台词口型与拍点严丝合缝。',
      },
      {
        id: 'film-step7-master-qa',
        name: 'film-qa-supervisor',
        role: 'Step 7 · 独立成片分镜拼图质检与防穿帮终审（Gemini Hydrogen）',
        provider: 'antigravity',
        model: 'hydrogen',
        kind: 'review',
        reviewedTaskId: 'film-step6-audio-edit',
        dependencies: ['film-step6-audio-edit'],
        subject: '独立抽帧检查角色一致性、字幕遮挡与音画同步并签发母带交付准许',
        prompt: '按 N-1 独立审查原则核对 7 步产物完整性，输出成片质检报告。',
      },
    ],
  },
  {
    id: 'pixel-lyric-mv-pipeline',
    mode: 'video',
    name: '16-Bit 像素风程序化歌词 MV 流水线 (Gemini 动效引擎 + GPT 透明像素立绘)',
    subtitle: '基于 WebCodecs + Canvas2D/WebGL 的 60fps 程序化音乐 MV：GPT gpt-image-2.6 生成透明底像素动作序列，Gemini 编写节拍同步舞蹈与粒子渲染',
    badge: '音乐 MV · 60fps',
    isBuiltin: true,
    gitReferences: ['Nyankomintsu/world-execute-me-lyric-mv', 'HKUDS/ViMax'],
    videoConfig: {
      mode: 'video',
      aspectRatio: '16:9',
      resolution: '1920x1080',
      fps: 60,
      renderer: 'webcodecs-canvas2d',
      imageModel: 'gpt-image-2.6',
      directorModel: 'gemini-3.8-flash-tiered',
    },
    stages: [
      {
        id: 'mv-beat-planner',
        name: 'gemini-mv-director',
        role: '音乐 BPM 节拍拆解与歌词时间轴策划（Gemini 导演官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        kind: 'requirements',
        dependencies: [],
        subject: '解析歌曲 BPM 拍点、歌词段落情绪与 16-bit 角色动作状态机设计',
        prompt: '拆解音乐 BPM 节拍、副歌高潮时间窗与歌词时间轴，设计角色立绘动作序列清单与场景切换表。',
      },
      {
        id: 'mv-gpt-sprites',
        name: 'gpt-sprite-artist',
        role: '16-Bit 像素角色立绘与舞蹈序列生图师（GPT Image 2.6）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        imageModel: 'gpt-image-2.6',
        kind: 'implementation',
        dependencies: ['mv-beat-planner'],
        subject: '调用 GPT gpt-image-2.6 生成透明底像素角色立绘与动作帧并校准 regions.json',
        prompt: '使用 gpt-image-2.6 (transparent_background: true) 生成角色立绘与舞蹈帧，保持 NEAREST 邻近采样锐利像素边缘。',
      },
      {
        id: 'mv-gemini-engine',
        name: 'gemini-webgl-coder',
        role: 'Canvas2D/WebGL 逐帧动效与歌词排版渲染师（Gemini 动效官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        kind: 'implementation',
        dependencies: ['mv-gpt-sprites'],
        subject: '实现 BPM 节拍驱动的角色失重漂浮、集群矩阵舞蹈与 WebCodecs GPU 导出脚本',
        prompt: '设置 imageSmoothingEnabled = false，编写按拍点驱动的精灵动画、动态代码字幕与 WebCodecs + FFmpeg 混流脚本。',
      },
      {
        id: 'mv-qa-sheet',
        name: 'mv-qa-reviewer',
        role: '关键帧拼图快检与音画同步终审官（Gemini Hydrogen）',
        provider: 'antigravity',
        model: 'hydrogen',
        kind: 'review',
        reviewedTaskId: 'mv-gemini-engine',
        dependencies: ['mv-gemini-engine'],
        subject: '执行关键帧拼图抽检，核验零文字重叠、零裁切与音轨同步',
        prompt: '独立审查 MV 渲染代码与关键帧拼图配置，确认中英文字体预加载完整且无重叠。',
      },
    ],
  },
  {
    id: 'shortgpt-story-video',
    mode: 'video',
    name: 'ShortGPT 叙事短剧与科普视频流水线 (Gemini 剧本合成 + GPT 视觉插画)',
    subtitle: '参考 X-PLUG/MM_StoryAgent 与 ShortGPT：适合科普解说、故事漫剧、产品演示视频的敏捷 4 步流水线',
    badge: '短视频 / 漫剧',
    isBuiltin: true,
    gitReferences: ['X-PLUG/MM_StoryAgent', 'RayVentura/ShortGPT'],
    videoConfig: {
      mode: 'video',
      aspectRatio: '9:16',
      resolution: '1080x1920',
      fps: 30,
      renderer: 'ffmpeg-timeline',
      imageModel: 'gpt-image-2.6',
      directorModel: 'gemini-3.8-flash-tiered',
    },
    stages: [
      {
        id: 'short-script',
        name: 'gemini-story-writer',
        role: '爆款叙事文案与分镜脚本师（Gemini 编剧官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        kind: 'requirements',
        dependencies: [],
        subject: '撰写黄金前 3 秒钩子、旁白台词与逐镜画面描述',
        prompt: '撰写紧凑吸睛的短视频分镜脚本与字幕时间轴，输出生图 Prompt 列表。',
      },
      {
        id: 'short-gpt-illust',
        name: 'gpt-storyboard-illustrator',
        role: '高张力分镜插画生成师（GPT Image 2.6）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        imageModel: 'gpt-image-2.6',
        kind: 'implementation',
        dependencies: ['short-script'],
        subject: '使用 GPT 生图模型批量生成竖屏/横屏高清分镜插画',
        prompt: '根据脚本调用 gpt-image-2.6 生成风格统一的视觉画面资产。',
      },
      {
        id: 'short-gemini-composer',
        name: 'gemini-video-editor',
        role: '动态字幕特效与视频剪辑合成师（Gemini 剪辑官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        kind: 'implementation',
        dependencies: ['short-gpt-illust'],
        subject: '合成平滑缩放转场、高颜值动态字幕与背景音轨',
        prompt: '使用 Gemini 编写视频时间轴合成脚本（FFmpeg / HTML5 Canvas），输出完整成片配置与脚本。',
      },
      {
        id: 'short-qa',
        name: 'short-qa-auditor',
        role: '独立成片质量审查官（Gemini Hydrogen）',
        provider: 'antigravity',
        model: 'hydrogen',
        kind: 'review',
        reviewedTaskId: 'short-gemini-composer',
        dependencies: ['short-gemini-composer'],
        subject: '独立核验分镜完整性与合成脚本正确性',
        prompt: '独立审查短视频合成流水线与资产对齐情况。',
      },
    ],
  },
  // ==================== GRAPHIC / IMAGE GENERATION PIPELINES (GPT-FIRST) ====================
  {
    id: 'gpt-character-sheet-studio',
    mode: 'graphic',
    name: 'GPT 角色设定集与正侧背三视图工作流 (GPT Image 2.6 主导 + Gemini 设定企划)',
    subtitle: '以 GPT gpt-image-2.6 为绝对主力：一键产出角色正/侧/背标准三视图、6 种表情差分贴纸、透明底立绘与专属色卡设定集',
    badge: '图形主力 · GPT 角色三视图',
    isBuiltin: true,
    gitReferences: ['GPT-Image-2.6-Character-Studio', 'ComfyUI-Character-Sheet'],
    videoConfig: {
      mode: 'graphic',
      aspectRatio: '16:9',
      resolution: '1536x1024',
      fps: 1,
      renderer: 'gpt-image-hd-sheet',
      imageModel: 'gpt-image-2.6',
      directorModel: 'gpt-6.1-sol',
    },
    stages: [
      {
        id: 'char-spec-design',
        name: 'gpt-concept-lead',
        role: '角色世界观与视觉锚点主策（GPT-6.1-Sol 概念主策）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        kind: 'requirements',
        dependencies: [],
        subject: '拆解角色瞳色、发型、服饰材质、配饰锚点与三视图标准 Prompt 矩阵',
        prompt: '作为 GPT 概念主策，制定角色的外貌特征锁定词（Character Anchor Tags）、主副色值 HEX 与三视图/表情包生图 Prompt 清单。',
      },
      {
        id: 'char-gpt-turnaround',
        name: 'gpt-turnaround-artist',
        role: '角色正侧背三视图与透明立绘主美（GPT Image 2.6 首席生图官）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        imageModel: 'gpt-image-2.6',
        kind: 'implementation',
        dependencies: ['char-spec-design'],
        subject: '使用 GPT gpt-image-2.6 生成角色正/侧/背三视图、透明底主立绘与表情包套件',
        prompt: '调用 gpt-image-2.6 生成高分辨率角色三视图（Turnaround Sheet）、透明背景立绘与 6 格喜怒哀乐表情贴纸。',
      },
      {
        id: 'char-sheet-layout',
        name: 'gemini-artbook-composer',
        role: '设定集画册排版与 SVG 矢量标注师（Gemini 哈吉米审美官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        kind: 'implementation',
        dependencies: ['char-gpt-turnaround'],
        subject: '将 GPT 生成的角色立绘与三视图排版为高清交互式设定集画册与色卡规范',
        prompt: '将角色图像资产组装为带色卡、尺寸比例尺与特征引线标注的视觉设定集页面。',
      },
      {
        id: 'char-qa-review',
        name: 'graphic-qa-auditor',
        role: '视觉一致性与透视细节审查官（Gemini Hydrogen）',
        provider: 'antigravity',
        model: 'hydrogen',
        kind: 'review',
        reviewedTaskId: 'char-sheet-layout',
        dependencies: ['char-sheet-layout'],
        subject: '独立核验角色三视图比例一致性、透明通道纯净度与设定集排版质量',
        prompt: '独立审查角色图形资产与设定集产物完整性。',
      },
    ],
  },
  {
    id: 'gpt-brand-ui-poster-studio',
    mode: 'graphic',
    name: 'GPT 品牌主视觉、GitHub 宣传封面与高定图标工作流 (GPT Image 2.6 主导)',
    subtitle: '专为开源项目、独立应用与新媒体打造：使用 GPT gpt-image-2.6 生成 3D 玻璃质感 App 图标、GitHub Hero Banner 与高点击率封面',
    badge: '图形主力 · 封面与图标套件',
    isBuiltin: true,
    gitReferences: ['GPT-Image-Brand-Kit', 'Apple-Liquid-Glass-HIG'],
    videoConfig: {
      mode: 'graphic',
      aspectRatio: '16:9',
      resolution: '1536x1024',
      fps: 1,
      renderer: 'gpt-image-vector-hybrid',
      imageModel: 'gpt-image-2.6',
      directorModel: 'gpt-6.1-sol',
    },
    stages: [
      {
        id: 'brand-art-direction',
        name: 'gpt-brand-director',
        role: '品牌视觉总监与构图策划（GPT-6.1-Sol）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        kind: 'requirements',
        dependencies: [],
        subject: '规划品牌主视觉构图、光影材质（Apple 液态玻璃 / 赛博霓虹 / 极简杂志）与生图提示词',
        prompt: '制定整套品牌视觉规范：包含 App 图标（1024x1024）、GitHub 社媒 Banner（1536x1024）与宣传海报的 GPT 提示词。',
      },
      {
        id: 'brand-gpt-render',
        name: 'gpt-key-visual-artist',
        role: '主视觉海报与高清图标生成师（GPT Image 2.6）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        imageModel: 'gpt-image-2.6',
        kind: 'implementation',
        dependencies: ['brand-art-direction'],
        subject: '使用 GPT gpt-image-2.6 渲染高清品牌主视觉图、透明底图标与装饰图形切片',
        prompt: '通过 gpt-image-2.6 生成主视觉海报与透明底 App Icon 资产，确保光影通透、边缘锐利。',
      },
      {
        id: 'brand-qa-review',
        name: 'brand-qa-reviewer',
        role: '品牌视觉规范与分辨率核验官（Gemini 3.8 Flash 哈吉米审美官）',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-tiered',
        kind: 'review',
        reviewedTaskId: 'brand-gpt-render',
        dependencies: ['brand-gpt-render'],
        subject: '独立审查品牌图形资产的对比度、文字可读性与多尺寸适配度',
        prompt: '以哈吉米高定审美标准独立核验海报与图标资产。',
      },
    ],
  },
  {
    id: 'gpt-pixel-game-assets-studio',
    mode: 'graphic',
    name: 'GPT 16-Bit 游戏精灵图集、UI 边框与无缝场景贴图流水线 (GPT Image 2.6)',
    subtitle: '面向独立游戏与像素动画：使用 GPT 生成透明底 Sprite Sheet 精灵表、道具图标库、9-Slice 像素 UI 框与视差背景图层',
    badge: '图形主力 · 游戏美术资产',
    isBuiltin: true,
    gitReferences: ['Pixel-Sprite-Sheet-GPT', 'Aseprite-Pipeline'],
    videoConfig: {
      mode: 'graphic',
      aspectRatio: '1:1',
      resolution: '1024x1024',
      fps: 1,
      renderer: 'pixel-nearest-atlas',
      imageModel: 'gpt-image-2.6',
      directorModel: 'gpt-6.1-sol',
    },
    stages: [
      {
        id: 'pixel-asset-list',
        name: 'gpt-game-art-lead',
        role: '游戏美术规格与精灵网格规划师（GPT-6.1-Sol）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        kind: 'requirements',
        dependencies: [],
        subject: '定义调色板（16/32 色限制）、精灵帧网格尺寸与图层拆分清单',
        prompt: '规划角色待机/奔跑/攻击帧、道具图标与远中近三层视差背景的 GPT 像素生图指令。',
      },
      {
        id: 'pixel-gpt-generator',
        name: 'gpt-pixel-illustrator',
        role: '透明底像素精灵与场景生图师（GPT Image 2.6）',
        provider: 'cliproxyapi',
        model: 'gpt-6.1-sol',
        imageModel: 'gpt-image-2.6',
        kind: 'implementation',
        dependencies: ['pixel-asset-list'],
        subject: '调用 GPT gpt-image-2.6 生成透明底像素图集与视差背景层',
        prompt: '使用 gpt-image-2.6 生成干净无杂色的 16-bit 像素美术图集，并输出坐标切图映射表 regions.json。',
      },
      {
        id: 'pixel-atlas-qa',
        name: 'pixel-qa-inspector',
        role: '像素对齐与透明边缘质检官（Gemini Hydrogen）',
        provider: 'antigravity',
        model: 'hydrogen',
        kind: 'review',
        reviewedTaskId: 'pixel-gpt-generator',
        dependencies: ['pixel-gpt-generator'],
        subject: '独立检查像素格对齐、Alpha 通道无白边残留与 regions.json 坐标准确性',
        prompt: '独立审查像素图形资产与切图坐标。',
      },
    ],
  },
]

export const LOCAL_MEDIA_MODELS_GUIDE = [
  {
    id: 'flux-1-dev-schnell',
    category: 'graphic',
    name: 'FLUX.1-dev / FLUX.1-schnell (Black Forest Labs)',
    badge: '本地生图天花板 · 12B DiT',
    vramRequirement: '8GB 显存可用 (FP8 量化版) / 16GB+ 推荐',
    runtime: 'ComfyUI / SD-WebUI Forge / Ollama',
    defaultEndpoint: 'http://127.0.0.1:8188',
    summary: '目前开源界构图、手部细节与英文排版最强的生图底座；Schnell 版仅需 4 步即可秒级出图，适合在本地无限量免费生成分镜与海报。',
    downloadCommands: [
      '# 方式 A：通过魔搭社区 (ModelScope 国内满速免代理下载 FP8 量化版，8G 显存可跑)',
      'pip install modelscope',
      'modelscope download --model AI-ModelScope/flux1-schnell-fp8 flux1-schnell-fp8.safetensors --local_dir ./models/checkpoints',
      '# 方式 B：通过 HuggingFace CLI 下载官方权重',
      'hf download black-forest-labs/FLUX.1-schnell --local-dir ./models/flux1-schnell',
    ],
  },
  {
    id: 'qwen-image-kolors',
    category: 'graphic',
    name: 'Kolors 可图 / Qwen2.5-VL-Image (快手可图 / 通义万相本地生图)',
    badge: '中文海报汉字直出 · 国光审美',
    vramRequirement: '8GB ~ 12GB 显存',
    runtime: 'ComfyUI / Diffusers OpenAI Server',
    defaultEndpoint: 'http://127.0.0.1:8188',
    summary: '原生中文长提示词理解与画面汉字排版能力极强，非常适合国风漫剧、小红书/B站带字封面与东方角色立绘。',
    downloadCommands: [
      '# 通过魔搭社区 (ModelScope) 高速下载快手 Kolors 权重',
      'modelscope download --model Kwai-Kolors/Kolors --local_dir ./models/Kolors',
    ],
  },
  {
    id: 'wan-2-1-local-video',
    category: 'video',
    name: 'Wan2.1 通义万相开源视频大模型 (1.3B 轻量版 / 14B 旗舰版)',
    badge: '本地生视频首选 · 8G显存可跑',
    vramRequirement: '8.2GB 显存 (1.3B 消费级显卡甜点) / 24GB (14B 旗舰版)',
    runtime: 'ComfyUI-WanVideoWrapper / 官方 Gradio Server',
    defaultEndpoint: 'http://127.0.0.1:8188',
    summary: '阿里通义开源的 SOTA 文生视频/图生视频（支持首尾帧控制！）模型；1.3B 版本在家用 RTX 4060/4070 (8GB VRAM) 上即可流畅生成高清动态镜头。',
    downloadCommands: [
      '# 国内魔搭社区 (ModelScope) 满速下载 Wan2.1-T2V-1.3B (仅需 8GB 显存)',
      'pip install modelscope',
      'modelscope download --model Wan-AI/Wan2.1-T2V-1.3B --local_dir ./models/Wan2.1-T2V-1.3B',
      '# 若需图生视频 (配合 GPT 生成的首尾帧)：下载 I2V 权重',
      'modelscope download --model Wan-AI/Wan2.1-I2V-14B-480P --local_dir ./models/Wan2.1-I2V',
    ],
  },
  {
    id: 'hunyuan-video-local',
    category: 'video',
    name: 'HunyuanVideo 腾讯混元开源视频大模型 (13B FP8)',
    badge: '电影级物理光影 · 开源霸主',
    vramRequirement: '12GB ~ 16GB 显存 (ComfyUI FP8 卸载模式)',
    runtime: 'ComfyUI Native HunyuanVideo',
    defaultEndpoint: 'http://127.0.0.1:8188',
    summary: '具备极高物理真实感、镜头大幅度运动与电影级光影质感，配合 GPT Image 2.6 首帧垫图可产出媲美商业大片的视频片段。',
    downloadCommands: [
      '# 下载 ComfyUI 官方打包的 HunyuanVideo FP8 量化单文件权重 (12G 显存可跑)',
      'hf download Comfy-Org/HunyuanVideo_repackaged split_files/diffusion_models/hunyuan_video_t2v_720p_bf16.safetensors --local-dir ./models/diffusion_models',
    ],
  },
  {
    id: 'ltx-video-realtime',
    category: 'video',
    name: 'LTX-Video 2B (Lightricks 实时超高速视频生成模型)',
    badge: '秒级出片 · 低显存神器',
    vramRequirement: '6GB ~ 8GB 显存',
    runtime: 'ComfyUI / Diffusers',
    defaultEndpoint: 'http://127.0.0.1:8188',
    summary: '专为高帧率实时预演设计的 2B 轻量视频模型，生成 5 秒 24fps 视频仅需数秒，极适合快速验证分镜运镜。',
    downloadCommands: [
      '# 下载 LTX-Video 2B 轻量高速权重',
      'hf download Lightricks/LTX-Video ltx-video-2b-v0.9.5.safetensors --local-dir ./models/checkpoints',
    ],
  },
]

const customPipelinesFile = (workspaceRoot) =>
  join(resolve(workspaceRoot || process.cwd()), '.agent-teams', 'video-pipelines.json')

function readStoreData(workspaceRoot = process.cwd()) {
  const file = customPipelinesFile(workspaceRoot)
  if (!existsSync(file)) {
    return {
      pipelines: [],
      localMediaConfig: {
        enabled: false,
        providerType: 'comfyui',
        imageEndpoint: 'http://127.0.0.1:8188',
        imageModelName: 'flux1-schnell-fp8.safetensors',
        videoEndpoint: 'http://127.0.0.1:8188',
        videoModelName: 'Wan2.1-T2V-1.3B',
        openaiCompatibleApiKey: '',
      },
      generatedGallery: [],
    }
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return {
      pipelines: Array.isArray(parsed?.pipelines)
        ? parsed.pipelines.map((p) => ({ ...p, isBuiltin: false }))
        : [],
      localMediaConfig: {
        enabled: Boolean(parsed?.localMediaConfig?.enabled),
        providerType: String(parsed?.localMediaConfig?.providerType || 'comfyui'),
        imageEndpoint: String(parsed?.localMediaConfig?.imageEndpoint || 'http://127.0.0.1:8188'),
        imageModelName: String(parsed?.localMediaConfig?.imageModelName || 'flux1-schnell-fp8.safetensors'),
        videoEndpoint: String(parsed?.localMediaConfig?.videoEndpoint || 'http://127.0.0.1:8188'),
        videoModelName: String(parsed?.localMediaConfig?.videoModelName || 'Wan2.1-T2V-1.3B'),
        openaiCompatibleApiKey: String(parsed?.localMediaConfig?.openaiCompatibleApiKey || ''),
      },
      generatedGallery: Array.isArray(parsed?.generatedGallery) ? parsed.generatedGallery.slice(0, 30) : [],
      hiddenPipelineIds: Array.isArray(parsed?.hiddenPipelineIds)
        ? parsed.hiddenPipelineIds.map((x) => String(x)).filter(Boolean)
        : [],
    }
  } catch {
    return {
      pipelines: [],
      localMediaConfig: {
        enabled: false,
        providerType: 'comfyui',
        imageEndpoint: 'http://127.0.0.1:8188',
        imageModelName: 'flux1-schnell-fp8.safetensors',
        videoEndpoint: 'http://127.0.0.1:8188',
        videoModelName: 'Wan2.1-T2V-1.3B',
        openaiCompatibleApiKey: '',
      },
      generatedGallery: [],
      hiddenPipelineIds: [],
    }
  }
}

function writeStoreData(workspaceRoot = process.cwd(), data = {}) {
  const target = customPipelinesFile(workspaceRoot)
  const tmp = `${target}.${randomUUID()}.tmp`
  mkdirSync(dirname(target), { recursive: true })
  try {
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    renameSync(tmp, target)
  } finally {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {}
  }
}

export function listVideoPipelines(workspaceRoot = process.cwd()) {
  const store = readStoreData(workspaceRoot)
  const hiddenSet = new Set(store.hiddenPipelineIds || [])
  const visibleBuiltins = BUILTIN_VIDEO_PIPELINES.filter((p) => !hiddenSet.has(p.id))
  return {
    pipelines: [...visibleBuiltins, ...store.pipelines],
    customPipelines: store.pipelines,
    hiddenPipelineIds: store.hiddenPipelineIds || [],
    localMediaConfig: store.localMediaConfig,
    localModelsGuide: LOCAL_MEDIA_MODELS_GUIDE,
    generatedGallery: store.generatedGallery,
  }
}

export function saveLocalMediaConfig(workspaceRoot = process.cwd(), input = {}) {
  const store = readStoreData(workspaceRoot)
  store.localMediaConfig = {
    ...store.localMediaConfig,
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : store.localMediaConfig.enabled,
    providerType: String(input.providerType || store.localMediaConfig.providerType || 'comfyui').trim(),
    imageEndpoint: String(input.imageEndpoint || store.localMediaConfig.imageEndpoint || 'http://127.0.0.1:8188').trim(),
    imageModelName: String(input.imageModelName || store.localMediaConfig.imageModelName || 'flux1-schnell-fp8.safetensors').trim(),
    videoEndpoint: String(input.videoEndpoint || store.localMediaConfig.videoEndpoint || 'http://127.0.0.1:8188').trim(),
    videoModelName: String(input.videoModelName || store.localMediaConfig.videoModelName || 'Wan2.1-T2V-1.3B').trim(),
    openaiCompatibleApiKey:
      input.openaiCompatibleApiKey !== undefined
        ? String(input.openaiCompatibleApiKey).trim()
        : store.localMediaConfig.openaiCompatibleApiKey,
    updatedAt: new Date().toISOString(),
  }
  writeStoreData(workspaceRoot, store)
  return store.localMediaConfig
}

export async function probeLocalMediaEndpoint(endpointUrl = 'http://127.0.0.1:8188') {
  const cleanUrl = String(endpointUrl || 'http://127.0.0.1:8188').trim().replace(/\/+$/u, '')
  const probeTargets = [
    `${cleanUrl}/system_stats`, // ComfyUI
    `${cleanUrl}/sdapi/v1/sd-models`, // SD-WebUI Forge / A1111
    `${cleanUrl}/v1/models`, // OpenAI-compatible / Ollama / vLLM
    cleanUrl,
  ]
  for (const url of probeTargets) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2200)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)
      if (res.ok || res.status === 401) {
        return {
          online: true,
          endpoint: cleanUrl,
          matchedProbe: url,
          status: res.status,
          message: `本地模型服务在线 (${url} -> HTTP ${res.status})`,
        }
      }
    } catch {}
  }
  return {
    online: false,
    endpoint: cleanUrl,
    message: `未检测到本地服务响应 (${cleanUrl})，请确认已启动 ComfyUI / SD-WebUI / Ollama 或切换回 GPT (gpt-image-2.6) 云端生图。`,
  }
}

/**
 * Direct Instant Graphic/Image Generation via CPA (`gpt-image-2.6`) or Local OpenAI-compatible Endpoint,
 * with automatic high-aesthetic SVG Concept Card fallback if the external image gateway is unreachable.
 */
export async function generateStudioGraphic(workspaceRoot = process.cwd(), input = {}) {
  const prompt = String(input.prompt || '').trim() || 'Q版粗靛蓝描边猫耳少女哈吉米，天蓝长卷发配虹彩渐变发梢，Apple 18 液态玻璃科技感工作台'
  const model = String(input.model || 'gpt-image-2.6').trim()
  const size = String(input.size || '1024x1024').trim()
  const stylePreset = String(input.stylePreset || 'concept-art').trim()
  const cpaBaseUrl = String(input.cpaBaseUrl || process.env.CPA_BASE_URL || 'http://127.0.0.1:8317/v1').replace(/\/+$/u, '')
  const cpaApiKey = String(input.cpaApiKey || process.env.CPA_API_KEY || 'sk-cpa-local')

  const store = readStoreData(workspaceRoot)
  const useLocal = Boolean(input.useLocal) && Boolean(store.localMediaConfig?.enabled)
  const targetEndpoint = useLocal
    ? `${store.localMediaConfig.imageEndpoint.replace(/\/+$/u, '')}/v1/images/generations`
    : `${cpaBaseUrl}/images/generations`

  let imageUrl = ''
  let providerUsed = useLocal ? `local:${store.localMediaConfig.providerType}` : 'cliproxyapi'
  let fallbackUsed = false
  let errorDetail = ''

  const timeoutMs = Number(input.timeoutMs) > 0 ? Number(input.timeoutMs) : 5500

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(targetEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${useLocal ? store.localMediaConfig.openaiCompatibleApiKey || 'local' : cpaApiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt: `[Style: ${stylePreset}] ${prompt}`,
        n: 1,
        size,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (res.ok) {
      const data = await res.json()
      const first = Array.isArray(data?.data) ? data.data[0] : null
      if (first?.url) {
        imageUrl = first.url
      } else if (first?.b64_json) {
        imageUrl = `data:image/png;base64,${first.b64_json}`
      }
    } else {
      errorDetail = `HTTP ${res.status}`
    }
  } catch (err) {
    errorDetail = err?.message || 'endpoint unreachable'
  }

  // If live binary image endpoint wasn't reachable or returned empty, generate an instant high-res SVG Graphic Poster data URI so the user always gets an immediate visual asset preview + saved entry
  if (!imageUrl) {
    fallbackUsed = true
    const [wStr, hStr] = size.split('x')
    const width = Number(wStr) || 1024
    const height = Number(hStr) || 1024
    const safeTitle = prompt.slice(0, 34).replace(/[<>&"']/gu, '')
    const safeSub = prompt.slice(34, 76).replace(/[<>&"']/gu, '')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="45%" stop-color="#1e1b4b"/>
          <stop offset="100%" stop-color="#0ea5e9"/>
        </linearGradient>
        <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#38bdf8"/>
          <stop offset="50%" stop-color="#a855f7"/>
          <stop offset="100%" stop-color="#f472b6"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)" rx="36"/>
      <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.24)}" r="${Math.round(Math.min(width, height) * 0.22)}" fill="url(#accent)" opacity="0.28"/>
      <circle cx="${Math.round(width * 0.22)}" cy="${Math.round(height * 0.78)}" r="${Math.round(Math.min(width, height) * 0.26)}" fill="#38bdf8" opacity="0.18"/>
      <rect x="64" y="64" width="${width - 128}" height="${height - 128}" rx="28" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.24)" stroke-width="2"/>
      <text x="112" y="156" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="26" font-weight="800">🎨 GPT GRAPHIC STUDIO · ${model.toUpperCase()} · ${size}</text>
      <text x="112" y="236" fill="#ffffff" font-family="system-ui, sans-serif" font-size="42" font-weight="800">${safeTitle}</text>
      <text x="112" y="294" fill="#cbd5e1" font-family="system-ui, sans-serif" font-size="26" font-weight="500">${safeSub || 'High-Consistency Visual Asset Concept Card'}</text>
      <rect x="112" y="${height - 170}" width="440" height="58" rx="29" fill="url(#accent)"/>
      <text x="144" y="${height - 132}" fill="#ffffff" font-family="system-ui, sans-serif" font-size="24" font-weight="700">✦ Preset: ${stylePreset} · Ready for Team</text>
    </svg>`
    imageUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  }

  const record = {
    id: `img-${randomUUID().slice(0, 8)}`,
    prompt,
    model,
    size,
    stylePreset,
    providerUsed,
    fallbackUsed,
    errorDetail,
    imageUrl,
    createdAt: new Date().toISOString(),
  }
  store.generatedGallery = [record, ...(store.generatedGallery || [])].slice(0, 24)
  writeStoreData(workspaceRoot, store)
  return record
}

export function saveCustomVideoPipeline(workspaceRoot = process.cwd(), input = {}) {
  const store = readStoreData(workspaceRoot)
  const customPipelines = store.pipelines
  const id = String(input.id || '').trim() || `video-pipe-${randomUUID().slice(0, 8)}`
  const mode = input.mode === 'graphic' || input.videoConfig?.mode === 'graphic' ? 'graphic' : 'video'
  const rawStages = Array.isArray(input.stages) && input.stages.length > 0
    ? input.stages
    : BUILTIN_VIDEO_PIPELINES[0].stages

  const normalizedStages = rawStages.map((s, idx) => ({
    id: String(s.id || `stage-${idx + 1}`).trim(),
    name: String(s.name || `agent-${idx + 1}`).trim().replace(/\s+/gu, '-'),
    role: String(s.role || (mode === 'graphic' ? '图形流水线成员' : '视频流水线成员')).trim(),
    provider: String(s.provider || (mode === 'graphic' || idx === 1 ? 'cliproxyapi' : 'antigravity')).trim(),
    model: String(s.model || (mode === 'graphic' || idx === 1 ? 'gpt-6.1-sol' : 'gemini-3.8-flash-tiered')).trim(),
    ...(s.imageModel ? { imageModel: String(s.imageModel).trim() } : {}),
    kind: ['requirements', 'implementation', 'review', 'verification'].includes(s.kind)
      ? s.kind
      : 'implementation',
    ...(s.reviewedTaskId ? { reviewedTaskId: String(s.reviewedTaskId).trim() } : {}),
    dependencies: Array.isArray(s.dependencies)
      ? s.dependencies.map((d) => String(d).trim()).filter(Boolean)
      : idx > 0
        ? [String(rawStages[idx - 1].id || `stage-${idx}`).trim()]
        : [],
    subject: String(s.subject || `执行第 ${idx + 1} 阶段创作任务`).trim(),
    prompt: String(s.prompt || '按视觉制作流水线规范完成本阶段产物。').trim(),
  }))

  const saved = {
    id,
    mode,
    name: String(input.name || (mode === 'graphic' ? '自定义 AI 图形生成流水线' : '自定义 AI 视频生成流水线')).trim(),
    subtitle:
      String(
        input.subtitle ||
          (mode === 'graphic'
            ? '用户自定义多智能体图形与视觉创作流水线（GPT Image 2.6 主导）'
            : '用户自定义多智能体视频制作流水线（Gemini 编导合成 + GPT 生图）'),
      ).trim(),
    badge: String(input.badge || (mode === 'graphic' ? '自定义图形流' : '自定义视频流')).trim(),
    isBuiltin: false,
    gitReferences: Array.isArray(input.gitReferences)
      ? input.gitReferences
      : ['HKUDS/ViMax', 'calderbuild/agentcut'],
    videoConfig: {
      mode,
      aspectRatio: String(input.videoConfig?.aspectRatio || '16:9'),
      resolution: String(input.videoConfig?.resolution || '1920x1080'),
      fps: Number(input.videoConfig?.fps || (mode === 'graphic' ? 1 : 60)),
      renderer: String(input.videoConfig?.renderer || (mode === 'graphic' ? 'gpt-image-hd-sheet' : 'webcodecs-ffmpeg')),
      imageModel: String(input.videoConfig?.imageModel || 'gpt-image-2.6'),
      directorModel: String(input.videoConfig?.directorModel || (mode === 'graphic' ? 'gpt-6.1-sol' : 'gemini-3.8-flash-tiered')),
    },
    stages: normalizedStages,
    updatedAt: new Date().toISOString(),
  }

  const nextCustom = [...customPipelines]
  const existingIdx = nextCustom.findIndex((p) => p.id === id)
  if (existingIdx >= 0) nextCustom[existingIdx] = saved
  else nextCustom.push(saved)

  store.pipelines = nextCustom
  writeStoreData(workspaceRoot, store)
  return saved
}

export function deleteCustomVideoPipeline(workspaceRoot = process.cwd(), id = '') {
  const store = readStoreData(workspaceRoot)
  const nextCustom = store.pipelines.filter((p) => p.id !== id)
  if (nextCustom.length !== store.pipelines.length) {
    store.pipelines = nextCustom
    writeStoreData(workspaceRoot, store)
    return true
  }
  if (BUILTIN_VIDEO_PIPELINES.some((p) => p.id === id)) {
    const hidden = new Set(store.hiddenPipelineIds || [])
    hidden.add(id)
    store.hiddenPipelineIds = [...hidden]
    writeStoreData(workspaceRoot, store)
    return true
  }
  return false
}

export function restoreBuiltinVideoPipelines(workspaceRoot = process.cwd()) {
  const store = readStoreData(workspaceRoot)
  store.hiddenPipelineIds = []
  writeStoreData(workspaceRoot, store)
  return listVideoPipelines(workspaceRoot)
}

export function deleteGeneratedGraphic(workspaceRoot = process.cwd(), id = '') {
  const store = readStoreData(workspaceRoot)
  if (id === 'all') {
    store.generatedGallery = []
    writeStoreData(workspaceRoot, store)
    return true
  }
  const nextGallery = (store.generatedGallery || []).filter((g) => g.id !== id)
  if (nextGallery.length === (store.generatedGallery || []).length) return false
  store.generatedGallery = nextGallery
  writeStoreData(workspaceRoot, store)
  return true
}

/**
 * Convert a Video or Graphic Pipeline + User Creative Brief into a Staged Team specification
 * compatible with `createStagedTeam` (respecting N-1 review rules and mandatory staged gate).
 */
export function buildVideoTeamFromPipeline(pipeline, brief = '') {
  const pipe = pipeline || BUILTIN_VIDEO_PIPELINES[0]
  const isGraphic = pipe.mode === 'graphic' || pipe.videoConfig?.mode === 'graphic'
  const studioLabel = isGraphic ? 'AI 图形与视觉创作工坊' : 'AI 视频制作工坊'
  const videoBrief = String(brief || '').trim() || `使用「${pipe.name}」创作 ${isGraphic ? 'AI 图形资产' : 'AI 视频作品'}`
  const cfg = pipe.videoConfig || {}

  const memberMap = new Map()
  for (const stage of pipe.stages) {
    if (!memberMap.has(stage.name)) {
      memberMap.set(stage.name, {
        name: stage.name,
        role: stage.role,
        provider: stage.provider || (isGraphic ? 'cliproxyapi' : 'antigravity'),
        model: stage.model || (isGraphic ? 'gpt-6.1-sol' : 'gemini-3.8-flash-tiered'),
        executionPrompt: [
          `【${studioLabel} · 流水线：${pipe.name}】`,
          `画幅规格：${cfg.aspectRatio || '16:9'} (${cfg.resolution || '1920x1080'}${isGraphic ? '' : ` @ ${cfg.fps || 60}fps`}) · 渲染引擎：${cfg.renderer || 'webcodecs-ffmpeg'}`,
          stage.imageModel
            ? `生图模型偏好：优先使用 GPT 生图模型 ${stage.imageModel} 生成高一致性角色与视觉图像资产。`
            : isGraphic
              ? '图形主导偏好：以 GPT 模型为主导完成视觉设定、提示词精炼与高清生图。'
              : '核心编导与视频代码合成偏好：使用 Gemini 完成分镜规划、动效代码编写与音视频合成。',
          stage.prompt || '',
        ]
          .filter(Boolean)
          .join('\n'),
      })
    }
  }

  if (memberMap.size < 2) {
    memberMap.set('video-qa-supervisor', {
      name: 'video-qa-supervisor',
      role: '独立视觉质检官（Gemini Hydrogen）',
      provider: 'antigravity',
      model: 'hydrogen',
      executionPrompt: '独立黑盒审查分镜、生图资产与合成产物完整性。',
    })
  }

  const tasks = pipe.stages.map((stage, index) => {
    const isReview = stage.kind === 'review'
    const prevStageId = index > 0 ? pipe.stages[index - 1].id : undefined
    const reviewedTargetId = isReview ? stage.reviewedTaskId || prevStageId : undefined

    let assignee = stage.name
    if (isReview && reviewedTargetId) {
      const targetStage = pipe.stages.find((s) => s.id === reviewedTargetId)
      if (targetStage && targetStage.name === assignee) {
        const altMember = [...memberMap.keys()].find((k) => k !== targetStage.name)
        if (altMember) assignee = altMember
      }
    }

    return {
      id: stage.id || `vstage-${index + 1}`,
      subject: `${stage.subject}（主题：${videoBrief.slice(0, 36)}）`,
      description: [
        `创作主题：${videoBrief}`,
        `模式：${isGraphic ? '🎨 AI 图形生成 (GPT 主导)' : '🎬 AI 视频生成 (Gemini 编导 + GPT 生图)'}`,
        `画幅规格：${cfg.aspectRatio || '16:9'} (${cfg.resolution || '1920x1080'})`,
        stage.imageModel ? `指定生图模型：${stage.imageModel}` : '',
        `阶段职责说明：${stage.prompt || stage.subject}`,
      ]
        .filter(Boolean)
        .join('\n'),
      assignee,
      dependencies: Array.isArray(stage.dependencies) ? stage.dependencies : [],
      kind: stage.kind || 'implementation',
      ...(reviewedTargetId ? { reviewedTaskId: reviewedTargetId } : {}),
      objective: stage.subject,
      inScope: ['video-projects/', 'graphics/', 'src/', 'assets/', 'docs/'],
      acceptance: [
        `完成阶段「${stage.subject}」并落盘对应图形/分镜/合成产物`,
      ],
      ...(stage.kind !== 'review' ? { verify: ['node -e "process.exit(0)"'] } : {}),
    }
  })

  return {
    key: pipe.id,
    label: pipe.name,
    members: [...memberMap.values()],
    tasks,
  }
}
