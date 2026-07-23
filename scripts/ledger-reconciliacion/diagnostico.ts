// Diagnóstico READ-ONLY del ledger: qué registra `schema_migrations` vs qué está REALMENTE
// aplicado en la base, verificado por OBJETO/PRIVILEGIO (nunca por el ledger, que es justo lo
// que está en duda). Es el script que produjo el mapa de la Fase A.
//
//   node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//     scripts/ledger-reconciliacion/diagnostico.ts staging
//
// Para prod: T0_PROD_FIRMADO=<fecha> T0_FIRMA_ESPERADA=<fecha> (ver comun.ts).

import { abrir, q, smoke, SQL_LEDGER } from './comun.ts'

const { entorno, ref, token } = abrir(process.argv)
console.log(`\n╔══ DIAGNÓSTICO DEL LEDGER · ${entorno.toUpperCase()} · ${ref} ══╗`)
await smoke(ref, token)

const ledger = await q(ref, token, SQL_LEDGER)
console.log(`\n📒 LEDGER — ${ledger.length} filas:`)
console.log(`   ${ledger.map((r: any) => r.version).join(', ')}`)

const T = (t: string) => `exists(select 1 from information_schema.tables where table_schema='public' and table_name='${t}')`
const C = (t: string, c: string) => `exists(select 1 from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='${c}')`
const F = (f: string) => `exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${f}')`

// Cada sonda = un objeto que crea esa migración. Verde ⇒ la migración está aplicada de verdad,
// diga lo que diga el ledger.
const [s] = await q(ref, token, `select
  ${T('employees')} as m001_employees, ${F('get_my_role')} as m001_fn_get_my_role,
  ${C('tip_sessions', 'pool_efectivo_crc')} as m002_pool_efectivo,
  ${T('customers')} as m004_customers, ${T('loyalty_config')} as m005_loyalty,
  ${T('finance_accounts')} as m006_finance, ${C('profiles', 'email')} as m009_profiles_email,
  ${C('cash_movements', 'account_id')} as m015_account_id, ${T('documents')} as m016_documents,
  ${T('ingredient_prices')} as m017_ingredient_prices, ${T('cash_cierres_dia')} as m018_cierres_dia,
  ${F('verify_manager')} as m019_fn_verify_manager,
  ${T('sops')} as m0095_sops,
  ${C('cash_movements', 'factura_verified_by')} as m038_col, ${F('mark_factura_verified')} as m038_fn,
  ${T('movement_deletions')} as m039_tbl, ${F('delete_movement_cascade')} as m039_fn,
  ${T('inventory_review_task')} as m040_tbl, ${C('cash_movements', 'classification')} as m041_col,
  ${T('accounting_entries')} as m042_tbl, ${F('post_accounting_entry')} as m042_fn,
  ${F('complete_inventory_review')} as m043_fn,
  ${C('movement_deletions', 'authorized_by')} as m044_col,
  (select max(p.pronargs) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='delete_movement_cascade') as m044_nargs,
  ${F('verify_manager_password')} as m045_fn,
  ${C('tip_sessions', 'pool_barra_electronico_crc')} as m046_col,
  ${C('role_tip_points', 'recibe_propina')} as m048_col,
  ${C('tip_sessions', 'pool_pos_crc')} as m035_col, ${F('sync_pos_tips_to_pool')} as m035_fn,
  ${C('cash_movements', 'attachments')} as m026_attachments,
  exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
         where t.typname='user_role' and e.enumlabel='proveedor') as m026_enum_proveedor,
  ${T('pos_orders')} as pos_orders, ${T('pos_payments')} as pos_payments`)

console.log('\n🔬 SONDAS (aplicación REAL por objeto):')
for (const [k, v] of Object.entries(s ?? {})) {
  console.log(`   ${k.padEnd(24)} ${v === true ? '✅' : v === false ? '❌' : `→ ${v}`}`)
}

// El subset core de la 026 vive en el schema `storage` → consulta aparte por si no es legible.
try {
  const b = await q(ref, token, `select id, public from storage.buckets where id = 'facturas'`)
  console.log(`\n🪣 bucket 'facturas': ${b.length ? `✅ existe (public=${b[0].public})` : '❌ no existe'}`)
  const p = await q(ref, token, `select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'facturas%' order by policyname`)
  console.log(`   políticas: ${p.map((r: any) => r.policyname).join(', ') || '(ninguna)'}`)
} catch (e) {
  console.log(`\n🪣 bucket 'facturas': ⚠️ ${(e as Error).message.slice(0, 120)}`)
}

console.log(`\n╚══ FIN ${entorno.toUpperCase()} — cero escrituras ══╝\n`)
