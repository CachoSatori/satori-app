// Guardas baratas del diff de un PR contra su base (las corre scripts/ci/gate.sh, paso «guardas-pr»):
//   R04  nada bajo supabase/functions/ ni supabase/config.toml hacia main hasta cerrar el ítem 11 (ESTADO, regla 2). Excepción: etiqueta `ok-dueno-edge`.
//   R14  nunca modificar, borrar ni renombrar un supabase/migrations/*.sql que ya existía en la base (ESTADO, regla 10),
//        salvo una renumeración registrada con `origen` en supabase/migraciones-reservadas.json.
// Base: GATE_BASE (gate.sh la fija en el CI de un PR a HEAD^1 de la fusión = cabeza ACTUAL de main, no el base.sha viejo del
// evento: con el viejo, todo lo que entró a main después contaría como del PR); sin ella, el merge-base con origin/main si existe; sin ninguna, se salta
// y lo dice (en el CI de un push a main no hay base). Etiquetas: GATE_LABELS, separadas por coma o salto de línea.
// Uso: node scripts/ci/guardas-pr.mjs   (desde la raíz del repo; GATE_ROOT cambia la carpeta, para las pruebas)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ETIQUETA_EDGE = 'ok-dueno-edge'

/** Líneas de `git diff --name-status -M` → [{estado, ruta, anterior?}] (R100\told\tnew → estado R). */
export function parsearNameStatus(salida) {
  return salida.split('\n').filter(Boolean).map(l => {
    const [est, a, b] = l.split('\t')
    return est.startsWith('R') ? { estado: 'R', ruta: b, anterior: a } : { estado: est[0], ruta: a }
  })
}

/** @returns {string[]} problemas (vacío = ok) */
export function evaluar({ cambios, etiquetas, registro }) {
  const problemas = []
  const esEdge = r => !!r && (r.startsWith('supabase/functions/') || r === 'supabase/config.toml')
  const edge = cambios.filter(c => esEdge(c.ruta) || esEdge(c.anterior))
  if (edge.length && !etiquetas.includes(ETIQUETA_EDGE)) {
    problemas.push(
      `R04: el PR toca supabase/functions/ o supabase/config.toml (${edge.slice(0, 5).map(c => c.ruta).join(', ')}${edge.length > 5 ? ` y ${edge.length - 5} más` : ''}). ` +
      `Hasta cerrar el ítem 11 no entra nada ahí hacia main (ESTADO, regla 2): un despliegue de Branching desde main pisa prod con código viejo. ` +
      `Cómo arreglarlo: sacá esos archivos del PR (van por la rama de Edge con el dueño); si el dueño ya lo autorizó, que ponga la etiqueta «${ETIQUETA_EDGE}» al PR.`)
  }
  const origenes = new Map() // «NNN_nombre.sql» de origen → número al que se renumeró
  for (const [v, a] of Object.entries(registro.asignadas ?? {})) {
    if (a.origen) origenes.set(`${a.origen}_${a.nombre}.sql`, v)
  }
  const mig = f => /^supabase\/migrations\/[^/]+\.sql$/.test(f)
  for (const c of cambios) {
    const vieja = c.estado === 'R' ? c.anterior : c.ruta
    if (!['M', 'D', 'R'].includes(c.estado) || !mig(vieja)) continue
    const nombre = vieja.split('/').pop()
    if (c.estado !== 'M' && origenes.has(nombre)) {
      const nuevo = origenes.get(nombre)
      if (c.estado === 'D' || c.ruta.split('/').pop().startsWith(`${nuevo}_`)) continue // renumeración registrada
    }
    const que = { M: 'modifica', D: 'borra', R: 'renombra' }[c.estado]
    problemas.push(
      `R14: el PR ${que} ${vieja}, que ya existe en la base (ESTADO, regla 10: lo que está en el ledger no se reescribe). ` +
      `Cómo arreglarlo: restaurá el archivo (git checkout <base> -- ${vieja}) y poné el cambio en una migración NUEVA hacia adelante. ` +
      `Si es una renumeración de pase, registrala en supabase/migraciones-reservadas.json (bloque «pase», con «origen»: «${nombre.split('_')[0]}»).`)
  }
  return problemas
}

function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8' }) }

export function resolverBase(cwd, env = process.env) {
  if (env.GATE_BASE) return env.GATE_BASE
  try { return git(['merge-base', 'origin/main', 'HEAD'], cwd).trim() } catch { return '' }
}

export function correr(env = process.env) {
  const cwd = env.GATE_ROOT || join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
  const base = resolverBase(cwd, env)
  if (!base) { console.log('guardas-pr: sin base contra la que comparar (push a main o sin origin/main): se saltan R04 y R14.'); return 0 }
  const cambios = parsearNameStatus(git(['diff', '--name-status', '-M', '--diff-filter=ADMR', `${base}...HEAD`, '--', 'supabase/functions', 'supabase/config.toml', 'supabase/migrations'], cwd))
  const etiquetas = (env.GATE_LABELS ?? '').split(/[,\n]/).map(s => s.trim()).filter(Boolean)
  const registro = JSON.parse(readFileSync(join(cwd, 'supabase/migraciones-reservadas.json'), 'utf8'))
  const problemas = evaluar({ cambios, etiquetas, registro })
  for (const p of problemas) console.log(`::error title=Guarda del PR::${p}`)
  if (!problemas.length) console.log(`guardas-pr: R04 y R14 ok contra ${base.slice(0, 8)} (${cambios.length} cambios en supabase/).`)
  return problemas.length ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(correr())
