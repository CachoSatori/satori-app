/**
 * Reportes (owner, manager): reporte mensual del Club por mes y local.
 * «Exportar PDF» abre el HTML A4 del estándar (fuentes incrustadas) y lanza la impresión
 * del navegador → «Guardar como PDF». «Exportar CSV» baja el anexo con todas las filas.
 */
import { useEffect, useState } from 'react'
import { getReporteMes, getLocalesClub, localActual, type LocalClub, cerrarMes, aClubError, fmtCreditos, getReporteAltas, type ReporteMes, type FilaReporte, type AltasPorCajero, getReporteVisitas, type VisitasPorUsuario } from '../../shared/api/club'
import { useAuth } from '../../shared/hooks/useAuth'
import Comparacion from './Comparacion'
import Vencimiento from './Vencimiento'
import { Aviso, Btn, Card } from './ui'
import { C, inputStyle, labelStyle, fmtFecha } from './estilos'
import { esParcial } from './reporteSaldo'

const mesAnterior = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }))
  d.setDate(1); d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const n0 = (n: number) => Number(n ?? 0).toLocaleString('de-DE', { maximumFractionDigits: 0 })
const crc = (n: number) => `₡${n0(n)}`

export default function Reportes() {
  const [mes, setMes] = useState(mesAnterior())
  const [local, setLocal] = useState<string | null>(localActual())
  const [locales, setLocales] = useState<LocalClub[]>([])
  const [rep, setRep] = useState<ReporteMes | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [cerrando, setCerrando] = useState(false)
  const { profile } = useAuth()
  const esOwner = profile?.role === 'owner'

  useEffect(() => {
    getLocalesClub().then(l => {
      setLocales(l)
      setLocal(act => act ?? l.find(x => x.activo)?.id ?? l[0]?.id ?? null)
    }).catch(() => {})
  }, [])
  useEffect(() => {
    let vivo = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCargando(true); setError(null)
    getReporteMes(`${mes}-01`, local)
      .then(r => { if (vivo) setRep(r) })
      .catch(e => { if (vivo) { setRep(null); setError(aClubError(e).message) } })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [mes, local])

  // CLUB-AUD-04: cerrar el mes congela el reporte (sha256). Recerrar crea una versión nueva con motivo.
  async function cerrar() {
    if (!rep) return
    if (!window.confirm(rep.cerrado ? `¿Recerrar ${rep.mes}? Queda como versión ${(rep.version ?? 1) + 1}.` : `¿Cerrar ${rep.mes}? El reporte queda congelado.`)) return
    setCerrando(true); setError(null)
    try { setRep(await cerrarMes(`${mes}-01`, motivo, local)); setMotivo('') }
    catch (e) { setError(aClubError(e).message) }
    finally { setCerrando(false) }
  }

  async function exportarPdf() {
    if (!rep) return
    const { reporteHtml } = await import('./reporteHtml')
    const url = URL.createObjectURL(new Blob([reporteHtml(rep)], { type: 'text/html' }))
    const w = window.open(url, '_blank')
    if (w) w.addEventListener('load', () => setTimeout(() => w.print(), 400))
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  async function exportarCsv() {
    if (!rep) return
    const { reporteCsv } = await import('./reporteHtml')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([reporteCsv(rep)], { type: 'text/csv;charset=utf-8' }))
    a.download = `club-satori-${rep.local}-${rep.mes}.csv`
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  const k = rep?.kpis
  return (
    <div className="tips-body" style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <Card style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'end' }}>
        <label><span style={labelStyle}>Mes</span><input type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)} style={inputStyle} /></label>
        <label><span style={labelStyle}>Local</span>
          <select value={local ?? ''} onChange={e => setLocal(e.target.value)} style={inputStyle}>
            {locales.map(l => <option key={l.id} value={l.id}>{l.nombre}{l.activo ? '' : ' (Club apagado)'}</option>)}
          </select>
        </label>
        <Btn onClick={exportarPdf} disabled={!rep}>Exportar PDF</Btn>
        <Btn variant="secondary" onClick={exportarCsv} disabled={!rep}>Exportar CSV</Btn>
      </Card>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      {esOwner && <Vencimiento />}
      <Comparacion />
      {rep && !cargando && rep.cerrado && (
        <Aviso tono="info">
          Mes cerrado (versión {rep.version}) el {fmtFecha(rep.cerrado_en ?? '')}: el reporte no cambia aunque después se paguen
          cargos o se resuelvan excepciones. Huella {rep.sha256?.slice(0, 12)}…{rep.motivo ? ` · Motivo: ${rep.motivo}` : ''}
        </Aviso>
      )}
      {rep && !cargando && esOwner && !esParcial(rep) && (
        <Card style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ flex: 1, minWidth: 200 }}><span style={labelStyle}>{rep.cerrado ? 'Motivo del recierre (obligatorio)' : 'Cerrar el mes (opcional: motivo)'}</span>
            <input value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={500} style={inputStyle} />
          </label>
          <Btn variant="secondary" onClick={cerrar} disabled={cerrando || (rep.cerrado && !motivo.trim())}>
            {cerrando ? 'Cerrando…' : rep.cerrado ? 'Recerrar el mes' : 'Cerrar el mes'}
          </Btn>
        </Card>
      )}
      {cargando && <div style={{ textAlign: 'center', color: C.muted, padding: '2rem' }}>Armando el reporte…</div>}
      {rep && k && !cargando && (
        <>
          <Card>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <Kpi v={n0(k.personas)} e="personas referidas" a={`mes anterior: ${n0(k.anterior.personas)}`} />
              <Kpi v={fmtCreditos(k.creditos_canjeados)} e="créditos canjeados" a={crc(k.valor_canjeado_crc)} />
              <Kpi v={fmtCreditos(k.saldo_creditos_al_cierre)} e={esParcial(rep) ? `créditos en saldo hoy (mes en curso)` : `créditos en saldo al cierre del mes`} a={`${n0(k.cuentas_con_saldo)} cuentas`} />
              <Kpi v={n0(k.cupones_usados)} e="cupones usados" a={`de ${n0(k.cupones_generados)} generados`} />
            </div>
          </Card>
          <Seccion t="Ranking del mes" filas={rep.ranking} col={f => `${n0(f.personas ?? 0)} p. · prom. ${fmtCreditos(f.prom_3m ?? 0)}`} vacio="Ningún referente mandó gente este mes." />
          <Seccion t="Vienen subiendo" filas={rep.subiendo} col={f => f.nuevo_ritmo ? 'nuevo ritmo' : `${n0(f.personas ?? 0)} vs. ${fmtCreditos(f.prom_3m ?? 0)}`} vacio="Nadie subió este mes." />
          <Seccion t="Vienen bajando" filas={rep.bajando} col={f => `${n0(f.personas ?? 0)} vs. ${fmtCreditos(f.prom_3m ?? 0)}`} vacio="Nadie bajó este mes." />
          <Seccion t="A contactar (vencen en 30 días)" filas={rep.a_contactar} col={f => `${fmtCreditos(f.creditos ?? 0)} cr. · vence ${fmtFecha(f.vence_en)}`} vacio="Nadie vence en los próximos 30 días." />
          <Seccion t={`Dormidos: ${n0(rep.dormidos.cuentas)} cuentas, ${fmtCreditos(rep.dormidos.creditos)} créditos`} filas={rep.dormidos.lista.slice(0, 10)} col={f => `${fmtCreditos(f.creditos ?? 0)} cr. · ${fmtFecha(f.ultima_actividad)}`} vacio="No hay cuentas dormidas." />
          <Seccion t={`Nuevos: ${n0(rep.nuevos.cuentas)}`} filas={rep.nuevos.lista} col={f => `${n0(f.personas ?? 0)} p.`} vacio="Ningún referente nuevo." />
          <Seccion t={`Equipo Satori: ${n0(rep.equipo.personas_mes)} personas en el mes`} filas={rep.equipo.lista} col={f => `${fmtCreditos(f.creditos ?? 0)} cr.`} vacio="Sin movimientos del equipo." />
          <Card>
            <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Saldos por antigüedad</h3>
            {rep.antiguedad.map(b => (
              <div key={b.tramo} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderBottom: `1px solid ${C.panel}` }}>
                <span>{b.tramo}</span><span>{n0(b.cuentas)} cuentas · {fmtCreditos(b.creditos)} cr. · {crc(b.valor_crc)}</span>
              </div>
            ))}
          </Card>
          <Card>
            <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Concierges PM</h3>
            <div>Pendiente {crc(rep.pm.pendiente_crc)} · cargado en el mes {crc(rep.pm.cargos_mes_crc)} · pagado {crc(rep.pm.pagos_mes_crc)}</div>
            {rep.pm.nota && <div style={{ color: C.muted, fontSize: '0.85rem', marginTop: 4 }}>{rep.pm.nota}</div>}
          </Card>
          <AltasSocios mes={mes} local={local} />
          <VisitasSocios mes={mes} local={local} />
          <Card>
            <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Calidad de datos</h3>
            <div>{n0(rep.calidad.abiertas)} excepciones abiertas y {n0(rep.calidad.resueltas)} resueltas en el mes.
              {!rep.calidad.promo_activa && ' «Promo sin cupón» y «cupón sin promo» están pendientes de configuración: falta el código de «PROMO CLUB 10%».'}</div>
          </Card>
        </>
      )}
    </div>
  )
}

function Kpi({ v, e, a }: { v: string; e: string; a: string }) {
  return (
    <div>
      <div style={{ fontSize: '1.9rem', fontWeight: 800, fontFamily: 'var(--font-serif)' }}>{v}</div>
      <div style={{ color: C.muted, fontSize: '0.8rem' }}>{e}</div>
      <div style={{ fontSize: '0.8rem' }}>{a}</div>
    </div>
  )
}

function Seccion({ t, filas, col, vacio }: { t: string; filas: FilaReporte[]; col: (f: FilaReporte) => string; vacio: string }) {
  return (
    <Card>
      <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>{t}</h3>
      {filas.length === 0 ? <div style={{ color: C.muted }}>{vacio}</div> : filas.map((f, i) => (
        <div key={`${f.nombre}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderBottom: `1px solid ${C.panel}` }}>
          <span><strong>{f.nombre}</strong>{f.negocio ? <span style={{ color: C.muted }}> · {f.negocio}</span> : null}</span>
          <span style={{ whiteSpace: 'nowrap' }}>{col(f)}</span>
        </div>
      ))}
    </Card>
  )
}

/** LC-A5: altas de socios del mes por usuario (sale de la auditoría). */
function AltasSocios({ mes, local }: { mes: string; local: string | null }) {
  const [filas, setFilas] = useState<AltasPorCajero[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    const [a, m] = mes.split('-').map(Number)
    const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
    getReporteAltas(`${mes}-01`, fin, local)
      .then(f => { if (vivo) { setFilas(f); setError(null) } })
      .catch(e => { if (vivo) setError(aClubError(e).message) })
    return () => { vivo = false }
  }, [mes, local])
  return (
    <Card>
      <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Altas de socios por usuario</h3>
      {error && <Aviso tono="error">{error}</Aviso>}
      {filas === null ? <div style={{ color: C.muted }}>Cargando…</div> : filas.length === 0 ? <div style={{ color: C.muted }}>Sin altas en el mes.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead><tr style={{ textAlign: 'left', color: C.muted }}>
              <th>Usuario</th><th>Altas en caja</th><th>Validó autoaltas</th><th>Confirmó</th><th>Sin confirmar</th><th>Volvieron a pendiente</th>
            </tr></thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.usuario} style={{ borderTop: `1px solid ${C.panel}` }}>
                  <td>{f.usuario}</td><td>{n0(f.altas_caja)}</td><td>{n0(f.validaciones)}</td><td>{n0(f.confirmo)}</td>
                  <td>{n0(f.sin_confirmar)}</td><td style={{ color: f.vencidas > 0 ? C.red : undefined }}>{n0(f.vencidas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/** LC-A6: visitas de socio por usuario que las registró. «Sin factura» y un mismo socio muchas veces son lo que hay que mirar. */
function VisitasSocios({ mes, local }: { mes: string; local: string | null }) {
  const [filas, setFilas] = useState<VisitasPorUsuario[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    const [a, m] = mes.split('-').map(Number)
    const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
    getReporteVisitas(`${mes}-01`, fin, local)
      .then(f => { if (vivo) { setFilas(f); setError(null) } })
      .catch(e => { if (vivo) setError(aClubError(e).message) })
    return () => { vivo = false }
  }, [mes, local])
  return (
    <Card>
      <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Visitas de socios por usuario</h3>
      <div style={{ fontSize: '0.8rem', color: C.muted, marginBottom: 6 }}>
        Quién registró cada visita de socio en la app. Mirá «Sin factura» (la visita no cruzó con ninguna factura del PoS) y
        «Máx. un socio» (el mismo socio registrado muchas veces por la misma persona).
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}
      {filas === null ? <div style={{ color: C.muted }}>Cargando…</div> : filas.length === 0 ? <div style={{ color: C.muted }}>Sin visitas de socios en el mes.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead><tr style={{ textAlign: 'left', color: C.muted }}>
              <th>Usuario</th><th>Visitas</th><th>Socios</th><th>Con beneficio</th><th>Como invitado</th><th>Con créditos</th><th>Sin factura</th><th>Máx. un socio</th>
            </tr></thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.usuario} style={{ borderTop: `1px solid ${C.panel}` }}>
                  <td>{f.usuario}</td><td>{n0(f.visitas)}</td><td>{n0(f.socios)}</td><td>{n0(f.con_beneficio)}</td><td>{n0(f.como_invitado)}</td>
                  <td>{n0(f.con_creditos)}</td><td style={{ color: f.sin_factura > 0 ? C.red : undefined }}>{n0(f.sin_factura)}</td><td>{n0(f.max_mismo_socio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
