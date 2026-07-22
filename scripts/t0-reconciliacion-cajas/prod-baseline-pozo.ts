// LÍNEA BASE de PRODUCCIÓN — READ-ONLY, por el canal firmado de siempre.
//
//   T0_PROD_FIRMADO=2026-07-22 node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//     scripts/t0-reconciliacion-cajas/prod-baseline-pozo.ts
//
// NO escribe nada: `abrirProdFirmado` prueba primero que el canal RECHAZA escrituras (25006)
// y todas las consultas van en transacción `read_only`.
//
// Deja por escrito, ANTES del asiento de arranque:
//   · conteos de las tablas del ledger (la evidencia del "+1 exacto" después)
//   · si el asiento ya existe (idempotencia)
//   · qué muestra HOY la tarjeta y qué mostrará DESPUÉS del asiento (cálculo puro, sin escribir)
//   · los pendientes de transferencia y las tarjetas de período con el filtro nuevo
//   · una huella del ledger para probar que ninguna otra fila cambió

import { loadEnv } from './env.ts'
import { abrirProdFirmado, cerrarProd } from './prod-gate.ts'
import { saldoTarjetaEfectivo } from '../../src/modules/cash/tarjetaPozo.ts'
import { POZO_CORTE } from '../../src/modules/cash/cierrePozo.ts'
import { isEgreso } from '../../src/modules/cash/cashUtils.ts'
import type { CashMovement, CashSession, CashCierreDia, MovementType } from '../../src/shared/types/database.ts'

const fi = (n: number) => '₡' + n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fd = (n: number) => '$' + n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const APERTURA_DESC = `Apertura pozo ${POZO_CORTE}`
const APERTURA_CRC = 744_570
const APERTURA_USD = 3_441

const env = loadEnv()
const ap = await abrirProdFirmado(env, 'scripts/t0-reconciliacion-cajas/prod-baseline-pozo.ts')
console.log(`\n[gate] smoke de rechazo de escritura en PROD: ${ap.smoke}`)
console.log(`[gate] conteos ANTES: ${JSON.stringify(ap.conteosAntes)}`)

const movements = (await ap.lector.fetchAll('cash_movements')) as unknown as CashMovement[]
const sessions = (await ap.lector.fetchAll('cash_sessions')) as unknown as CashSession[]
const cierres = (await ap.lector.fetchAll('cash_cierres_dia')) as unknown as CashCierreDia[]

console.log(`\n=== UNIVERSO PROD ===`)
console.log(`  movimientos: ${movements.length} · sesiones: ${sessions.length} · cierres: ${cierres.length}`)

// ── Idempotencia: ¿ya existe el asiento? ───────────────────────────────────
const yaExiste = movements.filter(m => m.description === APERTURA_DESC)
console.log(`\n=== ASIENTO DE ARRANQUE ===`)
console.log(`  filas con description = "${APERTURA_DESC}": ${yaExiste.length}`)
const conApertura = movements.filter(m => m.subcategory === 'Apertura pozo')
console.log(`  filas con subcategory = 'Apertura pozo' (cualquier fecha): ${conApertura.length}`)

// ── Tarjeta: HOY (pre-asiento) y DESPUÉS (cálculo puro) ────────────────────
const hoy = saldoTarjetaEfectivo(movements, sessions)
console.log(`\n=== TARJETA DE EFECTIVO ===`)
console.log(`  HOY (sin el asiento): ${fi(hoy.crc)} / ${fd(hoy.usd)} · esPozo=${hoy.esPozo} · desdeApertura=${hoy.desdeApertura}`)

// El asiento tal cual lo va a insertar el script (misma forma que recordAperturaPozo).
const asiento = {
  id: '00000000-0000-0000-0000-000000000000', session_id: null, created_by: null,
  movement_type: 'ingreso', amount_crc: APERTURA_CRC, amount_usd: APERTURA_USD,
  currency: 'CRC', exchange_rate: null, description: APERTURA_DESC, subcategory: 'Apertura pozo',
  supplier_id: null, supplier_name: '', employee_name: '', method: 'Efectivo',
  shift: '', caja_origen: 'Caja Fuerte', status: 'aprobado',
  created_at: `${POZO_CORTE}T12:00:00+00:00`, updated_at: `${POZO_CORTE}T12:00:00+00:00`,
} as unknown as CashMovement

const despues = saldoTarjetaEfectivo([...movements, asiento], sessions)
console.log(`  DESPUÉS del asiento:  ${fi(despues.crc)} / ${fd(despues.usd)} · esPozo=${despues.esPozo} · desdeApertura=${despues.desdeApertura}`)
console.log(`  indeterminados: ${despues.indeterminados.cantidad} · ${fi(despues.indeterminados.crc)}`)
const okTarjeta = despues.crc === APERTURA_CRC && despues.usd === APERTURA_USD
console.log(`  ${okTarjeta ? '✅' : '❌'} ¿la tarjeta dará EXACTAMENTE ${fi(APERTURA_CRC)} / ${fd(APERTURA_USD)}?`)

// ── Pend. Transferencia (NO se filtra por período) ─────────────────────────
const pend = movements.filter(m => m.status === 'pendiente')
const pendTotal = pend.reduce((s, m) => s + (Number(m.amount_crc) || 0), 0)
console.log(`\n=== PEND. TRANSFERENCIA (sin filtrar por período) ===`)
console.log(`  ${fi(pendTotal)} · ${pend.length} pago(s)`)
for (const p of pend) console.log(`    ${fi(Number(p.amount_crc) || 0).padStart(16)}  "${String(p.description).slice(0, 46)}"`)

// ── Tarjetas de PERÍODO con el filtro nuevo (desde = corte) ────────────────
const sesionFecha = new Map(sessions.map(s => [s.id, s.session_date]))
const dateCR = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date(iso))
const movFecha = (m: CashMovement) => sesionFecha.get(m.session_id ?? '') ?? dateCR(m.created_at)
const esAperturaAjuste = (m: CashMovement) => /ajuste apertura/i.test(m.subcategory || '') || /ajuste apertura/i.test(m.description || '')
const enPeriodo = movements.filter(m => movFecha(m) >= POZO_CORTE)
const totIngresos = enPeriodo.filter(m => m.movement_type === 'ingreso' && !esAperturaAjuste(m)).reduce((s, m) => s + (Number(m.amount_crc) || 0), 0)
const totEgresos = enPeriodo.filter(m => isEgreso(m.movement_type as MovementType) && !esAperturaAjuste(m)).reduce((s, m) => s + (Number(m.amount_crc) || 0), 0)
const ajustes = cierres.filter(c => c.session_date >= POZO_CORTE && Number(c.diferencia_crc) !== 0)
console.log(`\n=== TARJETAS DE PERÍODO (filtro por defecto: desde ${POZO_CORTE}) ===`)
console.log(`  movimientos en el período (hoy, sin el asiento): ${enPeriodo.length}`)
console.log(`  Ingresos (período): ${fi(totIngresos)}`)
console.log(`  Egresos  (período): ${fi(totEgresos)}`)
console.log(`  Ajustes: ${ajustes.length === 0 ? '"Sin diferencias"' : `${ajustes.length} cierre(s)`}`)
console.log(`  ⚠️ tras el asiento, Ingresos del período sumará ${fi(APERTURA_CRC)} (el asiento ES un ingreso)`)

// ── Criterio del movimiento de prueba de ₡1.000 (cálculo puro, sin escribir) ─
const prueba = { ...asiento, id: 'test', amount_crc: 1_000, amount_usd: 0,
  movement_type: 'egreso_mercaderia', caja_origen: 'Caja Proveedores',
  description: 'PRUEBA', subcategory: '' } as unknown as CashMovement
const conPrueba = saldoTarjetaEfectivo([...movements, asiento, prueba], sessions)
console.log(`\n=== CRITERIO: egreso de prueba ₡1.000 efectivo (Caja Proveedores) ===`)
console.log(`  ${fi(despues.crc)} → ${fi(conPrueba.crc)} · delta ${fi(conPrueba.crc - despues.crc)}`)
console.log(`  ${conPrueba.crc - despues.crc === -1000 ? '✅' : '❌'} baja EXACTAMENTE ₡1.000 (cálculo puro — no se escribió nada)`)

// ── Huella del ledger, para probar después que nada más cambió ──────────────
const huella = movements
  .map(m => `${m.id}|${m.amount_crc}|${m.amount_usd}|${m.status}|${m.description}`)
  .sort().join('\n')
let h = 0
for (let i = 0; i < huella.length; i++) { h = ((h << 5) - h + huella.charCodeAt(i)) | 0 }
console.log(`\n=== HUELLA DEL LEDGER (antes) ===`)
console.log(`  filas: ${movements.length} · hash: ${h}`)
console.log(`  suma amount_crc: ${fi(movements.reduce((s, m) => s + (Number(m.amount_crc) || 0), 0))}`)

const cierre = await cerrarProd(ap)
console.log(`\n[gate] conteos DESPUÉS: ${JSON.stringify(cierre.despues)}`)
console.log(`[gate] ${cierre.iguales ? '✅ nada cambió durante la lectura' : '❌ algo cambió'}\n`)
