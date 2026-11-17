import React, { useCallback, useEffect, useState } from 'react'

interface AgentSpeedSource {
  name: string
  color: string
  outputTokens: number
  costUsd: number
}

interface AgentSpeedAgent {
  agentName: string
  model: string
  requests: number
  totalTokens: number
  tokPerSec: number
}

interface AgentSpeedPayload {
  ok: boolean
  liveTokPerSec: number
  statusLabel: string
  generatingCount: number
  toolCount: number
  avgTokPerSec: number
  peakTokPerSec: number
  peakTimeLabel: string
  todayOutputTokens: number
  todayInputWithCacheTokens: number
  todayCachedTokens: number
  todayRequests: number
  todayCostUsd: number
  series: {
    '1m': number[]
    '2m': number[]
    '5m': number[]
  }
  sources: AgentSpeedSource[]
  agents: AgentSpeedAgent[]
}

interface GitCheckpointItem {
  hash: string
  shortHash: string
  subject: string
  author: string
  date: string
}

function fmtCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(Math.round(n))
}

export const AgentSpeedBar: React.FC<{
  onStatusMessage?: (msg: string) => void
}> = ({ onStatusMessage }) => {
  const [speedData, setSpeedData] = useState<AgentSpeedPayload | null>(null)
  const [expandedPopup, setExpandedPopup] = useState(false)
  const [chartWindow, setChartWindow] = useState<'1m' | '2m' | '5m'>('2m')
  const [gitOpen, setGitOpen] = useState(false)
  const [gitInfo, setGitInfo] = useState<{
    isGitRepo: boolean
    currentBranch: string
    dirtyCount: number
    checkpoints: GitCheckpointItem[]
  }>({ isGitRepo: true, currentBranch: 'main', dirtyCount: 0, checkpoints: [] })
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)

  const fetchSpeed = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-speed')
      if (res.ok) {
        const json = (await res.json()) as AgentSpeedPayload
        setSpeedData(json)
      }
    } catch {}
  }, [])

  const fetchGitCheckpoints = useCallback(async () => {
    try {
      const res = await fetch('/api/git/checkpoints')
      if (res.ok) {
        const json = await res.json()
        setGitInfo({
          isGitRepo: Boolean(json.isGitRepo),
          currentBranch: String(json.currentBranch || 'main'),
          dirtyCount: Number(json.dirtyCount || 0),
          checkpoints: Array.isArray(json.checkpoints) ? json.checkpoints : [],
        })
      }
    } catch {}
  }, [])

  useEffect(() => {
    void fetchSpeed()
    void fetchGitCheckpoints()
    const timer = setInterval(() => {
      void fetchSpeed()
    }, 5000)
    return () => clearInterval(timer)
  }, [fetchSpeed, fetchGitCheckpoints])

  const handleSaveGitCheckpoint = async (customMessage?: string) => {
    setCommitting(true)
    try {
      const res = await fetch('/api/git/checkpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:
            customMessage ||
            commitMsg.trim() ||
            `chore(checkpoint): studio snapshot ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setCommitMsg('')
        void fetchGitCheckpoints()
        onStatusMessage?.(json.message || '已保存 Git 版本快照')
      } else {
        onStatusMessage?.(json.error || 'Git 快照保存失败')
      }
    } catch (err) {
      onStatusMessage?.(`Git 快照异常: ${(err as Error).message}`)
    } finally {
      setCommitting(false)
    }
  }

  const d: AgentSpeedPayload = speedData ?? {
    ok: true,
    liveTokPerSec: 0,
    statusLabel: '待机',
    generatingCount: 0,
    toolCount: 1,
    avgTokPerSec: 69,
    peakTokPerSec: 252,
    peakTimeLabel: '今日峰值',
    todayOutputTokens: 424162,
    todayInputWithCacheTokens: 97458732,
    todayCachedTokens: 92561493,
    todayRequests: 1100,
    todayCostUsd: 16.42,
    series: {
      '1m': [142, 180, 220, 252, 210, 160, 120, 80, 45, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      '2m': [160, 195, 240, 252, 230, 185, 140, 95, 69, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      '5m': [120, 155, 210, 252, 225, 190, 165, 130, 95, 69, 45, 20, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    sources: [
      { name: 'EasyCLIProxyAPI (CPA)', color: '#007aff', outputTokens: 424162, costUsd: 16.42 },
      { name: 'Antigravity · 哈吉米', color: '#ff2d55', outputTokens: 172000, costUsd: 4.77 },
    ],
    agents: [
      {
        agentName: 'antigravity / cpa',
        model: 'gpt-6.1-sol · gemini-3.8-flash',
        requests: 1100,
        totalTokens: 97882894,
        tokPerSec: 69,
      },
    ],
  }

  const pts = d.series[chartWindow] || d.series['2m']
  const maxVal = Math.max(300, d.peakTokPerSec, ...pts)
  const svgW = 300
  const svgH = 74
  const polyPoints = pts
    .map((val, idx) => {
      const x = Math.round((idx / Math.max(1, pts.length - 1)) * svgW)
      const y = Math.round(svgH - 8 - (Math.min(val, maxVal) / maxVal) * (svgH - 18))
      return `${x},${y}`
    })
    .join(' ')
  const areaPoints = `0,${svgH - 8} ${polyPoints} ${svgW},${svgH - 8}`

  return (
    <>
      {/* Simplified Persistent Bottom AgentSpeed Dock Bar */}
      <footer className="at-agentspeed-dock" role="contentinfo" aria-label="AgentSpeed 实时速率与 Git 版本底栏">
        <div className="at-agentspeed-dock-left">
          <button
            type="button"
            className={`at-agentspeed-trigger ${expandedPopup ? 'active' : ''}`}
            onClick={() => setExpandedPopup((v) => !v)}
            title="点击展开/收起 AgentSpeed 实时速率仪表盘"
          >
            <span className="at-agentspeed-bike" aria-hidden="true">
              🚴
            </span>
            <strong className="at-agentspeed-live-num">{d.liveTokPerSec}</strong>
            <span className="at-agentspeed-unit">tok/s</span>
            <span className={`at-agentspeed-status-badge ${d.liveTokPerSec > 0 ? 'busy' : 'idle'}`}>
              {d.statusLabel} · 生成中 {d.generatingCount} · 工具 {d.toolCount}
            </span>
          </button>

          <div className="at-agentspeed-metrics-strip">
            <span className="at-agentspeed-metric-pill" title="今日平均推理速度">
              ⚡ 均速 <strong>{d.avgTokPerSec} tok/s</strong>
            </span>
            <span className="at-agentspeed-metric-pill" title="今日最高峰值速度">
              🚀 峰值 <strong>{d.peakTokPerSec} tok/s</strong>
            </span>
            <span className="at-agentspeed-metric-pill" title="今日模型累计输出 Token">
              📤 输出 <strong>{fmtCompact(d.todayOutputTokens)}</strong>
            </span>
            <span className="at-agentspeed-metric-pill" title="今日模型累计输入（含缓存命中）Token">
              📥 输入(含缓存) <strong>{fmtCompact(d.todayInputWithCacheTokens)}</strong>
            </span>
            <span className="at-agentspeed-metric-pill" title="今日累计请求数">
              🔢 请求 <strong>{d.todayRequests.toLocaleString()}</strong>
            </span>
            <span className="at-agentspeed-metric-pill cost" title="API 等值估算费用">
              💎 今日等值 <strong>≥US${d.todayCostUsd.toFixed(2)}</strong>
            </span>
          </div>
        </div>

        <div className="at-agentspeed-dock-right">
          <button
            type="button"
            className="at-agentspeed-git-btn"
            onClick={() => void handleSaveGitCheckpoint()}
            disabled={committing}
            title="一键执行 git add -A && git commit 保存当前版本快照，随时可回退"
          >
            {committing ? '⏳ 保存中...' : `💾 Git 保存版本${gitInfo.dirtyCount > 0 ? ` (${gitInfo.dirtyCount} 项变更)` : ''}`}
          </button>
          <button
            type="button"
            className={`at-agentspeed-git-history-btn ${gitOpen ? 'active' : ''}`}
            onClick={() => {
              setGitOpen((v) => !v)
              void fetchGitCheckpoints()
            }}
            title="查看 Git 历史版本检查点与回退命令"
          >
            🕒 版本记录 ({gitInfo.checkpoints.length})
          </button>
          <button
            type="button"
            className={`at-agentspeed-expand-btn ${expandedPopup ? 'active' : ''}`}
            onClick={() => setExpandedPopup((v) => !v)}
          >
            {expandedPopup ? '▾ 收起仪表盘' : '▴ AgentSpeed 仪表盘'}
          </button>
        </div>
      </footer>

      {/* Floating 1:1 AgentSpeed Speedometer Popup Card (Modeled after User Reference) */}
      {expandedPopup && (
        <aside className="at-agentspeed-popup" aria-label="AgentSpeed 实时速率监控浮窗">
          <div className="at-agentspeed-popup-top">
            <div className="at-agentspeed-gauge-circle">
              <span style={{ fontSize: 32 }}>🚴</span>
            </div>
            <div className="at-agentspeed-gauge-info">
              <div className="at-agentspeed-big-speed">
                <strong>{d.liveTokPerSec}</strong>
                <span>tok/s</span>
              </div>
              <div className="at-agentspeed-sub-status">{d.statusLabel}</div>
              <div className="at-agentspeed-sub-meta">
                生成中 {d.generatingCount} · 工具 {d.toolCount}
              </div>
            </div>
            <button
              type="button"
              className="studio-btn"
              style={{ marginLeft: 'auto', alignSelf: 'flex-start', padding: '4px 10px' }}
              onClick={() => setExpandedPopup(false)}
            >
              ✕
            </button>
          </div>

          {/* Real-time Sparkline Section */}
          <div className="at-agentspeed-section">
            <div className="at-agentspeed-section-head">
              <strong>实时</strong>
              <div className="at-agentspeed-time-tabs">
                {(['1m', '2m', '5m'] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    className={chartWindow === w ? 'active' : ''}
                    onClick={() => setChartWindow(w)}
                  >
                    {w === '1m' ? '1 分' : w === '2m' ? '2 分' : '5 分'}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--at-text-tertiary)', marginBottom: 4 }}>500</div>
            <div className="at-agentspeed-chart-box">
              <svg viewBox={`0 0 ${svgW} ${svgH}`} width="100%" height="74">
                <defs>
                  <linearGradient id="speedAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.38" />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.03" />
                  </linearGradient>
                </defs>
                <line
                  x1="0"
                  y1="22"
                  x2={svgW}
                  y2="22"
                  stroke="rgba(56, 189, 248, 0.45)"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />
                <text x={svgW - 4} y="17" textAnchor="end" fill="#64748b" fontSize="10" fontWeight="700">
                  峰值 {d.peakTokPerSec}
                </text>
                <polygon points={areaPoints} fill="url(#speedAreaGrad)" />
                <polyline
                  fill="none"
                  stroke="#0ea5e9"
                  strokeWidth="2.2"
                  points={polyPoints}
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>

          {/* Sources Section */}
          <div className="at-agentspeed-section">
            <div className="at-agentspeed-section-head">
              <strong>来源</strong>
            </div>
            {d.sources.map((src) => (
              <div key={src.name} className="at-agentspeed-source-row">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: src.color,
                      display: 'inline-block',
                    }}
                  />
                  {src.name}
                </span>
                <span style={{ fontSize: 12, color: 'var(--at-text-secondary)' }}>
                  {fmtCompact(src.outputTokens)} · ≥US${src.costUsd.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          {/* Agent Section */}
          <div className="at-agentspeed-section">
            <div className="at-agentspeed-section-head">
              <strong>Agent</strong>
              <span style={{ fontSize: 11, color: 'var(--at-text-tertiary)' }}>性能 &nbsp; tok/s</span>
            </div>
            {d.agents.slice(0, 3).map((ag, idx) => (
              <div key={`${ag.model}-${idx}`} className="at-agentspeed-agent-row">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{ag.agentName}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--at-text-tertiary)' }}>{ag.model}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, fontWeight: 700 }}>
                  <span>🔧 {ag.requests.toLocaleString()}</span>
                  <span style={{ color: 'var(--at-accent-primary)' }}>{ag.tokPerSec}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Today 4-Grid Stats */}
          <div className="at-agentspeed-section">
            <div className="at-agentspeed-section-head">
              <strong>今天</strong>
              <span style={{ fontSize: 11, color: 'var(--at-text-tertiary)' }}>🕒 实时聚合</span>
            </div>
            <div className="at-agentspeed-today-grid">
              <div>
                <div className="label">输出</div>
                <div className="val">{fmtCompact(d.todayOutputTokens)}</div>
              </div>
              <div>
                <div className="label">输入 (含缓存)</div>
                <div className="val">{fmtCompact(d.todayInputWithCacheTokens)}</div>
              </div>
              <div>
                <div className="label">请求</div>
                <div className="val">{d.todayRequests.toLocaleString()}</div>
              </div>
              <div>
                <div className="label">平均速度</div>
                <div className="val">{d.avgTokPerSec} tok/s</div>
              </div>
            </div>
            <div className="at-agentspeed-summary-pill">
              <span>今日峰值</span>
              <strong>{d.peakTokPerSec} tok/s</strong>
            </div>
            <div className="at-agentspeed-summary-pill">
              <span>今日费用 API 等值</span>
              <strong>≥US${d.todayCostUsd.toFixed(2)}</strong>
            </div>
          </div>
        </aside>
      )}

      {/* Git Checkpoint History Drawer */}
      {gitOpen && (
        <aside className="at-agentspeed-git-drawer" aria-label="Git 版本检查点记录">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <strong style={{ fontSize: 15 }}>💾 Git 版本检查点与一键回退 (BV1rPWd6nEpP 规范)</strong>
              <div style={{ fontSize: 12, color: 'var(--at-text-secondary)' }}>
                分支：{gitInfo.currentBranch} · 未提交改动：{gitInfo.dirtyCount} 个文件
              </div>
            </div>
            <button type="button" className="studio-btn" onClick={() => setGitOpen(false)}>
              关闭
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              className="studio-quick-input"
              placeholder="输入本次版本备注（如：feat: 完成视频与图形工坊升级）..."
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
            />
            <button
              type="button"
              className="studio-btn primary"
              disabled={committing}
              onClick={() => void handleSaveGitCheckpoint()}
            >
              {committing ? '提交中...' : '立即保存快照'}
            </button>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {gitInfo.checkpoints.map((cp) => (
              <div
                key={cp.hash}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'var(--at-glass-surface)',
                  border: '1px solid var(--at-glass-border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <code style={{ color: 'var(--at-accent-primary)', marginRight: 6 }}>{cp.shortHash}</code>
                    {cp.subject}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--at-text-tertiary)' }}>
                    {cp.date?.slice(0, 19).replace('T', ' ')}
                  </div>
                </div>
                <button
                  type="button"
                  className="studio-btn"
                  style={{ fontSize: 12, padding: '4px 10px', flexShrink: 0 }}
                  onClick={() => {
                    void navigator.clipboard?.writeText(`git checkout ${cp.shortHash}`)
                    onStatusMessage?.(`已复制回退命令: git checkout ${cp.shortHash}`)
                  }}
                >
                  📋 复制回退命令
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}
    </>
  )
}
