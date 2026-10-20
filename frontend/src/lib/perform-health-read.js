// PerForm: reading the watch's data from Health Connect on the Android app (HealthReadPlugin.java).
// The reading is folded into S.health by lib/perform-health.js; this file owns the plugin, when to
// read, and the phone's own note of it.
//
// Whether it is on is a fact about this phone, like the writing side (lib/health-sync.js): kept in
// its own file in the app's data directory, never in S, so a second phone or the desktop never
// switches it on. What it read is the user's data and does go into S.
//
// It reads when turned on, when the app comes back to the foreground, and on "Read now", at
// most once every few minutes on its own. The web build never gets here (MOBILE).
import { MOBILE, isAndroid, readJsonFile, writeJsonFile } from './mobile.js'
import { mergeReading, readWindow, weighInsToAdd } from './perform-health.js'

export const HEALTH_READ_FILE = 'perform-health-read.json'
const OFF = { on: false, at: 0, error: null, granted: [], history: false }
const QUIET_MS = 10 * 60000

// Wrapped in an object: a Capacitor plugin proxy answers `then` (see lib/health-sync.js).
let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  if (!(await isAndroid())) return null
  const { registerPlugin } = await import('@capacitor/core')
  return { HR: registerPlugin('HealthRead') }
})().catch(() => null))

let cached = null
export async function loadHealthRead() {
  if (cached) return cached
  const f = await readJsonFile(HEALTH_READ_FILE)
  cached = f && typeof f === 'object' ? { ...OFF, ...f } : { ...OFF }
  return cached
}
const save = h => { cached = h; return writeJsonFile(HEALTH_READ_FILE, h) }

const listeners = new Set()
/** Called with the file's new content after every reading, for the Settings row. */
export function onHealthReadChange(cb) { listeners.add(cb); return () => listeners.delete(cb) }
const told = h => { listeners.forEach(cb => { try { cb(h) } catch { /* a closed screen */ } }) }

/** { status: 'available' | 'missing' | 'unsupported', granted: ['sleep', …], history } */
export async function healthReadStatus() {
  if (!MOBILE) return { status: 'unsupported', granted: [], history: false }
  try {
    const p = await plugin()
    if (!p) return { status: 'unsupported', granted: [], history: false }
    return await p.HR.status()
  } catch { return { status: 'unsupported', granted: [], history: false } }
}

// The store, handed over by initHealthRead: this file cannot import it (the store imports the
// files that import this one).
let store = null

// The new S.health and the scale's weigh-ins for days the weight log has none of, in one change.
function apply(reading, since, until) {
  store.update(s => {
    const now = Date.now()
    s.health = mergeReading(s.health, reading, { since, until, now })
    const { add, ids } = weighInsToAdd(s.health, s.bodyweight, s.unit, now)
    if (add.length) {
      s.bodyweight = [...(s.bodyweight || []), ...add].sort((a, b) => (a.d < b.d ? -1 : 1))
      s.health.imported = [...s.health.imported, ...ids]
    }
  })
}

let running = null
/**
 * Reads what is new since the last time and folds it into the log. `force` reads even when the
 * last reading was a moment ago. Resolves with the file's content afterwards; `error` is
 * 'permission' when every permission was taken back, 'unavailable' or 'failed' otherwise.
 */
export function readHealthNow({ force = false } = {}) {
  // Not before the store has the log: a reading folded into the empty state of a launch that is
  // still restoring would be the only health data the merge then sees from this phone.
  if (!MOBILE || !store || !store.ready()) return Promise.resolve(null)
  if (running) return running
  running = (async () => {
    let h = await loadHealthRead()
    if (!h.on) return h
    if (!force && Date.now() - h.at < QUIET_MS) return h
    const p = await plugin()
    if (!p) return h
    let out = { ...h }
    try {
      const st = await p.HR.status()
      out.granted = st.granted || []
      out.history = !!st.history
      if (st.status !== 'available') out.error = 'unavailable'
      else if (!out.granted.length) out.error = 'permission'
      else {
        const { since, until } = readWindow(h.at, { history: out.history })
        const reading = await p.HR.read({ since, until })
        apply(reading, since, until)
        out = { ...out, at: until, error: null }
      }
    } catch (e) {
      out.error = e?.code === 'permission' ? 'permission' : e?.code === 'unavailable' ? 'unavailable' : 'failed'
    }
    await save(out)
    told(out)
    return out
  })().finally(() => { running = null })
  return running
}

/**
 * Turning it on: asks for the read permissions, then reads as far back as Health Connect lets it.
 * Resolves with { ok, reason, health } — reason 'denied' when nothing was granted.
 */
export async function enableHealthRead() {
  const p = await plugin()
  if (!p) return { ok: false, reason: 'unsupported' }
  const st = await p.HR.status().catch(() => ({ status: 'unsupported', granted: [] }))
  if (st.status !== 'available') return { ok: false, reason: st.status }
  const got = await p.HR.requestPermissions().catch(() => ({ granted: [] }))
  if (!(got.granted || []).length) return { ok: false, reason: 'denied' }
  const h = await loadHealthRead()
  await save({ ...h, on: true, error: null, granted: got.granted, history: !!got.history })
  const after = await readHealthNow({ force: true })
  return { ok: !after?.error, reason: after?.error || null, health: after }
}

/** Stops reading. What was read stays in the log: it is the user's data. */
export async function disableHealthRead() {
  if (running) await running.catch(() => {})
  const out = { ...(await loadHealthRead()), on: false, error: null }
  await save(out)
  told(out)
  return out
}

/** Asks again, for permissions the user skipped the first time. */
export async function askHealthReadAgain() {
  const p = await plugin()
  if (!p) return null
  const got = await p.HR.requestPermissions().catch(() => null)
  if (!got) return null
  const out = { ...(await loadHealthRead()), granted: got.granted || [], history: !!got.history }
  await save(out)
  told(out)
  return readHealthNow({ force: true })
}

let started = false
/** From the store, once: `api` is { update, ready } — its change function, and whether it has loaded. */
export function initHealthRead(api) {
  if (!MOBILE || started) return
  started = true
  store = api
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) readHealthNow().catch(() => {}) })
  }).catch(() => {})
  let tries = 0
  const first = () => {
    if (store.ready()) readHealthNow().catch(() => {})
    else if (++tries < 15) setTimeout(first, 4000)
  }
  setTimeout(first, 4000)
}
