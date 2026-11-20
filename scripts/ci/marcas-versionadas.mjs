// Ninguna marca de habilitación (`.claude/*.local`) ni `.claude/settings.local.json` puede quedar versionada en ninguna
// rama: si una rama la trae, `git switch` / `git checkout` / `git reset --hard` la escribirían en .claude/ sin pasar por la
// firma. La guardia (scripts/hooks/guardia.mjs) deja sincronizar el worktree; esto lo cuida el gate en cada PR.
// Lo usa scripts/ci/marcas-versionadas.test.ts (corre en el paso vitest de gate.sh).
import { execFileSync } from 'node:child_process'

/** Pathspecs de lo que nunca va al índice. */
export const PATRONES = ['.claude/*.local', '.claude/settings.local.json']

/** Archivos versionados (en el índice) que son marcas o configuración local. @param {string} dir @returns {string[]} */
export function marcasVersionadas(dir) {
  const salida = execFileSync('git', ['-C', dir, 'ls-files', '--', ...PATRONES], { encoding: 'utf8' })
  return salida.split('\n').map(l => l.trim()).filter(Boolean)
}

/** Rutas de ejemplo que `.gitignore` tiene que ignorar (sin mirar el índice). @param {string} dir @returns {string[]} las que NO ignora */
export function sinIgnorar(dir, rutas) {
  return rutas.filter(r => {
    try {
      execFileSync('git', ['-C', dir, 'check-ignore', '-q', '--no-index', r], { stdio: 'ignore' })
      return false
    } catch {
      return true
    }
  })
}
