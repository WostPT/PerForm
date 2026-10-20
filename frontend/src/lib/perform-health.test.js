import { describe, expect, it } from 'vitest'
import {
  summarizeSleep, summarizeSession, summarizeWeight, mergeReading, readWindow, weighInsToAdd,
  nightsByDay, healthSeries, healthAverage, emptyHealth, healthOf, HEALTH_KEEP_DAYS,
} from './perform-health.js'

const MIN = 60000, H = 60 * MIN, DAY = 24 * H
const at = (iso, h = 0, m = 0) => new Date(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime()

describe('summarizeSleep', () => {
  it('adds up the stages and files the night under the day it ended', () => {
    const start = at('2026-10-19', 23, 0)
    const s = summarizeSleep({
      id: 'a', start, end: at('2026-10-20', 7, 0), src: 'com.fitbit.FitbitMobile',
      stages: [
        { s: start, e: start + 2 * H, k: 4 },            // light
        { s: start + 2 * H, e: start + 3 * H, k: 5 },    // deep
        { s: start + 3 * H, e: start + 3 * H + 20 * MIN, k: 1 },   // awake
        { s: start + 3 * H + 20 * MIN, e: start + 5 * H, k: 6 },   // rem
        { s: start + 5 * H, e: start + 8 * H, k: 4 },    // light
      ],
    })
    expect(s).toMatchObject({ id: 'a', d: '2026-10-20', light: 300, deep: 60, rem: 100, awake: 20, asleep: 460, src: 'com.fitbit.FitbitMobile' })
  })

  it('counts a session without stages as asleep the whole time', () => {
    expect(summarizeSleep({ id: 'b', start: at('2026-10-20', 14), end: at('2026-10-20', 14, 30) }).asleep).toBe(30)
  })

  it('leaves out a session with no id or no length', () => {
    expect(summarizeSleep({ start: 1, end: 2 })).toBe(null)
    expect(summarizeSleep({ id: 'x', start: 5, end: 5 })).toBe(null)
  })
})

describe('summarizeSession and summarizeWeight', () => {
  it('names the type and turns metres into km', () => {
    const s = summarizeSession({ id: 's', start: at('2026-10-18', 9), end: at('2026-10-18', 9, 40), type: 56, hrAvg: 151.4, hrMax: 178, m: 7421 })
    expect(s).toEqual({ id: 's', d: '2026-10-18', start: s.start, end: s.end, type: 'running', hrAvg: 151, hrMax: 178, km: 7.42 })
    expect(summarizeSession({ id: 't', start: 1, end: 2, type: 999 }).type).toBe('other')
  })

  it('keeps the time a weigh-in was taken', () => {
    const time = at('2026-10-20', 7, 42)
    expect(summarizeWeight({ id: 'w', time, kg: 81.2345 })).toEqual({ id: 'w', d: '2026-10-20', time, kg: 81.235 })
    expect(summarizeWeight({ id: 'w', time, kg: 0 })).toBe(null)
  })
})

describe('readWindow', () => {
  const now = at('2026-10-20', 12)
  it('goes back 30 days the first time, a year with the history permission', () => {
    expect(readWindow(0, { now }).since).toBe(now - 30 * DAY)
    expect(readWindow(0, { now, history: true }).since).toBe(now - 365 * DAY)
  })
  it('rereads the last three days after that, for a watch that synced late', () => {
    expect(readWindow(now - H, { now })).toEqual({ since: now - H - 3 * DAY, until: now })
  })
})

describe('mergeReading', () => {
  const now = at('2026-10-20', 12)
  const since = at('2026-10-17', 12), until = now

  it('replaces the days of the window and keeps the older ones', () => {
    const prev = { days: { '2026-10-10': { steps: 9000 }, '2026-10-18': { steps: 1, rhr: 70 } } }
    const out = mergeReading(prev, {
      days: [{ d: '2026-10-17', steps: 4000 }, { d: '2026-10-18', steps: 12000, hrMin: 48, hrAvg: 71.6, hrMax: 160, rhr: 54 }, { d: '2026-10-19' }],
      hrv: [{ time: at('2026-10-18', 3), ms: 40 }, { time: at('2026-10-18', 5), ms: 45 }],
    }, { since, until, now })
    expect(out.days).toEqual({
      '2026-10-10': { steps: 9000 },
      '2026-10-17': { steps: 4000 },
      '2026-10-18': { steps: 12000, hrMin: 48, hrAvg: 72, hrMax: 160, rhr: 54, hrv: 42.5 },
    })
    expect(Object.keys(out.days)).toEqual(['2026-10-10', '2026-10-17', '2026-10-18'])
  })

  it('drops a night the watch deleted inside the window, keeps the ones before it', () => {
    const old = { id: 'old', d: '2026-10-12', start: at('2026-10-11', 23), end: at('2026-10-12', 7), asleep: 420 }
    const gone = { id: 'gone', d: '2026-10-19', start: at('2026-10-18', 23), end: at('2026-10-19', 7), asleep: 400 }
    const out = mergeReading({ sleep: [old, gone] }, {
      sleep: [{ id: 'new', start: at('2026-10-19', 23), end: at('2026-10-20', 6, 30), stages: [] }],
    }, { since, until, now })
    expect(out.sleep.map(s => s.id)).toEqual(['old', 'new'])
  })

  it('replaces a record that comes back by id, even one that began before the window', () => {
    const s = { id: 'x', start: since - H, end: since + 6 * H }
    const first = mergeReading(null, { sleep: [s] }, { since: since - DAY, until, now })
    const again = mergeReading(first, { sleep: [{ ...s, end: since + 7 * H }] }, { since, until, now })
    expect(again.sleep).toHaveLength(1)
    expect(again.sleep[0].asleep).toBe(8 * 60)
  })

  it('lets go of anything older than the keep window', () => {
    const old = new Date(now - (HEALTH_KEEP_DAYS + 2) * DAY)
    const iso = old.toISOString().slice(0, 10)
    const out = mergeReading({ days: { [iso]: { steps: 1 } }, weights: [{ id: 'w', d: iso, time: old.getTime(), kg: 80 }], imported: ['w'] }, {}, { since, until, now })
    expect(out.days).toEqual({})
    expect(out.weights).toEqual([])
    expect(out.imported).toEqual([])
  })

  it('reads an older profile without S.health as empty', () => {
    expect(healthOf({})).toEqual(emptyHealth())
    expect(mergeReading(undefined, null, { since, until, now })).toEqual(emptyHealth())
  })
})

describe('weighInsToAdd', () => {
  const health = {
    weights: [
      { id: 'a', d: '2026-10-18', time: at('2026-10-18', 7), kg: 80 },
      { id: 'b', d: '2026-10-18', time: at('2026-10-18', 21), kg: 81 },
      { id: 'c', d: '2026-10-19', time: at('2026-10-19', 7, 15), kg: 80.4 },
      { id: 'd', d: '2026-10-20', time: at('2026-10-20', 7), kg: 79.9 },
    ],
    imported: ['d'],
  }

  it('adds the last weigh-in of each day the log has none for, with when it was taken', () => {
    const { add, ids } = weighInsToAdd(health, [{ d: '2026-10-19', w: 80.5, t: 1 }], 'kg', 123)
    expect(add).toEqual([{ d: '2026-10-18', w: 81, t: 123, at: at('2026-10-18', 21), src: 'health-connect' }])
    expect(ids).toEqual(['b'])
  })

  it('converts to pounds for a pound profile', () => {
    const { add } = weighInsToAdd({ weights: [health.weights[2]] }, [], 'lb', 1)
    expect(add[0].w).toBe(177.3)
  })

  it('never copies one twice, so a deleted one stays deleted', () => {
    expect(weighInsToAdd(health, [], 'kg').add.map(b => b.d)).toEqual(['2026-10-18', '2026-10-19'])
  })
})

describe('series and averages', () => {
  const now = at('2026-10-20', 12)
  const health = {
    days: { '2026-10-18': { rhr: 55 }, '2026-10-19': { rhr: 53, steps: 8000 }, '2026-10-20': { rhr: 51 } },
    sleep: [
      { id: 'n', d: '2026-10-20', start: at('2026-10-19', 23), end: at('2026-10-20', 7), asleep: 450 },
      { id: 'nap', d: '2026-10-20', start: at('2026-10-20', 14), end: at('2026-10-20', 14, 30), asleep: 30 },
    ],
  }

  it('takes the longest sleep of a day as its night', () => {
    expect(nightsByDay(health)['2026-10-20'].id).toBe('n')
    expect(healthSeries(health, 'sleep', 0, now)).toEqual([{ t: at('2026-10-20', 12), d: '2026-10-20', y: 7.5 }])
  })

  it('charts a day metric within the range', () => {
    expect(healthSeries(health, 'rhr', 1, now).map(p => p.y)).toEqual([53, 51])
    expect(healthSeries(health, 'steps', 0, now).map(p => p.y)).toEqual([8000])
  })

  it('averages the days up to one', () => {
    expect(healthAverage(health, 'rhr', '2026-10-20', 7)).toBe(53)
    expect(healthAverage(health, 'hrv', '2026-10-20', 7)).toBe(null)
  })
})
