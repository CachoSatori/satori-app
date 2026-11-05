// Pages Function: /api/* → functions/_lib/api.js
import { manejar } from '../_lib/api.js'

export async function onRequest({ request, env, params }) {
  const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '')
  return manejar(request, env, path)
}
