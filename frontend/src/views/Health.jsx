import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { healthOf, healthSeries, healthAverage, nightsByDay, exerciseTypeName } from '../lib/perform-health.js'
import { fmtDate, fmtDur, fmtNum, todayISO, isoOf } from '../lib/format.js'
import { dateLocale, t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Segmented } from '../components/ui.jsx'

// PerForm: what the watch recorded (sleep, resting heart rate, HRV, steps, its workouts and the
// scale's weigh-ins), read from Health Connect on the phone (lib/perform-health-read.js) and kept
// in S.health, so it shows here on the desktop as well.
const METRICS = [
  { value: 'sleep', label: 'Sleep', unit: 'h', color: 'var(--indigo)' },
  { value: 'rhr', label: 'Resting HR', unit: 'bpm', color: 'var(--red)' },
  { value: 'hrv', label: 'HRV', unit: 'ms', color: 'var(--teal)' },
  { value: 'steps', label: 'Steps', unit: '', color: 'var(--green)' },
]
const TYPE_LABELS = {
  running: 'Running', running_treadmill: 'Treadmill run', walking: 'Walking', hiking: 'Hiking',
  biking: 'Cycling', biking_stationary: 'Indoor cycling', elliptical: 'Elliptical', hiit: 'HIIT',
  strength_training: 'Strength training', weightlifting: 'Weightlifting', yoga: 'Yoga',
  pilates: 'Pilates', stretching: 'Stretching', rowing: 'Rowing', rowing_machine: 'Rowing machine',
  swimming_pool: 'Pool swim', swimming_open_water: 'Open water swim', soccer: 'Football',
  tennis: 'Tennis', squash: 'Squash', stair_climbing: 'Stairs', stair_climbing_machine: 'Stair climber',
}
const typeLabel = type => t(TYPE_LABELS[exerciseTypeName(type)] || 'Workout')
const clock = ms => new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
const hm = min => fmtDur(min * 60000)
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return isoOf(d) }

function Tile({ label, value, unit, sub }) {
  return <div className="card" style={{ margin: 0, padding: 12 }}>
    <div className="muted small">{label}</div>
    <div className="big" style={{ marginTop: 3, fontSize: '1.5rem' }}>{value ?? '–'}{value != null && unit ? <span className="muted" style={{ fontSize: '0.9rem' }}> {unit}</span> : null}</div>
    {sub && <div className="small dim" style={{ marginTop: 2 }}>{sub}</div>}
  </div>
}

function Stages({ night }) {
  const parts = [['deep', 'var(--indigo)'], ['light', 'var(--blue)'], ['rem', 'var(--teal)'], ['awake', 'var(--orange)']]
  const total = parts.reduce((a, [k]) => a + (night[k] || 0), 0)
  if (!total) return null
  return <>
    <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 10 }}>
      {parts.map(([k, c]) => night[k] ? <div key={k} style={{ width: `${(night[k] / total) * 100}%`, background: c }} /> : null)}
    </div>
    <div className="small dim" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
      {parts.map(([k, c]) => night[k] ? <span key={k}><span style={{ color: c }}>●</span> {t({ deep: 'Deep', light: 'Light', rem: 'REM', awake: 'Awake' }[k])} {hm(night[k])}</span> : null)}
    </div>
  </>
}

export default function Health() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const h = useMemo(() => healthOf(S), [S])
  const [metric, setMetric] = useState('sleep')
  const [range, setRange] = useState(30)
  const nights = useMemo(() => nightsByDay(h), [h])
  const today = todayISO()
  const lastNight = nights[today] || nights[yesterday()] || null
  const day = h.days[today] || {}
  const recentRhr = Object.entries(h.days).reverse().find(([, v]) => v.rhr)
  const recentHrv = Object.entries(h.days).reverse().find(([, v]) => v.hrv)
  const m = METRICS.find(x => x.value === metric)
  const points = healthSeries(h, metric, range)
  const avg = healthAverage(h, metric, today, 7)
  const sessions = [...h.sessions].reverse().slice(0, 15)
  const weights = [...h.weights].reverse().slice(0, 10)
  const empty = !Object.keys(h.days).length && !h.sleep.length && !h.sessions.length && !h.weights.length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Sleep & recovery')}</h1><div className="sub">{t('From your watch, through Health Connect')}</div></div>
    </div>

    {empty && <div className="card">
      <div className="muted small">{MOBILE
        ? t('Nothing read yet. Turn on Read from Health Connect in Settings, and make sure the Fitbit app shares its data with Health Connect.')
        : t('Nothing read yet. Turn on Read from Health Connect in the Android app\'s Settings; what it reads shows here too.')}</div>
    </div>}

    {!empty && <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <Tile label={t('Last night')} value={lastNight ? hm(lastNight.asleep) : null}
          sub={lastNight ? `${clock(lastNight.start)} – ${clock(lastNight.end)}` : null} />
        <Tile label={t('Resting HR')} value={recentRhr ? recentRhr[1].rhr : null} unit="bpm"
          sub={recentRhr && recentRhr[0] !== today ? fmtDate(recentRhr[0]) : null} />
        <Tile label={t('HRV')} value={recentHrv ? fmtNum(recentHrv[1].hrv) : null} unit="ms"
          sub={recentHrv && recentHrv[0] !== today ? fmtDate(recentHrv[0]) : null} />
        <Tile label={t('Steps today')} value={day.steps != null ? day.steps.toLocaleString(dateLocale()) : null} />
      </div>

      {lastNight && <div className="card"><div className="muted small">{t('Sleep stages')}</div><Stages night={lastNight} /></div>}

      <div className="card">
        <Segmented value={metric} onChange={setMetric} options={METRICS.map(x => ({ value: x.value, label: t(x.label) }))} />
        <div className="row between" style={{ margin: '10px 0 4px' }}>
          <div className="muted small">{t('7-day average')}</div>
          <b>{avg == null ? '–' : metric === 'sleep' ? hm(Math.round(avg * 60)) : `${metric === 'steps' ? Math.round(avg).toLocaleString(dateLocale()) : fmtNum(avg)} ${m.unit}`}</b>
        </div>
        <Segmented className="seg-range" value={range} onChange={setRange}
          options={[{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }]} />
        <div className="chart"><LineChart points={points} h={170} unit={m.unit} color={m.color} /></div>
      </div>

      {sessions.length > 0 && <Section title={t('Watch workouts')}>
        <div className="list">{sessions.map(s => <div className="card" key={s.id} style={{ margin: 0 }}>
          <div className="row between">
            <div><b>{s.title || typeLabel(s.type)}</b>
              <div className="small dim" style={{ marginTop: 2 }}>{fmtDate(s.d, true)} · {clock(s.start)} · {fmtDur(s.end - s.start)}</div></div>
            <div className="small" style={{ textAlign: 'right' }}>
              {s.km ? <div>{fmtNum(s.km)} km</div> : null}
              {s.hrAvg ? <div className="dim">♥ {s.hrAvg}{s.hrMax ? ` / ${s.hrMax}` : ''} bpm</div> : null}
            </div>
          </div>
        </div>)}</div>
      </Section>}

      {weights.length > 0 && <Section title={t('Weigh-ins from Health Connect')}>
        <div className="list">{weights.map(w => <div className="card row between" key={w.id} style={{ margin: 0 }}>
          <div>{fmtDate(w.d, true)} <span className="dim small">{clock(w.time)}</span></div>
          <b>{fmtNum(S.unit === 'lb' ? w.kg * 2.2046226218 : w.kg)} {S.unit === 'lb' ? 'lb' : 'kg'}</b>
        </div>)}</div>
      </Section>}
    </>}
  </div>
}
