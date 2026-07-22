// Inspección READ-ONLY de staging para mover el corte del pozo al 2026-07-22.
//
// No escribe nada. Responde tres preguntas con datos reales, no con supuestos:
//   1. ¿Qué asientos de apertura del pozo existen y con qué fecha operativa?
//   2. ¿Qué movimientos de efectivo tiene el 2026-07-22 y cuánto aporta cada uno al pozo?
//   3. ¿Qué número mostraría la tarjeta con el corte en 2026-07-22?
//
// La aritmética NO se reimplementa acá: se importan `saldoTarjetaEfectivo` / `contribucionPozo`
// del código de la app, así lo que se reporta es lo que la pantalla va a calcular.

import { leerDeStaging, token } from './gate.ts'
import { loadEnv } from '../t0-reconciliacion-cajas/env.ts'
import { saldoTarjetaEfectivo } from '../../src/modules/cash/tarjetaPozo.ts'
import { contribucionPozo } from '../../src/modules/cash/pozo.ts'
import { fechaOperativa, fechaAperturaPozo, esPostCorte, diasPendientesDeCierre } from '../../src/modules/cash/cierrePozo.ts'
import type { CashMovement, CashSession, CashCierreDia } from '../../src/shared/types/database.ts'

const CORTE_NUEVO = '2026-07-22'
const fi = (n: number) => '₡' + n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fd = (n: number) => '$' + n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const tok = token(loadEnv())

// La Management API devuelve `numeric` como STRING ("744575.00"). Sin coerción, `crc += c.crc`
// concatena en vez de sumar y el total sale como texto. Misma convención que
// scripts/t0-reconciliacion-cajas/db.ts. (La app NO tiene este problema: lee por PostgREST,
// que sí serializa numeric como número JSON.)
const NUMERICA = /(_crc|_usd|_rate|_cambio)$/
function coerce<T>(fila: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fila)) {
    out[k] = NUMERICA.test(k) && typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
  }
  return out as T
}

async function traer<T>(sql: string): Promise<T[]> {
  const out: T[] = []
  for (let off = 0; ; off += 500) {
    const lote = (await leerDeStaging(`${sql} limit 500 offset ${off}`, tok)) as Record<string, unknown>[]
    out.push(...lote.map(f => coerce<T>(f)))
    if (lote.length < 500) return out
  }
}

const movements = await traer<CashMovement>('select * from public.cash_movements order by id')
const sessions = await traer<CashSession>('select * from public.cash_sessions order by id')
const cierres = await traer<CashCierreDia>('select * from public.cash_cierres_dia order by id')
const sesionFecha = new Map(sessions.map(s => [s.id, s.session_date]))

console.log(`\n=== UNIVERSO ===`)
console.log(`movimientos: ${movements.length} · sesiones: ${sessions.length} · cierres: ${cierres.length}`)

// ── 1 · Asientos de apertura ────────────────────────────────────────────────
console.log(`\n=== 1 · ASIENTOS DE APERTURA DEL POZO ===`)
const aperturas = movements.filter(m => m.subcategory === 'Apertura pozo')
for (const a of aperturas) {
  console.log(`  ${a.id.slice(0, 8)} · fechaOperativa=${fechaOperativa(a, sesionFecha)} · ${fi(a.amount_crc || 0)} / ${fd(a.amount_usd || 0)}`)
  console.log(`      desc="${a.description}" · caja=${a.caja_origen} · tipo=${a.movement_type} · status=${a.status} · created_at=${a.created_at}`)
}
console.log(`  → fechaAperturaPozo (la más reciente) = ${fechaAperturaPozo(movements, sesionFecha)}`)

// ── 2 · Movimientos del 2026-07-22 ──────────────────────────────────────────
console.log(`\n=== 2 · MOVIMIENTOS CON FECHA OPERATIVA ${CORTE_NUEVO} ===`)
const delDia = movements.filter(m => fechaOperativa(m, sesionFecha) === CORTE_NUEVO)
let sumaDia = 0, sumaDiaUsd = 0
for (const m of delDia.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
  const c = contribucionPozo(m)
  sumaDia += c.crc; sumaDiaUsd += c.usd
  const signo = c.crc > 0 ? '+' : c.crc < 0 ? '−' : ' '
  console.log(`  ${signo} ${fi(Math.abs(c.crc)).padStart(16)} ${c.usd ? fd(c.usd) : ''}  [${c.clase}]`)
  console.log(`      "${m.description}" · ${m.movement_type} · caja=${m.caja_origen} · method=${m.method} · status=${m.status} · monto=${fi(m.amount_crc || 0)}`)
}
console.log(`  → aporte NETO del día al pozo: ${fi(sumaDia)} / ${fd(sumaDiaUsd)}  (${delDia.length} movimientos)`)

// ── 3 · Qué mostraría la tarjeta ────────────────────────────────────────────
console.log(`\n=== 3 · TARJETA con corte ${CORTE_NUEVO} ===`)
const ap = fechaAperturaPozo(movements, sesionFecha)
console.log(`  apertura=${ap} · esPostCorte(apertura, ${CORTE_NUEVO})=${ap ? esPostCorte(ap, CORTE_NUEVO) : 'n/a'}`)
const base = ap === null ? movements : movements.filter(m => fechaOperativa(m, sesionFecha) >= ap)
console.log(`  filas en la base (fechaOperativa >= apertura): ${base.length}`)
const t = saldoTarjetaEfectivo(movements, sessions)
console.log(`  saldoTarjetaEfectivo() con el corte COMPILADO HOY (${process.env.VITE_POZO_CORTE ?? 'fallback del build'}):`)
console.log(`     esPozo=${t.esPozo} · desdeApertura=${t.desdeApertura} · ${fi(t.crc)} / ${fd(t.usd)}`)
console.log(`     indeterminados: ${t.indeterminados.cantidad} · ${fi(t.indeterminados.crc)} / ${fd(t.indeterminados.usd)}`)

// Desglose de la base, fila por fila, para que el número sea auditable.
console.log(`\n=== 3b · DESGLOSE DE LA BASE DE LA TARJETA (colón por colón) ===`)
let acc = 0, accUsd = 0
for (const m of base.sort((a, b) => fechaOperativa(a, sesionFecha).localeCompare(fechaOperativa(b, sesionFecha)) || String(a.created_at).localeCompare(String(b.created_at)))) {
  const c = contribucionPozo(m)
  if (c.crc === 0 && c.usd === 0 && c.clase === 'fuera') continue
  acc += c.crc; accUsd += c.usd
  console.log(`  ${fechaOperativa(m, sesionFecha)}  ${(c.crc >= 0 ? '+' : '−') + fi(Math.abs(c.crc))}  ${c.usd ? (c.usd >= 0 ? '+' : '−') + fd(Math.abs(c.usd)) : ''}  [${c.clase}]  "${String(m.description).slice(0, 50)}"`)
}
console.log(`  → TOTAL: ${fi(acc)} / ${fd(accUsd)}`)

// ── 4 · Guard de cadena para el cierre del 22/07 ────────────────────────────
console.log(`\n=== 4 · GUARD DE CADENA para el cierre del ${CORTE_NUEVO} (corte=${CORTE_NUEVO}) ===`)
const pend = diasPendientesDeCierre({ fecha: CORTE_NUEVO, corte: CORTE_NUEVO, cierres, movements, sessions })
console.log(`  días que trabarían el cierre: ${pend.length}`)
for (const d of pend) console.log(`    ${d.fecha} · ${d.movimientos} mov · ${fi(d.crc)}`)
console.log(`  esPostCorte('${CORTE_NUEVO}', '${CORTE_NUEVO}') = ${esPostCorte(CORTE_NUEVO, CORTE_NUEVO)}`)

// ── 5 · Sesión abierta del día (para la prueba en vivo) ─────────────────────
console.log(`\n=== 5 · SESIONES DEL ${CORTE_NUEVO} ===`)
for (const s of sessions.filter(s => s.session_date === CORTE_NUEVO)) {
  console.log(`  ${s.id.slice(0, 8)} · ${s.shift_type} · status=${s.status} · fondo=${fi(s.initial_suppliers_crc || 0)}`)
}
console.log()
