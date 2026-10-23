// PerForm: the Nutrition tab — one day of food against its targets, meals in time order around
// the day's workout, water, supplements, and the week before it on a strip.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, getLang, dateLocale } from '../lib/i18n.js'
import { todayISO, fmtNum, DAYS } from '../lib/format.js'
import {
  dayView, dayOf, nutritionOf, targetsFor, sumItems, macroShares, suppStreak, shift,
  addWater, toggleSupp, setDayType, logSavedMeal, unlogPlanned, removeItem, copyDay,
  foodName, foodOf, hhmm, GLASS_ML,
} from '../lib/perform-nutrition.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { menuSheet } from '../sheets.jsx'
import FoodIcon, { FoodTile, MACRO_COLOR } from '../components/PerformFoodIcon.jsx'
import {
  addFoodSheet, editItemSheet, targetsSheet, savedMealsSheet, saveAsMealSheet,
  mealLabel, tagLabel, round, kcalText, macroLine, amountText,
} from '../components/PerformNutritionSheets.jsx'
import '../perform-nutrition.css'

const update = (...a) => useStore.getState().update(...a)
const toast = (m, o) => useUI.getState().toast(m, o)
const pct = (v, of) => Math.min(100, of > 0 ? (v / of) * 100 : 0) + '%'

export default function Nutrition() {
  const S = useStore(s => s.S)
  const today = todayISO()
  const [sel, setSel] = useState(today)
  const [weekOff, setWeekOff] = useState(0)
  const v = dayView(S, sel)
  const tg = targetsFor(S, sel)
  const n = nutritionOf(S)
  const day = dayOf(S, sel)

  return <div className="narrow nutrition">
    <div className="hdr">
      <div><h1>{t('Nutrition')}</h1><div className="sub">{dayLabel(sel, today)}</div></div>
      <button className="iconbtn" onClick={() => targetsSheet(v.type)} aria-label={t('Daily targets')} title={t('Daily targets')}><Icon name="slider" /></button>
    </div>
    <WeekStrip S={S} sel={sel} setSel={setSel} today={today} off={weekOff} setOff={setWeekOff} />
    <DayTag S={S} iso={sel} v={v} />
    <KcalCard total={v.total} tg={tg} />
    <WaterCard ml={day.water} target={n.water} iso={sel} />
    {n.supps.length > 0 && <SuppCard S={S} iso={sel} supps={n.supps} taken={day.supps} />}
    <Timeline S={S} iso={sel} v={v} />
    {v.empty.length > 0 && <div className="nu-empties">
      {v.empty.map(m => <Button key={m.key} size="sm" variant="tinted" icon="plus" onClick={() => addFoodSheet({ iso: sel, meal: m.key })}>
        {mealLabel(m.key) + (m.tag && m.key !== 'pre' && m.key !== 'post' ? ' · ' + tagLabel(m.tag).toLowerCase() : '')}
      </Button>)}
    </div>}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <Button size="sm" variant="plain" icon="copy" onClick={() => copyYesterday(S, sel)}>{t('Copy yesterday')}</Button>
      <Button size="sm" variant="plain" icon="clipboard" onClick={() => savedMealsSheet(sel)}>{t('Saved meals')}</Button>
    </div>
  </div>
}

function dayLabel(iso, today) {
  const d = new Date(iso + 'T12:00:00')
  const long = d.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
  if (iso === today) return t('Today, {0}', long)
  if (iso === shift(today, -1)) return t('Yesterday, {0}', long)
  return long
}

function copyYesterday(S, iso) {
  const from = shift(iso, -1)
  if (!dayOf(S, from).items.length) { toast(t('Nothing logged the day before.')); return }
  let n = 0
  const before = useStore.getState().S.food?.[iso]
  update(s => { n = copyDay(s, from, iso) })
  toast(t('{0} foods copied from the day before.', n), {
    action: t('Undo'),
    onAction: () => update(s => { s.food = { ...(s.food || {}) }; if (before) s.food[iso] = before; else delete s.food[iso] }),
  })
}

/* ------------------------------------------------------------ week strip -- */

function WeekStrip({ S, sel, setSel, today, off, setOff }) {
  const end = shift(today, off * 7)
  const days = Array.from({ length: 7 }, (_, i) => shift(end, i - 6))
  const first = new Date(days[0] + 'T12:00:00'), last = new Date(days[6] + 'T12:00:00')
  const label = off === 0 ? t('Last 7 days') : `${first.getDate()} ${first.toLocaleDateString(dateLocale(), { month: 'short' })} – ${last.getDate()} ${last.toLocaleDateString(dateLocale(), { month: 'short' })}`
  return <>
    <div className="nu-weeknav">
      <button className="iconbtn" onClick={() => setOff(o => o - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
      <span className="small muted" style={{ fontWeight: 500 }}>{label}</span>
      <button className="iconbtn" onClick={() => setOff(o => Math.min(0, o + 1))} disabled={off >= 0} style={off >= 0 ? { opacity: 0.3 } : undefined} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
    </div>
    <div className="week nu-week">
      {days.map(iso => {
        const d = new Date(iso + 'T12:00:00')
        const items = dayOf(S, iso).items
        const kcal = items.length ? sumItems(S, items).kcal : 0
        const target = targetsFor(S, iso).kcal
        const over = kcal > target * 1.05
        return <button key={iso} className={'wday' + (iso === today ? ' today' : '') + (iso === sel ? ' sel' : '')} onClick={() => setSel(iso)}
          aria-pressed={iso === sel} aria-label={d.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' }) + (items.length ? ', ' + t('{0} kcal', kcalText(kcal)) : '')}>
          <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div>
          <div className="wt"><span style={{ width: pct(kcal, target), background: over ? 'var(--orange)' : 'var(--acc)' }} /></div>
        </button>
      })}
    </div>
  </>
}

/* ------------------------------------------------------------ day type -- */

function DayTag({ S, iso, v }) {
  const own = dayOf(S, iso).type
  const training = v.type === 'training'
  const title = training ? (v.workout?.name ? t('Training day · {0}', v.workout.name) : t('Training day')) : t('Rest day')
  const sub = own ? t('Your call for this day · tap to change') : v.workout?.done ? t('From your workout · tap to change') : t('From your Plan · tap to change')
  const pick = () => menuSheet({
    title: t('This day'),
    items: [
      { icon: 'dumbbell', label: t('Training day'), sub: t('Training-day targets, pre- and post-workout meals'), on: own === 'training', onClick: () => update(s => setDayType(s, iso, 'training')) },
      { icon: 'moon', label: t('Rest day'), sub: t('Rest-day targets'), on: own === 'rest', onClick: () => update(s => setDayType(s, iso, 'rest')) },
      { icon: 'calendar', label: t('Follow my Plan'), on: !own, onClick: () => update(s => setDayType(s, iso, null)) },
    ],
  })
  return <button className="nu-daytag" onClick={pick}>
    <span className="nu-ficon" style={{ width: 34, height: 34, borderRadius: 9, color: training ? 'var(--acc)' : 'var(--indigo)' }}>
      <FoodIcon name={training ? 'dumbbell' : 'moon'} size={20} /></span>
    <span className="grow" style={{ minWidth: 0 }}><span style={{ fontSize: 15, fontWeight: 600, display: 'block' }}>{title}</span><span className="muted small" style={{ display: 'block' }}>{sub}</span></span>
    <span className="small" style={{ color: 'var(--acc)' }}>{t('Change')}</span>
  </button>
}

/* -------------------------------------------------------------- kcal card -- */

export function KcalHead({ total, tg }) {
  const left = Math.round(tg.kcal - total.kcal)
  const over = left < 0
  return <>
    <div className="row between" style={{ alignItems: 'baseline' }}>
      <div><span className="big" style={over ? { color: 'var(--orange)' } : undefined}>{fmtNum(Math.abs(left))}</span> <span className="muted small">{over ? t('kcal over') : t('kcal left')}</span></div>
      <span className="muted small">{t('{0} of {1} kcal', kcalText(total.kcal), fmtNum(tg.kcal))}</span>
    </div>
    <div className="nu-track" style={{ marginTop: 10 }}><div className="nu-fill" style={{ width: pct(total.kcal, tg.kcal), background: over ? 'var(--orange)' : 'var(--acc)' }} /></div>
  </>
}

function KcalCard({ total, tg }) {
  const share = macroShares(total)
  const rows = [['p', t('Protein')], ['c', t('Carbs')], ['f', t('Fat')], ['fb', t('Fibre')]]
  return <div className="card">
    <KcalHead total={total} tg={tg} />
    <div className="nu-macros">
      {rows.map(([k, label]) => {
        const val = round(total[k]), target = tg[k], left = Math.round(target - total[k])
        return <div key={k}>
          <div className="row between small">
            <span><span style={{ color: MACRO_COLOR[k], fontWeight: 600 }}>{label}</span>{k !== 'fb' && total.kcal > 0 && <span className="muted"> {share[k]}%</span>}</span>
            <span><b style={{ fontWeight: 600 }}>{val}</b> <span className="muted">/ {target} g · {left >= 0 ? t('{0} g left', left) : t('{0} g over', -left)}</span></span>
          </div>
          <div className="nu-mtrack"><div className="nu-fill" style={{ width: pct(total[k], target), background: MACRO_COLOR[k] }} /></div>
        </div>
      })}
    </div>
  </div>
}

/* ------------------------------------------------------------------ water -- */

function WaterCard({ ml, target, iso }) {
  const p = Math.min(1, target > 0 ? ml / target : 0)
  const h = Math.round(62 * p)
  const left = target - ml
  const add = d => update(s => addWater(s, iso, d))
  return <div className="card">
    <div className="row" style={{ gap: 14 }}>
      <svg width="40" height="80" viewBox="0 0 40 80" role="img" aria-label={t('Water bottle, {0}% full', Math.round(p * 100))}>
        <rect x="15" y="3" width="10" height="7" rx="2" fill="none" stroke="var(--label-3)" strokeWidth="2" />
        <path d="M10 16 Q10 11 15 11 H25 Q30 11 30 16 V72 Q30 77 25 77 H15 Q10 77 10 72 Z" fill="none" stroke="var(--label-3)" strokeWidth="2" />
        <rect x="13" y={74 - h} width="14" height={h} rx="3" fill="var(--teal)" style={{ transition: 'y .3s, height .3s' }} />
      </svg>
      <div className="grow">
        <div className="nu-cap" style={{ margin: '0 0 2px' }}>{t('Water')}</div>
        <div><span className="big" style={{ fontSize: 26 }}>{fmtL(ml)}</span> <span className="muted small">{t('of {0} L', fmtL(target))} · {left > 0 ? t('{0} ml to go', fmtNum(left)) : t('target reached')}</span></div>
        <div className="nu-mtrack"><div className="nu-fill" style={{ width: p * 100 + '%', background: 'var(--teal)' }} /></div>
      </div>
    </div>
    <div className="row" style={{ gap: 8, marginTop: 12 }}>
      <Button size="sm" className="nu-minus" onClick={() => add(-GLASS_ML)} aria-label={t('Remove 250 ml')} disabled={!ml} icon="minus" />
      <Button size="sm" className="nu-waterbtn" onClick={() => add(GLASS_ML)}>+250 ml</Button>
      <Button size="sm" className="nu-waterbtn" onClick={() => add(500)}>+500 ml</Button>
    </div>
  </div>
}
export const fmtL = ml => fmtNum(Math.round((ml / 1000) * 100) / 100)

/* ------------------------------------------------------------ supplements -- */

function SuppCard({ S, iso, supps, taken }) {
  const count = supps.filter(sp => taken[sp.id]).length
  return <div className="card">
    <div className="row between" style={{ marginBottom: 10 }}><span className="nu-cap" style={{ margin: 0 }}>{t('Supplements')}</span><span className="muted small">{t('{0} of {1} taken', count, supps.length)}</span></div>
    <div className="nu-supps">
      {supps.map(sp => {
        const on = !!taken[sp.id]
        const streak = suppStreak(S, sp.id, iso)
        return <button key={sp.id} className={'nu-suppchip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => update(s => toggleSupp(s, iso, sp.id))}>
          <span className="ck"><Icon name="check" /></span>
          <span><span style={{ display: 'block', fontWeight: 600 }}>{sp.name} {sp.dose}</span>
            <span className="muted" style={{ display: 'block', fontSize: 12 }}>{streak > 1 ? t('{0} days in a row', streak) : sp.post ? t('After workout') : hhmm(sp.at ?? 0)}</span></span>
        </button>
      })}
    </div>
  </div>
}

/* --------------------------------------------------------------- timeline -- */

function Timeline({ S, iso, v }) {
  const rows = v.meals.map(m => ({ at: m.at, el: <Meal key={m.key} S={S} iso={iso} m={m} /> }))
  if (v.workout) rows.push({ at: v.workout.at + 0.5, el: <WorkoutCard key="workout" w={v.workout} /> })
  rows.sort((a, b) => a.at - b.at)
  return <>{rows.map(r => r.el)}</>
}

function WorkoutCard({ w }) {
  return <div className="nu-workout">
    <span className="nu-ficon" style={{ width: 38, height: 38, borderRadius: 10 }}><FoodIcon name="dumbbell" size={22} /></span>
    <div className="grow" style={{ minWidth: 0 }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{w.name || t('Workout')}</div>
      <div className="muted small">{w.done ? t('Logged · {0} min', w.mins) : w.live ? t('In progress') : t('From your Plan · about {0} min', w.mins)}</div>
    </div>
    <b style={{ fontWeight: 600, color: 'var(--acc)' }}>{hhmm(w.at)}</b>
  </div>
}

function Meal({ S, iso, m }) {
  const lang = getLang()
  const fromPlan = m.items.some(it => it.plan === m.key)
  const menu = () => menuSheet({
    title: mealLabel(m.key),
    items: [
      { icon: 'plus', label: t('Add food'), onClick: () => addFoodSheet({ iso, meal: m.key }) },
      m.items.length ? { icon: 'clipboard', label: t('Save as a meal'), sub: t('Log it again in one tap, or put it in a day plan'), onClick: () => saveAsMealSheet(m.items, mealLabel(m.key)) } : null,
      m.items.length ? { icon: 'trash', label: t('Clear this meal'), danger: true, onClick: () => clearMeal(iso, m) } : null,
    ],
  })
  return <div className="nu-meal">
    <div className="nu-mealhd">
      <span style={{ minWidth: 0 }}><b>{mealLabel(m.key)}</b> <span className="muted small">{hhmm(m.at)}</span>
        {m.tag && m.key !== 'pre' && m.key !== 'post' && <span className={'nu-tag ' + m.tag}>{tagLabel(m.tag)}</span>}</span>
      <span className="row" style={{ gap: 2 }}>
        {m.items.length > 0 && <span className="small" style={{ fontWeight: 600 }}>{kcalText(m.sum.kcal)} kcal</span>}
        <button className="iconbtn" onClick={menu} aria-label={t('{0} options', mealLabel(m.key))}><Icon name="more" /></button>
      </span>
    </div>
    {m.items.length > 0 && <div className="muted small nu-mealsub">{macroLine(m.sum)}{fromPlan && <> · {t('as planned')} · <button className="small" style={{ color: 'var(--acc)' }} onClick={() => update(s => unlogPlanned(s, iso, m.key))}>{t('Undo')}</button></>}</div>}
    {m.items.map(it => {
      const f = it.foodObj
      return <button key={it.id} className="nu-entry" onClick={() => editItemSheet(iso, it)}>
        <FoodTile food={f} size={34} />
        <div className="grow" style={{ minWidth: 0 }}><div className="tt">{f ? foodName(f, lang) : t('Unknown food')}</div><div className="ss">{amountText(f, it)} · {macroLine(it.m)}</div></div>
        <span className="small" style={{ fontWeight: 600 }}>{kcalText(it.m.kcal)} kcal</span>
      </button>
    })}
    {m.planned && <Planned S={S} iso={iso} m={m} />}
    <button className="nu-addrow" onClick={() => addFoodSheet({ iso, meal: m.key })}><Icon name="plus" />{t('Add food')}</button>
  </div>
}

function Planned({ S, iso, m }) {
  const saved = m.slot.savedMeal
  const sum = m.slot.sum
  const eat = () => update(s => logSavedMeal(s, iso, saved, m.key, true))
  const adjust = () => { eat(); toast(t('Logged. Tap a food to change how much.')) }
  return <div className="nu-planned">
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <FoodTile food={sum} icon={foodOf(S, saved.items[0]?.food)?.icon} size={34} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{t('Planned · {0}', saved.name)}</div>
        <div className="muted small">{kcalText(sum.kcal)} kcal · {macroLine(sum)}</div>
      </div>
    </div>
    <div className="row" style={{ marginTop: 10 }}>
      <Button size="sm" variant="primary" icon="check" style={{ flex: 1 }} onClick={eat}>{t('Eaten as planned')}</Button>
      <Button size="sm" variant="plain" onClick={adjust}>{t('Adjust')}</Button>
    </div>
  </div>
}

function clearMeal(iso, m) {
  const ids = m.items.map(it => it.id)
  const before = useStore.getState().S.food?.[iso]
  update(s => { for (const id of ids) removeItem(s, iso, id) })
  toast(t('{0} cleared.', mealLabel(m.key)), {
    action: t('Undo'),
    onAction: () => update(s => { s.food = { ...(s.food || {}) }; if (before) s.food[iso] = before }),
  })
}

