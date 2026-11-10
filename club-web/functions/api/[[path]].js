// Pages Function: /api/* → functions/_lib/api.js
// (10-nov) Cada respuesta lleva «x-club-api: pages»: si el plan B (worker/, «x-club-api: worker») está puesto, /api/salud
// dice quién contestó.
import { manejar } from '../_lib/api.js'

export async function onRequest({ request, env, params }) {
  const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '')
  const r = await manejar(request, env, path)
  const h = new Headers(r.headers)
  h.set('x-club-api', 'pages')
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h })
}
