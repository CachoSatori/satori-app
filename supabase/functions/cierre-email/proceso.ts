// ─────────────────────────────────────────────────────────────────────────────────────────────
//  El flujo de `cierre-email`, sin red (index.ts le pasa los clientes). Probado en proceso.test.ts.
//
//  Orden (la plata manda; el correo es cortesía y el resumen, cortesía de la cortesía):
//    1. Sin Authorization → 401. Token que no es de un usuario real → 401.
//    2. Sin Resend o sin destinatario → no se lee nada ni se manda.
//    3. El cierre se relee con el cliente DEL USUARIO (RLS de cash_cierres_dia = portón). Si no lo ve o no
//       existe → 403/404, y NO se lee el PoS (el resumen nunca corre para un cierre que el usuario no ve).
//    4. Recién ahí, el resumen de ventas (resumen.ts: guarda de 36 h + lectura con service_role, opción B).
//       Si falla, el correo sale igual con «Resumen de ventas no disponible».
//    5. La RESPUESTA al cliente no trae montos ni nombres (SEC-02): `{ ok, id, resumen: true|false }`.
//       Lo que lee el cajero no cambia; las ventas viajan solo dentro del correo a REPORT_TO_EMAIL.
// ─────────────────────────────────────────────────────────────────────────────────────────────
import { buildHtml, type CierreCorreo } from './plantilla.ts'
import { FALTA_DESTINATARIO } from './destinatario.ts'
import type { CierreParaResumen, MotivoSinResumen, ResumenCorreo } from './resumen.ts'

export type CierreFila = CierreCorreo & CierreParaResumen & { tipo?: string }

export interface DepsCierre {
  hayToken: boolean
  usuarioValido: () => Promise<boolean>
  hayResend: boolean
  hayDestinatario: boolean
  /** Relee la fila con el JWT del usuario (RLS). Solo cierres completos. */
  leerCierre: (id: string) => Promise<{ data: CierreFila | null; error: unknown }>
  resumen: (c: CierreFila) => Promise<{ resumen: ResumenCorreo | null; motivo: MotivoSinResumen | null }>
  enviar: (subject: string, html: string) => Promise<{ ok: boolean; id?: string | null }>
  log: (o: Record<string, unknown>) => void
}

export interface Salida { status: number; body: Record<string, unknown> }

export async function procesarCierre(cuerpo: unknown, d: DepsCierre): Promise<Salida> {
  if (!d.hayToken) return { status: 401, body: { ok: false, error: 'No autorizado' } }
  const cierreId = (cuerpo as { cierre_id?: unknown } | null)?.cierre_id
  if (!cierreId || typeof cierreId !== 'string') return { status: 400, body: { ok: false, error: 'Falta cierre_id' } }
  if (!await d.usuarioValido()) return { status: 401, body: { ok: false, error: 'No autorizado' } }

  if (!d.hayResend) return { status: 200, body: { ok: false, error: 'RESEND_API_KEY no configurada' } }
  if (!d.hayDestinatario) {
    d.log({ etapa: FALTA_DESTINATARIO, secreto: 'REPORT_TO_EMAIL' })
    return { status: 500, body: { ok: false, code: 'falta_destinatario', error: 'Falta el destinatario del correo (secreto REPORT_TO_EMAIL)' } }
  }

  const { data, error } = await d.leerCierre(cierreId)
  if (error) return { status: 403, body: { ok: false, error: 'Sin acceso al cierre' } }
  if (!data) return { status: 404, body: { ok: false, error: 'Cierre no encontrado' } }

  // El resumen nunca rompe el correo.
  let resumen: ResumenCorreo | null = null
  try {
    const r = await d.resumen(data)
    resumen = r.resumen
    if (r.motivo) d.log({ etapa: 'resumen_ventas', motivo: r.motivo })
  } catch {
    d.log({ etapa: 'resumen_ventas', motivo: 'error_lectura' })
  }

  const subject = `🔒 Satori — Cierre del día ${data.session_date}`
  const res = await d.enviar(subject, buildHtml(data, resumen))
  if (!res.ok) return { status: 200, body: { ok: false, error: 'No se pudo enviar el correo' } }
  return { status: 200, body: { ok: true, id: res.id ?? null, resumen: resumen !== null } }
}
