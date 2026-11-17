// Pruebas de la guarda de checks propios (scripts/ci/checks-protegidos.mjs). Solo lógica pura: la lista de archivos que
// devolvería la API → qué se marca y si el job falla. Más una prueba contra el árbol real: cada patrón existe en el repo.
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error módulo .mjs sin tipos (corre en el runner sin npm ci)
import { evaluar, decidir, globARegex, patchTocaSagrados, escaparComando, REGLAS, ETIQUETA_OK } from './checks-protegidos.mjs'

type Archivo = { filename: string; status: string; previous_filename?: string; patch?: string }
const mod = (filename: string, extra: Partial<Archivo> = {}): Archivo => ({ filename, status: 'modified', ...extra })
const marcados = (a: Archivo[]) => evaluar(a).map((m: { archivo: string }) => m.archivo)

describe('globARegex', () => {
  it('`*` no cruza carpetas y `**` sí', () => {
    expect(globARegex('src/*.test.ts').test('src/privacidadRepo.test.ts')).toBe(true)
    expect(globARegex('src/*.test.ts').test('src/modules/cash/x.test.ts')).toBe(false)
    expect(globARegex('.claude/**').test('.claude/skills/satori-estandar-pr/SKILL.md')).toBe(true)
    expect(globARegex('**/CLAUDE.md').test('club-web/CLAUDE.md')).toBe(true)
    expect(globARegex('**/CLAUDE.md').test('CLAUDE.md')).toBe(true)
    expect(globARegex('vite.config.ts').test('club-web/vite.config.ts')).toBe(false)
    expect(globARegex('vite.config.ts').test('viteXconfig.ts')).toBe(false) // el punto es literal
  })
})

describe('evaluar: qué se marca', () => {
  it('marca los archivos que juzgan cambios', () => {
    const protegidos = [
      'src/privacidadRepo.test.ts', 'src/refProdEnPruebas.test.ts', 'supabase/migraciones.test.ts',
      '.claude/skills/satori-estandar-pr/SKILL.md', 'CLAUDE.md', 'docs/REGLAS-POR-INCIDENTE.md',
      '.github/workflows/ci.yml', '.github/workflows/checks-protegidos.yml', 'scripts/ci/lint-linea-base.json',
      'scripts/ci/checks-protegidos.mjs', 'scripts/sql/mutar_bateria.py', 'scripts/sql/gate61.sh',
      'scripts/sql/baterias_assert.test.ts', 'scripts/sql/184_pruebas.sql', 'scripts/sql/094_verificacion.sql',
      'vite.config.ts', 'eslint.config.js', 'club-web/src/usted.test.ts', 'src/shared/wallet/usted.test.ts',
    ]
    expect(marcados(protegidos.map(f => mod(f)))).toEqual(protegidos)
  })

  it('no marca el código de la app ni los docs comunes', () => {
    const libres = [
      'src/modules/cash/CashMovimientos.tsx', 'src/modules/club/retosReglas.test.ts', 'docs/sop-app/caja.md',
      'supabase/migrations/185_algo.sql', 'supabase/migraciones-reservadas.json', 'scripts/sql/185_rollback.sql',
      'club-web/src/aviso.test.ts', 'package.json', 'docs/REGLAS-otra-cosa.md',
    ]
    expect(marcados(libres.map(f => mod(f)))).toEqual([])
  })

  it('la batería NUEVA de una migración no se marca; tocar una existente sí', () => {
    expect(marcados([mod('scripts/sql/185_pruebas.sql', { status: 'added' })])).toEqual([])
    expect(marcados([mod('scripts/sql/185_pruebas.py', { status: 'added' })])).toEqual([])
    expect(marcados([mod('scripts/sql/184_pruebas.sql', { status: 'removed' })])).toEqual(['scripts/sql/184_pruebas.sql'])
    // la infraestructura de baterías se marca aunque sea nueva
    expect(marcados([mod('scripts/sql/bateria_nueva.py', { status: 'added' })])).toEqual(['scripts/sql/bateria_nueva.py'])
  })

  it('renombrar un protegido a otro lado no lo esconde', () => {
    expect(marcados([mod('docs/viejo/privacidad.txt', { status: 'renamed', previous_filename: 'src/privacidadRepo.test.ts' })]))
      .toEqual(['docs/viejo/privacidad.txt'])
  })

  it('ESTADO.md: solo se marca si el patch toca la tabla de hashes de los sagrados', () => {
    const normal = '@@ -1,3 +1,3 @@\n-**Al día: 2026-11-16**\n+**Al día: 2026-11-17**\n contexto'
    const sagrado = '@@ -107 +107 @@\n-- **Sagrados (hash de blob):** `cashUtils.ts` **`b597c697`**\n+- **Sagrados (hash de blob):** `cashUtils.ts` **`deadbeef`**'
    const hashSuelto = '@@ -1 +1 @@\n+| `src/modules/cash/cashUtils.ts` | `0123abcd` |'
    const contextoSolo = '@@ -107 +107 @@\n - **Sagrados (hash de blob):** `cashUtils.ts` **`b597c697`**\n+otra línea'
    expect(marcados([mod('ESTADO.md', { patch: normal })])).toEqual([])
    expect(marcados([mod('ESTADO.md', { patch: sagrado })])).toEqual(['ESTADO.md'])
    expect(marcados([mod('ESTADO.md', { patch: hashSuelto })])).toEqual(['ESTADO.md'])
    expect(marcados([mod('ESTADO.md', { patch: contextoSolo })])).toEqual([])
    // sin patch (diff demasiado grande para la API) → se marca para revisar a mano
    expect(marcados([mod('ESTADO.md')])).toEqual(['ESTADO.md'])
    expect(patchTocaSagrados(undefined)).toBeUndefined()
  })
})

describe('decidir: avisa o bloquea', () => {
  const uno = [{ archivo: '.claude/skills/x/SKILL.md', porque: 'skills' }]

  it('sin protegidos: pasa', () => {
    expect(decidir({ marcados: [], etiquetas: [], modo: 'bloquear' }).falla).toBe(false)
  })
  it('modo observar: avisa con la lista y «necesita OK del dueño», no falla', () => {
    const r = decidir({ marcados: uno, etiquetas: [], modo: 'observar' })
    expect(r).toMatchObject({ falla: false, nivel: 'warning' })
    expect(r.titulo).toContain('necesita OK del dueño')
    expect(r.texto).toContain('.claude/skills/x/SKILL.md')
  })
  it('modo bloquear: falla sin la etiqueta y pasa con ella', () => {
    expect(decidir({ marcados: uno, etiquetas: ['otra'], modo: 'bloquear' })).toMatchObject({ falla: true, nivel: 'error' })
    expect(decidir({ marcados: uno, etiquetas: [ETIQUETA_OK], modo: 'bloquear' }).falla).toBe(false)
  })
  it('un modo desconocido no bloquea (solo «bloquear» bloquea)', () => {
    expect(decidir({ marcados: uno, etiquetas: [], modo: 'BLOQUEAR' }).falla).toBe(false)
  })
})

describe('seguridad del comando de anotación', () => {
  it('un nombre de archivo con saltos de línea no inyecta otro comando ::', () => {
    const r = escaparComando('a\n::error::falso%')
    expect(r).not.toContain('\n')
    expect(r).toBe('a%0A::error::falso%25')
  })
})

describe('contra el repo real', () => {
  const raiz = join(__dirname, '..', '..')
  const tracked: string[] = execSync('git ls-files', { cwd: raiz, encoding: 'utf8' }).split('\n').filter(Boolean)
  // Patrones que todavía no tienen archivo en main (llegan en otros PR); se marcan igual cuando aparezcan.
  const AUSENTES_PERMITIDOS = new Set(['docs/REGLAS-POR-INCIDENTE.md', '.github/CODEOWNERS', '**/CLAUDE.md'])

  it('cada patrón protegido existe en el repo (si no, la lista quedó vieja)', () => {
    const huerfanos = REGLAS.filter((r: { patron: string }) => !AUSENTES_PERMITIDOS.has(r.patron))
      .filter((r: { patron: string }) => !tracked.some(f => globARegex(r.patron).test(f)))
      .map((r: { patron: string }) => r.patron)
    expect(huerfanos).toEqual([])
  })

  it('el workflow corre con pull_request_target, permisos de solo lectura y sin checkout del PR', () => {
    const y = readFileSync(join(raiz, '.github/workflows/checks-protegidos.yml'), 'utf8')
    expect(y).toMatch(/^\s*pull_request_target:/m)
    expect(y).not.toMatch(/^\s*pull_request:/m)
    expect(y).toMatch(/pull-requests: read/)
    expect(y).toMatch(/contents: read/)
    expect(y).not.toMatch(/: write/)
    // nada del PR en el checkout ni interpolado en shell
    expect(y).not.toMatch(/head\.(sha|ref)|github\.head_ref|merge_commit_sha|refs\/pull/)
    expect(y).not.toMatch(/\$\{\{\s*github\.event\.pull_request\.(title|body|head)/)
  })
})
