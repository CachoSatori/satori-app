#!/usr/bin/env node
// ── pos-bridge · CLI del dry-run ───────────────────────────────────────────────
//
//   npm run pos:dia -- 2026-09-01
//   npm run pos:dia -- 2026-09-01 --sin-detalle
//   npm run pos:dia -- 2026-09-01 --json > dia.json
//
// SE CORRE EN LA PC DEL PoS (DESKTOP-25PRDR1) o a través de un túnel hasta
// SQLNUBE. El clon del repo en la nube NO tiene red a esa máquina.
//
// Cero escritura: solo imprime.

import { assertFecha } from './consulta.ts'
import { extraerDiaDetalle } from './extraerDia.ts'
import { formatearReporte, resumirDia } from './reporte.ts'

const USO = `Uso: npm run pos:dia -- <YYYY-MM-DD> [opciones]

Opciones:
  --sin-detalle   solo el resumen (sin la tabla factura por factura)
  --json          imprime el DiaData en JSON en vez del reporte
  -h, --help      esta ayuda

Necesita un .env con POS_DB_HOST / POS_DB_USER / POS_DB_PASSWORD (ver .env.example).
Se corre en la PC del PoS o con un túnel abierto hasta SQLNUBE.`

export interface Argumentos {
  fecha:   string
  detalle: boolean
  json:    boolean
}

/** Parseo de argumentos. Puro, para poder probarlo. */
export function parsearArgs(argv: string[]): Argumentos {
  const libres: string[] = []
  let detalle = true
  let json = false

  for (const a of argv) {
    if (a === '--sin-detalle') detalle = false
    else if (a === '--detalle') detalle = true
    else if (a === '--json') { json = true; detalle = false }
    else if (a.startsWith('-')) throw new Error(`Opción desconocida: ${a}\n\n${USO}`)
    else libres.push(a)
  }

  if (libres.length === 0) throw new Error(`Falta la fecha.\n\n${USO}`)
  if (libres.length > 1) throw new Error(`Sobran argumentos: ${libres.join(' ')}\n\n${USO}`)

  return { fecha: assertFecha(libres[0]), detalle, json }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(USO)
    return
  }

  const args = parsearArgs(argv)
  const extraccion = await extraerDiaDetalle(args.fecha)

  if (args.json) {
    console.log(JSON.stringify(extraccion.dia, null, 2))
    return
  }

  const resumen = resumirDia(extraccion)
  const lineas = formatearReporte(resumen, extraccion.tickets, {
    origen:  extraccion.origen,
    detalle: args.detalle,
  })
  console.log(lineas.join('\n'))
}

main().catch((e: unknown) => {
  // Nada de stack traces con datos adentro: el mensaje alcanza para actuar.
  console.error(`\n✖ ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
