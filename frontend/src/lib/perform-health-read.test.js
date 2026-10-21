import { beforeEach, describe, expect, it, vi } from 'vitest'

// PerForm: the Android app reading the watch's data from Health Connect. The native plugin
// (HealthReadPlugin.java), the app's data directory and the store are played in memory.
const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { files: new Map(), calls: [], status: { status: 'available', granted: [] }, grant: ['sleep', 'weight'], reading: {}, fail: null, details: null }
})

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async ({ path }) => {
      if (!h.files.has(path)) throw new Error('File does not exist')
      return { data: h.files.get(path) }
    },
    writeFile: async ({ path, data }) => { h.files.set(path, data) },
  },
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: () => ({ remove() {} }) } }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android' },
  registerPlugin: () => ({
    status: async () => ({ ...h.status }),
    requestPermissions: async () => { h.calls.push(['request']); h.status.granted = h.grant; return { granted: h.grant } },
    read: async arg => {
      h.calls.push(['read', arg])
      if (h.fail) throw Object.assign(new Error('refused'), { code: h.fail })
      return h.reading
    },
    details: async arg => {
      h.calls.push(['details', arg])
      if (!h.details) throw Object.assign(new Error('not there'), { code: 'UNIMPLEMENTED' })
      return h.details
    },
  }),
}))

const file = () => JSON.parse(h.files.get('perform-health-read.json') || 'null')
const day = (iso, hh) => new Date(`${iso}T${String(hh).padStart(2, '0')}:00:00`).getTime()
const reads = () => h.calls.filter(c => c[0] === 'read')

let hr, S, ready
const store = { update: fn => { const next = structuredClone(S); fn(next); S = next }, ready: () => ready, state: () => S }
beforeEach(async () => {
  vi.resetModules()
  vi.useRealTimers()
  h.files.clear(); h.calls = []; h.status = { status: 'available', granted: [] }; h.grant = ['sleep', 'weight']; h.fail = null; h.details = null
  h.reading = {}
  S = { unit: 'kg', bodyweight: [] }
  ready = true
  hr = await import('./perform-health-read.js')
  hr.initHealthRead(store)
})

describe('off (the default)', () => {
  it('reads nothing and asks for nothing', async () => {
    await hr.readHealthNow({ force: true })
    expect(h.calls).toEqual([])
    expect(S.health).toBeUndefined()
  })
})

describe('turning it on', () => {
  it('asks for the permissions, reads 30 days back and folds the reading into the log', async () => {
    const time = Date.now() - 3600000
    h.reading = {
      sleep: [{ id: 's1', start: time - 8 * 3600000, end: time, stages: [] }],
      weights: [{ id: 'w1', time, kg: 80.25 }],
    }
    const r = await hr.enableHealthRead()
    expect(r.ok).toBe(true)
    expect(h.calls[0]).toEqual(['request'])
    const [, win] = reads()[0]
    expect(win.until - win.since).toBe(30 * 86400000)
    expect(S.health.sleep.map(s => s.id)).toEqual(['s1'])
    expect(S.health.weights[0]).toMatchObject({ id: 'w1', time, kg: 80.25 })
    // The scale's weigh-in reaches the weight log, once, with when it was taken.
    expect(S.bodyweight).toEqual([expect.objectContaining({ w: 80.3, at: time, src: 'health-connect' })])
    expect(S.health.imported).toEqual(['w1'])
    expect(file()).toMatchObject({ on: true, error: null, granted: ['sleep', 'weight'] })
  })

  it('logs the watch\'s run as a workout', async () => {
    const end = Date.now() - 3600000
    h.reading = { sessions: [{ id: 'r1', start: end - 30 * 60000, end, type: 56, m: 5000 }] }
    await hr.enableHealthRead()
    expect(S.workouts).toEqual([expect.objectContaining({ id: 'hc-r1', src: 'health-connect', entries: [expect.objectContaining({ id: '0685' })] })])
    expect(S.health.imported).toEqual(['r1'])
  })

  it('reads the run\'s details once, and keeps them on the workout', async () => {
    const end = Date.now() - 3600000, start = end - 30 * 60000
    h.reading = { sessions: [{ id: 'r1', start, end, type: 56, m: 5000 }] }
    h.details = { start, end, route: 'none', dist: [[start, end, 5000]], hr: [[start + 60000, 150]] }
    await hr.enableHealthRead()
    expect(h.calls.filter(c => c[0] === 'details')).toEqual([['details', { id: 'r1' }]])
    expect(S.workouts[0].details).toMatchObject({ v: 2, km: 5, splits: [{ km: 1 }, { km: 1 }, { km: 1 }, { km: 1 }, { km: 1 }] })
    await hr.readHealthNow({ force: true })
    expect(h.calls.filter(c => c[0] === 'details')).toHaveLength(1)
  })

  it('reads the details again when they were worked out by an older version', async () => {
    const end = Date.now() - 3600000, start = end - 30 * 60000
    h.reading = { sessions: [{ id: 'r1', start, end, type: 56, m: 5000 }] }
    h.details = { start, end, route: 'none', dist: [[start, end, 5000]] }
    await hr.enableHealthRead()
    S.workouts[0].details = { v: 1, km: 5.02, splits: [] }
    vi.resetModules()
    hr = await import('./perform-health-read.js')
    hr.initHealthRead(store)
    await hr.readHealthNow({ force: true })
    expect(S.workouts[0].details).toMatchObject({ v: 2, km: 5 })
  })

  it('an older APK without details still reads the rest', async () => {
    const end = Date.now() - 3600000
    h.reading = { sessions: [{ id: 'r1', start: end - 30 * 60000, end, type: 56, m: 5000 }] }
    const out = await hr.enableHealthRead()
    expect(out.ok).toBe(true)
    expect(S.workouts[0].details).toBeUndefined()
  })

  it('stays off when nothing is granted', async () => {
    h.grant = []
    expect(await hr.enableHealthRead()).toEqual({ ok: false, reason: 'denied' })
    expect(reads()).toEqual([])
    expect(file()).toBeNull()
  })

  it('says so when Health Connect is not there', async () => {
    h.status = { status: 'missing', granted: [] }
    expect(await hr.enableHealthRead()).toEqual({ ok: false, reason: 'missing' })
  })
})

describe('after that', () => {
  it('reads again from three days before the last time, and not twice in a row', async () => {
    await hr.enableHealthRead()
    const last = file().at
    await hr.readHealthNow()
    expect(reads()).toHaveLength(1)
    await hr.readHealthNow({ force: true })
    expect(reads()).toHaveLength(2)
    expect(reads()[1][1].since).toBe(last - 3 * 86400000)
  })

  it('does not copy a weigh-in back after it was deleted from the log', async () => {
    h.reading = { weights: [{ id: 'w1', time: day('2026-10-19', 7), kg: 80 }] }
    await hr.enableHealthRead()
    S.bodyweight = []
    await hr.readHealthNow({ force: true })
    expect(S.bodyweight).toEqual([])
  })

  it('keeps the error for the Settings row and what was read before', async () => {
    h.reading = { sleep: [{ id: 's1', start: Date.now() - 9 * 3600000, end: Date.now() - 3600000 }] }
    await hr.enableHealthRead()
    h.fail = 'permission'
    const out = await hr.readHealthNow({ force: true })
    expect(out.error).toBe('permission')
    expect(S.health.sleep).toHaveLength(1)
  })

  it('waits for the store to load the log', async () => {
    await hr.enableHealthRead()
    ready = false
    expect(await hr.readHealthNow({ force: true })).toBe(null)
    expect(reads()).toHaveLength(1)
  })

  it('stops reading when turned off, and keeps the data', async () => {
    h.reading = { sleep: [{ id: 's1', start: Date.now() - 9 * 3600000, end: Date.now() - 3600000 }] }
    await hr.enableHealthRead()
    await hr.disableHealthRead()
    await hr.readHealthNow({ force: true })
    expect(reads()).toHaveLength(1)
    expect(S.health.sleep).toHaveLength(1)
    expect(file().on).toBe(false)
  })
})
