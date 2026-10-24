// @vitest-environment happy-dom
// PerForm: the Nutrition tab end to end — a food searched, sized and logged into a meal; water from
// the tab and from Home's drops; a planned meal eaten in one tap; supplements ticked; Plan › Meals.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { dayOf, saveMeal, setSlot, saveSupp } from '../lib/perform-nutrition.js'
import Nutrition from './Nutrition.jsx'
import Modals from '../components/Modals.jsx'
import PerformNutritionCard from '../components/PerformNutritionCard.jsx'
import PerformMealPlan from '../components/PerformMealPlan.jsx'

vi.mock('react-router-dom', async orig => ({ ...(await orig()), useNavigate: () => () => {} }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useUI.setState({ sheets: [] })
  useStore.setState(s => ({ S: { ...s.S, routines: [], week: {}, dayPlan: {}, workouts: [], active: null, food: {}, nutrition: {} }, user: null }))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useUI.setState({ sheets: [] })
})

const mount = el => act(() => root.render(<>{el}<Modals /></>))
const all = () => [...document.querySelectorAll('button, [role="button"]')]
const byText = (txt, scope = document) => [...scope.querySelectorAll('button, [role="button"]')].find(b => b.textContent.trim() === txt || b.textContent.includes(txt))
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const type = (input, value) => act(() => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const today = () => dayOf(useStore.getState().S, todayISO())

describe('Nutrition tab', () => {
  it('logs a food searched in either language into the meal it was added to', () => {
    mount(<Nutrition />)
    click(byText('Lunch'))
    const search = document.querySelector('input[aria-label="Search foods"]')
    expect(search).toBeTruthy()
    type(search, 'arroz cozido')
    const first = document.querySelector('#modal-root .item, .sheet .item')
    expect(first.textContent).toContain('Rice, white, cooked')
    click(first)
    click(byText('200 g'))
    click(byText('Add to Lunch'))
    expect(today().items).toMatchObject([{ food: 'rice_white_cooked', g: 200, meal: 'lunch' }])
    // the meal card shows it, with its calories
    expect(host.textContent).toContain('Rice, white, cooked')
    expect(host.textContent).toContain('260 kcal')
  })

  it('counts a fruit in pieces', () => {
    mount(<Nutrition />)
    click(byText('Snack'))
    type(document.querySelector('input[aria-label="Search foods"]'), 'apple')
    click(document.querySelector('#modal-root .item, .sheet .item'))
    click(document.querySelector('button[aria-label="More"]'))
    click(byText('Add to Snack'))
    expect(today().items).toMatchObject([{ food: 'apple', g: 300, pcs: 2, meal: 'snack' }])
    expect(host.textContent).toContain('2 apples (300 g)')
  })

  it('adds and takes away water', () => {
    mount(<Nutrition />)
    click(byText('+500 ml'))
    click(byText('+250 ml'))
    expect(today().water).toBe(750)
    click(document.querySelector('button[aria-label="Remove 250 ml"]'))
    expect(today().water).toBe(500)
  })

  it('shows a planned meal and logs it in one tap, with an Undo', () => {
    useStore.getState().update(s => {
      const id = saveMeal(s, { name: 'Oats breakfast', items: [{ food: 'oats', g: 60 }, { food: 'milk_semi', g: 250 }] })
      setSlot(s, 'rest', 'breakfast', { saved: id, at: 8 * 60 })
      setSlot(s, 'training', 'breakfast', { saved: id, at: 8 * 60 })
    }, false)
    mount(<Nutrition />)
    expect(host.textContent).toContain('Planned · Oats breakfast')
    click(byText('Eaten as planned'))
    expect(today().items.map(i => i.food)).toEqual(['oats', 'milk_semi'])
    expect(host.textContent).not.toContain('Planned · Oats breakfast')
    click(byText('Undo', host))
    expect(today().items).toEqual([])
  })

  it('ticks a supplement off for the day', () => {
    useStore.getState().update(s => { saveSupp(s, { name: 'Creatine', dose: '5 g', post: true }) }, false)
    mount(<Nutrition />)
    expect(host.textContent).toContain('0 of 1 taken')
    click(host.querySelector('.nu-suppchip'))
    expect(host.textContent).toContain('1 of 1 taken')
    expect(Object.keys(today().supps)).toHaveLength(1)
  })
})

describe('Home card', () => {
  it('fills the next drop with a glass of water', () => {
    mount(<PerformNutritionCard />)
    expect(host.querySelectorAll('.nu-drop')).toHaveLength(12)
    click(host.querySelector('button[aria-label="Add a glass of water, 250 ml"]'))
    click(host.querySelector('button[aria-label="Add a glass of water, 250 ml"]'))
    expect(today().water).toBe(500)
    expect(host.querySelectorAll('.nu-drop.on')).toHaveLength(2)
    expect(host.textContent).toContain('kcal left')
  })
})

describe('Plan › Meals', () => {
  it('lays the training day plan out around the workout time', () => {
    useStore.getState().update(s => {
      const m = saveMeal(s, { name: 'Salmon & potatoes', items: [{ food: 'salmon_grilled', g: 180 }, { food: 'potato_boiled', g: 300 }] })
      setSlot(s, 'training', 'post', { saved: m, after: 60 })
      saveSupp(s, { name: 'Magnesium', dose: '300 mg', at: 22 * 60 + 30 })
      s.nutrition = { ...s.nutrition, workoutAt: 18 * 60 }
    }, false)
    mount(<PerformMealPlan />)
    const times = [...host.querySelectorAll('.nu-tl .tm')].map(e => e.textContent)
    expect(times).toEqual(['18:00', '20:00', '22:30'])
    expect(host.textContent).toContain('1 h after workout')
    expect(host.textContent).toContain('Salmon & potatoes')
  })
})
