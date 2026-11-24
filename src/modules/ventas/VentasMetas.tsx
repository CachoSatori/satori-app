import { useState, useMemo } from 'react'
import type { DiasMap, HistMap, Meta } from '../../shared/types/ventas'
import {
  availableMonths, allSaloneros, metaProgress, fmtMonthLabel,
} from './ventasUtils'
import { saveMetas } from '../../shared/api/ventas'
import { alEscribir, errorDeNumeros, leerCuadro, valorInput, type CuadroNumero } from '../../shared/cuadrosNumericos'

// Un cuadro ilegible («0-450», «5-») queda NaN; vacío sigue siendo 0, como antes. R35.
const leerMeta = (el: HTMLInputElement): number => { const v = leerCuadro(el); return v === '' ? 0 : v }

const GLOBALES: [keyof Meta['global'], string, number, string][] = [
  ['promPax',    'Prom/PAX (₡)',    1000, '₡ '],
  ['bebPax',     'Beb/PAX',         0.1,  ''],
  ['ratioCB',    'Ratio C/B (₡)',   0.1,  ''],
  ['ticketItem', 'Ticket/ítem (₡)', 500,  '₡ '],
  ['ventas',     'Ventas/día (₡)',  50000,'₡ '],
]
const ETIQUETA_SAL: Record<keyof Meta['global'], string> = { promPax: 'Prom/PAX', bebPax: 'Beb/PAX', ratioCB: 'Ratio C/B', ticketItem: 'Ticket/ítem', ventas: 'Ventas/día' }

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

  // Solo se revisan los cuadros que cambiaron (lo guardado de antes no traba): ilegible, negativo o margen > 100 → aviso
  // que nombra el cuadro y no se guarda nada (antes `Number('')` guardaba 0 con texto ilegible a la vista).
  const cambiados: CuadroNumero[] = [
    ...months.slice(0, 12).flatMap(ym => [
      ...(local.restaurante?.[ym] !== metas.restaurante?.[ym] ? [{ nombre: `Meta restaurante · ${fmtMonthLabel(ym)}`, valor: local.restaurante?.[ym], vacioVale: true }] : []),
      ...(local.margen?.[ym] !== metas.margen?.[ym] ? [{ nombre: `% Margen bruto · ${fmtMonthLabel(ym)}`, valor: local.margen?.[ym], max: 100, vacioVale: true }] : []),
    ]),
    ...GLOBALES.filter(([k]) => local.global?.[k] !== metas.global?.[k]).map(([k, label]) => ({ nombre: label, valor: local.global?.[k], vacioVale: true })),
    ...sals.flatMap(sal => (Object.keys(ETIQUETA_SAL) as (keyof Meta['global'])[])
      .filter(k => local.salMetas?.[sal]?.[k] !== metas.salMetas?.[sal]?.[k])
      .map(k => ({ nombre: `${ETIQUETA_SAL[k]} · ${sal}`, valor: local.salMetas?.[sal]?.[k], vacioVale: true }))),
  ]
  const aviso = errorDeNumeros(cambiados)

  const handleSave = async () => {
    if (aviso) return
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
        <button className="tips-btn-teal" onClick={handleSave} disabled={saving || !!aviso}>
          {saving ? 'Guardando…' : '✓ Guardar metas'}
        </button>
      </div>
      {aviso && <p className="field-error" role="alert" style={{ marginBottom: '1rem' }}>{aviso}</p>}

      {/* 3.5.2 (SPEC §12.2): el seguimiento de la meta del mes (vendido, ritmo, proyección, falta para la meta y
          necesario por día) pasó a «Resumen» → «Meta de {mes}», con la proyección ponderada por día de semana. */}
      <div className="vt-kpi-sub" data-testid="metas-seguimiento-movido" style={{ marginBottom: '1rem' }}>
        El seguimiento de la meta del mes (lo vendido, el ritmo, la proyección, lo que falta y lo necesario por día) está
        en «Resumen» → «Meta del mes». Acá se cargan las metas.
      </div>

      {/* Meta mensual restaurante */}
      <div className="vt-sl" style={{ marginTop: '1.5rem' }}>Meta mensual restaurante</div>
      <div className="vt-metas-grid">
        {months.slice(0, 12).map(ym => {
          const prog = metaProgress(local, dias, hist, ym)
          return (
            <div key={ym} className="vt-meta-item">
              <div className="vt-meta-label">{fmtMonthLabel(ym)}</div>
              <div className="cd-monto-wrap">
                <span className="cd-prefix">₡</span>
                <input type="number" className="cd-monto-input"
                  aria-label={`Meta restaurante · ${fmtMonthLabel(ym)}`}
                  value={valorInput(local.restaurante?.[ym] ?? '')}
                  {...alEscribir(el => setRestMeta(ym, leerMeta(el)))}
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
                aria-label={`% Margen bruto · ${fmtMonthLabel(ym)}`}
                value={valorInput(local.margen?.[ym] ?? '')}
                {...alEscribir(el => setMargen(ym, leerMeta(el)))}
                min={0} max={100} step={0.5} placeholder="0" />
            </div>
          </div>
        ))}
      </div>

      {/* Metas globales de performance */}
      <div className="vt-sl" style={{ marginTop: '1.5rem' }}>Metas de performance (generales)</div>
      <div className="vt-kpi-grid">
        {GLOBALES.map(([key, label, step, prefix]) => (
          <div key={key} className="vt-kpi">
            <div className="vt-kpi-label">{label}</div>
            <div className="cd-monto-wrap">
              {prefix && <span className="cd-prefix">{prefix}</span>}
              <input type="number" className="cd-monto-input"
                style={{ paddingLeft: prefix ? '1.75rem' : '0.6rem' }}
                aria-label={label}
                value={valorInput(local.global?.[key] ?? '')}
                {...alEscribir(el => setGlobal(key, leerMeta(el)))}
                min={0} step={step} />
            </div>
          </div>
        ))}
      </div>

      {/* Individual overrides */}
      {sals.length > 0 && (
        <>
          <div className="vt-sl" style={{ marginTop: '1.5rem' }}>Metas individuales (sobrescriben globales)</div>
          <div className="vt-tbl-wrap">
            <table className="vt-tbl">
              <thead>
                <tr>
                  <th>Salonero</th>
                  <th className="r">Prom/PAX</th>
                  <th className="r">Beb/PAX</th>
                  <th className="r">Ratio C/B</th>
                  <th className="r">Ticket/ítem</th>
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
                            aria-label={`${ETIQUETA_SAL[key]} · ${sal}`}
                            value={valorInput(sm[key] ?? '')}
                            {...alEscribir(el => setSalMeta(sal, key, leerMeta(el)))}
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
