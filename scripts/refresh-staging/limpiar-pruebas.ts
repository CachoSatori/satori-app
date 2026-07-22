// Limpieza de las pruebas manuales en STAGING. Solo staging (candado de gate.ts).
//
//   node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//        scripts/refresh-staging/limpiar-pruebas.ts --confirmo
//
// ⚠️ LECCIÓN APRENDIDA A LOS GOLPES (2026-07-22): borrar por DESCRIPCIÓN no alcanza. La
// descripción 'Ingreso de Banco → Caja Fuerte' la comparten 5 filas — 1 era la prueba manual de
// la dueña y 4 eran datos legítimos venidos de prod. El primer intento se llevó las 5; hubo que
// re-copiarlas de prod. Ahora cada fila se identifica por la TUPLA COMPLETA (descripción +
// montos + fecha) y el script EXIGE que el conteo sea el esperado: si no coincide, aborta sin
// borrar nada.

import { loadEnv } from '../t0-reconciliacion-cajas/env.ts'
import { escribirEnStaging, leerDeStaging, token, verificarRefs } from './gate.ts'
import { esc } from './lib.ts'

/** Movimientos de prueba a borrar, identificados sin ambigüedad y con su conteo esperado. */
const A_BORRAR: { desc: string; crc: number; usd: number; dia: string; esperadas: number; motivo: string }[] = [
  {
    desc: 'Ingreso de Banco → Caja Fuerte',
    crc: 5_932_684, usd: 520, dia: '2026-07-22', esperadas: 1,
    motivo: 'intento manual de cuadrar la tarjeta a mano — enmascara el bug del fetch',
  },
]

async function main(): Promise<void> {
  verificarRefs()
  if (!process.argv.includes('--confirmo')) throw new Error('Falta --confirmo: este script BORRA filas de staging.')
  const tok = token(loadEnv())

  for (const t of A_BORRAR) {
    // La tupla completa, no solo la descripción.
    const donde =
      `description = ${esc(t.desc)} and amount_crc = ${t.crc} and amount_usd = ${t.usd} ` +
      `and (created_at at time zone 'America/Costa_Rica')::date = ${esc(t.dia)}`
    const previas = (await leerDeStaging(
      `select id::text, created_at::text from public.cash_movements where ${donde}`,
      tok,
    )) as { id: string; created_at: string }[]

    if (previas.length === 0) { console.log(`  "${t.desc}" (${t.dia}): ya no está, nada que borrar`); continue }
    if (previas.length !== t.esperadas) {
      throw new Error(
        `ABORTADO sin borrar: se esperaban ${t.esperadas} fila(s) para "${t.desc}" del ${t.dia} y hay ${previas.length}. ` +
          'Revisar a mano antes de tocar nada.',
      )
    }
    for (const p of previas) {
      console.log(`  borrando ${p.id.slice(0, 8)} · ${t.desc} · ₡${t.crc.toLocaleString('es-CR')} / $${t.usd} · ${p.created_at.slice(0, 19)}`)
      console.log(`    motivo: ${t.motivo}`)
    }
    await escribirEnStaging(`delete from public.cash_movements where ${donde}`, tok)
  }

  const [{ n }] = (await leerDeStaging('select count(*)::int n from public.cash_movements', tok)) as { n: number }[]
  console.log(`[limpieza] ✅ cash_movements queda en ${n} filas`)
}

main().catch((e: unknown) => {
  console.error(`[limpieza] ABORTADO: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
