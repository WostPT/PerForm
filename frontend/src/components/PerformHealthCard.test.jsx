// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// PerForm: the "Watch data" section in Settings never goes missing on the Android app: where
// reading cannot work it says why. lib/perform-health-read.js is mocked; its own tests cover it.
const m = vi.hoisted(() => ({ status: { status: 'available', granted: [] }, file: { on: false, granted: [] } }))
vi.mock('../lib/perform-health-read.js', () => ({
  healthReadStatus: async () => m.status, loadHealthRead: async () => m.file,
  enableHealthRead: vi.fn(), disableHealthRead: vi.fn(), readHealthNow: vi.fn(), askHealthReadAgain: vi.fn(),
  onHealthReadChange: () => () => {},
}))
vi.mock('../lib/health-sync.js', () => ({ openHealthConnect: vi.fn(async () => {}) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
import PerformHealthCard from './PerformHealthCard.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = async () => { await act(async () => { root.render(<PerformHealthCard toast={() => {}} />) }) }

describe('PerformHealthCard', () => {
  it('shows the switch where Health Connect is there', async () => {
    m.status = { status: 'available', granted: [] }
    await mount()
    expect(host.textContent).toContain('Watch data')
    expect(host.querySelector('[role="switch"], input[type="checkbox"], .switch')).toBeTruthy()
  })

  it('says why when the plugin fails, instead of hiding', async () => {
    m.status = { status: 'error', message: 'not implemented', granted: [] }
    await mount()
    expect(host.textContent).toContain('Watch data')
    expect(host.textContent).toContain('not implemented')
  })

  it('points to installing Health Connect where it is missing', async () => {
    m.status = { status: 'missing', granted: [] }
    await mount()
    expect(host.textContent).toContain('Install or update Health Connect')
  })
})
