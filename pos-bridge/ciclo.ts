// ── pos-bridge · un ciclo del agente (A3) ──────────────────────────────────────
//
// Toda la decisión del agente vive acá y NO toca ni la base ni la red: las tres
// operaciones con el mundo entran como puertos inyectados. Así el ciclo entero —el
// saludo de arranque, el avance del cursor, qué pasa con el PoS apagado o con Supabase
// caído— se prueba con mocks, que es lo único que se puede validar desde el repo (la
// PC del PoS es la única con red al PoS y a Supabase).

import type { OpenIngest, PayloadIngest, TicketIngest } from '../src/shared/ndf/ingestNdf.ts'

import { anteriorFactura, compararFactura, mayorFactura, normalizarFactura } from './factura.ts'
import type { IngestNdfResult } from './pushIngest.ts'
import { rangoLectura, type RangoLectura } from './ventana.ts'

export interface PuertosCiclo {
  /** Facturas cerradas nuevas (`NumeroFactura > ultima`) dentro de la ventana. */
  leerCerradas(p: RangoLectura & { ultima: string | null }): Promise<{ tickets: TicketIngest[]; avisos: string[] }>
  /**
   * Facturas provisionales (`R` en curso, `X` anulada) de la ventana ENTERA, sin cursor. Se
   * releen cada ciclo porque cambian. Nunca mueven el cursor: lo topan.
   */
  leerProvisionales(r: RangoLectura): Promise<{ tickets: TicketIngest[]; avisos: string[] }>
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
  /** Cerradas (`C`) leídas este ciclo: las que mueven el cursor. */
  tickets:   number
  /** Provisionales (`R`/`X`) releídas este ciclo. Viajan en el mismo lote, no mueven el cursor. */
  provisionales: number
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
          fase: 'saludo', tickets: 0, provisionales: 0, abiertas: null, guardados: 0,
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
          fase: 'error_envio', tickets: 0, provisionales: 0, abiertas: null, guardados: 0,
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
  let provisionales: TicketIngest[]
  let abiertas: OpenIngest[] | null
  let avisos: string[]
  try {
    const cerradas = await puertos.leerCerradas({ ...rango, ultima: estado.ultimaFactura })
    tickets = cerradas.tickets
    const prov = await puertos.leerProvisionales(rango)
    provisionales = prov.tickets
    avisos = [...cerradas.avisos, ...prov.avisos]
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
        fase: 'error_pos', tickets: 0, provisionales: 0, abiertas: null, guardados: 0,
        cursor: estado.ultimaFactura, avisos: [], error,
      },
    }
  }

  // ── 3. Armar el lote ─────────────────────────────────────────────────────────
  // El cursor propuesto es el mayor número de factura CERRADA efectivamente leída. Nunca se
  // adivina hacia adelante: si una factura no entró en este lote, su número no viaja.
  //
  // Y NUNCA por encima de una `R`. La lectura de cerradas es `NumeroFactura > cursor`; una
  // factura en curso que quedara por debajo del cursor no se leería nunca cuando cierre.
  // Pasa de verdad: la caja de la tarde abre minutos antes de que cierre la de la mañana, y
  // sus primeras facturas tienen número menor que la última de la mañana. Si el cursor ya se
  // había pasado (historia previa a este tope), se REBOBINA: el Edge pisa `last_factura` y el
  // upsert por `(local, numero_factura)` hace que releer no duplique. Las `X` no topan nada.
  // Un solo lote, SIN repetidos. La misma factura puede salir como `R` (relectura de la
  // ventana) y como `C` (cerró en este mismo ciclo). El Edge NO deduplica dentro de un tramo:
  // hace `upsert` del chunk tal cual, y Postgres rechaza un `ON CONFLICT` que toque la misma
  // fila dos veces — se caería el lote entero, cada ciclo, mientras dure la superposición.
  // Se resuelve acá: si hay `C`, la `R`/`X` del mismo número no viaja. La `C` es la verdad.
  const cerradasPorNumero = new Set(
    tickets.map((t) => normalizarFactura(t.numero_factura)).filter((n): n is string => n !== null),
  )
  const provisionalesSinCerradas = provisionales.filter((t) => {
    const n = normalizarFactura(t.numero_factura)
    return n === null || !cerradasPorNumero.has(n)
  })

  // El tope mira SOLO las `R` que quedaron: una que cerró en este ciclo ya es `C`, y una `C`
  // no retiene el cursor — al contrario, lo empuja.
  const propuesto = toparCursor(
    mayorFactura(tickets.map((t) => t.numero_factura), estado.ultimaFactura),
    provisionalesSinCerradas,
  )

  const payload: PayloadIngest = {
    local,
    tickets: [...provisionalesSinCerradas, ...tickets],
    cursor: { last_error: null },
  }
  // `open` ausente ≠ `open: []`. Ausente = "no sé, no lo toques" (esta instalación no
  // puede leer las abiertas); `[]` = "no hay nada abierto", y el Edge cierra todas.
  if (abiertas !== null) payload.open = abiertas
  // `last_factura` solo si avanzó: mandarlo igual no rompe (el Edge fusiona), pero
  // mandar solo lo que cambió deja el log del lote diciendo la verdad.
  if (propuesto !== null && propuesto !== estado.ultimaFactura) {
    payload.cursor = { ...payload.cursor, last_factura: propuesto }
    // La fecha acompaña al cursor solo cuando el cursor ES una cerrada de este lote. Con un
    // tope (o un rebobinado) el número no corresponde a ningún ticket leído, y la fecha vieja
    // se conserva por la fusión del Edge.
    const ultimo = tickets.find((t) => normalizarFactura(t.numero_factura) === propuesto)
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
        provisionales: provisionalesSinCerradas.length,
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
        provisionales: provisionalesSinCerradas.length,
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

/**
 * El cursor nunca queda por encima de la menor factura EN CURSO (`R`) que se vio este ciclo.
 * Devuelve el menor entre `propuesto` y `anteriorFactura(menor R)`. Sin `R` no topa nada.
 */
export function toparCursor(
  propuesto: string | null,
  provisionales: readonly Pick<TicketIngest, 'numero_factura' | 'estado'>[],
): string | null {
  let menorR: string | null = null
  for (const t of provisionales) {
    if (t.estado !== 'R') continue
    const n = normalizarFactura(t.numero_factura)
    if (n === null) continue
    if (menorR === null || compararFactura(n, menorR) < 0) menorR = n
  }
  if (menorR === null) return propuesto
  const tope = anteriorFactura(menorR)
  if (tope === null) return propuesto
  if (propuesto === null) return propuesto
  return compararFactura(propuesto, tope) > 0 ? tope : propuesto
}
