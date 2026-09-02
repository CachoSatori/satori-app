import { describe, it, expect } from 'vitest'
import type { CajeroDay, SaloneroDay } from '../../shared/types/ventas'
import { getDayStats, topProds } from './ventasUtils'
import {
  ARTICULO_PAX, LOCALES, mixPorCategoria, prodsDelDia, ticketsDelDia, ticketPromedioDe,
  variacionPct, paxEsConfiable, UMBRAL_PAX_CONFIABLE,
} from './ventasEnVivoTypes'
import {
  getSnapshotEnVivo, fechaHoyCR, horaActualCR, horaCorteCR, servicioEnCursoCR,
  CATALOGO_NOMBRES, REFRESH_MS,
} from './ventasEnVivoMock'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ Ventas · En vivo — que hable el MISMO idioma que el resto del módulo                   ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// Lo que se fija acá no es la pantalla: es que el snapshot sea un `DiaData` de verdad, del que
// las funciones que ya existen (`getDayStats`, `topProds`) puedan sacar los mismos números que
// sacan de un día importado del xls. Cuando el mock se reemplace por la lectura del PoS, estos
// tests son el contrato que la implementación nueva tiene que seguir cumpliendo.

describe('el snapshot es un DiaData de verdad', () => {
  it('tiene la forma que produce el import de xls', async () => {
    const { dia } = await getSnapshotEnVivo('santa-teresa')
    expect(typeof dia.fileName).toBe('string')
    expect(dia.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(Object.keys(dia.saloneros).length).toBeGreaterThan(0)
  })

  it('trae saloneros Y caja, como un día real', async () => {
    const { dia } = await getSnapshotEnVivo('santa-teresa')
    const filas = Object.values(dia.saloneros)
    expect(filas.some(s => (s as CajeroDay).esCajero === true)).toBe(true)
    expect(filas.some(s => !(s as CajeroDay).esCajero)).toBe(true)
  })

  it('cada salonero trae los campos que `SaloneroDay` declara', async () => {
    const { dia } = await getSnapshotEnVivo('santa-teresa')
    for (const [, s] of Object.entries(dia.saloneros)) {
      if ((s as CajeroDay).esCajero) continue
      const sl = s as SaloneroDay
      for (const k of ['pax', 'total', 'com', 'beb', 'iCom', 'iBeb', 'iva', 'serv'] as const) {
        expect(typeof sl[k]).toBe('number')
      }
      // `prods` es la tupla [nombre, qty, monto] — la misma que arma `xlsParser`.
      for (const p of sl.prods) {
        expect(p).toHaveLength(3)
        expect(typeof p[0]).toBe('string')
        expect(typeof p[1]).toBe('number')
        expect(typeof p[2]).toBe('number')
      }
    }
  })

  it('la caja trae los campos que `CajeroDay` declara', async () => {
    const { dia } = await getSnapshotEnVivo('santa-teresa')
    const caja = Object.values(dia.saloneros).find(s => (s as CajeroDay).esCajero) as CajeroDay
    for (const k of ['total', 'salon', 'delivery', 'iva', 'serv', 'ordenes', 'ticketProm'] as const) {
      expect(typeof caja[k]).toBe('number')
    }
    // Salón + delivery tienen que cerrar contra el total, como en el parser.
    expect(caja.salon + caja.delivery).toBe(caja.total)
  })
})

describe('los números del día salen de las funciones DE SIEMPRE', () => {
  it('`getDayStats` come el snapshot sin adaptadores', async () => {
    const { dia } = await getSnapshotEnVivo('santa-teresa')
    const s = getDayStats(dia)
    expect(s.ventaNeta).toBeGreaterThan(0)
    expect(s.pax).toBeGreaterThan(0)
    // La invariante del modelo: bruta = neta + IVA + servicio.
    expect(s.ventaBruta).toBe(s.ventaNeta + s.iva + s.serv)
    // promPax es salón / pax — la definición del módulo, no una nuestra.
    expect(s.promPax).toBeCloseTo(s.salon / s.pax, 6)
  })

  it('salón y delivery cierran contra la venta neta', async () => {
    const { dia } = await getSnapshotEnVivo('santa-teresa')
    const s = getDayStats(dia)
    expect(s.salon + s.delivery).toBeCloseTo(s.ventaNeta, 6)
  })

  it('saloneros y caja son ADITIVOS, como en `aggGeneral`', async () => {
    const { dia } = await getSnapshotEnVivo('santa-teresa')
    let sal = 0, caj = 0
    for (const s of Object.values(dia.saloneros)) {
      if ((s as CajeroDay).esCajero) caj += (s as CajeroDay).total
      else                           sal += (s as SaloneroDay).total
    }
    expect(getDayStats(dia).ventaNeta).toBeCloseTo(sal + caj, 6)
  })

  it('`topProds` come los productos del día sin adaptadores', async () => {
    const { dia } = await getSnapshotEnVivo('santa-teresa')
    const top = topProds(prodsDelDia(dia), 'monto', 5)
    expect(top.length).toBeGreaterThan(0)
    expect(top.map(p => p.m)).toEqual([...top.map(p => p.m)].sort((a, b) => b - a))
  })
})

// ── El artículo PAX ─────────────────────────────────────────────────────────────
// `xlsParser` lo saca del mix (`if (prod === 'PAX') return`): cuenta comensales, no es algo
// que se venda. Si se colara, inflaría las unidades y encabezaría «lo que más se vendió».
describe('el artículo PAX queda FUERA del mix', () => {
  it('el catálogo del mock no lo tiene', () => {
    expect(CATALOGO_NOMBRES).not.toContain(ARTICULO_PAX)
  })

  it('no aparece en los `prods` de ninguna fila', async () => {
    const { dia } = await getSnapshotEnVivo('santa-teresa')
    for (const s of Object.values(dia.saloneros)) {
      for (const [nombre] of s.prods) {
        expect(nombre.trim().toUpperCase()).not.toBe(ARTICULO_PAX)
      }
    }
  })

  it('y si igual llegara, el mix y el top lo descartan', () => {
    // El guard explícito importa para el día en que el feed venga del PoS, donde el pax SÍ
    // puede venir como artículo.
    const dia = {
      fileName: 'x', uploadedAt: '',
      saloneros: {
        FRAN: {
          pax: 10, total: 1000, com: 1000, beb: 0, iCom: 1, iBeb: 0, iva: 0, serv: 0,
          promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0,
          prods: [['PAX', 10, 0], ['ROLL SATORI', 1, 1000]] as [string, number, number][],
        } as SaloneroDay,
      },
    }
    const pm = { 'ROLL SATORI': { tipo: 'comida', clasificacion: 'SUSHI', subclasificacion: '', multiplicador: 1, costo_unitario: 0 } }
    expect(mixPorCategoria(dia, pm).map(c => c.categoria)).toEqual(['SUSHI'])
    expect(Object.keys(prodsDelDia(dia))).toEqual(['ROLL SATORI'])
  })
})

describe('el mix se agrupa por clasificación, igual que Mix Ventas', () => {
  it('usa `pm[nombre].clasificacion` y cierra en 100 %', async () => {
    const { dia, pm } = await getSnapshotEnVivo('santa-teresa')
    const mix = mixPorCategoria(dia, pm)
    expect(mix.length).toBeGreaterThan(0)
    expect(mix.reduce((s, c) => s + c.pctMix, 0)).toBeCloseTo(100, 4)
    // Ordenado de mayor a menor.
    expect(mix.map(c => c.monto)).toEqual([...mix.map(c => c.monto)].sort((a, b) => b - a))
    // Todas las categorías salen del ProductMap, ninguna cae en el fallback.
    expect(mix.map(c => c.categoria)).not.toContain('SIN CLASIFICAR')
  })
})

describe('derivados live-only', () => {
  it('los tickets salen del ritmo por hora — el xls solo cuenta `ordenes` de caja', async () => {
    const { porHora } = await getSnapshotEnVivo('santa-teresa')
    expect(ticketsDelDia(porHora)).toBe(porHora.reduce((s, h) => s + h.tickets, 0))
  })

  it('ticket promedio = venta / tickets, y sin tickets es 0, no NaN', () => {
    expect(ticketPromedioDe(250_000, 10)).toBe(25_000)
    expect(ticketPromedioDe(100_000, 0)).toBe(0)
  })

  it('sin referencia la variación es null, que NO es lo mismo que 0', () => {
    // `0` es «igual que la referencia»; `null` es «no hay con qué comparar». Aplastarlos
    // mostraría «▲ 0,0%» en un día sin histórico.
    expect(variacionPct(500, 0)).toBeNull()
    expect(variacionPct(100, 100)).toBe(0)
    expect(variacionPct(110, 100)).toBeCloseTo(10)
  })

  it('el umbral de confianza del pax es exigente a propósito', () => {
    expect(UMBRAL_PAX_CONFIABLE).toBe(90)
    expect(paxEsConfiable({ pctPaxNativoCargado: 90 })).toBe(true)
    expect(paxEsConfiable({ pctPaxNativoCargado: 89 })).toBe(false)
  })
})

describe('el reloj es de Costa Rica (UTC−6 fijo)', () => {
  it('la hora CR es exactamente 6 menos que la UTC, sin horario de verano', () => {
    // Si alguien mete una librería de zonas con DST, esto se cae en agosto — el mes en que el
    // desfase de BioTime pasó semanas invisible.
    expect(horaActualCR()).toBe((new Date().getUTCHours() - 6 + 24) % 24)
  })

  it('la venta acumulada es la suma de las horas: el KPI y el gráfico no pueden discrepar', async () => {
    const s = await getSnapshotEnVivo('santa-teresa')
    expect(getDayStats(s.dia).ventaNeta).toBeCloseTo(s.porHora.reduce((a, h) => a + h.monto, 0), 0)
  })

  it('las horas que todavía no llegaron van en CERO, no con venta inventada', async () => {
    const s = await getSnapshotEnVivo('santa-teresa')
    for (const h of s.porHora) {
      if (h.hora > horaCorteCR()) { expect(h.monto).toBe(0); expect(h.tickets).toBe(0) }
    }
  })

  // A las 3 de la mañana el local está cerrado. Un dashboard que mostrara el «día de hoy»
  // quedaría en blanco y el que lo mira no sabría si no hay datos o si se rompió.
  it('SIEMPRE hay un servicio que mostrar, sea la hora que sea', async () => {
    const s = await getSnapshotEnVivo('santa-teresa')
    expect(getDayStats(s.dia).ventaNeta).toBeGreaterThan(0)
  })

  it('fuera de horario muestra el servicio de AYER, completo, y lo declara', async () => {
    const s = await getSnapshotEnVivo('santa-teresa')
    expect(s.servicioEnCurso).toBe(servicioEnCursoCR())
    if (!s.servicioEnCurso) {
      expect(s.fecha < fechaHoyCR()).toBe(true)
      expect(s.porHora.every(h => h.monto > 0)).toBe(true)
    } else {
      expect(s.fecha).toBe(fechaHoyCR())
    }
  })
})

describe('el proveedor mock', () => {
  it('es DETERMINISTA: dos llamadas seguidas dan lo mismo', async () => {
    // El refresco de 30 s no puede repintar el gráfico con números nuevos: parecería roto.
    const a = await getSnapshotEnVivo('santa-teresa')
    const b = await getSnapshotEnVivo('santa-teresa')
    expect(b.porHora).toEqual(a.porHora)
    expect(getDayStats(b.dia).ventaNeta).toBe(getDayStats(a.dia).ventaNeta)
  })

  it('cada local tiene su propia magnitud', async () => {
    const st = await getSnapshotEnVivo('santa-teresa')
    const no = await getSnapshotEnVivo('nosara')
    expect(getDayStats(st.dia).ventaNeta).not.toBe(getDayStats(no.dia).ventaNeta)
    expect(no.local).toBe('nosara')
  })

  it('los dos locales son los mismos slugs que usa el resto de la app', () => {
    // Mismos valores que `locations.id`, `work_days.local` y el biotime-bridge. Si divergen,
    // cruzar ventas con horas deja de funcionar y nadie se entera hasta que falta un local.
    expect(LOCALES.map(l => l.id)).toEqual(['santa-teresa', 'nosara'])
  })

  it('el refresco es de 30 s', () => {
    expect(REFRESH_MS).toBe(30_000)
  })
})
