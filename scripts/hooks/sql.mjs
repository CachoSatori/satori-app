// Guardia de SQL para los hooks: frena `drop`, `delete` y `truncate` fuera de un `begin … rollback`, y pide el turno
// de prod (regla 13) para cualquier SQL contra el ref de prod. La usan el PreToolUse de Bash (curl a la Management
// API, psql a un host de Supabase, borrado por PostgREST) y el de las herramientas MCP `execute_sql` / `apply_migration`.

// Refs de Supabase (ESTADO.md, tabla de punteros). Este archivo es una herramienta, no una prueba: acá sí va el ref
// como candado (src/refProdEnPruebas.test.ts prohíbe escribirlo en archivos de prueba; las pruebas lo importan de acá).
export const REF_PROD = 'yiczgdtirrkdvohdquzf'
export const REF_STAGING = 'hwiatgicyyqyezqwldia'

/** Parte el SQL en sentencias respetando comentarios, strings y dollar quotes. @returns {string[]} */
export function sentencias(sql) {
  const out = []
  let actual = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    if (c === '-' && sql[i + 1] === '-') { const f = sql.indexOf('\n', i); i = f === -1 ? n : f; actual += ' '; continue }
    if (c === '/' && sql[i + 1] === '*') {
      let prof = 1
      let j = i + 2
      while (j < n && prof > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { prof++; j += 2 } else if (sql[j] === '*' && sql[j + 1] === '/') { prof--; j += 2 } else j++
      }
      i = j
      actual += ' '
      continue
    }
    if (c === "'") {
      let j = i + 1
      const conBarra = /[eE]$/.test(actual)
      while (j < n) {
        if (conBarra && sql[j] === '\\') { j += 2; continue }
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue } break }
        j++
      }
      actual += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (c === '"') {
      const f = sql.indexOf('"', i + 1)
      const hasta = f === -1 ? n : f
      actual += sql.slice(i, hasta + 1)
      i = hasta + 1
      continue
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (m) {
        const fin = sql.indexOf(m[0], i + m[0].length)
        const hasta = fin === -1 ? n : fin + m[0].length
        actual += sql.slice(i, hasta)
        i = hasta
        continue
      }
    }
    if (c === ';') { if (actual.trim()) out.push(actual.trim()); actual = ''; i++; continue }
    actual += c
    i++
  }
  if (actual.trim()) out.push(actual.trim())
  return out
}

/** Saca strings, identificadores entre comillas y cuerpos `$$…$$`; con `cuerpos`, devuelve aparte los cuerpos. */
function limpiar(stmt) {
  const cuerpos = []
  const sinDollar = stmt.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$([\s\S]*?)\$\1\$/g, (_m, _t, cuerpo) => { cuerpos.push(cuerpo); return ' $cuerpo$ ' })
  const texto = sinDollar
    .replace(/[eE]?'(?:''|\\'|[^'])*'/g, " '' ")
    .replace(/"[^"]*"/g, ' "id" ')
    .toLowerCase()
  return { texto, cuerpos }
}

const SIN_PELIGRO = /\b(?:on|for|or|before|after|of)\s+delete\b/g

/** ¿La sentencia (ya limpia) borra o tira algo? */
function destructivaTexto(texto) {
  const primera = /^\s*(\w+)/.exec(texto)?.[1] ?? ''
  if (['grant', 'revoke', 'comment'].includes(primera)) return null
  const m = /\b(drop|delete|truncate)\b/.exec(texto.replace(SIN_PELIGRO, ' '))
  return m ? m[1] : null
}

/** @returns {string | null} la palabra destructiva, mirando también el cuerpo de un `do $$ … $$` (que corre ya). */
export function destructiva(stmt) {
  const { texto, cuerpos } = limpiar(stmt)
  const propia = destructivaTexto(texto)
  if (propia) return propia
  if (/^\s*do\b/.test(texto)) {
    for (const cuerpo of cuerpos) {
      for (const s of sentencias(cuerpo)) {
        const d = destructivaTexto(limpiar(s).texto)
        if (d) return d
      }
    }
  }
  return null
}

function tipoTransaccion(stmt) {
  const t = limpiar(stmt).texto.trim()
  if (/^(begin|start\s+transaction)\b/.test(t)) return 'begin'
  if (/^(rollback|abort)\b/.test(t) && !/^rollback\s+(?:work\s+|transaction\s+)?to\b/.test(t) && !/^rollback\s+prepared\b/.test(t)) return 'rollback'
  if (/^(commit|end)\b/.test(t) || /^prepare\s+transaction\b/.test(t)) return 'commit'
  return null
}

/**
 * @param {string} sql
 * @returns {string | null} motivo del bloqueo, o null si pasa.
 */
export function evaluarSQL(sql) {
  let enTx = false
  /** @type {string[]} */
  let pendientes = []
  for (const s of sentencias(sql)) {
    const tipo = tipoTransaccion(s)
    if (tipo === 'begin') { if (!enTx) { enTx = true; pendientes = [] } continue }
    if (tipo === 'rollback') { enTx = false; pendientes = []; continue }
    if (tipo === 'commit') {
      if (enTx && pendientes.length) return `«${pendientes[0]}» dentro de una transacción que termina en COMMIT`
      enTx = false
      pendientes = []
      continue
    }
    const d = destructiva(s)
    if (!d) continue
    const corto = s.replace(/\s+/g, ' ').slice(0, 80)
    if (!enTx) return `«${d}» fuera de begin … rollback: ${corto}`
    pendientes.push(corto)
  }
  if (enTx && pendientes.length) return `«${pendientes[0]}» en una transacción que no termina en ROLLBACK`
  return null
}

const LECTURA_INICIO = new Set(['select', 'with', 'show', 'explain', 'values', 'table'])
// Funciones que escriben o cambian estado aunque vayan dentro de un SELECT.
const ESCRIBE = /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|vacuum|refresh|reindex|cluster|lock|security|import|load|notify|analyze)\b|\b(?:cron\.(?:schedule|unschedule|alter_job)|pg_terminate_backend|pg_cancel_backend|set_config|setval|nextval|lo_import|lo_unlink|dblink_exec|net\.http_\w+|pg_reload_conf|pg_notify)\s*\(/
const FUNC_ESCRITURA = /\b(?:cron\.(?:schedule|unschedule|alter_job)|pg_terminate_backend|pg_cancel_backend|set_config|setval|nextval|lo_import|lo_unlink|dblink_exec|net\.http_\w+|pg_reload_conf|pg_notify)\s*\(/

/**
 * ¿El SQL solo lee? Cada sentencia es un SELECT / WITH / SHOW / EXPLAIN (sin ANALYZE) / VALUES / TABLE sin palabras ni
 * funciones que escriban, o control de transacción (`begin`, `rollback`, `commit`, `set` de sesión). Ante la duda: no.
 */
export function esSoloLectura(sql) {
  const lista = sentencias(sql)
  if (lista.length === 0) return true
  for (const s of lista) {
    const crudo = s.toLowerCase()
    const { texto } = limpiar(s)
    const t = texto.trim()
    if (tipoTransaccion(s)) continue
    if (/^set\s+(local\s+)?(role|statement_timeout|search_path|transaction\s+read\s+only)\b/.test(t)) continue
    const primera = /^(\w+)/.exec(t)?.[1] ?? ''
    if (!LECTURA_INICIO.has(primera)) return false
    if (ESCRIBE.test(t.replace(/^explain\b/, ''))) return false
    // Un string no ejecuta nada, pero una función de escritura con argumentos string sí: se mira también el crudo.
    if (FUNC_ESCRITURA.test(crudo)) return false
  }
  return true
}

/** Ref de Supabase en un texto (URL de la Management API, host de la base, URL del proyecto). */
export function refsEn(texto) {
  const refs = new Set()
  for (const m of texto.matchAll(/api\.supabase\.com\/v1\/projects\/([^/\s"']+)/g)) refs.add(m[1])
  for (const m of texto.matchAll(/(?:^|[/@.\s"'])(?:db\.)?([a-z]{20})\.supabase\.(?:co|in)\b/g)) refs.add(m[1])
  for (const m of texto.matchAll(/postgres\.([a-z]{20})\b/g)) refs.add(m[1])
  return [...refs]
}

/** Ref no literal (variable, comando): no se puede confirmar a qué base va (regla 7). */
export const refLiteral = ref => /^[a-z]{20}$/.test(ref)
