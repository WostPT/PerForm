// PerForm: the running module. Personal bests and heart-rate zones, worked out from what each run
// keeps in `details` (lib/perform-run-details.js: its best efforts and seconds per 5-bpm band), so
// nothing here reads Health Connect and it all shows on the desktop as well.
//
//   S.running = { maxHr }   // a maximum heart rate the user typed; none: the highest seen in runs
import { BEST_M, bestKey } from './perform-run-details.js'
import { isoOf } from './format.js'

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
