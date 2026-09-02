import { useState, Suspense, lazy } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import type { LocalId } from './types'
// Piel del módulo. El archivo es SCOPED: todo cuelga de `.apos` y no toca index.css ni :root,
// así que ningún otro módulo cambia por este import.
import './analitica.css'

// Analítica PoS · Fase A.
//
// El módulo existe para leer el PoS (SQL Server, base `ndf`) y todavía NO tenemos permiso de
// lectura. Así que esta fase estructura las tres piezas para que cablear después sea trivial:
//   1. el contrato de datos  → types.ts   (nuestro modelo, no el del PoS)
//   2. la pantalla           → VentasEnVivo.tsx + mock.ts
//   3. el agente             → tools/pos-bridge/ (esqueleto, no se conecta a nada)
//
// Una sola pestaña por ahora. La estructura de tabs queda armada porque las siguientes
// (Mix, Meseros, Calidad de datos) ya se saben; agregarlas es una línea en `TABS`.

const VentasEnVivo = lazy(() => import('./VentasEnVivo'))

type Tab = 'vivo'

const TABS: { id: Tab; label: string }[] = [
  { id: 'vivo', label: 'Ventas en vivo' },
]

export default function AnaliticaPosModule() {
  const { profile } = useAuth()
  const navigate    = useNavigate()

  const [tab, setTab]     = useState<Tab>('vivo')
  const [local, setLocal] = useState<LocalId>('santa-teresa')

  return (
    <div className="apos">

      <div className="apos-header">
        <div className="apos-brand">
          <span className="apos-kanji">析</span>
          <div>
            <div className="apos-title">Satori</div>
            <div className="apos-sub">Analítica PoS</div>
          </div>
        </div>
        <span className="apos-spacer" />
        <span className="apos-fase">Fase A · datos simulados</span>
        {profile?.role && <span className="role-badge">{profile.role}</span>}
        <button className="cash-back-btn" onClick={() => navigate('/')}>← Inicio</button>
      </div>

      <div className="apos-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`apos-tab ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="apos-body">
        <Suspense fallback={<div className="apos-cargando"><span className="loading-mark">析</span></div>}>
          {tab === 'vivo' && <VentasEnVivo local={local} onLocalChange={setLocal} />}
        </Suspense>
      </div>
    </div>
  )
}
