import { describe, it, expect } from 'vitest'

import {
  cifrasDeDia,
  compararParidad,
  fueraDeTolerancia,
  METRICAS,
  TOLERANCIA_POR_DEFECTO,
  type Tolerancia,
} from './ventasParidadCalc'
import type { DiasMap, ProductMap, SaloneroDay } from '../../shared/types/ventas'

const PM: ProductMap = {
  'ROLL SATORI': { tipo: 'comida', clasificacion: 'SUSHI', subclasificacion: '', multiplicador: 1, costo_unitario: 0 },
  'CERVEZA':     { tipo: 'bebida', clasificacion: 'BEBIDAS', subclasificacion: '', multiplicador: 1, costo_unitario: 0 },
}

/** Un día de un solo mesero, con las cifras a mano. */
const dia = (o: {
  total: number; pax: number; iva?: number; serv?: number
  com?: number; beb?: number
}): DiasMap[string] => {
  const sal: SaloneroDay = {
    pax: o.pax, total: o.total, com: o.com ?? 0, beb: o.beb ?? 0,
    iCom: 0, iBeb: 0, iva: o.iva ?? 0, serv: o.serv ?? 0,
    promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0,
    prods: [
      ...(o.com ? [['ROLL SATORI', 1, o.com] as [string, number, number]] : []),
      ...(o.beb ? [['CERVEZA', 1, o.beb] as [string, number, number]] : []),
    ],
  }
  return { fileName: 'x', uploadedAt: 'x', saloneros: { MAXO: sal } }
}

// ── Las cifras de un día ───────────────────────────────────────────────────────────────────

describe('cifrasDeDia', () => {
  it('las nueve métricas salen de getDayStats + aggGeneral, sin inventar', () => {
    const c = cifrasDeDia('2026-09-04', dia({ total: 100000, pax: 20, iva: 13000, serv: 10000, com: 70000, beb: 30000 }), PM)
    expect(c).toEqual({
      ventaNeta:  100000,
      ventaBruta: 123000,          // neta + IVA + servicio
      iva:        13000,
      servicio:   10000,
      salon:      100000,          // todo de mesero
      delivery:   0,
      pax:        20,
      comidas:    70000,
      bebidas:    30000,
    })
  })

  it('un día ausente da todo en cero, sin romper', () => {
    const c = cifrasDeDia('2026-09-04', undefined, PM)
    expect(Object.values(c).every(v => v === 0)).toBe(true)
    expect(Object.keys(c).sort()).toEqual(METRICAS.map(m => m.clave).sort())
  })
})

// ── La regla de tolerancia ─────────────────────────────────────────────────────────────────

describe('fueraDeTolerancia — hacen falta LAS DOS condiciones', () => {
  const tol = TOLERANCIA_POR_DEFECTO   // >1% Y >₡1.000

  it('el default es >1% y >₡1.000, con ±2 pax', () => {
    expect(tol).toEqual({ pct: 1, abs: 1000, absPax: 2 })
  })

  it('grande en % pero chica en plata: NO se marca', () => {
    // ₡500 sobre ₡40.000 es 1,25% — pasa el %, pero no los ₡1.000.
    expect(fueraDeTolerancia(40000, 40500, 'crc', tol)).toBe(false)
  })

  it('grande en plata pero chica en %: NO se marca', () => {
    // ₡5.000 sobre ₡10.000.000 es 0,05% — pasa los ₡1.000, pero no el %.
    expect(fueraDeTolerancia(10_000_000, 10_005_000, 'crc', tol)).toBe(false)
  })

  it('grande en las dos: SE MARCA', () => {
    expect(fueraDeTolerancia(100000, 105000, 'crc', tol)).toBe(true)   // ₡5.000 y 5%
  })

  it('da igual el signo: de más o de menos, se marca igual', () => {
    expect(fueraDeTolerancia(100000, 95000, 'crc', tol)).toBe(true)
    expect(fueraDeTolerancia(100000, 105000, 'crc', tol)).toBe(true)
  })

  it('el PAX tiene su propio umbral: con el de colones nunca se marcaría', () => {
    // 20 → 30 pax es media jornada de diferencia. Con `abs` en ₡1.000 pasaría desapercibido.
    expect(fueraDeTolerancia(20, 30, 'pax', tol)).toBe(true)
    expect(fueraDeTolerancia(20, 30, 'crc', tol)).toBe(false)   // ← el bug que `absPax` evita
    expect(fueraDeTolerancia(20, 21, 'pax', tol)).toBe(false)   // ±2 pax se tolera
  })

  it('con el xls en 0, manda el absoluto: aparecer de la nada es una diferencia real', () => {
    expect(fueraDeTolerancia(0, 50000, 'crc', tol)).toBe(true)
    expect(fueraDeTolerancia(0, 500, 'crc', tol)).toBe(false)    // por debajo del absoluto
  })

  it('es AJUSTABLE: con la tolerancia apretada, la misma diferencia se marca', () => {
    const estricta: Tolerancia = { pct: 0.01, abs: 1, absPax: 0 }
    expect(fueraDeTolerancia(40000, 40500, 'crc', estricta)).toBe(true)
    expect(fueraDeTolerancia(20, 21, 'pax', estricta)).toBe(true)
  })
})

// ── El reporte ─────────────────────────────────────────────────────────────────────────────

describe('compararParidad', () => {
  const XLS: DiasMap = {
    '2026-09-04': dia({ total: 100000, pax: 20, serv: 10000, com: 70000, beb: 30000 }),
    '2026-09-05': dia({ total: 200000, pax: 40, serv: 20000, com: 140000, beb: 60000 }),
  }

  it('una fila por día, en orden, más el TOTAL', () => {
    const r = compararParidad(XLS, XLS, PM)
    expect(r.filas.map(f => f.fecha)).toEqual(['2026-09-04', '2026-09-05'])
    expect(r.total.fecha).toBe('TOTAL')
  })

  it('fuentes idénticas: cero diffs, cero flags', () => {
    const r = compararParidad(XLS, XLS, PM)
    expect(r.resumen).toEqual({ dias: 2, ok: 2, flag: 0, soloXls: 0, soloPos: 0 })
    expect(r.filas.every(f => f.comparaciones.every(c => c.diff === 0 && !c.fuera))).toBe(true)
    expect(r.total.flag).toBe(false)
  })

  it('cada comparación trae xls, pos, diff y diff% con el signo correcto', () => {
    const pos: DiasMap = { ...XLS, '2026-09-04': dia({ total: 110000, pax: 20, serv: 10000, com: 70000, beb: 30000 }) }
    const r = compararParidad(XLS, pos, PM)
    const neta = r.filas[0].comparaciones.find(c => c.clave === 'ventaNeta')!
    expect(neta).toMatchObject({ xls: 100000, pos: 110000, diff: 10000, diffPct: 10, fuera: true })
    // `diff` es pos − xls: positivo = el PoS dice MÁS.
    expect(neta.diff).toBeGreaterThan(0)
  })

  it('diff% es null cuando el xls es 0 (no hay base para el porcentaje)', () => {
    const r = compararParidad({ '2026-09-04': dia({ total: 0, pax: 0 }) },
                              { '2026-09-04': dia({ total: 5000, pax: 2 }) }, PM)
    expect(r.filas[0].comparaciones.find(c => c.clave === 'ventaNeta')!.diffPct).toBeNull()
  })

  it('EL PUNTO DEL TOTAL: los corrimientos de borde de día se cancelan en el rango', () => {
    // La misma plata, puesta en días distintos por cada fuente (una factura de después de
    // medianoche). Los dos días se marcan… y el total cuadra exacto.
    const pos: DiasMap = {
      '2026-09-04': dia({ total: 130000, pax: 26, serv: 10000, com: 70000, beb: 30000 }),
      '2026-09-05': dia({ total: 170000, pax: 34, serv: 20000, com: 140000, beb: 60000 }),
    }
    const r = compararParidad(XLS, pos, PM)
    expect(r.resumen.flag).toBe(2)                       // los dos días piden mirada…
    const netaTotal = r.total.comparaciones.find(c => c.clave === 'ventaNeta')!
    expect(netaTotal).toMatchObject({ xls: 300000, pos: 300000, diff: 0, fuera: false })
    expect(r.total.flag).toBe(false)                     // …y el rango cuadra: paridad OK
  })

  it('el TOTAL suma las dos fuentes sobre la UNIÓN de días', () => {
    const r = compararParidad(XLS, XLS, PM)
    const t = (clave: string) => r.total.comparaciones.find(c => c.clave === clave)!
    expect(t('ventaNeta').xls).toBe(300000)
    expect(t('pax').xls).toBe(60)
    expect(t('comidas').xls).toBe(210000)
    expect(t('bebidas').xls).toBe(90000)
  })

  it('un día que está en UNA sola fuente se marca y se cuenta aparte', () => {
    const soloEnXls: DiasMap = { ...XLS, '2026-09-06': dia({ total: 50000, pax: 10 }) }
    const r = compararParidad(soloEnXls, XLS, PM)
    expect(r.resumen).toMatchObject({ dias: 3, flag: 1, soloXls: 1, soloPos: 0 })
    const fila = r.filas.find(f => f.fecha === '2026-09-06')!
    expect(fila).toMatchObject({ enXls: true, enPos: false, flag: true })
    // Y su plata SÍ entra en el total: si no, el total mentiría diciendo que cuadra.
    expect(r.total.comparaciones.find(c => c.clave === 'ventaNeta')).toMatchObject({
      xls: 350000, pos: 300000, diff: -50000,
    })
  })

  it('un día que solo tiene el PoS también se ve (el swap agregaría datos de la nada)', () => {
    const soloEnPos: DiasMap = { ...XLS, '2026-09-06': dia({ total: 50000, pax: 10 }) }
    const r = compararParidad(XLS, soloEnPos, PM)
    expect(r.resumen).toMatchObject({ soloXls: 0, soloPos: 1, flag: 1 })
  })

  it('la tolerancia usada viaja en el reporte, para poder mostrarla', () => {
    const tol: Tolerancia = { pct: 5, abs: 50000, absPax: 10 }
    const r = compararParidad(XLS, XLS, PM, tol)
    expect(r.tolerancia).toEqual(tol)
  })

  it('aflojar la tolerancia baja los flags; apretarla los sube', () => {
    const pos: DiasMap = { ...XLS, '2026-09-04': dia({ total: 103000, pax: 20, serv: 10000, com: 70000, beb: 30000 }) }
    expect(compararParidad(XLS, pos, PM, { pct: 1, abs: 1000, absPax: 2 }).resumen.flag).toBe(1)
    expect(compararParidad(XLS, pos, PM, { pct: 10, abs: 1000, absPax: 2 }).resumen.flag).toBe(0)
  })

  it('sin días en ninguna fuente: reporte vacío, no una división por cero', () => {
    const r = compararParidad({}, {}, PM)
    expect(r.filas).toEqual([])
    expect(r.resumen).toEqual({ dias: 0, ok: 0, flag: 0, soloXls: 0, soloPos: 0 })
    expect(r.total.comparaciones.every(c => c.xls === 0 && c.pos === 0 && !c.fuera)).toBe(true)
    expect(r.total.flag).toBe(false)
  })
})
