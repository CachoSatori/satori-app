// (12-nov, el dueño) A los clientes se les habla de «usted»: el pase de Google, el de Apple (apagado) y el mensaje de
// canje. Esta prueba arma el pase en todos los casos (socio activo con cortesía, socio pendiente, anfitrión, los dos y
// vencido) y revisa CADA texto en español. El portal (club-web) tiene su propia prueba: club-web/src/usted.test.ts.
import { describe, it, expect } from 'vitest'
import { armarObjeto, configurarBaseClub, type PaseDatos } from './googlePase'
import { armarPassJson } from './applePase'
import { mensajeCanje } from './sincronizar'

configurarBaseClub('https://club.ejemplo.test')

/** Tuteo y voseo: pronombres y los verbos que alguna vez aparecieron en estos textos. Sin acento no hay voseo en «usted». */
export const TUTEO_VOSEO = new RegExp('(^|[^\\p{L}])(' + [
  'tu', 'tus', 'te', 'ti', 'contigo', 'vos', 'sos', 'tenés', 'podés', 'querés', 'sabés', 'estás', 'fuiste',
  'validá', 'mostrá', 'mostralo', 'probá', 'tocá', 'elegí', 'sumate', 'anotate', 'fijate', 'avisanos', 'escribinos',
  'pedí', 'usá', 'abrí', 'guardá', 'guardalo', 'agregá', 'agregalo', 'compartí', 'compartilo', 'esperá', 'volvé',
  'escaneá', 'canjeá', 'generá', 'completá', 'marcá', 'escribí', 'revisá', 'descargá', 'intentá', 'seguí', 'llamá',
].join('|') + ')(?=$|[^\\p{L}])', 'iu')

const A = '00000000-0000-4000-8000-0000000000aa'
const socio = { estado: 'activo' as const, desde: '2026-11-01', qr_url: 'https://club.ejemplo.test/s/ABCD2345K', beneficio: 'Vale en todos los Satori',
                visitas_mes: 2, cortesias: [{ sorpresa: true, cantidad: 2, motivo: 'promo', vence_en: null }] }
const anfitrion = { activo: true, tipo: 'referente', codigo_publico: 'ABCD2345', qr_url: 'https://club.ejemplo.test/r/ABCD2345',
                    personas: 14, creditos: 2, personas_proximo_medio: 1, valor_credito_crc: 18000, referidos_mes: 1, creditos_ganados_mes: 1 }
const base = (over: Partial<PaseDatos>): PaseDatos => ({
  contrato: 1, miembro_id: A, version: 1, actualizado_en: '2026-11-12T19:20:00Z', nombre_pila: 'Ana', estado: 'activo',
  local: { id: 'local-prueba', nombre: 'Local Prueba' }, pestanas: ['mi_club', 'anfitrion'],
  codigo_barras: { tipo: 'socio', valor: socio.qr_url }, socio, anfitrion, promociones: [],
  canjear_url: `https://club.ejemplo.test/w/${'d'.repeat(64)}`, ...over,
})
const CASOS: Record<string, PaseDatos> = {
  'socio y anfitrión': base({}),
  'socio activo con cortesía': base({ pestanas: ['mi_club'], anfitrion: null, canjear_url: null }),
  'socio pendiente': base({ pestanas: ['mi_club'], anfitrion: null, canjear_url: null, socio: { ...socio, estado: 'pendiente', cortesias: [] } }),
  'solo anfitrión': base({ pestanas: ['anfitrion'], socio: null, codigo_barras: { tipo: 'cupones', valor: anfitrion.qr_url } }),
  'de baja': base({ estado: 'baja' }),
}

/** Todos los textos en español de un objeto de Google: valores por defecto, encabezados, cuerpos y descripciones. */
function textosEs(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) { for (const y of x) textosEs(y, out); return out }
  if (!x || typeof x !== 'object') return out
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (k === 'translatedValues') continue                                 // el inglés no se revisa acá
    if (typeof v === 'string' && ['header', 'body', 'description', 'value', 'label'].includes(k)) out.push(v)
    else textosEs(v, out)
  }
  return out
}

describe('clientes = usted', () => {
  it('la expresión detecta tuteo y voseo, y deja pasar «usted»', () => {
    for (const mal of ['Tus cupones para compartir', 'Tu próxima visita', '¿No fuiste vos? Avisanos.', 'Validá tu alta', 'Te quedan 2']) {
      expect(TUTEO_VOSEO.test(mal), mal).toBe(true)
    }
    for (const bien of ['Sus cupones para compartir', 'Su próxima visita', '¿No fue usted? Avísenos.', 'Valide su alta', 'Le quedan 2',
                        'Créditos al 12-nov 13:20', 'Vale en todos los Satori', 'Canjear créditos (código de 10 minutos)']) {
      expect(TUTEO_VOSEO.test(bien), bien).toBe(false)
    }
  })

  for (const [caso, d] of Object.entries(CASOS)) {
    it(`pase de Google · ${caso}: ningún texto en tuteo o voseo`, () => {
      const textos = textosEs(armarObjeto('3388000000012345678', 'prod', d))
      expect(textos.length).toBeGreaterThan(2)
      expect(textos.filter(t => TUTEO_VOSEO.test(t))).toEqual([])
    })
    it(`pase de Apple (apagado) · ${caso}: ningún texto en tuteo o voseo`, () => {
      const p = armarPassJson(d, { passTypeIdentifier: 'pass.test.ejemplo.club', teamIdentifier: 'ABCDE12345', webServiceURL: null }, null)
      expect(textosEs(p).filter(t => TUTEO_VOSEO.test(t))).toEqual([])
    })
  }

  it('los enlaces del reverso dicen «Sus cupones para compartir»', () => {
    const o = armarObjeto('3388000000012345678', 'prod', CASOS['socio y anfitrión']) as unknown as { linksModuleData: { uris: Array<{ id: string; description: string }> } }
    expect(o.linksModuleData.uris.find(u => u.id === 'cupones')?.description).toBe('Sus cupones para compartir')
  })

  it('el mensaje de canje del pase: «usted»', () => {
    for (const [c, s] of [[1, 0], [1.5, 2], [3, 1]]) {
      const m = mensajeCanje(c, s).es
      expect(TUTEO_VOSEO.test(m.header) || TUTEO_VOSEO.test(m.body), m.body).toBe(false)
    }
  })
})
