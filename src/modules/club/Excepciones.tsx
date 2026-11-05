/**
 * Excepciones del puente (manager, owner). Lista por tipo y fecha, detalle con la factura del
 * puente y «resolver con nota». Resolver no toca el libro: para corregir saldos se usa un ajuste.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getExcepciones, resolverExcepcion, aClubError, fmtCreditos, type Excepcion, type TipoExcepcion } from '../../shared/api/club'
import { Aviso, Btn, Card, Chip } from './ui'
import { C, inputStyle, labelStyle, fmtFechaHora } from './estilos'

const TIPO_EXC: Record<TipoExcepcion, { titulo: string; que: string }> = {
  REGISTRO_SIN_FACTURA: { titulo: 'Registro sin factura', que: 'Cupón, tarjeta o canje con un número de factura que no está en el PoS.' },
  CREDITOS_SIN_CANJE:   { titulo: 'Créditos sin canje',   que: 'Factura pagada «a crédito» por un múltiplo de medio crédito, sin canje en el Club.' },
  CANJE_MONTO_DISTINTO: { titulo: 'Canje con monto distinto', que: 'El valor del canje no coincide con lo cobrado «a crédito» en la factura.' },
  PROMO_SIN_CUPON:      { titulo: 'Promo sin cupón',      que: 'Factura con el artículo de la promo 10 % y sin cupón ni tarjeta registrada.' },
}
const crc = (n: unknown) => (typeof n === 'number' || typeof n === 'string') && n !== '' ? `₡${Number(n).toLocaleString('de-DE', { maximumFractionDigits: 0 })}` : '—'
const hoyCR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' })
const haceDias = (d: number) => { const t = new Date(); t.setDate(t.getDate() - d); return t.toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' }) }

export default function Excepciones() {
  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(hoyCR())
  const [tipo, setTipo] = useState<'' | TipoExcepcion>('')
  const [verResueltas, setVerResueltas] = useState(false)
  const [lista, setLista] = useState<Excepcion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setError(null)
    try { setLista(await getExcepciones(desde, hasta)) }
    catch (e) { setError(aClubError(e).message); setLista([]) }
  }, [desde, hasta])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar() }, [cargar])

  const filtradas = useMemo(() => (lista ?? [])
    .filter(e => !tipo || e.tipo === tipo)
    .filter(e => verResueltas || !e.resuelta), [lista, tipo, verResueltas])
  const conteo = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of lista ?? []) if (!e.resuelta) c[e.tipo] = (c[e.tipo] ?? 0) + 1
    return c
  }, [lista])

  return (
    <div className="tips-body" style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      <Card style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <label><span style={labelStyle}>Desde</span><input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={inputStyle} /></label>
        <label><span style={labelStyle}>Hasta</span><input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={inputStyle} /></label>
        <label><span style={labelStyle}>Tipo</span>
          <select value={tipo} onChange={e => setTipo(e.target.value as '' | TipoExcepcion)} style={inputStyle}>
            <option value="">Todos</option>
            {(Object.keys(TIPO_EXC) as TipoExcepcion[]).map(k => <option key={k} value={k}>{TIPO_EXC[k].titulo} ({conteo[k] ?? 0})</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', alignSelf: 'end', minHeight: 44 }}>
          <input type="checkbox" checked={verResueltas} onChange={e => setVerResueltas(e.target.checked)} /> Ver resueltas
        </label>
      </Card>
      <div style={{ fontSize: '0.8rem', color: C.muted }}>
        «Probable»: el PoS no trae el nombre «CREDITOS NUEVO», así que se infiere por el monto «a crédito» (múltiplo de medio crédito).
      </div>

      {lista === null ? <div style={{ textAlign: 'center', color: C.muted, padding: '2rem' }}>Cargando…</div> :
        filtradas.length === 0 ? <div style={{ textAlign: 'center', color: C.muted, padding: '2rem' }}>Sin excepciones abiertas en el período.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtradas.map(e => {
              const id = `${e.tipo}|${e.ref}`
              return (
                <div key={id} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8 }}>
                  <button onClick={() => setAbierta(abierta === id ? null : id)} aria-expanded={abierta === id}
                    style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '0.7rem 0.8rem', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>{TIPO_EXC[e.tipo].titulo}</strong>
                      <Chip color={e.certeza === 'probable' ? C.gold : C.ink}>{e.certeza}</Chip>
                      {e.resuelta && <Chip color={C.teal}>resuelta</Chip>}
                      <span style={{ marginLeft: 'auto', color: C.muted, fontSize: '0.85rem' }}>{fmtFechaHora(e.fecha)}</span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: C.muted, marginTop: 2 }}>
                      Factura {e.factura ?? '—'}{typeof e.detalle.miembro === 'string' ? ` · ${e.detalle.miembro}` : ''}
                    </div>
                  </button>
                  {abierta === id && <Detalle e={e} onResuelta={cargar} />}
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}

function Detalle({ e, onResuelta }: { e: Excepcion; onResuelta: () => Promise<void> }) {
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const d = e.detalle
  const filas: Array<[string, string]> = [
    ['Qué es', TIPO_EXC[e.tipo].que],
    ['Factura (PoS)', e.factura ?? '—'],
    ...(d.movimiento ? [['Registro en el Club', String(d.movimiento).replace('_', ' ')] as [string, string]] : []),
    ...(d.personas != null ? [['Personas', String(d.personas)] as [string, string]] : []),
    ...(d.creditos != null ? [['Créditos', fmtCreditos(Number(d.creditos))] as [string, string]] : []),
    ...(d.creditos_estimados != null ? [['Créditos estimados', fmtCreditos(Number(d.creditos_estimados))] as [string, string]] : []),
    ...(d.cxc_crc != null ? [['Cobrado «a crédito»', crc(d.cxc_crc)] as [string, string]] : []),
    ...(d.canje_crc != null ? [['Valor del canje', crc(d.canje_crc)] as [string, string]] : []),
    ...(d.diferencia_crc != null ? [['Diferencia', crc(d.diferencia_crc)] as [string, string]] : []),
    ...(d.total_crc != null ? [['Total de la factura', crc(d.total_crc)] as [string, string]] : []),
  ]
  async function resolver() {
    setEnviando(true); setError(null)
    try { await resolverExcepcion(e.tipo, e.ref, nota); await onResuelta() }
    catch (err) { setError(aClubError(err).message) }
    finally { setEnviando(false) }
  }
  return (
    <div style={{ borderTop: `1px solid ${C.panel}`, padding: '0.7rem 0.8rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, max-content) 1fr', gap: '4px 12px', margin: 0, fontSize: '0.88rem' }}>
        {filas.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt style={{ color: C.muted }}>{k}</dt><dd style={{ margin: 0 }}>{v}</dd></div>)}
      </dl>
      {e.resuelta ? (
        <Aviso tono="ok">Resuelta el {fmtFechaHora(e.resuelta_en)}: {e.nota}</Aviso>
      ) : (
        <>
          {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
          <label><span style={labelStyle}>Nota para resolver</span>
            <textarea value={nota} onChange={ev => setNota(ev.target.value)} rows={2} maxLength={500}
              placeholder="Qué pasó y qué se hizo (si hay que corregir saldo, se hace con un ajuste)" style={{ ...inputStyle, resize: 'vertical' }} />
          </label>
          <Btn onClick={resolver} disabled={enviando || !nota.trim()}>{enviando ? 'Guardando…' : 'Resolver con nota'}</Btn>
        </>
      )}
    </div>
  )
}
