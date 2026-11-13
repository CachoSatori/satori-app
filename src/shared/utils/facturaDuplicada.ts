/**
 * (13-nov, decisiones del dueño) Reglas de duplicados de facturas, PURAS (sin red), para el asistente «Agregar» de Caja,
 * «➕ Agregar foto» de Caja/Proveedores y la Bandeja:
 *  · misma foto (sha256) o misma clave FE de un documento VIGENTE (`documentoVigente`) → BLOQUEA, sin excepción de rol
 *    (eso lo hacen las pantallas con findDuplicate); los huérfanos y los descartados no cuentan;
 *  · mismo proveedor + mismo número + mismo total con OTRA foto → AVISO no bloqueante («Es otra»): `mismaFactura`.
 */

/** Número de factura comparable: sin espacios ni signos, en mayúsculas y sin ceros a la izquierda («0354099» = «354099»). */
export function normNumero(n: string | null | undefined): string {
  return String(n ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^0+(?=.)/, '')
}

/**
 * (13-nov) ¿Cuenta este documento para los duplicados? Solo los VIGENTES: los «nuevo» (en la Bandeja, esperando) y los
 * «procesado» que siguen enlazados a un movimiento. NO cuentan los «descartado» ni los huérfanos («procesado» cuyo
 * movimiento se borró: la FK deja `linked_movement_id` en null). Si no, el huérfano bloquearía la recarga legítima de
 * esa misma factura (pasó el 12-nov: movimiento borrado a las 17:01, la misma foto recargada a las 17:26).
 */
export function documentoVigente(d: { estado?: string | null; linked_movement_id?: string | null }): boolean {
  if (d.estado === 'nuevo') return true
  return d.estado === 'procesado' && !!d.linked_movement_id
}

/** Nombre de proveedor comparable: sin acentos, minúsculas y espacios simples. */
export function normProveedor(p: string | null | undefined): string {
  return String(p ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Cédula comparable: solo dígitos. */
const normCedula = (c: string | null | undefined) => String(c ?? '').replace(/\D/g, '')

export interface FacturaComparable {
  proveedor?: string | null
  proveedor_cedula?: string | null
  numero_documento?: string | null
  total?: number | string | null
  moneda?: string | null
}

/**
 * ¿Es la misma factura? Mismo número (no vacío), mismo total (±0,5) y misma moneda, y el mismo proveedor: por cédula si
 * las dos la traen, si no por nombre. Sin número no se puede decir: false (no se avisa por proveedor + total solos:
 * en prod eran compras legítimas que se repiten).
 */
export function mismaFactura(a: FacturaComparable, b: FacturaComparable): boolean {
  const na = normNumero(a.numero_documento), nb = normNumero(b.numero_documento)
  if (!na || na !== nb) return false
  const ta = Number(a.total), tb = Number(b.total)
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || Math.abs(ta - tb) > 0.5) return false
  if ((a.moneda || 'CRC') !== (b.moneda || 'CRC')) return false
  const ca = normCedula(a.proveedor_cedula), cb = normCedula(b.proveedor_cedula)
  if (ca && cb) return ca === cb
  const pa = normProveedor(a.proveedor), pb = normProveedor(b.proveedor)
  return pa !== '' && pa === pb
}

/** Fecha corta de Costa Rica (UTC−6 fijo) para los avisos: «12-nov 17:32». */
export function fechaCortaCR(iso: string | null | undefined): string {
  const ms = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms - 6 * 3600 * 1000)
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic']
  return `${d.getUTCDate()}-${meses[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export const MSG_FOTO_DUPLICADA = (cuando: string) =>
  `Esta foto ya fue cargada${cuando ? ` (el ${cuando})` : ''}. No se registró nada. Para volver a cargarla, primero descartá la anterior.`
export const MSG_CLAVE_DUPLICADA = (cuando: string) =>
  `Esta factura (misma clave FE) ya fue cargada${cuando ? ` (el ${cuando})` : ''}. No se registró nada. Para volver a cargarla, primero descartá la anterior.`
export const MSG_PARECIDA = (cuando: string, numero: string) =>
  `Ya hay una factura de este proveedor con el número ${numero} por el mismo total${cuando ? `, cargada el ${cuando}` : ''}. Si es otra factura, tocá «Es otra».`
export const MSG_VARIOS_DOCS = (n: number, k: number) =>
  `Esta foto tiene ${n} documentos: el primero está acá; ${k === 1 ? 'el otro queda' : `los otros ${k} quedan`} en la Bandeja para confirmar.`

// ── Revisión de los documentos de una foto (la usan las tres pantallas) ──────────────────────────────────────────────
interface ConFecha { created_at: string }
export interface DocRevisado<T> { doc: T; claveRepetida: ConFecha | null; parecida: ConFecha | null }

/** Para cada documento leído de la foto: ¿su clave FE ya está cargada? ¿se parece a una factura ya cargada? (red inyectada) */
export async function revisarDocumentos<T extends FacturaComparable & { clave_fe?: string | null }>(
  docs: T[],
  deps: { porClave: (clave: string) => Promise<ConFecha | null>; parecida: (doc: T) => Promise<ConFecha | null> },
): Promise<DocRevisado<T>[]> {
  const out: DocRevisado<T>[] = []
  for (const doc of docs) {
    const claveRepetida = doc.clave_fe ? await deps.porClave(doc.clave_fe) : null
    const parecida = claveRepetida ? null : await deps.parecida(doc)
    out.push({ doc, claveRepetida, parecida })
  }
  return out
}

/**
 * Asistente «Agregar» y «➕ Agregar foto» de Caja/Proveedores (decisiones del dueño, 13-nov): el PRIMER documento es el
 * de la pantalla; si su clave FE ya está cargada, se bloquea TODO (no se precarga ni se enlaza nada). Los demás van a la
 * Bandeja, salvo los que tengan su clave FE ya cargada (se saltean). La parecida es la del primero (aviso «Es otra»).
 */
export function politicaPantalla<T>(rev: DocRevisado<T>[]): { bloqueo: ConFecha | null; primero: T | null; extras: T[]; saltados: number; parecida: ConFecha | null } {
  if (rev.length && rev[0].claveRepetida) return { bloqueo: rev[0].claveRepetida, primero: null, extras: [], saltados: 0, parecida: null }
  const extras = rev.slice(1).filter(r => !r.claveRepetida).map(r => r.doc)
  return { bloqueo: null, primero: rev[0]?.doc ?? null, extras, saltados: rev.slice(1).length - extras.length, parecida: rev[0]?.parecida ?? null }
}

/** Bandeja (13-nov): entra cada documento cuya clave FE no esté cargada; los parecidos entran con aviso. */
export function politicaBandeja<T>(rev: DocRevisado<T>[]): { entran: T[]; bloqueados: number; parecidos: number; cuandoBloqueo: string } {
  const bloq = rev.filter(r => r.claveRepetida)
  return {
    entran: rev.filter(r => !r.claveRepetida).map(r => r.doc),
    bloqueados: bloq.length,
    parecidos: rev.filter(r => !r.claveRepetida && r.parecida).length,
    cuandoBloqueo: bloq.length ? fechaCortaCR(bloq[0].claveRepetida!.created_at) : '',
  }
}
