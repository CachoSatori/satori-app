// Ventas v2 · fase 2.1 — «Resumen»: los números contra Contabilidad para el MISMO período, la venta por
// persona D4, las bases y la lectura. Datos ficticios (logins y montos inventados).
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import { calcularPeriodo } from './periodos'
import {
  armarLectura, bajada, cambioPct, cifrasDelRango, compararCifras, csvResumen, avisoCalidad, alertaDeAyer,
} from './resumenV2'
import { juntarPartes, tramosDeLectura } from './resumenV2Datos'
import { armarDiasMap } from './ventasDiasDesdePos'
import { getContabilidadDays, totalesContabilidad } from './ventasUtils'

import { datos, l, t } from './resumenV2.fixture'

const { tickets, lineas } = datos('2026-09-01', 78)
const lectura = armarLectura(tickets, lineas)

/** Contabilidad, tal como la arma la pantalla vieja: DiasMap del PoS → getContabilidadDays → totalesContabilidad. */
function contabilidadDelMes(anio: number, mes: number) {
  const { dias } = armarDiasMap(tickets, lineas, { desde: '2026-09-01', hasta: '2026-11-17' },
    { uploadedAt: 'x', avisar: () => {} })
  const days = getContabilidadDays(anio, mes, dias, {})
  return { days, tot: totalesContabilidad(days) }
}

describe('Resumen = Contabilidad para el mismo período', () => {
  it('octubre 2026 (mes cerrado): cada día y la fila TOTAL dan lo mismo', () => {
    const p = calcularPeriodo({ tipo: 'mes', dia: '2026-10-10', ancla: '2026-11-18' })
    const c = cifrasDelRango(lectura, p)
    const conta = contabilidadDelMes(2026, 10)
    expect(c.dias).toEqual(conta.days)
    expect(c.totales).toEqual(conta.tot)
    expect(c.dias).toHaveLength(31)
    // TOTAL = suma de los días mostrados (#288): con céntimos, distinto de redondear el período una vez.
    expect(c.totales.ventaNeta).toBe(c.dias.reduce((s, d) => s + d.ventaNeta, 0))
  })

  it('mes a la fecha (18-nov → 1 al 17): igual a Contabilidad de noviembre, sin el día de hoy', () => {
    const p = calcularPeriodo({ tipo: 'mesALaFecha', ancla: '2026-11-18' })
    expect([p.desde, p.hasta]).toEqual(['2026-11-01', '2026-11-17'])
    const c = cifrasDelRango(lectura, p)
    const conta = contabilidadDelMes(2026, 11)
    expect(c.totales).toEqual(conta.tot)
    expect(c.dias.map(d => d.fecha)).not.toContain('2026-11-18')
  })

  it('las bases salen del mismo camino: la base A de mes a la fecha (1–17 oct) = Contabilidad de esos días', () => {
    const p = calcularPeriodo({ tipo: 'mesALaFecha', ancla: '2026-11-18' })
    const a = p.bases.anteriorEquivalente!
    expect([a.desde, a.hasta]).toEqual(['2026-10-01', '2026-10-17'])
    const c = cifrasDelRango(lectura, a)
    const oct = contabilidadDelMes(2026, 10).days.filter(d => d.fecha <= '2026-10-17')
    expect(c.totales).toEqual(totalesContabilidad(oct))
  })
})

describe('las cuatro cifras', () => {
  const p = calcularPeriodo({ tipo: 'mes', dia: '2026-10-10', ancla: '2026-11-18' })
  const c = cifrasDelRango(lectura, p)

  it('facturas y cuenta promedio por día CR de factura', () => {
    const oct = tickets.filter(x => x.fecha_registra.startsWith('2026-10'))
    expect(c.facturas).toBe(oct.length)
    expect(c.cuentaPromedio).toBeCloseTo(c.totales.ventaNeta / oct.length, 6)
  })

  it('venta por persona D4: sin mesas de dueños ni regalías totales, con estimadas', () => {
    expect(c.vpp.mesasDuenos).toBeGreaterThan(0)
    expect(c.vpp.regaliasTotales).toBeGreaterThan(0)
    expect(c.vpp.personasEstimadas).toBeGreaterThan(0)
    expect(c.vpp.valor).toBeCloseTo(c.vpp.netaSalon / (c.vpp.personasCargadas + c.vpp.personasEstimadas), 6)
    // No es Salón ÷ PAX de Contabilidad (esa cuenta incluye dueños, regalías y no estima).
    expect(c.vpp.valor).not.toBeCloseTo(c.totales.promPax, 0)
  })

  it('cambio: sin base o base en 0 → «sin comparación» (null), nunca 0 ni −100 %', () => {
    expect(cambioPct(100, 0)).toBeNull()
    expect(cambioPct(100, null)).toBeNull()
    expect(cambioPct(110, 100)).toBeCloseTo(10)
    expect(compararCifras(c, null).every(x => x.cambio === null)).toBe(true)
  })

  it('muestra chica: venta por persona con < 100 personas va en gris', () => {
    const ayer = cifrasDelRango(lectura, { desde: '2026-10-05', hasta: '2026-10-05' })
    const cmp = compararCifras(ayer, cifrasDelRango(lectura, { desde: '2026-09-28', hasta: '2026-09-28' }))
    expect(cmp.find(x => x.id === 'ventaPorPersona')!.muestraChica).toBe(true)
    expect(compararCifras(c, c).find(x => x.id === 'ventaPorPersona')!.muestraChica).toBe(false)
  })
})

describe('bajada, calidad, alerta y CSV', () => {
  const p = calcularPeriodo({ tipo: 'mesALaFecha', ancla: '2026-11-18' })
  const cp = cifrasDelRango(lectura, p)
  const ca = cifrasDelRango(lectura, p.bases.anteriorEquivalente!)

  it('la bajada nombra la base y no inventa la que no hay (−364 cae antes de los datos)', () => {
    const txt = bajada(cp, { id: 'anteriorEquivalente', cifras: ca }, { id: 'anioMismoDiaSemana', cifras: null })
    expect(txt).toMatch(/^Vas \d+ % (arriba|abajo) del período anterior\./)
    expect(txt).not.toMatch(/año pasado/)
    expect(bajada(cp, { id: 'anteriorEquivalente', cifras: null }, { id: 'anioMismoDiaSemana', cifras: null }))
      .toMatch(/Sin comparación/)
  })

  it('aviso de calidad: % de mesas de salón sin pax sobre el umbral', () => {
    const a = avisoCalidad(cp)
    expect(a.pctSinPax).toBeGreaterThan(5)
    expect(a.supera).toBe(true)
  })

  it('alerta de ayer: por salonero, con las mesas cargadas desde la caja aparte', () => {
    const al = alertaDeAyer(lectura, p)
    const ayer = tickets.filter(x => x.fecha_registra.startsWith('2026-11-17') && x.canal === 'salon' && !x.id.endsWith('-D') && !x.id.endsWith('-R'))
    expect(al.total.facturasSalon).toBe(ayer.length)
    expect(al.sinSalonero.facturasSalon).toBe(ayer.filter(x => !x.salonero_login).length)
  })

  it('el CSV trae las TRES bases (también «mismas fechas», que en pantalla está a un clic)', () => {
    const bases = {
      anteriorEquivalente: ca,
      anioMismasFechas: null,
      anioMismoDiaSemana: null,
    }
    const csv = csvResumen(p, cp, bases)
    const hdr = csv.split('\n')[0]
    expect(hdr).toContain('período anterior: 2026-10-01 a 2026-10-17')
    expect(hdr).toContain('año pasado (mismas fechas)')
    expect(hdr).toContain('año pasado (mismo día de semana)')
    expect(csv).toContain(`"Venta neta","${cp.totales.ventaNeta}","${ca.totales.ventaNeta}"`)
    expect(csv).toContain('sin comparación')
  })
})

describe('la lectura', () => {
  it('tramos: período + bases + ayer, estirados 4 semanas para el estimador y juntados', () => {
    const p = calcularPeriodo({ tipo: 'mesALaFecha', ancla: '2026-11-18' })
    const tr = tramosDeLectura(p)
    // Base A (oct) y el período (nov) se tocan: un solo tramo; las dos de 2025 se juntan en otro.
    expect(tr).toHaveLength(2)
    expect(tr[1].hasta).toBe('2026-11-17')
    expect(tr[0].hasta).toBe('2025-11-18')
    expect(tr.every(r => r.desde >= '2024-01-05')).toBe(true)
  })

  it('una factura que viene en dos tramos cuenta una vez, con sus líneas una vez', () => {
    const a = t({ id: 'x1' })
    const [ts, ls] = juntarPartes([
      { tickets: [a], lineas: [l('x1', 1000)] },
      { tickets: [a, t({ id: 'x2' })], lineas: [l('x1', 1000), l('x2', 500)] },
    ])
    expect(ts.map(x => x.id)).toEqual(['x1', 'x2'])
    expect(ls.map(x => x.ticket_id)).toEqual(['x1', 'x2'])
  })
})
