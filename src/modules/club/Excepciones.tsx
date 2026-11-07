/**
 * Excepciones del puente (manager, owner). Lista por tipo y fecha, detalle con la factura del
 * puente y «resolver con nota». Resolver no toca el libro: para corregir saldos se usa un ajuste.
 * SIN_CRUCE (registro con pedido que no encontró su factura: posible cuenta dividida o refactura):
 * el manager elige la factura de la lista de facturas sin pedido de ese día; queda anotado quién.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getExcepciones, resolverExcepcion, aClubError, fmtCreditos, getCandidatasSinCruce, elegirFacturaSinCruce, describirFactura,
  type Excepcion, type TipoExcepcion, type FacturaCandidata,
} from '../../shared/api/club'
import { Aviso, Btn, Card, Chip } from './ui'
import { C, inputStyle, labelStyle, fmtFechaHora } from './estilos'
import { useAuth } from '../../shared/hooks/useAuth'

const TIPO_EXC: Record<TipoExcepcion, { titulo: string; que: string }> = {
  SIN_CRUCE:            { titulo: 'Sin cruce: posible cuenta dividida', que: 'Registro con pedido que no encontró la factura de su pedido (anulada, refacturada o cobrada solo en facturas sin pedido). Elegí la factura de la lista o buscala por los últimos dígitos del tiquete.' },
  AMBIGUA:              { titulo: 'Factura ambigua', que: 'Factura sin pedido de una mesa que cae en la ventana de dos pedidos de esa misma mesa: no se asignó a ninguno. Revisá a cuál corresponde y resolvé con nota.' },
  VISITA_REPETIDA:      { titulo: 'Visita repetida', que: 'El mismo referente tiene más de una tarjeta en la misma visita (misma factura). Solo vale una por visita.' },
  PERSONAS_SOBRE_PAX:   { titulo: 'Personas sobre el pax', que: 'Las personas registradas en el Club para esa visita (todos los referentes) superan el pax de sus facturas.' },
  REGISTRO_SIN_FACTURA: { titulo: 'Registro sin factura', que: 'Cupón, tarjeta o canje con un número de factura que no está en el PoS.' },
  CREDITOS_SIN_CANJE:   { titulo: 'Créditos sin canje',   que: 'Factura pagada «a crédito» por un múltiplo de medio crédito, sin canje en el Club.' },
  CANJE_MONTO_DISTINTO: { titulo: 'Canje con monto distinto', que: 'El valor del canje no coincide con lo cobrado «a crédito» en la factura.' },
  PROMO_SIN_CUPON:      { titulo: 'Promo sin cupón',      que: 'Factura con el artículo de la promo 10 % y sin cupón ni tarjeta registrada.' },
  TARJETA_MANUAL:       { titulo: 'Tarjeta física',       que: 'Tarjeta impresa cargada a mano (piloto en paralelo). Siempre se revisa; no la resuelve quien la cargó.' },
  CANJE_SIN_CODIGO:     { titulo: 'Canje sin código',     que: 'Canje sin celular aprobado por owner o manager. Siempre se revisa; no lo resuelve quien lo aprobó.' },
  CUPON_SIN_PROMO:      { titulo: 'Cupón sin promo',      que: 'Cupón usado en una visita cuyas facturas no tienen el artículo de la promo 10 %: sumó personas sin descuento aplicado.' },
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
                      <Chip color={e.certeza === 'probable' ? C.gold : e.certeza === 'manual' ? C.teal : C.ink}>{e.certeza}</Chip>
                      {e.resuelta && <Chip color={C.teal}>resuelta</Chip>}
                      <span style={{ marginLeft: 'auto', color: C.muted, fontSize: '0.85rem' }}>{fmtFechaHora(e.fecha)}</span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: C.muted, marginTop: 2 }}>
                      {e.tipo === 'SIN_CRUCE' ? '' : 'Factura '}{e.factura ?? '—'}{typeof e.detalle.miembro === 'string' ? ` · ${e.detalle.miembro}` : ''}
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
  const { profile } = useAuth()
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const d = e.detalle
  // CLUB-AUD-25: quien registró el movimiento no resuelve su excepción (la resuelve el owner); TARJETA_MANUAL y
  // CANJE_SIN_CODIGO no las resuelve quien las cargó o aprobó, ni siendo owner. La base lo controla igual.
  const mia = Array.isArray(d.registradores) && !!profile?.id && (d.registradores as unknown[]).includes(profile.id)
  const bloqueo = !mia ? null
    : e.tipo === 'TARJETA_MANUAL' || e.tipo === 'CANJE_SIN_CODIGO' ? 'Es un registro tuyo: la resuelve otra persona.'
    : profile?.role !== 'owner' ? 'Es un registro tuyo: la resuelve el owner.' : null
  const filas: Array<[string, string]> = [
    ['Qué es', TIPO_EXC[e.tipo].que],
    [e.tipo === 'SIN_CRUCE' ? 'Pedido (PoS)' : 'Factura (PoS)', e.factura ?? '—'],
    ...(d.hora_escaneo ? [['Hora del escaneo', fmtFechaHora(String(d.hora_escaneo))] as [string, string]] : []),
    ...(d.cupon ? [['Cupón', String(d.cupon)] as [string, string]] : []),
    ...(d.cargada_por ? [['Cargada por', String(d.cargada_por)] as [string, string]] : []),
    ...(d.aprobado_por ? [['Aprobado por', String(d.aprobado_por)] as [string, string]] : []),
    ...(d.motivo && e.tipo === 'CANJE_SIN_CODIGO' ? [['Motivo', String(d.motivo)] as [string, string]] : []),
    ...(d.movimiento ? [['Registro en el Club', String(d.movimiento).replace('_', ' ')] as [string, string]] : []),
    ...(d.personas != null ? [['Personas', String(d.personas)] as [string, string]] : []),
    ...(d.creditos != null ? [['Créditos', fmtCreditos(Number(d.creditos))] as [string, string]] : []),
    ...(d.creditos_estimados != null ? [['Créditos estimados', fmtCreditos(Number(d.creditos_estimados))] as [string, string]] : []),
    ...(d.cxc_crc != null ? [['Cobrado «a crédito»', crc(d.cxc_crc)] as [string, string]] : []),
    ...(d.canje_crc != null ? [['Valor del canje', crc(d.canje_crc)] as [string, string]] : []),
    ...(d.diferencia_crc != null ? [['Diferencia', crc(d.diferencia_crc)] as [string, string]] : []),
    ...(d.total_crc != null ? [[e.tipo === 'SIN_CRUCE' ? 'Total del pedido' : 'Total de la factura', crc(d.total_crc)] as [string, string]] : []),
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
        <Aviso tono="ok">
          Resuelta el {fmtFechaHora(e.resuelta_en)}{typeof d.resuelta_por === 'string' ? ` por ${d.resuelta_por}` : ''}: {e.nota}
        </Aviso>
      ) : bloqueo ? (
        <Aviso tono="info">{bloqueo}</Aviso>
      ) : (
        <>
          {e.tipo === 'SIN_CRUCE' && (
            <>
              <ElegirFactura e={e} onElegida={onResuelta} />
              <div style={{ fontSize: '0.85rem', color: C.muted, marginTop: 6 }}>
                Si ninguna factura corresponde (pedido anulado, registro equivocado), resolvela con una nota; si hay que
                corregir el saldo, se hace con un ajuste.
              </div>
            </>
          )}
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

/**
 * SIN_CRUCE: lista de facturas sin pedido de ese día (la misma mesa primero) o búsqueda por los
 * últimos dígitos del consecutivo del tiquete; un toque elige, después «Elegir esta factura».
 */
function ElegirFactura({ e, onElegida }: { e: Excepcion; onElegida: () => Promise<void> }) {
  const [lista, setLista] = useState<FacturaCandidata[] | null>(null)
  const [buscar, setBuscar] = useState('')
  const [buscado, setBuscado] = useState('')
  const [elegida, setElegida] = useState<string | null>(null)
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    getCandidatasSinCruce(e.ref, buscado || undefined).then(setLista).catch(err => { setError(aClubError(err).message); setLista([]) })
  }, [e.ref, buscado])
  async function elegir() {
    if (!elegida) return
    setEnviando(true); setError(null)
    try { await elegirFacturaSinCruce(e.ref, elegida, nota); await onElegida() }
    catch (err) { setError(aClubError(err).message) }
    finally { setEnviando(false) }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      <form onSubmit={ev => { ev.preventDefault(); setLista(null); setElegida(null); setBuscado(buscar.replace(/\D/g, '')) }}
        style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <label style={{ flex: 1 }}><span style={labelStyle}>Últimos dígitos del tiquete (opcional)</span>
          <input value={buscar} onChange={ev => setBuscar(ev.target.value.replace(/\D/g, '').slice(0, 20))} inputMode="numeric"
            placeholder="Ej. 6197" style={{ ...inputStyle, letterSpacing: '0.15em' }} />
        </label>
        <Btn type="submit" variant="secondary" disabled={buscar.length > 0 && buscar.length < 3}>{buscar ? 'Buscar' : 'Ver las del día'}</Btn>
      </form>
      <span style={labelStyle}>{buscado ? `Facturas con el tiquete terminado en …${buscado}` : 'Facturas sin pedido de ese día (la misma mesa primero)'}</span>
      {lista === null && <div style={{ color: C.muted }}>Cargando…</div>}
      {lista?.length === 0 && <div style={{ color: C.muted, fontSize: '0.88rem' }}>{buscado ? 'No hay facturas con ese tiquete.' : 'No hay facturas sin pedido ese día.'}</div>}
      {lista?.map(f => {
        const sel = elegida === f.numero_factura
        return (
          <button key={f.numero_factura} onClick={() => setElegida(f.numero_factura)} aria-pressed={sel}
            style={{ textAlign: 'left', minHeight: 44, borderRadius: 8, cursor: 'pointer', padding: '0.5rem 0.8rem',
                     border: `2px solid ${sel ? C.ink : C.border}`, background: sel ? C.paper : '#fff' }}>
            <strong>{describirFactura(f)}</strong>
            <span style={{ color: C.muted, fontSize: '0.8rem' }}> · factura {f.numero_factura}{f.misma_mesa ? ' · misma mesa' : ''}{f.asignada_a_otro ? ' · ya elegida para otro registro' : ''}</span>
          </button>
        )
      })}
      {(lista?.length ?? 0) > 0 && (
        <>
          <label><span style={labelStyle}>Nota (opcional)</span>
            <input value={nota} onChange={ev => setNota(ev.target.value)} maxLength={400} placeholder="Ej. cuenta dividida en 2" style={inputStyle} />
          </label>
          <Btn onClick={elegir} disabled={enviando || !elegida}>{enviando ? 'Guardando…' : 'Elegir esta factura'}</Btn>
        </>
      )}
    </div>
  )
}
