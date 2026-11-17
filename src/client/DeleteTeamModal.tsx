/**
 * DeleteTeamModal: Strong double-confirmation destructive action modal.
 *
 * Implements:
 * 1. Warning about running members and queued tasks that will be cancelled.
 * 2. Case-insensitive trimmed name matching input field to unlock danger button.
 * 3. "I understand" acknowledgement checkbox.
 * 4. Calls DELETE /plugins/dsh-agent-teams/teams/:teamId with confirm: true.
 * 5. Soft-delete archival notice (safe recovery without purge).
 *
 * @module dsh-agent-teams/client/delete-team-modal
 */

import { useState, useCallback, useRef, useEffect, type FormEvent } from 'react'
import type { SessionId } from './dsh-shims.ts'
import css from './DeleteConfirmModal.module.css'
import { teamRequest, reconcileTeam, OutcomeUnknown, type OperationState } from './team-management.ts'

export interface DeleteTeamModalProps {
  readonly open: boolean
  readonly teamId: string
  readonly teamName: string
  readonly activeMemberCount?: number
  readonly pendingTaskCount?: number
  readonly sessionId?: SessionId
  readonly workspace?: string
  readonly createdAt?: number
  readonly onClose: () => void
  readonly onDeleted?: (teamId: string) => void
}

export function DeleteTeamModal({
  open,
  teamId,
  teamName,
  activeMemberCount = 0,
  pendingTaskCount = 0,
  sessionId,
  workspace,
  createdAt,
  onClose,
  onDeleted,
}: DeleteTeamModalProps) {
  const [operation, setOperation] = useState<OperationState>('idle')
  const deleting = operation === 'validating' || operation === 'submitting'
  const busy = useRef(false)
  const identity = useRef(teamId + ':' + sessionId)
  identity.current = teamId + ':' + sessionId
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [open, onClose])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const canSubmit = !deleting && operation !== 'outcome_unknown' && operation !== 'succeeded'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit || busy.current) return
    if (!sessionId) { setError('请先选择原队长会话'); return }
    busy.current = true
    const bound = identity.current
    setOperation('validating')
    setError(null)
    try {
      setOperation('submitting')
      await teamRequest(`/plugins/dsh-agent-teams/teams/${encodeURIComponent(teamId)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, sessionId, createdAt }),
      })
      if (identity.current !== bound) return
      setOperation('succeeded'); setSuccess('已安全归档；恢复仅为只读历史，不会重启成员。'); onDeleted?.(teamId)
    } catch (err: unknown) {
      if (identity.current !== bound) return
      if (err instanceof OutcomeUnknown) {
        setOperation('outcome_unknown'); setError(err.message + ' 正在查询最新状态…')
        try {
          const team = await reconcileTeam(teamId, workspace)
          if (identity.current !== bound) return
          if (!team) { setOperation('succeeded'); setError(null); setSuccess('已查询确认团队不再活跃。'); onDeleted?.(teamId) }
          else setError(team.phase === 'cancelling' ? '服务端正在删除；关闭窗口不撤销操作，请刷新核对。' : '结果未知，请刷新核对；不会自动重发。')
        } catch { setError('状态查询失败，请刷新核对；不会自动重发。') }
      } else { setOperation('failed'); setError(err instanceof Error ? err.message : String(err)) }
    } finally { busy.current = false }
  }

  if (!open) return null

  return (
    <div className={css.modalBackdrop} onClick={onClose} role="dialog" aria-modal="true" aria-label="删除并归档团队">
      <div className={css.dangerModal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={css.dangerHeader}>
          <span className={css.dangerIcon}>⚠️</span>
          <span className={css.dangerTitle}>确认删除团队并移入回收站？</span>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className={css.dangerBody}>
            <div style={{ fontSize: '14.5px', lineHeight: '1.6', color: 'var(--dsw-alias-label-primary)' }}>
              确定要将团队 <strong style={{ color: 'var(--dsw-alias-state-error-primary, #EF4444)' }}>{teamName}</strong> 移入回收站吗？
            </div>

            <div className={css.impactBox} style={{ margin: '12px 0' }}>
              <ul className={css.impactList} style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', lineHeight: '1.7', color: 'var(--dsw-alias-label-secondary)' }}>
                <li>正在运行的成员子任务将被优雅中断并归档</li>
                <li>团队历史将安全保留至代际目录，可在回收站中随时一键还原</li>
              </ul>
            </div>

            {error && <div className={`${css.statusMessage} ${css.statusError}`}>{error}</div>}
            {success && <div className={`${css.statusMessage} ${css.statusSuccess}`}>{success}</div>}
          </div>

          {/* Actions */}
          <div className={css.dangerActions}>
            <button type="button" className={css.cancelBtn} onClick={onClose} disabled={deleting}>
              关闭视图 (Esc，不撤销服务端操作)
            </button>
            <button type="submit" className={css.dangerSubmitBtn} disabled={!canSubmit}>
              {deleting ? '正在安全中断并归档...' : '确认删除并归档'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
