import { describe, it, expect, vi } from 'vitest'
import type { Supplier } from '../types/database'

// classifyMovement reusa `norm` de inventoryIngest, que importa el cliente supabase (tira sin env).
// Mockeamos SOLO ese leaf para mantener el test puro (sin red ni env) y usar el `norm` REAL.
vi.mock('../api/supabase', () => ({ supabase: {} }))

import { classifyMovement } from './classifyMovement'

// Factory de Supplier completo (sin casts) — ejercita la forma real del tipo.
const mkSupplier = (name: string, aliases: string[] | null = null): Supplier => ({
  id: name,
  name,
  category: null,
  contact: null,
  moneda: 'CRC',
  ciclo_pago: 'Semanal',
  metodo_pago: 'Efectivo',
  cuenta_iban: '',
  aliases,
  is_active: true,
  created_at: '2026-06-29T00:00:00Z',
  updated_at: '2026-06-29T00:00:00Z',
})

const suppliers: Supplier[] = [
  mkSupplier('Pescadería del Pacífico', ['Pesca Pacífico']),
  mkSupplier('Verdulería La Huerta'),
  mkSupplier('Carnes El Novillo'),
]

describe('classifyMovement — contrato base', () => {
  it('siempre devuelve { suggestion ∈ {mercaderia,operativa}, confidence ∈ [0,1] }', () => {
    const r = classifyMovement({ text: 'algo' }, suppliers)
    expect(['mercaderia', 'operativa']).toContain(r.suggestion)
    expect(r.confidence).toBeGreaterThanOrEqual(0)
    expect(r.confidence).toBeLessThanOrEqual(1)
  })

  it('es pura: no muta el input ni la lista de suppliers', () => {
    const input = { text: 'pago alquiler', supplierName: 'X', amount: 1000 }
    const inputCopy = structuredClone(input)
    const suppliersCopy = structuredClone(suppliers)
    classifyMovement(input, suppliers)
    expect(input).toEqual(inputCopy)
    expect(suppliers).toEqual(suppliersCopy)
  })
})

describe('señal 1 — proveedor reconocido → mercadería (confianza alta)', () => {
  it('supplierName que coincide con un proveedor conocido → mercadería ~0.95', () => {
    const r = classifyMovement({ supplierName: 'Pescadería del Pacífico' }, suppliers)
    expect(r.suggestion).toBe('mercaderia')
    expect(r.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('match insensible a acentos y mayúsculas (usa norm)', () => {
    const r = classifyMovement({ supplierName: 'PESCADERIA DEL PACIFICO' }, suppliers)
    expect(r.suggestion).toBe('mercaderia')
    expect(r.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('match por alias del proveedor', () => {
    const r = classifyMovement({ supplierName: 'pesca pacifico' }, suppliers)
    expect(r.suggestion).toBe('mercaderia')
    expect(r.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('proveedor conocido embebido en el texto OCR → mercadería (alta, algo menor que exacto)', () => {
    const r = classifyMovement({ text: 'Factura 0098 Verdulería La Huerta - varios' }, suppliers)
    expect(r.suggestion).toBe('mercaderia')
    expect(r.confidence).toBeGreaterThanOrEqual(0.8)
    expect(r.confidence).toBeLessThan(0.95)
  })

  it('el proveedor reconocido DOMINA aunque haya keyword operativa (orden de peso §6)', () => {
    const r = classifyMovement({ supplierName: 'Carnes El Novillo', text: 'pago de alquiler del local' }, suppliers)
    expect(r.suggestion).toBe('mercaderia')
  })
})

describe('señal 2 — palabra clave operativa → operativa (confianza media)', () => {
  it('texto con keyword operativa y sin proveedor → operativa ~0.7', () => {
    const r = classifyMovement({ text: 'Pago de electricidad del mes' }, suppliers)
    expect(r.suggestion).toBe('operativa')
    expect(r.confidence).toBeCloseTo(0.7, 5)
  })

  it('keyword con acentos en el texto también matchea (norm)', () => {
    const r = classifyMovement({ text: 'Reparación del aire acondicionado' }, suppliers)
    expect(r.suggestion).toBe('operativa')
    expect(r.confidence).toBeCloseTo(0.7, 5)
  })

  it('keyword en el nombre del payee (no proveedor de mercadería) → operativa', () => {
    const r = classifyMovement({ supplierName: 'Servicios Municipales', text: '' }, suppliers)
    expect(r.suggestion).toBe('operativa')
    expect(r.confidence).toBeCloseTo(0.7, 5)
  })

  it('no hay falsos positivos por substring: "gaseosa" NO dispara la keyword "gas"', () => {
    // Sin proveedor ni keyword real → cae al desempate (operativa baja), no a la media por keyword.
    const r = classifyMovement({ text: 'compra de gaseosa', amount: 3000 }, suppliers)
    expect(r.suggestion).toBe('operativa')
    expect(r.confidence).toBeLessThan(0.7)
  })
})

describe('señal 3 — desempate por monto → operativa (confianza baja)', () => {
  it('sin proveedor y sin keyword → operativa, confianza baja', () => {
    const r = classifyMovement({ text: 'pago varios', amount: 12345 }, suppliers)
    expect(r.suggestion).toBe('operativa')
    expect(r.confidence).toBeLessThanOrEqual(0.4)
  })

  it('monto alto y redondo (costo fijo típico) → operativa, baja pero algo mayor', () => {
    const r = classifyMovement({ text: 'transferencia mensual', amount: 350_000 }, suppliers)
    expect(r.suggestion).toBe('operativa')
    expect(r.confidence).toBe(0.5)
  })

  it('proveedor DESCONOCIDO + texto de mercadería (sin keyword operativa) → operativa baja', () => {
    // Por §6, un payee no reconocido NO es señal de mercadería (eso lo da el proveedor conocido o el
    // supplier_item_map, que no se pasa a una función pura). Default conservador: operativa, el humano
    // lo cambia a mercadería con un tap. Evita crear tareas de inventario espurias.
    const r = classifyMovement({ supplierName: 'Distribuidora Nueva SA', text: 'pescado y camarones', amount: 80_000 }, suppliers)
    expect(r.suggestion).toBe('operativa')
    expect(r.confidence).toBeLessThanOrEqual(0.5)
  })
})

describe('casos borde', () => {
  it('input totalmente vacío → operativa, confianza mínima (adivinanza)', () => {
    const r = classifyMovement({}, suppliers)
    expect(r.suggestion).toBe('operativa')
    expect(r.confidence).toBeLessThanOrEqual(0.3)
  })

  it('texto vacío con lista de suppliers vacía → operativa (no crashea)', () => {
    const r = classifyMovement({ text: '' }, [])
    expect(r.suggestion).toBe('operativa')
  })

  it('proveedor conocido pero lista de suppliers vacía → no puede reconocerlo → operativa', () => {
    const r = classifyMovement({ supplierName: 'Pescadería del Pacífico' }, [])
    expect(r.suggestion).toBe('operativa')
  })

  it('keyword operativa con lista de suppliers vacía → operativa media', () => {
    const r = classifyMovement({ text: 'pago de internet', amount: 20_000 }, [])
    expect(r.suggestion).toBe('operativa')
    expect(r.confidence).toBeCloseTo(0.7, 5)
  })
})
