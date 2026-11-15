/**
 * Club → Ranking de socios por consumo (SPEC Club v2, ítem 7; mig 161). Solo owner y manager. Por socio: visitas,
 * venta respaldada (la de la mesa; una factura cuenta una vez), tiquete promedio, invitados (857), descuento estimado
 * y última visita. Ordenable; filtro por local y período (días CR). Sin teléfonos ni correos (la base no los manda).
 * Abrirlo y exportarlo quedan en club_auditoria: una fila por apertura de la pantalla (un id por apertura; los cambios
 * de filtro no dejan otra) y una por cada exporte. El CSV sale de una llamada aparte con `exporte`, no de lo que está
 * en pantalla. Los filtros esperan medio segundo (escribir una fecha no dispara una consulta por tecla).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { getRanking, getLocalesClub, localActual, nuevaApertura, aClubError, type LocalClub, type Ranking as TRanking } from '../../shared/api/club'
import { todayCR } from '../../shared/utils'
import { Aviso, Btn, Card } from './ui'
import { C, fmtFecha, inputStyle, labelStyle } from './estilos'
import { crcTxt, numTxt, ordenar, periodo, periodoValido, rankingCsv, type Columna, type Preset } from './cohortesFormato'

const COLS: Array<{ c: Columna; t: string; izq?: boolean }> = [
  { c: 'nombre', t: 'Socio', izq: true }, { c: 'visitas', t: 'Visitas' }, { c: 'venta_respaldada_crc', t: 'Venta respaldada' },
  { c: 'tiquete_promedio_crc', t: 'Tiquete promedio' }, { c: 'invitados', t: 'Invitados' },
  { c: 'descuento_estimado_crc', t: 'Descuento (estimado)' }, { c: 'ultima_visita', t: 'Última visita' },
]
const DEBOUNCE_MS = 500
const td: React.CSSProperties = { textAlign: 'right', padding: '6px', borderTop: `1px solid ${C.border}`, whiteSpace: 'nowrap' }

export default function Ranking() {
  const inicial = periodo('90', todayCR())
  const [desde, setDesde] = useState(inicial.desde)
  const [hasta, setHasta] = useState(inicial.hasta)
  const [local, setLocal] = useState<string>(localActual() ?? '')
  const [locales, setLocales] = useState<LocalClub[]>([])
  const [r, setR] = useState<TRanking | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [col, setCol] = useState<Columna>('venta_respaldada_crc')
  const [asc, setAsc] = useState(false)
  const invalido = periodoValido(desde, hasta)
  const [apertura] = useState(nuevaApertura)
  const primera = useRef(true)

  useEffect(() => { getLocalesClub().then(setLocales).catch(() => {}) }, [])
  useEffect(() => {
    if (invalido) return
    let vivo = true
    // la primera carga va directo; un cambio de filtro espera 500 ms (debounce)
    const espera = primera.current ? 0 : DEBOUNCE_MS
    primera.current = false
    const t = setTimeout(() => {
      setCargando(true); setError(null)
      getRanking(desde, hasta, local || null, false, apertura)
        .then(x => { if (vivo) setR(x) })
        .catch(e => { if (vivo) { setR(null); setError(aClubError(e).message) } })
        .finally(() => { if (vivo) setCargando(false) })
    }, espera)
    return () => { vivo = false; clearTimeout(t) }
  }, [desde, hasta, local, invalido, apertura])

  const filas = useMemo(() => (r ? ordenar(r.socios, col, asc) : []), [r, col, asc])

  function elegir(p: Preset) { const x = periodo(p, todayCR()); setDesde(x.desde); setHasta(x.hasta) }
  function ordenarPor(c: Columna) {
    if (c === col) setAsc(a => !a)
    else { setCol(c); setAsc(c === 'nombre') }
  }
  async function exportarCsv() {
    if (invalido) return
    let datos: TRanking
    // el exporte lo entrega la base (y lo audita); se ordena igual que en pantalla
    try { datos = await getRanking(desde, hasta, local || null, true, apertura) } catch (e) { setError(aClubError(e).message); return }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([rankingCsv(datos, ordenar(datos.socios, col, asc))], { type: 'text/csv;charset=utf-8' }))
    a.download = `club-ranking-socios-${local || 'todos'}-${datos.desde}-${datos.hasta}.csv`
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  return (
    <div className="tips-body" style={{ maxWidth: 1000, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <Card style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'end' }}>
        <label><span style={labelStyle}>Desde</span><input type="date" aria-label="Desde" value={desde} onChange={e => setDesde(e.target.value)} style={inputStyle} /></label>
        <label><span style={labelStyle}>Hasta</span><input type="date" aria-label="Hasta" value={hasta} onChange={e => setHasta(e.target.value)} style={inputStyle} /></label>
        <label><span style={labelStyle}>Local</span>
          <select aria-label="Local" value={local} onChange={e => setLocal(e.target.value)} style={inputStyle}>
            <option value="">Todos mis locales</option>
            {locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </label>
        <Btn variant="secondary" onClick={() => void exportarCsv()} disabled={!r || !!invalido}>Exportar CSV</Btn>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', gridColumn: '1 / -1' }}>
          <Btn variant="ghost" onClick={() => elegir('mes')}>Este mes</Btn>
          <Btn variant="ghost" onClick={() => elegir('90')}>Últimos 90 días</Btn>
          <Btn variant="ghost" onClick={() => elegir('anio')}>Este año</Btn>
        </div>
      </Card>
      {invalido && <Aviso tono="info">{invalido}</Aviso>}
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      {r && r.locales_sin_pos.length > 0 && !cargando && (
        <Aviso tono="info">
          Sin facturas del PoS en el período: {r.locales_sin_pos.join(', ')}. Ahí la venta, el tiquete y el descuento salen en cero
          (las visitas sí se cuentan).
        </Aviso>
      )}
      {cargando && <div style={{ textAlign: 'center', color: C.muted, padding: '2rem' }}>Armando el ranking…</div>}
      {r && !cargando && !invalido && (
        <Card>
          <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem' }}>Ranking de socios por consumo</h3>
          <p style={{ margin: '0 0 10px', color: C.ink }} data-testid="resumen">
            {r.totales.socios === 0
              ? 'Todavía no hay socios del Local Club en este local.'
              : r.totales.visitas === 0
                ? `${numTxt(r.totales.socios)} socios · ninguna visita registrada en el período.`
                : `${numTxt(r.totales.socios_con_visita)} de ${numTxt(r.totales.socios)} socios vinieron · ${numTxt(r.totales.visitas)} visitas · ${crcTxt(r.totales.venta_respaldada_crc)} de venta respaldada en ${numTxt(r.totales.facturas)} facturas`}
          </p>
          {filas.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead><tr style={{ color: C.muted }}>
                  {COLS.map(k => (
                    <th key={k.c} style={{ textAlign: k.izq ? 'left' : 'right', padding: '4px 6px' }}
                        aria-sort={col === k.c ? (asc ? 'ascending' : 'descending') : 'none'}>
                      <button onClick={() => ordenarPor(k.c)}
                        style={{ background: 'none', border: 'none', color: 'inherit', fontWeight: 700, cursor: 'pointer', padding: 0, font: 'inherit' }}>
                        {k.t}{col === k.c ? (asc ? ' ▲' : ' ▼') : ''}
                      </button>
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {filas.map(s => (
                    <tr key={s.id} data-testid="fila-socio">
                      <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>
                        {s.nombre}{s.estado === 'baja' && <span style={{ color: C.muted }}> (de baja)</span>}
                        {r.locales.length > 1 && <div style={{ color: C.muted, fontSize: '0.75rem' }}>alta en {s.local_alta}</div>}
                      </td>
                      <td style={td}>{numTxt(s.visitas)}</td>
                      <td style={td}>{crcTxt(s.venta_respaldada_crc)}</td>
                      <td style={td}>{crcTxt(s.tiquete_promedio_crc)}</td>
                      <td style={td}>{numTxt(s.invitados)}</td>
                      <td style={td}>{crcTxt(s.descuento_estimado_crc)}</td>
                      <td style={td}>{fmtFecha(s.ultima_visita)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr style={{ fontWeight: 700 }}>
                  <td style={{ ...td, textAlign: 'left' }}>Total (cada factura una vez)</td>
                  <td style={td}>{numTxt(r.totales.visitas)}</td>
                  <td style={td}>{crcTxt(r.totales.venta_respaldada_crc)}</td>
                  <td style={td}></td>
                  <td style={td}>{numTxt(r.totales.invitados)}</td>
                  <td style={td}>{crcTxt(r.totales.descuento_estimado_crc)}</td>
                  <td style={td}></td>
                </tr></tfoot>
              </table>
            </div>
          )}
          <div style={{ color: C.muted, fontSize: '0.8rem', marginTop: 8, lineHeight: 1.4 }}>
            Venta respaldada = la venta neta de la mesa del socio (facturas cerradas que cruzan con su visita). Si dos socios
            comparten mesa, la factura sale en los dos; el total la cuenta una vez. Tiquete = venta ÷ mesas. Invitados = artículo
            INVITADO del Local Club. El PoS manda el descuento en cero: se estima línea por línea contra el precio más vendido de
            los 30 días anteriores{r.totales.lineas_sin_referencia > 0 ? ` (${numTxt(r.totales.lineas_sin_referencia)} líneas sin precio de referencia no se estiman)` : ''}.
            Abrir y exportar este ranking queda registrado.
          </div>
        </Card>
      )}
    </div>
  )
}
