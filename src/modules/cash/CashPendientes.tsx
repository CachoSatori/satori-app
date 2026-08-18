import { useState, useMemo } from 'react'
import type { CashMovement, CashSession, Supplier, SupplierCredit, CreditApplication } from '../../shared/types/database'
import { updateMovementStatus, updateCashMovement, sendPagoProveedorEmail } from '../../shared/api/cash'
import { aprobacionPropinaFields } from './propinaPago'
import { fi, fd } from './cashUtils'
import { dateCR } from '../../shared/utils'
import { useManagerOverride } from '../../shared/ManagerOverride'
import { saldoResidual, saldoCredito, facturaAplicado } from './supplierCredits'
import { RegistrarCreditoModal, AplicarCreditoModal } from './CreditoModals'
import { waNumber, descargarComprobantePNG, compartirComprobanteWhatsApp, puedeCompartirArchivos, type ComprobanteData } from './comprobante'

interface Props {
  movements: CashMovement[]
  sessions:  CashSession[]
  suppliers: Supplier[]   // mig 047 — para leer email/whatsapp/notificar_pago del proveedor
  credits: SupplierCredit[]           // mig 053/054 — saldo a favor del proveedor
  applications: CreditApplication[]
  onRefresh: () => void
}

const N = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// waNumber (formato internacional para wa.me) vive ahora en ./comprobante (compartido con la
// liquidación de crédito); se re-exporta acá para no romper importadores/tests existentes.
export { waNumber }

interface Row {
  id: string
  fecha: string
  turno: string
  crc: number       // amount_crc ORIGINAL (para tachar si hay crédito aplicado)
  usd: number
  ref: string
  aplicado: number  // crédito aplicado (no reversado) a esta factura (mig 053)
  residual: number  // crc − aplicado = lo que falta pagar
}
interface Group {
  key: string
  name: string
  esPropinas: boolean
  rows: Row[]
  totalCRC: number  // Σ RESIDUAL del grupo (NO Σ amount_crc)
  totalUSD: number
}

// Las propinas pendientes NO son un proveedor: caen todas en UN grupo, con cada turno como fila.
// Clave sentinela (no puede colisionar con el nombre lowercase de un proveedor real).
const PROPINAS_KEY = '__propinas__'

export default function CashPendientes({ movements, sessions, suppliers, credits, applications, onRefresh }: Props) {
  const requireManager = useManagerOverride()
  const sesionMap = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions])
  // Lookups para la notificación al proveedor (mig 047). Null-safe: supplier_id puede ser null.
  const movById = useMemo(() => new Map(movements.map(m => [m.id, m])), [movements])
  const supById = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers])
  // Proveedor de un grupo = el del 1er movimiento del grupo que tenga supplier_id vivo.
  const supOfGroup = (g: Group): Supplier | null => {
    for (const r of g.rows) {
      const sid = movById.get(r.id)?.supplier_id
      const s = sid ? supById.get(sid) : undefined
      if (s) return s
    }
    return null
  }
  // Saldo a favor disponible del proveedor (mig 053) = Σ saldo de sus créditos (monto − aplicado no reversado).
  const saldoDisponibleOf = (s: Supplier | null): number =>
    s ? credits.filter(c => c.supplier_id === s.id).reduce((sum, c) => sum + saldoCredito(c, applications), 0) : 0
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  // Comprobante POST-pago: snapshot de lo pagado. Al pagar la última factura (o "Marcar todos"), el
  // grupo desaparece de Pendientes → sin este snapshot no se podría emitir el comprobante después.
  const [pagoResultado, setPagoResultado] = useState<{ data: ComprobanteData; whatsapp: string | null } | null>(null)
  const [regModal, setRegModal] = useState<Supplier | null>(null)   // "Registrar saldo a favor"
  const [aplModal, setAplModal] = useState<Supplier | null>(null)   // "Aplicar crédito"
  // Crear/aplicar crédito = gerencia-gated (la RPC además exige owner/manager server-side).
  const abrirRegistrar = async (s: Supplier) => { if ((await requireManager()).ok) setRegModal(s) }
  const abrirAplicar   = async (s: Supplier) => { if ((await requireManager()).ok) setAplModal(s) }

  // ── Agrupar pendientes por proveedor (las propinas, todas juntas) ──
  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Group>()
    movements
      .filter(m => m.status === 'pendiente')
      .forEach(m => {
        // Propinas: un solo grupo. Si no, la description ("Propinas turno <fecha> <turno>")
        // abría un grupo por turno y la lista quedaba llena de "proveedores" fantasma.
        const esPropinas = m.subcategory === 'Propinas por turno'
        const name = esPropinas
          ? 'Propinas'
          : (m.supplier_name || m.employee_name || m.description || 'Sin proveedor').trim()
        const key = esPropinas ? PROPINAS_KEY : name.toLowerCase()
        const ses = sesionMap.get(m.session_id ?? '')
        // Nivel-día (sin turno): fecha LOCAL CR del registro (dateCR), no slice UTC.
        const fecha = ses?.session_date ?? dateCR(m.created_at)
        const turno = m.shift || ses?.shift_type || ''
        if (!map.has(key)) map.set(key, { key, name, esPropinas, rows: [], totalCRC: 0, totalUSD: 0 })
        const g = map.get(key)!
        const aplicado = facturaAplicado(m.id, applications)   // crédito aplicado a esta factura (mig 053)
        const residual = saldoResidual(m, applications)
        g.rows.push({ id: m.id, fecha, turno, crc: N(m.amount_crc), usd: N(m.amount_usd), ref: m.description || m.subcategory || '', aplicado, residual })
        g.totalCRC += residual   // ← el total del grupo suma RESIDUALES, no amount_crc
        g.totalUSD += N(m.amount_usd)
      })
    const arr = [...map.values()]
    arr.forEach(g => g.rows.sort((a, b) => a.fecha.localeCompare(b.fecha)))
    return arr.sort((a, b) => b.totalCRC - a.totalCRC)
  }, [movements, sesionMap, applications])

  // ¿El equipo puede compartir archivos por el menú del sistema? Decide si el botón 💬 WhatsApp
  // aparece aun sin número guardado (en celular manda la IMAGEN del comprobante).
  const compartirArchivos = useMemo(() => puedeCompartirArchivos(), [])

  const totalCRC = groups.reduce((s, g) => s + g.totalCRC, 0)
  const totalUSD = groups.reduce((s, g) => s + g.totalUSD, 0)
  const totalCount = groups.reduce((s, g) => s + g.rows.length, 0)
  const provCount = groups.filter(g => !g.esPropinas).length   // el grupo Propinas no es un proveedor

  // Vía de pago por FILA, leída del movimiento real (no del agrupamiento visual, que es display
  // y podría reagruparse mañana sin que la plata cambie de vía).
  const esPropina = useMemo(() => {
    const porId = new Map(movements.map(m => [m.id, m.subcategory]))
    return (id: string) => porId.get(id) === 'Propinas por turno'
  }, [movements])

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
  // Una propina que se dejó PENDIENTE se salda por BANCO (aprobacionPropinaFields — la MISMA vía
  // que usa el select de estado en Movimientos; el porqué vive allá): el turno ya cerró y ese
  // efectivo no quedó apartado en la caja, así que el pago no puede descontar efectivo. Queda
  // fuera del efectivo esperado tanto del cierre (propinasPagadasEnFecha) como de la Caja Diaria
  // (otrosEgresosEf filtra method 'Efectivo').
  // "Pagar ahora" (CashTurno/CashCierre, propinaEgresoFields) sigue siendo Efectivo/Registradora.
  // Los proveedores no cambian: solo status.
  const pagar = async (ids: string[], snapshot?: { data: ComprobanteData; whatsapp: string | null } | null) => {
    if (!ids.length) return
    // Destinatarios del comprobante por email: SOLO proveedores con notificar_pago='email' + email.
    // Selección mixta (propinas + varios proveedores) → acá quedan SOLO los configurados.
    const receptores = ids
      .map(id => {
        const sid = movById.get(id)?.supplier_id
        const s = sid ? supById.get(sid) : undefined
        return s && s.notificar_pago === 'email' && s.email ? { id, name: s.name, email: s.email } : null
      })
      .filter((x): x is { id: string; name: string; email: string } => x !== null)
    // Confirmación EXPLÍCITA por envío. Si nadie recibe (Notificar=No) → flujo idéntico al actual (sin confirm).
    if (receptores.length > 0) {
      const lineas = receptores.map(r => `📧 Se enviará comprobante a: ${r.name} (${r.email})`).join('\n')
      if (!window.confirm(`Confirmar pago de ${ids.length} pendiente${ids.length !== 1 ? 's' : ''}.\n\n${lineas}`)) return
    }
    setSaving(true)
    try {
      await Promise.all(ids.map(id => esPropina(id)
        ? updateCashMovement(id, aprobacionPropinaFields())
        : updateMovementStatus(id, 'aprobado')))
      // LA PLATA MANDA: el email va DESPUÉS del pago, fire-and-forget — nunca lo bloquea ni lo revierte.
      receptores.forEach(r => { void sendPagoProveedorEmail(r.id) })
      setSelected(prev => { const n = new Set(prev); ids.forEach(i => n.delete(i)); return n })
      // Comprobante post-pago (snapshot ya armado en el call site, estable ante el refresh). Propinas → null.
      if (snapshot && snapshot.data.lineas.length) setPagoResultado(snapshot)
      onRefresh()
    } finally { setSaving(false) }
  }

  // ── Rechazar (FIRMADO): marca el pendiente como 'rechazado' — no se paga ni se borra, queda
  // trazable. Funciona por id de movimiento → sirve para los huérfanos (supplier_id NULL).
  // Exige autorización de gerencia (borra deuda registrada). No toca esquema ni sagrados.
  const rechazar = async (ids: string[]) => {
    if (!ids.length) return
    const msg = ids.length === 1
      ? '¿Rechazar este pendiente? Queda registrado como rechazado (no se paga, no se borra). Requiere autorización de gerencia.'
      : `¿Rechazar ${ids.length} pendientes? Quedan registrados como rechazados (no se pagan, no se borran). Requiere autorización de gerencia.`
    if (!window.confirm(msg)) return
    if (!(await requireManager()).ok) return
    setSaving(true)
    try {
      await Promise.all(ids.map(id => updateMovementStatus(id, 'rechazado')))
      setSelected(prev => { const n = new Set(prev); ids.forEach(i => n.delete(i)); return n })
      onRefresh()
    } finally { setSaving(false) }
  }

  // ── Comprobante (PNG + texto WhatsApp) — vía el módulo compartido ./comprobante ──
  // Arma el ComprobanteData del grupo: MISMAS líneas/total que antes (residual + desglose del
  // crédito), ahora renderizado por el generador compartido. Output del pago normal SIN cambios.
  // Arma el ComprobanteData a partir de un set EXPLÍCITO de filas (para snapshots post-pago).
  const comprobanteDeRows = (g: Group, rows: Row[]): ComprobanteData => {
    // Comprobante = lo transferido = Σ RESIDUAL (amount_crc − crédito aplicado). NO muta amount_crc.
    const sumCRC = rows.reduce((s, r) => s + r.residual, 0)
    const sumUSD = rows.reduce((s, r) => s + r.usd, 0)
    return {
      tituloTexto: 'Comprobante de pago',
      tituloPNG: g.esPropinas ? 'Comprobante de pago de propinas' : 'Comprobante de pago a proveedor',
      proveedor: g.name,
      lineas: rows.map(r => ({
        fecha: r.fecha,
        nota: r.ref,
        monto: r.residual ? fi(r.residual) : (r.usd ? fd(r.usd) : '—'),
        // Desglose del crédito aplicado (mig 053). El texto lleva "= pagado Z"; el PNG no (espaciado).
        subnotaTexto: r.aplicado > 0 ? `facturado ${fi(r.crc)} − crédito ${fi(r.aplicado)} = pagado ${fi(r.residual)}` : undefined,
        subnotaPNG:   r.aplicado > 0 ? `facturado ${fi(r.crc)}  −  crédito ${fi(r.aplicado)}` : undefined,
      })),
      totalTexto: `${sumCRC ? fi(sumCRC) : ''}${sumUSD ? (sumCRC ? ' · ' : '') + fd(sumUSD) : ''}`,
      totalPNG:   `${sumCRC ? fi(sumCRC) : ''}${sumUSD ? (sumCRC ? '  ·  ' : '') + fd(sumUSD) : ''}`,
    }
  }
  const comprobanteDeGrupo = (g: Group, onlySelected: boolean): ComprobanteData =>
    comprobanteDeRows(g, onlySelected ? g.rows.filter(r => selected.has(r.id)) : g.rows)
  const descargarComprobante = (g: Group, onlySelected: boolean) => {
    const rows = onlySelected ? g.rows.filter(r => selected.has(r.id)) : g.rows
    if (!rows.length) return
    descargarComprobantePNG(comprobanteDeGrupo(g, onlySelected))
  }
  // WhatsApp manual (mig 047): comparte el comprobante como IMAGEN (Web Share con archivo);
  // en equipos sin soporte cae a wa.me con el texto prearmado, o a la descarga del PNG.
  const abrirWhatsApp = (g: Group, onlySelected: boolean) => {
    void compartirComprobanteWhatsApp(comprobanteDeGrupo(g, onlySelected), supOfGroup(g)?.whatsapp ?? '')
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
          {totalCount} factura{totalCount !== 1 ? 's' : ''} · {provCount} proveedor{provCount !== 1 ? 'es' : ''}
        </div>
      </div>

      {groups.map(g => {
        const selInGroup = g.rows.filter(r => selected.has(r.id))
        const allSel = selInGroup.length === g.rows.length && g.rows.length > 0
        const isCollapsed = collapsed.has(g.key)
        const supG = supOfGroup(g)   // mig 047 — proveedor del grupo (para WhatsApp / config)
        const saldoDisp = saldoDisponibleOf(supG)   // mig 053 — saldo a favor disponible del proveedor
        // Snapshot del comprobante post-pago (proveedor + filas pagadas). Propinas → null (no aplica).
        const snap = (rows: Row[]) => g.esPropinas ? null : { data: comprobanteDeRows(g, rows), whatsapp: supG?.whatsapp ?? null }
        return (
          <div key={g.key} className="cd-prov-card" style={{ marginBottom: '1.25rem', padding: 0, overflow: 'hidden' }}>
            {/* Header proveedor */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0.9rem 1.1rem', borderBottom: isCollapsed ? 'none' : '1px solid var(--t-border)' }}>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                {g.esPropinas
                  ? <span style={{ fontSize: '1rem', lineHeight: 1 }}>🎁</span>
                  : <span style={{ width: 9, height: 9, borderRadius: 99, background: '#c8a030', display: 'inline-block' }} />}
                <div>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--t-ink)' }}>{g.name}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--t-muted)' }}>
                    {g.esPropinas
                      ? `Propinas · ${g.rows.length} turno${g.rows.length !== 1 ? 's' : ''} pendiente${g.rows.length !== 1 ? 's' : ''}`
                      : `Proveedor · ${g.rows.length} pago${g.rows.length !== 1 ? 's' : ''} pendiente${g.rows.length !== 1 ? 's' : ''}`}
                  </div>
                  {saldoDisp > 0 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--t-teal)', fontWeight: 600, marginTop: 2 }}>
                      💳 crédito disponible {fi(saldoDisp)}
                    </div>
                  )}
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
                          <td style={{ textAlign: 'right', fontFamily: "'DM Mono', monospace" }}>
                            {r.aplicado > 0 ? (
                              <>
                                <span style={{ textDecoration: 'line-through', color: 'var(--t-muted)', fontSize: '0.7rem' }}>{fi(r.crc)}</span>{' '}
                                <strong>{fi(r.residual)}</strong>
                                <div style={{ fontSize: '0.6rem', color: 'var(--t-teal)' }}>crédito {fi(r.aplicado)}</div>
                              </>
                            ) : (r.crc ? fi(r.crc) : '—')}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: "'DM Mono', monospace", color: '#7ab4d4' }}>{r.usd ? fd(r.usd) : '—'}</td>
                          <td style={{ fontSize: '0.78rem', color: '#5a5040' }}>{r.ref || '—'}</td>
                          <td style={{ textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', gap: '0.3rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                              <button className="tips-btn-teal" disabled={saving} style={{ fontSize: '0.72rem', padding: '0.3rem 0.7rem' }}
                                onClick={() => pagar([r.id], snap([r]))}>✓ Pagado</button>
                              <button className="tips-btn-ghost" disabled={saving} style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem', color: '#c0392b', borderColor: '#f0b0b0' }}
                                onClick={() => rechazar([r.id])} title="Rechazar (requiere autorización de gerencia)">✕ Rechazar</button>
                            </div>
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
                      onClick={() => pagar(selInGroup.map(r => r.id), snap(selInGroup))}>
                      ✓ Pagar seleccionados ({selInGroup.length})
                    </button>
                  )}
                  {selInGroup.length > 0 && (
                    <button className="tips-btn-ghost" disabled={saving}
                      style={{ color: '#c0392b', borderColor: '#f0b0b0' }}
                      onClick={() => rechazar(selInGroup.map(r => r.id))}>
                      ✕ Rechazar seleccionados ({selInGroup.length})
                    </button>
                  )}
                  <button className="cd-btn-primary" disabled={saving}
                    style={{ background: '#0d0d0d' }}
                    onClick={() => pagar(g.rows.map(r => r.id), snap(g.rows))}>
                    ✓ Marcar todos pagados
                  </button>
                  <button className="tips-btn-ghost"
                    onClick={() => descargarComprobante(g, selInGroup.length > 0)}>
                    📷 Descargar comprobante{selInGroup.length > 0 ? ` (${selInGroup.length})` : ''}
                  </button>
                  {(supG?.whatsapp || (supG && compartirArchivos)) && (
                    <button className="tips-btn-ghost"
                      onClick={() => abrirWhatsApp(g, selInGroup.length > 0)}
                      title={`Enviar comprobante por WhatsApp a ${supG.name}`}>
                      💬 WhatsApp{selInGroup.length > 0 ? ` (${selInGroup.length})` : ''}
                    </button>
                  )}
                  {!g.esPropinas && supG && (
                    <button className="tips-btn-ghost" onClick={() => abrirRegistrar(supG)}
                      title="Registrar un saldo a favor (sobrepago) — NO mueve plata">
                      💳 Registrar saldo a favor
                    </button>
                  )}
                  {!g.esPropinas && supG && saldoDisp > 0 && (
                    <button className="cd-btn-primary" disabled={saving} onClick={() => abrirAplicar(supG)}>
                      💳 Aplicar crédito ({fi(saldoDisp)})
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )
      })}

      {regModal && (
        <RegistrarCreditoModal supplier={regModal} movements={movements}
          onDone={onRefresh} onClose={() => setRegModal(null)} />
      )}
      {aplModal && (
        <AplicarCreditoModal supplier={aplModal} credits={credits} applications={applications}
          pendientes={movements.filter(m => m.supplier_id === aplModal.id && m.status === 'pendiente')}
          onDone={onRefresh} onClose={() => setAplModal(null)} />
      )}

      {/* Comprobante POST-pago: el grupo ya salió de Pendientes, pero el snapshot deja emitirlo. */}
      {pagoResultado && (
        <div className="cd-modal-overlay" onClick={() => setPagoResultado(null)}>
          <div className="cd-modal" onClick={e => e.stopPropagation()}>
            <div className="cd-modal-title">Comprobante de pago · {pagoResultado.data.proveedor}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--t-muted)', marginBottom: '0.6rem' }}>Pago registrado ✓</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: 260, overflowY: 'auto' }}>
              {pagoResultado.data.lineas.map((l, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.78rem', padding: '0.3rem 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.fecha || '—'}{l.nota ? <> · <span style={{ color: 'var(--t-muted)' }}>{l.nota}</span></> : null}
                  </span>
                  <strong style={{ whiteSpace: 'nowrap' }}>{l.monto}</strong>
                </div>
              ))}
            </div>
            <div style={{ margin: '0.75rem 0', fontSize: '0.85rem' }}>
              Total pagado: <strong style={{ color: 'var(--t-teal)' }}>{pagoResultado.data.totalTexto}</strong>
            </div>
            <div className="cd-modal-actions">
              <button className="tips-btn-ghost" onClick={() => descargarComprobantePNG(pagoResultado.data)}>📷 Descargar comprobante</button>
              {(pagoResultado.whatsapp || compartirArchivos) && (
                <button className="tips-btn-ghost"
                  onClick={() => { void compartirComprobanteWhatsApp(pagoResultado.data, pagoResultado.whatsapp ?? '') }}>
                  💬 WhatsApp
                </button>
              )}
              <button className="tips-btn-teal" onClick={() => setPagoResultado(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
