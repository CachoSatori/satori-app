/**
 * Miembros (owner, manager): lista con filtros, alta y edición, negocio con selector
 * (+ crear uno nuevo), regenerar el QR, historial y link del portal. El equipo va en
 * una pestaña aparte. Los contactos solo los ven owner y manager (RLS).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import {
  getMiembros, getSaldos, getNegocios, getMovimientos, getContacto, guardarMiembro, guardarNegocio,
  regenerarCodigo, tokenPortal, aClubError, fmtCreditos, ajustarSaldo, nuevoOp,
  type ClubMiembro, type ClubSaldo, type ClubNegocio, type ClubMovimiento, type TipoMiembro, type TipoNegocio,
} from '../../shared/api/club'
import { urlPortal, urlReferente } from './qrFormato'
import { Aviso, Btn, Card, Chip } from './ui'
import { C, inputStyle, labelStyle, fmtFecha, fmtFechaHora, TIPO_MIEMBRO_LABEL, TIPO_NEGOCIO_LABEL, TIPO_MOV_LABEL } from './estilos'
import { useAuth } from '../../shared/hooks/useAuth'

type Pestana = 'referentes' | 'equipo'
type Fila = ClubMiembro & { saldo: ClubSaldo | null; negocio: string | null }
const SEIS_MESES_MS = 182 * 24 * 3600 * 1000

export default function Miembros() {
  const [pestana, setPestana] = useState<Pestana>('referentes')
  const [miembros, setMiembros] = useState<ClubMiembro[]>([])
  const [saldos, setSaldos] = useState<ClubSaldo[]>([])
  const [negocios, setNegocios] = useState<ClubNegocio[]>([])
  const [cargando, setCargando] = useState(true)
  const [ahora, setAhora] = useState(0)   // momento de la última carga (filtro «sin actividad»)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [editando, setEditando] = useState<ClubMiembro | 'nuevo' | null>(null)

  // filtros
  const [fTexto, setFTexto] = useState('')
  const [fTipo, setFTipo] = useState<'' | TipoMiembro>('')
  const [fNegocio, setFNegocio] = useState('')
  const [fEstado, setFEstado] = useState<'' | 'activo' | 'baja'>('activo')
  const [fSaldo, setFSaldo] = useState(false)
  const [fDormido, setFDormido] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    try {
      const [m, s, n] = await Promise.all([getMiembros(), getSaldos(), getNegocios()])
      setMiembros(m); setSaldos(s); setNegocios(n); setAhora(Date.now())
    } catch (e) { setError(aClubError(e).message) }
    finally { setCargando(false) }
  }, [])
  // Carga inicial (patrón del repo: efecto que dispara la carga asíncrona).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar() }, [cargar])

  // Todas las filas con saldo y negocio (el detalle busca acá: un miembro recién dado de baja
  // no desaparece aunque el filtro de la lista sea «Activos»).
  const todas: Fila[] = useMemo(() => {
    const sMap = new Map(saldos.map(s => [s.miembro_id, s]))
    const nMap = new Map(negocios.map(n => [n.id, n.nombre]))
    return miembros.map(m => ({ ...m, saldo: sMap.get(m.id) ?? null, negocio: m.negocio_id ? nMap.get(m.negocio_id) ?? null : null }))
  }, [miembros, saldos, negocios])

  const filas: Fila[] = useMemo(() => {
    const txt = fTexto.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    return todas
      .filter(m => (pestana === 'equipo' ? m.tipo === 'equipo' : m.tipo === 'referente' || m.tipo === 'concierge_pm'))
      .filter(f => !fTipo || f.tipo === fTipo)
      .filter(f => !fNegocio || f.negocio_id === fNegocio)
      .filter(f => !fEstado || f.estado === fEstado)
      .filter(f => !fSaldo || (f.saldo?.personas ?? 0) > 0)
      .filter(f => !fDormido || !f.saldo?.ultima_actividad || ahora - new Date(f.saldo.ultima_actividad).getTime() > SEIS_MESES_MS)
      .filter(f => !txt || `${f.nombre} ${f.negocio ?? ''} ${f.codigo}`.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(txt))
  }, [todas, pestana, fTipo, fNegocio, fEstado, fSaldo, fDormido, fTexto, ahora])

  const seleccionado = todas.find(f => f.id === sel) ?? null

  if (editando) {
    return (
      <div className="tips-body" style={{ maxWidth: 640 }}>
        <FormMiembro inicial={editando === 'nuevo' ? null : editando} tipoPorDefecto={pestana === 'equipo' ? 'equipo' : 'referente'}
          negocios={negocios}
          saldoPersonas={editando === 'nuevo' ? 0 : (todas.find(f => f.id === editando.id)?.saldo?.personas ?? 0)}
          onNegocioCreado={n => setNegocios(prev => [...prev, n].sort((a, b) => a.nombre.localeCompare(b.nombre)))}
          onCancelar={() => setEditando(null)}
          onGuardado={async id => { setEditando(null); await cargar(); setSel(id) }} />
      </div>
    )
  }

  if (seleccionado) {
    return (
      <div className="tips-body" style={{ maxWidth: 640 }}>
        <Detalle f={seleccionado} onVolver={() => setSel(null)} onEditar={() => setEditando(seleccionado)} onCambio={cargar} />
      </div>
    )
  }

  return (
    <div className="tips-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <Btn variant={pestana === 'referentes' ? 'primary' : 'secondary'} onClick={() => setPestana('referentes')} style={{ flex: 1 }}>Referentes y concierges</Btn>
        <Btn variant={pestana === 'equipo' ? 'primary' : 'secondary'} onClick={() => setPestana('equipo')} style={{ flex: 1 }}>Equipo</Btn>
      </div>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}

      <Card style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={fTexto} onChange={e => setFTexto(e.target.value)} placeholder="Filtrar por nombre, negocio o código" aria-label="Filtrar miembros por nombre, negocio o código" style={{ ...inputStyle, flex: 1 }} />
          <Btn onClick={() => setEditando('nuevo')}>+ Nuevo</Btn>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          {pestana === 'referentes' && (
            <select value={fTipo} onChange={e => setFTipo(e.target.value as '' | TipoMiembro)} style={inputStyle} aria-label="Tipo">
              <option value="">Todos los tipos</option>
              <option value="referente">Referente</option>
              <option value="concierge_pm">Concierge PM</option>
            </select>
          )}
          <select value={fNegocio} onChange={e => setFNegocio(e.target.value)} style={inputStyle} aria-label="Negocio">
            <option value="">Todos los negocios</option>
            {negocios.map(n => <option key={n.id} value={n.id}>{n.nombre}</option>)}
          </select>
          <select value={fEstado} onChange={e => setFEstado(e.target.value as '' | 'activo' | 'baja')} style={inputStyle} aria-label="Estado">
            <option value="activo">Activos</option>
            <option value="baja">Dados de baja</option>
            <option value="">Todos</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.88rem' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={fSaldo} onChange={e => setFSaldo(e.target.checked)} /> Con saldo</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={fDormido} onChange={e => setFDormido(e.target.checked)} /> Sin actividad hace más de 6 meses</label>
        </div>
      </Card>

      {cargando ? <div style={{ textAlign: 'center', color: C.muted, padding: '2rem' }}>Cargando…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: '0.78rem', color: C.muted }}>{filas.length} {filas.length === 1 ? 'miembro' : 'miembros'}</div>
          {filas.length === 0 && <div style={{ color: C.muted, textAlign: 'center', padding: '1.5rem' }}>Sin resultados.</div>}
          {filas.map(f => (
            <button key={f.id} onClick={() => setSel(f.id)}
              style={{ textAlign: 'left', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: '0.7rem 0.8rem', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{f.nombre}</strong>
                <span style={{ fontWeight: 700 }}>{fmtCreditos(f.saldo?.creditos ?? 0)} cr.</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.78rem', color: C.muted, marginTop: 2 }}>
                <span>{f.negocio ?? 'Sin negocio'}</span>
                <Chip>{TIPO_MIEMBRO_LABEL[f.tipo]}</Chip>
                {f.estado !== 'activo' && <Chip color={C.red}>baja</Chip>}
                <span style={{ marginLeft: 'auto' }}>últ. actividad {fmtFecha(f.saldo?.ultima_actividad)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Detalle ──────────────────────────────────────────────────────────────────

function Detalle({ f, onVolver, onEditar, onCambio }: { f: Fila; onVolver: () => void; onEditar: () => void; onCambio: () => Promise<void> }) {
  const { profile } = useAuth()
  const [recarga, setRecarga] = useState(0)
  const [movs, setMovs] = useState<ClubMovimiento[] | null>(null)
  const [contacto, setContacto] = useState<{ telefono: string | null; email: string | null } | null>(null)
  const [qr, setQr] = useState('')
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'error'; t: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    Promise.all([getMovimientos(f.id), getContacto(f.id)])
      .then(([m, c]) => { if (vivo) { setMovs(m); setContacto(c) } })
      .catch(e => { if (vivo) setAviso({ tono: 'error', t: aClubError(e).message }) })
    QRCode.toDataURL(urlReferente(f.codigo), { width: 480, margin: 2, errorCorrectionLevel: 'M' })
      .then(u => { if (vivo) setQr(u) }).catch(() => {})
    return () => { vivo = false }
  }, [f.id, f.codigo, recarga])

  async function copiarPortal() {
    setOcupado(true)
    try {
      const url = urlPortal(await tokenPortal(f.id))
      await navigator.clipboard?.writeText(url)
      setAviso({ tono: 'ok', t: 'Link del portal copiado.' })
    } catch (e) { setAviso({ tono: 'error', t: aClubError(e).message }) }
    finally { setOcupado(false) }
  }

  async function regenerar() {
    if (!window.confirm(`¿Regenerar el QR de ${f.nombre}? El QR y el link anteriores dejan de funcionar.`)) return
    setOcupado(true)
    try {
      const r = await regenerarCodigo(f.id)
      await onCambio()
      setAviso({ tono: 'ok', t: `QR regenerado. Código nuevo: ${r.codigo}` })
    } catch (e) { setAviso({ tono: 'error', t: aClubError(e).message }) }
    finally { setOcupado(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="secondary" onClick={onVolver}>← Volver</Btn>
        <Btn variant="secondary" onClick={onEditar} style={{ marginLeft: 'auto' }}>Editar</Btn>
      </div>
      {aviso && <Aviso tono={aviso.tono} onClose={() => setAviso(null)}>{aviso.t}</Aviso>}
      <Card>
        <div style={{ fontSize: '0.7rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {TIPO_MIEMBRO_LABEL[f.tipo]}{f.negocio ? ` · ${f.negocio}` : ''}
        </div>
        <div style={{ fontSize: '1.3rem', fontWeight: 800, display: 'flex', gap: 8, alignItems: 'center' }}>
          {f.nombre} {f.estado !== 'activo' && <Chip color={C.red}>baja</Chip>}
        </div>
        <div style={{ display: 'flex', gap: 16, margin: '0.6rem 0', flexWrap: 'wrap' }}>
          <div><strong style={{ fontSize: '1.4rem' }}>{fmtCreditos(f.saldo?.creditos ?? 0)}</strong> créditos</div>
          <div><strong style={{ fontSize: '1.4rem' }}>{f.saldo?.personas ?? 0}</strong> personas</div>
          <div style={{ color: C.muted }}>faltan {f.saldo?.personas_proximo_credito ?? '—'} para el próximo medio crédito</div>
        </div>
        <div style={{ fontSize: '0.88rem', color: C.muted }}>
          Tel.: {contacto?.telefono ?? '—'} · Email: {contacto?.email ?? '—'}
        </div>
      </Card>

      <Card style={{ textAlign: 'center' }}>
        {qr && <img src={qr} alt={`QR de ${f.nombre}`} style={{ width: 'min(220px, 60vw)', height: 'auto' }} />}
        <div style={{ letterSpacing: '0.15em', fontWeight: 800, marginTop: 4 }}>{f.codigo}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          {qr && <a href={qr} download={`club-${f.codigo}.png`} style={{ textDecoration: 'none' }}><Btn variant="secondary">⬇ QR</Btn></a>}
          <Btn variant="secondary" onClick={copiarPortal} disabled={ocupado}>⎘ Link del portal</Btn>
          <Btn variant="danger" onClick={regenerar} disabled={ocupado}>Regenerar QR</Btn>
        </div>
      </Card>

      {profile?.role === 'owner' && (
        <AjusteOwner f={f} onHecho={async t => { await onCambio(); setRecarga(n => n + 1); setAviso({ tono: 'ok', t }) }} />
      )}

      <Card>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Historial</div>
        {movs === null ? <div style={{ color: C.muted }}>Cargando…</div> : movs.length === 0 ? (
          <div style={{ color: C.muted }}>Sin movimientos.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {movs.map(m => (
              <div key={m.id} style={{ display: 'flex', gap: 8, fontSize: '0.85rem', borderBottom: `1px solid ${C.panel}`, padding: '4px 0' }}>
                <span style={{ width: 92, color: C.muted }}>{fmtFechaHora(m.fecha_visita)}</span>
                <span style={{ flex: 1 }}>
                  {TIPO_MOV_LABEL[m.tipo]}{m.creditos != null ? ` ${fmtCreditos(m.creditos)} cr.` : ''}
                  {m.nota ? <span style={{ color: C.muted }}> · {m.nota}</span> : null}
                  {m.factura_pos ? <span style={{ color: C.muted }}> · {m.factura_pos}</span> : null}
                </span>
                <strong style={{ color: m.personas > 0 ? C.teal : C.red }}>{m.personas > 0 ? '+' : ''}{m.personas}</strong>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

/**
 * Ajuste o restitución del saldo (solo owner, nota obligatoria). La restitución es la única forma de devolver
 * un saldo vencido (por inactividad o por la baja): reactivar la cuenta no lo devuelve.
 */
function AjusteOwner({ f, onHecho }: { f: Fila; onHecho: (texto: string) => Promise<void> }) {
  const [tipo, setTipo] = useState<'restitucion' | 'ajuste'>('restitucion')
  const [personas, setPersonas] = useState('')
  const [nota, setNota] = useState('')
  const [op, setOp] = useState(nuevoOp)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const n = Number(personas)
  const ok = Number.isInteger(n) && n !== 0 && Math.abs(n) <= 1000 && (tipo === 'ajuste' || n > 0) && nota.trim().length > 0
  async function guardar() {
    if (!window.confirm(`¿${tipo === 'restitucion' ? 'Restituir' : 'Ajustar'} ${n > 0 ? '+' : ''}${n} personas a ${f.nombre}?`)) return
    setEnviando(true); setError(null)
    try {
      await ajustarSaldo(f.id, n, tipo, nota.trim(), op)
      setPersonas(''); setNota(''); setOp(nuevoOp())
      await onHecho(`${tipo === 'restitucion' ? 'Restitución' : 'Ajuste'} de ${n > 0 ? '+' : ''}${n} personas a ${f.nombre}.`)
    } catch (e) { setError(aClubError(e).message) }   // el op se conserva: el reintento no duplica
    finally { setEnviando(false) }
  }
  return (
    <Card>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Ajuste o restitución (solo owner)</div>
      <div style={{ fontSize: '0.82rem', color: C.muted, marginBottom: 8 }}>
        Restitución: devuelve personas vencidas (por inactividad o por la baja). Ajuste: corrige un error (puede ser negativo).
      </div>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <label><span style={labelStyle}>Tipo</span>
          <select value={tipo} onChange={e => setTipo(e.target.value as 'restitucion' | 'ajuste')} style={inputStyle}>
            <option value="restitucion">Restitución</option>
            <option value="ajuste">Ajuste</option>
          </select>
        </label>
        <label><span style={labelStyle}>Personas</span>
          <input value={personas} onChange={e => setPersonas(e.target.value.replace(/[^\d-]/g, ''))} inputMode="numeric"
            placeholder={tipo === 'restitucion' ? 'Ej. 12' : 'Ej. -3 o 3'} style={inputStyle} />
        </label>
      </div>
      <label><span style={labelStyle}>Nota (obligatoria)</span>
        <input value={nota} onChange={e => setNota(e.target.value)} maxLength={300} placeholder="Por qué" style={inputStyle} />
      </label>
      <Btn onClick={guardar} disabled={!ok || enviando} style={{ marginTop: 8, width: '100%' }}>{enviando ? 'Guardando…' : 'Guardar'}</Btn>
    </Card>
  )
}

// ── Formulario ───────────────────────────────────────────────────────────────

function FormMiembro({ inicial, tipoPorDefecto, negocios, saldoPersonas, onNegocioCreado, onCancelar, onGuardado }: {
  inicial: ClubMiembro | null; tipoPorDefecto: TipoMiembro; negocios: ClubNegocio[]; saldoPersonas: number
  onNegocioCreado: (n: ClubNegocio) => void; onCancelar: () => void; onGuardado: (id: string) => Promise<void>
}) {
  const [tipo, setTipo] = useState<TipoMiembro>(inicial?.tipo ?? tipoPorDefecto)
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [negocioId, setNegocioId] = useState(inicial?.negocio_id ?? '')
  const [estado, setEstado] = useState<'activo' | 'baja'>(inicial?.estado ?? 'activo')
  const [tel, setTel] = useState(''); const [email, setEmail] = useState('')
  const [optWa, setOptWa] = useState(false); const [optEm, setOptEm] = useState(false)
  const [contactoCargado, setContactoCargado] = useState(!inicial)
  const [nuevoNeg, setNuevoNeg] = useState<{ nombre: string; tipo: TipoNegocio } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!inicial) return
    let vivo = true
    getContacto(inicial.id).then(c => {
      if (!vivo) return
      setTel(c?.telefono ?? ''); setEmail(c?.email ?? ''); setOptWa(!!c?.optin_whatsapp); setOptEm(!!c?.optin_email)
      setContactoCargado(true)
    }).catch(() => { if (vivo) setContactoCargado(true) })
    return () => { vivo = false }
  }, [inicial])

  async function crearNegocio() {
    if (!nuevoNeg) return
    setGuardando(true); setError(null)
    try {
      const id = await guardarNegocio({ id: null, nombre: nuevoNeg.nombre, tipo: nuevoNeg.tipo, activo: true })
      onNegocioCreado({ id, nombre: nuevoNeg.nombre.trim().replace(/\s+/g, ' '), tipo: nuevoNeg.tipo, activo: true, created_at: new Date().toISOString() })
      setNegocioId(id); setNuevoNeg(null)
    } catch (e) { setError(aClubError(e).message) }
    finally { setGuardando(false) }
  }

  async function guardar() {
    // La baja vence el saldo en el momento (decisión de Ismael); volver a activo no lo restituye.
    if (inicial?.estado === 'activo' && estado === 'baja' && saldoPersonas > 0 &&
        !window.confirm(`Dar de baja a ${inicial.nombre} vence su saldo (${saldoPersonas} personas). Volver a activarlo no lo restituye: eso solo lo hace el owner con un ajuste. ¿Seguir?`)) return
    setGuardando(true); setError(null)
    try {
      const id = await guardarMiembro({
        id: inicial?.id ?? null, tipo, nombre, negocio_id: negocioId || null, estado,
        contacto: contactoCargado ? { telefono: tel, email, optin_whatsapp: optWa, optin_email: optEm } : null,
      })
      await onGuardado(id)
    } catch (e) { setError(aClubError(e).message); setGuardando(false) }
  }

  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{inicial ? 'Editar miembro' : 'Nuevo miembro'}</div>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      <label><span style={labelStyle}>Tipo</span>
        <select value={tipo} onChange={e => setTipo(e.target.value as TipoMiembro)} style={inputStyle}>
          <option value="referente">Referente</option>
          <option value="concierge_pm">Concierge PM</option>
          <option value="equipo">Equipo Satori</option>
        </select>
      </label>
      <label><span style={labelStyle}>Nombre</span>
        <input value={nombre} onChange={e => setNombre(e.target.value)} style={inputStyle} placeholder="Nombre y apellido" />
      </label>
      <div>
        <span style={labelStyle}>Negocio</span>
        {nuevoNeg ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input value={nuevoNeg.nombre} onChange={e => setNuevoNeg({ ...nuevoNeg, nombre: e.target.value })} placeholder="Nombre del negocio" style={inputStyle} />
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={nuevoNeg.tipo} onChange={e => setNuevoNeg({ ...nuevoNeg, tipo: e.target.value as TipoNegocio })} style={{ ...inputStyle, flex: 1 }}>
                {Object.entries(TIPO_NEGOCIO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <Btn variant="secondary" onClick={() => setNuevoNeg(null)}>Cancelar</Btn>
              <Btn onClick={crearNegocio} disabled={guardando || !nuevoNeg.nombre.trim()}>Crear</Btn>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={negocioId} onChange={e => setNegocioId(e.target.value)} style={{ ...inputStyle, flex: 1 }} aria-label="Negocio">
              <option value="">Sin negocio</option>
              {negocios.map(n => <option key={n.id} value={n.id}>{n.nombre}{n.activo ? '' : ' (inactivo)'}</option>)}
            </select>
            <Btn variant="secondary" onClick={() => setNuevoNeg({ nombre: '', tipo: 'hotel' })}>+ Negocio</Btn>
          </div>
        )}
      </div>
      <label><span style={labelStyle}>Estado</span>
        <select value={estado} onChange={e => setEstado(e.target.value as 'activo' | 'baja')} style={inputStyle}>
          <option value="activo">Activo</option>
          <option value="baja">Dado de baja</option>
        </select>
      </label>
      <div style={{ borderTop: `1px solid ${C.panel}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: '0.78rem', color: C.muted }}>Contacto (solo lo ven owner y manager)</div>
        <label><span style={labelStyle}>Teléfono / WhatsApp</span>
          <input value={tel} onChange={e => setTel(e.target.value)} inputMode="tel" placeholder="8888 8888 o +1…" style={inputStyle} disabled={!contactoCargado} />
        </label>
        <label><span style={labelStyle}>Email</span>
          <input value={email} onChange={e => setEmail(e.target.value)} inputMode="email" placeholder="nombre@ejemplo.com" style={inputStyle} disabled={!contactoCargado} />
        </label>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.88rem' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={optWa} onChange={e => setOptWa(e.target.checked)} /> Acepta WhatsApp</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={optEm} onChange={e => setOptEm(e.target.checked)} /> Acepta email</label>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="secondary" onClick={onCancelar} disabled={guardando} style={{ flex: 1 }}>Cancelar</Btn>
        <Btn onClick={guardar} disabled={guardando || !nombre.trim()} style={{ flex: 2 }}>{guardando ? 'Guardando…' : 'Guardar'}</Btn>
      </div>
    </Card>
  )
}
