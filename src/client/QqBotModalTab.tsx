import { useCallback, useEffect, useState } from 'react'

export interface QqBotPublicConfig {
  readonly enabled: boolean
  readonly appId: string
  readonly hasSecret: boolean
  readonly secretPreview: string
  readonly c2cPolicy: 'allowlist' | 'open' | 'disabled'
  readonly groupPolicy: 'allowlist' | 'open' | 'disabled'
  readonly requireMentionInGroup: boolean
  readonly allowUsers: readonly string[]
  readonly allowGroups: readonly string[]
  readonly defaultModel: string
  readonly defaultEffort: string
  readonly defaultMode: string
  readonly defaultReplyDetail?: 'concise' | 'verbose'
  readonly defaultTeamPreset: string
  readonly defaultWorkspace: string
  readonly allowedWorkspaces: readonly string[]
  readonly markdownSupport: boolean
}

export interface QqBotRemoteTask {
  readonly id: string
  readonly mode: string
  readonly model: string
  readonly effort: string
  readonly cwd: string
  readonly prompt: string
  readonly teamId?: string | null
  readonly status: string
  readonly summary?: string | null
  readonly error?: string | null
  readonly createdAt?: number | null
  readonly finishedAt?: number | null
}

export interface QqBotStatusResponse {
  readonly ok?: boolean
  readonly config: QqBotPublicConfig
  readonly pairing?: {
    readonly active: boolean
    readonly code: string | null
    readonly expiresAt: number | null
  }
  readonly gateway: {
    readonly state: 'offline' | 'connecting' | 'online' | 'reconnecting' | 'fatal'
    readonly appId: string
    readonly botUser?: { readonly username?: string; readonly id?: string } | null
    readonly lastConnectedAt?: string | null
    readonly lastError?: string | null
    readonly reconnectAttempt?: number
  }
  readonly activeDirectCount?: number
  readonly activeTeamCount?: number
  readonly recentTasks?: readonly QqBotRemoteTask[]
}

interface Props {
  readonly status: QqBotStatusResponse | null
  readonly availableModelIds: readonly string[]
  readonly onRefresh: () => Promise<void>
  readonly onNotice: (msg: string) => void
}

const STATE_BADGES: Record<string, { label: string; color: string }> = {
  online: { label: '🟢 网关在线', color: 'var(--at-accent-success)' },
  connecting: { label: '🟡 正在连接…', color: 'var(--at-accent-warning)' },
  reconnecting: { label: '🟡 断线重连中…', color: 'var(--at-accent-warning)' },
  fatal: { label: '🔴 致命错误', color: 'var(--at-accent-danger, #fb7185)' },
  offline: { label: '⚪ 未连接', color: 'var(--dsw-alias-label-secondary)' },
}

export function QqBotModalTab({ status, availableModelIds, onRefresh, onNotice }: Props) {
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [c2cPolicy, setC2cPolicy] = useState<'allowlist' | 'open' | 'disabled'>('allowlist')
  const [groupPolicy, setGroupPolicy] = useState<'allowlist' | 'open' | 'disabled'>('allowlist')
  const [defaultModel, setDefaultModel] = useState('gpt-6.1-sol')
  const [defaultEffort, setDefaultEffort] = useState('medium')
  const [defaultMode, setDefaultMode] = useState('direct')
  const [defaultReplyDetail, setDefaultReplyDetail] = useState<'concise' | 'verbose'>('verbose')
  const [defaultTeamPreset, setDefaultTeamPreset] = useState('chatgpt-crew')
  const [defaultWorkspace, setDefaultWorkspace] = useState('')
  const [allowedWorkspacesText, setAllowedWorkspacesText] = useState('')
  const [markdownSupport, setMarkdownSupport] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!status?.config || dirty) return
    const c = status.config
    setAppId(c.appId || '')
    setC2cPolicy(c.c2cPolicy || 'allowlist')
    setGroupPolicy(c.groupPolicy || 'allowlist')
    setDefaultModel(c.defaultModel || 'gpt-6.1-sol')
    setDefaultEffort(c.defaultEffort || 'medium')
    setDefaultMode(c.defaultMode || 'direct')
    setDefaultReplyDetail(c.defaultReplyDetail === 'concise' ? 'concise' : 'verbose')
    setDefaultTeamPreset(c.defaultTeamPreset || 'chatgpt-crew')
    setDefaultWorkspace(c.defaultWorkspace || '')
    setAllowedWorkspacesText((c.allowedWorkspaces || []).join('\n'))
    setMarkdownSupport(Boolean(c.markdownSupport))
  }, [status, dirty])

  const saveConfig = useCallback(
    async (extraPatch: Record<string, unknown> = {}) => {
      setBusy('save')
      try {
        const allowedWorkspaces = allowedWorkspacesText
          .split(/\r?\n|;/u)
          .map((s) => s.trim())
          .filter(Boolean)
        const payload: Record<string, unknown> = {
          appId: appId.trim(),
          c2cPolicy,
          groupPolicy,
          defaultModel: defaultModel.trim() || 'gpt-6.1-sol',
          defaultEffort,
          defaultMode,
          defaultReplyDetail,
          defaultTeamPreset,
          defaultWorkspace: defaultWorkspace.trim(),
          allowedWorkspaces,
          markdownSupport,
          ...extraPatch,
        }
        if (appSecret.trim()) {
          payload.appSecret = appSecret.trim()
        }
        const res = await fetch('/api/channels/qqbot/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = (await res.json()) as { error?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        setAppSecret('')
        setDirty(false)
        await onRefresh()
        onNotice('✅ QQ 机器人配置已加密落盘保存！')
        return true
      } catch (err) {
        onNotice(`❌ 保存 QQ 配置失败: ${err instanceof Error ? err.message : String(err)}`)
        return false
      } finally {
        setBusy(null)
      }
    },
    [
      allowedWorkspacesText,
      appId,
      appSecret,
      c2cPolicy,
      defaultEffort,
      defaultMode,
      defaultModel,
      defaultReplyDetail,
      defaultTeamPreset,
      defaultWorkspace,
      groupPolicy,
      markdownSupport,
      onNotice,
      onRefresh,
    ],
  )

  const handleConnect = useCallback(async () => {
    const saved = await saveConfig({ enabled: true })
    if (!saved) return
    setBusy('connect')
    try {
      const res = await fetch('/api/channels/qqbot/connect', { method: 'POST' })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      await onRefresh()
      onNotice('✅ 已发起连接腾讯 QQ 机器人网关，请稍候片刻确认在线状态喵~')
    } catch (err) {
      onNotice(`❌ 连接 QQ 网关失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }, [onNotice, onRefresh, saveConfig])

  const handleDisconnect = useCallback(async () => {
    setBusy('disconnect')
    try {
      await fetch('/api/channels/qqbot/disconnect', { method: 'POST' })
      await onRefresh()
      onNotice('✅ 已断开 QQ 机器人网关连接。')
    } catch (err) {
      onNotice(`❌ 断开失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }, [onNotice, onRefresh])

  const handleGeneratePairing = useCallback(async () => {
    setBusy('pair')
    try {
      const res = await fetch('/api/channels/qqbot/pairing-code', { method: 'POST' })
      const data = (await res.json()) as { pairing?: { code?: string }; error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      await onRefresh()
      onNotice(`✅ 已生成一次性配对码 ${data.pairing?.code ?? ''}（10 分钟内有效），请在 QQ 发送 /pair ${data.pairing?.code ?? ''}`)
    } catch (err) {
      onNotice(`❌ 生成配对码失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }, [onNotice, onRefresh])

  const removeAllowedUser = useCallback(
    async (userId: string) => {
      const next = (status?.config?.allowUsers || []).filter((id) => id !== userId)
      await saveConfig({ allowUsers: next })
    },
    [saveConfig, status?.config?.allowUsers],
  )

  const removeAllowedGroup = useCallback(
    async (groupId: string) => {
      const next = (status?.config?.allowGroups || []).filter((id) => id !== groupId)
      await saveConfig({ allowGroups: next })
    },
    [saveConfig, status?.config?.allowGroups],
  )

  const handleCancelTask = useCallback(
    async (taskId: string) => {
      try {
        await fetch(`/api/channels/qqbot/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' })
        await onRefresh()
        onNotice(`🛑 已发送中止信号给任务 #${taskId.slice(0, 8)}`)
      } catch {}
    },
    [onNotice, onRefresh],
  )

  const gwState = status?.gateway?.state || 'offline'
  const badge = STATE_BADGES[gwState] || STATE_BADGES.offline
  const pairing = status?.pairing

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* 状态与连接控制 */}
      <div
        className="at-ecosystem-card"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong style={{ fontSize: 15.5 }}>🤖 官方 QQ 机器人远程控制网关 (WebSocket v2)</strong>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: badge.color }}>{badge.label}</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' }}>
            {status?.gateway?.botUser?.username
              ? `机器人身份：${status.gateway.botUser.username} · AppID: ${status.config.appId}`
              : '支持在手机 QQ 直接发送需求、切换模型与思考程度 (/model, /think)、单兵执行与多智能体团队审批。'}
          </div>
          {status?.gateway?.lastError && (
            <div style={{ fontSize: 12, color: 'var(--at-accent-danger, #fb7185)' }}>
              最近提示：{status.gateway.lastError}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="studio-btn studio-btn-primary"
            disabled={busy !== null}
            onClick={() => { void handleConnect() }}
          >
            {busy === 'connect' ? '连接中…' : gwState === 'online' ? '🔄 保存并重连' : '🔌 保存并连接 QQ'}
          </button>
          {gwState !== 'offline' && (
            <button
              type="button"
              className="studio-btn"
              disabled={busy !== null}
              onClick={() => { void handleDisconnect() }}
            >
              🛑 断开连接
            </button>
          )}
          <button
            type="button"
            className="studio-btn"
            disabled={busy !== null}
            onClick={() => { void onRefresh() }}
          >
            🔄 刷新
          </button>
        </div>
      </div>

      {/* 授权配对与白名单 */}
      <div className="at-ecosystem-card" style={{ gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <strong style={{ fontSize: 14.5 }}>🔐 管理员配对与访问白名单</strong>
            <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' }}>
              默认拦截陌生人调用。生成配对码后，用你的 QQ 给机器人发送 <code>/pair 配对码</code> 即可绑定权限。
            </div>
          </div>
          <button
            type="button"
            className="studio-btn studio-btn-primary"
            disabled={busy !== null}
            onClick={() => { void handleGeneratePairing() }}
          >
            {busy === 'pair' ? '生成中…' : '🔑 生成 6 位配对码'}
          </button>
        </div>

        {pairing?.active && pairing.code && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              background: 'var(--at-accent-primary-subtle)',
              border: '1px solid var(--at-border-highlight)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div>
              <span>当前有效配对码：</span>
              <code style={{ fontSize: 18, fontWeight: 800, letterSpacing: 3, marginLeft: 6 }}>
                {pairing.code}
              </code>
              <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
                （在 QQ 发送：<code>/pair {pairing.code}</code>）
              </span>
            </div>
            <button
              type="button"
              className="studio-btn"
              onClick={() => {
                void navigator.clipboard?.writeText(`/pair ${pairing.code}`)
                onNotice(`✅ 已复制 /pair ${pairing.code}`)
              }}
            >
              📋 复制配对指令
            </button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontWeight: 600 }}>私聊策略 (c2cPolicy)</span>
            <select
              className="studio-team-select"
              style={{ maxWidth: '100%' }}
              value={c2cPolicy}
              onChange={(e) => {
                setDirty(true)
                setC2cPolicy(e.target.value as 'allowlist' | 'open' | 'disabled')
              }}
            >
              <option value="allowlist">仅已配对白名单用户 (推荐)</option>
              <option value="open">开放私聊 (风险：仅限测试)</option>
              <option value="disabled">禁用私聊</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontWeight: 600 }}>群聊策略 (groupPolicy)</span>
            <select
              className="studio-team-select"
              style={{ maxWidth: '100%' }}
              value={groupPolicy}
              onChange={(e) => {
                setDirty(true)
                setGroupPolicy(e.target.value as 'allowlist' | 'open' | 'disabled')
              }}
            >
              <option value="allowlist">仅白名单群 + 已配对管理员 (推荐)</option>
              <option value="open">已配对管理员在任意群 @bot</option>
              <option value="disabled">禁用群聊</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
          <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>已授权 QQ OpenID：</span>
          {(status?.config?.allowUsers || []).length === 0 ? (
            <span style={{ color: 'var(--at-accent-warning)' }}>暂无（请生成配对码并在 QQ 发送 /pair）</span>
          ) : (
            (status?.config?.allowUsers || []).map((uid) => (
              <span
                key={uid}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '2px 10px',
                  borderRadius: 999,
                  border: '1px solid var(--at-border-hairline)',
                  background: 'var(--at-surface-elevated, rgba(255,255,255,0.06))',
                }}
              >
                <code>{uid.slice(0, 14)}…</code>
                <button
                  type="button"
                  title="移除该用户授权"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
                  onClick={() => { void removeAllowedUser(uid) }}
                >
                  ✕
                </button>
              </span>
            ))
          )}
        </div>

        {(status?.config?.allowGroups || []).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
            <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>已授权群 OpenID：</span>
            {status!.config.allowGroups.map((gid) => (
              <span
                key={gid}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '2px 10px',
                  borderRadius: 999,
                  border: '1px solid var(--at-border-hairline)',
                }}
              >
                <code>{gid.slice(0, 14)}…</code>
                <button
                  type="button"
                  title="移除群授权"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
                  onClick={() => { void removeAllowedGroup(gid) }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 机器人凭证与默认模型/思考程度配置 */}
      <div className="at-ecosystem-card" style={{ gap: 12 }}>
        <strong style={{ fontSize: 14.5 }}>⚙️ 机器人凭证、默认模型与工作区范围</strong>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontWeight: 600 }}>QQ 机器人 AppID</span>
            <input
              type="text"
              className="studio-quick-input"
              placeholder="输入 QQ 开放平台机器人 AppID"
              value={appId}
              onChange={(e) => {
                setDirty(true)
                setAppId(e.target.value)
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontWeight: 600 }}>
              QQ 机器人 AppSecret {status?.config?.hasSecret ? '（已安全存储）' : ''}
            </span>
            <input
              type="password"
              className="studio-quick-input"
              placeholder={status?.config?.hasSecret ? '已配置（留空则保持原密钥不变）' : '输入 QQ 开放平台 AppSecret'}
              value={appSecret}
              onChange={(e) => {
                setDirty(true)
                setAppSecret(e.target.value)
              }}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontWeight: 600 }}>默认模型 (defaultModel)</span>
            <input
              type="text"
              list="qqbot-models-datalist"
              className="studio-quick-input"
              value={defaultModel}
              onChange={(e) => {
                setDirty(true)
                setDefaultModel(e.target.value)
              }}
            />
            <datalist id="qqbot-models-datalist">
              {availableModelIds.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </label>

          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontWeight: 600 }}>默认思考程度 (defaultEffort)</span>
            <select
              className="studio-team-select"
              style={{ maxWidth: '100%' }}
              value={defaultEffort}
              onChange={(e) => {
                setDirty(true)
                setDefaultEffort(e.target.value)
              }}
            >
              <option value="off">关闭思考 (off)</option>
              <option value="low">轻度思考 (low)</option>
              <option value="medium">均衡思考 (medium)</option>
              <option value="high">深度思考 (high)</option>
              <option value="xhigh">极致思考 (xhigh)</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontWeight: 600 }}>默认接单模式 (defaultMode)</span>
            <select
              className="studio-team-select"
              style={{ maxWidth: '100%' }}
              value={defaultMode}
              onChange={(e) => {
                setDirty(true)
                setDefaultMode(e.target.value)
              }}
            >
              <option value="direct">⚡ 单兵直达 (direct)</option>
              <option value="team">🐉 多智能体团队 (team)</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontWeight: 600 }}>默认回复风格 (defaultReplyDetail)</span>
            <select
              className="studio-team-select"
              style={{ maxWidth: '100%' }}
              value={defaultReplyDetail}
              onChange={(e) => {
                setDirty(true)
                setDefaultReplyDetail(e.target.value === 'concise' ? 'concise' : 'verbose')
              }}
            >
              <option value="verbose">📋 详细模式 (含接单/模型/Token/耗时)</option>
              <option value="concise">💬 简洁模式 (只看纯粹回答内容)</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontWeight: 600 }}>默认工作区 (defaultWorkspace)</span>
            <input
              type="text"
              className="studio-quick-input"
              value={defaultWorkspace}
              onChange={(e) => {
                setDirty(true)
                setDefaultWorkspace(e.target.value)
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontWeight: 600 }}>默认团队预设 (defaultTeamPreset)</span>
            <select
              className="studio-team-select"
              style={{ maxWidth: '100%' }}
              value={defaultTeamPreset}
              onChange={(e) => {
                setDirty(true)
                setDefaultTeamPreset(e.target.value)
              }}
            >
              <option value="chatgpt-crew">chatgpt-crew (敏捷双人组)</option>
              <option value="studio-default">studio-default (3人全栈开发组)</option>
              <option value="heterogeneous-cross-review">heterogeneous-cross-review (异构交叉审查)</option>
              <option value="ai-radar-squad">ai-radar-squad (调研评估编队)</option>
              <option value="video-studio">video-studio (AI 视频制作工坊)</option>
            </select>
          </label>
        </div>

        <label style={{ display: 'grid', gap: 5 }}>
          <span style={{ fontWeight: 600 }}>允许远程 /cwd 切换的工作区根目录（每行一个路径）</span>
          <textarea
            className="studio-quick-input"
            rows={2}
            style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12.5 }}
            value={allowedWorkspacesText}
            onChange={(e) => {
              setDirty(true)
              setAllowedWorkspacesText(e.target.value)
            }}
          />
        </label>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={markdownSupport}
              onChange={(e) => {
                setDirty(true)
                setMarkdownSupport(e.target.checked)
              }}
            />
            <span>启用 QQ Markdown 消息格式（仅当机器人已获官方 Markdown 权限时开启）</span>
          </label>

          <button
            type="button"
            className="studio-btn"
            disabled={busy !== null}
            onClick={() => { void saveConfig() }}
          >
            {busy === 'save' ? '保存中…' : '💾 仅保存配置'}
          </button>
        </div>
      </div>

      {/* 最近 QQ 远程任务监控 */}
      <div className="at-ecosystem-card" style={{ gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 14.5 }}>📋 最近 QQ 远程任务记录 ({status?.recentTasks?.length ?? 0})</strong>
          <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
            QQ 常用指令：<code>/models</code> · <code>/model</code> · <code>/think</code> · <code>/mode</code> · <code>/team</code> · <code>/approve</code> · <code>/cancel</code>
          </span>
        </div>

        {(status?.recentTasks || []).length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' }}>
            暂无 QQ 远程任务记录。配对后直接在手机 QQ 发一条需求即可触发执行喵~
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {status!.recentTasks!.slice(0, 8).map((task) => (
              <div
                key={task.id}
                style={{
                  padding: '8px 12px',
                  borderRadius: 12,
                  border: '1px solid var(--at-border-hairline)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                    <code>#{task.id.slice(0, 8)}</code>
                    <strong>[{task.status}]</strong>
                    <span>{task.mode}</span>
                    <span>· {task.model}</span>
                    <span>· {task.effort}</span>
                    {task.teamId && <code>team:{task.teamId}</code>}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: 'var(--dsw-alias-label-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {task.prompt}
                  </div>
                </div>
                {task.status === 'running' && (
                  <button
                    type="button"
                    className="studio-btn"
                    onClick={() => { void handleCancelTask(task.id) }}
                  >
                    🛑 中止
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
