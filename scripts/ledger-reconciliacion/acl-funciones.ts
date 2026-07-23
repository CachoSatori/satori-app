// Auditoría READ-ONLY de privilegios de las funciones SECURITY DEFINER.
//
//   node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//     scripts/ledger-reconciliacion/acl-funciones.ts staging
//
// POR QUÉ EXISTE (hallazgo 2026-07-23, ver HALLAZGOS.md): `create function` otorga EXECUTE a
// PUBLIC por defecto. Un `revoke execute ... from anon` NO le quita a `anon` lo que hereda de
// PUBLIC → la función queda ejecutable por anónimos igual. El patrón correcto es el de la mig
// 045: `revoke all on function ... from public, anon`.
//
// Cómo leer `proacl`: un item que empieza con `=` (sin rol antes del `=`) ES PUBLIC. Si ves
// `=X/postgres`, PUBLIC tiene EXECUTE y `anon` lo hereda.
//
// Pendiente de B2: correr esto contra PROD para medir `delete_movement_cascade`.

import { abrir, q, smoke } from './comun.ts'

const { entorno, ref, token } = abrir(process.argv)
console.log(`\n╔══ ACL DE FUNCIONES · ${entorno.toUpperCase()} · ${ref} ══╗`)
await smoke(ref, token)

const filas = await q(ref, token, `select p.proname,
    coalesce(array_to_string(p.proacl, ' | '), '(null → PUBLIC por defecto)') as acl,
    p.prosecdef as security_definer,
    has_function_privilege('anon', p.oid, 'execute') as anon_execute,
    has_function_privilege('authenticated', p.oid, 'execute') as auth_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
  order by has_function_privilege('anon', p.oid, 'execute') desc, p.proname`)

console.log(`\n🔐 funciones SECURITY DEFINER en public: ${filas.length}\n`)
const expuestas = filas.filter((f: any) => f.anon_execute)
for (const f of filas) {
  const flag = f.anon_execute ? '🔴' : '✅'
  console.log(`   ${flag} ${String(f.proname).padEnd(30)} anon=${String(f.anon_execute).padEnd(5)} auth=${f.auth_execute}`)
  console.log(`      acl: ${f.acl}`)
}

console.log(`\n📊 ejecutables por anon: ${expuestas.length}/${filas.length}`)
if (expuestas.length) {
  console.log('   → revisar si tienen guard de rol interno; el fix es:')
  console.log('     revoke all on function public.<fn>(<args>) from public, anon;')
}
console.log(`\n╚══ FIN ${entorno.toUpperCase()} — cero escrituras ══╝\n`)
