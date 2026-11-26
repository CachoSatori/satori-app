// Parser PURO de comprobantes electrónicos de Hacienda (F1, docs/inventario/SPEC-compras-stock-costos.md §4.4).
// Lo usan las pruebas (vitest) y la Edge `fe-ingesta` (Deno): acá NO hay base, ni red, ni reloj.
//
// Reglas (spec §4.4):
//   · lee por nombre local de elemento, sin depender del espacio de nombres → sirve para v4.3 y v4.4;
//   · números con punto decimal, devueltos como TEXTO decimal (la base los guarda como numeric; nada pasa por float
//     salvo el control de la suma);
//   · un elemento desconocido se ignora; uno obligatorio ausente o un control que falla manda a «revisar» con su motivo:
//     NUNCA se descarta un comprobante que trae clave;
//   · sin clave legible (50 caracteres) no hay idempotencia posible → «roto» (la Edge lo anota en la bitácora como error).
// No valida la firma digital (spec §4.3, queda como mejora).

import { hijo, hijos, leerXml, textoDe, type NodoXml } from './xmlMini.ts'

export type TipoFe = 'factura' | 'nota_credito' | 'nota_debito' | 'tiquete' | 'factura_compra' | 'otro'

/** Raíz del XML → tipo. Lo que no está acá y trae `Clave` es «otro» (a revisar): p. ej. exportación o el R.E.P. de v4.4. */
export const RAIZ_A_TIPO: Record<string, Exclude<TipoFe, 'otro'>> = {
  FacturaElectronica: 'factura',
  NotaCreditoElectronica: 'nota_credito',
  NotaDebitoElectronica: 'nota_debito',
  TiqueteElectronico: 'tiquete',
  FacturaElectronicaCompra: 'factura_compra',
}

/** Monedas que se aceptan sin revisión. Otra moneda ISO entra igual, a «revisar». */
export const MONEDAS_CONOCIDAS = ['CRC', 'USD', 'EUR'] as const

export interface ComprobanteFe {
  clave: string
  tipo: TipoFe
  version: string | null            // '4.4', '4.3'… (del espacio de nombres); null si no se reconoce
  consecutivo: string | null
  fecha_emision: string | null      // ISO con zona: la del XML o, si no traía, `-06:00` (hora de CR)
  emisor_cedula: string | null
  emisor_tipo_id: string | null
  emisor_nombre: string | null
  emisor_nombre_comercial: string | null
  receptor_cedula: string | null
  condicion_venta: string | null
  plazo_credito: string | null
  medio_pago: string | null
  moneda: string
  tipo_cambio: string
  total_venta_neta: string | null
  total_impuesto: string | null
  total_descuentos: string | null
  total_otros_cargos: string | null
  total_comprobante: string | null
  ref_tipo_doc: string | null
  ref_clave: string | null
  ref_codigo: string | null
  ref_razon: string | null
}

export interface LineaFe {
  numero_linea: number
  cabys: string | null
  codigo_comercial_tipo: string | null
  codigo_comercial: string | null
  detalle: string | null
  cantidad: string | null
  unidad: string | null
  unidad_comercial: string | null
  precio_unitario: string | null
  monto_total: string | null
  descuento: string | null
  subtotal: string | null
  impuesto_codigo: string | null
  impuesto_tarifa: string | null
  impuesto_monto: string | null
  impuesto_neto: string | null
  total_linea: string | null
}

export type MensajeHacienda = 'aceptado' | 'parcial' | 'rechazado' | 'desconocido'

export interface RespuestaFe {
  clave: string
  mensaje: MensajeHacienda
  detalle: string | null
  receptor_cedula: string | null
}

export type ResultadoFe =
  | { clase: 'comprobante'; comprobante: ComprobanteFe; lineas: LineaFe[]; estado: 'ok' | 'revisar'; motivos: string[] }
  | { clase: 'respuesta'; respuesta: RespuestaFe }
  | { clase: 'no_comprobante'; raiz: string }
  | { clase: 'roto'; motivo: string }

const DECIMAL = /^-?\d{1,18}(\.\d{1,10})?$/
const CLAVE = /^[0-9A-Za-z]{50}$/
// ISO con o sin zona. Muchos emisores v4.4 mandan la hora local sin zona (prueba con XML reales, 25-nov): se toma como hora
// de Costa Rica y se guarda con `-06:00` (CR no tiene horario de verano), así la base la lee como timestamptz sin adivinar.
const FECHA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:Z|[+-](\d{2}):(\d{2}))?$/
const CON_ZONA = /(?:Z|[+-]\d{2}:\d{2})$/
export const ZONA_CR = '-06:00'

/** Formato válido pero calendario imposible (mes 13, 31-feb, hora 25…): la base la rechazaría (22008) y el XML quedaría
 *  como «error» para siempre; mejor «revisar» con la fecha en null. */
export function fechaFeExiste(m: RegExpExecArray): boolean {
  const [a, me, d, h, mi, se, zh, zm] = [1, 2, 3, 4, 5, 6, 7, 8].map(i => Number(m[i] ?? 0))
  if (me < 1 || me > 12 || d < 1 || h > 23 || mi > 59 || se > 59 || zh > 14 || zm > 59) return false
  return d <= new Date(Date.UTC(a, me, 0)).getUTCDate()   // día 0 del mes siguiente = último día de este
}
const TOPE_TEXTO = 500

const corto = (s: string | null, n = TOPE_TEXTO) => (s == null ? null : s.replace(/\s+/g, ' ').slice(0, n))
const soloId = (s: string | null) => (s == null ? null : s.replace(/[\s-]/g, '').slice(0, 20) || null)

/** Versión desde el `xmlns` de la raíz (…/xml-schemas/v4.4/…). */
export function versionDe(raiz: NodoXml): string | null {
  const ns = raiz.atributos.xmlns ?? Object.entries(raiz.atributos).find(([k]) => k.startsWith('xmlns'))?.[1] ?? ''
  const m = /\/v(\d+\.\d+)\//.exec(ns)
  return m ? m[1] : null
}

/** Clave → partes (spec §4.4): 506 · DDMMAA · cédula del emisor (12) · consecutivo (20) · situación (1) · seguridad (8). */
export function partesClave(clave: string) {
  return {
    pais: clave.slice(0, 3),
    dia: clave.slice(3, 5), mes: clave.slice(5, 7), anio2: clave.slice(7, 9),
    emisor: clave.slice(9, 21), consecutivo: clave.slice(21, 41), situacion: clave.slice(41, 42), seguridad: clave.slice(42, 50),
  }
}

/** Margen del control «suma de líneas = total»: el mayor entre 1 unidad y 0,1 % del total (redondeos de cada línea). */
export function margenSuma(total: number): number {
  return Math.max(1, Math.abs(total) * 0.001)
}

export function parsearFe(xml: string): ResultadoFe {
  const l = leerXml(xml)
  if (!l.ok) return { clase: 'roto', motivo: `XML ilegible: ${l.motivo}` }
  const raiz = l.raiz

  if (raiz.nombre === 'MensajeHacienda') return parsearRespuesta(raiz)

  const claveTxt = textoDe(raiz, 'Clave')
  const tipoConocido: Exclude<TipoFe, 'otro'> | undefined = RAIZ_A_TIPO[raiz.nombre]
  if (!tipoConocido && claveTxt == null) return { clase: 'no_comprobante', raiz: raiz.nombre.slice(0, 60) }
  if (claveTxt == null) return { clase: 'roto', motivo: `${raiz.nombre} sin Clave` }
  if (!CLAVE.test(claveTxt)) return { clase: 'roto', motivo: `Clave inválida (largo ${claveTxt.length}, se esperan 50)` }

  const motivos: string[] = []
  const num = (n: NodoXml | null, ruta: string, campo: string): string | null => {
    const t = textoDe(n, ruta)
    if (t == null) return null
    if (!DECIMAL.test(t)) { motivos.push(`${campo} no es un número («${t.slice(0, 20)}»)`); return null }
    return t
  }
  const obligatorio = <T>(v: T | null, campo: string): T | null => {
    if (v == null) motivos.push(`falta ${campo}`)
    return v
  }

  const tipo: TipoFe = tipoConocido ?? 'otro'
  if (!tipoConocido) motivos.push(`tipo de comprobante no previsto (${raiz.nombre.slice(0, 60)})`)
  const version = versionDe(raiz)
  if (version !== '4.4' && version !== '4.3') motivos.push(`versión no reconocida (${version ?? 'sin espacio de nombres'})`)

  // ── Clave ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const pc = partesClave(claveTxt)
  if (!/^\d{50}$/.test(claveTxt)) motivos.push('la clave trae letras (¿cédula alfanumérica nueva?)')
  if (pc.pais !== '506') motivos.push('la clave no empieza con 506')

  // ── Cabecera ───────────────────────────────────────────────────────────────────────────────────────────────────
  const resumen = hijo(raiz, 'ResumenFactura')
  let fecha = obligatorio(textoDe(raiz, 'FechaEmision'), 'FechaEmision')
  if (fecha) {
    const m = FECHA.exec(fecha)
    if (!m) { motivos.push('FechaEmision con formato desconocido'); fecha = null }   // null: la base no la puede leer
    else if (!fechaFeExiste(m)) { motivos.push('FechaEmision imposible (mes, día u hora fuera de rango)'); fecha = null }
    else {
      if (m[3] !== pc.dia || m[2] !== pc.mes || m[1].slice(2) !== pc.anio2) motivos.push('la fecha de la clave no coincide con FechaEmision')
      if (!CON_ZONA.test(fecha)) fecha = fecha + ZONA_CR   // sin zona = hora de CR; no es motivo de «revisar»
    }
  }
  // v4.4: ResumenFactura/MedioPago/TipoMedioPago · v4.3: MedioPago en la cabecera (puede venir más de uno: el primero)
  const medio = textoDe(resumen, 'MedioPago/TipoMedioPago') ?? textoDe(raiz, 'MedioPago')
  const moneda = textoDe(resumen, 'CodigoTipoMoneda/CodigoMoneda') ?? 'CRC'   // ausente = colones (v4.3)
  if (!/^[A-Z]{3}$/.test(moneda)) motivos.push(`moneda inválida («${moneda.slice(0, 10)}»)`)
  else if (!(MONEDAS_CONOCIDAS as readonly string[]).includes(moneda)) motivos.push(`moneda no prevista (${moneda})`)
  let tc = num(resumen, 'CodigoTipoMoneda/TipoCambio', 'TipoCambio') ?? '1'
  if (!(Number(tc) > 0)) { motivos.push('TipoCambio no positivo'); tc = '1' }
  // InformacionReferencia (NC/ND): v4.4 TipoDocIR · v4.3 TipoDoc
  const ref = hijo(raiz, 'InformacionReferencia')
  const refClave = textoDe(ref, 'Numero')

  const comprobante: ComprobanteFe = {
    clave: claveTxt,
    tipo,
    version,
    consecutivo: corto(obligatorio(textoDe(raiz, 'NumeroConsecutivo'), 'NumeroConsecutivo'), 20),
    fecha_emision: fecha,
    emisor_cedula: soloId(obligatorio(textoDe(raiz, 'Emisor/Identificacion/Numero'), 'cédula del emisor')),
    emisor_tipo_id: corto(textoDe(raiz, 'Emisor/Identificacion/Tipo'), 2),
    emisor_nombre: corto(textoDe(raiz, 'Emisor/Nombre'), 200),
    emisor_nombre_comercial: corto(textoDe(raiz, 'Emisor/NombreComercial'), 200),
    receptor_cedula: soloId(textoDe(raiz, 'Receptor/Identificacion/Numero')),
    condicion_venta: corto(textoDe(raiz, 'CondicionVenta'), 5),
    plazo_credito: corto(textoDe(raiz, 'PlazoCredito'), 20),
    medio_pago: corto(medio, 5),
    moneda: /^[A-Z]{3}$/.test(moneda) ? moneda : 'XXX',   // XXX (ISO «sin moneda»): entra a revisar, no se pierde
    tipo_cambio: tc,
    total_venta_neta: num(resumen, 'TotalVentaNeta', 'TotalVentaNeta'),
    total_impuesto: num(resumen, 'TotalImpuesto', 'TotalImpuesto'),
    total_descuentos: num(resumen, 'TotalDescuentos', 'TotalDescuentos'),
    total_otros_cargos: num(resumen, 'TotalOtrosCargos', 'TotalOtrosCargos'),
    total_comprobante: obligatorio(num(resumen, 'TotalComprobante', 'TotalComprobante'), 'TotalComprobante'),
    ref_tipo_doc: corto(textoDe(ref, 'TipoDocIR') ?? textoDe(ref, 'TipoDoc'), 5),
    ref_clave: corto(refClave, 50),
    ref_codigo: corto(textoDe(ref, 'Codigo'), 5),
    ref_razon: corto(textoDe(ref, 'Razon'), 300),
  }
  if (comprobante.receptor_cedula == null) motivos.push('sin cédula del receptor')
  if ((tipo === 'nota_credito' || tipo === 'nota_debito') && !refClave) motivos.push('nota sin InformacionReferencia/Numero')

  // ── Líneas ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const lineas: LineaFe[] = []
  const vistos = new Set<number>()
  hijos(hijo(raiz, 'DetalleServicio'), 'LineaDetalle').forEach((ld, idx) => {
    const nl = Number(textoDe(ld, 'NumeroLinea'))
    const numero = Number.isInteger(nl) && nl > 0 && nl < 10000 && !vistos.has(nl) ? nl : 0
    if (!numero) motivos.push(`línea ${idx + 1}: NumeroLinea ausente o repetido`)
    const n = numero || 10000 + idx
    vistos.add(n)
    // CABYS: v4.4 CodigoCABYS · v4.3 Codigo (texto simple; en v4.2 Codigo era otra cosa, con hijos: se ignora)
    const cabys = textoDe(ld, 'CodigoCABYS') ?? textoDe(ld, 'Codigo')
    const cc = hijos(ld, 'CodigoComercial')
    const elegido = cc.find(c => textoDe(c, 'Tipo') === '01') ?? cc[0] ?? null
    const imps = hijos(ld, 'Impuesto')
    const iva = imps.find(x => textoDe(x, 'Codigo') === '01') ?? imps[0] ?? null
    let impMonto: string | null = null
    if (imps.length) {
      const montos = imps.map((x, k) => num(x, 'Monto', `línea ${n} impuesto ${k + 1}`))
      impMonto = montos.every(m => m != null) ? sumaDecimal(montos as string[]) : null
    }
    lineas.push({
      numero_linea: n,
      cabys: corto(cabys, 20),
      codigo_comercial_tipo: corto(textoDe(elegido, 'Tipo'), 5),
      codigo_comercial: corto(textoDe(elegido, 'Codigo'), 40),
      detalle: corto(textoDe(ld, 'Detalle'), 300),
      cantidad: num(ld, 'Cantidad', `línea ${n} Cantidad`),
      unidad: corto(textoDe(ld, 'UnidadMedida'), 20),
      unidad_comercial: corto(textoDe(ld, 'UnidadMedidaComercial'), 40),
      precio_unitario: num(ld, 'PrecioUnitario', `línea ${n} PrecioUnitario`),
      monto_total: num(ld, 'MontoTotal', `línea ${n} MontoTotal`),
      descuento: num(ld, 'Descuento/MontoDescuento', `línea ${n} MontoDescuento`),
      subtotal: num(ld, 'SubTotal', `línea ${n} SubTotal`),
      impuesto_codigo: corto(textoDe(iva, 'Codigo'), 5),
      impuesto_tarifa: num(iva, 'Tarifa', `línea ${n} Tarifa`),
      impuesto_monto: impMonto,
      impuesto_neto: num(ld, 'ImpuestoNeto', `línea ${n} ImpuestoNeto`),
      total_linea: obligatorio(num(ld, 'MontoTotalLinea', `línea ${n} MontoTotalLinea`), `línea ${n} MontoTotalLinea`),
    })
  })
  if (!lineas.length) motivos.push('sin líneas de detalle')

  // ── Control: suma de líneas (+ otros cargos − IVA devuelto) = total ─────────────────────────────────────────────
  if (lineas.length && comprobante.total_comprobante != null && lineas.every(x => x.total_linea != null)) {
    const otros = Number(comprobante.total_otros_cargos ?? 0)
    const devuelto = Number(textoDe(resumen, 'TotalIVADevuelto') ?? 0) || 0
    const suma = lineas.reduce((a, x) => a + Number(x.total_linea), 0) + otros - devuelto
    const total = Number(comprobante.total_comprobante)
    if (Math.abs(suma - total) > margenSuma(total)) motivos.push('la suma de las líneas no calza con el total')
  }

  return { clase: 'comprobante', comprobante, lineas, estado: motivos.length ? 'revisar' : 'ok', motivos }
}

function parsearRespuesta(raiz: NodoXml): ResultadoFe {
  const clave = textoDe(raiz, 'Clave')
  if (clave == null || !CLAVE.test(clave)) return { clase: 'roto', motivo: 'MensajeHacienda sin Clave válida' }
  // Mensaje: 1 = aceptado · 2 = aceptado parcial · 3 = rechazado
  const m = textoDe(raiz, 'Mensaje')
  const mensaje: MensajeHacienda = m === '1' ? 'aceptado' : m === '2' ? 'parcial' : m === '3' ? 'rechazado' : 'desconocido'
  return {
    clase: 'respuesta',
    respuesta: {
      clave,
      mensaje,
      detalle: corto(textoDe(raiz, 'DetalleMensaje'), 1000),
      receptor_cedula: soloId(textoDe(raiz, 'NumeroCedulaReceptor')),
    },
  }
}

/** Suma exacta de decimales en texto (sin float): escala al mayor número de decimales. */
export function sumaDecimal(xs: string[]): string {
  const dec = Math.max(0, ...xs.map(x => (x.split('.')[1] ?? '').length))
  const escala = 10n ** BigInt(dec)
  const aEntero = (x: string) => {
    const neg = x.startsWith('-')
    const [e, f = ''] = (neg ? x.slice(1) : x).split('.')
    const v = BigInt(e) * escala + BigInt((f + '0'.repeat(dec)).slice(0, dec) || '0')
    return neg ? -v : v
  }
  const t = xs.reduce((a, x) => a + aEntero(x), 0n)
  const neg = t < 0n
  const abs = neg ? -t : t
  const ent = abs / escala
  const frac = dec ? '.' + (abs % escala).toString().padStart(dec, '0') : ''
  return (neg ? '-' : '') + ent.toString() + frac
}

