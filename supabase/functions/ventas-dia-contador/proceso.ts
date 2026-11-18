// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Orquestación del correo (parámetros → datos → archivos → envío), con las dependencias inyectadas:
//  se prueba sin red (proceso.test.ts). index.ts solo pone la autenticación y las dependencias reales.
//
//  Respuesta y log SIN montos ni nombres (como monthly-report tras SEC-02): período, conteos, nombres
//  de los adjuntos, bytes y huella sha256 de cada uno. La plata va solo en el correo.
// ─────────────────────────────────────────────────────────────────────────────────────────────
import { elegirQuincena, type Quincena } from './quincena.ts'
import { armarDetalle, type LogicaApp } from './detalle.ts'
import { armarCorreo, type Correo } from './correo.ts'

export const LOCAL_POR_DEFECTO = 'santa-teresa'

export interface Dependencias {
  logica: LogicaApp
  leerDias(rango: { desde: string; hasta: string }, local: string): Promise<Record<string, unknown>>
  enviar(c: Correo): Promise<void>
  /** Hay destinatario configurado (secreto REPORT_TO_EMAIL). */
  hayDestinatario: boolean
  ahora: Date
}

export type Resultado =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 500; body: { ok: false; code: string; error: string } }

const falla = (status: 400 | 500, code: string, error: string): Resultado => ({ status, body: { ok: false, code, error } })

/** «2026-11-16 07:00» en hora CR, sin toLocaleString. */
export function marcaCR(ahora: Date): string {
  const cr = new Date(ahora.getTime() - 6 * 3_600_000)
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${cr.getUTCFullYear()}-${dos(cr.getUTCMonth() + 1)}-${dos(cr.getUTCDate())} ${dos(cr.getUTCHours())}:${dos(cr.getUTCMinutes())}`
}

async function sha256(b64: string): Promise<string> {
  const bin = atob(b64), b = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i)
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', b))
  return [...h].map(x => x.toString(16).padStart(2, '0')).join('')
}

export async function procesar(body: unknown, dep: Dependencias): Promise<Resultado> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return falla(400, 'entrada', 'Datos inválidos')
  const b = body as { quincena?: unknown; local?: unknown; dry_run?: unknown }
  if (b.dry_run !== undefined && typeof b.dry_run !== 'boolean') return falla(400, 'dry_run', 'dry_run inválido')
  const dry = b.dry_run === true
  let local = LOCAL_POR_DEFECTO
  if (b.local !== undefined && b.local !== null && b.local !== '') {
    if (typeof b.local !== 'string' || !/^[a-z][a-z0-9-]{1,39}$/.test(b.local)) return falla(400, 'local', 'Local inválido')
    local = b.local
  }
  const e = elegirQuincena(b.quincena, dep.ahora)
  if (!e.ok) return falla(400, e.code, e.error)
  const q: Quincena = e.q
  // Sin destinatario no se manda nada; el modo seco no manda, así que sigue.
  if (!dry && !dep.hayDestinatario) return falla(500, 'falta_destinatario', 'Falta el destinatario (secreto REPORT_TO_EMAIL)')

  const dias = await dep.leerDias({ desde: q.desde, hasta: q.hasta }, local)
  const detalle = armarDetalle(dep.logica, dias, q)
  const correo = armarCorreo(detalle, local, marcaCR(dep.ahora))
  if (!dry) await dep.enviar(correo)

  const adjuntos = []
  for (const a of correo.attachments) adjuntos.push({ archivo: a.filename, bytes: a.bytes, sha256: await sha256(a.content) })
  return {
    status: 200,
    body: {
      ok: true, dry_run: dry, enviado: !dry, local,
      quincena: q.clave, desde: q.desde, hasta: q.hasta,
      dias: detalle.filas.length, dias_con_ventas: detalle.diasConVentas,
      adjuntos, fuente: 'pos',
    },
  }
}
