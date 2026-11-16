// @vitest-environment happy-dom
// Mig 173 (D-cumple-1 A + D-cumple-2, 15-nov): cumpleaños en el alta en caja, aviso del Inicio con WhatsApp, beneficio
// configurable en Promociones y aviso en Escanear. Se simula solo `supabase.rpc`: la prueba cae si la app llama a otra
// función, si manda el cumpleaños sin permiso o si el mensaje al cliente deja de ir en «usted».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  condicionesCumple, cuandoCumple, cumpleDelFormulario, diaMesTexto, linkCumpleWhatsApp, textoCumpleCaja, textoCumpleWhatsApp,
} from './cumple'
import type { CumpleEnvio } from '../../shared/api/club'

// Las mismas palabras que src/shared/wallet/usted.test.ts (tuteo y voseo); no se importa para no correr esas pruebas dos veces.
const TUTEO_VOSEO = new RegExp('(^|[^\\p{L}])(' + [
  'tu', 'tus', 'te', 'ti', 'contigo', 'vos', 'sos', 'tenés', 'podés', 'querés', 'sabés', 'estás', 'fuiste',
  'validá', 'mostrá', 'mostralo', 'probá', 'tocá', 'elegí', 'sumate', 'anotate', 'fijate', 'avisanos', 'escribinos',
  'pedí', 'usá', 'abrí', 'guardá', 'guardalo', 'agregá', 'agregalo', 'compartí', 'compartilo', 'esperá', 'volvé',
  'escaneá', 'canjeá', 'generá', 'completá', 'marcá', 'escribí', 'revisá', 'descargá', 'intentá', 'seguí', 'llamá',
  'reservá', 'vení', 'celebrá', 'festejá', 'mostrale', 'te esperamos',
].join('|') + ')(?=$|[^\\p{L}])', 'iu')

const H = vi.hoisted(() => ({ rpc: vi.fn(), rol: 'cajero' }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: H.rol, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: { rpc: H.rpc, from: vi.fn() } }))

import Escanear from './Escanear'
import { CumplesInicio } from './CumplesInicio'
import { ConfigCumple } from './CumpleConfig'
import { configurarClubUrl } from './qrFormato'

const CFG = {
  location_id: 'local-prueba', activo: true, beneficio: 'postre de cortesía', min_personas: 5, dias_antes: 7, dias_despues: 7,
  uno_por_mesa: true, solo_reserva: true, reserva_url: 'https://reservas.ejemplo.test/r?rid=1',
  cortesia: { id: 'k1', codigo: 'P1', nombre: 'Postre Ficticio', activa: true }, lista_para_caja: true,
}
const ENVIO: CumpleEnvio = { ...CFG, nombre: 'Ana María Prueba', whatsapp: '+15550100001', cumple: '2027-01-02', desde: '2026-12-26', hasta: '2027-01-09' }

describe('mensaje de cumpleaños (lo lee el cliente)', () => {
  it('va en «usted», con el beneficio, las condiciones, la vigencia y el link de reserva', () => {
    const t = textoCumpleWhatsApp(ENVIO, '2026-12-28')
    expect(TUTEO_VOSEO.test(t)).toBe(false)
    expect(t).toContain('Hola, Ana.')
    expect(t).toContain('postre de cortesía para mesas de 5 personas o más, uno por mesa y con reserva.')
    expect(t).toContain('Vale del 28 de diciembre al 9 de enero.')   // no ofrece días que ya pasaron
    expect(t).toContain('Reserve aquí: https://reservas.ejemplo.test/r?rid=1')
  })
  it('cambiando el texto sirve para otra cosa; sin condiciones ni link no deja frases sueltas', () => {
    const t = textoCumpleWhatsApp({ ...ENVIO, beneficio: 'una copa de vino', min_personas: 1, uno_por_mesa: false, solo_reserva: false, reserva_url: null },
      '2026-12-20')
    expect(t).toContain('celebrarlo con nosotros: una copa de vino. Vale del 26 de diciembre al 9 de enero.')
    expect(t).not.toContain('Reserve')
    expect(TUTEO_VOSEO.test(t)).toBe(false)
  })
  it('link wa.me con el número y el texto; sin número, null', () => {
    const l = linkCumpleWhatsApp(ENVIO, '2026-12-28')!
    expect(l.startsWith('https://wa.me/15550100001?text=')).toBe(true)
    expect(decodeURIComponent(l.split('text=')[1])).toBe(textoCumpleWhatsApp(ENVIO, '2026-12-28'))
    expect(linkCumpleWhatsApp({ ...ENVIO, whatsapp: '' }, '2026-12-28')).toBeNull()
  })
  it('fechas como día de Costa Rica, sin pasar por la zona de la máquina', () => {
    expect(diaMesTexto('2027-01-02')).toBe('2 de enero')
    expect(diaMesTexto('2026-09-30')).toBe('30 de setiembre')
    expect(condicionesCumple({ min_personas: 5, uno_por_mesa: false, solo_reserva: true })).toBe('para mesas de 5 personas o más y con reserva')
    expect(cuandoCumple(0)).toBe('hoy'); expect(cuandoCumple(1)).toBe('mañana'); expect(cuandoCumple(5)).toBe('en 5 días')
  })
})

describe('caja: texto del beneficio y formulario del alta', () => {
  it('con artículo activo: qué marcar y las condiciones; sin artículo: NO ofrecerlo', () => {
    const a = textoCumpleCaja(CFG)
    expect(a.ofrecer).toBe(true)
    expect(a.detalle).toBe('Solo si: mesa de 5 o más, con reserva, uno por mesa. Marcá el artículo P1 (Postre Ficticio) de «CORTESÍA CLUB».')
    const b = textoCumpleCaja({ ...CFG, lista_para_caja: false })
    expect(b.ofrecer).toBe(false)
    expect(b.detalle).toMatch(/^NO lo ofrezcas/)
  })
  it('cumpleaños del alta: vacío = no lo dio; sin permiso o sin fecha = falta; 31/4 = inválido', () => {
    expect(cumpleDelFormulario('', '', false)).toEqual({ ok: true, cumple: null })
    expect(cumpleDelFormulario('29', '2', true)).toEqual({ ok: true, cumple: { dia: 29, mes: 2 } })
    expect(cumpleDelFormulario('3', '4', false)).toEqual({ ok: false, error: 'falta' })
    expect(cumpleDelFormulario('', '', true)).toEqual({ ok: false, error: 'falta' })
    expect(cumpleDelFormulario('31', '4', true)).toEqual({ ok: false, error: 'invalido' })
  })
})

describe('Escanear → alta en caja con cumpleaños (v3)', () => {
  beforeEach(() => {
    configurarClubUrl('https://club.ejemplo.test')
    H.rol = 'cajero'
    H.rpc.mockReset().mockImplementation(async (fn: string) =>
      fn === 'club_socio_alta_caja_v3' ? { data: { miembro_id: 'm1', estado: 'activo', provisional_hasta: '2026-11-20T12:00:00Z', token_portal: null, cumple: 'guardado' }, error: null }
        : { data: null, error: { message: `no simulada: ${fn}` } })
  })
  function llenar() {
    render(<Escanear />)
    fireEvent.click(screen.getByText(/Nuevo socio del Local Club/))
    const campo = (l: RegExp) => screen.getByText(l).parentElement!.querySelector('input') as HTMLInputElement
    fireEvent.change(campo(/Nombre y apellido/), { target: { value: 'Ana Prueba' } })
    fireEvent.change(campo(/^WhatsApp$/), { target: { value: '88880000' } })
    fireEvent.click(campo(/Verifiqué que es local/))
    fireEvent.click(campo(/Es mayor de 18 años/))
    return campo
  }
  it('día y mes SIN el permiso: «Dar de alta» deshabilitado y no llama a la base', () => {
    llenar()
    fireEvent.change(screen.getByLabelText('Día del cumpleaños'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Mes del cumpleaños'), { target: { value: '3' } })
    const boton = screen.getByText('Dar de alta').closest('button') as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    fireEvent.click(boton)
    expect(H.rpc).not.toHaveBeenCalled()
  })
  it('con el permiso: manda día, mes y permiso a la v3 y avisa «Cumpleaños guardado»', async () => {
    const campo = llenar()
    fireEvent.change(screen.getByLabelText('Día del cumpleaños'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Mes del cumpleaños'), { target: { value: '3' } })
    fireEvent.click(campo(/Dio permiso para usar su cumpleaños/))
    fireEvent.click(screen.getByText('Dar de alta'))
    fireEvent.click(screen.getByText('Sí, es este'))   // hallazgo 230: confirma el WhatsApp
    await screen.findByText(/Cumpleaños guardado/)
    const llamada = H.rpc.mock.calls.find(c => c[0] === 'club_socio_alta_caja_v3')!
    expect(llamada[1]).toMatchObject({ p_cumple_dia: 12, p_cumple_mes: 3, p_cumple_permiso: true, p_mayor_edad: true })
  })
  it('sin cumpleaños: los tres en null', async () => {
    llenar()
    fireEvent.click(screen.getByText('Dar de alta'))
    fireEvent.click(screen.getByText('Sí, es este'))   // hallazgo 230: confirma el WhatsApp
    await waitFor(() => expect(H.rpc).toHaveBeenCalled())
    expect(H.rpc.mock.calls[0][1]).toMatchObject({ p_cumple_dia: null, p_cumple_mes: null, p_cumple_permiso: null })
  })
})

describe('Inicio: cumpleaños con WhatsApp', () => {
  let abrir: ReturnType<typeof vi.fn>
  let ventana: { location: { href: string }; close: ReturnType<typeof vi.fn> }
  beforeEach(() => {
    H.rol = 'owner'
    ventana = { location: { href: '' }, close: vi.fn() }
    abrir = vi.fn(() => ventana)
    vi.stubGlobal('open', abrir)
    H.rpc.mockReset().mockImplementation(async (fn: string) => {
      if (fn === 'club_cumple_proximos') return { data: { ...CFG, hoy: '2026-12-28', socios: [
        { miembro_id: 'm1', nombre: 'Ana Prueba', faltan: 5, con_whatsapp: true },
        { miembro_id: 'm2', nombre: 'Beto Prueba', faltan: 0, con_whatsapp: true }] }, error: null }
      if (fn === 'club_cumple_enviar') return { data: ENVIO, error: null }
      return { data: null, error: { message: `no simulada: ${fn}` } }
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })
  it('muestra «Cumpleaños en los próximos 7 días: 2 socios»; WhatsApp marca enviado, abre wa.me y lo saca de la lista', async () => {
    render(<CumplesInicio rol="owner" />)
    await screen.findByText('Cumpleaños en los próximos 7 días: 2 socios')
    expect(screen.getByText('Cumple hoy.')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Mandar saludo de cumpleaños por WhatsApp a Ana Prueba'))
    await waitFor(() => expect(ventana.location.href).toMatch(/^https:\/\/wa\.me\/15550100001\?text=/))
    expect(abrir).toHaveBeenCalledTimes(1)
    expect(H.rpc.mock.calls.find(c => c[0] === 'club_cumple_enviar')![1]).toMatchObject({ p_miembro: 'm1' })
    await waitFor(() => expect(screen.queryByText('Ana Prueba')).toBeNull())
  })
  it('si la base dice que ya se mandó: cierra la pestaña y muestra el error', async () => {
    H.rpc.mockImplementation(async (fn: string) => fn === 'club_cumple_proximos'
      ? { data: { ...CFG, hoy: '2026-12-28', socios: [{ miembro_id: 'm1', nombre: 'Ana Prueba', faltan: 5, con_whatsapp: true }] }, error: null }
      : { data: null, error: { message: 'Ya se le mandó el saludo de cumpleaños de este año' } })
    render(<CumplesInicio rol="owner" />)
    fireEvent.click(await screen.findByLabelText('Mandar saludo de cumpleaños por WhatsApp a Ana Prueba'))
    await screen.findByText(/Ya se le mandó el saludo/)
    expect(ventana.close).toHaveBeenCalled()
  })
  it('apagado o sin nadie: no muestra nada', async () => {
    H.rpc.mockImplementation(async () => ({ data: { ...CFG, activo: false, hoy: '2026-12-28', socios: [] }, error: null }))
    const { container } = render(<CumplesInicio rol="owner" />)
    await waitFor(() => expect(H.rpc).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})

describe('Promociones: beneficio de cumpleaños', () => {
  beforeEach(() => {
    H.rpc.mockReset().mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'club_cumple_config_ver') return { data: { ...CFG, activo: false }, error: null }
      if (fn === 'club_cortesias_listar') return { data: [{ id: 'k1', codigo_producto: 'P1', nombre: 'Postre Ficticio', activa: true }], error: null }
      if (fn === 'club_cumple_config_guardar') return { data: { ...CFG, ...(args.p_datos as object) }, error: null }
      return { data: null, error: { message: `no simulada: ${fn}` } }
    })
  })
  it('quien edita cambia el texto y lo enciende: manda el formulario entero', async () => {
    render(<ConfigCumple edita />)
    const texto = await screen.findByLabelText('Beneficio')
    fireEvent.change(texto, { target: { value: 'una copa de vino' } })
    fireEvent.click(screen.getByText('Encender'))
    await screen.findByText(/Encendido/)
    const g = H.rpc.mock.calls.find(c => c[0] === 'club_cumple_config_guardar')!
    expect(g[1].p_datos).toEqual({ activo: true, beneficio: 'una copa de vino', min_personas: 5, dias_antes: 7, dias_despues: 7,
      uno_por_mesa: true, solo_reserva: true, reserva_url: 'https://reservas.ejemplo.test/r?rid=1', cortesia_id: 'k1' })
  })
  it('quien no edita solo ve', async () => {
    render(<ConfigCumple edita={false} />)
    await screen.findByText(/Hoy:/)
    expect(screen.queryByText('Encender')).toBeNull()
    expect(screen.queryByLabelText('Beneficio')).toBeNull()
  })
})
