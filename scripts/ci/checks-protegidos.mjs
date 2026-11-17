// Guarda de los checks propios: «un cambio no puede modificar los checks que lo juzgan».
// Si un PR toca un archivo que juzga cambios (pruebas guardianas, skills, workflows, gate, baterías de los PASE, tabla de
// hashes de los sagrados), el check lo marca y pide OK explícito del dueño (etiqueta `ok-dueno-checks`).
//
// Lo corre .github/workflows/checks-protegidos.yml con `pull_request_target`: este archivo sale SIEMPRE de la rama
// base (main), nunca del PR. No ejecuta ni lee código del PR: solo la lista de archivos cambiados (y el patch de
// ESTADO.md) por la API REST. Sin dependencias: corre con el Node del runner, sin `npm ci`.
//
// Modo (variable MODO): `observar` (por defecto) anota y no falla · `bloquear` falla si toca protegidos sin la etiqueta.
// Detalle y cómo pasar a bloquear: docs/REGLAS-checks-protegidos.md
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const ETIQUETA_OK = 'ok-dueno-checks'

/**
 * Archivos protegidos. `soloSiExiste: true` = solo cuenta si el PR modifica, borra o renombra un archivo que ya
 * existía; agregar uno nuevo (la batería de una migración nueva) no se marca: se revisa como cualquier otro archivo.
 */
export const REGLAS = [
  // Pruebas guardianas del repo entero (escaneos de privacidad, dominio, Wallet, refs de prod, fechas CR, ventas).
  { patron: 'src/*.test.ts', porque: 'pruebas guardianas del repo (privacidad, dominio, Wallet, refs de prod, hora CR, ventas)' },
  { patron: 'club-web/src/usted.test.ts', porque: 'guarda del «usted» en textos para clientes' },
  { patron: 'src/shared/wallet/usted.test.ts', porque: 'guarda del «usted» en el pase de Wallet' },
  // Pruebas de migraciones.
  { patron: 'supabase/*.test.ts', porque: 'pruebas de migraciones (numeración, registro, rollback)' },
  // Reglas que leen los agentes.
  { patron: '.claude/**', porque: 'skills y configuración de los agentes que hacen y revisan los PR' },
  { patron: 'CLAUDE.md', porque: 'convenciones del repo que leen los agentes' },
  { patron: '**/CLAUDE.md', porque: 'convenciones que leen los agentes' },
  { patron: 'docs/REGLAS-POR-INCIDENTE.md', porque: 'reglas nacidas de incidentes' },
  { patron: 'docs/REGLAS-checks-protegidos.md', porque: 'esta misma guarda' },
  // CI y gate.
  { patron: '.github/workflows/**', porque: 'workflows: el gate de CI, el deploy y esta guarda' },
  { patron: '.github/CODEOWNERS', porque: 'quién revisa qué' },
  { patron: 'scripts/ci/**', porque: 'scripts del gate (lint con línea base, esta guarda y su lista)' },
  { patron: 'vite.config.ts', porque: 'configuración de vitest (qué pruebas corren) y del build' },
  { patron: 'vitest.setup.ts', porque: 'preparación de todas las pruebas' },
  { patron: 'eslint.config.js', porque: 'reglas del lint del gate' },
  // Baterías y herramientas de los PASE.
  { patron: 'scripts/sql/mutar_bateria.py', porque: 'mutaciones de las baterías SQL' },
  { patron: 'scripts/sql/mutaciones_*.json', porque: 'mutaciones de las baterías SQL' },
  { patron: 'scripts/sql/bateria_*', porque: 'baterías compartidas de los PASE' },
  { patron: 'scripts/sql/baterias_*', porque: 'control estático de las baterías SQL' },
  { patron: 'scripts/sql/gate61*', porque: 'gate de catálogo de los PASE' },
  { patron: 'scripts/sql/local_*', porque: 'base local donde corren las baterías' },
  { patron: 'scripts/sql/*_pruebas*', porque: 'batería de un PASE ya escrita', soloSiExiste: true },
  { patron: 'scripts/sql/*_verificacion.sql', porque: 'verificación de un PASE ya escrita', soloSiExiste: true },
]

/** Glob simple a RegExp: `**` cruza carpetas, `*` no. Sin dependencias a propósito. */
export function globARegex(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      i++
      if (glob[i + 1] === '/') { i++; re += '(?:.*/)?' } else re += '.*'
    } else if (c === '*') re += '[^/]*'
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

const REGEX = REGLAS.map(r => ({ ...r, re: globARegex(r.patron) }))

// La tabla de hashes de los sagrados vive en ESTADO.md (línea «Sagrados (hash de blob)» y la regla 8). ESTADO.md
// cambia en casi todo PR, así que se mira el patch: solo se marca si una línea +/- toca esa tabla.
const SAGRADOS = /sagrad|cashUtils\.ts|tipCalculations\.ts|cierrePozo\.ts|posFiscal\.ts|computeTotals/i
const HASH = /\b[0-9a-f]{7,40}\b/

/** ¿El patch cambia una línea con un sagrado y un hash (o que habla de sagrados)? `undefined` = sin patch. */
export function patchTocaSagrados(patch) {
  if (patch == null) return undefined
  return patch.split('\n').some(l => /^[+-]/.test(l) && (/sagrad/i.test(l) || (SAGRADOS.test(l) && HASH.test(l))))
}

/**
 * @param {{filename: string, status: string, previous_filename?: string, patch?: string}[]} archivos de la API
 * @returns {{archivo: string, porque: string}[]}
 */
export function evaluar(archivos) {
  const marcados = []
  for (const a of archivos) {
    const nombres = [a.filename, a.previous_filename].filter(Boolean)
    const regla = REGEX.find(r => nombres.some(n => r.re.test(n)) && !(r.soloSiExiste && a.status === 'added'))
    if (regla) { marcados.push({ archivo: a.filename, porque: regla.porque }); continue }
    if (a.filename === 'ESTADO.md') {
      const toca = patchTocaSagrados(a.patch)
      if (toca === undefined) marcados.push({ archivo: a.filename, porque: 'diff sin patch en la API: revisar a mano la tabla de hashes de los sagrados' })
      else if (toca) marcados.push({ archivo: a.filename, porque: 'tabla de hashes de los sagrados' })
    }
  }
  return marcados
}

/** Decide el resultado. Devuelve el texto del informe y si el job tiene que fallar. */
export function decidir({ marcados, etiquetas, modo }) {
  const conOk = etiquetas.includes(ETIQUETA_OK)
  if (marcados.length === 0) return { falla: false, nivel: 'notice', titulo: 'Checks protegidos', texto: 'El PR no toca archivos que juzgan cambios.' }
  const lista = marcados.map(m => `- \`${m.archivo}\` — ${m.porque}`).join('\n')
  if (conOk) return { falla: false, nivel: 'notice', titulo: 'Checks protegidos · OK del dueño', texto: `Toca archivos que juzgan cambios; tiene la etiqueta \`${ETIQUETA_OK}\`.\n\n${lista}` }
  const bloquea = modo === 'bloquear'
  return {
    falla: bloquea,
    nivel: bloquea ? 'error' : 'warning',
    titulo: 'Checks protegidos · necesita OK del dueño',
    texto: `Este PR toca ${marcados.length} archivo(s) que juzgan cambios. Necesita OK del dueño (etiqueta \`${ETIQUETA_OK}\`).` +
      (bloquea ? '' : ' Modo observar: hoy solo avisa.') + `\n\n${lista}`,
  }
}

// Escapa lo que va dentro de un comando de workflow (::warning ...::texto). Los nombres de archivo vienen del PR.
export function escaparComando(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

async function archivosDelPR({ repo, numero, token }) {
  const todos = []
  for (let pagina = 1; pagina <= 30; pagina++) { // la API devuelve como mucho 3000 archivos (30 × 100)
    const r = await fetch(`https://api.github.com/repos/${repo}/pulls/${numero}/files?per_page=100&page=${pagina}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    })
    if (!r.ok) throw new Error(`API ${r.status} al leer los archivos del PR`)
    const lote = await r.json()
    todos.push(...lote)
    if (lote.length < 100) break
  }
  return todos
}

async function main() {
  const evento = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const pr = evento.pull_request
  const modo = process.env.MODO === 'bloquear' ? 'bloquear' : 'observar'
  const archivos = await archivosDelPR({ repo: process.env.GITHUB_REPOSITORY, numero: Number(pr.number), token: process.env.GITHUB_TOKEN })
  const marcados = evaluar(archivos)
  if (archivos.length >= 3000) marcados.push({ archivo: '(más de 3000 archivos)', porque: 'la API no lista todos: revisar a mano' })
  const etiquetas = (pr.labels ?? []).map(l => l.name)
  const r = decidir({ marcados, etiquetas, modo })

  console.log(`modo=${modo} · archivos=${archivos.length} · protegidos=${marcados.length}`)
  console.log(r.texto)
  console.log(`::${r.nivel} title=${r.titulo}::${escaparComando(r.texto)}`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${r.titulo}\n\n${r.texto}\n`)
  if (r.falla) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    // En modo observar un error de la API avisa y no frena; en modo bloquear falla (no se aprueba a ciegas).
    const bloquea = process.env.MODO === 'bloquear'
    console.log(`::${bloquea ? 'error' : 'warning'} title=Checks protegidos::${escaparComando(e.message)}`)
    if (bloquea) process.exit(1)
  })
}
