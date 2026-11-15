// Datos ficticios del embudo del anfitrión (mig 162) para las pruebas de la pantalla y del CSV.
import type { AnfitrionEmbudo, Embudo, GrupoEmbudo } from '../../shared/api/club'

const grupo = (x: Partial<GrupoEmbudo> = {}): GrupoEmbudo => ({
  anfitriones: 0, sin_cupones: 0, generados: 0, usados: 0, vigentes: 0, vencidos: 0, anulados: 0, clics_resena: null,
  con_factura: 0, personas: 0, facturas: 0, mesas: 0, venta_respaldada_crc: 0, venta_neta_crc: 0, ...x,
})
const anf = (x: Partial<AnfitrionEmbudo>): AnfitrionEmbudo => ({
  id: 'x', nombre: 'x', tipo: 'referente', grupo: 'anfitrion', estado: 'activo', local: 'Local P162 A',
  generados: 0, usados: 0, vigentes: 0, vencidos: 0, anulados: 0, clics_resena: null, con_factura: 0, personas: 0,
  facturas: 0, mesas: 0, venta_respaldada_crc: 0, venta_neta_crc: 0, tiquete_promedio_crc: null,
  pct_uso: null, pct_resena: null, pct_con_factura: null, personas_por_cupon: null, ...x,
})

export function embudoDePrueba(resena = false): Embudo {
  const c = (n: number) => (resena ? n : null)
  return {
    mes: '2001-03', mes_en_curso: false, local: 'p162-a', locales: ['p162-a'], generado_en: '2001-04-01T00:00:00Z',
    locales_sin_pos: [], resena_disponible: resena, d7: true,
    anfitriones: [
      anf({ id: 'e1', nombre: 'Equipo Uno', tipo: 'equipo', grupo: 'equipo', generados: 2, usados: 1, vigentes: 1, con_factura: 1,
            personas: 3, facturas: 1, mesas: 1, venta_respaldada_crc: 8000, venta_neta_crc: 8000, tiquete_promedio_crc: 8000,
            pct_uso: 50, pct_con_factura: 100, personas_por_cupon: 3, clics_resena: c(0), pct_resena: resena ? 0 : null }),
      anf({ id: 'r1', nombre: '=Referente Uno', generados: 6, usados: 4, vencidos: 1, anulados: 1, con_factura: 3, personas: 11,
            facturas: 3, mesas: 3, venta_respaldada_crc: 17000, venta_neta_crc: 24000, tiquete_promedio_crc: 5667,
            pct_uso: 66.7, pct_con_factura: 75, personas_por_cupon: 2.8, clics_resena: c(2), pct_resena: resena ? 50 : null }),
    ],
    grupos: {
      equipo: grupo({ anfitriones: 1, sin_cupones: 1, generados: 2, usados: 1, vigentes: 1, con_factura: 1, personas: 3, facturas: 1,
                      mesas: 1, venta_respaldada_crc: 8000, venta_neta_crc: 8000, clics_resena: c(0) }),
      anfitrion: grupo({ anfitriones: 1, sin_cupones: 1, generados: 6, usados: 4, vencidos: 1, anulados: 1, con_factura: 3, personas: 11,
                         facturas: 3, mesas: 3, venta_respaldada_crc: 17000, venta_neta_crc: 24000, clics_resena: c(2) }),
    },
    totales: grupo({ anfitriones: 2, sin_cupones: 2, generados: 8, usados: 5, vigentes: 1, vencidos: 1, anulados: 1, con_factura: 4,
                     personas: 14, facturas: 3, mesas: 3, venta_respaldada_crc: 17000, venta_neta_crc: 24000, clics_resena: c(2) }),
  }
}

export function embudoVacio(): Embudo {
  return {
    mes: '2026-11', mes_en_curso: true, local: 'p162-c', locales: ['p162-c'], generado_en: '2026-11-14T00:00:00Z',
    locales_sin_pos: ['Local P162 C'], resena_disponible: false, d7: false, anfitriones: [],
    grupos: { equipo: grupo(), anfitrion: grupo() }, totales: grupo(),
  }
}
