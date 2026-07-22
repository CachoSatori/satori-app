// T2 · Corrida anclada con las funciones REALES del modelo nuevo, contra STAGING. READ-ONLY.
//
//   node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//        scripts/t0-reconciliacion-cajas/run-t2.ts
//
// Criterio del tramo: tiene que reproducir los MISMOS 6/6 pares consecutivos que el T1.
// Si el recableado del cierre rompe la mecánica, este número baja y se ve acá.

import { loadEnv } from './env.ts'
import { abrirLector, leerSnapshot } from './db.ts'
import { asCierre, asMov, asSesion, type Cierre, type Mov, type Sesion } from './analisis.ts'
import { corridaAnclada } from './anclado.ts'
import { corridaAncladaT2 } from './anclado-t2.ts'
import { fi } from './reporte.ts'
import { dateCR, fechaDeMov, TOLERANCIA_CRC } from './analisis.ts'

/**
 * Parte de `propinas_m + propinas_n` que NO corresponde a propinas en EFECTIVO de ese día.
 *
 * El campo sellado arrastra propinas pagadas por TRANSFERENCIA (verificado en prod: ₡15.000 el
 * 2026-07-19 y ₡9.000 el 2026-07-20). Esa plata nunca salió del efectivo, así que el modelo
 * viejo la restaba de más y el pozo, correctamente, no la resta. Es la diferencia esperada
 * entre las dos corridas — y hay que medirla, no taparla.
 */
function selladoNoEfectivo(cierre: Cierre, movs: Mov[], sesiones: Sesion[]): number {
  const porSesion = new Map(sesiones.map(x => [x.id, x]))
  const enEfectivo = movs
    .filter(
      m =>
        m.subcategory === 'Propinas por turno' &&
        m.status !== 'rechazado' &&
        (m.method === 'Efectivo' || !m.method) &&
        (fechaDeMov(m, porSesion) || dateCR(m.created_at)) === cierre.session_date,
    )
    .reduce((a, m) => a + m.amount_crc, 0)
  const sellado = (cierre.propinas_m_crc || 0) + (cierre.propinas_n_crc || 0)
  return Math.max(0, sellado - enEfectivo)
}

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

  // ── Red de regresión ──────────────────────────────────────────────────────
  // No alcanza con contar pares: el T1 se apoya en los campos sellados y el T2 en los
  // movimientos, así que donde el sello está mal los dos tienen que diferir. Cada
  // divergencia se explica o el script aborta.
  const sinExplicar: string[] = []
  for (const x of t2) {
    const y = t1.find(z => z.fecha === x.fecha)
    if (!y) continue
    const gap = x.deberiaNuevo - y.esperado
    if (Math.abs(gap) <= 0.005) continue
    const c = cierres.find(z => z.session_date === x.fecha && z.tipo === 'completo')
    const esperado = c ? selladoNoEfectivo(c, movs, sesiones) : 0
    const explicado = Math.abs(gap - esperado) <= TOLERANCIA_CRC
    console.log(
      `  ⚖️  ${x.fecha}: T2 − T1 = ${fi(gap)} · propinas NO-efectivo dentro del sello = ${fi(esperado)} ` +
        `${explicado ? '→ EXPLICADO ✅' : '→ SIN EXPLICAR 🔴'}`,
    )
    if (!explicado) sinExplicar.push(`${x.fecha} (${fi(gap)} vs ${fi(esperado)})`)
  }

  if (sinExplicar.length) {
    throw new Error(
      `REGRESIÓN: ${sinExplicar.length} par(es) donde el modelo nuevo difiere del núcleo T1 sin causa ` +
        `conocida: ${sinExplicar.join(' · ')}.`,
    )
  }
  const okT1 = contig(1, t1)
  const okT2 = contig(1, t2)
  console.log(
    `[T2] ✅ sin regresiones: toda diferencia entre el modelo nuevo y el núcleo T1 queda explicada por ` +
      `propinas NO-efectivo metidas en los campos sellados (pares consecutivos: T1 ${okT1} · T2 ${okT2}).`,
  )
}

main().catch((e: unknown) => {
  console.error(`[T2] ABORTADO: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
