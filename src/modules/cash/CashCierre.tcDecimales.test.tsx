// @vitest-environment happy-dom
//
// TC del cierre del día con decimales (decisión del dueño, 14-nov): el campo «TC ₡/$» tenía step={5}
// y el navegador marcaba inválido 503.45. Ahora es un campo de texto (inputMode="decimal") que acepta
// punto o coma sin depender del idioma del navegador, exige 300–900 y hasta 2 decimales: el valor viaja
// tal cual a la base y a la conversión $ → ₡. Verificador (#189): con type="number" y el separador que
// el navegador no esperaba, React se comía el punto y «503.45» quedaba en 50345 sin nada que lo frenara.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashCierreDia, CashSession } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  saveCierreParcial: vi.fn(async (payload: Record<string, unknown>) => ({ saved: payload })),
  getCierresDia:     vi.fn(async () => [] as unknown[]),
  getCashSessions:   vi.fn(async () => [] as unknown[]),
  cerrarDiaCompleto: vi.fn(async (payload: Record<string, unknown>) => { void payload; return { cierre_id: 'c1', idempotente: false } }),
}))
vi.mock('../../shared/api/cash', () => ({
  ...api,
  getAllCashMovements: vi.fn(async () => []),
  deshacerCierreDia:   vi.fn(async () => {}),
  discardDiaCompleto:  vi.fn(async () => {}),
  previewDiaCompleto:  vi.fn(async () => ({ fecha: '', borrar: [], ajenas: [] })),
  createDayMovement:   vi.fn(async () => ({})),
  sendCierreEmail:     vi.fn(async () => {}),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 600) }))
vi.mock('../../shared/api/tips', () => ({ getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Dueña' } }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))

import CashCierre from './CashCierre'
import { todayStr } from './cashUtils'
import { avisoTipoCambio, errorTipoCambio, parseTipoCambio } from './tipoCambio'

const HOY = todayStr()
const parcialCon = (tc: number) => ({
  id: 'c1', session_date: HOY, manager: 'Dueña', tipo: 'parcial_mediodia',
  vm_crc: 0, vm_usd: 0, propinas_m_crc: 0, otros_m_crc: 0, ef_real_m_crc: 0,
  vn_crc: 0, vn_usd: 0, propinas_n_crc: 0, otros_n_crc: 0, ef_real_n_crc: 0,
  sep_diaria_crc: 0, sep_diaria_usd: 0, sep_registradora_crc: 0, sep_registradora_usd: 0,
  remanente_crc: 0, remanente_usd: 0, diferencia_crc: 0, ajuste_tipo: '', ajuste_motivo: '',
  notas: '', tipo_cambio: tc, created_at: `${HOY}T14:00:00Z`, updated_at: `${HOY}T14:00:00Z`,
} as CashCierreDia)
const turnoCerrado = { id: 's1', session_date: HOY, status: 'closed', shift_type: 'Día', cajero_name: 'Ana' } as CashSession

const inputTC = () => screen.getByText('TC ₡/$').nextElementSibling as HTMLInputElement
const montos = () => Array.from(document.querySelectorAll<HTMLInputElement>('.cierre-monto input'))
const cambiar = (el: HTMLInputElement, v: string) => fireEvent.change(el, { target: { value: v } })

beforeEach(() => {
  vi.clearAllMocks()
  api.getCierresDia.mockResolvedValue([])
  api.getCashSessions.mockResolvedValue([])
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
})

describe('parseTipoCambio', () => {
  it('punto o coma dan el mismo número; vacío, dos separadores o letras → NaN', () => {
    expect(parseTipoCambio('503.45')).toBe(503.45)
    expect(parseTipoCambio('503,45')).toBe(503.45)
    expect(parseTipoCambio(' 640 ')).toBe(640)
    expect(parseTipoCambio('')).toBeNaN()
    expect(parseTipoCambio('503,4.5')).toBeNaN()
    expect(parseTipoCambio('5.03,45')).toBeNaN()
    expect(parseTipoCambio('abc')).toBeNaN()
    expect(parseTipoCambio('-503')).toBeNaN()
  })
})

describe('errorTipoCambio', () => {
  it('acepta 300–900 con hasta 2 decimales; frena vacío, fuera de rango (50345, 5034) y 3 decimales', () => {
    expect(errorTipoCambio(640)).toBeNull()
    expect(errorTipoCambio(503.4)).toBeNull()
    expect(errorTipoCambio(503.45)).toBeNull()
    expect(errorTipoCambio(300)).toBeNull()
    expect(errorTipoCambio(900)).toBeNull()
    expect(errorTipoCambio(50345)).toMatch(/¿es ~500\?/)
    expect(errorTipoCambio(5034)).toMatch(/¿es ~500\?/)
    expect(errorTipoCambio(299.99)).toMatch(/¿es ~500\?/)
    expect(errorTipoCambio(900.01)).toMatch(/¿es ~500\?/)
    expect(errorTipoCambio(503.456)).toMatch(/hasta 2 decimales/)
    expect(errorTipoCambio(Number.NaN)).toMatch(/Ingresá el tipo de cambio/)
    expect(errorTipoCambio(0)).toMatch(/Ingresá el tipo de cambio/)
  })
})

describe('avisoTipoCambio', () => {
  it('avisa (sin bloquear) solo si se aleja más de 10 % del TC de Admin', () => {
    expect(avisoTipoCambio(503.45, 500)).toBeNull()
    expect(avisoTipoCambio(550, 500)).toBeNull()
    expect(avisoTipoCambio(551, 500)).toMatch(/más de 10 %/)
    expect(avisoTipoCambio(449, 500)).toMatch(/más de 10 %/)
    expect(avisoTipoCambio(700, null)).toBeNull()
  })
})

describe('Cierre del día — TC con decimales', () => {
  for (const idioma of ['es-CR', 'en-US']) {
    for (const escrito of ['503.45', '503,45']) {
      it(`navegador ${idioma}: «${escrito}» se guarda como 503.45 y convierte los dólares con ese TC`, async () => {
        Object.defineProperty(globalThis.navigator, 'language', { value: idioma, configurable: true })
        render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
        const btn = await screen.findByText(/Confirmar cierre mediodía/)
        await waitFor(() => expect(inputTC().value).toBe('600'))
        expect(inputTC().type).toBe('text')
        expect(inputTC().getAttribute('inputmode')).toBe('decimal')
        // Tecleado de a un carácter, como en el celular: el separador no se pierde en el camino.
        for (let i = 1; i <= escrito.length; i++) cambiar(inputTC(), escrito.slice(0, i))
        expect(inputTC().value).toBe(escrito)
        cambiar(montos()[0], '200000')
        cambiar(montos()[1], '100')
        expect(screen.getByText(/Dólares físicos \$ → ₡50\s345$/)).toBeTruthy()
        fireEvent.click(btn)
        await waitFor(() => expect(api.saveCierreParcial).toHaveBeenCalledTimes(1))
        const p = api.saveCierreParcial.mock.calls[0][0]
        expect(p.tipo_cambio).toBe(503.45)
        expect(p.ef_real_m_crc).toBe(149655)
      })
    }
  }

  it('50345 (punto perdido) NO se sella: mensaje «¿es ~500?» y no guarda', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const btn = await screen.findByText(/Confirmar cierre mediodía/)
    await waitFor(() => expect(inputTC().value).toBe('600'))
    cambiar(inputTC(), '50345')
    expect(inputTC().getAttribute('aria-invalid')).toBe('true')
    cambiar(montos()[0], '200000')
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getAllByText(/¿es ~500\?/).length).toBeGreaterThan(0))
    expect(api.saveCierreParcial).not.toHaveBeenCalled()
  })

  it('campo vacío: no vuelve al último valor en silencio; frena con mensaje y no guarda', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const btn = await screen.findByText(/Confirmar cierre mediodía/)
    await waitFor(() => expect(inputTC().value).toBe('600'))
    cambiar(inputTC(), '')
    expect(inputTC().value).toBe('')
    cambiar(montos()[0], '200000')
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getAllByText(/Ingresá el tipo de cambio/).length).toBeGreaterThan(0))
    expect(api.saveCierreParcial).not.toHaveBeenCalled()
  })

  it('aviso de ±10 % contra el TC de Admin, sin bloquear', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const btn = await screen.findByText(/Confirmar cierre mediodía/)
    await waitFor(() => expect(inputTC().value).toBe('600'))
    cambiar(inputTC(), '503.45')                 // Admin = 600 → −16 %
    expect(screen.getByText(/más de 10 %/)).toBeTruthy()
    cambiar(montos()[0], '200000')
    fireEvent.click(btn)
    await waitFor(() => expect(api.saveCierreParcial).toHaveBeenCalledTimes(1))
  })

  it('Fase 1: un TC con 3 decimales NO se redondea en silencio: frena con mensaje y no guarda', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const btn = await screen.findByText(/Confirmar cierre mediodía/)
    await waitFor(() => expect(inputTC().value).toBe('600'))
    cambiar(inputTC(), '503.456')
    cambiar(montos()[0], '200000')
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getAllByText(/admite hasta 2 decimales/).length).toBeGreaterThan(0))
    expect(api.saveCierreParcial).not.toHaveBeenCalled()
  })

  it('Fase 2: el TC sellado 503.45 llega a la RPC (exchange_rate y tipo_cambio) y al efectivo real de noche', async () => {
    api.getCierresDia.mockResolvedValue([parcialCon(503.45)])
    api.getCashSessions.mockResolvedValue([turnoCerrado])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    await waitFor(() => expect(inputTC().value).toBe('503.45'))
    expect(inputTC().disabled).toBe(true)
    cambiar(montos()[0], '100000')   // Ventas noche ₡
    cambiar(montos()[1], '10')       // $10 × 503.45 = ₡5.034,50
    cambiar(montos()[7], '94966')    // remanente CF ₡
    cambiar(montos()[8], '10')       // remanente CF $
    fireEvent.click(screen.getByText(/Revisar resumen y cerrar el día/))
    expect(await screen.findByText(/TC ₡503,45/)).toBeTruthy()
    fireEvent.click(await screen.findByText(/CONFIRMAR CIERRE DEL DÍA/))
    await waitFor(() => expect(api.cerrarDiaCompleto).toHaveBeenCalledTimes(1))
    const p = api.cerrarDiaCompleto.mock.calls[0][0] as { exchange_rate: number; cierre: Record<string, unknown> }
    expect(p.exchange_rate).toBe(503.45)
    expect(p.cierre.tipo_cambio).toBe(503.45)
    // 100000 − 10 × 503.45 = 94965.5 → al colón (Math.round, sin cambio de este PR) = 94966
    expect(p.cierre.ef_real_n_crc).toBe(94966)
  })
})
