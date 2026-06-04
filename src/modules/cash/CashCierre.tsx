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
import type { CashCierreDia, CashSession } from '../../shared/types/database'
import { getCierresDia, saveCierreParcial, updateCierreCompleto } from '../../shared/api/cash'
import { fi, todayStr } from './cashUtils'

const fi2 = (n: number | undefined) => fi(n ?? 0)

interface Props { onRefresh: () => void; openSession?: CashSession | null }

function N(v: number | ''): number { return Number(v) || 0 }

export default function CashCierre({ onRefresh, openSession }: Props) {
  const { profile } = useAuth()
  const today       = todayStr()
  const turnoAbierto = !!openSession  // no se puede cerrar el día con un turno abierto

  const [cierres,  setCierres]  = useState<CashCierreDia[]>([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [msg,      setMsg]      = useState<string | null>(null)
  const [fecha,    setFecha]    = useState(today)

  const loadCierres = async () => {
    setLoading(true)
    try {
      setCierres(await getCierresDia(fecha))
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

  const manager = profile?.full_name ?? ''

  // ── FASE 1 state ──────────────────────────────────────────────
  const [vmCRC,       setVmCRC]       = useState<number | ''>('')
  const [vmUSD,       setVmUSD]       = useState<number | ''>('')
  const [propM,       setPropM]       = useState<number | ''>('')
  const [otrosM,      setOtrosM]      = useState<number | ''>('')
  const tc = 640  // use fixed or from last session

  const efRealM = Math.round(N(vmCRC) + N(vmUSD) * tc)

  // ── FASE 2 state ──────────────────────────────────────────────
  const [vnCRC,       setVnCRC]       = useState<number | ''>('')
  const [vnUSD,       setVnUSD]       = useState<number | ''>('')
  const [propN,       setPropN]       = useState<number | ''>('')
  const [otrosN,      setOtrosN]      = useState<number | ''>('')

  const efRealN = Math.round(N(vnCRC) + N(vnUSD) * tc)

  // Separaciones
  const [sepDiariaCRC,  setSepDiariaCRC]  = useState<number | ''>('')
  const [sepDiariaUSD,  setSepDiariaUSD]  = useState<number | ''>('')
  const [sepRegCRC,     setSepRegCRC]     = useState<number | ''>('')
  const [sepRegUSD,     setSepRegUSD]     = useState<number | ''>('')
  const [remCRC,        setRemCRC]        = useState<number | ''>('')
  const [remUSD,        setRemUSD]        = useState<number | ''>('')

  const totalContadoCRC = N(sepDiariaCRC) + N(sepRegCRC) + N(remCRC)
  const totalContadoUSD = N(sepDiariaUSD) + N(sepRegUSD) + N(remUSD)

  // Verification calculation
  const efRealMFromParcial = parcial ? parcial.ef_real_m_crc : efRealM
  const propMFromParcial   = parcial ? parcial.propinas_m_crc : N(propM)
  const otrosMFromParcial  = parcial ? parcial.otros_m_crc    : N(otrosM)

  const netoM    = efRealMFromParcial - propMFromParcial - otrosMFromParcial
  const netoN    = efRealN - N(propN) - N(otrosN)
  const deberia  = netoM + netoN
  const diferencia = totalContadoCRC > 0 ? totalContadoCRC - deberia : null
  const cuadra     = diferencia !== null && Math.abs(diferencia) < 500

  // Ajuste
  const [ajusteTipo,   setAjusteTipo]   = useState('Faltante')
  const [ajusteMotivo, setAjusteMotivo] = useState('')
  const [notas,        setNotas]        = useState('')

  const requiresAjuste = diferencia !== null && !cuadra

  // ── Confirmar cierre parcial (Fase 1) ─────────────────────────
  const handleConfirmParcial = async () => {
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
        otros_m_crc:     N(otrosM),
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
    if (turnoAbierto) { setError('Cerrá el turno abierto en Caja Diaria antes del cierre del día'); return }
    if (!N(vnCRC) && !N(vnUSD)) { setError('Ingresá las ventas de noche'); return }
    if (totalContadoCRC === 0) { setError('Completá el conteo físico (separaciones)'); return }
    if (requiresAjuste && !ajusteMotivo.trim()) {
      setError('⚠ Hay diferencia — el motivo es obligatorio antes de cerrar'); return
    }
    setSaving(true); setError(null)
    try {
      if (parcial) {
        // Update existing parcial to completo
        await updateCierreCompleto(parcial.id, {
          tipo:                 'completo',
          vn_crc:               N(vnCRC),
          vn_usd:               N(vnUSD),
          propinas_n_crc:       N(propN),
          otros_n_crc:          N(otrosN),
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

  if (loading) return <div style={{ padding:'2rem', textAlign:'center', color:'#888' }}>Cargando…</div>

  return (
    <div style={{ maxWidth:680, margin:'0 auto', padding:'1rem 0.5rem' }}>

      {/* Date selector */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.25rem', flexWrap:'wrap', gap:'0.5rem' }}>
        <div>
          <div style={{ fontSize:'0.95rem', fontWeight:700, letterSpacing:'0.03em' }}>Cierre del día</div>
          <div style={{ fontSize:'0.72rem', color:'#888', marginTop:2 }}>TC: ₡{tc.toLocaleString('es-CR')} / $1</div>
        </div>
        <input type="date" value={fecha} max={today}
          onChange={e => setFecha(e.target.value)}
          style={{ background:'#1a1a1a', border:'1px solid #333', color:'var(--t-gold)', padding:'5px 10px', borderRadius:2, fontSize:'0.82rem' }} />
      </div>

      {turnoAbierto && (
        <div className="cd-warn" style={{ marginBottom:'1rem' }}>
          ⚠ Hay un turno de caja abierto{openSession?.cajero_name ? ` (${openSession.cajero_name})` : ''}. Cerralo en <strong>Caja Diaria</strong> antes de hacer el cierre del día.
        </div>
      )}

      {/* Messages */}
      {error && (
        <div style={{ background:'rgba(194,59,34,.12)', border:'1px solid #c23b22', borderRadius:2, padding:'0.625rem 0.875rem', marginBottom:'0.75rem', fontSize:'0.82rem', color:'#c23b22', display:'flex', justifyContent:'space-between' }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background:'none', border:'none', color:'#c23b22', cursor:'pointer' }}>✕</button>
        </div>
      )}
      {msg && (
        <div style={{ background:'rgba(74,154,106,.12)', border:'1px solid #4a9a6a', borderRadius:2, padding:'0.625rem 0.875rem', marginBottom:'0.75rem', fontSize:'0.82rem', color:'#4a9a6a' }}>{msg}</div>
      )}

      {/* Barra de fases */}
      <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1.25rem' }}>
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:'0.4rem', padding:'0.5rem 0.75rem', borderRadius:2, background: parcial ? 'rgba(74,154,106,.15)' : 'rgba(200,169,110,.1)', border:`1px solid ${parcial ? '#4a9a6a' : '#c8a030'}` }}>
          <span style={{ fontSize:'0.9rem' }}>{parcial ? '✅' : '☀️'}</span>
          <span style={{ fontSize:'0.75rem', fontWeight:600, color: parcial ? '#4a9a6a' : '#c8a030' }}>
            Fase 1 — Mediodía {parcial ? '(sellado)' : '(pendiente)'}
          </span>
        </div>
        <span style={{ color:'#444', fontSize:'1rem', flexShrink:0 }}>→</span>
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:'0.4rem', padding:'0.5rem 0.75rem', borderRadius:2, background: completo ? 'rgba(74,154,106,.15)' : parcial ? 'rgba(200,169,110,.1)' : 'rgba(40,40,40,.4)', border:`1px solid ${completo ? '#4a9a6a' : parcial ? '#c8a030' : '#2a2a2a'}` }}>
          <span style={{ fontSize:'0.9rem' }}>{completo ? '✅' : '🌙'}</span>
          <span style={{ fontSize:'0.75rem', fontWeight:600, color: completo ? '#4a9a6a' : parcial ? '#c8a030' : '#555' }}>
            Fase 2 — Noche {completo ? '(cerrado)' : parcial ? '(en progreso)' : '(esperando)'}
          </span>
        </div>
      </div>

      {/* ── CIERRE YA COMPLETO ── */}
      {completo && (
        <div style={{ background:'rgba(74,154,106,.08)', border:'2px solid #4a9a6a', borderRadius:2, padding:'1.25rem' }}>
          <div style={{ fontSize:'0.88rem', fontWeight:700, color:'#4a9a6a', marginBottom:'1rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
            ✅ Día cerrado — {fecha}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'0.75rem', marginBottom:'1rem' }}>
            {[
              { label:'Remanente CF',    val: completo.remanente_crc,    color:'var(--t-gold)' },
              { label:'Caja Diaria mañana', val: completo.sep_diaria_crc, color:'#4a9a6a' },
              { label:'Diferencia',      val: completo.diferencia_crc,   color: Math.abs(completo.diferencia_crc) < 500 ? '#4a9a6a' : '#c23b22' },
            ].map(k => (
              <div key={k.label} style={{ background:'#111', padding:'0.75rem', borderRadius:2, textAlign:'center' }}>
                <div style={{ fontSize:'0.6rem', color:'#555', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>{k.label}</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:'1.1rem', fontWeight:800, color:k.color }}>
                  {fi2(k.val)}
                </div>
              </div>
            ))}
          </div>
          {completo.notas && (
            <div style={{ fontSize:'0.78rem', color:'#888', padding:'0.5rem 0.75rem', background:'#0d0d0d', borderRadius:2 }}>
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
            <Section title="Ventas mediodía" icon="☀️" color="#c8a030">
              <Row2>
                <Field label="Ventas PoS ₡">
                  <MontoInput prefix="₡" value={vmCRC} onChange={setVmCRC} />
                </Field>
                <Field label={`Dólares físicos $ → ₡${N(vmUSD) > 0 ? (N(vmUSD)*tc).toLocaleString('es-CR') : '—'}`}>
                  <MontoInput prefix="$" value={vmUSD} onChange={setVmUSD} />
                </Field>
              </Row2>
              {(N(vmCRC) > 0 || N(vmUSD) > 0) && (
                <div style={{ background:'rgba(200,169,110,.1)', border:'1px solid #c8a030', borderRadius:2, padding:'0.5rem 0.75rem', fontSize:'0.82rem', color:'#c8a030', marginBottom:'0.75rem' }}>
                  Efectivo real mediodía: <strong>{fi2(efRealM)}</strong>
                </div>
              )}
              <Row2>
                <Field label="Propinas ₡">
                  <MontoInput prefix="₡" value={propM} onChange={setPropM} />
                </Field>
                <Field label="Otros egresos ₡">
                  <MontoInput prefix="₡" value={otrosM} onChange={setOtrosM} />
                </Field>
              </Row2>
              <button
                onClick={handleConfirmParcial} disabled={saving || turnoAbierto}
                style={{ width:'100%', marginTop:'0.75rem', padding:'0.75rem', fontSize:'0.82rem', fontWeight:700, borderRadius:2, cursor:'pointer', background:'rgba(200,169,110,.15)', color:'#c8a030', border:'1.5px solid #c8a030', display:'flex', alignItems:'center', justifyContent:'center', gap:'0.5rem' }}>
                💾 Confirmar cierre mediodía → sellar Fase 1
              </button>
            </Section>
          ) : (
            /* Mediodía sellado */
            <div style={{ background:'#0d0d0d', border:'1px solid #2a2a2a', borderRadius:2, overflow:'hidden', marginBottom:'1rem' }}>
              <div style={{ padding:'0.625rem 0.875rem', background:'#111', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #1a1a1a' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                  <span>🔒</span>
                  <div>
                    <div style={{ fontSize:'0.82rem', fontWeight:600, color:'#888' }}>Ventas mediodía — sellado</div>
                    <div style={{ fontSize:'0.65rem', color:'#555' }}>Registrado · no editable</div>
                  </div>
                </div>
                <span style={{ fontSize:'0.65rem', color:'#4a9a6a', background:'rgba(74,154,106,.1)', padding:'2px 8px', borderRadius:10, border:'1px solid #4a9a6a' }}>✓ Confirmado</span>
              </div>
              {[
                { l:'Ventas PoS ₡', v: fi2(parcial.vm_crc) },
                { l:'Dólares $',    v: '$' + parcial.vm_usd.toFixed(2) },
                { l:'Efectivo real ₡', v: fi2(parcial.ef_real_m_crc) },
                { l:'Propinas ₡',   v: fi2(parcial.propinas_m_crc) },
                parcial.otros_m_crc > 0 ? { l:'Otros egresos ₡', v: fi2(parcial.otros_m_crc) } : null,
              ].filter(Boolean).map((row, i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'0.4rem 0.875rem', borderBottom:'1px solid #111', fontSize:'0.8rem' }}>
                  <span style={{ color:'#666' }}>{(row as {l:string;v:string}).l}</span>
                  <span style={{ fontWeight:500, color:'#aaa' }}>{(row as {l:string;v:string}).v}</span>
                </div>
              ))}
              <div style={{ display:'flex', justifyContent:'space-between', padding:'0.5rem 0.875rem', background:'#111', fontSize:'0.8rem' }}>
                <span style={{ color:'#888', fontSize:'0.68rem', textTransform:'uppercase', letterSpacing:'0.08em' }}>Efectivo neto mediodía</span>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:'0.9rem', fontWeight:700, color:'#c8a030' }}>
                  {fi2((parcial.ef_real_m_crc||0) - (parcial.propinas_m_crc||0) - (parcial.otros_m_crc||0))}
                </span>
              </div>
            </div>
          )}

          {/* ── FASE 2: Noche (solo si Fase 1 cerrada) ── */}
          {parcial && (
            <>
              <Section title="Ventas noche" icon="🌙" color="#7ab4d4">
                <Row2>
                  <Field label="Ventas PoS ₡">
                    <MontoInput prefix="₡" value={vnCRC} onChange={setVnCRC} />
                  </Field>
                  <Field label={`Dólares $ → ₡${N(vnUSD) > 0 ? (N(vnUSD)*tc).toLocaleString('es-CR') : '—'}`}>
                    <MontoInput prefix="$" value={vnUSD} onChange={setVnUSD} />
                  </Field>
                </Row2>
                {(N(vnCRC) > 0 || N(vnUSD) > 0) && (
                  <div style={{ background:'rgba(122,180,212,.1)', border:'1px solid #7ab4d4', borderRadius:2, padding:'0.5rem 0.75rem', fontSize:'0.82rem', color:'#7ab4d4', marginBottom:'0.75rem' }}>
                    Efectivo real noche: <strong>{fi2(efRealN)}</strong>
                  </div>
                )}
                <Row2>
                  <Field label="Propinas noche ₡">
                    <MontoInput prefix="₡" value={propN} onChange={setPropN} />
                  </Field>
                  <Field label="Otros egresos noche ₡">
                    <MontoInput prefix="₡" value={otrosN} onChange={setOtrosN} />
                  </Field>
                </Row2>
              </Section>

              {/* Separaciones */}
              <Section title="Conteo físico — separaciones" icon="📊" color="#4a9a6a">
                <div style={{ fontSize:'0.72rem', color:'#666', marginBottom:'0.75rem' }}>
                  Juntá todo el efectivo, separás las asignaciones y contás el remanente de Caja Fuerte.
                </div>
                <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:'0.75rem' }}>
                  <thead>
                    <tr style={{ background:'#0d0d0d', borderBottom:'1px solid #1a1a1a' }}>
                      <th style={{ textAlign:'left', padding:'0.4rem 0.625rem', fontSize:'0.62rem', color:'#555', letterSpacing:'0.1em', textTransform:'uppercase', width:180 }}/>
                      <th style={{ textAlign:'center', padding:'0.4rem 0.5rem', fontSize:'0.62rem', color:'#555', letterSpacing:'0.1em', textTransform:'uppercase', borderLeft:'1px solid #1a1a1a' }}>₡ Colones</th>
                      <th style={{ textAlign:'center', padding:'0.4rem 0.5rem', fontSize:'0.62rem', color:'#555', letterSpacing:'0.1em', textTransform:'uppercase', borderLeft:'1px solid #1a1a1a' }}>$ Dólares</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label:'Caja Diaria mañana', sub:'separación día siguiente', color:'#4a9a6a', crc:sepDiariaCRC, setCRC:setSepDiariaCRC, usd:sepDiariaUSD, setUSD:setSepDiariaUSD },
                      { label:'Caja Registradora',  sub:'para vuelto mañana',       color:'#888',    crc:sepRegCRC,    setCRC:setSepRegCRC,    usd:sepRegUSD,    setUSD:setSepRegUSD    },
                      { label:'Remanente CF',        sub:'queda en Caja Fuerte',     color:'#c890e8', crc:remCRC,       setCRC:setRemCRC,       usd:remUSD,       setUSD:setRemUSD       },
                    ].map(row => (
                      <tr key={row.label} style={{ borderBottom:'1px solid #111', background: row.color === '#c890e8' ? 'rgba(200,144,232,.05)' : undefined }}>
                        <td style={{ padding:'0.625rem 0.75rem', borderRight:'1px solid #111' }}>
                          <div style={{ fontSize:'0.8rem', fontWeight:600, color:row.color }}>{row.label}</div>
                          <div style={{ fontSize:'0.65rem', color:'#555', marginTop:1 }}>{row.sub}</div>
                        </td>
                        <td style={{ padding:'0.3rem 0.5rem', borderRight:'1px solid #111' }}>
                          <MontoInput prefix="₡" value={row.crc} onChange={row.setCRC} compact />
                        </td>
                        <td style={{ padding:'0.3rem 0.5rem' }}>
                          <MontoInput prefix="$" value={row.usd} onChange={row.setUSD} compact />
                        </td>
                      </tr>
                    ))}
                    <tr style={{ background:'#0d0d0d', borderTop:'2px solid #2a2a2a' }}>
                      <td style={{ padding:'0.625rem 0.75rem', fontSize:'0.78rem', color:'#888', borderRight:'1px solid #111' }}>Total contado</td>
                      <td style={{ padding:'0.625rem 0.5rem', fontFamily:"'DM Mono',monospace", fontSize:'0.95rem', fontWeight:800, color:'#4a9a6a', borderRight:'1px solid #111', textAlign:'center' }}>
                        {totalContadoCRC > 0 ? fi2(totalContadoCRC) : '—'}
                      </td>
                      <td style={{ padding:'0.625rem 0.5rem', fontSize:'0.82rem', color:'#888', textAlign:'center' }}>
                        {totalContadoUSD > 0 ? `$${totalContadoUSD.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Verificación */}
                {totalContadoCRC > 0 && (
                  <div style={{ background: cuadra ? 'rgba(74,154,106,.1)' : 'rgba(194,59,34,.1)', border:`1.5px solid ${cuadra ? '#4a9a6a' : '#c23b22'}`, borderRadius:2, padding:'0.75rem', marginBottom:'0.75rem' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'0.5rem', marginBottom:'0.5rem', textAlign:'center' }}>
                      {[
                        { l:'Mediodía neto',  v: netoM },
                        { l:'Noche neto',     v: netoN },
                        { l:'Debería quedar', v: deberia },
                      ].map(k => (
                        <div key={k.l}>
                          <div style={{ fontSize:'0.6rem', color:'#555', textTransform:'uppercase', letterSpacing:'0.1em' }}>{k.l}</div>
                          <div style={{ fontSize:'0.88rem', fontWeight:700, color:'#aaa' }}>{fi2(k.v)}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', justifyContent:'center', fontSize:'0.82rem', fontWeight:700, color: cuadra ? '#4a9a6a' : '#c23b22' }}>
                      {cuadra ? '✅ Cuadra correctamente' : `⚠️ Diferencia: ${diferencia! >= 0 ? '+' : ''}${fi2(diferencia ?? 0)}`}
                    </div>
                  </div>
                )}

                {/* Ajuste obligatorio si hay diferencia */}
                {requiresAjuste && (
                  <div style={{ background:'rgba(194,59,34,.08)', border:'2px solid #c23b22', borderRadius:2, padding:'0.875rem', marginBottom:'0.75rem' }}>
                    <div style={{ fontSize:'0.82rem', fontWeight:700, color:'#c23b22', marginBottom:'0.75rem' }}>
                      ⚠ Diferencia detectada — registrá el motivo para cerrar
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'160px 1fr', gap:'0.5rem', alignItems:'end' }}>
                      <Field label="Tipo">
                        <select value={ajusteTipo} onChange={e => setAjusteTipo(e.target.value)}
                          style={{ width:'100%', background:'#111', border:'1px solid #333', color:'var(--t-paper)', padding:'6px 8px', borderRadius:2, fontSize:'0.82rem' }}>
                          <option>Faltante</option><option>Sobrante</option><option>Error cobro</option><option>Otro</option>
                        </select>
                      </Field>
                      <Field label="Motivo *">
                        <input value={ajusteMotivo} onChange={e => setAjusteMotivo(e.target.value)}
                          placeholder="Descripción obligatoria…"
                          style={{ width:'100%', background:'#111', border:`1px solid ${ajusteMotivo ? '#333' : '#c23b22'}`, color:'var(--t-paper)', padding:'6px 10px', borderRadius:2, fontSize:'0.82rem' }} />
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
                    style={{ width:'100%', background:'#111', border:'1px solid #2a2a2a', color:'var(--t-paper)', padding:'6px 10px', borderRadius:2, fontSize:'0.82rem' }} />
                </Field>
              </div>

              <button
                onClick={handleConfirmCompleto}
                disabled={saving || turnoAbierto || !N(vnCRC) || totalContadoCRC === 0 || (requiresAjuste && !ajusteMotivo.trim())}
                style={{ width:'100%', padding:'0.875rem', fontSize:'0.82rem', fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', borderRadius:2, cursor:'pointer', background:'rgba(74,154,106,.15)', color:'#4a9a6a', border:'2px solid #4a9a6a', display:'flex', alignItems:'center', justifyContent:'center', gap:'0.5rem', opacity: saving ? 0.6 : 1 }}>
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
    <div style={{ background:'#0a0a0a', border:'1px solid #1a1a1a', borderRadius:2, overflow:'hidden', marginBottom:'0.875rem' }}>
      <div style={{ padding:'0.625rem 0.875rem', background:'#111', borderBottom:'1px solid #1a1a1a', display:'flex', alignItems:'center', gap:'0.625rem' }}>
        <span style={{ fontSize:'1.1rem' }}>{icon}</span>
        <div style={{ fontSize:'0.85rem', fontWeight:600, color }}>{title}</div>
      </div>
      <div style={{ padding:'0.875rem' }}>{children}</div>
    </div>
  )
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.625rem', marginBottom:'0.75rem' }}>{children}</div>
}

function Field({ label, children }: { label:string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize:'0.65rem', color:'#888', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>{label}</div>
      {children}
    </div>
  )
}

function MontoInput({ prefix, value, onChange, compact }: {
  prefix: string; value: number|''; onChange: (v: number|'') => void; compact?: boolean
}) {
  return (
    <div style={{ display:'flex', alignItems:'center', height: compact ? 34 : 38, background:'#111', border:'1px solid #2a2a2a', borderRadius:2 }}>
      <span style={{ padding:'0 8px', fontSize: compact ? '0.72rem' : '0.82rem', color:'#555', flexShrink:0 }}>{prefix}</span>
      <input
        type="number" min={0} step={100} value={value}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        style={{ flex:1, background:'transparent', border:'none', outline:'none', color:'var(--t-paper)', fontSize: compact ? '0.82rem' : '0.9rem', padding:'0 8px', fontFamily:'DM Mono, monospace' }}
        placeholder="0"
      />
    </div>
  )
}
