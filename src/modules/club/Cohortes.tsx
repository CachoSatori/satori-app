/**
 * Club → Cohortes (SPEC Club v2, ítem 6; mig 161): socios del Local Club por mes de alta (hora CR): con 2.ª y 4.ª
 * visita, activos a 30/60/90 días y visitas por socio. owner y manager (en la base también el contador: solo conteos).
 * Una celda que todavía no puede medirse dice «aún no», nunca 0. Abrir la pantalla deja una fila en club_auditoria.
 */
import { useEffect, useState } from 'react'
import { getCohortes, getLocalesClub, localActual, nuevaApertura, aClubError, type Cohortes as TCohortes, type LocalClub } from '../../shared/api/club'
import { Aviso, Card } from './ui'
import { C, inputStyle, labelStyle } from './estilos'
import { celdaCohorte, mesTxt, numTxt } from './cohortesFormato'

const th: React.CSSProperties = { textAlign: 'right', padding: '4px 6px', fontWeight: 700 }
const td: React.CSSProperties = { textAlign: 'right', padding: '6px', borderTop: `1px solid ${C.border}` }

export default function Cohortes() {
  const [local, setLocal] = useState<string>(localActual() ?? '')
  const [locales, setLocales] = useState<LocalClub[]>([])
  const [c, setC] = useState<TCohortes | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // un id por apertura de la pantalla: la base deja UNA fila de rastro aunque se cambie el local
  const [apertura] = useState(nuevaApertura)

  useEffect(() => { getLocalesClub().then(setLocales).catch(() => {}) }, [])
  useEffect(() => {
    let vivo = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCargando(true); setError(null)
    getCohortes(local || null, apertura)
      .then(r => { if (vivo) setC(r) })
      .catch(e => { if (vivo) { setC(null); setError(aClubError(e).message) } })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [local, apertura])

  return (
    <div className="tips-body" style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <Card style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, alignItems: 'end' }}>
        <label><span style={labelStyle}>Local del alta</span>
          <select aria-label="Local" value={local} onChange={e => setLocal(e.target.value)} style={inputStyle}>
            <option value="">Todos mis locales</option>
            {locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </label>
      </Card>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      {cargando && <div style={{ textAlign: 'center', color: C.muted, padding: '2rem' }}>Armando las cohortes…</div>}
      {c && !cargando && (
        <Card>
          <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem' }}>Cohortes del Local Club</h3>
          <p style={{ margin: '0 0 10px', color: C.ink }} data-testid="resumen">
            {c.totales.socios === 0
              ? 'Todavía no hay socios del Local Club en este local.'
              : `${numTxt(c.totales.socios)} socios · ${numTxt(c.totales.con_2)} con 2.ª visita · ${numTxt(c.totales.con_4)} con 4.ª visita · ${numTxt(c.totales.visitas_por_socio, 1)} visitas por socio`}
          </p>
          {c.cohortes.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead><tr style={{ color: C.muted }}>
                  <th style={{ ...th, textAlign: 'left' }}>Mes de alta</th><th style={th}>Socios</th>
                  <th style={th}>Con 2.ª visita</th><th style={th}>Con 4.ª visita</th>
                  <th style={th}>Activos a 30 días</th><th style={th}>A 60 días</th><th style={th}>A 90 días</th>
                  <th style={th}>Visitas por socio</th>
                </tr></thead>
                <tbody>
                  {c.cohortes.map(k => (
                    <tr key={k.mes} data-testid={`cohorte-${k.mes}`}>
                      <td style={{ ...td, textAlign: 'left' }}>{mesTxt(k.mes)}</td>
                      <td style={td}>{numTxt(k.socios)}{k.bajas > 0 && <span style={{ color: C.muted }}> ({numTxt(k.bajas)} de baja)</span>}</td>
                      <td style={td}>{celdaCohorte(k.con_2, k.socios)}</td>
                      <td style={td}>{celdaCohorte(k.con_4, k.socios)}</td>
                      <td style={td}>{celdaCohorte(k.activos_30, k.socios)}</td>
                      <td style={td}>{celdaCohorte(k.activos_60, k.socios)}</td>
                      <td style={td}>{celdaCohorte(k.activos_90, k.socios)}</td>
                      <td style={td}>{numTxt(k.visitas_por_socio, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ color: C.muted, fontSize: '0.8rem', marginTop: 8, lineHeight: 1.4 }}>
            Mes de alta en hora de Costa Rica. Visitas registradas en cualquier local desde el alta (el alta sola no es una visita).
            «Activos a 30 días» = volvió entre el día 1 y el 30 después del alta (a 60: del 31 al 60; a 90: del 61 al 90).
            «Aún no» = la ventana todavía no se cerró para todos los socios de ese mes. Los de baja siguen contando en su mes.
          </div>
        </Card>
      )}
    </div>
  )
}
