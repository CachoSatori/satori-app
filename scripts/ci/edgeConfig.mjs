// Lectura de supabase/config.toml y de las carpetas de supabase/functions/ para la guarda R04 (guardas-pr.mjs) y para
// supabase/config.test.ts. Sin dependencias (no hay parser de TOML en el repo): solo entiende lo que usamos,
// `[seccion]` y `clave = valor` en una línea.
//
// Regla (ítem 11, ESTADO regla 2): con config.toml presente, entra código bajo supabase/functions/ hacia main si
//   · cada carpeta de función (las que no empiezan con `_` ni `.`) tiene su [functions.<slug>] con verify_jwt explícito,
//   · no hay [functions.<slug>] sin carpeta (Branching fallaría al buscarla),
//   · ingest-ndf y club-pase van con verify_jwt = false (llaman sin JWT de usuario: con true, 401 en cada llamada),
//   · no hay nada más (lista blanca): ni [remotes.*] (con él, Branching aplicaría [auth]/[api]/[db] a ese proyecto), ni
//     `entrypoint`, `enabled`, `import_map` ni claves con puntos. Agregar una clave es cambiar esta lista, con firma.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Funciones que se llaman SIN JWT de usuario: verify_jwt tiene que ser false. */
export const SIN_JWT = ['ingest-ndf', 'club-pase']

/**
 * Lee el texto de config.toml con LISTA BLANCA → { verify: {slug: true|false|undefined}, secciones: string[], ajenas: string[] }.
 * Solo se acepta: arriba de todo `project_id = "…"`; tablas `[functions.<slug>]`; dentro de cada una, solo `verify_jwt = true|false`.
 * Cualquier otra cosa (otra clave o tabla, claves con puntos o comillas como `remotes.x.project_id = …`, tablas en línea,
 * `[[…]]`, `entrypoint`, `enabled`, `import_map`, líneas que no se entienden) va a `ajenas` y hace caer la guarda.
 */
export function leerConfig(texto) {
  const verify = {}
  const secciones = []
  const ajenas = []
  let actual = null      // slug de la [functions.x] en curso
  let arriba = true      // todavía no apareció ninguna tabla
  texto.split('\n').forEach((linea, i) => {
    const l = linea.replace(/#.*/, '').trim()
    if (!l) return
    const n = i + 1
    const sec = /^\[\s*([^\[\]]+?)\s*\]$/.exec(l)
    if (sec) {
      arriba = false
      secciones.push(sec[1])
      const fn = /^functions\.([a-z0-9][a-z0-9_-]*)$/.exec(sec[1])
      actual = fn ? fn[1] : null
      if (actual) {
        if (actual in verify) ajenas.push(`línea ${n}: [functions.${actual}] repetida`)
        verify[actual] = undefined
      } else ajenas.push(`línea ${n}: tabla [${sec[1]}] no permitida (solo [functions.<slug>])`)
      return
    }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(l)
    if (!kv) { ajenas.push(`línea ${n}: «${l.slice(0, 60)}» no permitida (solo project_id arriba y verify_jwt en [functions.<slug>])`); return }
    const [, clave, valor] = kv
    if (arriba) {
      if (clave === 'project_id' && /^"[A-Za-z0-9_-]+"$/.test(valor)) return
      ajenas.push(`línea ${n}: clave «${clave}» no permitida arriba (solo project_id = "<nombre>")`)
      return
    }
    if (actual && clave === 'verify_jwt' && /^(true|false)$/.test(valor)) {
      if (typeof verify[actual] === 'boolean') ajenas.push(`línea ${n}: verify_jwt repetido en [functions.${actual}]`)
      verify[actual] = valor === 'true'
      return
    }
    ajenas.push(`línea ${n}: clave «${clave}»${actual ? ` en [functions.${actual}]` : ''} no permitida (solo verify_jwt = true|false)`)
  })
  return { verify, secciones, ajenas }
}

/** Carpetas de función bajo `dir` (sin `_compartido`, `_shared`, ocultas). */
export function carpetasDeFunciones(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => !f.startsWith('_') && !f.startsWith('.') && statSync(join(dir, f)).isDirectory()).sort()
}

/** Problemas de la configuración (vacío = ok). `config` = leerConfig(...), `carpetas` = carpetasDeFunciones(...). */
export function problemasConfig(config, carpetas) {
  const p = []
  const { verify, secciones, ajenas = [] } = config
  for (const a of ajenas) p.push(`supabase/config.toml, ${a}`)
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
