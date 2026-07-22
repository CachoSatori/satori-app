// VACIADO de las tablas de OPERACIÓN de STAGING — arranque de cero.
//
//   node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//        scripts/refresh-staging/vaciar-operacion.ts --confirmar
//
// Deja la base como si el restaurante abriera por primera vez: sin movimientos, sin turnos,
// sin cierres, sin propinas — pero CON los catálogos (proveedores, empleados, tipo de cambio,
// puntos de propina por rol) y con `profiles` intacta (sus ids son los de auth.users: tocarla
// rompe el login).
//
// TRES CANDADOS:
//   1. Escribe por `escribirEnStaging` (gate.ts): ref de staging clavado en código. PROD no
//      es alcanzable desde acá ni pasando otro ref.
//   2. `VACIAR ⊆ TABLAS_REFRESH` se verifica en tiempo de ejecución: solo se borra lo que el
//      backup sabe guardar Y el restore sabe reponer. Un backup del que no se puede volver
//      no es un backup.
//   3. Exige `--confirmar`. Sin la bandera, imprime el plan y no toca nada.
//
// ORDEN: HIJOS → PADRES, del grafo real de FKs (pg_catalog).
//   tip_entries → tip_sessions (CASCADE) · cash_movements → cash_sessions (CASCADE)
// Borrar el padre primero funcionaría por cascada, pero deja el conteo sin explicar: se hace
// explícito para que el reporte diga cuántas filas se fueron por cada tabla.

import { escribirEnStaging, leerDeStaging, TABLAS_REFRESH, token, verificarRefs } from './gate.ts'
import { loadEnv } from '../t0-reconciliacion-cajas/env.ts'

verificarRefs()
const tok = token(loadEnv())

/** Orden HIJOS → PADRES. Todas deben estar en TABLAS_REFRESH (candado 2). */
const VACIAR = [
  'tip_entries',        // → tip_sessions (CASCADE)
  'tip_sessions',
  'documents',          // → cash_movements (SET NULL): se va antes para no dejar links huérfanos
  'movement_deletions', // auditoría de borrados del ledger que se está vaciando
  'cash_movements',     // → cash_sessions (CASCADE)
  'cash_sessions',
  'cash_cierres_dia',   // sin FKs, ni hijo ni padre
] as const

/** Catálogos y config: se CONSERVAN. */
const CONSERVAR = ['suppliers', 'employees', 'exchange_rates', 'role_tip_points', 'profiles'] as const

for (const t of VACIAR) {
  if (!(TABLAS_REFRESH as readonly string[]).includes(t)) {
    throw new Error(`ABORTADO: ${t} no está en TABLAS_REFRESH — el backup no la guarda y el restore no la repone.`)
  }
}

const contar = async (t: string): Promise<number> => {
  const r = (await leerDeStaging(`select count(*)::int as n from public."${t}"`, tok)) as { n: number }[]
  return Number(r[0]?.n ?? -1)
}

const antes: Record<string, number> = {}
for (const t of [...VACIAR, ...CONSERVAR]) antes[t] = await contar(t)

console.log('\n=== PLAN ===')
console.log('  A VACIAR (hijos → padres):')
for (const t of VACIAR) console.log(`    ${t.padEnd(22)} ${String(antes[t]).padStart(6)} filas`)
console.log('  A CONSERVAR:')
for (const t of CONSERVAR) console.log(`    ${t.padEnd(22)} ${String(antes[t]).padStart(6)} filas`)

if (!process.argv.includes('--confirmar')) {
  console.log('\n[vaciar] SIMULACRO — sin --confirmar no se tocó nada.\n')
  process.exit(0)
}

console.log('\n=== VACIANDO ===')
for (const t of VACIAR) {
  await escribirEnStaging(`delete from public."${t}"`, tok)
  const n = await contar(t)
  console.log(`  ${t.padEnd(22)} ${String(antes[t]).padStart(6)} → ${String(n).padStart(4)} ${n === 0 ? '✅' : '❌ NO QUEDÓ EN CERO'}`)
}

console.log('\n=== CONSERVADAS (deben estar intactas) ===')
let mal = 0
for (const t of CONSERVAR) {
  const n = await contar(t)
  const ok = n === antes[t]
  if (!ok) mal++
  console.log(`  ${t.padEnd(22)} ${String(antes[t]).padStart(6)} → ${String(n).padStart(4)} ${ok ? '✅ intacta' : '❌ CAMBIÓ'}`)
}

// Residuo conocido: tablas fuera del alcance del backup que referencian lo borrado con
// ON DELETE SET NULL. No se tocan (no habría cómo restaurarlas), pero se reportan.
console.log('\n=== RESIDUO fuera de alcance (referencias que quedaron en NULL) ===')
for (const t of ['inventory_review_task', 'inventory_movements', 'ingredient_prices']) {
  console.log(`  ${t.padEnd(22)} ${String(await contar(t)).padStart(6)} filas (intactas; sus links a movimientos/documentos quedaron NULL)`)
}

console.log(`\n${mal === 0 ? '✅ VACIADO COMPLETO' : `❌ ${mal} catálogo(s) cambiaron`}\n`)
if (mal) process.exitCode = 1
