import { describe, expect, it } from 'vitest'
import { applyWatchWorkouts, watchGlyph, watchRowParts, watchWorkoutId, WATCH_SRC } from './perform-watch-workouts.js'
import { mergeReading } from './perform-health.js'
import { sessionRecord } from './health-connect.js'

// PerForm: the watch's workouts becoming workouts in the log.
const at = (iso, hh, mm = 0) => new Date(`${iso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).getTime()
const NOW = at('2026-10-21', 18)
// The 7:00 run of 21 October: 34:13, 4.87 km.
const RUN = { id: 'r1', d: '2026-10-21', start: at('2026-10-21', 7), end: at('2026-10-21', 7, 34) + 13000, type: 'running', hrAvg: 155, hrMax: 178, steps: 5400, km: 4.87 }
const state = (sessions, extra = {}) => ({
  unit: 'kg', workouts: [], customEx: [], routines: [], week: {}, dayPlan: {},
  health: { days: {}, sleep: [], sessions, weights: [], imported: [] }, ...extra,
})

describe('a watch run', () => {
  it('becomes a workout with the library run in it, one cardio set from the watch', () => {
    const s = state([RUN])
    const { added } = applyWatchWorkouts(s, NOW)
    expect(added).toHaveLength(1)
    const [w] = s.workouts
    expect(w).toMatchObject({
      id: watchWorkoutId('r1'), d: '2026-10-21', start: RUN.start, end: RUN.end, name: 'Run',
      src: WATCH_SRC, routineIds: [], watch: { km: 4.87, hrAvg: 155, hrMax: 178, steps: 5400 },
    })
    expect(w.entries).toEqual([{ id: '0685', topW: null, sets: [{ min: 34.2, speed: 8.5, done: true, at: RUN.end, src: 'watch' }] }])
    expect(s.health.imported).toEqual(['r1'])
  })

  it('keeps the name the watch gave it', () => {
    const s = state([{ ...RUN, title: 'Morning run' }])
    applyWatchWorkouts(s, NOW)
    expect(s.workouts[0].name).toBe('Morning run')
  })

  it('is made once, and stays deleted once deleted', () => {
    const s = state([RUN])
    applyWatchWorkouts(s, NOW)
    applyWatchWorkouts(s, NOW)
    expect(s.workouts).toHaveLength(1)
    s.workouts = []
    applyWatchWorkouts(s, NOW)
    expect(s.workouts).toEqual([])
  })

  it('keeps its id through the next reading, which drops only ids gone from the log', () => {
    const s = state([RUN])
    applyWatchWorkouts(s, NOW)
    const raw = { id: 'r1', start: RUN.start, end: RUN.end, type: 56, m: 4870 }
    const next = mergeReading(s.health, { sessions: [raw] }, { since: NOW - 3 * 86400000, until: NOW, now: NOW })
    expect(next.imported).toEqual(['r1'])
  })

  it('goes into the log in its place, by day and start', () => {
    const s = state([RUN], {
      workouts: [
        { id: 'a', d: '2026-10-20', start: at('2026-10-20', 18), end: at('2026-10-20', 19), entries: [] },
        { id: 'b', d: '2026-10-21', start: at('2026-10-21', 18), end: at('2026-10-21', 19), entries: [] },
      ],
    })
    applyWatchWorkouts(s, NOW)
    expect(s.workouts.map(w => w.id)).toEqual(['a', watchWorkoutId('r1'), 'b'])
  })

  it('is never written back to Health Connect', () => {
    const s = state([RUN])
    applyWatchWorkouts(s, NOW)
    expect(sessionRecord(s.workouts[0], { unit: 'kg', nameOf: () => '', speedUnit: 'kmh' })).toBeNull()
  })
})

describe('a session logged in the app as well', () => {
  const gym = () => ({ id: 'g1', d: '2026-10-21', start: at('2026-10-21', 17), end: at('2026-10-21', 18), name: 'Push', entries: [] })

  it('adds its heart rate to that workout instead of making a second one', () => {
    const s = state([{ ...RUN, id: 'x', type: 'running_treadmill', start: at('2026-10-21', 17, 5), end: at('2026-10-21', 17, 15) }], { workouts: [gym()] })
    const { added, linked } = applyWatchWorkouts(s, NOW)
    expect(added).toEqual([])
    expect(linked.map(w => w.id)).toEqual(['g1'])
    expect(s.workouts).toHaveLength(1)
    expect(s.workouts[0].watch).toEqual({ hrAvg: 155, hrMax: 178 })
    expect(s.health.imported).toEqual(['x'])
  })

  it('waits while a workout is going on in the app', () => {
    const s = state([{ ...RUN, start: NOW - 30 * 60000, end: NOW - 60000 }], { active: { start: NOW - 40 * 60000 } })
    applyWatchWorkouts(s, NOW)
    expect(s.workouts).toEqual([])
    expect(s.health.imported).toEqual([])
  })
})

describe('a strength session from the watch', () => {
  const lift = { id: 'l1', d: '2026-10-21', start: at('2026-10-21', 17), end: at('2026-10-21', 18), type: 'strength_training', hrAvg: 120, hrMax: 160 }

  it('makes no workout of its own, and is looked at again once one is logged', () => {
    const s = state([lift])
    applyWatchWorkouts(s, NOW)
    expect(s.workouts).toEqual([])
    expect(s.health.imported).toEqual([])
    s.workouts.push({ id: 'g1', d: '2026-10-21', start: at('2026-10-21', 17, 2), end: at('2026-10-21', 17, 58), entries: [] })
    applyWatchWorkouts(s, NOW)
    expect(s.workouts[0].watch).toEqual({ hrAvg: 120, hrMax: 160 })
  })
})

describe('a type the library has no exercise for', () => {
  it('gets an exercise of its own, made once', () => {
    const hike = { id: 'h1', d: '2026-10-19', start: at('2026-10-19', 9), end: at('2026-10-19', 12), type: 'hiking', km: 11 }
    const s = state([hike, { ...hike, id: 'h2', d: '2026-10-20', start: at('2026-10-20', 9), end: at('2026-10-20', 11) }])
    applyWatchWorkouts(s, NOW)
    expect(s.customEx).toEqual([expect.objectContaining({ id: 'hcx-hiking', n: 'hiking', bp: 'cardio', custom: true })])
    expect(s.workouts.map(w => [w.name, w.entries[0].id])).toEqual([['Hike', 'hcx-hiking'], ['Hike', 'hcx-hiking']])
  })
})

describe('the day plan', () => {
  const routine = { id: 'rt', name: 'Easy run', ex: [{ id: '0685', sets: 1, min: 30 }] }
  // 21 October 2026 is a Wednesday.
  const planned = extra => state([RUN], { routines: [routine], week: { 3: ['rt'] }, ...extra })

  it('a run fills the routine planned for its day that has a run in it', () => {
    const s = planned()
    applyWatchWorkouts(s, NOW)
    expect(s.workouts[0]).toMatchObject({ routineIds: ['rt'], routineId: 'rt' })
    expect(s.workouts[0].entries[0].rid).toBe('rt')
  })

  it('not a routine without that exercise, nor one already done that day', () => {
    const other = planned({ routines: [{ ...routine, ex: [{ id: '0025' }] }] })
    applyWatchWorkouts(other, NOW)
    expect(other.workouts[0].routineIds).toEqual([])
    const done = planned({ workouts: [{ id: 'g', d: '2026-10-21', start: at('2026-10-21', 6), end: at('2026-10-21', 6, 30), routineIds: ['rt'], entries: [] }] })
    applyWatchWorkouts(done, NOW)
    expect(done.workouts.find(w => w.src).routineIds).toEqual([])
  })

  it('not for a session from weeks ago', () => {
    const s = planned()
    applyWatchWorkouts(s, at('2026-11-18', 18))
    expect(s.workouts[0].routineIds).toEqual([])
  })
})

describe('History', () => {
  it('shows the distance and a runner, a bike for a ride', () => {
    const s = state([RUN, { ...RUN, id: 'b1', type: 'biking', km: 20.456 }])
    applyWatchWorkouts(s, NOW)
    expect(s.workouts.map(watchRowParts)).toEqual([['4.87 km'], ['20.46 km']])
    expect(s.workouts.map(watchGlyph)).toEqual(['figureRun', 'bike'])
    expect(watchRowParts({ id: 'w', entries: [] })).toBeNull()
  })
})
