import React, { useCallback, useEffect, useState } from 'react'

export interface RadarNewsItem {
  id: string
  title: string
  sourceType: 'official' | 'community'
  sourceName: string
  level: 'beginner' | 'power-user' | 'developer'
  valueScore: number
  category: string
  publishedAt: string
  url: string
  valueProposition: string
  summary: string
  actionableTip?: string
  tags?: string[]
  recommendedPreset?: string
  isCustom?: boolean
  isLiveFetched?: boolean
}

interface GrokHistoryEntry {
  id: string
  query: string
  mode: string
  answer: string
  modelUsed: string
  routeUsed: string
  liveConnected: boolean
  matchedRadarCount: number
  createdAt: string
}

interface GrokOpenSourceProject {
  id: string
  repo: string
  url: string
  badge: string
  summary: string
  installCmd: string
}

const LEVEL_META: Record<
  'all' | 'beginner' | 'power-user' | 'developer',
  { label: string; icon: string; badgeColor: string; desc: string }
> = {
  all: {
    label: '全部等级',
    icon: '🌐',
    badgeColor: '#007aff',
    desc: '汇总官方发布与社区热榜全部高价值情报',
  },
  beginner: {
    label: '🌱 新手级 (Beginner)',
    icon: '🌱',
    badgeColor: '#10b981',
    desc: '零代码开箱即用、直观看懂核心价值与上手玩法',
  },
  'power-user': {
    label: '⚡ 老手级 (Power User)',
    icon: '⚡',
    badgeColor: '#f59e0b',
    desc: '高阶工作流编排、多模型路由、长周期项目 SOP 与效率倍增',
  },
  developer: {
    label: '🛠️ 开发级 (Developer)',
    icon: '🛠️',
    badgeColor: '#8b5cf6',
    desc: '底层 SDK、开源仓库源码、多 Agent 框架与本地部署调优',
  },
}

export const AiNewsRadarView: React.FC<{
  onTeamLaunched?: (teamId: string, msg: string) => void
  onStatusMessage?: (msg: string) => void
}> = ({ onTeamLaunched, onStatusMessage }) => {
  const [items, setItems] = useState<RadarNewsItem[]>([])
  const [counts, setCounts] = useState({
    total: 0,
    beginner: 0,
    powerUser: 0,
    developer: 0,
    official: 0,
    community: 0,
  })
  const [levelFilter, setLevelFilter] = useState<'all' | 'beginner' | 'power-user' | 'developer'>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'official' | 'community'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newSourceType, setNewSourceType] = useState<'official' | 'community'>('community')
  const [newSourceName, setNewSourceName] = useState('GitHub / 社区精选')
  const [newLevel, setNewLevel] = useState<'beginner' | 'power-user' | 'developer'>('developer')
  const [newValueScore, setNewValueScore] = useState(92)
  const [newValueProp, setNewValueProp] = useState('')
  const [newSummary, setNewSummary] = useState('')
  const [newUrl, setNewUrl] = useState('')

  // Grok Bot State
  const [grokQuery, setGrokQuery] = useState('')
  const [grokMode, setGrokMode] = useState<'fact-check' | 'deepsearch' | 'roast' | 'grok-build'>('fact-check')
  const [grokBusy, setGrokBusy] = useState(false)
  const [grokHistory, setGrokHistory] = useState<GrokHistoryEntry[]>([])
  const [grokProjects, setGrokProjects] = useState<GrokOpenSourceProject[]>([])
  const [showGrokConfig, setShowGrokConfig] = useState(false)
  const [xaiApiKey, setXaiApiKey] = useState('')
  const [xaiModel, setXaiModel] = useState('grok-3')

  const loadRadar = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        level: levelFilter,
        sourceType: sourceFilter,
        q: searchQuery,
      })
      const res = await fetch(`/api/radar?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setItems(Array.isArray(data.items) ? data.items : [])
        if (data.counts) setCounts(data.counts)
      }
    } catch {}
  }, [levelFilter, sourceFilter, searchQuery])

  const loadGrokStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/grok/status')
      if (res.ok) {
        const data = await res.json()
        setGrokHistory(Array.isArray(data.history) ? data.history : [])
        setGrokProjects(Array.isArray(data.openSourceProjects) ? data.openSourceProjects : [])
        if (data.config?.preferredModel) setXaiModel(data.config.preferredModel)
      }
    } catch {}
  }, [])

  useEffect(() => {
    void loadRadar()
  }, [loadRadar])

  useEffect(() => {
    void loadGrokStatus()
  }, [loadGrokStatus])

  const handleRefreshLive = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/radar/refresh', { method: 'POST' })
      const data = await res.json()
      await loadRadar()
      onStatusMessage?.(`📡 已完成实时社区与官方情报同步（新增/更新 ${data.fetchedCount ?? 0} 条热点）`)
    } catch {
      onStatusMessage?.('情报同步完成（使用本地高价值精选库）')
    } finally {
      setRefreshing(false)
    }
  }

  const handleLaunchFromRadar = async (item: RadarNewsItem) => {
    setLaunchingId(item.id)
    try {
      const res = await fetch('/api/radar/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          valueProposition: item.valueProposition,
          summary: item.summary,
          level: item.level,
          preset: item.recommendedPreset || 'ai-radar-squad',
        }),
      })
      const data = await res.json()
      if (data.ok && data.teamId) {
        onTeamLaunched?.(data.teamId, data.message || `已基于《${item.title}》创建待审批团队`)
      }
    } catch (err) {
      onStatusMessage?.(`派发失败: ${(err as Error).message}`)
    } finally {
      setLaunchingId(null)
    }
  }

  const handleAskGrok = async (customQuery?: string, customMode?: 'fact-check' | 'deepsearch' | 'roast' | 'grok-build') => {
    const q = (customQuery ?? grokQuery).trim()
    if (!q) return
    const m = customMode ?? grokMode
    setGrokBusy(true)
    try {
      const res = await fetch('/api/grok/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, mode: m }),
      })
      const data = await res.json()
      if (data.ok && data.status?.history) {
        setGrokHistory(data.status.history)
        if (!customQuery) setGrokQuery('')
        onStatusMessage?.(`⚡ @Grok Bot 已完成 [${m}] 深度分析`)
      }
    } catch (err) {
      onStatusMessage?.(`@Grok 请求异常: ${(err as Error).message}`)
    } finally {
      setGrokBusy(false)
    }
  }

  const handleSaveCustomItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim()) return
    try {
      const res = await fetch('/api/radar/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          sourceType: newSourceType,
          sourceName: newSourceName,
          level: newLevel,
          valueScore: newValueScore,
          valueProposition: newValueProp || '用户自定义重点关注的 AI 情报与高价值实践',
          summary: newSummary || newTitle,
          url: newUrl || 'https://github.com',
        }),
      })
      if (res.ok) {
        setNewTitle('')
        setNewValueProp('')
        setNewSummary('')
        setNewUrl('')
        setShowAddModal(false)
        await loadRadar()
        onStatusMessage?.('✅ 已添加自定义 AI 情报卡片')
      }
    } catch {}
  }

  const handleSaveGrokConfig = async () => {
    try {
      await fetch('/api/grok/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          xaiApiKey,
          preferredModel: xaiModel,
        }),
      })
      setShowGrokConfig(false)
      onStatusMessage?.('⚡ 已保存 @Grok Bot 路由配置')
    } catch {}
  }

  return (
    <div className="at-fullscreen-module-shell">
      {/* Top 3-Tier Overview Bento Strip */}
      <div className="at-bento-top-strip">
        {(['beginner', 'power-user', 'developer'] as const).map((lvKey, idx) => {
          const meta = LEVEL_META[lvKey]
          const count =
            lvKey === 'beginner'
              ? counts.beginner
              : lvKey === 'power-user'
                ? counts.powerUser
                : counts.developer
          const isActive = levelFilter === lvKey
          return (
            <div
              key={lvKey}
              className="at-bento-card"
              style={{
                cursor: 'pointer',
                border: isActive ? `2px solid ${meta.badgeColor}` : undefined,
              }}
              onClick={() => setLevelFilter(isActive ? 'all' : lvKey)}
            >
              <div className="at-bento-card-head">
                <span className="at-bento-step">
                  #{idx + 1} · {lvKey}
                </span>
                <span className="at-bento-badge done">
                  {count} 条高价值情报 {isActive ? '· 已筛选 ✓' : ''}
                </span>
              </div>
              <div className="at-bento-title">
                {meta.label} — {meta.desc}
              </div>
            </div>
          )
        })}
      </div>

      {/* Main Fullscreen 2-Column Split: Left = 3-Tier AI News Grabber | Right = Built-in @Grok Bot Hub */}
      <div className="at-radar-grok-grid">
        {/* LEFT COLUMN: Actionable AI Intelligence Grabber */}
        <section className="at-solid-glass-card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 21, fontWeight: 800 }}>
                  📡 AI 情报抓手 · 官方最新动态与社区高价值精选
                </h2>
                <span className="studio-tag" style={{ fontSize: 12.5, padding: '4px 10px' }}>
                  价值优先 · 新手 / 老手 / 开发 3 级分流
                </span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--at-text-secondary)' }}>
                彻底告别杂乱无章的信息流：每条情报直接标明<strong>【价值分】</strong>、<strong>【核心价值 Why It Matters】</strong>与<strong>【一句话简介】</strong>，支持一键呼叫 <code>@Grok</code> 核查真伪或派发团队实测。
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="studio-btn"
                onClick={() => setShowAddModal((v) => !v)}
              >
                ➕ 录入自定义情报
              </button>
              <button
                type="button"
                className="studio-btn primary"
                disabled={refreshing}
                onClick={() => void handleRefreshLive()}
              >
                {refreshing ? '⏳ 正在抓取 Hacker News / GitHub...' : '🔄 实时抓取最新社区热榜'}
              </button>
            </div>
          </div>

          {/* Add Custom Intelligence Form */}
          {showAddModal && (
            <form
              onSubmit={handleSaveCustomItem}
              style={{
                padding: 16,
                marginBottom: 16,
                borderRadius: 16,
                background: 'var(--at-glass-surface)',
                border: '1px solid var(--at-glass-border)',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12,
              }}
            >
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>情报标题 *</label>
                <input
                  className="studio-quick-input"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="例如：OpenAI 发布最新开源 Agent SDK..."
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>受众等级</label>
                <select
                  className="studio-quick-input"
                  value={newLevel}
                  onChange={(e) => setNewLevel(e.target.value as 'beginner' | 'power-user' | 'developer')}
                >
                  <option value="beginner">🌱 新手级 (Beginner)</option>
                  <option value="power-user">⚡ 老手级 (Power User)</option>
                  <option value="developer">🛠️ 开发级 (Developer)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>消息源分类</label>
                <select
                  className="studio-quick-input"
                  value={newSourceType}
                  onChange={(e) => setNewSourceType(e.target.value as 'official' | 'community')}
                >
                  <option value="official">🏛️ AI 官方发布</option>
                  <option value="community">🔥 社区与开源热门</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>价值指数 (60-100)</label>
                <input
                  type="number"
                  min={60}
                  max={100}
                  className="studio-quick-input"
                  value={newValueScore}
                  onChange={(e) => setNewValueScore(Number(e.target.value))}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>💡 核心价值 (Why It Matters)</label>
                <input
                  className="studio-quick-input"
                  value={newValueProp}
                  onChange={(e) => setNewValueProp(e.target.value)}
                  placeholder="一句话说明它为什么值得关注、能省多少成本或提升什么能力..."
                />
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
                <input
                  className="studio-quick-input"
                  style={{ flex: 1 }}
                  value={newSummary}
                  onChange={(e) => setNewSummary(e.target.value)}
                  placeholder="内容简介摘要..."
                />
                <button type="submit" className="studio-btn primary">保存情报卡片</button>
              </div>
            </form>
          )}

          {/* Filter Bar: 3 Levels + 2 Source Types + Search */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['all', 'beginner', 'power-user', 'developer'] as const).map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className={`studio-btn ${levelFilter === lv ? 'primary' : ''}`}
                  onClick={() => setLevelFilter(lv)}
                >
                  {LEVEL_META[lv].label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`studio-btn ${sourceFilter === 'all' ? 'primary' : ''}`}
                onClick={() => setSourceFilter('all')}
              >
                全部来源 ({counts.total})
              </button>
              <button
                type="button"
                className={`studio-btn ${sourceFilter === 'official' ? 'primary' : ''}`}
                onClick={() => setSourceFilter('official')}
              >
                🏛️ AI 官方最新 ({counts.official})
              </button>
              <button
                type="button"
                className={`studio-btn ${sourceFilter === 'community' ? 'primary' : ''}`}
                onClick={() => setSourceFilter('community')}
              >
                🔥 社区热门 & GitHub ({counts.community})
              </button>
              <input
                type="text"
                className="studio-quick-input"
                style={{ width: 220 }}
                placeholder="🔍 搜索模型、仓库、BV号..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* 2-Column Responsive Cards Grid inside the Left Module */}
          <div className="at-radar-cards-grid">
            {items.map((item) => {
              const lvMeta = LEVEL_META[item.level] || LEVEL_META.developer
              return (
                <article key={item.id} className="at-radar-card">
                  <div className="at-radar-card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span
                        className="at-radar-level-pill"
                        style={{
                          background: `${lvMeta.badgeColor}1f`,
                          color: lvMeta.badgeColor,
                          border: `1px solid ${lvMeta.badgeColor}55`,
                        }}
                      >
                        {lvMeta.label}
                      </span>
                      <span className="at-radar-source-pill">
                        {item.sourceType === 'official' ? '🏛️ 官方发布' : '🔥 社区热榜'} · {item.sourceName}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--at-text-tertiary)' }}>{item.publishedAt}</span>
                    </div>
                    <div className="at-radar-score-badge" title="情报价值指数 (0-100)">
                      💎 价值 <strong>{item.valueScore}</strong>
                    </div>
                  </div>

                  <h3 className="at-radar-card-title">{item.title}</h3>

                  {/* Value Proposition Box (Why It Matters) */}
                  <div className="at-radar-value-box">
                    <div className="at-radar-value-label">💡 核心价值 (Why It Matters)</div>
                    <div className="at-radar-value-text">{item.valueProposition}</div>
                  </div>

                  {/* Summary */}
                  <p className="at-radar-summary">
                    <strong>📝 内容简介：</strong>
                    {item.summary}
                  </p>

                  {item.actionableTip && (
                    <div className="at-radar-tip">
                      <strong>⚡ 落地指南：</strong>
                      {item.actionableTip}
                    </div>
                  )}

                  {/* Footer Tags & Actions */}
                  <div className="at-radar-card-footer">
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(item.tags || []).slice(0, 4).map((tg) => (
                        <span key={tg} className="studio-quick-chip" style={{ fontSize: 11.5, padding: '2px 8px' }}>
                          #{tg}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="studio-btn"
                        onClick={() =>
                          void handleAskGrok(`请对这条情报进行事实核查与价值拆解：《${item.title}》 — ${item.summary}`, 'fact-check')
                        }
                      >
                        ⚡ @Grok 核查
                      </button>
                      <button
                        type="button"
                        className="studio-btn primary"
                        disabled={launchingId === item.id}
                        onClick={() => void handleLaunchFromRadar(item)}
                      >
                        {launchingId === item.id ? '生成中...' : '🚀 派发团队验证'}
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        {/* RIGHT COLUMN: Built-in @Grok Bot & xai-org/grok-build Hub */}
        <aside className="at-solid-glass-card at-grok-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 22 }}>⚡</span>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>
                  @Grok Bot 实时核查与深搜中枢
                </h2>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--at-text-secondary)', marginTop: 2 }}>
                融合开源 <code>xai-org/grok-build</code> 与 X 平台 <code>@grok</code> 求真核查 / 毒舌红队
              </div>
            </div>
            <button
              type="button"
              className="studio-btn"
              onClick={() => setShowGrokConfig((v) => !v)}
            >
              ⚙️ 渠道配置
            </button>
          </div>

          {showGrokConfig && (
            <div
              style={{
                padding: 14,
                marginBottom: 14,
                borderRadius: 14,
                background: 'var(--at-glass-surface)',
                border: '1px solid var(--at-glass-border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                🔌 xAI Grok / CPA 自动降级路由配置（未填 Key 时默认走本地 CPA <code>gpt-6.1-sol</code> 零配置即用）
              </div>
              <input
                type="password"
                className="studio-quick-input"
                placeholder="可选：输入 xAI 官方 API Key (xai-...) 直连 grok-3"
                value={xaiApiKey}
                onChange={(e) => setXaiApiKey(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className="studio-quick-input"
                  style={{ flex: 1 }}
                  value={xaiModel}
                  onChange={(e) => setXaiModel(e.target.value)}
                  placeholder="首选模型 (grok-3 / grok-3-mini-fast)"
                />
                <button type="button" className="studio-btn primary" onClick={() => void handleSaveGrokConfig()}>
                  保存
                </button>
              </div>
            </div>
          )}

          {/* 4 Signature Grok Modes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
            {(
              [
                { id: 'fact-check', label: '⚖️ @grok 事实核查', desc: '求真打假 + 真实度评分' },
                { id: 'deepsearch', label: '🔎 DeepSearch 深搜', desc: '穿透社区与开源情报' },
                { id: 'roast', label: '🌶️ 毒舌红队锐评', desc: '一针见血挑刺架构漏洞' },
                { id: 'grok-build', label: '🛠️ Grok-Build 拆解', desc: '生成 2~5 分钟原子任务' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                className={`studio-btn ${grokMode === m.id ? 'primary' : ''}`}
                style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '8px 12px' }}
                onClick={() => setGrokMode(m.id)}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{m.label}</div>
                  <div style={{ fontSize: 11.5, opacity: 0.82 }}>{m.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Interactive @grok Input */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input
              type="text"
              className="studio-quick-input"
              style={{ flex: 1 }}
              placeholder="输入 @grok 这个技术是真的还是噱头？或输入任意架构问题..."
              value={grokQuery}
              onChange={(e) => setGrokQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAskGrok()
              }}
            />
            <button
              type="button"
              className="studio-btn primary"
              disabled={grokBusy}
              onClick={() => void handleAskGrok()}
            >
              {grokBusy ? '⏳ 思考中...' : '⚡ 发送'}
            </button>
          </div>

          {/* Grok Conversation Stream */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 460, overflowY: 'auto', marginBottom: 16 }}>
            {grokHistory.length === 0 ? (
              <div
                style={{
                  padding: 16,
                  borderRadius: 14,
                  background: 'var(--at-glass-surface)',
                  border: '1px dashed var(--at-glass-border)',
                  fontSize: 13.5,
                  color: 'var(--at-text-secondary)',
                }}
              >
                💡 <strong>试试点击左侧任意新闻卡片的「⚡ @Grok 核查」</strong>，或者在上方输入框直接向 @Grok 提问！支持一键识别营销噱头、输出毒舌红队锐评或拆解为多智能体工程任务。
              </div>
            ) : (
              grokHistory.map((h) => (
                <div
                  key={h.id}
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    background: 'var(--at-glass-surface)',
                    border: '1px solid var(--at-glass-border)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--at-text-tertiary)', marginBottom: 6 }}>
                    <span>
                      <strong>@{h.mode}</strong> · 路由: {h.routeUsed} ({h.modelUsed})
                    </span>
                    <span>{h.createdAt.slice(11, 19)}</span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8, color: 'var(--at-accent-primary)' }}>
                    Q: {h.query}
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'inherit',
                      fontSize: 13.5,
                      lineHeight: 1.6,
                      color: 'var(--at-text-primary)',
                    }}
                  >
                    {h.answer}
                  </pre>
                </div>
              ))
            )}
          </div>

          {/* Open-Source Grok Ecosystem Directory */}
          <div style={{ borderTop: '1px solid var(--at-glass-border)', paddingTop: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>
              📦 GitHub 开源 Grok Bot 生态与本地适配清单
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {grokProjects.map((proj) => (
                <div
                  key={proj.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    background: 'var(--at-glass-surface)',
                    border: '1px solid var(--at-glass-border)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 13.5 }}>{proj.repo}</strong>
                    <span className="studio-tag" style={{ fontSize: 11 }}>{proj.badge}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--at-text-secondary)', margin: '4px 0 6px' }}>
                    {proj.summary}
                  </div>
                  <code
                    style={{
                      display: 'block',
                      padding: '5px 8px',
                      borderRadius: 8,
                      background: 'rgba(15, 23, 42, 0.08)',
                      fontSize: 11.5,
                      overflowX: 'auto',
                    }}
                  >
                    {proj.installCmd}
                  </code>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
