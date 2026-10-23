/* PerForm: what the athlete ate, for the Coach (the `nutrition` data category).
 *
 * The Nutrition tab logs food into S.food per day and keeps each day's totals beside its items
 * (frontend/src/lib/perform-nutrition.js, `sum`); the targets, water target and supplements live
 * in S.nutrition. This copies a bounded slice into the payload, by name like the rest of
 * payload.js: per day the calories, protein, carbs, fat and fibre eaten, the water drunk, the
 * supplements ticked off and the day type when the athlete set it; and the targets for training
 * and rest days. Not the single foods, not the meal times, not the person's own food names.
 *
 * Kept out of payload.js so the fork's change to that upstream file stays one call per review
 * kind; see .claude/CLAUDE.md.
 */
export const MAX_NUTRITION_DAYS = 84;

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const n = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);
const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const MACROS = ['kcal', 'p', 'c', 'f', 'fb'];

function macros(src) {
  const o = {};
  for (const k of MACROS) if (n(src?.[k]) !== undefined) o[k] = n(src[k]);
  return o;
}

/**
 * { targets: { training, rest, water }, supplements: [{ name, dose }], days: [{ d, kcal, p, c, f,
 * fb, water, supps, type }] } for the days from `from` to `to` (inclusive, either may be null), the
 * last MAX_NUTRITION_DAYS of them. A day carries only what was logged on it. null when nothing was
 * logged there, so a profile that does not log food sends nothing at all.
 */
export function nutritionOf(S, from, to) {
  const food = isMap(S?.food) ? S.food : null;
  if (!food) return null;
  const inRange = d => isDay(d) && (!from || d >= from) && (!to || d <= to);
  const nu = isMap(S?.nutrition) ? S.nutrition : {};
  const supps = (Array.isArray(nu.supps) ? nu.supps : []).filter(x => isMap(x) && x.id);
  const nameOf = new Map(supps.map(x => [x.id, String(x.name || '').slice(0, 40)]));

  const days = Object.keys(food).filter(inRange).sort().slice(-MAX_NUTRITION_DAYS).map(d => {
    const v = isMap(food[d]) ? food[d] : {};
    const o = { d };
    if (Array.isArray(v.items) && v.items.length && isMap(v.sum)) Object.assign(o, macros(v.sum));
    if (n(v.water)) o.water = n(v.water);
    const taken = Object.keys(isMap(v.supps) ? v.supps : {}).filter(id => v.supps[id] && nameOf.has(id)).map(id => nameOf.get(id));
    if (taken.length) o.supps = taken;
    if (v.type === 'training' || v.type === 'rest') o.type = v.type;
    return o;
  }).filter(o => Object.keys(o).some(k => k !== 'd' && k !== 'type'));
  if (!days.length) return null;

  const t = isMap(nu.targets) ? nu.targets : {};
  const out = { targets: {}, days };
  for (const k of ['training', 'rest']) if (isMap(t[k])) out.targets[k] = macros(t[k]);
  if (n(nu.water)) out.targets.water = n(nu.water);
  if (supps.length) out.supplements = supps.map(x => ({ name: nameOf.get(x.id), dose: String(x.dose || '').slice(0, 20) }));
  return out;
}
