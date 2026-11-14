// @vitest-environment happy-dom
// D1 (14-nov) · Alta de socio en caja → «Mandarle su link por WhatsApp ↗» (wa.me con el link del portal, en «usted»).
// Solo owner y manager: `club_miembro_token` (mig 150) le niega el token al cajero.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { linkAltaWhatsApp, textoAltaWhatsApp, puedeMandarLinkPortal } from './altaWhatsApp'
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

describe('altaWhatsApp: texto y link', () => {
  it('arma el wa.me con el número internacional y el link del portal', () => {
    const href = linkAltaWhatsApp('8888 0000', 'Ana María Prueba', URL)!
    expect(href.startsWith('https://wa.me/50688880000?text=')).toBe(true)
    const texto = decodeURIComponent(href.split('?text=')[1])
    expect(texto).toContain(URL)
    expect(texto).toContain('Hola, Ana.')
  })
  it('número con +506 o extranjero: no duplica el código', () => {
    expect(linkAltaWhatsApp('+506 8888-0000', 'Ana', URL)!.startsWith('https://wa.me/50688880000?')).toBe(true)
    expect(linkAltaWhatsApp('+1 555 010 0000', 'Ana', URL)!.startsWith('https://wa.me/15550100000?')).toBe(true)
  })
  it('sin dígitos no hay link', () => {
    expect(linkAltaWhatsApp('—', 'Ana', URL)).toBeNull()
  })
  it('el texto para el cliente va de «usted»', () => {
    const t = textoAltaWhatsApp('Ana', URL)
    expect(TUTEO_VOSEO.test(t), t).toBe(false)
    expect(t).toMatch(/Guárdelo y muéstrelo/)
  })
  it('solo owner y manager', () => {
    expect(['owner', 'manager', 'cajero', 'salonero', null].map(puedeMandarLinkPortal)).toEqual([true, true, false, false, false])
  })
})

async function darDeAlta() {
  render(<Escanear />)
  fireEvent.click(screen.getByText(/Nuevo socio del Local Club/))
  const campo = (l: RegExp) => screen.getByText(l).parentElement!.querySelector('input') as HTMLInputElement
  fireEvent.change(campo(/Nombre y apellido/), { target: { value: 'Ana Prueba' } })
  fireEvent.change(campo(/^WhatsApp$/), { target: { value: '88880000' } })
  fireEvent.click(screen.getByText(/Verifiqué que es local/).parentElement!.querySelector('input')!)
  fireEvent.click(screen.getByText('Dar de alta'))
  await screen.findByText(/es socio \(activo provisional/)
}

describe('Escanear → Nuevo socio: enlace de WhatsApp al terminar', () => {
  beforeEach(() => {
    configurarClubUrl('https://club.ejemplo.test')
    api.socioAltaCaja.mockReset().mockResolvedValue({ miembro_id: 'm1', estado: 'activo', provisional_hasta: '2026-11-20T12:00:00Z' })
    api.tokenPortal.mockReset().mockResolvedValue('ab'.repeat(32))
  })

  it('manager: aparece «Mandarle su link por WhatsApp ↗» con el portal del socio recién creado', async () => {
    rol.v = 'manager'
    await darDeAlta()
    const a = await screen.findByText(/Mandarle su link por WhatsApp/)
    expect(api.tokenPortal).toHaveBeenCalledWith('m1')
    const href = a.closest('a')!.getAttribute('href')!
    expect(href.startsWith('https://wa.me/50688880000?text=')).toBe(true)
    expect(decodeURIComponent(href)).toContain(URL)
  })

  it('cajero: no pide el token (la base se lo niega) ni muestra el enlace; dice que lo manda un manager', async () => {
    rol.v = 'cajero'
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
