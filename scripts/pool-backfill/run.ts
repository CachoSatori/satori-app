// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Backfill de tip_sessions.pool_total_crc contra STAGING.
//
//  Cómo correrlo (desde la raíz del repo; requiere .env.local con VITE_SUPABASE_URL de staging y
//  el token de la Management API en el Keychain "Supabase CLI" o SUPABASE_ACCESS_TOKEN):
//
//    DRY-RUN (default, NO escribe):
//      node --import ./scripts/pool-backfill/register.mjs scripts/pool-backfill/run.ts
//
//    APLICAR (escribe SOLO pool_total_crc; exige que la mig 051 ya esté aplicada en staging):
//      POOL_BACKFILL_APPLY=yes node --import ./scripts/pool-backfill/register.mjs scripts/pool-backfill/run.ts
//
//  Flags: --focus=YYYY-MM (detalle por sesión; default 2026-07).
//  Candado: assertStaging aborta si el .env no apunta a staging. --apply solo escribe en staging.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { loadEnv, assertStaging, mgmtToken } from '../t0-reconciliacion-cajas/env.ts'
import { refFromEnv, verificarRechazoDeEscritura, contarTablas, applyPoolTotalStaging } from './mgmt.ts'
import { leerYArmar } from './runner.ts'
import { fi } from './report.ts'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const focus = args.find((a) => a.startsWith('--focus='))?.split('=')[1] ?? '2026-07'
  const apply = process.env.POOL_BACKFILL_APPLY === 'yes' && !args.includes('--dry-run')

  const env = loadEnv()
  const ref = refFromEnv(env)
  assertStaging(ref) // ← staging o nada

  const token = mgmtToken(env)
  if (!token) {
    throw new Error(
      'Sin token de Management API (SUPABASE_ACCESS_TOKEN o Keychain "Supabase CLI"). ' +
        'La anon key NO sirve: RLS devuelve 200 con [].',
    )
  }

  // Prueba de que el canal es read-only de verdad (aunque staging tolere más, mantenemos el rito).
  const smoke = await verificarRechazoDeEscritura(ref, token)
  const antes = await contarTablas(ref, token)

  const res = await leerYArmar('STAGING', ref, token, focus)
  console.log(res.text)
  console.log('')
  console.log(`Canal read-only OK (el server rechazó la sonda de escritura): ${smoke}`)
  console.log(`Conteos antes: ${JSON.stringify(antes)}`)

  if (!apply) {
    const despues = await contarTablas(ref, token)
    const iguales = JSON.stringify(antes) === JSON.stringify(despues)
    console.log(`Conteos después: ${JSON.stringify(despues)} → ${iguales ? 'sin cambios ✅' : 'CAMBIARON ❌'}`)
    console.log('\nDRY-RUN: no se escribió nada. Para aplicar (staging): POOL_BACKFILL_APPLY=yes')
    return
  }

  // ── APLICAR (staging) ────────────────────────────────────────────────────────────────────────
  if (!res.hadColumn) {
    throw new Error('--apply pero la columna pool_total_crc NO existe en staging. Aplicá la mig 051 primero.')
  }
  const cambios = res.plans.filter((p) => p.changed).map((p) => ({ id: p.id, poolTotal: p.poolTotal }))
  console.log(`\nAPLICANDO en staging: ${cambios.length} sesiones (escribe SOLO pool_total_crc)…`)
  const n = await applyPoolTotalStaging(ref, token, cambios)
  const despues = await contarTablas(ref, token)
  const iguales = JSON.stringify(antes) === JSON.stringify(despues)
  console.log(`Escritas ${n} filas · total del período ${fi(res.months.reduce((a, m) => a + m.total, 0))}`)
  console.log(`Conteos después: ${JSON.stringify(despues)} → filas ${iguales ? 'iguales ✅ (solo se tocó una columna)' : 'CAMBIARON ❌'}`)
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e))
  process.exitCode = 1
})
