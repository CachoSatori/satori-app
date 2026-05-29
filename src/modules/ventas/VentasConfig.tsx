import { useState, useMemo } from 'react'
import type { DiasMap, ProductMap } from '../../shared/types/ventas'
import { updateProductInfo } from '../../shared/api/ventas'

interface Props {
  dias: DiasMap
  pm:   ProductMap
  onRefresh: () => void
}

const TIPOS = ['comida','bebida','cortesia','personal','nofood','desconocido']

export default function VentasConfig({ dias, pm, onRefresh }: Props) {
  const [saving, setSaving] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('desconocido')

  // Collect all unique product names from DIAS
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
    const info = pm[n]
    if (filter === 'todos') return true
    return (info?.tipo ?? 'desconocido') === filter
  })

  const handleUpdate = async (nombre: string, tipo: string, clas: string, subcl: string) => {
    setSaving(nombre)
    try {
      await updateProductInfo(nombre, { tipo, clasificacion: clas, subclasificacion: subcl, multiplicador: 1 })
      onRefresh()
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="vt-section">
      <div className="vt-sl">Clasificación de productos ({allProds.length} únicos en datos)</div>

      <div className="vt-range-bar" style={{ marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.72rem', color: '#888' }}>Filtrar:</span>
        {['todos','desconocido',...TIPOS.filter(t => t !== 'desconocido')].map(t => (
          <button key={t} className={`vt-range-btn ${filter === t ? 'active' : ''}`}
            onClick={() => setFilter(t)}>
            {t} ({t === 'todos' ? allProds.length : allProds.filter(n => (pm[n]?.tipo ?? 'desconocido') === t).length})
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(n => {
              const info = pm[n]
              return (
                <ProductRow key={n} nombre={n} info={info}
                  saving={saving === n}
                  onSave={handleUpdate} />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface RowProps {
  nombre: string
  info:   { tipo?: string; clasificacion?: string; subclasificacion?: string } | undefined
  saving: boolean
  onSave: (nombre: string, tipo: string, clas: string, subcl: string) => void
}

function ProductRow({ nombre, info, saving, onSave }: RowProps) {
  const [tipo,  setTipo]  = useState(info?.tipo ?? 'desconocido')
  const [clas,  setClas]  = useState(info?.clasificacion ?? '')
  const [subcl, setSubcl] = useState(info?.subclasificacion ?? '')
  const changed = tipo !== (info?.tipo ?? 'desconocido') || clas !== (info?.clasificacion ?? '') || subcl !== (info?.subclasificacion ?? '')

  return (
    <tr style={{ background: saving ? '#fffdf5' : '' }}>
      <td style={{ fontSize: '0.8rem', fontWeight: 500 }}>{nombre}</td>
      <td>
        <select className="cd-tbl-select" value={tipo}
          onChange={e => setTipo(e.target.value)} disabled={saving}>
          {['comida','bebida','cortesia','personal','nofood','desconocido'].map(t => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </td>
      <td>
        <input className="cd-tbl-input" value={clas}
          onChange={e => setClas(e.target.value)}
          placeholder="ej: NIGIRIS" disabled={saving} />
      </td>
      <td>
        <input className="cd-tbl-input" value={subcl}
          onChange={e => setSubcl(e.target.value)}
          placeholder="ej: NIGIRIS" disabled={saving} />
      </td>
      <td style={{ textAlign: 'center' }}>
        {changed && (
          <button className="tips-btn-ghost" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
            onClick={() => onSave(nombre, tipo, clas, subcl)} disabled={saving}>
            {saving ? '⟳' : '✓'}
          </button>
        )}
      </td>
    </tr>
  )
}
