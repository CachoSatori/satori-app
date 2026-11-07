import { describe, expect, it } from 'vitest'
import { etiquetaTramo, rangoDeTramo, TRAMOS, tramoDe, tramoDelAnioAnterior, type Tramo } from './temporadas'

/** Todos los días de [desde, hasta] como `YYYY-MM-DD`, en UTC (sin huso: solo calendario). */
function dias(desde: string, hasta: string): string[] {
  const out: string[] = []
  const d = new Date(`${desde}T00:00:00Z`)
  const fin = new Date(`${hasta}T00:00:00Z`)
  while (d <= fin) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

describe('temporadas — propiedad: cada día 2024–2030 cae en exactamente un tramo', () => {
  const todos = dias('2024-01-01', '2030-12-31')

  it('recorre los 2.557 días', () => {
    expect(todos).toHaveLength(2557)
  })

  it('cada día está dentro del rango del tramo que devuelve tramoDe', () => {
    for (const d of todos) {
      const t = tramoDe(d)
      expect(d >= t.desde && d <= t.hasta, d).toBe(true)
    }
  })

  it('y en NINGÚN otro tramo de los años vecinos', () => {
    for (const d of todos) {
      const anio = Number(d.slice(0, 4))
      const contenedores: Tramo[] = []
      for (const a of [anio - 1, anio, anio + 1, anio + 2]) {
        for (const id of TRAMOS) {
          const r = rangoDeTramo(id, a)
          if (d >= r.desde && d <= r.hasta) contenedores.push(r)
        }
      }
      expect(contenedores, d).toHaveLength(1)
      expect(contenedores[0]).toEqual(tramoDe(d))
    }
  })

  it('los tramos son contiguos: el día siguiente al fin de uno es el inicio del próximo', () => {
    for (let i = 1; i < todos.length; i++) {
      const a = tramoDe(todos[i - 1]), b = tramoDe(todos[i])
      if (a.id !== b.id || a.anio !== b.anio) {
        expect(todos[i - 1]).toBe(a.hasta)
        expect(todos[i]).toBe(b.desde)
      }
    }
  })
})

describe('temporadas — bordes y etiquetas', () => {
  it('la alta pertenece al año en que termina', () => {
    expect(tramoDe('2025-12-15')).toEqual({ id: 'alta', anio: 2026, desde: '2025-12-15', hasta: '2026-04-30' })
    expect(tramoDe('2026-04-30').id).toBe('alta')
    expect(tramoDe('2025-12-14')).toEqual({ id: 'baja-sepdic', anio: 2025, desde: '2025-09-01', hasta: '2025-12-14' })
    expect(tramoDe('2026-05-01').id).toBe('baja-may')
    expect(tramoDe('2026-06-01').id).toBe('media')
    expect(tramoDe('2026-08-31').id).toBe('media')
    expect(tramoDe('2026-09-01').id).toBe('baja-sepdic')
  })

  it('29 de febrero cae en la alta', () => {
    expect(tramoDe('2028-02-29')).toMatchObject({ id: 'alta', anio: 2028 })
  })

  it('la etiqueta muestra el rango real', () => {
    expect(etiquetaTramo(rangoDeTramo('alta', 2026))).toBe('Alta 2026: 15 dic 2025 – 30 abr 2026')
    expect(etiquetaTramo(rangoDeTramo('baja-sepdic', 2026))).toBe('Baja sep–dic 2026: 1 sep 2026 – 14 dic 2026')
  })

  it('la comparación es tramo contra tramo del año anterior', () => {
    expect(tramoDelAnioAnterior(rangoDeTramo('baja-may', 2026))).toEqual(rangoDeTramo('baja-may', 2025))
    expect(tramoDelAnioAnterior(rangoDeTramo('alta', 2026)).desde).toBe('2024-12-15')
  })

  it('un día mal formado tira', () => {
    expect(() => tramoDe('2026-1-01')).toThrow()
  })
})
