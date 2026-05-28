import type { TipCalculationResult } from '../../shared/utils/tipCalculations'
import { formatCRC } from '../../shared/utils/tipCalculations'

interface Props {
  calculation: TipCalculationResult
  exchangeRate: number
}

export default function TipSummary({ calculation, exchangeRate }: Props) {
  return (
    <div className="tip-summary">
      <div className="summary-title">Resumen del pool</div>
      <div className="summary-grid">
        <div className="summary-item">
          <span className="summary-label">Pool total</span>
          <span className="summary-value accent">{formatCRC(calculation.total_pool_crc)}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Total puntos</span>
          <span className="summary-value">{calculation.total_points.toFixed(1)}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Valor por punto</span>
          <span className="summary-value">{formatCRC(calculation.value_per_point)}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Tipo de cambio</span>
          <span className="summary-value">₡{exchangeRate.toLocaleString('es-CR')}</span>
        </div>
      </div>
    </div>
  )
}
