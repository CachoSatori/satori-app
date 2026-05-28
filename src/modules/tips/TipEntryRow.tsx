import { useState, useEffect } from 'react'
import type { Employee, TipEntry } from '../../shared/types/database'
import type { TipCalculationRow } from '../../shared/utils/tipCalculations'
import { formatCRC } from '../../shared/utils/tipCalculations'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario', manager: 'Encargado', cajero: 'Cajero',
  salonero: 'Salonero', barman: 'Barman', barback: 'Barback',
  runner: 'Runner', cocina: 'Cocina',
}

interface Props {
  employee: Employee
  entry: TipEntry | undefined
  calcRow: TipCalculationRow | undefined
  showCalc: boolean
  isManager: boolean
  onSave: (employeeId: string, hours: number, crc: number, usd: number) => Promise<void>
  onDelete: (employeeId: string) => Promise<void>
}

export default function TipEntryRow({
  employee, entry, calcRow, showCalc, isManager, onSave, onDelete,
}: Props) {
  const [hours, setHours] = useState(entry?.hours_worked?.toString() ?? '')
  const [crc, setCrc] = useState(entry?.tip_amount_crc?.toString() ?? '0')
  const [usd, setUsd] = useState(entry?.tip_amount_usd?.toString() ?? '0')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Sincronizar si la entrada cambia externamente
  useEffect(() => {
    if (entry) {
      setHours(entry.hours_worked.toString())
      setCrc(entry.tip_amount_crc.toString())
      setUsd(entry.tip_amount_usd.toString())
      setDirty(false)
    }
  }, [entry])

  const handleSave = async () => {
    const h = parseFloat(hours)
    const c = parseFloat(crc) || 0
    const u = parseFloat(usd) || 0
    if (isNaN(h) || h <= 0) return
    setSaving(true)
    await onSave(employee.id, h, c, u)
    setSaving(false)
    setDirty(false)
  }

  const handleDelete = async () => {
    if (!entry) return
    setSaving(true)
    await onDelete(employee.id)
    setSaving(false)
    setHours('')
    setCrc('0')
    setUsd('0')
  }

  const hasEntry = !!entry

  return (
    <tr className={`tip-row ${hasEntry ? 'has-entry' : ''}`}>
      <td className="tip-cell-name">{employee.full_name}</td>
      <td className="tip-cell-role">
        <span className="role-tag">{ROLE_LABELS[employee.role] ?? employee.role}</span>
      </td>
      <td className="tip-cell-input">
        {isManager ? (
          <input
            type="number" min="0.5" max="24" step="0.5"
            value={hours} placeholder="0"
            onChange={e => { setHours(e.target.value); setDirty(true) }}
            disabled={saving}
            className="tip-input"
          />
        ) : (
          <span>{entry?.hours_worked ?? '—'}</span>
        )}
      </td>
      <td className="tip-cell-input">
        {isManager ? (
          <input
            type="number" min="0" step="100"
            value={crc} placeholder="0"
            onChange={e => { setCrc(e.target.value); setDirty(true) }}
            disabled={saving}
            className="tip-input"
          />
        ) : (
          <span>{entry ? formatCRC(entry.tip_amount_crc) : '—'}</span>
        )}
      </td>
      <td className="tip-cell-input">
        {isManager ? (
          <input
            type="number" min="0" step="0.01"
            value={usd} placeholder="0.00"
            onChange={e => { setUsd(e.target.value); setDirty(true) }}
            disabled={saving}
            className="tip-input"
          />
        ) : (
          <span>{entry ? `$${entry.tip_amount_usd}` : '—'}</span>
        )}
      </td>
      {showCalc && (
        <td className="tip-cell-points">
          {calcRow ? calcRow.points.toFixed(1) : '—'}
        </td>
      )}
      {showCalc && (
        <td className="tip-cell-payout">
          {calcRow ? <strong>{formatCRC(calcRow.payout_crc)}</strong> : '—'}
        </td>
      )}
      {isManager && (
        <td className="tip-cell-actions">
          {dirty && (
            <button className="btn-save-inline" onClick={handleSave} disabled={saving}>
              {saving ? '…' : 'Guardar'}
            </button>
          )}
          {hasEntry && !dirty && (
            <button className="btn-delete-inline" onClick={handleDelete} disabled={saving}>
              ✕
            </button>
          )}
        </td>
      )}
    </tr>
  )
}
