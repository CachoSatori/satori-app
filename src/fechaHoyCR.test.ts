// (12-nov, auditoría) «Hoy» se calcula en hora de Costa Rica (`todayCR()`), nunca con la fecha UTC.
// `new Date().toISOString().slice(0, 10)` da la fecha UTC: después de las 18:00 de Costa Rica ya es «mañana».
// En pleno servicio de la noche eso corría los rangos por defecto de Ventas y daba por terminada una
// competencia que terminaba hoy.
//
// Esta prueba no deja que el patrón vuelva a aparecer en `src/`. Lo que queda en la lista de abajo:
//   · NOMBRE_DE_ARCHIVO: la fecha solo va en el nombre de una descarga o en la ruta de un adjunto. No afecta datos.
//   · PENDIENTE_CON_FIRMA: fechas por defecto de registros de Caja, Bandeja e Inventario. Tienen el mismo error,
//     pero tocan registros de plata o de stock: se corrigen con la firma del dueño (ver la auditoría del 12-nov).
import { test, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = new URL('.', import.meta.url).pathname

const HOY_EN_UTC = /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/

const NOMBRE_DE_ARCHIVO = [
  'modules/cash/comprobante.ts',
  'modules/club/Reportes.tsx',
  'modules/inventario/InvIngredientes.tsx',
  'modules/ventas/VentasConfig.tsx',
  'shared/api/documents.ts',
  'shared/api/facturas.ts',
]

const PENDIENTE_CON_FIRMA = [
  'modules/cash/CreditoModals.tsx',
  'modules/inbox/InboxModule.tsx',
  'modules/inventario/InvMovimientos.tsx',
  'shared/api/inventario.ts',
]

// Tiene `todayCR`/`fechaCR` como primera opción y la fecha UTC solo como último recurso.
const CON_RESPALDO_CR = ['modules/ventas/VentasPromPaxExplicado.tsx']

const PERMITIDOS = new Set([...NOMBRE_DE_ARCHIVO, ...PENDIENTE_CON_FIRMA, ...CON_RESPALDO_CR])

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? archivos(p) : [p]
  })
}

const conPatron = archivos(SRC)
  .filter(p => /\.(ts|tsx)$/.test(p) && !/\.test\.(ts|tsx)$/.test(p))
  .filter(p => HOY_EN_UTC.test(readFileSync(p, 'utf8')))
  .map(p => relative(SRC, p))
  .sort()

test('ningún archivo nuevo calcula «hoy» con la fecha UTC', () => {
  expect(conPatron.filter(p => !PERMITIDOS.has(p))).toEqual([])
})

test('la lista de permitidos no tiene archivos que ya se corrigieron', () => {
  expect([...PERMITIDOS].filter(p => !conPatron.includes(p)).sort()).toEqual([])
})
