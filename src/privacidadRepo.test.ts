// (16-nov, regla «Repo público» de CLAUDE.md) El repo es público: ni el nombre de pila del dueño ni correos reales.
// Esta prueba recorre TODOS los archivos de texto (docs/, .md, scripts, .claude/, club-web/) y falla si aparece:
//   1. El nombre de pila del dueño (también pegado a otra palabra, como en una ruta de usuario). Se compara por hash
//      SHA-256 de cada palabra normalizada (minúsculas, sin tildes) y de sus prefijos: el nombre no está en el archivo.
//      Ojo: un hash de un nombre común se puede adivinar con un diccionario; esto evita el texto plano, no es un secreto.
//   2. Un correo que no sea ficticio. Ficticios: dominios `.test`, `ejemplo.*`, `example.*`, la cuenta de servicio de
//      mentira y unos pocos genéricos (placeholders y remitentes de servicios). El correo público del negocio (también
//      con alias `+algo`) solo vale en el aviso del Club y su prueba.
// Fuera del escaneo: `supabase/migrations/` (ya aplicadas: el ledger y Branching dependen de su texto) y los lockfiles
// (metadatos de terceros).
// PENDIENTES: lugares conocidos donde el valor se USA en ejecución (cambiarlo cambia comportamiento) o que decide el
// dueño. Están por hash y por archivo: un lugar nuevo hace caer la prueba. Sacarlos de la lista cuando se arreglen.
import { test, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const RAIZ = new URL('..', import.meta.url).pathname
const FUERA = new Set(['.git', 'node_modules', 'dist', 'coverage', '.wrangler'])
const FUERA_RUTAS = ['supabase/migrations/']
const FUERA_ARCHIVOS = new Set(['package-lock.json', 'club-web/package-lock.json'])
const BINARIOS = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz|pkpass|xlsx?|docx?)$/i

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

// Hash del nombre de pila del dueño (minúsculas, sin tildes).
const NOMBRE = '7132fe635f6e982683a62d90761f4c66698221c8a5e225a0bdbba16b64312ec3'
// Hash del correo público del negocio (parte local sin `+alias`).
const NEGOCIO = 'c1ad5654de04a3946d9fa483f888055f7731eab4870e0374227719a5d2cbcc68'
// Hash del correo personal del dueño (destino por defecto de dos Edge Functions).
const DUENO = '010039fad6aca99cbdb47a302143bad29853b81bc3e18c0483c2c491dd662e97'

const PERMITIDOS_NEGOCIO = new Set(['club-web/src/i18n.ts', 'club-web/src/aviso.test.ts'])

const PENDIENTES: Record<string, string[]> = {
  // La regla misma de «Repo público» nombra el correo del negocio: la redacción la decide el dueño.
  'CLAUDE.md': [NEGOCIO],
  // Scripts que buscan al owner por su correo en la base (es el valor que se compara).
  'scripts/clone_prod_to_staging.py': [NEGOCIO],
  'scripts/refresh-staging/humo-arranque-cero.ts': [NEGOCIO],
  'scripts/refresh-staging/prueba-viva-tarjeta.ts': [NEGOCIO],
  'scripts/refresh-staging/seed-apertura.ts': [NEGOCIO],
  'scripts/t0-reconciliacion-cajas/prod-asiento-arranque.ts': [NEGOCIO],
  // Texto que ve el personal al dar de alta a alguien sin correo propio (alias del correo del negocio).
  'src/modules/admin/NuevoEmpleado.tsx': [NEGOCIO],
  'src/modules/admin/UserApprovals.tsx': [NEGOCIO],
  // Destinatario por defecto si falta REPORT_TO_EMAIL (regla 2: nada bajo supabase/functions/ en un PR a main).
  'supabase/functions/cierre-email/index.ts': [DUENO],
  'supabase/functions/monthly-report/index.ts': [DUENO],
}

const CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const DOMINIO_FICTICIO = /(?:^|\.)(?:test|ejemplo\.[a-z]+|example\.[a-z]+|staging\.satori|proyecto-falso\.iam\.gserviceaccount\.com)$/
const GENERICOS = new Set([
  'vos@email.com', // placeholder del registro de clientes
  'proveedor@correo.com', // placeholder de Proveedores
  'onboarding@resend.dev', // remitente de prueba de Resend
  'noreply@anthropic.com', // autor de commits de agentes
])

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    if (FUERA.has(n)) return []
    const p = join(dir, n)
    const st = statSync(p)
    return st.isDirectory() ? archivos(p) : [p]
  })
}

const normal = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function tieneNombre(texto: string): boolean {
  const vistas = new Set<string>()
  for (const m of texto.matchAll(/\p{L}+/gu)) {
    const w = normal(m[0])
    if (w.length < 4 || vistas.has(w)) continue
    vistas.add(w)
    for (let n = 4; n <= Math.min(w.length, 12); n++) if (sha(w.slice(0, n)) === NOMBRE) return true
  }
  return false
}

export function correosMalos(rel: string, texto: string): string[] {
  const malos: string[] = []
  for (const m of texto.matchAll(CORREO)) {
    const c = m[0].toLowerCase()
    const [local, dominio] = c.split('@')
    if (DOMINIO_FICTICIO.test(dominio) || GENERICOS.has(c)) continue
    const h = sha(`${local.split('+')[0]}@${dominio}`)
    if (h === NEGOCIO && PERMITIDOS_NEGOCIO.has(rel)) continue
    if (PENDIENTES[rel]?.includes(h)) continue
    malos.push(`${rel}: correo ${h === NEGOCIO ? 'del negocio' : h === DUENO ? 'del dueño' : 'no ficticio'} (${h.slice(0, 8)})`)
  }
  return malos
}

test('la guarda detecta el nombre y los correos (sin escribirlos acá)', () => {
  // Se arman a partir de los hashes conocidos: probamos con valores que NO son el nombre ni los correos reales.
  expect(tieneNombre('decisión del dueño (08-nov)')).toBe(false)
  expect(correosMalos('x.md', 'ana@ejemplo.test, b@example.com, vos@email.com')).toEqual([])
  // Armados por partes para que el escaneo no encuentre este archivo.
  expect(correosMalos('x.md', 'escribir a alguien' + '@' + 'gmail.com')).toHaveLength(1)
  expect(correosMalos('x.md', 'jefe' + '@' + 'dominio-real.cr')).toHaveLength(1)
})

test('ningún archivo del repo tiene el nombre de pila del dueño ni correos reales fuera de lo permitido', () => {
  const malos: string[] = []
  for (const p of archivos(RAIZ)) {
    const rel = relative(RAIZ, p).split(sep).join('/')
    if (FUERA_RUTAS.some(r => rel.startsWith(r)) || FUERA_ARCHIVOS.has(rel)) continue
    if (BINARIOS.test(p) || statSync(p).size > 5_000_000) continue
    const t = readFileSync(p, 'utf8')
    if (tieneNombre(t)) malos.push(`${rel}: nombre de pila del dueño`)
    malos.push(...correosMalos(rel, t))
  }
  expect(malos).toEqual([])
})
