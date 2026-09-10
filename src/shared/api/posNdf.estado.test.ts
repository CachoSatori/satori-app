// El estado de la factura como filtro en las lecturas de `pos_ndf_tickets` que NO pasan por
// `armarDia`. Desde B, la tabla trae `R` (en curso) y `X` (anulada) además de `C`; cada lectura
// tiene que decir a qué estados se refiere, y decirlo en el SQL, no en la esperanza.
import { describe, it, expect, vi } from 'vitest'

interface Fila { [k: string]: unknown }

/**
 * Doble mínimo de PostgREST: registra los filtros que le piden y los APLICA sobre las filas,
 * para que el test vea el resultado y no solo la llamada.
 */
function fakePostgrest(filas: Fila[]) {
  const llamadas: { metodo: string; args: unknown[] }[] = []
  const nuevo = () => {
    let datos = filas
    const resolver = () => ({ data: datos, error: null })
    const api = {
      from:   (...a: unknown[]) => { llamadas.push({ metodo: 'from', args: a }); return api },
      select: (...a: unknown[]) => { llamadas.push({ metodo: 'select', args: a }); return api },
      eq:     (c: string, v: unknown) => {
        llamadas.push({ metodo: 'eq', args: [c, v] }); datos = datos.filter(f => f[c] === v); return api
      },
      in:     (c: string, vs: unknown[]) => {
        llamadas.push({ metodo: 'in', args: [c, vs] }); datos = datos.filter(f => vs.includes(f[c])); return api
      },
      not:    (c: string, op: string, v: unknown) => {
        llamadas.push({ metodo: 'not', args: [c, op, v] })
        if (op === 'is' && v === null) datos = datos.filter(f => f[c] !== null && f[c] !== undefined)
        return api
      },
      gte:    (...a: unknown[]) => { llamadas.push({ metodo: 'gte', args: a }); return api },
      lt:     (...a: unknown[]) => { llamadas.push({ metodo: 'lt', args: a }); return api },
      order:  (...a: unknown[]) => { llamadas.push({ metodo: 'order', args: a }); return api },
      range:  (a: number, b: number) => {
        llamadas.push({ metodo: 'range', args: [a, b] })
        return Promise.resolve({ data: datos.slice(a, b + 1), error: null })
      },
      then:   (r: (v: ReturnType<typeof resolver>) => unknown) => r(resolver()),
    }
    return api
  }
  return { from: () => nuevo(), llamadas }
}

const mock = vi.hoisted(() => ({ cliente: { from: (): unknown => ({}) } }))
vi.mock('./supabase', () => ({ supabase: mock.cliente }))

const { getPedidosCerradosJornada } = await import('./posNdf')

const LOCAL = 'santa-teresa'
const JORNADA = '2026-09-09'

const tk = (o: Fila): Fila => ({
  id: 't', local: LOCAL, numero_pedido: null, estado: 'C',
  fecha_registra: '2026-09-09T20:00:00-06:00', valor_servido_crc: 0, ...o,
})

describe('getPedidosCerradosJornada — la llave que saca una mesa de «abiertas»', () => {
  it('pide EXPLÍCITAMENTE estado C y R, y no X', async () => {
    const fake = fakePostgrest([])
    mock.cliente.from = fake.from
    await getPedidosCerradosJornada(LOCAL, JORNADA)
    const filtroIn = fake.llamadas.find(l => l.metodo === 'in')
    expect(filtroIn?.args).toEqual(['estado', ['C', 'R']])
  })

  it('una mesa con factura EN CURSO (R) ya no es «abierta»: su pedido entra en la llave', async () => {
    // Existe la factura → el pedido ya pasó a F en el PoS y salió de pos_ndf_open. La mesa está
    // en cobro, y su plata se ve en «Sin cerrar», no en «Abierto».
    const fake = fakePostgrest([
      tk({ id: 'c', estado: 'C', numero_pedido: '101' }),
      tk({ id: 'r', estado: 'R', numero_pedido: '102' }),
    ])
    mock.cliente.from = fake.from
    const llave = await getPedidosCerradosJornada(LOCAL, JORNADA)
    expect([...llave].sort()).toEqual(['101', '102'])
  })

  it('una factura ANULADA (X) no cierra nada: su pedido NO entra en la llave', async () => {
    const fake = fakePostgrest([
      tk({ id: 'c', estado: 'C', numero_pedido: '101' }),
      tk({ id: 'x', estado: 'X', numero_pedido: '103' }),
    ])
    mock.cliente.from = fake.from
    const llave = await getPedidosCerradosJornada(LOCAL, JORNADA)
    expect([...llave]).toEqual(['101'])
  })

  it('sin numero_pedido no hay llave, sea cual sea el estado', async () => {
    const fake = fakePostgrest([
      tk({ id: 'c', estado: 'C', numero_pedido: null }),
      tk({ id: 'r', estado: 'R', numero_pedido: '  ' }),
    ])
    mock.cliente.from = fake.from
    expect(await getPedidosCerradosJornada(LOCAL, JORNADA)).toEqual(new Set())
  })
})
