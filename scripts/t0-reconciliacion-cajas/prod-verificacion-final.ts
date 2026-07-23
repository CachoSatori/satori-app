// VERIFICACIÓN FINAL EN PROD — READ-ONLY, los 5 números del paso 7.
//
//   T0_PROD_FIRMADO=2026-07-22 node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//     scripts/t0-reconciliacion-cajas/prod-verificacion-final.ts
//
// Mide lo que ve la PANTALLA, no lo que dice un SELECT crudo. La diferencia importa: la app
// trae los movimientos con `getAllCashMovements(days = 1000)`, así que las filas anteriores a
// esa ventana NO existen para la UI — entre ellas el huérfano de fecha imposible `9b79e731`
// (2020-07-09, ₡74.126,92), documentado en REPORTE-T0B-PROD.md §3.f.
//
// Reproduce las mismas funciones que la pantalla: `saldoTarjetaEfectivo` para la tarjeta y la
// misma aritmética de CashMovimientos para las tarjetas de período.

import { loadEnv } from './env.ts'
import { abrirProdFirmado, cerrarProd } from './prod-gate.ts'
import { saldoTarjetaEfectivo } from '../../src/modules/cash/tarjetaPozo.ts'
import { POZO_CORTE, SUBCAT_APERTURA_POZO } from '../../src/modules/cash/cierrePozo.ts'
import { isEgreso } from '../../src/modules/cash/cashUtils.ts'
import type { CashMovement, CashSession, CashCierreDia, MovementType } from '../../src/shared/types/database.ts'

const fi = (n: number) => '₡' + n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fd = (n: number) => '$' + n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Lo que muestra la UI: `fi()` de la app redondea a colón entero. */
const pantalla = (n: number) => '₡ ' + Math.round(n).toLocaleString('es-CR')

const DIAS_FETCH = 1000   // getAllCashMovements(days = 1000)

const env = loadEnv()
const ap = await abrirProdFirmado(env, 'scripts/t0-reconciliacion-cajas/prod-verificacion-final.ts')
console.log(`[gate] smoke de rechazo de escritura: ${String(ap.smoke).slice(0, 80)}…`)

const todos = (await ap.lector.fetchAll('cash_movements')) as unknown as CashMovement[]
const sessions = (await ap.lector.fetchAll('cash_sessions')) as unknown as CashSession[]
const cierres = (await ap.lector.fetchAll('cash_cierres_dia')) as unknown as CashCierreDia[]

// Ventana del fetch de la app.
const corte = new Date(); corte.setDate(corte.getDate() - DIAS_FETCH)
const desdeFetch = corte.toISOString().slice(0, 10)
const movements = todos.filter(m => String(m.created_at).slice(0, 10) >= desdeFetch)
console.log(`\n=== VENTANA DE LA APP ===`)
console.log(`  getAllCashMovements(${DIAS_FETCH}) → desde ${desdeFetch}`)
console.log(`  filas en la base: ${todos.length} · filas que la app ve: ${movements.length} · fuera de ventana: ${todos.length - movements.length}`)

// El huérfano: confirmar que existe y que la app NO lo ve.
const huerfano = todos.filter(m => String(m.id).startsWith('9b79e731'))
for (const h of huerfano) {
  const visible = String(h.created_at).slice(0, 10) >= desdeFetch
  console.log(`  huérfano ${String(h.id).slice(0, 8)} · created_at=${h.created_at} · ${fi(Number(h.amount_crc))} · status=${h.status}`)
  console.log(`    ${visible ? '❌ LA APP LO VE' : '✅ fuera de la ventana — la app NO lo muestra'}`)
}

let mal = 0
const chk = (ok: boolean, m: string) => { console.log(`  ${ok ? '✅' : '❌'} ${m}`); if (!ok) mal++ }

// ── 1 · Efectivo en caja ────────────────────────────────────────────────────
const t = saldoTarjetaEfectivo(movements, sessions)
console.log(`\n=== 1 · EFECTIVO EN CAJA ===`)
console.log(`  ${pantalla(t.crc)} / ${fd(t.usd)} · esPozo=${t.esPozo} · desdeApertura=${t.desdeApertura}`)
console.log(`  indeterminados: ${t.indeterminados.cantidad}`)
chk(t.crc === 744570, `la tarjeta dice ${pantalla(744570)}`)
chk(t.usd === 3441, `y ${fd(3441)}`)
chk(t.esPozo === true, `en MODO POZO ("Efectivo en caja"), desde ${POZO_CORTE}`)

// ── 2 · Pend. Transferencia ─────────────────────────────────────────────────
const pend = movements.filter(m => m.status === 'pendiente')
const pendTotal = pend.reduce((s, m) => s + (Number(m.amount_crc) || 0), 0)
console.log(`\n=== 2 · PEND. TRANSFERENCIA ===`)
console.log(`  ${pantalla(pendTotal)} · ${pend.length} pago(s)`)
for (const p of pend) console.log(`    ${fi(Number(p.amount_crc) || 0).padStart(16)}  "${String(p.description).slice(0, 44)}"`)
chk(Math.round(pendTotal) === 250573, `suma ${pantalla(250573)} en pantalla`)
chk(pend.length === 4, `son 4 pagos`)

// ── 3 · Tarjetas de período (filtro por defecto: desde el corte) ────────────
const sesionFecha = new Map(sessions.map(s => [s.id, s.session_date]))
const dateCR = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date(iso))
const movFecha = (m: CashMovement) => sesionFecha.get(m.session_id ?? '') ?? dateCR(m.created_at)
const esApertura = (m: CashMovement) =>
  /ajuste apertura/i.test(m.subcategory || '') || /ajuste apertura/i.test(m.description || '')
  || m.subcategory === SUBCAT_APERTURA_POZO
const periodo = movements.filter(m => movFecha(m) >= POZO_CORTE)
const totIng = periodo.filter(m => m.movement_type === 'ingreso' && !esApertura(m)).reduce((s, m) => s + (Number(m.amount_crc) || 0), 0)
const totEgr = periodo.filter(m => isEgreso(m.movement_type as MovementType) && !esApertura(m)).reduce((s, m) => s + (Number(m.amount_crc) || 0), 0)
const ajustes = cierres.filter(c => c.session_date >= POZO_CORTE && Number(c.diferencia_crc) !== 0)
console.log(`\n=== 3 · TARJETAS DE PERÍODO (desde ${POZO_CORTE}) ===`)
console.log(`  movimientos en el período: ${periodo.length}`)
for (const m of periodo) console.log(`    ${movFecha(m)} ${String(m.movement_type).padEnd(18)} ${fi(Number(m.amount_crc)).padStart(15)}  "${String(m.description).slice(0, 38)}"${esApertura(m) ? '  ← excluido del período' : ''}`)
console.log(`  Ingresos (período): ${pantalla(totIng)}`)
console.log(`  Egresos  (período): ${pantalla(totEgr)}`)
console.log(`  Ajustes: ${ajustes.length === 0 ? '"Sin diferencias"' : `${ajustes.length} cierre(s)`}`)
chk(totIng === 0, `Ingresos (período) en 0`)
chk(totEgr === 0, `Egresos (período) en 0`)
chk(ajustes.length === 0, `Ajustes: "Sin diferencias"`)

// ── 4 · El histórico sigue accesible e idéntico ─────────────────────────────
const historico = movements.filter(m => movFecha(m) < POZO_CORTE)
const sumaHist = historico.reduce((s, m) => s + (Number(m.amount_crc) || 0), 0)
console.log(`\n=== 4 · HISTÓRICO (ampliando el filtro) ===`)
console.log(`  ${historico.length} movimientos anteriores al corte · suma ${fi(sumaHist)}`)
console.log(`  cierres sellados: ${cierres.length}`)
chk(historico.length > 0 && cierres.length === 17, `el histórico sigue entero (${historico.length} mov · ${cierres.length} cierres)`)

// ── 5 · Criterio del movimiento de prueba de ₡1.000 (cálculo puro) ──────────
const prueba = {
  id: 'prueba', session_id: null, movement_type: 'egreso_mercaderia', amount_crc: 1000, amount_usd: 0,
  method: 'Efectivo', caja_origen: 'Caja Proveedores', status: 'aprobado', subcategory: '',
  description: 'PRUEBA', created_at: `${POZO_CORTE}T12:00:00+00:00`,
} as unknown as CashMovement
const conPrueba = saldoTarjetaEfectivo([...movements, prueba], sessions)
console.log(`\n=== 5 · EGRESO DE PRUEBA ₡1.000 (Caja Proveedores, efectivo) ===`)
console.log(`  ${pantalla(t.crc)} → ${pantalla(conPrueba.crc)} · delta ${fi(conPrueba.crc - t.crc)}`)
chk(conPrueba.crc - t.crc === -1000, `baja EXACTAMENTE ₡1.000 (cálculo puro — no se escribió nada)`)

const c = await cerrarProd(ap)
console.log(`\n[gate] conteos: ${JSON.stringify(c.despues)} · ${c.iguales ? '✅ nada cambió durante la lectura' : '❌ cambió'}`)
console.log(`\n${mal === 0 ? '✅ LOS 5 NÚMEROS DAN EXACTO' : `❌ ${mal} CHEQUEO(S) NO DAN EXACTO — rollback`}\n`)
if (mal) process.exitCode = 1
