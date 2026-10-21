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
    getTicketsDeJornadas:      vi.fn(async () => []),
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
    // La PRIMERA lectura (la del día) es solo de las C. Las R se piden aparte, para el provisional.
    expect(vi.mocked(posNdf.getLineasDeTickets).mock.calls[0]).toEqual([['c1', 'c2']])
    expect(vi.mocked(posNdf.getLineasDeTickets)).toHaveBeenCalledWith(['r1', 'r2'])
    expect(vi.mocked(posNdf.getLineasDeTickets)).not.toHaveBeenCalledWith(expect.arrayContaining(['x1']))
  })

  it('con líneas, el provisional se mide con la NETA nueva y no toca el día', async () => {
    const posNdf = await import('../../shared/api/posNdf')
    const lineasDe = (ids: string[]) => ids.flatMap(id => [
      { ticket_id: id, codigo_producto: '1', nombre: 'ROLL',   cantidad: 1, monto: 10_000, familia: 3,  usuario_registra: null },
      { ticket_id: id, codigo_producto: '2', nombre: 'REMERA', cantidad: 1, monto: 14_000, familia: 21, usuario_registra: null },
      { ticket_id: id, codigo_producto: '3', nombre: 'XX',     cantidad: 1, monto: 5_000,  familia: 6,  usuario_registra: null },
    ])
    vi.mocked(posNdf.getLineasDeTickets).mockImplementation(async ids => lineasDe(ids))
    try {
      const snap = await getSnapshotEnVivo('santa-teresa', '2026-09-01')
      // 2 R × (10.000 + 14.000); la familia 6 no es venta.
      expect(snap.provisional).toEqual({ monto: 48_000, tickets: 2 })
      // El día: 2 C × 24.000. Ni las R ni la X entran.
      const neto = Object.values(snap.dia.saloneros).reduce((a, v) => a + v.total, 0)
      expect(neto).toBe(48_000)
    } finally {
      vi.mocked(posNdf.getLineasDeTickets).mockImplementation(async () => [])
    }
  })
})
