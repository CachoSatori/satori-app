#!/usr/bin/env node
// Empaqueta `src/modules/ventas/ventasPosPuro.ts` (la lógica PURA de ventas desde el PoS) en UN
// módulo ESM sin dependencias, para la Edge `monthly-report` (Deno no puede importar `src/`).
//
//   node scripts/edge/empaquetar-ventas-pos.mjs <salida.js>
//
// · El cliente de Supabase de la app (`shared/api/supabase.ts`, Vite) se reemplaza por un módulo
//   vacío: lo puro no lo usa, y así el paquete no arrastra supabase-js ni `import.meta.env`.
// · Privacidad (D3, repo público): el roster `SALONEROS_CONOCIDOS` de `mapTicket.ts` (nombres reales) se
//   reemplaza por `{}`. La Edge saca los nombres de `employees` (pos_login → full_name, la misma primera capa
//   que la app); un login que no esté ahí sale «sin asignar», no rompe.
// · La cabecera lleva el commit y el sha256 del contenido, para saber de qué `src/` salió.
// · `ventasPosPuro.paridad.test.ts` arma el paquete en memoria con `empaquetar()` y lo compara
//   contra la app en el caso de `__paridad__/`.
import { rolldown } from 'rolldown'
import ts from 'typescript'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENTRADA = join(RAIZ, 'src/modules/ventas/ventasPosPuro.ts')
const STUB = '\0satori-supabase-vacio'

export async function empaquetar() {
  const b = await rolldown({
    input: ENTRADA,
    platform: 'neutral',
    treeshake: true,
    plugins: [{
      name: 'supabase-vacio',
      resolveId(id) { return /(^|\/)supabase$/.test(id) && !id.includes('@supabase') ? STUB : null },
      load(id) { return id === STUB ? 'export const supabase = null' : null },
    }, {
      name: 'sin-roster-de-nombres',
      transform(code, id) {
        if (!id.endsWith('/shared/ndf/mapTicket.ts')) return null
        const re = /export const SALONEROS_CONOCIDOS: Record<string, string> = \{[\s\S]*?\n\}/
        if (!re.test(code)) throw new Error('empaquetar: no encontré SALONEROS_CONOCIDOS en mapTicket.ts')
        return code.replace(re, 'export const SALONEROS_CONOCIDOS: Record<string, string> = {}')
      },
    }, {
      // `personasNdf.ts` une los códigos de una misma persona (eso se queda) y le pone una etiqueta con
      // su nombre (eso NO viaja): la etiqueta de cada mesero pasa a «<código> · sin asignar».
      name: 'sin-etiquetas-de-nombres',
      transform(code, id) {
        if (!id.endsWith('/shared/ndf/personasNdf.ts')) return null
        const re = /(\{ id: '([^']+)',\s*rol: 'mesero',\s*etiqueta: )'[^']*'/g
        if (!re.test(code)) throw new Error('empaquetar: no encontré las etiquetas de meseros en personasNdf.ts')
        return code.replace(re, (_m, pre, cod) => `${pre}'${cod} · sin asignar'`)
      },
    }],
  })
  const { output } = await b.generate({ format: 'esm' })
  await b.close()
  // Sin comentarios: los de `src/` nombran personas en el texto (repo público, D3).
  return ts.transpileModule(output[0].code, {
    compilerOptions: { removeComments: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
}

export function cabecera(codigo) {
  let sha = 'desconocido'
  try { sha = execSync('git rev-parse --short HEAD', { cwd: RAIZ }).toString().trim() } catch { /* sin git */ }
  const huella = createHash('sha256').update(codigo).digest('hex')
  return `// GENERADO — no editar a mano. Fuente: src/modules/ventas/ventasPosPuro.ts @ ${sha}\n` +
    `// Regenerar: node scripts/edge/empaquetar-ventas-pos.mjs <salida>  ·  sha256(cuerpo) ${huella}\n` +
    `// deno-lint-ignore-file\n// @ts-nocheck\n`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const salida = process.argv[2]
  if (!salida) { console.error('uso: node scripts/edge/empaquetar-ventas-pos.mjs <salida.js>'); process.exit(1) }
  const codigo = await empaquetar()
  writeFileSync(salida, cabecera(codigo) + codigo)
  console.log(`ok: ${salida} (${codigo.length} bytes)`)
}
