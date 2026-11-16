// @vitest-environment happy-dom
// D1 (14-nov) · Alta de socio en caja → «Mandarle su link por WhatsApp ↗» (wa.me con el link del portal, en «usted»).
// Mig 156: el alta devuelve el token del socio NUEVO, también al cajero. Si no viene (número que ya era de alguien),
// solo owner y manager lo piden con `club_miembro_token` (mig 150); al cajero no se le muestra el enlace.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { formatoWhatsApp, linkAltaWhatsApp, textoAltaWhatsApp, puedeMandarLinkPortal, tokenDelAlta } from './altaWhatsApp'
import { configurarClubUrl } from './qrFormato'

const rol = vi.hoisted(() => ({ v: 'manager' }))
const api = vi.hoisted(() => ({ socioAltaCaja: vi.fn(), tokenPortal: vi.fn() }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: rol.v, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({ ...(await orig<typeof import('../../shared/api/club')>()), ...api }))

import Escanear from './Escanear'

// Las mismas palabras que src/shared/wallet/usted.test.ts (tuteo y voseo).
const TUTEO_VOSEO = /(^|[^\p{L}])(tu|tus|te|ti|vos|sos|tenés|podés|mostrá|mostralo|guardá|guardalo|abrí|usá)(?=$|[^\p{L}])/iu
const URL = 'https://club.ejemplo.test/p/' + 'ab'.repeat(32)
const TOK_ALTA = 'cd'.repeat(32)   // el que devuelve el alta (mig 156)
const URL_ALTA = 'https://club.ejemplo.test/p/' + TOK_ALTA

describe('altaWhatsApp: texto y link', () => {
  it('arma el wa.me con el número internacional y el link del portal', () => {
    const href = linkAltaWhatsApp('8888 0000', 'Ana María Prueba', URL, '8888 0000')!
    expect(href.startsWith('https://wa.me/50688880000?text=')).toBe(true)
    const texto = decodeURIComponent(href.split('?text=')[1])
    expect(texto).toContain(URL)
    expect(texto).toContain('Hola, Ana.')
  })
  it('número con +506 o extranjero: no duplica el código', () => {
    expect(linkAltaWhatsApp('+506 8888-0000', 'Ana', URL, '88880000')!.startsWith('https://wa.me/50688880000?')).toBe(true)
    expect(linkAltaWhatsApp('+1 555 010 0000', 'Ana', URL, '+1 555 010 0000')!.startsWith('https://wa.me/15550100000?')).toBe(true)
  })
  it('sin dígitos no hay link', () => {
    expect(linkAltaWhatsApp('—', 'Ana', URL, '—')).toBeNull()
  })
  it('hallazgo 230: sin el número confirmado no hay link; con otro número confirmado, tampoco', () => {
    expect(linkAltaWhatsApp('88880000', 'Ana', URL, null)).toBeNull()
    expect(linkAltaWhatsApp('88880000', 'Ana', URL, '88880001')).toBeNull()
    expect(linkAltaWhatsApp('88880000', 'Ana', URL, '')).toBeNull()
    // el mismo número escrito distinto sí vale (el cajero confirmó el mismo WhatsApp)
    expect(linkAltaWhatsApp('88880000', 'Ana', URL, '+506 8888 0000')).not.toBeNull()
  })
  it('hallazgo 230: el número como se lo lee el cajero', () => {
    expect(formatoWhatsApp('88880000')).toBe('+506 8888 0000')
    expect(formatoWhatsApp('+506 8888-0000')).toBe('+506 8888 0000')
    expect(formatoWhatsApp('+1 555 010 0000')).toBe('+15550100000')
    expect(formatoWhatsApp('—')).toBe('')
  })
  it('el texto para el cliente va de «usted»', () => {
    const t = textoAltaWhatsApp('Ana', URL)
    expect(TUTEO_VOSEO.test(t), t).toBe(false)
    expect(t).toMatch(/Guárdelo y muéstrelo/)
  })
  it('el token general (club_miembro_token): solo owner y manager', () => {
    expect(['owner', 'manager', 'cajero', 'salonero', null].map(puedeMandarLinkPortal)).toEqual([true, true, false, false, false])
  })
})

describe('tokenDelAlta (mig 156)', () => {
  it('si el alta trajo el token, lo usa para cualquier rol (también el cajero) sin pedir nada', async () => {
    for (const rol of ['cajero', 'manager', 'owner']) {
      const pedir = vi.fn()
      expect(await tokenDelAlta({ miembro_id: 'm1', token_portal: TOK_ALTA }, rol, pedir)).toBe(TOK_ALTA)
      expect(pedir).not.toHaveBeenCalled()
    }
  })
  it('sin token en el alta: manager lo pide con club_miembro_token', async () => {
    const pedir = vi.fn().mockResolvedValue('ef'.repeat(32))
    expect(await tokenDelAlta({ miembro_id: 'm1', token_portal: null }, 'manager', pedir)).toBe('ef'.repeat(32))
    expect(pedir).toHaveBeenCalledWith('m1')
  })
  it('sin token en el alta: el cajero no pide nada (la base se lo negaría) y queda null', async () => {
    const pedir = vi.fn()
    expect(await tokenDelAlta({ miembro_id: 'm1', token_portal: null }, 'cajero', pedir)).toBeNull()
    expect(await tokenDelAlta({ miembro_id: 'm1' }, 'cajero', pedir)).toBeNull()
    expect(pedir).not.toHaveBeenCalled()
  })
})

async function darDeAlta() {
  render(<Escanear />)
  fireEvent.click(screen.getByText(/Nuevo socio del Local Club/))
  const campo = (l: RegExp) => screen.getByText(l).parentElement!.querySelector('input') as HTMLInputElement
  fireEvent.change(campo(/Nombre y apellido/), { target: { value: 'Ana Prueba' } })
  fireEvent.change(campo(/^WhatsApp$/), { target: { value: '88880000' } })
  fireEvent.click(screen.getByText(/Verifiqué que es local/).parentElement!.querySelector('input')!)
  fireEvent.click(screen.getByText(/Es mayor de 18 años/).parentElement!.querySelector('input')!)
  fireEvent.click(screen.getByText('Dar de alta'))
  fireEvent.click(screen.getByText('Sí, es este'))   // hallazgo 230: confirma el WhatsApp
  await screen.findByText(/es socio \(activo provisional/)
}

describe('Escanear → Nuevo socio: enlace de WhatsApp al terminar', () => {
  beforeEach(() => {
    configurarClubUrl('https://club.ejemplo.test')
    api.socioAltaCaja.mockReset().mockResolvedValue({ miembro_id: 'm1', estado: 'activo', provisional_hasta: '2026-11-20T12:00:00Z' })
    api.tokenPortal.mockReset().mockResolvedValue('ab'.repeat(32))
  })

  it('cajero: con el token que devuelve el alta (mig 156) aparece el enlace, sin pedir el token general', async () => {
    rol.v = 'cajero'
    api.socioAltaCaja.mockResolvedValue({ miembro_id: 'm1', estado: 'activo', provisional_hasta: '2026-11-20T12:00:00Z', token_portal: TOK_ALTA })
    await darDeAlta()
    const a = await screen.findByText(/Mandarle su link por WhatsApp/)
    expect(api.tokenPortal).not.toHaveBeenCalled()
    const href = a.closest('a')!.getAttribute('href')!
    expect(href.startsWith('https://wa.me/50688880000?text=')).toBe(true)
    expect(decodeURIComponent(href)).toContain(URL_ALTA)
    expect(screen.queryByText(/se lo manda un manager/)).toBeNull()
  })

  it('manager: si el alta trajo el token, usa ese y no llama a club_miembro_token', async () => {
    rol.v = 'manager'
    api.socioAltaCaja.mockResolvedValue({ miembro_id: 'm1', estado: 'activo', provisional_hasta: '2026-11-20T12:00:00Z', token_portal: TOK_ALTA })
    await darDeAlta()
    const a = await screen.findByText(/Mandarle su link por WhatsApp/)
    expect(api.tokenPortal).not.toHaveBeenCalled()
    expect(decodeURIComponent(a.closest('a')!.getAttribute('href')!)).toContain(URL_ALTA)
  })

  it('manager, alta sin token (número que ya era de alguien): lo pide con club_miembro_token', async () => {
    rol.v = 'manager'
    await darDeAlta()
    const a = await screen.findByText(/Mandarle su link por WhatsApp/)
    expect(api.tokenPortal).toHaveBeenCalledWith('m1')
    const href = a.closest('a')!.getAttribute('href')!
    expect(href.startsWith('https://wa.me/50688880000?text=')).toBe(true)
    expect(decodeURIComponent(href)).toContain(URL)
  })

  it('cajero, alta sin token (número que ya era de alguien): no pide el token general ni muestra el enlace; lo manda un manager', async () => {
    rol.v = 'cajero'
    api.socioAltaCaja.mockResolvedValue({ miembro_id: 'm1', estado: 'activo', provisional_hasta: '2026-11-20T12:00:00Z', token_portal: null })
    await darDeAlta()
    expect(api.tokenPortal).not.toHaveBeenCalled()
    expect(screen.queryByText(/Mandarle su link por WhatsApp/)).toBeNull()
    expect(screen.getByText(/se lo manda un manager desde Miembros/)).toBeTruthy()
  })

  it('si falla el token, el alta igual queda y avisa cómo copiarlo', async () => {
    rol.v = 'owner'
    api.tokenPortal.mockRejectedValue(new Error('Sin permiso'))
    await darDeAlta()
    await waitFor(() => expect(screen.getByText(/No se pudo armar el link de WhatsApp/)).toBeTruthy())
    expect(screen.queryByText(/Mandarle su link por WhatsApp/)).toBeNull()
  })
})

describe('Escanear → Nuevo socio: «Es mayor de 18 años» (D6 A)', () => {
  beforeEach(() => {
    rol.v = 'cajero'
    api.socioAltaCaja.mockReset().mockResolvedValue({ miembro_id: 'm1', estado: 'activo', provisional_hasta: '2026-11-20T12:00:00Z' })
  })

  it('sin la casilla de edad, «Dar de alta» queda deshabilitado y no llama a la base', () => {
    render(<Escanear />)
    fireEvent.click(screen.getByText(/Nuevo socio del Local Club/))
    const campo = (l: RegExp) => screen.getByText(l).parentElement!.querySelector('input') as HTMLInputElement
    fireEvent.change(campo(/Nombre y apellido/), { target: { value: 'Ana Prueba' } })
    fireEvent.change(campo(/^WhatsApp$/), { target: { value: '88880000' } })
    fireEvent.click(campo(/Verifiqué que es local/))
    const boton = screen.getByText('Dar de alta').closest('button') as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    fireEvent.click(boton)
    expect(api.socioAltaCaja).not.toHaveBeenCalled()
    fireEvent.click(campo(/Es mayor de 18 años/))
    expect(boton.disabled).toBe(false)
  })

  it('con la casilla, manda mayorEdad = true a la base', async () => {
    await darDeAlta()
    expect(api.socioAltaCaja).toHaveBeenCalledWith('Ana Prueba', '88880000', null, true, true, null)
  })
})

describe('Escanear → Nuevo socio: «¿Este es su WhatsApp?» antes del alta y del link (hallazgo 230)', () => {
  beforeEach(() => {
    rol.v = 'cajero'
    configurarClubUrl('https://club.ejemplo.test')
    api.socioAltaCaja.mockReset().mockResolvedValue({ miembro_id: 'm1', estado: 'activo', provisional_hasta: '2026-11-20T12:00:00Z', token_portal: TOK_ALTA })
    api.tokenPortal.mockReset()
  })
  const campo = (l: RegExp) => screen.getByText(l).parentElement!.querySelector('input') as HTMLInputElement
  function llenar(tel = '88880000') {
    render(<Escanear />)
    fireEvent.click(screen.getByText(/Nuevo socio del Local Club/))
    fireEvent.change(campo(/Nombre y apellido/), { target: { value: 'Ana Prueba' } })
    fireEvent.change(campo(/^WhatsApp$/), { target: { value: tel } })
    fireEvent.click(campo(/Verifiqué que es local/))
    fireEvent.click(campo(/Es mayor de 18 años/))
    fireEvent.click(screen.getByText('Dar de alta'))
  }

  it('«Dar de alta» muestra el número formateado y NO da de alta ni arma el link hasta «Sí, es este»', async () => {
    llenar()
    expect(screen.getByText('¿Este es su WhatsApp? +506 8888 0000')).toBeTruthy()
    expect(api.socioAltaCaja).not.toHaveBeenCalled()
    expect(screen.queryByText(/Mandarle su link por WhatsApp/)).toBeNull()
    expect(document.querySelector('a[href^="https://wa.me/"]')).toBeNull()
    fireEvent.click(screen.getByText('Sí, es este'))
    const a = await screen.findByText(/Mandarle su link por WhatsApp/)
    expect(api.socioAltaCaja).toHaveBeenCalledTimes(1)
    expect(a.closest('a')!.getAttribute('href')!.startsWith('https://wa.me/50688880000?text=')).toBe(true)
  })

  it('«Corregir» vuelve al campo del WhatsApp sin dar de alta; el número corregido se vuelve a confirmar y es el que se usa', async () => {
    llenar('88880001')
    fireEvent.click(screen.getByText('Corregir'))
    expect(screen.queryByText(/¿Este es su WhatsApp\?/)).toBeNull()
    expect(document.activeElement).toBe(campo(/^WhatsApp$/))
    expect(api.socioAltaCaja).not.toHaveBeenCalled()
    fireEvent.change(campo(/^WhatsApp$/), { target: { value: '88880000' } })
    fireEvent.click(screen.getByText('Dar de alta'))
    expect(screen.getByText('¿Este es su WhatsApp? +506 8888 0000')).toBeTruthy()
    fireEvent.click(screen.getByText('Sí, es este'))
    const a = await screen.findByText(/Mandarle su link por WhatsApp/)
    expect(api.socioAltaCaja).toHaveBeenCalledWith('Ana Prueba', '88880000', null, true, true, null)
    expect(a.closest('a')!.getAttribute('href')!.startsWith('https://wa.me/50688880000?text=')).toBe(true)
  })

  it('cambiar el número mientras se confirma cierra la confirmación (no se confirma un número que no se leyó)', () => {
    llenar()
    fireEvent.change(campo(/^WhatsApp$/), { target: { value: '88880009' } })
    expect(screen.queryByText('Sí, es este')).toBeNull()
    expect(api.socioAltaCaja).not.toHaveBeenCalled()
  })

  it('un WhatsApp sin números no se puede confirmar', () => {
    llenar('—')
    expect(screen.getByText(/no tiene números/)).toBeTruthy()
    expect(screen.queryByText('Sí, es este')).toBeNull()
    expect(api.socioAltaCaja).not.toHaveBeenCalled()
  })
})
