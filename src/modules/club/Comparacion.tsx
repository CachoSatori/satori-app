/**
 * Comparación con la página vieja (piloto interno en paralelo, decisión de Ismael 07-nov).
 * Por referente y por semana (lunes, hora CR): personas cargadas en staging al lado de las de la página vieja,
 * que se pegan acá (referente;semana;personas) o llegan de un export. Sin datos de contacto. owner y manager.
 */
import { useCallback, useEffect, useState } from 'react'
import { getComparacion, cargarComparacion, aClubError, type FilaComparacion } from '../../shared/api/club'
import { Aviso, Btn, Card } from './ui'
import { C, inputStyle, labelStyle } from './estilos'
import { parsearPegado } from './comparacionPegado'

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' })
const haceDias = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' }) }
const fmtSemana = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })

export default function Comparacion() {
  const [desde, setDesde] = useState(haceDias(27))
  const [hasta, setHasta] = useState(hoy())
  const [filas, setFilas] = useState<FilaComparacion[] | null>(null)
  const [pegado, setPegado] = useState('')
  const [msg, setMsg] = useState<{ tono: 'ok' | 'error'; t: string } | null>(null)
  const [cargando, setCargando] = useState(false)

  const cargar = useCallback(() => {
    setFilas(null)
    getComparacion(desde, hasta).then(setFilas).catch(e => { setFilas([]); setMsg({ tono: 'error', t: aClubError(e).message }) })
  }, [desde, hasta])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar() }, [cargar])

  async function subir() {
    const datos = parsearPegado(pegado)
    if (!datos.length) { setMsg({ tono: 'error', t: 'No reconozco ninguna línea. Formato: referente;AAAA-MM-DD;personas' }); return }
    setCargando(true); setMsg(null)
    try {
      const r = await cargarComparacion(datos)
      const faltan = r.no_encontrados.map(x => `${x.referente ?? '—'} (${x.motivo})`).join(', ')
      setMsg({ tono: faltan ? 'error' : 'ok', t: `Cargadas ${r.cargadas}.${faltan ? ` Sin cargar: ${faltan}.` : ''}` })
      setPegado(''); cargar()
    } catch (e) { setMsg({ tono: 'error', t: aClubError(e).message }) }
    finally { setCargando(false) }
  }

  const tot = (filas ?? []).reduce((a, f) => ({ st: a.st + f.personas_staging, vi: a.vi + (f.personas_vieja ?? 0) }), { st: 0, vi: 0 })
  return (
    <Card>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Comparación con la página vieja</div>
      <div style={{ fontSize: '0.82rem', color: C.muted, marginBottom: 8 }}>
        Piloto en paralelo: personas por referente y por semana, cargadas en el Club (cupones y tarjeta física) y en la página vieja.
      </div>
      {msg && <Aviso tono={msg.tono} onClose={() => setMsg(null)}>{msg.t}</Aviso>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <label><span style={labelStyle}>Desde</span><input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={inputStyle} /></label>
        <label><span style={labelStyle}>Hasta</span><input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={inputStyle} /></label>
      </div>
      {filas === null ? <div style={{ color: C.muted, padding: '1rem 0' }}>Cargando…</div> : filas.length === 0 ? (
        <div style={{ color: C.muted, padding: '1rem 0' }}>Sin personas en el período.</div>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr style={{ textAlign: 'left', color: C.muted }}>
              <th style={{ padding: 6 }}>Semana</th><th style={{ padding: 6 }}>Referente</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Club</th><th style={{ padding: 6, textAlign: 'right' }}>Página vieja</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Diferencia</th>
            </tr></thead>
            <tbody>
              {filas.map(f => (
                <tr key={`${f.semana}|${f.miembro_id}`} style={{ borderTop: `1px solid ${C.panel}` }}>
                  <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{fmtSemana(f.semana)}</td>
                  <td style={{ padding: 6 }}>{f.referente}{f.negocio ? <span style={{ color: C.muted }}> · {f.negocio}</span> : null}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{f.personas_staging}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{f.personas_vieja ?? '—'}</td>
                  <td style={{ padding: 6, textAlign: 'right', fontWeight: 700, color: f.personas_vieja == null ? C.muted : f.diferencia === 0 ? C.teal : C.red }}>
                    {f.personas_vieja == null ? '—' : f.diferencia > 0 ? `+${f.diferencia}` : f.diferencia}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: `2px solid ${C.border}`, fontWeight: 700 }}>
                <td style={{ padding: 6 }} colSpan={2}>Total</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{tot.st}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{tot.vi}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{tot.st - tot.vi > 0 ? `+${tot.st - tot.vi}` : tot.st - tot.vi}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <label style={{ display: 'block', marginTop: 12 }}>
        <span style={labelStyle}>Pegar las de la página vieja (una por línea: referente;AAAA-MM-DD;personas)</span>
        <textarea value={pegado} onChange={e => setPegado(e.target.value)} rows={3} placeholder="Nombre del referente;2026-11-02;7"
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace' }} />
      </label>
      <Btn onClick={subir} disabled={cargando || !pegado.trim()} style={{ marginTop: 8 }}>{cargando ? 'Cargando…' : 'Cargar'}</Btn>
    </Card>
  )
}
