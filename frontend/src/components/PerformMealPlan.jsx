// PerForm: Plan › Meals — the food side of the plan. A day plan per day type (which saved meal,
// and when: at a time or tied to the workout), the supplements, and the saved meals themselves.
// The Nutrition tab picks the day plan from the Schedule and shows it as meals still to eat.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { nutritionOf, planTimeline, sumItems, foodOf, hhmm, fromHHMM } from '../lib/perform-nutrition.js'
import Icon from './Icon.jsx'
import { Button, Segmented } from './ui.jsx'
import FoodIcon, { FoodTile } from './PerformFoodIcon.jsx'
import {
  slotSheet, suppSheet, mealEditorSheet, mealLabel, kcalText, macroLine, mealFoodsText, suppWhen, round,
} from './PerformNutritionSheets.jsx'
import '../perform-nutrition.css'

const update = (...a) => useStore.getState().update(...a)

export default function PerformMealPlan() {
  const S = useStore(s => s.S)
  const n = nutritionOf(S)
  const [type, setType] = useState('training')
  const tl = planTimeline(S, type)
  const setWorkoutAt = v => {
    const m = fromHHMM(v)
    if (m != null) update(s => { s.nutrition = { ...(s.nutrition || {}), workoutAt: m } })
  }
  return <div className="meal-plan">
    <Segmented value={type} onChange={setType} options={[{ value: 'training', label: t('Training day') }, { value: 'rest', label: t('Rest day') }]} />
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row between">
        <div><div style={{ fontWeight: 600 }}>{type === 'training' ? t('Training day plan') : t('Rest day plan')}</div>
          <div className="muted small">{t('Picked for each day from your Schedule')}</div></div>
        <div style={{ textAlign: 'end' }}><div style={{ fontWeight: 600 }}>{kcalText(tl.total.kcal)} kcal</div><div className="muted small">{macroLine(tl.total)}</div></div>
      </div>
      {type === 'training' && <label className="row between" style={{ marginTop: 12 }}>
        <span className="small muted">{t('Usual workout time')}</span>
        <input type="time" className="timef" value={hhmm(n.workoutAt)} onChange={e => setWorkoutAt(e.target.value)} aria-label={t('Usual workout time')} />
      </label>}
      {type === 'training' && <div className="muted small" style={{ marginTop: 6 }}>{t('A logged workout moves the meals tied to it to its real time.')}</div>}
    </div>

    {tl.rows.map((r, i) => <div key={i} className="nu-tl">
      <div className="tm">{hhmm(r.at)}</div>
      {r.kind === 'workout' ? <div className="nu-slot workout">
        <div className="row" style={{ gap: 10 }}>
          <span className="nu-ficon" style={{ width: 34, height: 34, borderRadius: 9, color: 'var(--acc)' }}><FoodIcon name="dumbbell" /></span>
          <div className="grow"><div style={{ fontWeight: 600 }}>{t('Workout')}</div><div className="muted small">{t('From your Schedule · about {0} min', r.mins)}</div></div>
        </div>
      </div> : r.kind === 'supp' ? <button className="nu-slot supp" onClick={() => suppSheet(r.supp)}>
        <div className="row" style={{ gap: 10 }}>
          <span className="nu-ficon" style={{ width: 34, height: 34, borderRadius: 9, color: 'var(--cyan,#64d2ff)' }}><FoodIcon name="pill" /></span>
          <div className="grow"><div style={{ fontWeight: 600 }}>{r.supp.name} {r.supp.dose}</div><div className="muted small">{r.supp.post && type === 'training' ? t('With the post-workout meal') : t('Supplement')}</div></div>
        </div>
      </button> : <button className="nu-slot" onClick={() => slotSheet(type, r.key)}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <FoodTile food={r.sum} icon={foodOf(S, r.slot.savedMeal?.items[0]?.food)?.icon} size={34} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{mealLabel(r.key)}</div>
            <div className="muted small">{r.slot.savedMeal ? `${r.slot.savedMeal.name} · P ${round(r.sum.p)} g` : t('Pick a saved meal')}</div>
            {type === 'training' && (r.slot.before != null || r.slot.after != null) && <span className={'nu-anchor ' + (r.slot.before != null ? 'pre' : 'post')}>
              <Icon name="link" />{r.slot.before != null ? t('{0} h before workout', fmtH(r.slot.before)) : t('{0} h after workout', fmtH(r.slot.after))}
            </span>}
          </div>
          <span className="small" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{kcalText(r.sum.kcal)} kcal</span>
        </div>
      </button>}
    </div>)}
    {!tl.rows.some(r => r.kind === 'meal') && <div className="muted small" style={{ margin: '4px 2px 12px' }}>
      {n.meals.length ? t('No meals planned for this day type yet.') : t('Save a meal first (below), then put it in the plan.')}</div>}
    <Button variant="tinted" icon="plus" onClick={() => slotSheet(type)}>{t('Add a meal to this plan')}</Button>

    <h4 className="sec" style={{ marginTop: 22 }}>{t('Supplements · ticked off each day, no calories')}</h4>
    <div className="list">
      {n.supps.map(sp => <div key={sp.id} className="item" {...tappable(() => suppSheet(sp))}>
        <span className="nu-ficon" style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--cyan,#64d2ff)' }}><FoodIcon name="pill" /></span>
        <div className="grow"><div className="tt">{sp.name} <span className="muted small">{sp.dose}</span></div><div className="ss">{suppWhen(sp)}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>)}
    </div>
    <div style={{ height: 8 }} />
    <Button variant="plain" icon="plus" onClick={() => suppSheet(null)}>{t('Add supplement')}</Button>

    <h4 className="sec" style={{ marginTop: 22 }}>{t('Saved meals · built once, like routines')}</h4>
    <div className="list">
      {n.meals.map(m => {
        const sum = sumItems(S, m.items)
        return <div key={m.id} className="item" {...tappable(() => mealEditorSheet(m))}>
          <FoodTile food={sum} icon={foodOf(S, m.items[0]?.food)?.icon} />
          <div className="grow" style={{ minWidth: 0 }}><div className="tt">{m.name}</div><div className="ss">{mealFoodsText(S, m)}</div></div>
          <div style={{ textAlign: 'end', flex: 'none' }}><div className="small" style={{ fontWeight: 600 }}>{kcalText(sum.kcal)} kcal</div><div className="muted small">P {round(sum.p)}</div></div>
        </div>
      })}
    </div>
    <div style={{ height: 8 }} />
    <Button variant="plain" icon="plus" onClick={() => mealEditorSheet()}>{t('New meal')}</Button>
  </div>
}

const fmtH = mins => String(Math.round((mins / 60) * 10) / 10)
