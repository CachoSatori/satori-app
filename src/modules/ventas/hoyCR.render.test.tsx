// @vitest-environment happy-dom
//
// «Hoy» en Ventas es el día de Costa Rica (UTC−6), no la fecha UTC.
//
// El error que esto cuida: Competencias, Paridad (retirada el 16-nov), Saloneros por línea y Cajeros calculaban «hoy»
// con `new Date().toISOString()`. Desde las 18:00 CR la fecha UTC ya es «mañana»: de noche, en
// pleno servicio, el rango por defecto terminaba en el día siguiente y una competencia que
// terminaba hoy figuraba «Finalizada».
//
// Se fija el reloj a las 17:59, 18:01 y 23:59 CR del 30 de noviembre (último día del mes, para
// que el corrimiento a UTC también cambie el mes) y se mira lo que la pantalla PINTA.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// I/O mockeada: lo que se prueba es la fecha por defecto, no la lectura de datos.
vi.mock('./saloneroLentesDatos', () => ({ getLentesDesdePos: vi.fn() }))
vi.mock('./ventasDiasDesdePos', () => ({ getDiasMapDesdePos: vi.fn() }))
vi.mock('../../shared/api/ventas', () => ({
  getProductMap: vi.fn(), saveComp: vi.fn(), deleteComp: vi.fn(),
}))

import VentasCajeros from './VentasCajeros'
import VentasSaloneroLineas from './VentasSaloneroLineas'
import VentasCompetencias from './VentasCompetencias'
import {
  diasAtrasCR, inicioDeMesCR, haceUnMes, haceUnaSemana, estadoCompetencia, progresoCompetencia,
} from './rangosPorDefecto'
import type { CajeroDay, Comp, DiasMap } from '../../shared/types/ventas'

// 30-nov-2026 en Costa Rica, en tres momentos. Entre paréntesis, la fecha UTC (la del error).
const MOMENTOS = [
  { hora: '17:59 CR', utc: '2026-11-30T23:59:00Z' }, // UTC todavía 30-nov
  { hora: '18:01 CR', utc: '2026-12-01T00:01:00Z' }, // UTC ya 1-dic
  { hora: '23:59 CR', utc: '2026-12-01T05:59:00Z' }, // UTC ya 1-dic
] as const

const HOY = '2026-11-30'

const fechas = () =>
  [...document.querySelectorAll<HTMLInputElement>('input[type="date"]')].map(i => i.value)

// Un día con caja de turno: sin ventas de caja, Cajeros muestra el vacío y no la barra de rango.
const caj: CajeroDay = {
  esCajero: true, total: 1_000, salon: 0, delivery: 1_000, iva: 0, serv: 0, ordenes: 1, ticketProm: 1_000, prods: [],
}
const DIAS_CAJA: DiasMap = {
  '2026-11-15': { fileName: 'x', uploadedAt: '2026-11-15', saloneros: { 'Cajero turno mañana': caj } },
}

const comp = (o: Partial<Comp>): Comp => ({
  id: 'c1', nombre: 'Competencia de prueba', tipo: 'semanal', inicio: HOY, fin: HOY,
  premio: 'Premio ficticio', prods: [{ name: 'X', pts: 1 }], parts: [], ...o,
})

afterEach(() => { cleanup(); vi.useRealTimers() })

describe.each(MOMENTOS)('a las $hora del 30-nov', ({ utc }) => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(utc))
  })

  it('Saloneros por línea abre con los últimos 7 días, hasta el 30-nov', () => {
    render(<VentasSaloneroLineas />)
    expect(fechas()).toEqual(['2026-11-24', HOY])
  })

  it('Cajeros abre con noviembre (1 al 30), y «7 días» va del 23 al 30', () => {
    render(<VentasCajeros dias={DIAS_CAJA} />)
    expect(fechas()).toEqual(['2026-11-01', HOY])
    fireEvent.click(screen.getByText('7 días'))
    expect(fechas()).toEqual(['2026-11-23', HOY])
  })

  it('Competencias: la que termina hoy sigue «En curso» y el contador no se adelanta', () => {
    render(<VentasCompetencias dias={{}} pm={{}} onRefresh={() => {}} comps={[
      comp({ id: 'a', nombre: 'Termina hoy', inicio: '2026-11-24', fin: HOY }),
      comp({ id: 'b', nombre: 'A mitad', inicio: '2026-11-28', fin: '2026-12-02' }),
    ]} />)
    const texto = document.body.textContent ?? ''
    expect(texto).not.toContain('Finalizada')
    expect(texto.match(/● En curso/g)).toHaveLength(2)
    // Día 3 de una competencia del 28-nov al 2-dic (total 4, como se calculaba antes).
    expect(texto).toContain('3 / 4 días')
  })

  it('Competencias → «+ Nueva» propone inicio y fin = 30-nov', () => {
    render(<VentasCompetencias dias={{}} pm={{}} onRefresh={() => {}} comps={[]} />)
    fireEvent.click(screen.getByText('+ Nueva'))
    expect(fechas()).toEqual([HOY, HOY])
  })

  it('las funciones puras, con «hoy» del reloj', () => {
    expect(diasAtrasCR(7)).toBe('2026-11-23')
    expect(inicioDeMesCR()).toBe('2026-11-01')
    expect(haceUnMes()).toBe('2026-10-30')
    expect(haceUnaSemana()).toBe('2026-11-24')
    expect(estadoCompetencia({ inicio: '2026-11-24', fin: HOY })).toBe('active')
  })
})

describe('aritmética de días (sin reloj)', () => {
  it('cruza mes y año', () => {
    expect(diasAtrasCR(7, '2027-01-03')).toBe('2026-12-27')
    expect(haceUnaSemana('2027-03-02')).toBe('2027-02-24')
    expect(haceUnMes('2027-01-15')).toBe('2026-12-15')
    expect(inicioDeMesCR('2027-01-15')).toBe('2027-01-01')
  })

  it('competencia: próxima, en curso, finalizada y el contador por día de calendario', () => {
    const c = { inicio: '2026-11-28', fin: '2026-12-02' }
    expect(estadoCompetencia(c, '2026-11-27')).toBe('upcoming')
    expect(estadoCompetencia(c, '2026-12-02')).toBe('active')
    expect(estadoCompetencia(c, '2026-12-03')).toBe('ended')
    expect(progresoCompetencia(c, '2026-11-27')).toEqual({ total: 4, elapsed: 0 })
    expect(progresoCompetencia(c, '2026-11-28')).toEqual({ total: 4, elapsed: 1 })
    expect(progresoCompetencia(c, '2026-11-30')).toEqual({ total: 4, elapsed: 3 })
    expect(progresoCompetencia(c, '2026-12-05')).toEqual({ total: 4, elapsed: 4 })
  })
})

// Guardia del módulo: que el patrón no vuelva a Ventas. Quedan dos usos que no son «hoy» de un rango:
//   · VentasConfig.tsx: la fecha solo va en el nombre del CSV que se descarga.
//   · VentasPromPaxExplicado.tsx: usa `fechaCR()` y la fecha UTC solo si aquella devuelve null.
describe('guardia: Ventas no calcula «hoy» con la fecha UTC', () => {
  it('ningún archivo nuevo de src/modules/ventas usa new Date().toISOString().slice(0, 10)', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    // En happy-dom `import.meta.url` no es una ruta del disco: se parte de la raíz del repo.
    const dir = `${process.cwd()}/src/modules/ventas/`
    const PERMITIDOS = ['VentasConfig.tsx', 'VentasPromPaxExplicado.tsx']
    const conPatron = readdirSync(dir)
      .filter(n => /\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n))
      .filter(n => /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/.test(readFileSync(dir + n, 'utf8')))
      .sort()
    expect(conPatron).toEqual(PERMITIDOS)
  })
})
