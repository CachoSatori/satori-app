// @vitest-environment happy-dom
// 164 (B6): los avisos del Inicio abren el Club en la pestaña donde se revisa (?vista=…); el cajero sigue en «Escanear».
// También: el owner edita los umbrales de las alertas por local. Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const s = vi.hoisted(() => ({
  role: 'manager', guardado: null as unknown, umbrales: null as unknown, umbralesFalla: 0, lecturas: 0,
  locales: [{ id: 'local-a', nombre: 'Local A', activo: true }] as Array<{ id: string; nombre: string; activo: boolean }>,
  localesEnEspera: null as Promise<void> | null,
}))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: s.role, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getLocalesClub: async () => { if (s.localesEnEspera) await s.localesEnEspera; return s.locales },
  // 170: la pantalla pide los locales según el rol; en estas pruebas el manager tiene asignados todos.
  getLocalesClubParaRol: async () => { if (s.localesEnEspera) await s.localesEnEspera; return s.locales },
  getClubUrl: async () => null,
  getUmbrales: async () => { s.lecturas++; if (s.umbralesFalla > 0) { s.umbralesFalla--; throw new Error('sin conexión') } return s.umbrales },
  guardarUmbrales: async (_l: string, u: unknown) => { s.guardado = u },
}))
vi.mock('./Escanear', () => ({ default: () => <p>pantalla escanear</p> }))
vi.mock('./Miembros', () => ({ default: ({ abrirId }: { abrirId?: string | null }) => <p>pantalla miembros {abrirId ?? 'ninguno'}</p> }))
vi.mock('./Excepciones', () => ({ default: ({ tipoInicial }: { tipoInicial?: string | null }) => <p>pantalla excepciones {tipoInicial ?? 'todas'}</p> }))
vi.mock('./Reportes', () => ({ default: () => <p>pantalla reportes</p> }))

import ClubModule from './ClubModule'

const montar = (url: string) => render(<MemoryRouter initialEntries={[url]}><ClubModule /></MemoryRouter>)

beforeEach(() => {
  cleanup(); s.role = 'manager'; s.guardado = null; s.umbralesFalla = 0; s.lecturas = 0; s.localesEnEspera = null
  s.locales = [{ id: 'local-a', nombre: 'Local A', activo: true }]
  localStorage.clear()
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

describe('Club · verificador #183', () => {
  it('?local=… abre el Club en ese local', async () => {
    s.locales = [{ id: 'local-a', nombre: 'Local A', activo: true }, { id: 'local-b', nombre: 'Local B', activo: true }]
    montar('/club?vista=reportes&local=local-b')
    const sel = await screen.findByDisplayValue('Local B') as HTMLSelectElement
    expect(sel.value).toBe('local-b')
  })
  it('umbrales: si la lectura falla, error visible y «Reintentar» los trae', async () => {
    s.role = 'owner'; s.umbralesFalla = 1
    montar('/club')
    fireEvent.click(await screen.findByText('Locales'))
    expect(await screen.findByText(/No se pudieron leer los umbrales/)).toBeTruthy()
    expect(screen.queryByText('Guardar umbrales')).toBeNull()
    fireEvent.click(screen.getByText('Reintentar'))
    expect(await screen.findByLabelText('Avisar si un anfitrión suma más de … visitas en 24 h')).toBeTruthy()
    expect(s.lecturas).toBe(2)
  })
  it('umbrales: si los locales llegan después de abrir «Locales», igual cargan (no queda «Cargando…»)', async () => {
    s.role = 'owner'
    let soltar = () => {}
    s.localesEnEspera = new Promise<void>(r => { soltar = r })
    montar('/club')
    fireEvent.click(await screen.findByText('Locales'))
    expect(s.lecturas).toBe(0)
    soltar()
    expect(await screen.findByLabelText('Avisar si un anfitrión suma más de … visitas en 24 h')).toBeTruthy()
  })
  it('umbrales: local sin configuración lo dice', async () => {
    s.role = 'owner'; s.umbrales = null
    montar('/club')
    fireEvent.click(await screen.findByText('Locales'))
    expect(await screen.findByText('Este local no tiene configuración del Club.')).toBeTruthy()
  })
})
