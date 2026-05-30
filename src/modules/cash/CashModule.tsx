import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import {
  getOpenCashSession,
  getCashSessions,
  getAllCashMovements,
  getSuppliers,
} from '../../shared/api/cash'
import type { CashSession, CashMovement, Supplier } from '../../shared/types/database'
import CashTurno from './CashTurno'
import CashMovimientos from './CashMovimientos'
import CashProveedores from './CashProveedores'
import CashPendientes from './CashPendientes'
import CashResumen from './CashResumen'

type Tab = 'turno' | 'movimientos' | 'proveedores' | 'pendientes' | 'resumen'

function getTabs(role: string): { id: Tab; label: string }[] {
  if (role === 'cajero') return [
    { id: 'turno',       label: 'Caja Diaria' },
    { id: 'pendientes',  label: 'Pendientes' },
  ]
  if (role === 'contador') return [
    { id: 'movimientos', label: 'Movimientos' },
    { id: 'proveedores', label: 'Proveedores' },
    { id: 'pendientes',  label: 'Pendientes' },
    { id: 'resumen',     label: 'Resumen' },
  ]
  // owner / manager
  return [
    { id: 'turno',       label: 'Caja Diaria' },
    { id: 'movimientos', label: 'Movimientos' },
    { id: 'proveedores', label: 'Proveedores' },
    { id: 'pendientes',  label: 'Pendientes' },
    { id: 'resumen',     label: 'Resumen' },
  ]
}

export default function CashModule() {
  const { profile } = useAuth()
  const navigate    = useNavigate()

  const tabs    = getTabs(profile?.role ?? 'cajero')
  const [tab, setTab]           = useState<Tab>(tabs[0].id)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  // Data
  const [openSession, setOpenSession]     = useState<CashSession | null>(null)
  const [sessions, setSessions]           = useState<CashSession[]>([])
  const [allMovements, setAllMovements]   = useState<CashMovement[]>([])
  const [suppliers, setSuppliers]         = useState<Supplier[]>([])

  const pendCount = allMovements.filter(m => m.status === 'pendiente').length

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [open, all, supps, allMovs] = await Promise.all([
        getOpenCashSession(),
        getCashSessions(),
        getSuppliers(),
        getAllCashMovements(),
      ])
      setOpenSession(open)
      setSessions(all)
      setSuppliers(supps)
      setAllMovements(allMovs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const handleSessionOpen = (s: CashSession) => {
    setOpenSession(s)
    setSessions(prev => [s, ...prev])
  }
  const handleSessionClose = () => {
    setOpenSession(null)
    loadAll()
  }
  const handleMovAdded = (m: CashMovement) => {
    setAllMovements(prev => [m, ...prev])
  }
  if (loading) {
    return (
      <div className="module-loading">
        <span className="loading-mark">金</span>
      </div>
    )
  }

  return (
    <div className="tips-module">
      {/* Header */}
      <div className="cd-module-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="tips-kanji" style={{ fontSize: '1.6rem' }}>金</span>
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--t-ink)' }}>Caja</div>
            <div style={{ fontSize: '0.72rem', letterSpacing: '0.15em', color: '#888', textTransform: 'uppercase' }}>
              Satori · Santa Teresa
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="cash-back-btn" onClick={() => navigate('/')}>← Inicio</button>
        </div>
      </div>

      {/* Nav tabs */}
      <div className="cd-nav-tabs">
        {tabs.map(t => (
          <div
            key={t.id}
            className={`cd-nav-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'pendientes' && pendCount > 0 && (
              <span className="cd-pend-badge">{pendCount}</span>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="tips-error" style={{ margin: '0.75rem 1.5rem' }}>
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Tab content */}
      <div className="cd-content">
        {tab === 'turno' && (
          <CashTurno
            openSession={openSession}
            suppliers={suppliers}
            sessions={sessions}
            sessionMovements={openSession
              ? allMovements.filter(m => m.session_id === openSession.id)
              : []}
            onSessionOpen={handleSessionOpen}
            onSessionClose={handleSessionClose}
            onMovAdded={handleMovAdded}
            onError={setError}
          />
        )}
        {tab === 'movimientos' && (
          <CashMovimientos
            movements={allMovements}
            sessions={sessions}
            onRefresh={loadAll}
          />
        )}
        {tab === 'proveedores' && (
          <CashProveedores
            suppliers={suppliers}
            movements={allMovements}
            onRefresh={loadAll}
          />
        )}
        {tab === 'pendientes' && (
          <CashPendientes
            movements={allMovements}
            sessions={sessions}
            onRefresh={loadAll}
          />
        )}
        {tab === 'resumen' && (
          <CashResumen
            movements={allMovements}
            sessions={sessions}
          />
        )}
      </div>
    </div>
  )
}
