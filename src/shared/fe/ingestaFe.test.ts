// F1 · orquestación de la Edge fe-ingesta con una base y un Storage FALSOS en memoria (la base real se prueba en
// scripts/sql/199_pruebas.sql y 201_pruebas.sql). Muestras ficticias.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { esYaExisteStorage, procesarSobre, subirIdempotente, type DepsIngesta, type ErrorRpc } from './ingestaFe'
import type { SobreFe } from './sobreFe'
import { claveFicticia, mensajeHaciendaFicticio, xmlFicticio } from './fixturasFe.testutil'

function baseFalsa(o: { fallaRpc?: string; errorDato?: string; fallaStorage?: boolean } = {}) {
  const comprobantes = new Map<string, Record<string, unknown>>()
  const versiones = new Map<string, Map<string, string>>()
  const respuestas = new Map<string, unknown>()
  const objetos = new Map<string, string>()
  const bitacora: { resultado: string; clave: string | null; motivo: string | null }[] = []
  const latidos: string[] = []
  const deps: DepsIngesta = {
    sha256: async t => createHash('sha256').update(t, 'utf8').digest('hex'),
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
        // como la 201: la ruta tiene que terminar en el sha; mismo sha = duplicado; otro sha = versión nueva y «revisar»
        if (!String(p.xml_path).endsWith(`/${String(p.xml_sha256)}.xml`)) return { data: null, error: { code: 'P0001', message: 'ruta sin sha' } }
        const c = p.comprobante as { clave: string }
        const vs = versiones.get(c.clave)
        if (vs) {
          if (vs.has(String(p.xml_sha256))) return { data: { resultado: 'duplicado' }, error: null }
          vs.set(String(p.xml_sha256), String(p.xml_path))
          return { data: { resultado: 'revisar', versiones: vs.size }, error: null }
        }
        versiones.set(c.clave, new Map([[String(p.xml_sha256), String(p.xml_path)]]))
        comprobantes.set(c.clave, p)
        return { data: { resultado: p.estado === 'ok' ? 'nuevo' : 'revisar' }, error: null }
      }
      throw new Error(`rpc inesperada ${fn}`)
    },
  }
  return { deps, comprobantes, versiones, respuestas, objetos, bitacora, latidos }
}

const shaDe = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

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
    expect([...b.objetos.keys()][0]).toBe(`2026/11/${claveFicticia()}/${shaDe(xmlFicticio())}.xml`)
  })
  it('manda a la base las líneas, el estado, el hash y la ruta', async () => {
    const b = baseFalsa()
    await procesarSobre(sobre([xmlFicticio()]), b.deps)
    const p = b.comprobantes.get(claveFicticia())!
    expect(p.estado).toBe('ok')
    expect((p.lineas as unknown[]).length).toBe(2)
    expect(p.xml_sha256).toBe(shaDe(xmlFicticio()))
    expect(p.xml_path).toBe(`2026/11/${claveFicticia()}/${shaDe(xmlFicticio())}.xml`)
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

describe('Storage «ya existe» = éxito idempotente (la Edge no da 500 en cada reintento)', () => {
  // Formas reales de storage-js según versión (StorageApiError): código del cuerpo, HTTP 409, o 400 + «Duplicate».
  const yaExiste = [
    { statusCode: '409', message: 'The resource already exists' },
    { status: 409, message: 'x' },
    { status: 400, error: 'Duplicate', message: 'otra cosa' },
    { message: 'The resource already exists' },
  ]
  it.each(yaExiste)('ya existe: %o', e => {
    expect(esYaExisteStorage(e)).toBe(true)
  })
  it.each([null, undefined, 'texto', { status: 500, message: 'Internal' }, { statusCode: '403', message: 'denied' }, { message: 'Bucket not found' }])(
    'otro error no es «ya existe»: %o', e => {
      expect(esYaExisteStorage(e)).toBe(false)
    })

  it('subirIdempotente: sin error → ok · ya existe → ya_existe · otro → tira', async () => {
    await expect(subirIdempotente(async () => ({ error: null }))).resolves.toBe('ok')
    await expect(subirIdempotente(async () => ({ error: { statusCode: '409', message: 'The resource already exists' } }))).resolves.toBe('ya_existe')
    await expect(subirIdempotente(async () => ({ error: { status: 500, message: 'Internal' } }))).rejects.toThrow('storage: Internal')
  })

  it('reintento del mismo sobre con un Storage que contesta 409 al segundo upload: 200 y «duplicado», no 500', async () => {
    const b = baseFalsa()
    const subidos = new Set<string>()
    const deps: DepsIngesta = {
      ...b.deps,
      subirXml: (ruta) => subirIdempotente(async () => {
        if (subidos.has(ruta)) return { error: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } }
        subidos.add(ruta)
        return { error: null }
      }),
    }
    const s = sobre([xmlFicticio()])
    expect((await procesarSobre(s, deps)).status).toBe(200)
    const r2 = await procesarSobre(s, deps)
    expect(r2.status).toBe(200)
    expect(r2.cuerpo.resultados[0].resultado).toBe('duplicado')
  })
})

describe('257/258 — misma clave con otro XML (mig 201)', () => {
  it('dos XML distintos con la misma clave: dos archivos (cada uno en la ruta de SU sha), el segundo «revisar», 200', async () => {
    const b = baseFalsa()
    const real = xmlFicticio()
    const falso = xmlFicticio({ total: '1.00000' })
    expect(shaDe(real)).not.toBe(shaDe(falso))
    const r1 = await procesarSobre(sobre([falso]), b.deps)
    const r2 = await procesarSobre(sobre([real]), b.deps)
    expect(r1.cuerpo.resultados[0].resultado).toBe('revisar') // la suma no calza: el parser ya lo manda a revisar
    expect(r2.status).toBe(200)
    expect(r2.cuerpo.resultados[0].resultado).toBe('revisar')
    expect([...b.objetos.keys()].sort()).toEqual([
      `2026/11/${claveFicticia()}/${shaDe(falso)}.xml`, `2026/11/${claveFicticia()}/${shaDe(real)}.xml`].sort())
    expect(b.objetos.get(`2026/11/${claveFicticia()}/${shaDe(real)}.xml`)).toBe(real)
    expect(b.objetos.get(`2026/11/${claveFicticia()}/${shaDe(falso)}.xml`)).toBe(falso)
    expect(b.versiones.get(claveFicticia())!.size).toBe(2)
  })
  it('cada archivo guardado tiene el sha con el que quedó en la base (258)', async () => {
    const b = baseFalsa()
    await procesarSobre(sobre([xmlFicticio(), xmlFicticio({ total: '2.00000' })]), b.deps)
    for (const [sha, ruta] of b.versiones.get(claveFicticia())!) {
      expect(ruta.endsWith(`/${sha}.xml`)).toBe(true)
      expect(shaDe(b.objetos.get(ruta)!)).toBe(sha)
    }
  })
  it('«ya existe» en Storage solo pasa con el MISMO XML: otro XML nunca cae sobre un archivo existente', async () => {
    const b = baseFalsa()
    const intentos: string[] = []
    const deps: DepsIngesta = {
      ...b.deps,
      subirXml: async (ruta, xml) => { intentos.push(ruta); return b.deps.subirXml(ruta, xml) },
    }
    await procesarSobre(sobre([xmlFicticio()]), deps)
    await procesarSobre(sobre([xmlFicticio({ total: '3.00000' })]), deps)
    expect(new Set(intentos).size).toBe(2)
  })
  it('sha ilegible: no se sube nada ni se llama a la base; 500 (el script reintenta)', async () => {
    const b = baseFalsa()
    const roto: DepsIngesta = { ...b.deps, sha256: async () => 'no-es-hex' }
    expect((await procesarSobre(sobre([xmlFicticio()]), roto)).status).toBe(500)
    expect(b.objetos.size).toBe(0)
    expect(b.comprobantes.size).toBe(0)
  })
  it('la base rechaza la ruta (P0001): 500, no 422 (el correo no queda «fe-error»)', async () => {
    const b = baseFalsa()
    const deps: DepsIngesta = {
      ...b.deps,
      rpc: async (fn, args) => fn === 'fe_ingestar' ? { data: null, error: { code: 'P0001', message: 'ruta' } } : b.deps.rpc(fn, args),
    }
    expect((await procesarSobre(sobre([xmlFicticio()]), deps)).status).toBe(500)
  })
})
