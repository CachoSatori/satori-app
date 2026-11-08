// Numeración de migraciones (decisión de Ismael, 08/11): bloque por rama, sin repetidos y con la
// tabla de ESTADO.md al día. Corre en el gate (vitest). Ver supabase/migraciones-reservadas.json.
//
// Falla si:
//   · dos archivos de supabase/migrations/ tienen la misma versión;
//   · una migración ≥ 086 no está registrada en «asignadas» (con el mismo nombre) o queda fuera del
//     bloque de su rama;
//   · un número del bloque de PASE (150–199) no está registrado como «pase» con su número de origen,
//     o el archivo de origen sigue en el repo (se renombra, no se copia);
//   · el registro se contradice (bloques que se pisan, un número en dos lugares, una asignada fuera
//     de su bloque);
//   · ESTADO.md no lista los bloques o algún número registrado.
// La regla del pase a prod («ningún número ≤ al último del ledger de prod») depende de la base y se
// verifica en el PR del pase, no acá; este test solo exige que la renumeración caiga en el bloque de
// pase y quede registrada con su origen (nunca dentro de un bloque de creación).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Bloque { tipo: 'creacion' | 'pase'; desde: number; hasta: number; que: string }
interface Registro {
  bloques: Record<string, Bloque>
  usadas_antes_de_los_bloques: Record<string, { nombre: string; de: string }>
  libres_fuera_de_bloque: string[]
  asignadas: Record<string, { nombre: string; bloque: string; rama?: string; origen?: string }>
}

const RAIZ = join(__dirname, '..')
const REG: Registro = JSON.parse(readFileSync(join(__dirname, 'migraciones-reservadas.json'), 'utf8'))
const PRIMER_BLOQUE = 86   // desde acá, todo número tiene que estar registrado

/** Las migraciones del repo: versión (texto, como el ledger) y nombre. */
function migraciones(): { version: string; nombre: string; archivo: string }[] {
  return readdirSync(join(__dirname, 'migrations'))
    .filter(f => f.endsWith('.sql'))
    .map(f => {
      const m = /^(\d+)_(.+)\.sql$/.exec(f)
      if (!m) throw new Error(`Nombre de migración inválido: ${f} (tiene que ser NNN_nombre.sql)`)
      return { version: m[1], nombre: m[2], archivo: f }
    })
}

describe('numeración de migraciones', () => {
  const migs = migraciones()

  it('no hay dos migraciones con la misma versión', () => {
    const vistas = new Map<string, string>()
    const repetidas: string[] = []
    for (const m of migs) {
      const otra = vistas.get(m.version)
      if (otra) repetidas.push(`${m.version}: ${otra} y ${m.archivo}`)
      vistas.set(m.version, m.archivo)
    }
    expect(repetidas).toEqual([])
  })

  it(`toda migración ≥ ${PRIMER_BLOQUE} está registrada, con su nombre, dentro del bloque de su rama`, () => {
    const malas: string[] = []
    for (const m of migs) {
      if (!/^\d{3}$/.test(m.version) || Number(m.version) < PRIMER_BLOQUE) continue
      const a = REG.asignadas[m.version]
      if (!a) { malas.push(`${m.archivo}: no está en «asignadas» de migraciones-reservadas.json`); continue }
      if (a.nombre !== m.nombre) malas.push(`${m.archivo}: el registro dice «${a.nombre}»`)
      const b = REG.bloques[a.bloque]
      if (!b) malas.push(`${m.archivo}: bloque «${a.bloque}» inexistente`)
      else if (Number(m.version) < b.desde || Number(m.version) > b.hasta) {
        malas.push(`${m.archivo}: fuera del bloque «${a.bloque}» (${b.desde}–${b.hasta})`)
      }
    }
    expect(malas).toEqual([])
  })

  it('las migraciones 081–085 son las registradas como usadas antes de los bloques', () => {
    for (const m of migs) {
      const u = REG.usadas_antes_de_los_bloques[m.version]
      if (u) expect(m.nombre, m.archivo).toBe(u.nombre)
    }
  })

  it('el registro no se contradice', () => {
    const bloques = Object.entries(REG.bloques).sort((a, b) => a[1].desde - b[1].desde)
    for (let i = 1; i < bloques.length; i++) {
      expect(bloques[i][1].desde, `${bloques[i - 1][0]} y ${bloques[i][0]} se pisan`).toBeGreaterThan(bloques[i - 1][1].hasta)
    }
    for (const [, b] of bloques) expect(b.desde).toBeGreaterThanOrEqual(PRIMER_BLOQUE)
    const todos = [
      ...Object.keys(REG.usadas_antes_de_los_bloques), ...Object.keys(REG.asignadas), ...REG.libres_fuera_de_bloque,
    ]
    expect(todos.length, 'un número aparece en dos lugares del registro').toBe(new Set(todos).size)
    for (const [v, a] of Object.entries(REG.asignadas)) {
      const b = REG.bloques[a.bloque]
      expect(b, `${v}: bloque «${a.bloque}»`).toBeTruthy()
      expect(Number(v) >= b.desde && Number(v) <= b.hasta, `${v} fuera de «${a.bloque}»`).toBe(true)
    }
    for (const v of REG.libres_fuera_de_bloque) {
      expect(bloques.some(([, b]) => Number(v) >= b.desde && Number(v) <= b.hasta), `${v} está dentro de un bloque`).toBe(false)
    }
  })

  it('bloque de PASE: solo renumeraciones registradas con su origen; los de creación no llevan origen', () => {
    const malas: string[] = []
    const origenes = new Set<string>()
    for (const [v, a] of Object.entries(REG.asignadas)) {
      const b = REG.bloques[a.bloque]
      if (!b) continue
      if (b.tipo === 'creacion') {
        if (a.origen !== undefined) malas.push(`${v}: un bloque de creación no lleva «origen»`)
        continue
      }
      // tipo pase
      if (!a.origen || !/^\d{3}$/.test(a.origen)) { malas.push(`${v}: pase sin «origen» (NNN)`); continue }
      const o = Number(a.origen)
      const enPase = Object.values(REG.bloques).some(x => x.tipo === 'pase' && o >= x.desde && o <= x.hasta)
      if (enPase) malas.push(`${v}: el origen ${a.origen} no puede ser otro número de pase`)
      if (origenes.has(a.origen)) malas.push(`${v}: el origen ${a.origen} ya se renumeró una vez`)
      origenes.add(a.origen)
      const conocido = REG.usadas_antes_de_los_bloques[a.origen] ?? REG.asignadas[a.origen]
      if (conocido && conocido.nombre !== a.nombre) malas.push(`${v}: el nombre no coincide con el de su origen ${a.origen}`)
      if (!conocido && o >= PRIMER_BLOQUE) malas.push(`${v}: el origen ${a.origen} no está registrado`)
      // se renombra, no se copia: el archivo de origen no puede seguir al lado del de pase
      if (migs.some(m => m.version === a.origen && m.nombre === a.nombre) && migs.some(m => m.version === v)) {
        malas.push(`${v}: el archivo de origen ${a.origen}_${a.nombre}.sql sigue en el repo`)
      }
    }
    for (const [nombre, b] of Object.entries(REG.bloques)) {
      expect(['creacion', 'pase'], `tipo del bloque ${nombre}`).toContain(b.tipo)
    }
    expect(malas).toEqual([])
  })

  it('ESTADO.md lista los bloques y cada número registrado', () => {
    const estado = readFileSync(join(RAIZ, 'ESTADO.md'), 'utf8')
    const i = estado.indexOf('### Numeración de migraciones')
    expect(i, 'falta la sección «### Numeración de migraciones» en ESTADO.md').toBeGreaterThan(-1)
    const seccion = estado.slice(i, estado.indexOf('\n## ', i) === -1 ? undefined : estado.indexOf('\n## ', i))
    for (const [nombre, b] of Object.entries(REG.bloques)) {
      expect(seccion, `bloque ${nombre}`).toContain(`${String(b.desde).padStart(3, '0')}–${b.hasta}`)
    }
    for (const v of [...Object.keys(REG.usadas_antes_de_los_bloques), ...Object.keys(REG.asignadas)]) {
      expect(seccion, `número ${v}`).toMatch(new RegExp(`\\| ${v} \\|`))
    }
  })
})
