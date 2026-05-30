import { useState, useEffect } from 'react'
import { useAuth } from '../../shared/hooks/useAuth'
import { getCurrentRate, getRateHistory, saveRate } from '../../shared/api/exchangeRate'
import { todayCR } from '../../shared/utils'
import type { ExchangeRateRow } from '../../shared/api/exchangeRate'

export default function ExchangeRateWidget() {
  const { profile } = useAuth()
  const [rate,    setRate]    = useState<number>(640)
  const [history, setHistory] = useState<ExchangeRateRow[]>([])
  const [input,   setInput]   = useState<number | ''>(640)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getCurrentRate(), getRateHistory(10)])
      .then(([r, h]) => { setRate(r); setInput(r); setHistory(h) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    if (!profile || !input || Number(input) <= 0) return
    setSaving(true)
    setMsg(null)
    try {
      await saveRate({
        rate_date:  todayCR(),
        usd_to_crc: Number(input),
        source:     'manual',
        created_by: profile.id,
      })
      setRate(Number(input))
      const h = await getRateHistory(10)
      setHistory(h)
      setMsg('✓ Guardado')
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setMsg(e instanceof Error ? '✗ ' + e.message : '✗ Error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <div className="xr-widget">
      <div className="xr-header">
        <div>
          <div className="xr-title">Tipo de cambio</div>
          <div className="xr-subtitle">Usado en propinas y caja para convertir USD → ₡</div>
        </div>
        <div className="xr-current">
          <span className="xr-current-label">Vigente hoy</span>
          <span className="xr-current-val">₡ {rate.toLocaleString('es-CR')}</span>
          <span className="xr-current-unit">por USD</span>
        </div>
      </div>

      <div className="xr-form">
        <div className="tips-field">
          <div className="tips-field-label">Nuevo tipo de cambio (₡ por 1 USD)</div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="cd-monto-wrap" style={{ minWidth: 160 }}>
              <span className="cd-prefix">₡</span>
              <input
                type="number"
                className="cd-monto-input"
                value={input}
                min={400}
                max={900}
                step={1}
                onChange={e => setInput(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="640"
              />
            </div>
            <button
              className="tips-btn-teal"
              onClick={handleSave}
              disabled={saving || !input || Number(input) <= 0}
            >
              {saving ? 'Guardando…' : 'Actualizar'}
            </button>
            {msg && (
              <span style={{ fontSize: '0.82rem', color: msg.startsWith('✓') ? 'var(--t-teal)' : 'var(--t-red)' }}>
                {msg}
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '0.4rem' }}>
            Referencia BCCR: <a href="https://gee.bccr.fi.cr/" target="_blank" rel="noreferrer" style={{ color: 'var(--t-teal)' }}>gee.bccr.fi.cr</a>
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <div className="xr-history">
          <div className="tips-field-label" style={{ marginBottom: '0.5rem' }}>Historial reciente</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--t-border)' }}>
                <th style={{ textAlign: 'left', padding: '0.3rem 0', color: 'var(--t-teal)', fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Fecha</th>
                <th style={{ textAlign: 'right', padding: '0.3rem 0', color: 'var(--t-teal)', fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>₡ / USD</th>
                <th style={{ textAlign: 'right', padding: '0.3rem 0', color: 'var(--t-teal)', fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Fuente</th>
              </tr>
            </thead>
            <tbody>
              {history.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--t-border)' }}>
                  <td style={{ padding: '0.4rem 0' }}>{r.rate_date}</td>
                  <td style={{ textAlign: 'right', padding: '0.4rem 0', fontWeight: 600 }}>
                    ₡ {Number(r.usd_to_crc).toLocaleString('es-CR')}
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.4rem 0', color: '#888', fontSize: '0.72rem' }}>
                    {r.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
