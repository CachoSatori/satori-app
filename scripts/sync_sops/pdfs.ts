// Rutas de Storage de los PDF de SoP. Las mismas constantes las usa la app
// (src/shared/api/sops.ts): si cambian acá, cambian allá.

/** sops/2026-11/2.5.pdf */
export function rutaPdfSop(version: string, codigo: string): string {
  if (!/^\d{4}-\d{2}$/.test(version)) throw new Error(`versión inválida: ${version}`)
  if (!/^\d+(\.\d+)*$/.test(codigo)) throw new Error(`código inválido: ${codigo}`)
  return `sops/${version}/${codigo}.pdf`
}

export const LIBROS = [
  { nombre: 'Libro del empleado',   archivo: 'Satori - Libro del empleado.pdf',   ruta: 'sops/libros/libro-empleado.pdf' },
  { nombre: 'Libro de franquicia',  archivo: 'Satori - Libro de franquicia.pdf',  ruta: 'sops/libros/franquicia/libro-franquicia.pdf' },
] as const
