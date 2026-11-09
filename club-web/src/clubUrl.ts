/**
 * (09-nov, auditoría) Validación del dominio público del Club (`VITE_CLUB_URL`). Módulo sin `import.meta.env` para que
 * lo usen también `vite.config.ts` (frena el build de producción) y las pruebas.
 */
const RE_CLUB_URL = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i

/** `https://…` sin barra final, o null si falta o está mal formada. */
export function clubUrlValida(env: string | undefined): string | null {
  const v = (env ?? '').trim().replace(/\/+$/, '')
  return RE_CLUB_URL.test(v) ? v : null
}

export const ERROR_SIN_CLUB_URL =
  'club-web: falta VITE_CLUB_URL (o no es https://<dominio> sin ruta). En producción no se arranca con el origen: ' +
  'los QR y links del Club saldrían con el dominio equivocado. Cargarla en Cloudflare Pages → Settings → Variables.'
