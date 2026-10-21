// PerForm: the watch's sleep and recovery in the Coach's payload (the `recovery` category).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryOf, MAX_RECOVERY_DAYS } from '../coach/core/perform-recovery.js';
import { build as buildPayload } from '../coach/core/payload.js';

const health = {
  days: {
    '2026-10-19': { steps: 9000, hrMin: 45, rhr: 48, hrv: 41.25 },
    '2026-10-20': { steps: 12000, rhr: 47 },
    '2026-10-21': { steps: 7000, rhr: 52, hrv: 30 },
  },
  sleep: [
    { id: 'n1', d: '2026-10-20', start: 1, end: 8 * 3600000, asleep: 410, deep: 70, light: 230, rem: 90, awake: 20, src: 'com.fitbit' },
    { id: 'nap', d: '2026-10-20', start: 0, end: 1800000, asleep: 30 },
    { id: 'n2', d: '2026-10-21', start: 1, end: 6 * 3600000, asleep: 330, deep: 40, rem: 60, awake: 30 },
  ],
  sessions: [{ id: 'r1', d: '2026-10-21', start: 1, end: 2, type: 'running', hrAvg: 155 }],
  weights: [{ id: 'w', d: '2026-10-21', time: 1, kg: 80 }],
  imported: ['w'],
};

test('a night per day and the day values, by name, nothing else', () => {
  const r = recoveryOf({ health }, '2026-10-20', '2026-10-21');
  assert.deepEqual(r, {
    nights: [{ d: '2026-10-20', asleep: 410, deep: 70, rem: 90, awake: 20 }, { d: '2026-10-21', asleep: 330, deep: 40, rem: 60, awake: 30 }],
    days: [{ d: '2026-10-20', rhr: 47, steps: 12000 }, { d: '2026-10-21', rhr: 52, hrv: 30, steps: 7000 }],
  });
  assert.ok(!JSON.stringify(r).includes('fitbit'));
});

test('nothing when there is no watch data', () => {
  assert.equal(recoveryOf({}, null, null), null);
  assert.equal(recoveryOf({ health: { days: {}, sleep: [] } }, null, null), null);
});

test('bounded to the last MAX_RECOVERY_DAYS days', () => {
  const days = {};
  for (let i = 0; i < 200; i++) days[new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)] = { rhr: 50 };
  assert.equal(recoveryOf({ health: { days } }, null, null).days.length, MAX_RECOVERY_DAYS);
});

test('a review payload carries it, and one without watch data does not', () => {
  const S = {
    unit: 'kg', routines: [], customEx: [], bodyweight: [], health,
    workouts: [{ id: 'a', d: '2026-10-19', start: 1, end: 2, entries: [{ id: '0025', sets: [{ w: 60, r: 5, done: true }] }] }],
  };
  const p = buildPayload(S, { kind: 'review', handle: 'h' });
  assert.deepEqual(p.recovery.days.map(d => d.d), ['2026-10-19', '2026-10-20', '2026-10-21']);
  const q = buildPayload({ ...S, health: undefined }, { kind: 'review', handle: 'h' });
  assert.equal(q.recovery, undefined);
});
