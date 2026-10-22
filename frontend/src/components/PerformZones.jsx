import { t } from '../lib/i18n.js'
import { fmtTime, ZONE_NAMES } from '../lib/perform-running.js'

// PerForm: time in each heart-rate zone as one bar and its legend (lib/perform-running.js), on a
// run's detail sheet and on the Running page.
export const ZONE_COLORS = ['var(--blue)', 'var(--green)', 'var(--yellow)', 'var(--orange)', 'var(--red)']

export default function PerformZones({ secs, bounds }) {
  const total = secs.reduce((a, s) => a + s, 0)
  if (!total) return null
  return <div>
    <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 8 }}>
      {secs.map((s, i) => s ? <div key={i} style={{ width: `${(s / total) * 100}%`, background: ZONE_COLORS[i] }} /> : null)}
    </div>
    <div className="small" style={{ marginTop: 8, display: 'grid', gap: 3 }}>
      {secs.map((s, i) => <div key={i} className="row between">
        <span><span style={{ color: ZONE_COLORS[i] }}>●</span> {t('Zone {0}', i + 1)} · {t(ZONE_NAMES[i])}
          {bounds && <span className="dim"> {bounds[i]}{i < 4 ? `–${bounds[i + 1] - 1}` : '+'} bpm</span>}</span>
        <span><b>{Math.round((s / total) * 100)}%</b> <span className="dim">{fmtTime(s)}</span></span>
      </div>)}
    </div>
  </div>
}
