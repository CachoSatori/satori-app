// ── Test de CONTRATO: RPC `pos_prompax_agregado` (mig 080) == `netaVenta.ts` ───────────────
//
// Corre solo con datos bajados por `scripts/contrato-prompax/descargar.sh` (Management API, solo
// lectura) en `PROMPAX_CONTRATO_DIR`. Sin esa variable se salta: el gate normal no toca ninguna base.
//
// Arma, desde las facturas y líneas CRUDAS, la misma agregación que el RPC con las reglas de la
// app (`netaDelTicket`, `paxDelTicket`, `fechaCR`) y exige 0 diferencias fila por fila.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fechaCR } from '../../shared/ndf/jornada'
import { netaDelTicket, type LineaNeta } from './netaVenta'
import { paxDelTicket } from './ventasEnVivoDatos'
import type { FilaAgregada, Franja } from './ventasPromPaxExplicado'

const DIR = process.env.PROMPAX_CONTRATO_DIR

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

/** Hora CR (UTC−6, sin horario de verano) de un instante. */
function horaCR(iso: string): number {
  return new Date(Date.parse(iso) - 6 * 3_600_000).getUTCHours()
}

function franjaDe(h: number): Franja {
  return h >= 6 && h <= 16 ? 'mañana' : h >= 17 ? 'noche' : 'madrugada'
}

interface TicketCrudo {
  id: string; canal: string | null; salonero_login: string | null; valor_servido_crc: unknown
  fecha_registra: string; pax: unknown; pax_articulo: unknown
}
interface LineaCruda { ticket_id: string; familia: number | null; monto: unknown; codigo_producto: string | null }

describe.skipIf(!DIR)('contrato RPC 080 ↔ netaVenta.ts', () => {
  it('cada fila (día, franja, salonero, canal) da lo mismo: facturas, pax, neta y neta sin pax', () => {
    const leer = (f: string) => JSON.parse(readFileSync(join(DIR!, f), 'utf8'))
    const tickets: TicketCrudo[] = leer('tickets.json')
    const lineas: LineaCruda[] = leer('lineas.json')
    const rpcRaw = leer('rpc.json')
    const rpc: FilaAgregada[] = Object.values(rpcRaw[0])[0] as FilaAgregada[]

    const porTicket = new Map<string, LineaNeta[]>()
    for (const l of lineas) {
      const lista = porTicket.get(l.ticket_id) ?? []
      lista.push({ familia: l.familia, monto: num(l.monto), codigo_producto: l.codigo_producto })
      porTicket.set(l.ticket_id, lista)
    }

    const esperado = new Map<string, { tickets: number; pax: number; neta: number; neta_sin_pax: number; tickets_sin_pax: number }>()
    for (const t of tickets) {
      const neta = netaDelTicket({ valor_servido_crc: num(t.valor_servido_crc) }, porTicket.get(t.id))
      const pax = paxDelTicket({ pax: num(t.pax), pax_articulo: num(t.pax_articulo) })
      const k = [fechaCR(t.fecha_registra), franjaDe(horaCR(t.fecha_registra)), t.salonero_login ?? '', t.canal ?? 'otro'].join('|')
      const e = esperado.get(k) ?? { tickets: 0, pax: 0, neta: 0, neta_sin_pax: 0, tickets_sin_pax: 0 }
      e.tickets += 1; e.pax += pax; e.neta += neta
      if (pax === 0) { e.neta_sin_pax += neta; e.tickets_sin_pax += 1 }
      esperado.set(k, e)
    }

    const diferencias: string[] = []
    const vistos = new Set<string>()
    for (const f of rpc) {
      const k = [f.dia, f.franja, f.salonero_login ?? '', f.canal].join('|')
      vistos.add(k)
      const e = esperado.get(k)
      if (!e) { diferencias.push(`solo en RPC: ${k}`); continue }
      for (const c of ['tickets', 'pax', 'neta', 'neta_sin_pax', 'tickets_sin_pax'] as const) {
        if (Math.abs(num(f[c]) - e[c]) > 1e-6) diferencias.push(`${k} ${c}: RPC ${f[c]} ≠ app ${e[c]}`)
      }
    }
    for (const k of esperado.keys()) if (!vistos.has(k)) diferencias.push(`solo en la app: ${k}`)

    const totalRpc = rpc.reduce((s, f) => s + num(f.neta), 0)
    const totalApp = [...esperado.values()].reduce((s, e) => s + e.neta, 0)
    console.info(`[contrato] facturas ${tickets.length} · filas ${rpc.length} · neta RPC ${totalRpc.toFixed(2)} · neta app ${totalApp.toFixed(2)}`)

    expect(tickets.length).toBeGreaterThan(0)
    expect(diferencias).toEqual([])
  })
})
