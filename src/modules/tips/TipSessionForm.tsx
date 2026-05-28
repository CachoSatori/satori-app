import { useState } from 'react'
import { format } from 'date-fns'

interface Props {
  onSubmit: (date: string, exchangeRate: number, notes?: string) => Promise<void>
  onCancel: () => void
}

export default function TipSessionForm({ onSubmit, onCancel }: Props) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [date, setDate] = useState(today)
  const [exchangeRate, setExchangeRate] = useState('520')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const rate = parseFloat(exchangeRate)
    if (isNaN(rate) || rate <= 0) { setError('Tipo de cambio inválido'); return }
    setLoading(true)
    setError(null)
    try {
      await onSubmit(date, rate, notes || undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
      setLoading(false)
    }
  }

  return (
    <div className="form-card">
      <h3 className="form-title">Abrir turno de propinas</h3>
      <form onSubmit={handleSubmit} className="form-body">
        <div className="field">
          <label>Fecha del turno</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div className="field">
          <label>Tipo de cambio (₡ por USD)</label>
          <input
            type="number"
            value={exchangeRate}
            onChange={e => setExchangeRate(e.target.value)}
            min="1"
            step="0.01"
            required
            disabled={loading}
            placeholder="520.00"
          />
        </div>
        <div className="field">
          <label>Notas (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={loading}
            placeholder="Ej: Turno noche, evento especial…"
          />
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={loading}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Abriendo…' : 'Abrir turno'}
          </button>
        </div>
      </form>
    </div>
  )
}
