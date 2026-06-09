/* Satori · PWA Share Target handler (Fase 2D-B)
 * Se importa dentro del Service Worker de Workbox (importScripts).
 * Intercepta SOLO el POST de "Compartir" hacia {BASE}inbox/share (base-agnóstico),
 * guarda la imagen en Cache Storage y redirige a {BASE}inbox?shared=1.
 * El resto del fetch lo maneja Workbox normalmente.
 */
self.addEventListener('fetch', (event) => {
  try {
    const url = new URL(event.request.url)
    if (event.request.method === 'POST' && url.pathname.endsWith('/inbox/share')) {
      event.respondWith((async () => {
        try {
          const form = await event.request.formData()
          const file = form.get('image') || form.get('file') || form.get('photo')
          if (file) {
            const cache = await caches.open('satori-share-inbox')
            const headers = new Headers({ 'content-type': file.type || 'image/jpeg', 'x-filename': file.name || 'compartido.jpg' })
            await cache.put('/__shared__', new Response(file, { headers }))
          }
        } catch (_e) { /* noop */ }
        // Relativo al scope del SW → respeta el base (/satori-app/ en prod, / en staging)
        return Response.redirect(new URL('inbox?shared=1', self.registration.scope).toString(), 303)
      })())
    }
  } catch (_e) { /* dejar pasar al handler por defecto */ }
})
