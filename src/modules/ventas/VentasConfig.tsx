import { useState, useMemo } from 'react'
import type { DiasMap, ProductMap } from '../../shared/types/ventas'
import { updateProductInfo } from '../../shared/api/ventas'

interface Props {
  dias: DiasMap
  pm:   ProductMap
  onRefresh: () => void
}

const TIPOS = ['comida','bebida','cortesia','personal','nofood','desconocido']

// Clasificaciones predefinidas por tipo — se pueden completar libremente
const CLAS_SUGERIDAS: Record<string, string[]> = {
  comida:  ['TAPAS ASIATICAS','POKES BOWLS CEVICHES','SUSHI ROLLS','NIGIRIS','SASHIMIS','COMBOS','HOSOMAKIS','ESPECIALES','POSTRES','KIDS MENU'],
  bebida:  ['VINOS','CERVEZAS','COCTELES','LICORES','SOFT DRINKS','JUGOS','AGUAS'],
  nofood:  ['MERCHANDISING','ROPA','ACCESORIOS'],
  cortesia:['CORTESIAS'],
  personal:['PERSONAL'],
}

export default function VentasConfig({ dias, pm, onRefresh }: Props) {
  const [saving, setSaving] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('desconocido')

  const allProds = useMemo(() => {
    const names = new Set<string>()
    for (const dia of Object.values(dias)) {
      for (const s of Object.values(dia.saloneros)) {
        for (const [name] of (s as { prods?: [string, number, number][] }).prods ?? []) {
          names.add(name.toUpperCase())
        }
      }
    }
    return [...names].sort()
  }, [dias])

  const filtered = allProds.filter(n => {
    if (filter === 'todos') return true
    return (pm[n]?.tipo ?? 'desconocido') === filter
  })

  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: allProds.length }
    for (const n of allProds) c[pm[n]?.tipo ?? 'desconocido'] = (c[pm[n]?.tipo ?? 'desconocido'] ?? 0) + 1
    return c
  }, [allProds, pm])

  const handleUpdate = async (nombre: string, tipo: string, clas: string, subcl: string, mult: number, costo: number) => {
    setSaving(nombre)
    try {
      await updateProductInfo(nombre, { tipo, clasificacion: clas, subclasificacion: subcl, multiplicador: mult, costo_unitario: costo })
      onRefresh()
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="vt-section">
      {/* Info box about multiplicadores */}
      <div className="vt-config-info">
        <strong>Multiplicador de bebidas:</strong> Una botella de vino = 5 unidades, una cerveza = 1 unidad. Afecta los ratios Beb/PAX y C/B que usa el sistema para medir el desempeño de los saloneros.
      </div>

      <div className="vt-sl" style={{ marginTop: '1.25rem' }}>Clasificación de productos ({allProds.length} únicos)</div>

      <div className="vt-range-bar" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        {['todos','desconocido',...TIPOS.filter(t => t !== 'desconocido')].map(t => (
          <button key={t} className={`vt-range-btn ${filter === t ? 'active' : ''}`}
            onClick={() => setFilter(t)}>
            {t} ({counts[t] ?? 0})
          </button>
        ))}
      </div>

      <div className="vt-tbl-wrap">
        <table className="vt-tbl">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Tipo</th>
              <th>Clasificación</th>
              <th>Subclasificación</th>
              <th className="r" title="Para bebidas: cuántas unidades equivale este ítem (vino botella=5, cerveza=1)">
                Mult. ×
              </th>
              <th className="r" title="Costo de insumos por unidad vendida (food cost)">
                Costo ₡
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(n => (
              <ProductRow key={n} nombre={n} info={pm[n]}
                clasSugeridas={CLAS_SUGERIDAS[pm[n]?.tipo ?? ''] ?? []}
                saving={saving === n}
                onSave={(nombre, tipo, clas, subcl, mult, costo) => handleUpdate(nombre, tipo, clas, subcl, mult, costo)} />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#888', fontSize: '0.85rem' }}>
                  Sin productos en esta categoría
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface RowProps {
  nombre: string
  info:   { tipo?: string; clasificacion?: string; subclasificacion?: string; multiplicador?: number; costo_unitario?: number } | undefined
  clasSugeridas: string[]
  saving: boolean
  onSave: (nombre: string, tipo: string, clas: string, subcl: string, mult: number, costo: number) => void
}

function ProductRow({ nombre, info, clasSugeridas, saving, onSave }: RowProps) {
  const [tipo,  setTipo]  = useState(info?.tipo ?? 'desconocido')
  const [clas,  setClas]  = useState(info?.clasificacion ?? '')
  const [subcl, setSubcl] = useState(info?.subclasificacion ?? '')
  const [mult,  setMult]  = useState(info?.multiplicador ?? 1)
  const [costo, setCosto] = useState(info?.costo_unitario ?? 0)

  const changed =
    tipo  !== (info?.tipo             ?? 'desconocido') ||
    clas  !== (info?.clasificacion    ?? '')             ||
    subcl !== (info?.subclasificacion ?? '')             ||
    mult  !== (info?.multiplicador    ?? 1)              ||
    costo !== (info?.costo_unitario   ?? 0)

  return (
    <tr style={{ background: saving ? '#fffdf5' : '' }}>
      <td style={{ fontSize: '0.8rem', fontWeight: 500, maxWidth: 200 }}>{nombre}</td>
      <td>
        <select className="cd-tbl-select" value={tipo}
          onChange={e => { setTipo(e.target.value); if (!clas) setClas('') }}
          disabled={saving}>
          {TIPOS.map(t => <option key={t}>{t}</option>)}
        </select>
      </td>
      <td>
        {clasSugeridas.length > 0 ? (
          <select className="cd-tbl-select" value={clas}
            onChange={e => setClas(e.target.value)} disabled={saving}>
            <option value="">— sin clasificar —</option>
            {clasSugeridas.map(c => <option key={c}>{c}</option>)}
          </select>
        ) : (
          <input className="cd-tbl-input" value={clas}
            onChange={e => setClas(e.target.value)}
            placeholder="ej: NIGIRIS" disabled={saving} />
        )}
      </td>
      <td>
        <input className="cd-tbl-input" value={subcl}
          onChange={e => setSubcl(e.target.value)}
          placeholder="ej: NIGIRIS" disabled={saving} />
      </td>
      <td className="r">
        {/* Multiplicador: solo relevante para bebidas */}
        <input
          type="number"
          className="cd-tbl-input r"
          value={mult}
          min={1} max={20} step={1}
          style={{
            width: 44,
            color: mult > 1 ? 'var(--vt-gold-dark, #a07830)' : undefined,
            fontWeight: mult > 1 ? 700 : undefined,
          }}
          onChange={e => setMult(Math.max(1, parseInt(e.target.value) || 1))}
          disabled={saving || tipo !== 'bebida'}
          title={tipo !== 'bebida' ? 'Solo aplica a bebidas' : 'Unidades equivalentes (ej: botella vino = 5)'}
        />
      </td>
      <td className="r">
        {/* Costo de insumos por unidad (food cost) */}
        <input
          type="number"
          className="cd-tbl-input r"
          value={costo || ''}
          min={0} step={100}
          style={{
            width: 70,
            color: costo > 0 ? 'var(--vt-red)' : undefined,
          }}
          placeholder="0"
          onChange={e => setCosto(Math.max(0, Number(e.target.value) || 0))}
          disabled={saving}
          title="Costo de insumos por unidad vendida (₡)"
        />
      </td>
      <td style={{ textAlign: 'center' }}>
        {changed && (
          <button className="tips-btn-ghost" style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem' }}
            onClick={() => onSave(nombre, tipo, clas, subcl, mult, costo)} disabled={saving}>
            {saving ? '⟳' : '✓ Guardar'}
          </button>
        )}
      </td>
    </tr>
  )
}
