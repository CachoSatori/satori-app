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
// (12-nov, el dueño) Si lo que bloquea es un documento «nuevo» (esperando en la Bandeja), el aviso dice qué hacer.
const queDocumento = (tipo: 'foto' | 'clave') => (tipo === 'foto' ? 'Esta foto' : 'Esta factura (misma clave FE)')
export const MSG_EN_BANDEJA = (tipo: 'foto' | 'clave', cuando: string) =>
  `${queDocumento(tipo)} ya está en la Bandeja esperando confirmación${cuando ? ` (cargada el ${cuando})` : ''}. No se registró nada: confirmala ahí.`
export const MSG_EN_ESTA_BANDEJA = (tipo: 'foto' | 'clave', cuando: string) =>
  `${queDocumento(tipo)} ya está en esta Bandeja esperando confirmación${cuando ? ` (cargada el ${cuando})` : ''}. No se registró nada: confirmala en la lista.`

/**
 * El aviso de bloqueo según QUÉ bloquea: un documento «nuevo» de la Bandeja → «confirmala ahí» (en la Bandeja misma,
 * «confirmala en la lista»); uno ya enlazado a un pago → «ya fue cargada… descartá la anterior».
 */
export function mensajeBloqueo(tipo: 'foto' | 'clave', doc: ConFecha, donde: 'caja' | 'bandeja'): string {
  const cuando = fechaCortaCR(doc.created_at)
  if (doc.estado === 'nuevo') return donde === 'bandeja' ? MSG_EN_ESTA_BANDEJA(tipo, cuando) : MSG_EN_BANDEJA(tipo, cuando)
  return tipo === 'foto' ? MSG_FOTO_DUPLICADA(cuando) : MSG_CLAVE_DUPLICADA(cuando)
}
export const MSG_PARECIDA = (cuando: string, numero: string) =>
  `Ya hay una factura de este proveedor con el número ${numero} por el mismo total${cuando ? `, cargada el ${cuando}` : ''}. Si es otra factura, tocá «Es otra».`
// (#149, el dueño) Una foto con varias facturas se carga UNA POR UNA en el asistente (nada va a la Bandeja).
export const MSG_VARIAS_FACTURAS = (n: number, i: number) =>
  i === 1 ? `Esta foto tiene ${n} facturas: las vas a cargar una por una. Factura 1 de ${n}.` : `Factura ${i} de ${n}.`
export const MSG_QUEDAN_SIN_CARGAR = (k: number) =>
  k === 1 ? 'Queda 1 factura de esta foto sin cargar. ¿Salir igual?' : `Quedan ${k} facturas de esta foto sin cargar. ¿Salir igual?`
// «➕ Agregar foto» adjunta UNA foto a UN pago: si trae varias facturas, enlaza solo una y avisa.
export const MSG_FOTO_VARIAS_PAGO = (n: number) =>
  `La foto tiene ${n} facturas: solo se enlazó una; cargá las otras con ➕ Agregar factura.`

/**
 * (#149) El cierre del recorrido de una foto con varias facturas: qué se registró, qué se salteó y qué quedó sin cargar.
 * null = todas registradas y sin avisos (el asistente se cierra como siempre). Las que quedaron sin cargar no se pueden
 * volver a cargar subiendo la MISMA foto: el asistente reconoce las ya registradas y ofrece solo las que faltan (D11 = B).
 */
export function resumenVarias(total: number, hechas: number, salteadas: number, postAvisos: string[]): { titulo: string; aviso: string } | null {
  const faltan = Math.max(0, total - hechas - salteadas)
  if (!salteadas && !faltan && !postAvisos.length) return null
  const partes = [`Se registraron ${hechas} de ${total} facturas de la foto.`]
  if (salteadas) partes.push(salteadas === 1 ? '1 se salteó (no se registró).' : `${salteadas} se saltearon (no se registraron).`)
  // (D11 = B) Subiendo la MISMA foto, el asistente ofrece solo las que faltan.
  if (faltan) partes.push(faltan === 1
    ? '1 no se cargó: cargala con ➕ Agregar factura subiendo la misma foto: te va a ofrecer solo la que falta.'
    : `${faltan} no se cargaron: cargalas con ➕ Agregar factura subiendo la misma foto: te va a ofrecer solo las que faltan.`)
  partes.push(...postAvisos)
  const titulo = hechas === 0 ? 'No se registró ninguna factura.'
    : hechas === 1 ? '✓ Quedó registrada 1 factura.' : `✓ Quedaron registradas ${hechas} facturas.`
  return { titulo, aviso: partes.join(' ') }
}

/**
 * (#149) «➕ Agregar foto» con varias facturas: cuál se enlaza al pago. La de total más parecido al del pago (en su
 * moneda; si el pago no tiene monto en la moneda de la factura, no compite); si no hay con qué comparar, la primera.
 */
export function elegirParaPago<T extends { total?: number | string | null; moneda?: string | null }>(
  docs: T[], pago: { amount_crc?: number | null; amount_usd?: number | null },
): number {
  let mejor = 0, dif = Infinity
  docs.forEach((d, i) => {
    const t = Number(d.total)
    if (d.total == null || !Number.isFinite(t)) return
    const ref = Number(d.moneda === 'USD' ? pago.amount_usd : pago.amount_crc) || 0
    if (ref <= 0) return   // el pago no tiene monto en esa moneda: no se compara
    const x = Math.abs(t - ref)
    if (x < dif) { dif = x; mejor = i }
  })
  return mejor
}

// (13-nov, verificación) Si no se pudo consultar si la factura ya está cargada, NO se registra nada («falla cerrada»).
export const MSG_NO_VERIFICA = 'No se pudo verificar si la factura ya está cargada. Revisá la conexión y reintentá.'

/**
 * (13-nov, verificación) El aviso ÚNICO después de un pago ya registrado con foto. `enlaceFallo`: la factura no se
 * enlazó al movimiento; `extrasFallidos`: cuántos de los otros documentos de la foto no pasaron a la Bandeja.
 * Si el enlace falló NUNCA se manda a la Bandeja: la factura entraría como «nuevo» y el pago se haría dos veces.
 * Si solo fallaron los extras, la Bandeja bloquearía la misma foto → cada documento va con su propia foto.
 */
export function mensajePostPago(enlaceFallo: boolean, extrasFallidos: number): string | null {
  if (enlaceFallo) {
    const base = 'El pago se registró, pero la factura no se enlazó: adjuntala en Revisión de inventario. No la subas a la Bandeja: se pagaría dos veces.'
    return extrasFallidos > 0 ? `${base} Tampoco pasaron ${extrasFallidos} documento(s) más de la foto: avisá al encargado.` : base
  }
  if (extrasFallidos > 0) return `El pago se registró, pero ${extrasFallidos} documento(s) más de la foto no pasaron a la Bandeja: cargá cada uno con su propia foto.`
  return null
}

// ── Revisión de los documentos de una foto (la usan las tres pantallas) ──────────────────────────────────────────────
export interface ConFecha { created_at: string; estado?: string | null }
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
export function politicaBandeja<T>(rev: DocRevisado<T>[]): { entran: T[]; bloqueados: number; parecidos: number; cuandoBloqueo: string; docBloqueo: ConFecha | null } {
  const bloq = rev.filter(r => r.claveRepetida)
  return {
    docBloqueo: bloq[0]?.claveRepetida ?? null,
    entran: rev.filter(r => !r.claveRepetida).map(r => r.doc),
    bloqueados: bloq.length,
    parecidos: rev.filter(r => !r.claveRepetida && r.parecida).length,
    cuandoBloqueo: bloq.length ? fechaCortaCR(bloq[0].claveRepetida!.created_at) : '',
  }
}

// ── (D11 = B, 13-nov) La MISMA foto subida otra vez después de cargar solo algunas de sus facturas ───────────────────
export const msgProgreso = (k: number, i: number, parcial: { registradas: number; total: number; enBandeja?: number } | null) => {
  if (!parcial || i !== 1) return MSG_VARIAS_FACTURAS(k, i)
  // (re-verificación) No afirma que las otras estén sin registrar: dice que hay que revisarlas.
  const revisar = k === 1 ? 'Revisá la otra: Factura 1 de 1.' : `Revisá las otras ${k} una por una: Factura 1 de ${k}.`
  if (parcial.registradas === 0) {
    return `Esta foto ya se había cargado: no se reconoció ninguna de sus ${parcial.total} facturas como registrada. ${k === 1 ? 'Revisala: Factura 1 de 1.' : `Revisalas una por una: Factura 1 de ${k}.`}`
  }
  const b = parcial.enBandeja ?? 0
  const bandeja = b ? ` (${b === 1 ? '1 está' : `${b} están`} en la Bandeja esperando confirmación)` : ''
  return `Esta foto ya se había cargado: ${parcial.registradas} de ${parcial.total} facturas ya están registradas${bandeja}. ${revisar}`
}
export const MSG_INDETERMINADA = (cuando: string) =>
  `Esta foto ya se había cargado${cuando ? ` (el ${cuando})` : ''} y no se puede confirmar si esta factura ya se pagó. Revisá en Pagos a proveedores: si no está, tocá «Es otra»; si ya está, «Saltear esta factura».`
// (verificación #154) La misma factura dos veces en una foto, comparada contra las YA registradas en esta pasada.
export const MSG_YA_EN_ESTA_CARGA = 'Esta factura (misma clave FE) ya se registró en esta misma foto. No se va a registrar otra vez: tocá «Saltear esta factura».'
export const MSG_PARECIDA_EN_ESTA_CARGA = 'Ya registraste una factura igual en esta misma foto (mismo proveedor, número y total). Si es otra, tocá «Es otra»; si no, «Saltear esta factura».'

/** Clave FE comparable: solo dígitos; menos de 20 dígitos no es una clave de verdad → ''. */
const normClave = (c: string | null | undefined) => { const d = String(c ?? '').replace(/\D/g, ''); return d.length >= 20 ? d : '' }

type Leida = FacturaComparable & { clave_fe?: string | null }

/**
 * (verificación #154) ¿La factura `ex` ya se registró en ESTA pasada (lista en memoria)? 'clave' = misma clave FE
 * (bloquea: solo saltear); 'parecida' = sin poder comparar claves, mismo proveedor + número + total (Es otra / Saltear).
 */
export function enEstaPasada(ex: Leida, registradas: Leida[]): 'clave' | 'parecida' | null {
  const c = normClave(ex.clave_fe)
  let parecida = false
  for (const r of registradas) {
    const rc = normClave(r.clave_fe)
    if (c && rc) { if (c === rc) return 'clave'; continue }   // las dos con clave: manda la clave
    if (mismaFactura(ex, r)) parecida = true
  }
  return parecida ? 'parecida' : null
}

/**
 * (D11 = B) Cruza las facturas leídas de una foto contra los documentos VIGENTES de ese mismo sha. Registrada: primero
 * por clave FE; si la factura no tiene clave, por `mismaFactura`. Cada documento previo cuenta para UNA factura.
 * (re-verificación #154) `dudas[i]`: TODA factura no reconocida es duda, aunque no quede ningún documento libre ni
 * las claves difieran: su pago puede existir SIN documento (en la primera pasada el movimiento se creó y el enlace
 * falló). La pantalla la trata como «parecida»: nunca se confirma sin «Es otra». `enBandeja`/`docBandeja`: las
 * reconocidas que están en la Bandeja esperando confirmación («nuevo»), para que el aviso lo diga.
 */
export function cruzarConFoto<P extends ConFecha & { clave_fe?: string | null; raw_json?: Leida | null }>(
  docs: Leida[], previos: P[],
): { registradas: boolean[]; dudas: (P | null)[]; enBandeja: number; docBandeja: P | null } {
  const usados = new Set<number>()
  const registradas = docs.map(() => false)
  docs.forEach((d, i) => {
    const c = normClave(d.clave_fe)
    if (!c) return
    const j = previos.findIndex((p, k) => !usados.has(k) && normClave(p.clave_fe ?? p.raw_json?.clave_fe) === c)
    if (j >= 0) { usados.add(j); registradas[i] = true }
  })
  docs.forEach((d, i) => {
    if (registradas[i] || normClave(d.clave_fe)) return
    const j = previos.findIndex((p, k) => !usados.has(k) && !!p.raw_json && mismaFactura(d, p.raw_json))
    if (j >= 0) { usados.add(j); registradas[i] = true }
  })
  const libres = previos.filter((_, k) => !usados.has(k))
  const ref = libres[0] ?? previos[previos.length - 1] ?? null   // para la fecha del aviso
  const dudas = docs.map((_, i) => (registradas[i] ? null : ref))
  const enBandejaDocs = previos.filter((p, k) => usados.has(k) && p.estado === 'nuevo')
  return { registradas, dudas, enBandeja: enBandejaDocs.length, docBandeja: enBandejaDocs[0] ?? null }
}
