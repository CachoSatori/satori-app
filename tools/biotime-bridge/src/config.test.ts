import { describe, it, expect } from 'vitest'
import { loadConfig, type Env } from './config.js'

// F1c: la config es lo único que distingue una PC de la otra. Un LOCAL equivocado le
// acredita las horas al local que no es, y el id incremental es POR local.

const BASE: Env = {
  LOCAL: 'santa-teresa',
  BIOTIME_PASSWORD: 'clave-ro',
  INGEST_URL: 'https://hwiatgicyyqyezqwldia.supabase.co/functions/v1/ingest-punches',
  INGEST_SECRET: 'secreto',
}

describe('loadConfig', () => {
  it('completa los valores por defecto del .env.example', () => {
    const c = loadConfig(BASE)
    expect(c).toMatchObject({
      local: 'santa-teresa', biotimeHost: '127.0.0.1', biotimePort: 7496,
      biotimeDb: 'Satori', biotimeUser: 'satori_ro',
      pollIntervalMs: 120_000, batchSize: 200, stateFile: './.bridge-state.json',
    })
  })

  it('LOCAL fuera de la lista no arranca', () => {
    expect(() => loadConfig({ ...BASE, LOCAL: 'santateresa' })).toThrow(/LOCAL inválido/)
    expect(() => loadConfig({ ...BASE, LOCAL: undefined })).toThrow(/Falta LOCAL/)
    expect(loadConfig({ ...BASE, LOCAL: 'nosara' }).local).toBe('nosara')
  })

  it('sin clave de satori_ro o sin INGEST_SECRET no arranca', () => {
    expect(() => loadConfig({ ...BASE, BIOTIME_PASSWORD: '' })).toThrow(/BIOTIME_PASSWORD/)
    expect(() => loadConfig({ ...BASE, INGEST_SECRET: undefined })).toThrow(/INGEST_SECRET/)
  })

  it('el edge tiene que ser https: el secreto viaja en un header', () => {
    expect(() => loadConfig({ ...BASE, INGEST_URL: 'http://ejemplo.com/x' })).toThrow(/https/)
  })

  it('los números del .env se validan', () => {
    expect(() => loadConfig({ ...BASE, BATCH_SIZE: '0' })).toThrow(/BATCH_SIZE/)
    expect(() => loadConfig({ ...BASE, POLL_INTERVAL_MS: 'dos minutos' })).toThrow(/POLL_INTERVAL_MS/)
    expect(loadConfig({ ...BASE, BATCH_SIZE: '500' }).batchSize).toBe(500)
  })
})
