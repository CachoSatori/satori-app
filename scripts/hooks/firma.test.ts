// Pruebas del hook de la firma del dueño (scripts/hooks/firma.mjs, opción A del 20-nov): la sesión principal escribe la
// marca con Write → pedido de permiso al dueño (regla ask + «ask» del hook) con el texto «Aprobar = …»; un subagente,
// otra ruta, Edit o un contenido dudoso → deny; Bash → deny (guardia).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
// @ts-expect-error módulo .mjs sin tipos
import { evaluarFirma, claveDeMarca } from './firma.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { evaluarBash } from './guardia.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { shasFirmados, shaFirmadoCoincide, okNocheValido, turnoProdValido, migracionesFirmadas } from './marcas.mjs'

const FIRMA = resolve(__dirname, 'firma.mjs')
const CABEZA = 'abcdef1234567890abcdef1234567890abcdef12'
const HOY = '2026-11-20'
let raiz: string

type InfoPR = { numero: number, cabeza: string, archivos: string[], titulo?: string } | { error: string }
function ctx(opc: { ahora?: string, pr?: InfoPR, migracion?: string | null } = {}) {
  return {
    raiz,
    ahora: new Date(opc.ahora ?? '2026-11-20T22:00:00Z'), // 16:00 CR
    consultarPR: () => opc.pr ?? { numero: 316, cabeza: CABEZA, archivos: ['src/a.ts'], titulo: 'Arreglo de prueba' },
    buscarMigracion: () => opc.migracion ?? null,
  }
}
const ruta = (n: string) => join(raiz, '.claude', n)
const write = (n: string, content: string, extra: Record<string, unknown> = {}) =>
  ({ tool_name: 'Write', tool_input: { file_path: ruta(n), content }, cwd: raiz, ...extra })

beforeEach(() => { raiz = mkdtempSync(join(tmpdir(), 'firma-')); mkdirSync(join(raiz, '.claude')) })
afterEach(() => rmSync(raiz, { recursive: true, force: true }))

describe('qué es una marca', () => {
  it('las cuatro marcas sí; lo demás no', () => {
    for (const n of ['sha-firmado.local', 'ok-dueno-noche.local', 'turno-prod.local', 'migracion-firmada.local']) expect(claveDeMarca(`/x/.claude/${n}`)).not.toBeNull()
    for (const n of ['/x/.claude/settings.json', '/x/src/a.ts', '/x/.claude/otra.local', '', undefined]) expect(claveDeMarca(n)).toBeNull()
  })
  it('otro archivo pasa sin tocar (Write, Edit, subagente)', () => {
    expect(evaluarFirma({ tool_name: 'Write', tool_input: { file_path: join(raiz, 'src/a.ts'), content: 'x' } }, ctx()).decision).toBe('pasa')
    expect(evaluarFirma({ tool_name: 'Edit', tool_input: { file_path: join(raiz, 'README.md') }, agent_id: 'a1' }, ctx()).decision).toBe('pasa')
  })
})

describe('quién y cómo', () => {
  it('subagente (agent_id) → deny aunque el contenido sea válido', () => {
    const r = evaluarFirma(write('sha-firmado.local', `#316 ${CABEZA}`, { agent_id: 'agente-1', agent_type: 'general-purpose' }), ctx())
    expect(r.decision).toBe('deny')
    expect(r.motivo).toMatch(/subagente/)
  })
  it('sesión principal con agent_type (--agent) pero sin agent_id → no se trata como subagente', () => {
    expect(evaluarFirma(write('sha-firmado.local', `#316 ${CABEZA}`, { agent_type: 'coordinador' }), ctx()).decision).toBe('ask')
  })
  it('Edit / MultiEdit / NotebookEdit de una marca → deny (se escribe entera con Write)', () => {
    for (const h of ['Edit', 'MultiEdit', 'NotebookEdit']) {
      const r = evaluarFirma({ tool_name: h, tool_input: { file_path: ruta('sha-firmado.local'), old_string: 'a', new_string: `#316 ${CABEZA}` } }, ctx())
      expect(r.decision).toBe('deny')
      expect(r.motivo).toMatch(/Write/)
    }
  })
  it('marca fuera de <raíz>/.claude (worktree, otra carpeta) → deny con la ruta buena', () => {
    for (const p of [join(raiz, '..', 'wt-x', '.claude', 'sha-firmado.local'), join(raiz, 'sha-firmado.local'), join(raiz, 'docs', '.claude', 'sha-firmado.local')]) {
      const r = evaluarFirma({ tool_name: 'Write', tool_input: { file_path: p, content: `#316 ${CABEZA}` } }, ctx())
      expect(r.decision).toBe('deny')
      expect(r.motivo).toContain(ruta('sha-firmado.local'))
    }
    // relativa a la raíz: es la misma ruta → pasa al pedido
    expect(evaluarFirma({ tool_name: 'Write', tool_input: { file_path: '.claude/sha-firmado.local', content: `#316 ${CABEZA}` }, cwd: raiz }, ctx()).decision).toBe('ask')
  })
  it('Bash no escribe la marca, tampoco con el formato nuevo (guardia)', () => {
    const g = { raiz, cwd: raiz, env: {}, ahora: new Date(), ramaActual: () => 'x', consultarPR: () => ({ error: 'no' }), leerArchivo: () => null }
    for (const c of [
      `printf '# Aprobar = x\\n#316 ${CABEZA}\\n' > .claude/sha-firmado.local`,
      `cat > ${ruta('sha-firmado.local')} <<'EOF'\n#316 ${CABEZA}\nEOF`,
      `echo "#316 ${CABEZA}" | tee -a .claude/sha-firmado.local`,
    ]) expect(evaluarBash(c, g)).toMatch(/marca/)
  })
})

describe('SHA firmado', () => {
  it('válido → ask; el dueño ve PR, título y commit; la guardia acepta lo que queda escrito', () => {
    const r = evaluarFirma(write('sha-firmado.local', `#316 ${CABEZA}`), ctx())
    expect(r.decision).toBe('ask')
    expect(r.motivo).toMatch(/FIRMA DEL DUEÑO/)
    expect(r.motivo).toMatch(/#316 «Arreglo de prueba» solo con el commit abcdef12/)
    const texto = r.updatedInput.content as string
    expect(texto).toBe(`# Aprobar = autorizo mergear el PR #316 «Arreglo de prueba» solo con el commit abcdef12. Si el PR cambia, la firma deja de valer.\n#316 ${CABEZA}\n`)
    expect(r.updatedInput.file_path).toBe(ruta('sha-firmado.local'))
    const firmados = shasFirmados(texto)
    expect(firmados).toHaveLength(1) // el comentario no cuenta como firma
    expect(shaFirmadoCoincide(firmados, 316, CABEZA)).toBe(true)
    expect(shaFirmadoCoincide(firmados, 317, CABEZA)).toBe(false)
  })
  it('reescribir: los comentarios viejos se descartan y se regeneran (no se acumulan)', () => {
    const r1 = evaluarFirma(write('sha-firmado.local', `#316 ${CABEZA}`), ctx())
    const r2 = evaluarFirma(write('sha-firmado.local', r1.updatedInput.content), ctx())
    expect(r2.updatedInput.content).toBe(r1.updatedInput.content)
  })
  it('SHA que no es la cabeza actual del PR → deny', () => {
    const r = evaluarFirma(write('sha-firmado.local', '#316 1111111'), ctx())
    expect(r.decision).toBe('deny')
    expect(r.motivo).toMatch(/no es la cabeza actual del PR #316/)
  })
  it('SHA sin número de PR, o línea rara → deny', () => {
    for (const c of [CABEZA, '#316', '#316 zzzzzzz', `#316 ${CABEZA} y algo más`, '316abcdef1']) expect(evaluarFirma(write('sha-firmado.local', c), ctx()).decision).toBe('deny')
  })
  it('sin GitHub → ask igual, avisando que no se pudo confirmar', () => {
    const r = evaluarFirma(write('sha-firmado.local', `#316 ${CABEZA.slice(0, 8)}`), ctx({ pr: { error: 'sin red' } }))
    expect(r.decision).toBe('ask')
    expect(r.motivo).toMatch(/no pude confirmar en GitHub/)
  })
  it('vacía → ask «revoca»', () => {
    const r = evaluarFirma(write('sha-firmado.local', ''), ctx())
    expect(r.decision).toBe('ask')
    expect(r.motivo).toMatch(/revoca/)
    expect(shasFirmados(r.updatedInput.content)).toHaveLength(0)
  })
})

describe('OK del dueño, turno de prod y migración', () => {
  it('OK de hoy → ask con el tramo; la guardia lo acepta; el comentario solo no vale', () => {
    const linea = `${HOY} #316 «dale, mergeá el 316»`
    const r = evaluarFirma(write('ok-dueno-noche.local', linea), ctx())
    expect(r.decision).toBe('ask')
    expect(r.motivo).toMatch(/PR #316 hoy 2026-11-20, de 15:00 a 19:00/)
    expect(okNocheValido(r.updatedInput.content, HOY, 316).ok).toBe(true)
    const soloComentario = (r.updatedInput.content as string).split('\n')[0]
    expect(okNocheValido(soloComentario, HOY, 316).ok).toBe(false)
  })
  it('OK URGENTE → el texto dice que vale hasta 23:30', () => {
    const r = evaluarFirma(write('ok-dueno-noche.local', `${HOY} #316 «URGENTE: se cae el cierre»`), ctx())
    expect(r.motivo).toMatch(/URGENTE: vale también de 19:00 a 23:30/)
  })
  it('OK de otra fecha (UTC de noche) o sin cita → deny', () => {
    expect(evaluarFirma(write('ok-dueno-noche.local', '2026-11-21 #316 «dale, mergeá el 316»'), ctx()).decision).toBe('deny')
    expect(evaluarFirma(write('ok-dueno-noche.local', `${HOY} #316 sin cita`), ctx()).decision).toBe('deny')
    expect(evaluarFirma(write('ok-dueno-noche.local', `${HOY} «dale, mergeá el 316»`), ctx()).decision).toBe('deny')
  })
  it('a las 23:00 CR (05:00 UTC del día siguiente) «hoy» sigue siendo el día CR', () => {
    expect(evaluarFirma(write('ok-dueno-noche.local', `${HOY} #316 «URGENTE dale al 316»`), ctx({ ahora: '2026-11-21T05:00:00Z' })).decision).toBe('ask')
  })
  it('turno de prod de hoy → ask; el comentario no contiene «TURNO DE PROD»', () => {
    const r = evaluarFirma(write('turno-prod.local', `TURNO DE PROD: esta sesión de CC · ${HOY}`), ctx())
    expect(r.decision).toBe('ask')
    expect(r.motivo).toMatch(/PRODUCCIÓN hoy 2026-11-20/)
    const comentario = (r.updatedInput.content as string).split('\n')[0]
    expect(turnoProdValido(comentario, HOY).ok).toBe(false)
    expect(turnoProdValido(r.updatedInput.content, HOY).ok).toBe(true)
    expect(evaluarFirma(write('turno-prod.local', 'TURNO DE PROD · 2026-11-19'), ctx()).decision).toBe('deny')
  })
  it('migración: nombra el archivo encontrado; si no lo encuentra, avisa; la guardia lee el sha', () => {
    const sha = createHash('sha256').update('select 1;\n').digest('hex')
    const r = evaluarFirma(write('migracion-firmada.local', sha), ctx({ migracion: '195_x.sql' }))
    expect(r.decision).toBe('ask')
    expect(r.motivo).toMatch(/la migración 195_x\.sql/)
    expect(migracionesFirmadas(r.updatedInput.content).has(sha)).toBe(true)
    expect(migracionesFirmadas(r.updatedInput.content).size).toBe(1)
    const s = evaluarFirma(write('migracion-firmada.local', `${sha} 196_y.sql`), ctx())
    expect(s.motivo).toMatch(/no la encontré/)
    expect(evaluarFirma(write('migracion-firmada.local', 'abc'), ctx()).decision).toBe('deny')
  })
})

describe('hook por línea de comandos (como lo corre Claude Code)', () => {
  const correr = (entrada: unknown) => spawnSync('node', [FIRMA], {
    input: JSON.stringify(entrada), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: raiz, SATORI_HOOKS_AHORA: '2026-11-20T22:00:00Z' },
  })
  const prod = `TURNO DE PROD: esta sesión de CC · ${HOY}`
  it('otro archivo: exit 0 sin salida', () => {
    const r = correr({ tool_name: 'Write', tool_input: { file_path: join(raiz, 'src/a.ts'), content: 'x' } })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })
  it('sesión principal: exit 0 con permissionDecision «ask», el texto y updatedInput', () => {
    const r = correr(write('turno-prod.local', prod))
    expect(r.status).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(j.hookSpecificOutput.permissionDecision).toBe('ask')
    expect(j.hookSpecificOutput.permissionDecisionReason).toMatch(/FIRMA DEL DUEÑO/)
    expect(j.hookSpecificOutput.updatedInput.content).toContain(prod)
  })
  it('subagente: exit 2 con el motivo en stderr', () => {
    const r = correr(write('turno-prod.local', prod, { agent_id: 'a1' }))
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/subagente/)
  })
})

describe('.claude/settings.json', () => {
  const s = JSON.parse(readFileSync(resolve(__dirname, '../../.claude/settings.json'), 'utf8'))
  it('regla ask anclada a la raíz para las marcas (la que salta el clasificador del modo automático)', () => {
    expect(s.permissions.ask).toContain('Edit(/.claude/*.local)')
  })
  it('ninguna regla allow cubre las marcas', () => {
    for (const r of s.permissions.allow ?? []) expect(r).not.toMatch(/\.local|\.claude/)
  })
  it('el hook de la firma corre antes de Edit/Write/MultiEdit/NotebookEdit y falla cerrado', () => {
    const h = s.hooks.PreToolUse.find((x: { matcher: string }) => /Write/.test(x.matcher))
    expect(h).toBeDefined()
    for (const t of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) expect(new RegExp(`^(?:${h.matcher})$`).test(t)).toBe(true)
    expect(h.hooks[0].command).toMatch(/scripts\/hooks\/firma\.mjs.*\|\| exit 2/)
    expect(h.hooks[0].onFailure).toBe('block')
  })
})
