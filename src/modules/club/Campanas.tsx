/**
 * Campañas (solo owner) — 166, SPEC Club v2 ítem 12 (B8): grupo de control.
 * El owner arma una campaña con la lista «A contactar» de HOY (créditos que vencen en los próximos 30 días) y puede
 * reservar un % sin la oferta (por defecto 15). El grupo de cada uno lo pone un sorteo fijo en la base: la pantalla no
 * elige ni reasigna a nadie. La lista y el CSV traen SOLO al grupo con oferta. El reporte compara los dos grupos.
 * Una campaña ABIERTA por local: para armar otra se cierra la anterior (con motivo; queda registrado, no se reabre).
 * El manager no ve esta pestaña: sigue viendo «A contactar» en Reportes, como hoy.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  aClubError, cerrarCampana, crearCampana, exportarListaCampana, fmtCreditos, getCampanas, getListaCampana, getReporteCampana,
  localActual, sumarNuevosCampana, type Campana, type ListaCampana, type ReporteCampana,
} from '../../shared/api/club'
import { todayCR } from '../../shared/utils'
import { Aviso, Btn, Card } from './ui'
import { C, inputStyle, labelStyle, fmtFecha, TIPO_MIEMBRO_LABEL } from './estilos'
import { REGLA_BENEFICIO_BASE, PCT_RESERVA_DEFECTO, pctReserva, avisoNoConcluyente, filasReporte, campanaCsv } from './campanaFormato'

export default function Campanas() {
  const local = localActual()
  // Un id por apertura de la pantalla: la base deja UNA fila de rastro por apertura, no una por clic.
  const apertura = useMemo(() => crypto.randomUUID(), [])
  const [lista, setLista] = useState<Campana[] | null>(null)
  const [nombre, setNombre] = useState('')
  const [reservar, setReservar] = useState(true)
  const [pctTxt, setPctTxt] = useState(String(PCT_RESERVA_DEFECTO))
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null)
  const [abierta, setAbierta] = useState<{ id: string; vista: 'lista' | 'reporte' } | null>(null)

  const cargar = useCallback(async () => {
    try { setLista(await getCampanas(local)) }
    catch (e) { setLista([]); setMsg({ tono: 'error', texto: aClubError(e).message }) }
  }, [local])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void cargar() }, [cargar])

  const pct = reservar ? pctReserva(pctTxt) : 0
  const abierta0 = lista?.find(c => !c.cerrada_en) ?? null
  async function armar() {
    if (pct === null || nombre.trim().length < 2) return
    if (!window.confirm(reservar
      ? `¿Armar «${nombre.trim()}» con la lista «A contactar» de hoy y reservar ${pct} % sin la oferta? El sorteo queda fijo: nadie se puede cambiar de grupo después.`
      : `¿Armar «${nombre.trim()}» sin grupo reservado? Sin reserva, el reporte no puede decir si la oferta sirvió.`)) return
    setOcupado(true); setMsg(null)
    try {
      const c = await crearCampana(nombre.trim(), local, pct)
      setMsg({ tono: 'ok', texto: `Campaña armada: ${c.oferta} con oferta y ${c.control} reservados.` })
      setNombre(''); await cargar()
    } catch (e) { setMsg({ tono: 'error', texto: aClubError(e).message }) }
    finally { setOcupado(false) }
  }
  async function sumar(c: Campana) {
    setOcupado(true); setMsg(null)
    try {
      const r = await sumarNuevosCampana(c.id)
      setMsg({ tono: 'ok', texto: r.nuevos ? `Se sumaron ${r.nuevos}. Los que ya estaban siguen en su grupo.` : 'No hay nadie nuevo en la lista.' })
      await cargar()
    } catch (e) { setMsg({ tono: 'error', texto: aClubError(e).message }) }
    finally { setOcupado(false) }
  }
  async function cerrar(c: Campana) {
    const motivo = window.prompt(`Cerrar «${c.nombre}». No se reabre y no suma a nadie más; el reporte se sigue viendo. Motivo:`)
    if (motivo === null) return
    if (motivo.trim().length < 3) { setMsg({ tono: 'error', texto: 'Poné el motivo del cierre.' }); return }
    setOcupado(true); setMsg(null)
    try { await cerrarCampana(c.id, motivo.trim()); setMsg({ tono: 'ok', texto: 'Campaña cerrada.' }); await cargar() }
    catch (e) { setMsg({ tono: 'error', texto: aClubError(e).message }) }
    finally { setOcupado(false) }
  }
  async function exportar(c: Campana) {
    let l: ListaCampana
    try { l = await exportarListaCampana(c.id) } catch (e) { setMsg({ tono: 'error', texto: aClubError(e).message }); return }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([campanaCsv(l.filas)], { type: 'text/csv;charset=utf-8' }))
    a.download = `club-satori-campana-${c.local}-${todayCR()}.csv`
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  return (
    <div className="tips-body" style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <Card>
        <span style={labelStyle}>Armar campaña (solo owner)</span>
        <div style={{ fontSize: '0.85rem', color: C.muted, marginBottom: 8 }}>
          Toma la lista «A contactar» de hoy: anfitriones con créditos que vencen en los próximos 30 días.
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <label><span style={labelStyle}>Nombre</span>
            <input value={nombre} onChange={e => setNombre(e.target.value)} maxLength={80} placeholder="Ej.: Créditos por vencer — noviembre" style={inputStyle} />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, color: C.ink }}>
            <input type="checkbox" checked={reservar} onChange={e => setReservar(e.target.checked)} />
            Reservar
            <input aria-label="Porcentaje reservado" value={pctTxt} onChange={e => setPctTxt(e.target.value)} disabled={!reservar}
              inputMode="decimal" style={{ ...inputStyle, width: 70, padding: '0.4rem 0.5rem' }} />
            % sin oferta
          </label>
          {reservar && pct === null && <Aviso tono="error">El porcentaje va de 0 a 50.</Aviso>}
          <Aviso tono="info">{REGLA_BENEFICIO_BASE}</Aviso>
          <div style={{ fontSize: '0.8rem', color: C.muted }}>
            Quién queda reservado lo decide un sorteo fijo y anotado: no se elige a mano y nadie cambia de grupo después.
            Hay una sola campaña abierta por local: para armar otra, cerrá la anterior.
          </div>
          {abierta0 && <Aviso tono="info">Ya hay una campaña abierta: «{abierta0.nombre}». Cerrala antes de armar otra.</Aviso>}
          <Btn onClick={armar} disabled={ocupado || pct === null || nombre.trim().length < 2 || !!abierta0}>{ocupado ? 'Armando…' : 'Armar campaña'}</Btn>
        </div>
      </Card>
      {msg && <Aviso tono={msg.tono} onClose={() => setMsg(null)}>{msg.texto}</Aviso>}

      {lista !== null && lista.length === 0 && <Aviso tono="info">Todavía no hay campañas en este local.</Aviso>}
      {lista?.map(c => (
        <Card key={c.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <strong>{c.nombre}</strong>
              <div style={{ fontSize: '0.85rem', color: C.muted }}>
                Desde {fmtFecha(c.inicio)} · {c.oferta} con oferta · {c.control} reservados ({c.control_pct} %)
                {' · '}{c.cerrada_en ? `Cerrada el ${fmtFecha(c.cerrada_en)}${c.cierre_motivo ? ` (${c.cierre_motivo})` : ''}` : 'Abierta'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Btn variant="secondary" onClick={() => setAbierta(a => a?.id === c.id && a.vista === 'lista' ? null : { id: c.id, vista: 'lista' })}>Lista</Btn>
              <Btn variant="secondary" onClick={() => exportar(c)}>CSV (sin reservados)</Btn>
              {!c.cerrada_en && <Btn variant="secondary" onClick={() => sumar(c)} disabled={ocupado}>Sumar nuevos</Btn>}
              <Btn variant="secondary" onClick={() => setAbierta(a => a?.id === c.id && a.vista === 'reporte' ? null : { id: c.id, vista: 'reporte' })}>Reporte</Btn>
              {!c.cerrada_en && <Btn variant="danger" onClick={() => cerrar(c)} disabled={ocupado}>Cerrar campaña</Btn>}
            </div>
          </div>
          {abierta?.id === c.id && abierta.vista === 'lista' && <ListaVista id={c.id} apertura={apertura} />}
          {abierta?.id === c.id && abierta.vista === 'reporte' && <ReporteVista id={c.id} apertura={apertura} />}
        </Card>
      ))}
    </div>
  )
}

function ListaVista({ id, apertura }: { id: string; apertura: string }) {
  const [l, setL] = useState<ListaCampana | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    getListaCampana(id, apertura).then(x => { if (vivo) setL(x) }).catch(e => { if (vivo) setError(aClubError(e).message) })
    return () => { vivo = false }
  }, [id, apertura])
  if (error) return <Aviso tono="error">{error}</Aviso>
  if (!l) return <div style={{ color: C.muted, marginTop: 8 }}>Cargando…</div>
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: '0.85rem', color: C.muted, marginBottom: 6 }}>
        A quién mandarle la oferta: {l.oferta}. Los {l.control} reservados no salen acá ni en el CSV: no se les manda esta oferta.
        Quien pasó a baja después de entrar sale marcado acá, pero no en el CSV.
      </div>
      {l.filas.length === 0 ? <Aviso tono="info">Nadie en la lista.</Aviso> : (
        <div style={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr style={{ textAlign: 'left', color: C.muted }}>
              <th style={{ padding: 6 }}>Anfitrión</th><th style={{ padding: 6 }}>Créditos</th><th style={{ padding: 6 }}>Vence</th>
            </tr></thead>
            <tbody>{l.filas.map(f => (
              <tr key={f.miembro_id} style={{ borderTop: `1px solid ${C.panel}` }}>
                <td style={{ padding: 6 }}>{f.nombre}{f.negocio ? ` · ${f.negocio}` : ''} <span style={{ color: C.muted }}>({TIPO_MIEMBRO_LABEL[f.tipo] ?? f.tipo}{f.estado === 'baja' ? ', de baja' : ''})</span></td>
                <td style={{ padding: 6 }}>{fmtCreditos(f.creditos)}</td>
                <td style={{ padding: 6 }}>{fmtFecha(f.vence_en)}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ReporteVista({ id, apertura }: { id: string; apertura: string }) {
  const [r, setR] = useState<ReporteCampana | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    getReporteCampana(id, apertura).then(x => { if (vivo) setR(x) }).catch(e => { if (vivo) setError(aClubError(e).message) })
    return () => { vivo = false }
  }, [id, apertura])
  if (error) return <Aviso tono="error">{error}</Aviso>
  if (!r) return <div style={{ color: C.muted, marginTop: 8 }}>Cargando…</div>
  const aviso = avisoNoConcluyente(r)
  return (
    <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
      <div style={{ fontSize: '0.85rem', color: C.muted }}>
        Cada uno se mide 30 días desde que entró a la campaña (hora de Costa Rica), en este local.
        {r.cerrado ? ' Ventana cerrada.' : ` Parcial: la ventana sigue abierta${r.ventana_hasta ? ` hasta el ${fmtFecha(r.ventana_hasta)}` : ''}.`}
        {' '}Venta respaldada: facturas cerradas de sus visitas, neta menos regalía; una factura cuenta una vez por grupo.
      </div>
      {aviso && <Aviso tono="info">{aviso}</Aviso>}
      {r.pos_sin_datos && <Aviso tono="info">Este local no tiene facturas del PoS desde que arrancó la campaña: la venta sale en cero.</Aviso>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <thead><tr style={{ textAlign: 'left', color: C.muted }}>
          <th style={{ padding: 6 }}></th><th style={{ padding: 6 }}>Con oferta</th><th style={{ padding: 6 }}>Reservados</th>
        </tr></thead>
        <tbody>{filasReporte(r).map(([t, a, b]) => (
          <tr key={t} style={{ borderTop: `1px solid ${C.panel}` }}>
            <td style={{ padding: 6, color: C.muted }}>{t}</td><td style={{ padding: 6 }}>{a}</td><td style={{ padding: 6 }}>{b}</td>
          </tr>))}
        </tbody>
      </table>
      <div style={{ fontSize: '0.8rem', color: C.muted }}>{REGLA_BENEFICIO_BASE}</div>
    </div>
  )
}
