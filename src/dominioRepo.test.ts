// (el dueño, 08-nov noche) El dominio del Club es configuración (club_config_global.club_url en la base, VITE_CLUB_URL en
// club-web): no puede volver a aparecer escrito en ningún archivo del repo, salvo la documentación (docs/ y los .md).
// El patrón se arma por partes para que esta prueba no se encuentre a sí misma.
// (18-nov, decisión del dueño: 2.ª excepción de «Repo público» en CLAUDE.md) El remitente propio de los correos
// automáticos (la cuenta no-responder de ese dominio) vale SOLO como esa dirección exacta y SOLO en el código `.ts` de
// las Edge de correo y sus pruebas. Cualquier otra mención del dominio en esos archivos sigue cayendo.
import { test, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const RAIZ = new URL('..', import.meta.url).pathname
const PATRON = new RegExp(['satori', 'costarica', '\\.com'].join(''), 'i')
const FUERA = new Set(['.git', 'node_modules', 'dist', 'docs', 'coverage', '.claude'])
const BINARIOS = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz)$/i
const REMITENTE = new RegExp(['no-responder@', 'satori', 'costarica', '\\.com'].join(''), 'gi')
const PERMITIDOS_REMITENTE = /^supabase\/functions\/(?:cierre-email|monthly-report|pago-notificar|ventas-dia-contador)\/[^/]+\.tsx?$/

/** El texto que se revisa: en las Edge de correo, sin la dirección exacta del remitente propio. */
export function textoARevisar(rel: string, texto: string): string {
  return PERMITIDOS_REMITENTE.test(rel) ? texto.replace(REMITENTE, '') : texto
}

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
    .filter(p => PATRON.test(textoARevisar(relative(RAIZ, p).split(sep).join('/'), readFileSync(p, 'utf8'))))
    .map(p => relative(RAIZ, p))
  expect(con).toEqual([])
})

test('el remitente propio vale solo como dirección exacta y solo en las Edge de correo (18-nov)', () => {
  const dom = ['satori', 'costarica', '.com'].join('')
  const rem = `Satori <no-responder@${dom}>`
  expect(PATRON.test(textoARevisar('supabase/functions/ventas-dia-contador/index.ts', rem))).toBe(false)
  expect(PATRON.test(textoARevisar('supabase/functions/cierre-email/index.ts', rem))).toBe(false)
  // otra Edge, otro tipo de archivo, src/ o club-web: cae
  expect(PATRON.test(textoARevisar('supabase/functions/extract-document/index.ts', rem))).toBe(true)
  expect(PATRON.test(textoARevisar('supabase/functions/ventas-dia-contador/x.js', rem))).toBe(true)
  expect(PATRON.test(textoARevisar('src/modules/ventas/VentasContabilidad.tsx', rem))).toBe(true)
  expect(PATRON.test(textoARevisar('club-web/src/i18n.ts', rem))).toBe(true)
  // en una Edge de correo, el dominio suelto o con otra cuenta sigue cayendo
  expect(PATRON.test(textoARevisar('supabase/functions/ventas-dia-contador/index.ts', `https://club.${dom}`))).toBe(true)
  expect(PATRON.test(textoARevisar('supabase/functions/ventas-dia-contador/index.ts', `otra@${dom}`))).toBe(true)
})
