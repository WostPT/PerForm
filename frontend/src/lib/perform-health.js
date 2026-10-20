// PerForm: what the phone reads back from Health Connect (HealthReadPlugin.java), folded into the
// log. A Fitbit Versa 4 reaches Health Connect through the Fitbit app; any other watch or scale
// that writes there comes through the same way. Nothing here talks to the phone:
// lib/perform-health-read.js fetches a reading and hands it to these helpers.
//
// The data lives in S.health, so it syncs to the server like the rest of the log and the desktop,
// the charts and the Coach all see it. Only the phone that has it turned on ever writes it.
//
//   S.health = {
//     days:     { [iso]: { steps, hrMin, hrAvg, hrMax, rhr, hrv } },   // per local calendar day
//     sleep:    [{ id, d, start, end, asleep, deep, light, rem, awake, src }],   // minutes; d = the day woken up on
//     sessions: [{ id, d, start, end, type, title, hrAvg, hrMax, steps, km, src }],   // workouts recorded on the watch
//     weights:  [{ id, d, time, kg, src }],   // weigh-ins, with the time they were taken
//     imported: [id],   // weigh-ins already copied into S.bodyweight, so a deleted one stays deleted
//   }
import { isoOf } from './format.js'

const DAY = 86400000
const LB_PER_KG = 2.2046226218
// About a year and a month: enough for a year-on-year look without the log growing for ever.
export const HEALTH_KEEP_DAYS = 400
// A reading goes back this far over the last one: the watch syncs to the Fitbit app, and that to
// Health Connect, hours or days late (a watch left off the phone over a weekend).
export const REREAD_DAYS = 3
// Health Connect hands out only this many days from before the first permission was granted,
// unless the history permission was granted too.
export const FIRST_READ_DAYS = 30
export const HISTORY_READ_DAYS = 365

// SleepSessionRecord.STAGE_TYPE_*. Awake in bed counts as awake; out of bed and an unknown stage
// count as neither asleep nor awake.
const STAGE = { 1: 'awake', 2: 'asleep', 4: 'light', 5: 'deep', 6: 'rem', 7: 'awake' }

// ExerciseSessionRecord.EXERCISE_TYPE_*: the ones a watch is likely to record, by name. The rest
// keep their number in the log and show as "Workout".
export const EXERCISE_TYPES = {
  0: 'other', 8: 'biking', 9: 'biking_stationary', 25: 'elliptical', 36: 'hiit', 37: 'hiking',
  48: 'pilates', 53: 'rowing', 54: 'rowing_machine', 56: 'running', 57: 'running_treadmill',
  64: 'soccer', 66: 'squash', 68: 'stair_climbing', 69: 'stair_climbing_machine',
  70: 'strength_training', 71: 'stretching', 73: 'swimming_open_water', 74: 'swimming_pool',
  76: 'tennis', 79: 'walking', 81: 'weightlifting', 83: 'yoga',
}
export const exerciseTypeName = n => EXERCISE_TYPES[n] || (Number.isFinite(Number(n)) ? 'other' : String(n || 'other'))

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const minutes = ms => Math.round(ms / 60000)
const isoAt = ms => isoOf(new Date(ms))
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

/** An empty S.health, also what an older profile without one reads as. */
export function emptyHealth() {
  return { days: {}, sleep: [], sessions: [], weights: [], imported: [] }
}
export function healthOf(S) {
  const h = S?.health
  if (!isMap(h)) return emptyHealth()
  return {
    days: isMap(h.days) ? h.days : {},
    sleep: Array.isArray(h.sleep) ? h.sleep : [],
    sessions: Array.isArray(h.sessions) ? h.sessions : [],
    weights: Array.isArray(h.weights) ? h.weights : [],
    imported: Array.isArray(h.imported) ? h.imported : [],
  }
}

/**
 * One night as the log keeps it: minutes asleep, in each stage and awake. Without stages (a
 * sleep logged by hand in some app) the whole session counts as asleep. Filed under the day it
 * ended on, which is the night most people mean by "last night"; a nap files under its own day.
 */
export function summarizeSleep(rec) {
  const start = num(rec?.start), end = num(rec?.end)
  if (!rec?.id || start == null || end == null || !(end > start)) return null
  const ms = { asleep: 0, light: 0, deep: 0, rem: 0, awake: 0 }
  for (const st of Array.isArray(rec.stages) ? rec.stages : []) {
    const k = STAGE[st?.k]
    const s = num(st?.s), e = num(st?.e)
    if (!k || s == null || e == null || !(e > s)) continue
    ms[k] += e - s
  }
  const staged = ms.light + ms.deep + ms.rem + ms.asleep
  const out = {
    id: String(rec.id), d: isoAt(end), start, end,
    asleep: minutes(staged || (ms.awake ? 0 : end - start)),
    deep: minutes(ms.deep), light: minutes(ms.light), rem: minutes(ms.rem), awake: minutes(ms.awake),
  }
  if (rec.src) out.src = String(rec.src)
  return out
}

/** A workout the watch recorded, as the log keeps it. */
export function summarizeSession(rec) {
  const start = num(rec?.start), end = num(rec?.end)
  if (!rec?.id || start == null || end == null || !(end > start)) return null
  const out = { id: String(rec.id), d: isoAt(start), start, end, type: exerciseTypeName(rec.type) }
  if (rec.title) out.title = String(rec.title).slice(0, 200)
  for (const k of ['hrAvg', 'hrMax', 'steps']) if (num(rec[k]) != null && rec[k] > 0) out[k] = Math.round(rec[k])
  if (num(rec.m) != null && rec.m > 0) out.km = Math.round(rec.m / 10) / 100
  if (rec.src) out.src = String(rec.src)
  return out
}

/** A weigh-in, with the time it was taken. */
export function summarizeWeight(rec) {
  const time = num(rec?.time), kg = num(rec?.kg)
  if (!rec?.id || time == null || !(kg > 0)) return null
  const out = { id: String(rec.id), d: isoAt(time), time, kg: Math.round(kg * 1000) / 1000 }
  if (rec.src) out.src = String(rec.src)
  return out
}

// One day's summed values, with only what is there: a day with steps and no heart rate keeps no
// empty heart-rate fields.
function dayOf(row) {
  const out = {}
  for (const k of ['steps', 'hrMin', 'hrAvg', 'hrMax', 'rhr']) if (num(row?.[k]) != null && row[k] > 0) out[k] = Math.round(row[k])
  return out
}

/**
 * What to ask Health Connect for: from REREAD_DAYS before the last reading, or as far back as it
 * lets an app read on the first one. `lastAt` is when this phone last read (0 for never).
 */
export function readWindow(lastAt, { history = false, now = Date.now() } = {}) {
  const first = now - (history ? HISTORY_READ_DAYS : FIRST_READ_DAYS) * DAY
  const since = lastAt > 0 ? Math.max(lastAt - REREAD_DAYS * DAY, now - HEALTH_KEEP_DAYS * DAY) : first
  return { since: Math.floor(since), until: Math.floor(now) }
}

const byStart = (a, b) => (a.start ?? a.time) - (b.start ?? b.time)

// The records a reading covers replace the stored ones in its window: one the watch deleted or
// corrected there is gone or corrected here too. Outside the window the stored ones stay.
function replaceIn(prev, fresh, since, until, at) {
  const ids = new Set(fresh.map(x => x.id))
  const kept = prev.filter(x => {
    if (!x || ids.has(x.id)) return false
    const t = at(x)
    return !(t >= since && t < until)
  })
  return [...kept, ...fresh].sort(byStart)
}

/**
 * S.health after a reading of [since, until): `reading` is what HealthReadPlugin.read returned.
 * Days, sleep, workouts and weigh-ins in that window are taken from the reading; everything older
 * than HEALTH_KEEP_DAYS is let go. Returns a new object; `prev` is left as it is.
 */
export function mergeReading(prev, reading, { since, until, now = Date.now() }) {
  const h = healthOf({ health: prev })
  const r = isMap(reading) ? reading : {}
  const cut = isoAt(now - HEALTH_KEEP_DAYS * DAY)

  // Days: whole local days from the one `since` falls on, as the plugin sums them.
  const fromIso = isoAt(since), toIso = isoAt(until)
  const fresh = {}
  for (const row of Array.isArray(r.days) ? r.days : []) {
    if (!row?.d) continue
    const d = dayOf(row)
    if (Object.keys(d).length) fresh[row.d] = d
  }
  // HRV: a watch writes one or a few readings a night; the day keeps their mean.
  const hrv = {}
  for (const x of Array.isArray(r.hrv) ? r.hrv : []) {
    const t = num(x?.time), ms = num(x?.ms)
    if (t == null || !(ms > 0)) continue
    const d = isoAt(t);
    (hrv[d] || (hrv[d] = [])).push(ms)
  }
  for (const [d, list] of Object.entries(hrv)) {
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    (fresh[d] || (fresh[d] = {})).hrv = Math.round(mean * 10) / 10
  }
  const days = {}
  for (const [d, v] of Object.entries(h.days)) {
    if (d < cut) continue
    if (d >= fromIso && d <= toIso) continue
    days[d] = v
  }
  for (const [d, v] of Object.entries(fresh)) if (d >= cut) days[d] = v

  const keep = list => list.filter(x => x.d >= cut)
  const sleep = replaceIn(h.sleep, (r.sleep || []).map(summarizeSleep).filter(Boolean), since, until, x => x.start)
  const sessions = replaceIn(h.sessions, (r.sessions || []).map(summarizeSession).filter(Boolean), since, until, x => x.start)
  const weights = replaceIn(h.weights, (r.weights || []).map(summarizeWeight).filter(Boolean), since, until, x => x.time)

  const out = {
    days: Object.fromEntries(Object.entries(days).sort(([a], [b]) => (a < b ? -1 : 1))),
    sleep: keep(sleep), sessions: keep(sessions), weights: keep(weights),
    imported: h.imported,
  }
  // Ids of weigh-ins that left the log are of no more use.
  const live = new Set(out.weights.map(w => w.id))
  out.imported = h.imported.filter(id => live.has(id))
  return out
}

/**
 * The scale's weigh-ins that belong in the weight log: one per day that has none there yet (a
 * weigh-in typed in the app always wins), the last one taken that day, never one copied before
 * (deleting it from the log keeps it deleted). Returns { add: [bodyweight entries], ids }.
 * The entries carry `at`, when it was taken, and `src`: the Health Connect write leaves them out,
 * since they came from there.
 */
export function weighInsToAdd(health, bodyweight, unit, now = Date.now()) {
  const h = healthOf({ health })
  const have = new Set((Array.isArray(bodyweight) ? bodyweight : []).map(b => b?.d))
  const done = new Set(h.imported)
  const last = {}
  for (const w of h.weights) {
    if (done.has(w.id) || have.has(w.d)) continue
    if (!last[w.d] || w.time > last[w.d].time) last[w.d] = w
  }
  const add = Object.values(last).sort((a, b) => a.time - b.time).map(w => ({
    d: w.d,
    w: Math.round((unit === 'lb' ? w.kg * LB_PER_KG : w.kg) * 10) / 10,
    t: now, at: w.time, src: 'health-connect',
  }))
  return { add, ids: Object.values(last).map(w => w.id) }
}

/** The main sleep of each day: the longest one woken up from that day (a nap does not replace a night). */
export function nightsByDay(health) {
  const out = {}
  for (const s of healthOf({ health }).sleep) {
    const cur = out[s.d]
    if (!cur || s.end - s.start > cur.end - cur.start) out[s.d] = s
  }
  return out
}

/**
 * A metric as LineChart points, one per day over the last `range` days (0 for all):
 * 'sleep' (hours asleep), 'rhr', 'hrv', 'steps'.
 */
export function healthSeries(health, metric, range = 0, now = Date.now()) {
  const h = healthOf({ health })
  const from = range ? isoAt(now - range * DAY) : ''
  const pts = []
  if (metric === 'sleep') {
    for (const [d, s] of Object.entries(nightsByDay(h))) {
      if (d < from || !(s.asleep > 0)) continue
      pts.push({ t: new Date(d + 'T12:00:00').getTime(), d, y: Math.round(s.asleep / 6) / 10 })
    }
  } else {
    for (const [d, v] of Object.entries(h.days)) {
      if (d < from || num(v?.[metric]) == null) continue
      pts.push({ t: new Date(d + 'T12:00:00').getTime(), d, y: v[metric] })
    }
  }
  return pts.sort((a, b) => a.t - b.t)
}

/** The mean of a metric over the `n` days up to and including `iso`, or null with no data. */
export function healthAverage(health, metric, iso, n = 7) {
  const end = new Date(iso + 'T12:00:00').getTime()
  const pts = healthSeries(health, metric, 0).filter(p => p.t <= end && p.t > end - n * DAY)
  if (!pts.length) return null
  return Math.round(pts.reduce((a, p) => a + p.y, 0) / pts.length * 10) / 10
}
