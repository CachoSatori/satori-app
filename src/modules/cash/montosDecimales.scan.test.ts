import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Escaneo de los inputs de montos de dinero que vienen de un documento o de un medio electrónico
// (factura, movimiento, pago, Bandeja, precio de línea). Tienen que aceptar céntimos: un
// <input type="number"> sin `step` solo acepta enteros y el navegador marca inválido 12345.67.
// Se usa step="any" (no "0.01"): con "0.01" algunos motores calculan el paso en coma flotante y marcan
// inválidos valores como 10.5 (happy-dom lo hace); "any" acepta cualquier decimal en todos.
// Los conteos de efectivo físico y la pantalla de cierres quedan afuera a propósito (ver el PR).

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

const CASOS: [archivo: string, ancla: string][] = [
  ['modules/cash/AgregarAsistente.tsx', 'aria-label="Monto colones"'],
  ['modules/cash/AgregarAsistente.tsx', 'aria-label="Monto dólares"'],
  ['modules/cash/CashMovimientos.tsx', 'value={nmCRC}'],
  ['modules/cash/CashMovimientos.tsx', 'value={nmUSD}'],
  ['modules/cash/CashMovimientos.tsx', "key={m.id + '-crc'}"],
  ['modules/cash/CashMovimientos.tsx', "key={m.id + '-usd'}"],
  ['modules/cash/CashTurno.tsx', 'aria-label="Monto ₡ del pago"'],
  ['modules/cash/CashTurno.tsx', 'aria-label="Monto $ del pago"'],
  ['modules/inbox/InboxModule.tsx', 'value={total}'],
  ['shared/InvLineTable.tsx', 'value={l.precio}'],
  ['modules/crm/ClientesModule.tsx', 'value={iAmount}'],
]

describe('inputs de montos de dinero aceptan céntimos', () => {
  it.each(CASOS)('%s · %s → type="number" con step="any"', (archivo, ancla) => {
    const tag = inputCon(leer(archivo), ancla)
    expect(tag).toContain('type="number"')
    expect(tag).toContain('step="any"')
  })

  it('CreditoModals: los montos de texto abren el teclado con punto decimal (inputMode="decimal")', () => {
    const f = leer('modules/cash/CreditoModals.tsx')
    expect(inputCon(f, 'value={monto}')).toContain('inputMode="decimal"')
    expect(inputCon(f, 'value={montos[m.id]')).toContain('inputMode="decimal"')
  })
})
