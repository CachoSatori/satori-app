// ── Cuadros ilegibles de la tabla de líneas de factura (Bandeja e InvRevision), 23-nov (R29–R31) ──
//
// Módulo PURO. Un `<input type="number">` con texto que no es número («0-450», «5-», «--») entrega `value === ''`
// y `validity.badInput`; antes `N('')` lo volvía 0 sin aviso y la factura entraba con cantidad o precio 0. Ahora
// InvLineTable guarda NaN en el cuadro ilegible y esto devuelve el aviso que nombra el cuadro y la línea; con aviso
// no se confirma ni se guarda nada. Vacío sigue como antes (0). No cambia ningún cálculo de costo ni de stock.
import { errorDeCuadros } from '../modules/cash/cuadrosMonto'
import { NONE, type EditLine } from './api/inventoryIngest'

/** El primer cuadro ilegible de las líneas, con su aviso; null si todos se leen. El factor solo cuenta si la línea es inventario (si no, el cuadro está apagado). */
export function errorDeLineas(lines: readonly EditLine[]): string | null {
  for (const l of lines) {
    const linea = l.descripcion || 'línea sin nombre'
    const cuadros = [
      { nombre: `Cant. · ${linea}`, valor: l.cantidad, ilegible: Number.isNaN(l.cantidad), admiteNegativo: true },
      ...(l.sel !== NONE ? [{ nombre: `Factor · ${linea}`, valor: l.factor, ilegible: Number.isNaN(l.factor), admiteNegativo: true }] : []),
      { nombre: `Precio · ${linea}`, valor: l.precio, ilegible: Number.isNaN(l.precio), admiteNegativo: true },
    ]
    const e = errorDeCuadros(cuadros)
    if (e) return e
  }
  return null
}
