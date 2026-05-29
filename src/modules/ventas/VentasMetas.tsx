import { useState, useMemo } from 'react'
import type { DiasMap, HistMap, Meta } from '../../shared/types/ventas'
import {
  availableMonths, allSaloneros, metaProgress,
  fmtMonthLabel,
} from './ventasUtils'
import { saveMetas } from '../../shared/api/ventas'

interface Props {
  dias:  DiasMap
  hist:  HistMap
  metas: Meta
  onMetasUpdated: (m: Meta) => void
}

export default function VentasMetas({ dias, hist, metas, onMetasUpdated }: Props) {
  const months = useMemo(() => availableMonths(dias, hist), [dias, hist])
  const sals   = useMemo(() => allSaloneros(dias), [dias])
  const [saving, setSaving] = useState(false)
  const [local, setLocal] = useState<Meta>(() => JSON.parse(JSON.stringify(metas)))

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveMetas(local)
      onMetasUpdated(local)
    } finally {
      setSaving(false)
    }
  }

  const setRestMeta = (ym: string, val: number) =>
    setLocal(prev => ({ ...prev, restaurante: { ...prev.restaurante, [ym]: val } }))

  const setMargen = (ym: string, val: number) =>
    setLocal(prev => ({ ...prev, margen: { ...prev.margen, [ym]: val } }))

  const setGlobal = (key: keyof Meta['global'], val: number) =>
    setLocal(prev => ({ ...prev, global: { ...prev.global, [key]: val } }))

  const setSalMeta = (sal: string, key: string, val: number) =>
    setLocal(prev => ({
      ...prev,
      salMetas: {
        ...prev.salMetas,
        [sal]: { ...prev.salMetas?.[sal], [key]: val },
      },
    }))

  return (
    <div className="vt-section">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button className="tips-btn-teal" onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando…' : '✓ Guardar metas'}
        </button>
      </div>

      {/* Meta mensual restaurante */}
      <div className="vt-sl">Meta mensual restaurante</div>
      <div className="vt-metas-grid">
        {months.slice(0, 12).map(ym => {
          const prog = metaProgress(local, dias, hist, ym)
          return (
            <div key={ym} className="vt-meta-item">
              <div className="vt-meta-label">{fmtMonthLabel(ym)}</div>
              <div className="cd-monto-wrap">
                <span className="cd-prefix">₡</span>
                <input type="number" className="cd-monto-input"
                  value={local.restaurante?.[ym] ?? ''}
                  onChange={e => setRestMeta(ym, Number(e.target.value))}
                  min={0} step={100000} placeholder="0" />
              </div>
              {prog && (
                <div className="vt-meta-prog">
                  <div className="vt-progress-track" style={{ marginTop: '0.3rem' }}>
                    <div className="vt-progress-fill" style={{
                      width: `${Math.min(prog.pct, 100)}%`,
                      background: prog.onTrack ? 'var(--vt-green)' : 'var(--vt-red)',
                    }} />
                  </div>
                  <span style={{ color: prog.onTrack ? 'var(--vt-green)' : 'var(--vt-red)', fontSize: '0.72rem' }}>
                    {prog.pct.toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Margen bruto */}
      <div className="vt-sl" style={{ marginTop: '1.5rem' }}>% Margen bruto (contador)</div>
      <div className="vt-metas-grid">
        {months.slice(0, 12).map(ym => (
          <div key={ym} className="vt-meta-item">
            <div className="vt-meta-label">{fmtMonthLabel(ym)}</div>
            <div className="cd-monto-wrap">
              <span className="cd-prefix">%</span>
              <input type="number" className="cd-monto-input"
                value={local.margen?.[ym] ?? ''}
                onChange={e => setMargen(ym, Number(e.target.value))}
                min={0} max={100} step={0.5} placeholder="0" />
            </div>
          </div>
        ))}
      </div>

      {/* Metas globales de performance */}
      <div className="vt-sl" style={{ marginTop: '1.5rem' }}>Metas de performance (generales)</div>
      <div className="vt-kpi-grid">
        {([
          ['promPax',    'Prom/PAX (₡)',    1000, '₡ '],
          ['bebPax',     'Beb/PAX',         0.1,  ''],
          ['ratioCB',    'Ratio C/B (₡)',   0.1,  ''],
          ['ticketItem', 'Ticket/item (₡)', 500,  '₡ '],
          ['ventas',     'Ventas/día (₡)',  50000,'₡ '],
        ] as [keyof Meta['global'], string, number, string][]).map(([key, label, step, prefix]) => (
          <div key={key} className="vt-kpi">
            <div className="vt-kpi-label">{label}</div>
            <div className="cd-monto-wrap">
              {prefix && <span className="cd-prefix">{prefix}</span>}
              <input type="number" className="cd-monto-input"
                style={{ paddingLeft: prefix ? '1.75rem' : '0.6rem' }}
                value={local.global?.[key] ?? ''}
                onChange={e => setGlobal(key, Number(e.target.value))}
                min={0} step={step} />
            </div>
          </div>
        ))}
      </div>

      {/* Individual overrides */}
      {sals.length > 0 && (
        <>
          <div className="vt-sl" style={{ marginTop: '1.5rem' }}>Metas individuales (sobreescriben globales)</div>
          <div className="vt-tbl-wrap">
            <table className="vt-tbl">
              <thead>
                <tr>
                  <th>Salonero</th>
                  <th className="r">Prom/PAX</th>
                  <th className="r">Beb/PAX</th>
                  <th className="r">Ratio C/B</th>
                  <th className="r">Ticket/item</th>
                  <th className="r">Ventas/día</th>
                </tr>
              </thead>
              <tbody>
                {sals.map(sal => {
                  const sm = local.salMetas?.[sal] ?? {}
                  return (
                    <tr key={sal}>
                      <td style={{ fontWeight: 600 }}>{sal}</td>
                      {(['promPax','bebPax','ratioCB','ticketItem','ventas'] as const).map(key => (
                        <td key={key} className="r">
                          <input type="number" className="vt-meta-input-sm"
                            value={sm[key] ?? ''}
                            onChange={e => setSalMeta(sal, key, Number(e.target.value))}
                            placeholder={String(local.global?.[key] ?? '')} />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
