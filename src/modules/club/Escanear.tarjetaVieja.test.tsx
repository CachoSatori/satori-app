// @vitest-environment happy-dom
// Piloto (decisión del dueño 11-nov; puesta al día 16-nov, del #118) · Escanear → «Tarjeta vieja»: la tarjeta de
// PAPEL de un anfitrión que trae un turista. Botón propio (solo con la tarjeta vieja —`tarjeta_manual`— encendida en el local), QR único de
// caja, búsqueda mientras se escribe, y termina en el MISMO camino de servidor de siempre (`tarjetaManual` →
// club_tarjeta_manual). Además: el aviso falso «Código no reconocido» después de Confirmar sobre una ficha abierta por
// «Buscar». La pantalla real contra una API simulada. Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { BusquedaFila, PedidoAbierto, ResolverReferente } from '../../shared/api/club'

const rol = vi.hoisted(() => ({ v: 'cajero' }))
const api = vi.hoisted(() => ({
  resolverQR: vi.fn(), resolverMiembro: vi.fn(), buscar: vi.fn(), tarjetaManual: vi.fn(), canjeAprobado: vi.fn(),
  getTarjetaManualActiva: vi.fn(), getPedidosAbiertos: vi.fn(), getFacturasRecientes: vi.fn(), buscarFacturas: vi.fn(),
}))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: rol.v, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({ ...(await orig<typeof import('../../shared/api/club')>()), ...api }))

import Escanear, { ESPERA_BUSQUEDA_MS, MSG_TARJETA_VIEJA_APAGADA, MSG_SIN_RESULTADOS_VIEJA } from './Escanear'
import { QR_CAJA_TARJETA_VIEJA } from './qrFormato'

const ficha = (extra: Partial<ResolverReferente['datos']> = {}): ResolverReferente => ({
  tipo: 'referente',
  datos: {
    id: 'm1', nombre: 'Persona Prueba', tipo_miembro: 'referente', negocio: 'Hostal Ejemplo', estado: 'activo',
    personas: 6, creditos: 1, personas_proximo: 3, personas_por_credito: 6, valor_credito_crc: 1000,
    canjeado_hoy: 0, canje_min: 1, canje_paso: 0.5, max_creditos_por_visita: 2, tarjeta_manual_activa: true,
    sin_creditos: false, personas_mes: 0, ...extra,
  },
} as ResolverReferente)
const fila: BusquedaFila = { id: 'm1', nombre: 'Persona Prueba', negocio: 'Hostal Ejemplo', tipo: 'referente', estado: 'activo', creditos: 1 } as BusquedaFila
const pedido: PedidoAbierto = { pedido: 'pedido:2026-11-16:12', mesa: '4', salonero: 'Salonero Ficticio', total_crc: 10000, pax: 2,
  actualizado: '2026-11-16T20:00:00Z' }
const espera = { timeout: ESPERA_BUSQUEDA_MS + 1500 }

function escribirCodigo(codigo: string) {
  fireEvent.change(screen.getByPlaceholderText('Cupón, canje, socio o pase'), { target: { value: codigo } })
  fireEvent.click(screen.getByText('Ver'))
}

async function abrirVieja() {
  render(<Escanear />)
  fireEvent.click(await screen.findByRole('button', { name: 'Tarjeta vieja' }))
  return screen.getByLabelText('Buscar referente por nombre, negocio o últimos 4 del teléfono')
}

async function cargarTarjeta() {
  fireEvent.click(await screen.findByText(/Pedido pedido:2026-11-16:12/))
  fireEvent.click(screen.getByText('+')); fireEvent.click(screen.getByText('+'))   // 0 → 1 → 2 personas
  fireEvent.click(screen.getByText('Continuar'))
  fireEvent.click(await screen.findByText('Confirmar'))
}

describe('Escanear · «Tarjeta vieja»', () => {
  beforeEach(() => {
    rol.v = 'cajero'
    api.getTarjetaManualActiva.mockReset().mockResolvedValue(true)
    api.resolverQR.mockReset().mockResolvedValue(ficha())
    api.resolverMiembro.mockReset().mockResolvedValue(ficha())
    api.buscar.mockReset().mockResolvedValue([fila])
    api.tarjetaManual.mockReset().mockResolvedValue({ personas: 8, creditos: 1 })
    api.canjeAprobado.mockReset().mockResolvedValue({ personas: 0, creditos: 0 })
    api.getPedidosAbiertos.mockReset().mockResolvedValue([pedido])
    api.getFacturasRecientes.mockReset().mockResolvedValue([])
    api.buscarFacturas.mockReset().mockResolvedValue([])
  })

  it('el botón solo aparece con la tarjeta vieja encendida en el local', async () => {
    api.getTarjetaManualActiva.mockResolvedValue(false)
    render(<Escanear />)
    await waitFor(() => expect(api.getTarjetaManualActiva).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('button', { name: 'Tarjeta vieja' })).toBeNull()
  })

  it('busca mientras se escribe (con 3 caracteres, una sola consulta tras la espera) y abre la ficha por id', async () => {
    const campo = await abrirVieja()
    fireEvent.change(campo, { target: { value: 'Pe' } })
    expect(await screen.findByText(/Escribí al menos 3 letras/)).toBeTruthy()
    fireEvent.change(campo, { target: { value: 'Per' } })
    fireEvent.change(campo, { target: { value: 'Pers' } })
    await waitFor(() => expect(api.buscar).toHaveBeenCalledTimes(1), espera)
    expect(api.buscar).toHaveBeenCalledWith('Pers')
    fireEvent.click(await screen.findByText('Persona Prueba'))
    await waitFor(() => expect(api.resolverMiembro).toHaveBeenCalledWith('m1'))
    // la ficha abre en «Tarjeta vieja» (el camino de siempre), sin código de QR (CLUB-AUD-30)
    expect(await screen.findByText(/La tarjeta de papel del anfitrión/)).toBeTruthy()
    // (16-nov, decisión del dueño) en el PoS se marca «PROMO CLUB 10 %», como con el cupón
    expect(screen.getByText(/marcá el artículo «PROMO CLUB 10 %» \(vale ₡0: es la marca\), como con el cupón/)).toBeTruthy()
    expect(screen.getByText(/excepción «Tarjeta vieja»/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tarjeta vieja' })).toBeTruthy()
    expect(screen.queryByText(/Tarjeta f[ií]sica/)).toBeNull()
    expect(api.resolverQR).not.toHaveBeenCalled()
  })

  it('sin resultados: dice que no se carga a otro', async () => {
    api.buscar.mockResolvedValue([])
    const campo = await abrirVieja()
    fireEvent.change(campo, { target: { value: 'Nadie' } })
    expect(await screen.findByText(MSG_SIN_RESULTADOS_VIEJA, undefined, espera)).toBeTruthy()
  })

  it('una respuesta vieja (se siguió escribiendo) no pisa la nueva', async () => {
    let soltarVieja: (v: BusquedaFila[]) => void = () => {}
    api.buscar.mockImplementation((q: string) => q === 'Per'
      ? new Promise<BusquedaFila[]>(r => { soltarVieja = r })
      : Promise.resolve([{ ...fila, id: 'm2', nombre: 'Otra Persona' }]))
    const campo = await abrirVieja()
    fireEvent.change(campo, { target: { value: 'Per' } })
    await waitFor(() => expect(api.buscar).toHaveBeenCalledWith('Per'), espera)
    fireEvent.change(campo, { target: { value: 'Otra' } })
    expect(await screen.findByText('Otra Persona', undefined, espera)).toBeTruthy()
    await act(async () => { soltarVieja([fila]) })
    expect(screen.queryByText('Persona Prueba')).toBeNull()
  })

  it('Confirmar usa el MISMO camino de servidor de siempre, dice «Tarjeta vieja: +N…» y no muestra «Código no reconocido»', async () => {
    const campo = await abrirVieja()
    fireEvent.change(campo, { target: { value: 'Persona' } })
    fireEvent.click(await screen.findByText('Persona Prueba', undefined, espera))
    await cargarTarjeta()
    await waitFor(() => expect(api.tarjetaManual).toHaveBeenCalledTimes(1))
    const [miembro, personas, pos] = api.tarjetaManual.mock.calls[0]
    expect([miembro, personas, pos?.modo]).toEqual(['m1', 2, 'pedido'])
    expect(await screen.findByText('Tarjeta vieja: +2 personas a Persona Prueba')).toBeTruthy()
    expect(screen.queryByText(/Tarjeta f[ií]sica/)).toBeNull()
    // la ficha se relee por id (no hay código que resolver) y el aviso de éxito queda
    await waitFor(() => expect(api.resolverMiembro).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/Código no reconocido/)).toBeNull()
    expect(api.resolverQR).not.toHaveBeenCalled()
  })

  it('«Canje sin celular» sobre una ficha abierta por «Buscar» tampoco termina en «Código no reconocido»', async () => {
    rol.v = 'manager'
    api.resolverMiembro.mockResolvedValue(ficha({ creditos: 2, personas: 12 }))
    render(<Escanear />)
    fireEvent.change(screen.getByLabelText('Buscar referente por nombre, negocio o últimos 4 del teléfono'), { target: { value: 'Persona' } })
    fireEvent.click(await screen.findByText('Persona Prueba', undefined, espera))
    fireEvent.click(await screen.findByText('Canje sin celular'))
    fireEvent.change(screen.getByPlaceholderText('Ej.: no tiene el celular; lo conozco'), { target: { value: 'Sin celular hoy' } })
    fireEvent.click(screen.getByLabelText(/^1 crédito/))
    fireEvent.click(await screen.findByText(/Pedido pedido:2026-11-16:12/))
    fireEvent.click(screen.getByText('Continuar'))
    fireEvent.click(await screen.findByText('Confirmar'))
    await waitFor(() => expect(api.canjeAprobado).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Canje sin celular de 1 crédito/)).toBeTruthy()
    await waitFor(() => expect(api.resolverMiembro).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/Código no reconocido/)).toBeNull()
  })

  it('el QR de caja abre «Tarjeta vieja» sin pasar por el servidor del Club', async () => {
    render(<Escanear />)
    await screen.findByRole('button', { name: 'Tarjeta vieja' })
    escribirCodigo(QR_CAJA_TARJETA_VIEJA.toLowerCase())
    expect(await screen.findByText('Anfitrión de la tarjeta')).toBeTruthy()
    expect(api.resolverQR).not.toHaveBeenCalled()
    expect(screen.queryByText(/Código no reconocido/)).toBeNull()
  })

  it('el QR de caja con la tarjeta vieja apagada: aviso claro, sin buscador', async () => {
    api.getTarjetaManualActiva.mockResolvedValue(false)
    render(<Escanear />)
    await waitFor(() => expect(api.getTarjetaManualActiva).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    escribirCodigo(QR_CAJA_TARJETA_VIEJA)
    expect(await screen.findByText(MSG_TARJETA_VIEJA_APAGADA)).toBeTruthy()
    expect(screen.queryByText('Anfitrión de la tarjeta')).toBeNull()
    expect(api.resolverQR).not.toHaveBeenCalled()
  })

  it('el plan B de siempre también busca mientras se escribe', async () => {
    render(<Escanear />)
    fireEvent.change(screen.getByLabelText('Buscar referente por nombre, negocio o últimos 4 del teléfono'), { target: { value: '4321' } })
    await waitFor(() => expect(api.buscar).toHaveBeenCalledWith('4321'), espera)
  })
})
