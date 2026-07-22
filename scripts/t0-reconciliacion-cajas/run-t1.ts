// T1 · Corrida paralela ANCLADA contra STAGING. READ-ONLY.
//
//   node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//        scripts/t0-reconciliacion-cajas/run-t1.ts
//
// Usa el MISMO candado de entorno que run.ts (`abrirLector` → staging o nada) y el mismo
// transporte read-only. Lo nuevo es que el análisis se apoya en la función REAL promovida a
// `src/modules/cash/pozo.ts`: si esa función cambia, este reporte cambia — que es justamente
// lo que queremos de una validación paralela.

import { writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

// `./pozo.ts` es un puente delgado al núcleo promovido `src/modules/cash/pozo.ts` — no
// reimplementa nada. `cashUtils.ts` no se toca (queda byte-idéntico a origin/staging).
import { saldoPozoEfectivo } from './pozo.ts'
// El único símbolo del modelo VIEJO que se importa: se usa para replicar `deberia` tal cual
// lo calcula CashCierre.tsx. El archivo no se toca.
import { saldoCajaFuerte } from '../../src/modules/cash/cashUtils.ts'

import { loadEnv, REPO_ROOT, SCRIPT_DIR } from './env.ts'
import { abrirLector, leerSnapshot } from './db.ts'
import { asCierre, asMov, asSesion, watermark, type Mov } from './analisis.ts'
import { corridaAnclada } from './anclado.ts'
import { abrirProdFirmado, cerrarProd, FIRMA_REQUERIDA, REF_PROD_CLAVADO } from './prod-gate.ts'
import { analisisFondo, replayCierre } from './preguntas.ts'
import { fi } from './reporte.ts'
import { renderT1 } from './reporte-t1.ts'

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** Las dos preguntas de la adenda son sobre PROD y sobre estos días concretos. */
const FECHA_SOBRANTE = '2026-07-18'
const FECHAS_FONDO = ['2026-07-09', '2026-07-20', '2026-07-21']

async function main(): Promise<void> {
  const env = loadEnv()
  const soloStaging = process.argv.includes('--solo-staging')
  const lector = abrirLector(env) // ← candado: staging o nada
  console.log(`[T1] proyecto ${lector.ref} (STAGING) · transporte ${lector.backend} · READ-ONLY`)

  const snap = await leerSnapshot(lector)
  if (snap.movements.length === 0) {
    throw new Error(
      'La base devolvió 0 movimientos (RLS con la anon key responde 200 con []). ' +
        'Corré con el token de la Management API o con SUPABASE_SERVICE_ROLE_KEY.',
    )
  }

  const movs: Mov[] = snap.movements.map(asMov)
  const sesiones = snap.sessions.map(asSesion)
  const cierres = snap.cierres.map(asCierre)
  console.log(`[T1] leídos ${movs.length} movimientos · ${sesiones.length} sesiones · ${cierres.length} cierres`)

  const pares = corridaAnclada(movs, sesiones, cierres)
  if (!pares.length) throw new Error('No hay dos cierres completos consecutivos para anclar.')

  const saldoPozoHoy = saldoPozoEfectivo(movs)

  // ── Fase PROD (adenda T1) — mismo doble opt-in que run-prod.ts ────────────
  let prod: Parameters<typeof renderT1>[0]['prod']
  if (soloStaging) {
    console.log('[T1] --solo-staging: se omiten las dos preguntas de la adenda (necesitan PROD).')
  } else {
    console.log(`[T1] ⚠️  PRODUCCIÓN ${REF_PROD_CLAVADO} · firma ${FIRMA_REQUERIDA} · READ-ONLY`)
    const apertura = await abrirProdFirmado(env, 'scripts/t0-reconciliacion-cajas/run-t1.ts')
    console.log(`[T1] smoke de escritura: RECHAZADA ✅ — ${apertura.smoke.replace(/\s+/g, ' ').slice(0, 80)}`)
    const snapP = await leerSnapshot(apertura.lector)
    const movsP: Mov[] = snapP.movements.map(asMov)
    const sesionesP = snapP.sessions.map(asSesion)
    const cierresP = snapP.cierres.map(asCierre)
    const conteos = await cerrarProd(apertura)
    console.log(
      `[T1] prod: ${movsP.length} movimientos · conteos ${conteos.iguales ? 'IGUALES ✅' : 'DISTINTOS ❌'}`,
    )

    const cierreSobrante = cierresP.find(c => c.session_date === FECHA_SOBRANTE && c.tipo === 'completo')
    if (!cierreSobrante) throw new Error(`No hay cierre completo del ${FECHA_SOBRANTE} en prod.`)

    prod = {
      ref: apertura.lector.ref,
      watermark: watermark(snapP, movsP, sesionesP, cierresP),
      conteos,
      smoke: apertura.smoke,
      pares: corridaAnclada(movsP, sesionesP, cierresP),
      replay: replayCierre(
        cierreSobrante,
        movsP,
        sesionesP,
        saldoCajaFuerte as unknown as (m: Mov[]) => { crc: number; usd: number },
      ),
      fondo: analisisFondo(cierresP, movsP, sesionesP, FECHAS_FONDO),
    }
    const p1 = prod.replay
    console.log(
      `[T1] P1 ${p1.fecha}: dif recalculada ${fi(p1.difCalculada)} vs sellada ${fi(p1.difSellada)} → ` +
        `${p1.coincide ? 'REPLICA ✅' : 'NO REPLICA ❌'}`,
    )
    for (const d of prod.fondo) {
      console.log(
        `[T1] P2 ${d.fecha}: efectivo ${fi(d.totalEfectivo)} · invisible ${fi(d.invisible)} · ` +
          `dif sellada ${fi(d.difSellada)} · esperada ${fi(d.difEsperada)} · brecha ${fi(d.brecha)} ${d.explicado ? '✅' : '🔴'}`,
      )
    }
  }

  const md = renderT1({
    ref: lector.ref,
    watermark: watermark(snap, movs, sesiones, cierres),
    pares,
    saldoPozoHoy,
    prod,
  })

  const out = resolve(arg('--out') ?? resolve(SCRIPT_DIR, 'REPORTE-T1-PARALELO.md'))
  writeFileSync(out, md, 'utf8')

  const ok = pares.filter(x => x.reproduce)
  const cuadraron = pares.filter(x => x.cuadro)
  console.log(
    `[T1] pares ${pares.length} → reproducen ${ok.length} · no reproducen ${pares.length - ok.length}`,
  )
  console.log(
    `[T1] de los ${cuadraron.length} días que cuadraron, reproducen ${cuadraron.filter(x => x.reproduce).length}`,
  )
  console.log(`[T1] pozo acumulado hoy ${fi(saldoPozoHoy.crc)} · indeterminados ${saldoPozoHoy.indeterminados.cantidad}`)
  console.log(`[T1] reporte → ${relative(REPO_ROOT, out)}`)
}

main().catch((e: unknown) => {
  console.error(`[T1] ABORTADO: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
