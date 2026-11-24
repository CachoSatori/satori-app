// @vitest-environment happy-dom
// Bandeja → paso «Inventario» (InvLineTable, compartida con InvRevision): un cuadro de cantidad, factor o precio con
// texto que no es número («0-450», «5-») daba `value` "" y `N('')` lo volvía 0: la factura entraba con precio o
// cantidad 0 sin aviso. Ahora aviso con el nombre del cuadro y la línea, el botón no confirma y no se escribe nada.
// Cuadros tipeados con userEvent sobre la imitación de Chrome (R29). Datos ficticios.
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DocumentRow } from '../../shared/api/documents'
import type { Ingredient } from '../../shared/types/inventario'
import type { Supplier } from '../../shared/types/database'
import { imitarInputNumeroDeChrome, textoVisible } from '../tips/inputNumeroComoChrome.testutil'

const H = vi.hoisted(() => ({
  commit: vi.fn<(p: { lines: { cantidad: number; precio_unitario: number; factor_conversion: number }[] }) => Promise<object>>(async () => ({})),
}))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/inventoryIngest', async orig => {
  const real = await orig<typeof import('../../shared/api/inventoryIngest')>()
  return {
    ...real,
    getSupplierItemMap: vi.fn(async () => []),
    findOrCreateSupplier: vi.fn(async () => 'sup-1'),
    commitInventoryForDocument: H.commit,
    // Sin crear ingredientes: mismo mapeo que el real para ingredientes existentes.
    resolveEditLines: vi.fn(async (lines: import('../../shared/api/inventoryIngest').EditLine[]) => lines.map(l => ({
      codigo: l.codigo, descripcion: l.descripcion, ingredient_id: l.sel === real.NONE ? null : l.sel, ingredient_unit: 'K',
      unidad_factura: l.unidad, factor_conversion: l.factor || 1, cantidad: l.cantidad, precio_unitario: l.precio,
      es_inventario: l.sel !== real.NONE,
    }))),
  }
})

import InventoryStep from './InventoryStep'

const ING = [{ id: 'ing-1', name: 'Pescado ficticio', unit: 'K' }] as unknown as Ingredient[]
const SUP = [{ id: 'sup-1', name: 'Proveedor Ficticio', aliases: [] }] as unknown as Supplier[]
// Precio 0 en la factura → el cuadro arranca con «0» (así se llega a «0-450», como en la validación del dueño).
const DOC = {
  id: 'doc-1', linked_movement_id: 'mov-1',
  raw_json: { tipo: 'factura', proveedor: 'Proveedor Ficticio', clave_fe: null, fecha: '2026-11-20',
    items: [{ descripcion: 'Pescado ficticio', cantidad: 2, unidad: 'K', precio_unitario: 0, total: 0 }] },
} as unknown as DocumentRow

let sacar: () => void
beforeAll(() => { sacar = imitarInputNumeroDeChrome() })
afterAll(() => sacar())
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup() })

const boton = () => screen.getByRole('button', { name: /Ingresar a inventario/ }) as HTMLButtonElement
const cuadro = (nombre: string) => screen.getByLabelText(`${nombre}: Pescado ficticio`) as HTMLInputElement
const aviso = () => screen.queryByRole('alert')?.textContent ?? null

async function abrir() {
  render(<InventoryStep doc={DOC} ingredients={ING} suppliers={SUP} createdBy="u-1" onClose={() => {}} onDone={() => {}} />)
  await screen.findByLabelText('Precio: Pescado ficticio')
  await waitFor(() => expect(boton().disabled).toBe(false))
}

describe('Bandeja → Inventario · cuadros ilegibles no se guardan como 0', () => {
  it('«0-450» en el precio → aviso con el cuadro y la línea, botón apagado, no se ingresa nada', async () => {
    const u = userEvent.setup()
    await abrir()
    expect(textoVisible(cuadro('Precio'))).toBe('0')
    await u.type(cuadro('Precio'), '-450')
    expect(textoVisible(cuadro('Precio'))).toBe('0-450')
    expect(aviso()).toContain('«Precio · Pescado ficticio»: el monto no es un número')
    expect(boton().disabled).toBe(true)
    await u.click(boton())
    expect(H.commit).not.toHaveBeenCalled()
  })

  it('«5-» en la cantidad → aviso y no se ingresa; corregir a 5 → entra con cantidad 5', async () => {
    const u = userEvent.setup()
    await abrir()
    await u.type(cuadro('Cantidad'), '5-', { initialSelectionStart: 0, initialSelectionEnd: 1 })
    expect(textoVisible(cuadro('Cantidad'))).toBe('5-')
    expect(aviso()).toContain('«Cant. · Pescado ficticio»')
    expect(boton().disabled).toBe(true)
    await u.type(cuadro('Cantidad'), '{Backspace}')
    expect(aviso()).toBeNull()
    await u.click(boton())
    await waitFor(() => expect(H.commit).toHaveBeenCalledTimes(1))
    expect(H.commit.mock.calls[0][0].lines[0].cantidad).toBe(5)
  })

  it('borrar un «0-450» (de "" a "": React 19 no dispara onChange) destraba; vacío sigue siendo 0 como antes', async () => {
    const u = userEvent.setup()
    await abrir()
    await u.type(cuadro('Precio'), '-450')
    expect(boton().disabled).toBe(true)
    await u.clear(cuadro('Precio'))
    expect(aviso()).toBeNull()
    expect(boton().disabled).toBe(false)
    await u.click(boton())
    await waitFor(() => expect(H.commit).toHaveBeenCalledTimes(1))
    expect(H.commit.mock.calls[0][0].lines[0].precio_unitario).toBe(0)
  })

  it('cantidad «0-450» y borrarla (de "" a "": solo llega onInput) destraba', async () => {
    const u = userEvent.setup()
    await abrir()
    await u.type(cuadro('Cantidad'), '0-450', { initialSelectionStart: 0, initialSelectionEnd: 1 })
    expect(textoVisible(cuadro('Cantidad'))).toBe('0-450')
    expect(aviso()).toContain('«Cant. · Pescado ficticio»')
    await u.clear(cuadro('Cantidad'))
    expect(aviso()).toBeNull()
    expect(boton().disabled).toBe(false)
  })

  it('cuadro ilegible + «--» encima (de "" a "") sigue bloqueado', async () => {
    const u = userEvent.setup()
    await abrir()
    await u.type(cuadro('Precio'), '-450')
    await u.type(cuadro('Precio'), '--', { initialSelectionStart: 0, initialSelectionEnd: 5 })
    expect(textoVisible(cuadro('Precio'))).toBe('--')
    expect(aviso()).toContain('«Precio · Pescado ficticio»')
    expect(boton().disabled).toBe(true)
  })

  it('«5-» en el factor bloquea; pasar la línea a «No es inventario» apaga el cuadro y destraba', async () => {
    const u = userEvent.setup()
    await abrir()
    await u.type(cuadro('Factor'), '5-', { initialSelectionStart: 0, initialSelectionEnd: 1 })
    expect(aviso()).toContain('«Factor · Pescado ficticio»')
    expect(boton().disabled).toBe(true)
    await u.selectOptions(screen.getByRole('combobox'), '__none__')
    expect(aviso()).toBeNull()
    expect(cuadro('Factor').disabled).toBe(true)
    // Al volver a ser inventario el factor no queda trabado sin verse.
    await u.selectOptions(screen.getByRole('combobox'), 'ing-1')
    expect(aviso()).toBeNull()
    expect(textoVisible(cuadro('Factor'))).toBe('1')
  })
})
