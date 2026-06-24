import { describe, it, expect, vi, afterEach } from 'vitest'

import { installRealtimeReproSwitch } from './realtimeReproSwitch'
import type { DiagSupabaseClient } from './realtimeReproSwitch'

// Cliente FALSO con el contrato mínimo de DiagSupabaseClient. getSession/refreshSession
// originales son funciones distinguibles (vi.fn) para poder verificar, tras disarm, que se
// restauran EXACTAMENTE las MISMAS referencias. realtime.connect/disconnect son espías.
function makeFake() {
  const connect = vi.fn<() => void>(() => { /* noop */ })
  const disconnect = vi.fn<() => Promise<'ok' | 'timeout'>>(async () => 'ok')
  const origGetSession = vi.fn(async () => ({ data: { session: null }, error: null }))
  const origRefreshSession = vi.fn(async () => ({ data: { session: null, user: null }, error: null }))
  const client: DiagSupabaseClient = {
    auth: { getSession: origGetSession, refreshSession: origRefreshSession },
    realtime: { connect, disconnect },
  }
  return { client, connect, disconnect, origGetSession, origRefreshSession }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('realtimeReproSwitch — switch de reproducción del cuelgue (solo-staging)', () => {
  it('armZombie: getSession/refreshSession parcheados NO settlean y disconnect fue llamado', async () => {
    vi.useFakeTimers()
    const { client, disconnect } = makeFake()
    const sw = installRealtimeReproSwitch(client)

    sw.armZombie()
    expect(disconnect).toHaveBeenCalledTimes(1)   // tumbó el socket

    // Marcamos si ALGUNA de las dos promesas llega a settlear (resolver o rechazar).
    const settled = vi.fn()
    void client.auth.getSession().then(settled, settled)
    void client.auth.refreshSession().then(settled, settled)

    // Tope PROPIO del test: si en 60s no settló, es que cuelga (justo lo que queremos). Con
    // fake timers, las promesas zombi no tienen timer asociado → solo dispara este guard.
    const guard = new Promise<'timeout'>((resolve) => { setTimeout(() => resolve('timeout'), 60_000) })
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(guard).resolves.toBe('timeout')
    await Promise.resolve()                         // drena microtasks pendientes

    expect(settled).not.toHaveBeenCalled()          // NINGUNA settleó → siguen colgadas
  })

  it('armExpired: getSession resuelve session:null; refreshSession resuelve con AuthError (no timeout); disconnect llamado', async () => {
    const { client, disconnect } = makeFake()
    const sw = installRealtimeReproSwitch(client)

    sw.armExpired()
    expect(disconnect).toHaveBeenCalledTimes(1)

    // getSession COMPLETA con session:null (rama "deslogueado real", no timeout).
    const gs = await client.auth.getSession()
    expect(gs).toEqual({ data: { session: null }, error: null })

    // refreshSession RESUELVE (no cuelga) con error de auth real y session/user en null.
    const rs = await client.auth.refreshSession()
    expect(rs.data.session).toBeNull()
    expect(rs.data.user).toBeNull()
    expect(rs.error).not.toBeNull()                 // resolvió CON error → no es un cuelgue/timeout
    expect(rs.error?.name).toBe('AuthApiError')
  })

  it('disarm: getSession/refreshSession vuelven a ser EXACTAMENTE los originales y connect fue llamado', () => {
    const { client, connect, origGetSession, origRefreshSession } = makeFake()
    const sw = installRealtimeReproSwitch(client)

    sw.armZombie()
    expect(client.auth.getSession).not.toBe(origGetSession)        // armado: ya no es el original
    expect(client.auth.refreshSession).not.toBe(origRefreshSession)

    sw.disarm()
    expect(client.auth.getSession).toBe(origGetSession)            // restaurado: MISMA referencia
    expect(client.auth.refreshSession).toBe(origRefreshSession)
    expect(connect).toHaveBeenCalledTimes(1)                       // reconectó el socket
  })
})
