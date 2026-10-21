// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import PerformRunDetails from './PerformRunDetails.jsx'

// PerForm: a watch workout's route, splits and curves on its detail sheet.
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const series = n => Array.from({ length: n }, (_, i) => i)
const w = details => ({ id: 'hc-r1', d: '2026-10-21', start: 0, end: 2053000, src: 'health-connect', watch: { hrAvg: 155 }, entries: [], details })
const mount = workout => {
  useStore.setState(s => ({ S: { ...s.S, workouts: [workout] } }))
  act(() => root.render(<PerformRunDetails w={workout} toast={() => {}} />))
}

describe('PerformRunDetails', () => {
  it('shows the totals, the route, the splits and the curves', () => {
    mount(w({
      v: 1, km: 4.87, sec: 2053, gain: 21, spm: 165,
      splits: [{ km: 1, sec: 417, hr: 148, elev: 4 }, { km: 1, sec: 410, hr: 156, elev: -2 }, { km: 0.87, sec: 380, hr: 165 }],
      series: { t: series(60).map(i => i * 34), pace: series(60).map(i => 400 + i), hr: series(60).map(i => 140 + i / 2) },
      route: [[38.7, -9.14], [38.71, -9.14], [38.71, -9.13]],
    }))
    const text = host.textContent
    expect(text).toContain('Advanced details')
    expect(text).toContain('4.87 km')
    expect(text).toContain('7:02 /km')   // 2053 s over 4.87 km
    expect(text).toContain('155 bpm')
    expect(text).toContain('165 spm')
    expect(text).toContain('6:57')       // the first split
    expect(text).toContain('+4 m')
    expect(text).toContain('2.87')       // where the last, shorter split ends
    expect(host.querySelectorAll('svg path')).toHaveLength(1)
    expect(host.querySelectorAll('polyline')).toHaveLength(2)
  })

  it('the pace curve leaves out the stand-still at the end', () => {
    mount(w({ v: 1, km: 4.87, sec: 2053, splits: [], series: { t: [0, 1, 2, 3, 4, 5], pace: [420, 400, 410, 415, 405, 1035] } }))
    expect(host.textContent).not.toContain('17:15')
  })

  it('nothing for a workout without details', () => {
    mount(w(undefined))
    expect(host.textContent).toBe('')
    mount(w({ v: 1, none: true }))
    expect(host.textContent).toBe('')
  })

  it('says where to allow a route Health Connect holds back', () => {
    mount(w({ v: 1, km: 1, sec: 400, splits: [], series: { t: [] }, route: null, routeConsent: true }))
    expect(host.textContent).toContain('Android app to allow its route')
  })

  it('a PB the run set, and its time in each heart-rate zone', () => {
    const today = new Date().toISOString().slice(0, 10)
    useStore.setState(s => ({ S: { ...s.S, running: { maxHr: 182 }, health: { days: { [today]: { rhr: 52 } } } } }))
    const run = { ...w({ v: 4, km: 5.02, sec: 1800, splits: [], series: { t: [] }, route: null, best: { 1000: 330, 5000: 1750 }, hrs: { 125: 600, 160: 1200 } }),
      start: Date.now() - 3600000, entries: [{ id: '0685', sets: [] }] }
    mount(run)
    const text = host.textContent
    expect(text).toContain('New 5 km best: 29:10')
    expect(text).toContain('Longest run: 5.02 km')
    expect(text).toContain('Heart-rate zones')
    expect(text).toContain('67%')       // 1200 of 1800 s in zone 4
    useStore.setState(s => ({ S: { ...s.S, running: undefined, health: undefined } }))
  })
})
