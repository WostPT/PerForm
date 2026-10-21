import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { fmtDate } from '../lib/format.js'
import { dateLocale, t } from '../lib/i18n.js'
import { fmtPace } from '../lib/perform-run-details.js'
import { fmtTime, hrProfile, LONGEST, PB_DISTANCES, runPbs, runsOf, seenMaxHr, zonesOver } from '../lib/perform-running.js'
import { WorkoutRow, workoutDetailSheet } from '../sheets.jsx'
import PerformZones from '../components/PerformZones.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Section } from '../components/ui.jsx'

// PerForm: the running module (lib/perform-running.js). Personal bests and heart-rate zones from
// the runs' details, shown wherever the log is, the desktop included.
const fmtKm = n => (Math.round(n * 100) / 100).toLocaleString(dateLocale(), { maximumFractionDigits: 2 })

function MaxHr({ S, prof }) {
  const update = useStore(s => s.update)
  const [val, setVal] = useState(S.running?.maxHr ? String(S.running.maxHr) : '')
  const seen = seenMaxHr(S.workouts)
  const save = () => {
    const n = Math.round(Number(val))
    update(s => { s.running = { ...(s.running || {}), maxHr: n >= 100 && n <= 230 ? n : null } })
    if (!(n >= 100 && n <= 230)) setVal('')
  }
  return <div className="row between" style={{ gap: 10, marginTop: 12, alignItems: 'center' }}>
    <div className="small" style={{ minWidth: 0 }}>
      <div>{t('Maximum heart rate')}</div>
      <div className="dim">{prof?.maxTyped ? t('Typed in. Leave it empty to use the highest seen in a run ({0}).', seen ?? '–')
        : t('The highest seen in a run this year. A lab or field test is better: type it here.')}</div>
    </div>
    <input className="field" type="number" inputMode="numeric" min="100" max="230" placeholder={seen ? String(seen) : 'bpm'}
      value={val} onChange={e => setVal(e.target.value)} onBlur={save} style={{ width: 80, flexShrink: 0 }} aria-label={t('Maximum heart rate')} />
  </div>
}

export default function Running() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const runs = useMemo(() => runsOf(S.workouts), [S.workouts])
  const { bests } = runPbs(S.workouts)
  const prof = hrProfile(S)
  const zones = prof ? zonesOver(S.workouts, prof.bounds, 28) : null
  const recent = [...runs].reverse().slice(0, 10)
  const pbRows = PB_DISTANCES.filter(x => bests[x.key])

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Running')}</h1><div className="sub">{t('Personal bests and heart-rate zones from your runs')}</div></div>
    </div>

    {!runs.length && <div className="card"><div className="muted small">{t('No runs yet. A run from your watch shows here once Health Connect has it.')}</div></div>}

    {(pbRows.length > 0 || bests[LONGEST]) && <Section title={t('Personal bests')} footer={t('From runs outdoors with the watch. Treadmill runs count for zones, not for bests.')}>
      <div className="list">
        {pbRows.map(x => { const b = bests[x.key]; return <div className="item" key={x.key} role="button" tabIndex={0} onClick={() => workoutDetailSheet(b.w)}>
          <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, color: 'var(--yellow)' }}><Icon name="trophy" /></span>
          <div className="grow"><div className="tt">{t(x.label)}</div>
            <div className="ss">{fmtDate(b.w.d, true, true)} · {fmtPace(b.sec / (x.m / 1000))} /km</div></div>
          <b>{fmtTime(b.sec)}</b>
          <Icon name="chevronRight" className="chev" />
        </div> })}
        {bests[LONGEST] && <div className="item" role="button" tabIndex={0} onClick={() => workoutDetailSheet(bests[LONGEST].w)}>
          <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8 }}><Icon name="figureRun" /></span>
          <div className="grow"><div className="tt">{t('Longest run')}</div>
            <div className="ss">{fmtDate(bests[LONGEST].w.d, true, true)}</div></div>
          <b>{fmtKm(bests[LONGEST].km)} km</b>
          <Icon name="chevronRight" className="chev" />
        </div>}
      </div>
    </Section>}

    {runs.length > 0 && <div className="card">
      <h2 style={{ margin: 0 }}>{t('Heart-rate zones')}</h2>
      <div className="muted small" style={{ marginTop: 4 }}>{prof
        ? t('Last 4 weeks. Resting {0} bpm, maximum {1} bpm.', prof.rest, prof.max)
        : t('Zones need a resting heart rate from the watch and a maximum: either one seen in a run or one typed below.')}</div>
      {zones && (zones.some(Boolean)
        ? <PerformZones secs={zones} bounds={prof.bounds} />
        : <div className="small dim" style={{ marginTop: 8 }}>{t('No heart rate from a run in the last 4 weeks.')}</div>)}
      <MaxHr S={S} prof={prof} />
    </div>}

    {recent.length > 0 && <Section title={t('Recent runs')}>
      <div className="list">{recent.map(w => <WorkoutRow key={w.id} w={w} onClick={() => workoutDetailSheet(w)} />)}</div>
    </Section>}
  </div>
}
