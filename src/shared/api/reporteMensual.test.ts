// SEC-02 (06/11): el botón de reportes de Admin llama a monthly-report con functions.invoke (reenvía el
// JWT del owner) y muestra solo qué se envió; los errores de la función llegan con su mensaje fijo.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fn = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: fn.invoke } } }))

import { enviarReporteMensual, mensajeReporte } from './reporteMensual'

beforeEach(() => fn.invoke.mockReset())

describe('enviarReporteMensual', () => {
  it('usa functions.invoke (sesión del owner) con tipo y mes', async () => {
    fn.invoke.mockResolvedValue({ data: { ok: true, month: 'Octubre 2026', enviados: ['ventas'], sin_datos: [] }, error: null })
    const r = await enviarReporteMensual('ventas', '2026-10')
    expect(fn.invoke).toHaveBeenCalledWith('monthly-report', { body: { tipo: 'ventas', month: '2026-10' } })
    expect(r.ok).toBe(true)
  })
  it('403 de la función → mensaje fijo', async () => {
    fn.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ ok: false, code: 'no_autorizado', error: 'Solo un owner activo puede pedir el reporte', ref: 'x' }), { status: 403 }) } })
    expect(await enviarReporteMensual('ambos')).toEqual({ ok: false, error: 'Solo un owner activo puede pedir el reporte' })
  })
  it('sin red', async () => {
    fn.invoke.mockResolvedValue({ data: null, error: new Error('Failed to fetch') })
    expect((await enviarReporteMensual('ambos')).error).toBe('Sin conexión — no se envió nada')
  })
})

describe('mensajeReporte', () => {
  it.each([
    ['ambos', { ok: true, month: 'Octubre 2026', enviados: ['ventas', 'propinas'], sin_datos: [] }, '✓ Ambos reportes enviados — Octubre 2026'],
    ['ambos', { ok: true, month: 'Octubre 2026', enviados: ['ventas'], sin_datos: ['propinas'] }, '✓ Reporte ventas enviado — Octubre 2026 (sin datos: propinas)'],
    ['propinas', { ok: true, month: 'Noviembre 2026', enviados: [], sin_datos: ['propinas'] }, '✗ Sin datos para Noviembre 2026 — no se envió nada'],
    ['ventas', { ok: false, error: 'Solo un owner activo puede pedir el reporte' }, '✗ Solo un owner activo puede pedir el reporte'],
  ] as const)('%s → %s', (tipo, r, msg) => {
    expect(mensajeReporte(tipo, r)).toBe(msg)
  })
})
