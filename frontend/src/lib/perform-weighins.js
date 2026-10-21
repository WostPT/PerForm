// PerForm: the time of day of a weigh-in, and the 7-day rolling average shown beside the latest
// one. A weigh-in's `at` is when it was taken (ms): the scale's copies from Health Connect carry
// it (perform-health.js), and one typed in the app carries it when a time is given. From one
// morning to the next the weight moves with water, salt and the last meal, so the mean of the
// last seven days is the number that follows the trend.

const DAY = 86400000
const pad = n => String(n).padStart(2, '0')
const dayMs = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))

/** "HH:MM" (local time) of a weigh-in's `at`, or '' when it has none. */
export function weighInTime(b) {
  const at = Number(b?.at)
  if (!(at > 0)) return ''
  const d = new Date(at)
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** The `at` (ms) of a local "HH:MM" on the day `iso`, or null when the time is blank or not one. */
export function atFrom(iso, hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim())
  if (!m || +m[1] > 23 || +m[2] > 59 || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return null
  return new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), +m[1], +m[2]).getTime()
}

/**
 * The mean of the weigh-ins in the `days` days ending on `iso` (that day included), or null when
 * none fall in it. An entry with no day or no weight is skipped. Returns { avg, n }.
 */
export function rollingAverage(bodyweight, iso, days = 7) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return null
  const end = dayMs(iso)
  const start = end - (days - 1) * DAY
  let sum = 0, n = 0
  for (const b of Array.isArray(bodyweight) ? bodyweight : []) {
    if (!b?.d || !(Number(b.w) > 0)) continue
    const t = dayMs(b.d)
    if (t < start || t > end) continue
    sum += Number(b.w); n++
  }
  return n ? { avg: sum / n, n } : null
}
