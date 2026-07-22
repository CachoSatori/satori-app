// T2 · Corrida anclada con las funciones REALES del modelo nuevo, contra STAGING. READ-ONLY.
//
//   node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//        scripts/t0-reconciliacion-cajas/run-t2.ts
//
// Criterio del tramo: tiene que reproducir los MISMOS 6/6 pares consecutivos que el T1.
// Si el recableado del cierre rompe la mecánica, este número baja y se ve acá.

import { loadEnv } from './env.ts'
import { abrirLector, leerSnapshot } from './db.ts'
import { asCierre, asMov, asSesion, type Mov } from './analisis.ts'
import { corridaAnclada } from './anclado.ts'
import { corridaAncladaT2 } from './anclado-t2.ts'
import { fi } from './reporte.ts'

async function main(): Promise<void> {
  const lector = abrirLector(loadEnv()) // candado: staging o nada
  console.log(`[T2] proyecto ${lector.ref} (STAGING) · ${lector.backend} · READ-ONLY`)

  const snap = await leerSnapshot(lector)
  if (!snap.movements.length) throw new Error('0 movimientos — revisá las credenciales.')
  const movs: Mov[] = snap.movements.map(asMov)
  const sesiones = snap.sessions.map(asSesion)
  const cierres = snap.cierres.map(asCierre)

  const t1 = corridaAnclada(movs, sesiones, cierres)
  const t2 = corridaAncladaT2(movs, sesiones, cierres)

  const contig = (n: number, arr: { diasDeGap: number; reproduce: boolean }[]) =>
    arr.filter(x => x.diasDeGap === n).filter(x => x.reproduce).length

  console.log(`[T2] pares: ${t2.length}`)
  console.log(
    `[T2] consecutivos (gap=1) que reproducen — T1 (núcleo): ${contig(1, t1)}/${t1.filter(x => x.diasDeGap === 1).length} · ` +
      `T2 (funciones del cierre): ${contig(1, t2)}/${t2.filter(x => x.diasDeGap === 1).length}`,
  )
  for (const x of t2) {
    const t1x = t1.find(y => y.fecha === x.fecha)
    console.log(
      `  ${x.fechaAnterior}→${x.fecha} (${x.diasDeGap}d) esperado ${fi(x.deberiaNuevo)} · contado ${fi(x.contado)} · ` +
        `residuo ${fi(x.residuo)} ${x.reproduce ? '✅' : '🔴'}` +
        (t1x ? ` · T1 ${fi(t1x.residuo)} ${t1x.reproduce ? '✅' : '🔴'}` : ''),
    )
  }

  const okT1 = contig(1, t1)
  const okT2 = contig(1, t2)
  if (okT2 < okT1) {
    throw new Error(
      `REGRESIÓN: el modelo nuevo reproduce ${okT2} pares consecutivos y el núcleo del T1 reproducía ${okT1}.`,
    )
  }
  console.log(`[T2] ✅ el modelo nuevo reproduce los mismos ${okT2} pares consecutivos que el T1`)
}

main().catch((e: unknown) => {
  console.error(`[T2] ABORTADO: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
