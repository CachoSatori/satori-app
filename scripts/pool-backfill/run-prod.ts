// ─────────────────────────────────────────────────────────────────────────────────────────────
//  DRY-RUN READ-ONLY del backfill de pool_total_crc contra PRODUCCIÓN.
//
//  NO escribe: no importa nada del camino de escritura. Todo va con read_only:true, y antes de
//  leer un dato la sonda verificarRechazoDeEscritura() exige que el server rechace un write (25006).
//  Doble opt-in (prod-gate.ts): ref clavado + POOL_BACKFILL_PROD_FIRMADO=<fecha firmada>.
//
//  Cómo correrlo (desde la raíz; token en Keychain "Supabase CLI" o SUPABASE_ACCESS_TOKEN):
//    POOL_BACKFILL_PROD_FIRMADO=2026-08-05 \
//      node --import ./scripts/pool-backfill/register.mjs scripts/pool-backfill/run-prod.ts
//
//  Control: Julio 2026 debe dar ₡2.167.131 (== Estadísticas / Correo / Quincenal). Si no coincide,
//  sale con código ≠ 0.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { loadEnv, mgmtToken } from '../t0-reconciliacion-cajas/env.ts'
import { verificarRechazoDeEscritura, contarTablas } from './mgmt.ts'
import { exigirFirma, verificarRefClavado, REF_PROD_CLAVADO } from './prod-gate.ts'
import { leerYArmar } from './runner.ts'

const SCRIPT = 'scripts/pool-backfill/run-prod.ts'
const CONTROL = { month: '2026-07', crc: 2_167_131 }

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const focus = args.find((a) => a.startsWith('--focus='))?.split('=')[1] ?? CONTROL.month

  const env = loadEnv()
  exigirFirma(env, SCRIPT)   // candado 2: firma
  verificarRefClavado()      // candado 1: ref clavado == prod, != staging

  const token = mgmtToken(env)
  if (!token) {
    throw new Error(
      'Sin token de Management API (SUPABASE_ACCESS_TOKEN o Keychain "Supabase CLI"). ' +
        'La anon key NO sirve: RLS devuelve 200 con [].',
    )
  }

  // SMOKE: exige que prod RECHACE una escritura antes de leer un solo dato.
  const smoke = await verificarRechazoDeEscritura(REF_PROD_CLAVADO, token)
  const antes = await contarTablas(REF_PROD_CLAVADO, token)

  const res = await leerYArmar('PROD', REF_PROD_CLAVADO, token, focus, CONTROL)

  const despues = await contarTablas(REF_PROD_CLAVADO, token)
  const iguales = JSON.stringify(antes) === JSON.stringify(despues)

  console.log(res.text)
  console.log('')
  console.log(`Canal read-only OK (server rechazó la sonda de escritura): ${smoke}`)
  console.log(`Conteos antes:   ${JSON.stringify(antes)}`)
  console.log(`Conteos después: ${JSON.stringify(despues)} → ${iguales ? 'sin cambios ✅' : 'CAMBIARON ❌'}`)
  console.log('\nDRY-RUN READ-ONLY: no se escribió nada, no se aplicó ninguna migración.')

  if (!iguales) throw new Error('Los conteos de prod cambiaron durante la corrida — snapshot inconsistente.')
  if (res.expectedOk === false) {
    throw new Error(`CONTROL FALLIDO: ${CONTROL.month} no dio ${CONTROL.crc}. Revisar antes de confiar en el número.`)
  }
  if (res.expectedOk === null) {
    console.log(`\n⚠ ${CONTROL.month} no apareció en los datos de prod (¿sin sesiones cerradas ese mes?).`)
  }
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e))
  process.exitCode = 1
})
