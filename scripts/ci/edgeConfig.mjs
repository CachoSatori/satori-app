// Lectura de supabase/config.toml y de las carpetas de supabase/functions/ para la guarda R04 (guardas-pr.mjs) y para
// supabase/config.test.ts. Sin dependencias (no hay parser de TOML en el repo): solo entiende lo que usamos,
// `[seccion]` y `clave = valor` en una línea.
//
// Regla (ítem 11, ESTADO regla 2): con config.toml presente, entra código bajo supabase/functions/ hacia main si
//   · cada carpeta de función (las que no empiezan con `_` ni `.`) tiene su [functions.<slug>] con verify_jwt explícito,
//   · no hay [functions.<slug>] sin carpeta (Branching fallaría al buscarla),
//   · ingest-ndf y club-pase van con verify_jwt = false (llaman sin JWT de usuario: con true, 401 en cada llamada),
//   · no hay [remotes.*] (con él, Branching aplicaría [auth]/[api]/[db] a ese proyecto: eso va con firma aparte).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Funciones que se llaman SIN JWT de usuario: verify_jwt tiene que ser false. */
export const SIN_JWT = ['ingest-ndf', 'club-pase']

/** Lee el texto de config.toml → { verify: {slug: true|false|undefined}, secciones: string[] } */
export function leerConfig(texto) {
  const verify = {}
  const secciones = []
  let actual = null
  for (const linea of texto.split('\n')) {
    const l = linea.replace(/#.*/, '').trim()
    if (!l) continue
    const sec = /^\[([^\]]+)\]$/.exec(l)
    if (sec) {
      secciones.push(sec[1].trim())
      const fn = /^functions\.([A-Za-z0-9_-]+)$/.exec(sec[1].trim())
      actual = fn ? fn[1] : null
      if (actual) verify[actual] = undefined
      continue
    }
    const v = /^verify_jwt\s*=\s*(true|false)$/.exec(l)
    if (v && actual) verify[actual] = v[1] === 'true'
  }
  return { verify, secciones }
}

/** Carpetas de función bajo `dir` (sin `_compartido`, `_shared`, ocultas). */
export function carpetasDeFunciones(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => !f.startsWith('_') && !f.startsWith('.') && statSync(join(dir, f)).isDirectory()).sort()
}

/** Problemas de la configuración (vacío = ok). `config` = leerConfig(...), `carpetas` = carpetasDeFunciones(...). */
export function problemasConfig(config, carpetas) {
  const p = []
  const { verify, secciones } = config
  for (const f of carpetas) {
    if (typeof verify[f] !== 'boolean') p.push(`supabase/functions/${f}/ sin [functions.${f}] con verify_jwt explícito en supabase/config.toml`)
  }
  for (const f of Object.keys(verify)) {
    if (!carpetas.includes(f)) p.push(`[functions.${f}] en supabase/config.toml sin su carpeta supabase/functions/${f}/`)
  }
  for (const f of SIN_JWT) {
    if (f in verify && verify[f] !== false) p.push(`[functions.${f}] tiene que llevar verify_jwt = false (llama sin JWT de usuario)`)
  }
  if (secciones.some(s => s === 'remotes' || s.startsWith('remotes.'))) {
    p.push('supabase/config.toml trae [remotes.*]: con eso Branching aplica [auth]/[api]/[db] a ese proyecto; va aparte y con firma del dueño')
  }
  return p
}

/** Lee todo desde la raíz del repo: { existe, problemas }. */
export function revisarRepo(raiz) {
  const ruta = join(raiz, 'supabase', 'config.toml')
  if (!existsSync(ruta)) return { existe: false, problemas: [] }
  return {
    existe: true,
    problemas: problemasConfig(leerConfig(readFileSync(ruta, 'utf8')), carpetasDeFunciones(join(raiz, 'supabase', 'functions'))),
  }
}
