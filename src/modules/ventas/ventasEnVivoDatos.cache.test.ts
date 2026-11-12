import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── A5 · En vivo: lo que no cambia en la jornada se pide una sola vez ──────────────────────────
// Se mockea solo el borde de I/O (`posNdf`). Lo que se prueba: el refresco de 30 s vuelve a leer
// lo de HOY, pero las 4 jornadas comparables y los nombres se piden una vez por jornada, y el
// snapshot sale IGUAL que sin memoria.

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

vi.mock('../../shared/api/posNdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../shared/api/posNdf')>()
  return {
    ...real,
    getTicketsJornada:         vi.fn(async () => [TICKET_HOY]),
    getLineasDeTickets:        vi.fn(async (ids: string[]) => ids.map(id => ({
      ticket_id: id, codigo_producto: '1', nombre: 'ROLL', cantidad: 1,
      monto: id.startsWith('c') ? 20_000 : 10_000, familia: 3, usuario_registra: null,
    }))),
    getSaloneroNombres:        vi.fn(async () => ({ '026': 'SALONERO A' })),
    getTicketsDeJornadas:      vi.fn(async (_l: string, fechas: string[]) => fechas.map((f, i) => ({
      id: `c${i}`, fecha_registra: `${f}T19:00:00-06:00`, estado: 'C',
    }))),
    getMesasAbiertas:          vi.fn(async () => []),
    getPedidosCerradosJornada: vi.fn(async () => new Set<string>()),
    getUltimoPollPoS:          vi.fn(async () => ({ ultimoPollAt: null, error: null })),
  }
})

import * as posNdf from '../../shared/api/posNdf'
import type { TicketNdfConId } from '../../shared/api/posNdf'
import { getSnapshotEnVivo, olvidarCacheEnVivo } from './ventasEnVivoDatos'
import type { SnapshotEnVivo } from './ventasEnVivoTypes'

/** El instante de armado cambia en cada llamada; todo lo demás tiene que ser igual. */
const sinHora = (s: SnapshotEnVivo) => ({ ...s, generadoEn: '' })

const TICKET_HOY: TicketNdfConId = {
  id: 'h1', numero_factura: 'h1', estado: 'C', fecha_registra: '2026-09-01T19:00:00-06:00',
  fecha_cierra: null, cajero_login: '222',
  canal: 'salon', mesa: null, salonero_login: '026', registrado_por: 'salonero', turno: 'noche',
  con_servicio: true, servicio_crc: 0, total_crc: 11_300, valor_servido_crc: 10_000,
  iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
  pax: 2, pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok',
}

beforeEach(() => {
  // Reloj fijo: el snapshot lleva sellos de hora; con el reloj quieto, dos armados son comparables.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-11T20:00:00Z'))
  olvidarCacheEnVivo()
  vi.mocked(posNdf.getTicketsJornada).mockClear()
  vi.mocked(posNdf.getTicketsDeJornadas).mockClear()
  vi.mocked(posNdf.getSaloneroNombres).mockClear()
  vi.mocked(posNdf.getLineasDeTickets).mockClear()
})

afterEach(() => { vi.useRealTimers() })

describe('getSnapshotEnVivo · memoria por jornada (A5)', () => {
  it('el refresco relee lo de hoy, no las comparables ni los nombres', async () => {
    const a = await getSnapshotEnVivo('santa-teresa', '2026-09-01')
    const b = await getSnapshotEnVivo('santa-teresa', '2026-09-01')
    expect(vi.mocked(posNdf.getTicketsJornada)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(posNdf.getTicketsDeJornadas)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(posNdf.getSaloneroNombres)).toHaveBeenCalledTimes(1)
    // líneas: 2 de hoy (una por refresco) + 1 de las comparables (una sola vez)
    expect(vi.mocked(posNdf.getLineasDeTickets)).toHaveBeenCalledTimes(3)
    expect(sinHora(b)).toEqual(sinHora(a))
  })

  it('el snapshot con memoria es idéntico al de sin memoria', async () => {
    await getSnapshotEnVivo('santa-teresa', '2026-09-01')
    const conMemoria = await getSnapshotEnVivo('santa-teresa', '2026-09-01')
    olvidarCacheEnVivo()
    const sinMemoria = await getSnapshotEnVivo('santa-teresa', '2026-09-01')
    expect(sinHora(conMemoria)).toEqual(sinHora(sinMemoria))
    // La comparativa sale de las jornadas guardadas y no está en cero: se probó algo.
    expect(conMemoria.historico.mismoDiaSemanaPasada).toBe(20_000)
    expect(conMemoria.historico).toEqual(sinMemoria.historico)
  })

  it('otra jornada u otro local vuelven a pedir', async () => {
    await getSnapshotEnVivo('santa-teresa', '2026-09-01')
    await getSnapshotEnVivo('santa-teresa', '2026-09-02')
    await getSnapshotEnVivo('nosara', '2026-09-02')
    expect(vi.mocked(posNdf.getTicketsDeJornadas)).toHaveBeenCalledTimes(3)
    expect(vi.mocked(posNdf.getSaloneroNombres)).toHaveBeenCalledTimes(2)
  })

  it('un error no queda guardado: el próximo refresco lo vuelve a pedir', async () => {
    vi.mocked(posNdf.getTicketsDeJornadas).mockRejectedValueOnce(new Error('sin red'))
    await expect(getSnapshotEnVivo('santa-teresa', '2026-09-01')).rejects.toThrow('sin red')
    await getSnapshotEnVivo('santa-teresa', '2026-09-01')
    expect(vi.mocked(posNdf.getTicketsDeJornadas)).toHaveBeenCalledTimes(2)
  })
})
