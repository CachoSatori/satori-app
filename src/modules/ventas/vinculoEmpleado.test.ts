// El vínculo empleado → ventas de Mi Rendimiento e ICP, en los DOS modos de `FUENTE_VENTAS`
// (firmado por Ismael, 2026-10-29). Los empleados son los de PROD con su `pos_login` y su
// `pos_name` reales: los casos en que el nombre del Excel y el del PoS NO coinciden.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import { armarDia } from './ventasEnVivoDatos'
import { aggSalonero, allSaloneros } from './ventasUtils'
import {
  claveDeEmpleado, clavesPropinaDeEmpleado, nombresDeEmpleados, type EmpleadoVinculable,
} from '../../shared/ndf/personasNdf'
import type { LineaNdfRow, TicketNdfConId } from '../../shared/api/posNdf'
import type { DiaData, DiasMap, SaloneroDay } from '../../shared/types/ventas'

// ── Empleados de prod (pos_login cargado el 2026-10-29) ────────────────────────────────────
const EMPLEADOS: (EmpleadoVinculable & { full_name: string; codigos: string[] })[] = [
  { full_name: 'PECHE',      pos_login: '034', pos_name: 'INE',         codigos: ['034'] },
  { full_name: 'RODRI',      pos_login: '035', pos_name: 'RODRIGO BAR', codigos: ['035'] },
  { full_name: 'MAXI BARRA', pos_login: '444', pos_name: 'Maxi',        codigos: ['444'] },
  { full_name: 'DOLORES',    pos_login: '025', pos_name: 'Dolores',     codigos: ['025'] },
  { full_name: 'IGNACIO',    pos_login: '029', pos_name: 'Ignacio',     codigos: ['029'] },
  { full_name: 'JOTA',       pos_login: '030', pos_name: 'Jota',        codigos: ['030'] },
  { full_name: 'FRANCO',     pos_login: '036', pos_name: null,          codigos: ['036'] },
  { full_name: 'VALENTINO',  pos_login: '037', pos_name: null,          codigos: ['037'] },
  // NACHO: el 266 es su histórico (sin pos_login), el 038 el nuevo.
  { full_name: 'NACHO',      pos_login: '038', pos_name: 'NACHO',       codigos: ['266', '038'] },
]
const NOMBRES = nombresDeEmpleados(EMPLEADOS)

const ticket = (id: string, login: string): TicketNdfConId => ({
  id, numero_factura: id, estado: 'C', fecha_registra: '2026-10-02T19:00:00-06:00', fecha_cierra: null,
  cajero_login: '222', canal: 'salon', mesa: id, salonero_login: login, registrado_por: 'salonero',
  turno: 'noche', con_servicio: true, servicio_crc: 0, total_crc: 0, valor_servido_crc: 1000,
  iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
  pax: 2, pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok',
})
const linea = (ticketId: string, login: string): LineaNdfRow => ({
  ticket_id: ticketId, codigo_producto: '100', nombre: 'ROLL', cantidad: 1, monto: 1000, familia: 3,
  usuario_registra: login,
})

/** Copia de la normalización local de VentasICP (la que se le pasa a `clavesPropinaDeEmpleado`). */
const normName = (s: string): string => s.toLowerCase()
  .replace(/[áàâä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i')
  .replace(/[óòôö]/g, 'o').replace(/[úùûü]/g, 'u').replace(/[ñ]/g, 'n').replace(/[^a-z0-9]/g, '')

// ── Modo 'pos': los días los arma el PoS ───────────────────────────────────────────────────
describe("FUENTE_VENTAS = 'pos' — ningún empleado con ventas en cero", () => {
  const tickets: TicketNdfConId[] = []
  const lineas: LineaNdfRow[] = []
  EMPLEADOS.forEach((e, i) => e.codigos.forEach((c, j) => {
    const id = `t${i}-${j}`
    tickets.push(ticket(id, c)); lineas.push(linea(id, c))
  }))
  const dias: DiasMap = { '2026-10-02': armarDia('2026-10-02', tickets, lineas, 'sello', NOMBRES).dia }
  const claves = allSaloneros(dias)

  it('una fila por empleado en el ranking (NACHO junta 266 y 038)', () => {
    expect(claves).toHaveLength(EMPLEADOS.length)
  })

  it.each(EMPLEADOS.map(e => [e.full_name, e] as const))('%s: Mi Rendimiento encuentra sus ventas', (_n, e) => {
    const clave = claveDeEmpleado(e, NOMBRES, claves)
    expect(clave).not.toBeNull()
    const total = aggSalonero(clave as string, ['2026-10-02'], dias, {}).total
    expect(total).toBe(1000 * e.codigos.length)
  })

  it('el vínculo por pos_login gana sobre pos_name cuando no coinciden', () => {
    expect(claveDeEmpleado(EMPLEADOS[0], NOMBRES, claves)).toBe('PECHE')      // pos_name INE
    expect(claveDeEmpleado(EMPLEADOS[1], NOMBRES, claves)).toBe('RODRI')      // pos_name RODRIGO BAR
    expect(claveDeEmpleado(EMPLEADOS[2], NOMBRES, claves)).toBe('MAXI BARRA') // pos_name Maxi
    expect(claveDeEmpleado(EMPLEADOS[3], NOMBRES, claves)).toBe('DOLORES')    // pos_name Dolores
  })

  it.each(EMPLEADOS.map(e => [e.full_name, e] as const))('%s: ICP suma sus propinas en la fila de sus ventas', (_n, e) => {
    const clave = claveDeEmpleado(e, NOMBRES, claves) as string
    expect(clavesPropinaDeEmpleado(e, NOMBRES, claves, normName)).toEqual([normName(clave)])
  })
})

// ── Modo 'xls': los días salen del Excel, con los nombres de pos_name ──────────────────────
describe("FUENTE_VENTAS = 'xls' — sin regresión", () => {
  const sal = (total: number): SaloneroDay => ({
    pax: 2, total, com: total, beb: 0, iCom: 1, iBeb: 0, iva: 0, serv: 0,
    promPax: total / 2, promPlato: total, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [],
  })
  const dia: DiaData = {
    fileName: 'ventas.xls', uploadedAt: '2026-10-02',
    saloneros: Object.fromEntries(
      EMPLEADOS.filter(e => e.pos_name).map(e => [e.pos_name as string, sal(5000)]),
    ),
  }
  const dias: DiasMap = { '2026-10-02': dia }
  const claves = allSaloneros(dias)

  it.each(EMPLEADOS.map(e => [e.full_name, e] as const))('%s: Mi Rendimiento usa pos_name como antes', (_n, e) => {
    // Antes: `employee.pos_name ?? heurística`. Ahora tiene que dar EXACTAMENTE lo mismo.
    expect(claveDeEmpleado(e, NOMBRES, claves)).toBe(e.pos_name ?? null)
  })

  it('con pos_name, el empleado sigue viendo sus ventas del Excel', () => {
    for (const e of EMPLEADOS.filter(x => x.pos_name)) {
      const clave = claveDeEmpleado(e, NOMBRES, claves) as string
      expect(aggSalonero(clave, ['2026-10-02'], dias, {}).total).toBe(5000)
    }
  })

  it.each(EMPLEADOS.map(e => [e.full_name, e] as const))('%s: ICP usa las mismas claves que antes (pos_name + full_name)', (_n, e) => {
    const antes = (() => {
      const fullKey = normName(e.full_name)
      const posKey  = e.pos_name ? normName(e.pos_name) : null
      const out: string[] = []
      if (posKey) out.push(posKey)
      if (!posKey || fullKey !== posKey) out.push(fullKey)
      return out
    })()
    expect(clavesPropinaDeEmpleado(e, NOMBRES, claves, normName)).toEqual(antes)
  })
})

describe('sin vínculo', () => {
  it('empleado sin pos_login ni pos_name → null (Mi Rendimiento cae a su heurística de siempre)', () => {
    expect(claveDeEmpleado({ full_name: 'X', pos_login: null, pos_name: null }, {}, ['MAXO'])).toBeNull()
    expect(claveDeEmpleado(null, {}, ['MAXO'])).toBeNull()
  })
})
