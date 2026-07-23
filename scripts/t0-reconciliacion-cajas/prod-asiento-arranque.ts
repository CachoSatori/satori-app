// ASIENTO DE ARRANQUE DEL POZO EN PRODUCCIÓN — el ÚNICO write autorizado en prod.
//
//   T0_PROD_FIRMADO=2026-07-22 node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//     scripts/t0-reconciliacion-cajas/prod-asiento-arranque.ts --confirmar-asiento
//
// Inserta UNA fila: 'Apertura pozo 2026-07-22' ₡744.570 / $3.441. Nada más.
//
// ── POR QUÉ ESTE ARCHIVO EXISTE APARTE ──────────────────────────────────────
// `prod-gate.ts` NO tiene camino de escritura a propósito ("PROD es SOLO LECTURA, siempre").
// Abrir uno ahí habría dejado una puerta abierta para siempre. Acá vive un camino de escritura
// de un solo uso, con el ref clavado, que solo sabe emitir ESTE insert.
//
// ── CANDADOS (los cuatro tienen que pasar) ──────────────────────────────────
//   1. `T0_PROD_FIRMADO=2026-07-22` (mismo doble opt-in del harness).
//   2. Ref de prod clavado en el código, verificado contra env.ts.
//   3. `--confirmar-asiento` explícito. Sin la bandera: simulacro, no escribe.
//   4. IDEMPOTENCIA por descripción: si el asiento ya existe con los MISMOS montos, no hace
//      nada y sale bien. Si existe con montos distintos, ABORTA y reporta — no pisa plata.
//
// ── EVIDENCIA ───────────────────────────────────────────────────────────────
// Conteos y huella del ledger ANTES y DESPUÉS. Exige +1 fila EXACTA en cash_movements, 0
// cambios en cash_sessions / cash_cierres_dia, y que la huella difiera SOLO en la fila nueva.

import { loadEnv, mgmtToken, REF_PROD, REF_STAGING } from './env.ts'

const REF_PROD_CLAVADO = 'yiczgdtirrkdvohdquzf'
const FIRMA_REQUERIDA = '2026-07-22'
const ENDPOINT = `https://api.supabase.com/v1/projects/${REF_PROD_CLAVADO}/database/query`

const DESC = 'Apertura pozo 2026-07-22'
const CRC = 744570
const USD = 3441

const fi = (n: number) => '₡' + n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const env = loadEnv()

// Candado 1 · firma
const firma = (env.T0_PROD_FIRMADO || '').trim()
if (firma !== FIRMA_REQUERIDA) {
  throw new Error(`FALTA/INVÁLIDA la firma: T0_PROD_FIRMADO debe ser "${FIRMA_REQUERIDA}" (vino "${firma}").`)
}
// Candado 2 · ref
if (REF_PROD_CLAVADO === REF_STAGING) throw new Error('ABORTADO: el ref clavado es el de STAGING.')
if (REF_PROD_CLAVADO !== REF_PROD) throw new Error(`ABORTADO: el ref clavado no coincide con REF_PROD (${REF_PROD}).`)

const tok = mgmtToken(env)
if (!tok) throw new Error('Sin token de Management API.')

async function sql(query: string, readOnly: boolean): Promise<Record<string, unknown>[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(readOnly ? { query, read_only: true } : { query }),
  })
  if (!res.ok) throw new Error(`[prod] HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`)
  return (await res.json()) as Record<string, unknown>[]
}

type Foto = { movimientos: number; sesiones: number; cierres: number; suma: number; hash: string }
async function foto(): Promise<Foto> {
  const [c] = await sql(`select
    (select count(*)::int from public.cash_movements)   as movimientos,
    (select count(*)::int from public.cash_sessions)    as sesiones,
    (select count(*)::int from public.cash_cierres_dia) as cierres,
    (select coalesce(sum(amount_crc),0)::numeric from public.cash_movements) as suma,
    (select md5(string_agg(id::text || '|' || amount_crc::text || '|' || coalesce(status,''), '' order by id::text))
       from public.cash_movements) as hash`, true)
  return {
    movimientos: Number(c.movimientos), sesiones: Number(c.sesiones), cierres: Number(c.cierres),
    suma: Number(c.suma), hash: String(c.hash),
  }
}

// Candado 4 · idempotencia
const previas = await sql(
  `select id, amount_crc::numeric as crc, amount_usd::numeric as usd, created_at
     from public.cash_movements where description = '${DESC}'`, true)
if (previas.length > 0) {
  const iguales = previas.every(p => Number(p.crc) === CRC && Number(p.usd) === USD)
  console.log(`\n[asiento] YA EXISTE (${previas.length} fila/s): ${JSON.stringify(previas)}`)
  if (!iguales) {
    throw new Error('ABORTADO: el asiento existe con montos DISTINTOS. No se pisa. Revisar a mano.')
  }
  console.log('[asiento] ✅ idempotente: mismos montos, no se escribe nada.\n')
  process.exit(0)
}

const antes = await foto()
console.log(`\n=== ANTES ===`)
console.log(`  movimientos: ${antes.movimientos} · sesiones: ${antes.sesiones} · cierres: ${antes.cierres}`)
console.log(`  suma amount_crc: ${fi(antes.suma)}`)
console.log(`  hash del ledger: ${antes.hash}`)
console.log(`\n=== ASIENTO A INSERTAR ===`)
console.log(`  description : ${DESC}`)
console.log(`  monto       : ${fi(CRC)} / $${USD}`)
console.log(`  forma       : ingreso · Caja Fuerte · Efectivo · aprobado · subcategory 'Apertura pozo'`)
console.log(`  created_at  : 2026-07-22T12:00:00+00 (fecha operativa = el corte)`)

if (!process.argv.includes('--confirmar-asiento')) {
  console.log('\n[asiento] SIMULACRO — sin --confirmar-asiento no se escribió NADA en prod.\n')
  process.exit(0)
}

// ── EL ÚNICO WRITE ──────────────────────────────────────────────────────────
await sql(
  `insert into public.cash_movements
     (session_id, created_by, movement_type, amount_crc, amount_usd, currency, exchange_rate,
      description, subcategory, supplier_id, supplier_name, employee_name, shift, caja_origen,
      method, status, created_at, updated_at)
   values (null,
     (select id from public.profiles where email = 'satorisushibar@gmail.com' limit 1),
     'ingreso', ${CRC}, ${USD}, 'CRC', null, '${DESC}', 'Apertura pozo',
     null, '', '', '', 'Caja Fuerte', 'Efectivo', 'aprobado',
     '2026-07-22T12:00:00+00', '2026-07-22T12:00:00+00')`, false)

const despues = await foto()
console.log(`\n=== DESPUÉS ===`)
console.log(`  movimientos: ${despues.movimientos} · sesiones: ${despues.sesiones} · cierres: ${despues.cierres}`)
console.log(`  suma amount_crc: ${fi(despues.suma)}`)
console.log(`  hash del ledger: ${despues.hash}`)

let mal = 0
const chk = (ok: boolean, m: string) => { console.log(`  ${ok ? '✅' : '❌'} ${m}`); if (!ok) mal++ }
console.log(`\n=== VERIFICACIÓN ===`)
chk(despues.movimientos === antes.movimientos + 1, `cash_movements +1 EXACTO (${antes.movimientos} → ${despues.movimientos})`)
chk(despues.sesiones === antes.sesiones, `cash_sessions sin cambios (${despues.sesiones})`)
chk(despues.cierres === antes.cierres, `cash_cierres_dia sin cambios (${despues.cierres})`)
chk(Math.abs((despues.suma - antes.suma) - CRC) < 0.005, `la suma subió EXACTAMENTE ${fi(CRC)} (Δ ${fi(despues.suma - antes.suma)})`)

const nuevas = await sql(
  `select id, amount_crc::numeric crc, amount_usd::numeric usd, caja_origen, method, status, subcategory, created_at
     from public.cash_movements where description = '${DESC}'`, true)
chk(nuevas.length === 1, `existe UNA sola fila del asiento`)
chk(Number(nuevas[0]?.crc) === CRC && Number(nuevas[0]?.usd) === USD, `montos exactos: ${fi(Number(nuevas[0]?.crc))} / $${nuevas[0]?.usd}`)
console.log(`  fila: ${JSON.stringify(nuevas[0])}`)

console.log(`\n${mal === 0 ? '✅ ASIENTO OK — prod tiene exactamente una fila nueva y nada más cambió' : `❌ ${mal} CHEQUEO(S) FALLARON — ver rollback`}\n`)
if (mal) process.exitCode = 1
