// F1 · script de Apps Script del correo de proveedores, corrido en Node con Gmail, UrlFetch y compañía FALSOS.
// Muerde: qué etiqueta recibe cada correo según lo que responde la Edge, que un 401 no etiquete nada, las tandas,
// el tope de tiempo y que en el archivo no haya secretos, correos ni direcciones.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

const CODIGO = readFileSync(join(__dirname, 'Codigo.gs'), 'utf8')

interface Adjunto { nombre: string; tipo?: string; bytes?: number; zip?: Adjunto[] }
function blob(a: Adjunto) {
  return {
    getName: () => a.nombre, getContentType: () => a.tipo ?? '',
    getBytes: () => new Array(a.bytes ?? 100).fill(60), copyBlob: () => blob(a), _zip: a.zip,
  }
}

function entorno(o: { mensajes: Record<string, Adjunto[]>; de?: Record<string, string>; respuestas?: (cuerpo: Record<string, unknown>) => number; ahora?: () => number; latido?: number }) {
  const pedidos: Record<string, unknown>[] = []
  const etiquetas: Record<string, string[]> = {}
  const labels: { id: string; name: string }[] = []
  const props: Record<string, string> = {
    FE_INGESTA_URL: 'https://proyecto-ficticio.ejemplo.test/functions/v1/fe-ingesta',
    FE_INGESTA_SECRET: 'x'.repeat(40), FE_FUENTE: 'prueba',
  }
  const ctx = {
    Date: { now: o.ahora ?? (() => 0) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props[k] ?? null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: () => {} },
    Utilities: {
      getUuid: () => '00000000-0000-4000-8000-000000000001',
      base64Encode: (b: number[]) => 'A'.repeat(Math.ceil(b.length / 3) * 4),
      unzip: (z: ReturnType<typeof blob>) => { if (!z._zip) throw new Error('zip roto'); return z._zip.map(blob) },
    },
    UrlFetchApp: {
      fetch: (_url: string, op: { payload: string; headers: Record<string, string> }) => {
        const cuerpo = JSON.parse(op.payload)
        pedidos.push(cuerpo)
        const codigo = cuerpo.latido ? (o.latido ?? 200) : (o.respuestas?.(cuerpo) ?? 200)
        if (codigo === 0) throw new Error('red')
        return { getResponseCode: () => codigo }
      },
    },
    Gmail: {
      Users: {
        Labels: {
          list: () => ({ labels }),
          create: (l: { name: string }) => { const n = { id: `L-${l.name}`, name: l.name }; labels.push(n); return n },
        },
        Messages: {
          list: () => ({ messages: Object.keys(o.mensajes).map(id => ({ id })) }),
          modify: (m: { addLabelIds: string[] }, _yo: string, id: string) => { (etiquetas[id] ??= []).push(...m.addLabelIds) },
        },
      },
    },
    GmailApp: { getMessageById: (id: string) => ({ getAttachments: () => o.mensajes[id].map(blob), getFrom: () => o.de?.[id] ?? 'Ficticio <alguien@ejemplo.test>' }) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }) },
  }
  vm.createContext(ctx)
  vm.runInContext(CODIGO, ctx)
  return { correr: () => vm.runInContext('correr()', ctx), pedidos, etiquetas, props }
}

const XML: Adjunto = { nombre: 'Factura.XML' }
const PDF: Adjunto = { nombre: 'factura.pdf', tipo: 'application/pdf' }

describe('fe-correo — etiquetas según la respuesta', () => {
  it('200 → fe-procesada; solo PDF → fe-sin-xml; 422 → fe-error; red o 500 → sin etiqueta', () => {
    const codigos: Record<string, number> = { 'ok.xml': 200, 'roto.xml': 422, 'red.xml': 0, 'cae.xml': 500 }
    let k = 0
    const orden = ['ok.xml', 'roto.xml', 'red.xml', 'cae.xml']
    const e = entorno({
      mensajes: { a: [{ nombre: 'ok.xml' }, PDF], b: [PDF], c: [{ nombre: 'roto.xml' }], d: [{ nombre: 'red.xml' }], f: [{ nombre: 'cae.xml' }] },
      respuestas: (cu) => (cu.sin_xml ? 200 : codigos[orden[k++]]),
    })
    e.correr()
    expect(e.etiquetas).toEqual({ a: ['L-fe-procesada'], b: ['L-fe-sin-xml'], c: ['L-fe-error'] })
  })
  it('el PDF no se manda nunca; el pedido no lleva remitente, asunto ni nombre de adjunto', () => {
    const e = entorno({ mensajes: { a: [XML, PDF] } })
    e.correr()
    const conXml = e.pedidos.filter(p => p.xmls) as { xmls: unknown[] }[]
    expect(conXml).toHaveLength(1)
    expect(conXml[0].xmls).toHaveLength(1)
    expect(Object.keys(conXml[0]).sort()).toEqual(['fuente', 'lote', 'xmls'])
    expect(JSON.stringify(e.pedidos)).not.toMatch(/Factura|pdf/i)
  })
  it('XML dentro de un zip se manda; zip dentro de zip → fe-error (lo bueno del zip igual se manda)', () => {
    const e = entorno({
      mensajes: {
        z: [{ nombre: 'facturas.zip', zip: [{ nombre: 'f1.xml' }, { nombre: 'f2.xml' }, { nombre: 'leame.txt' }] }],
        zz: [{ nombre: 'doble.zip', zip: [{ nombre: 'f3.xml' }, { nombre: 'otro.zip' }] }],
      },
    })
    e.correr()
    expect(e.etiquetas).toEqual({ z: ['L-fe-procesada'], zz: ['L-fe-error'] })
    const n = (e.pedidos.filter(p => p.xmls) as { xmls: unknown[] }[]).map(p => p.xmls.length)
    expect(n).toEqual([2, 1])
  })
  it('XML de más de 1 MB no se manda y el correo queda fe-error', () => {
    const e = entorno({ mensajes: { g: [{ nombre: 'grande.xml', bytes: 1024 * 1024 + 1 }] } })
    e.correr()
    expect(e.etiquetas).toEqual({ g: ['L-fe-error'] })
    expect(e.pedidos.filter(p => p.xmls)).toHaveLength(0)
  })
})

describe('fe-correo — fallas que no pueden etiquetar', () => {
  it('401 en el latido: no se lee ni se etiqueta nada', () => {
    const e = entorno({ mensajes: { a: [XML] }, latido: 401 })
    e.correr()
    expect(e.etiquetas).toEqual({})
    expect(e.pedidos).toHaveLength(1)
  })
  it('401 en un correo: se para la corrida sin etiquetar ese ni los siguientes', () => {
    const e = entorno({ mensajes: { a: [XML], b: [XML] }, respuestas: () => 401 })
    e.correr()
    expect(e.etiquetas).toEqual({})
    expect(e.pedidos.filter(p => p.xmls)).toHaveLength(1)
  })
  it('tope de 45 s: deja el resto para la próxima corrida', () => {
    let t = 0
    const e = entorno({ mensajes: { a: [XML], b: [XML], c: [XML] }, ahora: () => (t += 20_000) })
    e.correr()
    expect(Object.keys(e.etiquetas).length).toBeLessThan(3)
  })
  it('sin secreto configurado no corre (ni latido)', () => {
    const e = entorno({ mensajes: { a: [XML] } })
    e.props.FE_INGESTA_SECRET = ''
    expect(() => e.correr()).toThrow(/FE_INGESTA_SECRET/)
    expect(e.pedidos).toHaveLength(0)
  })
})

describe('fe-correo — tandas', () => {
  it('25 XML en un correo van en dos pedidos (≤ 20 por pedido)', () => {
    const e = entorno({ mensajes: { a: Array.from({ length: 25 }, (_, i) => ({ nombre: `f${i}.xml` })) } })
    e.correr()
    expect((e.pedidos.filter(p => p.xmls) as { xmls: unknown[] }[]).map(p => p.xmls.length)).toEqual([20, 5])
    expect(e.etiquetas).toEqual({ a: ['L-fe-procesada'] })
  })
  it('si una tanda falla por red, el correo queda sin etiqueta aunque la otra entre', () => {
    let k = 0
    const e = entorno({ mensajes: { a: Array.from({ length: 25 }, (_, i) => ({ nombre: `f${i}.xml` })) }, respuestas: () => (k++ === 0 ? 200 : 0) })
    e.correr()
    expect(e.etiquetas).toEqual({})
  })
})

describe('fe-correo — FE_REMITENTES (opcional, mig 201)', () => {
  it('vacío: se mandan todos', () => {
    const e = entorno({ mensajes: { a: [XML], b: [XML] }, de: { a: 'x@uno.test', b: 'Otro <y@dos.test>' } })
    e.correr()
    expect(e.etiquetas).toEqual({ a: ['L-fe-procesada'], b: ['L-fe-procesada'] })
  })
  it('con lista: dirección exacta o @dominio pasan; lo demás queda «fe-otro-remitente» y NO se manda', () => {
    const e = entorno({
      mensajes: { a: [XML], b: [XML], c: [XML], d: [XML] },
      de: { a: 'Proveedor <Facturas@Uno.Test>', b: 'z@dos.test', c: 'z@dos.test.malo.test', d: 'ventas@sub.tres.test' },
    })
    e.props.FE_REMITENTES = ' facturas@uno.test , @dos.test,@sub.tres.test'
    e.correr()
    expect(e.etiquetas).toEqual({ a: ['L-fe-procesada'], b: ['L-fe-procesada'], c: ['L-fe-otro-remitente'], d: ['L-fe-procesada'] })
    expect(e.pedidos.filter(p => p.xmls)).toHaveLength(3)
    expect(JSON.stringify(e.pedidos)).not.toMatch(/@/)
  })
  it('un dominio no deja pasar a otro que termina igual sin la arroba', () => {
    const e = entorno({ mensajes: { a: [XML] }, de: { a: 'z@xdos.test' } })
    e.props.FE_REMITENTES = '@dos.test'
    e.correr()
    expect(e.etiquetas).toEqual({ a: ['L-fe-otro-remitente'] })
  })
})

describe('fe-correo — repo público', () => {
  it('sin correos, secretos ni refs de Supabase en el código', () => {
    expect(CODIGO).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/)
    expect(CODIGO).not.toMatch(/[a-z]{20}\.supabase\.co/)
    expect(CODIGO).not.toMatch(/FE_INGESTA_SECRET\s*[:=]\s*['"][^'"]{8,}/)
  })
})
