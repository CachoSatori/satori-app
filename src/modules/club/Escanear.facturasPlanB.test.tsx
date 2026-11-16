// @vitest-environment happy-dom
// Mig 174 (decisión del dueño, 15-nov, opción A) · Escanear → «Tarjeta física» → «Factura (plan B)»: la lista muestra las
// facturas cobradas HOY (día CR) y se busca por los últimos dígitos del tiquete (mínimo 4, hasta 3 días atrás). Una factura
// que ya tiene tarjeta o cupón se ve marcada y no se puede elegir. Datos ficticios.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { FacturaReciente, ResolverReferente } from '../../shared/api/club'
import { MSG_TIQUETE_NO_APARECE, digitosTiquete } from '../../shared/api/club'

const api = vi.hoisted(() => ({ resolverQR: vi.fn(), getPedidosAbiertos: vi.fn(), buscarFacturas: vi.fn() }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'cajero', full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({ ...(await orig<typeof import('../../shared/api/club')>()), ...api }))

import Escanear, { MSG_FACTURA_USADA } from './Escanear'

const ficha: ResolverReferente = {
  tipo: 'referente',
  datos: {
    id: 'm1', nombre: 'Persona Prueba', tipo_miembro: 'referente', negocio: null, estado: 'activo',
    personas: 6, creditos: 1, personas_proximo: 3, personas_por_credito: 6, valor_credito_crc: 1000,
    canjeado_hoy: 0, canje_min: 1, canje_paso: 0.5, max_creditos_por_visita: 2, tarjeta_manual_activa: true,
    sin_creditos: false, personas_mes: 0,
  },
} as ResolverReferente

// 15-nov 21:33 CR (16-nov 03:33 UTC): de noche en CR, el día UTC ya cambió.
const AHORA = new Date('2026-11-16T03:33:00Z')
const fac = (n: string, hora: string, extra: Partial<FacturaReciente> = {}): FacturaReciente =>
  ({ numero_factura: n, hora, total_crc: 10000, mesa: '7', pedido: null, consecutivo_fe: `0010000104000009${n.slice(-4)}`, estado: 'C', usada: false, ...extra })
const HOY_19 = fac('9001', '2026-11-16T01:03:00Z')                    // 15-nov 19:03 CR
const HOY_USADA = fac('9002', '2026-11-16T00:10:00Z', { usada: true }) // 15-nov 18:10 CR, ya con tarjeta
const AYER = fac('9003', '2026-11-15T05:40:00Z')                       // 14-nov 23:40 CR

async function abrirPlanB() {
  render(<Escanear />)
  fireEvent.change(screen.getByPlaceholderText('Cupón, canje, socio o pase'), { target: { value: 'ABCDEFGH' } })
  fireEvent.click(screen.getByText('Ver'))
  await screen.findByText('Persona Prueba')
  fireEvent.click(screen.getByText('Tarjeta física'))
  await screen.findByText('Factura (plan B)')
}

describe('Escanear · plan B con facturas del día y búsqueda por tiquete (mig 174)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(AHORA)
    api.resolverQR.mockReset().mockResolvedValue(ficha)
    api.getPedidosAbiertos.mockReset().mockResolvedValue([])
    api.buscarFacturas.mockReset().mockImplementation(async (q: string | null) =>
      q == null ? [HOY_19, HOY_USADA] : q === '0003' || q === '90003' ? [AYER] : [])
  })
  afterEach(() => { vi.useRealTimers() })

  it('la lista dice «cobradas hoy» y pide las de hoy (sin búsqueda)', async () => {
    await abrirPlanB()
    expect(await screen.findByText(/cobradas hoy\) o buscala por número de tiquete/)).toBeTruthy()
    expect(api.buscarFacturas).toHaveBeenCalledWith(null)
    expect(screen.queryByText(/últimas 2 horas/)).toBeNull()
    await screen.findByText(/19:03/)
  })

  it('la factura ya usada se ve marcada y no se puede elegir; la otra sí', async () => {
    await abrirPlanB()
    const usada = (await screen.findByText(MSG_FACTURA_USADA)).closest('button') as HTMLButtonElement
    expect(usada.disabled).toBe(true)
    fireEvent.click(usada)
    expect(usada.getAttribute('aria-pressed')).toBe('false')
    const libre = screen.getByText(/19:03/).closest('button') as HTMLButtonElement
    expect(libre.disabled).toBe(false)
    fireEvent.click(libre)
    await waitFor(() => expect(libre.getAttribute('aria-pressed')).toBe('true'))
  })

  it('buscar por tiquete: menos de 4 dígitos no busca; con 5 trae la de ayer, con la fecha', async () => {
    await abrirPlanB()
    await screen.findByText(/19:03/)
    const campo = screen.getByLabelText('Buscar por número de tiquete')
    fireEvent.change(campo, { target: { value: '003' } })
    expect((screen.getByText('Buscar').closest('button') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(campo, { target: { value: '…90003' } })
    fireEvent.click(screen.getByText('Buscar'))
    await waitFor(() => expect(api.buscarFacturas).toHaveBeenLastCalledWith('90003'))
    // la de ayer muestra el día (14/11) para no confundirla con una de hoy
    expect(await screen.findByText(/^14\/11 · 23:40/)).toBeTruthy()
    expect(screen.getByText('Ver las de hoy')).toBeTruthy()
  })

  it('si no aparece: el mensaje dice qué revisar y que el owner hace el ajuste', async () => {
    await abrirPlanB()
    await screen.findByText(/19:03/)
    fireEvent.change(screen.getByLabelText('Buscar por número de tiquete'), { target: { value: '55555' } })
    fireEvent.click(screen.getByText('Buscar'))
    expect(await screen.findByText(MSG_TIQUETE_NO_APARECE)).toBeTruthy()
    expect(MSG_TIQUETE_NO_APARECE).toMatch(/otro local/)
    expect(MSG_TIQUETE_NO_APARECE).toMatch(/anularon/)
    expect(MSG_TIQUETE_NO_APARECE).toMatch(/más de 3 días/)
    expect(MSG_TIQUETE_NO_APARECE).toMatch(/pedile al owner un ajuste/)
  })

  it('digitosTiquete: solo dígitos, como mucho 20', () => {
    expect(digitosTiquete(' …12 345 ')).toBe('12345')
    expect(digitosTiquete('1'.repeat(25))).toHaveLength(20)
  })
})
