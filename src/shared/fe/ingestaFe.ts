// Orquestación PURA de la Edge `fe-ingesta` (F1, spec §4.3): qué hace con cada XML de un sobre ya validado.
// Las dependencias (base, Storage, hash) se inyectan: la Edge le pasa las reales (Deno + supabase-js) y las pruebas,
// unas falsas en memoria. Acá no hay red ni secretos.
//
// Por XML:
//   roto            → bitácora «error» con el motivo                                  (el correo queda «fe-error»: 422)
//   no_comprobante  → bitácora «no_comprobante»                                       (200)
//   respuesta       → fe_respuesta_registrar (nuevo / duplicado)                      (200)
//   comprobante     → sube el XML a fe-xml (AAAA/MM/clave.xml; si ya está, sigue) y fe_ingestar, UNA transacción por
//                     comprobante en la base (nuevo / duplicado / revisar)             (200)
//   dato que la base rechaza (SQLSTATE 22xxx / 23xxx) → bitácora «error»              (422: reintentar no lo arregla)
//   falla de red, de Storage o de la base           → 500: el script NO etiqueta y reintenta (todo es idempotente)
// Siempre anota el latido de la fuente (la pantalla de control sabe que el script corre).

import { parsearFe } from './parseFe.ts'
import { codigoHttp, rutaXml, type ResultadoIngesta, type SobreFe } from './sobreFe.ts'

export interface ErrorRpc { code?: string; message: string }
export interface DepsIngesta {
  sha256(texto: string): Promise<string>
  /** Sube el XML; 'ya_existe' si la ruta ya tiene un objeto. Tira si falla. */
  subirXml(ruta: string, xml: string): Promise<'ok' | 'ya_existe'>
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: ErrorRpc | null }>
}

export interface ResultadoXml { i: number; resultado: ResultadoIngesta; clave_fin?: string; motivo?: string }
export interface RespuestaIngesta { status: 200 | 422 | 500; cuerpo: { ok: boolean; latido?: true; resultados: ResultadoXml[] } }

/**
 * ¿El error de Storage al subir dice «ese objeto ya existe»? Es el reintento normal (el mismo XML llegó antes, o el
 * script reintentó tras un 500): se trata como ÉXITO idempotente y la base decide «duplicado». Si no se detecta, cada
 * reintento daría 500 para siempre y el correo nunca se etiquetaría.
 * Formas que manda storage-js según versión: `statusCode: '409'` (código del cuerpo), `status: 409` o `400` con
 * `error: 'Duplicate'`, y el mensaje «The resource already exists».
 */
export function esYaExisteStorage(e: unknown): boolean {
  if (e == null || typeof e !== 'object') return false
  const x = e as { statusCode?: unknown; status?: unknown; error?: unknown; message?: unknown }
  if (String(x.statusCode ?? '') === '409' || String(x.status ?? '') === '409') return true
  if (typeof x.error === 'string' && /^duplicate$/i.test(x.error.trim())) return true
  return typeof x.message === 'string' && /already exists|\bduplicate\b/i.test(x.message)
}

/** Lo que hace la Edge con la respuesta del `upload` de Storage (pura: la Edge le pasa la llamada real). */
export async function subirIdempotente(subir: () => Promise<{ error: unknown }>): Promise<'ok' | 'ya_existe'> {
  const { error } = await subir()
  if (!error) return 'ok'
  if (esYaExisteStorage(error)) return 'ya_existe'
  throw new Error(`storage: ${(error as { message?: string }).message ?? 'error'}`)
}

/** SQLSTATE de dato inválido o de restricción: el XML no entra nunca, reintentarlo no sirve. */
export const esErrorDeDato = (e: ErrorRpc | null) => !!e?.code && /^(22|23)/.test(e.code)

export async function procesarSobre(s: SobreFe, deps: DepsIngesta): Promise<RespuestaIngesta> {
  let fallaBase = false
  const lat = await deps.rpc('fe_latido', { p_fuente: s.fuente })
  if (lat.error) fallaBase = true
  if (s.latido) return { status: fallaBase ? 500 : 200, cuerpo: { ok: !fallaBase, latido: true, resultados: [] } }

  const anotar = async (resultado: ResultadoIngesta, clave: string | null, motivo: string | null) => {
    const { error } = await deps.rpc('fe_bitacora_anotar', {
      p_fuente: s.fuente, p_lote: s.lote, p_resultado: resultado, p_clave: clave, p_motivo: motivo,
    })
    if (error) fallaBase = true
  }

  const resultados: ResultadoXml[] = []
  if (s.sin_xml) {
    await anotar('sin_xml', null, null)
    resultados.push({ i: 0, resultado: 'sin_xml' })
  }

  for (const [i, xml] of s.xmls.entries()) {
    const r = parsearFe(xml)
    if (r.clase === 'roto') {
      await anotar('error', null, r.motivo)
      resultados.push({ i, resultado: 'error', motivo: r.motivo })
      continue
    }
    if (r.clase === 'no_comprobante') {
      await anotar('no_comprobante', null, `raíz ${r.raiz}`)
      resultados.push({ i, resultado: 'no_comprobante' })
      continue
    }
    if (r.clase === 'respuesta') {
      const { data, error } = await deps.rpc('fe_respuesta_registrar', { p: { fuente: s.fuente, lote: s.lote, respuesta: r.respuesta } })
      if (error) {
        if (esErrorDeDato(error)) {
          await anotar('error', r.respuesta.clave, `la base rechazó la respuesta (${error.code})`)
          resultados.push({ i, resultado: 'error', clave_fin: r.respuesta.clave.slice(-10) })
        } else fallaBase = true
        continue
      }
      resultados.push({ i, resultado: ((data as { resultado?: ResultadoIngesta } | null)?.resultado ?? 'nuevo'), clave_fin: r.respuesta.clave.slice(-10) })
      continue
    }

    const clave = r.comprobante.clave
    const ruta = rutaXml(clave)
    try {
      await deps.subirXml(ruta, xml)
    } catch {
      fallaBase = true
      continue
    }
    const { data, error } = await deps.rpc('fe_ingestar', {
      p: {
        fuente: s.fuente, lote: s.lote, estado: r.estado, motivos: r.motivos, xml_path: ruta,
        xml_sha256: await deps.sha256(xml), comprobante: r.comprobante, lineas: r.lineas,
      },
    })
    if (error) {
      if (esErrorDeDato(error)) {
        await anotar('error', clave, `la base rechazó el comprobante (${error.code})`)
        resultados.push({ i, resultado: 'error', clave_fin: clave.slice(-10) })
      } else fallaBase = true
      continue
    }
    const res = (data as { resultado?: ResultadoIngesta } | null)?.resultado
    resultados.push({ i, resultado: res ?? 'nuevo', clave_fin: clave.slice(-10) })
  }

  const status = codigoHttp(resultados.map(x => x.resultado), fallaBase)
  return { status, cuerpo: { ok: status === 200, resultados } }
}
