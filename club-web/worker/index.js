// Plan B de club-web (10-nov): /api en un Worker («satori-club-api»), con los topes RL_CREAR y RL_LEER, por si Pages no
// toma los bindings de rate limiting de wrangler.toml. Usa EL MISMO router que la Pages Function
// (functions/_lib/api.js): no hay una segunda copia de la API.
//
// · Responde solo /api/*; cualquier otra ruta es 404 (el sitio lo sigue sirviendo Pages).
// · Cada respuesta lleva «x-club-api: worker». La Pages Function marca las suyas con «x-club-api: pages». Así
//   /api/salud dice quién contestó: después de agregar la ruta del Worker, tiene que decir «worker».
// · Las variables y los secretos (SUPABASE_URL, SUPABASE_ANON_KEY, TURNSTILE_SECRET, CLUB_WEB_KEY) se cargan en el panel
//   del Worker, nunca en el repo. Los topes están en worker/wrangler.toml.
import { manejar } from '../functions/_lib/api.js'

export const ORIGEN = 'worker'

/** Lo que va después de /api/, con cada parte decodificada (como params.path de Pages). null si no es /api/… */
export function rutaApi(pathname) {
  if (!pathname.startsWith('/api/')) return null
  return pathname.slice('/api/'.length).split('/')
    .map(p => { try { return decodeURIComponent(p) } catch { return p } })
    .join('/')
}

export function marcar(respuesta, origen) {
  const h = new Headers(respuesta.headers)
  h.set('x-club-api', origen)
  return new Response(respuesta.body, { status: respuesta.status, statusText: respuesta.statusText, headers: h })
}

export default {
  async fetch(request, env) {
    const ruta = rutaApi(new URL(request.url).pathname)
    if (ruta === null) return marcar(new Response('no encontrado', { status: 404 }), ORIGEN)
    return marcar(await manejar(request, env, ruta), ORIGEN)
  },
}
