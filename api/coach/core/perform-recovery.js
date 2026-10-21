/* PerForm: what the watch says about recovery, for the Coach (the `recovery` data category).
 *
 * The phone reads sleep, resting heart rate, HRV and steps from Health Connect into S.health
 * (frontend/src/lib/perform-health.js). This copies a bounded slice of it into the payload, by
 * name like the rest of payload.js: per night the minutes asleep and in deep and REM sleep, per
 * day the resting heart rate, HRV and steps. Nothing else in S.health leaves: not the times of
 * day, not the data source, not the workouts the watch recorded (those reach the Coach as
 * workouts, through `training`).
 *
 * Kept out of payload.js so the fork's change to that upstream file stays one call per review
 * kind; see .claude/CLAUDE.md.
 */
export const MAX_RECOVERY_DAYS = 84;

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const n = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : undefined);
const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * { nights: [{ d, asleep, deep, rem, awake }], days: [{ d, rhr, hrv, steps }] } for the days from
 * `from` to `to` (inclusive, either may be null), the last MAX_RECOVERY_DAYS of them; minutes for
 * sleep. null when the watch has nothing there, so a profile without one sends nothing at all.
 */
export function recoveryOf(S, from, to) {
  const h = isMap(S?.health) ? S.health : null;
  if (!h) return null;
  const inRange = d => isDay(d) && (!from || d >= from) && (!to || d <= to);

  // One night per day: the longest sleep woken up from that day, so a nap does not replace it.
  const best = {};
  for (const s of Array.isArray(h.sleep) ? h.sleep : []) {
    if (!isMap(s) || !inRange(s.d)) continue;
    const len = Number(s.end) - Number(s.start);
    if (!best[s.d] || len > best[s.d].len) best[s.d] = { s, len };
  }
  const nights = Object.keys(best).sort().slice(-MAX_RECOVERY_DAYS).map(d => {
    const s = best[d].s;
    const o = { d };
    for (const k of ['asleep', 'deep', 'rem', 'awake']) if (n(s[k]) !== undefined) o[k] = Math.round(s[k]);
    return o;
  });

  const days = Object.keys(isMap(h.days) ? h.days : {}).filter(inRange).sort().slice(-MAX_RECOVERY_DAYS).map(d => {
    const v = isMap(h.days[d]) ? h.days[d] : {};
    const o = { d };
    if (n(v.rhr) !== undefined) o.rhr = Math.round(v.rhr);
    if (n(v.hrv) !== undefined) o.hrv = n(v.hrv);
    if (n(v.steps) !== undefined) o.steps = Math.round(v.steps);
    return o;
  }).filter(o => Object.keys(o).length > 1);

  return nights.length || days.length ? { nights, days } : null;
}
