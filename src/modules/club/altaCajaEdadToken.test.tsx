// @vitest-environment happy-dom
// #140 sobre main (156–158): el alta en caja pasa por `club_socio_alta_caja_v2` con `p_mayor_edad` (D6 A, mig 159)
// Y usa el `token_portal` que devuelve (mig 156; la v2 devuelve la respuesta completa de la interna) para que el CAJERO
// vea «Mandarle su link por WhatsApp ↗». Acá NO se simula la capa de API: se simula solo `supabase.rpc`, así la prueba
// cae si la app vuelve a llamar a la de 5 argumentos, si no manda la edad o si la API descarta el token.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { configurarClubUrl } from './qrFormato'

const H = vi.hoisted(() => ({ rpc: vi.fn(), rol: 'cajero' }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: H.rol, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: { rpc: H.rpc, from: vi.fn() } }))

import Escanear from './Escanear'
import { socioAltaCaja } from '../../shared/api/club'

const TOK = 'ef'.repeat(32)
const RESP = { miembro_id: 'm1', estado: 'activo', provisional_hasta: '2026-11-20T12:00:00Z', token_portal: TOK }

beforeEach(() => {
  configurarClubUrl('https://club.ejemplo.test')
  H.rol = 'cajero'
  H.rpc.mockReset().mockImplementation(async (fn: string) =>
    fn === 'club_socio_alta_caja_v2' ? { data: RESP, error: null } : { data: null, error: { message: `no simulada: ${fn}` } })
})

describe('socioAltaCaja → club_socio_alta_caja_v2 (159) con token_portal (156)', () => {
  it('llama a la v2 con p_mayor_edad y devuelve el token del alta', async () => {
    const r = await socioAltaCaja('Ana Prueba', '88880000', null, true, true)
    expect(H.rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = H.rpc.mock.calls[0]
    expect(fn).toBe('club_socio_alta_caja_v2')
    expect(args).toMatchObject({ p_nombre: 'Ana Prueba', p_whatsapp: '88880000', p_email: null, p_verifico_residencia: true, p_mayor_edad: true })
    expect(r.token_portal).toBe(TOK)
  })
})

describe('Escanear → alta en caja con edad: el cajero ve el botón del link', () => {
  it('cajero: alta con «es mayor de 18» → v2, y «Mandarle su link por WhatsApp ↗» con el token del alta', async () => {
    render(<Escanear />)
    fireEvent.click(screen.getByText(/Nuevo socio del Local Club/))
    const campo = (l: RegExp) => screen.getByText(l).parentElement!.querySelector('input') as HTMLInputElement
    fireEvent.change(campo(/Nombre y apellido/), { target: { value: 'Ana Prueba' } })
    fireEvent.change(campo(/^WhatsApp$/), { target: { value: '88880000' } })
    fireEvent.click(campo(/Verifiqué que es local/))
    fireEvent.click(campo(/Es mayor de 18 años/))
    fireEvent.click(screen.getByText('Dar de alta'))
    const a = await screen.findByText(/Mandarle su link por WhatsApp/)
    expect(decodeURIComponent(a.closest('a')!.getAttribute('href')!)).toContain('https://club.ejemplo.test/p/' + TOK)
    const fns = H.rpc.mock.calls.map(c => c[0])
    expect(fns).toContain('club_socio_alta_caja_v2')
    expect(fns).not.toContain('club_socio_alta_caja')      // la de 5 argumentos queda interna (159)
    expect(fns).not.toContain('club_miembro_token')        // el cajero no pide el token general
    expect(H.rpc.mock.calls.find(c => c[0] === 'club_socio_alta_caja_v2')![1]).toMatchObject({ p_mayor_edad: true })
    expect(screen.queryByText(/se lo manda un manager/)).toBeNull()
  })
})
