// REFRESH de DATOS staging ← prod. Copia FILAS, nunca estructura. Cero migraciones.
//
//   T0_PROD_FIRMADO=2026-07-22 node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//     scripts/refresh-staging/refresh.ts --confirmo-borrar-staging
//
// Orden de seguridad, en este orden y sin atajos:
//   1. Candado de refs (gate.ts): staging es el único destino de escritura, clavado.
//   2. Firma de prod (la misma del T0-B) + smoke: el canal de prod TIENE que rechazar
//      una escritura antes de que se lea un solo dato.
//   3. Exige `--confirmo-borrar-staging`: esto BORRA las tablas del alcance en staging.
//   4. Exige que exista un backup previo (--sello), o se niega a correr.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv, REPO_ROOT } from '../t0-reconciliacion-cajas/env.ts'
import { exigirFirma } from '../t0-reconciliacion-cajas/prod-gate.ts'
import {
  EXCLUIDAS, REF_PROD_LECTURA, REF_STAGING_ESCRITURA, TABLAS_REFRESH,
  escribirEnStaging, token, verificarProdEsSoloLectura, verificarRefs,
} from './gate.ts'
import { columnasDe, contar, sentenciasInsert, traerTabla } from './lib.ts'

function arg(n: string): string | undefined {
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : undefined
}

export type FilaResumen = { tabla: string; prod: number; stagingAntes: number; stagingDespues: number; ok: boolean }

async function main(): Promise<void> {
  verificarRefs()
  const env = loadEnv()
  exigirFirma(env, 'scripts/refresh-staging/refresh.ts')

  if (!process.argv.includes('--confirmo-borrar-staging')) {
    throw new Error(
      'Falta --confirmo-borrar-staging. Este script BORRA y reemplaza las tablas del alcance en STAGING.\n' +
        `  Alcance: ${TABLAS_REFRESH.join(', ')}`,
    )
  }
  const sello = arg('--sello')
  if (!sello) throw new Error('Falta --sello <carpeta del backup>: no se corre sin backup previo.')
  const dirBackup = resolve(REPO_ROOT, '_backups-staging', sello)
  if (!existsSync(dirBackup)) {
    throw new Error(`No existe el backup ${dirBackup}. Corré primero backup.ts --sello ${sello}.`)
  }

  const tok = token(env)
  const smoke = await verificarProdEsSoloLectura(tok)
  console.log(`[refresh] PROD ${REF_PROD_LECTURA} · SOLO LECTURA verificada — ${smoke.replace(/\s+/g, ' ').slice(0, 70)}`)
  console.log(`[refresh] destino de escritura: STAGING ${REF_STAGING_ESCRITURA} (clavado)`)
  console.log(`[refresh] backup previo: ${dirBackup}`)
  console.log(`[refresh] excluidas a propósito: ${Object.keys(EXCLUIDAS).length} grupos (ver PLAN.md)`)

  const resumen: FilaResumen[] = []
  for (const t of TABLAS_REFRESH) {
    const antes = await contar(t, tok, 'staging')
    const filas = await traerTabla(t, tok, 'prod')
    const cols = await columnasDe(t, tok)
    const omitidas = filas.length ? Object.keys(filas[0]).filter(c => !cols.has(c)) : []
    if (omitidas.length) {
      // No debería pasar nunca: el PLAN verificó que prod no tiene columnas que staging no tenga.
      throw new Error(`ABORTADO: ${t} tiene columnas en prod que staging no tiene: ${omitidas.join(', ')}`)
    }
    await escribirEnStaging(`delete from public.${t}`, tok)
    for (const sql of sentenciasInsert(t, filas, cols)) await escribirEnStaging(sql, tok)
    const despues = await contar(t, tok, 'staging')
    const ok = despues === filas.length
    resumen.push({ tabla: t, prod: filas.length, stagingAntes: antes, stagingDespues: despues, ok })
    console.log(
      `  ${t.padEnd(22)} prod ${String(filas.length).padStart(6)} · staging ${String(antes).padStart(6)} → ` +
        `${String(despues).padStart(6)} ${ok ? '✅' : '❌'}`,
    )
    if (!ok) throw new Error(`ABORTADO en ${t}: quedaron ${despues} filas y prod tenía ${filas.length}. Restaurá con restaurar.ts --sello ${sello}.`)
  }

  console.log(`[refresh] ✅ ${resumen.length} tablas · ${resumen.reduce((a, r) => a + r.prod, 0)} filas copiadas`)
  console.log(`[refresh] resumen JSON → ${JSON.stringify(resumen)}`)
}

main().catch((e: unknown) => {
  console.error(`[refresh] ABORTADO: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
