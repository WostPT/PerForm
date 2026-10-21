import { describe, expect, it } from 'vitest'
import { fmtTime, hrProfile, isOutdoorRun, isRun, pbsOf, restingHr, runPbs, seenMaxHr, zonesOver, zoneTimes } from './perform-running.js'

// PerForm: personal bests and heart-rate zones from the runs' details.
const at = (iso, hh = 7) => new Date(`${iso}T${String(hh).padStart(2, '0')}:00:00`).getTime()
const NOW = at('2026-10-21', 20)
const run = (id, d, { best, km = 5, hrMax = 180, hrs, ex = '0685' } = {}) => ({
  id, d, start: at(d), end: at(d) + 1800000, src: 'health-connect',
  entries: [{ id: ex, sets: [{ min: 30, done: true }] }],
  watch: { km, hrMax }, details: { v: 4, km, ...(best ? { best } : {}), ...(hrs ? { hrs } : {}) },
})

describe('what counts as a run', () => {
  it('a run outdoors or on a treadmill, from the watch or typed in; PBs only outdoors', () => {
    expect(isRun(run('a', '2026-10-01'))).toBe(true)
    expect(isRun(run('b', '2026-10-01', { ex: '2197' }))).toBe(true)
    expect(isOutdoorRun(run('b', '2026-10-01', { ex: '2197' }))).toBe(false)
    expect(isRun({ id: 'c', entries: [{ id: '0025' }] })).toBe(false)
    expect(isRun({ id: 'walk', entries: [{ id: '2258' }] })).toBe(false)
  })
})

describe('personal bests', () => {
  const log = [
    run('r1', '2026-09-01', { best: { 1000: 420, 5000: 2200 }, km: 5.1 }),
    run('r2', '2026-09-10', { best: { 1000: 400 }, km: 3 }),
    run('r3', '2026-09-20', { best: { 1000: 410, 5000: 2150, 10000: 4600 }, km: 10.2 }),
    run('t1', '2026-09-25', { best: { 1000: 300 }, km: 12, ex: '2197' }),
    { id: 'g', d: '2026-09-26', start: at('2026-09-26'), entries: [{ id: '0025' }] },
  ]

  it('the fastest time at each distance and the longest run, with the run that set it', () => {
    const { bests } = runPbs(log)
    expect(bests['1000']).toMatchObject({ sec: 400, w: { id: 'r2' } })
    expect(bests['5000']).toMatchObject({ sec: 2150, w: { id: 'r3' } })
    expect(bests['10000']).toMatchObject({ sec: 4600, w: { id: 'r3' } })
    expect(bests.longest).toMatchObject({ km: 10.2, w: { id: 'r3' } })
  })

  it('each run knows which PBs it set when it was run', () => {
    expect(pbsOf(log, log[0])).toEqual(['1000', '5000', 'longest'])
    expect(pbsOf(log, log[1])).toEqual(['1000'])
    expect(pbsOf(log, log[2])).toEqual(['5000', '10000', 'longest'])
  })

  it('a treadmill run sets none: its distance is the treadmill\'s guess', () => {
    expect(pbsOf(log, log[3])).toEqual([])
    expect(runPbs(log).bests['1000'].sec).toBe(400)
  })

  it('a tie keeps the older run', () => {
    const tie = [run('a', '2026-09-01', { best: { 1000: 400 } }), run('b', '2026-09-02', { best: { 1000: 400 } })]
    expect(runPbs(tie).bests['1000'].w.id).toBe('a')
    expect(pbsOf(tie, tie[1])).toEqual([])
  })
})

describe('heart-rate zones', () => {
  const health = { days: { '2026-10-19': { rhr: 50 }, '2026-10-20': { rhr: 54 }, '2026-10-21': { rhr: 52 }, '2026-08-01': { rhr: 70 } } }

  it('maximum: the highest seen in a run over the last year, a misread over 220 left out', () => {
    const log = [run('a', '2026-10-01', { hrMax: 185 }), run('b', '2026-10-02', { hrMax: 231 }), run('c', '2025-06-01', { hrMax: 199 })]
    expect(seenMaxHr(log, NOW)).toBe(185)
    expect(seenMaxHr([], NOW)).toBeNull()
  })

  it('resting: the median of the last 30 days', () => {
    expect(restingHr(health, NOW)).toBe(52)
    expect(restingHr({ days: {} }, NOW)).toBeNull()
  })

  it('five zones from the heart-rate reserve; a typed maximum wins over the one seen', () => {
    const S = { workouts: [run('a', '2026-10-01', { hrMax: 182 })], health }
    // reserve 182 - 52 = 130: 50% → 117, 60% → 130, 70% → 143, 80% → 156, 90% → 169
    expect(hrProfile(S, NOW)).toEqual({ max: 182, maxTyped: false, rest: 52, bounds: [117, 130, 143, 156, 169] })
    expect(hrProfile({ ...S, running: { maxHr: 192 } }, NOW)).toMatchObject({ max: 192, maxTyped: true })
    expect(hrProfile({ ...S, health: { days: {} } }, NOW)).toBeNull()
  })

  it('a run\'s seconds per band go to the zone each band\'s middle falls in', () => {
    const bounds = [117, 130, 143, 156, 169]
    expect(zoneTimes({ 100: 60, 125: 120, 140: 300, 155: 600, 170: 30 }, bounds)).toEqual([180, 300, 0, 600, 30])
    expect(zoneTimes(null, bounds)).toEqual([0, 0, 0, 0, 0])
  })

  it('over the last 4 weeks', () => {
    const bounds = [117, 130, 143, 156, 169]
    const log = [run('old', '2026-09-01', { hrs: { 140: 999 } }), run('a', '2026-10-10', { hrs: { 140: 100 } }), run('b', '2026-10-20', { hrs: { 160: 50 } })]
    expect(zonesOver(log, bounds, 28, NOW)).toEqual([0, 100, 0, 50, 0])
  })
})

it('times as m:ss, h:mm:ss past the hour', () => {
  expect(fmtTime(1471)).toBe('24:31')
  expect(fmtTime(6727)).toBe('1:52:07')
})
