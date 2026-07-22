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

import { loadEnv, REPO_ROOT, SCRIPT_DIR } from './env.ts'
import { abrirLector, leerSnapshot } from './db.ts'
import { asCierre, asMov, asSesion, watermark, type Mov } from './analisis.ts'
import { corridaAnclada } from './anclado.ts'
import { fi } from './reporte.ts'
import { renderT1 } from './reporte-t1.ts'

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const env = loadEnv()
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

  const md = renderT1({
    ref: lector.ref,
    watermark: watermark(snap, movs, sesiones, cierres),
    pares,
    saldoPozoHoy,
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
