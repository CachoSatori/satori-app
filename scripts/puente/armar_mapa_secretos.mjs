// Grok 103 (09-nov) · Arma el mapa POS_INGEST_SECRETS del pase, SIN mostrar ni copiar ningún secreto.
//
//   node --import file:///C:/satori/satori-app-prod/pos-bridge/register.mjs C:\satori\pase-v2\scripts\puente\armar_mapa_secretos.mjs
//        --agente C:\satori\satori-app-prod --clon C:\satori\pase-v2 --salida <archivo .env, ruta absoluta> [--nuevo-santa-teresa]
//        [--huella-completa]
//   o, solo para medir (paquete 1.9; Grok 119): … --agente … --clon … --solo-medir
//
// · --solo-medir: NO arma el mapa, NO escribe nada y NO aborta por el largo: dice qué archivo manda, el largo del secreto
//   efectivo y si cumple el mínimo de 32. Así un secreto corto no corta el pase en 1.9: se sigue por el camino de §4.4.
// · Huella (Grok 119): por pantalla solo los 12 primeros caracteres del sha256 del mapa (`huella_12`). El sha256 entero
//   sale SOLO con --huella-completa, que usa el paquete 3.2 capturando la salida en una variable (no se muestra) para
//   compararla con la del CLI.
//
// · El secreto de santa-teresa sale del MISMO parser del agente de prod: `loadEnv` + `loadAgenteConfig` de su propia
//   carpeta (pos-bridge/config.ts y configAgente.ts de 4d3513a). Es el valor que el agente manda de verdad.
// · nosara: uno aleatorio de un solo uso (32 bytes en hex). No se guarda en ningún lado fuera del archivo de salida.
// · Esquema CERRADO del mapa: un objeto con exactamente santa-teresa y nosara; cada valor texto (ni null, ni número, ni
//   objeto), de 32 o más, sin espacios ni comillas; sin repetidos. Se valida antes de escribir y otra vez sobre el JSON
//   ya serializado; y además con el MISMO parser del Edge (localDelSecreto del clon del pase): cada secreto tiene que
//   abrir su local.
// · Cualquier error aborta (código ≠ 0) y NO queda archivo: se escribe a un temporal y se renombra al final.
// · Por pantalla solo sale: qué archivo del agente manda, el largo del secreto de santa-teresa, si se cambió, y el
//   sha256 del mapa (para compararlo con la huella del CLI). Ningún valor.
// · --nuevo-santa-teresa (solo si el secreto del agente mide menos de 32; paquete §4.4, CON LA TAREA DETENIDA): genera
//   uno nuevo y lo escribe en la línea INGEST_SECRET= del archivo que manda (copia del archivo al lado, .antes-pase), y
//   vuelve a leerlo con el parser del agente para confirmar que es el efectivo.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const LOCALES = ['nosara', 'santa-teresa']
const salir = (msg) => { console.error(`NO SE SIGUE: ${msg}`); process.exit(1) }

function args() {
  const a = process.argv.slice(2), o = {}
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--nuevo-santa-teresa') { o.nuevo = true; continue }
    if (a[i] === '--solo-medir') { o.medir = true; continue }
    if (a[i] === '--huella-completa') { o.completa = true; continue }
    if (!['--agente', '--clon', '--salida'].includes(a[i]) || a[i + 1] === undefined) salir(`argumento no válido: ${a[i]}`)
    o[a[i].slice(2)] = a[++i]
  }
  if (o.medir && (o.salida !== undefined || o.nuevo || o.completa)) salir('--solo-medir va sin --salida, --nuevo-santa-teresa ni --huella-completa')
  for (const k of o.medir ? ['agente', 'clon'] : ['agente', 'clon', 'salida']) {
    if (!o[k]) salir(`falta --${k}`)
    if (!isAbsolute(o[k])) salir(`--${k} tiene que ser una ruta absoluta`)
    o[k] = resolve(o[k])
  }
  for (const k of ['agente', 'clon']) if (!existsSync(o[k]) || !statSync(o[k]).isDirectory()) salir(`--${k} no es una carpeta`)
  if (o.medir) return o
  if (!existsSync(dirname(o.salida))) salir('la carpeta de --salida no existe')
  for (const k of ['agente', 'clon']) {
    const r = relative(o[k], o.salida)
    if (!r.startsWith('..') && !isAbsolute(r)) salir(`--salida no puede estar dentro de --${k}`)
  }
  if (existsSync(o.salida)) salir('--salida ya existe: borralo primero (no se pisa nada)')
  return o
}

/** Esquema cerrado. Devuelve los problemas (nunca los valores). */
export function problemasMapa(m) {
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return ['el mapa no es un objeto']
  const out = []
  const claves = Object.keys(m).sort()
  if (claves.join(',') !== LOCALES.join(',')) out.push(`claves distintas de ${LOCALES.join(' y ')}: ${claves.join(', ')}`)
  const vistos = new Set()
  for (const k of claves) {
    const v = m[k]
    if (typeof v !== 'string') { out.push(`${k}: no es texto (${v === null ? 'null' : typeof v})`); continue }
    if (v.length < 32) out.push(`${k}: menos de 32 caracteres`)
    if (/[\s'"\\]/.test(v)) out.push(`${k}: tiene espacios, comillas o barras`)
    if (vistos.has(v)) out.push('hay secretos repetidos entre locales')
    vistos.add(v)
  }
  return out
}

const igual = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

async function main() {
  const o = args()
  if (process.env.INGEST_SECRET !== undefined) salir('INGEST_SECRET viene de una variable de entorno de esta consola: no está previsto')
  const cfgMod = await import(pathToFileURL(join(o.agente, 'pos-bridge', 'config.ts')).href)
  const agMod = await import(pathToFileURL(join(o.agente, 'pos-bridge', 'configAgente.ts')).href)
  const edge = await import(pathToFileURL(join(o.clon, 'src', 'shared', 'ndf', 'ingestNdf.ts')).href)
  const candidatos = [join(cfgMod.RAIZ_REPO, '.env'), join(cfgMod.RAIZ_REPO, '.env.local'), join(cfgMod.DIR_BRIDGE, '.env')]
  const manda = candidatos.filter((f) => existsSync(f) && 'INGEST_SECRET' in cfgMod.parseEnvFile(readFileSync(f, 'utf8'))).at(-1)
  if (!manda) salir('ningún .env del agente define INGEST_SECRET')
  const efectivo = () => agMod.loadAgenteConfig(cfgMod.loadEnv()).ingestSecret
  let st, cambiado = false
  try { st = efectivo() } catch (e) { salir(`el agente no podría arrancar con su configuración (${e.message.replace(/=.*/, '')})`) }
  if (o.medir) {
    console.log(JSON.stringify({ archivo_que_manda: relative(cfgMod.RAIZ_REPO, manda), largo_santa_teresa: st.length,
      cumple_32: st.length >= 32 }))
    return
  }
  if (st.length < 32) {
    if (!o.nuevo) salir(`el secreto del agente mide ${st.length} (< 32): paquete §4.4 (--nuevo-santa-teresa, con la tarea detenida)`)
    const nuevo = randomBytes(32).toString('hex')
    const texto = readFileSync(manda, 'utf8')
    const lineas = texto.split('\n')
    const idx = lineas.map((l, i) => [l, i]).filter(([l]) => /^\s*INGEST_SECRET\s*=/.test(l)).map(([, i]) => i)
    if (idx.length === 0) salir('no se encontró la línea INGEST_SECRET= del archivo que manda')
    const cr = lineas[idx.at(-1)].endsWith('\r') ? '\r' : ''
    lineas[idx.at(-1)] = `INGEST_SECRET=${nuevo}${cr}`          // la ÚLTIMA (es la que gana en el parser)
    copyFileSync(manda, `${manda}.antes-pase`)
    writeFileSync(`${manda}.tmp`, lineas.join('\n'), { encoding: 'utf8', mode: 0o600 })
    renameSync(`${manda}.tmp`, manda)
    st = efectivo()
    if (!igual(st, nuevo)) salir('después de escribirlo, el agente no lee el secreto nuevo (otro archivo lo pisa)')
    cambiado = true
  }
  const mapa = { 'santa-teresa': st, nosara: randomBytes(32).toString('hex') }
  let p = problemasMapa(mapa)
  if (p.length) salir(p.join('; '))
  const json = JSON.stringify(mapa)
  p = problemasMapa(JSON.parse(json))
  if (p.length) salir(p.join('; '))
  // el mismo parser del Edge: cada secreto abre SU local, y uno inventado no abre nada
  for (const [local, s] of Object.entries(mapa)) {
    if (edge.localDelSecreto(s, { mapa: json }, igual) !== local) salir(`con el parser del Edge, el secreto de ${local} no abre ${local}`)
  }
  if (edge.localDelSecreto(randomBytes(32).toString('hex'), { mapa: json }, igual) !== null) salir('el parser del Edge abre con un secreto inventado')
  const tmp = `${o.salida}.tmp`
  try {
    writeFileSync(tmp, `POS_INGEST_SECRETS='${json}'\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, o.salida)
  } catch (e) { rmSync(tmp, { force: true }); salir(`no se pudo escribir la salida (${e.code ?? 'error'})`) }
  const h = sha(json)
  console.log(JSON.stringify({ archivo_que_manda: relative(cfgMod.RAIZ_REPO, manda), largo_santa_teresa: st.length,
    santa_teresa_cambiado: cambiado, huella_12: h.slice(0, 12), ...(o.completa ? { sha256_mapa: h } : {}) }))
}

main().catch((e) => salir(`error inesperado (${e?.code ?? e?.name ?? 'error'})`))
