// @vitest-environment happy-dom
// R35 · Ventas → Metas, Clasificación (VentasConfig) y Competencias: un cuadro `type="number"` con texto ilegible («5-»,
// «0-450», «--») da `value === ''` + `validity.badInput`; antes `Number('')` guardaba 0 (o 1 punto) sin aviso. Ahora aviso
// que nombra el cuadro, botón apagado y la API de guardado no se llama. Los cuadros se escriben con `teclearNumero` (un
// solo evento input, como el navegador; con el cuadro VACÍO + «-» React 19 no dispara onChange) o con userEvent sobre
// la imitación de Chrome. Se buscan por rol y nombre (R32). Datos ficticios.
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DiasMap, Meta } from '../../shared/types/ventas'
import { teclearNumero } from '../cash/teclearNumero.testutil'
import { imitarInputNumeroDeChrome, textoVisible } from '../tips/inputNumeroComoChrome.testutil'

const H = vi.hoisted(() => ({
  saveMetas: vi.fn(async () => {}),
  saveProductMapItems: vi.fn(async () => {}),
  saveComp: vi.fn(async () => {}),
}))
vi.mock('../../shared/api/ventas', () => ({
  saveMetas: H.saveMetas, saveProductMapItems: H.saveProductMapItems, saveComp: H.saveComp, deleteComp: vi.fn(),
}))

import VentasMetas from './VentasMetas'
import VentasConfig from './VentasConfig'
import VentasCompetencias from './VentasCompetencias'
import { getMeta } from './ventasUtils'

let sacar: () => void
beforeAll(() => { sacar = imitarInputNumeroDeChrome() })
afterAll(() => sacar())
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup() })

const cuadro = (nombre: string) => screen.getByRole('spinbutton', { name: nombre }) as HTMLInputElement
const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre }) as HTMLButtonElement
const aviso = () => screen.queryByRole('alert')?.textContent ?? null

const METAS: Meta = { restaurante: {}, margen: {}, global: { promPax: 15000, bebPax: 1, ratioCB: 2, ticketItem: 5000, ventas: 900000 }, salMetas: {} } as unknown as Meta

describe('Metas · metas generales', () => {
  const abrir = () => render(<VentasMetas dias={{}} hist={{}} metas={METAS} onMetasUpdated={() => {}} />)

  it.each(['5-', '--', '0-450'])('cuadro vacío + «%s» → aviso con «Prom/PAX (₡)», botón apagado, no guarda', async texto => {
    abrir()
    teclearNumero(cuadro('Prom/PAX (₡)'), '')
    teclearNumero(cuadro('Prom/PAX (₡)'), texto)
    expect(aviso()).toContain('«Prom/PAX (₡)»: lo escrito no es un número')
    expect(boton(/Guardar metas/).disabled).toBe(true)
    fireEvent.click(boton(/Guardar metas/))
    expect(H.saveMetas).not.toHaveBeenCalled()
  })

  it('«15000-» detrás de lo que había (Chrome) → aviso; borrarlo destraba y vacío guarda 0 como antes', async () => {
    const u = userEvent.setup()
    abrir()
    await u.type(cuadro('Ventas/día (₡)'), '-')
    expect(textoVisible(cuadro('Ventas/día (₡)'))).toBe('900000-')
    expect(aviso()).toContain('«Ventas/día (₡)»')
    await u.clear(cuadro('Ventas/día (₡)'))
    expect(aviso()).toBeNull()
    fireEvent.click(boton(/Guardar metas/))
    await waitFor(() => expect(H.saveMetas).toHaveBeenCalled())
    expect((H.saveMetas.mock.calls[0] as unknown as [Meta])[0].global.ventas).toBe(0)
  })

  it('negativo legible → aviso; un número válido se guarda igual que antes', async () => {
    abrir()
    teclearNumero(cuadro('Beb/PAX'), '-1')
    expect(aviso()).toContain('«Beb/PAX»: va un número de 0 en adelante')
    teclearNumero(cuadro('Beb/PAX'), '1.5')
    expect(aviso()).toBeNull()
    fireEvent.click(boton(/Guardar metas/))
    await waitFor(() => expect(H.saveMetas).toHaveBeenCalled())
    expect((H.saveMetas.mock.calls[0] as unknown as [Meta])[0].global.bebPax).toBe(1.5)
  })
})

const DIAS = {
  '2026-11-10': { fileName: 'f', uploadedAt: 'x', saloneros: { 'Persona A': { prods: [['ROLLO FICTICIO', 1, 1000]] } } },
} as unknown as DiasMap

describe('Clasificación de productos · multiplicador y costo', () => {
  const abrir = () => render(<VentasConfig dias={DIAS} pm={{}} onRefresh={() => {}} />)
  const guardarFila = () => screen.getAllByRole('button', { name: /Guardar 1 cambio/ }) as HTMLButtonElement[]

  it('multiplicador vacío + «5-» → aviso con el producto, guardar apagado, no guarda', async () => {
    abrir()
    teclearNumero(cuadro('Mult. × · ROLLO FICTICIO'), '')
    teclearNumero(cuadro('Mult. × · ROLLO FICTICIO'), '5-')
    expect(aviso()).toContain('«Mult. × · ROLLO FICTICIO»')
    for (const b of guardarFila()) { expect(b.disabled).toBe(true); fireEvent.click(b) }
    expect(H.saveProductMapItems).not.toHaveBeenCalled()
  })

  it.each([['1e3', 'va un número entero de 1 a 20'], ['2.5', 'va un número entero de 1 a 20'], ['0', 'de 1 a 20']])(
    'multiplicador «%s» → aviso (tope y enteros)', async (texto, dice) => {
      abrir()
      teclearNumero(cuadro('Mult. × · ROLLO FICTICIO'), texto)
      expect(aviso()).toContain(dice)
      expect(guardarFila()[0].disabled).toBe(true)
    })

  it('costo ilegible o negativo → aviso; costo válido se guarda', async () => {
    abrir()
    teclearNumero(cuadro('Costo ₡ · ROLLO FICTICIO'), '0-450')
    expect(aviso()).toContain('«Costo ₡ · ROLLO FICTICIO»: lo escrito no es un número')
    teclearNumero(cuadro('Costo ₡ · ROLLO FICTICIO'), '-5')
    expect(aviso()).toContain('«Costo ₡ · ROLLO FICTICIO»: va un número de 0 en adelante')
    teclearNumero(cuadro('Costo ₡ · ROLLO FICTICIO'), '1250.5')
    expect(aviso()).toBeNull()
    fireEvent.click(guardarFila()[0])
    await waitFor(() => expect(H.saveProductMapItems).toHaveBeenCalled())
    expect((H.saveProductMapItems.mock.calls[0] as unknown as [Array<{ costo_unitario: number }>])[0][0].costo_unitario).toBe(1250.5)
  })

  it('edición masiva: multiplicador ilegible → aviso y «Aplicar» apagado', async () => {
    abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Elegir ROLLO FICTICIO' }))
    teclearNumero(cuadro('Mult. × (edición masiva)'), '--')
    expect(aviso()).toContain('«Mult. × (edición masiva)»')
    expect(boton(/Aplicar a 1/).disabled).toBe(true)
  })
})

describe('Competencias · puntos por producto', () => {
  const abrir = async () => {
    render(<VentasCompetencias dias={{}} pm={{}} comps={[]} onRefresh={() => {}} role="owner" />)
    fireEvent.click(screen.getByText('+ Nueva'))
    fireEvent.change(screen.getByPlaceholderText('ej: Batalla de bebidas — Julio'), { target: { value: 'Copa ficticia' } })
    fireEvent.change(screen.getByPlaceholderText('Nombre del producto (mayúsculas)'), { target: { value: 'ROLLO A' } })
  }

  it.each(['', '5-', '0', '2.5'])('puntos «%s» → aviso con el producto, no crea (antes quedaba 1 punto)', async texto => {
    await abrir()
    teclearNumero(cuadro('Puntos · ROLLO A'), '')
    teclearNumero(cuadro('Puntos · ROLLO A'), texto)
    expect(aviso()).toContain('«Puntos · ROLLO A»')
    expect(boton(/Crear competencia/).disabled).toBe(true)
    fireEvent.click(boton(/Crear competencia/))
    expect(H.saveComp).not.toHaveBeenCalled()
  })

  it('puntos válidos se guardan como número', async () => {
    await abrir()
    teclearNumero(cuadro('Puntos · ROLLO A'), '3')
    fireEvent.click(boton(/Crear competencia/))
    await waitFor(() => expect(H.saveComp).toHaveBeenCalled())
    expect((H.saveComp.mock.calls[0] as unknown as [{ prods: unknown }])[0].prods).toEqual([{ name: 'ROLLO A', pts: 3 }])
  })
})

describe('Metas individuales · vacía hereda la general (decisión del dueño, 24-nov)', () => {
  const META_SAL = { ...METAS, salMetas: { 'Persona A': { promPax: 20000, bebPax: 2 } } } as unknown as Meta
  const guardado = () => (H.saveMetas.mock.calls[0] as unknown as [Meta])[0]

  it('borrar una meta propia no guarda 0: se quita y getMeta usa la general', async () => {
    render(<VentasMetas dias={DIAS} hist={{}} metas={META_SAL} onMetasUpdated={() => {}} />)
    teclearNumero(cuadro('Prom/PAX · Persona A'), '')
    expect(cuadro('Prom/PAX · Persona A').value).toBe('')
    expect(aviso()).toBeNull()
    fireEvent.click(boton(/Guardar metas/))
    await waitFor(() => expect(H.saveMetas).toHaveBeenCalled())
    expect(guardado().salMetas['Persona A']).toEqual({ bebPax: 2 })
    expect(getMeta(guardado(), 'Persona A', 'promPax')).toBe(15000)
  })

  it('sin ninguna meta propia, el salonero sale del mapa', async () => {
    render(<VentasMetas dias={DIAS} hist={{}} metas={META_SAL} onMetasUpdated={() => {}} />)
    teclearNumero(cuadro('Prom/PAX · Persona A'), '')
    teclearNumero(cuadro('Beb/PAX · Persona A'), '')
    fireEvent.click(boton(/Guardar metas/))
    await waitFor(() => expect(H.saveMetas).toHaveBeenCalled())
    expect('Persona A' in guardado().salMetas).toBe(false)
  })

  it('un 0 escrito a mano sí se guarda como meta propia; lo ilegible sigue con aviso', async () => {
    render(<VentasMetas dias={DIAS} hist={{}} metas={META_SAL} onMetasUpdated={() => {}} />)
    teclearNumero(cuadro('Prom/PAX · Persona A'), '5-')
    expect(aviso()).toContain('«Prom/PAX · Persona A»')
    teclearNumero(cuadro('Prom/PAX · Persona A'), '0')
    fireEvent.click(boton(/Guardar metas/))
    await waitFor(() => expect(H.saveMetas).toHaveBeenCalled())
    expect(guardado().salMetas['Persona A'].promPax).toBe(0)
  })
})
