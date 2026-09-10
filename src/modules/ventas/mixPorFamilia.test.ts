// ── E2 · Mix por familia (fusión conservadora) + delivery por caja de turno ────────────────
//
// ── QUÉ SE ARREGLA ─────────────────────────────────────────────────────────────────────────
// `VentasMix.buildPMRaw` clasifica TODO con `pm[nombre]`, y ese `pm` era solo el `product_map`
// curado a mano. Los productos del PoS que nadie cargó caían en `desconocido` → sección
// «MERCHANDISING / OTROS». `armarDia` ya construye un ProductMap por FAMILIA mientras recorre
// las líneas, y hasta ahora se descartaba: ahora viaja con los días y se fusiona.
//
// ── POR QUÉ LA FUSIÓN ES CONSERVADORA ──────────────────────────────────────────────────────
// `product_map.tipo` tiene HOY dos vocabularios mezclados: el de la app (`comida`, `bebida`,
// `cortesia`…) y las CATEGORÍAS del CSV que escribió `scripts/import-carta.py:62`
// (`SUSHI ROLLS`, `X CORTESIAS`, `GREENSEASON`…). La familia rellena lo segundo y lo no curado,
// y NUNCA pisa lo primero — que es lo que garantiza que `aggGeneral.cortTotal`/`persTotal`,
// Menu Engineering y la Paridad no se muevan, y que los días del .xls queden idénticos.
import { describe, it, expect } from 'vitest'

import type { ProductMap } from '../../shared/types/ventas'
import { aggSalonero, esTipoCurado, fusionarProductMap, TIPOS_PRODUCTO } from './ventasUtils'
import type { DiasMap, SaloneroDay } from '../../shared/types/ventas'
import { CLAVES_CAJERO_TURNO, CLAVE_SALON_SIN_MESERO, CLAVE_SISTEMA_OTROS } from './baldesNoMesero'
import { armarDiasMap } from './ventasDiasDesdePos'
import type { LineaNdfRow, TicketNdfConId } from '../../shared/api/posNdf'

const info = (o: Partial<ProductMap[string]> = {}): ProductMap[string] => ({
  tipo: '', clasificacion: '', subclasificacion: '', multiplicador: 1, costo_unitario: 0, ...o,
})

describe('esTipoCurado · qué se respeta y qué se rellena', () => {
  it('los tipos del vocabulario de la app SÍ son curados', () => {
    for (const t of TIPOS_PRODUCTO.filter(t => t !== 'desconocido')) {
      expect(esTipoCurado(t)).toBe(true)
    }
  })

  it('`desconocido`, vacío y null NO lo son', () => {
    expect(esTipoCurado('desconocido')).toBe(false)
    expect(esTipoCurado('')).toBe(false)
    expect(esTipoCurado(null)).toBe(false)
    expect(esTipoCurado(undefined)).toBe(false)
  })

  it('las CATEGORÍAS del CSV tampoco: son las que hay que rellenar', () => {
    // Son las que escribió `import-carta.py`; ninguna pantalla sabe leerlas.
    for (const t of ['SUSHI ROLLS', 'BEBIDAS', 'GREENSEASON', 'X CORTESIAS', 'TSHIRTS']) {
      expect(esTipoCurado(t)).toBe(false)
    }
  })
})

describe('fusionarProductMap · campo por campo', () => {
  const FAMILIA: ProductMap = {
    'ROLL SATORI':   info({ tipo: 'comida', clasificacion: 'Rolls' }),
    'IMPERIAL':      info({ tipo: 'bebida', clasificacion: 'Bebidas' }),
    'KOROKKE BENTO': info({ tipo: 'comida', clasificacion: 'GreenSeason' }),
  }

  it('un producto que solo está en el PoS entra con lo que dice su familia', () => {
    const out = fusionarProductMap({}, FAMILIA)
    expect(out['ROLL SATORI'].tipo).toBe('comida')
    expect(out['KOROKKE BENTO'].clasificacion).toBe('GreenSeason')
  })

  it('un tipo VÁLIDO puesto a mano NO se pisa — es la garantía del pase', () => {
    const curado: ProductMap = { 'ROLL SATORI': info({ tipo: 'cortesia', clasificacion: 'X' }) }
    const out = fusionarProductMap(curado, FAMILIA)
    expect(out['ROLL SATORI'].tipo).toBe('cortesia')
    expect(out['ROLL SATORI'].clasificacion).toBe('X')
  })

  it('una CATEGORÍA del CSV sí se rellena con la familia', () => {
    const curado: ProductMap = { 'ROLL SATORI': info({ tipo: 'SUSHI ROLLS', multiplicador: 3 }) }
    const out = fusionarProductMap(curado, FAMILIA)
    expect(out['ROLL SATORI'].tipo).toBe('comida')
    expect(out['ROLL SATORI'].clasificacion).toBe('Rolls')
  })

  it('`desconocido` también se rellena', () => {
    const curado: ProductMap = { 'IMPERIAL': info({ tipo: 'desconocido' }) }
    expect(fusionarProductMap(curado, FAMILIA)['IMPERIAL'].tipo).toBe('bebida')
  })

  it('multiplicador y costo SIEMPRE los gana el curado — la familia no los sabe', () => {
    const curado: ProductMap = {
      'IMPERIAL':    info({ tipo: 'SUSHI ROLLS', multiplicador: 6, costo_unitario: 900 }),
      'ROLL SATORI': info({ tipo: 'cortesia',    multiplicador: 2, costo_unitario: 500 }),
    }
    const out = fusionarProductMap(curado, FAMILIA)
    expect(out['IMPERIAL'].multiplicador).toBe(6)      // aunque el tipo lo pise la familia
    expect(out['IMPERIAL'].costo_unitario).toBe(900)
    expect(out['ROLL SATORI'].multiplicador).toBe(2)
    expect(out['ROLL SATORI'].costo_unitario).toBe(500)
  })

  it('un producto que solo está en el curado (el .xls) queda intacto', () => {
    const curado: ProductMap = { 'CAMISETA': info({ tipo: 'merchandising', costo_unitario: 3_000 }) }
    expect(fusionarProductMap(curado, FAMILIA)['CAMISETA']).toEqual(curado['CAMISETA'])
  })

  it('no muta el mapa curado que recibe', () => {
    const curado: ProductMap = { 'ROLL SATORI': info({ tipo: 'cortesia' }) }
    const copia = structuredClone(curado)
    fusionarProductMap(curado, FAMILIA)
    expect(curado).toEqual(copia)
  })

  it('fusionar dos veces sobre el curado original da lo mismo (idempotente)', () => {
    // `VentasModule` fusiona una vez con el eager y otra con el fondo, siempre sobre el curado
    // ORIGINAL: el resultado no puede depender del orden de llegada.
    const curado: ProductMap = { 'ROLL SATORI': info({ tipo: 'SUSHI ROLLS', multiplicador: 3 }) }
    const unaVez = fusionarProductMap(curado, FAMILIA)
    expect(fusionarProductMap(curado, FAMILIA)).toEqual(unaVez)
  })
})

describe('Fix B · el delivery del Mix son las cajas de TURNO, no la marca', () => {
  const esCajaDeTurno = (c: string) => (CLAVES_CAJERO_TURNO as readonly string[]).includes(c)

  it('los dos turnos cuentan como delivery', () => {
    for (const c of CLAVES_CAJERO_TURNO) expect(esCajaDeTurno(c)).toBe(true)
  })

  it('«Salón sin mesero» NO — su plata es de salón por definición', () => {
    // Con la marca `esCajero` se habría ido a delivery: es el bug que este criterio evita.
    expect(esCajaDeTurno(CLAVE_SALON_SIN_MESERO)).toBe(false)
  })

  it('«Sistema y otros» y los meseros tampoco', () => {
    expect(esCajaDeTurno(CLAVE_SISTEMA_OTROS)).toBe(false)
    expect(esCajaDeTurno('MAXO')).toBe(false)
  })
})

describe('armarDiasMap · el familia-pm ya no se tira', () => {
  const ticket = (over: Partial<TicketNdfConId> = {}): TicketNdfConId => ({
    id: 't1', numero_factura: '1', estado: 'C', fecha_registra: '2026-09-01T19:00:00-06:00',
    fecha_cierra: '2026-09-02T01:00:00-06:00', cajero_login: '222',
    canal: 'salon', mesa: null, salonero_login: '026', registrado_por: 'salonero', turno: 'noche',
    con_servicio: true, servicio_crc: 0, total_crc: 12000, valor_servido_crc: 12000,
    iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
    pax: 2, pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok', ...over,
  })
  const linea = (over: Partial<LineaNdfRow> = {}): LineaNdfRow => ({
    ticket_id: 't1', codigo_producto: '1', nombre: 'ROLL SATORI',
    cantidad: 1, monto: 9000, familia: 3, usuario_registra: '026', ...over,
  })

  const r = armarDiasMap(
    [ticket()],
    [
      linea(),
      linea({ codigo_producto: '2', nombre: 'IMPERIAL',      cantidad: 1, monto: 2000, familia: 5 }),
      linea({ codigo_producto: '3', nombre: 'KOROKKE BENTO', cantidad: 1, monto: 1000, familia: 29 }),
      // Familia 22 (extras): fuera del neto → NO tiene que entrar al pm por familia.
      linea({ codigo_producto: '4', nombre: 'EXTRA SALSA',   cantidad: 1, monto:  500, familia: 22 }),
    ],
    { desde: '2026-09-01', hasta: '2026-09-01' },
    { uploadedAt: '2026-09-02' },
  )

  it('devuelve los días Y el pm por familia', () => {
    expect(Object.keys(r.dias)).toEqual(['2026-09-01'])
    expect(Object.keys(r.pm).sort()).toEqual(['IMPERIAL', 'KOROKKE BENTO', 'ROLL SATORI'])
  })

  it('clasifica por familia: 5 = bebida, el resto del neto = comida', () => {
    expect(r.pm['IMPERIAL'].tipo).toBe('bebida')
    expect(r.pm['ROLL SATORI'].tipo).toBe('comida')
    expect(r.pm['KOROKKE BENTO'].tipo).toBe('comida')
    expect(r.pm['KOROKKE BENTO'].clasificacion).toBe('GreenSeason')
  })

  it('lo que NO es neto queda afuera — merch y extras siguen en OTROS, como se firmó', () => {
    expect(r.pm['EXTRA SALSA']).toBeUndefined()
  })

  it('con ese pm, el Mix deja de mandar la plata del PoS a «desconocido»', () => {
    // Es la cuenta exacta que hace `buildPMRaw`: `pm[nombre]?.tipo ?? 'desconocido'`.
    const fusionado = fusionarProductMap({}, r.pm)
    const tipoEnMix = (n: string) => fusionado[n]?.tipo ?? 'desconocido'
    expect(tipoEnMix('ROLL SATORI')).toBe('comida')
    expect(tipoEnMix('IMPERIAL')).toBe('bebida')
    expect(tipoEnMix('EXTRA SALSA')).toBe('desconocido')   // fuera de alcance, a propósito
  })
})

// ── El multiplicador de bebida queda CONGELADO ─────────────────────────────────────────────
//
// `aggSalonero` recalcula `iBeb` como `Σ q × multiplicador` sobre los productos de tipo
// `bebida` (una botella que cuenta como 6 tragos). Antes de la fusión, los productos del PoS
// no estaban en el mapa —o estaban con la categoría del CSV—, así que NUNCA entraban a esa
// cuenta y el cálculo caía al `|| iBeb` crudo. Activarlos de golpe movería `bebPax`,
// `promBebida`, `ratioU` y `promTicket` de todos los días del PoS, que no es lo que este pase
// vino a hacer. La marca `tipoDeFamilia` los deja afuera; el multiplicador sigue aplicándose
// donde siempre se aplicó: los productos que alguien clasificó a mano.
describe('iBebAdj · el multiplicador NO se activa por la fusión', () => {
  const sal = (o: Partial<SaloneroDay>): SaloneroDay => ({
    pax: 0, total: 0, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
    promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [], ...o,
  })

  /** Un día del PoS: 20 comensales y 10 unidades de una bebida. */
  const DIAS: DiasMap = {
    '2026-09-07': {
      fileName: 'ndf', uploadedAt: '2026-09-08',
      saloneros: {
        MAXO: sal({
          pax: 20, total: 200_000, com: 150_000, beb: 50_000, iCom: 40, iBeb: 10,
          prods: [['ROLL SATORI', 40, 150_000], ['BOTELLA SAKE', 10, 50_000]],
        }),
      },
    },
  }
  const FECHA = ['2026-09-07']
  const FAMILIA = { 'BOTELLA SAKE': info({ tipo: 'bebida', clasificacion: 'Bebidas' }) }

  it('día PoS con una bebida de multiplicador 6: bebPax NO cambia con la fusión', () => {
    // ANTES: el curado tiene el producto con la CATEGORÍA del CSV, que ninguna pantalla lee,
    // así que el multiplicador nunca se aplicaba y la cuenta caía al `iBeb` crudo (10).
    const curado = { 'BOTELLA SAKE': info({ tipo: 'BEBIDAS', multiplicador: 6 }) }
    const antes = aggSalonero('MAXO', FECHA, DIAS, curado)
    expect(antes.iBeb).toBe(10)
    expect(antes.bebPax).toBe(0.5)                       // 10 ÷ 20

    // DESPUÉS: la fusión le pone `tipo: 'bebida'`, pero marcado como de familia.
    const fusionado = fusionarProductMap(curado, FAMILIA)
    expect(fusionado['BOTELLA SAKE'].tipo).toBe('bebida')
    expect(fusionado['BOTELLA SAKE'].tipoDeFamilia).toBe(true)
    expect(fusionado['BOTELLA SAKE'].multiplicador).toBe(6)   // el curado se conserva…

    const despues = aggSalonero('MAXO', FECHA, DIAS, fusionado)
    expect(despues.iBeb).toBe(10)                        // …pero NO se activa
    expect(despues.bebPax).toBe(antes.bebPax)
    expect(despues.promBebida).toBe(antes.promBebida)
    expect(despues.ratioU).toBe(antes.ratioU)
    expect(despues.promTicket).toBe(antes.promTicket)
  })

  it('sin la marca se habría disparado a 60 — el test de que el freeze hace algo', () => {
    const sinMarca = { 'BOTELLA SAKE': info({ tipo: 'bebida', multiplicador: 6 }) }
    expect(aggSalonero('MAXO', FECHA, DIAS, sinMarca).iBeb).toBe(60)   // 10 × 6
  })

  it('un producto sin curar tampoco lo activa: entra solo por familia', () => {
    const despues = aggSalonero('MAXO', FECHA, DIAS, fusionarProductMap({}, FAMILIA))
    expect(despues.iBeb).toBe(10)
    expect(despues.bebPax).toBe(0.5)
  })

  it('el .xls NO regresiona: con el tipo curado a mano, el multiplicador sigue aplicándose', () => {
    // Acá `bebida` es válido → la fusión lo respeta y NO lo marca → la cuenta se hace igual
    // que siempre. Es el caso de los días del Excel, donde el tipo siempre lo puso una persona.
    const curado = { 'BOTELLA SAKE': info({ tipo: 'bebida', multiplicador: 6 }) }
    const fusionado = fusionarProductMap(curado, FAMILIA)
    expect(fusionado['BOTELLA SAKE'].tipoDeFamilia).toBe(false)
    expect(aggSalonero('MAXO', FECHA, DIAS, fusionado).iBeb).toBe(60)
    expect(aggSalonero('MAXO', FECHA, DIAS, fusionado).iBeb)
      .toBe(aggSalonero('MAXO', FECHA, DIAS, curado).iBeb)   // idéntico a antes de la fusión
  })
})
