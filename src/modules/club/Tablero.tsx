/**
 * Club → Tablero (SPEC Club v2, ítems 3, 4 y 5; mig 160): «¿El Club deja plata?» y el pasivo de créditos, por mes y
 * local. owner, manager y contador. Solo totales: la función no devuelve nombres ni contactos. Cada lectura deja
 * rastro en club_auditoria. El owner edita el % de costo de las cortesías (queda en el historial de la config).
 */
import { useEffect, useState } from 'react'
import { getTablero, getLocalesClub, localActual, setCortesiaCostoPct, aClubError, type LocalClub, type TableroGrupo, type TableroMes } from '../../shared/api/club'
import { useAuth } from '../../shared/hooks/useAuth'
import { Aviso, Btn, Card } from './ui'
import { C, inputStyle, labelStyle, mesActualCR } from './estilos'
import { avisos, creditosTxt, crcTxt, filasPasivo, pctTxt, tableroCsv, titular } from './tableroFormato'

const n0 = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('de-DE', { maximumFractionDigits: 1 })

export default function Tablero() {
  const { profile } = useAuth()
  const esOwner = profile?.role === 'owner'
  const [mes, setMes] = useState(mesActualCR())
  const [local, setLocal] = useState<string | null>(localActual())
  const [locales, setLocales] = useState<LocalClub[]>([])
  const [t, setT] = useState<TableroMes | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    getLocalesClub().then(l => {
      setLocales(l)
      setLocal(act => act ?? l.find(x => x.activo)?.id ?? l[0]?.id ?? null)
    }).catch(() => {})
  }, [])
  useEffect(() => {
    // sin local elegido no se lee: cada lectura deja una fila en club_auditoria (se esperaba una sola)
    if (!local) return
    let vivo = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCargando(true); setError(null)
    getTablero(`${mes}-01`, local)
      .then(r => { if (vivo) setT(r) })
      .catch(e => { if (vivo) { setT(null); setError(aClubError(e).message) } })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [mes, local, recarga])

  function exportarCsv() {
    if (!t) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([tableroCsv(t)], { type: 'text/csv;charset=utf-8' }))
    a.download = `club-tablero-${t.local}-${t.mes}.csv`
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  const k = t?.plata
  return (
    <div className="tips-body" style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <Card style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'end' }}>
        <label><span style={labelStyle}>Mes</span><input type="month" aria-label="Mes" value={mes} onChange={e => e.target.value && setMes(e.target.value)} style={inputStyle} /></label>
        <label><span style={labelStyle}>Local</span>
          <select aria-label="Local" value={local ?? ''} onChange={e => setLocal(e.target.value)} style={inputStyle}>
            {locales.map(l => <option key={l.id} value={l.id}>{l.nombre}{l.activo ? '' : ' (Club apagado)'}</option>)}
          </select>
        </label>
        <Btn variant="secondary" onClick={exportarCsv} disabled={!t}>Exportar CSV</Btn>
      </Card>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      {cargando && <div style={{ textAlign: 'center', color: C.muted, padding: '2rem' }}>Armando el tablero…</div>}
      {t && k && !cargando && (
        <>
          <Card>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem' }}>¿El Club deja plata?</h3>
            <p style={{ margin: '0 0 10px', color: C.ink }} data-testid="titular">{titular(t)}</p>
            {avisos(t).map(a => <div key={a} role="status" style={{ color: C.muted, fontSize: '0.85rem', marginBottom: 4 }}>{a}</div>)}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 8 }}>
              <Kpi v={crcTxt(k.venta_respaldada_crc)} e="venta respaldada cobrada"
                a={`${n0(k.facturas_club)} facturas del Club de ${n0(k.facturas_mes)} · neta ${crcTxt(k.venta_respaldada_neta_crc)}, con lo regalado`} />
              <Kpi v={crcTxt(k.costo_total_crc)} e="costo del Club" a="descuento + cortesías + canjes" />
              <Kpi v={pctTxt(k.tasa_efectiva_pct)} e="tasa efectiva de descuento" a="costo ÷ venta cobrada" />
            </div>
          </Card>

          <Card>
            <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Costo del Club</h3>
            <Renglon e="Descuento (estimado)" v={crcTxt(k.descuento_estimado_crc)}
              d={`${n0(k.descuento_lineas)} líneas en ${n0(k.descuento_facturas)} facturas, contra el precio más vendido de los 30 días anteriores`} />
            <Renglon e={`Cortesías a costo (${pctTxt(t.config.cortesia_costo_pct)})`} v={crcTxt(k.cortesias_costo_crc)}
              d={`${n0(k.cortesias_unidades)} unidades · precio de lista ${crcTxt(k.cortesias_lista_crc)}`} />
            <Renglon e="Créditos canjeados" v={crcTxt(k.canjes_crc)}
              d={`${n0(k.canjes)} canjes · ${creditosTxt(k.creditos_canjeados)} créditos × valor del crédito de cada canje`} />
            <Renglon e="Total" v={crcTxt(k.costo_total_crc)} fuerte />
            <div style={{ color: C.muted, fontSize: '0.8rem', marginTop: 6 }}>
              El PoS manda el descuento en cero: se estima línea por línea con las reglas de «Descuento sin respaldo» (un cambio
              de lista no es descuento). Una factura con socio, cupón y canje cuenta una vez.
            </div>
            {esOwner && <EditarPct local={t.local} pct={t.config.cortesia_costo_pct} onGuardado={() => setRecarga(x => x + 1)} />}
          </Card>

          <Card>
            <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Regalía en el PoS</h3>
            <Renglon e="Regalía en facturas del Club (total)" v={crcTxt(t.regalia.crc)}
              d={`${n0(t.regalia.facturas)} facturas · ${crcTxt(t.regalia.en_canjes_crc)} en facturas con canje`} />
            <div style={{ color: C.muted, fontSize: '0.8rem', marginTop: 6 }}>
              Lo no cobrado (canjes y cortesías) va como regalía en el PoS: se resta de la venta (la venta respaldada es la cobrada)
              y no se suma al costo, que ya lo cuenta arriba. El PoS no dice el motivo de cada regalía.
            </div>
          </Card>

          <Card>
            <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Facturas con socio y sin socio</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead><tr style={{ textAlign: 'left', color: C.muted }}>
                  <th></th><th style={{ textAlign: 'right' }}>Facturas</th><th style={{ textAlign: 'right' }}>Venta</th>
                  <th style={{ textAlign: 'right' }}>Tiquete promedio</th><th style={{ textAlign: 'right' }}>Personas por factura</th>
                  <th style={{ textAlign: 'right' }}>Por persona</th>
                </tr></thead>
                <tbody>
                  <FilaGrupo e="Con socio" g={t.comparacion.con_socio} />
                  <FilaGrupo e="Sin socio" g={t.comparacion.sin_socio} />
                  <FilaGrupo e="Con cupón" g={t.comparacion.con_cupon} />
                </tbody>
              </table>
            </div>
            <div style={{ color: C.muted, fontSize: '0.8rem', marginTop: 6 }}>Compara facturas, no personas, con la venta cobrada. «Con cupón» es parte de «sin socio».</div>
          </Card>

          <Card>
            <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Pasivo de créditos</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead><tr style={{ textAlign: 'left', color: C.muted }}>
                  <th></th><th style={{ textAlign: 'right' }}>Personas</th><th style={{ textAlign: 'right' }}>Créditos</th><th style={{ textAlign: 'right' }}>Colones</th>
                </tr></thead>
                <tbody>
                  {filasPasivo(t).map(f => (
                    <tr key={f.clave} style={{ borderTop: `1px solid ${C.panel}`, fontWeight: f.total ? 700 : 400 }}>
                      <td>{f.etiqueta}</td>
                      <td style={{ textAlign: 'right' }}>{n0(f.linea.personas)}</td>
                      <td style={{ textAlign: 'right' }}>{creditosTxt(f.linea.creditos)}</td>
                      <td style={{ textAlign: 'right' }}>{crcTxt(f.linea.crc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ color: C.muted, fontSize: '0.8rem', marginTop: 6 }}>
              Canjeable hoy cuenta por cuenta: {creditosTxt(t.pasivo.canjeable_creditos)} créditos en {n0(t.pasivo.cuentas_con_saldo)} cuentas (la
              diferencia con el saldo son personas que todavía no completan medio crédito). Los colones van al valor del crédito de
              cada movimiento, sin revaluar.
            </div>
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px dashed ${C.border}` }}>
              <Renglon e="Congelado (equipo), fuera del pasivo" v={crcTxt(t.pasivo.congelado.crc)}
                d={`${n0(t.pasivo.congelado.cuentas)} cuentas · ${n0(t.pasivo.congelado.personas)} personas · ${creditosTxt(t.pasivo.congelado.creditos)} créditos`} />
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

function Kpi({ v, e, a }: { v: string; e: string; a: string }) {
  return (
    <div>
      <div style={{ fontSize: '1.7rem', fontWeight: 800, fontFamily: 'var(--font-serif)' }}>{v}</div>
      <div style={{ color: C.muted, fontSize: '0.8rem' }}>{e}</div>
      <div style={{ fontSize: '0.8rem' }}>{a}</div>
    </div>
  )
}

function Renglon({ e, v, d, fuerte }: { e: string; v: string; d?: string; fuerte?: boolean }) {
  return (
    <div style={{ padding: '4px 0', borderBottom: `1px solid ${C.panel}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: fuerte ? 700 : 400 }}>
        <span>{e}</span><span style={{ whiteSpace: 'nowrap' }}>{v}</span>
      </div>
      {d && <div style={{ color: C.muted, fontSize: '0.8rem' }}>{d}</div>}
    </div>
  )
}

function FilaGrupo({ e, g }: { e: string; g: TableroGrupo }) {
  return (
    <tr style={{ borderTop: `1px solid ${C.panel}` }}>
      <td>{e}</td>
      <td style={{ textAlign: 'right' }}>{n0(g.facturas)}</td>
      <td style={{ textAlign: 'right' }}>{crcTxt(g.venta_crc)}</td>
      <td style={{ textAlign: 'right' }}>{g.tiquete_crc == null ? '—' : crcTxt(g.tiquete_crc)}</td>
      <td style={{ textAlign: 'right' }}>{g.personas_por_factura == null ? '—' : n0(g.personas_por_factura)}</td>
      <td style={{ textAlign: 'right' }}>{g.por_persona_crc == null ? '—' : crcTxt(g.por_persona_crc)}</td>
    </tr>
  )
}

/** Solo owner: % del precio de lista que cuesta una cortesía (queda en el historial de la configuración). */
function EditarPct({ local, pct, onGuardado }: { local: string; pct: number; onGuardado: () => void }) {
  const [v, setV] = useState(String(pct))
  const [msg, setMsg] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const n = Number(v.replace(',', '.'))
  const valido = v.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100
  async function guardar() {
    setGuardando(true); setMsg(null)
    try { await setCortesiaCostoPct(local, n); setMsg('Guardado.'); onGuardado() }
    catch (e) { setMsg(aClubError(e).message) }
    finally { setGuardando(false) }
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 10 }}>
      <label style={{ width: 170 }}><span style={labelStyle}>Costo de una cortesía (%)</span>
        <input aria-label="Costo de una cortesía (%)" inputMode="decimal" value={v} onChange={e => setV(e.target.value)} style={inputStyle} />
      </label>
      <Btn variant="secondary" onClick={() => void guardar()} disabled={guardando || !valido || n === Number(pct)}>
        {guardando ? 'Guardando…' : 'Guardar %'}
      </Btn>
      {msg && <span style={{ fontSize: '0.85rem', color: msg === 'Guardado.' ? C.teal : C.red }}>{msg}</span>}
    </div>
  )
}
