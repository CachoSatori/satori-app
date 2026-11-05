/**
 * Supabase Edge Function — alta-empleado (Satori · alta de empleados desde Admin)
 *
 * Firmado por Ismael (05/11). Dos acciones, ambas con el JWT del usuario (verify_jwt = true):
 *
 *   · action 'crear' (solo OWNER ACTIVO): crea la cuenta de un empleado con contraseña temporal.
 *       1. service_role → auth.admin.createUser (el trigger handle_new_user, mig 068, crea el
 *          perfil salonero + inactivo; la metadata NO decide el rol).
 *       2. JWT DEL OWNER → profiles.update({ role, is_active: true }) y, si viene, el vínculo
 *          employees.profile_id. Así la guarda de la 068 (owner activo) y las policies (get_my_role,
 *          que desde la 069 exige is_active) lo vuelven a verificar EN LA BASE (variante B).
 *       3. Si 2 falla → service_role → auth.admin.deleteUser (cascade: perfil; SET NULL: empleado).
 *       La función NO crea owners: un owner nuevo se promueve desde Admin.
 *
 *   · action 'cambiar_password' (el propio usuario, con el flag pendiente): verifica la contraseña
 *       actual, exige una nueva distinta (8–72) y en UNA sola llamada de admin cambia la contraseña
 *       y baja app_metadata.cambiar_password. El flag vive en app_metadata: el usuario NO puede
 *       escribirlo (solo service_role), así que no hay forma de borrarlo sin cambiarla de verdad.
 *
 * Errores: al cliente solo van códigos y mensajes fijos (+ ref). El detalle va al log de la función
 * con la ref — nunca la contraseña ni el token.
 *
 * Deploy A MANO (regla: ningún PR a main con supabase/functions/ hasta el ítem 11):
 *   staging: functions deploy alta-empleado --project-ref hwiatgicyyqyezqwldia  (verify_jwt = true)
 *   prod:    con firma.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export const ROLES_PERMITIDOS = ['manager', 'cajero', 'salonero', 'barman', 'barback', 'runner', 'cocina', 'contador', 'proveedor']
const PASSWORD_MIN = 8
const PASSWORD_MAX = 72   // límite de bcrypt
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function origenPermitido(origin: string): boolean {
  return origin === 'https://cachosatori.github.io'                                  // prod (GitHub Pages)
    || /^https:\/\/([a-z0-9-]+\.)?satori-staging\.pages\.dev$/.test(origin)          // staging + previews de rama
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  if (origenPermitido(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}

// Contraseña temporal legible (sin 0/O/1/l/I), 12 caracteres, muestreo sin sesgo.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
function passwordTemporal(n = 12): string {
  const out: string[] = []
  const limite = 256 - (256 % ALFABETO.length)
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < limite && out.length < n) out.push(ALFABETO[b % ALFABETO.length])
    }
  }
  return out.join('')
}

const nuevaRef = () => crypto.randomUUID().replace(/-/g, '').slice(0, 8)

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  const ref = nuevaRef()
  const responder = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  const falla = (status: number, code: string, error: string) => responder(status, { code, error, ref })
  const log = (datos: Record<string, unknown>) => console.error(JSON.stringify({ ref, ...datos }))

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return falla(405, 'metodo', 'Método no permitido')

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return falla(401, 'sin_sesion', 'Iniciá sesión de nuevo')

    // Cliente con el JWT de quien llama: el RLS y la guarda de la 068 aplican sobre él.
    const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: ud, error: ue } = await comoUsuario.auth.getUser()
    const caller = ud?.user
    if (ue || !caller) return falla(401, 'sin_sesion', 'Iniciá sesión de nuevo')

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return falla(400, 'entrada', 'Datos inválidos')
    const action = body.action ?? 'crear'

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    // ── Cambio de contraseña inicial (el propio usuario) ─────────────────────────────────────
    if (action === 'cambiar_password') {
      if (caller.app_metadata?.cambiar_password !== true) {
        return falla(409, 'sin_cambio_pendiente', 'No hay un cambio de contraseña pendiente')
      }
      const actual = typeof body.actual === 'string' ? body.actual : ''
      const nueva  = typeof body.nueva  === 'string' ? body.nueva  : ''
      if (nueva.length < PASSWORD_MIN || nueva.length > PASSWORD_MAX) {
        return falla(400, 'password_largo', `La contraseña nueva debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres`)
      }
      if (nueva === actual) return falla(400, 'password_igual', 'La contraseña nueva tiene que ser distinta de la temporal')
      // La actual se verifica de verdad contra GoTrue (y esa sesión de prueba se cierra).
      const verificador = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
      const { error: ve } = await verificador.auth.signInWithPassword({ email: caller.email ?? '', password: actual })
      if (ve) return falla(400, 'actual_incorrecta', 'La contraseña actual no es correcta')
      await verificador.auth.signOut({ scope: 'local' }).catch(() => {})
      // UNA llamada: contraseña nueva + flag abajo. No hay forma de bajar el flag sin cambiarla.
      const { error: pe } = await admin.auth.admin.updateUserById(caller.id, {
        password: nueva,
        app_metadata: { ...caller.app_metadata, cambiar_password: false },
      })
      if (pe) {
        log({ action, caller: caller.id, etapa: 'updateUserById', detalle: pe.message })
        return falla(400, 'password_rechazada', 'No se pudo guardar esa contraseña. Probá con otra')
      }
      return responder(200, { ok: true })
    }

    if (action !== 'crear') return falla(400, 'entrada', 'Acción inválida')

    // ── Alta (solo owner ACTIVO) ─────────────────────────────────────────────────────────────
    const { data: owner, error: oe } = await admin.from('profiles').select('id')
      .eq('id', caller.id).eq('role', 'owner').eq('is_active', true).maybeSingle()
    if (oe) { log({ action, caller: caller.id, etapa: 'owner', detalle: oe.message }); return falla(500, 'interno', 'No se pudo crear la cuenta') }
    if (!owner) return falla(403, 'no_autorizado', 'Solo un owner activo puede dar de alta empleados')

    const fullName   = typeof body.full_name === 'string' ? body.full_name.trim().replace(/\s+/g, ' ') : ''
    const email      = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const role       = typeof body.role === 'string' ? body.role : ''
    const employeeId = body.employee_id == null || body.employee_id === '' ? null : String(body.employee_id)
    if (fullName.length < 3 || fullName.length > 80) return falla(400, 'nombre', 'Revisá el nombre (3 a 80 caracteres)')
    if (email.length > 254 || !EMAIL_RE.test(email)) return falla(400, 'email', 'Revisá el correo')
    if (!ROLES_PERMITIDOS.includes(role)) return falla(400, 'rol', 'Revisá el rol')
    if (employeeId !== null && !UUID_RE.test(employeeId)) return falla(400, 'empleado', 'Revisá el empleado a vincular')

    // Email repetido (sin distinguir mayúsculas). createUser lo vuelve a chequear abajo.
    const patron = email.replace(/[\\%_]/g, c => '\\' + c)
    const { data: dup, error: de } = await admin.from('profiles').select('id').ilike('email', patron).limit(1)
    if (de) { log({ action, caller: caller.id, etapa: 'dup', detalle: de.message }); return falla(500, 'interno', 'No se pudo crear la cuenta') }
    if (dup && dup.length) return falla(409, 'email_existe', 'Ya existe una cuenta con ese correo')

    // Empleado: se valida ANTES de crear nada (con el JWT del owner: su RLS manda).
    if (employeeId) {
      const { data: emp, error: ee } = await comoUsuario.from('employees').select('id, is_active, profile_id').eq('id', employeeId).maybeSingle()
      if (ee) { log({ action, caller: caller.id, etapa: 'empleado', detalle: ee.message }); return falla(500, 'interno', 'No se pudo crear la cuenta') }
      if (!emp || !emp.is_active || emp.profile_id) return falla(409, 'empleado_no_disponible', 'Ese empleado no existe, está inactivo o ya tiene una cuenta vinculada')
    }

    const temp = passwordTemporal()
    const { data: cu, error: ce } = await admin.auth.admin.createUser({
      email, password: temp, email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: { cambiar_password: true },
    })
    if (ce || !cu?.user) {
      const msg = ce?.message ?? ''
      if ((ce as { code?: string } | null)?.code === 'email_exists' || /already|registered|exists/i.test(msg)) {
        return falla(409, 'email_existe', 'Ya existe una cuenta con ese correo')
      }
      log({ action, caller: caller.id, etapa: 'createUser', detalle: msg })
      return falla(500, 'interno', 'No se pudo crear la cuenta')
    }
    const nuevoId = cu.user.id

    // Rol + activación + vínculo con el JWT DEL OWNER (variante B). Si algo falla: se borra todo.
    let etapa = 'perfil'
    try {
      const { data: pr, error: pe } = await comoUsuario.from('profiles')
        .update({ role, is_active: true }).eq('id', nuevoId).select('id')
      if (pe || !pr || pr.length !== 1) throw new Error(pe?.message ?? `perfil: ${pr?.length ?? 0} filas`)
      if (employeeId) {
        etapa = 'vinculo'
        const { data: er, error: ve } = await comoUsuario.from('employees')
          .update({ profile_id: nuevoId }).eq('id', employeeId).is('profile_id', null).select('id')
        if (ve || !er || er.length !== 1) throw new Error(ve?.message ?? `vinculo: ${er?.length ?? 0} filas`)
      }
    } catch (e) {
      const { error: del } = await admin.auth.admin.deleteUser(nuevoId)
      log({ action, caller: caller.id, etapa, detalle: (e as Error).message, compensacion: del ? `FALLÓ: ${del.message}` : 'usuario borrado' })
      return falla(500, 'interno', 'No se pudo crear la cuenta. No quedó nada a medias; probá de nuevo')
    }

    console.log(JSON.stringify({ ref, action, caller: caller.id, creado: nuevoId, role, vinculo: !!employeeId }))
    return responder(201, {
      user_id: nuevoId, email, full_name: fullName, role,
      employee_linked: !!employeeId, temp_password: temp,
    })
  } catch (e) {
    log({ etapa: 'no_controlado', detalle: (e as Error).message })
    return falla(500, 'interno', 'No se pudo completar la operación')
  }
})
