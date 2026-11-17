/** Reader-facing text-size control for the AgentTeams workspace panel.
 *  Restored historical behavior: four steps 90/100/115/130%, default 100%,
 *  persisted per browser via localStorage, always falling back to the default
 *  step when the stored value is missing, invalid, or the storage throws. */

export const FONT_SCALE_KEY = 'nanmicoder.dsh-agent-teams.font-scale'

export const FONT_SCALES = [0.9, 1, 1.15, 1.3] as const

/** Step index of the default 100% scale. */
export const FONT_SCALE_DEFAULT = 1

/** Minimal storage surface so tests can substitute an in-memory fake. */
export interface FontScaleStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function readFontScaleStep(storage: FontScaleStorage): number {
  try {
    const stored = Number(storage.getItem(FONT_SCALE_KEY))
    const index = FONT_SCALES.indexOf(stored as (typeof FONT_SCALES)[number])
    return index === -1 ? FONT_SCALE_DEFAULT : index
  } catch {
    return FONT_SCALE_DEFAULT
  }
}

export function stepDown(step: number): number {
  return Math.max(0, step - 1)
}

export function stepUp(step: number): number {
  return Math.min(FONT_SCALES.length - 1, step + 1)
}

export function scaleAtStep(step: number): number {
  return FONT_SCALES[step] ?? 1
}

export function writeFontScaleStep(storage: FontScaleStorage, step: number): void {
  try {
    storage.setItem(FONT_SCALE_KEY, String(scaleAtStep(step)))
  } catch {
    /* page-only: keep the current session scale when persistence is denied */
  }
}
