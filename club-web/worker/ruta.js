// Plan B de club-web: funciones de apoyo del Worker (10-nov). Van aparte de index.js porque un módulo de Worker solo puede
// exportar handlers: workerd rechaza otros exports.
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
