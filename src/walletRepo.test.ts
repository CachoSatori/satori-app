// (10-nov, decisión del dueño) Los datos de la cuenta de Google Wallet NO van al repo (es público): el Issuer ID y la
// cuenta de servicio son configuración del Edge (GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SA_KEY). Esta prueba recorre
// TODOS los archivos de texto (también docs/ y los .md) y falla si aparece un Issuer ID de Google Wallet (19 dígitos que
// empiezan con 3388) o una cuenta de servicio de Google que no sea de prueba. Las pruebas usan valores de mentira: el
// Issuer ID 3388000000012345678 y cuentas «@proyecto-falso».
// Los patrones se arman por partes para que la prueba no se encuentre a sí misma.
import { test, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const RAIZ = new URL('..', import.meta.url).pathname
const ISSUER = new RegExp('\\b' + '33' + '88' + '\\d{15}\\b', 'g')
const ISSUER_DE_PRUEBA = '3388000000012345678'
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
    for (const m of t.matchAll(ISSUER)) if (m[0] !== ISSUER_DE_PRUEBA) malos.push(`${relative(RAIZ, p)}: Issuer ID`)
    for (const m of t.matchAll(CUENTA)) if (m[1] !== 'proyecto-falso') malos.push(`${relative(RAIZ, p)}: cuenta de servicio`)
  }
  expect(malos).toEqual([])
})
