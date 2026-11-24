// @vitest-environment happy-dom
// R35 · Inventario → Movimientos (costo unitario de una compra) y Recetas (cantidad y merma de un ingrediente). Un cuadro
// `type="number"` con texto ilegible da `value === ''` + `validity.badInput`: antes la compra entraba SIN costo y sin
// egreso en Caja, y la merma vacía o ilegible guardaba `waste_factor` NaN. Ahora aviso que nombra el cuadro, botón
// apagado y no se llama a la API. Cuadros escritos con `teclearNumero` arrancando vacíos; por rol y nombre (R32).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { teclearNumero } from '../cash/teclearNumero.testutil'
import type { Ingredient, Recipe } from '../../shared/types/inventario'

const H = vi.hoisted(() => ({
  addMovement: vi.fn(async () => {}), setStockLevel: vi.fn(async () => {}),
  upsertRecipeIngredient: vi.fn(async () => {}),
  upsertIngredient: vi.fn(async () => {}),
  createCashMovement: vi.fn(async () => {}),
  receta: { id: 'r1', product_name: 'ROLLO FICTICIO', yield_qty: 1, yield_unit: 'unidad', notes: '', created_at: 'x', updated_at: 'x' } as Recipe,
}))
vi.mock('../../shared/api/inventario', () => ({
  addMovement: H.addMovement, setStockLevel: H.setStockLevel,
  getRecipes: async () => [H.receta], upsertRecipe: vi.fn(), getRecipeIngredients: async () => [],
  upsertRecipeIngredient: H.upsertRecipeIngredient, deleteRecipeIngredient: vi.fn(),
  upsertIngredient: H.upsertIngredient, deleteIngredient: vi.fn(),
}))
vi.mock('../../shared/api/inventoryIngest', () => ({ getIngredientPrices: async () => [] }))
vi.mock('../../shared/api/cash', () => ({ getOpenCashSession: async () => ({ id: 's1' }), createCashMovement: H.createCashMovement }))
vi.mock('../../shared/api/ventas', () => ({ getProductMap: async () => ({}), updateProductInfo: vi.fn() }))

const ING: Ingredient = {
  id: 'i1', name: 'Arroz ficticio', unit: 'kg', current_stock: 10, min_stock: 1, cost_per_unit: 1000, supplier: 'Proveedor X',
  category: 'secos', notes: '', updated_at: '2026-01-01', created_at: '2026-01-01',
}

import InvMovimientos from './InvMovimientos'
import InvRecetas from './InvRecetas'
import InvIngredientes from './InvIngredientes'

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup() })

const cuadro = (nombre: string) => screen.getByRole('spinbutton', { name: nombre }) as HTMLInputElement
const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre }) as HTMLButtonElement
const aviso = () => screen.queryByRole('alert')?.textContent ?? null

describe('Movimientos · costo unitario de una compra', () => {
  const abrir = () => {
    render(<InvMovimientos ingredients={[ING]} movements={[]} onRefresh={() => {}} profile={{ id: 'u1', role: 'manager' }} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Ingrediente' }), { target: { value: 'i1' } })
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '2' } })
  }

  it.each(['5-', '--', '0-450', '-1250'])('costo vacío + «%s» → aviso, botón apagado, ni movimiento ni egreso en Caja', async texto => {
    abrir()
    teclearNumero(cuadro('Costo unitario ₡'), '')
    teclearNumero(cuadro('Costo unitario ₡'), texto)
    expect(aviso()).toContain('«Costo unitario ₡»')
    expect(boton(/Registrar movimiento/).disabled).toBe(true)
    fireEvent.click(boton(/Registrar movimiento/))
    expect(H.addMovement).not.toHaveBeenCalled()
    expect(H.createCashMovement).not.toHaveBeenCalled()
  })

  it('vacío sigue siendo «sin costo» (opcional): registra la compra sin egreso en Caja, como antes', async () => {
    abrir()
    teclearNumero(cuadro('Costo unitario ₡'), '')
    fireEvent.click(boton(/Registrar movimiento/))
    await waitFor(() => expect(H.addMovement).toHaveBeenCalled())
    expect((H.addMovement.mock.calls[0] as unknown as [Record<string, unknown>])[0].unit_cost).toBeNull()
    expect(H.createCashMovement).not.toHaveBeenCalled()
  })

  it('costo válido: compra con costo y egreso en Caja por cantidad × costo', async () => {
    abrir()
    teclearNumero(cuadro('Costo unitario ₡'), '1250')
    fireEvent.click(boton(/Registrar movimiento/))
    await waitFor(() => expect(H.createCashMovement).toHaveBeenCalled())
    expect((H.addMovement.mock.calls[0] as unknown as [Record<string, unknown>])[0].unit_cost).toBe(1250)
    expect((H.createCashMovement.mock.calls[0] as unknown as [Record<string, unknown>])[0].amount_crc).toBe(2500)
  })

  it('cambiar a otro tipo (el cuadro se oculta) descarta lo ilegible y no traba', async () => {
    abrir()
    teclearNumero(cuadro('Costo unitario ₡'), '5-')
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo de movimiento' }), { target: { value: 'waste' } })
    expect(aviso()).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo de movimiento' }), { target: { value: 'purchase' } })
    expect(aviso()).toBeNull()
  })
})

describe('Recetas · cantidad y merma de un ingrediente', () => {
  const abrir = async () => {
    render(<InvRecetas ingredients={[ING]} onRefresh={() => {}} />)
    fireEvent.click(await screen.findByText('ROLLO FICTICIO'))
    await screen.findByRole('spinbutton', { name: 'Merma %' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Ingrediente' }), { target: { value: 'i1' } })
  }

  it.each([['Merma %', '5-'], ['Merma %', '1e3'], ['Merma %', '-2'], ['Cantidad', '0-450'], ['Cantidad', '0']])(
    '«%s» con «%s» → aviso, «+ Agregar» apagado, no guarda', async (nombre, texto) => {
      await abrir()
      teclearNumero(cuadro('Cantidad'), '0.25')
      teclearNumero(cuadro(nombre), '')
      teclearNumero(cuadro(nombre), texto)
      expect(aviso()).toContain(`«${nombre}»`)
      expect(boton('+ Agregar').disabled).toBe(true)
      fireEvent.click(boton('+ Agregar'))
      expect(H.upsertRecipeIngredient).not.toHaveBeenCalled()
    })

  it('merma vacía guarda 0 (antes guardaba NaN)', async () => {
    await abrir()
    teclearNumero(cuadro('Cantidad'), '0.25')
    teclearNumero(cuadro('Merma %'), '')
    fireEvent.click(boton('+ Agregar'))
    await waitFor(() => expect(H.upsertRecipeIngredient).toHaveBeenCalled())
    expect((H.upsertRecipeIngredient.mock.calls[0] as unknown as [Record<string, unknown>])[0]).toMatchObject({ quantity: 0.25, waste_factor: 0 })
  })
})

describe('Ingredientes · stock actual, mínimo y costo/unidad', () => {
  const nuevo = () => {
    render(<InvIngredientes ingredients={[]} onRefresh={() => {}} profile={{ id: 'u1', role: 'owner' }} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre *' }), { target: { value: 'Arroz ficticio' } })
  }

  it.each([['Stock actual', '0-450'], ['Stock mínimo', '5-'], ['Costo/unidad ₡', '--'], ['Costo/unidad ₡', '-1250'], ['Stock actual', '-3']])(
    '«%s» con «%s» → aviso con el cuadro, «✓ Guardar» apagado, no guarda', async (nombre, texto) => {
      nuevo()
      teclearNumero(cuadro(nombre), '')
      teclearNumero(cuadro(nombre), texto)
      expect(aviso()).toContain(`«${nombre}»`)
      expect(boton('✓ Guardar').disabled).toBe(true)
      fireEvent.click(boton('✓ Guardar'))
      expect(H.upsertIngredient).not.toHaveBeenCalled()
    })

  it('valores válidos se guardan; vacío = 0 como antes', async () => {
    nuevo()
    teclearNumero(cuadro('Costo/unidad ₡'), '1250.5')
    teclearNumero(cuadro('Stock mínimo'), '')
    fireEvent.click(boton('✓ Guardar'))
    await waitFor(() => expect(H.upsertIngredient).toHaveBeenCalled())
    expect((H.upsertIngredient.mock.calls[0] as unknown as [Record<string, unknown>])[0]).toMatchObject({ cost_per_unit: 1250.5, min_stock: 0 })
  })

  it('un stock viejo negativo (por consumo) no traba editar otra cosa', async () => {
    render(<InvIngredientes ingredients={[{ ...ING, current_stock: -2 }]} onRefresh={() => {}} profile={{ id: 'u1', role: 'owner' }} />)
    fireEvent.click(boton('Editar'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Proveedor' }), { target: { value: 'Proveedor Y' } })
    expect(aviso()).toBeNull()
    fireEvent.click(boton('✓ Guardar'))
    await waitFor(() => expect(H.upsertIngredient).toHaveBeenCalled())
  })
})
