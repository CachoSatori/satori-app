// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { CashSession, Supplier, CashMovement } from '../../shared/types/database'
import { fi } from './cashUtils'
import { claveReemplazos, mensajeNoTerminable, MSG_CIERRE_CON_REEMPLAZO, MSG_PAGO_EN_CAMBIO, NOTA_REEMPLAZO } from './reemplazoPago'

// Hallazgo 252: editar un pago YA guardado borraba el viejo y DESPUÉS creaba el nuevo; si el alta fallaba, el pago
// quedaba solo en memoria y al recargar desaparecía (Caja Proveedores corrida). Ahora: crear primero (id fijo,
// reintento sin duplicar) y recién después borrar el viejo; si el borrado no llega, no se cuenta doble.
// La «base» de esta prueba es el arreglo `db`: createCashMovement/deleteCashMovement la cambian y onRefresh la relee.
// Datos ficticios.

const h = vi.hoisted(() => ({
  db: [] as Record<string, unknown>[],
  createCashMovementSpy: vi.fn(),
  deleteCashMovementSpy: vi.fn(),
  // Mig 200: por defecto la función NO está en la base (prod antes del pase) y el aparato sigue por el camino de #361.
  rpcSpy: vi.fn(),
  closeCashSessionSpy: vi.fn(async () => undefined),
  requireManagerSpy: vi.fn(async () => ({ ok: true as boolean, managerEmail: 'gerencia@ejemplo.test' as string | undefined, managerPassword: 'clave-ficticia' as string | undefined })),
}))

vi.mock('../../shared/api/cash', () => ({
  createCashMovement: h.createCashMovementSpy,
  createCashSession: vi.fn(),
  closeCashSession: h.closeCashSessionSpy,
  deleteCashMovement: h.deleteCashMovementSpy,
  reemplazarPagoEnBase: h.rpcSpy,
  getCashMovementById: vi.fn(async (id: string) => h.db.find(r => r.id === id) ?? null),
  getPreviousCierre: vi.fn(async () => null),
  discardCashSession: vi.fn(),
  upsertSupplier: vi.fn(),
  updateMiddayCheck: vi.fn(),
}))
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'cajero', full_name: 'Caja Test' } }),
}))
vi.mock('../../shared/api/tips', () => ({
  getActiveEmployees: vi.fn(async () => []),
  getTipPayoutsSince: vi.fn(async () => []),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 500) }))
vi.mock('../../shared/api/facturas', () => ({
  uploadFacturaPhoto: vi.fn(async () => 'factura/path.jpg'),
  movementAttachments: vi.fn(() => []),
}))
vi.mock('../../shared/api/documents', () => ({ listLinkedDocs: vi.fn(async () => []) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => h.requireManagerSpy }))
vi.mock('./deletionNote', () => ({ useDeletionNote: () => vi.fn(async () => 'nota') }))
vi.mock('../../shared/FacturaThumbs', () => ({ default: () => null }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import CashTurno from './CashTurno'

const session = {
  id: 's-252', cajero_name: 'Caja Test', shift_type: 'AM', session_date: '2026-07-01',
  initial_suppliers_crc: 100000, initial_cash_usd: 0,
} as unknown as CashSession
const supplier = { id: 'sup-1', name: 'Proveedor de prueba 1', is_active: true } as unknown as Supplier
const pagoViejo = {
  id: 'mov-viejo', session_id: 's-252', movement_type: 'egreso_mercaderia', status: 'aprobado',
  caja_origen: 'Caja Proveedores', method: 'Efectivo', supplier_id: 'sup-1', supplier_name: 'Proveedor de prueba 1',
  amount_crc: 15000, amount_usd: 0, description: 'pago previo', created_at: '2026-07-01T10:00:00Z',
}

// Padre mínimo: igual que CashModule, onMovAdded agrega a la lista y onRefresh relee la «base».
function Harness({ onError, ses = session }: { onError: (m: string) => void; ses?: CashSession }) {
  const [movs, setMovs] = useState<CashMovement[]>(() => h.db.slice() as unknown as CashMovement[])
  return (
    <CashTurno openSession={ses} suppliers={[supplier]} sessions={[]} sessionMovements={movs} allMovements={movs}
      onSessionOpen={vi.fn()} onSessionClose={vi.fn()}
      onMovAdded={m => setMovs(prev => [m, ...prev])}
      onError={onError}
      onRefresh={() => setMovs(h.db.slice() as unknown as CashMovement[])} />
  )
}
const montar = () => { const onError = vi.fn(); const r = render(<Harness onError={onError} />); return { onError, ...r } }

const tarjeta = (label: string) => screen.getByText(label).parentElement?.querySelector('.cd-tc-val')?.textContent ?? ''
const crc = () => screen.getByLabelText('Monto ₡ del pago') as HTMLInputElement
const editarA = async (monto: string) => {
  fireEvent.click(screen.getByTitle('Editar'))
  fireEvent.change(crc(), { target: { value: monto } })
  await guardar()
}
const guardar = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: '✓ Guardar cambios' })) }) }

// Alta «real» contra la base de prueba: con el id pedido (opts.id); un id repetido rebota como en Postgres (23505).
const altaOk = async (m: Record<string, unknown>, opts?: { id?: string }) => {
  const id = opts?.id ?? `azar-${Math.random()}`
  if (h.db.some(r => r.id === id)) throw new Error('duplicate key value violates unique constraint "cash_movements_pkey"')
  const row = { ...m, id, created_at: '2026-07-01T11:00:00Z' }
  h.db.push(row)
  return row
}
const borradoOk = async (id: string) => { h.db = h.db.filter(r => r.id !== id) }
const errRpc = (message: string, code: string | null, caer: boolean) => Object.assign(new Error(message), { code, caer })
const sinFuncion = async () => { throw errRpc('Could not find the function public.reemplazar_pago_caja', 'PGRST202', true) }
// La RPC de la 200 contra la base de prueba: en UN paso crea el nuevo (id del cliente) y borra el viejo; reintento = lo mismo.
const rpcOk = async (viejo: string, nuevo: Record<string, unknown> & { id: string }) => {
  const ya = h.db.find(r => r.id === nuevo.id)
  if (!h.db.some(r => r.id === viejo)) {
    if (ya) return { estado: 'listo', repetido: true, nuevo: ya }
    throw errRpc('El pago anterior ya no existe (otro aparato lo cambió o lo borró). Recargá la lista.', 'P0002', false)
  }
  const row = ya ?? { ...nuevo, created_at: '2026-07-01T11:00:00Z' }
  h.db = [...h.db.filter(r => r.id !== viejo && r.id !== nuevo.id), row]
  return { estado: 'listo', repetido: false, nuevo: row }
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
  h.db = [{ ...pagoViejo }]
  h.createCashMovementSpy.mockReset(); h.createCashMovementSpy.mockImplementation(altaOk)
  h.deleteCashMovementSpy.mockReset(); h.deleteCashMovementSpy.mockImplementation(borradoOk)
  h.rpcSpy.mockReset(); h.rpcSpy.mockImplementation(sinFuncion)
  h.closeCashSessionSpy.mockClear()
  h.requireManagerSpy.mockClear()
  localStorage.clear()
})

describe('CashTurno · editar un pago guardado no lo pierde si falla la red (hallazgo 252)', () => {
  it('camino feliz: crea el nuevo, después borra el viejo con nota y credenciales; total = el nuevo', async () => {
    montar()
    await editarA('20000')
    expect(h.createCashMovementSpy).toHaveBeenCalledTimes(1)
    expect(h.deleteCashMovementSpy).toHaveBeenCalledWith('mov-viejo', NOTA_REEMPLAZO, 'gerencia@ejemplo.test', 'clave-ficticia')
    // El alta va ANTES que el borrado.
    expect(h.createCashMovementSpy.mock.invocationCallOrder[0]).toBeLessThan(h.deleteCashMovementSpy.mock.invocationCallOrder[0])
    expect(tarjeta('Gastado efectivo')).toBe(fi(20000))
    expect(screen.queryByText('Cambio de pago sin terminar.')).toBeNull()
  })

  it('(1) el alta falla → NO se borra el viejo; el pago sigue a la vista y contando; el modal queda abierto', async () => {
    h.createCashMovementSpy.mockRejectedValueOnce(new Error('Error 503 del servidor'))
    const { onError } = montar()
    await editarA('20000')
    expect(h.deleteCashMovementSpy).not.toHaveBeenCalled()
    expect(h.db.map(r => r.id)).toEqual(['mov-viejo'])
    expect(tarjeta('Gastado efectivo')).toBe(fi(15000))
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('El pago anterior sigue igual'))
    expect(screen.getByRole('button', { name: '✓ Guardar cambios' })).toBeTruthy()
  })

  it('(1b) tras recargar (montar de nuevo) el pago viejo sigue ahí', async () => {
    h.createCashMovementSpy.mockRejectedValueOnce(new Error('Error 503 del servidor'))
    const { unmount } = montar()
    await editarA('20000')
    unmount()
    montar()
    expect(screen.getByText('Proveedor de prueba 1')).toBeTruthy()
    expect(tarjeta('Gastado efectivo')).toBe(fi(15000))
  })

  it('(2) el borrado falla → el total NO cuenta doble (ni ahora ni tras recargar) y el cierre se frena', async () => {
    h.deleteCashMovementSpy.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { onError, unmount } = montar()
    await editarA('20000')
    expect(h.createCashMovementSpy).toHaveBeenCalledTimes(1)
    expect(h.db).toHaveLength(2)                                   // la base tiene los dos un rato
    expect(tarjeta('Gastado efectivo')).toBe(fi(20000))            // y la pantalla cuenta uno: no 35.000
    expect(tarjeta('Disponible')).toBe(fi(80000))
    expect(screen.getByText('Cambio de pago sin terminar.')).toBeTruthy()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('No se cuenta dos veces'))
    expect(localStorage.getItem(claveReemplazos('s-252'))).toContain('mov-viejo')

    // Recargar: la anotación del aparato sigue mandando.
    unmount()
    const r2 = montar()
    expect(tarjeta('Gastado efectivo')).toBe(fi(20000))
    // El cierre de la Caja Diaria se frena hasta terminar el cambio.
    fireEvent.click(screen.getByRole('button', { name: /VER RESUMEN Y CONFIRMAR CIERRE/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '✓ Confirmar y cerrar turno' })) })
    expect(r2.onError).toHaveBeenCalledWith(MSG_CIERRE_CON_REEMPLAZO)
    expect(h.closeCashSessionSpy).not.toHaveBeenCalled()

    // «Terminar el cambio» borra el viejo; el aviso se va y el total sigue en el nuevo.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Terminar el cambio' })) })
    expect(h.deleteCashMovementSpy).toHaveBeenLastCalledWith('mov-viejo', NOTA_REEMPLAZO, 'gerencia@ejemplo.test', 'clave-ficticia')
    expect(h.db).toHaveLength(1)
    expect(screen.queryByText('Cambio de pago sin terminar.')).toBeNull()
    expect(tarjeta('Gastado efectivo')).toBe(fi(20000))
    expect(localStorage.getItem(claveReemplazos('s-252'))).toBeNull()
  })

  it('(3) reintento tras falla del alta: MISMO id (client_op_id) y una sola alta en la base', async () => {
    h.createCashMovementSpy.mockRejectedValueOnce(new Error('Error 503 del servidor'))
    montar()
    await editarA('20000')
    await guardar()                                               // reintento con el modal aún abierto
    expect(h.createCashMovementSpy).toHaveBeenCalledTimes(2)
    const id1 = h.createCashMovementSpy.mock.calls[0][1]?.id
    const id2 = h.createCashMovementSpy.mock.calls[1][1]?.id
    expect(id1).toBeTruthy()
    expect(id2).toBe(id1)
    expect(h.db.filter(r => r.amount_crc === 20000)).toHaveLength(1)
    expect(h.deleteCashMovementSpy).toHaveBeenCalledTimes(1)
    expect(tarjeta('Gastado efectivo')).toBe(fi(20000))
  })

  it('(3b) el primer intento SÍ entró y el reintento rebota por duplicado → no hay segunda alta y se borra el viejo', async () => {
    // Primer intento: entra a la base pero la respuesta se pierde (el cliente ve un error).
    h.createCashMovementSpy.mockImplementationOnce(async (m: Record<string, unknown>, opts?: { id?: string }) => {
      await altaOk(m, opts); throw new Error('Error 502 (respuesta perdida)')
    })
    montar()
    await editarA('20000')
    expect(h.deleteCashMovementSpy).not.toHaveBeenCalled()
    await guardar()
    expect(h.db.filter(r => r.amount_crc === 20000)).toHaveLength(1)   // una sola alta
    expect(h.db.map(r => r.id)).not.toContain('mov-viejo')
    expect(tarjeta('Gastado efectivo')).toBe(fi(20000))
  })

  it('(ronda 2) el reintento manda el monto ACTUAL con el mismo id', async () => {
    h.createCashMovementSpy.mockRejectedValueOnce(new Error('Error 503 del servidor'))
    montar()
    await editarA('20000')
    fireEvent.change(crc(), { target: { value: '25000' } })     // corrige el monto con el modal aún abierto
    await guardar()
    expect(h.createCashMovementSpy).toHaveBeenCalledTimes(2)
    expect(h.createCashMovementSpy.mock.calls[1][0]).toMatchObject({ amount_crc: 25000 })
    expect(h.createCashMovementSpy.mock.calls[1][1]?.id).toBe(h.createCashMovementSpy.mock.calls[0][1]?.id)
    expect(h.db.map(r => r.amount_crc)).toEqual([25000])
    expect(tarjeta('Gastado efectivo')).toBe(fi(25000))
  })

  it('(ronda 2) el 1er intento SÍ entró con otro monto y el reintento trae uno nuevo → no se borra el viejo, se cuenta una vez y avisa', async () => {
    // Primer intento (20.000): entra a la base pero el cliente ve un error. El encargado corrige a 25.000 y reintenta:
    // la base rebota el id (23505). Antes se tomaba como hecho y se borraba el viejo con el 20.000 en la base.
    h.createCashMovementSpy.mockImplementationOnce(async (m: Record<string, unknown>, opts?: { id?: string }) => {
      await altaOk(m, opts); throw new Error('Error 502 (respuesta perdida)')
    })
    const { onError } = montar()
    await editarA('20000')
    fireEvent.change(crc(), { target: { value: '25000' } })
    await guardar()
    expect(h.deleteCashMovementSpy).not.toHaveBeenCalled()                     // el viejo sigue en la base
    expect(h.db.map(r => r.amount_crc).sort()).toEqual([15000, 20000])        // ninguna alta de 25.000
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining(fi(20000)))
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('No se cuenta dos veces'))
    expect(tarjeta('Gastado efectivo')).toBe(fi(20000))                       // una vez, no 35.000
    expect(screen.getByText('Cambio de pago sin terminar.')).toBeTruthy()
    expect(localStorage.getItem(claveReemplazos('s-252'))).toContain('mov-viejo')
  })

  it('(ronda 3) con un cambio abierto, editar el pago NUEVO se frena: no cuenta ₡40.000 (15.000 + 25.000) ni se va el aviso', async () => {
    // Reproducción del verificador sobre 4ec6e68: borrado caído → par {viejo 15.000, nuevo 20.000}. Editar el nuevo a
    // 25.000 creaba otro y borraba el nuevo: la anotación dejaba de ocultar al viejo y contaban los dos.
    h.deleteCashMovementSpy.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { onError } = montar()
    await editarA('20000')
    expect(tarjeta('Gastado efectivo')).toBe(fi(20000))
    fireEvent.click(screen.getByTitle('Editar'))                 // el único visible: el nuevo
    const cuadro = screen.queryByLabelText('Monto ₡ del pago') as HTMLInputElement | null
    if (cuadro) { fireEvent.change(cuadro, { target: { value: '25000' } }); await guardar() }
    expect(tarjeta('Gastado efectivo')).toBe(fi(20000))           // no 40.000
    expect(h.createCashMovementSpy).toHaveBeenCalledTimes(1)     // ninguna alta más
    expect(h.db.map(r => r.amount_crc).sort()).toEqual([15000, 20000])
    expect(onError).toHaveBeenLastCalledWith(MSG_PAGO_EN_CAMBIO)
    expect(screen.getByText('Cambio de pago sin terminar.')).toBeTruthy()
  })

  it('(ronda 3) con un cambio abierto, la × del pago nuevo también se frena (el viejo no vuelve a contar)', async () => {
    h.deleteCashMovementSpy.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { onError } = montar()
    await editarA('20000')
    h.deleteCashMovementSpy.mockClear()
    await act(async () => { fireEvent.click(screen.getByTitle('Eliminar')) })
    expect(onError).toHaveBeenLastCalledWith(MSG_PAGO_EN_CAMBIO)
    expect(h.deleteCashMovementSpy).not.toHaveBeenCalled()
    expect(tarjeta('Gastado efectivo')).toBe(fi(20000))
    // Terminado el cambio, el pago se puede editar de nuevo.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Terminar el cambio' })) })
    fireEvent.click(screen.getByTitle('Editar'))
    expect(screen.getByLabelText('Monto ₡ del pago')).toBeTruthy()
  })

  // Ronda 4 (Menor 3 del verificador): Terminar relee la base DESPUÉS de la autorización. Si otro aparato borró el
  // nuevo mientras tanto, borrar el viejo dejaba el pago sin ningún registro (el hueco original del 252).
  it('(ronda 4) el nuevo desapareció de la base antes de Terminar → NO se borra el viejo y se avisa', async () => {
    h.deleteCashMovementSpy.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { onError } = montar()
    await editarA('20000')
    expect(h.db).toHaveLength(2)
    h.deleteCashMovementSpy.mockClear()
    h.requireManagerSpy.mockImplementationOnce(async () => {
      h.db = h.db.filter(r => r.id === 'mov-viejo')      // otro aparato borró el pago nuevo
      return { ok: true, managerEmail: 'gerencia@ejemplo.test', managerPassword: 'clave-ficticia' }
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Terminar el cambio' })) })
    expect(h.deleteCashMovementSpy).not.toHaveBeenCalled()
    expect(onError).toHaveBeenLastCalledWith(mensajeNoTerminable('sin_nuevo'))
    expect(h.db.map(r => r.id)).toEqual(['mov-viejo'])
    // Recargado: el par ya no está a la vista y el pago que de verdad hay en la base cuenta una vez.
    expect(screen.queryByText('Cambio de pago sin terminar.')).toBeNull()
    expect(tarjeta('Gastado efectivo')).toBe(fi(15000))
  })

  // #361: si otro aparato ya terminó el cambio (el viejo ya no está), la Caja Diaria da el MISMO aviso que el Cierre.
  it('(#361) el viejo ya no estaba en la base al Terminar → no se borra nada, se va el aviso rojo y sale el aviso del Cierre', async () => {
    h.deleteCashMovementSpy.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { onError } = montar()
    await editarA('20000')
    h.deleteCashMovementSpy.mockClear()
    onError.mockClear()
    h.requireManagerSpy.mockImplementationOnce(async () => {
      h.db = h.db.filter(r => r.id !== 'mov-viejo')      // otro aparato ya borró el viejo
      return { ok: true, managerEmail: 'gerencia@ejemplo.test', managerPassword: 'clave-ficticia' }
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Terminar el cambio' })) })
    expect(h.deleteCashMovementSpy).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(screen.queryByText('Cambio de pago sin terminar.')).toBeNull()
    const aviso = screen.getByText(mensajeNoTerminable('resuelto'))
    expect(aviso.closest('.est-aviso')?.classList.contains('hecho')).toBe(true)   // la MISMA pieza que el Cierre
    expect(tarjeta('Gastado efectivo')).toBe(fi(20000))
  })

  it('(#361) el aviso «ya estaba terminado» desaparece al cerrar el turno (cambia el turno abierto)', async () => {
    h.deleteCashMovementSpy.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { rerender } = render(<Harness onError={vi.fn()} />)
    await editarA('20000')
    h.requireManagerSpy.mockImplementationOnce(async () => {
      h.db = h.db.filter(r => r.id !== 'mov-viejo')
      return { ok: true, managerEmail: 'gerencia@ejemplo.test', managerPassword: 'clave-ficticia' }
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Terminar el cambio' })) })
    expect(screen.getByText(mensajeNoTerminable('resuelto'))).toBeTruthy()
    rerender(<Harness onError={vi.fn()} ses={{ ...session, id: 's-otro' } as CashSession} />)
    expect(screen.queryByText(mensajeNoTerminable('resuelto'))).toBeNull()
  })

  it('el nuevo quedó en la cola (sin señal): el viejo no se borra todavía y no se cuenta doble', async () => {
    h.createCashMovementSpy.mockImplementationOnce(async (m: Record<string, unknown>, opts?: { id?: string }) =>
      ({ ...m, id: opts?.id, created_at: '2026-07-01T11:00:00Z', _pending: true }))
    montar()
    await editarA('20000')
    expect(h.deleteCashMovementSpy).not.toHaveBeenCalled()
    expect(tarjeta('Gastado efectivo')).toBe(fi(20000))
    expect(screen.getByText('Cambio de pago sin terminar.')).toBeTruthy()
  })

  it('sin conexión: no se crea ni se borra nada (mismo freno que el borrado)', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      const { onError } = montar()
      await editarA('20000')
      expect(h.createCashMovementSpy).not.toHaveBeenCalled()
      expect(h.deleteCashMovementSpy).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('requiere conexión'))
    } finally { onLine.mockRestore() }
  })
})

// Mig 200: con la función en la base, el cambio entero es UNA llamada (alta + borrado en la misma transacción).
describe('CashTurno · cambio de pago atómico en la base (mig 200)', () => {
  beforeEach(() => { h.rpcSpy.mockImplementation(rpcOk) })

  it('una sola llamada a la RPC (viejo, datos con el id del cliente, credenciales); sin alta ni borrado sueltos ni aviso rojo', async () => {
    montar()
    await editarA('20000')
    expect(h.rpcSpy).toHaveBeenCalledTimes(1)
    const [viejo, nuevo, mail, clave] = h.rpcSpy.mock.calls[0]
    expect(viejo).toBe('mov-viejo')
    expect(nuevo).toMatchObject({ amount_crc: 20000, supplier_id: 'sup-1', method: 'Efectivo', caja_origen: 'Caja Proveedores', session_id: 's-252' })
    expect(typeof nuevo.id).toBe('string')
    expect([mail, clave]).toEqual(['gerencia@ejemplo.test', 'clave-ficticia'])
    expect(h.createCashMovementSpy).not.toHaveBeenCalled()
    expect(h.deleteCashMovementSpy).not.toHaveBeenCalled()
    expect(h.db.map(r => r.amount_crc)).toEqual([20000])
    expect(tarjeta('Gastado efectivo')).toBe(fi(20000))
    expect(screen.queryByText('Cambio de pago sin terminar.')).toBeNull()
    expect(localStorage.getItem(claveReemplazos('s-252'))).toBeNull()
  })

  it('la base dice que no (permiso, local, monto): no cae al camino viejo, no cambia nada y el modal queda abierto', async () => {
    h.rpcSpy.mockImplementationOnce(async () => { throw errRpc('No autorizado para cambiar pagos de ese local', '42501', false) })
    const { onError } = montar()
    await editarA('20000')
    expect(h.createCashMovementSpy).not.toHaveBeenCalled()
    expect(h.deleteCashMovementSpy).not.toHaveBeenCalled()
    expect(h.db.map(r => r.id)).toEqual(['mov-viejo'])
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('No autorizado para cambiar pagos de ese local'))
    expect(screen.getByRole('button', { name: '✓ Guardar cambios' })).toBeTruthy()
  })

  it('el viejo ya no existe (otro aparato): aviso claro, se recarga la lista y se cierra el modal', async () => {
    const { onError } = montar()
    // Lo que ve esta pantalla todavía tiene el viejo; en la base, otro aparato ya lo cambió.
    h.rpcSpy.mockImplementationOnce(async () => { h.db = []; throw errRpc('El pago anterior ya no existe (otro aparato lo cambió o lo borró). Recargá la lista.', 'P0002', false) })
    await editarA('20000')
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('No se guardó el cambio: El pago anterior ya no existe'))
    expect(h.createCashMovementSpy).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '✓ Guardar cambios' })).toBeNull()
  })

  it('la respuesta se pierde (timeout) después de entrar: sigue por el camino viejo con el MISMO id y no duplica', async () => {
    h.rpcSpy.mockImplementationOnce(async (viejo: string, nuevo: Record<string, unknown> & { id: string }) => {
      await rpcOk(viejo, nuevo); throw errRpc('timeout de red', null, true)
    })
    montar()
    await editarA('20000')
    const idRpc = h.rpcSpy.mock.calls[0][1].id
    expect(h.createCashMovementSpy).toHaveBeenCalledTimes(1)
    expect(h.createCashMovementSpy.mock.calls[0][1]?.id).toBe(idRpc)      // el mismo id → 23505 → relee y compara
    expect(h.db.filter(r => r.amount_crc === 20000)).toHaveLength(1)
    expect(h.db.map(r => r.id)).not.toContain('mov-viejo')
    expect(tarjeta('Gastado efectivo')).toBe(fi(20000))
  })

  it('reintento tras un «no» de la base: el MISMO id en la segunda llamada', async () => {
    h.rpcSpy.mockImplementationOnce(async () => { throw errRpc('Error 503 del servidor', null, false) })
    montar()
    await editarA('20000')
    await guardar()
    expect(h.rpcSpy).toHaveBeenCalledTimes(2)
    expect(h.rpcSpy.mock.calls[1][1].id).toBe(h.rpcSpy.mock.calls[0][1].id)
    expect(h.db.map(r => r.amount_crc)).toEqual([20000])
  })

  it('«distinto» (un intento anterior quedó con otro monto): no se borra el viejo, se cuenta una vez y avisa el monto', async () => {
    h.rpcSpy.mockImplementationOnce(async (_v: string, nuevo: Record<string, unknown> & { id: string }) => {
      const guardado = { ...pagoViejo, id: nuevo.id, amount_crc: 18000, created_at: '2026-07-01T11:00:00Z' }
      h.db.push(guardado)
      return { estado: 'distinto', guardado }
    })
    const { onError } = montar()
    await editarA('20000')
    expect(h.db).toHaveLength(2)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining(fi(18000)))
    expect(tarjeta('Gastado efectivo')).toBe(fi(18000))
    expect(screen.getByText('Cambio de pago sin terminar.')).toBeTruthy()
  })
})

