// (12-nov, el dueño) El portal y las páginas públicas le hablan al cliente de «usted». Desde v1.2 (#140, migración 159)
// también el aviso de privacidad (`alta_aviso`): ya no hay excepción. Mismas palabras que src/shared/wallet/usted.test.ts.
import { test, expect } from 'vitest'
import { TEXTOS } from './i18n'

const TUTEO_VOSEO = new RegExp('(^|[^\\p{L}])(' + [
  'tu', 'tus', 'te', 'ti', 'contigo', 'vos', 'sos', 'tenés', 'podés', 'querés', 'sabés', 'estás', 'fuiste',
  'validá', 'mostrá', 'mostralo', 'probá', 'tocá', 'elegí', 'sumate', 'anotate', 'fijate', 'avisanos', 'escribinos',
  'pedí', 'usá', 'abrí', 'guardá', 'guardalo', 'agregá', 'agregalo', 'compartí', 'compartilo', 'esperá', 'volvé',
  'escaneá', 'canjeá', 'generá', 'completá', 'marcá', 'escribí', 'revisá', 'descargá', 'intentá', 'seguí', 'llamá',
].join('|') + ')(?=$|[^\\p{L}])', 'iu')

/** El texto de cada clave; las funciones se llaman con valores de ejemplo (1 y 2, un nombre, una fecha). */
function textos(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const [k, v] of Object.entries(TEXTOS.es)) {
    if (typeof v === 'string') out.push([k, v])
    else if (typeof v === 'function') {
      // cada función con los ejemplos que acepte (números para cantidades; textos para nombres y fechas)
      for (const arg of [1, 2, 'Ana', '12/11/2026']) {
        try { out.push([k, String((v as (a: unknown, b?: unknown) => unknown)(arg, 1))]) } catch { /* no es su tipo de dato */ }
      }
    }
    else if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) out.push([`${k}.${k2}`, String(v2)])
  }
  return out
}

test('club-web: ningún texto en español para el cliente tutea ni vosea (tampoco el aviso legal, desde v1.2)', () => {
  const t = textos()
  expect(t.length).toBeGreaterThan(80)
  expect(t.filter(([, s]) => TUTEO_VOSEO.test(s)).map(([k, s]) => `${k}: ${s}`)).toEqual([])
})

test('club-web: el aviso legal v1.2 está en «usted» y entra en el escaneo de arriba', () => {
  expect(TUTEO_VOSEO.test(TEXTOS.es.alta_aviso)).toBe(false)
  expect(textos().some(([k]) => k === 'alta_aviso')).toBe(true)
})
