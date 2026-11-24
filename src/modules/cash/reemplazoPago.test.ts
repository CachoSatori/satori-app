import { describe, it, expect, vi } from 'vitest'
import type { CashMovement } from '../../shared/types/database'
import {
  reemplazarPago, aplicarReemplazos, reemplazosAbiertos, podarReemplazos, leerReemplazos, guardarReemplazos,
  esDuplicado, claveReemplazos, coincidePago, leerTodosLosReemplazos, anotarEnAparato, enCambioAbierto,
  revisarCambioEnBase, reemplazosDelDia, soltarReemplazo, type ReemplazoPendiente, type DatosPago,
} from './reemplazoPago'

// Hallazgo 252: editar un pago guardado nunca deja un hueco. Datos ficticios.
const mov = (id: string, extra: Partial<CashMovement> = {}) => ({ id, ...extra }) as CashMovement
// Releer/comparar solo se usan tras un duplicado; en los demás casos no se llaman.
const sinRelectura = { releer: vi.fn(async () => null), coincide: () => false }
const DUP = 'duplicate key value violates unique constraint "cash_movements_pkey"'

describe('reemplazarPago — el orden es crear y después borrar', () => {
  it('alta OK y borrado OK → listo; se creó con el id pedido y recién después se borró', async () => {
    const orden: string[] = []
    const crear = vi.fn(async (id: string) => { orden.push('crear'); return mov(id) })
    const borrarViejo = vi.fn(async () => { orden.push('borrar') })
    const r = await reemplazarPago('viejo', 'nuevo-1', { ...sinRelectura, crear, borrarViejo })
    expect(r.estado).toBe('listo')
    expect(crear).toHaveBeenCalledWith('nuevo-1')
    expect(orden).toEqual(['crear', 'borrar'])
  })

  it('(1) el alta falla → sin_cambios y el viejo NO se borra', async () => {
    const borrarViejo = vi.fn(async () => {})
    const r = await reemplazarPago('viejo', 'n', { ...sinRelectura, crear: async () => { throw new Error('500 del servidor') }, borrarViejo })
    expect(r).toEqual({ estado: 'sin_cambios', error: '500 del servidor' })
    expect(borrarViejo).not.toHaveBeenCalled()
  })

  it('(2) el borrado falla → falta_borrar con el par anotado (el nuevo ya existe)', async () => {
    const r = await reemplazarPago('viejo', 'n', {
      ...sinRelectura, crear: async id => mov(id), borrarViejo: async () => { throw new Error('Failed to fetch') }, ahora: () => 1000,
    })
    expect(r.estado).toBe('falta_borrar')
    if (r.estado !== 'falta_borrar') return
    expect(r.reemplazo).toEqual({ viejo: 'viejo', nuevo: 'n', at: 1000 })
    expect(r.error).toBe('Failed to fetch')
  })

  it('el nuevo quedó en la cola (sin señal) → NO se borra el viejo todavía', async () => {
    const borrarViejo = vi.fn(async () => {})
    const r = await reemplazarPago('viejo', 'n', { ...sinRelectura, crear: async id => mov(id, { _pending: true }), borrarViejo })
    expect(r.estado).toBe('falta_borrar')
    expect(borrarViejo).not.toHaveBeenCalled()
  })

  it('(3) el alta rebota por duplicado CON los mismos datos (el intento anterior sí entró) → hecho y se borra el viejo', async () => {
    const borrarViejo = vi.fn(async () => {})
    const releer = vi.fn(async (id: string) => mov(id, { amount_crc: 20000 }))
    const r = await reemplazarPago('viejo', 'n', {
      crear: async () => { throw new Error(DUP) },
      releer, coincide: m => m.amount_crc === 20000,
      borrarViejo,
    })
    expect(r).toEqual({ estado: 'listo', nuevo: null })
    expect(releer).toHaveBeenCalledWith('n')
    expect(borrarViejo).toHaveBeenCalledTimes(1)
  })

  it('(ronda 2) duplicado con OTROS datos (el 1er intento entró con otro monto) → distinto y el viejo NO se borra', async () => {
    const borrarViejo = vi.fn(async () => {})
    const guardado = mov('n', { amount_crc: 18000 })
    const r = await reemplazarPago('viejo', 'n', {
      crear: async () => { throw new Error(DUP) },
      releer: async () => guardado, coincide: m => m.amount_crc === 20000,
      borrarViejo, ahora: () => 7,
    })
    expect(r).toEqual({ estado: 'distinto', guardado, reemplazo: { viejo: 'viejo', nuevo: 'n', at: 7 } })
    expect(borrarViejo).not.toHaveBeenCalled()
  })

  it('(ronda 2) duplicado y la relectura falla o no encuentra la fila → distinto con guardado null; no se borra', async () => {
    for (const releer of [async () => { throw new Error('Failed to fetch') }, async () => null]) {
      const borrarViejo = vi.fn(async () => {})
      const r = await reemplazarPago('viejo', 'n', { crear: async () => { throw new Error(DUP) }, releer, coincide: () => true, borrarViejo })
      expect(r.estado).toBe('distinto')
      if (r.estado === 'distinto') expect(r.guardado).toBeNull()
      expect(borrarViejo).not.toHaveBeenCalled()
    }
  })

  it('esDuplicado solo reconoce el choque de clave', () => {
    expect(esDuplicado(new Error('duplicate key value violates unique constraint'))).toBe(true)
    expect(esDuplicado(new Error('23505'))).toBe(true)
    expect(esDuplicado(new Error('No autorizado'))).toBe(false)
  })
})

describe('coincidePago — ¿la fila guardada tiene lo tecleado ahora?', () => {
  const d: DatosPago = {
    amount_crc: 20000, amount_usd: 0, supplier_id: 'sup-1', method: 'Efectivo', caja_origen: 'Caja Proveedores',
    description: 'factura 1', attachments: ['a.jpg', 'b.jpg'],
  }
  const fila = (extra: Partial<CashMovement> = {}) =>
    mov('n', { amount_crc: 20000, amount_usd: 0, supplier_id: 'sup-1', method: 'Efectivo', caja_origen: 'Caja Proveedores',
      description: 'factura 1', attachments: ['b.jpg', 'a.jpg'], ...extra } as Partial<CashMovement>)
  it('mismos datos (fotos en otro orden) → sí', () => { expect(coincidePago(fila(), d)).toBe(true) })
  it('cualquier campo distinto → no', () => {
    expect(coincidePago(fila({ amount_crc: 18000 }), d)).toBe(false)
    expect(coincidePago(fila({ amount_usd: 5 }), d)).toBe(false)
    expect(coincidePago(fila({ supplier_id: 'sup-2' }), d)).toBe(false)
    expect(coincidePago(fila({ method: 'Transferencia' }), d)).toBe(false)
    expect(coincidePago(fila({ description: 'otra' }), d)).toBe(false)
    expect(coincidePago(fila({ attachments: ['a.jpg'] } as Partial<CashMovement>), d)).toBe(false)
  })
  it('proveedor vacío y null son lo mismo', () => {
    expect(coincidePago(fila({ supplier_id: null }), { ...d, supplier_id: '' })).toBe(true)
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
  it('(ronda 2) leerTodosLosReemplazos junta las anotaciones de todos los turnos del aparato y nada más', () => {
    const m = new Map<string, string>()
    const st = { getItem: (k: string) => m.get(k) ?? null, key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size } }
    m.set(claveReemplazos('s1'), JSON.stringify([{ viejo: 'v1', nuevo: 'n1', at: 1 }]))
    m.set(claveReemplazos('s2'), JSON.stringify([{ viejo: 'v2', nuevo: 'n2', at: 2 }, { basura: true }]))
    m.set('otra:clave', JSON.stringify([{ viejo: 'x', nuevo: 'y', at: 3 }]))
    expect(leerTodosLosReemplazos(st)).toEqual([{ viejo: 'v1', nuevo: 'n1', at: 1 }, { viejo: 'v2', nuevo: 'n2', at: 2 }])
    expect(leerTodosLosReemplazos(null)).toEqual([])
    expect(leerTodosLosReemplazos({ getItem: () => null, key: () => { throw new Error('bloqueado') }, length: 1 })).toEqual([])
  })

  it('(ronda 3) anotarEnAparato: dos anotaciones seguidas con la MISMA lista vieja de memoria no se pisan', () => {
    const st = memoria()
    const r1: ReemplazoPendiente = { viejo: 'v1', nuevo: 'n1', at: 5 }
    const r2: ReemplazoPendiente = { viejo: 'v2', nuevo: 'n2', at: 6 }
    const movs = [mov('v1'), mov('n1'), mov('v2'), mov('n2')]
    const vieja: ReemplazoPendiente[] = []                        // la del último render
    anotarEnAparato('s1', vieja, prev => [...prev, r1], movs, st, 10)
    const lista = anotarEnAparato('s1', vieja, prev => [...prev, r2], movs, st, 10)
    expect(lista).toEqual([r1, r2])
    expect(leerReemplazos('s1', st)).toEqual([r1, r2])
  })

  it('(ronda 3) anotarEnAparato sin almacenamiento parte de la memoria', () => {
    const r1: ReemplazoPendiente = { viejo: 'v1', nuevo: 'n1', at: 5 }
    const r2: ReemplazoPendiente = { viejo: 'v2', nuevo: 'n2', at: 6 }
    expect(anotarEnAparato('s1', [r1], prev => [...prev, r2], [mov('v1'), mov('n1'), mov('v2'), mov('n2')], null, 10)).toEqual([r1, r2])
  })

  it('(ronda 3) enCambioAbierto: el viejo y el nuevo de un par abierto, nada más', () => {
    const r: ReemplazoPendiente = { viejo: 'v', nuevo: 'n', at: 0 }
    expect(enCambioAbierto('v', [r])).toBe(true)
    expect(enCambioAbierto('n', [r])).toBe(true)
    expect(enCambioAbierto('x', [r])).toBe(false)
    expect(enCambioAbierto(null, [r])).toBe(false)
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

// Ronda 3 (I1 del verificador): un cambio a medias nunca traba la Noche sin salida. Datos ficticios.
describe('revisarCambioEnBase / reemplazosDelDia / soltarReemplazo (ronda 3)', () => {
  const r: ReemplazoPendiente = { viejo: 'v', nuevo: 'n', at: 1 }
  const base = (...ids: string[]) => async (id: string) => (ids.includes(id) ? { id } : null)

  it('el viejo ya no está en la base → resuelto (aunque la lista cargada lo traiga)', async () => {
    expect(await revisarCambioEnBase(r, [mov('v'), mov('n')], base('n'))).toBe('resuelto')
  })
  it('los dos en la base → terminable; el nuevo todavía en la cola → en_cola; sin el nuevo → sin_nuevo', async () => {
    expect(await revisarCambioEnBase(r, [mov('v'), mov('n')], base('v', 'n'))).toBe('terminable')
    expect(await revisarCambioEnBase(r, [mov('v'), mov('n', { _pending: true })], base('v'))).toBe('en_cola')
    expect(await revisarCambioEnBase(r, [mov('v'), mov('n')], base('v'))).toBe('sin_nuevo')
  })
  it('sin señal → desconocido (no se suelta nada)', async () => {
    expect(await revisarCambioEnBase(r, [], async () => { throw new Error('Failed to fetch') })).toBe('desconocido')
  })
  it('reemplazosDelDia: solo los del día; sin turno conocido cuenta (mejor frenar)', () => {
    const movs = [mov('v', { session_id: 's1' }), mov('n', { session_id: 's1' }), mov('v2', { session_id: null }), mov('n2')]
    const ses = [{ id: 's1', session_date: '2000-01-01' }]
    const r2: ReemplazoPendiente = { viejo: 'v2', nuevo: 'n2', at: 1 }
    expect(reemplazosDelDia([r, r2], movs, ses, '2000-01-01')).toEqual([r, r2])
    expect(reemplazosDelDia([r, r2], movs, ses, '2000-01-02')).toEqual([r2])
  })
  it('soltarReemplazo quita ese viejo de TODOS los turnos y deja lo demás', () => {
    const m = new Map<string, string>()
    const st = {
      getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) },
      removeItem: (k: string) => { m.delete(k) }, key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size },
    }
    m.set(claveReemplazos('s1'), JSON.stringify([r, { viejo: 'x', nuevo: 'y', at: 2 }]))
    m.set(claveReemplazos('s2'), JSON.stringify([r]))
    m.set('otra-cosa', 'igual')
    soltarReemplazo('v', st)
    expect(leerTodosLosReemplazos(st)).toEqual([{ viejo: 'x', nuevo: 'y', at: 2 }])
    expect(m.has(claveReemplazos('s2'))).toBe(false)
    expect(m.get('otra-cosa')).toBe('igual')
  })
})
