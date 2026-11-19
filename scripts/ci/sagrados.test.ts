// Sagrados por hash de blob (ESTADO, regla 8): el hash (`git hash-object`) de cada archivo sagrado tiene que ser el de la tabla
// «Sagrados» de ESTADO.md. La tabla se lee de ESTADO.md; acá no hay hashes fijos. Si un PR cambia un sagrado a propósito, con
// acuerdo del dueño, actualiza el hash en ESTADO.md en el mismo PR (y el check «Checks protegidos» pide su OK).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = resolve(__dirname, '..', '..')
const SAGRADOS = [
  'src/shared/utils/tipCalculations.ts',
  'src/modules/cash/cashUtils.ts',
  'src/modules/cash/cierrePozo.ts',
]

/** Hash de la tabla «Sagrados» para un archivo: la fila lo nombra con su ruta completa o solo con el nombre del archivo. */
function hashEnEstado(estado: string, ruta: string): string | undefined {
  const i = estado.indexOf('**Sagrados')
  if (i < 0) return undefined
  const tabla = estado.slice(i, estado.indexOf('\n\n', estado.indexOf('|', i)) > 0 ? estado.indexOf('\n\n', estado.indexOf('|', i)) : undefined)
  const nombre = ruta.split('/').pop() as string
  for (const fila of tabla.split('\n')) {
    const m = /^\|\s*`([^`]+)`[^|]*\|\s*`([0-9a-f]{7,40})`/.exec(fila)
    if (m && (m[1] === ruta || m[1] === nombre)) return m[2]
  }
  return undefined
}

describe('sagrados por hash de blob', () => {
  const estado = readFileSync(join(RAIZ, 'ESTADO.md'), 'utf8')
  for (const ruta of SAGRADOS) {
    it(`${ruta} coincide con el hash de la tabla «Sagrados» de ESTADO.md`, () => {
      const esperado = hashEnEstado(estado, ruta)
      expect(esperado, `${ruta} no está en la tabla «Sagrados» de ESTADO.md`).toBeTruthy()
      expect(existsSync(join(RAIZ, ruta)), `${ruta} no existe`).toBe(true)
      const real = execFileSync('git', ['hash-object', ruta], { cwd: RAIZ, encoding: 'utf8' }).trim()
      expect(
        real.startsWith(esperado as string),
        `${ruta} cambió: hash ${real.slice(0, 8)}, ESTADO dice ${esperado}. Los sagrados no se tocan sin acuerdo explícito del dueño: ` +
        `deshacé el cambio (git checkout origin/main -- ${ruta}) o, si el dueño lo autorizó, actualizá el hash en ESTADO.md en este PR (regla 8).`,
      ).toBe(true)
    })
  }
})
