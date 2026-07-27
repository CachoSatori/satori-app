// Backup READ-ONLY del ledger. Es la red de seguridad ANTES de cualquier `repair`/`UPDATE`.
//
//   node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
//     scripts/ledger-reconciliacion/backup.ts staging preB2
//
// Escribe `_handoff/ledger-<entorno>-<sufijo>.json`. Para prod: T0_PROD_FIRMADO=<fecha>
// T0_FIRMA_ESPERADA=<fecha> (ver comun.ts).

import { abrir, q, smoke, SQL_LEDGER, REPO } from './comun.ts'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const { entorno, ref, token } = abrir(process.argv)
const sufijo = (process.argv[3] || 'snapshot').trim()

const msg = await smoke(ref, token)
const filas = await q(ref, token, SQL_LEDGER)

const salida = resolve(REPO, `_handoff/ledger-${entorno}-${sufijo}.json`)
writeFileSync(salida, JSON.stringify({
  entorno, ref, momento: sufijo,
  fuente: 'supabase_migrations.schema_migrations',
  smoke_read_only: msg.slice(0, 160),
  total: filas.length, filas,
}, null, 2) + '\n')

console.log(`📒 ${filas.length} filas: ${filas.map((f: any) => f.version).join(', ')}`)
console.log(`💾 → ${salida}`)
