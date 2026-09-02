import { describe, it, expect } from 'vitest'
import {
  ticketPromedioDe, ventaPorPaxDe, variacionPct, paxEsConfiable, UMBRAL_PAX_CONFIABLE, LOCALES,
} from './types'
import {
  getSnapshotVentasEnVivo, fechaHoyCR, horaActualCR, horaCorteCR, servicioEnCursoCR, REFRESH_MS,
} from './mock'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ Analítica PoS · Fase A — el CONTRATO y el proveedor mock                               ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// Lo que se fija acá no es la pantalla: es la FORMA de los datos. Cuando el mock se reemplace
// por la lectura real del PoS, estos tests son el contrato que la implementación nueva tiene
// que seguir cumpliendo — si cambia la forma, se rompen, y esa es la idea.

describe('derivados · una sola fórmula por cifra', () => {
  it('ticket promedio = venta / tickets', () => {
    expect(ticketPromedioDe(250_000, 10)).toBe(25_000)
  })

  it('venta por pax = venta / pax', () => {
    expect(ventaPorPaxDe(240_000, 24)).toBe(10_000)
  })

  it('sin denominador da 0, no NaN — la pantalla muestra «—», nunca «NaN»', () => {
    expect(ticketPromedioDe(100_000, 0)).toBe(0)
    expect(ventaPorPaxDe(100_000, 0)).toBe(0)
    expect(ventaPorPaxDe(100_000, -3)).toBe(0)
  })
})

describe('variación contra el histórico', () => {
  it('positiva y negativa', () => {
    expect(variacionPct(110, 100)).toBeCloseTo(10)
    expect(variacionPct(90, 100)).toBeCloseTo(-10)
  })

  it('sin referencia devuelve null, que NO es lo mismo que 0', () => {
    // `0` significa «igual que la referencia». `null` significa «no hay con qué comparar».
    // Aplastarlos mostraría «▲ 0,0%» en un día sin histórico, que es una mentira chiquita.
    expect(variacionPct(500, 0)).toBeNull()
    expect(variacionPct(500, -1)).toBeNull()
    expect(variacionPct(100, 100)).toBe(0)
  })
})

describe('calidad del pax · el indicador de Fase A', () => {
  it('el umbral es exigente a propósito', () => {
    expect(UMBRAL_PAX_CONFIABLE).toBe(90)
    expect(paxEsConfiable({ pctPaxNativoCargado: 90 })).toBe(true)
    expect(paxEsConfiable({ pctPaxNativoCargado: 89 })).toBe(false)
  })
})

describe('el reloj es de Costa Rica (UTC−6 fijo)', () => {
  it('la fecha tiene forma de fecha y la hora está en rango', () => {
    expect(fechaHoyCR()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const h = horaActualCR()
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(23)
  })

  it('la hora CR es exactamente 6 menos que la UTC, sin horario de verano', () => {
    // Si alguien mete una librería de zonas con DST, esto se cae en agosto — que es
    // justamente el mes en que el desfase de BioTime pasó semanas invisible.
    const utc = new Date().getUTCHours()
    expect(horaActualCR()).toBe((utc - 6 + 24) % 24)
  })
})

describe('el proveedor mock · la forma del snapshot', () => {
  it('devuelve todas las secciones que la pantalla consume', async () => {
    const s = await getSnapshotVentasEnVivo('santa-teresa')

    expect(s.local).toBe('santa-teresa')
    expect(s.generadoEn).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(Array.isArray(s.porHora)).toBe(true)
    expect(Array.isArray(s.porCategoria)).toBe(true)
    expect(Array.isArray(s.topProductos)).toBe(true)
    expect(Array.isArray(s.saloneros)).toBe(true)
    expect(Array.isArray(s.calidadPax)).toBe(true)
    expect(typeof s.historico.mismoDiaSemanaPasada).toBe('number')
    expect(typeof s.historico.promedio4Semanas).toBe('number')
  })

  it('los derivados del día salen de las MISMAS funciones que exporta el contrato', async () => {
    // Si el mock calculara por su cuenta, la pantalla y el contrato podrían discrepar y el
    // día que se cablee el PoS nadie sabría cuál de los dos estaba bien.
    const { dia } = await getSnapshotVentasEnVivo('santa-teresa')
    expect(dia.ticketPromedio).toBe(ticketPromedioDe(dia.ventaAcumulada, dia.tickets))
    expect(dia.ventaPorPax).toBe(ventaPorPaxDe(dia.ventaAcumulada, dia.pax))
  })

  it('la venta acumulada es la suma de las horas — el KPI y el gráfico no pueden discrepar', async () => {
    const s = await getSnapshotVentasEnVivo('santa-teresa')
    const suma = s.porHora.reduce((acc, h) => acc + h.monto, 0)
    expect(s.dia.ventaAcumulada).toBe(suma)
  })

  it('las horas que todavía no llegaron van en CERO, no con venta inventada', async () => {
    const s = await getSnapshotVentasEnVivo('santa-teresa')
    const hora = horaCorteCR()
    for (const h of s.porHora) {
      if (h.hora > hora) {
        expect(h.monto).toBe(0)
        expect(h.tickets).toBe(0)
      }
    }
  })

  it('el mix cierra en 100 %', async () => {
    const { porCategoria } = await getSnapshotVentasEnVivo('santa-teresa')
    const total = porCategoria.reduce((s, c) => s + c.pctMix, 0)
    expect(total).toBeCloseTo(100, 4)
  })

  // ── Fuera de horario ──────────────────────────────────────────────────────────
  // A las 3 de la mañana el local está cerrado. Un dashboard que mostrara el «día de hoy»
  // quedaría en blanco y el que lo mira no sabría si es que no hay datos o si se rompió.
  it('SIEMPRE hay un servicio que mostrar, sea la hora que sea', async () => {
    const s = await getSnapshotVentasEnVivo('santa-teresa')
    expect(s.dia.ventaAcumulada).toBeGreaterThan(0)
    expect(s.dia.tickets).toBeGreaterThan(0)
  })

  it('fuera de horario muestra el servicio de AYER, completo, y lo declara', async () => {
    const s = await getSnapshotVentasEnVivo('santa-teresa')
    expect(s.servicioEnCurso).toBe(servicioEnCursoCR())
    if (!s.servicioEnCurso) {
      // Cerrado: la jornada es la anterior y no quedan horas en cero.
      expect(s.dia.fecha < fechaHoyCR()).toBe(true)
      expect(s.porHora.every(h => h.monto > 0)).toBe(true)
    } else {
      expect(s.dia.fecha).toBe(fechaHoyCR())
    }
  })

  it('las categorías y los productos vienen ordenados de mayor a menor', async () => {
    const s = await getSnapshotVentasEnVivo('santa-teresa')
    const cats = s.porCategoria.map(c => c.monto)
    expect([...cats].sort((a, b) => b - a)).toEqual(cats)
    const prods = s.topProductos.map(p => p.monto)
    expect([...prods].sort((a, b) => b - a)).toEqual(prods)
  })

  it('es DETERMINISTA: dos llamadas seguidas dan lo mismo', async () => {
    // El refresco de 30 s no puede repintar el gráfico entero con números nuevos: la pantalla
    // parecería rota. El mock varía con la hora, no con cada llamada.
    const a = await getSnapshotVentasEnVivo('santa-teresa')
    const b = await getSnapshotVentasEnVivo('santa-teresa')
    expect(b.dia.ventaAcumulada).toBe(a.dia.ventaAcumulada)
    expect(b.porHora).toEqual(a.porHora)
  })

  it('cada local tiene su propia magnitud', async () => {
    const st = await getSnapshotVentasEnVivo('santa-teresa')
    const no = await getSnapshotVentasEnVivo('nosara')
    expect(st.dia.ventaAcumulada).not.toBe(no.dia.ventaAcumulada)
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
