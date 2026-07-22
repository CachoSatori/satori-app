// T0 · Entrypoint. Lee staging, analiza, escribe el reporte. No escribe en la base.
//
//   node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//        scripts/t0-reconciliacion-cajas/run.ts
//
// El `--import` registra un resolver ESM mínimo para que Node pueda cargar los
// imports sin extensión de src/ (ver ts-resolve-hook.mjs). Sin él, importar
// cashUtils.ts falla al resolver '../../shared/utils'.

import { writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

// ⚠️ ÚNICO import desde src/ — solo lectura, el archivo no se toca.
import { saldoCajaFuerte } from '../../src/modules/cash/cashUtils.ts'

import { loadEnv, REPO_ROOT, SCRIPT_DIR } from './env.ts'
import { abrirLector, leerSnapshot } from './db.ts'
import {
  asCierre,
  asMov,
  asSesion,
  clasificarCierres,
  compararPozo,
  construirInventarios,
  watermark,
  type Mov,
} from './analisis.ts'
import { fi, renderReporte } from './reporte.ts'

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const env = loadEnv()
  const lector = abrirLector(env) // ← aborta acá si la URL no es la de staging

  console.log(`[T0] proyecto ${lector.ref} (STAGING) · transporte ${lector.backend} · READ-ONLY`)

  const snap = await leerSnapshot(lector)
  if (snap.movements.length === 0) {
    throw new Error(
      'La base devolvió 0 movimientos. Con la anon key esto es lo esperado: RLS filtra todo y PostgREST ' +
        'responde 200 con []. Corré con el token de la Management API (Keychain "Supabase CLI" o ' +
        'SUPABASE_ACCESS_TOKEN), o exportá SUPABASE_SERVICE_ROLE_KEY.',
    )
  }

  const movs: Mov[] = snap.movements.map(asMov)
  const sesiones = snap.sessions.map(asSesion)
  const cierres = snap.cierres.map(asCierre)
  console.log(`[T0] leídos ${movs.length} movimientos · ${sesiones.length} sesiones · ${cierres.length} cierres`)

  const clasificados = clasificarCierres(movs, sesiones, cierres)
  const pozo = compararPozo(movs, saldoCajaFuerte as unknown as (m: Mov[]) => { crc: number; usd: number })
  const inv = construirInventarios(movs, sesiones)

  // Invariantes: si alguna falla el reporte mentiría, así que no se escribe.
  if (!pozo.espejoOk) {
    throw new Error(
      `El espejo de saldoCajaFuerte se desvió de la función real (espejo ${fi(pozo.cfEspejo.crc)} vs ` +
        `real ${fi(pozo.cfReal.crc)}). cashUtils.ts cambió: hay que revisar contribucionCajaFuerte().`,
    )
  }
  if (!pozo.cuadra) {
    throw new Error(
      `El desglose (${fi(pozo.sumaDesglose)}) no suma la diferencia pozo−CF (${fi(pozo.deltaCrc)}).`,
    )
  }
  const sinClase = clasificados.filter((c) => !c.clase)
  if (sinClase.length) throw new Error(`${sinClase.length} cierre(s) completos quedaron sin clasificar.`)

  const md = renderReporte({
    ref: lector.ref,
    backend: lector.backend,
    watermark: watermark(snap, movs, sesiones, cierres),
    cierres,
    clasificados,
    pozo,
    inv,
  })

  const out = resolve(arg('--out') ?? resolve(SCRIPT_DIR, 'REPORTE-T0-RECONCILIACION.md'))
  writeFileSync(out, md, 'utf8')

  const cuenta = (c: string) => clasificados.filter((x) => x.clase === c).length
  console.log(
    `[T0] cierres completos: ${clasificados.length} → ` +
      `CUADRÓ ${cuenta('CUADRÓ')} · HUECO-2 ${cuenta('EXPLICADO-HUECO-2')} · ` +
      `HUECO-1 ${cuenta('CANDIDATO-HUECO-1')} · NO-EXPLICADO ${cuenta('NO-EXPLICADO')}`,
  )
  console.log(`[T0] pozo ${fi(pozo.pozo.crc)} · cajaFuerte ${fi(pozo.cfReal.crc)} · Δ ${fi(pozo.deltaCrc)} (desglose ✅)`)
  console.log(`[T0] reporte → ${relative(REPO_ROOT, out)}`)
}

main().catch((e: unknown) => {
  console.error(`[T0] ABORTADO: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
