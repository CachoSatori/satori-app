// @vitest-environment happy-dom
// (184, firma del dueño 17-nov) El reporte de descuentos dice qué suma: todas las líneas sin respaldo de cada factura.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'owner', full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getMarcadores: async () => [],
  getDescuentosTipo: async () => [],
  getReporteDescuentos: async () => [
    { mes: '2026-10', tipo: 'sin clasificar', turno: 'tarde', facturas: 1, descuento_crc: 1800 },
    { mes: '2026-10', tipo: 'Ficticio 20', turno: 'tarde', facturas: 2, descuento_crc: 1100 },
  ],
}))

import Marcadores from './Marcadores'

describe('Marcadores · reporte de descuentos (184)', () => {
  it('el encabezado dice «Descuento sin respaldo: todas las líneas» y la columna del monto también', async () => {
    render(<Marcadores />)
    await screen.findByText('Ficticio 20')
    const t = document.body.textContent ?? ''
    expect(t).toContain('Descuento sin respaldo: todas las líneas.')
    expect(t).toContain('Una factura con líneas de dos tipos cuenta en los dos.')
    expect(screen.getByText('Monto (todas las líneas)', { selector: 'th' })).toBeTruthy()
    expect(t).toContain('₡1.100')
  })
})
