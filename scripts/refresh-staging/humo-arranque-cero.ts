// ARRANQUE DE CERO — verificación del estado vacío + prueba de humo de la lógica.
//
//   node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//        scripts/refresh-staging/humo-arranque-cero.ts
//
// PARTE A · la base vacía no muestra estados raros (tarjeta ₡0, pendientes 0, listas vacías,
//           Caja Diaria abrible por primera vez sin carryover que trabe).
// PARTE B · ciclo corto de 4 pasos que ejercita la lógica del pozo con datos limpios.
//
// Los saldos NO se reimplementan: se importa el código real de la app. Las filas de prueba se
// borran en `finally` — la base tiene que quedar VACÍA pase lo que pase.

import { leerDeStaging, escribirEnStaging, token, verificarRefs } from './gate.ts'
import { loadEnv } from '../t0-reconciliacion-cajas/env.ts'
import { esc } from './lib.ts'
import { saldoTarjetaEfectivo } from '../../src/modules/cash/tarjetaPozo.ts'
import { propinasPorPagarDe } from '../../src/modules/cash/propinaPago.ts'
import type { CashMovement, CashSession } from '../../src/shared/types/database.ts'

verificarRefs()
const tok = token(loadEnv())
const MARCA = 'HUMO-ARRANQUE-CERO'
const fi = (n: number) => '₡' + n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const NUMERICA = /(_crc|_usd|_rate|_cambio)$/
const coerce = <T,>(f: Record<string, unknown>): T => Object.fromEntries(
  Object.entries(f).map(([k, v]) => [k,
    NUMERICA.test(k) && typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]),
) as T

async function traer<T>(sql: string): Promise<T[]> {
  const out: T[] = []
  for (let off = 0; ; off += 500) {
    const lote = (await leerDeStaging(`${sql} limit 500 offset ${off}`, tok)) as Record<string, unknown>[]
    out.push(...lote.map(f => coerce<T>(f)))
    if (lote.length < 500) return out
  }
}
const contar = async (t: string): Promise<number> =>
  Number(((await leerDeStaging(`select count(*)::int as n from public."${t}"`, tok)) as { n: number }[])[0].n)

async function tarjeta(): Promise<ReturnType<typeof saldoTarjetaEfectivo>> {
  const movs = await traer<CashMovement>('select * from public.cash_movements order by id')
  const ses = await traer<CashSession>('select * from public.cash_sessions order by id')
  return saldoTarjetaEfectivo(movs, ses)
}

let fallos = 0
const chequeo = (ok: boolean, msg: string) => { console.log(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) fallos++ }

/** Inserta un movimiento a nivel día (session_id null), como hace createDayMovement. */
async function insertar(p: {
  tipo: string; caja: string; method: string; crc: number; usd?: number
  subcategory?: string; etiqueta: string
}): Promise<void> {
  await escribirEnStaging(
    `insert into public.cash_movements
       (session_id, created_by, movement_type, amount_crc, amount_usd, currency, exchange_rate,
        description, subcategory, supplier_id, supplier_name, employee_name, shift, caja_origen,
        method, status)
     values (null,
       (select id from public.profiles where email = 'satorisushibar@gmail.com' limit 1),
       ${esc(p.tipo)}, ${p.crc}, ${p.usd ?? 0}, 'CRC', null,
       ${esc(`${MARCA} · ${p.etiqueta}`)}, ${esc(p.subcategory ?? 'Prueba')},
       null, '', '', '', ${esc(p.caja)}, ${esc(p.method)}, 'aprobado')`,
    tok,
  )
}

const limpiar = async (): Promise<number> => Number((
  (await escribirEnStaging(
    `with d as (delete from public.cash_movements where description like ${esc(MARCA + '%')} returning 1)
     select count(*)::int as n from d`, tok)) as { n: number }[])[0].n)

try {
  await limpiar()   // higiene por si quedó algo de una corrida anterior

  // ── PARTE A · ESTADO VACÍO ────────────────────────────────────────────────
  console.log('\n════ PARTE A · LA BASE VACÍA NO MUESTRA ESTADOS RAROS ════\n')

  const vacias = ['cash_movements', 'cash_sessions', 'cash_cierres_dia', 'tip_sessions', 'tip_entries', 'documents', 'movement_deletions']
  for (const t of vacias) chequeo(await contar(t) === 0, `${t} está en 0`)

  const catalogos: Record<string, number> = { suppliers: 75, employees: 35, exchange_rates: 3, role_tip_points: 7, profiles: 5 }
  for (const [t, n] of Object.entries(catalogos)) {
    const real = await contar(t)
    chequeo(real === n, `${t} conservada (${real} filas)`)
  }

  const t0 = await tarjeta()
  console.log(`\n  tarjeta con base vacía: ${fi(t0.crc)} / $${t0.usd.toFixed(2)}`)
  chequeo(t0.crc === 0 && t0.usd === 0, 'la tarjeta muestra ₡0 / $0')
  chequeo(t0.esPozo === true, 'está en modo POZO (no cae al rótulo viejo "Caja Fuerte")')
  chequeo(t0.desdeApertura === null, 'no promete una fecha de apertura que no existe')
  chequeo(t0.indeterminados.cantidad === 0, 'sin warnings de traspasos indeterminados')

  // Pendientes de transferencia: movimientos con status 'pendiente'.
  const movs0 = await traer<CashMovement>('select * from public.cash_movements order by id')
  chequeo(movs0.filter(m => m.status === 'pendiente').length === 0, 'Pendientes en 0')
  chequeo(propinasPorPagarDe([], movs0).length === 0, 'Propinas por pagar en 0')

  // Caja Diaria abrible por primera vez: sin cierre previo no hay carryover que trabe, y no
  // existe una sesión de hoy que bloquee la apertura (getPreviousCierre → null).
  const cierresPrevios = await contar('cash_cierres_dia')
  const sesionesHoy = await traer<CashSession>(`select * from public.cash_sessions where session_date = '2026-07-22' order by id`)
  chequeo(cierresPrevios === 0, 'sin cierres previos → getPreviousCierre devuelve null → sin carryover sugerido')
  chequeo(sesionesHoy.length === 0, 'sin sesión del día → la Caja Diaria se puede abrir por primera vez')

  // ── PARTE B · HUMO DE LA LÓGICA ───────────────────────────────────────────
  console.log('\n════ PARTE B · CICLO CORTO CON DATOS LIMPIOS ════\n')

  await insertar({ tipo: 'traspaso', caja: 'Banco', method: 'Transferencia', crc: 500_000,
                   subcategory: 'Banco → Caja Fuerte', etiqueta: 'a) traspaso Banco → Caja Fuerte' })
  const a = await tarjeta()
  console.log(`  a) Traspaso 'Banco → Caja Fuerte' ₡500.000  →  tarjeta ${fi(a.crc)}`)
  chequeo(a.crc === 500_000, 'a) la tarjeta dice ₡500.000')

  await insertar({ tipo: 'egreso_mercaderia', caja: 'Caja Proveedores', method: 'Efectivo', crc: 10_000,
                   etiqueta: 'b) egreso efectivo Caja Proveedores' })
  const b = await tarjeta()
  console.log(`  b) Egreso EFECTIVO ₡10.000 (Caja Proveedores)  →  tarjeta ${fi(b.crc)}   Δ ${fi(b.crc - a.crc)}`)
  chequeo(b.crc === 490_000, 'b) la tarjeta baja exacto a ₡490.000')

  await insertar({ tipo: 'egreso_mercaderia', caja: 'Banco', method: 'Transferencia', crc: 50_000,
                   etiqueta: 'c) egreso por transferencia' })
  const c = await tarjeta()
  console.log(`  c) Egreso TRANSFERENCIA ₡50.000                →  tarjeta ${fi(c.crc)}   Δ ${fi(c.crc - b.crc)}`)
  chequeo(c.crc === 490_000, 'c) la tarjeta NO se mueve (₡490.000): no tocó efectivo')

  await insertar({ tipo: 'ingreso', caja: 'Registradora', method: 'Efectivo', crc: 20_000,
                   etiqueta: 'd) ingreso efectivo' })
  const d = await tarjeta()
  console.log(`  d) Ingreso EFECTIVO ₡20.000 (Registradora)     →  tarjeta ${fi(d.crc)}   Δ ${fi(d.crc - c.crc)}`)
  chequeo(d.crc === 510_000, 'd) la tarjeta sube exacto a ₡510.000')

  console.log(`\n  cuenta final: 500.000 − 10.000 − 0 + 20.000 = ${fi(d.crc)}`)
  chequeo(d.crc === 500_000 - 10_000 + 20_000, 'la aritmética del ciclo cierra al colón')
} finally {
  const n = await limpiar()
  console.log('\n════ LIMPIEZA ════\n')
  console.log(`  filas de prueba borradas: ${n}`)
  const final = await tarjeta()
  const total = await contar('cash_movements')
  console.log(`  cash_movements: ${total} · tarjeta: ${fi(final.crc)} / $${final.usd.toFixed(2)} · esPozo=${final.esPozo}`)
  chequeo(total === 0, 'la base queda VACÍA')
  chequeo(final.crc === 0, 'la tarjeta vuelve a ₡0')
  console.log(`\n${fallos === 0 ? '✅ TODO VERDE — base vacía y lista para el arranque de la dueña' : `❌ ${fallos} CHEQUEO(S) FALLARON`}\n`)
  if (fallos) process.exitCode = 1
}
