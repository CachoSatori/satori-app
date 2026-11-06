// Sync de SoP · CLI.
//
//   node scripts/sync_sops/sync.ts --paquete "<carpeta paquete app SoP>" [--entorno staging] [--aplicar]
//
// · Sin --aplicar es un ensayo: lee, valida y muestra qué haría. No escribe nada.
// · Con --aplicar: primero respalda todas las filas de public.sops en
//   <paquete>/respaldo/sops_<entorno>_<fecha-hora>.json y después escribe en una transacción.
// · PROD exige además --confirmo-prod. Los refs están clavados acá.
// · Credencial: SUPABASE_ACCESS_TOKEN (token de la Management API), solo desde el entorno.
//   Nunca se lee de un archivo del repo ni se imprime.
// · Si algún markdown tiene contraseñas, teléfonos, cédulas o correos, aborta sin escribir.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { armarFila, armarSql, buscarSensibles, type EntradaIndice, type FilaSop, type Mapeo } from './lib.ts'

const REFS = { staging: 'hwiatgicyyqyezqwldia', prod: 'yiczgdtirrkdvohdquzf' } as const
type Entorno = keyof typeof REFS

function args() {
  const a = process.argv.slice(2)
  const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined }
  const entorno = (val('--entorno') ?? 'staging') as Entorno
  if (!(entorno in REFS)) throw new Error(`--entorno debe ser staging o prod (vino «${entorno}»)`)
  const paquete = val('--paquete')
  if (!paquete) throw new Error('Falta --paquete "<carpeta paquete app SoP>"')
  return { entorno, paquete: resolve(paquete), aplicar: a.includes('--aplicar'), confirmoProd: a.includes('--confirmo-prod') }
}

async function consulta(ref: string, sql: string, readOnly = false): Promise<Record<string, unknown>[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) throw new Error('Falta SUPABASE_ACCESS_TOKEN en el entorno.')
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`Management API ${res.status}: ${txt.slice(0, 500)}`)
  const json = JSON.parse(txt)
  if (!Array.isArray(json)) throw new Error(`Respuesta inesperada: ${txt.slice(0, 300)}`)
  return json
}

function leerPaquete(dir: string): FilaSop[] {
  const indice = JSON.parse(readFileSync(join(dir, 'indice.json'), 'utf8')) as EntradaIndice[]
  const filas: FilaSop[] = []
  const problemas: string[] = []
  const vistos = new Set<string>()
  for (const e of indice) {
    if (vistos.has(e.codigo)) throw new Error(`Código repetido en el índice: ${e.codigo}`)
    vistos.add(e.codigo)
    const md = readFileSync(join(dir, e.markdown), 'utf8')
    const fila = armarFila(e, md)
    for (const h of buscarSensibles(fila.content)) {
      problemas.push(`  ${e.codigo} ${e.titulo} · línea ${h.linea} · ${h.tipo}: «${h.valor}»`)
    }
    filas.push(fila)
  }
  if (problemas.length) {
    throw new Error(`ABORTADO: el paquete tiene datos sensibles. No se escribió nada.\n${problemas.join('\n')}`)
  }
  return filas
}

async function main() {
  const { entorno, paquete, aplicar, confirmoProd } = args()
  const ref = REFS[entorno]
  if (entorno === 'prod' && aplicar && !confirmoProd) {
    throw new Error('PROD exige --confirmo-prod además de --aplicar.')
  }
  const aqui = dirname(fileURLToPath(import.meta.url))
  const mapeo = JSON.parse(readFileSync(join(aqui, 'mapeo.json'), 'utf8')) as Mapeo

  const filas = leerPaquete(paquete)
  console.log(`Paquete: ${filas.length} documentos, sin datos sensibles.`)

  // Chequeo de schema: la 076 tiene que estar aplicada.
  const cols = await consulta(ref, `select column_name from information_schema.columns
    where table_schema='public' and table_name='sops' and column_name in ('code','area','doc_type','version','employee_book')`, true)
  if (cols.length !== 5) throw new Error(`En ${entorno} falta la migración 076 (columnas encontradas: ${cols.map(c => c.column_name).join(', ') || 'ninguna'}).`)

  const actuales = await consulta(ref, 'select * from public.sops order by category, display_order, title', true)
  const porCodigo = new Map(actuales.filter(r => r.code).map(r => [r.code as string, r]))
  const porId = new Map(actuales.map(r => [r.id as string, r]))

  let nuevas = 0, cambian = 0, iguales = 0
  for (const f of filas) {
    const r = porCodigo.get(f.code)
    if (!r) { nuevas++; continue }
    const igual = r.title === f.title && r.category === f.category && r.content === f.content &&
      r.display_order === f.display_order && r.area === f.area && r.doc_type === f.doc_type &&
      r.version === f.version && r.employee_book === f.employee_book && r.is_active === true
    if (igual) iguales++; else cambian++
  }
  const faltan = [...Object.keys(mapeo.reemplazadas), ...Object.keys(mapeo.solo_app)].filter(id => !porId.has(id))
  const aDesactivar = Object.keys(mapeo.reemplazadas).filter(id => porId.get(id)?.is_active === true)
  console.log(`${entorno} (${ref}): ${actuales.length} filas hoy.`)
  console.log(`Plan: ${nuevas} nuevas · ${cambian} cambian · ${iguales} iguales · ${aDesactivar.length} viejas a desactivar · ${Object.keys(mapeo.solo_app).length} solo en la app con área provisional.`)
  if (faltan.length) console.log(`Aviso: ${faltan.length} ids del mapeo no existen en ${entorno}: ${faltan.join(', ')}`)

  if (!aplicar) { console.log('Ensayo: no se escribió nada. Agregá --aplicar para escribir.'); return }

  const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dirResp = join(paquete, 'respaldo')
  mkdirSync(dirResp, { recursive: true })
  const archivo = join(dirResp, `sops_${entorno}_${sello}.json`)
  writeFileSync(archivo, JSON.stringify(actuales, null, 1))
  console.log(`Respaldo: ${archivo}`)

  const res = await consulta(ref, armarSql(filas, mapeo))
  const conteo: Record<string, number> = {}
  for (const r of res) conteo[r.accion as string] = (conteo[r.accion as string] ?? 0) + 1
  console.log('Aplicado:', JSON.stringify(conteo))
  for (const r of res) console.log(`  ${r.accion}\t${r.code ?? ''}\t${r.title}`)
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
