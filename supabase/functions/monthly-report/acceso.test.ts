// SEC-02b: la guarda de monthly-report. Corre bajo vitest (env node), como pool.test.ts.
// Contra `main` antes de este PR fallan: no existe acceso.ts y el handler no tiene guarda (el
// test estático de abajo lo detecta en index.ts).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  corsHeaders, decidirAcceso, destinatarioReporte, igualConstante, mesValido, respuestaOk, validarParametros, type DepsAcceso,
} from './acceso'

const SERVICE = 'service-role-de-prueba'
const OWNER_ACTIVO = 'u-owner', OWNER_INACTIVO = 'u-owner-inactivo', MANAGER = 'u-manager', CAJERO = 'u-cajero'
const TOKENS: Record<string, string> = {
  'jwt-owner': OWNER_ACTIVO, 'jwt-owner-inactivo': OWNER_INACTIVO, 'jwt-manager': MANAGER, 'jwt-cajero': CAJERO,
}

function deps(over: Partial<DepsAcceso> = {}): DepsAcceso {
  return {
    serviceKey: SERVICE,
    esServiceRole: async (t) => t === 'sb_secret_nueva_de_prueba',   // una clave nueva validada por el servidor
    usuarioDeToken: async (t) => TOKENS[t] ?? null,                    // la anon key no es un usuario
    esOwnerActivo: async (id) => id === OWNER_ACTIVO,
    ...over,
  }
}

describe('decidirAcceso', () => {
  it('sin token → 401', async () => {
    expect(await decidirAcceso(null, deps())).toMatchObject({ ok: false, status: 401 })
    expect(await decidirAcceso('', deps())).toMatchObject({ ok: false, status: 401 })
    expect(await decidirAcceso('Basic abc', deps())).toMatchObject({ ok: false, status: 401 })
    expect(await decidirAcceso('Bearer    ', deps())).toMatchObject({ ok: false, status: 401 })
  })

  it('anon key (u otro token que no es un usuario) → 401', async () => {
    expect(await decidirAcceso('Bearer anon-key-publica', deps())).toMatchObject({ ok: false, status: 401, code: 'sin_sesion' })
  })

  it('manager, cajero y owner inactivo → 403', async () => {
    for (const t of ['jwt-manager', 'jwt-cajero', 'jwt-owner-inactivo']) {
      expect(await decidirAcceso(`Bearer ${t}`, deps()), t).toMatchObject({ ok: false, status: 403, code: 'no_autorizado' })
    }
  })

  it('service_role del entorno (el cron) y clave nueva validada por el servidor → ok', async () => {
    expect(await decidirAcceso(`Bearer ${SERVICE}`, deps())).toEqual({ ok: true, quien: 'service_role' })
    expect(await decidirAcceso('Bearer sb_secret_nueva_de_prueba', deps())).toEqual({ ok: true, quien: 'service_role' })
  })

  it('owner activo → ok', async () => {
    expect(await decidirAcceso('Bearer jwt-owner', deps())).toEqual({ ok: true, quien: `owner:${OWNER_ACTIVO}` })
  })

  it('si falla la consulta del owner → 500 fijo, sin detalle', async () => {
    const r = await decidirAcceso('Bearer jwt-owner', deps({ esOwnerActivo: async () => 'error' }))
    expect(r).toEqual({ ok: false, status: 500, code: 'interno', error: 'No se pudo generar el reporte' })
  })

  it('si las dependencias tiran, no deja pasar', async () => {
    const tira = async () => { throw new Error('red') }
    expect(await decidirAcceso('Bearer jwt-owner', deps({ esServiceRole: tira, usuarioDeToken: tira }))).toMatchObject({ ok: false, status: 401 })
  })
})

describe('validarParametros', () => {
  const ahora = new Date('2026-11-07T18:00:00Z')
  it('mes, tipo y dry_run válidos', () => {
    expect(validarParametros({ month: '2026-10', tipo: 'ventas', dry_run: true }, ahora)).toEqual({ ok: true, ym: '2026-10', tipo: 'ventas', dry: true })
    expect(validarParametros({}, ahora)).toEqual({ ok: true, ym: '2026-10', tipo: 'ambos', dry: false })
  })
  it('mes inválido, futuro o anterior a 2024 → 400', () => {
    for (const month of ['2026-13', '2026-12', '2023-12', 'basura', 202610]) {
      expect(validarParametros({ month }, ahora), String(month)).toMatchObject({ ok: false, status: 400, code: 'mes' })
    }
  })
  it('tipo inválido o dry_run no booleano → 400', () => {
    expect(validarParametros({ tipo: 'todo' }, ahora)).toMatchObject({ ok: false, status: 400, code: 'tipo' })
    expect(validarParametros({ dry_run: 'si' }, ahora)).toMatchObject({ ok: false, status: 400, code: 'dry_run' })
    expect(validarParametros(null, ahora)).toMatchObject({ ok: false, status: 400 })
  })
  it('mesValido acepta el mes en curso', () => {
    expect(mesValido('2026-11', '2026-11')).toBe(true)
  })
})

describe('respuesta 200 (dry_run) sin montos ni nombres', () => {
  it('solo mes, modo seco y qué se envió', () => {
    const r = respuestaOk('Octubre', 2026, true, ['ventas'], ['propinas'])
    expect(r).toEqual({ ok: true, month: 'Octubre 2026', dry_run: true, enviados: ['ventas'], sin_datos: ['propinas'] })
    const texto = JSON.stringify(r)
    expect(texto).not.toMatch(/₡|\d{4,}(?!\b)|total|pool|nombre|irs|top/i)
  })
})

describe('CORS', () => {
  it('prod y staging con el header; otro origen sin él', () => {
    expect(corsHeaders('https://cachosatori.github.io')['Access-Control-Allow-Origin']).toBe('https://cachosatori.github.io')
    expect(corsHeaders('https://abc123.satori-staging.pages.dev')['Access-Control-Allow-Origin']).toBe('https://abc123.satori-staging.pages.dev')
    expect(corsHeaders('https://otro.example')['Access-Control-Allow-Origin']).toBeUndefined()
    expect(corsHeaders(null)['Access-Control-Allow-Origin']).toBeUndefined()
  })
})

describe('igualConstante', () => {
  it('compara exacto', () => {
    expect(igualConstante('abc', 'abc')).toBe(true)
    expect(igualConstante('abc', 'abd')).toBe(false)
    expect(igualConstante('abc', 'abcd')).toBe(false)
  })
})

describe('index.ts usa la guarda (estático)', () => {
  const src = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  const handler = src.slice(src.indexOf('Deno.serve('))
  it('decide el acceso ANTES de calcular nada', () => {
    const iAcceso = handler.indexOf('decidirAcceso(')
    expect(iAcceso).toBeGreaterThan(-1)
    expect(iAcceso).toBeLessThan(handler.indexOf('calcVentas('))
    expect(iAcceso).toBeLessThan(handler.indexOf('calcPropinas('))
  })
  it('sin CORS abierto a cualquiera y sin montos en la respuesta', () => {
    expect(src).not.toMatch(/'Access-Control-Allow-Origin':\s*'\*'/)
    expect(handler).not.toMatch(/fi\(v\.total\)|fi\(p\.pool\)|topSal/)
  })
})

describe('destinatario del reporte (sin correo real en el código)', () => {
  it('sale solo del secreto; sin secreto o inválido → null (no se manda)', () => {
    expect(destinatarioReporte(' reportes@ejemplo.test ')).toBe('reportes@ejemplo.test')
    expect(destinatarioReporte(undefined)).toBeNull()
    expect(destinatarioReporte('')).toBeNull()
    expect(destinatarioReporte('no-es-un-correo')).toBeNull()
  })

  it('monthly-report y cierre-email no tienen correos fijos (salvo el remitente genérico de Resend)', () => {
    for (const f of ['../monthly-report/index.ts', '../cierre-email/index.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8')
      const correos = (src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [])
        .filter(c => c !== 'onboarding@resend.dev')
      expect(correos, f).toEqual([])
    }
  })

  it('monthly-report frena el envío real sin destinatario (el modo seco sigue)', () => {
    const src = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    expect(src).toMatch(/if \(!dry && !TO_EMAIL\) return falla\(/)
  })
})
