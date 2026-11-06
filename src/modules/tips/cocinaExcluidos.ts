// Pool semanal de cocina: personas que entran al pool pero NO reciben su parte (su parte se reparte
// entre el resto de cocina). La lista vive FUERA del repo (es público): variable de build
// `VITE_COCINA_EXCLUIDOS`, nombres separados por coma. Se compara igual que antes: sin distinguir
// mayúsculas, y alcanza con que el nombre del empleado CONTENGA uno de los valores.
// Sin la variable, nadie queda excluido.

export function parseExcluidos(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

export const COCINA_EXCLUIDOS: string[] = parseExcluidos(import.meta.env.VITE_COCINA_EXCLUIDOS as string | undefined)

export function esExcluidoCocina(name: string, excluidos: string[] = COCINA_EXCLUIDOS): boolean {
  const n = name.toLowerCase()
  return excluidos.some(x => n.includes(x))
}
