// (el dueño, 08-nov noche) El dominio del Club es configuración (club_config_global.club_url en la base, VITE_CLUB_URL en
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

// Excepción (decisión del dueño 18-nov, CLAUDE.md «Repo público»): el remitente genérico del negocio, SOLO en la Edge
// del cierre. Se quita esa dirección exacta antes de buscar: cualquier otra mención del dominio en ese archivo cae igual.
const REMITENTE = ['no-responder', ['satori', 'costarica', '.com'].join('')].join('@')
const PERMITIDOS_REMITENTE = new Set(['supabase/functions/cierre-email/index.ts'])
const texto = (p: string) => {
  const t = readFileSync(p, 'utf8')
  return PERMITIDOS_REMITENTE.has(relative(RAIZ, p)) ? t.split(`<${REMITENTE}>`).join('') : t
}

test('el dominio del Club no está escrito en ningún archivo del repo (salvo docs)', () => {
  const con = archivos(RAIZ)
    .filter(p => !p.endsWith('.md') && !BINARIOS.test(p) && statSync(p).size < 5_000_000)
    .filter(p => PATRON.test(texto(p)))
    .map(p => relative(RAIZ, p))
  expect(con).toEqual([])
})
