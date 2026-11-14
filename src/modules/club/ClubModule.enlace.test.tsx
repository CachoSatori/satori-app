// @vitest-environment happy-dom
// 164 (B6): los avisos del Inicio abren el Club en la pestaña donde se revisa (?vista=…); el cajero sigue en «Escanear».
// También: el owner edita los umbrales de las alertas por local. Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const s = vi.hoisted(() => ({ role: 'manager', guardado: null as unknown, umbrales: null as unknown }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: s.role, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getLocalesClub: async () => [{ id: 'local-a', nombre: 'Local A', activo: true }],
  getClubUrl: async () => null,
  getUmbrales: async () => s.umbrales,
  guardarUmbrales: async (_l: string, u: unknown) => { s.guardado = u },
}))
vi.mock('./Escanear', () => ({ default: () => <p>pantalla escanear</p> }))
vi.mock('./Miembros', () => ({ default: ({ abrirId }: { abrirId?: string | null }) => <p>pantalla miembros {abrirId ?? 'ninguno'}</p> }))
vi.mock('./Excepciones', () => ({ default: ({ tipoInicial }: { tipoInicial?: string | null }) => <p>pantalla excepciones {tipoInicial ?? 'todas'}</p> }))
vi.mock('./Reportes', () => ({ default: () => <p>pantalla reportes</p> }))

import ClubModule from './ClubModule'

const montar = (url: string) => render(<MemoryRouter initialEntries={[url]}><ClubModule /></MemoryRouter>)

beforeEach(() => {
  cleanup(); s.role = 'manager'; s.guardado = null
  s.umbrales = { alerta_anfitrion_24h_max: 5, alerta_mismo_usuario_max: 2, alerta_mismo_usuario_dias: 3,
                 alerta_visitas_sin_factura_max: 0, alerta_canjes_sin_codigo_max: 0 }
})

describe('Club · enlaces desde el Inicio (164)', () => {
  it('?vista=miembros&miembro=… abre Miembros con esa ficha', async () => {
    montar('/club?vista=miembros&miembro=m-1')
    expect(await screen.findByText('pantalla miembros m-1')).toBeTruthy()
  })
  it('?vista=excepciones&tipo=CANJE_SIN_CODIGO abre Excepciones filtradas', async () => {
    montar('/club?vista=excepciones&tipo=CANJE_SIN_CODIGO')
    expect(await screen.findByText('pantalla excepciones CANJE_SIN_CODIGO')).toBeTruthy()
  })
  it('?vista=reportes abre Reportes', async () => {
    montar('/club?vista=reportes')
    expect(await screen.findByText('pantalla reportes')).toBeTruthy()
  })
  it('el cajero no salta de pestaña: sigue en Escanear', async () => {
    s.role = 'cajero'
    montar('/club?vista=excepciones&tipo=CANJE_SIN_CODIGO')
    expect(await screen.findByText('pantalla escanear')).toBeTruthy()
    expect(screen.queryByText(/pantalla excepciones/)).toBeNull()
  })
  it('una vista inventada no rompe: Escanear', async () => {
    montar('/club?vista=locales')
    expect(await screen.findByText('pantalla escanear')).toBeTruthy()
  })
})

describe('Club · Locales · umbrales de las alertas (164, owner)', () => {
  it('el owner cambia un umbral y lo guarda; fuera de rango no deja guardar', async () => {
    s.role = 'owner'
    montar('/club')
    fireEvent.click(await screen.findByText('Locales'))
    const campo = await screen.findByLabelText('Avisar si un anfitrión suma más de … visitas en 24 h') as HTMLInputElement
    expect(campo.value).toBe('5')
    const boton = screen.getByText('Guardar umbrales') as HTMLButtonElement
    fireEvent.change(campo, { target: { value: '0' } })
    expect(boton.disabled).toBe(true)
    fireEvent.change(campo, { target: { value: '8' } })
    expect(boton.disabled).toBe(false)
    fireEvent.click(boton)
    await waitFor(() => expect(s.guardado).toMatchObject({ alerta_anfitrion_24h_max: 8, alerta_canjes_sin_codigo_max: 0 }))
    expect(await screen.findByText(/Umbrales guardados/)).toBeTruthy()
  })
})
