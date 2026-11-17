// @vitest-environment happy-dom
// (184, firma del dueño 17-nov) DESCUENTO_SIN_RESPALDO: la ficha muestra el monto de la línea ejemplo como «esta línea» y
// el total de TODAS las líneas sin respaldo de la factura (lo que suma el reporte de descuentos de Marcadores).
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Excepcion } from '../../shared/api/club'

const exc = vi.hoisted(() => ({ lista: [] as unknown[] }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'owner', full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getExcepciones: async () => exc.lista,
  getAlertasPrioritarias: async () => [],
}))

import Excepciones from './Excepciones'

const desc = (detalle: Record<string, unknown>): Excepcion => ({
  tipo: 'DESCUENTO_SIN_RESPALDO', ref: 'desc:1001', fecha: '2026-10-26T02:00:00Z', factura: '0001001', certeza: 'probable',
  detalle: { articulo: 'B1', nombre: 'Plato ficticio', precio: 1600, referencia: 2000, descuento_pct: 20, descuento_crc: 400,
             clasificacion: null, turno: 'tarde', ...detalle },   // sin clasificar: la lista oculta las clasificadas
  resuelta: false, nota: null, resuelta_en: null,
} as unknown as Excepcion)

async function abrir() {
  render(<Excepciones />)
  fireEvent.click(await screen.findByText('Descuento sin respaldo', { selector: 'strong' }))
  return document.body.textContent ?? ''
}

describe('Excepciones · DESCUENTO_SIN_RESPALDO con todas las líneas (184)', () => {
  it('muestra «esta línea» y el total de la factura con la cantidad de líneas', async () => {
    exc.lista = [desc({ descuento_crc_lineas: 700, lineas_sin_respaldo: [{}, {}, {}] })]
    const t = await abrir()
    expect(t).toContain('Monto estimado (esta línea)')
    expect(t).toContain('Sin respaldo en la factura')
    expect(t).toContain('₡700 en 3 líneas')
  })
  it('una sola línea: «en 1 línea»', async () => {
    exc.lista = [desc({ descuento_crc_lineas: 400, lineas_sin_respaldo: [{}] })]
    expect(await abrir()).toContain('₡400 en 1 línea')
  })
  it('sin las claves nuevas (base sin la 184): como antes, sin el total', async () => {
    exc.lista = [desc({})]
    const t = await abrir()
    expect(t).not.toContain('Sin respaldo en la factura')
    expect(t).not.toContain('(esta línea)')
  })
})
