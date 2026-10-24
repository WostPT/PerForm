// PerForm: a simple line drawing per kind of food, in the icon set's stroke style
// (components/Icon.jsx), tinted by the food's main macro where it is used.
import { mainMacro } from '../lib/perform-nutrition.js'

const D = {
  apple: 'M12 7.5c-1.6-1.3-5.2-1.6-6.6 1.4S5 16.2 7.6 19.2c1.7 1.9 3.3 1.8 4.4 1.1 1.1.7 2.7.8 4.4-1.1 2.6-3 3.6-7.3 2.2-10.3S13.6 6.2 12 7.5zM12 7.5c0-2 .8-3.6 2.6-4.5',
  banana: 'M4.5 6.5c0 7.5 4.5 13 11.5 13 2.2 0 3.6-.7 4-1.6-6.3-.2-10.6-4.6-12-11.4zM4.5 6.5 4 4.5',
  drumstick: 'M8.2 15.8C5 13.4 5.4 7.8 9.4 5c3.7-2.6 9-1.7 10.7 2.3 1.6 3.8-.9 7.9-5.3 9-2 .5-3.6.4-4.9-.2zM8.2 15.8l-2 2M6.2 17.8a1.6 1.6 0 1 0-1.7 2.2 1.6 1.6 0 1 0 2.2-1.7M12 8.5c1.4-.9 3.4-.8 4.6.3',
  fish: 'M2.5 12c2.8-3.6 6.6-5 10.5-4.3 2.4.4 4.6 2.1 5.5 4.3-.9 2.2-3.1 3.9-5.5 4.3-3.9.7-7.7-.7-10.5-4.3zM18.5 12l3-3v6zM14.5 11h.01',
  egg: 'M12 3c-3.4 0-6 5.4-6 10a6 6 0 0 0 12 0c0-4.6-2.6-10-6-10z',
  bowl: 'M3 11h18a9 9 0 0 1-18 0zM6.5 11c.4-2.2 2.7-3.8 5.5-3.8s5.1 1.6 5.5 3.8M9 6.5h.01M12 5.5h.01M15 6.5h.01',
  pasta: 'M3 11h18a9 9 0 0 1-18 0zM6 11c1-1.3 2-1.3 3 0s2 1.3 3 0 2-1.3 3 0 2 1.3 3 0M16 3l-3.5 8',
  potato: 'M5.5 9.5c1.3-4.2 7.4-6.2 11.3-3.2s3.2 9.5-1.1 11.6-11 1.8-11.2-3.2c-.1-2 .3-3.4 1-5.2zM10 10h.01M14 9h.01M12.5 14h.01',
  glass: 'M6.5 3h11l-1.4 18H7.9zM7.1 9h9.8',
  steak: 'M3.5 13.5c0-5.2 5-8.5 10.2-8.5 3.8 0 6.8 2.4 6.8 6 0 4.6-4.3 8.5-10 8.5-4.2 0-7-2.3-7-6zM15.5 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  broccoli: 'M12 21v-7M9.5 21h5M12 14l-2.5-2.5M12 14l2.5-2.5M7 12a3 3 0 0 1 .5-6 4.5 4.5 0 0 1 9 0 3 3 0 0 1 .5 6z',
  cup: 'M5 9h14l-1.8 11.2a1 1 0 0 1-1 .8H7.8a1 1 0 0 1-1-.8zM4 6h16v3H4z',
  bottle: 'M10 3h4v3.5l2.2 3V20a1 1 0 0 1-1 1H8.8a1 1 0 0 1-1-1V9.5l2.2-3zM9 13.5c1 .6 2 .6 3 0s2-.6 3 0',
  wheat: 'M12 21V8M12 8c-2.2-.9-3.2-2.8-3.2-5 2.2.9 3.2 2.8 3.2 5zM12 8c2.2-.9 3.2-2.8 3.2-5-2.2.9-3.2 2.8-3.2 5zM12 13.5c-2.2-.9-3.2-2.8-3.2-5 2.2.9 3.2 2.8 3.2 5zM12 13.5c2.2-.9 3.2-2.8 3.2-5-2.2.9-3.2 2.8-3.2 5z',
  can: 'M4.5 8c0-1.7 3.4-3 7.5-3s7.5 1.3 7.5 3v8c0 1.7-3.4 3-7.5 3s-7.5-1.3-7.5-3zM4.5 8c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3',
  bar: 'M3.5 9.5h17v5h-17zM8 9.5v5M12 9.5v5M16 9.5v5',
  bread: 'M5 20V11.5A3.5 3.5 0 0 1 3.5 8.6C3.5 6 6.6 4 12 4s8.5 2 8.5 4.6A3.5 3.5 0 0 1 19 11.5V20zM9 9.5l1.5 1.5M13 8.5l1.5 1.5',
  leaf: 'M5 19c0-8 5-13.5 14-14-.5 9-6 14-14 14zM5 19l7-7',
  nut: 'M12 3.5c3.6 0 6 2.9 6 6.6 0 4.6-3 10.4-6 10.4s-6-5.8-6-10.4c0-3.7 2.4-6.6 6-6.6zM12 6.5v11',
  cheese: 'M3.5 18.5V11L17 5.5l3.5 5.5v7.5zM3.5 11h17M9 14.5h.01M14.5 15.5h.01',
  citrus: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7v10M7 12h10M8.5 8.5l7 7M15.5 8.5l-7 7',
  berry: 'M8 13.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM16 13.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 7a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 7V3.5l2.5-1',
  mug: 'M4.5 8.5h12v7a4.5 4.5 0 0 1-4.5 4.5H9a4.5 4.5 0 0 1-4.5-4.5zM16.5 10.5h1.5a2.5 2.5 0 0 1 0 5h-1.5M8 3.5v2M12 3.5v2',
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7zM7 10l7 7',
  drop: 'M12 3c-3 4-6.5 7.5-6.5 11.2a6.5 6.5 0 0 0 13 0C18.5 10.5 15 7 12 3z',
  dumbbell: 'M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
}
export const FOOD_ICONS = Object.keys(D).filter(k => !['pill', 'drop', 'dumbbell', 'moon'].includes(k))

// The macro colours of the whole Nutrition tab.
export const MACRO_COLOR = { p: 'var(--blue)', c: 'var(--orange)', f: 'var(--purple)', fb: 'var(--brown)' }
export const tintOf = m => MACRO_COLOR[mainMacro(m)]

export default function FoodIcon({ name, size = 20, className = '', style }) {
  return <svg className={'icn ' + className} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" style={style}>
    <path d={D[name] || D.bowl} />
  </svg>
}

/** The rounded tile a food's drawing sits in, tinted by what it is mostly made of. */
export function FoodTile({ food, size = 36, icon }) {
  return <span className="nu-ficon" style={{ width: size, height: size, borderRadius: Math.round(size * 0.27), color: food ? tintOf(food) : 'var(--acc)' }}>
    <FoodIcon name={icon || food?.icon} size={Math.round(size * 0.58)} />
  </span>
}
