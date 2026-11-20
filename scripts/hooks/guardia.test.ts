// Pruebas de la guardia PreToolUse (scripts/hooks/guardia.mjs): cada regla bloquea su caso y deja pasar el vecino.
// El ref de prod NO va escrito acá (src/refProdEnPruebas.test.ts): se importa de la herramienta.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
// @ts-expect-error módulo .mjs sin tipos
import { evaluarBash, evaluarMerge, evaluarD1, evaluarMcpSupabase } from './guardia.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { relojCR, ventanaD1 } from './hora.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { evaluarSQL, esSoloLectura, REF_PROD, REF_STAGING } from './sql.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { comandos } from './shell.mjs'

const GUARDIA = resolve(__dirname, 'guardia.mjs')
const CABEZA = 'abcdef1234567890abcdef1234567890abcdef12'
let raiz: string

type InfoPR = { numero: number, cabeza: string, archivos: string[] } | { error: string }
function ctx(opc: { ahora?: string, env?: Record<string, string>, rama?: string, pr?: InfoPR } = {}) {
  return {
    raiz, cwd: raiz, env: opc.env ?? {},
    ahora: new Date(opc.ahora ?? '2026-11-20T15:00:00Z'), // 09:00 CR: ventana libre
    ramaActual: () => opc.rama ?? 'claude/tema',
    consultarPR: () => opc.pr ?? { numero: 305, cabeza: CABEZA, archivos: ['src/a.ts'] },
    leerArchivo: () => null,
  }
}
function marca(nombre: string, texto: string) { writeFileSync(join(raiz, '.claude', nombre), texto) }

beforeEach(() => { raiz = mkdtempSync(join(tmpdir(), 'guardia-')); mkdirSync(join(raiz, '.claude')) })
afterEach(() => rmSync(raiz, { recursive: true, force: true }))

describe('hora CR y ventana D1 (bordes)', () => {
  const casos: [string, string, string][] = [
    ['2026-11-20T21:49:00Z', '15:49', 'libre'],
    ['2026-11-20T21:50:00Z', '15:50', 'bloqueado'],
    ['2026-11-21T00:59:00Z', '18:59', 'bloqueado'],
    ['2026-11-21T01:00:00Z', '19:00', 'con-ok'],
    ['2026-11-21T05:29:00Z', '23:29', 'con-ok'],
    ['2026-11-21T05:30:00Z', '23:30', 'libre'],
  ]
  for (const [iso, hhmm, ventana] of casos) {
    it(`${hhmm} CR → ${ventana}`, () => {
      const r = relojCR(new Date(iso))
      expect(r.hhmm).toBe(hhmm)
      expect(r.fecha).toBe('2026-11-20') // de noche en CR la fecha UTC ya es el día siguiente
      expect(ventanaD1(r.minutos)).toBe(ventana)
    })
  }
})

describe('merge: regla D1', () => {
  it('15:50–19:00 bloquea aunque haya OK y SHA firmado', () => {
    marca('ok-dueno-noche.local', '2026-11-20 «dale, mergeá el 305»')
    marca('sha-firmado.local', `#305 ${CABEZA}`)
    expect(evaluarD1(ctx({ ahora: '2026-11-20T21:50:00Z' }))).toMatch(/15:50 a 19:00/)
    expect(evaluarD1(ctx({ ahora: '2026-11-20T21:49:00Z' }))).toBeNull()
  })
  it('19:00–23:30 sin OK bloquea; con OK de hoy (fecha CR) y cita pasa', () => {
    const noche = '2026-11-21T01:00:00Z'
    expect(evaluarD1(ctx({ ahora: noche }))).toMatch(/OK del dueño/)
    marca('ok-dueno-noche.local', '2026-11-21 «dale, mergeá el 305»') // fecha UTC: mal
    expect(evaluarD1(ctx({ ahora: noche }))).toMatch(/fecha de hoy \(2026-11-20\)/)
    marca('ok-dueno-noche.local', '2026-11-20 sin cita')
    expect(evaluarD1(ctx({ ahora: noche }))).not.toBeNull()
    marca('ok-dueno-noche.local', '2026-11-20 «dale, mergeá el 305»')
    expect(evaluarD1(ctx({ ahora: noche }))).toBeNull()
    expect(evaluarD1(ctx({ ahora: '2026-11-21T05:29:00Z' }))).toBeNull()
  })
  it('el OK también puede venir por variable de entorno', () => {
    expect(evaluarD1(ctx({ ahora: '2026-11-21T05:29:00Z', env: { SATORI_OK_DUENO_NOCHE: '2026-11-20 "ok del dueño a las 23"' } }))).toBeNull()
  })
  it('23:30 en adelante libre sin OK', () => {
    expect(evaluarD1(ctx({ ahora: '2026-11-21T05:30:00Z' }))).toBeNull()
  })
})

describe('merge: SHA firmado', () => {
  const merge = { selector: '305', repo: 'CachoSatori/satori-app' }
  it('sin SHA firmado bloquea; con el SHA de la cabeza pasa', () => {
    expect(evaluarMerge(merge, ctx())).toMatch(/no es un SHA firmado/)
    marca('sha-firmado.local', `#305 ${CABEZA.slice(0, 8)}`)
    expect(evaluarMerge(merge, ctx())).toBeNull()
  })
  it('SHA firmado de otro commit u otro PR no sirve', () => {
    marca('sha-firmado.local', '#305 1111111\n#306 ' + CABEZA)
    expect(evaluarMerge(merge, ctx())).toMatch(/no es un SHA firmado/)
  })
  it('por variable SATORI_SHA_FIRMADO', () => {
    expect(evaluarMerge(merge, ctx({ env: { SATORI_SHA_FIRMADO: CABEZA } }))).toBeNull()
  })
  it('PR solo de .md: exento del SHA, no de D1', () => {
    const pr = { numero: 305, cabeza: CABEZA, archivos: ['docs/a.md', 'ESTADO.md'] }
    expect(evaluarMerge(merge, ctx({ pr }))).toBeNull()
    expect(evaluarMerge(merge, ctx({ pr, ahora: '2026-11-20T22:00:00Z' }))).toMatch(/D1/)
    expect(evaluarMerge(merge, ctx({ pr: { ...pr, archivos: ['docs/a.md', 'src/a.ts'] } }))).toMatch(/SHA firmado/)
  })
  it('si no se puede leer el PR, no se mergea', () => {
    expect(evaluarMerge(merge, ctx({ pr: { error: 'sin red' } }))).toMatch(/No pude leer el PR/)
  })
  it('detecta las formas de merge por Bash', () => {
    const conFirma = ctx({ ahora: '2026-11-20T22:00:00Z' })
    for (const c of ['gh pr merge 305 --squash', 'gh pr merge --merge https://github.com/CachoSatori/satori-app/pull/305',
      'gh api -X PUT repos/CachoSatori/satori-app/pulls/305/merge', 'gh api repos/CachoSatori/satori-app/pulls/305/merge -f merge_method=squash',
      'cd x && gh pr merge', 'curl -X PUT https://api.github.com/repos/CachoSatori/satori-app/pulls/305/merge']) {
      expect(evaluarBash(c, conFirma), c).toMatch(/D1/)
    }
    expect(evaluarBash('gh api repos/CachoSatori/satori-app/pulls/305/merge', conFirma)).toBeNull() // GET: solo consulta
    expect(evaluarBash('gh pr view 305', conFirma)).toBeNull()
    expect(evaluarBash("gh api graphql -f query='mutation { mergePullRequest(input:{}) { clientMutationId } }'", ctx())).toMatch(/GraphQL/)
  })
})

describe('git push', () => {
  const bloquea = ['git push origin main', 'git push origin HEAD:main', 'git push origin x:refs/heads/main', 'git push origin +claude/x',
    'git push --force origin claude/x', 'git push -f origin claude/x', 'git push -uf origin claude/x', 'git -c push.negotiate=true push origin main',
    'git push --mirror origin', 'git push origin --delete main', 'echo ok && git push origin main']
  for (const c of bloquea) it(`bloquea: ${c}`, () => expect(evaluarBash(c, ctx())).toMatch(/Bloqueado/))
  it('bloquea push sin refspec (o HEAD) estando en main', () => {
    expect(evaluarBash('git push', ctx({ rama: 'main' }))).toMatch(/main/)
    expect(evaluarBash('git push origin HEAD', ctx({ rama: 'main' }))).toMatch(/main/)
  })
  const pasa = ['git -c push.negotiate=true push -u origin claude/settings-hooks', 'git push --force-with-lease origin claude/x',
    'git push origin claude/maintenance', 'git push', 'git push origin HEAD']
  for (const c of pasa) it(`deja pasar: ${c}`, () => expect(evaluarBash(c, ctx())).toBeNull())
})

describe('supabase CLI', () => {
  for (const c of ['supabase db push', 'supabase db push --linked', 'npx supabase db push', 'npx supabase@latest functions deploy club-pase', 'supabase --workdir x functions deploy f', "bash -c 'supabase db push'"])
    it(`bloquea: ${c}`, () => expect(evaluarBash(c, ctx())).toMatch(/Bloqueado: supabase/))
  for (const c of ['supabase db diff', 'npx supabase functions list', 'supabase migration list', 'npx vitest run'])
    it(`deja pasar: ${c}`, () => expect(evaluarBash(c, ctx())).toBeNull())
})

describe('.env y marcas', () => {
  for (const c of ['cat .env', 'cat .env.local', 'grep KEY .env.production', 'source ./.env', 'head -1 club-web/.env', 'node --env-file=.env x.js', 'less < .env', 'cat .env*'])
    it(`bloquea leer: ${c}`, () => expect(evaluarBash(c, ctx())).toMatch(/\.env/))
  for (const c of ['ls -la .env', 'test -f .env.local', 'node -e "console.log(process.env.X)"', 'grep -r import.meta.env src', 'cat src/environment.ts'])
    it(`deja pasar: ${c}`, () => expect(evaluarBash(c, ctx())).toBeNull())
  for (const c of ['echo "#305 abcdef1" > .claude/sha-firmado.local', 'printf x >> .claude/turno-prod.local', 'tee .claude/ok-dueno-noche.local < x', 'cp a .claude/turno-prod.local'])
    it(`bloquea escribir la marca: ${c}`, () => expect(evaluarBash(c, ctx())).toMatch(/marca/))
  it('leer o borrar la marca sí', () => {
    expect(evaluarBash('cat .claude/turno-prod.local', ctx())).toBeNull()
    expect(evaluarBash('rm .claude/turno-prod.local', ctx())).toBeNull()
  })
})

describe('SQL: drop / delete / truncate solo dentro de begin … rollback', () => {
  const bloquea = ['delete from t', 'drop table t', 'truncate t', 'begin; delete from t; commit;', 'begin; delete from t;',
    'with x as (delete from t returning *) select * from x', "do $$ begin delete from t; end $$", 'alter table t drop column c',
    'begin; select 1; rollback; delete from t;']
  for (const s of bloquea) it(`bloquea: ${s}`, () => expect(evaluarSQL(s)).not.toBeNull())
  const pasa = ['select 1', 'begin; delete from t; rollback;', 'BEGIN READ ONLY; drop table t; ROLLBACK;', "select 'delete from t'",
    '-- drop table t\nselect 1', 'create table t (id int references u on delete cascade)', 'create policy p on t for delete using (true)',
    'grant select, delete on t to authenticated', 'create function f() returns void as $$ delete from t $$ language sql',
    'begin; savepoint a; delete from t; rollback to savepoint a; rollback;', 'select deleted_at from t']
  for (const s of pasa) it(`deja pasar: ${s}`, () => expect(evaluarSQL(s)).toBeNull())
  it('lectura vs escritura', () => {
    expect(esSoloLectura('select * from t; with a as (select 1) select * from a')).toBe(true)
    expect(esSoloLectura('begin read only; select 1; rollback;')).toBe(true)
    for (const s of ['insert into t values (1)', 'update t set a = 1', 'create table t (a int)', "select cron.schedule('x', '* * * * *', 'select 1')", 'select set_config(\'a\', \'b\', false)'])
      expect(esSoloLectura(s), s).toBe(false)
  })
})

describe('SQL por Bash (Management API, psql, PostgREST)', () => {
  const api = (ref: string, q: string) => `curl -s -X POST https://api.supabase.com/v1/projects/${ref}/database/query -H "Authorization: Bearer $T" -d '${JSON.stringify({ query: q })}'`
  it('staging: delete fuera de rollback bloquea, dentro pasa', () => {
    expect(evaluarBash(api(REF_STAGING, 'delete from t'), ctx())).toMatch(/fuera de begin/)
    expect(evaluarBash(api(REF_STAGING, 'begin; delete from t; rollback;'), ctx())).toBeNull()
  })
  it('prod: leer pasa sin turno; escribir pide el turno de prod de hoy', () => {
    expect(evaluarBash(api(REF_PROD, 'select count(*) from t'), ctx())).toBeNull()
    expect(evaluarBash(api(REF_PROD, 'update t set a = 1'), ctx())).toMatch(/turno de prod/)
    marca('turno-prod.local', 'TURNO DE PROD: esta sesión de CC · 2026-11-19')
    expect(evaluarBash(api(REF_PROD, 'update t set a = 1'), ctx())).toMatch(/turno de prod/)
    marca('turno-prod.local', 'TURNO DE PROD: esta sesión de CC · 2026-11-20')
    expect(evaluarBash(api(REF_PROD, 'update t set a = 1'), ctx())).toBeNull()
    expect(evaluarBash(api(REF_PROD, 'delete from t'), ctx())).toMatch(/fuera de begin/) // el turno no habilita borrar
  })
  it('ref no literal bloquea (regla 7)', () => {
    expect(evaluarBash(api('$REF', 'select 1'), ctx())).toMatch(/no es literal/)
  })
  it('cuerpo ilegible con drop/delete bloquea; heredoc se lee', () => {
    expect(evaluarBash(`curl -X POST https://api.supabase.com/v1/projects/${REF_STAGING}/database/query -d "$BODY"`, ctx())).toBeNull()
    expect(evaluarBash(`Q="delete from t"; curl -X POST https://api.supabase.com/v1/projects/${REF_STAGING}/database/query -d "{\\"query\\":\\"$Q\\"}"`, ctx())).toMatch(/delete/)
    const heredoc = `curl -X POST https://api.supabase.com/v1/projects/${REF_STAGING}/database/query --data-binary @- <<'JSON'\n{"query":"truncate t"}\nJSON`
    expect(evaluarBash(heredoc, ctx())).toMatch(/truncate/)
  })
  it('psql a Supabase y DELETE por PostgREST', () => {
    expect(evaluarBash(`psql "postgresql://postgres@db.${REF_STAGING}.supabase.co:5432/postgres" -c "drop table t"`, ctx())).toMatch(/drop/)
    expect(evaluarBash('psql -h localhost -c "drop table t"', ctx())).toBeNull() // base local de las baterías
    expect(evaluarBash(`curl -X DELETE "https://${REF_STAGING}.supabase.co/rest/v1/t?id=eq.1"`, ctx())).toMatch(/PostgREST/)
  })
})

describe('herramientas MCP de Supabase', () => {
  const sql = (ref: string, query: string) => ({ project_id: ref, query })
  it('execute_sql: prod lectura pasa, escritura pide turno; destructivo bloquea siempre', () => {
    expect(evaluarMcpSupabase('mcp__Supabase__execute_sql', sql(REF_PROD, 'select 1'), ctx())).toBeNull()
    expect(evaluarMcpSupabase('mcp__Supabase__execute_sql', sql(REF_PROD, 'insert into t values (1)'), ctx())).toMatch(/turno de prod/)
    expect(evaluarMcpSupabase('mcp__Supabase__execute_sql', sql(REF_STAGING, 'drop table t'), ctx())).toMatch(/drop/)
    expect(evaluarMcpSupabase('mcp__Supabase__execute_sql', sql(REF_STAGING, 'begin; drop table t; rollback;'), ctx())).toBeNull()
  })
  it('apply_migration y deploy_edge_function contra prod piden turno; lecturas no', () => {
    expect(evaluarMcpSupabase('mcp__Supabase__apply_migration', { project_id: REF_PROD, name: 'x', query: 'create table t (a int)' }, ctx())).toMatch(/turno de prod/)
    expect(evaluarMcpSupabase('mcp__Supabase__deploy_edge_function', { project_id: REF_PROD, name: 'f' }, ctx())).toMatch(/turno de prod/)
    expect(evaluarMcpSupabase('mcp__Supabase__deploy_edge_function', { project_id: REF_STAGING, name: 'f' }, ctx())).toBeNull()
    expect(evaluarMcpSupabase('mcp__Supabase__list_tables', { project_id: REF_PROD }, ctx())).toBeNull()
    expect(evaluarMcpSupabase('mcp__Supabase__get_logs', { project_id: REF_PROD }, ctx())).toBeNull()
    marca('turno-prod.local', 'TURNO DE PROD · 2026-11-20')
    expect(evaluarMcpSupabase('mcp__Supabase__deploy_edge_function', { project_id: REF_PROD, name: 'f' }, ctx())).toBeNull()
  })
  it('SATORI_ENTORNO=staging-agentes: todo lo que no sea staging se niega (lectura incluida), y sin merges', () => {
    const env = { SATORI_ENTORNO: 'staging-agentes' }
    expect(evaluarMcpSupabase('mcp__Supabase__list_tables', { project_id: REF_PROD }, ctx({ env }))).toMatch(/staging-agentes/)
    expect(evaluarMcpSupabase('mcp__Supabase__execute_sql', sql(REF_PROD, 'select 1'), ctx({ env }))).toMatch(/staging-agentes/)
    expect(evaluarMcpSupabase('mcp__Supabase__list_projects', {}, ctx({ env }))).toMatch(/staging-agentes/)
    expect(evaluarMcpSupabase('mcp__Supabase__execute_sql', sql(REF_STAGING, 'select 1'), ctx({ env }))).toBeNull()
    expect(evaluarMcpSupabase('mcp__Supabase__list_tables', { project_id: REF_PROD }, ctx())).toBeNull() // sin la variable, leer prod pasa
    marca('sha-firmado.local', `#305 ${CABEZA}`)
    expect(evaluarBash('gh pr merge 305', ctx({ env }))).toMatch(/staging-agentes/)
    expect(evaluarBash('gh pr merge 305', ctx())).toBeNull()
    expect(evaluarBash(`curl -X POST https://api.supabase.com/v1/projects/${REF_PROD}/database/query -d '{"query":"select 1"}'`, ctx({ env }))).toMatch(/staging-agentes/)
    expect(evaluarBash('git push origin main', ctx({ env }))).toMatch(/Bloqueado/)
  })
})

describe('lector de shell', () => {
  it('parte por operadores y entra en bash -c y $(…)', () => {
    const c = comandos(`echo "a;b" && bash -c 'git push origin main' | cat; x=$(gh pr merge 1)`)
    const progs = c.map((s: { palabras: string[] }) => s.palabras[0])
    expect(progs).toEqual(expect.arrayContaining(['echo', 'bash', 'cat', 'git', 'gh']))
  })
})

describe('CLI (exit codes reales)', () => {
  function correr(entrada: object, env: Record<string, string> = {}) {
    return spawnSync('node', [GUARDIA], {
      input: JSON.stringify(entrada), encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', CLAUDE_PROJECT_DIR: raiz, SATORI_HOOKS_AHORA: '2026-11-20T15:00:00Z', ...env },
    })
  }
  it('bloquea con exit 2 y el motivo en stderr', () => {
    const r = correr({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd: raiz })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/\[satori guardia\].*main/)
  })
  it('deja pasar con exit 0', () => {
    expect(correr({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: raiz }).status).toBe(0)
    expect(correr({ tool_name: 'mcp__Supabase__list_tables', tool_input: { project_id: REF_PROD }, cwd: raiz }).status).toBe(0)
  })
  it('MCP con staging-agentes: exit 2 fuera de staging', () => {
    const r = correr({ tool_name: 'mcp__Supabase__get_project', tool_input: { project_id: REF_PROD }, cwd: raiz }, { SATORI_ENTORNO: 'staging-agentes' })
    expect(r.status).toBe(2)
  })
  it('merge en 15:50–19:00 por CLI: exit 2 sin consultar GitHub', () => {
    const r = correr({ tool_name: 'Bash', tool_input: { command: 'gh pr merge 305' }, cwd: raiz }, { SATORI_HOOKS_AHORA: '2026-11-20T22:30:00Z' })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/D1/)
  })
})
