// BACKUP de STAGING a JSON local — se corre SIEMPRE antes de tocar nada.
//
//   node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//        scripts/refresh-staging/backup.ts
//
// Escribe _backups-staging/<timestamp>/<tabla>.json (carpeta gitignoreada).
// Restaurar: ver RESTAURAR.md, que este mismo script deja en la carpeta del backup.

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv, REPO_ROOT } from '../t0-reconciliacion-cajas/env.ts'
import { TABLAS_REFRESH, token, verificarRefs } from './gate.ts'
import { traerTabla } from './lib.ts'

function arg(n: string): string | undefined {
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  verificarRefs()
  const tok = token(loadEnv())
  // El sello del backup se pasa por parámetro: los scripts no pueden usar reloj propio
  // sin volverse no reproducibles, y acá conviene que el nombre sea el que el operador ve.
  const sello = arg('--sello') ?? 'manual'
  const dir = resolve(REPO_ROOT, '_backups-staging', sello)
  mkdirSync(dir, { recursive: true })

  console.log(`[backup] staging → ${dir}`)
  const resumen: Record<string, number> = {}
  for (const t of TABLAS_REFRESH) {
    const filas = await traerTabla(t, tok, 'staging')
    writeFileSync(resolve(dir, `${t}.json`), JSON.stringify(filas, null, 1), 'utf8')
    resumen[t] = filas.length
    console.log(`  ${t.padEnd(22)} ${String(filas.length).padStart(6)} filas`)
  }
  writeFileSync(resolve(dir, '_resumen.json'), JSON.stringify(resumen, null, 2), 'utf8')
  writeFileSync(
    resolve(dir, 'RESTAURAR.md'),
    [
      `# Cómo restaurar este backup de STAGING (${sello})`,
      '',
      'Cada archivo es el volcado JSON de una tabla de staging **antes** del refresh.',
      '',
      '```bash',
      'node --import ./scripts/t0-reconciliacion-cajas/register.mjs \\',
      `  scripts/refresh-staging/restaurar.ts --sello ${sello}`,
      '```',
      '',
      'El restore hace `delete from <tabla>` + re-inserta el JSON, tabla por tabla, y **solo**',
      'contra staging (mismo candado de `gate.ts`). No toca prod ni el esquema.',
      '',
      '## Conteos guardados',
      '',
      '| tabla | filas |',
      '|---|---|',
      ...Object.entries(resumen).map(([t, n]) => `| \`${t}\` | ${n} |`),
    ].join('\n'),
    'utf8',
  )
  console.log(`[backup] ✅ ${Object.keys(resumen).length} tablas · ${dir}/RESTAURAR.md`)
}

main().catch((e: unknown) => {
  console.error(`[backup] ABORTADO: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
