// PerForm: Home's "Nutrition today" card — calories left, the four macro bars, and water as a row
// of drops: one tap fills the next glass (250 ml).
import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { dayView, nutritionOf, targetsFor, addWater, GLASS_ML } from '../lib/perform-nutrition.js'
import Icon from './Icon.jsx'
import { MACRO_COLOR } from './PerformFoodIcon.jsx'
import { KcalHead, fmtL } from '../views/Nutrition.jsx'
import '../perform-nutrition.css'

const update = (...a) => useStore.getState().update(...a)
const DROP = 'M12 3c-3 4-6.5 7.5-6.5 11.2a6.5 6.5 0 0 0 13 0C18.5 10.5 15 7 12 3z'

export default function PerformNutritionCard() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const iso = todayISO()
  const v = dayView(S, iso)
  const tg = targetsFor(S, iso)
  const target = nutritionOf(S).water
  const glasses = Math.max(1, Math.min(20, Math.round(target / GLASS_ML)))
  const filled = Math.floor(v.water / GLASS_ML)
  // the drop that just filled plays a small pop; the others stay still
  const popped = useRef(-1)
  const add = d => { popped.current = d > 0 ? filled : -1; update(s => addWater(s, iso, d)) }
  const macros = [['p', t('Protein')], ['c', t('Carbs')], ['f', t('Fat')], ['fb', t('Fibre')]]
  return <div className="card">
    <button onClick={() => nav('/nutrition')} aria-label={t('Open Nutrition')} style={{ display: 'block', width: '100%', textAlign: 'start' }}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <span className="nu-cap" style={{ margin: 0 }}>{t('Nutrition today')}</span>
        <span className="row small" style={{ gap: 2, color: 'var(--acc)' }}>{t('Open')}<Icon name="chevronRight" /></span>
      </div>
      <KcalHead total={v.total} tg={tg} />
      <div className="nu-grid4" style={{ marginTop: 14 }}>
        {macros.map(([k, label]) => <div key={k}>
          <div className="small" style={{ color: MACRO_COLOR[k] }}>{label}</div>
          <div style={{ fontSize: 14, marginTop: 2, whiteSpace: 'nowrap' }}>{Math.round(v.total[k])} <span className="muted small">/ {tg[k]}</span></div>
          <div className="nu-mtrack"><div className="nu-fill" style={{ width: Math.min(100, tg[k] ? (v.total[k] / tg[k]) * 100 : 0) + '%', background: MACRO_COLOR[k] }} /></div>
        </div>)}
      </div>
    </button>
    <div className="nu-sep" />
    <div className="row" style={{ gap: 6 }}>
      <button className="grow" onClick={() => add(GLASS_ML)} aria-label={t('Add a glass of water, 250 ml')} style={{ textAlign: 'start', minHeight: 48 }}>
        <div className="row between small"><span><span className="nu-water" style={{ fontWeight: 600 }}>{t('Water')}</span> <span className="muted">{t('{0} of {1} L', fmtL(v.water), fmtL(target))}</span></span><span className="muted">{t('tap to add 250 ml')}</span></div>
        <div className="nu-drops">
          {Array.from({ length: glasses }, (_, i) => <span key={i + (i === popped.current ? '-p' + filled : '')} className={'nu-drop' + (i < filled ? ' on' : '') + (i === popped.current && i < filled ? ' pop' : '')}>
            <svg width="16" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d={DROP} /></svg>
          </span>)}
        </div>
      </button>
      <button className="iconbtn" onClick={() => add(-GLASS_ML)} disabled={!v.water} aria-label={t('Remove 250 ml of water')} style={{ background: 'none', color: 'var(--label-2)' }}><Icon name="minus" /></button>
    </div>
  </div>
}
