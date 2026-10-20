// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'
import Health from './Health.jsx'

// PerForm: the watch's data, as the desktop and the phone show it.
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mountWith = health => {
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg', health } }))
  act(() => root.render(<Health />))
}

describe('Health', () => {
  it('says how to turn it on when nothing was read', () => {
    mountWith(undefined)
    expect(host.textContent).toContain('Nothing read yet')
  })

  it('shows last night, resting heart rate, HRV, steps and the watch workouts', () => {
    const d = todayISO()
    const end = new Date(`${d}T07:00:00`).getTime(), start = end - 8 * 3600000
    mountWith({
      days: { [d]: { steps: 4321, rhr: 52, hrv: 41.5 } },
      sleep: [{ id: 'n', d, start, end, asleep: 450, deep: 80, light: 250, rem: 120, awake: 30 }],
      sessions: [{ id: 'r', d, start: start - 86400000, end: start - 86400000 + 1800000, type: 'running', hrAvg: 150, km: 5.2 }],
      weights: [{ id: 'w', d, time: end, kg: 80.4 }],
    })
    const text = host.textContent
    expect(text).toContain('7h 30m')
    expect(text).toContain('52')
    expect(text).toContain('41.5')
    expect(text).toContain('4,321')
    expect(text).toContain('Running')
    expect(text).toContain('5.2 km')
    expect(text).toContain('80.4 kg')
  })
})
