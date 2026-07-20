// @vitest-environment happy-dom
//
// Regresión de la agrupación de Pendientes: las propinas NO son un proveedor.
// Antes, cada turno de propina abría su propio grupo (el agrupador cae en `description`, que
// para propinas es "Propinas turno <fecha> <turno>") y la lista se llenaba de proveedores
// fantasma. Ahora todas caen en UN grupo "Propinas" con cada turno como fila.
//
// Este test fija las cuatro cosas que no pueden volver atrás:
//   1. un solo grupo "Propinas", con los N turnos como filas;
//   2. los proveedores siguen agrupando aparte, por nombre;
//   3. el contador de proveedores NO cuenta el grupo Propinas;
//   4. el total ₡ pendiente SÍ incluye las propinas (agrupar es display, no cambia la plata).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { CashMovement } from '../../shared/types/database'

vi.mock('../../shared/api/cash', () => ({ updateMovementStatus: vi.fn() }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))

import CashPendientes from './CashPendientes'

const mov = (over: Partial<CashMovement>): CashMovement => ({
  id: 'm', session_id: null, status: 'pendiente', amount_crc: 1000, amount_usd: 0,
  created_at: '2026-07-15T18:00:00Z', description: '', subcategory: '', shift: null,
  supplier_name: null, employee_name: null,
  ...over,
} as unknown as CashMovement)

// El resumen viene partido en varios nodos de texto → matcher por textContent normalizado.
const porTexto = (esperado: string) => (_c: string, el: Element | null) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim() === esperado

// Montos: separador de miles agnóstico (el ICU del entorno de test usa espacio, no punto).
const porMonto = (n: number) => (_c: string, el: Element | null) => {
  const t = (el?.textContent ?? '').trim()
  return t.startsWith('₡') && t.replace(/\D/g, '') === String(n)
}

// 3 turnos de propina (10.000 + 20.000 + 30.000 = 60.000) + 3 facturas de 2 proveedores
// (50.000 + 5.000 + 7.000 = 62.000). Total pendiente = 122.000.
const movs = [
  mov({ id: 'p1', subcategory: 'Propinas por turno', description: 'Propinas turno 2026-07-13 Mediodía', amount_crc: 10000 }),
  mov({ id: 'p2', subcategory: 'Propinas por turno', description: 'Propinas turno 2026-07-13 Noche',    amount_crc: 20000 }),
  mov({ id: 'p3', subcategory: 'Propinas por turno', description: 'Propinas turno 2026-07-14 Noche',    amount_crc: 30000 }),
  mov({ id: 's1', supplier_name: 'Pescados del Pacífico', description: 'Factura 12', amount_crc: 50000 }),
  mov({ id: 's2', supplier_name: 'Pescados del Pacífico', description: 'Factura 13', amount_crc: 5000 }),
  mov({ id: 's3', supplier_name: 'Verduras La Huerta',    description: 'Factura 99', amount_crc: 7000 }),
]

const renderPend = () => render(<CashPendientes movements={movs} sessions={[]} onRefresh={vi.fn()} />)

describe('CashPendientes — las propinas caen en UN solo grupo', () => {
  it('un único encabezado "Propinas", con los 3 turnos como filas', () => {
    renderPend()

    // Uno solo: si volviera a agrupar por description habría tres.
    expect(screen.getAllByText('Propinas')).toHaveLength(1)
    expect(screen.getByText(/Propinas · 3 turnos pendientes/)).toBeTruthy()

    // Los turnos no se pierden: siguen visibles como filas dentro del grupo.
    expect(screen.getByText('Propinas turno 2026-07-13 Mediodía')).toBeTruthy()
    expect(screen.getByText('Propinas turno 2026-07-13 Noche')).toBeTruthy()
    expect(screen.getByText('Propinas turno 2026-07-14 Noche')).toBeTruthy()

    // Total del grupo = suma de los 3 turnos.
    expect(screen.getAllByText(porMonto(60000)).length).toBeGreaterThan(0)
  })

  it('los proveedores siguen agrupando aparte, por nombre', () => {
    renderPend()

    expect(screen.getByText('Pescados del Pacífico')).toBeTruthy()
    expect(screen.getByText('Verduras La Huerta')).toBeTruthy()
    expect(screen.getByText(/Proveedor · 2 pagos pendientes/)).toBeTruthy()   // Pescados: 2 facturas
  })

  it('el contador cuenta 2 proveedores (el grupo Propinas no es uno) y las 6 facturas', () => {
    renderPend()
    expect(screen.getAllByText(porTexto('6 facturas · 2 proveedores')).length).toBeGreaterThan(0)
  })

  it('el total ₡ pendiente incluye las propinas — agrupar es display, no mueve plata', () => {
    renderPend()
    expect(screen.getAllByText(porMonto(122000)).length).toBeGreaterThan(0)
  })
})
