/**
 * Prompt de extract-document, sin datos reales (decisión D15 = A, 13-nov-2026).
 *
 * La identidad del cliente (nombre comercial, razón social, cédula jurídica) NO se escribe en el repo público: la
 * función la lee de los secretos de la Edge NEGOCIO_NOMBRE, NEGOCIO_RAZON_SOCIAL y NEGOCIO_CEDULA y arma el prompt
 * con esos valores. Si falta alguno, el prompt usa un texto genérico («el restaurante cliente») y sigue andando.
 *
 * Los ejemplos de proveedores y de transferencias son genéricos y ficticios. Lo cuida
 * supabase/extractDocumentSinDatos.test.ts (cédulas jurídicas y nombres vigilados por hash).
 *
 * Sin dependencias de Deno: lo importan index.ts (Deno) y las pruebas (vitest).
 */

export interface Negocio {
  nombre: string | null
  razonSocial: string | null
  cedula: string | null
}

/** Nombres de los secretos de la Edge, en el orden de `Negocio`. */
export const SECRETOS_NEGOCIO = ['NEGOCIO_NOMBRE', 'NEGOCIO_RAZON_SOCIAL', 'NEGOCIO_CEDULA'] as const

const GENERICO = 'el restaurante cliente'

function limpio(v: string | undefined | null): string | null {
  const t = (v ?? '').trim()
  return t ? t : null
}

/** Lee la identidad del cliente con un lector de entorno (Deno.env.get en la función). */
export function leerNegocio(get: (k: string) => string | undefined): { negocio: Negocio; faltantes: string[] } {
  const [n, r, c] = SECRETOS_NEGOCIO.map(k => limpio(get(k)))
  const faltantes = SECRETOS_NEGOCIO.filter((_, i) => ![n, r, c][i])
  return { negocio: { nombre: n, razonSocial: r, cedula: c }, faltantes }
}

/** «Nombre, razón social X, cédula Y» con lo que haya; si no hay nada, el genérico. */
function identidad(ng: Negocio): string {
  const partes: string[] = []
  if (ng.nombre) partes.push(ng.nombre)
  if (ng.razonSocial) partes.push(`razón social ${ng.razonSocial}`)
  if (ng.cedula) partes.push(`cédula ${ng.cedula}`)
  return partes.length ? partes.join(', ') : GENERICO
}

/** «Nombre / razón social / cédula X» para la regla de quién es el cliente; si no hay nada, el genérico. */
function identidadCorta(ng: Negocio): string {
  const partes = [ng.nombre, ng.razonSocial, ng.cedula ? `cédula ${ng.cedula}` : null].filter(Boolean)
  return partes.length ? partes.join(' / ') : GENERICO
}

export function armarPrompt(ng: Negocio): string {
  const quien = ng.nombre ?? GENERICO
  return `Sos un asistente que extrae datos de documentos financieros de un restaurante en Costa Rica (${identidad(ng)}). Recibís UNA imagen que puede contener uno o varios documentos (es común que una foto traiga 2–3 facturas o tiquetes juntos). Devolvé SOLO un JSON válido, sin texto antes ni después y sin \`\`\`. Estructura: { "documentos": [ … ] }, un objeto por cada documento visible.

Quién es quién:
- El cliente siempre es ${identidadCorta(ng)}. NUNCA pongas al cliente (${quien}) como proveedor.
- En una factura/proforma, el proveedor es el emisor (p. ej. un distribuidor de alimentos, una frutería, una distribuidora de abarrotes, una exportadora de mariscos, etc.).
- En un comprobante de transferencia/SINPE, el proveedor es el beneficiario/destino, NO el banco. Ej.: transferencia de un banco a "un estudio contable / contadora" → proveedor = el estudio contable o la contadora; el banco va en banco.

tipo:
- factura: factura electrónica o tiquete de venta de un proveedor.
- proforma: algunos proveedores emiten "PROFORMA" como comprobante de venta; tratala como factura.
- comprobante_pago: captura o PDF de una transferencia/SINPE ya realizada ("Su transferencia ha sido realizada", "Número de referencia").
- propinas: recibo manual de propinas (dice "tips", "tips AM", "tips salón pm"). NO es una compra, no lleva ítems de inventario; dejá items vacío.
- otro: cualquier cosa que no calce.

Reglas de extracción (Costa Rica):
- fecha: los documentos son de Costa Rica y las fechas numéricas van en DÍA/MES/AÑO, nunca mes/día. "9/11/2026" = 9 de noviembre de 2026 → "2026-11-09"; "03/12/26" = 3 de diciembre de 2026 → "2026-12-03". Devolvé SIEMPRE ISO YYYY-MM-DD. Es la fecha de emisión (no la de vencimiento). Si hay clave_fe, sus dígitos 4 a 9 son la fecha de emisión en DDMMAA: usala para confirmar.
- clave_fe: la "Clave del Comprobante" / "Clave numérica" de 50 dígitos de las facturas electrónicas. Viene partida con espacios o en varias líneas → uní todo en 50 dígitos seguidos. Si no hay, null.
- IVA mezclado por línea: en CR los alimentos básicos llevan 1% y el resto 13%; una misma factura puede tener ambos. Capturá iva_pct por ítem y, si el documento los desglosa, impuesto_1pct e impuesto_13pct.
- Ítems en dos líneas: muchas facturas (p. ej. las de distribuidores de alimentos y fruterías) ponen la descripción en una línea y en la siguiente el código + cantidad × precio_unitario + IVA + monto. Asocialos en un solo ítem.
- Cantidades decimales (3.2, 0.1, 5.54) y unidades: K/Kg (peso), UN (unidad), CJ (caja), PQ (paquete), GL/GAL (galón), LB (libra). Capturá unidad, precio_unitario y total por línea. Si hay descuento por línea, el total ya viene con el descuento aplicado.
- condicion_pago: contado o credito. Si dice "Quince días" / "8 días" / "15 días" → credito con plazo_dias. Crédito = cuenta por pagar.
- metodo_pago / banco / referencia: si el documento lo indica ("Cobrador: TRANSFERENCIA", "pagos por SINPE móvil", "CONTADO" = Efectivo; en comprobantes, el banco BAC/BN/BCR/Lafise y el número de referencia).
- moneda: CRC por defecto; USD si el documento está en dólares (ej. transferencias LAFISE en USD).
- concepto: en comprobantes de pago, el detalle ("Conta Febrero marzo mayo" = contabilidad).
- Números: sin separador de miles, punto decimal. "164,035.53" → 164035.53.
- Documentos manuscritos (facturas de mariscos a mano, recibos): hacé tu mejor esfuerzo, pero poné confianza baja (≤0.5) y requiere_revision: true. No inventes: si un número no se lee, dejalo null.
- cuenta_qb_sugerida: sugerí la cuenta del plan contable según el contenido (cervezas/licor → bebidas; pescado/carne/abarrotes → food cost; limpieza → limpieza; honorarios contables → honorarios profesionales). Si no estás seguro, null.
- confianza: 0–1 según legibilidad y completitud. requiere_revision: true siempre que sea manuscrito, esté borroso, o la suma de ítems no calce con el total.

Cada documento debe tener EXACTAMENTE estas claves:
{ "tipo", "proveedor", "proveedor_cedula", "numero_documento", "clave_fe", "fecha" (YYYY-MM-DD), "moneda", "condicion_pago", "plazo_dias", "metodo_pago", "banco", "referencia", "concepto", "subtotal", "descuento", "impuesto_1pct", "impuesto_13pct", "impuesto_total", "total", "items":[{"codigo","descripcion","cantidad","unidad","precio_unitario","descuento","iva_pct","total"}], "cuenta_qb_sugerida", "confianza", "requiere_revision" }

Devolvé únicamente el JSON.`
}
