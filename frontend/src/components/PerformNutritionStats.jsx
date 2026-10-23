// PerForm: Stats' nutrition card — the last 7 days' averages against the targets of those days.
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { todayISO, fmtNum } from '../lib/format.js'
import { averages, nutritionOf } from '../lib/perform-nutrition.js'
import Icon from './Icon.jsx'
import { MACRO_COLOR } from './PerformFoodIcon.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import '../perform-nutrition.css'

export default function PerformNutritionStats() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const a = averages(S, todayISO(), 7)
  const water = nutritionOf(S).water
  const rows = a ? [
    ['kcal', t('Calories'), 'kcal', 'var(--acc)'],
    ['p', t('Protein'), 'g', MACRO_COLOR.p], ['c', t('Carbs'), 'g', MACRO_COLOR.c],
    ['f', t('Fat'), 'g', MACRO_COLOR.f], ['fb', t('Fibre'), 'g', MACRO_COLOR.fb],
  ] : []
  return <div className="card tappable" style={{ cursor: 'pointer' }} {...tappable(() => nav('/nutrition'))}>
    <div className="row between" style={{ marginBottom: 6 }}>
      <h2 style={{ margin: 0 }}>{t('Nutrition')}</h2>
      <Icon name="chevronRight" className="chev" />
    </div>
    {!a ? <div className="muted small">{t('Nothing logged in the last 7 days. Log a meal on the Nutrition tab and the weekly averages show here.')}</div> : <>
      <div className="muted small" style={{ marginBottom: 12 }}>{a.days
        ? t('Daily average · {0} of the last 7 days logged', a.days)
        : t('Only water logged in the last 7 days')}</div>
      {a.days > 0 && <div className="nu-macros" style={{ marginTop: 0 }}>
        {rows.map(([k, label, unit, color]) => {
          const target = a.target[k]
          return <div key={k}>
            <div className="row between small">
              <span style={{ color, fontWeight: 600 }}>{label}</span>
              <span><b style={{ fontWeight: 600 }}>{fmtNum(Math.round(a[k]))}</b> <span className="muted">/ {fmtNum(Math.round(target))} {unit}</span></span>
            </div>
            <div className="nu-mtrack"><div className="nu-fill" style={{ width: Math.min(100, target ? (a[k] / target) * 100 : 0) + '%', background: color }} /></div>
          </div>
        })}
      </div>}
      {a.water > 0 && <div className="row between small" style={{ marginTop: 12 }}>
        <span className="nu-water" style={{ fontWeight: 600 }}>{t('Water')}</span>
        <span><b style={{ fontWeight: 600 }}>{fmtNum(Math.round(a.water / 100) / 10)}</b> <span className="muted">/ {fmtNum(Math.round(water / 100) / 10)} L</span></span>
      </div>}
    </>}
  </div>
}
