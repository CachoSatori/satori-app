// Piezas chicas compartidas por las pestañas de Salarios. Viven acá para que ninguna
// pantalla las duplique con una variante propia.

/** Iniciales para el cuadro `.sal-ini` del prototipo: una o dos letras, en mayúscula. */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '—'
  const a = partes[0][0] ?? ''
  const b = partes.length > 1 ? (partes[1][0] ?? '') : ''
  return (a + b).toUpperCase()
}
