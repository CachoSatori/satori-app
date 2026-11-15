// @vitest-environment happy-dom
// D6 A (mig 163) · «Validar socio» y la reactivación piden «Es mayor de 18 años» solo cuando la persona no tiene la edad
// registrada. La base (club_socio_validar_v2 / club_miembro_guardar_v2 y el trigger) es la que manda: acá se prueba que
// la pantalla muestre la casilla cuando la base la va a pedir, que el botón espere la casilla y que mande el dato.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { pideEdadAlValidar, pideEdadAlReactivar } from './edadSocio'
import type { EdadSocio } from '../../shared/api/club'

const rol = vi.hoisted(() => ({ v: 'cajero' }))
const api = vi.hoisted(() => ({
  resolverQR: vi.fn(), socioValidar: vi.fn(), getEdadSocio: vi.fn(), guardarMiembro: vi.fn(), getContacto: vi.fn(),
}))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: rol.v, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({ ...(await orig<typeof import('../../shared/api/club')>()), ...api }))

import Escanear from './Escanear'
import { FormMiembro } from './Miembros'

const rolSocio = (x: Partial<EdadSocio> = {}): EdadSocio =>
  ({ estado: 'pendiente', baja_por: null, alta_por: 'autoalta', validado_en: null, mayor_edad_en: null, ...x })

describe('cuándo se pregunta la edad (espeja la base)', () => {
  it('validar: solo si no tiene la edad; si no se pudo leer el rol, se pregunta', () => {
    expect(pideEdadAlValidar(rolSocio())).toBe(true)
    expect(pideEdadAlValidar(rolSocio({ mayor_edad_en: '2026-11-14T12:00:00Z' }))).toBe(false)
    expect(pideEdadAlValidar(null)).toBe(false)
    expect(pideEdadAlValidar(undefined)).toBe(true)
  })
  it('reactivar: solo de baja → activo, con un socio sin edad que vuelve a activo', () => {
    const baja = rolSocio({ estado: 'baja', baja_por: 'gerencia', alta_por: 'caja', validado_en: '2026-10-01T12:00:00Z' })
    expect(pideEdadAlReactivar(baja, 'baja', 'activo')).toBe(true)
    expect(pideEdadAlReactivar(baja, 'baja', 'baja')).toBe(false)           // no reactiva
    expect(pideEdadAlReactivar(baja, 'activo', 'activo')).toBe(false)       // solo edita
    expect(pideEdadAlReactivar(baja, undefined, 'activo')).toBe(false)      // alta nueva
    expect(pideEdadAlReactivar({ ...baja, mayor_edad_en: '2026-11-14T12:00:00Z' }, 'baja', 'activo')).toBe(false)
    expect(pideEdadAlReactivar({ ...baja, baja_por: 'socio' }, 'baja', 'activo')).toBe(false)   // no vuelve
    expect(pideEdadAlReactivar({ ...baja, alta_por: 'autoalta', validado_en: null }, 'baja', 'activo')).toBe(false)   // vuelve a pendiente
    expect(pideEdadAlReactivar({ ...baja, alta_por: 'migracion' }, 'baja', 'activo')).toBe(true)
    expect(pideEdadAlReactivar(null, 'baja', 'activo')).toBe(false)          // no es socio
    expect(pideEdadAlReactivar(undefined, 'baja', 'activo')).toBe(true)      // no se pudo leer
  })
})

async function abrirPendiente() {
  api.resolverQR.mockResolvedValue({ tipo: 'socio', datos: {
    id: 'm1', nombre: 'Socia Prueba', persona_estado: 'activo', estado: 'pendiente', desde: '2026-11-01T12:00:00Z',
    alta_por: 'autoalta', provisional_hasta: null, es_anfitrion: false } })
  render(<Escanear />)
  fireEvent.change(screen.getByPlaceholderText('Cupón, canje, socio o pase'), { target: { value: 'ABCDEFGHJ' } })
  fireEvent.click(screen.getByText('Ver'))
  await screen.findByText(/Socio pendiente/)
  return () => screen.getByText('Validar socio').closest('button') as HTMLButtonElement
}
const casilla = (l: RegExp) => screen.getByText(l).parentElement!.querySelector('input') as HTMLInputElement

describe('Escanear → «Validar socio» (163)', () => {
  beforeEach(() => {
    rol.v = 'cajero'
    api.socioValidar.mockReset().mockResolvedValue({ miembro_id: 'm1', estado: 'activo', provisional_hasta: '2026-11-21T12:00:00Z' })
    api.getEdadSocio.mockReset()
  })

  it('sin la edad registrada: aparece la casilla, el botón la espera y manda mayorEdad = true', async () => {
    api.getEdadSocio.mockResolvedValue(rolSocio())
    const boton = await abrirPendiente()
    await screen.findByText(/Es mayor de 18 años/)
    fireEvent.click(casilla(/Verifiqué que es local/))
    expect(boton().disabled).toBe(true)
    fireEvent.click(boton())
    expect(api.socioValidar).not.toHaveBeenCalled()
    fireEvent.click(casilla(/Es mayor de 18 años/))
    expect(boton().disabled).toBe(false)
    fireEvent.click(boton())
    await waitFor(() => expect(api.socioValidar).toHaveBeenCalledWith('m1', true, true))
  })

  it('con la edad ya registrada: no muestra la casilla y manda null', async () => {
    api.getEdadSocio.mockResolvedValue(rolSocio({ mayor_edad_en: '2026-11-14T12:00:00Z' }))
    const boton = await abrirPendiente()
    await waitFor(() => expect(api.getEdadSocio).toHaveBeenCalledWith('m1'))
    fireEvent.click(casilla(/Verifiqué que es local/))
    await waitFor(() => expect(boton().disabled).toBe(false))
    expect(screen.queryByText(/Es mayor de 18 años/)).toBeNull()
    fireEvent.click(boton())
    await waitFor(() => expect(api.socioValidar).toHaveBeenCalledWith('m1', true, null))
  })

  it('si no se pudo leer el rol, pregunta igual', async () => {
    api.getEdadSocio.mockRejectedValue(new Error('Sin conexión'))
    await abrirPendiente()
    expect(await screen.findByText(/Es mayor de 18 años/)).toBeTruthy()
  })
})

describe('Miembros → Editar: reactivar (163)', () => {
  const inicial = { id: 'm2', tipo: 'referente', nombre: 'Anfitrion Prueba', negocio_id: null, estado: 'baja' } as unknown as Parameters<typeof FormMiembro>[0]['inicial']
  const props = { tipoPorDefecto: 'referente' as const, negocios: [], saldoPersonas: 0, onNegocioCreado: () => {}, onCancelar: () => {}, onGuardado: async () => {} }
  const estado = () => screen.getByText('Estado').parentElement!.querySelector('select') as HTMLSelectElement
  const guardar = () => screen.getByText('Guardar').closest('button') as HTMLButtonElement

  beforeEach(() => {
    rol.v = 'manager'
    api.getContacto.mockReset().mockResolvedValue(null)
    api.guardarMiembro.mockReset().mockResolvedValue('m2')
    api.getEdadSocio.mockReset()
  })

  it('socio sin edad que vuelve a activo: casilla obligatoria y manda mayor_edad = true', async () => {
    api.getEdadSocio.mockResolvedValue(rolSocio({ estado: 'baja', baja_por: 'gerencia', alta_por: 'caja', validado_en: '2026-10-01T12:00:00Z' }))
    render(<FormMiembro inicial={inicial} {...props} />)
    await waitFor(() => expect(api.getEdadSocio).toHaveBeenCalledWith('m2'))
    expect(screen.queryByText(/Es mayor de 18 años/)).toBeNull()   // sigue de baja: no hace falta
    fireEvent.change(estado(), { target: { value: 'activo' } })
    await screen.findByText(/Es mayor de 18 años/)
    expect(guardar().disabled).toBe(true)
    fireEvent.click(casilla(/Es mayor de 18 años/))
    expect(guardar().disabled).toBe(false)
    fireEvent.click(guardar())
    await waitFor(() => expect(api.guardarMiembro).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2', estado: 'activo', mayor_edad: true })))
  })

  it('socio con la edad ya registrada: reactiva sin casilla y manda null', async () => {
    api.getEdadSocio.mockResolvedValue(rolSocio({ estado: 'baja', baja_por: 'gerencia', alta_por: 'caja', mayor_edad_en: '2026-11-14T12:00:00Z' }))
    render(<FormMiembro inicial={inicial} {...props} />)
    await waitFor(() => expect(api.getEdadSocio).toHaveBeenCalledWith('m2'))
    fireEvent.change(estado(), { target: { value: 'activo' } })
    await waitFor(() => expect(guardar().disabled).toBe(false))
    expect(screen.queryByText(/Es mayor de 18 años/)).toBeNull()
    fireEvent.click(guardar())
    await waitFor(() => expect(api.guardarMiembro).toHaveBeenCalledWith(expect.objectContaining({ estado: 'activo', mayor_edad: null })))
  })

  it('miembro activo: no lee el rol ni muestra la casilla', async () => {
    render(<FormMiembro inicial={{ ...inicial!, estado: 'activo' }} {...props} />)
    await waitFor(() => expect(guardar().disabled).toBe(false))
    expect(api.getEdadSocio).not.toHaveBeenCalled()
    expect(screen.queryByText(/Es mayor de 18 años/)).toBeNull()
  })
})
