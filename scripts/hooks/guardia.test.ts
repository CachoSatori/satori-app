// Pruebas de la guardia PreToolUse (scripts/hooks/guardia.mjs): cada regla bloquea su caso y deja pasar el vecino.
// El ref de prod NO va escrito acá (src/refProdEnPruebas.test.ts): se importa de la herramienta.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
// @ts-expect-error módulo .mjs sin tipos
import { evaluarBash, evaluarMerge, evaluarMcpSupabase, rutasDeArchivo, psqlRemoto } from './guardia.mjs'
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

describe('hora CR y ventana D1 (bordes; regla del 20-nov)', () => {
  const casos: [string, string, string][] = [
    ['2026-11-20T20:59:00Z', '14:59', 'libre'],
    ['2026-11-20T21:00:00Z', '15:00', 'con-ok'],
    ['2026-11-21T00:59:00Z', '18:59', 'con-ok'],
    ['2026-11-21T01:00:00Z', '19:00', 'urgente'],
    ['2026-11-21T05:29:00Z', '23:29', 'urgente'],
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
  const merge = { selector: '305', repo: 'CachoSatori/satori-app', cabezaPedida: CABEZA }
  const OK = '2026-11-20 #305 «dale, mergeá el 305»'
  const URGENTE = '2026-11-20 #305 «URGENTE: se cae el cierre, mergeá el 305»'
  beforeEach(() => marca('sha-firmado.local', `#305 ${CABEZA}`))
  it('14:59 libre sin OK; 15:00 pide OK', () => {
    expect(evaluarMerge(merge, ctx({ ahora: '2026-11-20T20:59:00Z' }))).toBeNull()
    expect(evaluarMerge(merge, ctx({ ahora: '2026-11-20T21:00:00Z' }))).toMatch(/15:00 a 19:00.*OK/)
    marca('ok-dueno-noche.local', OK)
    expect(evaluarMerge(merge, ctx({ ahora: '2026-11-20T21:00:00Z' }))).toBeNull()
  })
  it('18:59 con OK pasa; 19:00 con el mismo OK no: pide URGENTE', () => {
    marca('ok-dueno-noche.local', OK)
    expect(evaluarMerge(merge, ctx({ ahora: '2026-11-21T00:59:00Z' }))).toBeNull()
    expect(evaluarMerge(merge, ctx({ ahora: '2026-11-21T01:00:00Z' }))).toMatch(/URGENTE/)
    marca('ok-dueno-noche.local', '2026-11-20 #305 URGENTE «dale, mergeá el 305»') // URGENTE fuera de la cita: no
    expect(evaluarMerge(merge, ctx({ ahora: '2026-11-21T01:00:00Z' }))).toMatch(/URGENTE/)
    marca('ok-dueno-noche.local', URGENTE)
    expect(evaluarMerge(merge, ctx({ ahora: '2026-11-21T01:00:00Z' }))).toBeNull()
    expect(evaluarMerge(merge, ctx({ ahora: '2026-11-21T05:29:00Z' }))).toBeNull()
  })
  it('23:29 sin URGENTE bloquea; 23:30 libre sin OK', () => {
    expect(evaluarMerge(merge, ctx({ ahora: '2026-11-21T05:29:00Z' }))).toMatch(/D1/)
    expect(evaluarMerge(merge, ctx({ ahora: '2026-11-21T05:30:00Z' }))).toBeNull()
  })
  it('el OK vale solo con la fecha CR de hoy, el número del PR y la cita', () => {
    const tarde = '2026-11-20T22:00:00Z'
    marca('ok-dueno-noche.local', '2026-11-21 #305 «dale, mergeá el 305»') // fecha UTC: mal
    expect(evaluarMerge(merge, ctx({ ahora: tarde }))).toMatch(/2026-11-20/)
    marca('ok-dueno-noche.local', '2026-11-20 #305 sin cita')
    expect(evaluarMerge(merge, ctx({ ahora: tarde }))).not.toBeNull()
    marca('ok-dueno-noche.local', '2026-11-20 #306 «dale, mergeá el 306»') // OK de otro PR
    expect(evaluarMerge(merge, ctx({ ahora: tarde }))).toMatch(/#305/)
    marca('ok-dueno-noche.local', '2026-11-20 #3050 «dale, mergeá el 3050»') // prefijo de otro número
    expect(evaluarMerge(merge, ctx({ ahora: tarde }))).toMatch(/#305/)
  })
  it('el OK también puede venir por variable de entorno', () => {
    expect(evaluarMerge(merge, ctx({ ahora: '2026-11-21T05:29:00Z', env: { SATORI_OK_DUENO_NOCHE: '2026-11-20 #305 "URGENTE ok del dueño"' } }))).toBeNull()
  })
  it('PR solo de .md: sin OK solo de 23:30 a 15:00; fuera, regla general', () => {
    const pr = { numero: 305, cabeza: CABEZA, archivos: ['docs/a.md'] }
    marca('sha-firmado.local', '')
    expect(evaluarMerge(merge, ctx({ pr, ahora: '2026-11-20T20:59:00Z' }))).toBeNull()
    expect(evaluarMerge(merge, ctx({ pr, ahora: '2026-11-21T05:30:00Z' }))).toBeNull()
    expect(evaluarMerge(merge, ctx({ pr, ahora: '2026-11-20T21:00:00Z' }))).toMatch(/OK/)
    expect(evaluarMerge(merge, ctx({ pr, ahora: '2026-11-21T01:00:00Z' }))).toMatch(/URGENTE/)
    marca('ok-dueno-noche.local', OK)
    expect(evaluarMerge(merge, ctx({ pr, ahora: '2026-11-20T21:00:00Z' }))).toBeNull()
  })
})

describe('merge: SHA firmado y cabeza fijada', () => {
  const merge = { selector: '305', repo: 'CachoSatori/satori-app', cabezaPedida: CABEZA.slice(0, 8) }
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
  it('sin --match-head-commit, o con otro SHA, bloquea', () => {
    marca('sha-firmado.local', `#305 ${CABEZA}`)
    expect(evaluarMerge({ ...merge, cabezaPedida: null }, ctx())).toMatch(/match-head-commit/)
    expect(evaluarMerge({ ...merge, cabezaPedida: '1234567' }, ctx())).toMatch(/no es la cabeza/)
  })
  it('PR solo de .md: exento del SHA firmado, no de D1 ni de fijar la cabeza', () => {
    const pr = { numero: 305, cabeza: CABEZA, archivos: ['docs/a.md', 'ESTADO.md'] }
    expect(evaluarMerge(merge, ctx({ pr }))).toBeNull()
    expect(evaluarMerge(merge, ctx({ pr, ahora: '2026-11-20T22:00:00Z' }))).toMatch(/D1/)
    expect(evaluarMerge({ ...merge, cabezaPedida: null }, ctx({ pr }))).toMatch(/match-head-commit/)
    expect(evaluarMerge(merge, ctx({ pr: { ...pr, archivos: ['docs/a.md', 'src/a.ts'] } }))).toMatch(/SHA firmado/)
  })
  it('si no se puede leer el PR, no se mergea', () => {
    expect(evaluarMerge(merge, ctx({ pr: { error: 'sin red' } }))).toMatch(/No pude leer el PR/)
  })
  it('detecta las formas de merge por Bash y lee la cabeza pedida', () => {
    marca('sha-firmado.local', `#305 ${CABEZA}`)
    const c = ctx()
    expect(evaluarBash('gh pr merge 305 --squash', c)).toMatch(/match-head-commit/)
    expect(evaluarBash(`gh pr merge 305 --squash --match-head-commit ${CABEZA}`, c)).toBeNull()
    expect(evaluarBash(`gh pr merge --merge https://github.com/CachoSatori/satori-app/pull/305 --match-head-commit=${CABEZA}`, c)).toBeNull()
    expect(evaluarBash('gh api -X PUT repos/CachoSatori/satori-app/pulls/305/merge', c)).toMatch(/match-head-commit/)
    expect(evaluarBash(`gh api repos/CachoSatori/satori-app/pulls/305/merge -f merge_method=squash -f sha=${CABEZA}`, c)).toBeNull()
    expect(evaluarBash('gh api repos/CachoSatori/satori-app/pulls/305/merge', c)).toBeNull() // GET: solo consulta
    expect(evaluarBash('gh pr view 305', c)).toBeNull()
    const tarde = ctx({ ahora: '2026-11-20T22:00:00Z' })
    expect(evaluarBash(`cd x && gh pr merge --match-head-commit ${CABEZA}`, tarde)).toMatch(/D1/)
  })
  it('bloquea --auto, curl a la API y GraphQL', () => {
    marca('sha-firmado.local', `#305 ${CABEZA}`)
    expect(evaluarBash(`gh pr merge 305 --auto --match-head-commit ${CABEZA}`, ctx())).toMatch(/--auto/)
    expect(evaluarBash('curl -X PUT https://api.github.com/repos/CachoSatori/satori-app/pulls/305/merge', ctx())).toMatch(/curl/)
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
  for (const c of ['supabase db reset --linked', 'npx supabase db reset --db-url=postgresql://x', 'supabase db push', 'supabase db push --linked', 'npx supabase db push', 'npx supabase@latest functions deploy club-pase', 'supabase --workdir x functions deploy f', "bash -c 'supabase db push'"])
    it(`bloquea: ${c}`, () => expect(evaluarBash(c, ctx())).toMatch(/Bloqueado: supabase/))
  for (const c of ['supabase db reset', 'supabase db diff', 'npx supabase functions list', 'supabase migration list', 'npx vitest run'])
    it(`deja pasar: ${c}`, () => expect(evaluarBash(c, ctx())).toBeNull())
})

describe('.env y marcas', () => {
  for (const c of ['cat .env', 'cat .env.local', 'grep KEY .env.production', 'grep -e KEY .env', 'rg x club-web/.env', 'cat "$HOME/x/.env"', 'cat $CLAUDE_PROJECT_DIR/.env.local', 'cat ${HOME}/.env', 'source ./.env', 'head -1 club-web/.env', 'node --env-file=.env x.js', 'less < .env', 'cat .env*'])
    it(`bloquea leer: ${c}`, () => expect(evaluarBash(c, ctx())).toMatch(/\.env/))
  for (const c of ['ls -la .env', 'test -f .env.local', 'node -e "console.log(process.env.X)"', 'grep -r import.meta.env src', 'cat src/environment.ts',
    'grep -rn ".env" src', "rg '.env' src", 'cat .env.example', "sed -n '/.env/p' docs/x.md", 'grep -e foo src'])
    it(`deja pasar: ${c}`, () => expect(evaluarBash(c, ctx())).toBeNull())
  for (const c of ['echo "{}" > .claude/settings.local.json', 'cp x.json .claude/settings.json', "sed -i 's/a/b/' .claude/settings.local.json",
    'echo "abc" >> .claude/migracion-firmada.local', 'echo "#305 abcdef1" > .claude/sha-firmado.local', 'printf x >> .claude/turno-prod.local', 'tee .claude/ok-dueno-noche.local < x', 'cp a .claude/turno-prod.local'])
    it(`bloquea escribir la marca: ${c}`, () => expect(evaluarBash(c, ctx())).toMatch(/marca/))
  it('rutasDeArchivo salta el patrón de grep salvo con -e', () => {
    expect(rutasDeArchivo('grep', ['-rn', '.env', 'src'])).toEqual(['src'])
    expect(rutasDeArchivo('grep', ['-e', 'x', '.env'])).toEqual(['x', '.env'])
  })
  for (const c of ['git diff .claude/settings.json', 'jq . .claude/settings.json', 'cat .claude/settings.local.json', 'cp .claude/settings.json /tmp/copia.json', 'grep deny .claude/settings.json'])
    it(`leer la configuración sí: ${c}`, () => expect(evaluarBash(c, ctx())).toBeNull())
  for (const c of ['tee .claude/settings.json < x', 'mv x.json .claude/settings.local.json', 'rm .claude/settings.json', 'git checkout -- .claude/settings.json', 'cp nuevo.json .claude/settings.json'])
    it(`escribir la configuración no: ${c}`, () => expect(evaluarBash(c, ctx())).toMatch(/configuración/))
  it('leer o borrar la marca sí', () => {
    expect(evaluarBash('cat .claude/turno-prod.local', ctx())).toBeNull()
    expect(evaluarBash('rm .claude/turno-prod.local', ctx())).toBeNull()
  })
})

describe('SQL: drop / delete / truncate solo dentro de begin … rollback', () => {
  const bloquea = ['delete from t', 'drop table t', 'truncate t', 'begin; delete from t; commit;', 'begin; delete from t;',
    'with x as (delete from t returning *) select * from x', "do $$ begin delete from t; end $$", 'alter table t drop column c',
    'begin; select 1; rollback; delete from t;', "do $$ begin execute 'drop table t'; end $$", "do $f$ begin execute format('delete from %I', 't'); end $f$"]
  for (const s of bloquea) it(`bloquea: ${s}`, () => expect(evaluarSQL(s)).not.toBeNull())
  const pasa = ['select 1', 'begin; delete from t; rollback;', 'BEGIN READ ONLY; drop table t; ROLLBACK;', "select 'delete from t'",
    '-- drop table t\nselect 1', 'create table t (id int references u on delete cascade)', 'create policy p on t for delete using (true)',
    'grant select, delete on t to authenticated', 'create function f() returns void as $$ delete from t $$ language sql',
    'begin; savepoint a; delete from t; rollback to savepoint a; rollback;', 'select deleted_at from t',
    "do $$ begin execute 'select 1'; end $$", "begin; do $$ begin execute 'drop table t'; end $$; rollback;"]
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
  it('ref no literal: escribir bloquea (regla 7), leer pasa', () => {
    expect(evaluarBash(api('$REF', 'update t set a = 1'), ctx())).toMatch(/no es literal/)
    expect(evaluarBash(api('$REF', 'select 1'), ctx())).toBeNull()
  })
  it('migración firmada: el sha256 exacto del .sql habilita su drop policy if exists; otro sha no', () => {
    const sql = 'drop policy if exists p on t;\ncreate policy p on t for select using (true);\n'
    const sha = createHash('sha256').update(sql).digest('hex')
    const mcp = { project_id: REF_STAGING, name: 'm', query: sql }
    expect(evaluarMcpSupabase('mcp__Supabase__apply_migration', mcp, ctx())).toMatch(/migración firmada/)
    marca('migracion-firmada.local', `${'0'.repeat(64)} otra.sql`)
    expect(evaluarMcpSupabase('mcp__Supabase__apply_migration', mcp, ctx())).toMatch(/migración firmada/)
    marca('migracion-firmada.local', `${sha} 195_x.sql`)
    expect(evaluarMcpSupabase('mcp__Supabase__apply_migration', mcp, ctx())).toBeNull()
    expect(evaluarMcpSupabase('mcp__Supabase__apply_migration', { ...mcp, query: sql.trimEnd() }, ctx())).toBeNull() // sin el salto final
    expect(evaluarMcpSupabase('mcp__Supabase__apply_migration', { ...mcp, query: sql + 'drop table t;' }, ctx())).toMatch(/migración firmada/)
    expect(evaluarMcpSupabase('mcp__Supabase__apply_migration', { ...mcp, project_id: REF_PROD }, ctx())).toMatch(/turno de prod/) // la firma no da turno
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
    expect(evaluarBash('psql -c "drop table t"', ctx())).toBeNull() // socket local
    expect(evaluarBash('psql "$DB_URL" -c "drop table t"', ctx())).toMatch(/drop|literal/)
    expect(evaluarBash('psql "$DB_URL" -c "update t set a = 1"', ctx())).toMatch(/no es literal/)
    expect(evaluarBash('psql "$DB_URL" -c "select 1"', ctx())).toBeNull()
    expect(evaluarBash('psql postgresql://u@db.ejemplo.test/x -c "truncate t"', ctx())).toMatch(/truncate|literal/)
    expect(evaluarBash('psql -h 10.0.0.5 -c "delete from t"', ctx())).not.toBeNull()
    expect(evaluarBash('PGHOST=db.ejemplo.test psql -c "delete from t"', ctx())).not.toBeNull()
    expect(evaluarBash('DATABASE_URL=x psql -c "update t set a = 1"', ctx())).toMatch(/literal/)
    expect(evaluarBash(`env PGHOST=db.${REF_STAGING}.supabase.co psql -c "drop table t"`, ctx())).toMatch(/drop/)
    expect(evaluarBash('PGHOST=localhost psql -c "drop table t"', ctx())).toBeNull()
    expect(psqlRemoto([], ['PGPASSWORD=x'])).toBe(false)
    expect(psqlRemoto([], ['PGHOST=10.0.0.5'])).toBe(true)
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
    expect(evaluarBash(`gh pr merge 305 --match-head-commit ${CABEZA}`, ctx({ env }))).toMatch(/staging-agentes/)
    expect(evaluarBash(`gh pr merge 305 --match-head-commit ${CABEZA}`, ctx())).toBeNull()
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
  it('merge por CLI con gh que falla: exit 2 (sin verificar no se mergea)', () => {
    mkdirSync(join(raiz, 'bin'))
    writeFileSync(join(raiz, 'bin', 'gh'), '#!/usr/bin/env bash\necho "sin red" >&2\nexit 1\n', { mode: 0o755 })
    const r = correr({ tool_name: 'Bash', tool_input: { command: `gh pr merge 305 --match-head-commit ${CABEZA}` }, cwd: raiz }, { PATH: `${join(raiz, 'bin')}:${process.env.PATH ?? ''}` })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/No pude leer el PR/)
  })
})
