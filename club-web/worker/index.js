// Plan B de club-web (10-nov): /api en un Worker («satori-club-api») con los topes RL_CREAR y RL_LEER, por si Pages no
// toma los bindings de rate limiting de wrangler.toml. Usa EL MISMO router que la Pages Function
// (functions/_lib/api.js): no hay una segunda copia de la API.
//
// · SIN ZONA DEL DOMINIO EN CLOUDFLARE (el DNS queda en SiteGround): no hay Workers Routes. El Worker NO tiene URL pública
//   (workers_dev = false, sin rutas): solo se llega por el service binding CLUB_API de la Pages Function, que lo llama con
//   el host interno (interno.js). Un pedido con otro host → 404.
// · La IP del cliente llega en «x-club-ip» (la pone la Pages Function). Sin ella → 503: los topes por IP y por prefijo no
//   funcionarían (todos compartirían el mismo cupo), así que falla cerrado.
// · Responde solo /api/*; cada respuesta lleva «x-club-api: worker» (la Pages Function del plan A marca «pages»).
// · Variables y secretos (SUPABASE_URL, SUPABASE_ANON_KEY, TURNSTILE_SECRET, CLUB_WEB_KEY) en el panel del Worker.
import { manejar } from '../functions/_lib/api.js'
import { HOST_INTERNO, ENCABEZADO_IP } from './interno.js'
import { rutaApi, marcar } from './ruta.js'

const ORIGEN = 'worker'
const RE_IP = /^[0-9a-fA-F:.]{2,45}$/

const json = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } })

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.hostname !== HOST_INTERNO) return marcar(new Response('no encontrado', { status: 404 }), ORIGEN)
    const ruta = rutaApi(url.pathname)
    if (ruta === null) return marcar(new Response('no encontrado', { status: 404 }), ORIGEN)
    const ip = request.headers.get(ENCABEZADO_IP) || ''
    if (!RE_IP.test(ip)) return marcar(json(503, { error: 'servicio_no_disponible' }), ORIGEN)
    // el router lee la IP de CF-Connecting-IP: se arma el pedido con la del cliente (la que mandó la Pages Function)
    const h = new Headers(request.headers)
    h.set('CF-Connecting-IP', ip)
    h.delete(ENCABEZADO_IP)
    const pedido = new Request(request.url, { method: request.method, headers: h,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer() })
    return marcar(await manejar(pedido, env, ruta), ORIGEN)
  },
}
