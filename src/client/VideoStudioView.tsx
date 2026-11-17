/**
 * VideoStudioView.tsx — Unified Multi-Agent AI Video & Graphic Production Studio
 * + Local Model Download & Custom Endpoint Onboarding Wizard.
 *
 * Supports switching seamlessly between:
 *   1. `video` (🎬 AI 视频生成): Gemini leads Direction/Storyboarding/Synthesis, GPT (`gpt-image-2.6`) leads Keyframe Image Gen
 *   2. `graphic` (🎨 AI 图形生成): GPT (`gpt-image-2.6`, `gpt-6.1-sol`) leads Instant Image Generation & Multi-Agent Graphic Pipelines
 *   3. `local-models` (📦 本地模型下载与自定义接入): Hardware VRAM guide, ModelScope/HF commands & ComfyUI/SD-WebUI/Ollama binding
 */

import { useCallback, useEffect, useState } from 'react'

export interface VideoStageItem {
  id: string
  name: string
  role: string
  provider: string
  model: string
  imageModel?: string
  kind: 'requirements' | 'implementation' | 'review' | 'verification'
  reviewedTaskId?: string
  dependencies: string[]
  subject: string
  prompt: string
}

export interface VideoPipelineSpec {
  id: string
  mode?: 'video' | 'graphic'
  name: string
  subtitle: string
  badge: string
  isBuiltin?: boolean
  gitReferences?: string[]
  videoConfig: {
    mode?: 'video' | 'graphic'
    aspectRatio: string
    resolution: string
    fps: number
    renderer: string
    imageModel: string
    directorModel: string
  }
  stages: VideoStageItem[]
}

interface LocalMediaConfig {
  enabled: boolean
  providerType: string
  imageEndpoint: string
  imageModelName: string
  videoEndpoint: string
  videoModelName: string
  openaiCompatibleApiKey: string
}

interface LocalModelGuideItem {
  id: string
  category: 'graphic' | 'video'
  name: string
  badge: string
  vramRequirement: string
  runtime: string
  defaultEndpoint: string
  summary: string
  downloadCommands: string[]
}

interface GeneratedGraphicRecord {
  id: string
  prompt: string
  model: string
  size: string
  stylePreset: string
  providerUsed: string
  fallbackUsed: boolean
  imageUrl: string
  createdAt: string
}

interface VideoStudioViewProps {
  readonly activeSessionId: string
  readonly onTeamLaunched: (teamId: string, sessionId: string, message: string) => void
}

const IMAGE_MODEL_OPTIONS = [
  'gpt-image-2.6',
  'gpt-image-2.6-sunburst',
  'gpt-image-2.6-flare',
  'gpt-image-2.5',
  'gpt-image-1.5',
  'gpt-image-2',
  'flux1-schnell-fp8 (本地 ComfyUI)',
  'Kolors-Local (本地可图)',
  'gemini-3.1-flash-image',
] as const

const WORK_MODEL_OPTIONS: readonly { provider: string; model: string; label: string }[] = [
  { provider: 'antigravity', model: 'gemini-3.8-flash-tiered', label: 'Gemini 3.8 Flash Tiered · 哈吉米 (导演/合成首选)' },
  { provider: 'antigravity', model: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash High · 哈吉米 (深度分镜编剧)' },
  { provider: 'antigravity', model: 'hydrogen', label: 'Gemini Hydrogen · 哈吉米 (独立成片质检)' },
  { provider: 'antigravity', model: 'argon', label: 'Gemini 4 Argon Pro · 哈吉米 (高阶推理)' },
  { provider: 'cliproxyapi', model: 'gpt-6.1-sol', label: 'CPA GPT-6.1 Sol (驱动 GPT 生图与工程主力)' },
  { provider: 'cliproxyapi', model: 'gpt-6-astra', label: 'CPA GPT-6 Astra (多模态创意与生图调度)' },
  { provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek-V3 (DeepSeek Harness 分镜与脚本)' },
  { provider: 'qwen', model: 'qwen3-max', label: '通义千问 Qwen3-Max (中文剧本与通义万相联动)' },
  { provider: 'codex', model: 'gpt-6.1-sol', label: 'OpenAI Codex · GPT-6.1 Sol' },
]

export function VideoStudioView({ activeSessionId, onTeamLaunched }: VideoStudioViewProps) {
  const [studioMode, setStudioMode] = useState<'video' | 'graphic' | 'local-models'>('video')
  const [pipelines, setPipelines] = useState<VideoPipelineSpec[]>([])
  const [selectedId, setSelectedId] = useState<string>('vimax-gemini-gpt-studio')
  const [draft, setDraft] = useState<VideoPipelineSpec | null>(null)
  const [creativeBrief, setCreativeBrief] = useState<string>(
    '制作一段赛博星际主题的 60fps 概念宣传短片：哈吉米猫耳少女驾驶反重力棱镜飞船穿越液态玻璃星云，包含角色三视图锚点、首尾关键帧与节拍卡点转场',
  )
  const [customTeamName, setCustomTeamName] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // Instant Graphic Generation State
  const [graphicPrompt, setGraphicPrompt] = useState<string>(
    'Q版粗靛蓝描边猫耳少女哈吉米正侧背标准角色三视图（Turnaround Sheet），天蓝长卷发配粉紫/鹅黄/青绿虹彩渐变发梢，左玫红右琥珀金异色瞳，佩戴虹彩棱镜四芒星发夹，Apple 18 液态玻璃设定集排版',
  )
  const [graphicModel, setGraphicModel] = useState<string>('gpt-image-2.6')
  const [graphicSize, setGraphicSize] = useState<string>('1536x1024')
  const [graphicStyle, setGraphicStyle] = useState<string>('character-turnaround-sheet')
  const [useLocalForGraphic, setUseLocalForGraphic] = useState<boolean>(false)
  const [gallery, setGallery] = useState<GeneratedGraphicRecord[]>([])

  // Local Media Model Config & Guide State
  const [localConfig, setLocalConfig] = useState<LocalMediaConfig>({
    enabled: false,
    providerType: 'comfyui',
    imageEndpoint: 'http://127.0.0.1:8188',
    imageModelName: 'flux1-schnell-fp8.safetensors',
    videoEndpoint: 'http://127.0.0.1:8188',
    videoModelName: 'Wan2.1-T2V-1.3B',
    openaiCompatibleApiKey: '',
  })
  const [localGuide, setLocalGuide] = useState<LocalModelGuideItem[]>([])
  const [probeResult, setProbeResult] = useState<{ online?: boolean; message?: string } | null>(null)

  const loadPipelines = useCallback(async (preferredId?: string) => {
    try {
      const res = await fetch('/api/video/pipelines', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      const list: VideoPipelineSpec[] = data.pipelines ?? []
      setPipelines(list)
      if (data.localMediaConfig) setLocalConfig(data.localMediaConfig)
      if (Array.isArray(data.localModelsGuide)) setLocalGuide(data.localModelsGuide)
      if (Array.isArray(data.generatedGallery)) setGallery(data.generatedGallery)

      const target = list.find((p) => p.id === (preferredId || selectedId)) ?? list[0]
      if (target) {
        setSelectedId(target.id)
        setDraft(JSON.parse(JSON.stringify(target)) as VideoPipelineSpec)
      }
    } catch {}
  }, [selectedId])

  useEffect(() => {
    void loadPipelines()
  }, [loadPipelines])

  // Switch active pipeline automatically when toggling between Video and Graphic mode
  const handleSwitchMode = (nextMode: 'video' | 'graphic' | 'local-models') => {
    setStudioMode(nextMode)
    if (nextMode === 'video' || nextMode === 'graphic') {
      const modeList = pipelines.filter((p) => (p.mode || 'video') === nextMode)
      const first = modeList[0]
      if (first) {
        setSelectedId(first.id)
        setDraft(JSON.parse(JSON.stringify(first)) as VideoPipelineSpec)
        if (nextMode === 'graphic') {
          setCreativeBrief(
            '使用 GPT (gpt-image-2.6) 生成哈吉米猫耳少女角色正/侧/背标准三视图、6 种表情包贴纸与 Apple 18 液态玻璃项目宣传主视觉海报',
          )
        } else {
          setCreativeBrief(
            '制作一段赛博星际主题的 60fps 概念宣传短片：哈吉米猫耳少女驾驶反重力棱镜飞船穿越液态玻璃星云，包含角色三视图锚点、首尾关键帧与节拍卡点转场',
          )
        }
      }
    }
  }

  const handleSelectPipeline = (id: string) => {
    setSelectedId(id)
    const found = pipelines.find((p) => p.id === id)
    if (found) {
      setDraft(JSON.parse(JSON.stringify(found)) as VideoPipelineSpec)
      setNotice(null)
    }
  }

  const updateStage = (idx: number, patch: Partial<VideoStageItem>) => {
    if (!draft) return
    const nextStages = draft.stages.map((st, i) => (i === idx ? { ...st, ...patch } : st))
    setDraft({ ...draft, stages: nextStages })
  }

  const addStage = () => {
    if (!draft) return
    const idx = draft.stages.length + 1
    const prevId = draft.stages.at(-1)?.id
    const isGraphic = studioMode === 'graphic'
    const newStage: VideoStageItem = {
      id: `stage-custom-${idx}`,
      name: isGraphic ? `gpt-graphic-agent-${idx}` : `video-agent-${idx}`,
      role: isGraphic ? `自定义图形生图/排版专员 #${idx}` : `自定义视频制作专员 #${idx}`,
      provider: isGraphic ? 'cliproxyapi' : 'antigravity',
      model: isGraphic ? 'gpt-6.1-sol' : 'gemini-3.8-flash-tiered',
      imageModel: 'gpt-image-2.6',
      kind: 'implementation',
      dependencies: prevId ? [prevId] : [],
      subject: `执行第 ${idx} 阶段${isGraphic ? '图形生成' : '视频合成'}任务`,
      prompt: isGraphic
        ? '使用 GPT gpt-image-2.6 生成高清图形视觉资产并校验细节一致性。'
        : '使用 Gemini 编导合成或调用 GPT (gpt-image-2.6) 生成视觉关键帧资产。',
    }
    setDraft({ ...draft, stages: [...draft.stages, newStage] })
  }

  const removeStage = (idx: number) => {
    if (!draft || draft.stages.length <= 2) return
    const removedId = draft.stages[idx].id
    const nextStages = draft.stages
      .filter((_, i) => i !== idx)
      .map((s) => ({
        ...s,
        dependencies: s.dependencies.filter((d) => d !== removedId),
      }))
    setDraft({ ...draft, stages: nextStages })
  }

  const handleSaveCustomPipeline = async () => {
    if (!draft) return
    setBusy('save')
    setNotice(null)
    try {
      const payload: VideoPipelineSpec = {
        ...draft,
        mode: studioMode === 'graphic' ? 'graphic' : 'video',
        id: draft.isBuiltin ? `custom-${draft.id}-${Date.now().toString(36).slice(-4)}` : draft.id,
        name: draft.isBuiltin ? `${draft.name} (自定义版)` : draft.name,
        isBuiltin: false,
      }
      const res = await fetch('/api/video/pipelines', {
        method: 'POST',
        headers: { ' content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || !data.pipeline) throw new Error(data.error || '保存失败')
      await loadPipelines(data.pipeline.id)
      setNotice({ kind: 'ok', text: `已保存自定义流水线「${data.pipeline.name}」！` })
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  const handleLaunchVideoTeam = async () => {
    if (!draft) return
    setBusy('launch')
    setNotice(null)
    try {
      const res = await fetch('/api/video/launch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pipeline: { ...draft, mode: studioMode === 'graphic' ? 'graphic' : 'video' },
          brief: creativeBrief,
          teamName: customTeamName.trim() || undefined,
          sessionId: activeSessionId,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.teamId) {
        throw new Error(data.error || '创建团队失败')
      }
      onTeamLaunched(
        data.teamId,
        data.sessionId || activeSessionId,
        data.message || `已创建团队「${data.team?.name || data.teamId}」（待审批）`,
      )
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  const handleInstantGenerateGraphic = async () => {
    if (!graphicPrompt.trim()) return
    setBusy('gen-image')
    setNotice(null)
    try {
      const res = await fetch('/api/video/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: graphicPrompt,
          model: graphicModel,
          size: graphicSize,
          stylePreset: graphicStyle,
          useLocal: useLocalForGraphic,
        }),
      })
      const data = await res.json()
      if (data.ok && data.generated) {
        setGallery((prev) => [data.generated, ...prev])
        setNotice({
          kind: 'ok',
          text: `🎨 已使用 ${data.generated.model} (${data.generated.size}) 生成图形资产！`,
        })
      }
    } catch (err) {
      setNotice({ kind: 'err', text: `生图异常: ${(err as Error).message}` })
    } finally {
      setBusy(null)
    }
  }

  const handleSaveLocalConfig = async () => {
    setBusy('save-local')
    try {
      const res = await fetch('/api/video/local-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localConfig),
      })
      const data = await res.json()
      if (data.ok) {
        setLocalConfig(data.localMediaConfig)
        setNotice({ kind: 'ok', text: '📦 已保存本地生视频/生图模型接口配置！' })
      }
    } catch (err) {
      setNotice({ kind: 'err', text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const handleProbeLocalEndpoint = async (endpoint: string) => {
    setBusy('probe-local')
    try {
      const res = await fetch('/api/video/local-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      })
      const data = await res.json()
      setProbeResult(data)
    } catch (err) {
      setProbeResult({ online: false, message: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  if (!draft) return null

  const filteredPipelines = pipelines.filter(
    (p) => (p.mode || 'video') === (studioMode === 'graphic' ? 'graphic' : 'video'),
  )

  return (
    <div className="at-fullscreen-module-shell">
      {/* Top 3-Mode Switcher Bento Strip */}
      <div className="at-bento-top-strip">
        <div
          className="at-bento-card"
          style={{
            cursor: 'pointer',
            border: studioMode === 'video' ? '2px solid var(--at-accent-primary)' : undefined,
          }}
          onClick={() => handleSwitchMode('video')}
        >
          <div className="at-bento-card-head">
            <span className="at-bento-step">#1 · video-production</span>
            <span className={`at-bento-badge ${studioMode === 'video' ? 'running' : 'done'}`}>
              {studioMode === 'video' ? '当前激活 · Gemini 导演 + GPT 生图' : '点击切换'}
            </span>
          </div>
          <div className="at-bento-title">
            🎬 AI 视频制作工坊 — B站/YouTube 工业级 7 步首尾帧锁角色流水线 & ViMax/WebCodecs 合成
          </div>
        </div>

        <div
          className="at-bento-card"
          style={{
            cursor: 'pointer',
            border: studioMode === 'graphic' ? '2px solid var(--at-accent-primary)' : undefined,
          }}
          onClick={() => handleSwitchMode('graphic')}
        >
          <div className="at-bento-card-head">
            <span className="at-bento-step">#2 · gpt-graphic-studio</span>
            <span className={`at-bento-badge ${studioMode === 'graphic' ? 'running' : 'done'}`}>
              {studioMode === 'graphic' ? '当前激活 · GPT Image 2.6 主力' : '点击切换'}
            </span>
          </div>
          <div className="at-bento-title">
            🎨 AI 图形与视觉创作工坊 — GPT 主导角色正侧背三视图、品牌封面海报、16-Bit 像素图集与即时生图画板
          </div>
        </div>

        <div
          className="at-bento-card"
          style={{
            cursor: 'pointer',
            border: studioMode === 'local-models' ? '2px solid var(--at-accent-primary)' : undefined,
          }}
          onClick={() => handleSwitchMode('local-models')}
        >
          <div className="at-bento-card-head">
            <span className="at-bento-step">#3 · local-model-hub</span>
            <span className={`at-bento-badge ${studioMode === 'local-models' ? 'running' : 'pending'}`}>
              {localConfig.enabled ? '本地模型已启用' : '魔搭/HF 下载向导'}
            </span>
          </div>
          <div className="at-bento-title">
            📦 本地视频/图形模型下载与接入 — 一键获取 Wan2.1 / HunyuanVideo / FLUX.1 / 可图并绑定 ComfyUI
          </div>
        </div>
      </div>

      {/* Prominent Mode Switch Pill Bar */}
      <div
        className="at-solid-glass-card"
        style={{
          padding: '14px 22px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`studio-btn ${studioMode === 'video' ? 'primary' : ''}`}
            onClick={() => handleSwitchMode('video')}
          >
            🎬 切换：做视频 (AI Video Studio · Gemini 编导 + GPT 生图)
          </button>
          <button
            type="button"
            className={`studio-btn ${studioMode === 'graphic' ? 'primary' : ''}`}
            onClick={() => handleSwitchMode('graphic')}
          >
            🎨 切换：做图形 (AI Graphic Studio · GPT Image 2.6 绝对主力)
          </button>
          <button
            type="button"
            className={`studio-btn ${studioMode === 'local-models' ? 'primary' : ''}`}
            onClick={() => handleSwitchMode('local-models')}
          >
            📦 本地模型下载与自定义接口引导 ({localGuide.length} 款开源SOTA)
          </button>
        </div>
        {notice && (
          <div
            style={{
              padding: '6px 14px',
              borderRadius: 10,
              fontSize: 13.5,
              fontWeight: 700,
              background: notice.kind === 'ok' ? 'rgba(16, 185, 129, 0.14)' : 'rgba(239, 68, 68, 0.14)',
              color: notice.kind === 'ok' ? '#10b981' : '#ef4444',
            }}
          >
            {notice.text}
          </div>
        )}
      </div>

      {/* ==================== MODE 3: LOCAL MODELS DOWNLOAD & CUSTOM ONBOARDING ==================== */}
      {studioMode === 'local-models' && (
        <div className="at-fullscreen-two-col">
          {/* Left Column: Local Model Download Cards (ModelScope & HuggingFace) */}
          <section className="at-solid-glass-card" style={{ padding: 22 }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800 }}>
              📦 开源本地生视频 / 生图模型精选与国内高速下载引导
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--at-text-secondary)' }}>
              除云端 GPT (<code>gpt-image-2.6</code>) 与 Gemini 外，你可以根据显卡显存（8GB ~ 24GB）下载以下开源模型至本地 ComfyUI 或 SD-WebUI 免费无限生成：
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {localGuide.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: 16,
                    borderRadius: 16,
                    background: 'var(--at-glass-surface)',
                    border: '1px solid var(--at-glass-border)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="studio-tag" style={{ fontSize: 12 }}>
                        {item.category === 'video' ? '🎬 本地生视频' : '🎨 本地生图'}
                      </span>
                      <strong style={{ fontSize: 16 }}>{item.name}</strong>
                    </div>
                    <span className="at-bento-badge running">{item.badge}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--at-text-secondary)', margin: '8px 0' }}>
                    <strong>显存门槛：</strong>{item.vramRequirement} &nbsp;|&nbsp; <strong>推荐运行环境：</strong>{item.runtime}
                  </div>
                  <p style={{ margin: '0 0 10px', fontSize: 13.5, lineHeight: 1.55 }}>{item.summary}</p>
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      background: 'rgba(15, 23, 42, 0.08)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    {item.downloadCommands.map((cmd, idx) => (
                      <div key={idx} style={{ wordBreak: 'break-all' }}>
                        {cmd}
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="studio-btn"
                      onClick={() => {
                        const cmds = item.downloadCommands.filter((c) => !c.startsWith('#')).join('\n')
                        void navigator.clipboard?.writeText(cmds)
                        setNotice({ kind: 'ok', text: `已复制「${item.name}」高速下载命令！` })
                      }}
                    >
                      📋 一键复制下载命令
                    </button>
                    <button
                      type="button"
                      className="studio-btn primary"
                      onClick={() => {
                        if (item.category === 'video') {
                          setLocalConfig((c) => ({ ...c, enabled: true, videoModelName: item.name.split(' ')[0] }))
                        } else {
                          setLocalConfig((c) => ({ ...c, enabled: true, imageModelName: item.name.split(' ')[0] }))
                        }
                        setNotice({ kind: 'ok', text: `已将「${item.name}」填入右侧本地模型绑定配置！` })
                      }}
                    >
                      ⚡ 设为默认本地{item.category === 'video' ? '视频' : '生图'}模型
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Right Column: Custom Local Endpoint Binding & Connectivity Probe */}
          <aside className="at-solid-glass-card" style={{ padding: 22 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800 }}>
              🔌 本地模型服务端口绑定与连通性检测
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--at-text-secondary)' }}>
              支持接入本地 <strong>ComfyUI (:8188)</strong>、<strong>SD-WebUI Forge (:7860)</strong> 或任何 <strong>OpenAI 兼容图像/视频网关</strong>。开启后可在「做图形 / 做视频」中自由切换云端 GPT 或本地模型。
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={localConfig.enabled}
                  onChange={(e) => setLocalConfig({ ...localConfig, enabled: e.target.checked })}
                  style={{ width: 18, height: 18 }}
                />
                启用本地生视频 / 生图模型自定义接入
              </label>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  本地推理后端类型 (Runtime Engine)
                </label>
                <select
                  className="studio-quick-input"
                  value={localConfig.providerType}
                  onChange={(e) => setLocalConfig({ ...localConfig, providerType: e.target.value })}
                >
                  <option value="comfyui">ComfyUI (推荐 · 支持 FLUX.1 / Wan2.1 / HunyuanVideo)</option>
                  <option value="sd-webui-forge">Stable Diffusion WebUI Forge / A1111 (:7860)</option>
                  <option value="openai-compatible">OpenAI 兼容本地网关 (/v1/images/generations)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  🎨 本地生图服务地址 (Image Endpoint URL)
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="studio-quick-input"
                    style={{ flex: 1 }}
                    value={localConfig.imageEndpoint}
                    onChange={(e) => setLocalConfig({ ...localConfig, imageEndpoint: e.target.value })}
                    placeholder="http://127.0.0.1:8188"
                  />
                  <button
                    type="button"
                    className="studio-btn"
                    disabled={busy === 'probe-local'}
                    onClick={() => void handleProbeLocalEndpoint(localConfig.imageEndpoint)}
                  >
                    {busy === 'probe-local' ? '检测中...' : '🔍 检测连通性'}
                  </button>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  🎨 本地生图权重文件名 / 模型 ID
                </label>
                <input
                  className="studio-quick-input"
                  value={localConfig.imageModelName}
                  onChange={(e) => setLocalConfig({ ...localConfig, imageModelName: e.target.value })}
                  placeholder="flux1-schnell-fp8.safetensors"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  🎬 本地生视频服务地址 (Video Endpoint URL)
                </label>
                <input
                  className="studio-quick-input"
                  value={localConfig.videoEndpoint}
                  onChange={(e) => setLocalConfig({ ...localConfig, videoEndpoint: e.target.value })}
                  placeholder="http://127.0.0.1:8188"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  🎬 本地生视频权重名 (Wan2.1 / HunyuanVideo / LTX-Video)
                </label>
                <input
                  className="studio-quick-input"
                  value={localConfig.videoModelName}
                  onChange={(e) => setLocalConfig({ ...localConfig, videoModelName: e.target.value })}
                  placeholder="Wan2.1-T2V-1.3B"
                />
              </div>

              {probeResult && (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 600,
                    background: probeResult.online ? 'rgba(16, 185, 129, 0.14)' : 'rgba(245, 158, 11, 0.16)',
                    color: probeResult.online ? '#10b981' : '#d97706',
                  }}
                >
                  {probeResult.online ? '🟢 ' : '🟡 '}
                  {probeResult.message}
                </div>
              )}

              <button
                type="button"
                className="studio-btn primary"
                disabled={busy === 'save-local'}
                onClick={() => void handleSaveLocalConfig()}
              >
                💾 保存本地视频/图形模型配置
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ==================== MODE 2: INSTANT GPT GRAPHIC CANVAS (SHOWN IN GRAPHIC MODE) ==================== */}
      {studioMode === 'graphic' && (
        <div className="at-fullscreen-two-col">
          <section className="at-solid-glass-card" style={{ padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
                  ⚡ GPT Image 2.6 即时图形生成画板 (Direct Graphic Canvas)
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--at-text-secondary)' }}>
                  默认以 <strong>GPT (<code>gpt-image-2.6</code>)</strong> 为主力直接生成角色正侧背三视图、透明底图标、项目 Banner 或像素图集，也支持一键切换本地模型。
                </p>
              </div>
              <span className="studio-tag">GPT 生图首选 · 支持本地模型切换</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <textarea
                rows={3}
                className="studio-quick-input"
                style={{ width: '100%', padding: 12, resize: 'vertical' }}
                value={graphicPrompt}
                onChange={(e) => setGraphicPrompt(e.target.value)}
                placeholder="描述你想要生成的角色三视图、App 图标、GitHub 封面海报或像素精灵..."
              />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>🎨 生图模型 (默认 GPT)</label>
                  <select
                    className="studio-quick-input"
                    value={graphicModel}
                    onChange={(e) => setGraphicModel(e.target.value)}
                  >
                    {IMAGE_MODEL_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m} {m === 'gpt-image-2.6' ? '(GPT 旗舰首选)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>📐 画幅尺寸</label>
                  <select
                    className="studio-quick-input"
                    value={graphicSize}
                    onChange={(e) => setGraphicSize(e.target.value)}
                  >
                    <option value="1536x1024">1536×1024 (16:9 横屏设定集 / 封面)</option>
                    <option value="1024x1024">1024×1024 (1:1 图标 / 贴纸 / 头像)</option>
                    <option value="1024x1536">1024×1536 (9:16 竖屏海报 / 立绘)</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>✨ 视觉预设风格</label>
                  <select
                    className="studio-quick-input"
                    value={graphicStyle}
                    onChange={(e) => setGraphicStyle(e.target.value)}
                  >
                    <option value="character-turnaround-sheet">角色正侧背三视图 (Character Sheet)</option>
                    <option value="apple-liquid-glass-icon">Apple 18 液态玻璃 3D 图标</option>
                    <option value="github-hero-banner">GitHub / B站高点击宣传横幅</option>
                    <option value="pixel-16bit-sprite">16-Bit 像素透明底精灵图集</option>
                    <option value="anime-key-visual">高精度二次元厚涂主视觉</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={useLocalForGraphic}
                    onChange={(e) => setUseLocalForGraphic(e.target.checked)}
                  />
                  使用本地模型 ({localConfig.imageModelName}) 替代云端 GPT 生图
                </label>
                <button
                  type="button"
                  className="studio-btn primary"
                  disabled={busy === 'gen-image'}
                  onClick={() => void handleInstantGenerateGraphic()}
                >
                  {busy === 'gen-image' ? '⏳ GPT 正在绘制图形...' : '🎨 立即生成高清图形资产'}
                </button>
              </div>
            </div>
          </section>

          {/* Right Column: Instant Graphic Asset Preview Gallery */}
          <section className="at-solid-glass-card" style={{ padding: 22 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 19, fontWeight: 800 }}>
              🖼️ 最近生成的图形视觉资产 ({gallery.length})
            </h2>
            {gallery.length === 0 ? (
              <div
                style={{
                  padding: 28,
                  borderRadius: 16,
                  border: '1px dashed var(--at-glass-border)',
                  textAlign: 'center',
                  color: 'var(--at-text-secondary)',
                  fontSize: 14,
                }}
              >
                点击左侧「🎨 立即生成高清图形资产」，即可调用 <code>gpt-image-2.6</code> 或本地模型生成视觉稿并在此实时预览与下载。
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, maxHeight: 320, overflowY: 'auto' }}>
                {gallery.slice(0, 4).map((g) => (
                  <div
                    key={g.id}
                    style={{
                      padding: 10,
                      borderRadius: 14,
                      background: 'var(--at-glass-surface)',
                      border: '1px solid var(--at-glass-border)',
                    }}
                  >
                    <img
                      src={g.imageUrl}
                      alt={g.prompt}
                      style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 10, marginBottom: 8 }}
                    />
                    <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.prompt}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--at-text-tertiary)', display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                      <span>{g.model} · {g.size}</span>
                      <a href={g.imageUrl} download={`${g.id}.svg`} style={{ color: 'var(--at-accent-primary)', fontWeight: 700 }}>
                        下载
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ==================== FULLSCREEN TWO-COLUMN PIPELINE CONFIG & STAGE EDITOR (VIDEO OR GRAPHIC) ==================== */}
      {studioMode !== 'local-models' && (
        <div className="at-fullscreen-two-col">
          {/* Left Panel: Preset Selector + Creative Brief + Global Specs */}
          <section className="at-solid-glass-card" style={{ padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
                  {studioMode === 'graphic'
                    ? '🎨 多智能体 AI 图形设计流水线 (GPT Image 2.6 主导)'
                    : '🎬 多智能体 AI 视频制作工坊 (Gemini 导演合成 × GPT 视觉生图)'}
                </h2>
                <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--at-text-secondary)' }}>
                  {draft.subtitle}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="studio-btn"
                  disabled={busy !== null}
                  onClick={() => void handleSaveCustomPipeline()}
                >
                  {busy === 'save' ? '保存中...' : '💾 保存为自定义模板'}
                </button>
                <button
                  type="button"
                  className="studio-btn primary"
                  disabled={busy !== null}
                  onClick={() => void handleLaunchVideoTeam()}
                >
                  {busy === 'launch'
                    ? '正在组建团队...'
                    : studioMode === 'graphic'
                      ? '🚀 一键组建图形设计团队 (Staged 审批)'
                      : '🚀 一键组建视频制作团队 (Staged 审批)'}
                </button>
              </div>
            </div>

            {/* Pipeline Preset Pills */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
              {filteredPipelines.map((p) => {
                const active = p.id === selectedId
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`studio-btn ${active ? 'primary' : ''}`}
                    onClick={() => handleSelectPipeline(p.id)}
                  >
                    <span>{p.isBuiltin ? (studioMode === 'graphic' ? '🎨' : '🎬') : '🛠️'}</span>
                    <span>{p.name}</span>
                    <span style={{ fontSize: 11.5, opacity: 0.85 }}>({p.badge})</span>
                  </button>
                )
              })}
            </div>

            {/* Creative Brief Input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  🎯 {studioMode === 'graphic' ? '图形设定集 / 海报 / 角色三视图创意描述' : '视频创意主题 / 剧本大纲 / 音乐 MV 描述 (Creative Brief)'}
                </label>
                <textarea
                  rows={3}
                  className="studio-quick-input"
                  style={{ width: '100%', padding: 12, resize: 'vertical' }}
                  value={creativeBrief}
                  onChange={(e) => setCreativeBrief(e.target.value)}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>流水线模板名称</label>
                  <input
                    className="studio-quick-input"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>自定义团队名称 (可选)</label>
                  <input
                    className="studio-quick-input"
                    placeholder="默认自动根据主题命名..."
                    value={customTeamName}
                    onChange={(e) => setCustomTeamName(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Global Config Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--at-accent-primary)', display: 'block', marginBottom: 4 }}>
                  🎨 默认 GPT 生图模型 (喜好首选)
                </label>
                <select
                  className="studio-quick-input"
                  value={draft.videoConfig.imageModel}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      videoConfig: { ...draft.videoConfig, imageModel: e.target.value },
                    })
                  }
                >
                  {IMAGE_MODEL_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} {m === 'gpt-image-2.6' ? '(GPT 旗舰推荐)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>📐 画幅与分辨率</label>
                <select
                  className="studio-quick-input"
                  value={draft.videoConfig.aspectRatio}
                  onChange={(e) => {
                    const ar = e.target.value
                    const res = ar === '9:16' ? '1080x1920' : ar === '1:1' ? '1080x1080' : '1920x1080'
                    setDraft({
                      ...draft,
                      videoConfig: { ...draft.videoConfig, aspectRatio: ar, resolution: res },
                    })
                  }}
                >
                  <option value="16:9">16:9 横屏宽银幕 (1920×1080)</option>
                  <option value="9:16">9:16 竖屏短视频 (1080×1920)</option>
                  <option value="1:1">1:1 方形画幅 (1080×1080)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>🎞️ 帧率 / 输出模式</label>
                <select
                  className="studio-quick-input"
                  value={draft.videoConfig.fps}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      videoConfig: { ...draft.videoConfig, fps: Number(e.target.value) },
                    })
                  }
                >
                  <option value={60}>60 FPS (丝滑高帧率推荐)</option>
                  <option value={30}>30 FPS (标准叙事)</option>
                  <option value={24}>24 FPS (电影感帧率)</option>
                  <option value={1}>静态高清多图集 (Graphic Sheet)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>⚙️ 渲染与合成引擎</label>
                <select
                  className="studio-quick-input"
                  value={draft.videoConfig.renderer}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      videoConfig: { ...draft.videoConfig, renderer: e.target.value },
                    })
                  }
                >
                  <option value="webcodecs-ffmpeg">WebCodecs GPU + FFmpeg 混流</option>
                  <option value="gpt-image-hd-sheet">GPT Image 2.6 高清三视图/海报直出</option>
                  <option value="comfyui-wan-flux">本地 ComfyUI (Wan2.1 / FLUX.1)</option>
                  <option value="webcodecs-canvas2d">Canvas2D / WebGL 60fps 像素引擎</option>
                </select>
              </div>
            </div>
          </section>

          {/* Right Panel: Customizable Multi-Agent Stages Editor */}
          <section className="at-solid-glass-card" style={{ padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
                  🛠️ 自定义{studioMode === 'graphic' ? '图形设计' : '视频生成'}团队流水线与工作模型 ({draft.stages.length} 个阶段)
                </h3>
                <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--at-text-secondary)' }}>
                  自由定制每个阶段智能体的工作模型（Gemini / GPT / DeepSeek / 通义千问）、生图参数与依赖关系。
                </p>
              </div>
              <button type="button" className="studio-btn primary" onClick={addStage}>
                + 新增流水线阶段
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 540, overflowY: 'auto' }}>
              {draft.stages.map((stage, idx) => (
                <div
                  key={stage.id}
                  style={{
                    padding: 14,
                    borderRadius: 16,
                    background: 'var(--at-glass-surface)',
                    border: '1px solid var(--at-glass-border)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 220 }}>
                      <span className="at-bento-badge done">
                        Stage #{idx + 1} · {stage.kind}
                      </span>
                      <input
                        className="studio-quick-input"
                        style={{ width: 140, fontWeight: 700 }}
                        value={stage.name}
                        onChange={(e) => updateStage(idx, { name: e.target.value })}
                      />
                      <input
                        className="studio-quick-input"
                        style={{ flex: 1 }}
                        value={stage.role}
                        onChange={(e) => updateStage(idx, { role: e.target.value })}
                      />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <select
                        className="studio-quick-input"
                        value={`${stage.provider}:${stage.model}`}
                        onChange={(e) => {
                          const [prov, mod] = e.target.value.split(':')
                          updateStage(idx, { provider: prov, model: mod })
                        }}
                      >
                        {WORK_MODEL_OPTIONS.map((opt) => (
                          <option key={`${opt.provider}:${opt.model}`} value={`${opt.provider}:${opt.model}`}>
                            {opt.label}
                          </option>
                        ))}
                      </select>

                      {(stage.imageModel !== undefined || stage.name.includes('gpt') || stage.name.includes('artist')) && (
                        <select
                          className="studio-quick-input"
                          value={stage.imageModel || draft.videoConfig.imageModel}
                          onChange={(e) => updateStage(idx, { imageModel: e.target.value })}
                        >
                          {IMAGE_MODEL_OPTIONS.map((imgMod) => (
                            <option key={imgMod} value={imgMod}>
                              🎨 生图: {imgMod}
                            </option>
                          ))}
                        </select>
                      )}

                      {draft.stages.length > 2 && (
                        <button type="button" className="studio-btn danger" onClick={() => removeStage(idx)}>
                          移除
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>阶段任务目标 (Subject)</label>
                      <input
                        className="studio-quick-input"
                        value={stage.subject}
                        onChange={(e) => updateStage(idx, { subject: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>阶段专属指令 (Stage Prompt)</label>
                      <input
                        className="studio-quick-input"
                        value={stage.prompt}
                        onChange={(e) => updateStage(idx, { prompt: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
