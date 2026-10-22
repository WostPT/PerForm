// PerForm: the running module. Personal bests, heart-rate zones and training load, worked out from what each run
// keeps in `details` (lib/perform-run-details.js: its best efforts and seconds per 5-bpm band), so
// nothing here reads Health Connect and it all shows on the desktop as well.
//
//   S.running = { maxHr }   // a maximum heart rate the user typed; none: the highest seen in runs
import { BEST_M, bestKey } from './perform-run-details.js'
import { isoOf, weekStartOf } from './format.js'

const DAY = 86400000
export const RUN_EX = '0685'          // run (the library's, as watch runs are logged)
export const TREADMILL_EX = '2197'    // run on treadmill
// PB distances, with what the page calls them.
export const PB_DISTANCES = BEST_M.map(m => ({ key: bestKey(m), m, label: { 1000: '1 km', 5000: '5 km', 10000: '10 km', 21097: 'Half marathon', 42195: 'Marathon' }[bestKey(m)] }))
export const LONGEST = 'longest'
// Zone lower bounds, as a share of heart-rate reserve (Karvonen): zone 1 starts at 50%.
export const ZONES = [0.5, 0.6, 0.7, 0.8, 0.9]
export const ZONE_NAMES = ['Recovery', 'Easy', 'Steady', 'Threshold', 'Max']
const SEEN_MAX_DAYS = 365
const REST_DAYS = 30

const exIds = w => (Array.isArray(w?.entries) ? w.entries.map(e => e?.id) : [])
/** A run, outdoors or on a treadmill, logged from the watch or in the app. */
export const isRun = w => exIds(w).some(id => id === RUN_EX || id === TREADMILL_EX)
/** A run outdoors: the only kind whose distance is measured, so the only kind with PBs. */
export const isOutdoorRun = w => exIds(w).includes(RUN_EX) && !exIds(w).includes(TREADMILL_EX)
const kmOf = w => (w?.details?.km > 0 ? w.details.km : w?.watch?.km > 0 ? w.watch.km : 0)
// A typed run's distance, from its sets' minutes and speed (km/h), when the watch gave none.
const kmLogged = w => kmOf(w) || Math.round((w?.entries || []).flatMap(e => e?.sets || [])
  .reduce((a, x) => a + (x?.min > 0 && x?.speed > 0 ? (x.min / 60) * x.speed : 0), 0) * 100) / 100
const byStart = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (Number(a.start) || 0) - (Number(b.start) || 0))

/** The runs in the log, oldest first. */
export function runsOf(workouts) {
  return (Array.isArray(workouts) ? workouts : []).filter(isRun).sort(byStart)
}

const pbCache = new WeakMap()
/**
 * Every PB as it was set, going through the runs oldest first: { [workout id]: [keys] } with a
 * key from PB_DISTANCES or LONGEST, and `bests`: the standing one for each, { key: { sec | km, w } }.
 * The first run at a distance sets its PB, as on Strava.
 */
export function runPbs(workouts) {
  if (Array.isArray(workouts) && pbCache.has(workouts)) return pbCache.get(workouts)
  const set = {}, bests = {}
  for (const w of runsOf(workouts)) {
    if (!isOutdoorRun(w)) continue
    const keys = []
    for (const { key } of PB_DISTANCES) {
      const sec = w.details?.best?.[key]
      if (!(sec > 0) || (bests[key] && bests[key].sec <= sec)) continue
      bests[key] = { sec, w }
      keys.push(key)
    }
    const km = kmOf(w)
    if (km > 0 && !(bests[LONGEST] && bests[LONGEST].km >= km)) { bests[LONGEST] = { km, w }; keys.push(LONGEST) }
    if (keys.length) set[w.id] = keys
  }
  const out = { set, bests }
  if (Array.isArray(workouts)) pbCache.set(workouts, out)
  return out
}

/** The PBs this workout set when it was run, [] for none (and for anything but a run). */
export const pbsOf = (workouts, w) => (w?.id && runPbs(workouts).set[w.id]) || []

/** The highest heart rate the watch saw in a run over the last year, or null. */
export function seenMaxHr(workouts, now = Date.now()) {
  const from = now - SEEN_MAX_DAYS * DAY
  let max = null
  for (const w of runsOf(workouts)) {
    const hr = w.watch?.hrMax
    // Over 220 is the optical sensor losing the beat, not a heart.
    if ((Number(w.start) || 0) >= from && hr > 0 && hr <= 220 && !(max >= hr)) max = hr
  }
  return max
}

/** The median resting heart rate of the last 30 days, from the watch (S.health.days), or null. */
export function restingHr(health, now = Date.now()) {
  const from = isoOf(new Date(now - REST_DAYS * DAY))
  const xs = Object.entries(health?.days || {}).filter(([d, v]) => d >= from && v?.rhr > 0).map(([, v]) => v.rhr).sort((a, b) => a - b)
  if (!xs.length) return null
  const m = xs.length >> 1
  return xs.length % 2 ? xs[m] : Math.round((xs[m - 1] + xs[m]) / 2)
}

/**
 * What the zones are worked from: { max, maxTyped, rest, bounds } with `bounds` the lower edge of
 * each zone in bpm, or null while the watch has not given both a maximum and a resting rate.
 */
export function hrProfile(S, now = Date.now()) {
  const typed = Number(S?.running?.maxHr)
  const maxTyped = typed >= 100 && typed <= 230
  const max = maxTyped ? typed : seenMaxHr(S?.workouts, now)
  const rest = restingHr(S?.health, now)
  if (!(max > 0) || !(rest > 0) || rest >= max) return null
  return { max, maxTyped, rest, bounds: ZONES.map(p => Math.round(rest + p * (max - rest))) }
}

/**
 * Seconds in each of the five zones, from a run's seconds per 5-bpm band (details.hrs). A band
 * goes to the zone its middle falls in; below zone 1 (standing at the start) counts as zone 1.
 */
export function zoneTimes(hrs, bounds) {
  const out = [0, 0, 0, 0, 0]
  if (!hrs || !bounds) return out
  for (const [band, sec] of Object.entries(hrs)) {
    const mid = Number(band) + 2.5
    let z = 0
    for (let i = 0; i < bounds.length; i++) if (mid >= bounds[i]) z = i
    out[z] += sec
  }
  return out
}

/** Seconds in each zone over the runs from `days` days ago to now. */
export function zonesOver(workouts, bounds, days = 28, now = Date.now()) {
  const from = now - days * DAY
  const out = [0, 0, 0, 0, 0]
  for (const w of runsOf(workouts)) {
    if ((Number(w.start) || 0) < from) continue
    zoneTimes(w.details?.hrs, bounds).forEach((s, i) => { out[i] += s })
  }
  return out
}

/** Seconds as "24:31", or "1:52:07" past the hour. */
export function fmtTime(sec) {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

// ---- training load -------------------------------------------------------------------------
// Banister's TRIMP: minutes weighted by where the heart rate sat in its reserve, steeper towards
// the top (0.64·e^(1.92·x), the coefficients most tools use). A 30-minute easy run is about 35.
const trimpAt = x => x * 0.64 * Math.exp(1.92 * x)
// A run without heart rate (an old one, a typed one, the watch off the wrist) is counted as if at
// 65% of reserve, an easy-to-steady run, and marked as estimated.
const GUESS_HRR = 0.65
export const ACUTE_DAYS = 7
export const CHRONIC_DAYS = 28

const minutesOf = w => {
  const ms = Number(w?.end) - Number(w?.start)
  if (ms > 0) return ms / 60000
  return (w?.entries || []).flatMap(e => e?.sets || []).filter(x => x?.done !== false).reduce((a, x) => a + (Number(x.min) || 0), 0)
}

/** One run's load: { load, estimated }. `prof` from hrProfile, or null. */
export function runLoad(w, prof) {
  const hrs = w?.details?.hrs
  if (prof && hrs && Object.keys(hrs).length) {
    let load = 0
    for (const [band, sec] of Object.entries(hrs)) {
      const x = Math.min(1, Math.max(0, (Number(band) + 2.5 - prof.rest) / (prof.max - prof.rest)))
      load += (sec / 60) * trimpAt(x)
    }
    return { load: Math.round(load), estimated: false }
  }
  return { load: Math.round(minutesOf(w) * trimpAt(GUESS_HRR)), estimated: true }
}

/**
 * Acute (the last 7 days) against chronic (the weekly average of the last 28) load, and how they
 * read: { acute, chronic, ratio, reading } with reading one of 'easing' (under 0.8), 'steady'
 * (up to 1.3), 'building' (up to 1.5), 'fast' (over it, where running injuries cluster), or
 * 'start' while the log holds under four weeks of running to compare with. Null without runs in the 28 days.
 */
export function loadSummary(S, now = Date.now()) {
  const prof = hrProfile(S, now)
  let acute = 0, chronic = 0, any = false
  for (const w of runsOf(S?.workouts)) {
    const at = Number(w.start) || new Date(w.d + 'T12:00:00').getTime()
    const age = now - at
    if (age < 0 || age >= CHRONIC_DAYS * DAY) continue
    const { load } = runLoad(w, prof)
    any = true
    chronic += load
    if (age < ACUTE_DAYS * DAY) acute += load
  }
  if (!any) return null
  chronic = Math.round(chronic / (CHRONIC_DAYS / 7))
  const ratio = chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null
  // Under four weeks of running in the log, the weekly average is not what the body is used to
  // yet: every first week would read as a jump.
  const first = runsOf(S?.workouts)[0]
  const young = now - (Number(first?.start) || now) < CHRONIC_DAYS * DAY
  const reading = ratio == null || young ? 'start' : ratio < 0.8 ? 'easing' : ratio <= 1.3 ? 'steady' : ratio <= 1.5 ? 'building' : 'fast'
  return { acute, chronic, ratio, reading }
}

/** Load and km per week, the last `weeks` weeks oldest first: [{ from: iso, load, km }]. */
export function weeklyLoad(S, weeks = 12, now = Date.now()) {
  const prof = hrProfile(S, now)
  const ws = weekStartOf(S)
  const start = new Date(now)
  start.setHours(12, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() - ws + 7) % 7) - 7 * (weeks - 1))
  const out = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + 7 * i)
    return { from: isoOf(d), load: 0, km: 0 }
  })
  for (const w of runsOf(S?.workouts)) {
    let i = -1
    for (let k = out.length - 1; k >= 0; k--) if (w.d >= out[k].from) { i = k; break }
    if (i < 0 || w.d > isoOf(new Date(now))) continue
    out[i].load += runLoad(w, prof).load
    out[i].km = Math.round((out[i].km + kmLogged(w)) * 10) / 10
  }
  return out
}
