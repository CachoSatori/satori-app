import { describe, expect, it } from 'vitest'
import {
  agrupar, analizar, aCsv, calidadDatos, crc, cuadreVentas, descomponerPromPax, elegirCorte, entero, explicar,
  filtrar, pctPax, puedeSerCausa, signoCrc, tablaCorte, tablaSaloneros, totales, totSalon, turnoDeFranja,
  type FiltroTurno,
  type Corte, type FilaAgregada, type Franja, type Grupo,
} from './ventasPromPaxExplicado'
import { periodoDeComparacion, periodoMes, periodoSemana, periodoTemporada, periodoRango } from './periodosPromPax'

// Generador con semilla (mulberry32): mismos casos en cada corrida, sin dependencias nuevas.
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FRANJAS: Franja[] = ['mañana', 'noche', 'madrugada']
const CANALES = ['salon', 'salon', 'salon', 'barra', 'delivery', 'llevar', 'otro']
const LOGINS = [null, '026', '028', '032', '027', '0909']

function fila(p: Partial<FilaAgregada> & Pick<FilaAgregada, 'dia'>): FilaAgregada {
  return {
    franja: 'noche', salonero_login: '026', canal: 'salon', tickets: 1, pax: 2, neta: 30000,
    neta_sin_pax: 0, tickets_sin_pax: 0, ...p,
  }
}

/** Filas aleatorias para un rango de días de octubre o septiembre. */
function filasAleatorias(r: () => number, mes: '09' | '10', n: number): FilaAgregada[] {
  const out: FilaAgregada[] = []
  for (let i = 0; i < n; i++) {
    const dia = `2026-${mes}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`
    const canal = CANALES[Math.floor(r() * CANALES.length)]
    const conPax = r() < 0.85
    const pax = conPax ? 1 + Math.floor(r() * 8) : 0
    const neta = Math.round(r() * 400000 * 100) / 100 - (r() < 0.03 ? 50000 : 0) // a veces negativa (anulación parcial)
    out.push({
      dia, franja: FRANJAS[Math.floor(r() * 3)], canal,
      salonero_login: LOGINS[Math.floor(r() * LOGINS.length)],
      tickets: 1 + Math.floor(r() * 3), pax,
      neta, neta_sin_pax: conPax ? (r() < 0.2 ? neta * r() : 0) : neta,
      tickets_sin_pax: conPax ? 0 : 1,
    })
  }
  return out
}

const SEP = periodoRango('2026-09-01', '2026-09-28')
const OCT = periodoRango('2026-10-01', '2026-10-28')

describe('turno por hora de la factura — madrugada = noche del mismo día (opción B)', () => {
  it('mapea las tres franjas', () => {
    expect(turnoDeFranja('mañana')).toBe('mañana')
    expect(turnoDeFranja('noche')).toBe('noche')
    expect(turnoDeFranja('madrugada')).toBe('noche')
  })
  it('la madrugada no cambia el día: queda en el mismo día calendario', () => {
    const f = [fila({ dia: '2026-01-01', franja: 'madrugada' })]
    expect(filtrar(f, periodoRango('2026-01-01', '2026-01-01'), 'noche')).toHaveLength(1)
    expect(filtrar(f, periodoRango('2025-12-31', '2025-12-31'))).toHaveLength(0)
  })
})

describe('§6.1 — propiedad: Δ ventas = Σ Δ líneas, Δ salón = volumen + gasto (1e-9)', () => {
  it('2.000 casos aleatorios', () => {
    const r = prng(20261106)
    for (let k = 0; k < 2000; k++) {
      const v = totales(filasAleatorias(r, '09', 1 + Math.floor(r() * 60)))
      const n = totales(filasAleatorias(r, '10', 1 + Math.floor(r() * 60)))
      const c = cuadreVentas(v, n)
      const sumaLineas = Object.values(c.porLinea).reduce((s, x) => s + x, 0)
      expect(Math.abs(c.delta - sumaLineas)).toBeLessThan(1e-6 * Math.max(1, Math.abs(c.delta)))
      if (c.salon) {
        const dSalon = n.porLinea.salon - v.porLinea.salon
        expect(Math.abs(c.salon.volumen + c.salon.gasto - dSalon)).toBeLessThan(1e-9 * Math.max(1, Math.abs(dSalon)))
      } else {
        expect(v.paxSalon === 0 || n.paxSalon === 0).toBe(true)
      }
    }
  })
})

describe('§6.2 — propiedad: Σ rendimiento + Σ mezcla + venta sin pax = P_n − P_v (1e-9)', () => {
  const cortes: Corte[] = ['turno', 'dia', 'salonero', 'semana', 'saloneroTurno']
  it('12.500 casos aleatorios, los cinco cortes', () => {
    const r = prng(42)
    let probados = 0
    for (let k = 0; k < 2500; k++) {
      const fv = filasAleatorias(r, '09', 1 + Math.floor(r() * 50))
      const fn = filasAleatorias(r, '10', 1 + Math.floor(r() * 50))
      const v = totales(fv), n = totales(fn)
      for (const corte of cortes) {
        const d = descomponerPromPax(agrupar(fv, corte, SEP), agrupar(fn, corte, OCT), totSalon(v), totSalon(n))
        if (!d) { expect(v.paxSalon === 0 || n.paxSalon === 0).toBe(true); continue }
        probados++
        expect(Math.abs(d.residuo)).toBeLessThan(1e-9 * Math.max(1, Math.abs(d.P_v), Math.abs(d.P_n)))
        expect(d.P_v).toBeCloseTo(v.promPax!, 9)
        expect(d.P_n).toBeCloseTo(n.promPax!, 9)
        const sv = d.grupos.reduce((s, g) => s + g.s_v, 0), sn = d.grupos.reduce((s, g) => s + g.s_n, 0)
        expect(sv).toBeCloseTo(1, 9)
        expect(sn).toBeCloseTo(1, 9)
      }
    }
    expect(probados).toBeGreaterThan(11000)
  })

  it('magnitudes reales (₡ millones y miles de pax) también cuadran a 1e-9 relativo', () => {
    const r = prng(7)
    for (let k = 0; k < 500; k++) {
      const mk = (pax: number, neta: number, clave: string): Grupo =>
        ({ clave, etiqueta: clave, orden: 0, pax, neta, netaTotal: neta, tickets: 1 })
      const n = 2 + Math.floor(r() * 12)
      const gv: Grupo[] = [], gn: Grupo[] = []
      for (let i = 0; i < n; i++) {
        if (r() < 0.85) gv.push(mk(1 + Math.floor(r() * 900), r() * 15e6, `g${i}`))
        if (r() < 0.85) gn.push(mk(1 + Math.floor(r() * 900), r() * 15e6, `g${i}`))
      }
      if (!gv.length || !gn.length) continue
      const tv = { N: gv.reduce((s, g) => s + g.neta, 0), N0: r() * 4e5, PAX: gv.reduce((s, g) => s + g.pax, 0) }
      const tn = { N: gn.reduce((s, g) => s + g.neta, 0), N0: r() * 4e5, PAX: gn.reduce((s, g) => s + g.pax, 0) }
      const d = descomponerPromPax(gv, gn, tv, tn)!
      expect(Math.abs(d.residuo)).toBeLessThan(1e-9 * Math.max(Math.abs(d.P_v), Math.abs(d.P_n)))
    }
  })
})

describe('§6.2 — casos borde', () => {
  const g = (clave: string, pax: number, neta: number): Grupo => ({ clave, etiqueta: clave, orden: 0, pax, neta, netaTotal: neta, tickets: 1 })

  it('grupo que SALE (estaba en la comparación y no en el período) y grupo que ENTRA', () => {
    const gv = [g('ALFA', 100, 1_700_000), g('BETA', 40, 600_000)]
    const gn = [g('ALFA', 120, 2_100_000), g('NUEVO', 30, 450_000)]
    const d = descomponerPromPax(gv, gn,
      { N: 2_300_000, N0: 0, PAX: 140 }, { N: 2_550_000, N0: 50_000, PAX: 150 })!
    const sale = d.grupos.find(x => x.clave === 'BETA')!
    expect(sale.estado).toBe('sale')
    expect(sale.rendimiento).toBe(0)
    expect(sale.mezcla).toBeCloseTo(-(40 / 140) * (15_000 - 2_300_000 / 140), 9)
    const nuevo = d.grupos.find(x => x.clave === 'NUEVO')!
    expect(nuevo.estado).toBe('entra')
    expect(nuevo.mezcla).toBeCloseTo((30 / 150) * (15_000 - 2_300_000 / 140), 9)
    expect(d.ventaSinPax).toBeCloseTo(50_000 / 150, 9)
    expect(Math.abs(d.residuo)).toBeLessThan(1e-9)
    expect(puedeSerCausa(sale)).toBe(false)
  })

  it('sin pax en algún período → sin descomposición', () => {
    expect(descomponerPromPax([], [g('a', 1, 1)], { N: 0, N0: 100, PAX: 0 }, { N: 1, N0: 0, PAX: 1 })).toBeNull()
  })

  it('un grupo con pax 0 se trata como ausente (nunca −100 %)', () => {
    const d = descomponerPromPax([g('a', 10, 100_000), g('b', 0, 0)], [g('a', 10, 120_000)],
      { N: 100_000, N0: 0, PAX: 10 }, { N: 120_000, N0: 0, PAX: 10 })!
    expect(d.grupos.map(x => x.clave)).toEqual(['a'])
    const t = tablaCorte([g('a', 10, 100_000), g('b', 5, 0)], [g('a', 10, 120_000), g('b', 0, 30_000)], d)
    const b = t.find(x => x.clave === 'b')!
    expect(b.promPax).toBeNull()
    expect(b.deltaPct).toBeNull()
  })

  it('la neta de facturas sin pax va a «venta sin pax», no al grupo', () => {
    const fv = [fila({ dia: '2026-09-02', pax: 10, neta: 150_000 })]
    const fn = [fila({ dia: '2026-10-02', pax: 10, neta: 150_000 }),
                fila({ dia: '2026-10-03', pax: 0, neta: 20_000, neta_sin_pax: 20_000, tickets_sin_pax: 1 })]
    const a = analizar([...fv, ...fn], OCT, SEP)
    const d = a.cortes.salonero.d!
    expect(d.delta).toBeCloseTo(2_000, 9)
    expect(d.ventaSinPax).toBeCloseTo(2_000, 9)
    expect(d.grupos[0].aporte).toBeCloseTo(0, 9)
  })
})

describe('§6.3 — calidad de datos, causas y frases', () => {
  it('umbrales 30 / 100 en el período con menos pax', () => {
    expect(calidadDatos(29, 500)).toBe('pocos')
    expect(calidadDatos(30, 500)).toBe('orientacion')
    expect(calidadDatos(100, 99)).toBe('orientacion')
    expect(calidadDatos(100, 100)).toBe('ok')
  })

  it('causa: ≥ 15 pax en los dos períodos', () => {
    expect(puedeSerCausa({ pax_v: 15, pax_n: 15 })).toBe(true)
    expect(puedeSerCausa({ pax_v: 14, pax_n: 300 })).toBe(false)
  })

  it('elige el corte que más explica; empate turno → día → salonero', () => {
    const grupo = (clave: string, aporte: number) => ({
      clave, etiqueta: clave, orden: 0, estado: 'ambos' as const, pax_v: 50, pax_n: 50, s_v: .5, s_n: .5,
      p_v: 1, p_n: 1, rendimiento: aporte, mezcla: 0, aporte,
    })
    const desc = (aportes: number[]) => ({ P_v: 0, P_n: 0, delta: 0, Pstar_v: 0, Pstar_n: 0, ventaSinPax: 0, residuo: 0,
      grupos: aportes.map((a, i) => grupo(`g${i}`, a)) })
    expect(elegirCorte({ turno: desc([100, 50]), dia: desc([120, 40]), salonero: desc([-300]) })!.corte).toBe('salonero')
    expect(elegirCorte({ turno: desc([100, 50]), dia: desc([120, 30]), salonero: desc([-150]) })!.corte).toBe('turno')
    expect(elegirCorte({ turno: null, dia: desc([0]), salonero: desc([]) })).toBeNull()
  })

  it('con < 30 pax: «Pocos datos para sacar conclusiones» y sin causas', () => {
    const f = [fila({ dia: '2026-09-02', pax: 20 }), fila({ dia: '2026-10-02', pax: 40 })]
    const a = analizar(f, OCT, SEP)
    expect(a.explicacion.calidad).toBe('pocos')
    expect(a.explicacion.frases).toContain('Pocos datos para sacar conclusiones.')
    expect(a.explicacion.corte).toBeNull()
  })

  it('con 30–100 pax: causas con la etiqueta de orientación', () => {
    const f = [
      fila({ dia: '2026-09-02', pax: 30, neta: 450_000, salonero_login: '026' }),
      fila({ dia: '2026-09-02', pax: 30, neta: 450_000, salonero_login: '028' }),
      fila({ dia: '2026-10-07', pax: 30, neta: 600_000, salonero_login: '026' }),
      fila({ dia: '2026-10-07', pax: 30, neta: 450_000, salonero_login: '028' }),
    ]
    const a = analizar(f, OCT, SEP)
    expect(a.explicacion.calidad).toBe('orientacion')
    expect(a.explicacion.etiqueta).toBe('Pocos datos: tomalo como orientación')
    expect(a.explicacion.frases.length).toBeGreaterThanOrEqual(2)
    expect(a.explicacion.frases[1]).toMatch(/^Por (turno|día|salonero): /)
  })

  it('frase de ventas: volumen + gasto del salón', () => {
    const v = totales([fila({ dia: '2026-09-01', pax: 100, neta: 1_500_000 })])
    const n = totales([fila({ dia: '2026-10-01', pax: 110, neta: 1_760_000 })])
    const e = explicar(cuadreVentas(v, n), v, n, {})
    expect(e.frases[0]).toBe('Las ventas subieron ₡260.000. En el salón, ₡150.000 más por más gente y ₡110.000 más por más gasto por persona.')
  })

  it('crc formatea sin depender del locale', () => {
    expect(crc(16491.4)).toBe('₡16.491')
    expect(crc(-1234567.8)).toBe('₡1.234.568')
  })
})

describe('tablas', () => {
  it('saloneros: vs promedio del turno, una fila por salonero y turno con «ambos»', () => {
    const f = [
      fila({ dia: '2026-10-01', franja: 'noche', salonero_login: '026', pax: 10, neta: 200_000 }),
      fila({ dia: '2026-10-01', franja: 'noche', salonero_login: null, pax: 10, neta: 100_000 }),
      fila({ dia: '2026-10-01', franja: 'madrugada', salonero_login: '026', pax: 0, neta: 10_000, neta_sin_pax: 10_000 }),
      fila({ dia: '2026-10-02', franja: 'mañana', salonero_login: '026', pax: 5, neta: 50_000 }),
    ]
    const t = tablaSaloneros(f)
    const s026Noche = t.find(x => x.clave === '026' && x.turno === 'noche')!
    expect(s026Noche.promPax).toBeCloseTo(21_000, 9)
    expect(s026Noche.vsTurno).toBeCloseTo(21_000 / 15_500 - 1, 9)
    expect(t.find(x => x.clave === '026' && x.turno === 'mañana')!.vsTurno).toBeCloseTo(0, 9)
    expect(t.find(x => x.clave === 'caja')!.etiqueta).toBe('Caja / sin mesero')
  })

  it('CSV con BOM y comillas escapadas', () => {
    expect(aCsv(['a', 'b'], [['x"y', 1], [null, 2]])).toBe('﻿"a","b"\n"x""y","1"\n"","2"')
  })
})

describe('períodos y comparaciones', () => {
  it('mes, semana ISO y temporada', () => {
    expect(periodoMes(2026, 2)).toEqual({ tipo: 'mes', desde: '2026-02-01', hasta: '2026-02-28' })
    expect(periodoMes(2028, 2).hasta).toBe('2028-02-29')
    expect(periodoSemana('2026-11-06')).toEqual({ tipo: 'semana', desde: '2026-11-02', hasta: '2026-11-08' })
    expect(periodoTemporada('alta', 2026)).toMatchObject({ desde: '2025-12-15', hasta: '2026-04-30' })
  })
  it('anterior de igual largo, año anterior y tramo del año anterior', () => {
    expect(periodoDeComparacion(periodoRango('2026-10-01', '2026-10-29'), 'anterior'))
      .toEqual({ tipo: 'rango', desde: '2026-09-02', hasta: '2026-09-30' })
    expect(periodoDeComparacion(periodoMes(2026, 10), 'anio-anterior')).toEqual(periodoMes(2025, 10))
    expect(periodoDeComparacion(periodoSemana('2026-11-06'), 'anio-anterior'))
      .toEqual({ tipo: 'semana', desde: '2025-11-03', hasta: '2025-11-09' })
    expect(periodoDeComparacion(periodoRango('2028-02-29', '2028-03-01'), 'anio-anterior'))
      .toMatchObject({ desde: '2027-02-28', hasta: '2027-03-01' })
    expect(periodoDeComparacion(periodoTemporada('baja-may', 2026), 'tramo-anio-anterior'))
      .toMatchObject({ desde: '2025-05-01', hasta: '2025-05-31' })
    expect(() => periodoDeComparacion(periodoMes(2026, 1), 'tramo-anio-anterior')).toThrow()
  })
})

/** Los números de una frase: ₡ con o sin signo, % y «N pax». */
const NUMEROS = /[+−]?₡[\d.]+|\d+,\d%|[\d.]+(?= pax)/g

describe('§6.3 — cada número de una frase de causa está tal cual en la tabla visible', () => {
  it('2.000 análisis aleatorios, con turno ambos / noche / mañana', () => {
    const r = prng(1107)
    let frasesProbadas = 0
    for (let k = 0; k < 2000; k++) {
      const filas = [...filasAleatorias(r, '09', 40 + Math.floor(r() * 120)), ...filasAleatorias(r, '10', 40 + Math.floor(r() * 120))]
      const turno = (['ambos', 'noche', 'mañana'] as FiltroTurno[])[k % 3]
      const a = analizar(filas, OCT, SEP, turno)
      const corte = a.explicacion.corte
      if (!corte) continue
      if (turno === 'ambos') expect(corte).not.toBe('salonero')
      else expect(['turno', 'saloneroTurno']).not.toContain(corte)
      const { gv, gn, d } = a.cortes[corte]
      // La fila como la imprime la tabla (VentasPromPaxExplicado.tsx), columnas por defecto.
      const filasTabla = tablaCorte(gv, gn, d).map(f => [
        f.etiqueta, entero(f.pax), pctPax(f.pctPax), f.promPax === null ? 'sin pax' : crc(f.promPax),
        f.promPaxComp === null ? 'sin pax' : crc(f.promPaxComp), signoCrc(f.delta),
      ])
      for (const frase of a.explicacion.frases.slice(1)) {
        const fila = filasTabla.find(c => frase.replace(/^Por [^:]+: /, '').startsWith(`${c[0]}:`))
        expect(fila, frase).toBeTruthy()
        const nums = frase.match(NUMEROS) ?? []
        expect(nums.length, frase).toBeGreaterThanOrEqual(2)
        for (const num of nums) expect(fila!.slice(1), `${num} en «${frase}»`).toContain(num)
        frasesProbadas++
      }
    }
    expect(frasesProbadas).toBeGreaterThan(1000)
  })
})
