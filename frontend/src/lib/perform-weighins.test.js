import { describe, expect, it } from 'vitest'
import { atFrom, rollingAverage, weighInTime } from './perform-weighins.js'

describe('rollingAverage', () => {
  const log = [
    { d: '2026-10-07', w: 90 },
    { d: '2026-10-08', w: 81 },
    { d: '2026-10-10', w: 80 },
    { d: '2026-10-14', w: 79 },
    { d: '2026-10-15', w: 0 },
    { w: 70 },
  ]

  it('averages the seven days ending on the day, that day included', () => {
    expect(rollingAverage(log, '2026-10-14')).toEqual({ avg: 80, n: 3 })
  })

  it('leaves out the day before the window and anything after the day', () => {
    expect(rollingAverage(log, '2026-10-13')).toEqual({ avg: (90 + 81 + 80) / 3, n: 3 })
    expect(rollingAverage(log, '2026-10-10', 3)).toEqual({ avg: 80.5, n: 2 })
  })

  it('crosses a month end', () => {
    expect(rollingAverage([{ d: '2026-09-30', w: 80 }, { d: '2026-10-02', w: 82 }], '2026-10-02')).toEqual({ avg: 81, n: 2 })
  })

  it('is null with no weigh-in in the window or no day', () => {
    expect(rollingAverage(log, '2026-11-30')).toBeNull()
    expect(rollingAverage(log, '')).toBeNull()
    expect(rollingAverage(null, '2026-10-14')).toBeNull()
  })
})

describe('weigh-in time', () => {
  it('round-trips a local time on a day', () => {
    const at = atFrom('2026-10-21', '07:05')
    expect(new Date(at).getDate()).toBe(21)
    expect(weighInTime({ at })).toBe('07:05')
  })

  it('has no time when none was given', () => {
    expect(weighInTime({ d: '2026-10-21', w: 80 })).toBe('')
    expect(atFrom('2026-10-21', '')).toBeNull()
    expect(atFrom('2026-10-21', '25:00')).toBeNull()
    expect(atFrom('', '07:00')).toBeNull()
  })
})
