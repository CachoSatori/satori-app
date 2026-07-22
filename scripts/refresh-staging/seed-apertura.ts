// SEED del asiento de APERTURA del pozo en STAGING.
//
//   node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//        scripts/refresh-staging/seed-apertura.ts --fecha 2026-07-23
//
// La cifra NO se inventa: sale del CONTEO FÍSICO sellado del último cierre completo que haya
// en los datos (sep_diaria + sep_registradora + remanente, en ₡ y en US$). Es el mismo número
// que la dueña contó a mano esa noche, así que puede verificarlo de un vistazo.
//
// Escribe la misma fila que `recordAperturaPozo` de src/shared/api/cash.ts —  mismo
// subcategory, misma descripción, misma caja, mismo método — y es idempotente por descripción.

import { loadEnv } from '../t0-reconciliacion-cajas/env.ts'
import { escribirEnStaging, leerDeStaging, token, verificarRefs } from './gate.ts'
import { esc } from './lib.ts'

function arg(n: string): string | undefined {
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const fmt = (n: number): string =>
  '₡ ' + Math.round(n).toLocaleString('es-CR')

async function main(): Promise<void> {
  verificarRefs()
  const fecha = arg('--fecha')
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Falta --fecha AAAA-MM-DD (el día del corte)')
  const tok = token(loadEnv())

  const [ultimo] = (await leerDeStaging(
    `select session_date,
            (coalesce(sep_diaria_crc,0)+coalesce(sep_registradora_crc,0)+coalesce(remanente_crc,0))::numeric as crc,
            (coalesce(sep_diaria_usd,0)+coalesce(sep_registradora_usd,0)+coalesce(remanente_usd,0))::numeric as usd
       from public.cash_cierres_dia
      where tipo = 'completo'
      order by session_date desc
      limit 1`,
    tok,
  )) as { session_date: string; crc: string; usd: string }[]
  if (!ultimo) throw new Error('No hay ningún cierre completo en staging para tomar el conteo físico.')

  const crc = Number(ultimo.crc)
  const usd = Number(ultimo.usd)
  const desc = `Apertura pozo ${fecha}`

  // Idempotente por descripción, igual que recordAperturaPozo / recordCierreAjuste.
  await escribirEnStaging(`delete from public.cash_movements where description = ${esc(desc)}`, tok)
  await escribirEnStaging(
    `insert into public.cash_movements
       (session_id, created_by, movement_type, amount_crc, amount_usd, currency, exchange_rate,
        description, subcategory, supplier_id, supplier_name, employee_name, shift, caja_origen,
        method, status)
     values (null,
       (select id from public.profiles where email = 'satorisushibar@gmail.com' limit 1),
       'ingreso', ${crc}, ${usd}, 'CRC', null, ${esc(desc)}, 'Apertura pozo',
       null, '', '', '', 'Caja Fuerte', 'Efectivo', 'aprobado')`,
    tok,
  )

  const [ver] = (await leerDeStaging(
    `select amount_crc::numeric crc, amount_usd::numeric usd from public.cash_movements where description = ${esc(desc)}`,
    tok,
  )) as { crc: string; usd: string }[]

  console.log('')
  console.log('  ╔════════════════════════════════════════════════════════════════╗')
  console.log('  ║  APERTURA DEL POZO SEMBRADA EN STAGING                         ║')
  console.log('  ╠════════════════════════════════════════════════════════════════╣')
  console.log(`  ║  Fecha del asiento : ${fecha.padEnd(42)}║`)
  console.log(`  ║  Origen de la cifra: cierre completo del ${ultimo.session_date.padEnd(22)}║`)
  console.log(`  ║  ${'─'.repeat(62)}║`)
  console.log(`  ║  COLONES : ${fmt(crc).padEnd(52)}║`)
  console.log(`  ║  DÓLARES : ${('$ ' + usd.toFixed(2)).padEnd(52)}║`)
  console.log('  ╠════════════════════════════════════════════════════════════════╣')
  console.log('  ║  La dueña verifica ESTE número contra su conteo físico.        ║')
  console.log('  ╚════════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log(`[seed] verificado en la base: ${fmt(Number(ver.crc))} · $${Number(ver.usd).toFixed(2)}`)
}

main().catch((e: unknown) => {
  console.error(`[seed] ABORTADO: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
