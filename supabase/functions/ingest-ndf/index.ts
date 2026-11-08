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
// ── ESTADO DEL DESPLIEGUE (CLUB-AUD-28, verificado el 07-nov-2026 por la Management API) ───────────────
//   · STAGING (hwiatgicyyqyezqwldia): v12, desplegada el 07-nov 14:41 UTC desde `claude/puente-item11` @ c7d206e
//     (ítem 11 + área de la mesa; el Edge de 283e3c4 es idéntico). verify_jwt = false.
//   · PROD: la versión anterior al ítem 11. El pase va con firma y en el orden del RUNBOOK del Club
//     (docs/club-satori/RUNBOOK-piloto.md): la mig 081 SIEMPRE antes que este Edge.
//   · El secreto por local (POS_INGEST_SECRETS, ronda 3) está en esta rama y NO desplegado todavía.
//   · CLUB-AUD-46/47/48 (08-nov, en `src/shared/ndf/ingestNdf.ts`): latido con la hora del servidor y cursor que
//     solo avanza; secretos de ≥ 32 sin repetir; topes de largo. En esta rama, NO desplegados (los despliega el
//     RUNBOOK, con firma). Falta pasarlos a `claude/puente-item11-prod` antes del paso 3.
//   · CLUB-AUD-44/45 (08-nov): todo el lote en UNA transacción por local (`pos_ndf_ingestar`, mig 082). NECESITA la
//     082 aplicada ANTES de desplegar este Edge (en staging ya está aplicada; en prod va en el RUNBOOK).
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
  localDelSecreto,
  resolverLocalLegado,
  revisarCatalogo,
  type CatalogoLocales,
  normalizarLote,
  validarPayload,
  type CursorRow,
  type LineaRow,
  type OpenRow,
} from '../../../src/shared/ndf/ingestNdf.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const POS_INGEST_SECRET = Deno.env.get('POS_INGEST_SECRET') ?? ''
// CLUB-AUD-32: un secreto por local, JSON {"<local>": "…"}. Si está, manda sobre el de arriba.
const POS_INGEST_SECRETS = Deno.env.get('POS_INGEST_SECRETS') ?? ''
// LC-ML: el local del secreto único de antes. Sin esta variable vale el histórico, CON aviso en cada pedido (no corta).
const LEGADO = resolverLocalLegado(Deno.env.get('POS_INGEST_LOCAL_LEGADO'))

// LC-ML: catálogo de locales (locations y/o club_config), leído con service_role y guardado 5 minutos por instancia.
const CATALOGO_TTL_MS = 5 * 60_000
let catalogoCache: { valor: CatalogoLocales; hasta: number } | null = null
let avisoSinCatalogoDado = false

async function leerCatalogo(sb: Cliente): Promise<CatalogoLocales> {
  if (catalogoCache && catalogoCache.hasta > Date.now()) return catalogoCache.valor
  const ids = new Set<string>()
  let hayTabla = false
  // Una tabla que no existe en esta base (prod hoy no tiene ninguna de las dos) devuelve error: se ignora.
  const loc = await sb.from('locations').select('id')
  if (!loc.error) { hayTabla = true; for (const r of (loc.data ?? []) as { id: string }[]) ids.add(r.id) }
  const cfg = await sb.from('club_config').select('location_id')
  if (!cfg.error) { hayTabla = true; for (const r of (cfg.data ?? []) as { location_id: string }[]) ids.add(r.location_id) }
  const valor: CatalogoLocales = hayTabla ? ids : null
  catalogoCache = { valor, hasta: Date.now() + CATALOGO_TTL_MS }
  return valor
}

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
    if (!POS_INGEST_SECRET && !POS_INGEST_SECRETS) {
      console.error('ingest-ndf: no hay secreto cargado — rechazando todo (fail-closed)')
      return json({ ok: false, error: 'No autorizado' }, 401)
    }
    // CLUB-AUD-32: el secreto decide el local (mapa por local; el secreto único, solo para POS_INGEST_LOCAL_LEGADO).
    const localAutorizado = localDelSecreto(req.headers.get('x-ingest-secret') ?? '',
      { mapa: POS_INGEST_SECRETS, legado: POS_INGEST_SECRET, localLegado: LEGADO.local }, safeEqual)
    // Entró por el secreto único (sin mapa) y la variable falta o está mal: se avisa fuerte en cada pedido.
    const avisos: string[] = []
    if (!POS_INGEST_SECRETS && LEGADO.aviso) {
      console.warn(`ingest-ndf: ${LEGADO.aviso}`)
      avisos.push(LEGADO.aviso)
    }
    if (!localAutorizado) {
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
    if (local !== localAutorizado) {
      // un secreto de un local no escribe en otro
      return json({ ok: false, error: 'No autorizado' }, 401)
    }

    // LC-ML: el local tiene que existir en el catálogo (si la base tiene catálogo). Un error de tipeo en el mapa de
    // secretos no puede crear un local fantasma en pos_ndf_* (que no tienen FK sobre `local`).
    sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const revision = revisarCatalogo(local, POS_INGEST_SECRETS, await leerCatalogo(sb))
    for (const a of revision.avisos) {
      // «sin catálogo» se loguea una vez por instancia (en prod hoy es lo normal); lo demás, siempre.
      if (a.startsWith('Sin catálogo') && avisoSinCatalogoDado) continue
      if (a.startsWith('Sin catálogo')) avisoSinCatalogoDado = true
      console.warn(`ingest-ndf [${local}]: ${a}`)
    }
    avisos.push(...revision.avisos)
    if (!revision.ok) {
      // No se anota en el cursor: ese local no existe, no hay fila que tocar.
      return json({ ok: false, error: 'Local no registrado', avisos }, 403)
    }

    // ── 4. Normalizar (todo el trabajo lo hace el módulo puro) ───────────────────────────
    // Un ticket corrupto NO tumba el lote: se descarta, se cuenta y se loguea. Si un solo registro
    // raro devolviera 400, el agente reintentaría para siempre y el local dejaría de sincronizar.
    const lote = normalizarLote(sobre.valor, new Date().toISOString())
    if (lote.problemas.length > 0) console.warn(`ingest-ndf [${local}] descartes:`, lote.problemas)

    // ── 5–8. Todo en UNA transacción por local (CLUB-AUD-44/45, mig 082) ──────────────────────
    // Antes eran varias llamadas sueltas (upsert de tickets, borrar líneas, insertar líneas, snapshot de mesas,
    // cursor): dos POST simultáneos del mismo local podían duplicar las líneas de una factura, y un fallo en el medio
    // dejaba el lote a medias. `pos_ndf_ingestar` hace todo con un lock por local: o se guarda todo o nada.
    //   · tickets: upsert por (local, numero_factura); las líneas de esas facturas se REEMPLAZAN enteras;
    //   · `open` ausente = no se toca nada; `open: []` = no hay nada abierto (se borran todas);
    //   · sin la clave `cursor` en el sobre, el cursor NO se escribe (el backfill corre en paralelo sin moverle el
    //     corte al agente); con ella, se fusiona con las reglas de CLUB-AUD-46 (solo avanza; latido = hora del servidor).
    const lineas: (LineaRow & { numero_factura: string })[] = []
    for (const t of lote.tickets) for (const l of t.lineas) lineas.push({ ...l, numero_factura: t.fila.numero_factura })
    const { data: r, error: errIngesta } = await sb.rpc('pos_ndf_ingestar', {
      p_local:   local,
      p_tickets: lote.tickets.map((t) => t.fila),
      p_lineas:  lineas,
      p_open:    lote.open === undefined ? null : (lote.open as OpenRow[]),
      p_cursor:  lote.cursor,
    })
    if (errIngesta) throw new Error(`no se pudo guardar el lote: ${errIngesta.message}`)
    const res = (r ?? {}) as { tickets?: number; lineas?: number; open_guardadas?: number; open_borradas?: number; cursor?: CursorRow | null }

    // Invariante: tickets_recibidos = tickets_guardados + invalid + repetidos dentro del lote.
    return json({
      ok: true,
      local,
      tickets_recibidos: sobre.valor.tickets.length,
      tickets_guardados: res.tickets ?? 0,
      lineas_guardadas:  res.lineas ?? 0,
      open_guardadas:    res.open_guardadas ?? 0,
      open_borradas:     res.open_borradas ?? 0,
      invalid:           lote.invalid,
      recalculados:      lote.recalculados,
      problemas:         lote.problemas,
      // El cursor ya fusionado: es de acá de donde el agente saca por dónde seguir. Si el lote
      // no traía `cursor`, es la fila TAL CUAL está guardada (no se escribió nada).
      cursor: res.cursor ?? null,
      cursor_escrito: lote.cursor !== null,
      // LC-ML: avisos de configuración (variable de legado, catálogo). No frenan: se ven en el log del agente y del Edge.
      avisos,
    }, 200)
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e)
    console.error('ingest-ndf: excepción', e)
    // Nunca 200 si la escritura falló: el agente TIENE que reintentar este lote.
    if (sb && local) await anotarError(sb, local, mensaje)
    return json({ ok: false, error: 'Error interno' }, 500)
  }
})
