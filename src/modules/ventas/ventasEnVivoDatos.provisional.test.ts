import { describe, it, expect, vi } from 'vitest'

// ── A1 · getSnapshotEnVivo parte C vs R ANTES de armar nada ──────────────────────────────────
//
// Acá se mockea el borde de I/O (`posNdf`) y se deja pasar todo lo demás tal cual. Lo que se
// prueba es el cableado: la lista cruda con C+X+R entra, el `dia` oficial sale con Σ de las C,
// y el provisional sale aparte con Σ de las R. Nunca los dos en el mismo número.

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

vi.mock('../../shared/api/posNdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../shared/api/posNdf')>()
  return {
    ...real,
    getTicketsJornada:         vi.fn(async () => CRUDOS),
    getLineasDeTickets:        vi.fn(async () => []),
    getSaloneroNombres:        vi.fn(async () => ({ '026': 'MAXO' })),
    getNetoPorJornada:         vi.fn(async () => ({})),
    getMesasAbiertas:          vi.fn(async () => []),
    getPedidosCerradosJornada: vi.fn(async () => new Set<string>()),
    getUltimoPollPoS:          vi.fn(async () => ({ ultimoPollAt: null, error: null })),
  }
})

import type { TicketNdfConId } from '../../shared/api/posNdf'
import { getSnapshotEnVivo } from './ventasEnVivoDatos'

const ticket = (over: Partial<TicketNdfConId> & { id: string }): TicketNdfConId => ({
  numero_factura: over.id, estado: 'C', fecha_registra: '2026-09-01T19:00:00-06:00',
  fecha_cierra: null, cajero_login: '222',
  canal: 'salon', mesa: null, salonero_login: '026', registrado_por: 'salonero', turno: 'noche',
  con_servicio: true, servicio_crc: 0, total_crc: 0, valor_servido_crc: 0,
  iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
  pax: 2, pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok', ...over,
})

// Se declara con `var`-hoisting implícito de `vi.mock`: el factory corre antes que esta línea,
// pero el `vi.fn` la lee recién al invocarse, cuando ya existe.
const CRUDOS: TicketNdfConId[] = [
  ticket({ id: 'c1', estado: 'C', valor_servido_crc: 10_000, total_crc: 11_300 }),
  ticket({ id: 'c2', estado: 'C', valor_servido_crc: 15_000, total_crc: 16_950 }),
  ticket({ id: 'r1', estado: 'R', valor_servido_crc: 80_000, total_crc: 90_400, pax: 6, pax_articulo: 6 }),
  ticket({ id: 'r2', estado: 'R', valor_servido_crc:  5_000, total_crc:  5_650 }),
  ticket({ id: 'x1', estado: 'X', valor_servido_crc: 99_000, total_crc: 99_000 }),
]

describe('getSnapshotEnVivo: oficial = ΣC, provisional = ΣR, separados', () => {
  it('el día oficial suma SOLO las C', async () => {
    const snap = await getSnapshotEnVivo('santa-teresa', '2026-09-01')
    const neto = Object.values(snap.dia.saloneros).reduce((a, v) => a + v.total, 0)
    expect(neto).toBe(25_000)
    expect(snap.bruto).toBe(11_300 + 16_950)
  })

  it('el provisional suma SOLO las R, y viaja aparte', async () => {
    const snap = await getSnapshotEnVivo('santa-teresa', '2026-09-01')
    expect(snap.provisional).toEqual({ monto: 85_000, tickets: 2 })
  })

  it('ni las R ni la X tocan el pax ni el conteo de tickets del día', async () => {
    const snap = await getSnapshotEnVivo('santa-teresa', '2026-09-01')
    const pax = Object.values(snap.dia.saloneros).reduce((a, v) => a + (v.pax ?? 0), 0)
    expect(pax).toBe(4)
    expect(snap.porTurno?.reduce((a, t) => a + t.tickets, 0)).toBe(2)
  })

  it('las líneas se piden SOLO para las C: una R no arrastra su detalle', async () => {
    const posNdf = await import('../../shared/api/posNdf')
    vi.mocked(posNdf.getLineasDeTickets).mockClear()
    await getSnapshotEnVivo('santa-teresa', '2026-09-01')
    expect(vi.mocked(posNdf.getLineasDeTickets)).toHaveBeenCalledWith(['c1', 'c2'])
  })
})
