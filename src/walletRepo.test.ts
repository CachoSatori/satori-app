// (10-nov, decisión del dueño) Los datos de la cuenta de Google Wallet NO van al repo (es público): el Issuer ID y la
// cuenta de servicio son configuración del Edge (GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SA_KEY). Esta prueba recorre
// TODOS los archivos de texto (también docs/ y los .md) y falla si aparece un Issuer ID de Google Wallet (19 dígitos que
// empiezan con 3388) o una cuenta de servicio de Google que no sea de prueba. Las pruebas usan valores de mentira: el
// Issuer ID 3388000000012345678 y cuentas «@proyecto-falso».
// Los patrones se arman por partes para que la prueba no se encuentre a sí misma.
import { test, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

// ── (10-nov, Grok 169) Correos @gmail y el nombre del dueño ────────────────────────────────────────────────────────────
// CLAUDE.md: «Nunca al repo: nombres de personas … correos». Única excepción: el correo público del negocio, solo en el
// aviso del Club (club-web/src/i18n.ts) y en su prueba (club-web/src/aviso.test.ts); CLAUDE.md lo nombra al dar la regla.
// Los correos y el nombre se comparan por su sha256: esta prueba no los escribe.
// PENDIENTES: lo que ya estaba en el repo el 10-nov, cada uno con su motivo y su ítem del backlog. Si alguno deja de
// aparecer, la prueba pide sacarlo de la lista (la lista solo se achica). Uno nuevo en cualquier otro lugar → falla.
const NEGOCIO = 'c1ad5654de04a3946d9fa483f888055f7731eab4870e0374227719a5d2cbcc68'
const PERMITIDOS: Record<string, string[]> = {
  'club-web/src/i18n.ts': [NEGOCIO], 'club-web/src/aviso.test.ts': [NEGOCIO], 'CLAUDE.md': [NEGOCIO],
}
const PENDIENTES: Record<string, string[]> = {
  // backlog 22d: el correo personal como valor por defecto de REPORT_TO_EMAIL (después del piloto)
  'supabase/functions/cierre-email/index.ts': ['010039fad6aca99cbdb47a302143bad29853b81bc3e18c0483c2c491dd662e97'],
  'supabase/functions/monthly-report/index.ts': ['010039fad6aca99cbdb47a302143bad29853b81bc3e18c0483c2c491dd662e97'],
  // backlog 22j: el correo del negocio como login del owner en los scripts de staging (pasa a una variable de entorno)
  'STAGING.md': [NEGOCIO], 'scripts/clone_prod_to_staging.py': [NEGOCIO],
  'scripts/refresh-staging/humo-arranque-cero.ts': [NEGOCIO], 'scripts/refresh-staging/prueba-viva-tarjeta.ts': [NEGOCIO],
  'scripts/refresh-staging/seed-apertura.ts': [NEGOCIO], 'scripts/t0-reconciliacion-cajas/prod-asiento-arranque.ts': [NEGOCIO],
  // backlog 22j: el ejemplo «+nombre» del correo del negocio en el alta de empleados y en los archivos históricos
  'src/modules/admin/NuevoEmpleado.tsx': ['2cdcf1acc0bc947e2a974faae6e77c2ed60a7dcb383feec5ec1e77e81be48223'], 'src/modules/admin/UserApprovals.tsx': ['2cdcf1acc0bc947e2a974faae6e77c2ed60a7dcb383feec5ec1e77e81be48223'],
  'ESTADO-ARCHIVO.md': ['2cdcf1acc0bc947e2a974faae6e77c2ed60a7dcb383feec5ec1e77e81be48223'], 'ROADMAP-ARCHIVO.md': ['2cdcf1acc0bc947e2a974faae6e77c2ed60a7dcb383feec5ec1e77e81be48223'],
  // ficticio (un ejemplo en una prueba)
  'scripts/sync_sops/lib.test.ts': ['9afc8ddcb80324cebbb065b793321bb1b2fbc1dccb66aa0a2d73950e5b5df15a'],
}
const GMAIL = new RegExp('[a-z0-9._%+-]+@' + 'gmail' + '\\.com', 'gi')
// El nombre de pila del dueño (sha256 de las 6 letras en minúscula). Se mira el comienzo de cada palabra, así también
// aparece pegado (un usuario o una ruta). supabase/migrations/ queda afuera: sus comentarios se limpian después del pase
// del Club (backlog 22c) y los de adentro de funciones de la 150 quedan (cambiarían su huella).
const NOMBRE = '7132fe635f6e982683a62d90761f4c66698221c8a5e225a0bdbba16b64312ec3'
const NOMBRE_FUERA = 'supabase/migrations/'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

test('ningún correo @gmail fuera de los permitidos y de la lista de pendientes (que solo se achica)', () => {
  const malos: string[] = []
  const vistos = new Set<string>()
  for (const p of archivos(RAIZ)) {
    if (BINARIOS.test(p) || statSync(p).size > 5_000_000) continue
    const rel = relative(RAIZ, p)
    const t = readFileSync(p, 'utf8')
    for (const m of t.matchAll(GMAIL)) {
      const h = sha(m[0].toLowerCase())
      if ((PERMITIDOS[rel] ?? []).includes(h)) continue
      if ((PENDIENTES[rel] ?? []).includes(h)) { vistos.add(`${rel} ${h}`); continue }
      malos.push(`${rel}: correo @gmail`)
    }
  }
  for (const [rel, hs] of Object.entries(PENDIENTES))
    for (const h of hs) if (!vistos.has(`${rel} ${h}`)) malos.push(`${rel}: ya no tiene el correo pendiente: sacalo de PENDIENTES`)
  expect(malos).toEqual([])
})

test('el nombre del dueño no está en ningún archivo (fuera de supabase/migrations/, backlog 22c)', () => {
  const malos = new Set<string>()
  for (const p of archivos(RAIZ)) {
    if (BINARIOS.test(p) || statSync(p).size > 5_000_000) continue
    const rel = relative(RAIZ, p)
    if (rel.startsWith(NOMBRE_FUERA)) continue
    const t = readFileSync(p, 'utf8')
    for (const m of t.matchAll(/\p{L}{6,}/gu)) if (sha(m[0].slice(0, 6).toLowerCase()) === NOMBRE) malos.add(rel)
  }
  expect([...malos]).toEqual([])
})

test('la prueba encuentra lo que tiene que encontrar (controles positivos)', () => {
  expect(sha(['satori', 'sushibar'].join('') + '@gmail.com')).toBe(NEGOCIO)
  expect(('una' + '@' + 'gmail.com y otra').match(GMAIL)).not.toBeNull()
  expect(('x ' + 'una' + '@' + 'gmail.com').match(GMAIL)?.[0]).toBe('una' + '@' + 'gmail.com')
})
