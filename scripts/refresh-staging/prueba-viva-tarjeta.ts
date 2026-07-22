// CRITERIO DE ÉXITO DE LA TARJETA, verificado EN VIVO contra staging.
//
//   node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//        scripts/refresh-staging/prueba-viva-tarjeta.ts
//
// Registra dos movimientos de prueba, mide la tarjeta después de cada uno y LOS BORRA.
//
//   1. Egreso EFECTIVO de ₡10.000 desde Caja Proveedores → la tarjeta debe bajar EXACTAMENTE 10.000.
//   2. Egreso por TRANSFERENCIA/Banco de ₡10.000        → la tarjeta NO se debe mover.
//
// El saldo NO se reimplementa: se importa `saldoTarjetaEfectivo` del código de la app, así lo
// que se mide es lo que la pantalla calcula. El borrado va en `finally`: si una aserción falla,
// las filas de prueba se limpian igual.

import { leerDeStaging, escribirEnStaging, token, verificarRefs } from './gate.ts'
import { loadEnv } from '../t0-reconciliacion-cajas/env.ts'
import { esc } from './lib.ts'
import { saldoTarjetaEfectivo } from '../../src/modules/cash/tarjetaPozo.ts'
import type { CashMovement, CashSession } from '../../src/shared/types/database.ts'

verificarRefs()
const tok = token(loadEnv())

const MARCA = 'PRUEBA-CRITERIO-TARJETA-2026-07-22'
const fi = (n: number) => '₡' + n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const NUMERICA = /(_crc|_usd|_rate|_cambio)$/
function coerce<T>(f: Record<string, unknown>): T {
  const o: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) {
    o[k] = NUMERICA.test(k) && typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
  }
  return o as T
}
async function traer<T>(sql: string): Promise<T[]> {
  const out: T[] = []
  for (let off = 0; ; off += 500) {
    const lote = (await leerDeStaging(`${sql} limit 500 offset ${off}`, tok)) as Record<string, unknown>[]
    out.push(...lote.map(f => coerce<T>(f)))
    if (lote.length < 500) return out
  }
}

/** El saldo que mostraría la tarjeta AHORA, con los datos vivos de staging. */
async function tarjeta(): Promise<{ crc: number; usd: number; esPozo: boolean; desde: string | null }> {
  const movs = await traer<CashMovement>('select * from public.cash_movements order by id')
  const ses = await traer<CashSession>('select * from public.cash_sessions order by id')
  const t = saldoTarjetaEfectivo(movs, ses)
  return { crc: t.crc, usd: t.usd, esPozo: t.esPozo, desde: t.desdeApertura }
}

async function insertar(caja: string, method: string, etiqueta: string): Promise<void> {
  await escribirEnStaging(
    `insert into public.cash_movements
       (session_id, created_by, movement_type, amount_crc, amount_usd, currency, exchange_rate,
        description, subcategory, supplier_id, supplier_name, employee_name, shift, caja_origen,
        method, status)
     values (null,
       (select id from public.profiles where email = 'satorisushibar@gmail.com' limit 1),
       'egreso_operativo', 10000, 0, 'CRC', null,
       ${esc(`${MARCA} · ${etiqueta}`)}, 'Prueba', null, '', '', '', ${esc(caja)}, ${esc(method)}, 'aprobado')`,
    tok,
  )
}

async function borrarPruebas(): Promise<number> {
  const r = (await escribirEnStaging(
    `with d as (delete from public.cash_movements where description like ${esc(MARCA + '%')} returning 1)
     select count(*)::int as n from d`,
    tok,
  )) as { n: number }[]
  return Number(r[0]?.n ?? 0)
}

let fallos = 0
const chequeo = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? '✅' : '❌'} ${msg}`)
  if (!ok) fallos++
}

try {
  // Higiene: que no queden restos de una corrida anterior.
  const restos = await borrarPruebas()
  if (restos) console.log(`[limpieza previa] se borraron ${restos} fila(s) de una corrida anterior`)

  const base = await tarjeta()
  console.log(`\n=== BASE ===`)
  console.log(`  tarjeta: ${fi(base.crc)} / $${base.usd.toFixed(2)} · esPozo=${base.esPozo} · desdeApertura=${base.desde}`)
  chequeo(base.esPozo === true, 'la tarjeta está en MODO POZO (post-corte)')

  // ── 1 · Egreso EFECTIVO desde Caja Proveedores → debe bajar exactamente 10.000 ──
  await insertar('Caja Proveedores', 'Efectivo', 'egreso efectivo Caja Proveedores')
  const conEfectivo = await tarjeta()
  const deltaEf = conEfectivo.crc - base.crc
  console.log(`\n=== 1 · EGRESO EFECTIVO ₡10.000 desde Caja Proveedores ===`)
  console.log(`  tarjeta: ${fi(conEfectivo.crc)}  ·  delta = ${fi(deltaEf)}`)
  chequeo(deltaEf === -10000, `la tarjeta bajó EXACTAMENTE ₡10.000 (delta observado ${fi(deltaEf)})`)

  // ── 2 · Egreso por TRANSFERENCIA/Banco → no debe mover nada ──
  await insertar('Banco', 'Transferencia', 'egreso transferencia Banco')
  const conTransf = await tarjeta()
  const deltaTr = conTransf.crc - conEfectivo.crc
  console.log(`\n=== 2 · EGRESO ₡10.000 por TRANSFERENCIA (Banco) ===`)
  console.log(`  tarjeta: ${fi(conTransf.crc)}  ·  delta = ${fi(deltaTr)}`)
  chequeo(deltaTr === 0, `la Transferencia NO movió la tarjeta (delta observado ${fi(deltaTr)})`)

  // ── 3 · Estabilidad: releer no cambia el número ──
  const relectura = await tarjeta()
  console.log(`\n=== 3 · ESTABILIDAD (releer sin registrar nada) ===`)
  console.log(`  tarjeta: ${fi(relectura.crc)}`)
  chequeo(relectura.crc === conTransf.crc, 'el número NO cambia solo al releer')
} finally {
  const n = await borrarPruebas()
  console.log(`\n=== LIMPIEZA ===`)
  console.log(`  filas de prueba borradas: ${n}`)
  const final = await tarjeta()
  console.log(`  tarjeta tras limpiar: ${fi(final.crc)} / $${final.usd.toFixed(2)}`)
  console.log(`\n${fallos === 0 ? '✅ CRITERIO DE ÉXITO CUMPLIDO' : `❌ ${fallos} CHEQUEO(S) FALLARON`}\n`)
  if (fallos) process.exitCode = 1
}
