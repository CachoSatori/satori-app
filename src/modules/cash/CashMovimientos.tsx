import { useState, useCallback, useMemo, useEffect } from 'react'
import type { CashMovement, CashSession, MovementType } from '../../shared/types/database'
import { updateCashMovement, deleteCashMovement, getCierresDia, createDayMovement } from '../../shared/api/cash'
import { aprobacionPropinaFields } from './propinaPago'
import type { CashCierreDia } from '../../shared/types/database'
import { getFinanceAccounts, type FinanceAccount } from '../../shared/api/finance'
import { useAuth } from '../../shared/hooks/useAuth'

// Conceptos para "Nuevo movimiento" manual (administrativo, sin foto/turno)
const CONCEPTOS = [
  { id: 'banco_cf', label: 'Ingreso de Banco → Caja Fuerte', type: 'traspaso',          caja: 'Caja Fuerte',       sub: 'Banco → Caja Fuerte', method: 'Transferencia' },
  { id: 'cf_banco', label: 'Retiro Caja Fuerte → Banco',      type: 'traspaso',          caja: 'Caja Fuerte',       sub: 'Caja Fuerte → Banco', method: 'Transferencia' },
  { id: 'egr_merc', label: 'Egreso · Mercadería',             type: 'egreso_mercaderia', caja: 'Caja Proveedores',  sub: '',                    method: 'Efectivo' },
  { id: 'egr_oper', label: 'Egreso · Operativo',              type: 'egreso_operativo',  caja: 'Caja Proveedores',  sub: '',                    method: 'Efectivo' },
  { id: 'egr_pers', label: 'Egreso · Personal / Salario',     type: 'egreso_personal',   caja: 'Caja Fuerte',       sub: '',                    method: 'Efectivo' },
  { id: 'ing_otro', label: 'Ingreso · Otro (aceite, etc.)',   type: 'ingreso',           caja: 'Caja Fuerte',       sub: 'Otros ingresos',      method: 'Efectivo' },
  // Reajuste (Opción B firmada): cuando la plata de una diferencia de cierre aparece (o falta)
  // DESPUÉS — corrige el saldo de Caja Fuerte sin tocar el cierre ya sellado.
  { id: 'reaj_ing', label: 'Reajuste · apareció plata (CF)',  type: 'ingreso',           caja: 'Caja Fuerte',       sub: 'Reajuste',            method: 'Efectivo' },
  { id: 'reaj_egr', label: 'Reajuste · faltó plata (CF)',     type: 'egreso_operativo',  caja: 'Caja Fuerte',       sub: 'Reajuste',            method: 'Efectivo' },
] as const
import { dateCR } from '../../shared/utils'
import { MOVEMENT_LABELS, MOVEMENT_TYPES, CAJAS_ORIGEN, METODOS_PAGO, isEgreso, tipoColor, fi, fd, todayStr } from './cashUtils'
import { saldoTarjetaEfectivo } from './tarjetaPozo'
import { POZO_CORTE, SUBCAT_APERTURA_POZO } from './cierrePozo'
import { useManagerOverride } from '../../shared/ManagerOverride'
import { useDeletionNote } from './deletionNote'
import { movementAttachments } from '../../shared/api/facturas'
import FacturaThumbs from '../../shared/FacturaThumbs'
import FacturaVerify from '../../shared/FacturaVerify'
import { listLinkedDocs, type DocumentRow } from '../../shared/api/documents'

interface Props {
  movements: CashMovement[]
  sessions:  CashSession[]
  onRefresh: () => void
}

export default function CashMovimientos({ movements, sessions, onRefresh }: Props) {
  const requireManager = useManagerOverride()
  const askNote = useDeletionNote()
  const { profile } = useAuth()
  // Modal "Nuevo movimiento"
  const [nmOpen, setNmOpen] = useState(false)
  const [nmConcepto, setNmConcepto] = useState<typeof CONCEPTOS[number]['id']>('banco_cf')
  const [nmCRC, setNmCRC] = useState<number | ''>('')
  const [nmUSD, setNmUSD] = useState<number | ''>('')
  const [nmDesc, setNmDesc] = useState('')
  const [nmFecha, setNmFecha] = useState(todayStr())
  const [nmSaving, setNmSaving] = useState(false)
  const [nmErr, setNmErr] = useState<string | null>(null)
  const guardarNuevo = async () => {
    const c = CONCEPTOS.find(x => x.id === nmConcepto)!
    if (!Number(nmCRC) && !Number(nmUSD)) { setNmErr('Ingresá un monto'); return }
    setNmSaving(true); setNmErr(null)
    try {
      await createDayMovement({
        created_by: profile?.id ?? '', movement_type: c.type, amount_crc: Number(nmCRC) || 0, amount_usd: Number(nmUSD) || 0,
        description: nmDesc || c.label, subcategory: c.sub, method: c.method, caja_origen: c.caja, status: 'aprobado', fecha: nmFecha,
      })
      setNmOpen(false); setNmCRC(''); setNmUSD(''); setNmDesc('')
      onRefresh()
    } catch (e) { setNmErr(e instanceof Error ? e.message : 'Error'); setNmSaving(false) }
  }
  const sesionMap = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions])
  // Fecha del movimiento: la del turno si lo tiene; si es un movimiento a nivel
  // día (sin turno, ej. ventas del cierre) cae a su created_at, en fecha LOCAL CR
  // (dateCR) — no slice UTC — para que un registro de noche caiga en el día correcto.
  const movFecha = (m: CashMovement) =>
    sesionMap.get(m.session_id ?? '')?.session_date ?? dateCR(m.created_at)

  // "DESDE" por defecto = LA FECHA DE CORTE (firmado por el dueño). Con el modelo del pozo
  // arrancando en el corte, las tarjetas de PERÍODO (Ingresos/Egresos/Ajustes) tienen que
  // arrancar en cero y acumular solo lo nuevo: mezclar los 60 días previos mostraría plata del
  // modelo viejo sumada a la del nuevo, que es justo la confusión que el corte viene a evitar.
  //
  // El histórico NO se toca ni se esconde: sigue entero en la base y a un cambio de fecha de
  // distancia — mover "Desde" hacia atrás lo muestra idéntico a como se veía antes.
  //
  // Ojo: esto filtra SOLO la lista y las tarjetas de período. La tarjeta de efectivo y la de
  // Pend. Transferencia se calculan sobre `movements` SIN filtrar, a propósito: un pendiente de
  // antes del corte sigue siendo plata que se debe hoy. Ver los tests de este archivo.
  const defaultFrom = POZO_CORTE
  const [from,    setFrom]    = useState(defaultFrom)
  const [to,      setTo]      = useState(todayStr())
  const [tipo,    setTipo]    = useState('')
  const [busq,    setBusq]    = useState('')
  const [estado,  setEstado]  = useState('')
  const [saving,  setSaving]  = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())  // selección múltiple para borrado masivo
  // Cuentas contables (hojas) para asignar la cuenta del P&L por movimiento (FIX 4)
  const [accounts, setAccounts] = useState<FinanceAccount[]>([])
  useEffect(() => { getFinanceAccounts().then(a => setAccounts(a.filter(x => x.is_leaf))).catch(() => {}) }, [])
  // Cierres del día → para la tarjeta de Ajustes (diferencias del encargado)
  const [cierres, setCierres] = useState<CashCierreDia[]>([])
  useEffect(() => { getCierresDia().then(setCierres).catch(() => {}) }, [])
  // Facturas enlazadas (verificado) — map movimiento→documento, una sola consulta.
  const [docMap, setDocMap] = useState<Record<string, DocumentRow>>({})
  const [docsLoaded, setDocsLoaded] = useState(false)
  useEffect(() => {
    listLinkedDocs().then(ds => {
      const m: Record<string, DocumentRow> = {}
      for (const d of ds) if (d.linked_movement_id) m[d.linked_movement_id] = d
      setDocMap(m)
    }).catch(() => {}).finally(() => setDocsLoaded(true))
  }, [])

  const toggleSel = (id: string) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  // ── Filter ───────────────────────────────────────────────
  const filtered = movements.filter(m => {
    const fecha = movFecha(m)
    if (from   && fecha < from)  return false
    if (to     && fecha > to)    return false
    if (tipo   && m.movement_type !== tipo) return false
    if (estado) {
      const s = m.status === 'pendiente' ? 'Pendiente' : 'Pagado'
      if (s !== estado) return false
    }
    if (busq) {
      const q = busq.toLowerCase()
      // supplier_name/employee_name son NULLABLE en la base: hay movimientos viejos con null.
      if (!(
        (m.supplier_name ?? '').toLowerCase().includes(q) ||
        (m.employee_name ?? '').toLowerCase().includes(q) ||
        (m.description   ?? '').toLowerCase().includes(q)
      )) return false
    }
    return true
  }).sort((a, b) => {
    return movFecha(b).localeCompare(movFecha(a)) || b.created_at.localeCompare(a.created_at)
  })

  // ── Saldos ───────────────────────────────────────────────
  // POST-CORTE la tarjeta muestra el POZO: todo el efectivo físico, contado desde el asiento
  // de apertura. PRE-CORTE sigue mostrando `saldoCajaFuerte` tal cual (histórico intacto).
  // Ver tarjetaPozo.ts para el porqué — es la misma regla que el cierre ya usa.
  const tarjeta = saldoTarjetaEfectivo(movements, sessions)
  const { crc: cfSaldo, usd: cfSaldoUSD } = tarjeta

  const pendTotal = movements.filter(m => m.status === 'pendiente').reduce((s, m) => s + m.amount_crc, 0)
  const pendCount = movements.filter(m => m.status === 'pendiente').length

  // Ajustes = diferencias de los CIERRES del día (lo que el encargado ajusta
  // cuando el conteo físico no cuadra). A veces + y a veces −; sirve para ver
  // si a fin de mes netean a cero o si son errores a investigar.
  const cierresPeriodo = cierres.filter(c => (!from || c.session_date >= from) && (!to || c.session_date <= to) && Number(c.diferencia_crc) !== 0)
  const ajustesNet   = cierresPeriodo.reduce((s, c) => s + (Number(c.diferencia_crc) || 0), 0)
  const ajustesCount = cierresPeriodo.length
  // Neto US$ de los ajustes del período — cálculo PARALELO (el ₡ sigue saliendo de los cierres,
  // intacto). Como cash_cierres_dia no tiene columna diferencia_usd (decisión Opción B), el USD
  // se deriva del registro durable: los MOVIMIENTOS 'Ajuste de cierre' del período. Signo por
  // dirección: ingreso = sobrante (+) · egreso = faltante (−). Solo lectura.
  const ajustesNetUsd = movements
    .filter(m => m.subcategory === 'Ajuste de cierre' && (m.amount_usd || 0) !== 0)
    .filter(m => { const f = movFecha(m); return (!from || f >= from) && (!to || f <= to) })
    .reduce((s, m) => s + (m.movement_type === 'ingreso' ? 1 : -1) * (m.amount_usd || 0), 0)

  // El ajuste de APERTURA (reconciliación del saldo real) no es ingreso/egreso
  // real del negocio → se excluye de Ingresos/Egresos del período (pero sí
  // afecta el saldo de Caja Fuerte).
  //
  // MISMA REGLA para el ASIENTO DE ARRANQUE DEL POZO ('Apertura pozo AAAA-MM-DD'): es el saldo
  // con el que arranca el pozo, no plata que el negocio ingresó ese día. Sin esta exclusión,
  // el primer día post-corte "Ingresos (período)" mostraría el arranque entero (en prod,
  // ₡744.570) como si fuera venta — justo el número que el corte viene a poner en cero.
  // Sí sigue contando para el SALDO de la tarjeta: ahí es donde tiene que estar.
  const isAperturaAjuste = (m: CashMovement) =>
    /ajuste apertura/i.test(m.subcategory || '') || /ajuste apertura/i.test(m.description || '')
    || m.subcategory === SUBCAT_APERTURA_POZO
  const totIngresos = filtered.filter(m => m.movement_type === 'ingreso' && !isAperturaAjuste(m)).reduce((s, m) => s + m.amount_crc, 0)
  const totEgresos  = filtered.filter(m => isEgreso(m.movement_type as MovementType) && !isAperturaAjuste(m)).reduce((s, m) => s + m.amount_crc, 0)

  // ── Actions ──────────────────────────────────────────────
  // `mov` solo hace falta para el select de ESTADO: aprobar una propina pendiente tiene que ir
  // por la MISMA vía que la pestaña Pendientes (banco), y para saberlo hay que mirar su
  // subcategory. El resto de los campos no lo necesitan y lo omiten.
  const handleFieldChange = useCallback(async (id: string, field: string, value: unknown, mov?: CashMovement) => {
    // Editar un movimiento GUARDADO (montos, tipo, método…) requiere autorización de gerencia,
    // igual que borrarlo. owner/manager logueado pasa al instante; cajero → modal de contraseña.
    // Si cancela o falla, onRefresh() revierte lo que muestre el input.
    const auth = await requireManager()
    if (!auth.ok) { onRefresh(); return }
    setSaving(id)
    try {
      // Aprobar una propina PENDIENTE desde acá saldaba en efectivo y reabría el descuadre que
      // cerró la pestaña Pendientes (el porqué, en aprobacionPropinaFields). Una sola vía: los
      // 3 campos, no solo el status. Pasar a 'pendiente' y las filas NO-propina, igual que antes.
      const esAprobarPropina = field === 'status' && value === 'aprobado'
        && mov?.subcategory === 'Propinas por turno'
      const updates = esAprobarPropina ? aprobacionPropinaFields() : { [field]: value }
      await updateCashMovement(id, updates as Partial<CashMovement>)
      onRefresh()
    } catch {
      // revert handled by onRefresh
    } finally {
      setSaving(null)
    }
  }, [onRefresh, requireManager])

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm('¿Eliminar este movimiento? Esta acción no se puede deshacer.')) return
    const auth = await requireManager()
    if (!auth.ok) return
    // Motivo obligatorio: borra también el inventario ligado y queda en la auditoría (mig 039).
    const note = await askNote('movimiento')
    if (!note) return
    setSaving(id)
    try {
      await deleteCashMovement(id, note, auth.managerEmail, auth.managerPassword)
      onRefresh()
    } catch (e) {
      window.alert(`No se pudo eliminar: ${e instanceof Error ? e.message : 'reintentá con conexión'}`)
    } finally {
      setSaving(null)
    }
  }, [onRefresh, requireManager, askNote])

  const handleBulkDelete = async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    if (!window.confirm(`¿Eliminar ${ids.length} movimiento(s) seleccionado(s)? No se puede deshacer.`)) return
    const auth = await requireManager()
    if (!auth.ok) return
    // Una sola nota cubre todo el lote (queda en la auditoría de cada borrado).
    const note = await askNote(`${ids.length} movimiento(s)`)
    if (!note) return
    setSaving('bulk')
    try {
      const results = await Promise.allSettled(ids.map(id => deleteCashMovement(id, note, auth.managerEmail, auth.managerPassword)))
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed) {
        const reason = (results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason
        window.alert(`No se pudieron borrar ${failed} de ${ids.length}: ${reason instanceof Error ? reason.message : 'reintentá con conexión'}`)
      }
      setSelected(new Set())
      onRefresh()
    } finally {
      setSaving(null)
    }
  }

  const exportCSV = () => {
    const BOM = '﻿'
    const hdrs = ['Fecha','Turno','Tipo','Descripción','Proveedor/Empleado','₡','$','Método','Caja','Estado']
    const rows = filtered.map(m => {
      const ses = sesionMap.get(m.session_id ?? '')
      return [
        movFecha(m),
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
          <div className="cd-saldo-label">{tarjeta.esPozo ? 'Efectivo en caja' : 'Caja Fuerte'}</div>
          <div className={`cd-saldo-val ${cfSaldo < 0 ? 'red' : ''}`}>{fi(cfSaldo)}</div>
          {cfSaldoUSD !== 0 && <div style={{ fontSize: '13px', color: '#3a7bd5', fontFamily: "'DM Mono', monospace", marginTop: '2px' }}>{fd(cfSaldoUSD)}</div>}
          {tarjeta.esPozo && (
            <div data-testid="tarjeta-subtitulo" style={{ fontSize: '9px', color: '#888', marginTop: '3px', lineHeight: 1.3 }}>
              Caja Fuerte + Proveedores + Registradora
              {tarjeta.desdeApertura && <> · desde la apertura del {tarjeta.desdeApertura}</>}
            </div>
          )}
          {tarjeta.esPozo && tarjeta.indeterminados.cantidad > 0 && (
            <div style={{ fontSize: '9px', color: '#8a5a1f', marginTop: '2px' }}>
              ⚠ {tarjeta.indeterminados.cantidad} traspaso(s) sin dirección ({fi(tarjeta.indeterminados.crc)}) — neutros
            </div>
          )}
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
        <div className="cd-saldo-card" style={{ borderLeftColor: '#8a7a4a' }}>
          <div className="cd-saldo-label">Ajustes de cierre</div>
          {/* Patrón Caja Fuerte: ₡ arriba, $ debajo (secundario). Cada moneda solo si ≠ 0;
              signo y color por moneda (verde sobrante / rojo faltante / gris cero). */}
          {ajustesCount === 0 && ajustesNetUsd === 0 ? (
            <div className="cd-saldo-val" style={{ color: '#555', fontSize: '13px' }}>Sin diferencias</div>
          ) : (
            <>
              {ajustesCount > 0 && (
                <div className="cd-saldo-val" style={{ color: ajustesNet < 0 ? '#c0392b' : ajustesNet > 0 ? '#27874f' : '#555', fontSize: '17px' }}>
                  {`${ajustesNet >= 0 ? '+' : ''}${fi(ajustesNet)}`}
                </div>
              )}
              {ajustesNetUsd !== 0 && (
                <div style={{ fontSize: '13px', fontFamily: "'DM Mono', monospace", marginTop: '2px', color: ajustesNetUsd < 0 ? '#c0392b' : '#27874f' }}>
                  {ajustesNetUsd >= 0 ? '+' : ''}{fd(ajustesNetUsd)}
                </div>
              )}
              {ajustesCount > 0 && <div style={{ fontSize: '9px', color: '#888', marginTop: '3px' }}>{ajustesCount} cierre{ajustesCount !== 1 ? 's' : ''} con diferencia</div>}
            </>
          )}
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
        <button className="cd-btn-green" style={{ fontSize: '0.8rem' }} onClick={() => { setNmErr(null); setNmOpen(true) }}>+ Nuevo movimiento</button>
        <button className="tips-btn-ghost" style={{ fontSize: '0.8rem' }} onClick={exportCSV}>⬇ CSV</button>
      </div>

      {/* Modal: nuevo movimiento manual */}
      {nmOpen && (
        <div className="cd-modal-overlay" onClick={() => setNmOpen(false)}>
          <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="cd-modal-title">Nuevo movimiento</div>
            <p style={{ fontSize: '0.74rem', color: 'var(--t-muted)', margin: '0.2rem 0 0.75rem' }}>
              Movimientos administrativos sin foto ni turno (ej. ingreso de banco a caja fuerte, gasto suelto).
            </p>
            {nmErr && <div className="tips-error" style={{ marginBottom: '0.75rem' }}><span>{nmErr}</span><button onClick={() => setNmErr(null)}>✕</button></div>}
            <div className="tips-field">
              <div className="tips-field-label">Concepto</div>
              <select className="tips-input-dark" value={nmConcepto} onChange={e => setNmConcepto(e.target.value as typeof nmConcepto)}>
                {CONCEPTOS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="cd-grid2" style={{ marginTop: '0.75rem' }}>
              <div className="tips-field">
                <div className="tips-field-label">Monto ₡</div>
                <input type="number" className="tips-input-dark" value={nmCRC} placeholder="0" onChange={e => setNmCRC(e.target.value === '' ? '' : Number(e.target.value))} />
              </div>
              <div className="tips-field">
                <div className="tips-field-label">Monto $ (opcional)</div>
                <input type="number" className="tips-input-dark" value={nmUSD} placeholder="0" onChange={e => setNmUSD(e.target.value === '' ? '' : Number(e.target.value))} />
              </div>
              <div className="tips-field">
                <div className="tips-field-label">Fecha</div>
                <input type="date" className="tips-input-dark" value={nmFecha} max={todayStr()} onChange={e => setNmFecha(e.target.value)} />
              </div>
              <div className="tips-field">
                <div className="tips-field-label">Descripción / nota</div>
                <input className="tips-input-dark" value={nmDesc} placeholder="Opcional" onChange={e => setNmDesc(e.target.value)} />
              </div>
            </div>
            <div className="cd-modal-actions" style={{ marginTop: '1rem' }}>
              <button className="tips-btn-ghost" onClick={() => setNmOpen(false)} disabled={nmSaving}>Cancelar</button>
              <button className="cd-btn-green" onClick={guardarNuevo} disabled={nmSaving || (!Number(nmCRC) && !Number(nmUSD))}>
                {nmSaving ? 'Guardando…' : '✓ Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barra de acción masiva */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem', marginBottom: '0.75rem', background: 'rgba(194,59,34,0.08)', border: '1px solid rgba(194,59,34,0.3)', borderRadius: 3 }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--t-ink)', fontWeight: 600 }}>{selected.size} seleccionado(s)</span>
          <button onClick={handleBulkDelete} disabled={saving === 'bulk'}
            style={{ background: 'var(--t-red)', color: '#fff', border: 'none', borderRadius: 3, padding: '4px 12px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
            {saving === 'bulk' ? 'Eliminando…' : `🗑 Eliminar ${selected.size}`}
          </button>
          <button onClick={() => setSelected(new Set())}
            style={{ background: 'none', border: '1px solid var(--t-border)', color: 'var(--t-muted)', borderRadius: 3, padding: '4px 10px', fontSize: '0.78rem', cursor: 'pointer' }}>
            Limpiar selección
          </button>
        </div>
      )}

      {/* Table */}
      <div className="cd-tbl-wrap">
        <table className="cd-tbl cd-tbl-sel">
          <thead>
            <tr>
              <th style={{ width: 34, textAlign: 'center' }}>
                <input type="checkbox"
                  checked={filtered.length > 0 && filtered.every(m => selected.has(m.id))}
                  onChange={e => setSelected(e.target.checked ? new Set(filtered.map(m => m.id)) : new Set())} />
              </th>
              <th>Fecha</th>
              <th>Turno</th>
              <th>Tipo</th>
              <th>Descripción</th>
              <th>Prov./Emp.</th>
              <th className="r">₡</th>
              <th className="r">$</th>
              <th>Método</th>
              <th>Caja</th>
              <th>Cuenta P&L</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={13} style={{ textAlign: 'center', padding: '2rem', color: '#888', fontSize: '0.85rem' }}>
                Sin movimientos en el período
              </td></tr>
            )}
            {filtered.map(m => {
              const col = tipoColor(m.movement_type)
              const isPend = m.status === 'pendiente'

              return (
                <tr key={m.id} className={`${isPend ? 'cd-mov-pend' : ''} ${selected.has(m.id) ? 'cd-mov-sel' : ''}`}>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleSel(m.id)} />
                  </td>
                  <td style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                    {movFecha(m) || '—'}
                    {m._pending && <span title="En cola offline — se sincroniza al volver la red"
                      style={{ marginLeft: 4, color: '#a07830', fontWeight: 700 }}>⏳</span>}
                  </td>
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
                    {movementAttachments(m).length > 0 && (
                      <div style={{ marginTop: 2 }}><FacturaThumbs paths={movementAttachments(m)} size={26} /></div>
                    )}
                    {docsLoaded && isEgreso(m.movement_type as MovementType) && (
                      <div style={{ marginTop: 2 }}><FacturaVerify movement={m} doc={docMap[m.id] ?? null} compact onVerified={onRefresh} /></div>
                    )}
                  </td>
                  <td>
                    <input key={m.id + '-pe'} className="cd-tbl-input"
                      defaultValue={m.supplier_name || m.employee_name || ''}
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
                    <select className="cd-tbl-select" value={m.account_id ?? ''}
                      onChange={e => handleFieldChange(m.id, 'account_id', e.target.value || null)}
                      disabled={saving === m.id} title="Cuenta contable del P&L (opcional; si se deja vacío se mapea por subcategoría)">
                      <option value="">— auto —</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="cd-tbl-select"
                      style={{ fontWeight: 700, color: isPend ? '#c8a030' : '#4a7c59' }}
                      value={isPend ? 'Pendiente' : 'Pagado'}
                      onChange={e => handleFieldChange(m.id, 'status', e.target.value === 'Pendiente' ? 'pendiente' : 'aprobado', m)}
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
                <td colSpan={6}>{filtered.length} movimientos · Resultado del período</td>
                <td className="r" style={{ color: totIngresos - totEgresos >= 0 ? '#7ec8a0' : '#c23b22', fontWeight: 800 }}>
                  {totIngresos - totEgresos >= 0 ? '+' : ''}{fi(totIngresos - totEgresos)}
                </td>
                <td colSpan={6}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Mobile card list (shown instead of table on <760px) ── */}
      <div className="cd-mov-mobile-list" style={{ flexDirection: 'column', gap: '0.5rem' }}>
        {filtered.map(m => {
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
              {movementAttachments(m).length > 0 && (
                <div style={{ marginBottom: '0.3rem' }}><FacturaThumbs paths={movementAttachments(m)} size={40} /></div>
              )}
              {docsLoaded && isEg && (
                <div style={{ marginBottom: '0.3rem' }}><FacturaVerify movement={m} doc={docMap[m.id] ?? null} onVerified={onRefresh} /></div>
              )}
              <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.68rem', color: '#5a5040' }}>
                <span>{movFecha(m) || '—'}</span>
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
