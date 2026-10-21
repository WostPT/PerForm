import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Row, Section, Switch } from './ui.jsx'
import { t } from '../lib/i18n.js'
import { fmtAgo } from '../lib/format.js'
import {
  healthReadStatus, loadHealthRead, enableHealthRead, disableHealthRead, readHealthNow,
  askHealthReadAgain, onHealthReadChange,
} from '../lib/perform-health-read.js'
import { openHealthConnect } from '../lib/health-sync.js'

// PerForm, Settings on the Android app: reading sleep, heart rate, HRV, steps, workouts and
// weigh-ins from Health Connect (lib/perform-health-read.js). Out of the way on a phone without
// Health Connect; the writing card above (HealthConnectCard) points to installing it.
const ALL = ['sleep', 'heart', 'rhr', 'hrv', 'steps', 'distance', 'exercise', 'weight']

export default function PerformHealthCard({ toast }) {
  const nav = useNavigate()
  const [st, setSt] = useState(null)
  const [h, setH] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let gone = false
    Promise.all([healthReadStatus(), loadHealthRead()]).then(([s, f]) => { if (!gone) { setSt(s); setH(f) } }).catch(() => {})
    const off = onHealthReadChange(f => { if (!gone) setH(f) })
    return () => { gone = true; off() }
  }, [])
  if (!st || !h) return null
  // Never hidden on the Android app: a phone where reading cannot work says why, rather than the
  // section going missing (the plugin absent from an older APK reads as 'unsupported').
  if (st.status !== 'available') return (
    <Section title={t('Watch data')}>
      <Row icon="heart" iconTint="var(--pink)" title={t('Read from Health Connect')}
        subtitle={st.status === 'missing'
          ? t('Install or update Health Connect to read your watch data.')
          : st.status === 'error'
            ? t('Health Connect did not answer: {0}', st.message || '?')
            : t('This version of the app cannot read Health Connect. Install the latest APK.')}
        accessory={st.status === 'missing' ? 'chevron' : 'none'}
        onClick={st.status === 'missing' ? () => openHealthConnect().catch(() => {}) : undefined} />
    </Section>
  )

  const run = async fn => {
    setBusy(true)
    try { await fn() } catch { toast(t('Could not read from Health Connect')) }
    setBusy(false)
  }
  const turnOn = () => run(async () => {
    const r = await enableHealthRead()
    setH(r.health || await loadHealthRead())
    if (r.ok) toast(t('Reading from Health Connect'))
    else toast(r.reason === 'denied' ? t('Health Connect permission not granted') : t('Could not read from Health Connect'))
  })
  const turnOff = () => run(async () => setH(await disableHealthRead()))
  const readNow = () => run(async () => {
    const out = await readHealthNow({ force: true })
    if (out?.error) toast(t('Could not read from Health Connect'))
    else toast(t('Health data up to date'))
  })
  const askAgain = () => run(async () => { await askHealthReadAgain() })

  const missing = ALL.filter(k => !(h.granted || []).includes(k))
  const subtitle = h.on && h.at ? t('Last read {0}', fmtAgo(h.at)) : t('Sleep, heart rate, HRV, steps, watch workouts and weigh-ins.')
  return (
    <Section title={t('Watch data')}
      footer={h.on ? t('Read when you open the app. Weigh-ins from a scale fill days your weight log has none for; what you type always wins.') : null}>
      <Row icon="heart" iconTint="var(--pink)" title={t('Read from Health Connect')} subtitle={subtitle}>
        <Switch checked={!!h.on} disabled={busy} onChange={v => (v ? turnOn() : turnOff())} />
      </Row>
      {h.on && h.error === 'permission' && <Row icon="warning" iconTint="var(--orange)"
        title={t('Permission withdrawn. Tap to allow again')} accessory="chevron" onClick={askAgain} />}
      {h.on && h.error !== 'permission' && missing.length > 0 && <Row icon="lock" iconTint="var(--orange)"
        title={t('Some data is not allowed')} subtitle={t('Tap to choose what PerForm may read.')} accessory="chevron" onClick={askAgain} />}
      {h.on && <Row icon="repeat" iconTint="var(--blue)" title={t('Read now')} accessory="chevron" onClick={busy ? undefined : readNow} />}
      <Row icon="chartLine" iconTint="var(--teal)" title={t('Sleep & recovery')} accessory="chevron" onClick={() => nav('/health')} />
    </Section>
  )
}
