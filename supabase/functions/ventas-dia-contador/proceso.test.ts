// Orquestación sin red: dry_run arma todo y NO manda; la corrida real manda UN correo con los dos
// adjuntos; sin destinatario no lee ni manda; parámetros inválidos → 400; la respuesta no trae plata.
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../../src/shared/api/supabase', () => ({ supabase: null }))
import * as app from '../../../src/modules/ventas/ventasDiaContadorPuro'
import { procesar, marcaCR, type Dependencias } from './proceso.ts'
import type { Correo } from './correo.ts'
import type { LogicaApp } from './detalle.ts'
import { diasFicticios } from './pruebas.fixtures.ts'

function deps(over: Partial<Dependencias> = {}) {
  const enviados: Correo[] = []
  const lecturas: Array<{ rango: { desde: string; hasta: string }; local: string }> = []
  const d: Dependencias = {
    logica: app as unknown as LogicaApp,
    leerDias: async (rango, local) => { lecturas.push({ rango, local }); return diasFicticios(['2026-11-02', '2026-11-09']) },
    enviar: async (c) => { enviados.push(c) },
    hayDestinatario: true,
    ahora: new Date('2026-11-16T13:00:00Z'),   // el cron del 16, 07:00 CR
    ...over,
  }
  return { d, enviados, lecturas }
}

describe('procesar', () => {
  it('dry_run: arma y responde el resumen, sin mandar', async () => {
    const { d, enviados, lecturas } = deps()
    const r = await procesar({ dry_run: true }, d)
    expect(r.status).toBe(200)
    expect(enviados).toEqual([])
    expect(lecturas).toEqual([{ rango: { desde: '2026-11-01', hasta: '2026-11-15' }, local: 'santa-teresa' }])
    expect(r.body).toMatchObject({ ok: true, dry_run: true, enviado: false, quincena: '2026-11-1', dias: 15, dias_con_ventas: 2, fuente: 'pos' })
    const adj = (r.body as { adjuntos: Array<{ archivo: string; bytes: number; sha256: string }> }).adjuntos
    expect(adj.map(a => a.archivo)).toEqual(['satori_ventas_dia_santa-teresa_2026-11-1.xlsx', 'satori_ventas_dia_santa-teresa_2026-11-1.csv'])
    for (const a of adj) { expect(a.bytes).toBeGreaterThan(100); expect(a.sha256).toMatch(/^[0-9a-f]{64}$/) }
  })

  it('dry_run funciona aunque falte el destinatario (no manda)', async () => {
    const { d } = deps({ hayDestinatario: false })
    expect((await procesar({ dry_run: true }, d)).status).toBe(200)
  })

  it('corrida real: UN correo con asunto, totales en el cuerpo y los dos adjuntos', async () => {
    const { d, enviados } = deps({ ahora: new Date('2026-12-01T13:00:00Z') })
    const r = await procesar({}, d)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ enviado: true, quincena: '2026-11-2', desde: '2026-11-16', hasta: '2026-11-30', dias: 15 })
    expect(enviados.length).toBe(1)
    const c = enviados[0]
    expect(c.subject).toMatch(/^Satori · Ventas por día 16–30 de noviembre de 2026 · Santa Teresa · neta ₡[\d.]+$/)
    expect(c.html).toContain('Venta neta')
    expect(c.attachments.map(a => a.filename)).toEqual(['satori_ventas_dia_santa-teresa_2026-11-2.xlsx', 'satori_ventas_dia_santa-teresa_2026-11-2.csv'])
    // El CSV adjunto, decodificado, empieza con BOM y el encabezado.
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(Uint8Array.from(atob(c.attachments[1].content), ch => ch.charCodeAt(0)))
    expect(csv.startsWith('\uFEFF#,Fecha,Día,Venta bruta')).toBe(true)
  })

  it('sin destinatario (corrida real): 500 y no lee ni manda', async () => {
    const { d, enviados, lecturas } = deps({ hayDestinatario: false })
    const r = await procesar({}, d)
    expect(r).toMatchObject({ status: 500, body: { code: 'falta_destinatario' } })
    expect(enviados.length + lecturas.length).toBe(0)
  })

  it('parámetros inválidos → 400 sin leer', async () => {
    const { d, lecturas } = deps()
    for (const b of [null, [], 'x', { dry_run: 'si' }, { local: 'Santa Teresa' }, { local: 3 }, { quincena: '2026-11' }, { quincena: '2026-11-2' }]) {
      expect((await procesar(b, d)).status).toBe(400)
    }
    expect(lecturas).toEqual([])
  })

  it('otro local y una quincena pasada se pueden pedir', async () => {
    const { d, lecturas } = deps()
    const r = await procesar({ dry_run: true, local: 'nosara', quincena: '2026-10-2' }, d)
    expect(r.status).toBe(200)
    expect(lecturas[0]).toEqual({ rango: { desde: '2026-10-16', hasta: '2026-10-31' }, local: 'nosara' })
  })

  it('la respuesta no trae montos (SEC-02): ningún número de plata del correo aparece', async () => {
    const { d, enviados } = deps()
    const r = await procesar({}, d)
    const json = JSON.stringify(r.body)
    const neta = enviados[0].subject.match(/neta ₡([\d.]+)/)![1].replace(/\./g, '')
    expect(json).not.toContain(neta)
    expect(json).not.toMatch(/₡/)
  })

  it('marcaCR: hora de Costa Rica sin toLocaleString', () => {
    expect(marcaCR(new Date('2026-12-01T05:30:00Z'))).toBe('2026-11-30 23:30')
  })
})
