// Sube los PDF de los SoP y los dos libros al bucket privado `documents` y guarda
// `sops.pdf_path`. Lo corre una persona en su computadora: necesita la llave
// service_role del entorno, que nunca se commitea ni se imprime.
//
//   export SUPABASE_SERVICE_ROLE_KEY=...      # Supabase → Project Settings → API (del entorno elegido)
//   node scripts/sync_sops/subir_pdfs.ts \
//     --paquete "<carpeta paquete app SoP>" \
//     --pdfs "<carpeta Satori - Documentos noviembre 2026>" \
//     [--entorno staging] [--aplicar]
//
// · Sin --aplicar es un ensayo: muestra qué subiría y qué falta. No sube nada.
// · Rutas: sops/<versión>/<código>.pdf · sops/libros/libro-empleado.pdf ·
//   sops/libros/franquicia/libro-franquicia.pdf (este último solo lo leen owner y manager, mig 077).
// · Sube con upsert (se puede repetir) y después hace UPDATE de pdf_path por código.
// · PROD exige además --confirmo-prod.

import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { EntradaIndice } from './lib.ts'
import { rutaPdfSop, LIBROS } from './pdfs.ts'

const REFS = { staging: 'hwiatgicyyqyezqwldia', prod: 'yiczgdtirrkdvohdquzf' } as const
type Entorno = keyof typeof REFS

function args() {
  const a = process.argv.slice(2)
  const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined }
  const entorno = (val('--entorno') ?? 'staging') as Entorno
  if (!(entorno in REFS)) throw new Error(`--entorno debe ser staging o prod (vino «${entorno}»)`)
  const paquete = val('--paquete'), pdfs = val('--pdfs')
  if (!paquete || !pdfs) throw new Error('Faltan --paquete y/o --pdfs')
  return { entorno, paquete: resolve(paquete), pdfs: resolve(pdfs), aplicar: a.includes('--aplicar'), confirmoProd: a.includes('--confirmo-prod') }
}

interface Carga { origen: string; destino: string; code?: string }

async function main() {
  const { entorno, paquete, pdfs, aplicar, confirmoProd } = args()
  if (entorno === 'prod' && aplicar && !confirmoProd) throw new Error('PROD exige --confirmo-prod además de --aplicar.')
  const base = `https://${REFS[entorno]}.supabase.co`

  const indice = JSON.parse(readFileSync(join(paquete, 'indice.json'), 'utf8')) as EntradaIndice[]
  const cargas: Carga[] = []
  const faltan: string[] = []
  for (const e of indice) {
    const origen = join(pdfs, e.pdf)
    if (!existsSync(origen)) { faltan.push(`${e.codigo}: ${e.pdf}`); continue }
    cargas.push({ origen, destino: rutaPdfSop(e.version, e.codigo), code: e.codigo })
  }
  for (const l of LIBROS) {
    const origen = join(pdfs, l.archivo)
    if (!existsSync(origen)) { faltan.push(`${l.nombre}: ${l.archivo}`); continue }
    cargas.push({ origen, destino: l.ruta })
  }

  console.log(`${entorno}: ${cargas.length} archivos para subir al bucket documents.`)
  for (const c of cargas) console.log(`  ${c.destino}  ←  ${c.origen.slice(pdfs.length + 1)}  (${(statSync(c.origen).size / 1024).toFixed(0)} KB)`)
  if (faltan.length) {
    console.log(`Faltan ${faltan.length}:\n  ${faltan.join('\n  ')}`)
    throw new Error('ABORTADO: faltan archivos. No se subió nada.')
  }
  if (!aplicar) { console.log('Ensayo: no se subió nada. Agregá --aplicar para subir.'); return }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en el entorno.')
  const headers = { Authorization: `Bearer ${key}`, apikey: key }

  for (const c of cargas) {
    const res = await fetch(`${base}/storage/v1/object/documents/${c.destino}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/pdf', 'x-upsert': 'true', 'cache-control': 'max-age=300' },
      body: readFileSync(c.origen),
    })
    if (!res.ok) throw new Error(`Subida de ${c.destino}: ${res.status} ${(await res.text()).slice(0, 300)}`)
    console.log(`  ✓ ${c.destino}`)
  }

  // pdf_path por código, solo en las filas activas del paquete.
  for (const c of cargas.filter(x => x.code)) {
    const res = await fetch(`${base}/rest/v1/sops?code=eq.${encodeURIComponent(c.code!)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ pdf_path: c.destino }),
    })
    if (!res.ok) throw new Error(`pdf_path de ${c.code}: ${res.status} ${(await res.text()).slice(0, 300)}`)
    const filas = await res.json() as unknown[]
    if (filas.length !== 1) console.log(`  Aviso: ${c.code} actualizó ${filas.length} filas (esperaba 1).`)
  }
  console.log(`Listo: ${cargas.length} archivos subidos y pdf_path guardado en ${cargas.filter(x => x.code).length} SoP.`)
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
