// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ ingest-punches — BioTime F1b: receptor de marcas crudas. Escribe `time_punches`.        ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// Es el otro extremo del agente local (F1c): el agente lee `iclock_transaction` del Postgres de
// BioTime (en la PC del reloj, red local, solo lectura) y empuja lotes acá. Esta función NO deriva
// horas ni empareja in/out — eso es F1d. Acá solo se valida, se normaliza y se persiste la marca
// cruda tal cual llegó.
//
// ── POR QUÉ NO ES EL PATRÓN `pago-notificar` ───────────────────────────────────────────────
// Las otras funciones exigen el JWT del usuario y leen con RLS (el portón es el RLS). Acá NO hay
// usuario: el que llama es un proceso headless en la PC del reloj, sin sesión de Supabase. Por eso
// esta función usa **service-role** (que bypassa RLS) y el portón es un **secreto compartido**
// (`INGEST_SECRET`) en vez de un JWT. Es coherente con la mig 057, que a propósito dejó
// `time_punches` SIN policy de escritura: ningún usuario de la app puede insertar marcas, solo esto.
//
// ── ANTES DE USARLA (Ismael) ───────────────────────────────────────────────────────────────
// El secreto NO vive en el repo. Cargarlo una vez, con un valor largo y aleatorio:
//   supabase secrets set INGEST_SECRET=<valor-largo-aleatorio> --project-ref hwiatgicyyqyezqwldia
// (`openssl rand -base64 48` sirve para generarlo.) `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`
// los inyecta Supabase sola. Si `INGEST_SECRET` NO está cargado, la función responde 401 a TODO
// (fail-closed): nunca queda abierta por un secret faltante.
//
// Deploy STAGING:  supabase functions deploy ingest-punches --project-ref hwiatgicyyqyezqwldia
//   PROD va aparte, CON FIRMA (y con su propio INGEST_SECRET, distinto al de staging).
//
// ── CONTRATO CON EL AGENTE (F1c) ───────────────────────────────────────────────────────────
// POST /ingest-punches
//   headers: x-ingest-secret: <INGEST_SECRET>, content-type: application/json
//   body: { local: 'santa-teresa'|'nosara', punches: [{ biotime_id, emp_code, punch_time,
//                                                       punch_state, terminal?, raw? }] }
// El agente arranca el SELECT incremental en `max(biotime_id) where local = <su local>` — NO global:
// cada local tiene su propio BioTime con su propia secuencia de id (ver mig 057).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const INGEST_SECRET     = Deno.env.get('INGEST_SECRET') ?? ''

/** Slugs válidos = `public.locations.id` (los mismos que usan el POS y `work_days.local`). */
const LOCALES = new Set(['santa-teresa', 'nosara'])

/** Tope de lote. Un poll de 2–5 min trae decenas de marcas; esto solo frena un payload absurdo. */
const MAX_BATCH = 10_000

/** Tope por consulta a `employees`: evita armar una URL gigante con `.in(...)`. */
const CHUNK_CODES = 200

interface PunchIn {
  biotime_id?: unknown
  emp_code?: unknown
  punch_time?: unknown
  punch_state?: unknown
  terminal?: unknown
  raw?: unknown
}

interface PunchRow {
  local: string
  biotime_id: number
  emp_code: string
  employee_id: string | null
  punch_at: string
  punch_state: 'in' | 'out'
  terminal: string | null
  raw: unknown
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

/**
 * `0`/`'0'` → `in`, `1`/`'1'` → `out` (códigos nativos de BioTime). Cualquier otra cosa devuelve
 * null y la marca NO se inserta: el CHECK de `time_punches` solo admite in/out, así que meterla
 * reventaría el lote entero. Se cuenta en `unknown_state` para que quede visible, no silenciosa.
 */
function normState(v: unknown): 'in' | 'out' | null {
  const s = String(v).trim()
  if (s === '0') return 'in'
  if (s === '1') return 'out'
  return null
}

/**
 * El instante DEBE venir con zona horaria explícita (`...Z` o `...±HH:MM`).
 *
 * Esto no es quisquillosidad: si llega `'2026-08-21 22:30:00'` sin zona, Deno lo interpreta en la
 * zona del runtime (UTC) y la marca queda guardada 6 horas corrida respecto de Costa Rica. Un turno
 * de las 22:30 pasaría a las 16:30 — cae en otra jornada, y las horas de esa quincena salen mal SIN
 * QUE NADA FALLE. Preferimos rechazar la marca (visible en `invalid`) antes que guardar un instante
 * equivocado. El agente F1c tiene que mandar el offset de Costa Rica (`-06:00`).
 */
const TZ_RE = /(Z|[+-]\d{2}:?\d{2})$/i
function parseInstant(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!TZ_RE.test(s)) return null
  const t = Date.parse(s)
  if (Number.isNaN(t)) return null
  return new Date(t).toISOString()
}

/** `biotime_id` es `integer not null` en la tabla: acepta 5 y '5', rechaza 5.5, '' y null. */
function toInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isInteger(n) ? n : null
  }
  return null
}

Deno.serve(async (req) => {
  try {
    // ── 1. Método ────────────────────────────────────────────────────────────────────────
    // No hay bloque CORS a propósito: el que llama es el agente headless de la PC del reloj, no un
    // navegador. Sin `Access-Control-Allow-Origin`, ninguna página web puede invocarla desde el browser.
    if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido' }, 405)

    // ── 2. Portón: secreto compartido ────────────────────────────────────────────────────
    // FAIL-CLOSED: si el secret no está cargado, 401 a todo. Sin este guard, `INGEST_SECRET` vacío
    // + header ausente daría `safeEqual('', '')` = true y la función quedaría ABIERTA a internet.
    if (!INGEST_SECRET) {
      console.error('ingest-punches: INGEST_SECRET no está cargado — rechazando todo (fail-closed)')
      return json({ ok: false, error: 'No autorizado' }, 401)
    }
    const given = req.headers.get('x-ingest-secret') ?? ''
    if (!safeEqual(given, INGEST_SECRET)) {
      // Mismo mensaje para "falta" y "no coincide": no se le confirma nada al que prueba.
      return json({ ok: false, error: 'No autorizado' }, 401)
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error('ingest-punches: falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
      return json({ ok: false, error: 'Función mal configurada' }, 500)
    }

    // ── 3. Payload ───────────────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return json({ ok: false, error: 'JSON inválido' }, 400)

    const { local, punches } = body as { local?: unknown; punches?: unknown }

    if (typeof local !== 'string' || !LOCALES.has(local)) {
      return json({ ok: false, error: 'local inválido (santa-teresa | nosara)' }, 400)
    }
    if (!Array.isArray(punches)) {
      return json({ ok: false, error: 'punches debe ser un array' }, 400)
    }
    if (punches.length > MAX_BATCH) {
      return json({ ok: false, error: `Lote demasiado grande (máx ${MAX_BATCH})` }, 400)
    }

    const received = punches.length
    // Lote vacío = caso normal: el agente hizo poll y no había nada nuevo.
    if (received === 0) {
      return json(
        { ok: true, local, received: 0, inserted: 0, duplicates: 0, unmapped: 0, unknown_state: 0, invalid: 0 },
        200,
      )
    }

    // ── 4. Normalizar y validar fila por fila ────────────────────────────────────────────
    // Una marca corrupta NO tumba el lote: se descarta, se cuenta y se loguea. Si un solo registro
    // raro devolviera 400, el agente reintentaría para siempre y el local entero dejaría de sincronizar.
    let unknown_state = 0
    let invalid = 0
    const problemas: string[] = []
    const candidatos: Omit<PunchRow, 'employee_id'>[] = []

    for (const p of punches as PunchIn[]) {
      const bid = toInt(p?.biotime_id)
      const emp = p?.emp_code === null || p?.emp_code === undefined ? '' : String(p.emp_code).trim()
      const at = parseInstant(p?.punch_time)
      const st = normState(p?.punch_state)

      if (st === null) {
        unknown_state++
        if (problemas.length < 10) problemas.push(`punch_state desconocido: ${JSON.stringify(p?.punch_state)}`)
        continue
      }
      if (bid === null || emp === '' || at === null) {
        invalid++
        if (problemas.length < 10) {
          const falta = [
            bid === null ? 'biotime_id' : null,
            emp === '' ? 'emp_code' : null,
            at === null ? 'punch_time (¿sin zona horaria?)' : null,
          ].filter(Boolean).join(', ')
          problemas.push(`fila inválida (${falta}) biotime_id=${JSON.stringify(p?.biotime_id)}`)
        }
        continue
      }

      candidatos.push({
        local,
        biotime_id: bid,
        emp_code: emp,
        punch_at: at,
        punch_state: st,
        terminal: p?.terminal === null || p?.terminal === undefined ? null : String(p.terminal),
        // `raw` = la fila original tal cual vino. Si el agente ya mandó su propio `raw`, se respeta.
        raw: p?.raw ?? p,
      })
    }

    if (problemas.length > 0) console.warn(`ingest-punches [${local}] descartes:`, problemas)

    const attempted = candidatos.length

    // ── 5. Resolver empleado por biotime_emp_code ────────────────────────────────────────
    // NUNCA por nombre (SPEC §9: casar por nombre ya produjo drift real). Sin match → null: la marca
    // se guarda igual con su `emp_code` para poder reconciliarla después sin volver a BioTime.
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const codes = [...new Set(candidatos.map((c) => c.emp_code))]
    const mapa = new Map<string, string>()

    for (let i = 0; i < codes.length; i += CHUNK_CODES) {
      const trozo = codes.slice(i, i + CHUNK_CODES)
      const { data, error } = await sb
        .from('employees')
        .select('id, biotime_emp_code')
        .in('biotime_emp_code', trozo)
      if (error) {
        console.error('ingest-punches: fallo leyendo employees', error)
        return json({ ok: false, error: 'No se pudo resolver empleados' }, 500)
      }
      for (const e of (data ?? []) as { id: string; biotime_emp_code: string | null }[]) {
        // A texto de los dos lados: en BioTime el código es numérico, en la app es text.
        if (e.biotime_emp_code !== null) mapa.set(String(e.biotime_emp_code).trim(), e.id)
      }
    }

    // ── 6. Deduplicar dentro del propio lote ─────────────────────────────────────────────
    // Si el agente reenvía solapado, el mismo (local, biotime_id) puede venir dos veces en el MISMO
    // request. Se queda la primera; las repetidas cuentan como duplicados igual que las ya guardadas.
    const vistos = new Set<number>()
    const rows: PunchRow[] = []
    for (const c of candidatos) {
      if (vistos.has(c.biotime_id)) continue
      vistos.add(c.biotime_id)
      rows.push({ ...c, employee_id: mapa.get(c.emp_code) ?? null })
    }

    // ── 7. Insertar idempotente ──────────────────────────────────────────────────────────
    // `ignoreDuplicates` = `on conflict (local, biotime_id) do nothing`: reimportar NUNCA duplica ni
    // pisa una marca ya guardada. El `.select()` devuelve SOLO las filas realmente insertadas, que es
    // de donde salen los contadores (no se estiman).
    const { data: ins, error: insErr } = await sb
      .from('time_punches')
      .upsert(rows, { onConflict: 'local,biotime_id', ignoreDuplicates: true })
      .select('id, employee_id')

    if (insErr) {
      console.error('ingest-punches: fallo insertando time_punches', insErr)
      // Nunca 200 si la escritura falló: el agente TIENE que reintentar este lote.
      return json({ ok: false, error: 'No se pudieron guardar las marcas' }, 500)
    }

    const insertadas = (ins ?? []) as { id: string; employee_id: string | null }[]
    const inserted = insertadas.length
    const unmapped = insertadas.filter((r) => r.employee_id === null).length
    // Cubre las dos formas de duplicado: la que ya estaba en la tabla y la repetida dentro del lote.
    const duplicates = attempted - inserted

    // Invariante: received = inserted + duplicates + unknown_state + invalid.
    return json(
      { ok: true, local, received, inserted, duplicates, unmapped, unknown_state, invalid },
      200,
    )
  } catch (e) {
    console.error('ingest-punches: excepción', e)
    return json({ ok: false, error: 'Error interno' }, 500)
  }
})
