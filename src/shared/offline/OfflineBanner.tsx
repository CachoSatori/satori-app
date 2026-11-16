import { useEffect, useState } from 'react'
import {
  flushNow, pendingCount, initOutbox, rejectedCount, rejectedOps, getStuck, isStuck,
  requeueRejectedNow, resolveRejectedNow,
} from './outbox'
import type { RejectedOp, StuckState } from './outbox'
import { getStaleTs } from './cache'
import { avisoRechazadas, avisoTrabada, cuandoCR, queEra, motivoTexto } from './rechazadas'
import { useAuth } from '../hooks/useAuth'

/**
 * Banner global de estado offline (FASE A.b + B.c + A01):
 *  · sin red → "SIN CONEXIÓN — mostrando datos de las HH:MM · N operaciones pendientes"
 *  · con red pero cola pendiente → "N operaciones por sincronizar" + botón Sincronizar ahora
 *  · A01: operaciones que el servidor rechazó → aviso rojo + «Ver detalle» (la gerencia las resuelve)
 *  · A01: cola trabada tras varios intentos → aviso con el motivo
 * Desaparece solo cuando todo está al día.
 */
export default function OfflineBanner() {
  const { profile, user } = useAuth()
  const esGerencia = profile?.role === 'owner' || profile?.role === 'manager'
  const [online, setOnline]   = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [pending, setPending] = useState(0)
  const [rejected, setRejected] = useState(0)
  const [stuck, setStuck] = useState<StuckState>(getStuck())
  const [staleTs, setStaleTs] = useState<number | null>(getStaleTs())
  const [syncing, setSyncing] = useState(false)
  const [detalle, setDetalle] = useState<RejectedOp[] | null>(null)

  useEffect(() => {
    initOutbox()
    const onOnline  = () => setOnline(true)
    const onOffline = () => setOnline(false)
    const onPending = (e: Event) => setPending((e as CustomEvent<{ count: number }>).detail.count)
    const onRejected = (e: Event) => setRejected((e as CustomEvent<{ count: number }>).detail.count)
    const onStuck   = (e: Event) => setStuck((e as CustomEvent<StuckState>).detail)
    const onStale   = (e: Event) => setStaleTs((e as CustomEvent<{ ts: number | null }>).detail.ts)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('satori:outbox-pending', onPending)
    window.addEventListener('satori:outbox-rejected', onRejected)
    window.addEventListener('satori:outbox-stuck', onStuck)
    window.addEventListener('satori:stale-data', onStale)
    pendingCount().then(setPending).catch(() => { /* sin IDB */ })
    rejectedCount().then(setRejected).catch(() => { /* sin IDB */ })
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('satori:outbox-pending', onPending)
      window.removeEventListener('satori:outbox-rejected', onRejected)
      window.removeEventListener('satori:outbox-stuck', onStuck)
      window.removeEventListener('satori:stale-data', onStale)
    }
  }, [])

  const sync = async () => {
    setSyncing(true)
    try { await flushNow() } finally { setSyncing(false) }
  }
  const abrirDetalle = async () => setDetalle(await rejectedOps().catch(() => []))
  const recargarDetalle = async () => {
    const rs = await rejectedOps().catch(() => [])
    setDetalle(rs.length ? rs : null)
  }
  const reintentar = async (id: string) => { await requeueRejectedNow(id); await recargarDetalle() }
  const resolver = async (id: string) => {
    if (!window.confirm('¿Ya cargaste o corregiste esto a mano? Se quita de la lista y queda registrado en este aparato.')) return
    await resolveRejectedNow(id, user?.id ?? null); await recargarDetalle()
  }

  const trabada = pending > 0 && isStuck(stuck)
  if (online && pending === 0 && rejected === 0) return null

  const hora = staleTs ? new Date(staleTs).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }) : null
  const btn = { background: '#fff', border: 'none', borderRadius: 3, padding: '2px 10px', fontSize: '11px', fontWeight: 800, cursor: 'pointer' } as const
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 99998,
      display: 'flex', flexDirection: 'column', boxShadow: '0 -2px 8px rgba(0,0,0,.35)',
    }}>
      {rejected > 0 && (
        <div role="alert" style={{ background: '#a12a2a', color: '#fff', textAlign: 'center', fontSize: '12px', fontWeight: 700, padding: '5px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span>⛔ {avisoRechazadas(rejected)}</span>
          <button onClick={abrirDetalle} style={{ ...btn, color: '#a12a2a' }}>Ver detalle</button>
        </div>
      )}
      {trabada && (
        <div role="status" style={{ background: '#7a4a10', color: '#fff', textAlign: 'center', fontSize: '12px', fontWeight: 700, padding: '5px 8px' }}>
          ⚠ {avisoTrabada(stuck)}
        </div>
      )}
      {(!online || pending > 0) && (
        <div style={{
          background: online ? '#a07830' : '#444', color: '#fff', textAlign: 'center',
          fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em',
          padding: '5px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem',
        }}>
          {!online && <span>📡 SIN CONEXIÓN{hora ? ` — mostrando datos de las ${hora}` : ''}</span>}
          {pending > 0 && <span>{pending} {pending !== 1 ? 'operaciones' : 'operación'} pendiente{pending !== 1 ? 's' : ''} de sincronizar</span>}
          {online && pending > 0 && (
            <button onClick={sync} disabled={syncing} style={{ ...btn, color: '#a07830' }}>
              {syncing ? 'Sincronizando…' : '⟳ Sincronizar ahora'}
            </button>
          )}
        </div>
      )}
      {detalle && (
        <div role="dialog" aria-label="Operaciones rechazadas" style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 99999,
        }}>
          <div style={{ background: '#1c1c1c', color: '#eee', borderRadius: 8, maxWidth: 560, width: '100%', maxHeight: '80vh', overflowY: 'auto', padding: '1rem', fontSize: '13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <strong>Operaciones que el servidor rechazó</strong>
              <button onClick={() => setDetalle(null)} style={{ ...btn, color: '#333' }}>Cerrar</button>
            </div>
            <p style={{ margin: '0 0 0.75rem', color: '#bbb' }}>
              Estas operaciones NO quedaron guardadas en el sistema. Siguen en este aparato hasta que la gerencia las resuelva.
              {!esGerencia && ' Solo un encargado o el dueño puede resolverlas.'}
            </p>
            {detalle.length === 0 && <p>No hay operaciones rechazadas.</p>}
            {detalle.map(r => (
              <div key={r.client_op_id} style={{ borderTop: '1px solid #333', padding: '0.5rem 0' }}>
                <div><strong>Qué:</strong> {queEra(r)}</div>
                <div><strong>Cuándo:</strong> registrada {cuandoCR(r.created_at)} · rechazada {cuandoCR(r.rejected_at)}</div>
                <div><strong>Motivo:</strong> {motivoTexto(r)}</div>
                {esGerencia && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
                    <button onClick={() => reintentar(r.client_op_id)} style={{ ...btn, color: '#333' }}>↻ Reintentar</button>
                    <button onClick={() => resolver(r.client_op_id)} style={{ ...btn, color: '#333' }}>✓ Ya lo resolví</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
