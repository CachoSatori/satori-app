// @vitest-environment happy-dom
//
// Propinas con céntimos (firma del dueño, 14-nov): los inputs de ₡ de Propinas tenían step={100} y el
// tipo de cambio de Propinas no tenía step (= enteros), así que el navegador marcaba inválido
// 15000.50 o un TC de 505.37. Ahora usan step="any" (no "0.01": happy-dom calcula el paso en coma
// flotante y marca inválido, p. ej., 10.5).
//
// TipsModule y TipHistory son pantallas grandes; en vez de montarlas, la prueba toma la etiqueta
// <input …> REAL de la fuente, copia sus atributos type/min/max/step a un <input> de happy-dom y
// le pide checkValidity() con céntimos. Si alguien vuelve a step={100}, el input reconstruido es
// inválido y la prueba cae.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = resolve(__dirname, '../..')
const leer = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8')

/** La etiqueta <input …> completa (puede ocupar varias líneas) que contiene `ancla`. */
function inputCon(fuente: string, ancla: string): string {
  const i = fuente.indexOf(ancla)
  expect(i, `no se encontró «${ancla}»`).toBeGreaterThanOrEqual(0)
  const ini = fuente.lastIndexOf('<input', i)
  const fin = fuente.indexOf('/>', i)
  return fuente.slice(ini, fin + 2)
}

/** Lee un atributo JSX: attr="x" o attr={x}. null si no está. */
function atributo(tag: string, nombre: string): string | null {
  const m = tag.match(new RegExp(`\\b${nombre}=(?:"([^"]*)"|\\{([^}]*)\\})`))
  return m ? (m[1] ?? m[2]).trim() : null
}

/** Un <input> de happy-dom con los mismos type/min/max/step que la fuente. */
function reconstruir(tag: string): HTMLInputElement {
  const el = document.createElement('input')
  for (const a of ['type', 'min', 'max', 'step']) {
    const v = atributo(tag, a)
    if (v !== null) el.setAttribute(a, v)
  }
  return el
}

const CASOS: [archivo: string, ancla: string, valor: string][] = [
  ['modules/tips/TipsModule.tsx', 'value={valorInput(efectivoCRC)}', '15000.50'],
  ['modules/tips/TipsModule.tsx', 'value={valorInput(barraCRC)}', '15000.50'],
  ['modules/tips/TipsModule.tsx', 'value={valorInput(barraElecCRC)}', '15000.50'],
  ['modules/tips/TipsModule.tsx', 'value={valorInput(line.propina_crc)}', '15000.50'],
  ['modules/tips/TipsModule.tsx', 'value={valorInput(exchangeRate)}', '505.37'],
  ['modules/tips/TipHistory.tsx', 'value={valorInput(ePoolCRC)}', '15000.50'],
  ['modules/tips/TipHistory.tsx', 'value={valorInput(ePoolBarra)}', '15000.50'],
  ['modules/tips/TipHistory.tsx', 'value={valorInput(ePoolBarraElec)}', '15000.50'],
  ['modules/tips/TipHistory.tsx', 'value={valorInput(r.propina_crc)}', '15000.50'],
]

describe('Propinas: los inputs de ₡ y el tipo de cambio aceptan céntimos', () => {
  it.each(CASOS)('%s · %s acepta %s', (archivo, ancla, valor) => {
    const tag = inputCon(leer(archivo), ancla)
    expect(atributo(tag, 'type')).toBe('number')
    const el = reconstruir(tag)
    el.value = valor
    expect(el.validity.stepMismatch, `stepMismatch: ${tag}`).toBe(false)
    expect(el.checkValidity(), `checkValidity: ${tag}`).toBe(true)
  })

  it('control: la prueba sí detecta el step={100} viejo', () => {
    const viejo = reconstruir('<input type="number" step={100} min={0} />')
    viejo.value = '15000.50'
    expect(viejo.checkValidity()).toBe(false)
  })
})
