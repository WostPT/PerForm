import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { dateLocale, t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { fmtPace, routePath } from '../lib/perform-run-details.js'
import { askRoute } from '../lib/perform-health-read.js'
import { Button } from './ui.jsx'

// PerForm, on a watch workout's detail sheet: its route, splits per km and curves of pace, heart
// rate and altitude (w.details, lib/perform-run-details.js). The route is drawn as its shape on a
// plain ground, with no map behind it: a map would mean a map library and sending where you ran
// to a tile server.
const fmtKm = n => (Math.round(n * 100) / 100).toLocaleString(dateLocale(), { maximumFractionDigits: 2 })
const mmss = sec => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`

function Curve({ label, values, t: ts, fmt, color, invert = false }) {
  const pts = values.map((v, i) => [ts[i], v]).filter(p => p[1] != null)
  if (pts.length < 2) return null
  const W = 300, H = 70
  const ys = pts.map(p => p[1])
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || 1
  const xy = pts.map(([x, y]) => {
    const fy = (y - lo) / span
    return `${((x - t0) / (t1 - t0 || 1) * W).toFixed(1)},${(4 + (invert ? fy : 1 - fy) * (H - 8)).toFixed(1)}`
  })
  const best = invert ? lo : hi, worst = invert ? hi : lo
  return <div style={{ marginTop: 12 }}>
    <div className="row between small"><span className="muted">{label}</span><span className="dim">{fmt(worst)} – {fmt(best)}</span></div>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block', marginTop: 4 }} aria-hidden="true">
      <polyline points={xy.join(' ')} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  </div>
}

function Route({ route }) {
  const p = routePath(route, 300, 200)
  if (!p) return null
  return <svg viewBox="0 0 300 200" style={{ width: '100%', height: 'auto', display: 'block', background: 'var(--surface-2)', borderRadius: 10 }} role="img" aria-label={t('Route')}>
    <path d={p.d} fill="none" stroke="var(--acc)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
    <circle cx={p.start[0]} cy={p.start[1]} r="5" fill="var(--green)" />
    <circle cx={p.end[0]} cy={p.end[1]} r="5" fill="var(--red)" />
  </svg>
}

export default function PerformRunDetails({ w, toast }) {
  const live = useStore(s => (s.S.workouts || []).find(x => x?.id === w?.id)) || w
  const [busy, setBusy] = useState(false)
  const d = live?.details
  if (!d || d.none || d.v !== 1) return null
  const s = d.series || {}
  const avgPace = d.km > 0 ? d.sec / d.km : null
  const showRoute = async () => {
    setBusy(true)
    try { if (!(await askRoute(live))) toast?.(t('No route for this workout')) }
    catch { toast?.(t('Could not read from Health Connect')) }
    setBusy(false)
  }
  const stats = [
    d.km > 0 && [t('Distance'), `${fmtKm(d.km)} km`],
    avgPace && [t('Avg pace'), `${fmtPace(avgPace)} /km`],
    live.watch?.hrAvg && [t('Avg HR'), `${live.watch.hrAvg} bpm`],
    d.gain != null && [t('Climb'), `${d.gain} m`],
    d.spm > 0 && [t('Cadence'), `${d.spm} spm`],
  ].filter(Boolean)

  return <div className="card" style={{ margin: '4px 0 14px' }}>
    <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('Advanced details')}</div>
    {stats.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8, marginBottom: 12 }}>
      {stats.map(([k, v]) => <div key={k}><div className="small muted">{k}</div><b>{v}</b></div>)}
    </div>}
    {d.route && <Route route={d.route} />}
    {!d.route && d.routeConsent && (MOBILE
      ? <Button icon="pin" disabled={busy} onClick={showRoute}>{t('Show the route')}</Button>
      : <div className="small dim">{t('Open this workout in the Android app to allow its route.')}</div>)}
    {d.splits?.length > 0 && <table className="small" style={{ width: '100%', marginTop: 12, borderCollapse: 'collapse' }}>
      <thead><tr className="muted" style={{ textAlign: 'left' }}>
        <th style={{ fontWeight: 400 }}>km</th><th style={{ fontWeight: 400 }}>{t('Pace')}</th>
        <th style={{ fontWeight: 400 }}>{t('HR')}</th><th style={{ fontWeight: 400 }}>{t('Elev.')}</th>
      </tr></thead>
      <tbody>{d.splits.map((x, i) => {
        const done = d.splits.slice(0, i + 1).reduce((a, y) => a + y.km, 0)
        return <tr key={i} style={{ borderTop: '1px solid var(--sep)' }}>
          <td style={{ padding: '4px 0' }}>{x.km < 1 ? fmtKm(done) : Math.round(done)}</td>
          <td><b>{fmtPace(x.km > 0 ? x.sec / x.km : null)}</b></td>
          <td>{x.hr ?? '–'}</td>
          <td>{x.elev != null ? `${x.elev > 0 ? '+' : ''}${x.elev} m` : '–'}</td>
        </tr>
      })}</tbody>
    </table>}
    {s.pace && <Curve label={t('Pace')} values={s.pace} t={s.t} fmt={v => `${fmtPace(v)} /km`} color="var(--blue)" invert />}
    {s.hr && <Curve label={t('Heart rate')} values={s.hr} t={s.t} fmt={v => `${Math.round(v)} bpm`} color="var(--red)" />}
    {s.alt && <Curve label={t('Altitude')} values={s.alt} t={s.t} fmt={v => `${Math.round(v)} m`} color="var(--green)" />}
    {s.t?.length > 0 && <div className="small dim" style={{ marginTop: 6 }}>{mmss(0)} – {mmss(d.sec)}</div>}
  </div>
}
