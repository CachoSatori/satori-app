#!/usr/bin/env node
// PreToolUse de Edit|Write|MultiEdit|NotebookEdit: la firma del dueño como marca (opción A, decisión del dueño del 20-nov).
//
// El dueño firma desde la app de Claude, no desde una terminal: la sesión principal (coordinador) escribe la marca con
// Write y Claude Code le muestra al dueño un pedido de permiso; su «Aprobar» es la firma. Lo que fuerza el pedido aunque
// la sesión esté en modo automático es la regla `permissions.ask` `Edit(/.claude/*.local)` de .claude/settings.json
// (una regla ask explícita se resuelve antes del clasificador). Este hook se asegura de que la regla aplique y de que el
// dueño vea en claro qué firma:
//   · subagente (`agent_id` en la entrada) → deny: un subagente no puede mostrarle un pedido al dueño ni firmar por él;
//   · marca fuera de <raíz>/.claude/ (otra carpeta, un worktree) → deny: ahí la regla ask no aplica y la guardia no la lee;
//   · Edit / MultiEdit / NotebookEdit de una marca → deny: la marca se escribe entera con Write, así se ve todo lo que firma;
//   · contenido que no se entiende, SHA que no es la cabeza actual del PR, fecha que no es hoy (CR) → deny;
//   · si todo está bien → «ask» con `updatedInput`: el archivo lleva, antes de cada línea, un comentario «# Aprobar = …»
//     en lenguaje claro, que es lo que el dueño ve en el pedido. Los comentarios no cuentan para la guardia.
// Cualquier otro archivo pasa sin tocar (exit 0, sin salida). Formato de las marcas: scripts/hooks/README.md.
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MARCAS, parsearOkNoche, turnoProdValido } from './marcas.mjs'
import { relojCR, ahora as relojHooks } from './hora.mjs'
import { consultarPRgh, REPO } from './guardia.mjs'

/** Nombre del archivo → clave de la marca (`sha`, `noche`, `prod`, `migracion`). */
const POR_NOMBRE = Object.fromEntries(Object.entries(MARCAS).map(([clave, m]) => [basename(m.archivo), clave]))

/** Comentario generado por este hook (o cualquier línea `# …`): se descarta y se vuelve a escribir. */
const RE_COMENTARIO = /^\s*#(\s|$)/

/** ¿Esta ruta es una marca? @returns {string | null} la clave */
export function claveDeMarca(ruta) {
  if (typeof ruta !== 'string' || ruta === '') return null
  return POR_NOMBRE[basename(ruta.replace(/\\/g, '/'))] ?? null
}

const corto = sha => sha.slice(0, 8)

/**
 * Título del PR para el texto del pedido: lo escribe el autor del PR, así que se limpia (controles, saltos, marcas de
 * dirección U+200E/F, U+202A–202E, U+2066–2069, comillas «») y se corta a 80 caracteres.
 */
export function limpiarTitulo(t) {
  const s = String(t ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069«»]/g, ' ').replace(/\s+/g, ' ').trim()
  const letras = [...s]
  return letras.length > 80 ? letras.slice(0, 79).join('') + '…' : s
}

/**
 * Lee las líneas de una marca y arma el texto «Aprobar = …» de cada una.
 * @returns {{ ok: true, lineas: { dato: string, aprobar: string }[] } | { ok: false, motivo: string }}
 */
export function leerFirmas(clave, contenido, ctx) {
  const datos = String(contenido ?? '').split(/\r?\n/).map(l => l.trim()).filter(l => l !== '' && !RE_COMENTARIO.test(l))
  const { fecha } = relojCR(ctx.ahora)
  const lineas = []
  for (const dato of datos) {
    if (clave === 'sha') {
      const m = /^#(\d+)\s+([0-9a-f]{40})$/i.exec(dato)
      if (!m) return { ok: false, motivo: `«${dato}» no es «#<PR> <sha completo>» (40 hex, la cabeza que da GitHub, con el número del PR: un SHA sin PR valdría para cualquiera)` }
      const pr = Number(m[1])
      const sha = m[2].toLowerCase()
      const info = ctx.consultarPR(String(pr), REPO, ctx.raiz)
      // Falla cerrada: sin la cabeza leída por REST no se le pide al dueño que firme nada.
      if (!info || 'error' in info) return { ok: false, motivo: `no pude leer el PR #${pr} en GitHub (${info?.error ?? 'sin respuesta'}): sin verificar la cabeza no se firma` }
      const cabeza = String(info.cabeza).toLowerCase()
      if (cabeza !== sha) return { ok: false, motivo: `${corto(sha)} no es la cabeza actual del PR #${pr} (${corto(cabeza)}): el dueño firmaría un commit que no se mergea` }
      const titulo = limpiarTitulo(info.titulo)
      const detalle = titulo ? ` (título que puso el autor del PR: «${titulo}»)` : ''
      lineas.push({ dato: `#${pr} ${sha}`, aprobar: `autorizo mergear el PR #${pr}${detalle} solo con el commit ${corto(sha)}. Si el PR cambia, la firma deja de valer.` })
    } else if (clave === 'noche') {
      const p = parsearOkNoche(dato)
      if (!p) return { ok: false, motivo: `«${dato}» no es «AAAA-MM-DD #N «cita del dueño»» (un solo #N en la línea, cita de 8+ caracteres)` }
      if (p.fecha !== fecha) return { ok: false, motivo: `«${dato}» no tiene la fecha CR de hoy (${fecha})` }
      const urgente = /\bURGENTE\b/.test(p.cita)
      const tramo = urgente ? 'de 15:00 a 23:30 (es URGENTE: vale también de 19:00 a 23:30)' : 'de 15:00 a 19:00'
      lineas.push({ dato, aprobar: `autorizo mergear el PR #${p.pr} hoy ${fecha}, ${tramo}, hora CR. Vence a medianoche.` })
    } else if (clave === 'prod') {
      if (!turnoProdValido(dato, fecha).ok) return { ok: false, motivo: `«${dato}» no tiene «TURNO DE PROD» con la fecha de hoy (${fecha})` }
      lineas.push({ dato, aprobar: `esta sesión de CC puede escribir en la base de PRODUCCIÓN hoy ${fecha} (regla 13). Vence a medianoche.` })
    } else {
      const m = /^([0-9a-f]{64})(?:\s+(\S.*))?$/i.exec(dato)
      if (!m) return { ok: false, motivo: `«${dato}» no es «<sha256 del .sql> [nombre]» (64 hex)` }
      const sha = m[1].toLowerCase()
      const archivo = ctx.buscarMigracion(sha)
      const nombre = archivo ?? m[2] ?? null
      const donde = archivo ? `la migración ${archivo}` : nombre ? `la migración «${nombre}» (no la encontré con ese sha256 en supabase/migrations de esta copia: revisá que sea ese archivo)` : 'un SQL sin nombre (no lo encontré en supabase/migrations)'
      lineas.push({ dato: `${sha}${nombre ? ` ${nombre}` : ''}`, aprobar: `autorizo aplicar a mano ${donde}, sha256 ${corto(sha)}…, con sus drop/delete, tal cual ese texto. No da turno de prod.` })
    }
  }
  return { ok: true, lineas }
}

/**
 * Decide sobre una llamada de Edit/Write/MultiEdit/NotebookEdit.
 * @returns {{ decision: 'pasa' } | { decision: 'deny', motivo: string } | { decision: 'ask', motivo: string, updatedInput: Record<string, unknown> }}
 */
export function evaluarFirma(entrada, ctx) {
  const herramienta = String(entrada.tool_name ?? '')
  const input = entrada.tool_input ?? {}
  const ruta = input.file_path ?? input.notebook_path ?? input.path
  const clave = claveDeMarca(ruta)
  if (!clave) return { decision: 'pasa' }
  const archivo = MARCAS[clave].archivo
  if (entrada.agent_id) {
    return { decision: 'deny', motivo: `Un subagente no firma por el dueño (${archivo}): no puede mostrarle el pedido de permiso. La marca la escribe la sesión principal y la aprueba el dueño en la app.` }
  }
  if (herramienta !== 'Write') {
    return { decision: 'deny', motivo: `La marca ${archivo} se escribe entera con Write (no con ${herramienta || 'otra herramienta'}), para que el dueño vea todo lo que aprueba. Para revocar, borrala (rm) o escribila vacía.` }
  }
  const esperada = resolve(ctx.raiz, archivo)
  const pedida = isAbsolute(ruta) ? resolve(ruta) : resolve(entrada.cwd || ctx.raiz, ruta)
  if (pedida !== esperada) {
    return { decision: 'deny', motivo: `La marca va en ${esperada} (la raíz del proyecto de esta sesión), no en ${pedida}: solo ahí la lee la guardia y solo ahí la regla de permisos le pide la firma al dueño.` }
  }
  const r = leerFirmas(clave, input.content, ctx)
  if (!r.ok) return { decision: 'deny', motivo: `Firma no válida en ${archivo}: ${r.motivo}. Formato en scripts/hooks/README.md.` }
  const contenido = r.lineas.length === 0
    ? '# Aprobar = borro todas estas firmas (revoca).\n'
    : r.lineas.map(l => `# Aprobar = ${l.aprobar}\n${l.dato}\n`).join('')
  const resumen = r.lineas.length === 0 ? 'borrar todas estas firmas (revoca)' : r.lineas.map(l => l.aprobar).join(' · ')
  return {
    decision: 'ask',
    motivo: `FIRMA DEL DUEÑO (${archivo}). Al tocar Aprobar: ${resumen}`,
    updatedInput: { ...input, content: contenido },
  }
}

// ---------------------------------------------------------------------------------------------------------------- CLI

/** sha256 de cada .sql de supabase/migrations: busca el archivo firmado. */
function buscadorMigraciones(raiz) {
  let mapa = null
  return sha => {
    if (mapa === null) {
      mapa = new Map()
      const dir = join(raiz, 'supabase', 'migrations')
      try {
        for (const n of readdirSync(dir)) {
          if (!n.endsWith('.sql')) continue
          try {
            const t = readFileSync(join(dir, n), 'utf8')
            for (const v of [t, t.replace(/\s+$/, '') + '\n', t.replace(/\s+$/, '')]) mapa.set(createHash('sha256').update(v, 'utf8').digest('hex'), n)
          } catch { /* ilegible: no cuenta */ }
        }
      } catch { /* sin carpeta */ }
    }
    return mapa.get(sha) ?? null
  }
}

export function main() {
  let entrada = {}
  try { entrada = JSON.parse(readFileSync(0, 'utf8') || '{}') } catch { /* entrada rara: ver abajo */ }
  const env = process.env
  const raiz = env.CLAUDE_PROJECT_DIR || entrada.cwd || process.cwd()
  let r
  try {
    r = evaluarFirma(entrada, { raiz, ahora: relojHooks(env), consultarPR: consultarPRgh, buscarMigracion: buscadorMigraciones(raiz) })
  } catch (e) {
    const ruta = entrada.tool_input?.file_path ?? entrada.tool_input?.notebook_path ?? ''
    if (!claveDeMarca(ruta)) process.exit(0)
    r = { decision: 'deny', motivo: `El hook de la firma no pudo revisar la marca (${e instanceof Error ? e.message : e}): no pasa.` }
  }
  if (r.decision === 'deny') {
    process.stderr.write(`[satori firma] ${r.motivo}\n`)
    process.exit(2)
  }
  if (r.decision === 'ask') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: r.motivo, updatedInput: r.updatedInput },
    }))
  }
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
