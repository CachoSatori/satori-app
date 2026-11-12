// (11-nov) El build de producción de club-web corre SOLO, con las dependencias de club-web (Cloudflare Pages: carpeta
// `club-web`, `npm ci && npm run build`). El primer deploy de producción falló porque `tsc --noEmit` revisaba también
// los archivos de prueba, que usan `vitest`: vitest está en la raíz del repo, no en club-web.
// Las pruebas se corren desde la raíz (vitest las toma igual); el build no las revisa.
import { test, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), 'utf8')

test('el build no revisa los archivos de prueba (tsconfig los excluye)', () => {
  const ts = JSON.parse(leer('../tsconfig.json')) as { include?: string[]; exclude?: string[] }
  expect(ts.exclude).toContain('src/**/*.test.ts')
  expect(leer('../package.json')).toContain('"build": "tsc --noEmit && vite build"')
})

test('lo que entra al build no depende de nada de afuera de club-web', () => {
  const pkg = JSON.parse(leer('../package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  const propias = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])
  const malos: string[] = []
  for (const f of readdirSync(new URL('.', import.meta.url))) {
    if (!/\.ts$/.test(f) || /\.test\.ts$/.test(f) || /\.d\.ts$/.test(f)) continue
    for (const m of leer(`./${f}`).matchAll(/from\s+'([^'.][^']*)'/g)) {
      const paquete = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0]
      if (!propias.has(paquete)) malos.push(`${f}: ${m[1]}`)
    }
  }
  expect(malos).toEqual([])
})
