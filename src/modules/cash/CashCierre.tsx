/**
 * CashCierre — Cierre del día en 2 fases
 * Port of renderCierreTurno from SATORI CAJA standalone
 *
 * Fase 1 — Mediodía: Ventas PoS ₡/$, propinas, otros egresos → se sella
 * Fase 2 — Noche   : ídem + conteo físico (separaciones) + verificación
 *
 * Separaciones:
 *   - Caja Diaria mañana (para el próximo turno)
 *   - Caja Registradora (vuelto)
 *   - Remanente CF (queda en Caja Fuerte)
 *
 * Verificación: compara "debería quedar" vs total contado.
 * Si diferencia > ₡500 → campo obligatorio tipo + motivo.
 */
import { useState, useEffect } from 'react'
import { useAuth } from '../../shared/hooks/useAuth'
import { useManagerOverride } from '../../shared/ManagerOverride'
import type { CashCierreDia, CashSession, CashMovement } from '../../shared/types/database'
import { getCierresDia, getAllCashMovements, getCashSessions, saveCierreParcial, updateCierreCompleto, recordCierreSales, recordCierreRetiro, discardCierreDia, discardDiaCompleto } from '../../shared/api/cash'
import { getCurrentRate } from '../../shared/api/exchangeRate'
import { fi, todayStr, saldoCajaFuerte } from './cashUtils'

const fi2 = (n: number | undefined) => fi(n ?? 0)

interface Props { onRefresh: () => void; openSession?: CashSession | null }

function N(v: number | ''): number { return Number(v) || 0 }

// Cuadre USD del cierre — espeja la fórmula CRC (saldo base + mediodía + noche).
// En Caja Fuerte los dólares solo salen por retiro de socios o depósito a banco,
// así que el "debería" SIEMPRE incluye el saldo USD del ledger. Exportada para test.
export function calcDeberiaUSD(saldoBaseUsd: number, vmUsd: number, vnUsd: number): number {
  return saldoBaseUsd + vmUsd + vnUsd
}

export default function CashCierre({ onRefresh, openSession }: Props) {
  const { profile } = useAuth()
  const requireManager = useManagerOverride()
  const today       = todayStr()
  const turnoAbierto = !!openSession  // no se puede cerrar el día con un turno abierto

  const [cierres,  setCierres]  = useState<CashCierreDia[]>([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [msg,      setMsg]      = useState<string | null>(null)
  const [fecha,    setFecha]    = useState(today)
  const [movs,     setMovs]     = useState<CashMovement[]>([])   // ledger para saldoCajaFuerte
  const [sessions, setSessions] = useState<CashSession[]>([])    // para gatear: caja de proveedores cerrada

  const loadCierres = async () => {
    setLoading(true)
    try {
      const [cs, ms, ss] = await Promise.all([getCierresDia(fecha), getAllCashMovements(), getCashSessions()])
      setCierres(cs)
      setMovs(ms)
      setSessions(ss)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { loadCierres() }, [fecha])

  // Find partial (mediodía) and full (completo) for selected date
  const parcial  = cierres.find(c => c.tipo === 'parcial_mediodia')
  const completo = cierres.find(c => c.tipo === 'completo')
  // El cierre de bóveda (Fase 2) requiere que la Caja Diaria de proveedores del día
  // ya esté CERRADA (paso propio en Caja Diaria), aunque haya estado en cero.
  const cajaProvCerrada = sessions.some(s => s.session_date === fecha && s.status === 'closed')

  const manager = profile?.full_name ?? ''

  // Tipo de cambio configurado (último de exchange_rates). Editable por el
  // manager en el cierre. Default 640 hasta que cargue.
  const [tc, setTc] = useState<number>(640)
  useEffect(() => {
    const saved = parcial?.tipo_cambio
    if (saved && saved > 0) { setTc(saved); return }
    getCurrentRate().then(r => { if (r > 0) setTc(r) }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcial?.tipo_cambio])

  // ── FASE 1 state ──────────────────────────────────────────────
  const [vmCRC,       setVmCRC]       = useState<number | ''>('')
  const [vmUSD,       setVmUSD]       = useState<number | ''>('')
  const [propM,       setPropM]       = useState<number | ''>('')

  // Efectivo real en COLONES del mediodía = ventas PoS ₡ − dólares al TC.
  // (El PoS registra toda venta en colones; los dólares físicos se cuentan
  // aparte, así que se restan de la parte en colones.)
  const efRealM = Math.round(N(vmCRC) - N(vmUSD) * tc)

  // ── FASE 2 state ──────────────────────────────────────────────
  const [vnCRC,       setVnCRC]       = useState<number | ''>('')
  const [vnUSD,       setVnUSD]       = useState<number | ''>('')
  const [propN,       setPropN]       = useState<number | ''>('')
  const [retiroN,     setRetiroN]     = useState<number | ''>('')   // retiro de dueños a banco (egreso administrativo)

  const efRealN = Math.round(N(vnCRC) - N(vnUSD) * tc)

  // Separaciones
  const [sepDiariaCRC,  setSepDiariaCRC]  = useState<number | ''>('')
  const [sepDiariaUSD,  setSepDiariaUSD]  = useState<number | ''>('')
  const [sepRegCRC,     setSepRegCRC]     = useState<number | ''>('')
  const [sepRegUSD,     setSepRegUSD]     = useState<number | ''>('')
  const [remCRC,        setRemCRC]        = useState<number | ''>('')
  const [remUSD,        setRemUSD]        = useState<number | ''>('')

  const totalContadoCRC = N(sepDiariaCRC) + N(sepRegCRC) + N(remCRC)
  const totalContadoUSD = N(sepDiariaUSD) + N(sepRegUSD) + N(remUSD)

  // Verification calculation — único egreso del cierre = propinas.
  const efRealMFromParcial = parcial ? parcial.ef_real_m_crc : efRealM
  const propMFromParcial   = parcial ? parcial.propinas_m_crc : N(propM)
  const vmUSDFromParcial   = parcial ? parcial.vm_usd : N(vmUSD)

  // Saldo de Caja Fuerte según el ledger, EXCLUYENDO las ventas-de-cierre de esta fecha
  // (esas se re-suman desde el formulario → evitar doble conteo). Idempotente al re-cerrar.
  const saldoBase = saldoCajaFuerte(
    movs.filter(m => !(m.subcategory === 'Ventas cierre' && (m.description || '').includes(fecha))))
  const netoM    = efRealMFromParcial - propMFromParcial
  const netoN    = efRealN - N(propN) - N(retiroN)
  // Debería quedar en Caja Fuerte = saldo del ledger + ventas efectivo − propinas − retiro.
  const deberia  = saldoBase.crc + netoM + netoN
  const diferencia = totalContadoCRC > 0 ? totalContadoCRC - deberia : null
  const cuadra     = diferencia !== null && Math.abs(diferencia) < 500

  // Dólares: lo que debería haber físicamente = saldo USD de Caja Fuerte (ledger,
  // ya filtrado anti-doble-conteo) + dólares de ventas (mediodía + noche).
  const deberiaUSD   = calcDeberiaUSD(saldoBase.usd, vmUSDFromParcial, N(vnUSD))
  const difUSD       = totalContadoUSD > 0 || deberiaUSD > 0 ? totalContadoUSD - deberiaUSD : null
  const cuadraUSD    = difUSD === null || Math.abs(difUSD) < 1

  // Ajuste
  const [ajusteTipo,   setAjusteTipo]   = useState('Faltante')
  const [ajusteMotivo, setAjusteMotivo] = useState('')
  const [notas,        setNotas]        = useState('')

  const requiresAjuste = diferencia !== null && !cuadra

  // ── Confirmar cierre parcial (Fase 1) ─────────────────────────
  const handleConfirmParcial = async () => {
    if (!navigator.onLine) { setError('El cierre requiere conexión — esperá a que vuelva la señal y reintentá.'); return }
    if (turnoAbierto) { setError('Cerrá el turno abierto en Caja Diaria antes del cierre del día'); return }
    if (!N(vmCRC) && !N(vmUSD)) { setError('Ingresá las ventas de mediodía'); return }
    setSaving(true); setError(null)
    try {
      await saveCierreParcial({
        session_date:    fecha,
        manager,
        tipo:            'parcial_mediodia',
        vm_crc:          N(vmCRC),
        vm_usd:          N(vmUSD),
        propinas_m_crc:  N(propM),
        otros_m_crc:     0,
        ef_real_m_crc:   efRealM,
        // Fase 2 vacía
        vn_crc:0, vn_usd:0, propinas_n_crc:0, otros_n_crc:0, ef_real_n_crc:0,
        sep_diaria_crc:0, sep_diaria_usd:0, sep_registradora_crc:0, sep_registradora_usd:0,
        remanente_crc:0, remanente_usd:0, diferencia_crc:0, ajuste_tipo:'', ajuste_motivo:'',
        notas:'', tipo_cambio: tc,
      })
      setMsg('✓ Fase 1 confirmada — Mediodía sellado')
      await loadCierres()
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  // ── Confirmar cierre completo (Fase 2) ───────────────────────
  const handleConfirmCompleto = async () => {
    if (!navigator.onLine) { setError('El cierre requiere conexión — esperá a que vuelva la señal y reintentá.'); return }
    if (turnoAbierto) { setError('Cerrá el turno abierto en Caja Diaria antes del cierre del día'); return }
    if (!cajaProvCerrada) { setError('Cerrá primero la Caja Diaria de proveedores del día.'); return }
    if (!N(vnCRC) && !N(vnUSD)) { setError('Ingresá las ventas de noche'); return }
    if (totalContadoCRC === 0) { setError('Completá el conteo físico (separaciones)'); return }
    if (requiresAjuste && !ajusteMotivo.trim()) {
      setError('⚠ Hay diferencia — el motivo es obligatorio antes de cerrar'); return
    }
    // Orden de fases: la noche NO se puede cerrar sin el Mediodía confirmado (Fase 1).
    // Sin `parcial`, las ventas de mediodía se perderían y el cierre quedaría a medias.
    if (!parcial) { setError('Cerrá primero el Mediodía (Fase 1) antes de cerrar la noche.'); return }
    setSaving(true); setError(null)
    try {
      // Fase 1 ya confirmada → pasar el cierre a 'completo'.
      await updateCierreCompleto(parcial.id, {
        tipo:                 'completo',
        vn_crc:               N(vnCRC),
        vn_usd:               N(vnUSD),
        propinas_n_crc:       N(propN),
        otros_n_crc:          N(retiroN),
        ef_real_n_crc:        efRealN,
        sep_diaria_crc:       N(sepDiariaCRC),
        sep_diaria_usd:       N(sepDiariaUSD),
        sep_registradora_crc: N(sepRegCRC),
        sep_registradora_usd: N(sepRegUSD),
        remanente_crc:        N(remCRC),
        remanente_usd:        N(remUSD),
        diferencia_crc:       diferencia ?? 0,
        ajuste_tipo:          requiresAjuste ? ajusteTipo : '',
        ajuste_motivo:        requiresAjuste ? ajusteMotivo : '',
        notas,
        tipo_cambio:          tc,
      })
      // Fase 3 — registrar las ventas en EFECTIVO en el ledger. ES PARTE ESENCIAL del
      // cierre (alimenta el saldo de Caja Fuerte), NO es complementario. Si falla, el día
      // quedó guardado pero las ventas NO están → avisar explícito, nunca ocultar.
      try {
        await recordCierreSales({
          session_date:  fecha,
          created_by:    profile?.id ?? '',
          exchange_rate: tc,
          mediodia: { crc: efRealMFromParcial, usd: vmUSDFromParcial },
          noche:    { crc: efRealN,            usd: N(vnUSD) },
        })
        await recordCierreRetiro({
          session_date:  fecha,
          created_by:    profile?.id ?? '',
          exchange_rate: tc,
          amount_crc:    N(retiroN),
        })
      } catch (e3) {
        await loadCierres(); onRefresh()
        setError(`El día se guardó pero las VENTAS no se registraron en movimientos: ${e3 instanceof Error ? e3.message : String(e3)}. Deshacé el cierre y volvé a cerrarlo.`)
        return
      }
      setMsg('✓ Día cerrado completamente')
      await loadCierres()
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  // Deshacer SOLO el cierre del día (no toca los movimientos del día).
  const handleDeshacer = async () => {
    if (!parcial && !completo) return
    if (!window.confirm(
      `¿Deshacer el cierre del ${fecha}?\n\n` +
      `Se borran SOLO los datos del cierre y lo que generó (ventas del cierre + retiro).\n\n` +
      `⚠ NO se borran los pagos a proveedores, gastos ni ingresos manuales del día — esos quedan. ` +
      `Si querés recargar el día desde cero (sin duplicar), usá el botón "Borrar TODO el día".`)) return
    if (!(await requireManager()).ok) return
    setSaving(true); setError(null)
    try {
      await discardCierreDia(fecha)
      setMsg('✓ Cierre deshecho — los movimientos del día se mantienen.')
      await loadCierres(); onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al deshacer')
    } finally { setSaving(false) }
  }

  // Acción EXPLÍCITA y aparte: deshacer el cierre Y borrar TODOS los movimientos del día
  // (para recargar el día de cero sin duplicar pagos). Destructivo — confirmación doble.
  const handleBorrarDia = async () => {
    if (!window.confirm(
      `¿BORRAR TODO el día ${fecha}?\n\n` +
      `Esto borra el cierre, las ventas, el retiro, los PAGOS A PROVEEDORES, gastos, ingresos manuales ` +
      `y los turnos de caja del ${fecha}. Sirve para recargar el día desde cero.\n\n` +
      `NO toca propinas. NO se puede deshacer.`)) return
    const auth = await requireManager()
    if (!auth.ok) return
    setSaving(true); setError(null)
    try {
      await discardDiaCompleto(fecha, auth.managerEmail, auth.managerPassword)
      setMsg('✓ Día borrado completo — podés recargar desde cero.')
      await loadCierres(); onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al borrar el día')
    } finally { setSaving(false) }
  }

  if (loading) return <div style={{ padding:'2rem', textAlign:'center', color:'#888' }}>Cargando…</div>

  return (
    <div className="cierre-tab" style={{ maxWidth:680, margin:'0 auto' }}>

      {/* Date selector */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.25rem', flexWrap:'wrap', gap:'0.5rem' }}>
        <div>
          <div style={{ fontSize:'0.95rem', fontWeight:700, letterSpacing:'0.03em' }}>Cierre del día</div>
          <div style={{ fontSize:'0.72rem', color:'#6a6250', marginTop:4, display:'flex', alignItems:'center', gap:'0.4rem' }}>
            <span>TC ₡/$</span>
            <input type="number" min={300} max={900} step={5} value={tc}
              disabled={!!parcial}
              onChange={e => setTc(Number(e.target.value) || tc)}
              title={parcial ? 'Sellado en Fase 1' : 'Tipo de cambio del día'}
              className="cierre-input"
              style={{ width:64, color:'#8a6d1f', padding:'2px 6px', fontSize:'0.74rem', fontFamily:'DM Mono, monospace', opacity: parcial ? 0.6 : 1 }} />
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
          {(parcial || completo) && (
            <button onClick={handleDeshacer} disabled={saving} title="Deshacer SOLO el cierre (no borra los movimientos del día)"
              style={{ background:'transparent', border:'1px solid #c23b22', color:'#c23b22', borderRadius:2, padding:'5px 10px', fontSize:'0.76rem', cursor:'pointer' }}>
              ↩ Deshacer cierre
            </button>
          )}
          <button onClick={handleBorrarDia} disabled={saving} title="Deshacer el cierre Y borrar TODOS los movimientos del día (recargar de cero)"
            style={{ background:'#c23b22', border:'none', color:'#fff', borderRadius:2, padding:'5px 10px', fontSize:'0.76rem', cursor:'pointer' }}>
            🗑 Borrar TODO el día
          </button>
          <input type="date" value={fecha} max={today}
            onChange={e => setFecha(e.target.value)}
            className="cierre-input"
            style={{ color:'#8a6d1f', padding:'5px 10px', fontSize:'0.82rem' }} />
        </div>
      </div>

      {turnoAbierto && (
        <div className="cd-warn" style={{ marginBottom:'1rem' }}>
          ⚠ Hay un turno de caja abierto{openSession?.cajero_name ? ` (${openSession.cajero_name})` : ''}. Cerralo en <strong>Caja Diaria</strong> antes de hacer el cierre del día.
        </div>
      )}

      {/* Messages */}
      {error && (
        <div className="cierre-hint red" style={{ fontSize:'0.82rem', display:'flex', justifyContent:'space-between' }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background:'none', border:'none', color:'#c23b22', cursor:'pointer' }}>✕</button>
        </div>
      )}
      {msg && (
        <div className="cierre-hint green" style={{ fontSize:'0.82rem' }}>{msg}</div>
      )}

      {/* Barra de fases */}
      <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1.25rem' }}>
        <div className={`cierre-fase ${parcial ? 'ok' : 'pend'}`}>
          <span style={{ fontSize:'0.9rem' }}>{parcial ? '✅' : '☀️'}</span>
          <span>Fase 1 — Mediodía {parcial ? '(sellado)' : '(pendiente)'}</span>
        </div>
        <span style={{ color:'#b0a890', fontSize:'1rem', flexShrink:0 }}>→</span>
        <div className={`cierre-fase ${completo ? 'ok' : parcial ? 'pend' : 'wait'}`}>
          <span style={{ fontSize:'0.9rem' }}>{completo ? '✅' : '🌙'}</span>
          <span>Fase 2 — Noche {completo ? '(cerrado)' : parcial ? '(en progreso)' : '(esperando)'}</span>
        </div>
      </div>

      {/* ── CIERRE YA COMPLETO ── */}
      {completo && (
        <div style={{ background:'#e8f5ec', border:'2px solid #4a9a6a', borderRadius:2, padding:'1.25rem' }}>
          <div style={{ fontSize:'0.88rem', fontWeight:700, color:'#2a7a4a', marginBottom:'1rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
            ✅ Día cerrado — {fecha}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'0.75rem', marginBottom:'1rem' }}>
            {[
              { label:'Remanente CF',    val: completo.remanente_crc,    color:'#8a6d1f' },
              { label:'Caja Diaria mañana', val: completo.sep_diaria_crc, color:'#2a7a4a' },
              { label:'Diferencia',      val: completo.diferencia_crc,   color: Math.abs(completo.diferencia_crc) < 500 ? '#2a7a4a' : '#c23b22' },
            ].map(k => (
              <div key={k.label} style={{ background:'#fff', border:'1px solid var(--t-border, #d4cfc4)', padding:'0.75rem', borderRadius:2, textAlign:'center' }}>
                <div style={{ fontSize:'0.6rem', color:'#6a6250', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>{k.label}</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:'1.1rem', fontWeight:800, color:k.color }}>
                  {fi2(k.val)}
                </div>
              </div>
            ))}
          </div>
          {completo.notas && (
            <div style={{ fontSize:'0.78rem', color:'#6a6250', padding:'0.5rem 0.75rem', background:'var(--t-panel, #ede8de)', borderRadius:2 }}>
              📝 {completo.notas}
            </div>
          )}
        </div>
      )}

      {/* ── FASE 1: Mediodía ── */}
      {!completo && (
        <>
          {!parcial ? (
            /* Formulario Fase 1 */
            <Section title="Ventas mediodía" icon="☀️" color="#8a6d1f">
              <Row2>
                <Field label="Ventas PoS ₡">
                  <MontoInput prefix="₡" value={vmCRC} onChange={setVmCRC} />
                </Field>
                <Field label={`Dólares físicos $ → ₡${N(vmUSD) > 0 ? (N(vmUSD)*tc).toLocaleString('es-CR') : '—'}`}>
                  <MontoInput prefix="$" value={vmUSD} onChange={setVmUSD} />
                </Field>
              </Row2>
              {(N(vmCRC) > 0 || N(vmUSD) > 0) && (
                <div className="cierre-hint gold">
                  Efectivo real ₡ (ventas − dólares): <strong>{fi2(efRealM)}</strong>
                  {N(vmUSD) > 0 && <span style={{ color:'#6a6250' }}> · dólares físicos: <strong>${N(vmUSD).toFixed(2)}</strong></span>}
                </div>
              )}
              <Row2>
                <Field label="Propinas ₡ (único egreso)">
                  <MontoInput prefix="₡" value={propM} onChange={setPropM} />
                </Field>
                <div />
              </Row2>
              <button
                onClick={handleConfirmParcial} disabled={saving || turnoAbierto}
                className="cierre-btn gold" style={{ marginTop:'0.75rem' }}>
                💾 Confirmar cierre mediodía → sellar Fase 1
              </button>
            </Section>
          ) : (
            /* Mediodía sellado */
            <div className="cierre-card" style={{ marginBottom:'1rem' }}>
              <div className="cierre-card-head" style={{ justifyContent:'space-between' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                  <span>🔒</span>
                  <div>
                    <div style={{ fontSize:'0.82rem', fontWeight:600, color:'var(--t-ink, #0d0d0d)' }}>Ventas mediodía — sellado</div>
                    <div style={{ fontSize:'0.65rem', color:'#8a8272' }}>Registrado · no editable</div>
                  </div>
                </div>
                <span style={{ fontSize:'0.65rem', color:'#2a7a4a', background:'#e8f5ec', padding:'2px 8px', borderRadius:10, border:'1px solid #b0d8b8' }}>✓ Confirmado</span>
              </div>
              {[
                { l:'Ventas PoS ₡', v: fi2(parcial.vm_crc) },
                { l:'Dólares $',    v: '$' + parcial.vm_usd.toFixed(2) },
                { l:'Efectivo real ₡', v: fi2(parcial.ef_real_m_crc) },
                { l:'Propinas ₡',   v: fi2(parcial.propinas_m_crc) },
                parcial.otros_m_crc > 0 ? { l:'Otros egresos ₡', v: fi2(parcial.otros_m_crc) } : null,
              ].filter(Boolean).map((row, i) => (
                <div key={i} className="cierre-kv">
                  <span className="lbl">{(row as {l:string;v:string}).l}</span>
                  <span className="val">{(row as {l:string;v:string}).v}</span>
                </div>
              ))}
              <div className="cierre-kv total">
                <span style={{ color:'#6a6250', fontSize:'0.68rem', textTransform:'uppercase', letterSpacing:'0.08em' }}>Efectivo neto mediodía</span>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:'0.9rem', fontWeight:700, color:'#8a6d1f' }}>
                  {fi2((parcial.ef_real_m_crc||0) - (parcial.propinas_m_crc||0) - (parcial.otros_m_crc||0))}
                </span>
              </div>
            </div>
          )}

          {/* ── FASE 2: Noche (solo si Fase 1 cerrada) ── */}
          {parcial && (
            <>
              <Section title="Ventas noche" icon="🌙" color="#3a7794">
                <Row2>
                  <Field label="Ventas PoS ₡">
                    <MontoInput prefix="₡" value={vnCRC} onChange={setVnCRC} />
                  </Field>
                  <Field label={`Dólares $ → ₡${N(vnUSD) > 0 ? (N(vnUSD)*tc).toLocaleString('es-CR') : '—'}`}>
                    <MontoInput prefix="$" value={vnUSD} onChange={setVnUSD} />
                  </Field>
                </Row2>
                {(N(vnCRC) > 0 || N(vnUSD) > 0) && (
                  <div className="cierre-hint blue">
                    Efectivo real ₡ (ventas − dólares): <strong>{fi2(efRealN)}</strong>
                    {N(vnUSD) > 0 && <span style={{ color:'#6a6250' }}> · dólares físicos: <strong>${N(vnUSD).toFixed(2)}</strong></span>}
                  </div>
                )}
                <Row2>
                  <Field label="Propinas noche ₡">
                    <MontoInput prefix="₡" value={propN} onChange={setPropN} />
                  </Field>
                  <Field label="Retiro dueños → banco ₡">
                    <MontoInput prefix="₡" value={retiroN} onChange={setRetiroN} />
                  </Field>
                </Row2>
                {N(retiroN) > 0 && (
                  <div className="cierre-hint red" style={{ padding:'0.4rem 0.7rem', fontSize:'0.72rem', marginTop:'-0.25rem', marginBottom:'0.5rem' }}>
                    Retiro de dueños a banco: <strong>−{fi2(N(retiroN))}</strong> · queda registrado como egreso (Retiro de socios) en Movimientos.
                  </div>
                )}
              </Section>

              {/* Separaciones */}
              <Section title="Conteo físico — separaciones" icon="📊" color="#2a7a4a">
                <div style={{ fontSize:'0.72rem', color:'#6a6250', marginBottom:'0.75rem' }}>
                  Juntá todo el efectivo, separás las asignaciones y contás el remanente de Caja Fuerte.
                </div>
                <table className="cierre-table">
                  <thead>
                    <tr>
                      <th />
                      <th>₡ Colones</th>
                      <th>$ Dólares</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label:'Caja Diaria mañana', sub:'separación día siguiente', color:'#2a7a4a', crc:sepDiariaCRC, setCRC:setSepDiariaCRC, usd:sepDiariaUSD, setUSD:setSepDiariaUSD },
                      { label:'Caja Registradora',  sub:'para vuelto mañana',       color:'#6a6250', crc:sepRegCRC,    setCRC:setSepRegCRC,    usd:sepRegUSD,    setUSD:setSepRegUSD    },
                      { label:'Remanente CF',        sub:'queda en Caja Fuerte',     color:'#8a5aa8', crc:remCRC,       setCRC:setRemCRC,       usd:remUSD,       setUSD:setRemUSD       },
                    ].map(row => (
                      <tr key={row.label} style={{ background: row.color === '#8a5aa8' ? 'rgba(138,90,168,.06)' : undefined }}>
                        <td style={{ padding:'0.625rem 0.75rem' }}>
                          <div style={{ fontSize:'0.8rem', fontWeight:600, color:row.color }}>{row.label}</div>
                          <div style={{ fontSize:'0.65rem', color:'#8a8272', marginTop:1 }}>{row.sub}</div>
                        </td>
                        <td style={{ padding:'0.3rem 0.5rem' }}>
                          <MontoInput prefix="₡" value={row.crc} onChange={row.setCRC} compact />
                        </td>
                        <td style={{ padding:'0.3rem 0.5rem' }}>
                          <MontoInput prefix="$" value={row.usd} onChange={row.setUSD} compact />
                        </td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td style={{ padding:'0.625rem 0.75rem', fontSize:'0.78rem', color:'#6a6250' }}>Total contado</td>
                      <td style={{ padding:'0.625rem 0.5rem', fontFamily:"'DM Mono',monospace", fontSize:'0.95rem', fontWeight:800, color:'#2a7a4a', textAlign:'center' }}>
                        {totalContadoCRC > 0 ? fi2(totalContadoCRC) : '—'}
                      </td>
                      <td style={{ padding:'0.625rem 0.5rem', fontFamily:"'DM Mono',monospace", fontSize:'0.95rem', fontWeight:800, color:'#2a7a4a', textAlign:'center' }}>
                        {totalContadoUSD > 0 ? `$${totalContadoUSD.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Verificación */}
                {totalContadoCRC > 0 && (
                  <>
                    <div className="cierre-resumen">
                      <div className="cierre-resumen-header">Verificación — Cierre del Día</div>
                      <div className="cierre-resumen-cols">
                        <span />
                        <span>₡ Colones</span>
                        <span>US$</span>
                      </div>
                      <div className="cierre-resumen-row">
                        <span className="lbl">Saldo Caja Fuerte (según sistema)</span>
                        <span className="val">{fi2(saldoBase.crc)}</span>
                        <span className="val">${saldoBase.usd.toFixed(2)}</span>
                      </div>
                      <div className="cierre-resumen-row">
                        <span className="lbl">+ Mediodía neto</span>
                        <span className="val">{fi2(netoM)}</span>
                        <span className="val">${vmUSDFromParcial.toFixed(2)}</span>
                      </div>
                      <div className="cierre-resumen-row">
                        <span className="lbl">+ Noche neto</span>
                        <span className="val">{fi2(netoN)}</span>
                        <span className="val">${N(vnUSD).toFixed(2)}</span>
                      </div>
                      <div className="cierre-resumen-row destacada">
                        <span className="lbl">= Debería quedar en Caja Fuerte</span>
                        <span className="val">{fi2(deberia)}</span>
                        <span className="val">${deberiaUSD.toFixed(2)}</span>
                      </div>
                      <div className="cierre-resumen-row">
                        <span className="lbl">Total contado (conteo físico)</span>
                        <span className="val">{fi2(totalContadoCRC)}</span>
                        <span className="val">${totalContadoUSD.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className={`cd-cierre-resultado ${cuadra ? 'ok' : 'fail'}`}>
                      <span>{cuadra ? '✅ Cuadra correctamente (₡)' : `⚠️ Diferencia ₡: ${diferencia! >= 0 ? '+' : ''}${fi2(diferencia ?? 0)}`}</span>
                    </div>
                    {deberiaUSD > 0 && (
                      <div className={`cierre-resumen-usd ${cuadraUSD ? 'ok' : 'fail'}`}>
                        Dólares: debería ${deberiaUSD.toFixed(2)} · contado ${totalContadoUSD.toFixed(2)}
                        {cuadraUSD ? ' ✅' : ` ⚠️ ${difUSD! >= 0 ? '+' : ''}$${(difUSD ?? 0).toFixed(2)}`}
                      </div>
                    )}
                  </>
                )}

                {/* Ajuste obligatorio si hay diferencia */}
                {requiresAjuste && (
                  <div style={{ background:'#fdf0ee', border:'2px solid #c23b22', borderRadius:2, padding:'0.875rem', marginBottom:'0.75rem' }}>
                    <div style={{ fontSize:'0.82rem', fontWeight:700, color:'#c23b22', marginBottom:'0.75rem' }}>
                      ⚠ Diferencia detectada — registrá el motivo para cerrar
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'160px 1fr', gap:'0.5rem', alignItems:'end' }}>
                      <Field label="Tipo">
                        <select value={ajusteTipo} onChange={e => setAjusteTipo(e.target.value)}
                          className="cierre-input" style={{ width:'100%', padding:'6px 8px', fontSize:'0.82rem' }}>
                          <option>Faltante</option><option>Sobrante</option><option>Error cobro</option><option>Otro</option>
                        </select>
                      </Field>
                      <Field label="Motivo *">
                        <input value={ajusteMotivo} onChange={e => setAjusteMotivo(e.target.value)}
                          placeholder="Descripción obligatoria…"
                          className="cierre-input"
                          style={{ width:'100%', padding:'6px 10px', fontSize:'0.82rem', ...(ajusteMotivo ? {} : { border:'1px solid #c23b22' }) }} />
                      </Field>
                    </div>
                  </div>
                )}
              </Section>

              {/* Notas + Confirmar */}
              <div style={{ marginBottom:'0.75rem' }}>
                <Field label="Notas del cierre">
                  <input value={notas} onChange={e => setNotas(e.target.value)}
                    placeholder="Observaciones, incidentes…"
                    className="cierre-input" style={{ width:'100%', padding:'6px 10px', fontSize:'0.82rem' }} />
                </Field>
              </div>

              <button
                onClick={handleConfirmCompleto}
                disabled={saving || turnoAbierto || !N(vnCRC) || totalContadoCRC === 0 || (requiresAjuste && !ajusteMotivo.trim())}
                className="cierre-btn green">
                ✓ CONFIRMAR CIERRE DEL DÍA
              </button>
            </>
          )}
        </>
      )}

    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────
function Section({ title, icon, color, children }: { title:string; icon:string; color:string; children: React.ReactNode }) {
  return (
    <div className="cierre-card">
      <div className="cierre-card-head">
        <span style={{ fontSize:'1.1rem' }}>{icon}</span>
        <div style={{ fontSize:'0.85rem', fontWeight:600, color }}>{title}</div>
      </div>
      <div className="cierre-card-body">{children}</div>
    </div>
  )
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.625rem', marginBottom:'0.75rem' }}>{children}</div>
}

function Field({ label, children }: { label:string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize:'0.65rem', color:'#6a6250', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>{label}</div>
      {children}
    </div>
  )
}

function MontoInput({ prefix, value, onChange, compact }: {
  prefix: string; value: number|''; onChange: (v: number|'') => void; compact?: boolean
}) {
  return (
    <div className="cierre-monto" style={{ height: compact ? 34 : 38 }}>
      <span className="pfx" style={{ fontSize: compact ? '0.72rem' : '0.82rem' }}>{prefix}</span>
      <input
        type="number" min={0} step={100} value={value}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        style={{ fontSize: compact ? '0.82rem' : '0.9rem' }}
        placeholder="0"
      />
    </div>
  )
}
