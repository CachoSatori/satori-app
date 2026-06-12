import { useEffect, useState } from 'react'
import { flushNow, pendingCount, initOutbox } from './outbox'
import { getStaleTs } from './cache'

/**
 * Banner global de estado offline (FASE A.b + B.c):
 *  · sin red → "SIN CONEXIÓN — mostrando datos de las HH:MM · N operaciones pendientes"
 *  · con red pero cola pendiente → "N operaciones por sincronizar" + botón Sincronizar ahora
 * Discreto (franja fina abajo del header), desaparece solo cuando todo está al día.
 */
export default function OfflineBanner() {
  const [online, setOnline]   = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [pending, setPending] = useState(0)
  const [staleTs, setStaleTs] = useState<number | null>(getStaleTs())
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    initOutbox()
    const onOnline  = () => setOnline(true)
    const onOffline = () => setOnline(false)
    const onPending = (e: Event) => setPending((e as CustomEvent<{ count: number }>).detail.count)
    const onStale   = (e: Event) => setStaleTs((e as CustomEvent<{ ts: number | null }>).detail.ts)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('satori:outbox-pending', onPending)
    window.addEventListener('satori:stale-data', onStale)
    pendingCount().then(setPending).catch(() => { /* sin IDB */ })
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('satori:outbox-pending', onPending)
      window.removeEventListener('satori:stale-data', onStale)
    }
  }, [])

  const sync = async () => {
    setSyncing(true)
    try { await flushNow() } finally { setSyncing(false) }
  }

  if (online && pending === 0) return null

  const hora = staleTs ? new Date(staleTs).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }) : null
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 99998,
      background: online ? '#a07830' : '#444', color: '#fff', textAlign: 'center',
      fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em',
      padding: '5px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem',
      boxShadow: '0 -2px 8px rgba(0,0,0,.35)',
    }}>
      {!online && <span>📡 SIN CONEXIÓN{hora ? ` — mostrando datos de las ${hora}` : ''}</span>}
      {pending > 0 && <span>{pending} operación{pending !== 1 ? 'es' : ''} pendiente{pending !== 1 ? 's' : ''} de sincronizar</span>}
      {online && pending > 0 && (
        <button onClick={sync} disabled={syncing}
          style={{ background: '#fff', color: '#a07830', border: 'none', borderRadius: 3, padding: '2px 10px', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}>
          {syncing ? 'Sincronizando…' : '⟳ Sincronizar ahora'}
        </button>
      )}
    </div>
  )
}
