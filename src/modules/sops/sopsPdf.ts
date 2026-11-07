// Apertura de PDF de SoP y libros (URL firmada) y utilidades del lector.

import { SOP_LIBROS, urlPdfSop } from '../../shared/api/sops'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** "2026-11" → "noviembre 2026". */
export function mesVersion(v?: string | null): string | null {
  const m = v ? /^(\d{4})-(\d{2})$/.exec(v) : null
  if (!m) return null
  const mes = MESES[Number(m[2]) - 1]
  return mes ? `${mes} ${m[1]}` : null
}

/**
 * Abre un PDF con URL firmada. La pestaña se abre ANTES de pedir la URL (si se abre
 * después del await, Safari en iPhone la bloquea como popup). Devuelve la URL solo si
 * el navegador bloqueó la pestaña, para mostrar un link que la persona toque.
 */
export async function abrirPdf(ruta: string, descarga?: string): Promise<string | null> {
  const w = window.open('', '_blank')
  try {
    const url = await urlPdfSop(ruta, 600, descarga)
    if (w) { w.opener = null; w.location.href = url; return null }
    return url
  } catch (e) {
    w?.close()
    throw e
  }
}

/** Libros que ve cada rol: el de franquicia solo owner y manager. */
export function librosVisibles(rol: string | null | undefined) {
  const gerencia = rol === 'owner' || rol === 'manager'
  return SOP_LIBROS.filter(l => !l.soloGerencia || gerencia)
}
