// Pages Function: /api/* → functions/_lib/api.js
//
// (10-nov) /api/salud dice quién contestó (encabezado «x-club-api»):
// · Con el service binding CLUB_API (se carga en el PANEL de Pages → Settings → Bindings; decisión del dueño, 10-nov):
//   /api lo atiende el Worker satori-club-api, que tiene los topes. Sin zona del dominio en Cloudflare (el DNS queda en SiteGround) no hay Workers Routes: el único camino
//   al Worker es este binding. La IP real del cliente la ve ESTA función (Pages es el borde del pedido); se le pasa al
//   Worker en «x-club-ip», sin depender de qué hace Cloudflare con CF-Connecting-IP en un service binding. El Worker
//   marca «x-club-api: worker».
// · Sin el binding: el router corre acá, en Pages, y marca «x-club-api: pages». (12-nov) Pages NO puede tener los topes
//   RL_CREAR y RL_LEER (no admite esos bindings en su configuración; el deploy de cf1a61d falló por eso), así que crear y
//   leer responden 503: falla cerrada. No es un plan A: es la señal de que falta el binding en el panel.
import { manejar } from '../_lib/api.js'
import { HOST_INTERNO, ENCABEZADO_IP } from '../../worker/interno.js'

export async function onRequest({ request, env, params }) {
  if (env.CLUB_API && typeof env.CLUB_API.fetch === 'function') {
    const ip = request.headers.get('CF-Connecting-IP') || ''
    const origen = new URL(request.url)
    const h = new Headers(request.headers)
    h.set(ENCABEZADO_IP, ip)
    const pedido = new Request(`https://${HOST_INTERNO}${origen.pathname}${origen.search}`,
      { method: request.method, headers: h, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer() })
    return env.CLUB_API.fetch(pedido)
  }
  const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '')
  const r = await manejar(request, env, path)
  const h = new Headers(r.headers)
  h.set('x-club-api', 'pages')
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h })
}
