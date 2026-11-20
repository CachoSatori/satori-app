// Lectura de comandos git y gh para la guardia: push a main y merges de PR.

const GIT_OPC_CON_VALOR = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env'])

/** @param {string[]} args argumentos de `git` (sin el programa) @returns {{ sub: string, resto: string[], dir: string | null }} */
export function subcomandoGit(args) {
  let i = 0
  let dir = null
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-C') dir = args[i + 1] ?? null
    i += GIT_OPC_CON_VALOR.has(args[i]) ? 2 : 1
  }
  return { sub: args[i] ?? '', resto: args.slice(i + 1), dir }
}

const PUSH_OPC_CON_VALOR = new Set(['--repo', '--receive-pack', '--exec', '-o', '--push-option'])

/**
 * ¿Este `git push` va a main o fuerza? (ESTADO regla 3 + skill satori-estandar-pr §1: a main solo por PR; force-push
 * solo con --force-with-lease y en la rama propia.)
 * @param {string[]} resto argumentos después de `push` @param {() => string} ramaActual
 * @returns {string | null}
 */
export function evaluarPush(resto, ramaActual) {
  const posicionales = []
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i]
    if (a === '--') { posicionales.push(...resto.slice(i + 1)); break }
    if (PUSH_OPC_CON_VALOR.has(a)) { i++; continue }
    if (a === '--force') return 'git push --force (solo se permite --force-with-lease, y en tu rama)'
    if (/^-[^-]*f/.test(a)) return 'git push -f (solo se permite --force-with-lease, y en tu rama)'
    if (a === '--mirror' || a === '--all' || a === '--branches') return `git push ${a} (empuja también main)`
    if (a.startsWith('-')) continue
    posicionales.push(a)
  }
  const refspecs = posicionales.slice(1)
  if (refspecs.length === 0) {
    const rama = ramaActual()
    return rama === 'main' ? 'git push estando en main (a main solo se llega por PR)' : null
  }
  for (const r of refspecs) {
    if (r.startsWith('+')) return `git push ${r} (el + fuerza; usá --force-with-lease en tu rama)`
    const dos = r.lastIndexOf(':')
    let destino = dos === -1 ? r : r.slice(dos + 1)
    if (dos === -1 && (destino === 'HEAD' || destino === '@')) destino = ramaActual()
    destino = destino.replace(/^refs\/heads\//, '')
    if (destino === 'main') return `git push ${r} (a main solo se llega por PR)`
  }
  return null
}

const GH_OPC_CON_VALOR = new Set(['-R', '--repo', '-b', '--body', '-F', '--body-file', '-t', '--subject', '-A', '--author-email', '--match-head-commit'])
export const REPO = 'CachoSatori/satori-app'

/**
 * Detecta un merge de PR. @param {string} prog @param {string[]} args
 * `cabezaPedida` = el SHA que el comando exige a GitHub (`--match-head-commit` en gh pr merge, campo `sha` en la API).
 * @returns {null | { selector: string | null, repo: string, cabezaPedida: string | null } | { bloquear: string }}
 */
export function detectarMerge(prog, args) {
  if (prog === 'gh') {
    let i = 0
    let repo = REPO
    while (args[i]?.startsWith('-')) { if (args[i] === '-R' || args[i] === '--repo') repo = args[i + 1]; i += 2 }
    const [sub, accion] = [args[i], args[i + 1]]
    if (sub === 'pr' && accion === 'merge') {
      let selector = null
      let cabezaPedida = null
      const resto = args.slice(i + 2)
      for (let k = 0; k < resto.length; k++) {
        const a = resto[k]
        if (a === '--auto') return { bloquear: 'gh pr merge --auto (mergearía después, sin control de la hora ni de la cabeza)' }
        if (a === '--match-head-commit') { cabezaPedida = resto[k + 1] ?? null; k++; continue }
        if (a.startsWith('--match-head-commit=')) { cabezaPedida = a.slice(20); continue }
        if (a === '-R' || a === '--repo') { repo = resto[k + 1]; k++; continue }
        if (a.startsWith('--repo=')) { repo = a.slice(7); continue }
        if (GH_OPC_CON_VALOR.has(a)) { k++; continue }
        if (a.startsWith('-')) continue
        selector ??= a
      }
      return { selector, repo, cabezaPedida }
    }
    if (sub === 'api') {
      const resto = args.slice(i + 1)
      const crudo = resto.join(' ')
      if (/\bgraphql\b/.test(crudo) && /mergePullRequest|enablePullRequestAutoMerge/i.test(crudo)) {
        return { bloquear: 'merge por GraphQL: no se puede verificar la cabeza; usá gh pr merge o REST' }
      }
      const ruta = resto.find(a => /(?:^|\/)repos\/[^/]+\/[^/]+\/pulls\/\d+\/merge\b/.test(a))
      if (!ruta) return null
      const metodo = valorOpcion(resto, ['-X', '--method'])
      const conCampos = resto.some(a => ['-f', '-F', '--field', '--raw-field', '--input'].includes(a) || /^--(raw-)?field=/.test(a))
      const efectivo = (metodo ?? (conCampos ? 'POST' : 'GET')).toUpperCase()
      if (efectivo === 'GET') return null
      const m = /repos\/([^/]+\/[^/]+)\/pulls\/(\d+)\/merge/.exec(ruta)
      let cabezaPedida = null
      for (let k = 0; k < resto.length; k++) {
        const campo = ['-f', '-F', '--field', '--raw-field'].includes(resto[k]) ? resto[k + 1] : /^--(?:raw-)?field=(.*)$/.exec(resto[k])?.[1]
        if (campo?.startsWith('sha=')) cabezaPedida = campo.slice(4)
      }
      return { selector: m[2], repo: m[1], cabezaPedida }
    }
    return null
  }
  if (prog === 'curl') {
    const url = args.find(a => /api\.github\.com\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/merge\b/.test(a))
    if (!url) return null
    const metodo = (valorOpcion(args, ['-X', '--request']) ?? 'GET').toUpperCase()
    if (metodo === 'GET') return null
    return { bloquear: 'merge por curl a la API de GitHub; usá gh pr merge con --match-head-commit' }
  }
  return null
}

/** Valor de una opción (`-X PUT`, `-XPUT`, `--method=PUT`). */
export function valorOpcion(args, nombres) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    for (const n of nombres) {
      if (a === n) return args[i + 1]
      if (n.startsWith('--') && a.startsWith(n + '=')) return a.slice(n.length + 1)
      if (!n.startsWith('--') && a.startsWith(n) && a.length > n.length) return a.slice(n.length)
    }
  }
  return undefined
}
