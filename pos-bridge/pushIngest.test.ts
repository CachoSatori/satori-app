import { describe, it, expect, vi } from 'vitest'

import { pushIngest, type FetchLike } from './pushIngest.ts'
import { loadAgenteConfig, describirAgente, FIRMA_PROD } from './configAgente.ts'
import type { Env } from './config.ts'
import type { PayloadIngest } from '../src/shared/ndf/ingestNdf'

const DESTINO = { ingestUrl: 'https://x.supabase.co/functions/v1/ingest-ndf', ingestSecret: 'secreto-largo' }
const PAYLOAD: PayloadIngest = { local: 'santa-teresa', tickets: [] }

const CUERPO_OK = {
  ok: true, local: 'santa-teresa', tickets_recibidos: 0, tickets_guardados: 0,
  lineas_guardadas: 0, open_guardadas: 0, open_borradas: 0, invalid: 0, recalculados: 0,
  problemas: [], cursor: { local: 'santa-teresa', last_factura: '5001', last_fecha_registra: null, last_poll_at: null, last_error: null },
}

// Cada llamada arma su propia Response: el body de una Response se lee UNA sola vez.
const respuesta = (status: number, cuerpo: unknown = CUERPO_OK) => (): Response =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })

const falla = (mensaje: string) => (): never => { throw new Error(mensaje) }

function espia(respuestas: (() => Response)[]): { fetch: FetchLike; llamadas: RequestInit[] } {
  const llamadas: RequestInit[] = []
  let i = 0
  const fetch: FetchLike = async (_url, init) => {
    llamadas.push(init)
    return respuestas[Math.min(i++, respuestas.length - 1)]()
  }
  return { fetch, llamadas }
}

/**
 * Corre algo que va a esperar el back-off del reintento (3 s) sin gastarlos de verdad:
 * el reloj se adelanta a mano. Los tests tienen que ser rápidos o se dejan de correr.
 */
async function sinEsperar<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers()
  try {
    const p = fn()
    // El rechazo puede llegar ANTES del `await` de abajo; sin este catch al vuelo,
    // Node lo reporta como "unhandled rejection" aunque el test sí lo espere.
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(10_000)
    return await p
  } finally {
    vi.useRealTimers()
  }
}

describe('pushIngest', () => {
  it('manda el secreto en el header y devuelve el cursor guardado', async () => {
    const { fetch, llamadas } = espia([respuesta(200)])
    const r = await pushIngest(DESTINO, PAYLOAD, fetch)

    expect(llamadas[0].method).toBe('POST')
    expect((llamadas[0].headers as Record<string, string>)['x-ingest-secret']).toBe('secreto-largo')
    expect(r.cursor.last_factura).toBe('5001')
  })

  it('reintenta UNA vez ante un 5xx (puede ser pasajero)', async () => {
    const { fetch, llamadas } = espia([respuesta(503, { ok: false }), respuesta(200)])
    await expect(sinEsperar(() => pushIngest(DESTINO, PAYLOAD, fetch))).resolves.toMatchObject({ ok: true })
    expect(llamadas).toHaveLength(2)
  })

  it('reintenta ante un fallo de red', async () => {
    const { fetch, llamadas } = espia([falla('ECONNRESET'), respuesta(200)])
    await expect(sinEsperar(() => pushIngest(DESTINO, PAYLOAD, fetch))).resolves.toMatchObject({ ok: true })
    expect(llamadas).toHaveLength(2)
  })

  it('NO reintenta un 4xx: reintentar no lo arregla y taparía el problema', async () => {
    const { fetch, llamadas } = espia([respuesta(401, { ok: false, error: 'No autorizado' })])
    await expect(pushIngest(DESTINO, PAYLOAD, fetch)).rejects.toThrow(/rechazó el lote \(401\)/)
    expect(llamadas).toHaveLength(1)
  })

  it('una respuesta con forma rara tampoco se reintenta', async () => {
    const { fetch, llamadas } = espia([respuesta(200, { cualquiera: 1 })])
    await expect(pushIngest(DESTINO, PAYLOAD, fetch)).rejects.toThrow(/Respuesta inesperada/)
    expect(llamadas).toHaveLength(1)
  })

  it('tira (no devuelve ok) si se agotan los reintentos', async () => {
    const { fetch } = espia([falla('timeout')])
    await expect(sinEsperar(() => pushIngest(DESTINO, PAYLOAD, fetch))).rejects.toThrow('timeout')
  })
})

// ── Configuración del agente ───────────────────────────────────────────────────

const ENV_OK: Env = {
  POS_DB_HOST: 'DESKTOP-25PRDR1\\SQLNUBE', POS_DB_PORT: '1433',
  POS_DB_USER: 'ClienteConsulta', POS_DB_PASSWORD: 'clave',
  LOCAL: 'santa-teresa', ENV: 'staging',
  INGEST_URL: 'https://hwiatgicyyqyezqwldia.supabase.co/functions/v1/ingest-ndf',
  INGEST_SECRET: 'secreto-largo',
}

describe('loadAgenteConfig', () => {
  it('arma la config con el ritmo por defecto', () => {
    const cfg = loadAgenteConfig(ENV_OK)
    expect(cfg.local).toBe('santa-teresa')
    expect(cfg.entorno).toBe('staging')
    expect(cfg.ritmo).toEqual({ ventana: { inicio: 10, fin: 2 }, operacionMs: 75_000, madrugadaMs: 300_000 })
    expect(cfg.ventanaHoras).toBe(36)
    expect(cfg.pos.user).toBe('ClienteConsulta')
  })

  it('SOLO staging: producción necesita firma explícita', () => {
    expect(() => loadAgenteConfig({ ...ENV_OK, ENV: 'production' })).toThrow(/STAGING/)
    expect(loadAgenteConfig({ ...ENV_OK, ENV: 'production', [FIRMA_PROD]: '2026-09-05' }).entorno)
      .toBe('production')
  })

  it('el secreto viaja en un header: sin https no arranca', () => {
    expect(() => loadAgenteConfig({ ...ENV_OK, INGEST_URL: 'http://x/y' })).toThrow(/https/)
  })

  it('exige local conocido, URL y secreto', () => {
    expect(() => loadAgenteConfig({ ...ENV_OK, LOCAL: 'jaco' })).toThrow(/LOCAL inválido/)
    expect(() => loadAgenteConfig({ ...ENV_OK, INGEST_URL: '' })).toThrow(/INGEST_URL/)
    expect(() => loadAgenteConfig({ ...ENV_OK, INGEST_SECRET: '' })).toThrow(/INGEST_SECRET/)
  })

  it('hereda el candado del PoS: el admin no se usa jamás', () => {
    expect(() => loadAgenteConfig({ ...ENV_OK, POS_DB_USER: 'ciosa' })).toThrow(/administrativo/)
  })

  it('valida el ritmo y la ventana horaria', () => {
    expect(() => loadAgenteConfig({ ...ENV_OK, POLL_OPERACION_MS: '1000' })).toThrow(/POLL_OPERACION_MS/)
    expect(() => loadAgenteConfig({ ...ENV_OK, HORA_APERTURA: '99' })).toThrow(/HORA_APERTURA/)
  })

  it('describirAgente NUNCA imprime la clave del PoS ni el secreto del Edge', () => {
    const linea = describirAgente(loadAgenteConfig(ENV_OK))
    expect(linea).not.toContain('clave')
    expect(linea).not.toContain('secreto-largo')
    expect(linea).toContain('local=santa-teresa')
    expect(linea).toContain('entorno=staging')
  })
})
