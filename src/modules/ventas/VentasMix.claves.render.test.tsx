// @vitest-environment happy-dom
//
// Mix: una clasificación con productos de comida Y bebida se dibuja en DOS secciones
// (Bebidas y Comidas). Antes las dos filas compartían la `key` de React (solo la clasificación)
// y el estado de expandido: cada clic dejaba una fila huérfana (2 → 8 filas en 6 clics) y abrir
// una abría la otra. Estas pruebas cuentan filas en el DOM tras varios clics.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import VentasMix from './VentasMix'
import type { DiasMap, ProductMap, ProductInfo, SaloneroDay } from '../../shared/types/ventas'

afterEach(() => cleanup())

const info = (o: Partial<ProductInfo>): ProductInfo =>
  ({ tipo: 'comida', clasificacion: '', subclasificacion: '', multiplicador: 1, costo_unitario: 0, ...o }) as ProductInfo

const sal = (prods: [string, number, number][]): SaloneroDay => ({
  pax: 0, total: 0, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
  promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods,
})

// Datos ficticios: una clasificación con un plato y una bebida, y otra solo de comida.
const pm: ProductMap = {
  'Bowl de prueba':  info({ tipo: 'comida', clasificacion: 'GREENSEASON' }),
  'Jugo de prueba':  info({ tipo: 'bebida', clasificacion: 'GREENSEASON' }),
  'Rollo de prueba': info({ tipo: 'comida', clasificacion: 'SUSHI ROLLS', subclasificacion: 'CLASICOS' }),
}
const dias: DiasMap = {
  '2026-10-05': {
    fileName: 'prueba', uploadedAt: '2026-10-05T12:00:00Z',
    saloneros: { 'Mesero A': sal([['Bowl de prueba', 2, 1000], ['Jugo de prueba', 3, 600], ['Rollo de prueba', 1, 500]]) },
  },
  // Segundo mes: «Comparar» necesita dos períodos.
  '2026-09-05': {
    fileName: 'prueba', uploadedAt: '2026-09-05T12:00:00Z',
    saloneros: { 'Mesero A': sal([['Bowl de prueba', 1, 500], ['Jugo de prueba', 1, 200], ['Rollo de prueba', 1, 500]]) },
  },
}

/** Filas de la tabla del Mix (la última de la pantalla; en «Comparar» arriba va la de KPIs). */
const filas = () => {
  const tablas = document.querySelectorAll('table')
  return [...(tablas[tablas.length - 1]?.querySelectorAll('tbody tr') ?? [])]
}
const filasDe = (txt: string) => filas().filter(tr => tr.querySelector('td')?.textContent?.includes(txt))
/** Filas de clasificación (primera celda en negrita; la de subclasificación no lo está), por nombre. */
const clasRows = (txt: string) =>
  filasDe(txt).filter(tr => (tr.querySelector('td')?.getAttribute('style') ?? '').includes('font-weight: 700'))

function prueba(modo: 'ver' | 'comparar') {
  const errores = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { getByText } = render(<VentasMix dias={dias} pm={pm} />)
  if (modo === 'comparar') fireEvent.click(getByText('⇄ Comparar'))

  // Cerrado: 2 secciones + GREENSEASON (Bebidas) + GREENSEASON y SUSHI ROLLS (Comidas).
  const base = filas().length
  expect(base).toBe(5)
  expect(clasRows('GREENSEASON')).toHaveLength(2)

  for (let i = 1; i <= 6; i++) {
    fireEvent.click(clasRows('GREENSEASON')[0])
    // Siempre dos filas de clasificación GREENSEASON, una por sección.
    expect(clasRows('GREENSEASON')).toHaveLength(2)
    const abierta = i % 2 === 1
    // Abrir la primera agrega UNA fila (su subclasificación) y no abre la de la otra sección.
    expect(filas().length).toBe(base + (abierta ? 1 : 0))
    const [a, b] = clasRows('GREENSEASON')
    expect(a.textContent).toContain(abierta ? '▼' : '▶')
    expect(b.textContent).toContain('▶')
  }

  // La segunda, sola: abre solo la suya.
  fireEvent.click(clasRows('GREENSEASON')[1])
  expect(filas().length).toBe(base + 1)
  expect(clasRows('GREENSEASON')[0].textContent).toContain('▶')
  fireEvent.click(clasRows('GREENSEASON')[1])
  expect(filas().length).toBe(base)

  // React avisa en consola cuando hay claves repetidas: no debe haber ninguno.
  const avisosClave = errores.mock.calls.filter(c => String(c[0]).includes('same key'))
  errores.mockRestore()
  expect(avisosClave).toHaveLength(0)
}

describe('VentasMix — claves únicas por sección y clasificación', () => {
  it('Ver período: el conteo de filas queda estable tras 6 clics', () => prueba('ver'))
  it('Comparar: el conteo de filas queda estable tras 6 clics', () => prueba('comparar'))

  it('Expandir todo abre las dos secciones y Colapsar todo deja la tabla como al inicio', () => {
    const { getAllByText } = render(<VentasMix dias={dias} pm={pm} />)
    const base = filas().length
    fireEvent.click(getAllByText('▼ Expandir todo')[0])
    // Cada GREENSEASON abre su subclasificación y su producto (2 + 2), SUSHI ROLLS su subcl y producto (2).
    expect(filas().length).toBe(base + 6)
    for (const tr of clasRows('GREENSEASON')) expect(tr.textContent).toContain('▼')
    fireEvent.click(getAllByText('▲ Colapsar todo')[0])
    expect(filas().length).toBe(base)
  })
})
