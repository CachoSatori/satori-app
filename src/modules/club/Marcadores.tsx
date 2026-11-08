/**
 * Marcadores de descuento — LC-MD (Ismael, 08-nov). Lista CONFIGURABLE por local de los artículos del PoS que respaldan
 * un descuento en la factura (Local Club 856, invitado 857, PROMO CLUB, tarjetas de hoteles o tiendas, descuento de
 * personal…). DESCUENTO_SIN_RESPALDO y CANJE_CON_DESCUENTO la usan: cargar un marcador nuevo hace que esas facturas
 * dejen de salir como excepción, sin código. El owner edita; manager y contador ven.
 *  · % esperado vacío = respalda cualquier descuento; con valor = solo un descuento de ese % (±1,5 puntos).
 *  · No se borran: se apagan (queda la historia).
 */
import { useEffect, useState } from 'react'
import { getMarcadores, guardarMarcador, getProductos, aClubError, type MarcadorDescuento, type ProductoPos } from '../../shared/api/club'
import { Aviso, Btn, Card, Chip } from './ui'
import { C, inputStyle, labelStyle } from './estilos'
import { useAuth } from '../../shared/hooks/useAuth'

const pctTexto = (p: number | null) => (p === null ? 'cualquier descuento' : `${String(p).replace('.', ',')} %`)
function leerPct(v: string): number | null | 'mal' {
  const t = v.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 'mal'
}

export default function Marcadores() {
  const { profile } = useAuth()
  const owner = profile?.role === 'owner'
  const [lista, setLista] = useState<MarcadorDescuento[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [enviando, setEnviando] = useState(false)
  const [editPct, setEditPct] = useState<Record<string, string>>({})
  useEffect(() => {
    let vivo = true
    getMarcadores().then(l => { if (vivo) setLista(l) }).catch(e => { if (vivo) setError(aClubError(e).message) })
    return () => { vivo = false }
  }, [recarga])

  async function guardar(m: MarcadorDescuento, cambios: { activo?: boolean; pct?: string }) {
    const pct = cambios.pct === undefined ? m.pct_esperado : leerPct(cambios.pct)
    if (pct === 'mal') { setError('El % esperado va de 0,01 a 100, o vacío para cualquier descuento.'); return }
    setEnviando(true); setError(null); setOk(null)
    try {
      await guardarMarcador(m.id, null, null, pct, cambios.activo ?? m.activo)
      setOk(`«${m.nombre}» guardado.`); setEditPct(e => ({ ...e, [m.id]: '' })); setRecarga(n => n + 1)
    } catch (e) { setError(aClubError(e).message) } finally { setEnviando(false) }
  }

  return (
    <div className="tips-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {!owner && <Aviso tono="info">Los marcadores los edita el owner. Acá los ves.</Aviso>}
      <Card>
        <strong>Marcadores de descuento</strong>
        <div style={{ fontSize: '0.82rem', color: C.muted, margin: '4px 0 8px' }}>
          Artículos del PoS que respaldan un descuento en la factura. Si una factura con descuento tiene uno de estos,
          no sale como «descuento sin respaldo». Pagar con créditos y usar uno de estos sí sale («canje con descuento»).
        </div>
        {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
        {ok && <Aviso tono="ok" onClose={() => setOk(null)}>{ok}</Aviso>}
        {lista === null ? <div style={{ color: C.muted }}>Cargando…</div> : lista.length === 0 ? (
          <div style={{ color: C.muted }}>Sin marcadores: todo descuento sale como excepción.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {lista.map(m => (
              <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${C.panel}`, padding: '4px 0' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <strong>{m.nombre}</strong> <span style={{ color: C.muted, fontSize: '0.8rem' }}>· {m.codigo_producto}</span>
                  <div style={{ fontSize: '0.75rem', color: C.muted }}>
                    Respalda: {pctTexto(m.pct_esperado)} · {m.visto_en_facturas ? 'aparece en facturas' : 'todavía no aparece en ninguna factura'}
                  </div>
                </div>
                <Chip color={m.activo ? C.teal : C.muted}>{m.activo ? 'activo' : 'apagado'}</Chip>
                {owner && (
                  <>
                    <input aria-label={`% esperado de ${m.nombre}`} placeholder="% (vacío = cualquiera)" value={editPct[m.id] ?? ''}
                      onChange={e => setEditPct(x => ({ ...x, [m.id]: e.target.value }))} style={{ ...inputStyle, width: 150, padding: '0.4rem 0.5rem' }} />
                    <Btn variant="secondary" disabled={enviando} onClick={() => guardar(m, { pct: editPct[m.id] ?? '' })}>Guardar %</Btn>
                    <Btn variant="secondary" disabled={enviando} onClick={() => guardar(m, { activo: !m.activo })}>{m.activo ? 'Apagar' : 'Activar'}</Btn>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {owner && <NuevoMarcador onHecho={t => { setOk(t); setRecarga(n => n + 1) }} />}
      </Card>
    </div>
  )
}

function NuevoMarcador({ onHecho }: { onHecho: (texto: string) => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<ProductoPos[] | null>(null)
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [pct, setPct] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function buscar() {
    setError(null)
    try { setRes(await getProductos(q.trim() || null)) } catch (e) { setError(aClubError(e).message) }
  }
  async function agregar() {
    const p = leerPct(pct)
    if (p === 'mal') { setError('El % esperado va de 0,01 a 100, o vacío para cualquier descuento.'); return }
    setEnviando(true); setError(null)
    try {
      await guardarMarcador(null, codigo.trim(), nombre.trim() || null, p, true)
      onHecho('Marcador agregado.'); setCodigo(''); setNombre(''); setPct(''); setRes(null); setQ('')
    } catch (e) { setError(aClubError(e).message) } finally { setEnviando(false) }
  }
  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <strong style={{ fontSize: '0.9rem' }}>Agregar marcador</strong>
      <form onSubmit={e => { e.preventDefault(); void buscar() }} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <label style={{ flex: 1 }}><span style={labelStyle}>Buscar en las facturas (nombre o código)</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ej. TARJETA" style={inputStyle} /></label>
        <Btn type="submit" variant="secondary">Buscar</Btn>
      </form>
      {res && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
          {res.length === 0 && <div style={{ color: C.muted, fontSize: '0.85rem' }}>Nada en los últimos 120 días. Si el artículo es nuevo en el PoS, escribí el código y el nombre abajo.</div>}
          {res.map(p => (
            <button key={p.codigo} type="button" onClick={() => { setCodigo(p.codigo); setNombre(p.nombre) }}
              style={{ textAlign: 'left', background: codigo === p.codigo ? C.panel : '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.4rem 0.6rem', cursor: 'pointer', minHeight: 40 }}>
              <strong>{p.nombre}</strong> <span style={{ color: C.muted, fontSize: '0.8rem' }}>· {p.codigo} · {p.veces} veces</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <label><span style={labelStyle}>Código del artículo</span>
          <input value={codigo} onChange={e => setCodigo(e.target.value)} maxLength={30} style={inputStyle} /></label>
        <label><span style={labelStyle}>Nombre</span>
          <input value={nombre} onChange={e => setNombre(e.target.value)} maxLength={80} style={inputStyle} /></label>
        <label><span style={labelStyle}>% esperado (vacío = cualquiera)</span>
          <input value={pct} onChange={e => setPct(e.target.value)} inputMode="decimal" style={inputStyle} /></label>
      </div>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      <Btn onClick={() => void agregar()} disabled={enviando || !codigo.trim()}>Agregar marcador</Btn>
    </div>
  )
}
