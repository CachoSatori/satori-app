import type { Ingredient } from './types/inventario'
import { N, NONE, NEW, type EditLine } from './api/inventoryIngest'
import { alEscribir, esIlegible, valorInput } from '../modules/tips/validarTurno'
import { errorDeLineas } from './invLineasIlegibles'

// Cuadro `type="number"`: lo ilegible («0-450», «5-») queda NaN (no 0) y lo frena `errorDeLineas` (R29–R31).
const leer = (el: HTMLInputElement): number => (esIlegible(el) ? Number.NaN : N(el.value))

/**
 * Tabla editable de líneas de factura → ingrediente (dropdown + cantidad/factor/precio).
 * Presentacional: el estado de las líneas vive en el padre. La comparte la Bandeja
 * (InventoryStep) y la cola de Revisión de inventario (InvRevision) para no duplicar el mapeo.
 */
export default function InvLineTable({ lines, ingredients, onUpdate, onSelIngredient }: {
  lines: EditLine[]
  ingredients: Ingredient[]
  onUpdate: (i: number, patch: Partial<EditLine>) => void
  onSelIngredient: (i: number, sel: string) => void
}) {
  const aviso = errorDeLineas(lines)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="cd-tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Ítem de factura</th>
            <th style={{ textAlign: 'left' }}>Ingrediente</th>
            <th style={{ textAlign: 'right' }}>Cant.</th>
            <th style={{ textAlign: 'left' }}>Un. fact.</th>
            <th style={{ textAlign: 'right' }}>Factor →base</th>
            <th style={{ textAlign: 'right' }}>Precio</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const esInv = l.sel !== NONE
            return (
              <tr key={i}>
                <td>
                  <div style={{ fontWeight: 600 }}>{l.descripcion}</div>
                  {l.codigo && <div style={{ fontSize: '0.66rem', color: 'var(--t-muted)' }}>cód {l.codigo}</div>}
                </td>
                <td>
                  <select className="cd-tbl-select" style={{ minWidth: 180 }} value={l.sel} onChange={e => {
                    // Al apagar el factor («No es inventario»), lo ilegible vuelve a 1: si no, bloquearía sin verse al volver.
                    if (e.target.value === NONE && Number.isNaN(l.factor)) onUpdate(i, { factor: 1 })
                    onSelIngredient(i, e.target.value)
                  }}>
                    <option value="">— elegir —</option>
                    <option value={NONE}>✕ No es inventario</option>
                    <option value={NEW}>+ Crear ingrediente</option>
                    <optgroup label="Ingredientes">
                      {ingredients.map(g => <option key={g.id} value={g.id}>{g.name} ({g.unit})</option>)}
                    </optgroup>
                  </select>
                  {l.sel === NEW && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                      <input className="cd-tbl-input" placeholder="Nombre" value={l.newName} onChange={e => onUpdate(i, { newName: e.target.value })} style={{ width: 120 }} />
                      <input className="cd-tbl-input" placeholder="Un. base (K/UN…)" value={l.newUnit} onChange={e => onUpdate(i, { newUnit: e.target.value })} style={{ width: 90 }} />
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input type="number" className="cd-tbl-input" aria-label={`Cantidad: ${l.descripcion}`} value={valorInput(l.cantidad)} {...alEscribir(el => onUpdate(i, { cantidad: leer(el) }))} style={{ width: 60, textAlign: 'right' }} />
                </td>
                <td><input className="cd-tbl-input" value={l.unidad} onChange={e => onUpdate(i, { unidad: e.target.value })} style={{ width: 56 }} disabled={!esInv} /></td>
                <td style={{ textAlign: 'right' }}>
                  <input type="number" key={esInv ? 'factor' : 'factor-apagado'} className="cd-tbl-input" aria-label={`Factor: ${l.descripcion}`} value={valorInput(l.factor)} {...alEscribir(el => onUpdate(i, { factor: leer(el) }))} style={{ width: 64, textAlign: 'right' }} disabled={!esInv} />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input type="number" step="any" className="cd-tbl-input" aria-label={`Precio: ${l.descripcion}`} value={valorInput(l.precio)} {...alEscribir(el => onUpdate(i, { precio: leer(el) }))} style={{ width: 80, textAlign: 'right' }} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {aviso && <div className="tips-error" role="alert" style={{ marginTop: '0.5rem' }}><span>{aviso}</span></div>}
      <p style={{ fontSize: '0.68rem', color: 'var(--t-muted)', marginTop: '0.5rem' }}>
        Factor = cuántas unidades base entran por 1 unidad de factura (ej. caja de 12 → 12; kg → 1). Stock que entra = cantidad × factor. Precio base = precio ÷ factor.
      </p>
    </div>
  )
}
