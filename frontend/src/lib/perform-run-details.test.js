import { describe, expect, it } from 'vitest'
import { bestEfforts, DETAILS_V, distanceTrack, hrBands, fmtPace, haversine, routePath, runDetails, withoutStops } from './perform-run-details.js'

// PerForm: a watch workout's samples worked down to splits, curves and a slimmed route.
const T0 = new Date('2026-10-21T07:00:00').getTime()
const MIN = 34
const T1 = T0 + MIN * 60000
const V = 2.4                      // m/s: 6:57 per km
const M_PER_DEG = 111194.93        // metres per degree of latitude (mean Earth radius)
// A run due north from Lisbon at an even pace, climbing a metre every 100 s, with a GPS fix every
// 5 s, a heart-rate sample every 5 s going from 140 to 174 bpm, and 165 steps a minute.
function rawRun({ route = true } = {}) {
  const pts = [], hr = [], steps = []
  for (let s = 0; s <= MIN * 60; s += 5) {
    const t = T0 + s * 1000
    pts.push([t, 38.7 + (V * s) / M_PER_DEG, -9.14, 50 + s / 100])
    hr.push([t, Math.round(140 + 34 * s / (MIN * 60))])
  }
  for (let m = 0; m < MIN; m++) steps.push([T0 + m * 60000, T0 + (m + 1) * 60000, 165])
  return { start: T0, end: T1, route: route ? pts : 'consent', hr, speed: [], dist: [], steps, elev: [] }
}
const W = { id: 'hc-r1', start: T0, end: T1, watch: { km: 4.9, hrAvg: 157 } }

describe('runDetails', () => {
  it('splits a run into whole km and the rest, each with its pace, heart rate, climb and cadence', () => {
    const d = runDetails(rawRun(), W)
    const totalM = V * MIN * 60   // 4896 m
    expect(d.km).toBeCloseTo(totalM / 1000, 1)
    expect(d.splits.map(x => x.km)).toEqual([1, 1, 1, 1, 0.9])
    // 1000 m at 2.4 m/s is 417 s.
    for (const x of d.splits.slice(0, 4)) expect(Math.abs(x.sec - 417)).toBeLessThanOrEqual(1)
    expect(d.splits[0].hr).toBeLessThan(d.splits[3].hr)
    expect(d.splits[0].elev).toBe(4)
    expect(d.splits[0].spm).toBe(165)
    expect(d.spm).toBe(165)
    expect(d.gain).toBeGreaterThanOrEqual(18)
    expect(d.gain).toBeLessThanOrEqual(21)
  })

  it('keeps curves of pace, heart rate and altitude, and a route of at most about 200 points', () => {
    const d = runDetails(rawRun(), W)
    expect(d.series.t).toHaveLength(60)
    expect(d.series.pace.every(p => Math.abs(p - 417) <= 2)).toBe(true)
    expect(d.series.hr[0]).toBeLessThan(d.series.hr[59])
    expect(d.series.alt[59]).toBeGreaterThan(d.series.alt[0])
    expect(d.route.length).toBeLessThanOrEqual(205)
    expect(d.route[0]).toEqual([38.7, -9.14])
    expect(JSON.stringify(d).length).toBeLessThan(8000)
  })

  it('without a route: the distance records give the splits, and the route waits for consent', () => {
    const raw = rawRun({ route: false })
    raw.dist = Array.from({ length: MIN }, (_, m) => [T0 + m * 60000, T0 + (m + 1) * 60000, V * 60])
    const d = runDetails(raw, W)
    expect(d.route).toBeNull()
    expect(d.routeConsent).toBe(true)
    expect(d.splits).toHaveLength(5)
    expect(Math.abs(d.splits[0].sec - 417)).toBeLessThanOrEqual(1)
    expect(d.series.alt).toBeUndefined()
  })

  it('with the route the user allowed, it is no longer waiting', () => {
    const raw = rawRun({ route: false })
    const d = runDetails(raw, W, rawRun().route)
    expect(d.routeConsent).toBeUndefined()
    expect(d.route.length).toBeGreaterThan(10)
  })

  it('from speed samples alone', () => {
    const raw = { start: T0, end: T1, route: 'none', speed: Array.from({ length: MIN * 6 + 1 }, (_, i) => [T0 + i * 10000, V]) }
    const d = runDetails(raw, W)
    expect(d.km).toBeCloseTo(4.9, 1)
    expect(d.series.pace[10]).toBe(417)
  })

  it('a walk shorter than a km is one split', () => {
    const raw = { start: T0, end: T0 + 600000, route: 'none', dist: [[T0, T0 + 600000, 800]] }
    expect(runDetails(raw, { ...W, end: T0 + 600000 }).splits).toEqual([{ km: 0.8, sec: 600 }])
  })

  it('a last stretch under 100 m is folded into the km before it', () => {
    const raw = { start: T0, end: T0 + 1250000, route: 'none', dist: [[T0, T0 + 1250000, 2050]] }
    expect(runDetails(raw, W).splits.map(x => x.km)).toEqual([1, 1.05])
  })

  it('nothing to show when Health Connect had nothing', () => {
    expect(runDetails({ start: T0, end: T1, route: 'none', hr: [], speed: [], dist: [], steps: [], elev: [] }, W)).toEqual({ v: DETAILS_V, none: true })
    expect(runDetails(null, {})).toEqual({ v: DETAILS_V, none: true })
  })

  it('the splits add up to the distance the watch gave, not the records summed', () => {
    // Health Connect's total for the 21 October run was 4.87 km; its records summed to 4.89.
    const raw = { start: T0, end: T1, route: 'none', dist: [[T0, T1, 4890]] }
    const d = runDetails(raw, { ...W, watch: { km: 4.87 } })
    expect(d.km).toBe(4.87)
    expect(d.splits.reduce((a, x) => a + x.km, 0)).toBeCloseTo(4.87, 2)
  })

  it('the seconds stood still before stopping the watch do not slow the last split', () => {
    // The 21 October run: running at an even pace, then about 30 s standing before the watch was
    // stopped. Counted as running, those 30 s made the last 0.89 km read 7:26 instead of ~6:57.
    const raw = rawRun()
    const last = raw.route[raw.route.length - 1]
    for (let s = 5; s <= 30; s += 5) raw.route.push([T1 + s * 1000, last[1] + (s % 10 ? 0.000002 : 0), last[2], last[3]])
    const d = runDetails({ ...raw, end: T1 + 30000 }, { ...W, end: T1 + 30000 })
    const lastSplit = d.splits[d.splits.length - 1]
    expect(Math.abs(lastSplit.sec / lastSplit.km - 417)).toBeLessThanOrEqual(3)
    // The workout's own time, which the average pace is worked from, keeps the stand-still.
    expect(d.sec).toBe(MIN * 60 + 30)
  })

  it('a wait at a crossing is left out of that km, from the watch\'s speed', () => {
    // 1 km at 2.5 m/s with a 60 s stop half way.
    const speed = []
    for (let s = 0; s <= 460; s += 5) speed.push([T0 + s * 1000, s > 200 && s < 260 ? 0 : 2.5])
    const raw = { start: T0, end: T0 + 460000, route: 'none', speed }
    const d = runDetails(raw, { start: T0, end: T0 + 460000 })
    expect(d.splits[0].sec).toBeGreaterThanOrEqual(395)
    expect(d.splits[0].sec).toBeLessThanOrEqual(410)
  })

  it('the seconds after stopping are left out of the pace curve', () => {
    const raw = { start: T0, end: T1, route: 'none', speed: [...Array.from({ length: 200 }, (_, i) => [T0 + i * 10000, V]), [T1 - 20000, 0.97], [T1, 0.97]] }
    const d = runDetails(raw, W)
    expect(Math.max(...d.series.pace.filter(x => x != null))).toBeLessThan(500)
  })

  it('a stop at a crossing does not turn into a pace', () => {
    const raw = { start: T0, end: T0 + 600000, route: 'none', dist: [[T0, T0 + 300000, 700], [T0 + 300000, T0 + 600000, 0]] }
    const d = runDetails(raw, W)
    expect(d.series.pace.slice(-10).every(p => p == null)).toBe(true)
  })
})

describe('best efforts and heart rate, kept for the running page', () => {
  it('the fastest km in a run, and no 5 km in a 4.9 km run', () => {
    const d = runDetails(rawRun(), W)
    expect(Math.abs(d.best['1000'] - 417)).toBeLessThanOrEqual(1)
    expect(d.best['5000']).toBeUndefined()
  })

  it('the fastest km anywhere in the run, not only from the start', () => {
    // 1 km easy at 2 m/s, then 1 km fast at 4 m/s.
    const tr = [[0, 0], [500000, 1000], [750000, 2000]]
    expect(bestEfforts(tr)).toEqual({ 1000: 250 })
  })

  it('a wait at a crossing inside the stretch is left out', () => {
    // 600 m, 60 s standing, 600 m, all at 3 m/s.
    const tr = [[0, 0], [200000, 600], [260000, 600], [460000, 1200]]
    expect(bestEfforts(tr)['1000']).toBe(333)
  })

  it('every second of heart rate lands in its 5-bpm band', () => {
    const d = runDetails(rawRun(), W)
    const total = Object.values(d.hrs).reduce((a, x) => a + x, 0)
    expect(Math.abs(total - MIN * 60)).toBeLessThanOrEqual(2)
    expect(Object.keys(d.hrs).map(Number)).toEqual([140, 145, 150, 155, 160, 165, 170])
  })

  it('a gap in the recording is not filled with the last heart rate', () => {
    expect(hrBands([[0, 150], [120000, 160]], 0, 125000)).toEqual({ 150: 30, 160: 5 })
  })
})

describe('helpers', () => {
  it('haversine: a degree of latitude', () => {
    expect(haversine(38, -9, 39, -9)).toBeCloseTo(M_PER_DEG, -1)
  })

  it('the distance track never goes down and ends at the total', () => {
    const tr = distanceTrack({ route: [], dist: [[0, 10, 50], [10, 20, 50]], speed: [] }, 0)
    expect(tr[tr.length - 1][1]).toBe(100)
    for (let i = 1; i < tr.length; i++) expect(tr[i][1]).toBeGreaterThanOrEqual(tr[i - 1][1])
  })

  it('withoutStops keeps the run and drops the stand-still', () => {
    expect(withoutStops([420, 410, 400, 415, 405, 1030, null])).toEqual([420, 410, 400, 415, 405, null, null])
    expect(withoutStops([420, 1030])).toEqual([420, 1030])
  })

  it('pace as m:ss', () => {
    expect(fmtPace(417)).toBe('6:57')
    expect(fmtPace(359.6)).toBe('6:00')
    expect(fmtPace(null)).toBe('–')
  })

  it('the route fits its box, north up', () => {
    const p = routePath([[38.70, -9.14], [38.71, -9.14]], 300, 200, 10)
    expect(p.start[1]).toBeGreaterThan(p.end[1])
    expect(p.start[0]).toBe(150)
    expect(routePath([[1, 1]])).toBeNull()
  })
})
