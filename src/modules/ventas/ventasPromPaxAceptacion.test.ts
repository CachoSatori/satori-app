// ── Aceptación §9 (SPEC v2.3) con datos reales de prod ─────────────────────────────────────
//
// Corre solo con `PROMPAX_ACEPTACION_FILE` = las filas del RPC 078 de ene–oct 2026 (bajadas con
// `scripts/contrato-prompax/descargar.sh <PROD> <dir> 2026-01-01 2026-10-31`; en prod el cuerpo del
// RPC corre como SELECT de solo lectura). Sin la variable se salta.
//
// Los números son los del §9 v2.3: turno por la HORA de la factura, madrugada = noche del mismo
// día (opción B). Se comparan redondeados a colones, como se muestran.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { periodoRango } from './periodosPromPax'
import { resolverPersonas } from './promPaxSaloneros'
import {
  agrupar, analizar, filtrar, tablaCorte, tablaSaloneros, totales, type FilaAgregada, type FiltroTurno,
} from './ventasPromPaxExplicado'

const ARCHIVO = process.env.PROMPAX_ACEPTACION_FILE

describe.skipIf(!ARCHIVO)('§9 v2.3 — números reales de prod', () => {
  const filas: FilaAgregada[] = ARCHIVO
    ? (JSON.parse(readFileSync(ARCHIVO, 'utf8')) as FilaAgregada[]).map(f => ({
        ...f, neta: Number(f.neta), neta_sin_pax: Number(f.neta_sin_pax),
      }))
    : []
  const resolver = resolverPersonas()
  const pp = (desde: string, hasta: string, turno: FiltroTurno = 'ambos') => {
    const t = totales(filtrar(filas, periodoRango(desde, hasta), turno))
    return { pp: Math.round(t.promPax!), pax: t.paxSalon, netaSalon: t.salonN + t.salonN0 }
  }

  it('oct 1–29: total, mañana y noche; neta de salón = la de Ventas', () => {
    expect(pp('2026-10-01', '2026-10-29')).toEqual({ pp: 16491, pax: 805, netaSalon: expect.closeTo(13_274_984.71, 2) })
    expect(pp('2026-10-01', '2026-10-29', 'mañana')).toMatchObject({ pp: 13299, pax: 177 })
    expect(pp('2026-10-01', '2026-10-29', 'noche')).toMatchObject({ pp: 17390, pax: 628 })
  })

  it('ene-2026', () => {
    expect(pp('2026-01-01', '2026-01-31')).toMatchObject({ pp: 16237, pax: 2473 })
    expect(pp('2026-01-01', '2026-01-31', 'mañana')).toMatchObject({ pp: 10541, pax: 436 })
    expect(pp('2026-01-01', '2026-01-31', 'noche')).toMatchObject({ pp: 17456, pax: 2037 })
  })

  it('noche oct por salonero y por día', () => {
    const oct = periodoRango('2026-10-01', '2026-10-29')
    const noche = filtrar(filas, oct, 'noche')
    const s = new Map(tablaSaloneros(noche, resolver).map(x => [x.clave, x]))
    expect([Math.round(s.get('026')!.promPax!), s.get('026')!.pax]).toEqual([17934, 271])
    expect([Math.round(s.get('028')!.promPax!), s.get('028')!.pax]).toEqual([18105, 162])
    expect([Math.round(s.get('032')!.promPax!), s.get('032')!.pax]).toEqual([16954, 115])
    expect([Math.round(s.get('caja')!.promPax!), s.get('caja')!.pax]).toEqual([15080, 66])
    const dias = new Map(tablaCorte([], agrupar(noche, 'dia', oct), null).map(x => [x.etiqueta, Math.round(x.promPax!)]))
    expect([dias.get('Mar'), dias.get('Mié'), dias.get('Sáb')]).toEqual([19421, 18547, 15529])
  })

  it('prom/pax por turno en los rangos libres', () => {
    const r = (d: string, h: string, t: FiltroTurno) => pp(d, h, t).pp
    expect([r('2026-01-01', '2026-04-30', 'mañana'), r('2026-05-01', '2026-05-31', 'mañana'),
            r('2026-06-01', '2026-08-31', 'mañana'), r('2026-09-01', '2026-10-29', 'mañana')])
      .toEqual([11195, 13079, 11992, 13242])
    expect([r('2026-01-01', '2026-04-30', 'noche'), r('2026-05-01', '2026-05-31', 'noche'),
            r('2026-06-01', '2026-08-31', 'noche'), r('2026-09-01', '2026-10-29', 'noche')])
      .toEqual([17083, 16658, 16407, 16703])
  })

  it('«vs promedio del turno»', () => {
    const vs = (d: string, h: string, clave: string, turno: 'mañana' | 'noche') => {
      const x = tablaSaloneros(filtrar(filas, periodoRango(d, h)), resolver).find(f => f.clave === clave && f.turno === turno)!
      return [Math.round(x.vsTurno! * 1000) / 10, x.pax]
    }
    expect(vs('2026-01-01', '2026-04-30', '026', 'mañana')).toEqual([3.4, 747])
    expect(vs('2026-01-01', '2026-04-30', '026', 'noche')).toEqual([-2.4, 688])
    expect(vs('2026-05-01', '2026-05-31', '028', 'noche')).toEqual([11.1, 324])
    expect(vs('2026-09-01', '2026-10-29', 'caja', 'noche')).toEqual([-19.5, 152])
  })

  it('cuadres §6.1 y §6.2 exactos con un grupo real que SALE (GUILLE: ago → sep)', () => {
    const a = analizar(filas, periodoRango('2026-09-01', '2026-09-30'), periodoRango('2026-08-01', '2026-08-31'), 'ambos', resolver)
    const guille = a.cortes.salonero.d!.grupos.find(g => g.clave === '027')!
    expect(guille.estado).toBe('sale')
    for (const c of ['turno', 'dia', 'salonero', 'semana', 'saloneroTurno'] as const) {
      const d = a.cortes[c].d!
      expect(Math.abs(d.residuo)).toBeLessThan(1e-9 * Math.abs(d.P_n))
    }
    const dSalon = a.n.porLinea.salon - a.v.porLinea.salon
    expect(Math.abs(a.cuadre.salon!.volumen + a.cuadre.salon!.gasto - dSalon)).toBeLessThan(1e-6)
    expect(Math.abs(Object.values(a.cuadre.porLinea).reduce((s, x) => s + x, 0) - a.cuadre.delta)).toBeLessThan(1e-6)
  })
})
