import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { supabase } from '../../shared/api/supabase'
import { canCloseShift, type Turno } from '../../shared/utils/posPricing'

/** Mi Turno — métricas PROPIAS del salonero + cierre de turno.
 *  Los números salen del RPC `my_turno_stats` (SECURITY DEFINER, mig 026) que
 *  computa exclusivamente auth.uid(): garantía estructural de que cada quien ve
 *  SOLO lo suyo (no existe forma de pedirle datos de otro salonero).
 *  El cierre respeta canCloseShift: el último turno NO cierra con mesas abiertas. */
interface TurnoStats {
  date: string
  ventas_crc: number
  mesas: number
  pax: number
  ticket_mesa: number
  ticket_pax: number
  propinas_crc: number
  mesas_abiertas: string[]
}

const fmt = (n: number) => '₡' + Math.round(n).toLocaleString('es-CR')

export default function MiTurno() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [stats, setStats] = useState<TurnoStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [turno, setTurno] = useState<Turno>('noche')
  const [showCierre, setShowCierre] = useState(false)

  const load = useCallback(async () => {
    const rpc = supabase.rpc.bind(supabase) as unknown as
      (fn: string, args?: Record<string, unknown>) => Promise<{ data: TurnoStats | null; error: { message: string } | null }>
    const { data, error } = await rpc('my_turno_stats')
    if (error) { setError(error.message); return }
    setStats(data)
  }, [])
  useEffect(() => { load() }, [load])

  const abiertas = stats?.mesas_abiertas ?? []
  const cierre = canCloseShift(turno, abiertas)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--t-paper,#f5f1e8)', padding: '0.75rem', maxWidth: 560, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.6rem', color: '#c8a96e' }}>人</span>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '1.05rem', margin: 0 }}>Mi Turno</h1>
          <div style={{ fontSize: '0.7rem', color: '#5a5040' }}>{profile?.full_name} · {stats?.date ?? 'hoy'}</div>
        </div>
        <button onClick={() => navigate('/comandero')}
          style={{ background: 'none', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 3, padding: '4px 10px', cursor: 'pointer', color: '#5a5040', fontSize: '0.78rem' }}>卓 Comandero</button>
      </header>

      {error && <div style={{ color: '#c0392b', fontSize: '0.85rem', marginBottom: 8 }} onClick={() => setError(null)}>⚠ {error}</div>}
      {!stats && !error && <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>Cargando tus números…</div>}

      {stats && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: '0.75rem' }}>
            <Card label="Mis ventas de hoy" value={fmt(stats.ventas_crc)} big />
            <Card label="Mis propinas de hoy" value={fmt(stats.propinas_crc)} big />
            <Card label="Mesas atendidas" value={String(stats.mesas)} />
            <Card label="Personas (pax)" value={String(stats.pax)} />
            <Card label="Ticket promedio · mesa" value={fmt(stats.ticket_mesa)} />
            <Card label="Ticket promedio · pax" value={fmt(stats.ticket_pax)} />
          </div>
          <div style={{ fontSize: '0.66rem', color: '#8a8378', marginBottom: '1rem' }}>
            Solo ves TUS números (las mesas transferidas cuentan para quien las recibió).
            Las propinas aparecen cuando el encargado cierra el pool del día.
          </div>

          <div style={{ background: '#fff', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 8, padding: '0.875rem' }}>
            <div style={{ fontWeight: 800, fontSize: '0.92rem', marginBottom: 6 }}>🔒 Cierre de mi turno</div>
            <div style={{ fontSize: '0.78rem', color: '#5a5040', marginBottom: 8 }}>
              {abiertas.length
                ? <>Tenés <strong>{abiertas.length} mesa(s) abierta(s)</strong>: {abiertas.join(', ')}</>
                : 'No tenés mesas abiertas.'}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['mañana', 'noche'] as Turno[]).map(t => (
                <button key={t} onClick={() => { setTurno(t); setShowCierre(true) }}
                  style={{ flex: 1, padding: '10px', borderRadius: 5, cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                    border: '1px solid var(--t-border,#d4cfc4)',
                    background: showCierre && turno === t ? '#0d0d0d' : '#fff',
                    color: showCierre && turno === t ? '#c8a96e' : '#5a5040' }}>
                  {t === 'mañana' ? '☀️ Cierro turno mañana' : '🌙 Cierro último turno'}
                </button>
              ))}
            </div>
            {showCierre && (
              <div style={{ padding: '0.6rem', borderRadius: 5, fontSize: '0.82rem', fontWeight: 600,
                background: cierre.ok ? 'rgba(42,122,106,.12)' : 'rgba(194,59,34,.1)',
                color: cierre.ok ? '#1f6f3f' : '#c23b22',
                border: `1px solid ${cierre.ok ? '#2a7a6a' : '#c23b22'}` }}>
                {cierre.ok ? '✓ ' : '⛔ '}{cierre.message}
                {!cierre.ok && <div style={{ fontWeight: 400, marginTop: 4 }}>Cerralas o transferilas desde el Comandero antes de irte.</div>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Card({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 8, padding: '0.75rem' }}>
      <div style={{ fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#8a8378' }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: big ? '1.45rem' : '1.1rem', fontFamily: 'var(--font-serif)', marginTop: 2 }}>{value}</div>
    </div>
  )
}
