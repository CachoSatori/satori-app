// Armado puro del pago agrupado (19-nov). Datos FICTICIOS.
import { describe, it, expect } from 'vitest'
import { armarPago, diaCR, idsDelCuerpo, momentoDelPago, validarLote, MAX_IDS, MENSAJE_FALTAN_IDS } from './pago.ts'
import { facturaA, facturaB, editsEjemplo, aplicacionesEjemplo, ENVIO_ISO, PAGO_ISO, ids } from './plantilla.ejemplo.ts'

describe('idsDelCuerpo', () => {
  it('nuevo: movimiento_ids (deduplica, conserva el orden)', () => {
    expect(idsDelCuerpo({ movimiento_ids: [ids.b, ids.a, ids.b] })).toEqual({ ids: [ids.b, ids.a] })
  })
  it('viejo: movimiento_id = lista de 1 (la app anterior sigue funcionando durante el pase)', () => {
    expect(idsDelCuerpo({ movimiento_id: ids.a })).toEqual({ ids: [ids.a] })
  })
  it('vacío, no uuid o demasiados → error (y nunca el mensaje exacto de la función vieja)', () => {
    expect(idsDelCuerpo({})).toEqual({ error: MENSAJE_FALTAN_IDS })
    expect(idsDelCuerpo({ movimiento_ids: [] })).toEqual({ error: MENSAJE_FALTAN_IDS })
    expect(idsDelCuerpo(null)).toEqual({ error: MENSAJE_FALTAN_IDS })
    expect(idsDelCuerpo({ movimiento_ids: ['x'] })).toHaveProperty('error')
    expect(idsDelCuerpo({ movimiento_ids: [1] })).toHaveProperty('error')
    const muchos = Array.from({ length: MAX_IDS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect(idsDelCuerpo({ movimiento_ids: muchos })).toHaveProperty('error')
    // La app usa «Falta movimiento_id» (texto de la función vieja) para saber que tiene que caer a una llamada por id.
    expect(MENSAJE_FALTAN_IDS).not.toBe('Falta movimiento_id')
  })
})

describe('validarLote', () => {
  it('todos del mismo proveedor y pagados → ok', () => {
    expect(validarLote([ids.a, ids.b], [facturaA, facturaB])).toEqual({ ok: true, supplierId: 'prov-ejemplo' })
  })
  it('uno no visible (RLS) → 404', () => {
    expect(validarLote([ids.a, ids.b], [facturaA])).toMatchObject({ ok: false, status: 404 })
  })
  it('proveedores distintos → 400', () => {
    expect(validarLote([ids.a, ids.b], [facturaA, { ...facturaB, supplier_id: 'otro' }])).toMatchObject({ ok: false, status: 400 })
  })
  it('alguno sin pagar → 409 (no se manda nada)', () => {
    expect(validarLote([ids.a, ids.b], [facturaA, { ...facturaB, status: 'pendiente' }])).toMatchObject({ ok: false, status: 409 })
  })
  it('sin proveedor → no se manda', () => {
    expect(validarLote([ids.a], [{ ...facturaA, supplier_id: null }])).toMatchObject({ ok: false, error: 'Movimiento sin proveedor' })
  })
})

describe('fecha del pago', () => {
  it('sale de la auditoría (cambio a «aprobado»), no de la factura ni de otra edición', () => {
    expect(momentoDelPago(ids.a, editsEjemplo, ENVIO_ISO)).toEqual({ iso: PAGO_ISO, fuente: 'auditoria' })
  })
  it('una edición posterior al pago que no cambia el estado no mueve la fecha', () => {
    const e = [...editsEjemplo, { movement_id: ids.a, edited_at: '2026-11-21T15:00:00Z', changed: { method: { old: 'Transferencia', new: 'SINPE' } } }]
    expect(momentoDelPago(ids.a, e, ENVIO_ISO).iso).toBe(PAGO_ISO)
  })
  it('sin auditoría legible (cajero) → el momento del envío', () => {
    expect(momentoDelPago(ids.a, [], ENVIO_ISO)).toEqual({ iso: ENVIO_ISO, fuente: 'envio' })
  })
  it('si se pagó, se volvió a pendiente y se pagó otra vez, vale el último pago', () => {
    const e = [
      { movement_id: ids.a, edited_at: '2026-11-15T15:00:00Z', changed: { status: { old: 'pendiente', new: 'aprobado' } } },
      { movement_id: ids.a, edited_at: '2026-11-16T15:00:00Z', changed: { status: { old: 'aprobado', new: 'pendiente' } } },
      { movement_id: ids.a, edited_at: PAGO_ISO, changed: { status: { old: 'pendiente', new: 'aprobado' } } },
    ]
    expect(momentoDelPago(ids.a, e, ENVIO_ISO).iso).toBe(PAGO_ISO)
  })
  it('día de Costa Rica: 21:40 CR del 19 = 03:40 UTC del 20 → 19-nov', () => {
    expect(diaCR(PAGO_ISO)).toBe('2026-11-19')
    const p = armarPago({ movs: [facturaA, facturaB], aplicaciones: [], edits: editsEjemplo, ahora: ENVIO_ISO })
    expect(p.fechaPago).toEqual({ desde: '2026-11-19', hasta: '2026-11-19' })
    expect(p.fuenteFecha).toBe('auditoria')
  })
  it('pagos en días distintos (reenvío de varias) → desde/hasta', () => {
    const e = [...editsEjemplo.filter((x) => x.movement_id !== ids.b),
      { movement_id: ids.b, edited_at: '2026-11-18T18:00:00Z', changed: { status: { old: 'pendiente', new: 'aprobado' } } }]
    const p = armarPago({ movs: [facturaA, facturaB], aplicaciones: [], edits: e, ahora: ENVIO_ISO })
    expect(p.fechaPago).toEqual({ desde: '2026-11-18', hasta: '2026-11-19' })
  })
})

describe('montos', () => {
  const p = armarPago({ movs: [facturaB, facturaA], aplicaciones: aplicacionesEjemplo, edits: editsEjemplo, ahora: ENVIO_ISO })
  it('pagado = facturado − crédito aplicado no reversado, por factura y en total', () => {
    const a = p.filas.find((f) => f.id === ids.a)!
    expect(a).toMatchObject({ facturadoCRC: 120_000, creditoCRC: 20_000, pagadoCRC: 100_000 })
    expect(p.filas.find((f) => f.id === ids.b)).toMatchObject({ facturadoCRC: 66_450, creditoCRC: 0, pagadoCRC: 66_450 })
    expect(p.totalFacturadoCRC).toBe(186_450)
    expect(p.totalCreditoCRC).toBe(20_000)
    expect(p.totalPagadoCRC).toBe(166_450)
  })
  it('fecha de la factura: la de la sesión si se pudo leer; si no, el día CR de created_at', () => {
    expect(p.filas.map((f) => f.fecha)).toEqual(['2026-11-03', '2026-11-10'])
    const q = armarPago({ movs: [facturaA], aplicaciones: [], edits: [], ahora: ENVIO_ISO, fechaFactura: { [ids.a]: '2026-11-02' } })
    expect(q.filas[0].fecha).toBe('2026-11-02')
  })
})
