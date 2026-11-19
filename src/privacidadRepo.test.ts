// (16-nov, regla «Repo público» de CLAUDE.md) El repo es público: ni el nombre de pila del dueño ni correos reales.
// Esta prueba recorre TODOS los archivos de texto (docs/, .md, scripts, .claude/, club-web/) y falla si aparece:
//   1. El nombre de pila del dueño (también pegado a otra palabra, como en una ruta de usuario). Se compara por hash
//      SHA-256 de cada palabra normalizada (minúsculas, sin tildes) y de sus prefijos: el nombre no está en el archivo.
//      Ojo: un hash de un nombre común se puede adivinar con un diccionario; esto evita el texto plano, no es un secreto.
//   2. Un correo que no sea ficticio. Ficticios: dominios `.test`, `ejemplo.*`, `example.*`, la cuenta de servicio de
//      mentira y unos pocos genéricos (placeholders y remitentes de servicios). El correo público del negocio (también
//      con alias `+algo`) solo vale en el aviso del Club y su prueba. El remitente propio del dominio verificado en
//      Resend (decisión del dueño, 18-nov) solo vale en el código de las Edge de correo y sus pruebas.
//   3. (19-nov) Un TELÉFONO: número CR de 8 dígitos que empiece con 2/4/5/6/7/8 (con o sin +506, guiones o espacios) que no
//      sea de la lista blanca de ficticios (80000000–80000099). Ver `telefonosMalos` más abajo.
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

// (18-nov, decisión del dueño: segunda excepción de «Repo público» en CLAUDE.md) Hash del remitente propio
// (`no-responder@` del dominio del negocio, verificado en Resend). Vale SOLO en el código `.ts` de las Edge que mandan
// correo y en sus pruebas; en cualquier otro archivo (docs, src/, scripts, club-web) cae.
const REMITENTE = '314e8bd4c0f438086a8201054810a2bb8a4d2869ae08dfc3cc43e38933f737b6'
const PERMITIDOS_REMITENTE = /^supabase\/functions\/(?:cierre-email|monthly-report|pago-notificar|ventas-dia-contador)\/[^/]+\.tsx?$/

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

// (19-nov) TELÉFONOS. Un teléfono real en una prueba o un fixture queda público para siempre.
// Cómo arreglarlo: usá un ficticio de la lista blanca 80000000–80000099 (p. ej. 80000001, o «+506 8000 0001»). Si es un número
// que no es teléfono (id, monto, semilla), escribilo de forma que no parezca uno (con separador de miles, o con prefijo de
// texto) o agregá la ruta a TELEFONO_FUERA_RUTAS con el motivo.
const TEL = /(?<![0-9A-Za-z_-])(?<![0-9][.,])(?:\+?506[ -]?)?([24-8][0-9]{3})[ .-]?([0-9]{4})(?![0-9])(?![.,][0-9])/g
const TEL_FICTICIO = /^800000[0-9]{2}$/
const TEL_PLACEHOLDER = '88888888'   // «8888-8888»: ejemplo de formato en el campo de teléfono de los formularios
/** Rutas fuera de la regla de teléfonos, con el motivo (además de supabase/migrations y los lockfiles, ya fuera del escaneo). */
export const TELEFONO_FUERA_RUTAS: { patron: RegExp; motivo: string }[] = [
  { patron: /^scripts\/sql\/.*\.(sql|sh)$/, motivo: 'pruebas SQL que corren contra la base con números inventados de patrón obvio (6000xxxx, 6001xxxx, 6111xxxx, 8888xxxx); cambiarlos exige re-correrlas contra una base' },
  { patron: /^scripts\/t0-reconciliacion-cajas\/REPORTE-T0B-PROD\.md$/, motivo: 'reporte con ids de movimientos de ocho dígitos, no teléfonos' },
  { patron: /^docs\/analisis\/[^/]+\/datos\/.*\.csv$/, motivo: 'datos numéricos exportados (montos, conteos): sin teléfonos, y los números largos chocan con la regla' },
]
const esFechaCompacta = (d: string) => /^20[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$/.test(d)   // 20261118: semilla o fecha
const esRangoAnios = (a: string, b: string) => /^(19|20)[0-9]{2}$/.test(a) && /^(19|20)[0-9]{2}$/.test(b)   // 2024-2025

export function telefonosMalos(rel: string, texto: string): string[] {
  if (TELEFONO_FUERA_RUTAS.some(r => r.patron.test(rel))) return []
  const malos: string[] = []
  for (const m of texto.matchAll(TEL)) {
    const d = m[1] + m[2]
    if (TEL_FICTICIO.test(d) || d === TEL_PLACEHOLDER || esFechaCompacta(d) || d === '86400000' /* ms de un día */) continue
    if (/[ -]/.test(m[0].replace(/^\+?506[ -]?/, '')) && esRangoAnios(m[1], m[2])) continue
    malos.push(`${rel}: teléfono que parece real (posición ${m.index}). Reemplácelo por un ficticio 80000000–80000099 (ver telefonosMalos en src/privacidadRepo.test.ts)`)
  }
  return malos
}

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    if (FUERA.has(n)) return []
    const p = join(dir, n)
    const st = statSync(p)
    return st.isDirectory() ? archivos(p) : [p]
  })
}

const normal = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// (16-nov) Memoria por palabra para TODO el escaneo: antes cada archivo volvía a calcular los SHA-256 de las mismas
// palabras (cientos de miles de hashes) y bajo carga la prueba pasaba los 5 s de vitest y caía por timeout.
const memoria = new Map<string, Map<string, boolean>>()
function palabraEs(w: string, objetivo: string): boolean {
  let m = memoria.get(objetivo)
  if (!m) { m = new Map(); memoria.set(objetivo, m) }
  let r = m.get(w)
  if (r === undefined) {
    r = false
    for (let n = 4; n <= Math.min(w.length, 12); n++) if (sha(w.slice(0, n)) === objetivo) { r = true; break }
    m.set(w, r)
  }
  return r
}

/** `objetivo` = hash de la palabra buscada (por defecto, el nombre de pila del dueño; las pruebas pasan uno ficticio). */
export function tieneNombre(texto: string, objetivo: string = NOMBRE): boolean {
  const vistas = new Set<string>()
  for (const m of texto.matchAll(/\p{L}+/gu)) {
    if (m[0].length < 4 || vistas.has(m[0])) continue   // la palabra tal cual: se normaliza una sola vez por archivo
    vistas.add(m[0])
    if (palabraEs(normal(m[0]), objetivo)) return true
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
    if (h === REMITENTE && PERMITIDOS_REMITENTE.test(rel)) continue
    if (PENDIENTES[rel]?.includes(h)) continue
    malos.push(`${rel}: correo ${h === NEGOCIO ? 'del negocio' : h === DUENO ? 'del dueño' : 'no ficticio'} (${h.slice(0, 8)})`)
  }
  return malos
}

test('la guarda detecta un nombre (ficticio) también pegado a otra palabra, con tildes y repetido (memoria)', () => {
  const FICTICIO = sha('zorbalina')
  expect(tieneNombre('hola Zórbalina', FICTICIO)).toBe(true)
  expect(tieneNombre('/home/zorbalinax/proyecto', FICTICIO)).toBe(true)       // prefijo pegado (ruta de usuario)
  expect(tieneNombre('zorba y lina', FICTICIO)).toBe(false)
  // la memoria es por objetivo: la misma palabra con otro hash no hereda el resultado
  expect(tieneNombre('zorbalina', sha('otraplabra'))).toBe(false)
  expect(tieneNombre('zorbalina', FICTICIO)).toBe(true)                       // segunda vez (desde la memoria)
})

test('la guarda detecta el nombre y los correos (sin escribirlos acá)', () => {
  // Se arman a partir de los hashes conocidos: probamos con valores que NO son el nombre ni los correos reales.
  expect(tieneNombre('decisión del dueño (08-nov)')).toBe(false)
  expect(correosMalos('x.md', 'ana@ejemplo.test, b@example.com, vos@email.com')).toEqual([])
  // Armados por partes para que el escaneo no encuentre este archivo.
  expect(correosMalos('x.md', 'escribir a alguien' + '@' + 'gmail.com')).toHaveLength(1)
  expect(correosMalos('x.md', 'jefe' + '@' + 'dominio-real.cr')).toHaveLength(1)
})

test('el remitente propio vale solo en el código de las Edge de correo y sus pruebas (18-nov)', () => {
  const dom = ['satori', 'costarica', '.com'].join('')   // por partes: lo cuida src/dominioRepo.test.ts
  const rem = 'Satori <no-responder' + '@' + dom + '>'
  expect(correosMalos('supabase/functions/ventas-dia-contador/index.ts', rem)).toEqual([])
  expect(correosMalos('supabase/functions/cierre-email/index.ts', rem)).toEqual([])
  expect(correosMalos('supabase/functions/ventas-dia-contador/proceso.test.ts', rem)).toEqual([])
  // fuera de esas Edge, o en otro tipo de archivo, cae
  expect(correosMalos('supabase/functions/extract-document/index.ts', rem)).toHaveLength(1)
  expect(correosMalos('supabase/functions/ventas-dia-contador/README.md', rem)).toHaveLength(1)
  expect(correosMalos('src/modules/ventas/VentasContabilidad.tsx', rem)).toHaveLength(1)
  expect(correosMalos('docs/pases/PASE-189-correo-contador.md', rem)).toHaveLength(1)
  expect(correosMalos('club-web/src/i18n.ts', rem)).toHaveLength(1)
  // otra cuenta del mismo dominio no entra por esta excepción
  expect(correosMalos('supabase/functions/ventas-dia-contador/index.ts', 'otra' + '@' + dom)).toHaveLength(1)
})

test('la guarda de teléfonos: cae con uno plausible (con o sin +506, guiones o espacios), pasa con los ficticios y con lo que no es teléfono', () => {
  // armados por partes para que el escaneo no encuentre este archivo
  const plausible = ['7123', '4567'].join('')
  const cae = (t: string) => telefonosMalos('src/x.ts', t)
  expect(cae(`whatsapp: '${plausible}'`)).toHaveLength(1)
  expect(cae(`whatsapp: '+506 ${plausible.slice(0, 4)} ${plausible.slice(4)}'`)).toHaveLength(1)
  expect(cae(`wa.me/506${plausible}?text=hola`)).toHaveLength(1)
  expect(cae(`tel: '${plausible.slice(0, 4)}-${plausible.slice(4)}'`)).toHaveLength(1)
  for (const ini of ['2', '4', '5', '6', '8']) expect(cae(`'${ini}1234567'`), ini).toHaveLength(1)
  expect(cae(`'3${'1234567'}'`)).toEqual([])                       // empieza con 3: no es teléfono CR
  expect(cae(`'+506 8000 0001' y '${'8000'}${'0099'}' y '8000-0000'`)).toEqual([])   // lista blanca 80000000–80000099
  expect(cae(`'${'8000'}${'0100'}'`)).toHaveLength(1)                   // fuera del bloque
  expect(cae(`placeholder="8888-8888" · 2024-2025 · seed 20261118 · ${86_400_000} · 52608717.00 · ${plausible}9`)).toEqual([])   // placeholder, años, fecha compacta, ms, monto, número más largo
  // ronda 2: CSV, prefijo pegado y puntos caen; los decimales no
  expect(cae(`nombre,${plausible}`)).toHaveLength(1)
  expect(cae(`Tel.${plausible}`)).toHaveLength(1)
  expect(cae(`${plausible.slice(0, 4)}.${plausible.slice(4)}`)).toHaveLength(1)
  expect(cae('12.345678')).toEqual([])
  expect(cae('1234.5678 y 0.71234567')).toEqual([])
  expect(cae(`id 2a${plausible}`)).toEqual([])                // pegado a letras: hash o id
  expect(telefonosMalos('supabase/migrations/x.sql', plausible)).toHaveLength(1)   // (el escaneo real la saltea entera)
  expect(telefonosMalos('scripts/sql/999_pruebas.sql', plausible)).toEqual([])    // exclusión justificada
  expect(cae(plausible)[0]).toContain('80000000–80000099')    // el mensaje dice cómo arreglarlo
  expect(cae(plausible)[0]).not.toContain(plausible)          // y no repite el número
})

test('ningún archivo del repo tiene el nombre de pila del dueño, correos reales ni teléfonos que parezcan reales fuera de lo permitido', () => {
  const malos: string[] = []
  for (const p of archivos(RAIZ)) {
    const rel = relative(RAIZ, p).split(sep).join('/')
    if (FUERA_RUTAS.some(r => rel.startsWith(r)) || FUERA_ARCHIVOS.has(rel)) continue
    if (BINARIOS.test(p) || statSync(p).size > 5_000_000) continue
    const t = readFileSync(p, 'utf8')
    if (tieneNombre(t)) malos.push(`${rel}: nombre de pila del dueño`)
    malos.push(...correosMalos(rel, t))
    malos.push(...telefonosMalos(rel, t))
  }
  expect(malos).toEqual([])
}, 30_000) // recorre todo el repo: con la memoria tarda ~0,5 s; el tope de 30 s es para máquinas cargadas (antes: 5 s)
