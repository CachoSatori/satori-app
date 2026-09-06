// Resolver ESM de ~10 líneas: Node exige la extensión en los imports relativos y
// `src/` del repo los escribe sin ella (Vite los resuelve). Copiado tal cual de
// `scripts/pool-backfill/ts-resolve-hook.mjs`.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|node)$/
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !EXT.test(specifier)) {
    const base = new URL(specifier, context.parentURL).href
    for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
      if (existsSync(fileURLToPath(cand))) return nextResolve(cand, context)
    }
  }
  return nextResolve(specifier, context)
}
