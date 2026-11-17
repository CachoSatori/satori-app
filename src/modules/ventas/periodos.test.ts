// Motor de períodos de Ventas v2 (SPEC ventas v2 §3.5). Fechas como strings `YYYY-MM-DD`;
// el único reloj que se fija es el de la prueba de «hoy CR» (de noche: 23:30 CR = 05:30 UTC).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BASES, BASES_POR_DEFECTO, calcularPeriodo, periodoAnterior, periodoSiguiente, rotuloRango,
  type Base, type PeriodoV2, type TipoPeriodoV2,
} from './periodos'
import { diaSemana, largoEnDias, sumarDias } from './periodosPromPax'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre']
const pad = (n: number) => String(n).padStart(2, '0')
const f = (a: number, mes: string, d: number) => `${a}-${pad(MESES.indexOf(mes) + 1)}-${pad(Number(d))}`

/** Lee el rótulo de vuelta a fechas (independiente de la implementación). */
function leerRotulo(r: string, anioRef: number): { desde: string; hasta: string; dias: number } {
  const n = /\((\d+) días?\)$/.exec(r)
  if (!n) throw new Error(`Rótulo sin días: ${r}`)
  const dias = Number(n[1])
  const s = r.replace(/ \(\d+ días?\)$/, '')
  let m: RegExpExecArray | null
  if ((m = /^(\d+) de (\p{L}+) de (\d{4}) al (\d+) de (\p{L}+) de (\d{4})$/u.exec(s)))
    return { desde: f(+m[3], m[2], +m[1]), hasta: f(+m[6], m[5], +m[4]), dias }
  if ((m = /^(\d+) de (\p{L}+) al (\d+) de (\p{L}+)(?: de (\d{4}))?$/u.exec(s))) {
    const a = m[5] ? +m[5] : anioRef
    return { desde: f(a, m[2], +m[1]), hasta: f(a, m[4], +m[3]), dias }
  }
  if ((m = /^(\d+) al (\d+) de (\p{L}+)(?: de (\d{4}))?$/u.exec(s))) {
    const a = m[4] ? +m[4] : anioRef
    return { desde: f(a, m[3], +m[1]), hasta: f(a, m[3], +m[2]), dias }
  }
  if ((m = /^(\d+) de (\p{L}+)(?: de (\d{4}))?$/u.exec(s))) {
    const a = m[3] ? +m[3] : anioRef
    return { desde: f(a, m[2], +m[1]), hasta: f(a, m[2], +m[1]), dias }
  }
  throw new Error(`Rótulo ilegible: ${r}`)
}

function todosLosDias(desde: string, hasta: string): string[] {
  const out: string[] = []
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) out.push(d)
  return out
}

const TIPOS: TipoPeriodoV2[] = ['hoy', 'ayer', 'semana', 'quincena', 'mesALaFecha', 'mes', 'anioALaFecha', 'temporada']

function chequearRotulo(rango: { desde: string; hasta: string }, rotulo: string, anioRef: number, ctx: string) {
  const l = leerRotulo(rotulo, anioRef)
  expect(l, ctx).toEqual({ desde: rango.desde, hasta: rango.hasta, dias: largoEnDias(rango) })
}

/** Las invariantes de §3.5 para un período y sus bases. Devuelve un texto si algo falla (para juntar todo). */
function invariantes(p: PeriodoV2, ctx: string): string[] {
  const err: string[] = []
  const anioRef = Number(p.ancla.slice(0, 4))
  if (p.desde > p.hasta) err.push(`${ctx}: período al revés`)
  if (p.tipo !== 'hoy' && p.hasta > p.N) err.push(`${ctx}: pasa de N`)
  if (p.tipo === 'hoy' && (p.desde !== p.ancla || p.hasta !== p.ancla)) err.push(`${ctx}: hoy ≠ ancla`)
  if (p.dias !== largoEnDias(p)) err.push(`${ctx}: dias`)
  if (p.desde < p.natural.desde || p.hasta > p.natural.hasta) err.push(`${ctx}: fuera del contenedor`)
  if (p.enCurso !== (p.tipo === 'hoy' || p.natural.hasta > p.hasta)) err.push(`${ctx}: enCurso`)
  try { chequearRotulo(p, p.rotulo, anioRef, ctx) } catch (e) { err.push(String(e)) }
  for (const id of BASES) {
    const b: Base | null = p.bases[id]
    if (!b) {
      if (!p.motivos[id]) err.push(`${ctx}/${id}: null sin motivo`)
      continue
    }
    if (b.hasta >= p.desde) err.push(`${ctx}/${id}: la base pisa el período (${b.desde}..${b.hasta})`)
    if (b.desde > b.hasta) err.push(`${ctx}/${id}: base al revés`)
    if (b.desde < '2024-01-05') err.push(`${ctx}/${id}: base sin datos`)
    if (b.dias !== largoEnDias(b)) err.push(`${ctx}/${id}: dias de la base`)
    if (b.diferenciaDias !== b.dias - p.dias) err.push(`${ctx}/${id}: diferencia`)
    const nota = b.diferenciaDias === 0 ? null : `${b.dias} días contra ${p.dias}`
    if (b.notaLargo !== nota) err.push(`${ctx}/${id}: diferencia no declarada`)
    if (id === 'anioMismoDiaSemana' && diaSemana(b.desde) !== diaSemana(p.desde)) err.push(`${ctx}/${id}: día de semana`)
    try { chequearRotulo(b, b.rotulo, anioRef, `${ctx}/${id}`) } catch (e) { err.push(String(e)) }
  }
  return err
}

describe('periodos — barrido: cada día 2024–2030 × cada tipo de período (§3.5)', () => {
  const anclas = todosLosDias('2024-01-01', '2030-12-31')

  it('recorre los 2.557 días', () => expect(anclas).toHaveLength(2557))

  for (const tipo of TIPOS) {
    it(`${tipo}: bases sin pisar el período, mismo largo o diferencia declarada, rótulo = fechas`, () => {
      const errores: string[] = []
      for (const ancla of anclas) errores.push(...invariantes(calcularPeriodo({ tipo, ancla }), `${tipo}@${ancla}`))
      expect(errores.slice(0, 10)).toEqual([])
    })
  }

  it('rango: corto que termina hoy (se recorta a N) y largo de más de un año', () => {
    const errores: string[] = []
    for (const ancla of anclas) {
      const corto = calcularPeriodo({ tipo: 'rango', ancla, desde: sumarDias(ancla, -20), hasta: ancla })
      expect(corto.hasta).toBe(sumarDias(ancla, -1))
      expect(corto.enCurso).toBe(true)
      errores.push(...invariantes(corto, `rango-corto@${ancla}`))
      errores.push(...invariantes(
        calcularPeriodo({ tipo: 'rango', ancla, desde: sumarDias(ancla, -400), hasta: sumarDias(ancla, -1) }),
        `rango-largo@${ancla}`))
    }
    expect(errores.slice(0, 10)).toEqual([])
  })

  it('«a la fecha»: la base A tiene los mismos k días salvo que el mes anterior sea más corto', () => {
    for (const ancla of anclas) {
      const p = calcularPeriodo({ tipo: 'mesALaFecha', ancla })
      const a = p.bases.anteriorEquivalente
      if (!a) continue
      expect(a.desde.slice(8), ancla).toBe('01')
      if (p.enCurso) expect(a.dias, ancla).toBe(Math.min(p.dias, largoEnDias({ desde: a.desde, hasta: sumarDias(p.desde, -1) })))
    }
  })

  it('las flechas ‹ › recorren períodos contiguos sin huecos ni solapes', () => {
    const errores: string[] = []
    for (const ancla of ['2024-03-01', '2026-11-16', '2028-03-01', '2030-12-31']) {
      for (const tipo of ['semana', 'quincena', 'mes', 'anioALaFecha', 'temporada'] as const) {
        let p = calcularPeriodo({ tipo, ancla })
        for (let i = 0; i < 30; i++) {
          const ant = periodoAnterior(p)
          if (sumarDias(ant.hasta, 1) !== p.desde) errores.push(`${tipo}@${ancla} ‹ ${i}`)
          if (ant.enCurso) errores.push(`${tipo}@${ancla} ‹ ${i}: el anterior quedó en curso`)
          errores.push(...invariantes(ant, `${tipo}@${ancla} ‹ ${i}`))
          const vuelta = periodoSiguiente(ant)
          if (!vuelta || vuelta.desde !== p.desde || vuelta.hasta !== p.hasta) errores.push(`${tipo}@${ancla} › ${i}`)
          p = ant
        }
      }
    }
    expect(errores.slice(0, 10)).toEqual([])
  })
})

describe('periodos — caso real de la auditoría (ancla lunes 16-nov-2026)', () => {
  const ancla = '2026-11-16'

  it('mes a la fecha = 1–15 nov; A = 1–15 oct; B alineada = 2–16 nov 2025; mismas fechas = 1–15 nov 2025', () => {
    const p = calcularPeriodo({ tipo: 'mesALaFecha', ancla })
    expect([p.desde, p.hasta, p.dias, p.enCurso]).toEqual(['2026-11-01', '2026-11-15', 15, true])
    expect(p.rotulo).toBe('1 al 15 de noviembre (15 días)')
    const { anteriorEquivalente: a, anioMismoDiaSemana: b, anioMismasFechas: c } = p.bases
    expect([a?.desde, a?.hasta, a?.notaLargo]).toEqual(['2026-10-01', '2026-10-15', null])
    expect(a?.rotulo).toBe('1 al 15 de octubre (15 días)')
    expect([b?.desde, b?.hasta]).toEqual(['2025-11-02', '2025-11-16'])
    expect(b?.rotulo).toBe('2 al 16 de noviembre de 2025 (15 días)')
    expect([c?.desde, c?.hasta]).toEqual(['2025-11-01', '2025-11-15'])
  })

  it('la tabla §3.2 completa con N = domingo 15-nov', () => {
    const r = (tipo: TipoPeriodoV2) => {
      const p = calcularPeriodo({ tipo, ancla })
      return [p.desde, p.hasta, p.enCurso]
    }
    expect(r('hoy')).toEqual(['2026-11-16', '2026-11-16', true])
    expect(r('ayer')).toEqual(['2026-11-15', '2026-11-15', false])
    expect(r('semana')).toEqual(['2026-11-09', '2026-11-15', false])     // cerrada este lunes
    expect(r('quincena')).toEqual(['2026-11-01', '2026-11-15', false])   // cerrada hoy
    expect(r('mes')).toEqual(['2026-10-01', '2026-10-31', false])        // último mes cerrado
    expect(r('anioALaFecha')).toEqual(['2026-01-01', '2026-11-15', true])
    expect(r('temporada')).toEqual(['2026-09-01', '2026-11-15', true])
  })

  it('bases por defecto (D3=A): anterior equivalente + año anterior mismo día de semana', () => {
    expect(BASES_POR_DEFECTO).toEqual(['anteriorEquivalente', 'anioMismoDiaSemana'])
  })

  it('hoy: misma hora del mismo día de la semana pasada y de 52 semanas antes; sin «mismas fechas»', () => {
    const p = calcularPeriodo({ tipo: 'hoy', ancla })
    expect(p.bases.anteriorEquivalente).toMatchObject({ desde: '2026-11-09', aLaMismaHora: true })
    expect(p.bases.anioMismoDiaSemana).toMatchObject({ desde: '2025-11-17', aLaMismaHora: true })
    expect(p.bases.anioMismasFechas).toBeNull()
    expect(p.motivos.anioMismasFechas).toBeTruthy()
  })

  it('semana a la fecha (miércoles): lunes → martes, contra lunes → martes de la semana anterior', () => {
    const p = calcularPeriodo({ tipo: 'semana', ancla: '2026-11-18' })
    expect([p.desde, p.hasta, p.enCurso]).toEqual(['2026-11-16', '2026-11-17', true])
    expect([p.bases.anteriorEquivalente?.desde, p.bases.anteriorEquivalente?.hasta]).toEqual(['2026-11-09', '2026-11-10'])
    expect(p.bases.anioMismasFechas).toBeNull()
  })

  it('temporada: A = tramo anterior con aviso de lectura', () => {
    const p = calcularPeriodo({ tipo: 'temporada', ancla })
    expect(p.bases.anteriorEquivalente).toMatchObject({ desde: '2026-06-01', hasta: '2026-08-31' })
    expect(p.bases.anteriorEquivalente?.nota).toMatch(/dirección/)
    expect(p.bases.anioMismasFechas).toMatchObject({ desde: '2025-09-01', hasta: '2025-11-15' })
  })
})

describe('periodos — bordes (§3.3)', () => {
  it('mes anterior más corto: marzo cerrado contra febrero entero, «28 días contra 31»', () => {
    const p = calcularPeriodo({ tipo: 'mes', ancla: '2026-04-01' })
    expect([p.desde, p.hasta]).toEqual(['2026-03-01', '2026-03-31'])
    expect(p.bases.anteriorEquivalente).toMatchObject({ desde: '2026-02-01', hasta: '2026-02-28', notaLargo: '28 días contra 31' })
  })

  it('mes a la fecha al 30-mar: la base se corta en el 28-feb y lo declara', () => {
    const p = calcularPeriodo({ tipo: 'mesALaFecha', ancla: '2026-03-31' })
    expect(p.dias).toBe(30)
    expect(p.bases.anteriorEquivalente).toMatchObject({ hasta: '2026-02-28', notaLargo: '28 días contra 30' })
  })

  it('29 de febrero → 28 de febrero del año anterior', () => {
    const p = calcularPeriodo({ tipo: 'ayer', ancla: '2028-03-01' })
    expect(p.desde).toBe('2028-02-29')
    expect(p.bases.anioMismasFechas).toMatchObject({ desde: '2027-02-28', hasta: '2027-02-28' })
  })

  it('2.ª quincena de 13 a 16 días; la base A es la misma quincena del mes anterior y declara la diferencia', () => {
    const largos = new Set<number>()
    for (let m = 1; m <= 12; m++) {
      const fin = calcularPeriodo({ tipo: 'quincena', ancla: '2031-01-01', dia: `2028-${pad(m)}-20` })
      largos.add(fin.dias)
      expect(fin.desde.slice(8)).toBe('16')
    }
    expect([...largos].sort()).toEqual([14, 15, 16])
    expect(calcularPeriodo({ tipo: 'quincena', ancla: '2031-01-01', dia: '2026-02-20' }).dias).toBe(13)
    const marzo = calcularPeriodo({ tipo: 'quincena', ancla: '2026-04-01', dia: '2026-03-20' })
    expect(marzo.bases.anteriorEquivalente).toMatchObject({ desde: '2026-02-16', hasta: '2026-02-28', notaLargo: '13 días contra 16' })
  })

  it('sin datos antes del 5-ene-2024: sin comparación, con motivo', () => {
    const p = calcularPeriodo({ tipo: 'mesALaFecha', ancla: '2024-06-10' })
    expect(p.bases.anioMismoDiaSemana).toBeNull()
    expect(p.motivos.anioMismoDiaSemana).toMatch(/Sin comparación/)
    expect(p.bases.anteriorEquivalente).not.toBeNull()
  })

  it('local nuevo: primer día con datos propio', () => {
    const p = calcularPeriodo({ tipo: 'mes', ancla: '2026-12-01', primerDiaConDatos: '2026-11-01' })
    expect(p.bases.anteriorEquivalente).toBeNull()
    expect(p.bases.anioMismoDiaSemana).toBeNull()
  })

  it('las flechas: hoy ‹ = ayer; ayer de N › = hoy; el período actual no tiene ›', () => {
    const hoy = calcularPeriodo({ tipo: 'hoy', ancla: '2026-11-16' })
    const ayer = periodoAnterior(hoy)
    expect([ayer.tipo, ayer.desde]).toEqual(['ayer', '2026-11-15'])
    expect(periodoSiguiente(ayer)?.tipo).toBe('hoy')
    expect(periodoSiguiente(hoy)).toBeNull()
    expect(periodoSiguiente(calcularPeriodo({ tipo: 'mesALaFecha', ancla: '2026-11-16' }))).toBeNull()
    const oct = periodoAnterior(calcularPeriodo({ tipo: 'mesALaFecha', ancla: '2026-11-16' }))
    expect([oct.desde, oct.hasta, oct.enCurso]).toEqual(['2026-10-01', '2026-10-31', false])
    expect(oct.bases.anteriorEquivalente).toMatchObject({ desde: '2026-09-01', hasta: '2026-09-30' })
  })

  it('rótulos', () => {
    expect(rotuloRango({ desde: '2026-11-15', hasta: '2026-11-15' }, 2026)).toBe('15 de noviembre (1 día)')
    expect(rotuloRango({ desde: '2026-11-09', hasta: '2026-12-15' }, 2026)).toBe('9 de noviembre al 15 de diciembre (37 días)')
    expect(rotuloRango({ desde: '2025-12-15', hasta: '2026-04-30' }, 2026)).toBe('15 de diciembre de 2025 al 30 de abril de 2026 (137 días)')
  })

  it('entradas inválidas tiran', () => {
    expect(() => calcularPeriodo({ tipo: 'rango', ancla: '2026-11-16', desde: '2026-11-10', hasta: '2026-11-01' })).toThrow()
    expect(() => calcularPeriodo({ tipo: 'rango', ancla: '2026-11-16', desde: '2026-11-16', hasta: '2026-11-16' })).toThrow()
    expect(() => calcularPeriodo({ tipo: 'mes', ancla: '16-11-2026' })).toThrow()
  })
})

describe('periodos — reloj: «hoy» es Costa Rica (R10)', () => {
  afterEach(() => vi.useRealTimers())

  it('a las 23:30 CR (05:30 UTC del día siguiente) el ancla sigue siendo el día CR', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-17T05:30:00Z'))   // lunes 16-nov 23:30 en Costa Rica
    const p = calcularPeriodo({ tipo: 'mesALaFecha' })
    expect([p.ancla, p.desde, p.hasta]).toEqual(['2026-11-16', '2026-11-01', '2026-11-15'])
  })

  it('el módulo no lee el reloj ni el huso por su cuenta', () => {
    const src = readFileSync(new URL('./periodos.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/new Date\(|Date\.now|Date\.UTC|toISOString|\.get(?:UTC)?(?:Date|Day|Hours|Month|FullYear)\(/)
  })
})
