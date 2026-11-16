// @vitest-environment happy-dom
// Mig 175 (decisión del dueño 15-nov 21:49): el beneficio de cumpleaños se usa UNA vez por año por socio y lo marca la
// caja. Se simula solo `supabase.rpc`: la prueba cae si la app llama a otra función, si ofrece el botón cuando ya lo usó,
// si deja deshacer a quien no es owner o si el resumen deja de contar.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MSG_CUMPLE_YA_USO, rangoMes, resumenCumpleTexto, textoCumpleCaja } from './cumple'
import type { CumpleEnCaja } from '../../shared/api/club'

const H = vi.hoisted(() => ({ rpc: vi.fn(), rol: 'cajero' }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: H.rol, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: { rpc: H.rpc, from: vi.fn() } }))

import { UsoCumple } from './Escanear'
import { ResumenCumpleTarjeta, UsosCumple } from './CumpleConfig'

const EN_CAJA: CumpleEnCaja = {
  aplica: true, ya_uso: false, beneficio: 'postre de cortesía', min_personas: 5, dias_antes: 7, dias_despues: 7,
  uno_por_mesa: true, solo_reserva: true, cortesia: { id: 'k1', codigo: 'P1', nombre: 'Postre Ficticio', activa: true }, lista_para_caja: true,
}

describe('caja: una vez por año', () => {
  it('si ya lo usó: «Ya usó su beneficio de cumpleaños este año» y NO se ofrece', () => {
    const t = textoCumpleCaja({ ...EN_CAJA, ya_uso: true } as never)
    expect(t.titulo).toBe(MSG_CUMPLE_YA_USO)
    expect(t.titulo).toBe('Ya usó su beneficio de cumpleaños este año')
    expect(t.ofrecer).toBe(false)
    expect(textoCumpleCaja(EN_CAJA as never).ofrecer).toBe(true)
  })

  beforeEach(() => {
    H.rpc.mockReset().mockImplementation(async (fn: string) =>
      fn === 'club_cumple_usar' ? { data: { ok: true, uso_id: 'u9', cortesia: { codigo: 'P1', nombre: 'Postre Ficticio' } }, error: null }
        : { data: null, error: { message: `no simulada: ${fn}` } })
  })
  it('con la visita registrada y en la ventana: marca el uso sobre ESA visita y dice qué artículo marcar', async () => {
    const usado = vi.fn()
    render(<UsoCumple visita="v1" c={EN_CAJA} onUsado={usado} />)
    fireEvent.click(screen.getByText(/Usó el beneficio de cumpleaños \(postre de cortesía\)/))
    await screen.findByText(/Beneficio de cumpleaños registrado \(una vez por año\)\. Marcá el artículo P1/)
    expect(H.rpc).toHaveBeenCalledTimes(1)
    expect(H.rpc.mock.calls[0][0]).toBe('club_cumple_usar')
    expect(H.rpc.mock.calls[0][1]).toMatchObject({ p_visita: 'v1' })
    expect(usado).toHaveBeenCalled()
  })
  it('ya lo usó, fuera de ventana o sin artículo: no hay botón', () => {
    const { container, rerender } = render(<UsoCumple visita="v1" c={{ ...EN_CAJA, ya_uso: true }} />)
    expect(container.textContent).toBe('')
    rerender(<UsoCumple visita="v1" c={{ aplica: false }} />)
    expect(container.textContent).toBe('')
    rerender(<UsoCumple visita="v1" c={{ ...EN_CAJA, lista_para_caja: false }} />)
    expect(container.textContent).toBe('')
    rerender(<UsoCumple visita="v1" c={null} />)
    expect(container.textContent).toBe('')
    expect(H.rpc).not.toHaveBeenCalled()
  })
  it('si la base lo frena (otra caja lo marcó antes): muestra el error y recarga el recuadro', async () => {
    H.rpc.mockImplementation(async () => ({ data: null, error: { message: 'Ya usó su beneficio de cumpleaños este año' } }))
    const usado = vi.fn()
    render(<UsoCumple visita="v1" c={EN_CAJA} onUsado={usado} />)
    fireEvent.click(screen.getByText(/Usó el beneficio de cumpleaños/))
    await screen.findByText('Ya usó su beneficio de cumpleaños este año')
    expect(usado).toHaveBeenCalled()
  })
})

describe('fechas y resumen', () => {
  it('rango del mes en días de calendario (bisiesto y diciembre)', () => {
    expect(rangoMes('2027-02')).toEqual(['2027-02-01', '2027-02-28'])
    expect(rangoMes('2028-02')).toEqual(['2028-02-01', '2028-02-29'])
    expect(rangoMes('2026-12')).toEqual(['2026-12-01', '2026-12-31'])
  })
  it('renglón del resumen', () => {
    expect(resumenCumpleTexto({ usos: 1, deshechos: 0, sin_articulo_en_factura: 0, sin_factura: 0 })).toBe('1 uso del beneficio de cumpleaños')
    expect(resumenCumpleTexto({ usos: 3, deshechos: 1, sin_articulo_en_factura: 1, sin_factura: 2 }))
      .toBe('3 usos del beneficio de cumpleaños · 1 sin el artículo de cortesía en su factura · 2 todavía sin factura cruzada · 1 deshecho por el owner')
  })
})

const USO = { id: 'u1', usado_en: '2027-01-03T20:00:00-06:00', anio: 2026, socio: 'Ana Prueba', operador: 'Cajero Ficticio',
  visita_clave: 'F-1', cortesia_codigo: 'P1', deshecho_en: null, deshecho_nota: null, deshecho_por: null }

describe('Promociones: usos y deshacer', () => {
  beforeEach(() => {
    H.rpc.mockReset().mockImplementation(async (fn: string) => {
      if (fn === 'club_cumple_usos_listar') return { data: [USO], error: null }
      if (fn === 'club_cumple_uso_deshacer') return { data: { ok: true }, error: null }
      return { data: null, error: { message: `no simulada: ${fn}` } }
    })
  })
  it('el owner deshace con nota (5+ letras): manda id y nota', async () => {
    render(<UsosCumple owner />)
    await screen.findByText('Ana Prueba')
    fireEvent.click(screen.getByText('Deshacer'))
    const boton = screen.getByText('Deshacer marca').closest('button') as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Nota para deshacer'), { target: { value: 'marcada por error' } })
    fireEvent.click(boton)
    await waitFor(() => expect(H.rpc.mock.calls.some(c => c[0] === 'club_cumple_uso_deshacer')).toBe(true))
    expect(H.rpc.mock.calls.find(c => c[0] === 'club_cumple_uso_deshacer')![1]).toEqual({ p_uso: 'u1', p_nota: 'marcada por error' })
  })
  it('el manager ve la lista pero no puede deshacer', async () => {
    render(<UsosCumple owner={false} />)
    await screen.findByText('Ana Prueba')
    expect(screen.queryByText('Deshacer')).toBeNull()
    expect(screen.getByText(/pedile al owner que la deshaga/)).toBeTruthy()
  })
})

describe('Tablero y Excepciones: resumen de cumpleaños', () => {
  it('muestra usos y cortesías a costo; pide el período y el local', async () => {
    H.rpc.mockReset().mockImplementation(async (fn: string) => fn === 'club_cumple_usos_resumen'
      ? { data: { desde: '2027-01-01', hasta: '2027-01-31', local: 'l1', usos: 2, deshechos: 0, con_cortesia: 1, sin_articulo_en_factura: 1,
          sin_factura: 0, sin_precio: 0, cortesia_costo_pct: 35, cortesias_lista_crc: 5000, cortesias_costo_crc: 1750 }, error: null }
      : { data: null, error: { message: `no simulada: ${fn}` } })
    render(<ResumenCumpleTarjeta desde="2027-01-01" hasta="2027-01-31" local="l1" />)
    expect((await screen.findByTestId('resumen-cumple')).textContent)
      .toBe('2 usos del beneficio de cumpleaños · 1 sin el artículo de cortesía en su factura')
    expect(screen.getByText('₡1.750')).toBeTruthy()
    expect(H.rpc.mock.calls[0][1]).toEqual({ p_desde: '2027-01-01', p_hasta: '2027-01-31', p_location: 'l1' })
  })
  it('si la lectura falla (sin la 175), no muestra nada', async () => {
    H.rpc.mockReset().mockImplementation(async () => ({ data: null, error: { message: 'no existe' } }))
    const { container } = render(<ResumenCumpleTarjeta desde="2027-01-01" hasta="2027-01-31" />)
    await waitFor(() => expect(H.rpc).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})
