// (10-nov, decisión del dueño) Los datos de la cuenta de Google Wallet NO van al repo (es público): el Issuer ID y la
// cuenta de servicio son configuración del Edge (GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SA_KEY). Esta prueba recorre
// TODOS los archivos de texto (también docs/ y los .md) y falla si aparece un Issuer ID de Google Wallet (19 dígitos que
// empiezan con 3388) o una cuenta de servicio de Google que no sea de prueba (las pruebas usan «proyecto-falso»).
// Los patrones se arman por partes para que la prueba no se encuentre a sí misma.
import { test, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const RAIZ = new URL('..', import.meta.url).pathname
const ISSUER = new RegExp('\\b' + '33' + '88' + '\\d{15}\\b')
const CUENTA = new RegExp('[a-z0-9._-]+@([a-z0-9-]+)\\.' + ['iam', 'gserviceaccount', 'com'].join('\\.'), 'gi')
const FUERA = new Set(['.git', 'node_modules', 'dist', 'coverage', '.claude', '.wrangler'])
const BINARIOS = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz|pkpass)$/i

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    if (FUERA.has(n)) return []
    const p = join(dir, n)
    const st = statSync(p)
    return st.isDirectory() ? archivos(p) : [p]
  })
}

test('ningún archivo del repo tiene el Issuer ID de Google Wallet ni una cuenta de servicio real', () => {
  const malos: string[] = []
  for (const p of archivos(RAIZ)) {
    if (BINARIOS.test(p) || statSync(p).size > 5_000_000) continue
    const t = readFileSync(p, 'utf8')
    if (ISSUER.test(t)) malos.push(`${relative(RAIZ, p)}: Issuer ID`)
    for (const m of t.matchAll(CUENTA)) if (m[1] !== 'proyecto-falso') malos.push(`${relative(RAIZ, p)}: cuenta de servicio`)
  }
  expect(malos).toEqual([])
})
