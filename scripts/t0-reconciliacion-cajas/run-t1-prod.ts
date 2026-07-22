// T1-B · Corrida anclada por día contra PRODUCCIÓN. READ-ONLY.
//
//   T0_PROD_FIRMADO=2026-07-22 node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//     scripts/t0-reconciliacion-cajas/run-t1-prod.ts
//
// Mismo análisis que run-t1.ts (staging) pero contra prod, y con las dos preguntas
// obligatorias de la adenda. Escribe REPORTE-T1B-PROD-PARALELO.md — archivo aparte, para
// que REPORTE-T1-PARALELO.md (staging) quede intacto.
//
// El doble opt-in NO se reimplementa acá: vive una sola vez en prod-gate.ts, que también
// usa run-prod.ts. Ref clavado en el código + firma del dueño en el entorno, smoke de
// rechazo de escritura antes de leer nada, y conteos antes/después como evidencia.

import { writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

// Imports desde src/ SOLO de lectura. `pozo.ts` es el núcleo que T1 valida; `cashUtils.ts`
// se usa para replicar `deberia` tal cual lo calcula el cierre, y no se toca.
import { saldoCajaFuerte } from '../../src/modules/cash/cashUtils.ts'

import { loadEnv, REPO_ROOT, SCRIPT_DIR } from './env.ts'
import { leerSnapshot } from './db.ts'
import { abrirProdFirmado, cerrarProd, FIRMA_REQUERIDA, REF_PROD_CLAVADO } from './prod-gate.ts'
import { asCierre, asMov, asSesion, watermark, type Mov } from './analisis.ts'
import { corridaAnclada, motivoExclusion } from './anclado.ts'
import { contribucionPozo } from './pozo.ts'
import { analisisFondo, descomposicionPeriodo, flujoDelFondo, replayCierre } from './preguntas.ts'
import { fi } from './reporte.ts'
import { renderT1B } from './reporte-t1b.ts'

/** Las dos preguntas de la adenda son sobre estos días concretos de prod. */
const FECHA_SOBRANTE = '2026-07-18'
const FECHAS_FONDO = ['2026-07-09', '2026-07-20', '2026-07-21']

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const env = loadEnv()
  console.log(`[T1-B] ⚠️  PRODUCCIÓN ${REF_PROD_CLAVADO} · firma ${FIRMA_REQUERIDA} · READ-ONLY`)

  const apertura = await abrirProdFirmado(env, 'scripts/t0-reconciliacion-cajas/run-t1-prod.ts')
  console.log(`[T1-B] smoke de escritura: RECHAZADA ✅ — ${apertura.smoke.replace(/\s+/g, ' ').slice(0, 80)}`)
  console.log(`[T1-B] conteos ANTES: ${JSON.stringify(apertura.conteosAntes)}`)

  const snap = await leerSnapshot(apertura.lector)
  if (snap.movements.length === 0) throw new Error('PROD devolvió 0 movimientos — abortando.')

  const movs: Mov[] = snap.movements.map(asMov)
  const sesiones = snap.sessions.map(asSesion)
  const cierres = snap.cierres.map(asCierre)
  console.log(`[T1-B] leídos ${movs.length} movimientos · ${sesiones.length} sesiones · ${cierres.length} cierres`)

  const conteos = await cerrarProd(apertura)
  console.log(`[T1-B] conteos DESPUÉS: ${JSON.stringify(conteos.despues)} → IGUALES ✅`)

  const pares = corridaAnclada(movs, sesiones, cierres)
  if (!pares.length) throw new Error('No hay dos cierres completos consecutivos en prod.')

  const cierreSobrante = cierres.find(c => c.session_date === FECHA_SOBRANTE && c.tipo === 'completo')
  if (!cierreSobrante) throw new Error(`No hay cierre completo del ${FECHA_SOBRANTE} en prod.`)

  const replay = replayCierre(
    cierreSobrante,
    movs,
    sesiones,
    saldoCajaFuerte as unknown as (m: Mov[]) => { crc: number; usd: number },
  )

  // Si el par anclado que termina en el día del sobrante deja residuo, se abre el período
  // entero y se descompone movimiento por movimiento.
  const parDelSobrante = pares.find(x => x.fecha === FECHA_SOBRANTE) ?? null
  const periodoSobrante =
    parDelSobrante && !parDelSobrante.reproduce
      ? descomposicionPeriodo(
          parDelSobrante.fechaAnterior,
          parDelSobrante.fecha,
          parDelSobrante.residuo,
          movs,
          sesiones,
          (m, fechaCierre, fechaMov) => motivoExclusion(m, fechaCierre, fechaMov) !== null,
          m => contribucionPozo(m),
        )
      : null

  const md = renderT1B({
    ref: apertura.lector.ref,
    watermark: watermark(snap, movs, sesiones, cierres),
    conteos,
    smoke: apertura.smoke,
    pares,
    replay,
    periodoSobrante,
    fondo: analisisFondo(cierres, movs, sesiones, FECHAS_FONDO, pares),
    flujo: flujoDelFondo(cierres, movs, sesiones, FECHAS_FONDO),
  })

  const out = resolve(arg('--out') ?? resolve(SCRIPT_DIR, 'REPORTE-T1B-PROD-PARALELO.md'))
  writeFileSync(out, md, 'utf8')

  const ok = pares.filter(x => x.reproduce)
  console.log(`[T1-B] pares ${pares.length} → reproducen ${ok.length} · no reproducen ${pares.length - ok.length}`)
  console.log(
    `[T1-B] P1 ${replay.fecha}: replay ${replay.coincide ? 'REPRODUCE ✅' : 'NO reproduce ❌'} ` +
      `(${fi(replay.difCalculada)} vs ${fi(replay.difSellada)})`,
  )
  if (periodoSobrante) {
    console.log(
      `[T1-B] P1 período ${periodoSobrante.desde}→${periodoSobrante.hasta}: residuo ${fi(periodoSobrante.residuo)} · ` +
        `efectivo del período ${fi(periodoSobrante.egresosEfectivo.crc)} · resto ${fi(periodoSobrante.sobranteTrasEgresos)} ` +
        `${periodoSobrante.cierraConEgresos ? '✅' : '🔴'}`,
    )
  }
  console.log(`[T1-B] reporte → ${relative(REPO_ROOT, out)}`)
}

main().catch((e: unknown) => {
  console.error(`[T1-B] ABORTADO: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
