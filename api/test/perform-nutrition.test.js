// PerForm: what the athlete ate in the Coach's payload (the `nutrition` category).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nutritionOf, MAX_NUTRITION_DAYS } from '../coach/core/perform-nutrition.js';

const S = {
  food: {
    '2026-10-20': { items: [{ id: 'a', food: 'my_secret_bar', g: 60, meal: 'snack' }], sum: { kcal: 2412.4, p: 151, c: 280, f: 70, fb: 26 }, water: 2500, supps: { s1: true } },
    '2026-10-21': { water: 1000, type: 'rest' },
    '2026-10-22': { type: 'training' },
    '2026-10-23': { items: [{ id: 'b', food: 'oats', g: 60, meal: 'breakfast' }], sum: { kcal: 233, p: 10, c: 33, f: 4, fb: 6 }, supps: { s1: true, gone: true } },
  },
  nutrition: {
    targets: { training: { kcal: 2600, p: 160, c: 300, f: 75, fb: 30 }, rest: { kcal: 2300, p: 160 } },
    water: 3000,
    supps: [{ id: 's1', name: 'Creatine', dose: '5 g', post: true }],
    myFoods: [{ id: 'my_secret_bar', name: 'Secret bar' }],
  },
};

test('per day the totals, water and supplements, and the targets — not the foods', () => {
  const r = nutritionOf(S, '2026-10-20', '2026-10-22');
  assert.deepEqual(r, {
    targets: { training: { kcal: 2600, p: 160, c: 300, f: 75, fb: 30 }, rest: { kcal: 2300, p: 160 }, water: 3000 },
    supplements: [{ name: 'Creatine', dose: '5 g' }],
    days: [
      { d: '2026-10-20', kcal: 2412, p: 151, c: 280, f: 70, fb: 26, water: 2500, supps: ['Creatine'] },
      { d: '2026-10-21', water: 1000, type: 'rest' },
    ],
  });
  assert.ok(!JSON.stringify(r).includes('secret'));
});

test('a supplement no longer set up is left out; nothing logged sends nothing', () => {
  assert.deepEqual(nutritionOf(S, '2026-10-23', null).days, [{ d: '2026-10-23', kcal: 233, p: 10, c: 33, f: 4, fb: 6, supps: ['Creatine'] }]);
  assert.equal(nutritionOf(S, '2026-11-01', null), null);
  assert.equal(nutritionOf({}, null, null), null);
});

test('at most the last MAX_NUTRITION_DAYS days', () => {
  const food = {};
  for (let i = 0; i < MAX_NUTRITION_DAYS + 10; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    food[d] = { water: 500 };
  }
  const r = nutritionOf({ food }, null, null);
  assert.equal(r.days.length, MAX_NUTRITION_DAYS);
  assert.equal(r.days.at(-1).d, Object.keys(food).sort().at(-1));
});
