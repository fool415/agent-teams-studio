/** Shared six-state operations: uncertain writes reconcile; never blindly replay. */
export type OperationState = 'idle' | 'validating' | 'submitting' | 'succeeded' | 'failed' | 'outcome_unknown'
export class OutcomeUnknown extends Error {}
export class TeamRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
export async function teamRequest(url: string, init: RequestInit = {}): Promise<any> {
  let response: Response
  try { response = await fetch(url, { ...init, cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15_000) }) }
  catch { throw new OutcomeUnknown('网络超时或响应丢失；操作结果未知，请刷新核对，切勿盲目重发。') }
  if (!response.ok) {
    if (response.status === 504 || response.status === 502) throw new OutcomeUnknown('服务响应超时，操作结果未知。')
    const data = await response.json().catch(() => ({}))
    throw new TeamRequestError(response.status, `${response.status === 401 || response.status === 403 ? '鉴权失败' : response.status >= 500 ? '服务不可用' : '请求失败'} (${response.status}): ${data.error ?? response.statusText}`)
  }
  try { return await response.json() }
  catch { throw new OutcomeUnknown('响应内容丢失；操作可能已提交，请刷新核对。') }
}
export async function normalizeTeamName(name: string): Promise<string> {
  const normalized = name.normalize('NFC').trim().toLowerCase()
  const cleaned = normalized.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  const points = [...cleaned]
  if (cleaned && points.length <= 48) return cleaned
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  const digest = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 8)
  return cleaned ? `${points.slice(0, 48).join('')}-${digest}` : `k-${digest}`
}
export async function reconcileTeam(teamId: string, workspace?: string): Promise<any | undefined> {
  try {
    const result = await teamRequest(`/plugins/dsh-agent-teams/teams/${encodeURIComponent(teamId)}${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''}`)
    return result.team
  } catch (error) {
    if (error instanceof TeamRequestError && error.status === 404) return undefined
    throw error
  }
}
