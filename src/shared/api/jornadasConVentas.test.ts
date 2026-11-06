// Jornadas con ventas para la alerta de días sin cierre: la jornada es la del LOTE de cierre
// (la factura de las 00:30 cuenta para la jornada en que abrió el turno), no la fecha suelta.
import { describe, it, expect, vi } from 'vitest'

const pos = vi.hoisted(() => ({ getTicketsRango: vi.fn() }))
vi.mock('./posNdf', () => ({ getTicketsRango: pos.getTicketsRango }))
vi.mock('../../modules/ventas/ventasDiasDesdePos', () => ({ LOCAL_POR_DEFECTO: 'santa-teresa' }))

import { getJornadasConVentas } from './jornadasConVentas'

const t = (fecha_registra: string, fecha_cierra: string | null, cajero_login = 'caja1') =>
  ({ id: fecha_registra, fecha_registra, fecha_cierra, cajero_login }) as never

describe('getJornadasConVentas', () => {
  it('agrupa por lote: el ticket de las 00:30 cae en la jornada del turno', async () => {
    pos.getTicketsRango.mockResolvedValue([
      t('2026-10-04T20:00:00-06:00', '2026-10-05T01:00:00-06:00'),
      t('2026-10-05T00:30:00-06:00', '2026-10-05T01:00:00-06:00'),   // mismo lote → jornada 04/10
      t('2026-10-06T19:00:00-06:00', '2026-10-06T23:30:00-06:00'),
      t('2026-09-01T19:00:00-06:00', '2026-09-01T23:00:00-06:00'),   // fuera de rango
    ])
    expect(await getJornadasConVentas('2026-10-01', '2026-10-31')).toEqual(['2026-10-04', '2026-10-06'])
    expect(pos.getTicketsRango).toHaveBeenCalledWith('santa-teresa', { desde: '2026-10-01', hasta: '2026-10-31' })
  })
  it('rango vacío → sin consulta', async () => {
    pos.getTicketsRango.mockClear()
    expect(await getJornadasConVentas('2026-10-05', '2026-10-01')).toEqual([])
    expect(pos.getTicketsRango).not.toHaveBeenCalled()
  })
})
