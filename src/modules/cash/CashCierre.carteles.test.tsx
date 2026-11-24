// @vitest-environment happy-dom
//
// Caja PR0 (SPEC-caja-estandar §3.2 y §4): carteles del Cierre del día. Solo presentación.
//   · Con un cierre `completo` (sin fila `parcial_mediodia`, como quedan los cierres nuevos) la barra
//     de fases muestra las DOS fases cerradas — antes decía «Fase 1 — Mediodía (pendiente)».
//   · «Diferencia» en palabras: Cuadra / Faltan / Sobran (en curso) y Faltaron / Sobraron (cerrado),
//     con la tolerancia dicha; colores del dueño: cuadra musgo · faltó laca · sobró oro.
// Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { CashCierreDia, CashMovement, CashSession } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  getCierresDia:       vi.fn(async () => [] as unknown[]),
  getCashSessions:     vi.fn(async () => [] as unknown[]),
  getAllCashMovements: vi.fn(async () => [] as unknown[]),
}))
vi.mock('../../shared/api/cash', () => ({
  ...api,
  cerrarDiaCompleto:   vi.fn(async () => ({ cierre_id: 'c1', idempotente: false })),
  saveCierreParcial:   vi.fn(async () => ({})),
  deshacerCierreDia:   vi.fn(async () => {}),
  discardDiaCompleto:  vi.fn(async () => {}),
  previewDiaCompleto:  vi.fn(async () => ({ fecha: '', borrar: [], ajenas: [] })),
  createDayMovement:   vi.fn(async () => ({})),
  sendCierreEmail:     vi.fn(async () => {}),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 600) }))
vi.mock('../../shared/api/tips', () => ({ getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Prueba' } }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))

import CashCierre from './CashCierre'
import { todayStr } from './cashUtils'

const HOY = todayStr()
const fila = (tipo: string, extra: Partial<CashCierreDia> = {}) => ({
  id: 'c-' + tipo, session_date: HOY, manager: 'Prueba', tipo,
  vm_crc: 0, vm_usd: 0, propinas_m_crc: 0, otros_m_crc: 0, ef_real_m_crc: 0,
  vn_crc: 0, vn_usd: 0, propinas_n_crc: 0, otros_n_crc: 0, ef_real_n_crc: 0,
  sep_diaria_crc: 0, sep_diaria_usd: 0, sep_registradora_crc: 0, sep_registradora_usd: 0,
  remanente_crc: 0, remanente_usd: 0, diferencia_crc: 0, ajuste_tipo: '', ajuste_motivo: '',
  notas: '', tipo_cambio: 600, created_at: `${HOY}T14:00:00Z`, updated_at: `${HOY}T14:00:00Z`, ...extra,
}) as CashCierreDia
const ajusteUsd = (usd: number, tipo: 'ingreso' | 'egreso_caja_fuerte') => ({
  id: 'm-aj', session_id: null, fecha: HOY, created_at: `${HOY}T20:00:00Z`, movement_type: tipo,
  subcategory: 'Ajuste de cierre', description: `Ajuste de cierre ${HOY} · prueba`, amount_crc: 0, amount_usd: usd, status: 'aprobado',
}) as unknown as CashMovement

const fase = (cual: 'mediodia' | 'noche') => document.querySelector(`[data-fase="${cual}"]`)!
const bloqueDif = () => document.querySelector('[data-bloque="diferencia"]') as HTMLElement
const tono = (el: Element | null) => el?.querySelector('[data-tono]')?.getAttribute('data-tono')

beforeEach(() => {
  cleanup(); vi.clearAllMocks()
  api.getCashSessions.mockResolvedValue([{ id: 's1', session_date: HOY, status: 'closed', shift_type: 'Día' } as CashSession])
  api.getAllCashMovements.mockResolvedValue([])
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
})

const montarCerrado = async (dif: number, movs: CashMovement[] = [], conParcial = false) => {
  api.getCierresDia.mockResolvedValue([fila('completo', { diferencia_crc: dif, notas: 'Sin novedades' }), ...(conParcial ? [fila('parcial_mediodia')] : [])])
  api.getAllCashMovements.mockResolvedValue(movs)
  render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
  await screen.findByText(/Día cerrado/)
}

describe('Barra de fases', () => {
  it('día cerrado SIN fila parcial: las dos fases cerradas (antes «Mediodía (pendiente)»)', async () => {
    await montarCerrado(0)
    expect(fase('mediodia').textContent).toContain('Fase 1 — Mediodía (sellado)')
    expect(fase('mediodia').className).toContain('ok')
    expect(fase('noche').textContent).toContain('Fase 2 — Noche (cerrado)')
    expect(screen.queryByText(/pendiente\)/)).toBeNull()
  })
  it('mediodía sellado y noche en curso', async () => {
    api.getCierresDia.mockResolvedValue([fila('parcial_mediodia')])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    expect(fase('mediodia').textContent).toContain('(sellado)')
    expect(fase('noche').textContent).toContain('Fase 2 — Noche (en curso)')
  })
  it('sin nada: mediodía pendiente y noche en espera', async () => {
    api.getCierresDia.mockResolvedValue([])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Confirmar cierre mediodía/)
    expect(fase('mediodia').textContent).toContain('(pendiente)')
    expect(fase('noche').textContent).toContain('(en espera)')
  })
})

describe('Diferencia del día cerrado', () => {
  it('₡0 → Cuadra · Sin diferencia · musgo', async () => {
    await montarCerrado(0)
    expect(bloqueDif().textContent).toContain('Cuadra')
    expect(bloqueDif().textContent).toContain('Sin diferencia.')
    expect(tono(bloqueDif())).toBe('musgo')
  })
  it('−₡300 → Cuadra, dentro de la tolerancia (no «−₡300» en rojo)', async () => {
    await montarCerrado(-300)
    expect(bloqueDif().textContent).toContain('Faltaron ₡300: dentro de la tolerancia (menos de ₡500).')
    expect(tono(bloqueDif())).toBe('musgo')
  })
  it('−₡1.951 → «Faltaron ₡1.951», laca, registrada como ajuste', async () => {
    await montarCerrado(-1951)
    expect(bloqueDif().textContent).toContain('Faltaron ₡1.951')
    expect(bloqueDif().textContent).toContain('Quedó registrada como ajuste de cierre.')
    expect(tono(bloqueDif())).toBe('laca')
    expect(bloqueDif().textContent).not.toMatch(/[-−+]₡/)
  })
  it('+₡2.300 → «Sobraron ₡2.300» en ORO, no verde', async () => {
    await montarCerrado(2300)
    expect(bloqueDif().textContent).toContain('Sobraron ₡2.300')
    expect(tono(bloqueDif())).toBe('oro')
  })
  const titular = () => bloqueDif().querySelector('[data-titular]') as HTMLElement
  it('faltante SOLO en US$: el titular grande dice «Faltaron $2,00» en laca, no «Cuadra»', async () => {
    await montarCerrado(0, [ajusteUsd(2, 'egreso_caja_fuerte')])
    expect(titular().textContent).toBe('Faltaron $2,00')
    expect(titular().getAttribute('data-tono')).toBe('laca')
    expect(bloqueDif().textContent).toContain('Colones: cuadra, sin diferencia')
    expect(bloqueDif().textContent).toContain('Dólares: faltaron $2,00, fuera de tolerancia (US$1)')
    expect(bloqueDif().textContent).toContain('Quedó registrada como ajuste de cierre.')
  })
  it('faltan las dos: «Faltaron ₡1.951 y $2,00»', async () => {
    await montarCerrado(-1951, [ajusteUsd(2, 'egreso_caja_fuerte')])
    expect(titular().textContent).toBe('Faltaron ₡1.951 y $2,00')
  })
  it('sobran colones y faltan dólares: manda el faltante; las dos en el detalle', async () => {
    await montarCerrado(2300, [ajusteUsd(2, 'egreso_caja_fuerte')])
    expect(titular().textContent).toBe('Faltaron $2,00')
    expect(titular().getAttribute('data-tono')).toBe('laca')
    expect(bloqueDif().textContent).toContain('Colones: sobraron ₡2.300, fuera de tolerancia (₡500)')
  })
  it('sobran SOLO dólares: titular oro', async () => {
    await montarCerrado(0, [ajusteUsd(3.5, 'ingreso')])
    expect(titular().textContent).toBe('Sobraron $3,50')
    expect(titular().getAttribute('data-tono')).toBe('oro')
  })
  it('con la fila parcial vieja también cierra las dos fases', async () => {
    await montarCerrado(0, [], true)
    expect(fase('mediodia').textContent).toContain('(sellado)')
    expect(fase('noche').textContent).toContain('(cerrado)')
  })
})

describe('Diferencia en curso (verificación en vivo)', () => {
  // [0]=Ventas noche ₡ · [7]=Remanente CF ₡ (mismo orden que CashCierre.recontar.test.tsx)
  const montos = () => Array.from(document.querySelectorAll<HTMLInputElement>('.cierre-monto input'))
  const setMonto = (el: HTMLInputElement, v: number) => fireEvent.change(el, { target: { value: String(v) } })
  const enCurso = async (contado: number) => {
    api.getCierresDia.mockResolvedValue([fila('parcial_mediodia')])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    setMonto(montos()[0], 100000)
    setMonto(montos()[7], contado)
    return bloqueDif()
  }
  it('sobran ₡200 → Cuadra con la nota de tolerancia', async () => {
    const b = await enCurso(100200)
    expect(b.textContent).toContain('Diferencia: Cuadra')
    expect(b.textContent).toContain('Sobran ₡200: dentro de la tolerancia (menos de ₡500).')
    expect(b.className).toContain('ok')
  })
  it('faltan ₡1.951 → laca', async () => {
    const b = await enCurso(98049)
    expect(b.textContent).toContain('Diferencia: Faltan ₡1.951')
    expect(b.className).toContain('fail')
  })
  it('sobran ₡2.300 → oro (clase «sobra»), no verde ni rojo', async () => {
    const b = await enCurso(102300)
    expect(b.textContent).toContain('Diferencia: Sobran ₡2.300')
    expect(b.className).toContain('sobra')
    expect(b.className).not.toMatch(/\b(ok|fail)\b/)
  })
  const cajaAjuste = () => document.querySelector('[data-bloque="ajuste"]') as HTMLElement
  it('sobrante: la caja del ajuste también va en oro y dice «Sobran», sin «+₡» en laca', async () => {
    await enCurso(102300)
    expect(cajaAjuste().getAttribute('data-tono')).toBe('oro')
    expect(cajaAjuste().textContent).toContain('Sobran ₡2.300')
    expect(cajaAjuste().textContent).not.toMatch(/[+−-]₡/)
  })
  it('faltante: la caja del ajuste sigue en laca', async () => {
    await enCurso(98049)
    expect(cajaAjuste().getAttribute('data-tono')).toBe('laca')
    expect(cajaAjuste().textContent).toContain('Faltan ₡1.951')
  })
})
