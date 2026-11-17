import type { ActivityTeam } from './activity-monitor.ts'
import css from './QualityBadges.module.css'

const levels = ['L0', 'L1', 'L2', 'L3'] as const
const labels = ['结构', '机械', '白盒', '黑盒']
export function QualityBadges({ badges }: { badges?: ActivityTeam['qualityBadges'] }) {
  return <div className={css.row} aria-label="质量门禁证据" data-quality-badges>
    {levels.map((level, index) => {
      const badge = badges?.find(item => item.level === level)
      const passed = badge?.passed === true
      const title = `${passed ? '证据通过' : '未验证/未通过'}：${badge?.reason ?? '缺少服务端验收证据'}`
      return <span key={level} className={css.badge} data-level={level} data-passed={passed} title={title} aria-label={`${level} ${labels[index]} ${title}`}>
        <span aria-hidden="true">{passed ? '✓' : '—'}</span> {level} {labels[index]}
      </span>
    })}
  </div>
}
