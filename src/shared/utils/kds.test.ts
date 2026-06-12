import { describe, it, expect } from 'vitest'
import { timerColor, fmtElapsed, sortByCategory } from './kds'

describe('timerColor — verde→ámbar→rojo por umbral del curso', () => {
  it('holgado → verde', () => expect(timerColor(100, 600)).toBe('verde'))
  it('cerca del umbral (≥66%) → ámbar', () => expect(timerColor(420, 600)).toBe('ambar'))
  it('en o pasado el umbral → rojo', () => {
    expect(timerColor(600, 600)).toBe('rojo')
    expect(timerColor(900, 600)).toBe('rojo')
  })
  it('umbral 0 o inválido → verde (no alarma sin config)', () => expect(timerColor(50, 0)).toBe('verde'))
})

describe('fmtElapsed', () => {
  it('formatea m:ss', () => {
    expect(fmtElapsed(0)).toBe('0:00')
    expect(fmtElapsed(65)).toBe('1:05')
    expect(fmtElapsed(600)).toBe('10:00')
  })
})

describe('sortByCategory — orden configurable de Admin', () => {
  const items = [
    { n: 'roll', tipo: 'Sushi' },
    { n: 'mojito', tipo: 'Bebidas' },
    { n: 'edamame', tipo: 'Entradas' },
    { n: 'raro', tipo: 'SinCategoria' },
  ]
  it('respeta el orden de category_order, lo no listado va al final', () => {
    const order = ['Bebidas', 'Entradas', 'Sushi']
    const sorted = sortByCategory(items, order, i => i.tipo).map(i => i.n)
    expect(sorted).toEqual(['mojito', 'edamame', 'roll', 'raro'])
  })
  it('sin orden configurado → alfabético por tipo', () => {
    const sorted = sortByCategory(items, [], i => i.tipo).map(i => i.tipo)
    expect(sorted).toEqual(['Bebidas', 'Entradas', 'SinCategoria', 'Sushi'])
  })
})

describe('refinamiento 06-12 — orden escalonado y postres', () => {
  it('postres suben primero y el resto sigue el orden de subcategoría', async () => {
    const { sortForTicket } = await import('./kds')
    const items = [
      { n: 'ROLL', sc: 'Rolls', t: 'Sushi' },
      { n: 'FLAN', sc: 'Postres', t: 'Dulces' },
      { n: 'TIRADITO', sc: 'Crudos', t: 'Sushi' },
    ]
    const out = sortForTicket(items, ['Crudos', 'Rolls', 'Postres'], true, i => i.sc, i => i.t)
    expect(out.map(i => i.n)).toEqual(['FLAN', 'TIRADITO', 'ROLL'])
  })
  it('sin prioridad de postres, manda el orden configurado', async () => {
    const { sortForTicket } = await import('./kds')
    const items = [{ n: 'FLAN', sc: 'Postres', t: '' }, { n: 'TIRADITO', sc: 'Crudos', t: '' }]
    expect(sortForTicket(items, ['Crudos', 'Postres'], false, i => i.sc, i => i.t).map(i => i.n)).toEqual(['TIRADITO', 'FLAN'])
  })
  it('thresholdFor: postre usa el umbral corto propio', async () => {
    const { thresholdFor } = await import('./kds')
    expect(thresholdFor('principal', 'Postres', { principal: 900 }, 240)).toBe(240)
    expect(thresholdFor('principal', 'Rolls', { principal: 900 }, 240)).toBe(900)
  })
})
