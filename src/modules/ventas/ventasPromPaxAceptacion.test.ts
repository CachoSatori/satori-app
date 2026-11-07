// ── Aceptación §9 (SPEC v2.3) con datos reales ─────────────────────────────────────────────
//
// El repo es público: los números reales de aceptación NO están acá. Viven en un archivo privado
// (fuera del repo) que se pasa por variable de entorno:
//   · PROMPAX_ACEPTACION_FILE     = filas del RPC 080 (bajadas con scripts/contrato-prompax/descargar.sh;
//                                   en prod el cuerpo del RPC corre como SELECT de solo lectura)
//   · PROMPAX_ACEPTACION_ESPERADO = { checks: [...] } con los valores esperados (formato abajo)
// Sin las dos variables el test se salta.
//
// Turno por la HORA de la factura y madrugada = noche del mismo día (opción B). Se compara
// redondeado a colones, como se muestra.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { periodoRango } from './periodosPromPax'
import { resolverPersonas } from './promPaxSaloneros'
import {
  agrupar, analizar, filtrar, tablaCorte, tablaSaloneros, totales, type FilaAgregada, type FiltroTurno,
} from './ventasPromPaxExplicado'

/** Un valor esperado. `clave` = id de persona de `personasNdf.ts` (el código canónico) o «caja». */
export type CheckAceptacion =
  | { tipo: 'pp'; desde: string; hasta: string; turno: FiltroTurno; pp: number; pax?: number }
  | { tipo: 'netaSalon'; desde: string; hasta: string; valor: number }
  | { tipo: 'salonero'; desde: string; hasta: string; turno: 'mañana' | 'noche'; clave: string; pp: number; pax: number }
  | { tipo: 'dia'; desde: string; hasta: string; turno: FiltroTurno; dia: string; pp: number }
  | { tipo: 'vsTurno'; desde: string; hasta: string; turno: 'mañana' | 'noche'; clave: string; pct: number; pax: number }
  | { tipo: 'sale'; comp: { desde: string; hasta: string }; actual: { desde: string; hasta: string }; clave: string }

const FILAS = process.env.PROMPAX_ACEPTACION_FILE
const ESPERADO = process.env.PROMPAX_ACEPTACION_ESPERADO

export function leerFilas(archivo: string): FilaAgregada[] {
  return (JSON.parse(readFileSync(archivo, 'utf8')) as FilaAgregada[]).map(f => ({
    ...f, neta: Number(f.neta), neta_sin_pax: Number(f.neta_sin_pax),
  }))
}

describe.skipIf(!FILAS || !ESPERADO)('§9 v2.3 — números reales (archivo privado)', () => {
  const filas = FILAS ? leerFilas(FILAS) : []
  const checks: CheckAceptacion[] = ESPERADO ? JSON.parse(readFileSync(ESPERADO, 'utf8')).checks : []
  const resolver = resolverPersonas()

  it('trae checks de todos los tipos', () => {
    for (const t of ['pp', 'netaSalon', 'salonero', 'dia', 'vsTurno', 'sale']) {
      expect(checks.some(c => c.tipo === t), t).toBe(true)
    }
  })

  it('cada check da el valor esperado', () => {
    for (const c of checks) {
      const id = JSON.stringify(c)
      if (c.tipo === 'pp') {
        const t = totales(filtrar(filas, periodoRango(c.desde, c.hasta), c.turno))
        expect(Math.round(t.promPax!), id).toBe(c.pp)
        if (c.pax !== undefined) expect(t.paxSalon, id).toBe(c.pax)
      } else if (c.tipo === 'netaSalon') {
        const t = totales(filtrar(filas, periodoRango(c.desde, c.hasta)))
        expect(t.salonN + t.salonN0, id).toBeCloseTo(c.valor, 2)
      } else if (c.tipo === 'salonero') {
        const s = tablaSaloneros(filtrar(filas, periodoRango(c.desde, c.hasta), c.turno), resolver)
          .find(x => x.clave === c.clave && x.turno === c.turno)!
        expect([Math.round(s.promPax!), s.pax], id).toEqual([c.pp, c.pax])
      } else if (c.tipo === 'dia') {
        const r = periodoRango(c.desde, c.hasta)
        const fila = tablaCorte([], agrupar(filtrar(filas, r, c.turno), 'dia', r), null).find(x => x.etiqueta === c.dia)!
        expect(Math.round(fila.promPax!), id).toBe(c.pp)
      } else if (c.tipo === 'vsTurno') {
        const s = tablaSaloneros(filtrar(filas, periodoRango(c.desde, c.hasta)), resolver)
          .find(x => x.clave === c.clave && x.turno === c.turno)!
        expect([Math.round(s.vsTurno! * 1000) / 10, s.pax], id).toEqual([c.pct, c.pax])
      } else {
        // Cuadres §6.1 y §6.2 exactos con un grupo real que SALE.
        const a = analizar(filas, periodoRango(c.actual.desde, c.actual.hasta), periodoRango(c.comp.desde, c.comp.hasta), 'ambos', resolver)
        expect(a.cortes.salonero.d!.grupos.find(g => g.clave === c.clave)!.estado, id).toBe('sale')
        for (const corte of ['turno', 'dia', 'salonero', 'semana', 'saloneroTurno'] as const) {
          const d = a.cortes[corte].d!
          expect(Math.abs(d.residuo), `${id} ${corte}`).toBeLessThan(1e-9 * Math.abs(d.P_n))
        }
        const dSalon = a.n.porLinea.salon - a.v.porLinea.salon
        expect(Math.abs(a.cuadre.salon!.volumen + a.cuadre.salon!.gasto - dSalon)).toBeLessThan(1e-6)
        expect(Math.abs(Object.values(a.cuadre.porLinea).reduce((s, x) => s + x, 0) - a.cuadre.delta)).toBeLessThan(1e-6)
      }
    }
  })
})
