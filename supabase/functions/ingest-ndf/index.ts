// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ ingest-ndf — PoS "Nube de Fuego" (A2): receptor del día. Escribe las tablas pos_ndf_*. ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// Es el otro extremo del agente de la PC del PoS (A3): el agente lee `ndf` con el extractor de la
// Fase 1a (`pos-bridge/`, SQL Server, solo lectura) y empuja el día acá. Esta función NO calcula
// ventas ni reparte propinas ni toca la caja — solo valida, normaliza y persiste.
//
// ── DE DÓNDE SALE LA LÓGICA ────────────────────────────────────────────────────────────────
// De `src/shared/ndf/mapTicket.ts` (dominio) y `src/shared/ndf/ingestNdf.ts` (contrato), los dos
// PUROS y probados con vitest. Acá NO se redefine ni un canal ni una alerta de pax: lo único que
// esta función agrega son las llamadas a la base. Si el mapper cambia, este archivo cambia con él
// (los `Record<Union, true>` de `ingestNdf.ts` no compilan si aparece un caso nuevo sin contemplar).
//
// ── POR QUÉ NO ES EL PATRÓN `pago-notificar` ───────────────────────────────────────────────
// Las otras funciones exigen el JWT del usuario y leen con RLS (el portón es el RLS). Acá NO hay
// usuario: el que llama es un proceso headless en la PC del PoS, sin sesión de Supabase. Por eso
// usa **service-role** (que bypassa RLS) y el portón es un **secreto compartido**
// (`POS_INGEST_SECRET`) en vez de un JWT. Es coherente con la mig 062, que a propósito dejó las
// cuatro tablas SIN policy de escritura: ningún usuario de la app puede escribir un ticket del PoS.
//
// ── ANTES DE USARLA (Ismael) ───────────────────────────────────────────────────────────────
// El secreto NO vive en el repo. Cargarlo una vez, con un valor largo y aleatorio, y DISTINTO del
// de BioTime (`INGEST_SECRET`):
//   supabase secrets set POS_INGEST_SECRET=<valor-largo-aleatorio> --project-ref hwiatgicyyqyezqwldia
// (`openssl rand -base64 48` sirve para generarlo.) `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`
// los inyecta Supabase sola. Si `POS_INGEST_SECRET` NO está cargado, la función responde 401 a TODO
// (fail-closed): nunca queda abierta por un secret faltante.
//
// ⛔ NO DESPLEGADA. Se entrega en rama (`feat/pos-bridge-a1a2`) junto con la mig 062, que tampoco
//    está aplicada. El deploy va DESPUÉS de aplicar la migración (si no, la función escribe contra
//    tablas que no existen). Ver el README de esta carpeta.
//
// ── CONTRATO CON EL AGENTE (A3) ────────────────────────────────────────────────────────────
// POST /ingest-ndf
//   headers: x-ingest-secret: <POS_INGEST_SECRET>, content-type: application/json
//   body: { local, tickets: TicketIngest[], open?: OpenIngest[], cursor?: CursorIngest }
// Los tipos son los de `src/shared/ndf/ingestNdf.ts`. Payload de ejemplo: README.md de esta carpeta.
//
// IDEMPOTENTE: reenviar el mismo día no duplica nada — los tickets se upsertean por
// `(local, numero_factura)`, las líneas se reemplazan enteras y `open` es un snapshot.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import {
  fusionarCursor,
  normalizarLote,
  validarPayload,
  type CursorRow,
  type LineaRow,
  type OpenRow,
} from '../../../src/shared/ndf/ingestNdf.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const POS_INGEST_SECRET = Deno.env.get('POS_INGEST_SECRET') ?? ''

/** Tamaño de tanda para los INSERT. Un día grande son miles de líneas. */
const CHUNK = 500

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/**
 * Comparación en tiempo constante. Se sale temprano solo por LARGO, que es lo único que filtra
 * (irrelevante para un secreto aleatorio largo); el contenido se compara siempre entero, así que no
 * se puede adivinar byte por byte midiendo el tiempo de respuesta.
 */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

function tandas<T>(xs: T[], tam: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += tam) out.push(xs.slice(i, i + tam))
  return out
}

type Cliente = ReturnType<typeof createClient>

/** Deja el fallo escrito en el cursor: el problema tiene que verse en la base, no solo en la consola de la PC. */
async function anotarError(sb: Cliente, local: string, mensaje: string): Promise<void> {
  const { error } = await sb
    .from('pos_ndf_cursor')
    .upsert({ local, last_poll_at: new Date().toISOString(), last_error: mensaje.slice(0, 500) },
            { onConflict: 'local' })
  if (error) console.error('ingest-ndf: además falló anotar el error en el cursor', error)
}

Deno.serve(async (req) => {
  let sb: Cliente | null = null
  let local = ''

  try {
    // ── 1. Método ────────────────────────────────────────────────────────────────────────
    // No hay bloque CORS a propósito: el que llama es el agente headless de la PC del PoS, no un
    // navegador. Sin `Access-Control-Allow-Origin`, ninguna página puede invocarla desde el browser.
    if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido' }, 405)

    // ── 2. Portón: secreto compartido ────────────────────────────────────────────────────
    // FAIL-CLOSED: si el secret no está cargado, 401 a todo. Sin este guard, un secret vacío +
    // header ausente daría `safeEqual('', '')` = true y la función quedaría ABIERTA a internet.
    if (!POS_INGEST_SECRET) {
      console.error('ingest-ndf: POS_INGEST_SECRET no está cargado — rechazando todo (fail-closed)')
      return json({ ok: false, error: 'No autorizado' }, 401)
    }
    if (!safeEqual(req.headers.get('x-ingest-secret') ?? '', POS_INGEST_SECRET)) {
      // Mismo mensaje para "falta" y "no coincide": no se le confirma nada al que prueba.
      return json({ ok: false, error: 'No autorizado' }, 401)
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error('ingest-ndf: falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
      return json({ ok: false, error: 'Función mal configurada' }, 500)
    }

    // ── 3. Sobre ─────────────────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => null)
    const sobre = validarPayload(body)
    if (!sobre.ok) return json({ ok: false, error: sobre.error }, 400)
    local = sobre.valor.local

    // ── 4. Normalizar (todo el trabajo lo hace el módulo puro) ───────────────────────────
    // Un ticket corrupto NO tumba el lote: se descarta, se cuenta y se loguea. Si un solo registro
    // raro devolviera 400, el agente reintentaría para siempre y el local dejaría de sincronizar.
    const lote = normalizarLote(sobre.valor, new Date().toISOString())
    if (lote.problemas.length > 0) console.warn(`ingest-ndf [${local}] descartes:`, lote.problemas)

    sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // ── 5. Tickets: upsert por (local, numero_factura) ───────────────────────────────────
    // `onConflict` = reingestar el mismo día PISA la factura con lo último leído (no duplica y no
    // la ignora: si el PoS corrigió un monto, queremos la corrección). El `.select()` devuelve el
    // id de cada fila, que es lo que necesitan las líneas.
    const idPorFactura = new Map<string, string>()
    for (const tanda of tandas(lote.tickets, CHUNK)) {
      const { data, error } = await sb
        .from('pos_ndf_tickets')
        .upsert(tanda.map((t) => t.fila), { onConflict: 'local,numero_factura' })
        .select('id, numero_factura')
      if (error) throw new Error(`no se pudieron guardar los tickets: ${error.message}`)
      for (const r of (data ?? []) as { id: string; numero_factura: string }[]) {
        idPorFactura.set(r.numero_factura, r.id)
      }
    }

    // ── 6. Líneas: se REEMPLAZAN enteras ─────────────────────────────────────────────────
    // Borrar + insertar en vez de upsert: las líneas no tienen clave natural (el mismo producto
    // puede aparecer dos veces en la misma factura) y lo que importa es que el detalle guardado sea
    // EXACTAMENTE el del PoS. Si una línea se anuló, tiene que desaparecer.
    const ids = [...idPorFactura.values()]
    for (const tanda of tandas(ids, CHUNK)) {
      const { error } = await sb.from('pos_ndf_ticket_lines').delete().in('ticket_id', tanda)
      if (error) throw new Error(`no se pudo limpiar el detalle: ${error.message}`)
    }

    const filasLinea: (LineaRow & { ticket_id: string })[] = []
    for (const t of lote.tickets) {
      const ticket_id = idPorFactura.get(t.fila.numero_factura)
      if (!ticket_id) continue
      for (const l of t.lineas) filasLinea.push({ ...l, ticket_id })
    }
    for (const tanda of tandas(filasLinea, CHUNK)) {
      const { error } = await sb.from('pos_ndf_ticket_lines').insert(tanda)
      if (error) throw new Error(`no se pudo guardar el detalle: ${error.message}`)
    }

    // ── 7. Mesas abiertas: SNAPSHOT del local ────────────────────────────────────────────
    // `open` ausente = el agente no mandó snapshot y no se toca nada. `open: []` = mandó uno vacío,
    // o sea "no hay nada abierto": se borran todas. La mesa que se cerró desaparece porque no vino
    // en el lote, no porque alguien avise.
    let openGuardadas = 0
    let openBorradas = 0
    if (lote.open !== undefined) {
      for (const tanda of tandas(lote.open as OpenRow[], CHUNK)) {
        const { error } = await sb.from('pos_ndf_open').upsert(tanda, { onConflict: 'local,clave' })
        if (error) throw new Error(`no se pudo guardar el snapshot de mesas: ${error.message}`)
        openGuardadas += tanda.length
      }

      // Las que sobran se calculan acá y se borran por clave, en vez de armar un `not in (...)`
      // con las claves interpoladas en el filtro: son decenas de mesas, no un problema de tamaño,
      // y así ninguna clave rara del PoS puede romper el filtro.
      const vivas = new Set(lote.open.map((o) => o.clave))
      const { data: actuales, error: errLeer } = await sb
        .from('pos_ndf_open').select('clave').eq('local', local)
      if (errLeer) throw new Error(`no se pudo leer el snapshot de mesas: ${errLeer.message}`)

      const sobran = ((actuales ?? []) as { clave: string }[])
        .map((r) => r.clave)
        .filter((c) => !vivas.has(c))
      for (const tanda of tandas(sobran, CHUNK)) {
        const { error } = await sb.from('pos_ndf_open').delete().eq('local', local).in('clave', tanda)
        if (error) throw new Error(`no se pudieron cerrar las mesas: ${error.message}`)
        openBorradas += tanda.length
      }
    }

    // ── 8. Cursor ────────────────────────────────────────────────────────────────────────
    // Se escribe al final y solo si todo lo anterior salió bien: si el cursor avanzara con el lote
    // a medio guardar, el agente daría por sincronizado algo que no está.
    //
    // Se lee y se FUSIONA en vez de pisar la fila entera: lo que el agente no mandó se conserva.
    // El agente saluda al arrancar con un lote vacío para que la respuesta le diga hasta dónde
    // llegó; si ese saludo borrara `last_factura`, cada reinicio releería el día desde el principio.
    const { data: cursorActual, error: errLeerCursor } = await sb
      .from('pos_ndf_cursor').select('*').eq('local', local).maybeSingle()
    if (errLeerCursor) throw new Error(`no se pudo leer el cursor: ${errLeerCursor.message}`)

    const cursor = fusionarCursor((cursorActual ?? null) as CursorRow | null, lote.cursor)
    const { error: errCursor } = await sb
      .from('pos_ndf_cursor').upsert(cursor, { onConflict: 'local' })
    if (errCursor) throw new Error(`no se pudo actualizar el cursor: ${errCursor.message}`)

    // Invariante: tickets_recibidos = tickets_guardados + invalid + repetidos dentro del lote.
    return json({
      ok: true,
      local,
      tickets_recibidos: sobre.valor.tickets.length,
      tickets_guardados: idPorFactura.size,
      lineas_guardadas:  filasLinea.length,
      open_guardadas:    openGuardadas,
      open_borradas:     openBorradas,
      invalid:           lote.invalid,
      recalculados:      lote.recalculados,
      problemas:         lote.problemas,
      // El cursor ya fusionado: es de acá de donde el agente saca por dónde seguir.
      cursor,
    }, 200)
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e)
    console.error('ingest-ndf: excepción', e)
    // Nunca 200 si la escritura falló: el agente TIENE que reintentar este lote.
    if (sb && local) await anotarError(sb, local, mensaje)
    return json({ ok: false, error: 'Error interno' }, 500)
  }
})
