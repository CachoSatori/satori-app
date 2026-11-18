// Flujo de cierre-email sin red: el portón es el RLS del cierre (con el JWT del usuario); el resumen
// (service_role, opción B) corre SOLO si el usuario ve el cierre y es reciente; la respuesta no trae
// montos ni nombres; si el resumen falla, el correo sale igual. Datos FICTICIOS.
import { describe, it, expect } from 'vitest'
import * as edge from './ventasPos.gen.js'
import { procesarCierre, type CierreFila, type DepsCierre } from './proceso.ts'
import { resumenParaCierre, type LogicaResumen } from './resumen.ts'
import { cierreCuadraEjemplo } from './plantilla.ejemplo.ts'
import { diaFicticio } from './pruebas.fixtures.ts'

const AHORA = new Date('2026-11-16T05:40:00Z')   // 15-nov 23:40 CR
const CIERRE: CierreFila = { ...cierreCuadraEjemplo, tipo: 'completo', created_at: '2026-11-16T05:35:00Z', location_id: 'santa-teresa' }
const NOMBRE = 'NOMBRE FICTICIO UNO'

function deps(over: Partial<DepsCierre> = {}, cierre: CierreFila | null = CIERRE, errorRls: unknown = null) {
  const lecturasPos: string[] = []
  const enviados: { subject: string; html: string }[] = []
  const logs: Record<string, unknown>[] = []
  const d: DepsCierre = {
    hayToken: true,
    usuarioValido: async () => true,
    hayResend: true,
    hayDestinatario: true,
    hayRemitente: true,
    leerCierre: async () => ({ data: cierre, error: errorRls }),
    resumen: (c) => resumenParaCierre(c, {
      logica: edge as unknown as LogicaResumen,
      leerVentana: async (dia) => { lecturasPos.push(dia); return diaFicticio(dia) },
      leerNombres: async () => ({ '901': NOMBRE }),
      ahora: AHORA,
    }),
    enviar: async (subject, html) => { enviados.push({ subject, html }); return { ok: true, id: 'id-ficticio' } },
    log: (o) => { logs.push(o) },
    ...over,
  }
  return { d, lecturasPos, enviados, logs }
}

describe('procesarCierre', () => {
  it('cierre visible y reciente: correo con el resumen; la respuesta NO trae montos ni nombres', async () => {
    const { d, lecturasPos, enviados } = deps()
    const r = await procesarCierre({ cierre_id: 'c1' }, d)
    expect(r).toEqual({ status: 200, body: { ok: true, id: 'id-ficticio', resumen: true } })
    expect(lecturasPos).toEqual(['2026-11-15', '2026-11-08'])
    expect(enviados).toHaveLength(1)
    expect(enviados[0].html).toContain('Ventas del día')
    expect(enviados[0].html).toContain('Nombre Ficticio Uno')
    // SEC-02: nada del correo vuelve al cliente.
    const resp = JSON.stringify(r.body)
    expect(resp).not.toMatch(/₡|\d{3,}|NOMBRE|Nombre/)
    expect(Object.keys(r.body).sort()).toEqual(['id', 'ok', 'resumen'])
  })

  it('usuario SIN acceso al cierre (RLS) → 403, sin leer el PoS y sin correo', async () => {
    const { d, lecturasPos, enviados } = deps({}, null, { message: 'permission denied' })
    const r = await procesarCierre({ cierre_id: 'c1' }, d)
    expect(r.status).toBe(403)
    expect(lecturasPos).toEqual([])
    expect(enviados).toEqual([])
  })

  it('cierre que el usuario no ve (RLS filtra la fila) → 404, sin leer el PoS', async () => {
    let llamado = false
    const { d, enviados } = deps({ resumen: async () => { llamado = true; return { resumen: null, motivo: null } } }, null)
    expect((await procesarCierre({ cierre_id: 'c1' }, d)).status).toBe(404)
    expect(llamado).toBe(false)
    expect(enviados).toEqual([])
  })

  it('sin token o con token inválido → 401, nada se lee', async () => {
    let leido = false
    const leerCierre = async () => { leido = true; return { data: CIERRE, error: null } }
    expect((await procesarCierre({ cierre_id: 'c1' }, deps({ hayToken: false, leerCierre }).d)).status).toBe(401)
    expect((await procesarCierre({ cierre_id: 'c1' }, deps({ usuarioValido: async () => false, leerCierre }).d)).status).toBe(401)
    expect(leido).toBe(false)
  })

  it('cierre viejo (> 36 h) → correo SIN resumen («no disponible») y sin leer el PoS', async () => {
    const viejo = { ...CIERRE, session_date: '2026-11-01', created_at: '2026-11-02T05:00:00Z' }
    const { d, lecturasPos, enviados, logs } = deps({}, viejo)
    const r = await procesarCierre({ cierre_id: 'c1' }, d)
    expect(r.body).toEqual({ ok: true, id: 'id-ficticio', resumen: false })
    expect(lecturasPos).toEqual([])
    expect(enviados[0].html).toContain('Resumen de ventas no disponible.')
    expect(enviados[0].html).not.toContain('Salonero destacado')
    expect(logs).toContainEqual({ etapa: 'resumen_ventas', motivo: 'cierre_viejo' })
  })

  it('el resumen explota → el correo del cierre sale igual, con «no disponible»', async () => {
    const { d, enviados } = deps({ resumen: async () => { throw new Error('boom') } })
    const r = await procesarCierre({ cierre_id: 'c1' }, d)
    expect(r.body).toMatchObject({ ok: true, resumen: false })
    expect(enviados[0].html).toContain('Resumen de ventas no disponible.')
    expect(enviados[0].html).toContain('Distribución del conteo físico')
  })

  it('Resend falla → error genérico, sin el detalle de Resend ni montos', async () => {
    const { d } = deps({ enviar: async () => ({ ok: false }) })
    const r = await procesarCierre({ cierre_id: 'c1' }, d)
    expect(r.body).toEqual({ ok: false, error: 'No se pudo enviar el correo' })
  })

  it('sin destinatario → 500 y no lee el cierre ni el PoS', async () => {
    let leido = false
    const { d, lecturasPos } = deps({ hayDestinatario: false, leerCierre: async () => { leido = true; return { data: CIERRE, error: null } } })
    const r = await procesarCierre({ cierre_id: 'c1' }, d)
    expect(r.status).toBe(500)
    expect(leido).toBe(false)
    expect(lecturasPos).toEqual([])
  })

  it('sin remitente → 500 y no lee el cierre ni el PoS', async () => {
    let leido = false
    const { d, lecturasPos, logs } = deps({ hayRemitente: false, leerCierre: async () => { leido = true; return { data: CIERRE, error: null } } })
    const r = await procesarCierre({ cierre_id: 'c1' }, d)
    expect(r.body).toMatchObject({ code: 'falta_remitente' })
    expect(leido).toBe(false)
    expect(lecturasPos).toEqual([])
    expect(logs).toContainEqual({ etapa: 'falta remitente', secreto: 'REMITENTE_CORREOS' })
  })

  it('falta cierre_id → 400', async () => {
    expect((await procesarCierre({}, deps().d)).status).toBe(400)
  })
})
