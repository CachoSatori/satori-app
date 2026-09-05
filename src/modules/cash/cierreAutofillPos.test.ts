import { describe, it, expect } from 'vitest'
import {
  desfasesPoS, MARCA_DESFASE, notaDesfasePoS, notasConDesfasePoS,
  TOLERANCIA_CRC, TOLERANCIA_USD,
} from './cierreAutofillPos'
import type { VentasPorTurnoPoS } from '../../shared/api/posNdf'

const esperado = (over: Partial<VentasPorTurnoPoS> = {}): VentasPorTurnoPoS => ({
  mediodia: { crc: 100_000, usd: 20 },
  noche:    { crc: 300_000, usd: 50 },
  ...over,
})
const declarado = (md: [number, number], no: [number, number]) => ({
  mediodia: { crc: md[0], usd: md[1] },
  noche:    { crc: no[0], usd: no[1] },
})

describe('desfasesPoS', () => {
  it('sin diferencias, lista vacía', () => {
    expect(desfasesPoS(esperado(), declarado([100_000, 20], [300_000, 50]))).toEqual([])
  })

  it('sin datos del PoS no hay contra qué comparar — vacío, no «coincide»', () => {
    expect(desfasesPoS(null, declarado([1, 2], [3, 4]))).toEqual([])
  })

  it('marca el campo, el turno, los dos montos y la diferencia con signo', () => {
    const d = desfasesPoS(esperado(), declarado([95_000, 20], [300_000, 50]))
    expect(d).toEqual([
      { turno: 'Mediodía', moneda: 'CRC', esperado: 100_000, declarado: 95_000, diferencia: -5_000 },
    ])
  })

  it('declarar de MÁS también se anota (diferencia positiva)', () => {
    expect(desfasesPoS(esperado(), declarado([100_000, 20], [312_000, 50]))[0])
      .toMatchObject({ turno: 'Noche', moneda: 'CRC', diferencia: 12_000 })
  })

  it('un turno que el PoS reporta en cero SÍ se compara', () => {
    // El caso que más importa: el PoS no vio ninguna factura y el cajero declaró plata.
    const d = desfasesPoS(esperado({ noche: { crc: 0, usd: 0 } }), declarado([100_000, 20], [80_000, 0]))
    expect(d).toEqual([
      { turno: 'Noche', moneda: 'CRC', esperado: 0, declarado: 80_000, diferencia: 80_000 },
    ])
  })

  it('las cuatro celdas se miran por separado', () => {
    const d = desfasesPoS(esperado(), declarado([1, 2], [3, 4]))
    expect(d.map(x => `${x.turno}/${x.moneda}`))
      .toEqual(['Mediodía/CRC', 'Mediodía/USD', 'Noche/CRC', 'Noche/USD'])
  })

  it('respeta las tolerancias: ₡1 y $0,01 son diferencia; menos que eso es ruido', () => {
    expect(desfasesPoS(esperado(), declarado([100_000 + TOLERANCIA_CRC, 20], [300_000, 50])))
      .toHaveLength(1)
    expect(desfasesPoS(esperado(), declarado([100_000 + 0.4, 20], [300_000, 50])))
      .toEqual([])
    expect(desfasesPoS(esperado(), declarado([100_000, 20 + TOLERANCIA_USD], [300_000, 50])))
      .toHaveLength(1)
    // Ruido de punto flotante: 0.1 + 0.2 = 0.30000000000000004
    expect(desfasesPoS(esperado({ mediodia: { crc: 0, usd: 0.1 + 0.2 } }), declarado([0, 0.3], [300_000, 50])))
      .toEqual([])
  })
})

describe('notaDesfasePoS', () => {
  it('sin desfases no escribe nada', () => {
    expect(notaDesfasePoS([])).toBe('')
  })

  it('una línea por campo, con esperado → declarado y la diferencia', () => {
    const crc = (n: number) => n.toLocaleString('es-CR')
    const nota = notaDesfasePoS(desfasesPoS(esperado(), declarado([95_000, 18.5], [300_000, 50])))
    expect(nota.split('\n')).toEqual([
      MARCA_DESFASE,
      `Mediodía CRC: ₡${crc(100_000)} → ₡${crc(95_000)} (−₡${crc(5_000)})`,
      'Mediodía USD: $20.00 → $18.50 (−$1.50)',
    ])
  })
})

describe('notasConDesfasePoS', () => {
  it('lo que escribió la persona va PRIMERO y entero', () => {
    const r = notasConDesfasePoS('Faltó un depósito.', desfasesPoS(esperado(), declarado([95_000, 20], [300_000, 50])))
    expect(r.startsWith('Faltó un depósito.')).toBe(true)
    expect(r).toContain(MARCA_DESFASE)
  })

  it('sin desfases, las notas quedan tal cual', () => {
    expect(notasConDesfasePoS('Todo bien.', [])).toBe('Todo bien.')
    expect(notasConDesfasePoS('', [])).toBe('')
  })

  it('sin notas propias, solo el bloque — sin líneas en blanco de más', () => {
    const r = notasConDesfasePoS('', desfasesPoS(esperado(), declarado([95_000, 20], [300_000, 50])))
    expect(r.startsWith(MARCA_DESFASE)).toBe(true)
  })

  it('volver a guardar REEMPLAZA el bloque anterior, no lo acumula', () => {
    const uno = notasConDesfasePoS('Nota.', desfasesPoS(esperado(), declarado([95_000, 20], [300_000, 50])))
    const dos = notasConDesfasePoS(uno, desfasesPoS(esperado(), declarado([90_000, 20], [300_000, 50])))
    expect(dos.split(MARCA_DESFASE)).toHaveLength(2)      // aparece UNA vez
    expect(dos).toContain(`₡${(90_000).toLocaleString('es-CR')}`)
    expect(dos).not.toContain(`₡${(95_000).toLocaleString('es-CR')}`)
    expect(dos.startsWith('Nota.')).toBe(true)
  })

  it('si el desfase se corrige, el bloque viejo se va', () => {
    const conBloque = notasConDesfasePoS('Nota.', desfasesPoS(esperado(), declarado([95_000, 20], [300_000, 50])))
    expect(notasConDesfasePoS(conBloque, [])).toBe('Nota.')
  })
})
