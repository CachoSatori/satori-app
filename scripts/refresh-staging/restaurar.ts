// RESTORE de STAGING desde un backup JSON. Solo staging (candado de gate.ts).
//
//   node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//        scripts/refresh-staging/restaurar.ts --sello <carpeta>

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv, REPO_ROOT } from '../t0-reconciliacion-cajas/env.ts'
import { escribirEnStaging, TABLAS_REFRESH, token, verificarRefs } from './gate.ts'
import { columnasDe, contar, sentenciasInsert, type Fila } from './lib.ts'

/**
 * Orden PADRES → HIJOS. Sale del grafo real de FKs (pg_catalog, no information_schema:
 * ésa no las reporta). `cash_movements.session_id → cash_sessions` es ON DELETE CASCADE,
 * así que restaurar en el orden equivocado borra lo que ya se había restaurado.
 */
const ORDEN_RESTORE: string[] = [
  'employees', 'suppliers', 'exchange_rates', 'role_tip_points',
  'cash_sessions', 'tip_sessions',
  'cash_movements', 'tip_entries',
  // `cash_cierres_dia` faltaba en esta lista: el backup SÍ la guarda, pero el restore la
  // saltaba en silencio y la tabla quedaba como estuviera. Sin FKs (ni hijo ni padre), así
  // que su posición es indiferente. Se agregó al vaciar staging para el arranque de cero:
  // un backup del que no se puede restaurar lo que se borró no es un backup.
  'cash_cierres_dia',
  'documents', 'movement_deletions',
]

function arg(n: string): string | undefined {
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  verificarRefs()
  const sello = arg('--sello')
  if (!sello) throw new Error('Falta --sello <carpeta del backup>')
  const dir = resolve(REPO_ROOT, '_backups-staging', sello)
  if (!existsSync(dir)) throw new Error(`No existe el backup ${dir}`)
  const tok = token(loadEnv())

  // OJO con el ORDEN: `cash_movements.session_id → cash_sessions` es ON DELETE CASCADE.
  // Borrar cash_sessions se lleva puestos los movimientos que ya se habían restaurado, así
  // que se restaura en orden PADRES → HIJOS y se permite acotar con --solo.
  const solo = arg('--solo')
  const tablas = solo ? solo.split(',') : ORDEN_RESTORE
  console.log(`[restore] ${dir} → STAGING (${tablas.join(', ')})`)
  for (const t of tablas) {
    if (!(TABLAS_REFRESH as readonly string[]).includes(t)) throw new Error(`Tabla fuera del alcance: ${t}`)
    const f = resolve(dir, `${t}.json`)
    if (!existsSync(f)) { console.log(`  ${t}: sin archivo, se omite`); continue }
    const filas = JSON.parse(readFileSync(f, 'utf8')) as Fila[]
    const cols = await columnasDe(t, tok)
    await escribirEnStaging(`delete from public.${t}`, tok)
    for (const sql of sentenciasInsert(t, filas, cols)) await escribirEnStaging(sql, tok)
    console.log(`  ${t.padEnd(22)} ${String(await contar(t, tok, 'staging')).padStart(6)} filas restauradas`)
  }
  console.log('[restore] ✅')
}

main().catch((e: unknown) => {
  console.error(`[restore] ABORTADO: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
