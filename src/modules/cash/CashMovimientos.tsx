import { useState, useCallback, useMemo } from 'react'
import type { CashMovement, CashSession, MovementType } from '../../shared/types/database'
import { updateCashMovement, deleteCashMovement } from '../../shared/api/cash'
import { todayCR } from '../../shared/utils'
import { MOVEMENT_LABELS, MOVEMENT_TYPES, CAJAS_ORIGEN, METODOS_PAGO, isEgreso, tipoColor, fi, todayStr } from './cashUtils'

interface Props {
  movements: CashMovement[]
  sessions:  CashSession[]
  onRefresh: () => void
}

export default function CashMovimientos({ movements, sessions, onRefresh }: Props) {
  const sesionMap = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions])

  const defaultFrom = (() => { const d = new Date(todayCR() + 'T12:00:00'); d.setDate(d.getDate() - 60); return d.toISOString().slice(0, 10) })()
  const [from,    setFrom]    = useState(defaultFrom)
  const [to,      setTo]      = useState(todayStr())
  const [tipo,    setTipo]    = useState('')
  const [busq,    setBusq]    = useState('')
  const [estado,  setEstado]  = useState('')
  const [saving,  setSaving]  = useState<string | null>(null)

  // ── Filter ───────────────────────────────────────────────
  const filtered = movements.filter(m => {
    const ses = sesionMap.get(m.session_id)
    const fecha = ses?.session_date ?? ''
    if (from   && fecha < from)  return false
    if (to     && fecha > to)    return false
    if (tipo   && m.movement_type !== tipo) return false
    if (estado) {
      const s = m.status === 'pendiente' ? 'Pendiente' : 'Pagado'
      if (s !== estado) return false
    }
    if (busq) {
      const q = busq.toLowerCase()
      if (!(
        m.supplier_name.toLowerCase().includes(q) ||
        m.employee_name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
      )) return false
    }
    return true
  }).sort((a, b) => {
    const da = sesionMap.get(a.session_id)?.session_date ?? ''
    const db = sesionMap.get(b.session_id)?.session_date ?? ''
    return db.localeCompare(da) || b.created_at.localeCompare(a.created_at)
  })

  // ── Saldos ───────────────────────────────────────────────
  // BUG-2 FIX: filter both entradas AND salidas by caja_origen='Caja Fuerte'
  const cfEntradas = movements
    .filter(m => m.movement_type === 'ingreso' && m.caja_origen === 'Caja Fuerte' && m.status !== 'pendiente')
    .reduce((s, m) => s + m.amount_crc, 0)
  const cfSalidas = movements
    .filter(m => isEgreso(m.movement_type as MovementType) && m.caja_origen === 'Caja Fuerte' && m.status !== 'pendiente')
    .reduce((s, m) => s + m.amount_crc, 0)
  const cfSaldo = cfEntradas - cfSalidas

  const pendTotal = movements.filter(m => m.status === 'pendiente').reduce((s, m) => s + m.amount_crc, 0)
  const pendCount = movements.filter(m => m.status === 'pendiente').length

  const totIngresos = filtered.filter(m => m.movement_type === 'ingreso').reduce((s, m) => s + m.amount_crc, 0)
  const totEgresos  = filtered.filter(m => isEgreso(m.movement_type as MovementType)).reduce((s, m) => s + m.amount_crc, 0)

  // ── Actions ──────────────────────────────────────────────
  const handleFieldChange = useCallback(async (id: string, field: string, value: unknown) => {
    setSaving(id)
    try {
      await updateCashMovement(id, { [field]: value } as never)
      if (field === 'status') {
        // just update status
      }
      onRefresh()
    } catch {
      // revert handled by onRefresh
    } finally {
      setSaving(null)
    }
  }, [onRefresh])

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm('¿Eliminar este movimiento? Esta acción no se puede deshacer.')) return
    setSaving(id)
    try {
      await deleteCashMovement(id)
      onRefresh()
    } finally {
      setSaving(null)
    }
  }, [onRefresh])

  const exportCSV = () => {
    const BOM = '﻿'
    const hdrs = ['Fecha','Turno','Tipo','Descripción','Proveedor/Empleado','₡','$','Método','Caja','Estado']
    const rows = filtered.map(m => {
      const ses = sesionMap.get(m.session_id)
      return [
        ses?.session_date ?? '',
        ses?.shift_type ?? '',
        MOVEMENT_LABELS[m.movement_type as MovementType] ?? m.movement_type,
        m.description,
        m.supplier_name || m.employee_name || '',
        m.amount_crc,
        m.amount_usd,
        m.method,
        m.caja_origen,
        m.status === 'pendiente' ? 'Pendiente' : 'Pagado',
      ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')
    })
    const csv = BOM + [hdrs.join(','), ...rows].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `satori_movimientos_${from}_${to}.csv`
    a.click()
  }

  return (
    <div>
      {/* Saldos */}
      <div className="cd-saldos-bar">
        <div className={`cd-saldo-card ${cfSaldo < 0 ? 'red' : ''}`} style={{ borderLeftColor: '#c8a96e' }}>
          <div className="cd-saldo-label">Caja Fuerte</div>
          <div className={`cd-saldo-val ${cfSaldo < 0 ? 'red' : ''}`}>{fi(cfSaldo)}</div>
        </div>
        <div className="cd-saldo-card" style={{ borderLeftColor: pendTotal > 0 ? '#c8a030' : '#444' }}>
          <div className="cd-saldo-label">Pend. Transferencia</div>
          <div className="cd-saldo-val" style={{ color: pendTotal > 0 ? '#c8a030' : '#555', fontSize: pendTotal > 0 ? '17px' : '13px' }}>
            {pendTotal > 0 ? fi(pendTotal) : 'Sin pendientes'}
          </div>
          {pendTotal > 0 && <div style={{ fontSize: '9px', color: '#888', marginTop: '3px' }}>{pendCount} pago{pendCount !== 1 ? 's' : ''}</div>}
        </div>
        <div className="cd-saldo-card" style={{ borderLeftColor: '#27874f' }}>
          <div className="cd-saldo-label">Ingresos (período)</div>
          <div className="cd-saldo-val" style={{ color: '#27874f' }}>{fi(totIngresos)}</div>
        </div>
        <div className="cd-saldo-card" style={{ borderLeftColor: '#c0392b' }}>
          <div className="cd-saldo-label">Egresos (período)</div>
          <div className="cd-saldo-val" style={{ color: '#c0392b' }}>{fi(totEgresos)}</div>
        </div>
      </div>

      {/* Filters + actions */}
      <div className="cd-filters-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', flex: 1 }}>
          <label>Desde</label>
          <input className="cd-filter-input" type="date" value={from} onChange={e => setFrom(e.target.value)} />
          <label>Hasta</label>
          <input className="cd-filter-input" type="date" value={to} onChange={e => setTo(e.target.value)} />
          <label>Tipo</label>
          <select className="cd-filter-select" value={tipo} onChange={e => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {MOVEMENT_TYPES.map(t => <option key={t} value={t}>{MOVEMENT_LABELS[t]}</option>)}
          </select>
          <label>Estado</label>
          <select className="cd-filter-select" value={estado} onChange={e => setEstado(e.target.value)}>
            <option value="">Todos</option>
            <option>Pagado</option>
            <option>Pendiente</option>
          </select>
          <input className="cd-filter-input" style={{ minWidth: 140 }} value={busq} placeholder="Buscar..."
            onChange={e => setBusq(e.target.value)} />
        </div>
        <button className="tips-btn-ghost" style={{ fontSize: '0.8rem' }} onClick={exportCSV}>⬇ CSV</button>
      </div>

      {/* Table */}
      <div className="cd-tbl-wrap">
        <table className="cd-tbl">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Turno</th>
              <th>Tipo</th>
              <th>Descripción</th>
              <th>Prov./Emp.</th>
              <th className="r">₡</th>
              <th className="r">$</th>
              <th>Método</th>
              <th>Caja</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={11} style={{ textAlign: 'center', padding: '2rem', color: '#888', fontSize: '0.85rem' }}>
                Sin movimientos en el período
              </td></tr>
            )}
            {filtered.map(m => {
              const ses = sesionMap.get(m.session_id)
              const col = tipoColor(m.movement_type)
              const isPend = m.status === 'pendiente'

              return (
                <tr key={m.id} style={{ background: isPend ? '#fffdf5' : '' }}>
                  <td style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{ses?.session_date ?? '—'}</td>
                  <td style={{ fontSize: '0.78rem' }}>
                    <select className="cd-tbl-select" value={m.shift ?? ''}
                      onChange={e => handleFieldChange(m.id, 'shift', e.target.value)}
                      disabled={saving === m.id}>
                      <option value="">—</option>
                      <option>Mediodía</option>
                      <option>Noche</option>
                      <option>General</option>
                    </select>
                  </td>
                  <td>
                    <select className="cd-tbl-select" value={m.movement_type}
                      onChange={e => handleFieldChange(m.id, 'movement_type', e.target.value)}
                      disabled={saving === m.id}>
                      {MOVEMENT_TYPES.map(t => <option key={t} value={t}>{MOVEMENT_LABELS[t]}</option>)}
                    </select>
                  </td>
                  <td>
                    {/* Uncontrolled inputs — edits committed on blur to avoid re-render per keystroke */}
                    <input key={m.id + '-desc'} className="cd-tbl-input"
                      defaultValue={m.description}
                      onBlur={e => handleFieldChange(m.id, 'description', e.target.value)}
                      disabled={saving === m.id} />
                  </td>
                  <td>
                    <input key={m.id + '-pe'} className="cd-tbl-input"
                      defaultValue={m.supplier_name || m.employee_name}
                      onBlur={e => {
                        handleFieldChange(m.id, 'supplier_name', e.target.value)
                        handleFieldChange(m.id, 'employee_name', e.target.value)
                      }}
                      disabled={saving === m.id} />
                  </td>
                  <td className="r">
                    <input key={m.id + '-crc'} className="cd-tbl-input r" type="number"
                      defaultValue={m.amount_crc || ''}
                      style={{ color: col, fontWeight: 600 }}
                      onBlur={e => handleFieldChange(m.id, 'amount_crc', Number(e.target.value) || 0)}
                      disabled={saving === m.id} />
                  </td>
                  <td className="r">
                    <input key={m.id + '-usd'} className="cd-tbl-input r" type="number"
                      defaultValue={m.amount_usd || ''}
                      style={{ color: '#7ab4d4' }}
                      onBlur={e => handleFieldChange(m.id, 'amount_usd', Number(e.target.value) || 0)}
                      disabled={saving === m.id} />
                  </td>
                  <td>
                    <select className="cd-tbl-select" value={m.method ?? 'Efectivo'}
                      onChange={e => handleFieldChange(m.id, 'method', e.target.value)}
                      disabled={saving === m.id}>
                      {METODOS_PAGO.map(mt => <option key={mt}>{mt}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="cd-tbl-select" value={m.caja_origen ?? 'Caja Fuerte'}
                      onChange={e => handleFieldChange(m.id, 'caja_origen', e.target.value)}
                      disabled={saving === m.id}>
                      {CAJAS_ORIGEN.map(ca => <option key={ca}>{ca}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="cd-tbl-select"
                      style={{ fontWeight: 700, color: isPend ? '#c8a030' : '#4a7c59' }}
                      value={isPend ? 'Pendiente' : 'Pagado'}
                      onChange={e => handleFieldChange(m.id, 'status', e.target.value === 'Pendiente' ? 'pendiente' : 'aprobado')}
                      disabled={saving === m.id}>
                      <option>Pagado</option>
                      <option>Pendiente</option>
                    </select>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button className="cd-mov-del" onClick={() => handleDelete(m.id)}
                      disabled={saving === m.id}>×</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="cd-tbl-footer">
                <td colSpan={5}>{filtered.length} movimientos · Resultado del período</td>
                <td className="r" style={{ color: totIngresos - totEgresos >= 0 ? '#7ec8a0' : '#c23b22', fontWeight: 800 }}>
                  {totIngresos - totEgresos >= 0 ? '+' : ''}{fi(totIngresos - totEgresos)}
                </td>
                <td colSpan={5}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Mobile card list (shown instead of table on <760px) ── */}
      <div className="cd-mov-mobile-list" style={{ flexDirection: 'column', gap: '0.5rem' }}>
        {filtered.map(m => {
          const ses = sesionMap.get(m.session_id)
          const isIng  = m.movement_type === 'ingreso'
          const isEg   = isEgreso(m.movement_type as MovementType)
          const amtColor = isIng ? '#27874f' : isEg ? '#c0392b' : '#5a5040'
          const typeBg   = isIng ? '#d4edda' : isEg ? '#f8d7da' : 'rgba(0,0,0,0.06)'
          const typeCol  = isIng ? '#155724' : isEg ? '#721c24' : 'var(--t-ink)'
          const isPend   = m.status === 'pendiente'
          return (
            <div key={m.id} style={{
              background: isPend ? '#fffdf5' : '#fff',
              border: `1px solid ${isPend ? '#e0c878' : 'var(--t-border)'}`,
              borderRadius: 2, padding: '0.75rem 0.875rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 99, background: typeBg, color: typeCol }}>
                  {MOVEMENT_LABELS[m.movement_type as MovementType] ?? m.movement_type}
                </span>
                <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 800, fontSize: '0.95rem', color: amtColor }}>
                  {isIng ? '+' : isEg ? '−' : ''}{fi(m.amount_crc)}
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--t-ink)', marginBottom: '0.15rem' }}>
                {m.description || m.supplier_name || m.employee_name || '—'}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.68rem', color: '#5a5040' }}>
                <span>{ses?.session_date ?? '—'}</span>
                <span>{m.method}</span>
                <span>{m.caja_origen}</span>
                {isPend && <span style={{ color: '#c8a030', fontWeight: 700 }}>Pendiente</span>}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#888', fontSize: '0.85rem' }}>
            Sin movimientos en el período
          </div>
        )}
      </div>
    </div>
  )
}
