// @vitest-environment happy-dom
//
// Hallazgo 252, ronda 2 (Menor 1 del verificador del PR #355): con un cambio de pago sin terminar (el pago nuevo y el
// anterior en la base, el par anotado en el aparato), el Cierre del día contaba el egreso DOS veces: el «debería» del
// pozo bajaba y aparecía un falso sobrante. Ahora usa la misma regla que la Caja Diaria (aplicarReemplazos): cuenta
// una vez, avisa, deja sellar el Mediodía (no depende de pagos a proveedores) y frena la Noche hasta terminar el cambio.
// Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { CashCierreDia, CashMovement, CashSession } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  saveCierreParcial:   vi.fn(async (payload: Record<string, unknown>) => ({ saved: payload })),
  cerrarDiaCompleto:   vi.fn(async () => ({})),
  getCierresDia:       vi.fn(async () => [] as unknown[]),
  getAllCashMovements: vi.fn(async () => [] as unknown[]),
  getCashSessions:     vi.fn(async () => [] as unknown[]),
  // Ronda 3: la base «real» de la prueba (lo que devuelve releer por id) y el borrado del viejo.
  getCashMovementById: vi.fn<(id: string) => Promise<unknown>>(async () => null),
  deleteCashMovement:  vi.fn<(id: string, nota: string, e?: string, p?: string) => Promise<void>>(async () => {}),
}))
vi.mock('../../shared/api/cash', () => ({
  ...api,
  deshacerCierreDia:  vi.fn(async () => {}),
  discardDiaCompleto: vi.fn(async () => {}),
  previewDiaCompleto: vi.fn(async () => ({})),
  createDayMovement:  vi.fn(async () => ({})),
  sendCierreEmail:    vi.fn(async () => {}),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 600) }))
vi.mock('../../shared/api/tips', () => ({ getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Encargada de prueba' } }),
}))
// Ronda 4 (Menor 4): espía con credenciales ficticias, para probar que Terminar pide autorización y la pasa.
type Auth = { ok: boolean; managerEmail?: string; managerPassword?: string }
const auth = vi.hoisted(() => ({ requireManager: vi.fn<() => Promise<Auth>>() }))
const AUTH_OK: Auth = { ok: true, managerEmail: 'gerencia@ejemplo.test', managerPassword: 'clave-ficticia' }
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => auth.requireManager }))
// Todo post-corte (el pozo cuenta Caja Proveedores); el resto de cierrePozo es el real.
vi.mock('./cierrePozo', async (orig) => {
  const actual = await orig<typeof import('./cierrePozo')>()
  return { ...actual, esPostCorte: () => true }
})

import CashCierre from './CashCierre'
import { fi, todayStr } from './cashUtils'
import { claveReemplazos, guardarReemplazos, leerTodosLosReemplazos, mensajeNoTerminable, MSG_FASE2_CON_REEMPLAZO, NOTA_REEMPLAZO } from './reemplazoPago'

const HOY = todayStr()
const mov = (id: string, p: Partial<CashMovement>): CashMovement => ({
  id, session_id: 'sHoy', created_by: 'u1', movement_type: 'ingreso', amount_crc: 0, amount_usd: 0,
  currency: 'CRC', exchange_rate: 600, description: '', subcategory: '', supplier_id: null, supplier_name: null,
  employee_name: null, method: 'Efectivo', shift: '', caja_origen: 'Caja Fuerte', status: 'aprobado',
  approved_by: null, approved_at: null, account_id: null,
  created_at: `${HOY}T18:00:00Z`, updated_at: `${HOY}T18:00:00Z`, ...p,
} as CashMovement)

const fondo  = mov('mov-fondo', { movement_type: 'ingreso', amount_crc: 100000, description: 'fondo de prueba' })
const pago   = (id: string, crc: number) => mov(id, {
  movement_type: 'egreso_mercaderia', amount_crc: crc, caja_origen: 'Caja Proveedores', supplier_name: 'Proveedor de prueba 1',
})
const viejo  = pago('mov-viejo', 15000)
const nuevo  = pago('mov-nuevo', 20000)
const sesionHoy = { id: 'sHoy', session_date: HOY, shift_type: 'Día', status: 'closed', cajero_name: 'Caja Test' } as CashSession
const parcialSellado = {
  id: 'c1', session_date: HOY, manager: 'Encargada de prueba', tipo: 'parcial_mediodia',
  vm_crc: 0, vm_usd: 0, propinas_m_crc: 0, otros_m_crc: 0, ef_real_m_crc: 0,
  vn_crc: 0, vn_usd: 0, propinas_n_crc: 0, otros_n_crc: 0, ef_real_n_crc: 0,
  sep_diaria_crc: 0, sep_diaria_usd: 0, sep_registradora_crc: 0, sep_registradora_usd: 0,
  remanente_crc: 0, remanente_usd: 0, diferencia_crc: 0, ajuste_tipo: '', ajuste_motivo: '',
  notas: '', tipo_cambio: 600, created_at: `${HOY}T14:00:00Z`, updated_at: `${HOY}T14:00:00Z`,
} as CashCierreDia

const anotar = () => localStorage.setItem(claveReemplazos('sHoy'), JSON.stringify([{ viejo: 'mov-viejo', nuevo: 'mov-nuevo', at: Date.now() }]))
const montos = () => Array.from(document.querySelectorAll<HTMLInputElement>('.cierre-monto input'))
const setMonto = (el: HTMLInputElement, v: number) => fireEvent.change(el, { target: { value: String(v) } })
// Fase 2: ventas de noche y un conteo cualquiera para que aparezca la verificación con el pozo.
const llenarNoche = (remanente = 81000) => {
  const m = montos()
  setMonto(m[0], 1000)     // ventas noche ₡
  setMonto(m[7], remanente) // Remanente CF ₡
  fireEvent.click(screen.getByRole('button', { name: 'Sin novedades' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  api.getCierresDia.mockResolvedValue([parcialSellado])
  api.getAllCashMovements.mockResolvedValue([fondo, viejo, nuevo])
  api.getCashSessions.mockResolvedValue([sesionHoy])
  // La base de la prueba tiene los tres (el cambio a medias es real): ninguna anotación se suelta sola.
  api.getCashMovementById.mockImplementation(async (id: string) => [fondo, viejo, nuevo].find(m => m.id === id) ?? null)
  api.deleteCashMovement.mockImplementation(async () => {})
  auth.requireManager.mockImplementation(async () => AUTH_OK)
})

describe('CashCierre · cambio de pago sin terminar (hallazgo 252, ronda 2)', () => {
  it('control: sin anotación los dos pagos cuentan (pozo 100.000 − 15.000 − 20.000) y no hay aviso', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    llenarNoche()
    expect((await screen.findByTestId('resumen-pozo')).textContent).toBe(fi(65000))
    expect(screen.queryByText('Cambio de pago sin terminar.')).toBeNull()
  })

  it('con el par anotado el pozo cuenta el pago UNA vez (100.000 − 20.000) y avisa', async () => {
    anotar()
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    llenarNoche()
    expect((await screen.findByTestId('resumen-pozo')).textContent).toBe(fi(80000))
    expect(screen.getByText('Cambio de pago sin terminar.')).toBeTruthy()
  })

  it('la Noche (Fase 2) se frena con aviso claro: no abre el resumen ni cierra', async () => {
    anotar()
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const btn = await screen.findByText(/Revisar resumen y cerrar el día/)
    llenarNoche()
    fireEvent.click(btn)
    expect(await screen.findByText(MSG_FASE2_CON_REEMPLAZO)).toBeTruthy()
    expect(screen.queryByText('Resumen del cierre del día')).toBeNull()
    expect(api.cerrarDiaCompleto).not.toHaveBeenCalled()
  })

  it('si el nuevo no está a la vista (rechazado por la cola), el viejo cuenta y la Noche no se frena', async () => {
    anotar()
    api.getAllCashMovements.mockResolvedValue([fondo, viejo])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    llenarNoche()
    expect((await screen.findByTestId('resumen-pozo')).textContent).toBe(fi(85000))
    expect(screen.queryByText('Cambio de pago sin terminar.')).toBeNull()
  })

  it('el Mediodía (Fase 1) se sella igual: sella ventas y propinas, que el pago a proveedor no toca', async () => {
    anotar()
    api.getCierresDia.mockResolvedValue([])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const btn = await screen.findByText(/sellar Fase 1/)
    setMonto(montos()[0], 120000)
    fireEvent.click(btn)
    await waitFor(() => expect(api.saveCierreParcial).toHaveBeenCalledTimes(1))
    expect(api.saveCierreParcial.mock.calls[0][0]).toMatchObject({ vm_crc: 120000, propinas_m_crc: 0 })
  })

  it('una anotación nueva (otra pestaña de Caja) se ve sin recargar', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    llenarNoche()
    expect((await screen.findByTestId('resumen-pozo')).textContent).toBe(fi(65000))
    act(() => { guardarReemplazos('sHoy', [{ viejo: 'mov-viejo', nuevo: 'mov-nuevo', at: Date.now() }]) })
    expect(screen.getByTestId('resumen-pozo').textContent).toBe(fi(80000))
    expect(screen.getByText('Cambio de pago sin terminar.')).toBeTruthy()
  })

  // M1: el SEGUNDO freno (al confirmar). Una anotación que llega con el resumen ya abierto (otra pestaña) no cierra.
  it('M1: con el resumen abierto llega un cambio a medias → «Confirmar» no cierra y avisa', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const btn = await screen.findByText(/Revisar resumen y cerrar el día/)
    llenarNoche(66000)
    fireEvent.click(btn)
    const confirmar = await screen.findByText('✓ CONFIRMAR CIERRE DEL DÍA')
    act(() => { guardarReemplazos('sHoy', [{ viejo: 'mov-viejo', nuevo: 'mov-nuevo', at: Date.now() }]) })
    fireEvent.click(confirmar)
    expect(await screen.findByText(MSG_FASE2_CON_REEMPLAZO)).toBeTruthy()
    expect(api.cerrarDiaCompleto).not.toHaveBeenCalled()
  })
})

// Ronda 3 (I1 del verificador): el turno del cambio lo cerró OTRO aparato. Antes la Noche quedaba frenada y
// «Terminar el cambio» no estaba en ninguna pantalla. Ahora se termina (o se descarta) desde el Cierre del día, la
// anotación se suelta sola si el viejo ya no está en la base y una de un día posterior no frena este cierre.
describe('CashCierre · cambio a medias con el turno ya cerrado (ronda 3, I1)', () => {
  const enBase = (...ms: CashMovement[]) => api.getCashMovementById.mockImplementation(async (id: string) => ms.find(m => m.id === id) ?? null)

  it('caso reproducido: turno cerrado + par abierto → «Terminar el cambio» en el Cierre del día destraba la Noche', async () => {
    anotar(); enBase(fondo, viejo, nuevo)
    api.deleteCashMovement.mockImplementation(async () => {
      api.getAllCashMovements.mockResolvedValue([fondo, nuevo]); enBase(fondo, nuevo)
    })
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const terminar = await screen.findByRole('button', { name: 'Terminar el cambio' })
    fireEvent.click(terminar)
    await waitFor(() => expect(api.deleteCashMovement).toHaveBeenCalledTimes(1))
    expect(api.deleteCashMovement.mock.calls[0].slice(0, 2)).toEqual(['mov-viejo', NOTA_REEMPLAZO])
    await waitFor(() => expect(screen.queryByText('Cambio de pago sin terminar.')).toBeNull())
    expect(leerTodosLosReemplazos()).toEqual([])
    const btn = screen.getByText(/Revisar resumen y cerrar el día/)
    llenarNoche(81000)
    fireEvent.click(btn)
    expect(await screen.findByText('Resumen del cierre del día')).toBeTruthy()
    expect(screen.queryByText(MSG_FASE2_CON_REEMPLAZO)).toBeNull()
  })

  it('si falla el borrado, avisa y el pago sigue contándose una vez (la anotación queda)', async () => {
    anotar(); enBase(fondo, viejo, nuevo)
    api.deleteCashMovement.mockRejectedValue(new Error('Failed to fetch'))
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Terminar el cambio' }))
    expect(await screen.findByText(/No se pudo borrar el pago anterior: Failed to fetch/)).toBeTruthy()
    expect(leerTodosLosReemplazos()).toHaveLength(1)
    llenarNoche()
    expect(screen.getByTestId('resumen-pozo').textContent).toBe(fi(80000))
  })

  it('se resuelve sola: en la base el viejo ya no existe → se suelta la anotación y se recarga', async () => {
    anotar(); enBase(fondo, nuevo)   // la lista cargada todavía trae el viejo (quedó vieja)
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await waitFor(() => expect(leerTodosLosReemplazos()).toEqual([]))
    await waitFor(() => expect(api.getAllCashMovements).toHaveBeenCalledTimes(2))
  })

  it('el nuevo no existe en la base → «Descartar el cambio»: el viejo vuelve a contar y la Noche no se frena', async () => {
    anotar(); enBase(fondo, viejo)
    window.confirm = vi.fn(() => true)
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    expect(screen.queryByRole('button', { name: 'Terminar el cambio' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar el cambio' }))
    expect(leerTodosLosReemplazos()).toEqual([])
    expect(api.deleteCashMovement).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Cambio de pago sin terminar.')).toBeNull())
    llenarNoche()
    expect(screen.getByTestId('resumen-pozo').textContent).toBe(fi(65000))
  })

  // Ronda 4 (Menor 1): el pozo es acumulado, así que un par abierto de un día ANTERIOR sí entra en el «debería» de hoy.
  it('un cambio a medias de un día ANTERIOR frena la Noche de hoy, y se puede terminar ahí mismo', async () => {
    const AYER = '2000-01-01'
    const sesionAyer = { ...sesionHoy, id: 'sAyer', session_date: AYER } as CashSession
    const vA = { ...viejo, session_id: 'sAyer' }, nA = { ...nuevo, session_id: 'sAyer' }
    api.getAllCashMovements.mockResolvedValue([fondo, vA, nA])
    api.getCashSessions.mockResolvedValue([sesionAyer, sesionHoy])
    localStorage.setItem(claveReemplazos('sAyer'), JSON.stringify([{ viejo: 'mov-viejo', nuevo: 'mov-nuevo', at: Date.now() }]))
    enBase(fondo, vA, nA)
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const btn = await screen.findByText(/Revisar resumen y cerrar el día/)
    expect(await screen.findByText(/Para cerrar la Noche \(Fase 2\), primero terminá el cambio/)).toBeTruthy()
    expect(screen.queryByText(/no frena este cierre/)).toBeNull()
    expect(await screen.findByRole('button', { name: 'Terminar el cambio' })).toBeTruthy()
    llenarNoche(81000)
    fireEvent.click(btn)
    expect(await screen.findByText(MSG_FASE2_CON_REEMPLAZO)).toBeTruthy()
    expect(screen.queryByText('Resumen del cierre del día')).toBeNull()
    expect(api.cerrarDiaCompleto).not.toHaveBeenCalled()
  })

  it('un cambio de un día POSTERIOR no frena la Noche del día que se cierra', async () => {
    const ANTES = '2000-01-01'
    anotar(); enBase(fondo, viejo, nuevo)   // el par es de hoy; se cierra un día anterior
    render(<CashCierre onRefresh={vi.fn()} openSession={null} fechaInicial={ANTES} />)
    const btn = await screen.findByText(/Revisar resumen y cerrar el día/)
    expect(await screen.findByText(/Es de un día posterior: no frena este cierre/)).toBeTruthy()
    llenarNoche(1000)   // ese día los movimientos de hoy todavía no existían: el pozo es solo la venta de la noche
    fireEvent.click(btn)
    expect(await screen.findByText('Resumen del cierre del día')).toBeTruthy()
    expect(screen.queryByText(MSG_FASE2_CON_REEMPLAZO)).toBeNull()
  })

  // Ronda 4 (Menor 3): el estado del aviso es del montaje. Si otro aparato borró el nuevo antes de tocar Terminar,
  // borrar el viejo dejaba el pago sin ningún registro. Ahora se relee la base después de la autorización.
  it('el nuevo desapareció de la base antes de Terminar → NO se borra el viejo y se avisa', async () => {
    anotar(); enBase(fondo, viejo, nuevo)
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const terminar = await screen.findByRole('button', { name: 'Terminar el cambio' })
    auth.requireManager.mockImplementation(async () => {
      enBase(fondo, viejo); api.getAllCashMovements.mockResolvedValue([fondo, viejo])   // otro aparato borró el nuevo
      return AUTH_OK
    })
    fireEvent.click(terminar)
    expect(await screen.findByText(mensajeNoTerminable('sin_nuevo'))).toBeTruthy()
    expect(api.deleteCashMovement).not.toHaveBeenCalled()
    // Recargado: el par ya no está abierto y el viejo cuenta una vez (100.000 − 15.000).
    await waitFor(() => expect(screen.queryByText('Cambio de pago sin terminar.')).toBeNull())
    llenarNoche()
    expect(screen.getByTestId('resumen-pozo').textContent).toBe(fi(85000))
  })

  // Ronda 5b (Menor 1 del verificador): igual que la Caja Diaria (#361). Si otro aparato ya terminó el cambio (el viejo
  // no está), el Cierre da el aviso VERDE, no rojo, y suelta la anotación del aparato.
  it('el viejo ya no estaba en la base al Terminar → aviso verde «ya estaba terminado» y se suelta la anotación', async () => {
    anotar(); enBase(fondo, viejo, nuevo)
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const terminar = await screen.findByRole('button', { name: 'Terminar el cambio' })
    auth.requireManager.mockImplementation(async () => {
      enBase(fondo, nuevo); api.getAllCashMovements.mockResolvedValue([fondo, nuevo])   // otro aparato borró el viejo
      return AUTH_OK
    })
    fireEvent.click(terminar)
    const aviso = await screen.findByText(mensajeNoTerminable('resuelto'))
    expect(aviso.classList.contains('green')).toBe(true)
    expect(api.deleteCashMovement).not.toHaveBeenCalled()
    expect(leerTodosLosReemplazos()).toEqual([])
    await waitFor(() => expect(screen.queryByText('Cambio de pago sin terminar.')).toBeNull())
  })

  it('sin respuesta de la base al revisar (sesión vencida) → no se borra nada y la anotación queda', async () => {
    anotar(); enBase(fondo, viejo, nuevo)
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const terminar = await screen.findByRole('button', { name: 'Terminar el cambio' })
    auth.requireManager.mockImplementation(async () => { enBase(); return AUTH_OK })
    fireEvent.click(terminar)
    expect(await screen.findByText(mensajeNoTerminable('desconocido'))).toBeTruthy()
    expect(api.deleteCashMovement).not.toHaveBeenCalled()
    expect(leerTodosLosReemplazos()).toHaveLength(1)
  })

  // Ronda 4 (Menor 4): Terminar desde el Cierre pide autorización y pasa el autorizante a la RPC (movement_deletions).
  it('Terminar sin autorización (ok:false) no borra ni suelta la anotación', async () => {
    anotar(); enBase(fondo, viejo, nuevo)
    auth.requireManager.mockImplementation(async () => ({ ok: false }))
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Terminar el cambio' }))
    await waitFor(() => expect(auth.requireManager).toHaveBeenCalledTimes(1))
    await act(async () => { await Promise.resolve() })
    expect(api.deleteCashMovement).not.toHaveBeenCalled()
    expect(leerTodosLosReemplazos()).toHaveLength(1)
  })

  it('Terminar pasa las credenciales del autorizante a deleteCashMovement', async () => {
    anotar(); enBase(fondo, viejo, nuevo)
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Terminar el cambio' }))
    await waitFor(() => expect(api.deleteCashMovement).toHaveBeenCalledTimes(1))
    expect(auth.requireManager).toHaveBeenCalledTimes(1)
    expect(api.deleteCashMovement).toHaveBeenCalledWith('mov-viejo', NOTA_REEMPLAZO, 'gerencia@ejemplo.test', 'clave-ficticia')
  })
})
