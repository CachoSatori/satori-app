/**
 * ClubModule — Club Satori F1c (SPEC §2 y §4): Escanear (caja), Miembros y Negocios.
 * F1f: Excepciones del puente y Reportes (owner, manager). LC-A3: Promociones y cortesías (owner edita, manager lee).
 * LC-ML: multilocal. Los locales salen de club_config; el selector aparece solo si hay más de uno, y el owner enciende o
 * apaga el Club por local (pestaña Locales). Ninguna pantalla nombra un local.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { C, inputStyle } from './estilos'
import { getLocalesClub, localActual, elegirLocal, setClubActivo, crearLocal, aClubError, getClubUrl, type LocalClub } from '../../shared/api/club'
import { configurarClubUrl } from './qrFormato'

const Escanear = lazy(() => import('./Escanear'))
const Miembros = lazy(() => import('./Miembros'))
const Negocios = lazy(() => import('./Negocios'))
const Excepciones = lazy(() => import('./Excepciones'))
const Reportes = lazy(() => import('./Reportes'))
const Promociones = lazy(() => import('./Promociones'))
const Marcadores = lazy(() => import('./Marcadores'))

type Vista = 'escanear' | 'miembros' | 'negocios' | 'excepciones' | 'reportes' | 'promociones' | 'descuentos' | 'locales'

export default function ClubModule() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const gestiona = profile?.role === 'owner' || profile?.role === 'manager'
  const esOwner = profile?.role === 'owner'
  const [vista, setVista] = useState<Vista>('escanear')
  const [locales, setLocales] = useState<LocalClub[] | null>(null)
  const [local, setLocal] = useState<string | null>(localActual())

  // El owner ve también los locales apagados (para preparar su configuración); el resto, solo los encendidos.
  const visibles = (locales ?? []).filter(l => l.activo || esOwner)
  const cargarLocales = useCallback(async () => {
    try {
      const l = await getLocalesClub()
      setLocales(l)
      const vis = l.filter(x => x.activo || esOwner)
      const elegido = vis.find(x => x.id === localActual()) ?? vis.find(x => x.activo) ?? vis[0] ?? null
      elegirLocal(elegido?.id ?? null); setLocal(elegido?.id ?? null)
    } catch { setLocales([]) }
  }, [esOwner])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void cargarLocales() }, [cargarLocales])
  // (08-nov noche) el dominio de los QR y links sale de la configuración, no del código
  useEffect(() => { getClubUrl().then(configurarClubUrl).catch(() => configurarClubUrl(null)) }, [])

  return (
    <div className="tips-module">
      <div className="tips-header">
        <div className="tips-header-left">
          <span className="tips-kanji">縁</span>
          <div>
            <h2 className="tips-title">Club Satori</h2>
            <p className="tips-subtitle">Referentes · créditos · cupones</p>
          </div>
          {profile?.role && <span className="role-badge">{profile.role}</span>}
        </div>
        <button className="cash-back-btn" style={{ borderColor: '#333', color: '#888', whiteSpace: 'nowrap' }}
          onClick={() => navigate('/')}>← Inicio</button>
      </div>

      {visibles.length > 1 && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 12px 10px', color: C.ink, fontSize: 14, fontWeight: 600 }}>
          Local
          <select value={local ?? ''} onChange={e => { elegirLocal(e.target.value); setLocal(e.target.value) }}
            style={{ ...inputStyle, width: 'auto', padding: '0.4rem 0.6rem' }}>
            {visibles.map(l => <option key={l.id} value={l.id}>{l.nombre}{l.activo ? '' : ' (Club apagado)'}</option>)}
          </select>
        </label>
      )}
      {locales !== null && visibles.length === 0 && (
        <p style={{ color: C.red, margin: '12px' }}>El Club no está activo en ningún local. Lo enciende el owner.</p>
      )}

      {gestiona && (
        <div className="vt-nav-tabs">
          <div className={`vt-nav-tab ${vista === 'escanear' ? 'active' : ''}`} onClick={() => setVista('escanear')}>Escanear</div>
          <div className={`vt-nav-tab ${vista === 'miembros' ? 'active' : ''}`} onClick={() => setVista('miembros')}>Miembros</div>
          <div className={`vt-nav-tab ${vista === 'negocios' ? 'active' : ''}`} onClick={() => setVista('negocios')}>Negocios</div>
          <div className={`vt-nav-tab ${vista === 'excepciones' ? 'active' : ''}`} onClick={() => setVista('excepciones')}>Excepciones</div>
          <div className={`vt-nav-tab ${vista === 'reportes' ? 'active' : ''}`} onClick={() => setVista('reportes')}>Reportes</div>
          <div className={`vt-nav-tab ${vista === 'promociones' ? 'active' : ''}`} onClick={() => setVista('promociones')}>Promociones</div>
          <div className={`vt-nav-tab ${vista === 'descuentos' ? 'active' : ''}`} onClick={() => setVista('descuentos')}>Descuentos</div>
          {esOwner && <div className={`vt-nav-tab ${vista === 'locales' ? 'active' : ''}`} onClick={() => setVista('locales')}>Locales</div>}
        </div>
      )}

      <Suspense key={local ?? 'sin-local'} fallback={<div className="module-loading"><span className="loading-mark">縁</span></div>}>
        {vista === 'locales' && esOwner && <Locales locales={locales ?? []} onCambio={cargarLocales} />}
        {vista === 'escanear' && <Escanear />}
        {vista === 'miembros' && gestiona && <Miembros />}
        {vista === 'negocios' && gestiona && <Negocios />}
        {vista === 'excepciones' && gestiona && <Excepciones />}
        {vista === 'reportes' && gestiona && <Reportes />}
        {vista === 'promociones' && gestiona && <Promociones />}
        {vista === 'descuentos' && gestiona && <Marcadores />}
      </Suspense>
    </div>
  )
}

/** LC-ML: el interruptor del Club por local (solo owner; queda en club_config_historial). */
function Locales({ locales, onCambio }: { locales: LocalClub[]; onCambio: () => Promise<void> }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  async function cambiar(l: LocalClub) {
    const accion = l.activo ? 'APAGAR' : 'ENCENDER'
    if (!window.confirm(`¿${accion} el Club en ${l.nombre}? ${l.activo
      ? 'Se cortan altas, visitas, cupones y canjes en ese local.'
      : 'Antes, completá el checklist «Encender un local» del RUNBOOK (códigos del PoS, cortesías, promoción, secreto del puente).'}`)) return
    setOcupado(l.id); setMsg(null)
    try { await setClubActivo(l.id, !l.activo); await onCambio(); setMsg(`${l.nombre}: Club ${l.activo ? 'apagado' : 'encendido'}.`) }
    catch (e) { setMsg(aClubError(e).message) }
    finally { setOcupado(null) }
  }
  return (
    <div className="tips-body" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      {locales.map(l => (
        <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
          <span>{l.nombre} <span style={{ color: l.activo ? C.teal : C.red, fontSize: 12, fontWeight: 600 }}>· Club {l.activo ? 'encendido' : 'apagado'}</span></span>
          <button className="cash-back-btn" disabled={ocupado !== null} onClick={() => void cambiar(l)}>
            {l.activo ? 'Apagar' : 'Encender'}
          </button>
        </div>
      ))}
      {msg && <p style={{ color: C.ink, fontSize: 13 }}>{msg}</p>}
      <NuevoLocal locales={locales} onCreado={async (t) => { await onCambio(); setMsg(t) }} />
    </div>
  )
}

/** LC-ML: alta de un local (queda apagado). Después: su configuración y el checklist «Encender un local» del RUNBOOK. */
function NuevoLocal({ locales, onCreado }: { locales: LocalClub[]; onCreado: (texto: string) => Promise<void> }) {
  const [id, setId] = useState('')
  const [nombre, setNombre] = useState('')
  const [direccion, setDireccion] = useState('')
  const [mapa, setMapa] = useState('')
  const [copiarDe, setCopiarDe] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const campo = { ...inputStyle, padding: '0.55rem 0.7rem' }
  async function crear() {
    setEnviando(true); setError(null)
    try {
      const nuevo = await crearLocal({ id: id.trim().toLowerCase(), nombre: nombre.trim(), direccion: direccion.trim() || null,
                                       mapa: mapa.trim() || null, copiarDe: copiarDe || null })
      setId(''); setNombre(''); setDireccion(''); setMapa(''); setCopiarDe('')
      await onCreado(`Local «${nuevo}» creado y APAGADO. Cargá su configuración (Promociones y Descuentos con ese local elegido) y seguí el checklist «Encender un local» antes de encenderlo.`)
    } catch (e) { setError(aClubError(e).message) } finally { setEnviando(false) }
  }
  return (
    <div style={{ background: '#fff', border: `1px dashed ${C.border}`, borderRadius: 8, padding: '10px 12px', display: 'grid', gap: 6 }}>
      <strong style={{ fontSize: 13 }}>Nuevo local</strong>
      <input aria-label="Id del local" placeholder="id (minúsculas y guiones, ej. playa-nueva)" value={id} onChange={e => setId(e.target.value)} maxLength={40} style={campo} />
      <input aria-label="Nombre del local" placeholder="Nombre" value={nombre} onChange={e => setNombre(e.target.value)} maxLength={60} style={campo} />
      <input aria-label="Dirección" placeholder="Dirección (opcional)" value={direccion} onChange={e => setDireccion(e.target.value)} maxLength={160} style={campo} />
      <input aria-label="Mapa" placeholder="Enlace del mapa https://… (opcional)" value={mapa} onChange={e => setMapa(e.target.value)} style={campo} />
      <select aria-label="Copiar la configuración de" value={copiarDe} onChange={e => setCopiarDe(e.target.value)} style={campo}>
        <option value="">Sin copiar configuración (valores por defecto)</option>
        {locales.map(l => <option key={l.id} value={l.id}>Copiar la configuración de {l.nombre}</option>)}
      </select>
      {error && <p style={{ color: C.red, fontSize: 13, margin: 0 }}>{error}</p>}
      <button className="cash-back-btn" disabled={enviando || !id.trim() || !nombre.trim()} onClick={() => void crear()}>Crear local (apagado)</button>
    </div>
  )
}
