// F1 · orquestación de la Edge fe-ingesta con una base y un Storage FALSOS en memoria (la base real se prueba en
// scripts/sql/199_pruebas.sql). Muestras ficticias.
import { describe, it, expect } from 'vitest'
import { procesarSobre, type DepsIngesta, type ErrorRpc } from './ingestaFe'
import type { SobreFe } from './sobreFe'
import { claveFicticia, mensajeHaciendaFicticio, xmlFicticio } from './fixturasFe.testutil'

function baseFalsa(o: { fallaRpc?: string; errorDato?: string; fallaStorage?: boolean } = {}) {
  const comprobantes = new Map<string, Record<string, unknown>>()
  const respuestas = new Map<string, unknown>()
  const objetos = new Map<string, string>()
  const bitacora: { resultado: string; clave: string | null; motivo: string | null }[] = []
  const latidos: string[] = []
  const deps: DepsIngesta = {
    sha256: async t => t.length.toString(16).padStart(64, '0'),
    subirXml: async (ruta, xml) => {
      if (o.fallaStorage) throw new Error('storage caído')
      if (objetos.has(ruta)) return 'ya_existe'
      objetos.set(ruta, xml)
      return 'ok'
    },
    rpc: async (fn, args) => {
      if (o.fallaRpc === fn) return { data: null, error: { message: 'conexión perdida' } as ErrorRpc }
      if (o.errorDato === fn) return { data: null, error: { code: '22P02', message: 'dato' } }
      if (fn === 'fe_latido') { latidos.push(String(args.p_fuente)); return { data: null, error: null } }
      if (fn === 'fe_bitacora_anotar') {
        bitacora.push({ resultado: String(args.p_resultado), clave: (args.p_clave as string) ?? null, motivo: (args.p_motivo as string) ?? null })
        return { data: null, error: null }
      }
      const p = args.p as Record<string, unknown>
      if (fn === 'fe_respuesta_registrar') {
        const r = p.respuesta as { clave: string }
        const nuevo = !respuestas.has(r.clave)
        if (nuevo) respuestas.set(r.clave, r)
        return { data: { resultado: nuevo ? 'nuevo' : 'duplicado' }, error: null }
      }
      if (fn === 'fe_ingestar') {
        const c = p.comprobante as { clave: string }
        if (comprobantes.has(c.clave)) return { data: { resultado: 'duplicado' }, error: null }
        comprobantes.set(c.clave, p)
        return { data: { resultado: p.estado === 'ok' ? 'nuevo' : 'revisar' }, error: null }
      }
      throw new Error(`rpc inesperada ${fn}`)
    },
  }
  return { deps, comprobantes, respuestas, objetos, bitacora, latidos }
}

const sobre = (xmls: string[], extra: Partial<SobreFe> = {}): SobreFe =>
  ({ fuente: 'prueba', lote: 'lote-prueba-0001', latido: false, sin_xml: false, xmls, ...extra })

describe('procesarSobre — idempotencia', () => {
  it('el mismo correo dos veces deja UN comprobante; la segunda responde «duplicado» con 200', async () => {
    const b = baseFalsa()
    const r1 = await procesarSobre(sobre([xmlFicticio()]), b.deps)
    const r2 = await procesarSobre(sobre([xmlFicticio()]), b.deps)
    expect(r1.status).toBe(200)
    expect(r1.cuerpo.resultados[0].resultado).toBe('nuevo')
    expect(r2.status).toBe(200)
    expect(r2.cuerpo.resultados[0].resultado).toBe('duplicado')
    expect(b.comprobantes.size).toBe(1)
    expect(b.objetos.size).toBe(1)
    expect([...b.objetos.keys()][0]).toBe(`2026/11/${claveFicticia()}.xml`)
  })
  it('manda a la base las líneas, el estado, el hash y la ruta', async () => {
    const b = baseFalsa()
    await procesarSobre(sobre([xmlFicticio()]), b.deps)
    const p = b.comprobantes.get(claveFicticia())!
    expect(p.estado).toBe('ok')
    expect((p.lineas as unknown[]).length).toBe(2)
    expect(p.xml_path).toBe(`2026/11/${claveFicticia()}.xml`)
    expect(String(p.xml_sha256)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('procesarSobre — nota de crédito y revisar', () => {
  it('la NC llega con la clave de su factura', async () => {
    const b = baseFalsa()
    const fac = claveFicticia({ numero: 1 })
    const nc = claveFicticia({ numero: 2, tipo: '03' })
    await procesarSobre(sobre([xmlFicticio(), xmlFicticio({ raiz: 'NotaCreditoElectronica', clave: nc, referencia: fac })]), b.deps)
    const p = b.comprobantes.get(nc)!
    expect((p.comprobante as { tipo: string; ref_clave: string }).tipo).toBe('nota_credito')
    expect((p.comprobante as { ref_clave: string }).ref_clave).toBe(fac)
  })
  it('suma que no calza: entra a «revisar» con 200 (no se descarta ni se reintenta)', async () => {
    const b = baseFalsa()
    const r = await procesarSobre(sobre([xmlFicticio({ total: '99999.00000' })]), b.deps)
    expect(r.status).toBe(200)
    expect(r.cuerpo.resultados[0].resultado).toBe('revisar')
    expect(b.comprobantes.size).toBe(1)
  })
})

describe('procesarSobre — XML roto, no comprobante, respuesta', () => {
  it('XML roto: bitácora «error» y 422 (el script lo marca fe-error)', async () => {
    const b = baseFalsa()
    const r = await procesarSobre(sobre(['<FacturaElectronica><Clave>']), b.deps)
    expect(r.status).toBe(422)
    expect(b.bitacora).toEqual([expect.objectContaining({ resultado: 'error' })])
    expect(b.comprobantes.size).toBe(0)
  })
  it('correo con una buena y una rota: la buena queda guardada y el correo da 422', async () => {
    const b = baseFalsa()
    const r = await procesarSobre(sobre([xmlFicticio(), 'no es xml']), b.deps)
    expect(r.status).toBe(422)
    expect(b.comprobantes.size).toBe(1)
  })
  it('XML que no es comprobante: 200 y bitácora «no_comprobante»', async () => {
    const b = baseFalsa()
    const r = await procesarSobre(sobre(['<rss/>']), b.deps)
    expect(r.status).toBe(200)
    expect(b.bitacora[0].resultado).toBe('no_comprobante')
  })
  it('respuesta de Hacienda va a fe_respuesta_registrar (sin subir nada)', async () => {
    const b = baseFalsa()
    const r = await procesarSobre(sobre([mensajeHaciendaFicticio(claveFicticia(), '3')]), b.deps)
    expect(r.status).toBe(200)
    expect(b.respuestas.size).toBe(1)
    expect(b.objetos.size).toBe(0)
  })
})

describe('procesarSobre — fallas: reintentar o no', () => {
  it('la base cae: 500 (el script NO etiqueta y reintenta)', async () => {
    const b = baseFalsa({ fallaRpc: 'fe_ingestar' })
    expect((await procesarSobre(sobre([xmlFicticio()]), b.deps)).status).toBe(500)
  })
  it('Storage cae: 500 y no se llama a fe_ingestar', async () => {
    const b = baseFalsa({ fallaStorage: true })
    expect((await procesarSobre(sobre([xmlFicticio()]), b.deps)).status).toBe(500)
    expect(b.comprobantes.size).toBe(0)
  })
  it('la base rechaza un dato (22P02): 422 y bitácora «error» (reintentar no lo arregla)', async () => {
    const b = baseFalsa({ errorDato: 'fe_ingestar' })
    const r = await procesarSobre(sobre([xmlFicticio()]), b.deps)
    expect(r.status).toBe(422)
    expect(b.bitacora[0]).toMatchObject({ resultado: 'error', clave: claveFicticia() })
  })
  it('falla anotar la bitácora: 500', async () => {
    const b = baseFalsa({ fallaRpc: 'fe_bitacora_anotar' })
    expect((await procesarSobre(sobre(['no es xml']), b.deps)).status).toBe(500)
  })
})

describe('procesarSobre — latido y sin XML', () => {
  it('latido: solo anota la fuente', async () => {
    const b = baseFalsa()
    const r = await procesarSobre(sobre([], { latido: true }), b.deps)
    expect(r).toEqual({ status: 200, cuerpo: { ok: true, latido: true, resultados: [] } })
    expect(b.latidos).toEqual(['prueba'])
  })
  it('correo sin XML: bitácora «sin_xml» y 200', async () => {
    const b = baseFalsa()
    const r = await procesarSobre(sobre([], { sin_xml: true }), b.deps)
    expect(r.status).toBe(200)
    expect(b.bitacora[0].resultado).toBe('sin_xml')
  })
  it('todo pedido anota el latido', async () => {
    const b = baseFalsa()
    await procesarSobre(sobre([xmlFicticio()]), b.deps)
    expect(b.latidos).toEqual(['prueba'])
  })
})
