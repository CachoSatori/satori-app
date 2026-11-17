// Cambio de contraseña OBLIGATORIO (mig 185, decisión del dueño 17-nov 14:44 CR). El owner marca a un usuario desde
// Admin → Usuarios; la próxima vez que esa persona entra, la app solo la deja estar en /mi-cuenta hasta que cambie la
// contraseña. La base decide: `seguridad_debo_cambiar_clave()` compara la huella del hash guardada al marcar con la de
// hoy, y si ya la cambió (por cualquier vía) borra la marca sola.
import { supabase, withTimeout } from './supabase'

/** Tope de la consulta al entrar: si la red no responde, no se bloquea a nadie (se vuelve a consultar al reconectar). */
export const CONSULTA_TIMEOUT_MS = 6_000

/**
 * ¿El usuario de la sesión tiene que cambiar la contraseña?
 * true / false según la base; null si no se pudo saber (sin red, error, tiempo vencido): la app NO bloquea con null.
 */
export async function deboCambiarClave(): Promise<boolean | null> {
  try {
    const r = await withTimeout(
      Promise.resolve(supabase.rpc('seguridad_debo_cambiar_clave')),
      CONSULTA_TIMEOUT_MS,
      'seguridad_debo_cambiar_clave',
      { data: null, error: null } as unknown as Awaited<ReturnType<typeof supabase.rpc>>,
    )
    if (r.error || typeof r.data !== 'boolean') return null
    return r.data
  } catch {
    return null
  }
}

export interface PedidoCambioClave {
  user_id: string
  marcado_en: string
  marcado_por: string | null
}

/** Mensaje sin texto técnico para los errores de las funciones del owner. */
function mensaje(e: { code?: string; message?: string } | null, accion: string): string {
  if (e?.code === '42501') return `Solo el dueño puede ${accion}.`
  if (e?.code === 'P0002') return 'Ese usuario ya no existe.'
  if (e?.code === '22023') return 'Esa cuenta no tiene contraseña: no hay nada que cambiar.'
  return `No se pudo ${accion}. Revisá la conexión y probá de nuevo.`
}

/** Owner: obliga al usuario a cambiar la contraseña la próxima vez que entra. */
export async function pedirCambioClave(userId: string): Promise<void> {
  const { error } = await supabase.rpc('seguridad_marcar_cambio_clave', { p_user: userId })
  if (error) throw new Error(mensaje(error, 'pedir el cambio de contraseña'))
}

/** Owner: saca un pedido puesto por error. */
export async function sacarPedidoCambioClave(userId: string): Promise<void> {
  const { error } = await supabase.rpc('seguridad_desmarcar_cambio_clave', { p_user: userId })
  if (error) throw new Error(mensaje(error, 'sacar el pedido de cambio de contraseña'))
}

/** Owner: quién sigue con el cambio pendiente (la base limpia antes a los que ya la cambiaron). */
export async function pedidosCambioClave(): Promise<PedidoCambioClave[]> {
  const { data, error } = await supabase.rpc('seguridad_cambio_clave_pendientes')
  if (error) throw new Error(mensaje(error, 'ver los pedidos de cambio de contraseña'))
  return (data ?? []) as PedidoCambioClave[]
}
