/**
 * Promociones — LC-A3 (alcance mínimo para lanzar; PLAN-LC-lanzamiento.md).
 *  · Promociones: nombre, para quién, vigencia (fechas, días, horario), porcentaje y cantidad de cortesías.
 *    Estado borrador → vigente → terminada (una terminada no se edita: se crea otra). Solo el owner edita.
 *  · Cortesías del sorteo: hasta 10, activables. Cada una es un artículo de la sección «CORTESÍA CLUB» del PoS (₡0).
 *    En caja se sortea una entre las activas (A4); el socio ve «1 cortesía sorpresa».
 *  · La app no toca el PoS: el cajero aplica lo que dice la pantalla y el puente lo verifica después.
 */
import { useEffect, useState } from 'react'
import {
  getPromociones, guardarPromocion, getCortesias, guardarCortesia, getProductos, aClubError,
  type Promocion, type PromocionDatos, type ParaPromo, type EstadoPromo, type Cortesia, type ProductoPos,
} from '../../shared/api/club'
import { Aviso, Btn, Card, Chip } from './ui'
import { C, inputStyle, labelStyle, fmtFecha } from './estilos'
import { useAuth } from '../../shared/hooks/useAuth'

const PARA: Array<[ParaPromo, string]> = [['socio', 'Socios'], ['referente', 'Referentes'], ['turista_cupon', 'Turistas con cupón'], ['todos', 'Todos']]
const DIAS: Array<[number, string]> = [[1, 'Lu'], [2, 'Ma'], [3, 'Mi'], [4, 'Ju'], [5, 'Vi'], [6, 'Sá'], [7, 'Do']]
const ESTADO_COLOR: Record<EstadoPromo, string> = { vigente: C.teal, borrador: C.gold, terminada: C.muted }

export default function Promociones() {
  const { profile } = useAuth()
  const owner = profile?.role === 'owner'
  return (
    <div className="tips-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {!owner && <Aviso tono="info">Las promociones y las cortesías las edita el owner. Acá las ves.</Aviso>}
      <ListaPromociones owner={owner} />
      <ListaCortesias owner={owner} />
    </div>
  )
}

function ListaPromociones({ owner }: { owner: boolean }) {
  const [lista, setLista] = useState<Promocion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [editando, setEditando] = useState<Promocion | 'nueva' | null>(null)
  const [recarga, setRecarga] = useState(0)
  useEffect(() => {
    let vivo = true
    getPromociones().then(l => { if (vivo) setLista(l) }).catch(e => { if (vivo) setError(aClubError(e).message) })
    return () => { vivo = false }
  }, [recarga])

  if (editando) {
    return <FormPromocion inicial={editando === 'nueva' ? null : editando} onCancelar={() => setEditando(null)}
      onGuardada={t => { setEditando(null); setOk(t); setRecarga(n => n + 1) }} />
  }
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>Promociones</strong>
        {owner && <Btn onClick={() => setEditando('nueva')}>+ Nueva</Btn>}
      </div>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      {ok && <Aviso tono="ok" onClose={() => setOk(null)}>{ok}</Aviso>}
      {lista === null ? <div style={{ color: C.muted }}>Cargando…</div> : lista.length === 0 ? <div style={{ color: C.muted }}>Sin promociones.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {lista.map(p => (
            <div key={p.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '0.6rem 0.7rem', background: '#fff' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{p.nombre}</strong>
                <Chip color={ESTADO_COLOR[p.estado]}>{p.estado}</Chip>
                {p.vigente_ahora && <Chip color={C.teal}>aplica ahora</Chip>}
                <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{p.beneficio}</span>
              </div>
              <div style={{ fontSize: '0.8rem', color: C.muted, marginTop: 2 }}>
                {p.para.map(x => PARA.find(([k]) => k === x)?.[1] ?? x).join(', ')} · {resumenVigencia(p)}
              </div>
              {owner && p.estado !== 'terminada' && (
                <Btn variant="secondary" onClick={() => setEditando(p)} style={{ marginTop: 6 }}>Editar</Btn>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function resumenVigencia(p: Promocion): string {
  const dias = p.dias.length === 7 ? 'todos los días' : p.dias.map(d => DIAS.find(([n]) => n === d)?.[1] ?? d).join(' ')
  const fechas = p.desde || p.hasta ? ` · ${p.desde ? `desde ${fmtFecha(p.desde)}` : ''}${p.hasta ? ` hasta ${fmtFecha(p.hasta)}` : ''}` : ''
  const hora = p.hora_desde && p.hora_hasta ? ` · ${p.hora_desde.slice(0, 5)}–${p.hora_hasta.slice(0, 5)}` : ''
  return dias + fechas + hora
}

function FormPromocion({ inicial, onCancelar, onGuardada }: {
  inicial: Promocion | null; onCancelar: () => void; onGuardada: (texto: string) => void
}) {
  const [d, setD] = useState<PromocionDatos>(() => ({
    nombre: inicial?.nombre ?? '', nombre_en: inicial?.nombre_en ?? '', para: inicial?.para ?? ['socio'],
    estado: inicial?.estado ?? 'borrador', desde: inicial?.desde ?? '', hasta: inicial?.hasta ?? '',
    dias: inicial?.dias ?? [1, 2, 3, 4, 5, 6, 7], hora_desde: inicial?.hora_desde?.slice(0, 5) ?? '', hora_hasta: inicial?.hora_hasta?.slice(0, 5) ?? '',
    porcentaje: inicial?.porcentaje ?? 0, cortesias: inicial?.cortesias ?? 0,
  }))
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alterna = <T,>(lista: T[], v: T) => (lista.includes(v) ? lista.filter(x => x !== v) : [...lista, v])
  async function guardar() {
    if (d.estado === 'terminada' && !window.confirm('Una promoción terminada ya no se puede editar. ¿Terminarla?')) return
    setEnviando(true); setError(null)
    try {
      await guardarPromocion(inicial?.id ?? null, { ...d, nombre: d.nombre.trim() })
      onGuardada(inicial ? `Promoción «${d.nombre.trim()}» guardada.` : `Promoción «${d.nombre.trim()}» creada.`)
    } catch (e) { setError(aClubError(e).message) }
    finally { setEnviando(false) }
  }
  return (
    <Card>
      <form onSubmit={e => { e.preventDefault(); guardar() }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <strong>{inicial ? 'Editar promoción' : 'Nueva promoción'}</strong>
        <label><span style={labelStyle}>Nombre</span>
          <input value={d.nombre} onChange={e => setD({ ...d, nombre: e.target.value })} maxLength={80} style={inputStyle} /></label>
        <label><span style={labelStyle}>Nombre en inglés (opcional, para el pase)</span>
          <input value={d.nombre_en ?? ''} onChange={e => setD({ ...d, nombre_en: e.target.value })} maxLength={80} style={inputStyle} /></label>
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={labelStyle}>Para quién</legend>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PARA.map(([k, t]) => (
              <Btn key={k} variant={d.para.includes(k) ? 'primary' : 'secondary'} onClick={() => setD({ ...d, para: alterna(d.para, k) })}>{t}</Btn>
            ))}
          </div>
        </fieldset>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <label><span style={labelStyle}>Descuento (%)</span>
            <input value={String(d.porcentaje)} onChange={e => setD({ ...d, porcentaje: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })}
              inputMode="decimal" style={inputStyle} /></label>
          <label><span style={labelStyle}>Cortesías por visita (sorteo)</span>
            <select value={d.cortesias} onChange={e => setD({ ...d, cortesias: Number(e.target.value) })} style={inputStyle}>
              {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
            </select></label>
          <label><span style={labelStyle}>Desde (opcional)</span>
            <input type="date" value={d.desde ?? ''} onChange={e => setD({ ...d, desde: e.target.value })} style={inputStyle} /></label>
          <label><span style={labelStyle}>Hasta (opcional)</span>
            <input type="date" value={d.hasta ?? ''} onChange={e => setD({ ...d, hasta: e.target.value })} style={inputStyle} /></label>
          <label><span style={labelStyle}>Hora desde (opcional)</span>
            <input type="time" value={d.hora_desde ?? ''} onChange={e => setD({ ...d, hora_desde: e.target.value })} style={inputStyle} /></label>
          <label><span style={labelStyle}>Hora hasta</span>
            <input type="time" value={d.hora_hasta ?? ''} onChange={e => setD({ ...d, hora_hasta: e.target.value })} style={inputStyle} /></label>
        </div>
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={labelStyle}>Días</legend>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {DIAS.map(([n, t]) => (
              <Btn key={n} variant={d.dias.includes(n) ? 'primary' : 'secondary'} onClick={() => setD({ ...d, dias: alterna(d.dias, n).sort() })}>{t}</Btn>
            ))}
          </div>
        </fieldset>
        <label><span style={labelStyle}>Estado</span>
          <select value={d.estado} onChange={e => setD({ ...d, estado: e.target.value as EstadoPromo })} style={inputStyle}>
            <option value="borrador">Borrador (no aplica)</option>
            <option value="vigente">Vigente (aplica en su horario)</option>
            <option value="terminada">Terminada (no se puede volver a editar)</option>
          </select></label>
        {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn type="submit" disabled={enviando || d.nombre.trim().length < 2 || d.para.length === 0 || d.dias.length === 0}>
            {enviando ? 'Guardando…' : 'Guardar'}
          </Btn>
          <Btn variant="ghost" onClick={onCancelar}>Cancelar</Btn>
        </div>
      </form>
    </Card>
  )
}

function ListaCortesias({ owner }: { owner: boolean }) {
  const [lista, setLista] = useState<Cortesia[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [enviando, setEnviando] = useState(false)
  useEffect(() => {
    let vivo = true
    getCortesias().then(l => { if (vivo) setLista(l) }).catch(e => { if (vivo) setError(aClubError(e).message) })
    return () => { vivo = false }
  }, [recarga])
  async function alternar(c: Cortesia) {
    setEnviando(true); setError(null); setOk(null)
    try { await guardarCortesia(c.id, null, null, !c.activa); setOk(`«${c.nombre}» ${c.activa ? 'desactivada' : 'activada'}.`); setRecarga(n => n + 1) }
    catch (e) { setError(aClubError(e).message) }
    finally { setEnviando(false) }
  }
  const llenas = (lista?.length ?? 0) >= 10
  return (
    <Card>
      <strong>Cortesías del sorteo ({lista?.length ?? 0} de 10)</strong>
      <div style={{ fontSize: '0.82rem', color: C.muted, margin: '4px 0 8px' }}>
        Cada una es un artículo de la sección «CORTESÍA CLUB» del PoS, a ₡0. En caja se sortea una entre las activas.
      </div>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      {ok && <Aviso tono="ok" onClose={() => setOk(null)}>{ok}</Aviso>}
      {lista === null ? <div style={{ color: C.muted }}>Cargando…</div> : lista.length === 0 ? (
        <div style={{ color: C.muted }}>Todavía no hay cortesías: el sorteo no da nada hasta cargarlas.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {lista.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', borderBottom: `1px solid ${C.panel}`, padding: '4px 0' }}>
              <div style={{ flex: 1 }}>
                <strong>{c.nombre}</strong> <span style={{ color: C.muted, fontSize: '0.8rem' }}>· {c.codigo_producto}</span>
                <div style={{ fontSize: '0.75rem', color: C.muted }}>
                  {c.visto_en_facturas ? 'Aparece en facturas' : 'Todavía no aparece en ninguna factura'}
                  {c.en_seccion === false && ' · ⚠ no es de la sección «CORTESÍA CLUB»'}
                </div>
              </div>
              <Chip color={c.activa ? C.teal : C.muted}>{c.activa ? 'activa' : 'apagada'}</Chip>
              {owner && <Btn variant="secondary" onClick={() => alternar(c)} disabled={enviando}>{c.activa ? 'Apagar' : 'Activar'}</Btn>}
            </div>
          ))}
        </div>
      )}
      {owner && !llenas && <NuevaCortesia onHecha={t => { setOk(t); setRecarga(n => n + 1) }} />}
      {owner && llenas && <div style={{ marginTop: 8, fontSize: '0.82rem', color: C.muted }}>Ya hay 10: apagá una para usar otra.</div>}
    </Card>
  )
}

function NuevaCortesia({ onHecha }: { onHecha: (texto: string) => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<ProductoPos[] | null>(null)
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function buscar() {
    setError(null)
    try { setRes(await getProductos(q.trim() || null)) } catch (e) { setError(aClubError(e).message) }
  }
  async function agregar() {
    setEnviando(true); setError(null)
    try {
      await guardarCortesia(null, codigo.trim(), nombre.trim() || null, true)
      onHecha('Cortesía agregada.'); setCodigo(''); setNombre(''); setRes(null); setQ('')
    } catch (e) { setError(aClubError(e).message) }
    finally { setEnviando(false) }
  }
  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <strong style={{ fontSize: '0.9rem' }}>Agregar cortesía</strong>
      <form onSubmit={e => { e.preventDefault(); buscar() }} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <label style={{ flex: 1 }}><span style={labelStyle}>Buscar en las facturas (nombre o código)</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ej. CORTESIA" style={inputStyle} /></label>
        <Btn type="submit" variant="secondary">Buscar</Btn>
      </form>
      {res && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
          {res.length === 0 && <div style={{ color: C.muted, fontSize: '0.85rem' }}>Nada en los últimos 120 días. Si Ismael recién creó el artículo, escribí el código y el nombre abajo.</div>}
          {res.map(p => (
            <button key={p.codigo} type="button" onClick={() => { setCodigo(p.codigo); setNombre(p.nombre) }}
              style={{ textAlign: 'left', background: codigo === p.codigo ? C.panel : '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.4rem 0.6rem', cursor: 'pointer', minHeight: 40 }}>
              <strong>{p.nombre}</strong> <span style={{ color: C.muted, fontSize: '0.8rem' }}>· {p.codigo} · familia {p.familia ?? '—'} · {p.veces} veces</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <label><span style={labelStyle}>Código del artículo</span>
          <input value={codigo} onChange={e => setCodigo(e.target.value)} maxLength={30} style={inputStyle} /></label>
        <label><span style={labelStyle}>Nombre</span>
          <input value={nombre} onChange={e => setNombre(e.target.value)} maxLength={80} style={inputStyle} /></label>
      </div>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      <Btn onClick={agregar} disabled={enviando || !codigo.trim()}>{enviando ? 'Agregando…' : 'Agregar'}</Btn>
    </div>
  )
}
