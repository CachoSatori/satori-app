// (11-nov) El build de producción de club-web corre SOLO, con las dependencias de club-web (Cloudflare Pages: carpeta
// `club-web`, `npm ci && npm run build`). El primer deploy de producción falló porque `tsc --noEmit` revisaba también
// los archivos de prueba, que usan `vitest`: vitest está en la raíz del repo, no en club-web.
// Las pruebas se corren desde la raíz (vitest las toma igual); el build no las revisa.
import { test, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

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

// (12-nov) El deploy de producción de `cf1a61d` falló ANTES del build. Pages busca un archivo de configuración de
// wrangler en la carpeta del proyecto (y, si no hay, en las de arriba) y lo valida con sus reglas:
//   «Configuration file for Pages projects does not support "unsafe"»
//   «Failed: unable to read the Wrangler configuration file with code: 1»
// `club-web/wrangler.toml` tenía `pages_build_output_dir` y los dos topes `[[unsafe.bindings]]`, que Pages no admite.
// Decisión del dueño (12-nov): el proyecto de Pages se configura SOLO en el panel (build, variables y el service binding
// CLUB_API); el único archivo de wrangler es el del Worker (`club-web/worker/wrangler.toml`), que Pages no mira.
test('Pages no encuentra ningún archivo de wrangler: ni en club-web ni en la raíz del repo', () => {
  const encontrados: string[] = []
  for (const carpeta of ['..', '../..']) {
    for (const nombre of ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc']) {
      if (existsSync(new URL(`${carpeta}/${nombre}`, import.meta.url))) encontrados.push(`${carpeta}/${nombre}`)
    }
  }
  expect(encontrados).toEqual([])
})

test('el único archivo de wrangler de club-web es el del Worker, y no es una configuración de Pages', () => {
  const worker = leer('../worker/wrangler.toml')
  expect(worker).toMatch(/^main = "index\.js"$/m)
  expect(worker).not.toMatch(/^\s*pages_build_output_dir\b/m)
})
