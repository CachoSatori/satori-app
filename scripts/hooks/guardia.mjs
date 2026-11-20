#!/usr/bin/env node
// PreToolUse de Bash y de las herramientas MCP de SQL (ver .claude/settings.json y scripts/hooks/README.md).
// Frena con exit 2 (el motivo va a stderr, que lo lee el modelo):
//   · leer .env* por Bash;
//   · escribir por Bash las marcas que habilitan (sha firmado, OK de la noche, turno de prod);
//   · git push a main o con --force / -f / +refspec;
//   · merge de PR fuera de la regla D1 (hora CR) o con una cabeza que no es el SHA firmado (PR solo de .md: exento del SHA);
//   · SQL con drop / delete / truncate fuera de begin … rollback; SQL a prod sin turno de prod; ref no literal;
//   · DELETE por PostgREST (curl -X DELETE a <ref>.supabase.co/rest/v1);
//   · herramientas MCP de Supabase: contra prod, leer pasa y escribir (SQL de escritura, DDL, migración, deploy,
//     secretos, ramas) pide el turno de prod;
//   · con SATORI_ENTORNO=staging-agentes: toda herramienta MCP de Supabase o SQL por Bash fuera del ref de staging, y
//     todo merge de PR (el push a main ya está frenado siempre).
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { comandos, programa } from './shell.mjs'
import { subcomandoGit, evaluarPush, detectarMerge, valorOpcion, REPO } from './git.mjs'
import { evaluarSQL, esSoloLectura, refsEn, refLiteral, REF_PROD, REF_STAGING } from './sql.mjs'
import { relojCR, ventanaD1, ahora as relojHooks } from './hora.mjs'
import { leerMarca, okNocheValido, turnoProdValido, shasFirmados, shaFirmadoCoincide, migracionesFirmadas, escribeProtegido, MARCAS } from './marcas.mjs'

/**
 * @typedef {{ numero: number, cabeza: string, archivos: string[], titulo?: string } | { error: string }} InfoPR
 * @typedef {{
 *   raiz: string, cwd: string, env: Record<string, string | undefined>, ahora: Date,
 *   ramaActual: (dir: string) => string,
 *   consultarPR: (selector: string | null, repo: string, cwd: string) => InfoPR,
 *   leerArchivo: (ruta: string) => string | null,
 * }} Contexto
 */

// Una RUTA a un .env* (no un patrón de búsqueda ni código): `.env`, `club-web/.env.local`, `.env*`. `.env.example` sí se lee.
const RE_ENV = /^(?:[\w@.~${}-]*\/)*\.env(?:\.[\w.-]+)?\*?$/
const RE_ENV_PERMITIDO = /\.env\.example$/
const SOLO_MIRA = new Set(['ls', 'test', '[', '[[', 'stat'])
// Programas cuyo primer argumento posicional es un patrón o un programa, no un archivo (salvo -e / -f / --regexp).
const PRIMERO_ES_PATRON = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'sed', 'awk', 'gawk'])

/** Argumentos que son rutas de archivo (para la regla de .env). */
export function rutasDeArchivo(prog, args) {
  const salida = []
  let saltarPatron = PRIMERO_ES_PATRON.has(prog) && !args.some(a => /^(-e|-f|--regexp|--file|--expression)(=|$)/.test(a))
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('-')) {
      const igual = a.indexOf('=')
      if (igual !== -1) salida.push(a.slice(igual + 1)) // --env-file=.env
      continue
    }
    if (saltarPatron) { saltarPatron = false; continue }
    salida.push(a)
  }
  return salida
}
const esRutaEnv = a => RE_ENV.test(a) && !RE_ENV_PERMITIDO.test(a)

/** Ventana D1 (sin red). @returns {{ ventana: 'libre' | 'con-ok' | 'urgente', reloj: ReturnType<typeof relojCR> }} */
export function ventanaMerge(ctx) {
  const reloj = relojCR(ctx.ahora)
  return { ventana: ventanaD1(reloj.minutos), reloj }
}

/**
 * Merge de un PR. D1 (20-nov): libre 23:30–15:00 · 15:00–19:00 con OK del dueño para ESE PR · 19:00–23:30 solo urgente
 * (OK con URGENTE en la cita). Además `--match-head-commit` / `sha` obligatorio, completo (40 hex) e igual a la cabeza, y la
 * cabeza tiene que ser, exacta, un SHA firmado. Un PR solo de .md no necesita SHA firmado, y de 23:30 a 15:00 tampoco OK. @returns {string | null}
 */
export function evaluarMerge(merge, ctx) {
  const v = ventanaMerge(ctx)
  const info = ctx.consultarPR(merge.selector, merge.repo, ctx.cwd)
  if ('error' in info) return `No pude leer el PR para verificar la cabeza (${info.error}). Sin verificar no se mergea.`
  if (v.ventana !== 'libre') {
    const urgente = v.ventana === 'urgente'
    const ok = okNocheValido(leerMarca('noche', ctx), v.reloj.fecha, info.numero, { urgente })
    if (!ok.ok) {
      const tramo = urgente ? 'de 19:00 a 23:30 solo se mergea si es URGENTE y con OK del dueño (URGENTE dentro de la cita)' : 'de 15:00 a 19:00 el merge necesita el OK del dueño en el momento'
      return `Regla D1 (hora CR ${v.reloj.hhmm}): ${tramo} para el #${info.numero}: ${ok.motivo}. Formato en scripts/hooks/README.md (${MARCAS.noche.archivo} o ${MARCAS.noche.variable}).`
    }
  }
  const cabeza = String(info.cabeza).toLowerCase()
  const pedida = String(merge.cabezaPedida ?? '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(pedida)) return `Falta fijar la cabeza completa: gh pr merge ${info.numero} --match-head-commit <sha firmado, 40 hex> (o el campo sha en la API). Así GitHub no mergea otro commit.`
  if (cabeza !== pedida) return `--match-head-commit ${pedida.slice(0, 8)} no es la cabeza del PR #${info.numero} (${cabeza.slice(0, 8)}).`
  if (info.archivos.length > 0 && info.archivos.every(a => a.toLowerCase().endsWith('.md'))) return null
  const firmados = shasFirmados(leerMarca('sha', ctx))
  if (!shaFirmadoCoincide(firmados, info.numero, cabeza)) {
    return `La cabeza del PR #${info.numero} (${cabeza.slice(0, 8)}) no es un SHA firmado por el dueño. Anotá «#${info.numero} <sha completo de 40 hex>» en ${MARCAS.sha.archivo} o en ${MARCAS.sha.variable} (ver scripts/hooks/README.md).`
  }
  return null
}

/** Sesión de agentes de staging (SATORI_ENTORNO=staging-agentes): solo staging, sin merges ni push a main. */
export const esStagingAgentes = ctx => ctx.env.SATORI_ENTORNO === 'staging-agentes'

/** Escritura contra prod: pide el turno de prod (regla 13). @returns {string | null} */
function exigirTurnoProd(ctx, origen, que) {
  const t = turnoProdValido(leerMarca('prod', ctx), relojCR(ctx.ahora).fecha)
  if (t.ok) return null
  return `${origen} contra PROD (${que}): ${t.motivo}. Leer prod no lo pide; escribir sí. Regla 13: una sola sesión toca prod a la vez (${MARCAS.prod.archivo} o ${MARCAS.prod.variable}; ver scripts/hooks/README.md).`
}

/**
 * SQL hacia un ref. `sql` null = no se pudo leer (se trata como escritura).
 * @returns {string | null}
 */
export function evaluarSQLaRef(sql, refs, ctx, origen) {
  const lectura = sql !== null && esSoloLectura(sql)
  if (refs.length === 0) refs = ['(sin ref)']
  for (const ref of refs) {
    if (esStagingAgentes(ctx) && ref !== REF_STAGING) return `${origen}: SATORI_ENTORNO=staging-agentes solo permite el ref de staging (${REF_STAGING}), no «${ref}».`
    // Sin ref literal no se sabe si es prod (regla 7): leer pasa (leer prod no pide turno); escribir, no.
    if (!refLiteral(ref) && !lectura) return `${origen}: el ref «${ref}» no es literal y el SQL escribe (o no se puede leer); escribí el ref (regla 7: confirmar el ref antes de cualquier comando de base).`
  }
  if (refs.includes(REF_PROD) && !lectura) {
    const m = exigirTurnoProd(ctx, origen, sql === null ? 'SQL que no pude leer' : 'escritura o DDL')
    if (m) return m
  }
  if (sql === null) return null
  const m = evaluarSQL(sql)
  if (!m) return null
  if (migracionFirmada(sql, ctx)) return null
  return `${origen}: ${m}. Lo destructivo va dentro de begin … rollback (prueba), o es una migración firmada (sha256 del .sql en ${MARCAS.migracion.archivo}; ver scripts/hooks/README.md).`
}

/** ¿Este SQL es, tal cual, una migración firmada (sha256 del .sql)? Tolera solo el salto de línea final. */
export function migracionFirmada(sql, ctx) {
  const firmadas = migracionesFirmadas(leerMarca('migracion', ctx))
  if (firmadas.size === 0) return false
  const sha = t => createHash('sha256').update(t, 'utf8').digest('hex')
  return [sql, sql.replace(/\s+$/, '') + '\n', sql.replace(/\s+$/, '')].some(t => firmadas.has(sha(t)))
}

/**
 * ¿psql va a una base remota? Sí si nombra Supabase, usa una URL de conexión, una variable (no se sabe a dónde va) o un
 * host que no es local. Solo `psql` a localhost / socket local (baterías) queda afuera.
 */
export function psqlRemoto(args, asignaciones = []) {
  const texto = args.join(' ')
  if (/supabase\.(co|com|in)|postgres(?:ql)?:\/\/|\$/.test(texto)) return true
  // Variables de conexión delante del comando: PGHOST=…, PGSERVICE=…, DATABASE_URL=… (y cualquier PG* con URL o variable).
  for (const a of asignaciones) {
    const [nombre, ...resto] = a.split('=')
    const valor = resto.join('=')
    if (!/^(PG[A-Z]*|DATABASE_URL)$/.test(nombre)) continue
    if (/supabase\.(co|com|in)|postgres(?:ql)?:\/\/|\$/.test(valor)) return true
    if ((nombre === 'PGHOST' || nombre === 'PGHOSTADDR') && !/^(localhost|127\.0\.0\.1|::1|\/.*)$/.test(valor)) return true
    if (nombre === 'PGSERVICE' || nombre === 'DATABASE_URL') return true
  }
  const host = valorOpcion(args, ['-h', '--host']) ?? /\bhost=(\S+)/.exec(texto)?.[1]
  return host !== undefined && !/^(localhost|127\.0\.0\.1|::1|\/.*)$/.test(host)
}

/** Herramientas MCP de Supabase que solo leen (por prefijo del nombre). */
const MCP_LECTURA = /^(list_|get_|search_|generate_|query_)/

/**
 * PreToolUse de cualquier herramienta MCP de Supabase (`mcp__<servidor con supabase>__<herramienta>`).
 * @returns {string | null}
 */
export function evaluarMcpSupabase(nombre, toolInput, ctx) {
  const herramienta = nombre.split('__').pop() ?? ''
  const ref = String(toolInput?.project_id ?? '')
  const origen = `MCP ${herramienta}`
  if (esStagingAgentes(ctx) && ref !== REF_STAGING) {
    return `${origen}: SATORI_ENTORNO=staging-agentes solo permite herramientas de Supabase sobre staging (${REF_STAGING}); project_id = «${ref || 'ninguno'}».`
  }
  if (herramienta === 'execute_sql' || herramienta === 'apply_migration') {
    const sql = String(toolInput?.query ?? '')
    if (herramienta === 'apply_migration' && ref === REF_PROD) {
      const m = exigirTurnoProd(ctx, origen, 'migración')
      if (m) return m
    }
    return evaluarSQLaRef(sql, ref ? [ref] : [], ctx, origen)
  }
  if (MCP_LECTURA.test(herramienta)) return null
  // Escritura (deploy de Edge, secretos, ramas, pausa, …): contra prod, o sin project_id sobre ramas, pide el turno.
  if (ref === REF_PROD || (!ref && /branch/.test(herramienta))) return exigirTurnoProd(ctx, origen, herramienta)
  return null
}

/** Cuerpos de un curl: -d, --data…, --json; `@archivo` se lee. @returns {string[] | null} null = no se pudo leer */
function cuerposCurl(args, ctx) {
  const cuerpos = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    let valor
    const largo = /^--(data|data-raw|data-binary|data-ascii|data-urlencode|json)(?:=(.*))?$/.exec(a)
    if (largo) valor = largo[2] ?? args[++i]
    else if (a === '-d') valor = args[++i]
    else if (/^-d./.test(a)) valor = a.slice(2)
    if (valor === undefined) continue
    if (/\$(?:\{|\(|[A-Za-z_])/.test(valor)) return null // variable o comando sin expandir: no se sabe qué SQL va
    if (valor.startsWith('@')) {
      const texto = valor === '@-' ? null : ctx.leerArchivo(valor.slice(1))
      if (texto === null) return null
      valor = texto
    }
    cuerpos.push(valor)
  }
  return cuerpos
}

/** SQL dentro de un cuerpo JSON `{ "query": "…" }` o el texto tal cual. */
function sqlDeCuerpo(cuerpo) {
  try {
    const j = JSON.parse(cuerpo)
    if (j && typeof j.query === 'string') return j.query
  } catch { /* no es JSON */ }
  return cuerpo
}

const SOSPECHOSO = /\b(drop|delete|truncate)\b/i

// ---- Marcas y .claude/ por Bash: barrera blanda (el lector no expande variables ni decodifica nada). -----------------
// Si el comando nombra una marca, `settings.local.json` o una carpeta `.claude`, solo pasan lecturas evidentes; además,
// nunca pasa código que llega a un intérprete por un tubo (`… | bash`, `base64 -d | sh`) ni `bash <(…)` / `eval "$…"`.
const RE_NOMBRE_PROTEGIDO = /sha-firmado|ok-dueno-noche|turno-prod|migracion-firmada|settings\.local\.json/i
const RE_DIR_CLAUDE = /(?:^|[\s/'"=:;(&|<>`$])\.claude(?=[/\\'"\s;|&)<>`*]|$)/
const RE_MARCA_ARCHIVO = /(?:^|\/)(?:sha-firmado|ok-dueno-noche|turno-prod|migracion-firmada)\.local$/
const LECTURAS = new Set(['cat', 'jq', 'head', 'tail', 'less', 'more', 'ls', 'stat', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'diff', 'cmp',
  'sha256sum', 'sha1sum', 'md5sum', 'file', 'test', '[', '[[', 'echo', 'printf', 'true', 'pwd', 'realpath', 'readlink', 'basename', 'dirname'])
const GIT_LECTURAS = new Set(['diff', 'log', 'show', 'status', 'ls-files', 'add', 'commit', 'hash-object', 'check-ignore', 'blame', 'grep', 'rev-parse', 'cat-file'])
const RE_INTERPRETE_POR_TUBO = /\|\s*(?:sudo\s+|env\s+(?:\w+=\S*\s+)*)?(?:\S*\/)?(?:bash|sh|zsh|dash|ksh|python[\d.]*|node|perl|ruby|php)(?:\s+-[A-Za-z]+)*\s*(?=$|[|;&)\n])/
const RE_CODIGO_ILEGIBLE = /(?:^|[\s;&|(])(?:bash|sh|zsh|dash|ksh|source|\.)\s+<\(|\beval\b[^\n;|&]*\$/

/** ¿Este comando simple es una lectura evidente (o borra una marca: revoca)? */
function lecturaEvidente(s) {
  const { prog, args } = programa(s.palabras)
  if (s.redirecciones.some(r => />/.test(r.op) && r.destino !== '/dev/null')) return false
  const pos = args.filter(a => !a.startsWith('-'))
  if (LECTURAS.has(prog)) return true
  if (prog === 'git') {
    const { sub, resto } = subcomandoGit(args)
    return GIT_LECTURAS.has(sub) && !resto.some(a => a === '-o' || a.startsWith('--output'))
  }
  if (prog === 'gh') return !args.some(a => ['checkout', 'clone', 'download'].includes(a))
  if (prog === 'cd') return !pos.some(a => RE_DIR_CLAUDE.test(a) || RE_DIR_CLAUDE.test('/' + a))
  if (prog === 'cp') {
    // Solo copiar HACIA /tmp: sin -t / --target-directory (cambian cuál argumento es el destino) y sin «..».
    if (args.some(a => a === '-t' || a.startsWith('--target-directory') || /^-[a-zA-Z]*t/.test(a))) return false
    const d = pos[pos.length - 1] ?? ''
    return pos.length >= 2 && d.startsWith('/tmp/') && !d.includes('..') && !RE_NOMBRE_PROTEGIDO.test(d) && !RE_DIR_CLAUDE.test(d)
  }
  if (prog === 'rm' || prog === 'unlink') return pos.length > 0 && pos.every(a => RE_MARCA_ARCHIVO.test(a))
  return false
}

/** ¿La ruta está en una carpeta `.claude` o debajo? */
const dentroDeClaude = ruta => /(?:^|[/\\])\.claude(?:[/\\]|$)/.test(String(ruta ?? ''))

/**
 * Carpeta actual dentro de `.claude/` (el cwd persiste entre llamadas: `cd .claude` y después `cp /tmp/x .`): se niega
 * todo, salvo un `cd` que salga. @returns {string | null}
 */
export function evaluarCwdProtegido(cmd, cwd) {
  if (!dentroDeClaude(cwd)) return null
  const simples = comandos(cmd).filter(s => s.palabras.length > 0)
  const ultimo = simples[simples.length - 1]
  const soloCd = simples.length > 0 && simples.every(s => programa(s.palabras).prog === 'cd' && s.redirecciones.length === 0)
  if (soloCd) {
    const destino = programa(ultimo.palabras).args.filter(a => !a.startsWith('-'))[0]
    if (destino && !destino.includes('$') && !dentroDeClaude(resolve(cwd, destino))) return null
  }
  return `La carpeta actual (${cwd}) está dentro de .claude/: ahí no corre ningún comando. Salí primero (cd a la raíz del proyecto).`
}

/** @returns {string | null} */
export function evaluarZonaProtegida(cmd) {
  if (RE_INTERPRETE_POR_TUBO.test(cmd) || RE_CODIGO_ILEGIBLE.test(cmd)) {
    return 'No se pasa código a un intérprete por un tubo, por <(…) ni por eval de una variable (… | bash, base64 -d | sh): la guardia no lo puede leer. Escribí el comando tal cual.'
  }
  if (!RE_NOMBRE_PROTEGIDO.test(cmd) && !RE_DIR_CLAUDE.test(cmd)) return null
  const malo = comandos(cmd).find(s => s.palabras.length > 0 && !lecturaEvidente(s))
  if (!malo) return null
  return `No se escribe por Bash una marca de habilitación ni la configuración de Claude Code: un comando que nombra .claude/, una marca o settings.local.json solo puede leer (cat, jq, git diff…) o borrar una marca (rm, revoca); «${malo.palabras.slice(0, 3).join(' ')}» no es lectura. La marca la escribe la sesión principal con Write y la firma el dueño (ver scripts/hooks/README.md).`
}

/** @param {string} cmd @param {Contexto} ctx @returns {string | null} motivo del bloqueo */
export function evaluarBash(cmd, ctx) {
  const cwdMal = evaluarCwdProtegido(cmd, ctx.cwd)
  if (cwdMal) return cwdMal
  const zona = evaluarZonaProtegida(cmd)
  if (zona) return zona
  for (const s of comandos(cmd)) {
    const { prog, args } = programa(s.palabras)

    // Marcas y configuración de Claude Code: se leen, no se escriben por Bash.
    const protegido = escribeProtegido(prog, args, s.redirecciones)
    if (protegido) return `No se escribe por Bash una marca de habilitación ni la configuración de Claude Code (${protegido}). La pone el dueño o su sesión, con su OK (ver scripts/hooks/README.md).`

    // .env*: no se lee.
    if (!SOLO_MIRA.has(prog)) {
      const env = [...rutasDeArchivo(prog, args), ...s.redirecciones.filter(r => r.op.startsWith('<') && r.op !== '<<<').map(r => r.destino)]
        .find(esRutaEnv)
      if (env) return `No se leen archivos .env* (${env}): tienen secretos. Si hace falta un valor, pedíselo al dueño por su sesión.`
    }

    // supabase db push / functions deploy (también por npx): las migraciones entran por merge → Branching (regla 1) y
    // las Edge solo con firma (regla 2); los corre el dueño desde su terminal.
    const sb = prog === 'supabase' ? args : (prog === 'npx' || prog === 'bunx' || prog === 'pnpm') ? args.slice(args.findIndex(a => /^supabase(@.*)?$/.test(a)) + 1 || args.length) : null
    if (sb) {
      const t = ' ' + sb.filter(a => !a.startsWith('-')).join(' ') + ' '
      if (/ db push /.test(t)) return 'Bloqueado: supabase db push (las migraciones entran por merge → Branching, regla 1).'
      if (/ db reset /.test(t) && sb.some(a => a === '--linked' || a.startsWith('--db-url'))) return 'Bloqueado: supabase db reset contra una base remota (--linked / --db-url).'
      if (/ functions deploy /.test(t)) return 'Bloqueado: supabase functions deploy (Edge solo con firma del dueño, regla 2; lo corre el dueño).'
    }

    if (prog === 'git') {
      const { sub, resto, dir } = subcomandoGit(args)
      if (sub === 'reset' && resto.includes('--hard')) return 'Bloqueado: git reset --hard (puede pisar .claude/ y los cambios sin commitear). Usá git switch / git restore sobre archivos puntuales.'
      if (sub === 'push') {
        const base = dir ? resolve(ctx.cwd, dir) : ctx.cwd
        const m = evaluarPush(resto, () => ctx.ramaActual(base))
        if (m) return `Bloqueado: ${m}.`
      }
    }

    const merge = detectarMerge(prog, args)
    if (merge && 'bloquear' in merge) return `Bloqueado: ${merge.bloquear}.`
    if (merge && esStagingAgentes(ctx)) return 'Bloqueado: SATORI_ENTORNO=staging-agentes no mergea PRs (lo hace la sesión del dueño con su OK).'
    if (merge) {
      const m = evaluarMerge(merge, ctx)
      if (m) return m
    }

    if (prog === 'curl') {
      const urls = args.filter(a => /supabase\.(co|in|com)/.test(a))
      const texto = urls.join(' ')
      const metodo = (valorOpcion(args, ['-X', '--request']) ?? '').toUpperCase()
      if (/\.supabase\.(co|in)\/rest\/v1\//.test(texto) && metodo === 'DELETE') {
        return 'Bloqueado: DELETE por PostgREST. Lo destructivo va por migración con firma o dentro de begin … rollback.'
      }
      if (/api\.supabase\.com\/v1\/projects\/[^\s]*\/database\/query/.test(texto)) {
        const cuerpos = cuerposCurl(args, ctx)
        let sql = null
        if (cuerpos === null || cuerpos.length === 0) {
          const crudo = cmd + '\n' + (s.stdin ?? '')
          if (s.stdin) sql = sqlDeCuerpo(s.stdin)
          else if (SOSPECHOSO.test(crudo)) return 'Management API: no pude leer el SQL del cuerpo (variable o stdin) y el comando menciona drop/delete/truncate. Pasalo literal o con -d @archivo.json.'
        } else sql = cuerpos.map(sqlDeCuerpo).join(';\n')
        const m = evaluarSQLaRef(sql, refsEn(texto), ctx, 'Management API')
        if (m) return m
      }
    }

    if (prog === 'psql') {
      const asignaciones = s.palabras.slice(0, s.palabras.findIndex(p => p.split('/').pop() === 'psql')).filter(p => /^[A-Za-z_][A-Za-z0-9_]*=/.test(p))
      const texto = [...asignaciones, ...args].join(' ')
      const refs = refsEn(texto)
      if (psqlRemoto(args, asignaciones)) {
        if (refs.length === 0) refs.push(/\$/.test(texto) ? '(variable)' : '(host sin ref)')
        const partes = []
        const c = valorOpcion(args, ['-c', '--command'])
        if (c !== undefined) partes.push(c)
        const f = valorOpcion(args, ['-f', '--file'])
        if (f !== undefined) {
          const t = ctx.leerArchivo(f)
          if (t === null) return `psql: no pude leer ${f} para revisar el SQL.`
          partes.push(t)
        }
        if (s.stdin) partes.push(s.stdin)
        const m = evaluarSQLaRef(partes.join(';\n'), refs, ctx, 'psql')
        if (m) return m
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------- CLI

function ramaActualGit(dir) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

function ghJson(args) {
  const r = spawnSync('gh', ['api', ...args], { encoding: 'utf8', timeout: 15_000 })
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'gh api falló').trim().split('\n')[0])
  return JSON.parse(r.stdout)
}

/** Resuelve el PR por REST (GraphQL no anda desde las sesiones). */
export function consultarPRgh(selector, repo, cwd) {
  try {
    let numero = null
    if (selector && /^\d+$/.test(selector)) numero = Number(selector)
    else if (selector && /\/pull\/(\d+)/.test(selector)) {
      const m = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(selector)
      if (m) { repo = m[1]; numero = Number(m[2]) }
    }
    if (numero === null) {
      const rama = selector ?? ramaActualGit(cwd)
      const dueno = repo.split('/')[0]
      const lista = ghJson([`repos/${repo}/pulls?head=${dueno}:${encodeURIComponent(rama)}&state=open`])
      if (!Array.isArray(lista) || lista.length !== 1) return { error: `no encontré un único PR abierto para la rama «${rama}»` }
      numero = lista[0].number
    }
    const pr = ghJson([`repos/${repo}/pulls/${numero}`])
    const archivos = ghJson(['--paginate', `repos/${repo}/pulls/${numero}/files?per_page=100`, '--jq', '[.[].filename]'])
    return { numero, cabeza: pr.head.sha, archivos: Array.isArray(archivos) ? archivos : [], titulo: String(pr.title ?? '') }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function leerStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}') } catch { return {} }
}

export function main() {
  const entrada = leerStdin()
  const env = process.env
  const cwd = entrada.cwd || process.cwd()
  const raiz = env.CLAUDE_PROJECT_DIR || cwd
  /** @type {Contexto} */
  const ctx = {
    raiz, cwd, env, ahora: relojHooks(env),
    ramaActual: ramaActualGit,
    consultarPR: consultarPRgh,
    leerArchivo: ruta => { try { return readFileSync(isAbsolute(ruta) ? ruta : resolve(cwd, ruta), 'utf8') } catch { return null } },
  }
  const herramienta = String(entrada.tool_name ?? '')
  let motivo = null
  try {
    if (herramienta === 'Bash') motivo = evaluarBash(String(entrada.tool_input?.command ?? ''), ctx)
    else if (/^mcp__.*supabase.*__/i.test(herramienta)) motivo = evaluarMcpSupabase(herramienta, entrada.tool_input, ctx)
  } catch (e) {
    const cmd = JSON.stringify(entrada.tool_input ?? {})
    if (/push|merge|supabase|psql|\.env|drop|delete|truncate/i.test(cmd + herramienta)) {
      motivo = `La guardia no pudo analizar el comando (${e instanceof Error ? e.message : e}) y toca algo sensible: no pasa. Simplificalo.`
    }
  }
  if (motivo) {
    process.stderr.write(`[satori guardia] ${motivo}\n`)
    process.exit(2)
  }
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
export { REPO }
