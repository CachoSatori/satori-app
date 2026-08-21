import { describe, it, expect, vi } from 'vitest'
import { pushIngest, type FetchLike } from './pushIngest.js'
import type { BridgeConfig } from './config.js'
import type { IngestPunch } from './fetchPunches.js'

// F1c: el contrato con la Edge Function. El secreto va en el header (la función corre con
// --no-verify-jwt, no hay Authorization), y un 4xx NO se reintenta.

const CFG: BridgeConfig = {
  local: 'santa-teresa',
  biotimeHost: '127.0.0.1', biotimePort: 7496, biotimeDb: 'Satori',
  biotimeUser: 'satori_ro', biotimePassword: 'x',
  ingestUrl: 'https://ejemplo.supabase.co/functions/v1/ingest-punches',
  ingestSecret: 'secreto-largo',
  pollIntervalMs: 120_000, batchSize: 200, stateFile: './.bridge-state.json',
}

const PUNCH: IngestPunch = {
  biotime_id: 4821, emp_code: '17', punch_time: '2026-08-22T04:30:00.000Z',
  punch_state: '0', terminal: 'RELOJ-ST', raw: {},
}

const OK = {
  ok: true, local: 'santa-teresa', received: 1, inserted: 1,
  duplicates: 0, unmapped: 0, unknown_state: 0, invalid: 0,
}

const respuesta = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response

describe('pushIngest · POST al edge', () => {
  it('manda { local, punches } con x-ingest-secret y sin Authorization', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => respuesta(OK))
    const res = await pushIngest(CFG, [PUNCH], fetchImpl)

    expect(res.inserted).toBe(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(CFG.ingestUrl)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['x-ingest-secret']).toBe('secreto-largo')
    expect(headers['content-type']).toBe('application/json')
    expect(Object.keys(headers).map(h => h.toLowerCase())).not.toContain('authorization')
    expect(JSON.parse(String(init.body))).toEqual({ local: 'santa-teresa', punches: [PUNCH] })
  })

  it('un 5xx se reintenta una vez y sale bien', async () => {
    const fetchImpl = vi.fn<FetchLike>()
      .mockResolvedValueOnce(respuesta({ ok: false }, 503))
      .mockResolvedValueOnce(respuesta(OK))
    await expect(pushIngest(CFG, [PUNCH], fetchImpl)).resolves.toMatchObject({ inserted: 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('un 401 (secreto equivocado) NO se reintenta: tira y se ve', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => respuesta({ ok: false, error: 'No autorizado' }, 401))
    await expect(pushIngest(CFG, [PUNCH], fetchImpl)).rejects.toThrow(/401/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('si la red falla las dos veces, tira (el ciclo NO avanza el last_id)', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => { throw new Error('ECONNREFUSED') })
    await expect(pushIngest(CFG, [PUNCH], fetchImpl)).rejects.toThrow(/ECONNREFUSED/)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('un 200 con ok:false se trata como fallo', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => respuesta({ ok: false, error: 'raro' }))
    await expect(pushIngest(CFG, [PUNCH], fetchImpl)).rejects.toThrow(/inesperada/i)
  }, 10_000)
})
