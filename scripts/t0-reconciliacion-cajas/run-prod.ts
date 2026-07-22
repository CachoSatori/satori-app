// T0-B · Corrida READ-ONLY contra PRODUCCIÓN.
//
//   T0_PROD_FIRMADO=2026-07-22 node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//     scripts/t0-reconciliacion-cajas/run-prod.ts
//
// Mismas consultas y mismas clasificaciones que run.ts (staging). Escribe un archivo
// DISTINTO — REPORTE-T0B-PROD.md — para que el reporte de staging quede intacto.
//
// ── DOBLE OPT-IN ────────────────────────────────────────────────────────────
// 1. El ref de prod está clavado acá abajo, en el código.
// 2. Además exige `T0_PROD_FIRMADO=2026-07-22` en el entorno.
// Ninguna de las dos alcanza sola. Correr esto por accidente no es posible: hay que
// elegir el archivo Y poner la firma del día que el dueño autorizó.
//
// ── POR QUÉ SE PUEDE CORRER CONTRA PROD ─────────────────────────────────────
// El canal manda todo con `read_only: true`, que Postgres impone a nivel de TRANSACCIÓN.
// Antes de leer un solo dato, `verificarRechazoDeEscritura()` manda a propósito un
// `create temp table` y exige que el servidor lo rechace con `25006`. Si esa sonda
// pasara, el script aborta sin consultar nada.

import { writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

// ⚠️ ÚNICO import desde src/ — solo lectura, el archivo no se toca.
import { saldoCajaFuerte } from '../../src/modules/cash/cashUtils.ts'

import { loadEnv, REPO_ROOT, SCRIPT_DIR } from './env.ts'
import { leerSnapshot } from './db.ts'
import { abrirProdFirmado, cerrarProd, FIRMA_REQUERIDA, REF_PROD_CLAVADO } from './prod-gate.ts'
import {
  asCierre,
  asMov,
  asSesion,
  clasificarCierres,
  compararPozo,
  construirFocos,
  construirInventarios,
  watermark,
  type Mov,
} from './analisis.ts'
import { fi, renderReporte } from './reporte.ts'


/**
 * En prod el 2026-07-21 es un día REAL de piso (en staging era de laboratorio). La lista
 * va vacía a propósito: marcar acá una fecha real sería descartar plata verdadera.
 */
const FECHAS_NO_CONFIABLES_PROD: string[] = []

/** Días que el T0-B tiene que auditar contra los datos y no contra lo que se recuerda. */
const FOCOS = [
  {
    fecha: '2026-07-21',
    nota:
      'El dueño remedió a mano el **caso Ronny** (SOP interino): recategorizó el egreso a `Caja Fuerte`. ' +
      'Hay que ver con qué caja quedó el movimiento hoy y cómo terminó clasificando el cierre del día.',
  },
  {
    fecha: '2026-07-14',
    nota:
      'El DIAGNÓSTICO anotó una **caja vieja abierta** de esta fecha en prod. Confirmar o descartar con datos: ' +
      'si el turno existe, en qué `status` está hoy.',
  },
]

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const env = loadEnv()
  console.log(`[T0-B] ⚠️  PRODUCCIÓN ${REF_PROD_CLAVADO} · firma ${FIRMA_REQUERIDA} · READ-ONLY`)

  // 1+2) Candado compartido: firma, ref clavado, smoke de escritura y conteos ANTES.
  const apertura = await abrirProdFirmado(env, 'scripts/t0-reconciliacion-cajas/run-prod.ts')
  const { lector, smoke, conteosAntes: antes } = apertura
  console.log(`[T0-B] smoke de escritura: RECHAZADA ✅ — ${smoke.replace(/\s+/g, ' ').slice(0, 90)}`)
  console.log(`[T0-B] conteos ANTES: ${JSON.stringify(antes)}`)

  // 3) Lectura.
  const snap = await leerSnapshot(lector)
  if (snap.movements.length === 0) throw new Error('PROD devolvió 0 movimientos — algo anda mal, abortando.')

  const movs: Mov[] = snap.movements.map(asMov)
  const sesiones = snap.sessions.map(asSesion)
  const cierres = snap.cierres.map(asCierre)
  console.log(`[T0-B] leídos ${movs.length} movimientos · ${sesiones.length} sesiones · ${cierres.length} cierres`)

  // 4) Conteos DESPUÉS — evidencia de que la corrida no movió nada.
  const { despues, iguales } = await cerrarProd(apertura)
  console.log(`[T0-B] conteos DESPUÉS: ${JSON.stringify(despues)} → ${iguales ? 'IGUALES ✅' : 'DISTINTOS ❌'}`)

  // 5) Análisis — mismas funciones que staging; solo cambian las fechas no confiables.
  const clasificados = clasificarCierres(movs, sesiones, cierres, FECHAS_NO_CONFIABLES_PROD)
  const pozo = compararPozo(movs, saldoCajaFuerte as unknown as (m: Mov[]) => { crc: number; usd: number })
  const inv = construirInventarios(movs, sesiones, FECHAS_NO_CONFIABLES_PROD)
  const focos = construirFocos(movs, sesiones, FOCOS)

  if (!pozo.espejoOk) {
    throw new Error(
      `El espejo de saldoCajaFuerte se desvió de la función real (espejo ${fi(pozo.cfEspejo.crc)} vs ` +
        `real ${fi(pozo.cfReal.crc)}). cashUtils.ts cambió: hay que revisar contribucionCajaFuerte().`,
    )
  }
  if (!pozo.cuadra) {
    throw new Error(`El desglose (${fi(pozo.sumaDesglose)}) no suma la diferencia pozo−CF (${fi(pozo.deltaCrc)}).`)
  }

  const md = renderReporte({
    ref: lector.ref,
    backend: lector.backend,
    watermark: watermark(snap, movs, sesiones, cierres),
    cierres,
    clasificados,
    pozo,
    inv,
    titulo: '# REPORTE T0-B — Reconciliación de cajas · PRODUCCIÓN',
    entorno: 'PRODUCCIÓN',
    fechasNoConfiables: FECHAS_NO_CONFIABLES_PROD,
    focos,
    conteos: { antes, despues, iguales },
    smokeEscritura: smoke,
  })

  const out = resolve(arg('--out') ?? resolve(SCRIPT_DIR, 'REPORTE-T0B-PROD.md'))
  writeFileSync(out, md, 'utf8')

  const cuenta = (c: string) => clasificados.filter((x) => x.clase === c).length
  console.log(
    `[T0-B] cierres completos: ${clasificados.length} → ` +
      `CUADRÓ ${cuenta('CUADRÓ')} · HUECO-2 ${cuenta('EXPLICADO-HUECO-2')} · ` +
      `HUECO-1 ${cuenta('CANDIDATO-HUECO-1')} · NO-EXPLICADO ${cuenta('NO-EXPLICADO')}`,
  )
  console.log(`[T0-B] pozo ${fi(pozo.pozo.crc)} · cajaFuerte ${fi(pozo.cfReal.crc)} · Δ ${fi(pozo.deltaCrc)} (desglose ✅)`)
  console.log(`[T0-B] cajas abiertas: ${inv.sesionesAbiertas.length}`)
  console.log(`[T0-B] reporte → ${relative(REPO_ROOT, out)}`)
}

main().catch((e: unknown) => {
  console.error(`[T0-B] ABORTADO: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
