import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mig 200 · `reemplazarPagoEnBase` (RPC `reemplazar_pago_caja`): qué errores dejan seguir por el camino de siempre
// (#361) y cuáles son un «no» de la base que NO puede caer al camino viejo. Datos ficticios.

const h = vi.hoisted(() => ({ rpcSpy: vi.fn(), debeEncolar: vi.fn(async () => false) }))
const builder = (r: { data: unknown; error: { message: string; code?: string } | null }) => {
  const b = { abortSignal: () => b, then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(r).then(res, rej) }
  return b
}
vi.mock('./supabase', () => ({ supabase: { rpc: h.rpcSpy, from: () => { throw new Error('el cambio atómico va por la RPC') } } }))
vi.mock('../offline/outbox', () => ({ enqueue: vi.fn(), pendingOps: vi.fn(async () => []) }))
vi.mock('../offline/ordenEscrituras', async (orig) => ({ ...(await orig<object>()), debeEncolarAhora: h.debeEncolar }))

import { reemplazarPagoEnBase, rpcReemplazoCae, ErrorRpcReemplazo } from './cash'

const nuevo = { id: 'n-1', amount_crc: 20000 }
const falla = async () => { try { await reemplazarPagoEnBase('v-1', nuevo); return null } catch (e) { return e as ErrorRpcReemplazo } }

beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
  h.rpcSpy.mockReset(); h.debeEncolar.mockReset(); h.debeEncolar.mockResolvedValue(false)
})

describe('reemplazarPagoEnBase (mig 200)', () => {
  it('llama reemplazar_pago_caja con el viejo, el nuevo y las credenciales; devuelve lo que dice la base', async () => {
    h.rpcSpy.mockReturnValue(builder({ data: { estado: 'listo', repetido: false, nuevo: { id: 'n-1' } }, error: null }))
    const r = await reemplazarPagoEnBase('v-1', nuevo, 'gerencia@ejemplo.test', 'clave-ficticia')
    expect(h.rpcSpy).toHaveBeenCalledWith('reemplazar_pago_caja', {
      p_viejo: 'v-1', p_nuevo: nuevo, p_manager_email: 'gerencia@ejemplo.test', p_manager_password: 'clave-ficticia' })
    expect(r.estado).toBe('listo')
  })

  it('sin red o con la cola pendiente (A01) no llama la base y cae al camino viejo', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true })
    expect((await falla())?.caer).toBe(true)
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
    h.debeEncolar.mockResolvedValue(true)
    expect((await falla())?.caer).toBe(true)
    expect(h.rpcSpy).not.toHaveBeenCalled()
  })

  it('la función no está (prod antes del pase) → cae; un «no» de la base (42501, P0002, 22023) → NO cae', async () => {
    h.rpcSpy.mockReturnValueOnce(builder({ data: null, error: { message: 'Could not find the function public.reemplazar_pago_caja(...) in the schema cache', code: 'PGRST202' } }))
    expect((await falla())?.caer).toBe(true)
    for (const code of ['42501', 'P0002', '22023']) {
      h.rpcSpy.mockReturnValueOnce(builder({ data: null, error: { message: 'no', code } }))
      const e = await falla()
      expect(e?.caer, code).toBe(false)
      expect(e?.code).toBe(code)
    }
  })

  it('respuesta sin forma conocida → error que NO cae (nada se da por hecho)', async () => {
    h.rpcSpy.mockReturnValue(builder({ data: { estado: 'raro' }, error: null }))
    expect((await falla())?.caer).toBe(false)
  })

  it('rpcReemplazoCae: red, timeout y duplicado caen; permiso no', () => {
    expect(rpcReemplazoCae(null, 'Failed to fetch')).toBe(true)
    expect(rpcReemplazoCae(null, 'timeout de red')).toBe(true)
    expect(rpcReemplazoCae('23505', 'duplicate key')).toBe(true)
    expect(rpcReemplazoCae('42883', 'function public.reemplazar_pago_caja does not exist')).toBe(true)
    expect(rpcReemplazoCae('42501', 'No autorizado para cambiar pagos')).toBe(false)
  })
})
