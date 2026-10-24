// PerForm: the Nutrition tab's logic — what was eaten, against which targets, around which
// workout. Pure helpers over the state; the views and sheets only render what these return.
//
// State (both maps merge across devices one key at a time, lib/sync-merge.js PER_KEY):
//   S.food = { [iso]: { items: [{ id, food, g, pcs?, meal, plan? }], sum, water: ml, supps: { [id]: true }, type?: 'training'|'rest' } }
//     an item is grams of one food in one meal of the day; `pcs` when it was counted in pieces,
//     `plan` when it was logged from the day plan's slot of that meal ("Eaten as planned").
//     `sum` is the day's totals as logged ({ kcal, p, c, f, fb }, rounded), kept with the day so the
//     AI Coach (api/coach/core/perform-nutrition.js) can read them without the food list.
//   S.nutrition = { targets, water, favs, myFoods, meals, plans, supps, workoutAt }
//     targets: { training: { kcal, p, c, f, fb }, rest: {...} } — plain grams, as the person typed them
//     water: daily target in ml · favs: food ids · myFoods: the person's own foods (per 100 g)
//     meals: saved meals [{ id, name, items: [{ food, g, pcs? }] }]
//     plans: { training: [slot], rest: [slot] }, slot = { meal: key, saved: mealId, at? | before? | after? }
//     supps: [{ id, name, dose, at? | post: true, restAt? }] · workoutAt: usual workout time, minutes
import { FOODS, FOOD_BY_ID } from './perform-foods.js'
import { effectiveRoutines } from './history.js'

export const GLASS_ML = 250
export const DEFAULT_WATER = 3000
export const DEFAULT_WORKOUT_AT = 18 * 60 + 30
export const DEFAULT_TARGETS = {
  training: { kcal: 2600, p: 160, c: 300, f: 75, fb: 30 },
  rest: { kcal: 2300, p: 160, c: 240, f: 75, fb: 30 },
}
// The meals of a day, at their usual times. Pre- and post-workout exist on training days only,
// timed from the workout.
export const MEAL_KEYS = ['breakfast', 'lunch', 'snack', 'dinner', 'pre', 'post']
export const MEAL_AT = { breakfast: 8 * 60, lunch: 13 * 60, snack: 16 * 60 + 30, dinner: 20 * 60 + 30 }
export const PRE_BEFORE = 90
export const POST_AFTER = 60
// A meal this close to the workout is tagged pre- or post-workout.
export const AROUND_WORKOUT = 180
// An anchored meal never lands before this, whatever the workout time.
const EARLIEST = 6 * 60
const KCAL = { p: 4, c: 4, f: 9, fb: 2 }

const isMap = x => !!x && typeof x === 'object' && !Array.isArray(x)
const list = x => (Array.isArray(x) ? x : [])
const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0)

/** The nutrition settings with their defaults filled in. */
export function nutritionOf(S) {
  const n = isMap(S?.nutrition) ? S.nutrition : {}
  const t = isMap(n.targets) ? n.targets : {}
  return {
    targets: {
      training: { ...DEFAULT_TARGETS.training, ...(isMap(t.training) ? t.training : {}) },
      rest: { ...DEFAULT_TARGETS.rest, ...(isMap(t.rest) ? t.rest : {}) },
    },
    water: num(n.water) > 0 ? num(n.water) : DEFAULT_WATER,
    favs: list(n.favs),
    myFoods: list(n.myFoods).filter(f => f && f.id),
    meals: list(n.meals).filter(m => m && m.id),
    plans: { training: list(n.plans?.training), rest: list(n.plans?.rest) },
    supps: list(n.supps).filter(x => x && x.id),
    workoutAt: Number.isFinite(n.workoutAt) ? n.workoutAt : DEFAULT_WORKOUT_AT,
  }
}

/** One day's log, empty when nothing was logged. */
export function dayOf(S, iso) {
  const d = isMap(S?.food) && isMap(S.food[iso]) ? S.food[iso] : {}
  return { items: list(d.items), water: num(d.water), supps: isMap(d.supps) ? d.supps : {}, type: d.type === 'training' || d.type === 'rest' ? d.type : null }
}

/* ------------------------------------------------------------------ foods -- */

/** The person's own foods first (marked `mine`), then the built-in list. Hidden own foods (deleted
 *  ones, kept so the days that logged them still add up) are left out unless asked for. */
export function allFoods(S, { hidden = false } = {}) {
  const mine = nutritionOf(S).myFoods.filter(f => hidden || !f.hidden).map(f => ({ ...f, mine: true }))
  return [...mine, ...FOODS]
}
export function foodOf(S, id) {
  const mine = nutritionOf(S).myFoods.find(f => f.id === id)
  return mine ? { ...mine, mine: true } : FOOD_BY_ID.get(id) || null
}

const isPt = lang => String(lang || '').toLowerCase().startsWith('pt')
/** The food's name in the app's language (Portuguese or English); the person's own foods have one. */
export const foodName = (f, lang) => (f.mine ? f.name : isPt(lang) ? f.pt : f.en)
/** The other language's name, shown under the first. */
export const foodAlt = (f, lang) => (f.mine ? '' : isPt(lang) ? f.en : f.pt)
/** "2 apples" / "1 maçã" */
export function pieceText(f, n, lang) {
  const p = f.piece
  if (!p) return ''
  const word = isPt(lang) ? (n === 1 ? p.pt1 : p.ptN) : (n === 1 ? p.one : p.many)
  return `${fmtAmount(n)} ${word || ''}`.trim()
}
const fmtAmount = n => String(Math.round(n * 100) / 100)

const plain = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[,()/]/g, ' ')
const hay = f => plain([f.en, f.pt, f.name].filter(Boolean).join(' '))

/** Foods matching every word typed, in either language and any order, accents ignored: "rice"
 *  finds raw rice first, "cooked rice" or "arroz cozido" the cooked one. Favourites come first,
 *  then foods as bought, then the shorter (plainer) names. `filter`: all | fav | mine. */
export function searchFoods(S, q, filter = 'all') {
  const favs = new Set(nutritionOf(S).favs)
  const words = plain(q).split(/\s+/).filter(Boolean)
  let pool = allFoods(S)
  if (filter === 'fav') pool = pool.filter(f => favs.has(f.id))
  else if (filter === 'mine') pool = pool.filter(f => f.mine)
  const found = words.length ? pool.filter(f => { const h = hay(f); return words.every(w => h.includes(w)) }) : pool
  const rank = f => [favs.has(f.id) ? 0 : 1, words.length ? (f.raw || f.mine ? 0 : 1) : 0, words.length ? (f.en || f.name || '').length : 0]
  return found
    .map((f, i) => ({ f, r: rank(f), i }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.r[2] - b.r[2] || a.i - b.i)
    .map(x => x.f)
}

/** kcal, protein, carbs, fat and fibre in `g` grams of food `f` (its values are per 100 g). */
export function macrosOf(f, g) {
  const k = num(g) / 100
  if (!f) return { kcal: 0, p: 0, c: 0, f: 0, fb: 0 }
  return { kcal: num(f.k) * k, p: num(f.p) * k, c: num(f.c) * k, f: num(f.f) * k, fb: num(f.fb) * k }
}
export const zero = () => ({ kcal: 0, p: 0, c: 0, f: 0, fb: 0 })
export function addTo(sum, m) {
  for (const k of ['kcal', 'p', 'c', 'f', 'fb']) sum[k] += m[k]
  return sum
}
export function sumItems(S, items) {
  return list(items).reduce((sum, it) => addTo(sum, macrosOf(foodOf(S, it.food), it.g)), zero())
}
/** Calories the macros stand for (4/4/9 per gram, fibre 2): what a typed-in food's kcal defaults to. */
export const kcalFromMacros = m => num(m.p) * KCAL.p + num(m.c) * KCAL.c + num(m.f) * KCAL.f + num(m.fb) * KCAL.fb
/** Each macro's share of `kcal`, in whole percent: { p, c, f }. */
export function macroShares(m, kcal = m.kcal) {
  const of = x => (kcal > 0 ? Math.round((num(x) * 100) / kcal) : 0)
  return { p: of(num(m.p) * KCAL.p), c: of(num(m.c) * KCAL.c), f: of(num(m.f) * KCAL.f) }
}
/** The macro a food (or meal) gets most of its calories from: 'p', 'c' or 'f' — its icon's tint. */
export function mainMacro(m) {
  const p = num(m.p) * KCAL.p, c = num(m.c) * KCAL.c, f = num(m.f) * KCAL.f
  return p >= c && p >= f ? 'p' : c >= f ? 'c' : 'f'
}

/* ----------------------------------------------------------- day and plan -- */

/** The workout of a day: the one logged (its real start and length), or else the Plan's routines
 *  at the usual workout time. null on a day with neither. */
export function workoutOf(S, iso, now = Date.now()) {
  const logged = list(S?.workouts).filter(w => w && w.d === iso && w.start > 0).sort((a, b) => a.start - b.start)[0]
  if (logged) {
    const d = new Date(logged.start)
    const mins = logged.end > logged.start ? Math.round((logged.end - logged.start) / 60000) : usualLength(S)
    return { name: logged.name || '', at: d.getHours() * 60 + d.getMinutes(), mins, done: true }
  }
  const active = S?.active && S.active.d === iso && S.active.start > 0 && !S.active.editingWorkoutId ? S.active : null
  if (active) {
    const d = new Date(active.start)
    return { name: active.name || '', at: d.getHours() * 60 + d.getMinutes(), mins: Math.max(usualLength(S), Math.round((now - active.start) / 60000)), done: false, live: true }
  }
  const routines = S?.routines ? effectiveRoutines(S, iso) : []
  if (!routines.length) return null
  return { name: routines.map(r => r.name).join(' + '), at: nutritionOf(S).workoutAt, mins: usualLength(S), done: false }
}
// How long a workout usually takes: the median of the last ten logged, an hour without any.
function usualLength(S) {
  const lens = list(S?.workouts).filter(w => w && w.end > w.start).slice(-10).map(w => (w.end - w.start) / 60000).filter(m => m >= 10 && m <= 240).sort((a, b) => a - b)
  return lens.length ? Math.round(lens[Math.floor(lens.length / 2)]) : 60
}

/** 'training' or 'rest' for a day: the person's own choice for it, else whether it has a workout. */
export function dayType(S, iso) {
  const own = dayOf(S, iso).type
  if (own) return own
  return workoutOf(S, iso) ? 'training' : 'rest'
}
export const targetsFor = (S, iso) => nutritionOf(S).targets[dayType(S, iso)]

/** When a slot of the day plan falls, in minutes: its fixed time, or its distance from the
 *  workout. A slot tied to a workout on a day without one keeps its meal's usual time. */
export function slotTime(slot, workout) {
  const key = slot?.meal
  if (workout && slot?.before != null) return Math.max(EARLIEST, workout.at - num(slot.before))
  if (workout && slot?.after != null) return workout.at + workout.mins + num(slot.after)
  if (Number.isFinite(slot?.at)) return slot.at
  if (key === 'pre') return workout ? Math.max(EARLIEST, workout.at - PRE_BEFORE) : MEAL_AT.snack
  if (key === 'post') return workout ? workout.at + workout.mins + POST_AFTER : MEAL_AT.dinner
  return MEAL_AT[key] ?? MEAL_AT.snack
}

/** 'pre', 'post' or null: a meal eaten up to three hours before the workout or after it ends. */
export function aroundWorkout(at, workout) {
  if (!workout) return null
  if (at <= workout.at && workout.at - at <= AROUND_WORKOUT) return 'pre'
  const end = workout.at + workout.mins
  if (at >= end && at - end <= AROUND_WORKOUT) return 'post'
  return null
}

/** The day plan for a type, its slots in meal order with the saved meal each one names. */
export function planOf(S, type) {
  const n = nutritionOf(S)
  return list(n.plans[type]).filter(s => s && MEAL_KEYS.includes(s.meal) && (type === 'training' || (s.meal !== 'pre' && s.meal !== 'post')))
    .map(s => ({ ...s, savedMeal: n.meals.find(m => m.id === s.saved) || null }))
}

/**
 * Everything the Nutrition tab shows for one day, in time order:
 *   meals — { key, at, items (with their macros), sum, tag ('pre'|'post'|null), slot (the day plan's,
 *             with its saved meal and totals) | null, planned (the slot is still to be eaten) }
 *   workout — the day's workout or null · empty — the meals with nothing logged or planned
 */
export function dayView(S, iso) {
  const day = dayOf(S, iso)
  const type = dayType(S, iso)
  const workout = workoutOf(S, iso)
  const slots = planOf(S, type)
  const keys = MEAL_KEYS.filter(k => type === 'training' || (k !== 'pre' && k !== 'post') || day.items.some(it => it.meal === k))
  const meals = keys.map(key => {
    const slot = slots.find(s => s.meal === key) || null
    const items = day.items.filter(it => (MEAL_KEYS.includes(it.meal) ? it.meal : 'snack') === key)
      .map(it => { const food = foodOf(S, it.food); return { ...it, foodObj: food, m: macrosOf(food, it.g) } })
    const sum = items.reduce((s, it) => addTo(s, it.m), zero())
    const at = slot ? slotTime(slot, workout) : (key === 'pre' || key === 'post') ? slotTime({ meal: key }, workout) : MEAL_AT[key]
    const tag = key === 'pre' || key === 'post' ? key : aroundWorkout(at, workout)
    const slotSum = slot?.savedMeal ? sumItems(S, slot.savedMeal.items) : null
    // still to eat: nothing logged in that meal yet (eating something else instead settles it too)
    const planned = !!slot?.savedMeal && !items.length
    return { key, at, items, sum, tag, slot: slot ? { ...slot, sum: slotSum } : null, planned }
  })
  const shown = meals.filter(m => m.items.length || m.planned)
  const empty = meals.filter(m => !m.items.length && !m.planned && (m.key !== 'pre' && m.key !== 'post' ? true : !!workout))
  const total = meals.reduce((s, m) => addTo(s, m.sum), zero())
  return { iso, type, workout, meals: shown.sort((a, b) => a.at - b.at), empty, total, water: day.water }
}

/** The meal something added now most likely belongs to, by the time of day. */
export function mealByTime(minutes, type = 'rest', workout = null) {
  if (type === 'training' && workout) {
    const tag = aroundWorkout(minutes, workout)
    if (tag === 'pre' && workout.at - minutes <= PRE_BEFORE + 30) return 'pre'
    if (tag === 'post' && minutes - (workout.at + workout.mins) <= POST_AFTER + 30) return 'post'
  }
  if (minutes < 11 * 60) return 'breakfast'
  if (minutes < 15 * 60 + 30) return 'lunch'
  if (minutes < 19 * 60) return 'snack'
  return 'dinner'
}

/* --------------------------------------------------------------- planning -- */

/** The day plan of a type as a timeline (Plan › Meals): slots with their time, kcal and macros,
 *  the workout and the supplements, in time order. */
export function planTimeline(S, type, workoutAt = nutritionOf(S).workoutAt) {
  const workout = type === 'training' ? { name: '', at: workoutAt, mins: usualLength(S) } : null
  const rows = planOf(S, type).map(s => ({
    kind: 'meal', key: s.meal, at: slotTime(s, workout), slot: s,
    sum: s.savedMeal ? sumItems(S, s.savedMeal.items) : zero(),
  }))
  if (workout) rows.push({ kind: 'workout', at: workout.at, mins: workout.mins })
  for (const sp of nutritionOf(S).supps) rows.push({ kind: 'supp', at: suppTime(sp, type, workout, S) + 0.5, supp: sp })
  rows.sort((a, b) => a.at - b.at)
  const total = rows.filter(r => r.kind === 'meal').reduce((s, r) => addTo(s, r.sum), zero())
  return { rows: rows.map(r => ({ ...r, at: Math.floor(r.at) })), total, workout }
}

/** When a supplement is taken: its own time, or with the post-workout meal on a training day
 *  (its rest-day time, else breakfast, on the others). */
export function suppTime(sp, type, workout, S) {
  if (sp.post) {
    if (type === 'training' && workout) {
      const post = S ? planOf(S, 'training').find(s => s.meal === 'post') : null
      return slotTime(post || { meal: 'post' }, workout)
    }
    return Number.isFinite(sp.restAt) ? sp.restAt : MEAL_AT.breakfast
  }
  return Number.isFinite(sp.at) ? sp.at : MEAL_AT.breakfast
}

/** Days in a row up to `iso` with the supplement ticked. A day not ticked yet doesn't break it:
 *  the count runs from the day before. */
export function suppStreak(S, id, iso) {
  const ticked = d => !!dayOf(S, d).supps[id]
  let d = ticked(iso) ? iso : shift(iso, -1)
  let n = 0
  while (ticked(d) && n < 3650) { n++; d = shift(d, -1) }
  return n
}

/* ---------------------------------------------------------------- history -- */

export function shift(iso, days) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/** Averages over the logged days among the `days` up to `iso` — a day with no food logged is left
 *  out, not counted as zero. { days, kcal, p, c, f, fb, water, target } (target: the average target
 *  of those days). null when nothing was logged. */
export function averages(S, iso, days = 7) {
  const sum = zero(), tgt = zero()
  let n = 0, water = 0, wn = 0
  for (let i = 0; i < days; i++) {
    const d = shift(iso, -i)
    const day = dayOf(S, d)
    if (day.water > 0) { water += day.water; wn++ }
    if (!day.items.length) continue
    n++
    addTo(sum, sumItems(S, day.items))
    addTo(tgt, targetsFor(S, d))
  }
  if (!n && !wn) return null
  const avg = x => (n ? x / n : 0)
  return {
    days: n, kcal: avg(sum.kcal), p: avg(sum.p), c: avg(sum.c), f: avg(sum.f), fb: avg(sum.fb),
    water: wn ? water / wn : 0,
    target: { kcal: avg(tgt.kcal), p: avg(tgt.p), c: avg(tgt.c), f: avg(tgt.f), fb: avg(tgt.fb) },
  }
}

/* --------------------------------------------------------------- changes -- */
// Each takes the draft state of a store update (useStore update) and changes it in place.

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

function dayDraft(s, iso) {
  if (!isMap(s.food)) s.food = {}
  const d = isMap(s.food[iso]) ? { ...s.food[iso] } : {}
  d.items = list(d.items).slice()
  s.food = { ...s.food, [iso]: d }
  return d
}
// The day's totals, stored beside its items (see `sum` above).
function resum(s, iso) {
  const d = s.food?.[iso]
  if (!d) return
  const items = list(d.items)
  if (!items.length) { delete d.sum; return }
  const m = sumItems(s, items)
  d.sum = { kcal: Math.round(m.kcal), p: Math.round(m.p), c: Math.round(m.c), f: Math.round(m.f), fb: Math.round(m.fb) }
}
// A day that holds nothing any more is taken out, so the log only has days with something in them.
function tidy(s, iso) {
  resum(s, iso)
  const d = s.food?.[iso]
  if (!d) return
  if (!list(d.items).length && !num(d.water) && !Object.keys(isMap(d.supps) ? d.supps : {}).length && !d.type) {
    const { [iso]: _gone, ...rest } = s.food
    s.food = rest
  }
}
export function nutritionDraft(s) {
  s.nutrition = isMap(s.nutrition) ? { ...s.nutrition } : {}
  return s.nutrition
}

/** Adds grams of a food to a meal of the day; returns the new item's id. */
export function addItem(s, iso, { food, g, pcs, meal, plan }) {
  const d = dayDraft(s, iso)
  const it = { id: newId(), food, g: Math.round(num(g) * 10) / 10, meal: MEAL_KEYS.includes(meal) ? meal : 'snack' }
  if (pcs) it.pcs = pcs
  if (plan) it.plan = plan
  d.items.push(it)
  resum(s, iso)
  return it.id
}
export function updateItem(s, iso, id, change) {
  const d = dayDraft(s, iso)
  d.items = d.items.map(it => {
    if (it.id !== id) return it
    const next = { ...it, ...change, g: Math.round(num(change.g ?? it.g) * 10) / 10 }
    if (!change.pcs) delete next.pcs
    return next
  })
  resum(s, iso)
}
export function removeItem(s, iso, id) {
  const d = dayDraft(s, iso)
  d.items = d.items.filter(it => it.id !== id)
  tidy(s, iso)
}
/** A saved meal's foods into a meal of the day. `plan`: logged from the day plan's slot. */
export function logSavedMeal(s, iso, saved, meal, plan) {
  for (const it of list(saved?.items)) addItem(s, iso, { food: it.food, g: it.g, pcs: it.pcs, meal, plan: plan ? meal : undefined })
}
/** Takes back what "Eaten as planned" logged for a meal. */
export function unlogPlanned(s, iso, meal) {
  const d = dayDraft(s, iso)
  d.items = d.items.filter(it => !(it.plan === meal && it.meal === meal))
  tidy(s, iso)
}
/** Everything eaten on `from`, added to `to` (Copy yesterday). Returns how many foods. */
export function copyDay(s, from, to) {
  const src = dayOf(s, from).items
  for (const it of src) addItem(s, to, { food: it.food, g: it.g, pcs: it.pcs, meal: it.meal })
  return src.length
}
export function addWater(s, iso, ml) {
  const d = dayDraft(s, iso)
  d.water = Math.max(0, num(d.water) + ml)
  if (!d.water) delete d.water
  tidy(s, iso)
}
export function toggleSupp(s, iso, id) {
  const d = dayDraft(s, iso)
  const supps = { ...(isMap(d.supps) ? d.supps : {}) }
  if (supps[id]) delete supps[id]; else supps[id] = true
  if (Object.keys(supps).length) d.supps = supps; else delete d.supps
  tidy(s, iso)
}
/** The person's own call on a day: 'training', 'rest', or null to follow the Plan again. */
export function setDayType(s, iso, type) {
  const d = dayDraft(s, iso)
  if (type) d.type = type; else delete d.type
  tidy(s, iso)
}
export function toggleFav(s, id) {
  const n = nutritionDraft(s)
  const favs = list(n.favs)
  n.favs = favs.includes(id) ? favs.filter(x => x !== id) : [...favs, id]
}
export function setTargets(s, type, targets) {
  const n = nutritionDraft(s)
  const cur = nutritionOf(s).targets
  n.targets = { ...cur, [type]: { ...cur[type], ...targets } }
}
/** Saves the person's own food (per 100 g); a new one gets an id. Returns the id. */
export function saveMyFood(s, food) {
  const n = nutritionDraft(s)
  const id = food.id || 'my_' + newId()
  const clean = { id, name: String(food.name || '').trim(), k: num(food.k), p: num(food.p), c: num(food.c), f: num(food.f), fb: num(food.fb), icon: food.icon || 'bowl' }
  if (num(food.piece?.g) > 0) clean.piece = { g: num(food.piece.g), one: food.piece.one || '', many: food.piece.many || food.piece.one || '', pt1: food.piece.one || '', ptN: food.piece.many || food.piece.one || '' }
  const mine = list(n.myFoods)
  n.myFoods = mine.some(f => f.id === id) ? mine.map(f => (f.id === id ? clean : f)) : [...mine, clean]
  return id
}
/** An own food is hidden, not deleted: the days that logged it keep adding up. */
export function hideMyFood(s, id) {
  const n = nutritionDraft(s)
  n.myFoods = list(n.myFoods).map(f => (f.id === id ? { ...f, hidden: true } : f))
  n.favs = list(n.favs).filter(x => x !== id)
}
export function saveMeal(s, meal) {
  const n = nutritionDraft(s)
  const id = meal.id || 'meal_' + newId()
  const clean = { id, name: String(meal.name || '').trim(), items: list(meal.items).map(it => ({ food: it.food, g: num(it.g), ...(it.pcs ? { pcs: it.pcs } : {}) })) }
  const meals = list(n.meals)
  n.meals = meals.some(m => m.id === id) ? meals.map(m => (m.id === id ? clean : m)) : [...meals, clean]
  return id
}
export function deleteMeal(s, id) {
  const n = nutritionDraft(s)
  n.meals = list(n.meals).filter(m => m.id !== id)
  const plans = nutritionOf(s).plans
  n.plans = { training: plans.training.filter(x => x.saved !== id), rest: plans.rest.filter(x => x.saved !== id) }
}
/** Puts a slot in a day plan (one per meal of the day), or takes it out with `slot` null. */
export function setSlot(s, type, meal, slot) {
  const n = nutritionDraft(s)
  const plans = nutritionOf(s).plans
  const rest = plans[type].filter(x => x.meal !== meal)
  const next = slot ? [...rest, { ...slot, meal }] : rest
  next.sort((a, b) => MEAL_KEYS.indexOf(a.meal) - MEAL_KEYS.indexOf(b.meal))
  n.plans = { ...plans, [type]: next }
}
export function saveSupp(s, sp) {
  const n = nutritionDraft(s)
  const id = sp.id || 'supp_' + newId()
  const clean = { id, name: String(sp.name || '').trim(), dose: String(sp.dose || '').trim() }
  if (sp.post) { clean.post = true; if (Number.isFinite(sp.restAt)) clean.restAt = sp.restAt } else clean.at = Number.isFinite(sp.at) ? sp.at : MEAL_AT.breakfast
  const supps = list(n.supps)
  n.supps = supps.some(x => x.id === id) ? supps.map(x => (x.id === id ? clean : x)) : [...supps, clean]
  return id
}
export function deleteSupp(s, id) {
  const n = nutritionDraft(s)
  n.supps = list(n.supps).filter(x => x.id !== id)
}

/* ------------------------------------------------------------------ text -- */

export const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(Math.round(m % 60)).padStart(2, '0')
export function fromHHMM(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ''))
  return m ? Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]) : null
}
