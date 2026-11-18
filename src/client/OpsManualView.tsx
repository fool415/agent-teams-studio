/**
 * OpsManualView v2.0 — Apple Liquid Glass Extensible Knowledge Base,
 * Custom SOP Modules & Auto-Prompt Injection Center.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

interface OpsAccount {
  readonly id: string
  readonly label: string
  readonly username: string
  readonly initialPassword: string
  readonly role: string
  readonly roleLabel: string
  readonly nodeScope: string
  readonly billingVisibility: string
  readonly matrixHeatmapVisibility: string
  readonly allowedActions: readonly string[]
  readonly restrictedFeatures: readonly string[]
}

interface BwPolicyStage {
  readonly stage: string
  readonly badge: string
  readonly condition: string
  readonly effect: string
  readonly recovery: string
}

interface BotCommandRow {
  readonly command: string
  readonly identity: string
  readonly description: string
}

interface SopScenario {
  readonly id: string
  readonly icon: string
  readonly symptom: string
  readonly quickPrompt: string
  readonly steps: readonly string[]
  readonly relatedCommands?: readonly string[]
}

interface CustomSpecItem {
  readonly label: string
  readonly value: string
  readonly badge?: string
}

interface ManualSummaryItem {
  readonly id: string
  readonly title: string
  readonly subtitle?: string
  readonly version?: string
  readonly category?: string
  readonly scopeLabel?: string
  readonly isCustom?: boolean
  readonly triggerKeywords?: readonly string[]
}

interface OpsManualData {
  readonly id: string
  readonly title: string
  readonly subtitle: string
  readonly version: string
  readonly category?: string
  readonly scopeLabel: string
  readonly isCustom?: boolean
  readonly triggerKeywords?: readonly string[]
  readonly specs?: readonly CustomSpecItem[]
  readonly sopCards?: readonly SopScenario[]
  readonly systemEntry?: {
    readonly controlTitle: string
    readonly webUrl: string
    readonly loopbackAddr: string
    readonly tunnelService: string
    readonly domainFallbackCommands: readonly string[]
    readonly telegramBot: string
    readonly telegramBotUrl: string
    readonly telegramPollingMode: string
  }
  readonly accounts?: readonly OpsAccount[]
  readonly authRules?: {
    readonly passwordHashing: string
    readonly sessionCookie: string
    readonly antiBruteForce: string
    readonly passwordChangePolicy: string
  }
  readonly nodeSpec?: {
    readonly nodeId: string
    readonly displayName: string
    readonly location: string
    readonly hardware: string
    readonly network: string
    readonly proxyProtocol: string
    readonly sni: string
    readonly trafficMultiplier: number
    readonly trafficMultiplierNote: string
    readonly nodeCapGb: number
    readonly zklQuotaGb: number
    readonly billingResetDay: number
    readonly paidUntil: string
    readonly billingSplit: string
    readonly nominalPortMbps: number
    readonly measuredPeakMbps: number
    readonly fupRedline: string
    readonly pollingInterval: string
    readonly bwPolicies: readonly BwPolicyStage[]
  }
  readonly telegramBot?: {
    readonly bindingMethods: readonly {
      readonly title: string
      readonly steps: readonly string[]
    }[]
    readonly commands: readonly BotCommandRow[]
  }
  readonly webConsole?: {
    readonly experienceBanner: {
      readonly title: string
      readonly endpoints: readonly string[]
      readonly highlights: readonly string[]
    }
    readonly zklModules: readonly string[]
    readonly novixlinkExtraModules: readonly string[]
  }
  readonly sopScenarios?: readonly SopScenario[]
  readonly rawMarkdown: string
}

interface OpsManualViewProps {
  readonly onQuickDispatchOps: (goalText: string) => Promise<void>
}

export function OpsManualView({ onQuickDispatchOps }: OpsManualViewProps) {
  const [manualsList, setManualsList] = useState<readonly ManualSummaryItem[]>([])
  const [selectedManualId, setSelectedManualId] = useState<string>('bv1rpwd6nepp-long-horizon-dev')
  const [manual, setManual] = useState<OpsManualData | null>(null)
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'sop' | 'commands' | 'markdown'>('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const [dispatchingId, setDispatchingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Extensible Custom Knowledge Manual Creator State
  const [editorOpen, setEditorOpen] = useState(false)
  const [savingManual, setSavingManual] = useState(false)
  const [hiddenManualCount, setHiddenManualCount] = useState(0)
  const [widgetsList, setWidgetsList] = useState<
    readonly {
      id: string
      title: string
      category?: string
      icon?: string
      description?: string
      actionType?: 'quick-command' | 'link' | 'note'
      payload?: string
    }[]
  >([])
  const [widgetEditorOpen, setWidgetEditorOpen] = useState(false)
  const [widgetDraft, setWidgetDraft] = useState({
    title: '',
    icon: '🧩',
    description: '',
    actionType: 'quick-command' as 'quick-command' | 'link' | 'note',
    payload: '@studio-default 执行自定义自动化检查',
  })
  const [manualDraft, setManualDraft] = useState({
    id: '',
    title: '',
    subtitle: '',
    version: 'v1.0',
    category: '业务知识库',
    scopeLabel: '自动按关键词注入团队智能体 Prompt',
    keywordsText: 'architecture, api, deploy',
    specsText: '核心服务端口=4317 | 在线\n主力模型路由=cliproxyapi/gpt-6.1-sol | 默认\n质量门禁=N-1异体双审 + SHA256 | 强制',
    sopTitle: '一键执行模块代码架构审查与自动化测试',
    sopPrompt: '@studio-default @gpt-6.1-sol 按知识库规范执行架构审查与测试验证',
    sopStepsText: '读取工作区核心模块与配置文件\n执行单元测试并核对返回码\n生成结构化审查结论',
    sopCommandsText: 'npm run typecheck\nnpm test',
    rawMarkdown: '# 自定义扩展知识库说明\n\n在此输入 Markdown 规范，智能体执行匹配任务时将自动加载本手册。',
  })

  const loadManualsCatalog = useCallback(async (preferredId?: string) => {
    try {
      const res = await fetch('/api/knowledge', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as {
        manuals?: readonly ManualSummaryItem[]
        widgets?: readonly {
          id: string
          title: string
          category?: string
          icon?: string
          description?: string
          actionType?: 'quick-command' | 'link' | 'note'
          payload?: string
        }[]
        hiddenManualCount?: number
      }
      const list = data.manuals ?? []
      setManualsList(list)
      setWidgetsList(data.widgets ?? [])
      setHiddenManualCount(Number(data.hiddenManualCount ?? 0))
      if (list.length === 0) {
        setManual(null)
        return
      }
      const candidateId = preferredId || selectedManualId
      const targetId = list.some((m) => m.id === candidateId) ? candidateId : list[0].id
      const detailRes = await fetch(`/api/knowledge/${encodeURIComponent(targetId)}`, { cache: 'no-store' })
      if (detailRes.ok) {
        const detailData = (await detailRes.json()) as { manual?: OpsManualData }
        if (detailData.manual) {
          setManual(detailData.manual)
          setSelectedManualId(detailData.manual.id)
        }
      }
    } catch {}
  }, [selectedManualId])

  useEffect(() => {
    void loadManualsCatalog()
  }, [loadManualsCatalog])

  const selectManual = useCallback(async (id: string) => {
    setSelectedManualId(id)
    setActiveSubTab('overview')
    try {
      const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as { manual?: OpsManualData }
        if (data.manual) setManual(data.manual)
      }
    } catch {}
  }, [])

  const handleSaveCustomManual = useCallback(async () => {
    if (!manualDraft.title.trim()) {
      setNotice('❌ 请输入自定义知识库标题')
      return
    }
    setSavingManual(true)
    setNotice(null)
    try {
      const triggerKeywords = manualDraft.keywordsText
        .split(/[,，]/u)
        .map((s) => s.trim())
        .filter(Boolean)

      const specs: CustomSpecItem[] = manualDraft.specsText
        .split(/\r?\n/u)
        .map((line) => {
          const eq = line.indexOf('=')
          if (eq <= 0) return null
          const label = line.slice(0, eq).trim()
          const rest = line.slice(eq + 1).trim()
          const [valPart, badgePart] = rest.split('|').map((s) => s.trim())
          return {
            label,
            value: valPart || '—',
            ...(badgePart ? { badge: badgePart } : {}),
          }
        })
        .filter((x): x is CustomSpecItem => x !== null && Boolean(x.label))

      const sopCards: SopScenario[] = manualDraft.sopTitle.trim()
        ? [
            {
              id: 'custom-sop-1',
              icon: '⚡',
              symptom: manualDraft.sopTitle.trim(),
              quickPrompt: manualDraft.sopPrompt.trim() || manualDraft.sopTitle.trim(),
              steps: manualDraft.sopStepsText
                .split(/\r?\n/u)
                .map((s) => s.trim())
                .filter(Boolean),
              relatedCommands: manualDraft.sopCommandsText
                .split(/\r?\n/u)
                .map((s) => s.trim())
                .filter(Boolean),
            },
          ]
        : []

      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(manualDraft.id ? { id: manualDraft.id } : {}),
          title: manualDraft.title.trim(),
          subtitle: manualDraft.subtitle.trim() || '用户自定义可扩展知识库与 SOP 中心',
          version: manualDraft.version.trim() || 'v1.0',
          category: manualDraft.category.trim() || '自定义知识库',
          scopeLabel: manualDraft.scopeLabel.trim() || '全局工作区智能体共享',
          triggerKeywords,
          specs,
          sopCards,
          rawMarkdown: manualDraft.rawMarkdown,
        }),
      })
      const data = (await res.json()) as { ok?: boolean; manual?: OpsManualData; error?: string }
      if (res.ok && data.ok && data.manual) {
        setEditorOpen(false)
        setNotice(`✅ 已保存扩展知识库「${data.manual.title}」，UI 已自动生成专属导航与液态玻璃卡片！`)
        await loadManualsCatalog(data.manual.id)
      } else {
        setNotice(`❌ 保存失败: ${data.error ?? '未知错误'}`)
      }
    } catch (err) {
      setNotice(`❌ 保存失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSavingManual(false)
    }
  }, [manualDraft, loadManualsCatalog])

  const handleDeleteCustomManual = useCallback(
    async (id: string, isCustom?: boolean) => {
      try {
        const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, { method: 'DELETE' })
        if (res.ok) {
          setNotice(
            isCustom
              ? '🗑️ 已彻底删除该自定义知识库模块'
              : '🙈 已移除该内置手册（随时可点击「恢复已移除内置手册」找回）',
          )
          await loadManualsCatalog('')
        }
      } catch {}
    },
    [loadManualsCatalog],
  )

  const handleRestoreManuals = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge/restore', { method: 'POST' })
      if (res.ok) {
        setNotice('🔄 已恢复全部内置知识库手册！')
        await loadManualsCatalog('bv1rpwd6nepp-long-horizon')
      }
    } catch {}
  }, [loadManualsCatalog])

  const handleSaveWidget = useCallback(async () => {
    if (!widgetDraft.title.trim()) return
    try {
      const res = await fetch('/api/extensions/widgets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(widgetDraft),
      })
      if (res.ok) {
        setWidgetDraft({
          title: '',
          icon: '🧩',
          description: '',
          actionType: 'quick-command',
          payload: '@studio-default 执行自定义自动化检查',
        })
        setWidgetEditorOpen(false)
        setNotice('✅ 已新增自定义扩展功能模块！')
        await loadManualsCatalog()
      }
    } catch {}
  }, [widgetDraft, loadManualsCatalog])

  const handleDeleteWidget = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/extensions/widgets/${encodeURIComponent(id)}`, { method: 'DELETE' })
        if (res.ok) {
          setNotice('🗑️ 已删除该自定义扩展功能模块')
          await loadManualsCatalog()
        }
      } catch {}
    },
    [loadManualsCatalog],
  )

  const copySnippet = useCallback((txt: string) => {
    navigator.clipboard?.writeText(txt).catch(() => {})
    setCopiedText(txt)
    setTimeout(() => setCopiedText((cur) => (cur === txt ? null : cur)), 1800)
  }, [])

  const handleDispatchSop = useCallback(
    async (id: string, promptText: string) => {
      setDispatchingId(id)
      try {
        await onQuickDispatchOps(promptText)
      } finally {
        setDispatchingId(null)
      }
    },
    [onQuickDispatchOps],
  )

  const filteredCommands = useMemo(() => {
    const list = manual?.telegramBot?.commands ?? []
    const q = searchQuery.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (c) =>
        c.command.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.identity.toLowerCase().includes(q),
    )
  }, [manual?.telegramBot?.commands, searchQuery])

  const activeSopList = useMemo(
    () => manual?.sopScenarios ?? manual?.sopCards ?? [],
    [manual?.sopScenarios, manual?.sopCards],
  )

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px 72px', width: '100%' }}>
      <div style={{ width: '100%', maxWidth: '100%', margin: '0 auto', display: 'grid', gap: 20 }}>
        {notice && (
          <div
            className="at-glass-card"
            style={{
              padding: '14px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              borderColor: 'var(--at-border-highlight)',
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>{notice}</span>
            <button type="button" className="studio-btn" onClick={() => setNotice(null)}>
              关闭
            </button>
          </div>
        )}

        {/* Top Hub Header: Dynamic Manual Selector + Add Custom Knowledge Base Button */}
        <section className="at-glass-card" style={{ padding: '22px 24px', display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 22 }}>🧩</span>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 780, letterSpacing: '-0.02em' }}>
                  可扩展知识库、SOP 与 Prompt 自动注入中心 (Extensible Knowledge Hub)
                </h2>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 650,
                    padding: '3px 11px',
                    borderRadius: 999,
                    background: 'var(--at-accent-primary-subtle)',
                    color: 'var(--at-accent-primary)',
                    border: '1px solid var(--at-border-highlight)',
                  }}
                >
                  已挂载 {manualsList.length} 套知识模块
                </span>
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 }}>
                支持自由新增自定义知识手册、业务指标卡与排障 SOP；设置触发关键词后，团队执行任务时将自动注入对应手册，UI 自动适配新增内容。
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {hiddenManualCount > 0 && (
                <button
                  type="button"
                  className="studio-btn"
                  onClick={() => { void handleRestoreManuals() }}
                >
                  🔄 恢复已移除内置手册 ({hiddenManualCount})
                </button>
              )}
              <button
                type="button"
                className="studio-btn studio-btn-primary"
                onClick={() => {
                  setManualDraft((prev) => ({ ...prev, id: '', title: '', subtitle: '' }))
                  setEditorOpen((prev) => !prev)
                }}
              >
                {editorOpen ? '✕ 收起编辑器' : '➕ 新增自定义知识库 / SOP 模块'}
              </button>
            </div>
          </div>

          {/* Extensible Manual Selector Pills with Direct Delete Button */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            {manualsList.map((item) => {
              const active = item.id === selectedManualId
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 6px 3px 3px',
                    borderRadius: 999,
                    background: 'var(--at-canvas-card)',
                    border: active ? '1.5px solid var(--at-accent-primary)' : '1px solid var(--at-border-hairline)',
                  }}
                >
                  <button
                    type="button"
                    className={`studio-btn ${active ? 'studio-btn-primary' : ''}`}
                    style={{ padding: '6px 14px', fontSize: 13.5, border: 0 }}
                    onClick={() => { void selectManual(item.id) }}
                  >
                    <span>{item.isCustom ? '📘' : '📡'}</span>
                    <span>{item.title}</span>
                    {item.version && (
                      <span style={{ opacity: 0.85, fontSize: 12 }}>({item.version})</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="studio-btn"
                    style={{ padding: '4px 8px', minHeight: 28, fontSize: 12, border: 0, color: '#ef4444' }}
                    title={item.isCustom ? '删除该自定义知识库' : '移除/隐藏该内置知识库'}
                    onClick={() => { void handleDeleteCustomManual(item.id, item.isCustom) }}
                  >
                    🗑️
                  </button>
                </div>
              )
            })}
          </div>

          {/* Custom Knowledge Base Creator / Editor Form */}
          {editorOpen && (
            <div
              className="at-ecosystem-card"
              style={{ gap: 14, border: '1.5px solid var(--at-accent-primary)', marginTop: 4 }}
            >
              <div style={{ fontWeight: 750, fontSize: 16 }}>
                ✨ 创建/扩展自定义知识库模块（保存后自动生成自适应 Liquid Glass 卡片与导航 Tab）
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <label style={{ display: 'grid', gap: 5 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>知识库标题 *</span>
                  <input
                    type="text"
                    className="studio-quick-input"
                    placeholder="例如：前端 Liquid Glass 视觉规范 / 核心网关排障手册"
                    value={manualDraft.title}
                    onChange={(e) => setManualDraft((p) => ({ ...p, title: e.target.value }))}
                  />
                </label>

                <label style={{ display: 'grid', gap: 5 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>副标题描述</span>
                  <input
                    type="text"
                    className="studio-quick-input"
                    placeholder="简述该知识库的适用场景…"
                    value={manualDraft.subtitle}
                    onChange={(e) => setManualDraft((p) => ({ ...p, subtitle: e.target.value }))}
                  />
                </label>

                <label style={{ display: 'grid', gap: 5 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>自动注入触发关键词 (逗号分隔)</span>
                  <input
                    type="text"
                    className="studio-quick-input"
                    placeholder="例如：glass, ui, 网关, 部署"
                    value={manualDraft.keywordsText}
                    onChange={(e) => setManualDraft((p) => ({ ...p, keywordsText: e.target.value }))}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ display: 'grid', gap: 5 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    自定义核心规格卡片（每行一个 `指标名=指标值 | 徽章`，UI 自动生成网格卡片）
                  </span>
                  <textarea
                    className="studio-quick-input"
                    style={{ height: 92, padding: '8px 12px', resize: 'vertical' }}
                    value={manualDraft.specsText}
                    onChange={(e) => setManualDraft((p) => ({ ...p, specsText: e.target.value }))}
                  />
                </label>

                <div style={{ display: 'grid', gap: 8 }}>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>关联 SOP 场景标题</span>
                    <input
                      type="text"
                      className="studio-quick-input"
                      value={manualDraft.sopTitle}
                      onChange={(e) => setManualDraft((p) => ({ ...p, sopTitle: e.target.value }))}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>一键派发 @快捷指令</span>
                    <input
                      type="text"
                      className="studio-quick-input"
                      value={manualDraft.sopPrompt}
                      onChange={(e) => setManualDraft((p) => ({ ...p, sopPrompt: e.target.value }))}
                    />
                  </label>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ display: 'grid', gap: 5 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>SOP 标准执行步骤（每行一步）</span>
                  <textarea
                    className="studio-quick-input"
                    style={{ height: 84, padding: '8px 12px', resize: 'vertical' }}
                    value={manualDraft.sopStepsText}
                    onChange={(e) => setManualDraft((p) => ({ ...p, sopStepsText: e.target.value }))}
                  />
                </label>

                <label style={{ display: 'grid', gap: 5 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Markdown 详细规范文档</span>
                  <textarea
                    className="studio-quick-input"
                    style={{ height: 84, padding: '8px 12px', resize: 'vertical' }}
                    value={manualDraft.rawMarkdown}
                    onChange={(e) => setManualDraft((p) => ({ ...p, rawMarkdown: e.target.value }))}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="studio-btn" onClick={() => setEditorOpen(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="studio-btn studio-btn-primary"
                  disabled={savingManual}
                  onClick={() => { void handleSaveCustomManual() }}
                >
                  {savingManual ? '保存中…' : '💾 保存并挂载到知识库中心'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Active Manual Content Area */}
        {manual && (
          <section className="at-glass-card" style={{ padding: '22px 24px', display: 'grid', gap: 20 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: 19, fontWeight: 780 }}>{manual.title}</h3>
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 650,
                      padding: '3px 10px',
                      borderRadius: 999,
                      background: 'var(--at-accent-primary-subtle)',
                      color: 'var(--at-accent-primary)',
                    }}
                  >
                    {manual.version} · {manual.scopeLabel}
                  </span>
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 }}>
                  {manual.subtitle}
                </div>
                {manual.triggerKeywords && manual.triggerKeywords.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}>自动注入触发词：</span>
                    {manual.triggerKeywords.map((kw) => (
                      <code
                        key={kw}
                        style={{
                          fontSize: 12.5,
                          padding: '2px 8px',
                          borderRadius: 6,
                          background: 'var(--at-canvas-input)',
                          border: '1px solid var(--at-border-hairline)',
                        }}
                      >
                        {kw}
                      </code>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div className="studio-tabs">
                  <button
                    type="button"
                    className="studio-tab"
                    data-active={activeSubTab === 'overview'}
                    onClick={() => setActiveSubTab('overview')}
                  >
                    🏛️ 核心架构与规格
                  </button>
                  <button
                    type="button"
                    className="studio-tab"
                    data-active={activeSubTab === 'sop'}
                    onClick={() => setActiveSubTab('sop')}
                  >
                    🛠️ SOP 一键派发 ({activeSopList.length})
                  </button>
                  {manual.telegramBot && (
                    <button
                      type="button"
                      className="studio-tab"
                      data-active={activeSubTab === 'commands'}
                      onClick={() => setActiveSubTab('commands')}
                    >
                      🤖 Bot 指令速查 ({manual.telegramBot.commands.length})
                    </button>
                  )}
                  <button
                    type="button"
                    className="studio-tab"
                    data-active={activeSubTab === 'markdown'}
                    onClick={() => setActiveSubTab('markdown')}
                  >
                    📄 Markdown 原文
                  </button>
                </div>

                <button
                  type="button"
                  className="studio-btn"
                  style={{ color: '#ef4444' }}
                  onClick={() => { void handleDeleteCustomManual(manual.id, manual.isCustom) }}
                >
                  🗑️ {manual.isCustom ? '删除此知识库' : '移除此内置手册'}
                </button>
              </div>
            </div>

            {/* Sub-Tab 1: Overview & Adaptive Specs Grid */}
            {activeSubTab === 'overview' && (
              <div style={{ display: 'grid', gap: 18 }}>
                {/* Custom Adaptive Specs Bento Grid (for user-created manuals) */}
                {manual.specs && manual.specs.length > 0 && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                      gap: 14,
                    }}
                  >
                    {manual.specs.map((spec, idx) => (
                      <div key={idx} className="at-ecosystem-card" style={{ gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 }}>
                            {spec.label}
                          </span>
                          {spec.badge && (
                            <span
                              style={{
                                fontSize: 12,
                                padding: '2px 8px',
                                borderRadius: 999,
                                background: 'var(--at-accent-primary-subtle)',
                                color: 'var(--at-accent-primary)',
                                fontWeight: 650,
                              }}
                            >
                              {spec.badge}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 17, fontWeight: 780 }}>{spec.value}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Built-in NovixLink Specs (if present) */}
                {manual.nodeSpec && manual.systemEntry && (
                  <>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                        gap: 14,
                      }}
                    >
                      <div className="at-ecosystem-card" style={{ gap: 6 }}>
                        <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 }}>
                          🌐 主控 Web 面板入口
                        </div>
                        <div style={{ fontSize: 15.5, fontWeight: 750, color: 'var(--at-accent-primary)' }}>
                          {manual.systemEntry.webUrl}
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}>
                          回环：{manual.systemEntry.loopbackAddr} · 隧道：{manual.systemEntry.tunnelService}
                        </div>
                      </div>

                      <div className="at-ecosystem-card" style={{ gap: 6 }}>
                        <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 }}>
                          🖥️ 节点硬件与协议规格
                        </div>
                        <div style={{ fontSize: 15.5, fontWeight: 750 }}>{manual.nodeSpec.displayName}</div>
                        <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}>
                          {manual.nodeSpec.hardware} · {manual.nodeSpec.proxyProtocol}
                        </div>
                      </div>

                      <div className="at-ecosystem-card" style={{ gap: 6 }}>
                        <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 }}>
                          📊 流量倍率与配额红线
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--at-accent-warning)' }}>
                          ×{manual.nodeSpec.trafficMultiplier} 双向计费 · {manual.nodeSpec.zklQuotaGb} GB
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}>
                          节点总上限 {manual.nodeSpec.nodeCapGb} GB · 每月 {manual.nodeSpec.billingResetDay} 号重置
                        </div>
                      </div>

                      <div className="at-ecosystem-card" style={{ gap: 6 }}>
                        <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 }}>
                          ⚡ 端口峰值与 FUP 保护
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 780, color: 'var(--at-accent-success)' }}>
                          实测 {manual.nodeSpec.measuredPeakMbps} Mbps (标称 {manual.nodeSpec.nominalPortMbps}M)
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}>
                          FUP 红线：{manual.nodeSpec.fupRedline}
                        </div>
                      </div>
                    </div>

                    {/* Three-Stage Bandwidth Policy Cards */}
                    <div style={{ display: 'grid', gap: 10 }}>
                      <div style={{ fontWeight: 750, fontSize: 15.5 }}>
                        🛡️ 三级自动限速与断流状态机 (Three-Stage Bandwidth Guard)
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                        {manual.nodeSpec.bwPolicies.map((pol) => (
                          <div key={pol.stage} className="at-ecosystem-card" style={{ gap: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <code style={{ fontWeight: 700, fontSize: 14, color: 'var(--at-accent-primary)' }}>{pol.stage}</code>
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  padding: '2px 9px',
                                  borderRadius: 999,
                                  background: 'var(--at-accent-primary-subtle)',
                                  color: 'var(--at-accent-primary)',
                                }}
                              >
                                {pol.badge}
                              </span>
                            </div>
                            <div style={{ fontSize: 13.5 }}><strong>触发条件：</strong>{pol.condition}</div>
                            <div style={{ fontSize: 13.5, color: 'var(--dsw-alias-label-secondary)' }}><strong>限速效果：</strong>{pol.effect}</div>
                            <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}><strong>恢复方式：</strong>{pol.recovery}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Sub-Tab 2: SOP Scenarios & One-Click Team Dispatch */}
            {activeSubTab === 'sop' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
                {activeSopList.map((sop) => (
                  <div key={sop.id} className="at-ecosystem-card" style={{ gap: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 20 }}>{sop.icon}</span>
                        <strong style={{ fontSize: 15.5 }}>{sop.symptom}</strong>
                      </div>
                      <button
                        type="button"
                        className="studio-btn studio-btn-primary"
                        disabled={dispatchingId === sop.id}
                        onClick={() => { void handleDispatchSop(sop.id, sop.quickPrompt) }}
                      >
                        {dispatchingId === sop.id ? '生成中…' : '⚡ 一键组队排障'}
                      </button>
                    </div>

                    <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6, fontSize: 13.5, color: 'var(--dsw-alias-label-secondary)' }}>
                      {sop.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>

                    {sop.relatedCommands && sop.relatedCommands.length > 0 && (
                      <div style={{ display: 'grid', gap: 6, marginTop: 'auto' }}>
                        {sop.relatedCommands.map((cmd, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 8,
                              padding: '7px 11px',
                              borderRadius: 10,
                              background: 'var(--at-canvas-input)',
                              border: '1px solid var(--at-border-hairline)',
                              fontFamily: 'ui-monospace, monospace',
                              fontSize: 12.5,
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd}</span>
                            <button
                              type="button"
                              className="studio-btn"
                              style={{ padding: '2px 9px', fontSize: 12 }}
                              onClick={() => copySnippet(cmd)}
                            >
                              {copiedText === cmd ? '✓ 已复制' : '复制'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Sub-Tab 3: Bot Commands */}
            {activeSubTab === 'commands' && manual.telegramBot && (
              <div style={{ display: 'grid', gap: 14 }}>
                <input
                  type="text"
                  className="studio-quick-input"
                  placeholder="🔍 搜索指令名称、权限身份或功能说明…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <div className="at-ecosystem-card" style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--at-border-hairline)', textAlign: 'left', color: 'var(--dsw-alias-label-secondary)' }}>
                        <th style={{ padding: '10px 12px' }}>Bot 指令</th>
                        <th style={{ padding: '10px 12px' }}>权限范围</th>
                        <th style={{ padding: '10px 12px' }}>功能说明</th>
                        <th style={{ padding: '10px 12px' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCommands.map((c) => (
                        <tr key={c.command} style={{ borderBottom: '1px solid var(--at-border-hairline)' }}>
                          <td style={{ padding: '9px 12px', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: 'var(--at-accent-primary)' }}>
                            {c.command}
                          </td>
                          <td style={{ padding: '9px 12px' }}>{c.identity}</td>
                          <td style={{ padding: '9px 12px', color: 'var(--dsw-alias-label-secondary)' }}>{c.description}</td>
                          <td style={{ padding: '9px 12px' }}>
                            <button type="button" className="studio-btn" onClick={() => copySnippet(c.command)}>
                              {copiedText === c.command ? '✓ 已复制' : '复制'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Sub-Tab 4: Raw Markdown */}
            {activeSubTab === 'markdown' && (
              <div className="at-ecosystem-card">
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 13.5,
                    lineHeight: 1.65,
                    maxHeight: 540,
                    overflow: 'auto',
                  }}
                >
                  {manual.rawMarkdown}
                </pre>
              </div>
            )}
          </section>
        )}

        {/* Custom Extension Feature Widgets Manager (Add + Execute + Delete) */}
        <section className="at-glass-card" style={{ padding: '22px 24px', display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>
                ⚡ 自定义扩展功能模块管理 ({widgetsList.length})
              </h3>
              <div style={{ fontSize: 13.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 3 }}>
                在此自由新增或删除自己的快捷指令模块、外部工具链接或备忘卡片，同时在「跨端审批 &amp; Worktree」页面同步展示。
              </div>
            </div>
            <button
              type="button"
              className="studio-btn studio-btn-primary"
              onClick={() => setWidgetEditorOpen((v) => !v)}
            >
              {widgetEditorOpen ? '✕ 收起' : '➕ 新增扩展功能模块'}
            </button>
          </div>

          {widgetEditorOpen && (
            <div
              className="at-ecosystem-card"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}
            >
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>模块标题 *</label>
                <input
                  className="studio-quick-input"
                  value={widgetDraft.title}
                  onChange={(e) => setWidgetDraft({ ...widgetDraft, title: e.target.value })}
                  placeholder="例如：一键安全红队扫描"
                />
              </div>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>动作类型</label>
                <select
                  className="studio-quick-input"
                  value={widgetDraft.actionType}
                  onChange={(e) =>
                    setWidgetDraft({
                      ...widgetDraft,
                      actionType: e.target.value as 'quick-command' | 'link' | 'note',
                    })
                  }
                >
                  <option value="quick-command">⚡ 触发 @快捷模式 团队指令</option>
                  <option value="link">🔗 打开外部工具/监控链接</option>
                  <option value="note">📌 纯信息备忘卡片</option>
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
                <input
                  className="studio-quick-input"
                  style={{ flex: 1 }}
                  value={widgetDraft.payload}
                  onChange={(e) => setWidgetDraft({ ...widgetDraft, payload: e.target.value })}
                  placeholder="输入 @指令 或 https://链接 或备忘说明..."
                />
                <button type="button" className="studio-btn studio-btn-primary" onClick={() => void handleSaveWidget()}>
                  💾 保存模块
                </button>
              </div>
            </div>
          )}

          {widgetsList.length === 0 ? (
            <div style={{ fontSize: 13.5, color: 'var(--dsw-alias-label-secondary)' }}>
              当前暂无自定义扩展功能模块，点击右上方「➕ 新增扩展功能模块」即可添加，并随时支持一键删除。
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {widgetsList.map((w) => (
                <div key={w.id} className="at-ecosystem-card" style={{ gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>
                      {w.icon || '🧩'} {w.title}
                    </strong>
                    <button
                      type="button"
                      className="studio-btn"
                      style={{ padding: '4px 10px', minHeight: 28, fontSize: 12, color: '#ef4444' }}
                      onClick={() => void handleDeleteWidget(w.id)}
                    >
                      🗑️ 删除
                    </button>
                  </div>
                  {w.payload && (
                    <code style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' }}>
                      {w.payload}
                    </code>
                  )}
                  {w.actionType === 'quick-command' && w.payload && (
                    <button
                      type="button"
                      className="studio-btn"
                      style={{ alignSelf: 'flex-start', fontSize: 12.5 }}
                      onClick={() => void handleDispatchSop(w.id, w.payload!)}
                    >
                      🚀 立即派发执行
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
