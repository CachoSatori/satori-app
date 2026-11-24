import { describe, it, expect, vi } from 'vitest'
import type { CashMovement } from '../../shared/types/database'
import {
  reemplazarPago, aplicarReemplazos, reemplazosAbiertos, podarReemplazos, leerReemplazos, guardarReemplazos,
  esDuplicado, claveReemplazos, type ReemplazoPendiente,
} from './reemplazoPago'

// Hallazgo 252: editar un pago guardado nunca deja un hueco. Datos ficticios.
const mov = (id: string, extra: Partial<CashMovement> = {}) => ({ id, ...extra }) as CashMovement

describe('reemplazarPago — el orden es crear y después borrar', () => {
  it('alta OK y borrado OK → listo; se creó con el id pedido y recién después se borró', async () => {
    const orden: string[] = []
    const crear = vi.fn(async (id: string) => { orden.push('crear'); return mov(id) })
    const borrarViejo = vi.fn(async () => { orden.push('borrar') })
    const r = await reemplazarPago('viejo', 'nuevo-1', { crear, borrarViejo })
    expect(r.estado).toBe('listo')
    expect(crear).toHaveBeenCalledWith('nuevo-1')
    expect(orden).toEqual(['crear', 'borrar'])
  })

  it('(1) el alta falla → sin_cambios y el viejo NO se borra', async () => {
    const borrarViejo = vi.fn(async () => {})
    const r = await reemplazarPago('viejo', 'n', { crear: async () => { throw new Error('500 del servidor') }, borrarViejo })
    expect(r).toEqual({ estado: 'sin_cambios', error: '500 del servidor' })
    expect(borrarViejo).not.toHaveBeenCalled()
  })

  it('(2) el borrado falla → falta_borrar con el par anotado (el nuevo ya existe)', async () => {
    const r = await reemplazarPago('viejo', 'n', {
      crear: async id => mov(id), borrarViejo: async () => { throw new Error('Failed to fetch') }, ahora: () => 1000,
    })
    expect(r.estado).toBe('falta_borrar')
    if (r.estado !== 'falta_borrar') return
    expect(r.reemplazo).toEqual({ viejo: 'viejo', nuevo: 'n', at: 1000 })
    expect(r.error).toBe('Failed to fetch')
  })

  it('el nuevo quedó en la cola (sin señal) → NO se borra el viejo todavía', async () => {
    const borrarViejo = vi.fn(async () => {})
    const r = await reemplazarPago('viejo', 'n', { crear: async id => mov(id, { _pending: true }), borrarViejo })
    expect(r.estado).toBe('falta_borrar')
    expect(borrarViejo).not.toHaveBeenCalled()
  })

  it('(3) el alta rebota por duplicado (el intento anterior sí entró) → se toma como hecho y se borra el viejo', async () => {
    const borrarViejo = vi.fn(async () => {})
    const r = await reemplazarPago('viejo', 'n', {
      crear: async () => { throw new Error('duplicate key value violates unique constraint "cash_movements_pkey"') },
      borrarViejo,
    })
    expect(r).toEqual({ estado: 'listo', nuevo: null })
    expect(borrarViejo).toHaveBeenCalledTimes(1)
  })

  it('esDuplicado solo reconoce el choque de clave', () => {
    expect(esDuplicado(new Error('duplicate key value violates unique constraint'))).toBe(true)
    expect(esDuplicado(new Error('23505'))).toBe(true)
    expect(esDuplicado(new Error('No autorizado'))).toBe(false)
  })
})

describe('aplicarReemplazos — nunca doble, nunca perdido', () => {
  const r: ReemplazoPendiente = { viejo: 'v', nuevo: 'n', at: 0 }
  it('con el viejo y el nuevo a la vista, el viejo no se cuenta', () => {
    expect(aplicarReemplazos([mov('v'), mov('n'), mov('x')], [r]).map(m => m.id)).toEqual(['n', 'x'])
  })
  it('si el nuevo no está (rechazado o sin cargar), el viejo cuenta como siempre', () => {
    expect(aplicarReemplazos([mov('v'), mov('x')], [r]).map(m => m.id)).toEqual(['v', 'x'])
  })
  it('sin anotaciones devuelve la misma lista', () => {
    const l = [mov('v')]
    expect(aplicarReemplazos(l, [])).toBe(l)
  })
  it('reemplazosAbiertos: solo los que tienen los dos a la vista', () => {
    expect(reemplazosAbiertos([mov('v'), mov('n')], [r])).toEqual([r])
    expect(reemplazosAbiertos([mov('n')], [r])).toEqual([])
  })
  it('podar suelta lo terminado y lo de más de 7 días; con la lista vacía no suelta nada', () => {
    const ahora = 10 * 24 * 3600 * 1000
    const nuevo = { ...r, at: ahora }
    expect(podarReemplazos([mov('n')], [nuevo], ahora)).toEqual([])            // terminado
    expect(podarReemplazos([mov('v'), mov('n')], [nuevo], ahora)).toEqual([nuevo])
    expect(podarReemplazos([], [nuevo], ahora)).toEqual([nuevo])                // cargando
    expect(podarReemplazos([mov('v'), mov('n')], [{ ...r, at: 0 }], ahora)).toEqual([])  // viejo
  })
})

describe('anotación en el aparato', () => {
  const memoria = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, m }
  }
  it('guarda y relee por turno; lista vacía borra la clave', () => {
    const st = memoria()
    const r: ReemplazoPendiente = { viejo: 'v', nuevo: 'n', at: 5 }
    guardarReemplazos('s1', [r], st)
    expect(leerReemplazos('s1', st)).toEqual([r])
    expect(leerReemplazos('s2', st)).toEqual([])
    guardarReemplazos('s1', [], st)
    expect(st.m.has(claveReemplazos('s1'))).toBe(false)
  })
  it('basura o almacenamiento que tira → lista vacía, sin romper', () => {
    const st = memoria()
    st.setItem(claveReemplazos('s1'), '{no es json')
    expect(leerReemplazos('s1', st)).toEqual([])
    const roto = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') }, removeItem: () => {} }
    expect(leerReemplazos('s1', roto)).toEqual([])
    expect(() => guardarReemplazos('s1', [{ viejo: 'v', nuevo: 'n', at: 1 }], roto)).not.toThrow()
  })
})
