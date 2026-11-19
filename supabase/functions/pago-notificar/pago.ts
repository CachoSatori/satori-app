// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Armado PURO del comprobante de pago agrupado (decisión del dueño, 19-nov 08:48 CR): UN correo por pago,
//  con la lista de facturas que se pagaron juntas, la fecha REAL del pago (hora CR) y lo PAGADO cuando hubo
//  crédito a favor (pagado = facturado − crédito aplicado no reversado, la misma cuenta que
//  src/modules/cash/supplierCredits.ts → saldoResidual y que el comprobante PNG de la app).
//  Sin red ni Deno: lo usan index.ts y las pruebas (vitest). Solo PRESENTACIÓN: no escribe ni recalcula nada guardado.
//
//  Fecha del pago (no hay columna: approved_at nunca se llena; el pago es un cambio de status). Fuente, en este orden:
//    1. movement_edits (auditoría tamper-evident de la 052): la ÚLTIMA fila del movimiento cuyo `changed.status.new`
//       es 'aprobado' → el momento exacto en que se marcó pagado ('auditoria').
//    2. Si no hay fila legible → el día CR de created_at del movimiento ('registro'), lo que mostraba la v15. Cubre los
//       pagos que nacieron pagados o son anteriores a la auditoría y al cajero, que no
//       puede leer movement_edits (RLS owner/manager/contador).
//    3. Solo si tampoco hay created_at válido → el momento del envío ('envio'), y el correo lo rotula «enviado el»,
//       NUNCA «fecha del pago» (ronda 2: el envío rotulado como pago era una regresión frente a la v15).
//  Un reenvío días después no mueve la fecha del pago: ninguna de las fuentes 1 y 2 depende del momento del envío.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const MAX_IDS = 50
export const MENSAJE_FALTAN_IDS = 'Faltan movimiento_ids'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CR_OFFSET_MS = 6 * 60 * 60 * 1000

const N = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** Día en Costa Rica (UTC-6 fijo, sin horario de verano), `YYYY-MM-DD`. */
export function diaCR(iso: string): string {
  const t = Date.parse(iso)
  if (!isFinite(t)) return String(iso ?? '')
  return new Date(t - CR_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * Ids del cuerpo de la llamada. Nuevo: `{ movimiento_ids: uuid[] }`. Viejo (la app de antes, durante el pase):
 * `{ movimiento_id: uuid }` = lista de 1. Deduplica y conserva el orden. Error si falta, si alguno no es uuid o si
 * vienen más de MAX_IDS.
 */
export function idsDelCuerpo(body: unknown): { ids: string[] } | { error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as { movimiento_ids?: unknown; movimiento_id?: unknown }
  let crudos: unknown[]
  if (Array.isArray(b.movimiento_ids)) crudos = b.movimiento_ids
  else if (b.movimiento_id !== undefined && b.movimiento_id !== null && b.movimiento_id !== '') crudos = [b.movimiento_id]
  else return { error: MENSAJE_FALTAN_IDS }
  if (!crudos.length) return { error: MENSAJE_FALTAN_IDS }
  if (crudos.some((x) => typeof x !== 'string' || !UUID.test(x))) return { error: 'Id de movimiento inválido' }
  const ids = [...new Set(crudos as string[])]
  if (ids.length > MAX_IDS) return { error: `Máximo ${MAX_IDS} movimientos por llamada` }
  return { ids }
}

export interface MovimientoPago {
  id: string
  supplier_id: string | null
  amount_crc: number
  amount_usd: number | null
  method: string | null
  description: string | null
  subcategory?: string | null
  created_at: string
  status: string
  session_id?: string | null
}

/**
 * Valida el lote leído con el token del que llama (RLS = portón): están todos (si RLS esconde uno, no se ve → 404),
 * son todos del MISMO proveedor y están TODOS pagados ('aprobado'). Si no, no se manda nada.
 */
export function validarLote(ids: string[], movs: MovimientoPago[]):
  { ok: true; supplierId: string } | { ok: false; status: number; error: string; pendientes?: string[] } {
  const porId = new Map(movs.map((m) => [m.id, m]))
  if (ids.some((id) => !porId.has(id))) return { ok: false, status: 404, error: 'Movimiento no encontrado' }
  const lote = ids.map((id) => porId.get(id)!)
  if (lote.some((m) => !m.supplier_id)) return { ok: false, status: 400, error: 'Movimiento sin proveedor' }
  const proveedores = new Set(lote.map((m) => m.supplier_id))
  if (proveedores.size !== 1) return { ok: false, status: 400, error: 'Los movimientos son de proveedores distintos' }
  // 409 con los ids que faltan (p. ej. todavía en la cola offline): la app puede reintentar después solo con esos.
  const pendientes = lote.filter((m) => m.status !== 'aprobado').map((m) => m.id)
  if (pendientes.length) return { ok: false, status: 409, error: 'Hay movimientos que no están pagados', pendientes }
  return { ok: true, supplierId: lote[0].supplier_id as string }
}

export interface EdicionMovimiento { movement_id: string; edited_at: string; changed: unknown }
export interface AplicacionCredito { applied_to_movement_id: string | null; amount_applied: number; reversed?: boolean | null }

export type FuenteFecha = 'auditoria' | 'registro' | 'envio'

/**
 * Momento del pago de UN movimiento: la última edición que lo pasó a 'aprobado' ('auditoria'); si no hay, su
 * created_at ('registro'); solo si created_at no es una fecha válida, `ahora` ('envio', se rotula «enviado el»).
 */
export function momentoDelPago(
  m: Pick<MovimientoPago, 'id' | 'created_at'>, edits: EdicionMovimiento[], ahora: string,
): { iso: string; fuente: FuenteFecha } {
  let mejor: string | null = null
  for (const e of edits) {
    if (e.movement_id !== m.id) continue
    const st = (e.changed as { status?: { new?: unknown } } | null)?.status
    if (!st || st.new !== 'aprobado') continue
    if (!isFinite(Date.parse(e.edited_at))) continue
    if (mejor === null || Date.parse(e.edited_at) > Date.parse(mejor)) mejor = e.edited_at
  }
  if (mejor) return { iso: mejor, fuente: 'auditoria' }
  if (m.created_at && isFinite(Date.parse(m.created_at))) return { iso: m.created_at, fuente: 'registro' }
  return { iso: ahora, fuente: 'envio' }
}

export interface FilaFactura {
  id: string
  fecha: string       // día de la factura en caja (sesión o día CR de created_at), YYYY-MM-DD
  referencia: string
  facturadoCRC: number
  creditoCRC: number  // crédito a favor aplicado (no reversado)
  pagadoCRC: number   // facturado − crédito = lo transferido
  usd: number
}

export interface Pago {
  filas: FilaFactura[]
  totalFacturadoCRC: number
  totalCreditoCRC: number
  totalPagadoCRC: number
  totalUSD: number
  /** Día CR del pago; si las facturas se marcaron en días distintos (reenvío de varias), desde/hasta. Con
   *  `fuenteFecha = 'envio'` es el día del ENVÍO (ninguna fuente confiable) y el correo lo rotula «enviado el». */
  fechaPago: { desde: string; hasta: string }
  fuenteFecha: FuenteFecha | 'mixta'
  metodo: string
}

/**
 * Arma el pago. `fechaFactura` (id → YYYY-MM-DD) = el día de la sesión de caja si se pudo leer (lo mismo que ve el
 * personal en Pendientes); si no, el día CR de created_at. Orden: fecha y, a igual fecha, id (R06).
 */
export function armarPago(input: {
  movs: MovimientoPago[]
  aplicaciones: AplicacionCredito[]
  edits: EdicionMovimiento[]
  ahora: string
  fechaFactura?: Record<string, string>
}): Pago {
  const vivas = input.aplicaciones.filter((a) => !a.reversed)
  const filas: FilaFactura[] = input.movs.map((m) => {
    const credito = r2(vivas.filter((a) => a.applied_to_movement_id === m.id).reduce((s, a) => s + N(a.amount_applied), 0))
    const facturado = N(m.amount_crc)
    return {
      id: m.id,
      fecha: input.fechaFactura?.[m.id] || diaCR(m.created_at),
      referencia: (m.description || m.subcategory || '').trim(),   // como la app (comprobanteProveedor.ts)
      facturadoCRC: facturado,
      creditoCRC: credito,
      pagadoCRC: r2(facturado - credito),
      usd: N(m.amount_usd) > 0 ? N(m.amount_usd) : 0,
    }
  }).sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const momentos = input.movs.map((m) => momentoDelPago(m, input.edits, input.ahora))
  // El rango sale solo de las fechas confiables (auditoría o registro). El envío entra únicamente si no hay ninguna.
  const confiables = momentos.filter((x) => x.fuente !== 'envio')
  const usados = confiables.length ? confiables : momentos
  const dias = usados.map((x) => diaCR(x.iso)).sort()
  const fuentes = new Set(usados.map((x) => x.fuente))
  const metodos = [...new Set(input.movs.map((m) => (m.method ?? '').trim() || 'Transferencia'))].sort()

  const totalPagadoCRC = r2(filas.reduce((s, f) => s + f.pagadoCRC, 0))
  const totalUSD = r2(filas.reduce((s, f) => s + f.usd, 0))
  return {
    filas,
    totalFacturadoCRC: r2(filas.reduce((s, f) => s + f.facturadoCRC, 0)),
    totalCreditoCRC: r2(filas.reduce((s, f) => s + f.creditoCRC, 0)),
    totalPagadoCRC,
    totalUSD,
    fechaPago: { desde: dias[0], hasta: dias[dias.length - 1] },
    fuenteFecha: fuentes.size === 1 ? [...fuentes][0] : 'mixta',
    metodo: metodos.length === 1 ? metodos[0] : metodos.slice(0, -1).join(', ') + ' y ' + metodos[metodos.length - 1],
  }
}
