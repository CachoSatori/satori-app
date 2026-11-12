// (Ismael, 08-nov noche) El dominio del Club es configuración (club_config_global.club_url en la base, VITE_CLUB_URL en
// club-web): no puede volver a aparecer escrito en ningún archivo del repo, salvo la documentación (docs/ y los .md).
// El patrón se arma por partes para que esta prueba no se encuentre a sí misma.
import { test, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const RAIZ = new URL('..', import.meta.url).pathname
const PATRON = new RegExp(['satori', 'costarica', '\\.com'].join(''), 'i')
const FUERA = new Set(['.git', 'node_modules', 'dist', 'docs', 'coverage', '.claude'])
const BINARIOS = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz)$/i

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    if (FUERA.has(n)) return []
    const p = join(dir, n)
    const st = statSync(p)
    return st.isDirectory() ? archivos(p) : [p]
  })
}

test('el dominio del Club no está escrito en ningún archivo del repo (salvo docs)', () => {
  const con = archivos(RAIZ)
    .filter(p => !p.endsWith('.md') && !BINARIOS.test(p) && statSync(p).size < 5_000_000)
    .filter(p => PATRON.test(readFileSync(p, 'utf8')))
    .map(p => relative(RAIZ, p))
  expect(con).toEqual([])
})
