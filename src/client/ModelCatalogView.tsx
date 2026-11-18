/**
 * ModelCatalogView.tsx — Unified Model & Provider Hub (`🤖 模型与供应商`).
 *
 * Displays all currently available models, active team model bindings, and model providers across:
 *   - Agent Platforms: Google Antigravity (反重力), OpenAI Codex, DSH, ZCode, OpenCode
 *   - Relay Stations (中转站): EasyCLIProxyAPI (CPA), NewAPI / OneAPI / VoAPI, OpenRouter, AiHubMix, SiliconFlow & Custom Relays
 *   - Official Cloud Platforms: OpenAI, Anthropic, DeepSeek, xAI Grok, Alibaba Qwen, Zhipu GLM, Moonshot Kimi, Doubao, MiniMax
 *   - Local Engines: Ollama / vLLM
 *
 * Supports full Add + Edit + Auto-Discover (`/v1/models`) + Live Ping Test + Delete/Hide + Restore.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { ActivityTeam } from './activity-monitor.ts'

export interface ProviderModelItem {
  id: string
  name?: string
  description?: string
  ownedBy?: string
  contextWindow?: number
  isLiveDiscovered?: boolean
  isCustom?: boolean
}

export interface RuntimeProviderEntry {
  id: string
  name: string
  icon?: string
  category?: 'agent-platform' | 'relay-station' | 'official-cloud' | 'local'
  region?: 'global' | 'domestic' | 'local'
  protocol?: string
  baseUrl?: string
  website?: string
  badge?: string
  description?: string
  isCustom?: boolean
  hasApiKey?: boolean
  apiKeyMasked?: string
  status?: 'online' | 'configured' | 'gateway-fallback' | 'offline'
  models: ProviderModelItem[]
}

interface ModelsHubResponse {
  ok?: boolean
  cpaOnline: boolean
  cpaBaseUrl: string
  liveCpaCount?: number
  defaultGptModel: string
  totalProvidersCount?: number
  totalModelsCount?: number
  hiddenProvidersCount?: number
  providers: RuntimeProviderEntry[]
}

interface PingOutcome {
  reachable: boolean
  latencyMs: number
  reply?: string
  error?: string
  routeUsed?: string
}

const CATEGORY_TABS: readonly {
  id: 'all' | 'agent-platform' | 'relay-station' | 'official-cloud' | 'local'
  label: string
}[] = [
  { id: 'all', label: '🌐 全部供应商' },
  { id: 'agent-platform', label: '🪐 反重力 / Codex / DSH / ZCode / OpenCode' },
  { id: 'relay-station', label: '🏮 中转站与聚合 (CPA / NewAPI / OpenRouter)' },
  { id: 'official-cloud', label: '🏛️ 主流官方平台' },
  { id: 'local', label: '🦙 本地离线' },
]

const RELAY_QUICK_TEMPLATES: readonly {
  id: string
  name: string
  icon: string
  category: 'agent-platform' | 'relay-station' | 'local'
  baseUrl: string
  placeholderModels: string
}[] = [
  {
    id: 'newapi',
    name: 'NewAPI / OneAPI 通用中转站',
    icon: '🏮',
    category: 'relay-station',
    baseUrl: 'https://your-relay-domain.com/v1',
    placeholderModels: 'gpt-4o, claude-3-7-sonnet-20250219, deepseek-r1, gemini-2.5-pro',
  },
  {
    id: 'opencode',
    name: 'OpenCode (Zen 终端路由 / 本地服务)',
    icon: '🧩',
    category: 'agent-platform',
    baseUrl: 'https://opencode.ai/zen/v1',
    placeholderModels: 'claude-sonnet-4-6, gpt-5, qwen3-coder',
  },
  {
    id: 'zcode',
    name: 'ZCode (智谱编码代理 / Coding Plan)',
    icon: '⚡',
    category: 'agent-platform',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    placeholderModels: 'glm-4.5, glm-4.5-air, zcode-coder',
  },
  {
    id: 'dsh',
    name: 'DSH 专属网关 / Harness 节点',
    icon: '🐉',
    category: 'agent-platform',
    baseUrl: 'http://127.0.0.1:8317/v1',
    placeholderModels: 'gpt-6.1-sol, deepseek-chat, deepseek-reasoner',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter 全球模型中转',
    icon: '🌐',
    category: 'relay-station',
    baseUrl: 'https://openrouter.ai/api/v1',
    placeholderModels: 'anthropic/claude-sonnet-4, openai/gpt-4.1, google/gemini-2.5-pro',
  },
]

export const ModelCatalogView: React.FC<{
  teams: readonly ActivityTeam[]
  onQuickUseModel?: (modelToken: string) => void
  onModelsUpdated?: () => void
  onStatusMessage?: (msg: string) => void
}> = ({ teams, onQuickUseModel, onModelsUpdated, onStatusMessage }) => {
  const [hub, setHub] = useState<ModelsHubResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<
    'all' | 'agent-platform' | 'relay-station' | 'official-cloud' | 'local'
  >('all')
  const [selectedProviderId, setSelectedProviderId] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [onlyLiveOrCustom, setOnlyLiveOrCustom] = useState(false)

  // Add / Edit Provider & Relay Station Form State
  const [editorOpen, setEditorOpen] = useState(false)
  const [draftId, setDraftId] = useState('')
  const [draftName, setDraftName] = useState('')
  const [draftIcon, setDraftIcon] = useState('🏮')
  const [draftCategory, setDraftCategory] = useState<'agent-platform' | 'relay-station' | 'official-cloud' | 'local'>('relay-station')
  const [draftBaseUrl, setDraftBaseUrl] = useState('')
  const [draftApiKey, setDraftApiKey] = useState('')
  const [draftModelsText, setDraftModelsText] = useState('')
  const [savingProvider, setSavingProvider] = useState(false)
  const [discovering, setDiscovering] = useState(false)

  // Quick Add Single Model to Selected Provider
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')

  // Ping results keyed by `${providerId}:${modelId}`
  const [pingMap, setPingMap] = useState<Record<string, PingOutcome | 'loading'>>({})
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const loadHub = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/models', { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as ModelsHubResponse
        setHub(data)
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadHub()
  }, [loadHub])

  // Compute real-time models currently bound across active/staged teams
  const activeTeamBindings = useMemo(() => {
    const list: { teamName: string; phase: string; memberName: string; provider: string; model: string }[] = []
    for (const team of teams) {
      for (const m of team.members ?? []) {
        list.push({
          teamName: team.name,
          phase: team.phase,
          memberName: m.name,
          provider: m.provider || 'cliproxyapi',
          model: m.model || hub?.defaultGptModel || 'gpt-6.1-sol',
        })
      }
    }
    return list
  }, [teams, hub?.defaultGptModel])

  const filteredProviders = useMemo(() => {
    const list = hub?.providers ?? []
    if (categoryFilter === 'all') return list
    return list.filter((p) => (p.category || 'official-cloud') === categoryFilter)
  }, [hub?.providers, categoryFilter])

  const flattenedModels = useMemo(() => {
    const providers = hub?.providers ?? []
    const q = searchQuery.trim().toLowerCase()
    const rows: { provider: RuntimeProviderEntry; model: ProviderModelItem }[] = []
    for (const prov of providers) {
      if (selectedProviderId !== 'all' && prov.id !== selectedProviderId) continue
      if (categoryFilter !== 'all' && (prov.category || 'official-cloud') !== categoryFilter) continue
      for (const mod of prov.models) {
        if (onlyLiveOrCustom && !mod.isLiveDiscovered && !mod.isCustom && !prov.isCustom) continue
        if (q) {
          const hay = `${prov.id} ${prov.name} ${mod.id} ${mod.name || ''} ${mod.description || ''}`.toLowerCase()
          if (!hay.includes(q)) continue
        }
        rows.push({ provider: prov, model: mod })
      }
    }
    return rows
  }, [hub?.providers, selectedProviderId, categoryFilter, onlyLiveOrCustom, searchQuery])

  const openEditProvider = (prov?: RuntimeProviderEntry) => {
    if (!prov) {
      setDraftId('')
      setDraftName('我的自定义 API 中转站')
      setDraftIcon('🏮')
      setDraftCategory('relay-station')
      setDraftBaseUrl('https://')
      setDraftApiKey('')
      setDraftModelsText('gpt-4o, claude-3-7-sonnet-20250219, deepseek-r1')
      setEditorOpen(true)
      return
    }
    setDraftId(prov.id)
    setDraftName(prov.name)
    setDraftIcon(prov.icon || '🔌')
    setDraftCategory(prov.category || 'relay-station')
    setDraftBaseUrl(prov.baseUrl || '')
    setDraftApiKey('')
    setDraftModelsText(prov.models.map((m) => m.id).join(', '))
    setEditorOpen(true)
  }

  const handleApplyQuickTemplate = (tpl: (typeof RELAY_QUICK_TEMPLATES)[number]) => {
    setDraftId(tpl.id)
    setDraftName(tpl.name)
    setDraftIcon(tpl.icon)
    setDraftCategory(tpl.category)
    setDraftBaseUrl(tpl.baseUrl)
    setDraftModelsText(tpl.placeholderModels)
  }

  const handleDiscoverFromRelay = async (targetProvId?: string, targetUrl?: string, targetKey?: string) => {
    const baseUrl = (targetUrl ?? draftBaseUrl).trim()
    if (!baseUrl || baseUrl === 'https://') {
      setNotice({ kind: 'err', text: '请先输入中转站或平台的 Base URL（如 https://xxx.com/v1）' })
      return
    }
    setDiscovering(true)
    setNotice(null)
    try {
      const res = await fetch('/api/models/providers/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: targetProvId ?? draftId,
          baseUrl,
          apiKey: targetKey !== undefined ? targetKey : draftApiKey || 'KEEP_EXISTING',
          autoSave: Boolean(targetProvId),
        }),
      })
      const data = await res.json()
      if (data.reachable && Array.isArray(data.models) && data.models.length > 0) {
        const ids = data.models.map((m: { id: string }) => m.id)
        if (!targetProvId) {
          setDraftModelsText(ids.join(', '))
        } else {
          await loadHub()
          onModelsUpdated?.()
        }
        const msg = `✅ 成功从接口自动拉取 ${ids.length} 款可用模型（耗时 ${data.latencyMs} ms）！`
        setNotice({ kind: 'ok', text: msg })
        onStatusMessage?.(msg)
      } else {
        setNotice({
          kind: 'err',
          text: `⚠️ 未能拉取到模型列表：${data.error || '返回为空，请检查 Base URL (/v1) 与 API Key 是否正确'}`,
        })
      }
    } catch (err) {
      setNotice({ kind: 'err', text: `拉取异常: ${(err as Error).message}` })
    } finally {
      setDiscovering(false)
    }
  }

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draftName.trim()) return
    setSavingProvider(true)
    setNotice(null)
    try {
      const models = draftModelsText
        .split(/[,，\n]+/u)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((id) => ({ id, name: id }))

      const res = await fetch('/api/models/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draftId.trim() || undefined,
          name: draftName.trim(),
          icon: draftIcon.trim() || '🏮',
          category: draftCategory,
          baseUrl: draftBaseUrl.trim(),
          apiKey: draftApiKey.trim() ? draftApiKey.trim() : 'KEEP_EXISTING',
          models,
          replaceModels: false,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || '保存失败')
      setEditorOpen(false)
      setSelectedProviderId(data.provider.id)
      await loadHub()
      onModelsUpdated?.()
      const msg = `✅ 已保存供应商/中转站「${data.provider.name}」（共 ${data.provider.models?.length ?? 0} 款模型）！`
      setNotice({ kind: 'ok', text: msg })
      onStatusMessage?.(msg)
    } catch (err) {
      setNotice({ kind: 'err', text: (err as Error).message })
    } finally {
      setSavingProvider(false)
    }
  }

  const handleDeleteProvider = async (prov: RuntimeProviderEntry) => {
    try {
      const res = await fetch(`/api/models/providers/${encodeURIComponent(prov.id)}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        if (selectedProviderId === prov.id) setSelectedProviderId('all')
        await loadHub()
        onModelsUpdated?.()
        const msg = prov.isCustom
          ? `🗑️ 已删除自定义供应商「${prov.name}」`
          : `🙈 已隐藏内置供应商「${prov.name}」（可随时点击顶部「恢复默认供应商」找回）`
        setNotice({ kind: 'ok', text: msg })
        onStatusMessage?.(msg)
      }
    } catch {}
  }

  const handleRestoreProviders = async () => {
    try {
      await fetch('/api/models/providers/restore', { method: 'POST' })
      await loadHub()
      onModelsUpdated?.()
      setNotice({ kind: 'ok', text: '🔄 已恢复全部默认供应商与内置模型列表！' })
    } catch {}
  }

  const handleAddQuickModel = async (e: React.FormEvent) => {
    e.preventDefault()
    const targetProv =
      selectedProviderId !== 'all'
        ? hub?.providers.find((p) => p.id === selectedProviderId)
        : hub?.providers[0]
    if (!targetProv || !newModelId.trim()) return
    try {
      const res = await fetch('/api/models/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: targetProv.id,
          name: targetProv.name,
          apiKey: 'KEEP_EXISTING',
          models: [{ id: newModelId.trim(), name: newModelName.trim() || newModelId.trim() }],
        }),
      })
      if (res.ok) {
        setNewModelId('')
        setNewModelName('')
        await loadHub()
        onModelsUpdated?.()
        setNotice({ kind: 'ok', text: `➕ 已向「${targetProv.name}」添加模型 ${newModelId.trim()}` })
      }
    } catch {}
  }

  const handleDeleteModel = async (providerId: string, modelId: string) => {
    try {
      const res = await fetch(
        `/api/models/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
        { method: 'DELETE' },
      )
      if (res.ok) {
        await loadHub()
        onModelsUpdated?.()
        setNotice({ kind: 'ok', text: `🗑️ 已从「${providerId}」移除模型 ${modelId}` })
      }
    } catch {}
  }

  const handlePingModel = async (providerId: string, modelId: string) => {
    const key = `${providerId}:${modelId}`
    setPingMap((prev) => ({ ...prev, [key]: 'loading' }))
    try {
      const res = await fetch('/api/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, model: modelId, timeoutMs: 6500 }),
      })
      const data = await res.json()
      setPingMap((prev) => ({
        ...prev,
        [key]: {
          reachable: Boolean(data.reachable),
          latencyMs: Number(data.latencyMs || 0),
          reply: data.reply,
          error: data.error,
          routeUsed: data.routeUsed,
        },
      }))
    } catch (err) {
      setPingMap((prev) => ({
        ...prev,
        [key]: { reachable: false, latencyMs: 0, error: (err as Error).message },
      }))
    }
  }

  const handleSetDefaultModel = async (modelId: string) => {
    try {
      const res = await fetch('/api/desktop/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { 'default-gpt-model': modelId } }),
      })
      if (res.ok) {
        await loadHub()
        const msg = `⭐ 已将平台默认主力模型切换为 ${modelId}！`
        setNotice({ kind: 'ok', text: msg })
        onStatusMessage?.(msg)
      }
    } catch {}
  }

  return (
    <div className="at-fullscreen-module-shell">
      {/* Top 3-Card Bento Overview */}
      <div className="at-bento-top-strip">
        <div className="at-bento-card">
          <div className="at-bento-card-head">
            <span className="at-bento-step">#1 · active-routing</span>
            <span className={`at-bento-badge ${hub?.cpaOnline ? 'done' : 'pending'}`}>
              {hub?.cpaOnline
                ? `🟢 CPA 总中转在线 (${hub.liveCpaCount ?? 0} 款实时模型)`
                : '🟡 CPA 离线 · 支持直连中转站'}
            </span>
          </div>
          <div className="at-bento-title">
            ⭐ 当前默认主力模型：<code>{hub?.defaultGptModel ?? 'gpt-6.1-sol'}</code> · 网关：<code>{hub?.cpaBaseUrl ?? 'http://127.0.0.1:8317/v1'}</code>
          </div>
        </div>

        <div className="at-bento-card">
          <div className="at-bento-card-head">
            <span className="at-bento-step">#2 · providers-ecosystem</span>
            <span className="at-bento-badge running">
              {hub?.totalProvidersCount ?? 20} 家供应商 · {hub?.totalModelsCount ?? 0} 款模型
            </span>
          </div>
          <div className="at-bento-title">
            🌐 全生态覆盖：反重力 · Codex · DSH · ZCode · OpenCode · NewAPI/OpenRouter 中转站与国产全系
          </div>
        </div>

        <div className="at-bento-card">
          <div className="at-bento-card-head">
            <span className="at-bento-step">#3 · live-team-bindings</span>
            <span className="at-bento-badge done">
              {activeTeamBindings.length} 名在编成员绑定
            </span>
          </div>
          <div className="at-bento-title">
            {activeTeamBindings.length === 0
              ? '当前暂无活跃团队成员，点击任意模型「🚀 用它建队」即可快速发起任务'
              : `正在使用：${Array.from(new Set(activeTeamBindings.map((b) => `${b.provider}/${b.model}`)))
                  .slice(0, 3)
                  .join(' · ')}`}
          </div>
        </div>
      </div>

      {/* Active Team Model Bindings Bar (if teams exist) */}
      {activeTeamBindings.length > 0 && (
        <section className="at-solid-glass-card" style={{ padding: '14px 20px' }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>
            👥 当前工作区团队成员实际使用的【供应商 / 模型】实时透视：
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {activeTeamBindings.slice(0, 14).map((b, idx) => (
              <span
                key={`${b.teamName}-${b.memberName}-${idx}`}
                className="at-solid-chip"
                style={{ fontSize: 12.5, gap: 6 }}
              >
                <strong>{b.teamName}</strong> · {b.memberName} →{' '}
                <code style={{ color: 'var(--at-accent-primary)', fontWeight: 700 }}>
                  {b.provider}/{b.model}
                </code>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Top Action & Category Filter Bar */}
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`studio-btn ${categoryFilter === tab.id ? 'primary' : ''}`}
              onClick={() => {
                setCategoryFilter(tab.id)
                setSelectedProviderId('all')
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {(hub?.hiddenProvidersCount ?? 0) > 0 && (
            <button type="button" className="studio-btn" onClick={() => void handleRestoreProviders()}>
              🔄 恢复已隐藏供应商 ({hub?.hiddenProvidersCount})
            </button>
          )}
          <button
            type="button"
            className="studio-btn"
            disabled={loading}
            onClick={() => void loadHub()}
          >
            {loading ? '刷新中...' : '🔄 刷新在线目录'}
          </button>
          <button
            type="button"
            className="studio-btn primary"
            onClick={() => openEditProvider()}
          >
            ➕ 接入新中转站 / 自定义供应商
          </button>
        </div>
      </div>

      {notice && (
        <div
          className="at-solid-glass-card"
          style={{
            padding: '12px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderColor: notice.kind === 'err' ? '#ef4444' : 'var(--at-border-highlight)',
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 14 }}>{notice.text}</span>
          <button type="button" className="studio-btn" onClick={() => setNotice(null)}>
            关闭
          </button>
        </div>
      )}

      {/* Add / Edit Relay Station & Provider Drawer */}
      {editorOpen && (
        <form
          onSubmit={handleSaveProvider}
          className="at-solid-glass-card"
          style={{ padding: 22, display: 'grid', gap: 14, border: '2px solid var(--at-accent-primary)' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
                🔌 接入或配置供应商 / API 中转站（完美兼容 OpenCode / ZCode / DSH / NewAPI / OneAPI / OpenRouter）
              </h3>
              <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', marginTop: 3 }}>
                点击下方快捷模板可一键填入标准地址；填入 <code>Base URL</code> 与 <code>API Key</code> 后点击「🔄 自动拉取全站模型」即可秒级导入中转站所有模型！
              </div>
            </div>
            <button type="button" className="studio-btn" onClick={() => setEditorOpen(false)}>
              ✕ 收起
            </button>
          </div>

          {/* Quick Templates */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>⚡ 一键套用预设模板：</span>
            {RELAY_QUICK_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="studio-btn"
                style={{ fontSize: 12.5, padding: '5px 12px' }}
                onClick={() => handleApplyQuickTemplate(tpl)}
              >
                {tpl.icon} {tpl.name}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                供应商标识 ID (英文，如 newapi / zcode / my-relay)
              </label>
              <input
                className="studio-quick-input"
                value={draftId}
                onChange={(e) => setDraftId(e.target.value)}
                placeholder="留空自动生成 relay-xxxx"
              />
            </div>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                显示名称 *
              </label>
              <input
                className="studio-quick-input"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                required
              />
            </div>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                所属分类
              </label>
              <select
                className="studio-quick-input"
                value={draftCategory}
                onChange={(e) =>
                  setDraftCategory(
                    e.target.value as 'agent-platform' | 'relay-station' | 'official-cloud' | 'local',
                  )
                }
              >
                <option value="relay-station">🏮 中转站与聚合网关 (NewAPI / OneAPI / OpenRouter)</option>
                <option value="agent-platform">🪐 Agent 宿主生态 (反重力 / Codex / DSH / ZCode / OpenCode)</option>
                <option value="official-cloud">🏛️ 官方大模型云平台</option>
                <option value="local">🦙 本地离线推理引擎 (Ollama / vLLM)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                图标 Emoji
              </label>
              <input
                className="studio-quick-input"
                value={draftIcon}
                onChange={(e) => setDraftIcon(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                🌐 接口地址 Base URL（通常以 /v1 结尾）*
              </label>
              <input
                className="studio-quick-input"
                value={draftBaseUrl}
                onChange={(e) => setDraftBaseUrl(e.target.value)}
                placeholder="https://api.your-relay.com/v1"
                required
              />
            </div>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                🔑 API Key 密钥（加密脱敏落盘，留空保留原密钥）
              </label>
              <input
                type="password"
                className="studio-quick-input"
                value={draftApiKey}
                onChange={(e) => setDraftApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </div>
            <button
              type="button"
              className="studio-btn"
              disabled={discovering}
              onClick={() => void handleDiscoverFromRelay()}
            >
              {discovering ? '⏳ 拉取中...' : '🔄 自动拉取全站模型 (/models)'}
            </button>
          </div>

          <div>
            <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>
              🧠 可用模型 ID 列表（逗号分隔，可手动增删或由上方按钮自动拉取）
            </label>
            <textarea
              rows={2}
              className="studio-quick-input"
              style={{ width: '100%', height: 'auto', padding: 10 }}
              value={draftModelsText}
              onChange={(e) => setDraftModelsText(e.target.value)}
              placeholder="gpt-6.1-sol, claude-sonnet-4-6, deepseek-r1, glm-4.5"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" className="studio-btn" onClick={() => setEditorOpen(false)}>
              取消
            </button>
            <button type="submit" className="studio-btn primary" disabled={savingProvider}>
              {savingProvider ? '保存中...' : '💾 保存供应商与模型配置'}
            </button>
          </div>
        </form>
      )}

      {/* Main Fullscreen 2-Column Split: Left = Providers Wall | Right = Models Explorer */}
      <div className="at-fullscreen-two-col">
        {/* LEFT COLUMN: Model Providers & Relay Stations Directory */}
        <section className="at-solid-glass-card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
                🏢 模型供应商与中转站列表 ({filteredProviders.length})
              </h2>
              <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 }}>
                点击任意供应商可筛选右侧模型；支持一键配置接口密钥、自动拉取中转站模型或移除不需要的渠道。
              </div>
            </div>
            {selectedProviderId !== 'all' && (
              <button
                type="button"
                className="studio-btn"
                onClick={() => setSelectedProviderId('all')}
              >
                显示全部供应商模型
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {filteredProviders.map((prov) => {
              const selected = selectedProviderId === prov.id
              const statusLabel =
                prov.status === 'online'
                  ? '🟢 实时在线'
                  : prov.status === 'configured'
                    ? '🔑 已配直连密钥'
                    : prov.status === 'offline'
                      ? '🔴 网关未启动'
                      : '🔀 CPA 兼容路由'
              return (
                <div
                  key={prov.id}
                  className="at-solid-list-item"
                  data-selected={selected ? 'true' : 'false'}
                  style={{ gap: 8 }}
                  onClick={() => setSelectedProviderId(selected ? 'all' : prov.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 22 }}>{prov.icon || '🔌'}</span>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 15 }}>{prov.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'monospace' }}>
                          provider: {prov.id} · {prov.models.length} 款模型
                        </div>
                      </div>
                    </div>
                    <span className="at-apple18-stage-pill" data-state={prov.status === 'online' || prov.status === 'configured' ? 'done' : 'running'}>
                      {statusLabel}
                    </span>
                  </div>

                  <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.45 }}>
                    {prov.description}
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    🌐 {prov.baseUrl || '未配置 Base URL'} {prov.apiKeyMasked ? `· 🔑 ${prov.apiKeyMasked}` : ''}
                  </div>

                  <div
                    style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="studio-btn"
                      style={{ fontSize: 12, padding: '4px 10px', minHeight: 30 }}
                      onClick={() => openEditProvider(prov)}
                    >
                      ⚙️ 配置 / 填 Key
                    </button>
                    <button
                      type="button"
                      className="studio-btn"
                      style={{ fontSize: 12, padding: '4px 10px', minHeight: 30 }}
                      disabled={discovering}
                      onClick={() => void handleDiscoverFromRelay(prov.id, prov.baseUrl)}
                    >
                      🔄 拉取模型
                    </button>
                    <button
                      type="button"
                      className="studio-btn"
                      style={{ fontSize: 12, padding: '4px 10px', minHeight: 30, color: '#ef4444' }}
                      onClick={() => void handleDeleteProvider(prov)}
                      title={prov.isCustom ? '删除该自定义中转站' : '从列表中隐藏该内置供应商（可随时恢复）'}
                    >
                      🗑️ {prov.isCustom ? '删除' : '移除'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* RIGHT COLUMN: Current Models Explorer, Quick Add/Delete & Live Ping Tester */}
        <section className="at-solid-glass-card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
                🧠 当前可用模型全景矩阵 ({flattenedModels.length})
              </h2>
              <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 }}>
                {selectedProviderId === 'all'
                  ? '当前展示全部已接入供应商的模型，支持测速连通、设为默认、快速建队与单模型移除'
                  : `当前筛选供应商：${selectedProviderId}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={onlyLiveOrCustom}
                  onChange={(e) => setOnlyLiveOrCustom(e.target.checked)}
                />
                仅看实时发现 / 自定义模型
              </label>
              <input
                type="text"
                className="studio-quick-input"
                style={{ width: 220 }}
                placeholder="🔍 搜索模型 ID / 名称..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Quick Add Model to Current Provider */}
          <form
            onSubmit={handleAddQuickModel}
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              marginBottom: 14,
              padding: '10px 12px',
              borderRadius: 14,
              background: 'var(--at-canvas-card)',
              border: '1px solid var(--at-border-hairline)',
            }}
          >
            <input
              type="text"
              className="studio-quick-input"
              style={{ flex: 1, minWidth: 180 }}
              placeholder={`向「${selectedProviderId === 'all' ? (hub?.providers[0]?.id ?? 'antigravity') : selectedProviderId}」手动新增模型 ID (如 deepseek-v3.2)...`}
              value={newModelId}
              onChange={(e) => setNewModelId(e.target.value)}
            />
            <input
              type="text"
              className="studio-quick-input"
              style={{ width: 180 }}
              placeholder="显示别名 (可选)"
              value={newModelName}
              onChange={(e) => setNewModelName(e.target.value)}
            />
            <button type="submit" className="studio-btn primary">
              ➕ 添加模型
            </button>
          </form>

          {/* Models List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 680, overflowY: 'auto' }}>
            {flattenedModels.map(({ provider, model }) => {
              const pingKey = `${provider.id}:${model.id}`
              const pingState = pingMap[pingKey]
              const isDefault = hub?.defaultGptModel === model.id
              return (
                <div
                  key={pingKey}
                  style={{
                    padding: '13px 16px',
                    borderRadius: 16,
                    background: 'var(--at-canvas-card)',
                    border: isDefault
                      ? '1.5px solid var(--at-accent-primary)'
                      : '1px solid var(--at-border-hairline)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ minWidth: 220, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15 }}>{model.name || model.id}</strong>
                      <code
                        style={{
                          fontSize: 12.5,
                          padding: '2px 8px',
                          borderRadius: 6,
                          background: 'rgba(148, 163, 184, 0.15)',
                          color: 'var(--at-accent-primary)',
                        }}
                      >
                        {provider.id}/{model.id}
                      </code>
                      {isDefault && (
                        <span className="at-bento-badge running">⭐ 默认主力</span>
                      )}
                      {model.isLiveDiscovered && (
                        <span className="at-bento-badge done">🟢 网关实时发现</span>
                      )}
                      {model.isCustom && (
                        <span className="at-bento-badge pending">🛠️ 自定义接入</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 }}>
                      供应商：{provider.icon} <strong>{provider.name}</strong>
                      {model.description ? ` · ${model.description}` : ''}
                    </div>
                    {pingState && pingState !== 'loading' && (
                      <div
                        style={{
                          marginTop: 5,
                          fontSize: 12,
                          fontWeight: 700,
                          color: pingState.reachable ? '#10b981' : '#ef4444',
                        }}
                      >
                        {pingState.reachable
                          ? `🟢 连通正常 · 延迟 ${pingState.latencyMs} ms · 响应: "${pingState.reply}" (${pingState.routeUsed})`
                          : `🔴 未连通 (${pingState.error}) · 请在左侧点击「⚙️ 配置 / 填 Key」核对 Base URL 与密钥`}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="studio-btn"
                      style={{ fontSize: 12.5, padding: '5px 11px', minHeight: 32 }}
                      disabled={pingState === 'loading'}
                      onClick={() => void handlePingModel(provider.id, model.id)}
                    >
                      {pingState === 'loading' ? '⏳ 测速中...' : '⚡ 测速连通'}
                    </button>
                    {!isDefault && (
                      <button
                        type="button"
                        className="studio-btn"
                        style={{ fontSize: 12.5, padding: '5px 11px', minHeight: 32 }}
                        onClick={() => void handleSetDefaultModel(model.id)}
                      >
                        ⭐ 设为默认
                      </button>
                    )}
                    <button
                      type="button"
                      className="studio-btn primary"
                      style={{ fontSize: 12.5, padding: '5px 12px', minHeight: 32 }}
                      onClick={() => onQuickUseModel?.(`@${model.id}`)}
                    >
                      🚀 用它建队
                    </button>
                    <button
                      type="button"
                      className="studio-btn"
                      style={{ fontSize: 12.5, padding: '5px 10px', minHeight: 32, color: '#ef4444' }}
                      onClick={() => void handleDeleteModel(provider.id, model.id)}
                      title="从该供应商目录中移除此模型"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
