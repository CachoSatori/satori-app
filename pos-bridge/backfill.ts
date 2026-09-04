#!/usr/bin/env node
// ── pos-bridge · backfill histórico (A4) ───────────────────────────────────────
//
//   npm run pos:backfill -- --desde 2026-08-05 --hasta 2026-09-03
//   npm run pos:backfill -- --desde 2026-07-01 --hasta 2026-07-31
//   npm run pos:backfill -- --todo
//   npm run pos:backfill -- --desde … --hasta … --dry-run
//
// El segundo camino, en paralelo al agente en vivo: trae el HISTÓRICO de ventas
// cerradas a `pos_ndf_tickets` / `pos_ndf_ticket_lines` de staging, día por día,
// agrupando el log por mes y del más reciente al más viejo.
//
// ── POR QUÉ NO HAY QUE PARAR EL AGENTE ─────────────────────────────────────────
// El payload del backfill lleva **solo `{ local, tickets }`**:
//   · sin `open`   — `open: []` le borraría a staging las mesas abiertas de HOY;
//                    ausente, el Edge no toca `pos_ndf_open`.
//   · sin `cursor` — ni siquiera `{ last_error: null }`: eso le limpiaría al agente
//                    un error recién escrito. Ausente, el Edge lee la fila para
//                    devolverla y NO la escribe: `last_factura`, `last_error` y
//                    `last_poll_at` quedan como los dejó el agente.
// Reingestar un ticket ya guardado no duplica (upsert por `(local, numero_factura)`)
// y el detalle se reemplaza entero, así que tampoco duplica líneas.
//
// READ-ONLY contra el PoS, igual que todo el resto de `pos-bridge/`.

import { pathToFileURL } from 'node:url'

import { todayCR } from '../src/shared/utils'
import type { PayloadIngest, TicketIngest } from '../src/shared/ndf/ingestNdf.ts'

import {
  acumular, agruparPorMes, conteoVacio, describirConteo, enumerarDias, parsearArgs,
  sumar, sumarDias, USO,
  type ArgsBackfill, type Conteo, type ResultadoDia,
} from './backfillPlan.ts'
import { describirAgente, loadAgenteConfig, type AgenteConfig } from './configAgente.ts'
import { loadEnv } from './config.ts'
import { aTicketIngest, primerDiaConVentas } from './consultaAgente.ts'
import { abrirSesion, extraerDiaEnSesion } from './extraerDia.ts'
import { pushIngest, type IngestNdfResult } from './pushIngest.ts'

// ── Puertos ────────────────────────────────────────────────────────────────────
// Las tres cosas que tocan el mundo. Inyectadas → el barrido se prueba con mocks,
// que es lo único validable desde el repo (no hay red al PoS ni a Supabase acá).

export interface PuertosBackfill {
  leerDia(fecha: string): Promise<{ tickets: TicketIngest[]; avisos: string[] }>
  enviar(payload: PayloadIngest): Promise<IngestNdfResult>
  pausar(ms: number): Promise<void>
  log(linea: string): void
}

/**
 * **El guardrail del backfill, en una función.** Solo `local` y `tickets`.
 *
 * No agregarle `open` ni `cursor` acá sin releer el comentario de arriba: las dos
 * claves le pisarían al agente en vivo algo que es suyo.
 */
export function payloadBackfill(local: string, tickets: TicketIngest[]): PayloadIngest {
  return { local, tickets }
}

export interface OpcionesBackfill {
  local:   string
  dias:    string[]
  dryRun:  boolean
  pausaMs: number
}

/** Un día: leer, mandar, contar. Nunca tira — el error vuelve en `ResultadoDia`. */
export async function correrDia(
  puertos: PuertosBackfill,
  local: string,
  fecha: string,
  dryRun: boolean,
): Promise<ResultadoDia> {
  try {
    const { tickets, avisos } = await puertos.leerDia(fecha)
    for (const a of avisos) puertos.log(`    ⚠ ${fecha} · ${a}`)

    const lineas = tickets.reduce((s, t) => s + t.items.length, 0)
    if (tickets.length === 0) {
      puertos.log(`    ${fecha}  sin ventas`)
      return { fecha, tickets: 0, guardados: 0, lineas: 0, error: null }
    }
    if (dryRun) {
      puertos.log(`    ${fecha}  tickets=${tickets.length} líneas=${lineas}  (dry-run: NO se envía)`)
      return { fecha, tickets: tickets.length, guardados: 0, lineas, error: null }
    }

    const res = await puertos.enviar(payloadBackfill(local, tickets))
    for (const p of res.problemas) puertos.log(`    ⚠ ${fecha} · ${p}`)
    puertos.log(
      `    ${fecha}  tickets=${tickets.length} guardados=${res.tickets_guardados} ` +
      `líneas=${res.lineas_guardadas}${res.invalid ? ` inválidos=${res.invalid}` : ''}`,
    )
    return {
      fecha,
      tickets:   tickets.length,
      guardados: res.tickets_guardados,
      lineas:    res.lineas_guardadas,
      error:     null,
    }
  } catch (e) {
    // Un día que falla NO frena el barrido: se anota y se sigue. Un tramo viejo raro
    // (saloneros reciclados, sin artículo de pax, una columna que no estaba) no puede
    // costar el resto del histórico.
    const error = e instanceof Error ? e.message : String(e)
    puertos.log(`    ${fecha}  ✖ ${error}`)
    return { fecha, tickets: 0, guardados: 0, lineas: 0, error }
  }
}

/** El barrido completo, tramo mensual por tramo mensual. */
export async function correrBackfill(
  puertos: PuertosBackfill,
  opts: OpcionesBackfill,
): Promise<{ total: Conteo; porMes: { mes: string; conteo: Conteo }[] }> {
  const tramos = agruparPorMes(opts.dias)
  const porMes: { mes: string; conteo: Conteo }[] = []
  let total = conteoVacio()

  for (const tramo of tramos) {
    puertos.log(`  ── ${tramo.mes} · ${tramo.dias.length} día(s) ──`)
    let conteo = conteoVacio()

    for (let i = 0; i < tramo.dias.length; i++) {
      conteo = acumular(conteo, await correrDia(puertos, opts.local, tramo.dias[i], opts.dryRun))
      // Sin pausa después del último: el barrido termina cuando termina.
      const esUltimoGlobal = tramo === tramos[tramos.length - 1] && i === tramo.dias.length - 1
      if (opts.pausaMs > 0 && !esUltimoGlobal) await puertos.pausar(opts.pausaMs)
    }

    puertos.log(describirConteo(`  ${tramo.mes}`, conteo))
    porMes.push({ mes: tramo.mes, conteo })
    total = sumar(total, conteo)
  }

  return { total, porMes }
}

// ── CLI ────────────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString()
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** El rango efectivo: el que se pidió, o el que descubre el PoS con `--todo`. */
export function rangoEfectivo(
  args: ArgsBackfill,
  primerDiaPos: string | null,
  hoyCR: string,
): { desde: string; hasta: string } {
  if (!args.todo) return { desde: args.desde as string, hasta: args.hasta as string }
  if (primerDiaPos === null) throw new Error('El PoS no tiene ninguna factura cerrada: nada que traer.')
  // Hasta AYER: hoy todavía se está facturando y de eso se encarga el agente en vivo.
  return { desde: primerDiaPos, hasta: sumarDias(hoyCR, -1) }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('-h') || argv.includes('--help')) { console.log(USO); return }

  const args: ArgsBackfill = parsearArgs(argv)
  const cfg: AgenteConfig = loadAgenteConfig(loadEnv())

  console.log(`[${ts()}] backfill pos-ndf · ${describirAgente(cfg)}`)
  if (args.dryRun) console.log(`[${ts()}] DRY-RUN: se lee y se cuenta, NO se envía nada.`)

  const sesion = await abrirSesion(cfg.pos)
  console.log(`[${ts()}] PoS (solo lectura): ${sesion.origen}`)

  try {
    const primero = args.todo ? await primerDiaConVentas(sesion.conn, sesion.esquema) : null
    const { desde, hasta } = rangoEfectivo(args, primero, todayCR())
    const dias = enumerarDias(desde, hasta, args.orden)

    console.log(
      `[${ts()}] rango ${desde} … ${hasta} · ${dias.length} día(s) · ` +
      `orden ${args.orden} · pausa ${args.pausaMs} ms`,
    )
    console.log(`[${ts()}] el agente en vivo NO se toca: el lote va sin 'open' y sin 'cursor'.`)

    const uploadedAt = todayCR()
    const puertos: PuertosBackfill = {
      async leerDia(fecha) {
        const ext = await extraerDiaEnSesion(sesion, fecha, uploadedAt)
        return { tickets: ext.tickets.map((t) => aTicketIngest(t)), avisos: ext.avisos }
      },
      enviar: (payload) => pushIngest(cfg, payload),
      pausar: dormir,
      log:    (linea) => console.log(`[${ts()}]${linea}`),
    }

    const { total } = await correrBackfill(puertos, {
      local: cfg.local, dias, dryRun: args.dryRun, pausaMs: args.pausaMs,
    })

    console.log(`[${ts()}] ${describirConteo('TOTAL', total)}`)
    if (total.errores > 0) {
      console.error(`[${ts()}] ${total.errores} día(s) con error: revisar arriba y re-correr ESE rango (reenviar no duplica).`)
      process.exitCode = 1
    }
  } finally {
    await sesion.close()
  }
}

// Solo corre si a este archivo lo invocaron como programa. Sin este guard, importarlo
// desde un test (para probar `correrBackfill` con mocks) dispararía `main()` — y con los
// argumentos equivocados eso intentaría abrir una conexión real al PoS.
const esEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (esEntrypoint) {
  main().catch((e: unknown) => {
    console.error(`\n✖ ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  })
}
