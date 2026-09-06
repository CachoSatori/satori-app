// ── pos-bridge · un ciclo del agente (A3) ──────────────────────────────────────
//
// Toda la decisión del agente vive acá y NO toca ni la base ni la red: las tres
// operaciones con el mundo entran como puertos inyectados. Así el ciclo entero —el
// saludo de arranque, el avance del cursor, qué pasa con el PoS apagado o con Supabase
// caído— se prueba con mocks, que es lo único que se puede validar desde el repo (la
// PC del PoS es la única con red al PoS y a Supabase).

import type { OpenIngest, PayloadIngest, TicketIngest } from '../src/shared/ndf/ingestNdf.ts'

import { mayorFactura, normalizarFactura } from './factura.ts'
import type { IngestNdfResult } from './pushIngest.ts'
import { rangoLectura, type RangoLectura } from './ventana.ts'

export interface PuertosCiclo {
  /** Facturas cerradas nuevas (`NumeroFactura > ultima`) dentro de la ventana. */
  leerCerradas(p: RangoLectura & { ultima: string | null }): Promise<{ tickets: TicketIngest[]; avisos: string[] }>
  /** Snapshot de mesas abiertas. `null` = esta instalación no lo puede leer. */
  leerAbiertas(r: RangoLectura): Promise<OpenIngest[] | null>
  enviar(payload: PayloadIngest): Promise<IngestNdfResult>
}

export interface EstadoAgente {
  /** Hasta qué factura se confirmó. `null` = todavía no se sabe. */
  ultimaFactura: string | null
  /** Ya se saludó al Edge y se leyó el cursor guardado. */
  saludado:      boolean
  /** Qué falló en el ciclo anterior (se manda para que quede en `pos_ndf_cursor`). */
  ultimoError:   string | null
}

export const ESTADO_INICIAL: EstadoAgente = {
  ultimaFactura: null,
  saludado:      false,
  ultimoError:   null,
}

export interface ResumenCiclo {
  fase:      'saludo' | 'sincronizado' | 'error_pos' | 'error_envio'
  tickets:   number
  abiertas:  number | null
  guardados: number
  cursor:    string | null
  avisos:    string[]
  error:     string | null
}

export interface ResultadoCiclo {
  estado:  EstadoAgente
  resumen: ResumenCiclo
}

const mensaje = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * SALUDO de arranque: un lote vacío, sin `open` y sin cursor. El Edge no toca nada y
 * devuelve el cursor guardado, que es por dónde tiene que seguir el agente.
 *
 * Por eso el cursor del Edge FUSIONA en vez de pisar: si este saludo escribiera la fila
 * entera, borraría `last_factura` y cada reinicio releería el día desde el principio.
 */
export function payloadSaludo(local: string): PayloadIngest {
  return { local, tickets: [] }
}

/**
 * Un ciclo completo. Nunca tira: cualquier fallo vuelve como `resumen.error` y el estado
 * queda listo para reintentar. Un agente que crashea a las 2 de la mañana no se entera
 * nadie hasta el otro día.
 */
export async function ejecutarCiclo(
  puertos: PuertosCiclo,
  local: string,
  ventanaHoras: number,
  estado: EstadoAgente,
  ahora: Date,
): Promise<ResultadoCiclo> {
  // ── 1. Saludo: leer el cursor guardado antes de pedirle nada al PoS ──────────
  if (!estado.saludado) {
    try {
      const res = await puertos.enviar(payloadSaludo(local))
      const guardado = normalizarFactura(res.cursor?.last_factura)
      return {
        estado: { ultimaFactura: guardado, saludado: true, ultimoError: null },
        resumen: {
          fase: 'saludo', tickets: 0, abiertas: null, guardados: 0,
          cursor: guardado, avisos: [], error: null,
        },
      }
    } catch (e) {
      // Sin cursor no se arranca: leer desde null reingesta la ventana entera y, aunque
      // el `(local, numero_factura)` de la base hace que eso NO duplique, es trabajo al
      // pedo cada reintento. Se espera al próximo ciclo.
      return {
        estado,
        resumen: {
          fase: 'error_envio', tickets: 0, abiertas: null, guardados: 0,
          cursor: estado.ultimaFactura, avisos: [], error: mensaje(e),
        },
      }
    }
  }

  const rango = rangoLectura(ahora, ventanaHoras)

  // ── 2. Leer el PoS ───────────────────────────────────────────────────────────
  // Sin inicializar a propósito: el `catch` de abajo corta con `return`, así que después
  // del try/catch las tres están asignadas y TypeScript lo sabe.
  let tickets: TicketIngest[]
  let abiertas: OpenIngest[] | null
  let avisos: string[]
  try {
    const cerradas = await puertos.leerCerradas({ ...rango, ultima: estado.ultimaFactura })
    tickets = cerradas.tickets
    avisos = cerradas.avisos
    abiertas = await puertos.leerAbiertas(rango)
  } catch (e) {
    // PoS apagado, red local caída, SQL Server reiniciando. NO se inventa el día: se deja
    // el error escrito en el cursor (para que se vea en la base, no solo en esta consola)
    // y se reintenta en el próximo ciclo.
    const error = mensaje(e)
    try {
      await puertos.enviar({ local, tickets: [], cursor: { last_error: error } })
    } catch {
      // Si tampoco hay red a Supabase, queda solo en el log de la PC. No hay más que hacer.
    }
    return {
      estado: { ...estado, ultimoError: error },
      resumen: {
        fase: 'error_pos', tickets: 0, abiertas: null, guardados: 0,
        cursor: estado.ultimaFactura, avisos: [], error,
      },
    }
  }

  // ── 3. Armar el lote ─────────────────────────────────────────────────────────
  // El cursor propuesto es el mayor número de factura EFECTIVAMENTE leído. Nunca se
  // adivina hacia adelante: si una factura no entró en este lote, su número no viaja.
  const propuesto = mayorFactura(tickets.map((t) => t.numero_factura), estado.ultimaFactura)

  const payload: PayloadIngest = { local, tickets, cursor: { last_error: null } }
  // `open` ausente ≠ `open: []`. Ausente = "no sé, no lo toques" (esta instalación no
  // puede leer las abiertas); `[]` = "no hay nada abierto", y el Edge cierra todas.
  if (abiertas !== null) payload.open = abiertas
  // `last_factura` solo si avanzó: mandarlo igual no rompe (el Edge fusiona), pero
  // mandar solo lo que cambió deja el log del lote diciendo la verdad.
  if (propuesto !== null && propuesto !== estado.ultimaFactura) {
    payload.cursor = { ...payload.cursor, last_factura: propuesto }
    const ultimo = tickets[tickets.length - 1]
    if (ultimo) payload.cursor.last_fecha_registra = ultimo.fecha_registra
  }

  // ── 4. Enviar ────────────────────────────────────────────────────────────────
  try {
    const res = await puertos.enviar(payload)
    // El cursor que manda es el que quedó GUARDADO, no el que propuso el agente: si el
    // Edge descartó la última factura por inválida, el agente no la da por sincronizada.
    const confirmado = normalizarFactura(res.cursor?.last_factura) ?? estado.ultimaFactura
    return {
      estado: { ultimaFactura: confirmado, saludado: true, ultimoError: null },
      resumen: {
        fase: 'sincronizado',
        tickets: tickets.length,
        abiertas: abiertas === null ? null : abiertas.length,
        guardados: res.tickets_guardados,
        cursor: confirmado,
        avisos: [...avisos, ...res.problemas],
        error: null,
      },
    }
  } catch (e) {
    // El cursor NO avanza: el próximo ciclo relee las mismas facturas y el
    // `(local, numero_factura)` de la base hace que reenviar no duplique.
    const error = mensaje(e)
    return {
      estado: { ...estado, ultimoError: error },
      resumen: {
        fase: 'error_envio',
        tickets: tickets.length,
        abiertas: abiertas === null ? null : abiertas.length,
        guardados: 0,
        cursor: estado.ultimaFactura,
        avisos,
        error,
      },
    }
  }
}

/** La línea que el agente imprime por ciclo. Sin datos de cliente, sin secretos. */
export function describirCiclo(r: ResumenCiclo): string {
  if (r.fase === 'saludo') return `saludo · cursor guardado=${r.cursor ?? '(vacío)'}`
  if (r.error !== null) return `${r.fase} · ${r.error} · cursor=${r.cursor ?? '(vacío)'} (no avanza)`
  const abiertas = r.abiertas === null ? 'n/d' : String(r.abiertas)
  return `cerradas=${r.tickets} guardadas=${r.guardados} abiertas=${abiertas} cursor=${r.cursor ?? '(vacío)'}`
}
