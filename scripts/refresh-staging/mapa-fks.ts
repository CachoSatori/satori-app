// READ-ONLY: grafo real de FKs + conteos, para planear el vaciado sin adivinar.
// pg_catalog, NO information_schema (ésta no reporta las FKs de este proyecto).

import { leerDeStaging, token } from './gate.ts'
import { loadEnv } from '../t0-reconciliacion-cajas/env.ts'

const tok = token(loadEnv())
const q = async (sql: string) => (await leerDeStaging(sql, tok)) as Record<string, unknown>[]

console.log('\n=== TABLAS DE public CON SUS FILAS ===')
const tablas = await q(`
  select c.relname as tabla, c.reltuples::bigint as aprox
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' order by c.relname`)
const nombres = tablas.map(t => String(t.tabla))
const conteos = (await q(
  'select ' + nombres.map(t => `(select count(*)::int from public."${t}") as "${t}"`).join(', '),
))[0]
for (const t of nombres) console.log(`  ${t.padEnd(30)} ${String(conteos[t]).padStart(7)}`)

console.log('\n=== FKs (hijo → padre · ON DELETE) ===')
const fks = await q(`
  select con.conname,
         hijo.relname  as tabla_hijo,
         padre.relname as tabla_padre,
         con.confdeltype as on_delete
  from pg_constraint con
  join pg_class hijo  on hijo.oid  = con.conrelid
  join pg_class padre on padre.oid = con.confrelid
  join pg_namespace n on n.oid = hijo.relnamespace
  where con.contype = 'f' and n.nspname = 'public'
  order by padre.relname, hijo.relname`)
const ACCION: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' }
for (const f of fks) {
  console.log(`  ${String(f.tabla_hijo).padEnd(28)} → ${String(f.tabla_padre).padEnd(22)} ${ACCION[String(f.on_delete)] ?? f.on_delete}`)
}
console.log()
