/**
 * 158 · Link de reseña de Google del local («Locales», solo owner). Solo direcciones de Google: la base tiene el mismo
 * CHECK (club_config_resena_url_google) y club-web la misma expresión (club-web/src/resena.ts); resenaUrl.test.ts y
 * club-web/src/resena.test.ts controlan que no se separen.
 */
export const RE_RESENA_GOOGLE =
  /^https:\/\/(maps\.app\.goo\.gl\/[^\s"<>\\]+|g\.page\/[^\s"<>\\]+|(www\.)?google\.com\/maps([/?][^\s"<>\\]*)?|search\.google\.com\/local\/writereview\?[^\s"<>\\]+)$/
export const RESENA_MAX = 500

/** `null` = borrar el link · string = link válido (sin espacios alrededor) · Error = no es una dirección de Google. */
export function normalizarResenaUrl(entrada: string): string | null {
  const u = entrada.trim()
  if (u === '') return null
  if (u.length > RESENA_MAX || !RE_RESENA_GOOGLE.test(u)) {
    throw new Error('El link tiene que ser de Google: maps.app.goo.gl, g.page, google.com/maps o search.google.com/local/writereview')
  }
  return u
}
