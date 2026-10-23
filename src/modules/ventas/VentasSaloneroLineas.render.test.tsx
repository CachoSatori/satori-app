// @vitest-environment happy-dom
//
// Lo que esta pantalla NO puede hacer: presentar las dos lentes como si se sumaran. Acá se
// verifica en el DOM, que es donde el dueño lo ve — dos tablas separadas, cada una valiendo la
// neta ENTERA del período.
import { describe, it, expect, vi } from 'vitest'
import { render, within } from '@testing-library/react'

// La capa de I/O no hace falta: lo que se prueba acá es `BloquesLentes`, que es puro. Se mockea
// para no arrastrar el cliente de Supabase (y sus variables de entorno) a un test de render.
vi.mock('./saloneroLentesDatos', () => ({ getLentesDesdePos: vi.fn() }))

import { BloquesLentes } from './VentasSaloneroLineas'
import { calcularLentes, type LineaLente, type TicketLente } from './saloneroLentes'
// Los montos se comparan con el MISMO formateador que usa la app (`₡ 20 000`, con su espacio
// fino): el test mira el cableado del DOM, no cómo se escribe un número.
import { fi } from './ventasUtils'

// La factura 110607: 5 líneas de GONZA (032) + 4 de MAXO (026), los dos 677 en MAXO.
const TICKETS: TicketLente[] = [{
  id: 'f110607', cajero_login: '222', valor_servido_crc: 20_000, iva_crc: 2_600,
  servicio_crc: 2_000, pax: 2, mesa: '7',
}]

const linea = (usuario_registra: string, monto: number, extra: Partial<LineaLente> = {}): LineaLente => ({
  ticket_id: 'f110607', usuario_registra, monto,
  codigo_producto: 'X1', cantidad: 1, familia: 2, ...extra,
})

const LINEAS: LineaLente[] = [
  ...Array.from({ length: 5 }, () => linea('032', 2_000)),
  ...Array.from({ length: 4 }, () => linea('026', 2_500)),
  linea('026', 0, { codigo_producto: '677', familia: 19, cantidad: 2 }),
]

const NOMBRES = { '032': 'Gonzalo Pérez', '026': 'Maximiliano Soto' }

const pintar = () =>
  render(<BloquesLentes lentes={calcularLentes(TICKETS, LINEAS)} nombres={NOMBRES} />)

describe('las dos lentes, en pantalla', () => {
  it('son DOS bloques separados, no dos columnas de la misma tabla', () => {
    const { container } = pintar()
    const tablas = container.querySelectorAll('table')
    expect(tablas).toHaveLength(2)
  })

  it('cada bloque dice para qué es: ranking una, contexto la otra', () => {
    const { getByText } = pintar()
    expect(getByText(/por línea — el ranking/)).toBeTruthy()
    expect(getByText(/por factura — contexto/)).toBeTruthy()
  })

  it('LENTE A: la factura partida se ve partida — ₡10.000 y ₡10.000', () => {
    const { container } = pintar()
    const filas = [...container.querySelectorAll('table')[0].querySelectorAll('tbody tr')]
    const texto = filas.map(f => f.textContent ?? '')
    expect(texto.some(t => t.includes('Gonzalo Pérez') && t.includes(fi(10_000)))).toBe(true)
    expect(texto.some(t => t.includes('Maximiliano Soto') && t.includes(fi(10_000)))).toBe(true)
  })

  it('LENTE B: la mesa entera es de quien registró el 677 — una sola fila de ₡20.000', () => {
    const { container } = pintar()
    const cuerpo = container.querySelectorAll('table')[1]
    const filas = [...cuerpo.querySelectorAll('tbody tr')]
    // Una fila de persona + la del total. Gonzalo NO aparece: la mesa no es suya.
    expect(filas.filter(f => (f.textContent ?? '').includes('Gonzalo'))).toHaveLength(0)
    expect(within(cuerpo).getByText('Maximiliano Soto')).toBeTruthy()
    expect(filas.some(f => (f.textContent ?? '').includes(fi(20_000)))).toBe(true)
  })

  it('usa los nombres de `employees`, no los códigos', () => {
    const { container, queryByText } = pintar()
    expect(container.textContent).toContain('Gonzalo Pérez')
    expect(queryByText('032')).toBeNull()
  })

  it('los dos totales dan LO MISMO: la neta entera del período, cada uno', () => {
    const { container } = pintar()
    const totalDe = (i: number) => {
      const fila = [...container.querySelectorAll('table')[i].querySelectorAll('tbody tr')]
        .find(f => (f.textContent ?? '').includes('Total del turno'))
      return fila?.textContent ?? ''
    }
    // Si alguien alguna vez sumara las dos lentes, este número se duplicaría. Los dos totales
    // valen la MISMA neta porque las dos lentes parten el mismo día por ejes distintos.
    expect(totalDe(0)).toContain(fi(20_000))
    expect(totalDe(1)).toContain(fi(20_000))
  })

  it('marca a los que no son meseros, para que no se lean como ranking', () => {
    const conCaja = calcularLentes(
      [{ id: 'x', cajero_login: '111', valor_servido_crc: 5_000, iva_crc: 0, servicio_crc: 0, pax: 0, mesa: null }],
      [{ ticket_id: 'x', usuario_registra: '111', monto: 5_000, codigo_producto: 'X1', cantidad: 1, familia: 2 }],
    )
    const { container } = render(<BloquesLentes lentes={conCaja} nombres={{}} />)
    expect(container.textContent).toContain('Caja')
  })
})
