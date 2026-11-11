// @vitest-environment happy-dom
// (11-nov, modo transición) La caja registra una tarjeta vieja (de papel, sin QR) eligiendo al anfitrión de la búsqueda.
// Corre el Escanear real contra una base de mentira (el cliente de Supabase simulado): nombres ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const { llamadas, estado } = vi.hoisted(() => ({
  llamadas: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  estado: { tarjetaActiva: true, locales: [{ location_id: 'local-prueba', club_activo: true, tarjeta_manual_activa: true }] },
}))

const FICHA = {
  tipo: 'referente',
  datos: { id: 'm1', nombre: 'Anfitrión Uno', tipo_miembro: 'referente', negocio: 'Hotel Ficticio', estado: 'activo', personas: 6, creditos: 1,
           personas_proximo: 3, personas_por_credito: 6, valor_credito_crc: 18000, canjeado_hoy: 0, canje_min: 1, canje_paso: 0.5,
           max_creditos_por_visita: 2, tarjeta_manual_activa: true },
}

vi.mock('../../shared/api/supabase', () => {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    llamadas.push({ fn, args })
    const datos: Record<string, unknown> = {
      club_buscar: [{ id: 'm1', nombre: 'Anfitrión Uno', negocio: 'Hotel Ficticio', tipo: 'referente', estado: 'activo', personas: 6, creditos: 1 }],
      club_resolver_miembro: { ...FICHA, datos: { ...FICHA.datos, tarjeta_manual_activa: estado.tarjetaActiva } },
      club_pedidos_abiertos: [{ pedido: 'pedido:2026-11-11:12', mesa: '5', area: 'S', salonero: 'Salonero Ficticio', total_crc: 10000, pax: 4, actualizado: '2026-11-11T20:00:00Z' }],
      club_facturas_recientes: [],
      club_tarjeta_manual: [{ personas: 8, creditos: 1 }],
      club_resolver: { tipo: 'desconocido', datos: {} },
    }
    return { data: datos[fn] ?? null, error: null }
  }
  const from = (tabla: string) => {
    const q = {
      select: () => q, order: () => q, eq: () => q, limit: () => q,
      then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: tabla === 'club_config' ? estado.locales : [], error: null }).then(ok),
    }
    return q
  }
  return { supabase: { rpc, from } }
})
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'cajero' } }) }))

import Escanear from './Escanear'

const escribir = (rotulo: RegExp, valor: string) => fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } })

async function cargarTarjetaDesdeLaFicha() {
  await screen.findByText('Anfitrión Uno')
  fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '2' } })
  fireEvent.click(await screen.findByRole('button', { name: /Salonero Ficticio/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  fireEvent.click(await screen.findByRole('button', { name: /^Confirmar/ }))
  await waitFor(() => expect(llamadas.some(l => l.fn === 'club_tarjeta_manual')).toBe(true))
}

beforeEach(() => { cleanup(); llamadas.length = 0; estado.tarjetaActiva = true; estado.locales[0].tarjeta_manual_activa = true })

describe('Escanear · tarjeta por búsqueda (el camino de hoy, «plan B»)', () => {
  it('después de registrar, el aviso es el de éxito (no «Código no reconocido») y la cuenta se cierra', async () => {
    render(<Escanear />)
    escribir(/Buscar referente|Buscar anfitrión/i, 'anfi')
    const boton = screen.queryByRole('button', { name: 'Buscar' })
    if (boton) fireEvent.click(boton)
    fireEvent.click(await screen.findByRole('button', { name: /Anfitrión Uno/ }))
    await cargarTarjetaDesdeLaFicha()
    await waitFor(() => expect(screen.getByText(/\+2 personas a Anfitrión Uno/)).toBeTruthy())
    expect(screen.queryByText(/Código no reconocido/)).toBeNull()
    const t = llamadas.find(l => l.fn === 'club_tarjeta_manual')!
    expect(t.args).toMatchObject({ p_miembro: 'm1', p_personas: 2 })
  })
})

describe('Escanear · «Tarjeta vieja (sin QR)» (modo transición)', () => {
  it('el botón aparece solo con la tarjeta vieja encendida en el local', async () => {
    render(<Escanear />)
    expect(await screen.findByRole('button', { name: 'Tarjeta vieja (sin QR)' })).toBeTruthy()
    cleanup()
    estado.locales[0].tarjeta_manual_activa = false
    render(<Escanear />)
    await screen.findByRole('button', { name: /Escanear/ })
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: 'Tarjeta vieja (sin QR)' })).toBeNull()
  })

  it('botón → busca mientras se escribe (una sola consulta) → elegir → personas y pedido → queda registrada', async () => {
    render(<Escanear />)
    fireEvent.click(await screen.findByRole('button', { name: 'Tarjeta vieja (sin QR)' }))
    expect(screen.getByText(/Llegó con tarjeta vieja/)).toBeTruthy()
    for (const v of ['a', 'an', 'anf', 'anfi']) escribir(/Anfitrión de la tarjeta/, v)        // sin tocar «Buscar»
    fireEvent.click(await screen.findByRole('button', { name: /Anfitrión Uno/ }, { timeout: 3000 }))
    expect(llamadas.filter(l => l.fn === 'club_buscar')).toHaveLength(1)
    expect(llamadas.find(l => l.fn === 'club_buscar')!.args).toEqual({ p_q: 'anfi' })
    expect(await screen.findByText(/Llegó con tarjeta vieja \(de papel, sin QR\)/)).toBeTruthy()
    await cargarTarjetaDesdeLaFicha()
    await waitFor(() => expect(screen.getByText(/Tarjeta vieja: \+2 personas a Anfitrión Uno/)).toBeTruthy())
    expect(screen.queryByText(/Código no reconocido/)).toBeNull()
    // CLUB-AUD-30: en ningún momento se pidió el código del QR del anfitrión ni su link del portal
    expect(llamadas.some(l => /codigo|link_portal/.test(l.fn))).toBe(false)
  })

  it('con menos de 3 letras no consulta', async () => {
    render(<Escanear />)
    fireEvent.click(await screen.findByRole('button', { name: 'Tarjeta vieja (sin QR)' }))
    escribir(/Anfitrión de la tarjeta/, 'an')
    await new Promise(r => setTimeout(r, 700))
    expect(llamadas.some(l => l.fn === 'club_buscar')).toBe(false)
    expect(screen.getByText(/Escribí al menos 3 letras/)).toBeTruthy()
  })

  it('el QR de caja abre el mismo flujo, sin pasar por la base y sin dar permisos', async () => {
    render(<Escanear />)
    await screen.findByRole('button', { name: 'Tarjeta vieja (sin QR)' })
    escribir(/Código a mano/, 'satori-caja:tarjeta-vieja')
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
    expect(await screen.findByText(/Llegó con tarjeta vieja/)).toBeTruthy()
    expect(llamadas.some(l => l.fn === 'club_resolver')).toBe(false)
  })

  it('el QR de caja con la tarjeta vieja apagada: avisa y no abre nada', async () => {
    estado.locales[0].tarjeta_manual_activa = false
    render(<Escanear />)
    await screen.findByRole('button', { name: /Escanear/ })
    await new Promise(r => setTimeout(r, 50))
    escribir(/Código a mano/, 'SATORI-CAJA:TARJETA-VIEJA')
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
    expect(await screen.findByText(/La tarjeta vieja está desactivada en este local/)).toBeTruthy()
    expect(screen.queryByText(/Llegó con tarjeta vieja/)).toBeNull()
  })
})
