// PerForm: the Nutrition tab's sheets — add a food, how much of it, daily targets, an own food,
// saved meals, a day-plan slot and a supplement. Each one changes the state through the pure
// helpers in lib/perform-nutrition.js.
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, getLang } from '../lib/i18n.js'
import { todayISO, fmtNum } from '../lib/format.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import {
  nutritionOf, searchFoods, foodOf, foodName, foodAlt, pieceText, macrosOf, sumItems, macroShares,
  kcalFromMacros, addItem, updateItem, removeItem, toggleFav, setTargets, saveMyFood, hideMyFood,
  saveMeal, deleteMeal, logSavedMeal, setSlot, saveSupp, deleteSupp, dayType, workoutOf, mealByTime,
  MEAL_KEYS, MEAL_AT, PRE_BEFORE, POST_AFTER, hhmm, fromHHMM,
} from '../lib/perform-nutrition.js'
import Icon from './Icon.jsx'
import { Button, NumberField, Segmented, TextField } from './ui.jsx'
import FoodIcon, { FoodTile, FOOD_ICONS, MACRO_COLOR } from './PerformFoodIcon.jsx'
import { confirmSheet } from '../sheets.jsx'
import '../perform-nutrition.css'

const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = (m, o) => ui().toast(m, o)

/* ------------------------------------------------------------------ text -- */

export function mealLabel(key) {
  return {
    breakfast: t('Breakfast'), lunch: t('Lunch'), snack: t('Snack'), dinner: t('Dinner'),
    pre: t('Pre-workout'), post: t('Post-workout'),
  }[key] || key
}
export const tagLabel = tag => (tag === 'pre' ? t('Pre-workout') : tag === 'post' ? t('Post-workout') : '')
export const round = n => Math.round(n || 0)
export const kcalText = n => fmtNum(round(n))
export const macroLine = m => `P ${round(m.p)} · C ${round(m.c)} · F ${round(m.f)}`
/** "2 apples (300 g)" or "200 g" */
export function amountText(food, it) {
  const g = `${fmtNum(round(it.g))} g`
  return it.pcs && food?.piece ? `${pieceText(food, it.pcs, getLang())} (${g})` : g
}
/** The meals a day offers: pre- and post-workout on a training day only. */
export const mealsFor = type => MEAL_KEYS.filter(k => type === 'training' || (k !== 'pre' && k !== 'post'))

/* ------------------------------------------------------------- add food -- */

/**
 * Search the food list and pick how much. Logs into `meal` of day `iso`, or, with `onPick`, hands
 * the food and grams back instead (a saved meal being built).
 */
function AddFood({ iso, meal: meal0, onPick, close }) {
  const S = useStore(s => s.S)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [picked, setPicked] = useState(null)
  const lang = getLang()
  const favs = new Set(nutritionOf(S).favs)
  const found = useMemo(() => searchFoods(S, q, filter), [S.nutrition, q, filter])
  const shown = q.trim() || filter !== 'all' ? found.slice(0, 80) : found.slice(0, 12)
  if (picked) return <Amount food={foodOf(S, picked) || picked} iso={iso} meal={meal0} onPick={onPick} onBack={() => setPicked(null)} close={close} />
  const newFood = () => myFoodSheet(null, { name: q.trim(), onSaved: id => setPicked(id) })
  return <>
    <h3 style={{ marginBottom: 2 }}>{t('Add food')}</h3>
    {!onPick && <div className="muted small" style={{ marginBottom: 12 }}>{t('To {0}', mealLabel(meal0))}</div>}
    <div className={'search' + (q ? ' has-clear' : '')} style={{ margin: onPick ? '10px 0 10px' : '0 0 10px' }}>
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Chicken, rice, apple…')} value={q} onChange={e => setQ(e.target.value)} aria-label={t('Search foods')} />
      {q && <button className="clear" onClick={() => setQ('')} aria-label={t('Clear')}><Icon name="xmark" /></button>}
    </div>
    <div className="nu-filters">
      {[['all', t('All foods')], ['fav', t('Favourites')], ['mine', t('My foods')]].map(([v, l]) =>
        <button key={v} className={'chip' + (filter === v ? ' on' : '')} onClick={() => setFilter(v)}>{l}</button>)}
    </div>
    <div className="list">
      {shown.map(f => {
        const alt = foodAlt(f, lang)
        return <div key={f.id} className="item" {...tappable(() => setPicked(f.id))}>
          <FoodTile food={f} size={42} />
          <div className="grow">
            <div className="tt row" style={{ gap: 5 }}>{favs.has(f.id) && <Icon name="starFill" className="fav-star" style={{ color: 'var(--yellow)', fontSize: 13 }} />}<span>{foodName(f, lang)}</span></div>
            <div className="ss">{[alt, f.mine ? t('my food') : null, `${t('per 100 g')}: ${round(f.k)} kcal · ${macroLine(f)}`].filter(Boolean).join(' · ')}</div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>
      })}
      {!shown.length && <div className="empty"><div className="ico"><Icon name="magnifier" /></div>
        {filter === 'fav' ? t('No favourites yet. Tap the star on a food to keep it here.') : filter === 'mine' && !q ? t('No foods of your own yet.') : t('No match')}</div>}
      <div className="item" {...tappable(newFood)}>
        <span className="nu-ficon" style={{ width: 42, height: 42, borderRadius: 11, color: 'var(--acc)' }}><Icon name="plus" /></span>
        <div className="grow"><div className="tt">{t('Create your own food')}</div><div className="ss">{t('name + macros per 100 g, from the label')}</div></div>
      </div>
    </div>
  </>
}
export function addFoodSheet(opts = {}) {
  const iso = opts.iso || todayISO()
  let meal = opts.meal
  if (!meal && !opts.onPick) {
    const S = useStore.getState().S
    const now = new Date()
    meal = mealByTime(now.getHours() * 60 + now.getMinutes(), dayType(S, iso), workoutOf(S, iso))
  }
  ui().openSheet(close => <AddFood {...opts} iso={iso} meal={meal} close={close} />)
}

/* ------------------------------------------------------------- how much -- */

const GRAM_CHIPS = [50, 100, 150, 200, 250, 300]

function Amount({ food, iso, meal: meal0, item, onPick, onBack, close }) {
  const S = useStore(s => s.S)
  const lang = getLang()
  const piece = food?.piece
  const [unit, setUnit] = useState(item ? (item.pcs && piece ? 'pc' : 'g') : piece ? 'pc' : 'g')
  const [amount, setAmount] = useState(item ? (item.pcs && piece ? item.pcs : item.g) : piece ? 1 : 100)
  const [meal, setMeal] = useState(item?.meal || meal0 || 'snack')
  if (!food) return <div className="muted">{t('This food is no longer in your list.')}</div>
  const grams = unit === 'pc' ? (Number(amount) || 0) * piece.g : Number(amount) || 0
  const m = macrosOf(food, grams)
  const fav = nutritionOf(S).favs.includes(food.id)
  const step = unit === 'pc' ? 1 : 10
  const bump = d => setAmount(a => Math.max(0, Math.round(((Number(a) || 0) + d * step) * 10) / 10))
  const setU = u => {
    if (u === unit) return
    setUnit(u)
    setAmount(u === 'pc' ? Math.max(1, Math.round(grams / piece.g)) : Math.round(grams))
  }
  const entry = { food: food.id, g: grams, pcs: unit === 'pc' ? Number(amount) : undefined }
  const confirm = () => {
    if (!(grams > 0)) { toast(t('Enter an amount')); return }
    if (onPick) { onPick(entry); close(); return }
    if (item) update(s => updateItem(s, iso, item.id, { ...entry, meal }))
    else update(s => { addItem(s, iso, { ...entry, meal }) })
    close()
    if (!item) toast(t('Added to {0}', mealLabel(meal)))
  }
  const remove = () => { update(s => removeItem(s, iso, item.id)); close() }
  const alt = foodAlt(food, lang)
  const type = dayType(S, iso)
  return <>
    <div className="row" style={{ gap: 12, marginBottom: 14, alignItems: 'center' }}>
      {onBack && <button className="iconbtn" onClick={onBack} aria-label={t('Back')}><Icon name="chevronLeft" /></button>}
      <FoodTile food={food} size={56} />
      <div className="grow" style={{ minWidth: 0 }}>
        <h3 style={{ margin: 0 }}>{foodName(food, lang)}</h3>
        <div className="muted small">{[alt, food.mine ? t('my food') : null].filter(Boolean).join(' · ') || t('per 100 g: {0} kcal', round(food.k))}</div>
      </div>
      <button className={'iconbtn nu-star' + (fav ? ' on' : '')} onClick={() => update(s => toggleFav(s, food.id))}
        aria-pressed={fav} aria-label={fav ? t('Remove from favourites') : t('Add to favourites')}><Icon name={fav ? 'starFill' : 'star'} /></button>
    </div>
    {piece && <Segmented value={unit} onChange={setU}
      options={[{ value: 'g', label: t('Grams') }, { value: 'pc', label: t('Pieces ({0} g each)', fmtNum(piece.g)) }]} />}
    <div className="nu-box" style={{ padding: '18px 14px' }}>
      <div className="nu-amount">
        <button className="nu-stepbtn" onClick={() => bump(-1)} aria-label={t('Less')}><Icon name="minus" /></button>
        <div className="grow" style={{ textAlign: 'center' }}>
          <div className="muted small">{unit === 'pc' ? (pieceText(food, Number(amount) || 0, lang).replace(/^[\d.]+\s*/, '') || t('pieces')) : t('grams')}</div>
          <NumberField className="nu-amt" value={amount} onChange={setAmount} aria-label={unit === 'pc' ? t('Pieces') : t('Grams')} />
          {unit === 'pc' && <div className="muted small">{fmtNum(round(grams))} g</div>}
        </div>
        <button className="nu-stepbtn" onClick={() => bump(1)} aria-label={t('More')}><Icon name="plus" /></button>
      </div>
      {unit === 'g' && <div className="nu-chips">
        {GRAM_CHIPS.map(g => <button key={g} className={'chip' + (Number(amount) === g ? ' on' : '')} onClick={() => setAmount(g)}>{g} g</button>)}
      </div>}
    </div>
    <div className="nu-box">
      <div className="nu-cap">{t('This adds')}</div>
      <div className="nu-adds">
        <div><div className="v">{kcalText(m.kcal)}</div><div className="muted small">kcal</div></div>
        <div><div className="v" style={{ color: MACRO_COLOR.p }}>{round(m.p)}</div><div className="muted small">{t('protein')}</div></div>
        <div><div className="v" style={{ color: MACRO_COLOR.c }}>{round(m.c)}</div><div className="muted small">{t('carbs')}</div></div>
        <div><div className="v" style={{ color: MACRO_COLOR.f }}>{round(m.f)}</div><div className="muted small">{t('fat')}</div></div>
        <div><div className="v" style={{ color: MACRO_COLOR.fb }}>{round(m.fb)}</div><div className="muted small">{t('fibre')}</div></div>
      </div>
    </div>
    {!onPick && <div className="nu-filters" style={{ marginTop: 14 }}>
      {mealsFor(type).concat(MEAL_KEYS.includes(meal) && !mealsFor(type).includes(meal) ? [meal] : []).map(k =>
        <button key={k} className={'chip' + (meal === k ? ' on' : '')} onClick={() => setMeal(k)}>{mealLabel(k)}</button>)}
    </div>}
    <div style={{ height: 6 }} />
    <Button variant="primary" onClick={confirm}>{item ? t('Save') : onPick ? t('Add') : t('Add to {0}', mealLabel(meal))}</Button>
    {item && <><div style={{ height: 8 }} /><Button variant="danger" onClick={remove}>{t('Remove')}</Button></>}
  </>
}
/** Change or remove a logged food. */
export function editItemSheet(iso, item) {
  const S = useStore.getState().S
  ui().openSheet(close => <Amount food={foodOf(S, item.food)} iso={iso} item={item} close={close} />)
}
/** Change the amount of a food in a saved meal being built. */
function amountSheet(food, item, onPick) {
  ui().openSheet(close => <Amount food={food} item={item} onPick={onPick} close={close} />)
}

/* --------------------------------------------------------------- targets -- */

const TARGET_FIELDS = [['kcal', 'Calories', 'kcal'], ['p', 'Protein', 'g'], ['c', 'Carbs', 'g'], ['f', 'Fat', 'g'], ['fb', 'Fibre', 'g']]

function Targets({ close, type: type0 }) {
  const S = useStore(s => s.S)
  const n = nutritionOf(S)
  const [type, setType] = useState(type0 || 'training')
  const tg = n.targets[type]
  const share = macroShares(tg, tg.kcal)
  const fromMacros = kcalFromMacros({ ...tg, fb: 0 })
  const diff = Math.round(fromMacros - tg.kcal)
  const set = (k, v) => update(s => setTargets(s, type, { [k]: Math.max(0, Math.round(v || 0)) }))
  const label = { kcal: t('Calories'), p: t('Protein'), c: t('Carbs'), f: t('Fat'), fb: t('Fibre') }
  const color = { kcal: 'var(--label)', ...MACRO_COLOR }
  return <>
    <h3 style={{ marginBottom: 2 }}>{t('Daily targets')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Your own numbers. Which days are training days comes from your Plan.')}</div>
    <Segmented value={type} onChange={setType} options={[{ value: 'training', label: t('Training days') }, { value: 'rest', label: t('Rest days') }]} />
    <div style={{ height: 12 }} />
    {TARGET_FIELDS.map(([k, , u]) => <label key={k} className="nu-field">
      <span><span style={{ color: color[k] }}>{label[k]}</span>{share[k] != null && k !== 'fb' && k !== 'kcal' && <b style={{ color: 'var(--label)', fontWeight: 600 }}> · {t('{0}% of calories', share[k])}</b>}</span>
      <span className="nu-unit"><NumberField className="field" decimal={false} value={tg[k]} onChange={v => set(k, v)} /><i>{u}</i></span>
    </label>)}
    <div className="nu-box" style={{ marginTop: 4 }}>
      <div className="nu-cap">{t('Share of your calories')}</div>
      <div className="nu-split">
        {['p', 'c', 'f'].map(k => <div key={k} style={{ width: Math.min(100, share[k]) + '%', background: MACRO_COLOR[k] }} />)}
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>
        {Math.abs(diff) <= 50
          ? t('Protein, carbs and fat add up to {0} kcal, in line with your target.', fmtNum(round(fromMacros)))
          : t(diff > 0 ? 'Protein, carbs and fat add up to {0} kcal, {1} more than your target.' : 'Protein, carbs and fat add up to {0} kcal, {1} less than your target.', fmtNum(round(fromMacros)), fmtNum(Math.abs(diff)))}
      </div>
    </div>
    <label className="nu-field" style={{ marginTop: 16 }}>
      <span style={{ color: 'var(--teal)' }}>{t('Water, every day')}</span>
      <span className="nu-unit"><NumberField className="field" decimal={false} value={n.water}
        onChange={v => update(s => { s.nutrition = { ...(s.nutrition || {}), water: Math.max(0, Math.round(v || 0)) } })} /><i>ml</i></span>
    </label>
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const targetsSheet = type => ui().openSheet(close => <Targets type={type} close={close} />)

/* --------------------------------------------------------------- my food -- */

function MyFood({ food, name: name0, onSaved, close }) {
  const [v, setV] = useState(() => food ? { ...food, pieceG: food.piece?.g || 0, pieceName: food.piece?.one || '' }
    : { name: name0 || '', k: null, p: 0, c: 0, f: 0, fb: 0, icon: 'bowl', pieceG: 0, pieceName: '' })
  const set = (k, x) => setV(o => ({ ...o, [k]: x }))
  const auto = Math.round(kcalFromMacros(v))
  const save = () => {
    if (!v.name.trim()) { toast(t('Give it a name')); return }
    let id
    update(s => {
      id = saveMyFood(s, { ...v, k: v.k == null || v.k === '' ? auto : v.k, piece: v.pieceG > 0 ? { g: v.pieceG, one: v.pieceName.trim() || t('piece'), many: v.pieceName.trim() || t('pieces') } : null })
    })
    close()
    onSaved?.(id)
  }
  const remove = () => confirmSheet({
    title: t('Delete “{0}”?', food.name), message: t('Days that logged it keep their numbers.'), confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(s => hideMyFood(s, food.id)); close() },
  })
  const num = (k, label, unit = 'g') => <label className="nu-field">
    <span style={MACRO_COLOR[k] ? { color: MACRO_COLOR[k] } : undefined}>{label}</span>
    <span className="nu-unit"><NumberField className="field" value={v[k] ?? ''} nullable={k === 'k'} onChange={x => set(k, x)} placeholder={k === 'k' ? String(auto) : undefined} /><i>{unit}</i></span>
  </label>
  return <>
    <h3 style={{ marginBottom: 2 }}>{food ? t('Edit food') : t('Your own food')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Per 100 g, as on the label.')}</div>
    <label className="nu-field"><span>{t('Name')}</span><TextField value={v.name} onChange={e => set('name', e.target.value)} placeholder={t('Protein bar')} /></label>
    <div className="nu-grid2">
      {num('p', t('Protein'))}{num('c', t('Carbs'))}
      {num('f', t('Fat'))}{num('fb', t('Fibre'))}
    </div>
    {num('k', t('Calories (empty: worked out from the macros)'), 'kcal')}
    <div className="nu-grid2">
      <label className="nu-field"><span>{t('One piece (optional)')}</span><span className="nu-unit"><NumberField className="field" value={v.pieceG || ''} onChange={x => set('pieceG', x)} /><i>g</i></span></label>
      <label className="nu-field"><span>{t('Piece name')}</span><TextField value={v.pieceName} onChange={e => set('pieceName', e.target.value)} placeholder={t('bar')} /></label>
    </div>
    <div className="nu-field"><span>{t('Picture')}</span>
      <div className="nu-icons">{FOOD_ICONS.map(ic => <button key={ic} className={v.icon === ic ? 'on' : ''} onClick={() => set('icon', ic)} aria-label={ic} aria-pressed={v.icon === ic}><FoodIcon name={ic} size={22} /></button>)}</div>
    </div>
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {food && <><div style={{ height: 8 }} /><Button variant="danger" onClick={remove}>{t('Delete')}</Button></>}
  </>
}
export function myFoodSheet(food, { name, onSaved } = {}) {
  ui().openSheet(close => <MyFood food={food} name={name} onSaved={onSaved} close={close} />)
}

/* ----------------------------------------------------------- saved meals -- */

/** A saved meal's foods, as one line: "200 g chicken breast, grilled, 300 g rice…" */
export function mealFoodsText(S, meal) {
  const lang = getLang()
  return meal.items.map(it => { const f = foodOf(S, it.food); return f ? `${amountText(f, it)} ${foodName(f, lang).toLowerCase()}` : '' }).filter(Boolean).join(', ')
}

function MealEditor({ meal, close }) {
  const S = useStore(s => s.S)
  const [name, setName] = useState(meal?.name || '')
  const [items, setItems] = useState(meal?.items || [])
  const lang = getLang()
  const sum = sumItems(S, items)
  const add = () => addFoodSheet({ onPick: it => setItems(xs => [...xs, it]) })
  const edit = i => {
    const f = foodOf(S, items[i].food)
    amountSheet(f, items[i], it => setItems(xs => xs.map((x, j) => (j === i ? it : x))))
  }
  const save = () => {
    if (!name.trim()) { toast(t('Give it a name')); return }
    if (!items.length) { toast(t('Add a food first')); return }
    update(s => { saveMeal(s, { id: meal?.id, name, items }) })
    close()
  }
  const remove = () => confirmSheet({
    title: t('Delete “{0}”?', meal.name), message: t('It also leaves the day plans it is in. Days already logged keep their food.'),
    confirmText: t('Delete'), danger: true, onConfirm: () => { update(s => deleteMeal(s, meal.id)); close() },
  })
  return <>
    <h3 style={{ marginBottom: 2 }}>{meal ? t('Edit meal') : t('New meal')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Built once, logged in one tap — like a routine for food.')}</div>
    <label className="nu-field"><span>{t('Name')}</span><TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('Chicken & rice')} /></label>
    <div className="list" style={{ marginBottom: 10 }}>
      {items.map((it, i) => {
        const f = foodOf(S, it.food)
        if (!f) return null
        const m = macrosOf(f, it.g)
        return <div key={i} className="item" {...tappable(() => edit(i))}>
          <FoodTile food={f} />
          <div className="grow"><div className="tt">{foodName(f, lang)}</div><div className="ss">{amountText(f, it)} · {macroLine(m)}</div></div>
          <span className="small" style={{ fontWeight: 600 }}>{kcalText(m.kcal)} kcal</span>
          <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 14, color: 'var(--red)' }} onClick={e => { e.stopPropagation(); setItems(xs => xs.filter((_, j) => j !== i)) }} aria-label={t('Remove')}><Icon name="xmark" /></button>
        </div>
      })}
      <div className="item" {...tappable(add)}>
        <span className="nu-ficon" style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--acc)' }}><Icon name="plus" /></span>
        <div className="grow"><div className="tt">{t('Add food')}</div></div>
      </div>
    </div>
    {items.length > 0 && <div className="muted small" style={{ margin: '0 2px 14px' }}>{t('{0} kcal', kcalText(sum.kcal))} · {macroLine(sum)} · {t('fibre')} {round(sum.fb)}</div>}
    <Button variant="primary" onClick={save}>{t('Save meal')}</Button>
    {meal && <><div style={{ height: 8 }} /><Button variant="danger" onClick={remove}>{t('Delete')}</Button></>}
  </>
}
export function mealEditorSheet(meal = null) { ui().openSheet(close => <MealEditor meal={meal} close={close} />) }
/** A logged meal of the day kept as a saved meal. */
export function saveAsMealSheet(items, name) {
  ui().openSheet(close => <MealEditor meal={{ name, items: items.map(it => ({ food: it.food, g: it.g, ...(it.pcs ? { pcs: it.pcs } : {}) })) }} close={close} />)
}

function SavedMeals({ iso, meal: meal0, close }) {
  const S = useStore(s => s.S)
  const n = nutritionOf(S)
  const type = dayType(S, iso)
  const [meal, setMeal] = useState(meal0)
  const log = m => {
    update(s => logSavedMeal(s, iso, m, meal))
    close()
    toast(t('“{0}” added to {1}', m.name, mealLabel(meal)))
  }
  return <>
    <h3 style={{ marginBottom: 10 }}>{t('Saved meals')}</h3>
    <div className="nu-filters">
      {mealsFor(type).map(k => <button key={k} className={'chip' + (meal === k ? ' on' : '')} onClick={() => setMeal(k)}>{mealLabel(k)}</button>)}
    </div>
    <div className="list">
      {n.meals.map(m => {
        const sum = sumItems(S, m.items)
        const first = foodOf(S, m.items[0]?.food)
        return <div key={m.id} className="item" {...tappable(() => log(m))}>
          <FoodTile food={sum} icon={first?.icon} />
          <div className="grow"><div className="tt">{m.name}</div><div className="ss">{mealFoodsText(S, m)}</div></div>
          <div style={{ textAlign: 'end', flex: 'none' }}><div className="small" style={{ fontWeight: 600 }}>{kcalText(sum.kcal)} kcal</div><div className="muted small">P {round(sum.p)}</div></div>
        </div>
      })}
      {!n.meals.length && <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No saved meals yet. Build one here, or save a meal you logged from its ⋯ menu.')}</div>}
    </div>
    <div style={{ height: 10 }} />
    <Button variant="tinted" icon="plus" onClick={() => mealEditorSheet()}>{t('New meal')}</Button>
  </>
}
export function savedMealsSheet(iso, meal) {
  const S = useStore.getState().S
  const now = new Date()
  const m = meal || mealByTime(now.getHours() * 60 + now.getMinutes(), dayType(S, iso), workoutOf(S, iso))
  ui().openSheet(close => <SavedMeals iso={iso} meal={m} close={close} />)
}

/* ----------------------------------------------------- day-plan slot -- */

function Slot({ type, meal: meal0, close }) {
  const S = useStore(s => s.S)
  const n = nutritionOf(S)
  const existing = meal0 ? n.plans[type].find(x => x.meal === meal0) : null
  const taken = new Set(n.plans[type].map(x => x.meal))
  const offer = mealsFor(type).filter(k => k === meal0 || !taken.has(k))
  const [meal, setMeal] = useState(meal0 || offer[0])
  const [saved, setSaved] = useState(existing?.saved || n.meals[0]?.id || null)
  const timing0 = existing?.before != null ? 'before' : existing?.after != null ? 'after' : existing ? 'at' : meal === 'pre' ? 'before' : meal === 'post' ? 'after' : 'at'
  const [timing, setTiming] = useState(timing0)
  const [at, setAt] = useState(hhmm(existing?.at ?? MEAL_AT[meal] ?? MEAL_AT.snack))
  const [hours, setHours] = useState(((existing?.before ?? existing?.after ?? (timing0 === 'before' ? PRE_BEFORE : POST_AFTER)) / 60))
  if (!offer.length) return <><h3>{t('Every meal is planned')}</h3><div className="muted">{t('Tap a meal in the plan to change it.')}</div></>
  const pickMeal = k => {
    setMeal(k)
    if (!existing) {
      setTiming(k === 'pre' ? 'before' : k === 'post' ? 'after' : 'at')
      setAt(hhmm(MEAL_AT[k] ?? MEAL_AT.snack))
      setHours((k === 'pre' ? PRE_BEFORE : POST_AFTER) / 60)
    }
  }
  const save = () => {
    if (!saved) { toast(t('Pick a saved meal first')); return }
    const mins = Math.round((Number(hours) || 0) * 60)
    const slot = { saved, ...(type === 'training' && timing === 'before' ? { before: mins } : type === 'training' && timing === 'after' ? { after: mins } : { at: fromHHMM(at) ?? MEAL_AT[meal] ?? MEAL_AT.snack }) }
    update(s => {
      if (meal0 && meal0 !== meal) setSlot(s, type, meal0, null)
      setSlot(s, type, meal, slot)
    })
    close()
  }
  const remove = () => { update(s => setSlot(s, type, meal0, null)); close() }
  return <>
    <h3 style={{ marginBottom: 2 }}>{type === 'training' ? t('Training day plan') : t('Rest day plan')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Which meal, what you eat, and when.')}</div>
    <div className="nu-filters">
      {offer.map(k => <button key={k} className={'chip' + (meal === k ? ' on' : '')} onClick={() => pickMeal(k)}>{mealLabel(k)}</button>)}
    </div>
    <div className="nu-cap" style={{ marginTop: 6 }}>{t('Eat')}</div>
    <div className="list" style={{ marginBottom: 12 }}>
      {n.meals.map(m => {
        const sum = sumItems(S, m.items)
        return <div key={m.id} className="item" {...tappable(() => setSaved(m.id))} aria-pressed={saved === m.id}>
          <FoodTile food={sum} icon={foodOf(S, m.items[0]?.food)?.icon} />
          <div className="grow"><div className="tt">{m.name}</div><div className="ss">{kcalText(sum.kcal)} kcal · {macroLine(sum)}</div></div>
          {saved === m.id && <Icon name="checkCircle" style={{ color: 'var(--acc)', fontSize: 22 }} />}
        </div>
      })}
      <div className="item" {...tappable(() => mealEditorSheet())}>
        <span className="nu-ficon" style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--acc)' }}><Icon name="plus" /></span>
        <div className="grow"><div className="tt">{t('New meal')}</div></div>
      </div>
    </div>
    <div className="nu-cap">{t('When')}</div>
    {type === 'training' && <Segmented value={timing} onChange={setTiming}
      options={[{ value: 'at', label: t('At a time') }, { value: 'before', label: t('Before workout') }, { value: 'after', label: t('After workout') }]} />}
    <div style={{ height: 10 }} />
    {timing === 'at' || type !== 'training'
      ? <label className="row between nu-field"><span className="muted">{t('Time')}</span><input type="time" className="timef" value={at} onChange={e => setAt(e.target.value)} aria-label={t('Time')} /></label>
      : <label className="nu-field"><span>{timing === 'before' ? t('Hours before the workout starts') : t('Hours after the workout ends')}</span>
        <span className="nu-unit"><NumberField className="field" value={hours} onChange={setHours} /><i>h</i></span></label>}
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {existing && <><div style={{ height: 8 }} /><Button variant="danger" onClick={remove}>{t('Take out of the plan')}</Button></>}
  </>
}
export const slotSheet = (type, meal) => ui().openSheet(close => <Slot type={type} meal={meal} close={close} />)

/* ------------------------------------------------------------ supplement -- */

function Supp({ supp, close }) {
  const [name, setName] = useState(supp?.name || '')
  const [dose, setDose] = useState(supp?.dose || '')
  const [timing, setTiming] = useState(supp?.post ? 'post' : 'at')
  const [at, setAt] = useState(hhmm(supp?.at ?? MEAL_AT.breakfast))
  const [restAt, setRestAt] = useState(hhmm(supp?.restAt ?? MEAL_AT.breakfast))
  const save = () => {
    if (!name.trim()) { toast(t('Give it a name')); return }
    update(s => { saveSupp(s, { id: supp?.id, name, dose, post: timing === 'post', at: fromHHMM(at), restAt: fromHHMM(restAt) }) })
    close()
  }
  const remove = () => { update(s => deleteSupp(s, supp.id)); close() }
  return <>
    <h3 style={{ marginBottom: 2 }}>{supp ? t('Edit supplement') : t('New supplement')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Ticked off each day on the Nutrition tab. No calories.')}</div>
    <div className="nu-grid2">
      <label className="nu-field"><span>{t('Name')}</span><TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('Creatine')} /></label>
      <label className="nu-field"><span>{t('Dose')}</span><TextField value={dose} onChange={e => setDose(e.target.value)} placeholder="5 g" /></label>
    </div>
    <Segmented value={timing} onChange={setTiming} options={[{ value: 'at', label: t('At a time') }, { value: 'post', label: t('After workout') }]} />
    <div style={{ height: 12 }} />
    {timing === 'at'
      ? <label className="row between nu-field"><span className="muted">{t('Every day at')}</span><input type="time" className="timef" value={at} onChange={e => setAt(e.target.value)} aria-label={t('Every day at')} /></label>
      : <>
        <div className="muted small" style={{ margin: '0 2px 10px' }}>{t('With the post-workout meal on training days.')}</div>
        <label className="row between nu-field"><span className="muted">{t('Rest days at')}</span><input type="time" className="timef" value={restAt} onChange={e => setRestAt(e.target.value)} aria-label={t('Rest days at')} /></label>
      </>}
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {supp && <><div style={{ height: 8 }} /><Button variant="danger" onClick={remove}>{t('Delete')}</Button></>}
  </>
}
export const suppSheet = supp => ui().openSheet(close => <Supp supp={supp} close={close} />)

/** "With the post-workout meal · rest days 09:00" / "22:30" */
export function suppWhen(sp) {
  return sp.post ? t('After workout · rest days {0}', hhmm(Number.isFinite(sp.restAt) ? sp.restAt : MEAL_AT.breakfast)) : t('Every day {0}', hhmm(Number.isFinite(sp.at) ? sp.at : MEAL_AT.breakfast))
}
