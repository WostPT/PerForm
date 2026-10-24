import { describe, expect, it } from 'vitest'
import { FOODS, FOOD_BY_ID } from './perform-foods.js'
import {
  nutritionOf, dayOf, searchFoods, macrosOf, sumItems, macroShares, mainMacro, kcalFromMacros,
  workoutOf, dayType, targetsFor, slotTime, aroundWorkout, dayView, mealByTime, planTimeline,
  suppTime, suppStreak, averages, shift, addItem, updateItem, removeItem, logSavedMeal, unlogPlanned,
  copyDay, addWater, toggleSupp, setDayType, toggleFav, setTargets, saveMyFood, hideMyFood,
  saveMeal, deleteMeal, setSlot, saveSupp, foodName, foodAlt, pieceText, hhmm, fromHHMM,
  DEFAULT_TARGETS, DEFAULT_WATER, DEFAULT_WORKOUT_AT, MEAL_AT,
} from './perform-nutrition.js'

const base = (extra = {}) => ({ routines: [], week: {}, dayPlan: {}, workouts: [], ...extra })
const at = (iso, h, m = 0) => new Date(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime()
const FRI = '2026-10-23'   // a Friday

const ALCOHOL = new Set(['beer', 'wine_red'])

describe('food list', () => {
  it('has unique ids and sane values per 100 g', () => {
    expect(new Set(FOODS.map(f => f.id)).size).toBe(FOODS.length)
    for (const f of FOODS) {
      expect(f.en && f.pt, f.id).toBeTruthy()
      for (const k of ['k', 'p', 'c', 'f', 'fb']) expect(f[k], `${f.id}.${k}`).toBeGreaterThanOrEqual(0)
      expect(f.p + f.c + f.f + f.fb, f.id).toBeLessThanOrEqual(101)
    }
    // the calories roughly match the macros (4/4/9, fibre 2), so no row has a typo in it; drinks
    // with alcohol (7 kcal/g, not a macro here) aside
    const off = FOODS.filter(f => f.k > 20 && !ALCOHOL.has(f.id) && Math.abs(kcalFromMacros(f) - f.k) / f.k > 0.15)
    expect(off.map(f => f.id)).toEqual([])
  })
})

describe('searchFoods', () => {
  it('finds a food by every word typed, in either language, accents ignored', () => {
    expect(searchFoods(base(), 'arroz cozido')[0].id).toBe('rice_white_cooked')
    expect(searchFoods(base(), 'cooked rice').map(f => f.id)).toContain('rice_white_cooked')
    expect(searchFoods(base(), 'maca')[0].id).toBe('apple')
  })
  it('a plain search gives the food as bought first', () => {
    expect(searchFoods(base(), 'rice')[0].id).toBe('rice_white')
    expect(searchFoods(base(), 'chicken breast')[0].id).toBe('chicken_breast')
  })
  it('puts favourites first and filters to favourites or own foods', () => {
    const S = base({ nutrition: { favs: ['banana'], myFoods: [{ id: 'my_bar', name: 'My bar', k: 350, p: 30, c: 30, f: 10, fb: 5 }] } })
    expect(searchFoods(S, '')[0].id).toBe('banana')
    expect(searchFoods(S, '', 'fav').map(f => f.id)).toEqual(['banana'])
    expect(searchFoods(S, '', 'mine').map(f => f.id)).toEqual(['my_bar'])
    expect(searchFoods(S, 'bar')[0].id).toBe('my_bar')
  })
  it('leaves hidden own foods out', () => {
    const S = base({ nutrition: { myFoods: [{ id: 'my_x', name: 'Gone', k: 100, hidden: true }] } })
    expect(searchFoods(S, 'gone')).toEqual([])
  })
})

describe('macros', () => {
  it('scales the per-100 g values to the grams', () => {
    const m = macrosOf(FOOD_BY_ID.get('chicken_breast_grilled'), 200)
    expect(m.kcal).toBe(330)
    expect(m.p).toBe(62)
  })
  it('sums a meal: 200 g grilled chicken, 300 g cooked rice and 2 apples', () => {
    const items = [{ food: 'chicken_breast_grilled', g: 200 }, { food: 'rice_white_cooked', g: 300 }, { food: 'apple', g: 300, pcs: 2 }]
    const sum = sumItems(base(), items)
    expect(Math.round(sum.kcal)).toBe(330 + 390 + 156)
    expect(Math.round(sum.fb)).toBe(Math.round(1.2 + 7.2))
  })
  it('shows each macro as a share of the calories', () => {
    expect(macroShares({ p: 160, c: 300, f: 75 }, 2600)).toEqual({ p: 25, c: 46, f: 26 })
    expect(macroShares({ p: 0, c: 0, f: 0 }, 0)).toEqual({ p: 0, c: 0, f: 0 })
  })
  it('tints a food by the macro most of its calories come from', () => {
    expect(mainMacro(FOOD_BY_ID.get('chicken_breast'))).toBe('p')
    expect(mainMacro(FOOD_BY_ID.get('rice_white'))).toBe('c')
    expect(mainMacro(FOOD_BY_ID.get('olive_oil'))).toBe('f')
  })
  it('names foods in the app language, pieces included', () => {
    const apple = FOOD_BY_ID.get('apple')
    expect(foodName(apple, 'pt')).toBe('Maçã')
    expect(foodAlt(apple, 'pt')).toBe('Apple')
    expect(foodName(apple, 'en')).toBe('Apple')
    expect(pieceText(apple, 2, 'en')).toBe('2 apples')
    expect(pieceText(apple, 1, 'pt-BR')).toBe('1 maçã')
  })
})

describe('settings', () => {
  it('fills in the defaults', () => {
    const n = nutritionOf({})
    expect(n.targets).toEqual(DEFAULT_TARGETS)
    expect(n.water).toBe(DEFAULT_WATER)
    expect(n.workoutAt).toBe(DEFAULT_WORKOUT_AT)
    expect(dayOf({}, FRI)).toEqual({ items: [], water: 0, supps: {}, type: null })
  })
  it('keeps a target typed for one day type apart from the other', () => {
    const s = base()
    setTargets(s, 'rest', { kcal: 2100 })
    expect(nutritionOf(s).targets.rest.kcal).toBe(2100)
    expect(nutritionOf(s).targets.training.kcal).toBe(DEFAULT_TARGETS.training.kcal)
  })
})

describe('training day and workout', () => {
  const routine = { id: 'r1', name: 'Push', ex: [{ id: 'bench' }] }
  it('reads the Plan: a weekday with a routine is a training day at the usual workout time', () => {
    const S = base({ routines: [routine], week: { 5: ['r1'] } })
    expect(dayType(S, FRI)).toBe('training')
    expect(workoutOf(S, FRI)).toMatchObject({ name: 'Push', at: DEFAULT_WORKOUT_AT, done: false })
    expect(dayType(S, shift(FRI, 1))).toBe('rest')
    expect(targetsFor(S, FRI)).toEqual(DEFAULT_TARGETS.training)
  })
  it('a logged workout gives its real start and length', () => {
    const S = base({ workouts: [{ id: 'w', d: FRI, start: at(FRI, 7, 15), end: at(FRI, 8, 25), name: 'Legs' }] })
    expect(workoutOf(S, FRI)).toMatchObject({ name: 'Legs', at: 7 * 60 + 15, mins: 70, done: true })
    expect(dayType(S, FRI)).toBe('training')
  })
  it('the person can call a day themselves', () => {
    const S = base({ routines: [routine], week: { 5: ['r1'] } })
    setDayType(S, FRI, 'rest')
    expect(dayType(S, FRI)).toBe('rest')
    setDayType(S, FRI, null)
    expect(dayType(S, FRI)).toBe('training')
    expect(S.food[FRI]).toBeUndefined()
  })
})

describe('meal times', () => {
  const workout = { at: 18 * 60 + 30, mins: 70 }
  it('ties a slot to the workout, or keeps its own time', () => {
    expect(slotTime({ meal: 'pre', before: 120 }, workout)).toBe(16 * 60 + 30)
    expect(slotTime({ meal: 'post', after: 60 }, workout)).toBe(20 * 60 + 40)
    expect(slotTime({ meal: 'lunch', at: 12 * 60 }, workout)).toBe(12 * 60)
    expect(slotTime({ meal: 'dinner' }, workout)).toBe(MEAL_AT.dinner)
  })
  it('never puts a meal before 06:00 for an early workout', () => {
    expect(slotTime({ meal: 'pre', before: 120 }, { at: 7 * 60, mins: 60 })).toBe(6 * 60)
  })
  it('tags meals up to three hours around the workout', () => {
    expect(aroundWorkout(16 * 60 + 30, workout)).toBe('pre')
    expect(aroundWorkout(MEAL_AT.dinner, workout)).toBe('post')
    expect(aroundWorkout(MEAL_AT.breakfast, workout)).toBe(null)
    expect(aroundWorkout(12 * 60, null)).toBe(null)
  })
  it('guesses the meal from the time of day', () => {
    expect(mealByTime(7 * 60)).toBe('breakfast')
    expect(mealByTime(13 * 60)).toBe('lunch')
    expect(mealByTime(17 * 60)).toBe('snack')
    expect(mealByTime(21 * 60)).toBe('dinner')
    expect(mealByTime(17 * 60 + 30, 'training', workout)).toBe('pre')
    expect(mealByTime(20 * 60, 'training', workout)).toBe('post')
  })
})

describe('logging', () => {
  it('adds, changes and removes foods; an empty day leaves the log', () => {
    const s = base()
    const id = addItem(s, FRI, { food: 'apple', g: 300, pcs: 2, meal: 'snack' })
    expect(dayOf(s, FRI).items).toEqual([{ id, food: 'apple', g: 300, pcs: 2, meal: 'snack' }])
    // the day keeps its totals beside the items, for the Coach
    expect(s.food[FRI].sum).toEqual({ kcal: 156, p: 1, c: 34, f: 1, fb: 7 })
    updateItem(s, FRI, id, { g: 150 })
    expect(dayOf(s, FRI).items[0]).toMatchObject({ g: 150 })
    expect(s.food[FRI].sum.kcal).toBe(78)
    expect(dayOf(s, FRI).items[0].pcs).toBeUndefined()
    removeItem(s, FRI, id)
    expect(s.food[FRI]).toBeUndefined()
  })
  it('does not change the copy it was handed (the store compares old and new)', () => {
    const before = base({ food: { [FRI]: { items: [{ id: 'a', food: 'apple', g: 150, meal: 'snack' }] } } })
    const s = { ...before }
    addItem(s, FRI, { food: 'banana', g: 120, meal: 'snack' })
    expect(before.food[FRI].items).toHaveLength(1)
    expect(s.food[FRI].items).toHaveLength(2)
  })
  it('water goes up in glasses and never below zero', () => {
    const s = base()
    addWater(s, FRI, 250); addWater(s, FRI, 500)
    expect(dayOf(s, FRI).water).toBe(750)
    addWater(s, FRI, -1000)
    expect(s.food[FRI]).toBeUndefined()
  })
  it('copies a day into another', () => {
    const s = base()
    addItem(s, '2026-10-22', { food: 'oats', g: 60, meal: 'breakfast' })
    addItem(s, '2026-10-22', { food: 'milk_semi', g: 250, meal: 'breakfast' })
    expect(copyDay(s, '2026-10-22', FRI)).toBe(2)
    expect(dayOf(s, FRI).items.map(i => i.food)).toEqual(['oats', 'milk_semi'])
  })
  it('favourites toggle', () => {
    const s = base()
    toggleFav(s, 'yogurt_greek')
    expect(nutritionOf(s).favs).toEqual(['yogurt_greek'])
    toggleFav(s, 'yogurt_greek')
    expect(nutritionOf(s).favs).toEqual([])
  })
  it('an own food deleted is hidden, so the days that logged it still add up', () => {
    const s = base()
    const id = saveMyFood(s, { name: ' Bar ', k: 360, p: 33, c: 30, f: 10, fb: 8, piece: { g: 60, one: 'bar', many: 'bars' } })
    addItem(s, FRI, { food: id, g: 60, pcs: 1, meal: 'snack' })
    hideMyFood(s, id)
    expect(searchFoods(s, 'bar').some(f => f.id === id)).toBe(false)
    expect(Math.round(sumItems(s, dayOf(s, FRI).items).kcal)).toBe(216)
  })
})

describe('day view', () => {
  const routine = { id: 'r1', name: 'Push', ex: [{ id: 'bench' }] }
  const withPlan = () => {
    const s = base({ routines: [routine], week: { 5: ['r1'] } })
    const oats = saveMeal(s, { name: 'Oats', items: [{ food: 'oats', g: 60 }, { food: 'milk_semi', g: 250 }] })
    const post = saveMeal(s, { name: 'Salmon & potatoes', items: [{ food: 'salmon_grilled', g: 180 }, { food: 'potato_boiled', g: 300 }] })
    setSlot(s, 'training', 'breakfast', { saved: oats, at: 8 * 60 })
    setSlot(s, 'training', 'post', { saved: post, after: 60 })
    return { s, oats, post }
  }
  it('orders meals and shows the planned ones still to eat', () => {
    const { s } = withPlan()
    addItem(s, FRI, { food: 'chicken_breast_grilled', g: 200, meal: 'lunch' })
    const v = dayView(s, FRI)
    expect(v.type).toBe('training')
    expect(v.meals.map(m => m.key)).toEqual(['breakfast', 'lunch', 'post'])
    expect(v.meals.find(m => m.key === 'breakfast').planned).toBe(true)
    expect(v.meals.find(m => m.key === 'post').at).toBe(DEFAULT_WORKOUT_AT + 60 + 60)
    expect(v.empty.map(m => m.key)).toEqual(['snack', 'dinner', 'pre'])
    expect(Math.round(v.total.kcal)).toBe(330)
  })
  it('Eaten as planned logs the saved meal; Undo takes it back', () => {
    const { s } = withPlan()
    const breakfast = nutritionOf(s).meals[0]
    logSavedMeal(s, FRI, breakfast, 'breakfast', true)
    let v = dayView(s, FRI)
    expect(v.meals.find(m => m.key === 'breakfast')).toMatchObject({ planned: false })
    expect(v.meals.find(m => m.key === 'breakfast').items).toHaveLength(2)
    unlogPlanned(s, FRI, 'breakfast')
    v = dayView(s, FRI)
    expect(v.meals.find(m => m.key === 'breakfast').planned).toBe(true)
  })
  it('a rest day has no pre- or post-workout meals', () => {
    const { s } = withPlan()
    const sat = shift(FRI, 1)
    const v = dayView(s, sat)
    expect(v.type).toBe('rest')
    expect([...v.meals, ...v.empty].map(m => m.key)).toEqual(['breakfast', 'lunch', 'snack', 'dinner'])
  })
  it('deleting a saved meal takes it out of the plans', () => {
    const { s, post } = withPlan()
    deleteMeal(s, post)
    expect(nutritionOf(s).plans.training.map(x => x.meal)).toEqual(['breakfast'])
  })
})

describe('plan timeline and supplements', () => {
  it('puts meals, the workout and supplements in time order', () => {
    const s = base()
    const m = saveMeal(s, { name: 'Yogurt', items: [{ food: 'yogurt_greek', g: 170 }] })
    setSlot(s, 'training', 'pre', { saved: m, before: 120 })
    setSlot(s, 'training', 'post', { saved: m, after: 60 })
    saveSupp(s, { name: 'Creatine', dose: '5 g', post: true })
    saveSupp(s, { name: 'Magnesium', dose: '300 mg', at: 22 * 60 + 30 })
    const tl = planTimeline(s, 'training', 18 * 60 + 30)
    expect(tl.rows.map(r => r.kind + '@' + hhmm(r.at))).toEqual(['meal@16:30', 'workout@18:30', 'meal@20:30', 'supp@20:30', 'supp@22:30'])
    const rest = planTimeline(s, 'rest')
    expect(rest.rows.map(r => r.kind + '@' + hhmm(r.at))).toEqual(['supp@08:00', 'supp@22:30'])
  })
  it('creatine goes with the post-workout meal, or at its rest-day time', () => {
    const sp = { post: true, restAt: 9 * 60 }
    expect(suppTime(sp, 'training', { at: 18 * 60, mins: 60 })).toBe(20 * 60)
    expect(suppTime(sp, 'rest', null)).toBe(9 * 60)
  })
  it('counts days in a row; today not ticked yet does not break it', () => {
    const s = base()
    for (const d of [shift(FRI, -3), shift(FRI, -2), shift(FRI, -1)]) toggleSupp(s, d, 'creatine')
    expect(suppStreak(s, 'creatine', FRI)).toBe(3)
    toggleSupp(s, FRI, 'creatine')
    expect(suppStreak(s, 'creatine', FRI)).toBe(4)
    expect(suppStreak(s, 'magnesium', FRI)).toBe(0)
  })
})

describe('averages', () => {
  it('averages the logged days only, water apart', () => {
    const s = base()
    addItem(s, FRI, { food: 'rice_white_cooked', g: 100, meal: 'lunch' })
    addItem(s, shift(FRI, -2), { food: 'rice_white_cooked', g: 300, meal: 'lunch' })
    addWater(s, FRI, 2000)
    const a = averages(s, FRI, 7)
    expect(a.days).toBe(2)
    expect(Math.round(a.kcal)).toBe(260)
    expect(a.water).toBe(2000)
    expect(a.target.kcal).toBe(DEFAULT_TARGETS.rest.kcal)
    expect(averages(base(), FRI)).toBe(null)
  })
})

describe('time text', () => {
  it('reads and writes HH:MM', () => {
    expect(hhmm(18 * 60 + 5)).toBe('18:05')
    expect(fromHHMM('07:30')).toBe(450)
    expect(fromHHMM('')).toBe(null)
  })
})
