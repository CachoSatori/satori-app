// Ventas v2 · fase 2.3 — «Tiempos»: cada cifra contra Contabilidad para el MISMO período (día de semana,
// turno, quincenas y calendario), la venta por persona D4 repartida sin perder nada, y los rótulos de las
// bases. Datos ficticios (logins y montos inventados), con céntimos: donde muerde el redondeo por día (#288).
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import type { FilaPromPaxRpc } from '../../shared/api/posNdf'
import { diaCRDeFactura, franjaDeHora, horaCRDeFactura, ventaPorPersona } from './indicadores'
import { calcularPeriodo, diaSemana, type Rango } from './periodos'
import { armarLectura, cifrasDelRango } from './resumenV2'
import { datos, l as linea, t as ticket } from './resumenV2.fixture'
import {
  calendario, filasQuincenas, mapaHoras, nombreQuincena, ordenHora, porDiaSemana, porTurno,
  rangosDeTiempos, ultimasQuincenas, vppPorDiaSemana,
} from './tiemposV2'
import { armarDiasMap } from './ventasDiasDesdePos'
import { getContabilidadDays, totalesContabilidad } from './ventasUtils'

const { tickets, lineas } = datos('2026-09-01', 78)
const lectura = armarLectura(tickets, lineas)
const ANCLA = '2026-11-18' // N = 17-nov, el último día del fixture

/** Contabilidad tal como la arma la pantalla vieja, recortada a un rango. */
function contabilidad(r: Rango) {
  const { dias } = armarDiasMap(tickets, lineas, { desde: '2026-09-01', hasta: '2026-11-17' }, { uploadedAt: 'x', avisar: () => {} })
  const days = [9, 10, 11].flatMap(m => getContabilidadDays(2026, m, dias, {}))
    .filter(d => d.fecha >= r.desde && d.fecha <= r.hasta)
  return { days, tot: totalesContabilidad(days) }
}

/** Lo que devolvería la 080 para el fixture: neta cruda por (día CR, franja, salonero, canal). */
function filas080(): FilaPromPaxRpc[] {
  const m = new Map<string, FilaPromPaxRpc>()
  for (const f of lectura.facturas) {
    const dia = diaCRDeFactura(f.fecha_registra)
    const franja = franjaDeHora(horaCRDeFactura(f.fecha_registra))
    const k = `${dia}|${franja}|${f.salonero_login}|${f.canal}`
    const e = m.get(k) ?? { dia, franja, salonero_login: f.salonero_login, canal: f.canal ?? 'otro', tickets: 0, pax: 0, neta: 0, neta_sin_pax: 0, tickets_sin_pax: 0 }
    e.tickets += 1
    e.neta += f.neta
    m.set(k, e)
  }
  return [...m.values()]
}

const octubre = calcularPeriodo({ tipo: 'mes', dia: '2026-10-10', ancla: ANCLA })

describe('Día de semana = Contabilidad', () => {
  it('octubre: Σ de los días de semana = la venta del mes de Contabilidad, y cada día de semana = Σ de sus días', () => {
    const conta = contabilidad(octubre)
    const filas = porDiaSemana(cifrasDelRango(lectura, octubre).dias)
    expect(filas.map(f => f.nombre)).toEqual(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'])
    expect(filas.reduce((s, f) => s + f.neta, 0)).toBe(conta.tot.ventaNeta)
    for (const f of filas) {
      const susDias = conta.days.filter(d => diaSemana(d.fecha) === f.dow)
      expect(f.neta).toBe(susDias.reduce((s, d) => s + d.ventaNeta, 0))
      expect(f.personas).toBe(susDias.reduce((s, d) => s + d.pax, 0))
      expect(f.diasAbiertos).toBe(susDias.filter(d => d.ventaNeta > 0).length)
    }
    // Octubre 2026 arranca jueves: 5 jueves, viernes y sábados; 4 del resto.
    expect(filas.map(f => f.diasAbiertos)).toEqual([4, 4, 4, 5, 5, 5, 4])
  })

  it('el índice: 100 = día promedio; el promedio de los índices ponderado por días abiertos da 100', () => {
    const c = cifrasDelRango(lectura, octubre)
    const filas = porDiaSemana(c.dias)
    const pond = filas.reduce((s, f) => s + (f.indice ?? 0) * f.diasAbiertos, 0) / c.diasAbiertos
    expect(pond).toBeCloseTo(100, 9)
    const jueves = filas[3]
    expect(jueves.indice).toBeCloseTo((jueves.neta / 5) / (c.totales.ventaNeta / c.diasAbiertos) * 100, 9)
  })

  it('sin días abiertos: índice y promedio en null (nunca 0)', () => {
    const filas = porDiaSemana([])
    expect(filas.every(f => f.indice === null && f.promedio === null && f.neta === 0)).toBe(true)
  })

  it('venta por persona D4 por día de semana: una mesa de las 00:30 de la caja de la noche es del día anterior', () => {
    // Viernes 2-oct-2026: la caja de la noche (222) abre el viernes y cierra el sábado 01:30.
    const tk = [
      ticket({ id: 'A', fecha_registra: '2026-10-02T19:00:00-06:00', fecha_cierra: '2026-10-03T01:30:00-06:00', cajero_login: '222' }),
      ticket({ id: 'B', fecha_registra: '2026-10-03T00:30:00-06:00', fecha_cierra: '2026-10-03T01:30:00-06:00', cajero_login: '222' }),
    ]
    const lt = armarLectura(tk, [linea('A', 10_000), linea('B', 8_000)])
    const vpps = vppPorDiaSemana(lt, { desde: '2026-10-01', hasta: '2026-10-04' })
    expect(vpps[4].facturasSalon).toBe(2) // viernes
    expect(vpps[5].facturasSalon).toBe(0) // sábado
    expect(vpps[4].netaSalon).toBe(18_000)
  })

  it('venta por persona D4 por día de semana: reparte la del período sin perder ni duplicar', () => {
    const vpps = vppPorDiaSemana(lectura, octubre)
    const total = ventaPorPersona(lectura.facturas, octubre)
    expect(vpps.reduce((s, v) => s + v.netaSalon, 0)).toBeCloseTo(total.netaSalon, 6)
    expect(vpps.reduce((s, v) => s + v.personasCargadas, 0)).toBe(total.personasCargadas)
    expect(vpps.reduce((s, v) => s + v.personasEstimadas, 0)).toBe(total.personasEstimadas)
    expect(vpps.reduce((s, v) => s + v.facturasSalon, 0)).toBe(total.facturasSalon)
  })
})

describe('Turno por hora: cuadra al colón con Contabilidad', () => {
  const vpp = {
    'mañana': ventaPorPersona(lectura.facturas, octubre, { turno: 'mañana' }),
    noche: ventaPorPersona(lectura.facturas, octubre, { turno: 'noche' }),
  }

  it('mediodía + noche = la venta neta del período (Contabilidad), sin descuadres', () => {
    const c = cifrasDelRango(lectura, octubre)
    const t = porTurno(c.dias, filas080(), vpp)
    expect(t.descuadres).toEqual([])
    expect(t.filas[0].neta + t.filas[1].neta).toBe(contabilidad(octubre).tot.ventaNeta)
    expect(t.filas[0].pct + t.filas[1].pct).toBeCloseTo(100, 9)
    // El mediodía es la franja 06–16 por la hora de la factura (no la caja).
    const mediodiaCrudo = filas080().filter(f => f.franja === 'mañana' && f.dia >= octubre.desde && f.dia <= octubre.hasta)
      .reduce((s, f) => s + f.neta, 0)
    expect(Math.abs(t.filas[0].neta - mediodiaCrudo)).toBeLessThanOrEqual(31) // ≤ ₡1 de redondeo por día
    expect(t.filas[0].neta).toBeGreaterThan(0)
  })

  it('si la 080 no trae un día, lo avisa como descuadre (no lo tapa)', () => {
    const c = cifrasDelRango(lectura, octubre)
    const sin = filas080().filter(f => f.dia !== '2026-10-07')
    expect(porTurno(c.dias, sin, vpp).descuadres).toEqual(['2026-10-07'])
  })

  it('la noche absorbe el redondeo del día: mediodía + noche = Contabilidad aunque la 080 cruda redondee distinto', () => {
    const dia = { fecha: '2026-10-01', ventaBruta: 0, ventaNeta: 1001, iva: 0, serv: 0, salon: 1001, delivery: 0, pax: 0, promPax: 0 }
    const f = (franja: FilaPromPaxRpc['franja'], neta: number): FilaPromPaxRpc =>
      ({ dia: '2026-10-01', franja, salonero_login: null, canal: 'salon', tickets: 1, pax: 0, neta, neta_sin_pax: 0, tickets_sin_pax: 0 })
    const t = porTurno([dia], [f('mañana', 300.2), f('noche', 700.2)], vpp)
    expect(t.descuadres).toEqual([])
    expect(t.filas.map(x => x.neta)).toEqual([300, 701])
  })

  it('la madrugada (00–05) va a la noche', () => {
    const dia = { fecha: '2026-10-01', ventaBruta: 0, ventaNeta: 1000, iva: 0, serv: 0, salon: 1000, delivery: 0, pax: 0, promPax: 0 }
    const f = (franja: FilaPromPaxRpc['franja'], neta: number): FilaPromPaxRpc =>
      ({ dia: '2026-10-01', franja, salonero_login: null, canal: 'salon', tickets: 1, pax: 0, neta, neta_sin_pax: 0, tickets_sin_pax: 0 })
    const t = porTurno([dia], [f('mañana', 300), f('noche', 500), f('madrugada', 200)], vpp)
    expect(t.filas.map(x => x.neta)).toEqual([300, 700])
  })
})

describe('Mapa por hora (solo salón)', () => {
  it('Σ celda × días abiertos = la neta de salón del período, por día CR de la factura', () => {
    const c = cifrasDelRango(lectura, octubre)
    const abiertos = porDiaSemana(c.dias).map(f => f.diasAbiertos)
    const m = mapaHoras(lectura.facturas, octubre, abiertos)
    const salon = lectura.facturas.filter(f => f.canal === 'salon')
      .filter(f => { const d = diaCRDeFactura(f.fecha_registra); return d >= octubre.desde && d <= octubre.hasta })
      .reduce((s, f) => s + f.neta, 0)
    expect(m.totalSalon).toBeCloseTo(salon, 6)
    const reconstruido = m.celdas.reduce((s, fila, dow) => s + fila.reduce((a, v) => a + v * abiertos[dow], 0), 0)
    expect(reconstruido).toBeCloseTo(salon, 6)
    // Sin delivery: el mapa es menos que la venta total.
    expect(m.totalSalon).toBeLessThan(c.totales.ventaNeta)
    expect(m.horas).toEqual([...m.horas].sort((a, b) => ordenHora(a) - ordenHora(b)))
  })

  it('el día del restaurante arranca a las 06: la madrugada va al final', () => {
    expect([1, 23, 12, 6, 0].sort((a, b) => ordenHora(a) - ordenHora(b))).toEqual([6, 12, 23, 0, 1])
  })
})

describe('Quincenas', () => {
  const p = calcularPeriodo({ tipo: 'mesALaFecha', ancla: ANCLA })
  const qs = ultimasQuincenas(p)

  it('12 quincenas seguidas, la más nueva primero, la primera es la de ayer y va «a la fecha»', () => {
    expect(qs).toHaveLength(12)
    expect(qs[0]).toMatchObject({ desde: '2026-11-16', hasta: '2026-11-17', enCurso: true })
    expect(qs[1]).toMatchObject({ desde: '2026-11-01', hasta: '2026-11-15', enCurso: false })
    expect(qs[11].desde).toBe('2026-06-01')
    for (let i = 1; i < qs.length; i++) {
      const fin = new Date(`${qs[i].natural.hasta}T12:00:00Z`)
      fin.setUTCDate(fin.getUTCDate() + 1)
      expect(fin.toISOString().slice(0, 10)).toBe(qs[i - 1].natural.desde)
    }
    expect(nombreQuincena(qs[0])).toBe('2.ª quincena de noviembre')
    expect(nombreQuincena(qs[1])).toBe('1.ª quincena de noviembre')
  })

  it('cada quincena = Contabilidad para esas fechas (venta, personas, días abiertos)', () => {
    const filas = filasQuincenas(lectura, qs, 'anteriorEquivalente', 'anioMismoDiaSemana')
    for (const f of filas) {
      const conta = contabilidad(f.q)
      expect(f.cifras.totales.ventaNeta).toBe(conta.tot.ventaNeta)
      expect(f.cifras.totales.pax).toBe(conta.tot.pax)
      expect(f.cifras.diasAbiertos).toBe(conta.days.filter(d => d.ventaNeta > 0).length)
    }
    expect(filas[1].cifras.totales.ventaNeta).toBeGreaterThan(0)
  })

  it('base A = la misma quincena del mes anterior, recortada a los mismos días si va a la fecha', () => {
    const filas = filasQuincenas(lectura, qs, 'anteriorEquivalente', 'anioMismoDiaSemana')
    expect(filas[0].q.bases.anteriorEquivalente).toMatchObject({ desde: '2026-10-16', hasta: '2026-10-17' })
    expect(filas[1].q.bases.anteriorEquivalente).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-15' })
    expect(filas[1].A!.totales.ventaNeta).toBe(contabilidad({ desde: '2026-10-01', hasta: '2026-10-15' }).tot.ventaNeta)
    expect(filas[1].cambioA).toBeCloseTo((filas[1].cifras.totales.ventaNeta / filas[1].A!.totales.ventaNeta - 1) * 100, 9)
    // Base sin ventas (año anterior, el fixture no tiene 2025): «sin comparación», nunca −100 %.
    expect(filas[1].cambioB).toBeNull()
  })

  it('la 2.ª quincena de febrero tiene 13 o 14 días', () => {
    const feb = ultimasQuincenas(calcularPeriodo({ tipo: 'mes', dia: '2028-02-10', ancla: '2028-03-20' }), 1)[0]
    expect(feb).toMatchObject({ desde: '2028-02-16', hasta: '2028-02-29', dias: 14 })
  })

  it('los rangos a leer incluyen el período, las quincenas y las bases de cada una', () => {
    const r = rangosDeTiempos(p, 'anteriorEquivalente', 'anioMismoDiaSemana', qs)
    expect(r).toContainEqual({ desde: '2026-11-01', hasta: '2026-11-17' })
    expect(r).toContainEqual({ desde: '2026-06-01', hasta: '2026-06-15' })
    expect(r).toContainEqual({ desde: '2026-05-01', hasta: '2026-05-15' })
  })
})

describe('Calendario', () => {
  it('cada celda es el día de Contabilidad; mejor y peor día entre los abiertos', () => {
    const c = cifrasDelRango(lectura, octubre)
    const cal = calendario(c.dias, octubre)
    expect(cal.meses.map(m => m.mes)).toEqual(['2026-10'])
    const celdas = cal.meses[0].semanas.flat().filter(Boolean)
    expect(celdas).toHaveLength(31)
    expect(cal.meses[0].semanas[0].slice(0, 3)).toEqual([null, null, null]) // 1-oct-2026 = jueves
    const conta = contabilidad(octubre).days
    const max = Math.max(...conta.map(d => d.ventaNeta)), min = Math.min(...conta.filter(d => d.ventaNeta > 0).map(d => d.ventaNeta))
    expect(cal.mejor!.ventaNeta).toBe(max)
    expect(cal.peor!.ventaNeta).toBe(min)
  })
})
