// Contrato PURO entre el script de Apps Script (scripts/apps-script/fe-correo/) y la Edge `fe-ingesta` (F1, spec §4.2–4.3).
// Lo usan las pruebas (vitest) y la Edge (Deno). Nada de base ni red.
//
// El script manda, por correo (o por tanda de un correo grande):
//   { fuente, lote, xmls: [{ b64 }], sin_xml? }      · fuente = rótulo de la cuenta (p. ej. 'santa-teresa'), no secreto
//   { fuente, latido: true }                        · en cada corrida, aunque no haya correos (pantalla de control)
// NUNCA el cuerpo del correo, el remitente, el asunto ni el nombre de los adjuntos (spec §4.2).

export const TOPE_CUERPO_BYTES = 2 * 1024 * 1024        // por pedido (spec §4.3)
export const TOPE_XML_BYTES = 1024 * 1024               // por XML ya decodificado
export const TOPE_XMLS_POR_PEDIDO = 20

export interface SobreFe {
  fuente: string
  lote: string
  latido: boolean
  sin_xml: boolean
  xmls: string[]          // texto XML ya decodificado (UTF-8)
}

export type Validacion = { ok: true; valor: SobreFe } | { ok: false; error: string }

const FUENTE = /^[a-z0-9][a-z0-9-]{0,39}$/
const LOTE = /^[A-Za-z0-9_-]{8,64}$/
const B64 = /^[A-Za-z0-9+/]*={0,2}$/

/** base64 → texto UTF-8 (estricto: un byte inválido no se «arregla» en silencio). null si no es base64 o UTF-8 válido. */
export function decodificarB64(b64: string): string | null {
  const limpio = b64.replace(/\s+/g, '')
  if (limpio.length % 4 !== 0 || !B64.test(limpio)) return null
  try {
    const bin = atob(limpio)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export function validarSobre(body: unknown): Validacion {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Cuerpo inválido' }
  const b = body as Record<string, unknown>
  if (typeof b.fuente !== 'string' || !FUENTE.test(b.fuente)) return { ok: false, error: 'fuente inválida' }
  if (b.latido === true) {
    return { ok: true, valor: { fuente: b.fuente, lote: '', latido: true, sin_xml: false, xmls: [] } }
  }
  if (typeof b.lote !== 'string' || !LOTE.test(b.lote)) return { ok: false, error: 'lote inválido' }
  const sinXml = b.sin_xml === true
  const lista = b.xmls ?? []
  if (!Array.isArray(lista)) return { ok: false, error: 'xmls tiene que ser una lista' }
  if (lista.length > TOPE_XMLS_POR_PEDIDO) return { ok: false, error: `más de ${TOPE_XMLS_POR_PEDIDO} XML en un pedido` }
  if (!sinXml && lista.length === 0) return { ok: false, error: 'sin XML' }
  if (sinXml && lista.length > 0) return { ok: false, error: 'sin_xml con XML adjuntos' }
  const xmls: string[] = []
  for (const [i, x] of lista.entries()) {
    const b64 = (x as { b64?: unknown } | null)?.b64
    if (typeof b64 !== 'string') return { ok: false, error: `xml ${i + 1}: falta b64` }
    if (b64.length > Math.ceil(TOPE_XML_BYTES / 3) * 4 + 4) return { ok: false, error: `xml ${i + 1}: pasa de 1 MB` }
    const texto = decodificarB64(b64)
    if (texto == null) return { ok: false, error: `xml ${i + 1}: base64 o UTF-8 inválido` }
    xmls.push(texto)
  }
  return { ok: true, valor: { fuente: b.fuente, lote: b.lote, latido: false, sin_xml: sinXml, xmls } }
}

/** Resultado por XML, el mismo que queda en `fe_ingesta_bitacora.resultado`. */
export type ResultadoIngesta = 'nuevo' | 'duplicado' | 'revisar' | 'no_comprobante' | 'sin_xml' | 'error'

/**
 * Código HTTP de la respuesta al script (spec §4.2):
 *   200 → el script etiqueta «fe-procesada» (o «fe-sin-xml»): todo quedó guardado o es un duplicado/no comprobante;
 *   422 → algún XML es ilegible: «fe-error» (lo bueno del mismo correo YA quedó guardado, y reintentarlo es idempotente);
 *   500 → falló la base: sin etiqueta, la próxima corrida reintenta.
 */
export function codigoHttp(resultados: ResultadoIngesta[], fallaBase: boolean): 200 | 422 | 500 {
  if (fallaBase) return 500
  return resultados.includes('error') ? 422 : 200
}

/**
 * Ruta del XML en el bucket privado `fe-xml`: AAAA/MM/<clave>/<sha256>.xml, con año y mes DE LA CLAVE (no depende del
 * local). El sha va en la ruta (mig 201, hallazgo 258): dos XML distintos con la misma clave nunca comparten archivo, y
 * «ese objeto ya existe» quiere decir «ese MISMO XML ya está guardado». La 201 rechaza una ruta que no termina así.
 */
export function rutaXml(clave: string, sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('rutaXml: sha256 inválido')
  const mm = clave.slice(5, 7)
  const aa = clave.slice(7, 9)
  return `20${aa}/${mm}/${clave}/${sha256}.xml`
}
