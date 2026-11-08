/**
 * ClubModule — Club Satori F1c (SPEC §2 y §4): Escanear (caja), Miembros y Negocios.
 * F1f: Excepciones del puente y Reportes (owner, manager). LC-A3: Promociones y cortesías (owner edita, manager lee).
 */
import { lazy, Suspense, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'

const Escanear = lazy(() => import('./Escanear'))
const Miembros = lazy(() => import('./Miembros'))
const Negocios = lazy(() => import('./Negocios'))
const Excepciones = lazy(() => import('./Excepciones'))
const Reportes = lazy(() => import('./Reportes'))
const Promociones = lazy(() => import('./Promociones'))

type Vista = 'escanear' | 'miembros' | 'negocios' | 'excepciones' | 'reportes' | 'promociones'

export default function ClubModule() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const gestiona = profile?.role === 'owner' || profile?.role === 'manager'
  const [vista, setVista] = useState<Vista>('escanear')

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

      {gestiona && (
        <div className="vt-nav-tabs">
          <div className={`vt-nav-tab ${vista === 'escanear' ? 'active' : ''}`} onClick={() => setVista('escanear')}>Escanear</div>
          <div className={`vt-nav-tab ${vista === 'miembros' ? 'active' : ''}`} onClick={() => setVista('miembros')}>Miembros</div>
          <div className={`vt-nav-tab ${vista === 'negocios' ? 'active' : ''}`} onClick={() => setVista('negocios')}>Negocios</div>
          <div className={`vt-nav-tab ${vista === 'excepciones' ? 'active' : ''}`} onClick={() => setVista('excepciones')}>Excepciones</div>
          <div className={`vt-nav-tab ${vista === 'reportes' ? 'active' : ''}`} onClick={() => setVista('reportes')}>Reportes</div>
          <div className={`vt-nav-tab ${vista === 'promociones' ? 'active' : ''}`} onClick={() => setVista('promociones')}>Promociones</div>
        </div>
      )}

      <Suspense fallback={<div className="module-loading"><span className="loading-mark">縁</span></div>}>
        {vista === 'escanear' && <Escanear />}
        {vista === 'miembros' && gestiona && <Miembros />}
        {vista === 'negocios' && gestiona && <Negocios />}
        {vista === 'excepciones' && gestiona && <Excepciones />}
        {vista === 'reportes' && gestiona && <Reportes />}
        {vista === 'promociones' && gestiona && <Promociones />}
      </Suspense>
    </div>
  )
}
