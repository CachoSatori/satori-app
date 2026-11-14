/**
 * Club → Embudo del anfitrión (SPEC Club v2, ítem 8; mig 162). Solo owner y manager. Por anfitrión, mes (hora CR) y local:
 * cupones generados → usados → (clic en reseña, si la base tiene la 158) → con factura → personas → venta respaldada →
 * tiquete promedio, con el % entre pasos. El equipo (desempeño) va aparte de referentes y concierges.
 * «QR visto» no se guarda en la base: no se muestra (lo dice la pantalla). Abrir y exportar quedan en club_auditoria:
 * el CSV sale de una llamada aparte con `exporte`, no de lo que está en pantalla.
 */
import { useEffect, useState } from 'react'
import { getEmbudoAnfitrion, getLocalesClub, localActual, aClubError, type AnfitrionEmbudo, type Embudo as TEmbudo,
  type GrupoEmbudo, type LocalClub } from '../../shared/api/club'
import { Aviso, Btn, Card } from './ui'
import { C, inputStyle, labelStyle, mesActualCR } from './estilos'
import { crcTxt, embudoCsv, numTxt, pasos, pctTxt, resumenVacio, tipoTxt } from './embudoFormato'

const td: React.CSSProperties = { textAlign: 'right', padding: '6px', borderTop: `1px solid ${C.border}`, whiteSpace: 'nowrap' }
const pctChico = (p: number | null) => <span style={{ color: C.muted, fontSize: '0.75rem' }}> {pctTxt(p)}</span>

function Tiras({ g, resena }: { g: GrupoEmbudo; resena: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6 }} data-testid="pasos">
      {pasos(g, resena).map((p, i) => (
        <div key={p.clave} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px', background: '#fff' }}>
          <div style={{ ...labelStyle, marginBottom: 2 }}>{i > 0 ? '→ ' : ''}{p.titulo}</div>
          <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{p.valor}</div>
          {p.pct != null && <div style={{ color: C.teal, fontSize: '0.78rem' }}>{pctTxt(p.pct)} del paso anterior</div>}
          {p.nota && <div style={{ color: C.muted, fontSize: '0.75rem' }}>{p.nota}</div>}
        </div>
      ))}
    </div>
  )
}

function Tabla({ filas, resena, varios }: { filas: AnfitrionEmbudo[]; resena: boolean; varios: boolean }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
        <thead><tr style={{ color: C.muted }}>
          <th style={{ textAlign: 'left', padding: '4px 6px' }}>Anfitrión</th>
          <th style={{ textAlign: 'right', padding: '4px 6px' }}>Generados</th>
          <th style={{ textAlign: 'right', padding: '4px 6px' }}>Usados</th>
          {resena && <th style={{ textAlign: 'right', padding: '4px 6px' }}>Clic en reseña</th>}
          <th style={{ textAlign: 'right', padding: '4px 6px' }}>Con factura</th>
          <th style={{ textAlign: 'right', padding: '4px 6px' }}>Personas</th>
          <th style={{ textAlign: 'right', padding: '4px 6px' }}>Venta respaldada</th>
          <th style={{ textAlign: 'right', padding: '4px 6px' }}>Tiquete promedio</th>
        </tr></thead>
        <tbody>
          {filas.map(a => (
            <tr key={a.id} data-testid="fila-anfitrion">
              <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>
                {a.nombre}{a.estado === 'baja' && <span style={{ color: C.muted }}> (de baja)</span>}
                <div style={{ color: C.muted, fontSize: '0.75rem' }}>{tipoTxt(a.tipo)}{varios ? ` · ${a.local}` : ''}</div>
              </td>
              <td style={td}>{numTxt(a.generados)}</td>
              <td style={td}>{numTxt(a.usados)}{pctChico(a.pct_uso)}</td>
              {resena && <td style={td}>{numTxt(a.clics_resena ?? 0)}{pctChico(a.pct_resena)}</td>}
              <td style={td}>{numTxt(a.con_factura)}{pctChico(a.pct_con_factura)}</td>
              <td style={td}>{numTxt(a.personas)}</td>
              <td style={td}>{crcTxt(a.venta_respaldada_crc)}</td>
              <td style={td}>{crcTxt(a.tiquete_promedio_crc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Embudo() {
  const [mes, setMes] = useState(mesActualCR())
  const [local, setLocal] = useState<string>(localActual() ?? '')
  const [locales, setLocales] = useState<LocalClub[]>([])
  const [r, setR] = useState<TEmbudo | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { getLocalesClub().then(setLocales).catch(() => {}) }, [])
  useEffect(() => {
    let vivo = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCargando(true); setError(null)
    getEmbudoAnfitrion(mes, local || null)
      .then(x => { if (vivo) setR(x) })
      .catch(e => { if (vivo) { setR(null); setError(aClubError(e).message) } })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [mes, local])

  async function exportarCsv() {
    let datos: TEmbudo
    // el exporte lo entrega la base (y lo audita)
    try { datos = await getEmbudoAnfitrion(mes, local || null, true) } catch (e) { setError(aClubError(e).message); return }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([embudoCsv(datos)], { type: 'text/csv;charset=utf-8' }))
    a.download = `club-embudo-anfitrion-${local || 'todos'}-${datos.mes}.csv`
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  const vacio = r ? resumenVacio(r) : null
  const equipo = r ? r.anfitriones.filter(a => a.grupo === 'equipo') : []
  const resto = r ? r.anfitriones.filter(a => a.grupo !== 'equipo') : []
  const varios = (r?.locales.length ?? 0) > 1

  return (
    <div className="tips-body" style={{ maxWidth: 1000, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <Card style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'end' }}>
        <label><span style={labelStyle}>Mes</span>
          <input type="month" aria-label="Mes" value={mes} onChange={e => e.target.value && setMes(e.target.value)} style={inputStyle} />
        </label>
        <label><span style={labelStyle}>Local</span>
          <select aria-label="Local" value={local} onChange={e => setLocal(e.target.value)} style={inputStyle}>
            <option value="">Todos mis locales</option>
            {locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </label>
        <Btn variant="secondary" onClick={() => void exportarCsv()} disabled={!r}>Exportar CSV</Btn>
      </Card>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      {r && r.locales_sin_pos.length > 0 && !cargando && (
        <Aviso tono="info">
          Sin facturas del PoS en el mes: {r.locales_sin_pos.join(', ')}. Ahí los cupones y las personas se cuentan, pero la
          venta y el tiquete salen en cero.
        </Aviso>
      )}
      {r && r.mes_en_curso && !cargando && r.totales.vigentes > 0 && (
        <Aviso tono="info">
          Mes en curso: {numTxt(r.totales.vigentes)} cupones siguen vigentes y todavía pueden usarse; el % de uso va a subir.
        </Aviso>
      )}
      {cargando && <div style={{ textAlign: 'center', color: C.muted, padding: '2rem' }}>Armando el embudo…</div>}
      {r && !cargando && (
        <Card>
          <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem' }}>Embudo del anfitrión</h3>
          {vacio
            ? <p style={{ margin: '0 0 10px', color: C.ink }} data-testid="vacio">{vacio}</p>
            : <>
                <p style={{ margin: '0 0 8px', color: C.ink }} data-testid="resumen">
                  {numTxt(r.totales.anfitriones)} anfitriones con cupones · {numTxt(r.totales.sin_cupones)} activos sin cupones en el mes
                </p>
                <Tiras g={r.totales} resena={r.resena_disponible} />
              </>}
          {!vacio && (equipo.length > 0 || r.grupos.equipo.sin_cupones > 0) && (
            <section style={{ marginTop: 14 }} data-testid="grupo-equipo">
              <h4 style={{ margin: '0 0 2px' }}>Equipo · desempeño</h4>
              <p style={{ margin: '0 0 6px', color: C.muted, fontSize: '0.8rem' }}>
                El equipo registra personas para medir su desempeño{r.d7 ? ' y no gana créditos' : ''}.
                {r.grupos.equipo.sin_cupones > 0 ? ` ${numTxt(r.grupos.equipo.sin_cupones)} del equipo sin cupones en el mes.` : ''}
              </p>
              {equipo.length > 0 && <><Tiras g={r.grupos.equipo} resena={r.resena_disponible} /><div style={{ height: 8 }} />
                <Tabla filas={equipo} resena={r.resena_disponible} varios={varios} /></>}
            </section>
          )}
          {!vacio && resto.length > 0 && (
            <section style={{ marginTop: 14 }} data-testid="grupo-anfitrion">
              <h4 style={{ margin: '0 0 6px' }}>Referentes y concierges</h4>
              <Tiras g={r.grupos.anfitrion} resena={r.resena_disponible} /><div style={{ height: 8 }} />
              <Tabla filas={resto} resena={r.resena_disponible} varios={varios} />
            </section>
          )}
          <div style={{ color: C.muted, fontSize: '0.8rem', marginTop: 10, lineHeight: 1.4 }}>
            Se cuentan los cupones GENERADOS en el mes (hora de Costa Rica) y qué pasó con ellos, aunque se usaran el mes
            siguiente. «QR visto» no se guarda: el embudo arranca en el cupón generado. Con factura = cupón usado con factura
            cerrada (una anulada no cuenta). Venta respaldada = venta neta de la mesa menos lo regalado en el PoS; si dos
            anfitriones comparten mesa, la factura sale en los dos y el total la cuenta una vez. Tiquete = venta ÷ mesas.
            {r.resena_disponible ? ' Clic en reseña = el turista tocó «Escribir una reseña» después de usar su cupón.' : ''}
            {' '}Abrir y exportar este embudo queda registrado.
          </div>
        </Card>
      )}
    </div>
  )
}
