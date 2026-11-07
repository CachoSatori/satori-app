/** Pegado de la página vieja para la comparación del piloto en paralelo. */
/** «Nombre;2026-11-02;7» por línea (también con coma o tab). */
export function parsearPegado(txt: string): Array<{ referente: string; semana: string; personas: number }> {
  return txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean).flatMap(l => {
    const p = l.split(/[;\t]|,(?=\s*\d{4}-\d{2}-\d{2})|,(?=\s*\d+\s*$)/).map(x => x.trim())
    if (p.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(p[1]) || !/^\d{1,5}$/.test(p[2])) return []
    return [{ referente: p[0], semana: p[1], personas: Number(p[2]) }]
  })
}
