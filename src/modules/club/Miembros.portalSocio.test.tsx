// @vitest-environment happy-dom
// 16-nov (lo vio el dueño): la ficha de un SOCIO no tenía cómo sacar el link de su portal (la tarjeta del QR es solo del
// anfitrión). Ahora: bloque «Portal del socio» con «⎘ Link del portal» y «Mandar por WhatsApp», para owner y para el
// manager de su local; «Mandar por WhatsApp» exige «¿Este es su WhatsApp?» → «Sí, es este» (hallazgo 230).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ClubMiembro, ClubRol } from '../../shared/api/club'
import { linkPortalWhatsApp, puedeLinkPortalDe, textoLinkPortalWhatsApp } from './altaWhatsApp'
import { configurarClubUrl } from './qrFormato'

const rol = vi.hoisted(() => ({ v: 'owner' }))
const api = vi.hoisted(() => ({
  getMiembros: vi.fn(), getSaldos: vi.fn(), getNegocios: vi.fn(), getRoles: vi.fn(), getMovimientos: vi.fn(),
  getContacto: vi.fn(), codigoMiembro: vi.fn(), getLocalesClub: vi.fn(), getMisLocales: vi.fn(), tokenPortal: vi.fn(),
  getSociosPorConfirmar: vi.fn(), getSolicitudesSocio: vi.fn(), getPendientesAprobacion: vi.fn(),
}))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: rol.v, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({ ...(await orig<typeof import('../../shared/api/club')>()), ...api }))

import Miembros from './Miembros'

const TUTEO_VOSEO = /(^|[^\p{L}])(tu|tus|te|ti|vos|sos|tenés|podés|mostrá|mostralo|guardá|guardalo|abrí|usá)(?=$|[^\p{L}])/iu
const TOK = 'ab'.repeat(32)
const URL = 'https://club.ejemplo.test/p/' + TOK

const socio = (x: Partial<ClubMiembro> = {}): ClubMiembro => ({
  id: 'm1', tipo: 'socio', nombre: 'Socia Prueba', negocio_id: null, estado: 'activo', origen: 'caja',
  created_at: '2026-10-01T12:00:00Z', location_id: 'local-a', ...x,
})
const rolSocio: ClubRol = { miembro_id: 'm1', rol: 'socio', estado: 'activo', desde: '2026-10-01T12:00:00Z', alta_por: 'caja' }

function preparar(m: ClubMiembro, tel: string | null = '8888 0000') {
  api.getMiembros.mockResolvedValue([m]); api.getSaldos.mockResolvedValue([]); api.getNegocios.mockResolvedValue([])
  api.getRoles.mockResolvedValue([rolSocio]); api.getMovimientos.mockResolvedValue([])
  api.getContacto.mockResolvedValue({ miembro_id: m.id, telefono: tel, email: null, optin_whatsapp: true, optin_email: false })
  api.codigoMiembro.mockResolvedValue('ABCDEFGHJ'); api.getLocalesClub.mockResolvedValue([])
  api.getSociosPorConfirmar.mockResolvedValue([]); api.getSolicitudesSocio.mockResolvedValue([]); api.getPendientesAprobacion.mockResolvedValue([])
  api.tokenPortal.mockResolvedValue(TOK)
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  configurarClubUrl('https://club.ejemplo.test')
  rol.v = 'owner'
  api.getMisLocales.mockResolvedValue(['local-a'])
})

describe('reglas puras', () => {
  it('quién ve el bloque: owner siempre; manager solo su local; el resto nunca', () => {
    expect(puedeLinkPortalDe('owner', 'local-b', null)).toBe(true)
    expect(puedeLinkPortalDe('manager', 'local-a', ['local-a'])).toBe(true)
    expect(puedeLinkPortalDe('manager', 'local-b', ['local-a'])).toBe(false)
    expect(puedeLinkPortalDe('manager', 'local-a', null)).toBe(false)     // sin saber sus locales, no
    expect(puedeLinkPortalDe('manager', undefined, ['local-a'])).toBe(true)
    for (const r of ['cajero', 'contador', 'salonero', null, undefined]) expect(puedeLinkPortalDe(r, 'local-a', ['local-a'])).toBe(false)
  })
  it('link de WhatsApp: solo con el número confirmado; texto en «usted»', () => {
    expect(linkPortalWhatsApp('88880000', 'Ana', URL, null)).toBeNull()
    expect(linkPortalWhatsApp('88880000', 'Ana', URL, '88881111')).toBeNull()
    const href = linkPortalWhatsApp('8888 0000', 'Ana María', URL, '88880000')!
    expect(href.startsWith('https://wa.me/50688880000?text=')).toBe(true)
    expect(decodeURIComponent(href.split('?text=')[1])).toContain(URL)
    expect(textoLinkPortalWhatsApp('Ana', URL)).not.toMatch(TUTEO_VOSEO)
  })
})

describe('Miembros → ficha del socio → «Portal del socio»', () => {
  it('owner: ve el bloque; abrir la ficha no pide el token; copiar lo pide', async () => {
    preparar(socio())
    const escribir = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escribir }, configurable: true })
    render(<Miembros abrirId="m1" />)
    await screen.findByText('Portal del socio')
    await waitFor(() => expect(api.getContacto).toHaveBeenCalled())
    expect(api.tokenPortal).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('⎘ Link del portal'))
    await screen.findByText('Link del portal copiado.')
    expect(escribir).toHaveBeenCalledWith(URL)
  })

  it('«Mandar por WhatsApp»: sin «Sí, es este» no abre; con «Sí, es este» abre wa.me con el link', async () => {
    preparar(socio())
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<Miembros abrirId="m1" />)
    await screen.findByText('Portal del socio')
    await waitFor(() => expect(api.getContacto).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Mandar por WhatsApp'))
    await screen.findByText(/¿Este es su WhatsApp\? \+506 8888 0000/)
    expect(abrir).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Sí, es este'))
    expect(abrir).toHaveBeenCalledTimes(1)
    const href = String(abrir.mock.calls[0][0])
    expect(href.startsWith('https://wa.me/50688880000?text=')).toBe(true)
    expect(decodeURIComponent(href.split('?text=')[1])).toContain(URL)
    abrir.mockRestore()
  })

  it('«Corregir» no abre WhatsApp y lleva a «Editar»', async () => {
    preparar(socio())
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<Miembros abrirId="m1" />)
    await screen.findByText('Portal del socio')
    await waitFor(() => expect(api.getContacto).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Mandar por WhatsApp'))
    await screen.findByText('Sí, es este')
    fireEvent.click(screen.getByText('Corregir'))
    await screen.findByText('Editar miembro')
    expect(abrir).not.toHaveBeenCalled()
    abrir.mockRestore()
  })

  it('sin WhatsApp cargado: no pide el token ni abre nada', async () => {
    preparar(socio(), null)
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<Miembros abrirId="m1" />)
    await screen.findByText('Portal del socio')
    await waitFor(() => expect(api.getContacto).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Mandar por WhatsApp'))
    await screen.findByText(/No tiene WhatsApp cargado/)
    expect(api.tokenPortal).not.toHaveBeenCalled()
    expect(abrir).not.toHaveBeenCalled()
    abrir.mockRestore()
  })

  it('manager de su local: lo ve; manager de otro local: no', async () => {
    rol.v = 'manager'
    preparar(socio())
    const { unmount } = render(<Miembros abrirId="m1" />)
    await screen.findByText('Portal del socio')
    unmount()
    preparar(socio({ location_id: 'local-b' }))
    render(<Miembros abrirId="m1" />)
    await screen.findByText('Socia Prueba')
    await waitFor(() => expect(api.getMisLocales).toHaveBeenCalledTimes(2))
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByText('Portal del socio')).toBeNull()
  })

  it('rol sin permiso (cajero): no ve el bloque', async () => {
    rol.v = 'cajero'
    preparar(socio())
    render(<Miembros abrirId="m1" />)
    await screen.findByText('Socia Prueba')
    await waitFor(() => expect(api.getContacto).toHaveBeenCalled())
    expect(screen.queryByText('Portal del socio')).toBeNull()
    expect(screen.queryByText('Mandar por WhatsApp')).toBeNull()
  })

  it('anfitrión: sigue con su tarjeta del QR, sin el bloque del socio', async () => {
    preparar(socio({ tipo: 'referente' }))
    render(<Miembros abrirId="m1" />)
    await screen.findByText('Regenerar QR')
    expect(screen.queryByText('Portal del socio')).toBeNull()
  })
})
