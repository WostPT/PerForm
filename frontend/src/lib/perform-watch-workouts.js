// PerForm: the watch's workouts as workouts in the log. A run the watch recorded is a run: it
// lands in History and on the calendar as a workout with the library's "run" in it, one cardio
// set (minutes, and the speed the distance gives), and counts for stats and progress like one
// typed in the app. What the watch knows besides (distance, heart rate, steps) rides along as
// `watch`; the set says where it came from (`src: 'watch'`), as a set from the rep band will.
//
// Worked out from S.health alone (lib/perform-health.js), on the phone that reads Health Connect,
// right after each reading (lib/perform-health-read.js):
//   - one workout per watch session, never twice: the session's id goes into S.health.imported,
//     so a workout deleted from History stays deleted;
//   - a session that overlaps a workout logged in the app adds its heart rate to that workout
//     instead of making a second one (the watch set to "Weights" at the gym);
//   - only sessions the library has an exercise for become workouts. A strength session from the
//     watch knows no exercises or sets, so it only ever lends its heart rate;
//   - a session from the last few days fills the day's plan when a routine planned for it has
//     the same exercise, so the run you had planned for today reads as done.
// lib/health-connect.js leaves these workouts out of what it writes, since they came from there.
import { healthOf } from './perform-health.js'
import { effectiveRoutineIds } from './history.js'
import { isoOf } from './format.js'

const DAY = 86400000
export const WATCH_SRC = 'health-connect'
// A session older than this is history: it is logged, but no longer fills a planned day.
export const CREDIT_DAYS = 7

// The watch's type (lib/perform-health.js EXERCISE_TYPES) → the library's exercise for it.
export const WATCH_EXERCISES = {
  running: '0685',               // run
  running_treadmill: '2197',     // run on treadmill
  walking: '2258',               // walking
  biking: '5214',                // riding outdoor bicycle
  biking_stationary: '2138',     // stationary bike
  elliptical: '2141',            // walk elliptical cross trainer
  rowing_machine: '1161',        // rowing (with rowing machine)
  stair_climbing_machine: '2311', // walking on stepmill
}
// Types the library has nothing for: an exercise of the user's own, made once and then reused.
// They can rename it or change its muscles like any custom exercise.
export const WATCH_CUSTOM = {
  hiking: { n: 'hiking', sm: ['quadriceps', 'glutes', 'calves'] },
  rowing: { n: 'rowing (outdoor)', sm: ['lats', 'biceps', 'quadriceps'] },
  stair_climbing: { n: 'stair climbing', sm: ['quadriceps', 'glutes', 'calves'] },
  swimming_pool: { n: 'pool swim', sm: ['lats', 'shoulders', 'triceps'] },
  swimming_open_water: { n: 'open water swim', sm: ['lats', 'shoulders', 'triceps'] },
  hiit: { n: 'hiit', sm: ['quadriceps', 'glutes', 'abs'] },
  soccer: { n: 'football', sm: ['quadriceps', 'hamstrings', 'calves'] },
  tennis: { n: 'tennis', sm: ['shoulders', 'forearms', 'quadriceps'] },
  squash: { n: 'squash', sm: ['shoulders', 'forearms', 'quadriceps'] },
}
// The workout's name when the watch gave the session none.
const NAMES = {
  running: 'Run', running_treadmill: 'Treadmill run', walking: 'Walk', biking: 'Ride',
  biking_stationary: 'Indoor ride', elliptical: 'Elliptical', rowing_machine: 'Rowing machine',
  stair_climbing_machine: 'Stair climber', hiking: 'Hike', rowing: 'Rowing',
  stair_climbing: 'Stairs', swimming_pool: 'Pool swim', swimming_open_water: 'Open water swim',
  hiit: 'HIIT', soccer: 'Football', tennis: 'Tennis', squash: 'Squash',
}
const GLYPHS = { biking: 'bike', biking_stationary: 'bike', swimming_pool: 'swim', swimming_open_water: 'swim' }

export const watchWorkoutId = sessionId => 'hc-' + sessionId
export const customIdFor = type => 'hcx-' + type
export const isWatchWorkout = w => w?.src === WATCH_SRC

/** The exercise a session of this type is logged as, or null when it only lends its heart rate. */
export function exerciseFor(type) {
  if (WATCH_EXERCISES[type]) return WATCH_EXERCISES[type]
  if (WATCH_CUSTOM[type]) return customIdFor(type)
  return null
}

function customExercise(type) {
  const c = WATCH_CUSTOM[type]
  return {
    id: customIdFor(type), n: c.n, bp: 'cardio', eq: 'body weight', tg: 'cardiovascular system',
    mg: c.sm[0], sm: c.sm.slice(1), desc: '', custom: true,
  }
}

const overlaps = (w, s) => {
  const start = Number(w?.start), end = Number(w?.end) > start ? Number(w.end) : start
  return start > 0 && start < s.end && end > s.start
}
const routineIdsOf = w => (Array.isArray(w?.routineIds) ? w.routineIds : (w?.routineId ? [w.routineId] : []))

// The routine planned for the session's day that has its exercise in it and is not done yet.
function plannedRoutine(s, sess, exId, today) {
  const plan = { ...s, routines: s.routines || [], week: s.week || {}, dayPlan: s.dayPlan || {} }
  let ids
  try { ids = effectiveRoutineIds(plan, sess.d, today) } catch { return null }
  const done = new Set((s.workouts || []).filter(w => w?.d === sess.d).flatMap(routineIdsOf))
  return ids.find(id => !done.has(id) && (plan.routines.find(r => r.id === id)?.ex || []).some(e => e?.id === exId)) || null
}

/** One workout for one watch session, its exercise being `exId`. */
export function workoutFromSession(sess, exId, rid = null) {
  const min = Math.round((sess.end - sess.start) / 6000) / 10
  const set = { min, done: true, at: sess.end, src: 'watch' }
  if (sess.km > 0 && min > 0) set.speed = Math.round(sess.km / (min / 60) * 10) / 10
  const watch = {}
  for (const k of ['km', 'hrAvg', 'hrMax', 'steps']) if (sess[k] > 0) watch[k] = sess[k]
  return {
    id: watchWorkoutId(sess.id), d: sess.d, start: sess.start, end: sess.end,
    routineIds: rid ? [rid] : [], routineId: rid,
    name: sess.title || NAMES[sess.type] || 'Workout',
    entries: [{ id: exId, sets: [set], topW: null, ...(rid ? { rid } : {}) }],
    prs: [], vol: 0, src: WATCH_SRC, watch,
  }
}

// Into the log in its place: by day, then by start, as History and the stats read it.
function insertWorkout(list, w) {
  const i = list.findIndex(x => x && (x.d > w.d || (x.d === w.d && Number(x.start) > w.start)))
  if (i < 0) list.push(w)
  else list.splice(i, 0, w)
}

/**
 * Turns the watch sessions in S.health that are not in the log yet into workouts, in `s` itself
 * (a draft, inside the store's update). Returns { added, linked }: the workouts made, and the
 * ones logged in the app that got the watch's heart rate.
 */
export function applyWatchWorkouts(s, now = Date.now()) {
  const h = healthOf(s)
  if (!h.sessions.length) return { added: [], linked: [] }
  s.workouts = Array.isArray(s.workouts) ? s.workouts : []
  const done = new Set(h.imported)
  const today = isoOf(new Date(now))
  const creditFrom = isoOf(new Date(now - CREDIT_DAYS * DAY))
  const added = [], linked = [], took = []
  for (const sess of h.sessions) {
    if (!sess?.id || done.has(sess.id)) continue
    // A session still going on in the app: whether it is the same one is decided once it is finished.
    if (s.active && overlaps({ start: s.active.start, end: now }, sess)) continue
    const own = s.workouts.find(w => !isWatchWorkout(w) && overlaps(w, sess))
    if (own) {
      if (!own.watch && (sess.hrAvg || sess.hrMax)) {
        own.watch = {}
        for (const k of ['hrAvg', 'hrMax']) if (sess[k] > 0) own.watch[k] = sess[k]
        linked.push(own)
      }
      took.push(sess.id)
      continue
    }
    const exId = exerciseFor(sess.type)
    // A strength session with nothing logged to lend its heart rate to (yet: the workout may be
    // logged later, as a past workout) stays out of the list, and is looked at again next time.
    if (!exId) continue
    if (s.workouts.some(w => w?.id === watchWorkoutId(sess.id))) { took.push(sess.id); continue }
    if (WATCH_CUSTOM[sess.type]) {
      s.customEx = Array.isArray(s.customEx) ? s.customEx : []
      if (!s.customEx.some(c => c?.id === exId)) s.customEx.push(customExercise(sess.type))
    }
    const rid = sess.d >= creditFrom ? plannedRoutine(s, sess, exId, today) : null
    const w = workoutFromSession(sess, exId, rid)
    insertWorkout(s.workouts, w)
    added.push(w)
    took.push(sess.id)
  }
  if (took.length) s.health = { ...h, imported: [...h.imported, ...took] }
  return { added, linked }
}

/** What History shows under a watch workout in place of sets and volume: its distance. */
export function watchRowParts(w) {
  if (!isWatchWorkout(w)) return null
  return w.watch?.km > 0 ? [`${Math.round(w.watch.km * 100) / 100} km`] : []
}
/** History's icon for a watch workout: a bike for a ride, a swimmer for a swim, a runner otherwise. */
export function watchGlyph(w) {
  if (!isWatchWorkout(w)) return null
  const type = Object.keys(WATCH_EXERCISES).find(k => WATCH_EXERCISES[k] === w.entries?.[0]?.id) ||
    Object.keys(WATCH_CUSTOM).find(k => customIdFor(k) === w.entries?.[0]?.id)
  return GLYPHS[type] || 'figureRun'
}
