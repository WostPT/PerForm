// PerForm: a watch workout in detail. What HealthReadPlugin.details hands back for one session (its
// GPS route and the heart rate, speed, distance, steps and elevation recorded during it, a sample
// every second or so) is worked down here to what the workout screen shows: splits per km, curves
// of pace, heart rate and altitude, and a slimmed route. Only that is kept, on the workout as
// `details`, so it syncs to the server and shows on the desktop too: a few KB for a run, against
// hundreds for the samples.
//
//   w.details = {
//     v: DETAILS_V,
//     km, sec,            // distance and time the splits are worked from
//     gain,               // metres climbed, when known
//     spm,                // steps per minute, from the watch's step count (it shares no real cadence)
//     splits: [{ km, sec, hr, elev, spm }],   // one per km, the last one shorter; sec = moving time
//     series: { t: [s from start], pace: [s/km], hr: [bpm], alt: [m] },   // null where unknown
//     route: [[lat, lon]] | null,
//     routeConsent: true, // Health Connect wants the route allowed first (HR.askRoute)
//   }
//   or { v, none: true } when Health Connect had nothing more for the session.
// DETAILS_V goes up when what is worked out changes: workouts with an older one are read again.
export const DETAILS_V = 3
const ROUTE_POINTS = 200
const SERIES_POINTS = 60
// A last split shorter than this is folded into the one before it rather than shown on its own.
const MIN_LAST_SPLIT_M = 100
// Slower than this (about 21 min/km, well under a slow walk) is standing, not moving: the seconds
// before the watch is stopped, a wait at a crossing. Left out of the splits, as Strava and Garmin
// do; the average pace stays on the whole workout's time.
export const STOPPED_MS = 0.8

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const arr = v => (Array.isArray(v) ? v : [])
const round = (v, d = 0) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d)
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** Metres between two points on the Earth. */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371008.8, rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

function cleanRoute(route) {
  return arr(route)
    .filter(p => Array.isArray(p) && num(p[0]) != null && num(p[1]) != null && num(p[2]) != null && Math.abs(p[1]) <= 90 && Math.abs(p[2]) <= 180)
    .map(p => [p[0], p[1], p[2], num(p[3])])
    .sort((a, b) => a[0] - b[0])
}
const intervals = list => arr(list)
  .filter(x => Array.isArray(x) && num(x[0]) != null && num(x[1]) != null && x[1] >= x[0] && num(x[2]) != null && x[2] >= 0)
  .sort((a, b) => a[0] - b[0])
const samples = list => arr(list).filter(x => Array.isArray(x) && num(x[0]) != null && num(x[1]) != null).sort((a, b) => a[0] - b[0])

/**
 * The distance covered by each moment: [[t, metres so far]], never going down. From the GPS route
 * when there is one, else from the distance records, else from the speed samples; scaled to the
 * watch's own total when it is near it (GPS jitter makes a raw route read long, and the records
 * summed can overlap where Health Connect's own total does not), so the splits add up to the
 * distance shown everywhere else.
 */
export function distanceTrack(src, start, totalM = null) {
  const out = rawTrack(src, start)
  const m = out.length ? out[out.length - 1][1] : 0
  const f = totalM > 0 && m > 0 ? totalM / m : 1
  return f > 0.8 && f < 1.25 && f !== 1 ? out.map(([t, x]) => [t, x * f]) : out
}

function rawTrack({ route, dist, speed }, start) {
  if (route.length >= 2) {
    const out = [[route[0][0], 0]]
    let m = 0
    for (let i = 1; i < route.length; i++) {
      m += haversine(route[i - 1][1], route[i - 1][2], route[i][1], route[i][2])
      out.push([route[i][0], m])
    }
    return out
  }
  if (dist.length) {
    const out = [[Math.min(start, dist[0][0]), 0]]
    let m = 0
    for (const [s, e, x] of dist) {
      if (s > out[out.length - 1][0]) out.push([s, m])
      m += x
      out.push([Math.max(e, out[out.length - 1][0]), m])
    }
    return out
  }
  if (speed.length >= 2) {
    const out = [[speed[0][0], 0]]
    let m = 0
    for (let i = 1; i < speed.length; i++) {
      m += (speed[i][0] - speed[i - 1][0]) / 1000 * (speed[i][1] + speed[i - 1][1]) / 2
      out.push([speed[i][0], m])
    }
    return out
  }
  return []
}

// Linear in between two points of a sorted [[x, y]] list, held flat past its ends.
function interp(list, x, xi = 0, yi = 1) {
  if (!list.length) return null
  if (x <= list[0][xi]) return list[0][yi]
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i]
    if (x <= b[xi]) return b[xi] === a[xi] ? b[yi] : a[yi] + (b[yi] - a[yi]) * (x - a[xi]) / (b[xi] - a[xi])
  }
  return list[list.length - 1][yi]
}

// What intervals sum to between a and b, each counted by how much of it falls inside.
function sumOver(list, a, b) {
  let s = 0
  for (const [x, y, v] of list) {
    const o = Math.min(b, y) - Math.max(a, x)
    if (o <= 0) continue
    s += y > x ? v * o / (y - x) : v
  }
  return s
}
const meanIn = (list, a, b) => mean(list.filter(x => x[0] >= a && x[0] <= b).map(x => x[1]))

function slimRoute(route) {
  if (route.length < 2) return null
  const step = Math.max(1, Math.ceil(route.length / ROUTE_POINTS))
  const out = []
  for (let i = 0; i < route.length; i += step) out.push([round(route[i][1], 5), round(route[i][2], 5)])
  const last = route[route.length - 1]
  if ((route.length - 1) % step) out.push([round(last[1], 5), round(last[2], 5)])
  return out
}

// Metres climbed along the route, counting a rise only once it passes a few metres: GPS altitude
// wanders up and down by a metre or two on flat ground.
function climbed(alts) {
  const STEP = 3
  let gain = 0, base = null
  for (const a of alts) {
    if (base == null) { base = a; continue }
    if (a - base >= STEP) { gain += a - base; base = a }
    else if (base - a >= STEP) base = a
  }
  return gain
}

/**
 * How much of [a, b] was spent moving, in ms. From the watch's speed samples when it has them
 * there, else from how fast the distance track rose between its points.
 */
export function movingMs(track, speed, a, b) {
  const sp = speed.filter(x => x[0] >= a - 15000 && x[0] <= b + 15000)
  const pairs = sp.length >= 2 ? sp.map((x, i) => i && [sp[i - 1][0], x[0], (sp[i - 1][1] + x[1]) / 2]).filter(Boolean)
    : track.map((x, i) => i && [track[i - 1][0], x[0], x[0] > track[i - 1][0] ? (x[1] - track[i - 1][1]) / ((x[0] - track[i - 1][0]) / 1000) : 0]).filter(Boolean)
  if (!pairs.length) return b - a
  let ms = 0, covered = 0
  for (const [s, e, v] of pairs) {
    const o = Math.min(b, e) - Math.max(a, s)
    if (o <= 0) continue
    covered += o
    if (v >= STOPPED_MS) ms += o
  }
  // Time the samples do not reach (a gap in them) is counted as moving rather than guessed away.
  return ms + Math.max(0, (b - a) - covered)
}

/**
 * The details for one session, from what HR.details returned (`raw`). `w` is the workout, for its
 * start, end and the distance the watch gave. `routeOverride` is a route from HR.askRoute.
 */
export function runDetails(raw, w, routeOverride = null) {
  const start = num(raw?.start) ?? num(w?.start), end = num(raw?.end) ?? num(w?.end)
  if (start == null || end == null || !(end > start)) return { v: DETAILS_V, none: true }
  const consent = raw?.route === 'consent' && !routeOverride
  const route = cleanRoute(routeOverride || raw?.route).filter(p => p[0] >= start - 60000 && p[0] <= end + 60000)
  const dist = intervals(raw?.dist), steps = intervals(raw?.steps), elev = intervals(raw?.elev)
  const hr = samples(raw?.hr).filter(x => x[1] > 0), speed = samples(raw?.speed).filter(x => x[1] >= 0)
  const recordedM = dist.reduce((a, x) => a + x[2], 0)
  // Health Connect's own total for the session first: it is the one History and the list show.
  const totalHint = num(w?.watch?.km) > 0 ? w.watch.km * 1000 : recordedM > 0 ? recordedM : null
  const track = distanceTrack({ route, dist, speed }, start, totalHint)
  const totalM = track.length ? track[track.length - 1][1] : 0
  const alts = route.filter(p => p[3] != null).map(p => [p[0], p[3]])

  if (!track.length && !hr.length && !consent) return { v: DETAILS_V, none: true }

  // Splits: the moment each whole km was reached.
  const splits = []
  if (totalM >= 1000 || totalM >= MIN_LAST_SPLIT_M) {
    const marks = []
    for (let m = 1000; m <= totalM; m += 1000) marks.push(m)
    if (totalM - (marks[marks.length - 1] || 0) >= MIN_LAST_SPLIT_M || !marks.length) marks.push(totalM)
    else if (marks.length) marks[marks.length - 1] = totalM
    let t0 = track[0][0], m0 = 0
    for (const m of marks) {
      const t1 = interp(track, m, 1, 0)
      const split = { km: round((m - m0) / 1000, 2), sec: Math.round(movingMs(track, speed, t0, t1) / 1000) }
      const h = meanIn(hr, t0, t1)
      if (h != null) split.hr = Math.round(h)
      if (alts.length) split.elev = Math.round(interp(alts, t1) - interp(alts, t0))
      if (steps.length && t1 > t0) split.spm = Math.round(sumOver(steps, t0, t1) / ((t1 - t0) / 60000))
      splits.push(split)
      t0 = t1; m0 = m
    }
  }

  // Curves over the session, in SERIES_POINTS buckets.
  const n = SERIES_POINTS, dt = (end - start) / n
  const series = { t: [], pace: [], hr: [], alt: [] }
  for (let i = 0; i < n; i++) {
    const a = start + i * dt, b = a + dt
    series.t.push(Math.round((i + 0.5) * dt / 1000))
    let pace = null
    const v = meanIn(speed, a, b)
    if (v > 0.3) pace = 1000 / v
    else if (track.length) {
      const dm = interp(track, b) - interp(track, a)
      if (dm > 5) pace = (dt / 1000) / (dm / 1000)
    }
    // Standing at a crossing reads as an endless pace; past 30 min/km it is not a pace any more.
    series.pace.push(pace != null && pace < 1800 ? Math.round(pace) : null)
    series.hr.push(round(meanIn(hr, a, b)))
    series.alt.push(alts.length ? round(meanIn(alts, a, b) ?? interp(alts, (a + b) / 2), 1) : null)
  }
  series.pace = withoutStops(series.pace)
  for (const k of ['pace', 'hr', 'alt']) if (series[k].every(x => x == null)) delete series[k]

  const out = { v: DETAILS_V, km: round(totalM / 1000, 2), sec: Math.round((end - start) / 1000), splits, series, route: slimRoute(route) }
  const gain = elev.length ? elev.reduce((a, x) => a + x[2], 0) : alts.length ? climbed(alts.map(x => x[1])) : null
  if (gain != null) out.gain = Math.round(gain)
  if (steps.length) out.spm = Math.round(sumOver(steps, start, end) / ((end - start) / 60000))
  if (consent) out.routeConsent = true
  return out
}

/**
 * A pace curve without the moments spent stopped: the seconds between stopping and ending the
 * workout on the watch, or a wait at a crossing, read as a pace several times the run's own and
 * flatten the rest of the curve against them. Over 1.6 times the median, it is left out.
 */
export function withoutStops(pace) {
  const xs = pace.filter(x => x != null).sort((a, b) => a - b)
  if (xs.length < 5) return pace
  const med = xs[Math.floor(xs.length / 2)]
  return pace.map(x => (x != null && x > med * 1.6 ? null : x))
}

/** Seconds per km as "5:42". */
export function fmtPace(secPerKm) {
  if (!(secPerKm > 0)) return '–'
  const s = Math.round(secPerKm)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The route as an SVG path in a w×h box, north up, with the shape kept (a degree of longitude is
 * shorter than one of latitude away from the equator). Returns { d, start, end } or null.
 */
export function routePath(route, w = 300, h = 200, pad = 10) {
  const pts = arr(route).filter(p => Array.isArray(p) && num(p[0]) != null && num(p[1]) != null)
  if (pts.length < 2) return null
  const lat0 = mean(pts.map(p => p[0]))
  const k = Math.cos(lat0 * Math.PI / 180)
  const xs = pts.map(p => p[1] * k), ys = pts.map(p => -p[0])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const span = Math.max(maxX - minX, maxY - minY) || 1
  const s = Math.min((w - 2 * pad) / (maxX - minX || span), (h - 2 * pad) / (maxY - minY || span))
  const ox = (w - (maxX - minX) * s) / 2, oy = (h - (maxY - minY) * s) / 2
  const xy = pts.map((_, i) => [round(ox + (xs[i] - minX) * s, 1), round(oy + (ys[i] - minY) * s, 1)])
  return { d: 'M' + xy.map(p => p.join(' ')).join(' L'), start: xy[0], end: xy[xy.length - 1] }
}
