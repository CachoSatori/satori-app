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

import { loadEnv, mgmtToken, REF_PROD, REF_STAGING, REPO_ROOT, SCRIPT_DIR } from './env.ts'
import { contarFilas, crearLectorMgmt, leerSnapshot, verificarRechazoDeEscritura, type Conteos } from './db.ts'
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

// ── Candado 1: el ref, clavado en el código ────────────────────────────────
// El `: string` es a propósito: sin él TS estrecha al literal y considera "imposible"
// (TS2367) la comparación defensiva contra REF_STAGING — justo el chequeo que queremos.
const REF_PROD_CLAVADO: string = 'yiczgdtirrkdvohdquzf'

// ── Candado 2: la firma del dueño ──────────────────────────────────────────
const FIRMA_REQUERIDA = '2026-07-22'

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

function exigirFirma(env: Record<string, string>): void {
  const firma = (env.T0_PROD_FIRMADO || '').trim()
  if (!firma) {
    throw new Error(
      'FALTA LA FIRMA. Esta corrida va contra PRODUCCIÓN y necesita doble opt-in.\n' +
        `  Para autorizarla:  T0_PROD_FIRMADO=${FIRMA_REQUERIDA} node --import ./scripts/t0-reconciliacion-cajas/register.mjs scripts/t0-reconciliacion-cajas/run-prod.ts\n` +
        '  Si lo que querés es STAGING, el entry point es run.ts (ese no pide nada).',
    )
  }
  if (firma !== FIRMA_REQUERIDA) {
    throw new Error(
      `FIRMA INVÁLIDA: T0_PROD_FIRMADO="${firma}" pero esta corrida está autorizada para "${FIRMA_REQUERIDA}". ` +
        'La firma es la fecha en que el dueño autorizó tocar prod — si hoy es otro día, hace falta una autorización nueva ' +
        '(y cambiar FIRMA_REQUERIDA en este archivo, a propósito y a mano).',
    )
  }
}

/** Paranoia barata: que el ref clavado sea el de prod y NO el de staging. */
function verificarRefClavado(): void {
  // El chequeo contra STAGING va PRIMERO: si fuera después del `!== REF_PROD`, el
  // control-flow de TS ya habría estrechado el ref al literal de prod y daría TS2367.
  if (REF_PROD_CLAVADO === REF_STAGING) {
    throw new Error('El ref clavado es el de STAGING. Para staging usá run.ts.')
  }
  if (REF_PROD_CLAVADO !== REF_PROD) {
    throw new Error(`El ref clavado (${REF_PROD_CLAVADO}) no coincide con REF_PROD (${REF_PROD}) de env.ts.`)
  }
}

async function main(): Promise<void> {
  const env = loadEnv()
  exigirFirma(env)
  verificarRefClavado()

  const token = mgmtToken(env)
  if (!token) {
    throw new Error(
      'Sin token de Management API (SUPABASE_ACCESS_TOKEN o Keychain "Supabase CLI"). ' +
        'La anon key NO sirve: RLS devuelve 200 con [].',
    )
  }

  console.log(`[T0-B] ⚠️  PRODUCCIÓN ${REF_PROD_CLAVADO} · firma ${FIRMA_REQUERIDA} · READ-ONLY`)

  // 1) Smoke ANTES de consultar: el canal tiene que rechazar una escritura.
  const smoke = await verificarRechazoDeEscritura(REF_PROD_CLAVADO, token)
  console.log(`[T0-B] smoke de escritura: RECHAZADA ✅ — ${smoke.replace(/\s+/g, ' ').slice(0, 90)}`)

  // 2) Conteos ANTES.
  const antes = await contarFilas(REF_PROD_CLAVADO, token)
  console.log(`[T0-B] conteos ANTES: ${JSON.stringify(antes)}`)

  // 3) Lectura.
  const lector = crearLectorMgmt(REF_PROD_CLAVADO, token)
  const snap = await leerSnapshot(lector)
  if (snap.movements.length === 0) throw new Error('PROD devolvió 0 movimientos — algo anda mal, abortando.')

  const movs: Mov[] = snap.movements.map(asMov)
  const sesiones = snap.sessions.map(asSesion)
  const cierres = snap.cierres.map(asCierre)
  console.log(`[T0-B] leídos ${movs.length} movimientos · ${sesiones.length} sesiones · ${cierres.length} cierres`)

  // 4) Conteos DESPUÉS — evidencia de que la corrida no movió nada.
  const despues = await contarFilas(REF_PROD_CLAVADO, token)
  const iguales = (Object.keys(antes) as (keyof Conteos)[]).every((t) => antes[t] === despues[t])
  console.log(`[T0-B] conteos DESPUÉS: ${JSON.stringify(despues)} → ${iguales ? 'IGUALES ✅' : 'DISTINTOS ❌'}`)
  if (!iguales) {
    throw new Error(
      `Los conteos cambiaron durante la corrida (antes ${JSON.stringify(antes)} vs después ${JSON.stringify(despues)}). ` +
        'No fue este script (solo manda SELECT en transacción read-only), pero el snapshot ya no es consistente: ' +
        'alguien escribió en paralelo. Repetir cuando la caja esté quieta.',
    )
  }

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
