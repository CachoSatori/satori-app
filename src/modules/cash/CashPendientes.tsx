import { useState, useMemo } from 'react'
import type { CashMovement, CashSession } from '../../shared/types/database'
import { updateMovementStatus } from '../../shared/api/cash'
import { fi, fd } from './cashUtils'
import { dateCR } from '../../shared/utils'

interface Props {
  movements: CashMovement[]
  sessions:  CashSession[]
  onRefresh: () => void
}

const N = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

interface Row {
  id: string
  fecha: string
  turno: string
  crc: number
  usd: number
  ref: string
}
interface Group {
  key: string
  name: string
  rows: Row[]
  totalCRC: number
  totalUSD: number
}

export default function CashPendientes({ movements, sessions, onRefresh }: Props) {
  const sesionMap = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  // ── Agrupar pendientes por proveedor ───────────────────────
  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Group>()
    movements
      .filter(m => m.status === 'pendiente')
      .forEach(m => {
        const name = (m.supplier_name || m.employee_name || m.description || 'Sin proveedor').trim()
        const key = name.toLowerCase()
        const ses = sesionMap.get(m.session_id ?? '')
        // Nivel-día (sin turno): fecha LOCAL CR del registro (dateCR), no slice UTC.
        const fecha = ses?.session_date ?? dateCR(m.created_at)
        const turno = m.shift || ses?.shift_type || ''
        if (!map.has(key)) map.set(key, { key, name, rows: [], totalCRC: 0, totalUSD: 0 })
        const g = map.get(key)!
        g.rows.push({ id: m.id, fecha, turno, crc: N(m.amount_crc), usd: N(m.amount_usd), ref: m.description || m.subcategory || '' })
        g.totalCRC += N(m.amount_crc)
        g.totalUSD += N(m.amount_usd)
      })
    const arr = [...map.values()]
    arr.forEach(g => g.rows.sort((a, b) => a.fecha.localeCompare(b.fecha)))
    return arr.sort((a, b) => b.totalCRC - a.totalCRC)
  }, [movements, sesionMap])

  const totalCRC = groups.reduce((s, g) => s + g.totalCRC, 0)
  const totalUSD = groups.reduce((s, g) => s + g.totalUSD, 0)
  const totalCount = groups.reduce((s, g) => s + g.rows.length, 0)

  const toggleSel = (id: string) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const toggleCollapse = (key: string) => setCollapsed(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n
  })
  const selGroupAll = (g: Group, on: boolean) => setSelected(prev => {
    const n = new Set(prev); g.rows.forEach(r => on ? n.add(r.id) : n.delete(r.id)); return n
  })

  // ── Marcar pagado ──────────────────────────────────────────
  const pagar = async (ids: string[]) => {
    if (!ids.length) return
    setSaving(true)
    try {
      await Promise.all(ids.map(id => updateMovementStatus(id, 'aprobado')))
      setSelected(prev => { const n = new Set(prev); ids.forEach(i => n.delete(i)); return n })
      onRefresh()
    } finally { setSaving(false) }
  }

  // ── Comprobante (imagen PNG por Canvas) ────────────────────
  const descargarComprobante = (g: Group, onlySelected: boolean) => {
    const rows = onlySelected ? g.rows.filter(r => selected.has(r.id)) : g.rows
    if (!rows.length) return
    const sumCRC = rows.reduce((s, r) => s + r.crc, 0)
    const sumUSD = rows.reduce((s, r) => s + r.usd, 0)

    const W = 760, padX = 40, rowH = 38, headerH = 200, footH = 120
    const H = headerH + rows.length * rowH + footH
    const c = document.createElement('canvas')
    const scale = 2
    c.width = W * scale; c.height = H * scale
    const ctx = c.getContext('2d')!
    ctx.scale(scale, scale)

    // fondo
    ctx.fillStyle = '#f5f0e8'; ctx.fillRect(0, 0, W, H)
    // encabezado
    ctx.fillStyle = '#0d0d0d'
    ctx.font = 'bold 30px Georgia, serif'
    ctx.fillText('Satori Sushi Bar', padX, 56)
    ctx.font = '14px Arial'; ctx.fillStyle = '#8a8070'
    ctx.fillText('Comprobante de pago a proveedor', padX, 80)
    ctx.font = 'bold 24px Arial'; ctx.fillStyle = '#0d0d0d'
    ctx.fillText(g.name, padX, 124)
    ctx.font = '13px Arial'; ctx.fillStyle = '#8a8070'
    ctx.fillText(`Emitido: ${new Date().toLocaleDateString('es-CR')}   ·   ${rows.length} factura(s)`, padX, 148)

    // header tabla
    let y = headerH - 16
    ctx.strokeStyle = '#d4cfc4'; ctx.beginPath(); ctx.moveTo(padX, y - 22); ctx.lineTo(W - padX, y - 22); ctx.stroke()
    ctx.font = 'bold 12px Arial'; ctx.fillStyle = '#8a8070'
    ctx.fillText('FECHA', padX, y - 4)
    ctx.fillText('REFERENCIA / NOTA', padX + 130, y - 4)
    ctx.textAlign = 'right'; ctx.fillText('MONTO', W - padX, y - 4); ctx.textAlign = 'left'

    // filas
    ctx.font = '14px Arial'
    rows.forEach(r => {
      ctx.fillStyle = '#0d0d0d'
      ctx.fillText(r.fecha || '—', padX, y + rowH - 14)
      const ref = (r.ref || '—').slice(0, 38)
      ctx.fillStyle = '#5a5040'; ctx.fillText(ref, padX + 130, y + rowH - 14)
      ctx.fillStyle = '#0d0d0d'; ctx.textAlign = 'right'
      ctx.font = 'bold 14px Arial'
      ctx.fillText(r.crc ? fi(r.crc) : (r.usd ? fd(r.usd) : '—'), W - padX, y + rowH - 14)
      ctx.font = '14px Arial'; ctx.textAlign = 'left'
      ctx.strokeStyle = '#e6e0d4'; ctx.beginPath(); ctx.moveTo(padX, y + rowH - 2); ctx.lineTo(W - padX, y + rowH - 2); ctx.stroke()
      y += rowH
    })

    // total
    y += 18
    ctx.strokeStyle = '#0d0d0d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(padX, y - 26); ctx.lineTo(W - padX, y - 26); ctx.stroke(); ctx.lineWidth = 1
    ctx.font = 'bold 16px Arial'; ctx.fillStyle = '#0d0d0d'
    ctx.fillText('TOTAL A PAGAR', padX, y)
    ctx.textAlign = 'right'; ctx.font = 'bold 22px Georgia, serif'; ctx.fillStyle = '#2a7a6a'
    const totalTxt = sumCRC ? fi(sumCRC) : ''
    const usdTxt = sumUSD ? (sumCRC ? '  ·  ' : '') + fd(sumUSD) : ''
    ctx.fillText(totalTxt + usdTxt, W - padX, y + 2); ctx.textAlign = 'left'
    ctx.font = '11px Arial'; ctx.fillStyle = '#8a8070'
    ctx.fillText('Documento generado automáticamente · Satori · Santa Teresa, CR', padX, H - 24)

    c.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `comprobante_${g.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.png`
      a.click(); URL.revokeObjectURL(url)
    }, 'image/png')
  }

  if (!totalCount) {
    return (
      <div className="tips-empty-state">
        <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>✓</div>
        <p className="tips-empty-text">Sin facturas pendientes</p>
      </div>
    )
  }

  return (
    <div>
      {/* Resumen global */}
      <div className="cd-pend-summary" style={{ marginBottom: '1.25rem' }}>
        <div>
          <div className="cd-saldo-label">Total pendiente</div>
          <div className="cd-saldo-val" style={{ color: '#c8a030' }}>{fi(totalCRC)}</div>
          {totalUSD > 0 && <div style={{ fontSize: '0.85rem', color: '#7ab4d4' }}>{fd(totalUSD)}</div>}
        </div>
        <div className="cd-saldo-label" style={{ alignSelf: 'center' }}>
          {totalCount} factura{totalCount !== 1 ? 's' : ''} · {groups.length} proveedor{groups.length !== 1 ? 'es' : ''}
        </div>
      </div>

      {groups.map(g => {
        const selInGroup = g.rows.filter(r => selected.has(r.id))
        const allSel = selInGroup.length === g.rows.length && g.rows.length > 0
        const isCollapsed = collapsed.has(g.key)
        return (
          <div key={g.key} className="cd-prov-card" style={{ marginBottom: '1.25rem', padding: 0, overflow: 'hidden' }}>
            {/* Header proveedor */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0.9rem 1.1rem', borderBottom: isCollapsed ? 'none' : '1px solid var(--t-border)' }}>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: '#c8a030', display: 'inline-block' }} />
                <div>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--t-ink)' }}>{g.name}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--t-muted)' }}>Proveedor · {g.rows.length} pago{g.rows.length !== 1 ? 's' : ''} pendiente{g.rows.length !== 1 ? 's' : ''}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontWeight: 800, fontSize: '1.6rem', color: '#c8a030' }}>{fi(g.totalCRC)}</div>
                {g.totalUSD > 0 && <div style={{ fontSize: '0.8rem', color: '#7ab4d4' }}>{fd(g.totalUSD)}</div>}
                <button onClick={() => toggleCollapse(g.key)}
                  style={{ background: 'none', border: 'none', color: 'var(--t-muted)', cursor: 'pointer', fontSize: '0.72rem' }}>
                  {isCollapsed ? '▶ ver detalle' : '▼ ocultar'}
                </button>
              </div>
            </div>

            {!isCollapsed && (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table className="cd-tbl" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 36, textAlign: 'center' }}>
                          <input type="checkbox" checked={allSel} onChange={e => selGroupAll(g, e.target.checked)} />
                        </th>
                        <th style={{ textAlign: 'left' }}>FECHA</th>
                        <th style={{ textAlign: 'left' }}>TURNO</th>
                        <th style={{ textAlign: 'right' }}>₡</th>
                        <th style={{ textAlign: 'right' }}>$</th>
                        <th style={{ textAlign: 'left' }}>REFERENCIA / NOTA</th>
                        <th style={{ textAlign: 'center' }}>ACCIÓN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map(r => (
                        <tr key={r.id} style={{ background: selected.has(r.id) ? 'rgba(200,169,110,.1)' : undefined }}>
                          <td style={{ textAlign: 'center' }}>
                            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} />
                          </td>
                          <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{r.fecha || '—'}</td>
                          <td style={{ color: 'var(--t-muted)' }}>{r.turno || '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: "'DM Mono', monospace" }}>{r.crc ? fi(r.crc) : '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: "'DM Mono', monospace", color: '#7ab4d4' }}>{r.usd ? fd(r.usd) : '—'}</td>
                          <td style={{ fontSize: '0.78rem', color: '#5a5040' }}>{r.ref || '—'}</td>
                          <td style={{ textAlign: 'center' }}>
                            <button className="tips-btn-teal" disabled={saving} style={{ fontSize: '0.72rem', padding: '0.3rem 0.7rem' }}
                              onClick={() => pagar([r.id])}>✓ Pagado</button>
                          </td>
                        </tr>
                      ))}
                      <tr style={{ background: 'var(--t-border)', fontWeight: 700 }}>
                        <td colSpan={3} style={{ padding: '0.6rem 0.75rem' }}>TOTAL</td>
                        <td style={{ textAlign: 'right', fontFamily: "'DM Mono', monospace" }}>{fi(g.totalCRC)}</td>
                        <td style={{ textAlign: 'right', fontFamily: "'DM Mono', monospace", color: '#7ab4d4' }}>{g.totalUSD ? fd(g.totalUSD) : '—'}</td>
                        <td colSpan={2} />
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Acciones del grupo */}
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', padding: '0.9rem 1.1rem', borderTop: '1px solid var(--t-border)' }}>
                  {selInGroup.length > 0 && (
                    <button className="cd-btn-primary" disabled={saving}
                      onClick={() => pagar(selInGroup.map(r => r.id))}>
                      ✓ Pagar seleccionados ({selInGroup.length})
                    </button>
                  )}
                  <button className="cd-btn-primary" disabled={saving}
                    style={{ background: '#0d0d0d' }}
                    onClick={() => pagar(g.rows.map(r => r.id))}>
                    ✓ Marcar todos pagados
                  </button>
                  <button className="tips-btn-ghost"
                    onClick={() => descargarComprobante(g, selInGroup.length > 0)}>
                    📷 Descargar comprobante{selInGroup.length > 0 ? ` (${selInGroup.length})` : ''}
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
