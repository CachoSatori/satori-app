// Fixture compartida de Cohortes y Ranking (datos ficticios; mismos números que scripts/sql/161_pruebas.sql).
import type { Cohortes, Ranking, SocioRanking } from '../../shared/api/club'

export function cohortesDePrueba(over: Partial<Cohortes> = {}): Cohortes {
  return {
    local: 'p161-a', locales: ['p161-a'], hoy: '2026-11-14', generado_en: '2026-11-14T12:00:00Z',
    cohortes: [
      { mes: '2026-11', socios: 1, bajas: 0, con_2: 0, con_4: 0, activos_30: null, activos_60: null, activos_90: null, visitas: 0, visitas_por_socio: 0 },
      { mes: '2001-02', socios: 1, bajas: 1, con_2: 1, con_4: 0, activos_30: 1, activos_60: 1, activos_90: 0, visitas: 3, visitas_por_socio: 3 },
      { mes: '2001-01', socios: 2, bajas: 0, con_2: 1, con_4: 1, activos_30: 1, activos_60: 1, activos_90: 1, visitas: 7, visitas_por_socio: 3.5 },
    ],
    totales: { socios: 4, bajas: 1, con_2: 2, con_4: 1, visitas: 10, visitas_por_socio: 2.5 },
    ...over,
  }
}
export const cohortesVacias = (): Cohortes => cohortesDePrueba({
  cohortes: [], totales: { socios: 0, bajas: 0, con_2: 0, con_4: 0, visitas: 0, visitas_por_socio: null },
})

const socio = (o: Partial<SocioRanking>): SocioRanking => ({
  id: 'x', nombre: 'X', local_alta: 'Local P161 A', estado: 'activo', alta: '2001-01-10', visitas: 0, mesas: 0, facturas: 0,
  venta_respaldada_crc: 0, tiquete_promedio_crc: null, personas: 0, invitados: 0, descuento_estimado_crc: 0, ultima_visita: null, ...o,
})
export function rankingDePrueba(over: Partial<Ranking> = {}): Ranking {
  return {
    desde: '2001-03-01', hasta: '2001-03-31', local: 'p161-a', locales: ['p161-a'], generado_en: '2001-04-01T12:00:00Z',
    locales_sin_pos: [],
    socios: [
      socio({ id: 's1', nombre: 'Socio Uno', visitas: 3, mesas: 2, facturas: 2, venta_respaldada_crc: 32000, tiquete_promedio_crc: 16000,
              personas: 7, invitados: 3, descuento_estimado_crc: 5000, ultima_visita: '2001-03-26' }),
      socio({ id: 's6', nombre: 'Socio Otro Local', local_alta: 'Local P161 B', visitas: 1, mesas: 1, facturas: 1,
              venta_respaldada_crc: 15000, tiquete_promedio_crc: 15000, personas: 4, invitados: 1, descuento_estimado_crc: 2000, ultima_visita: '2001-03-26' }),
      socio({ id: 's3', nombre: 'Socio Tres', estado: 'baja', visitas: 1, ultima_visita: '2001-03-08' }),
      socio({ id: 's2', nombre: 'Socio Dos', ultima_visita: '2001-01-31' }),
      socio({ id: 's7', nombre: '=Socio Nuevo' }),
    ],
    totales: { socios: 5, socios_con_visita: 3, visitas: 5, facturas: 2, venta_respaldada_crc: 32000, invitados: 3,
               descuento_estimado_crc: 5000, lineas_sin_referencia: 1 },
    ...over,
  }
}
export const rankingVacio = (): Ranking => rankingDePrueba({
  local: 'p161-c', locales: ['p161-c'], locales_sin_pos: ['Local P161 C'], socios: [],
  totales: { socios: 0, socios_con_visita: 0, visitas: 0, facturas: 0, venta_respaldada_crc: 0, invitados: 0, descuento_estimado_crc: 0, lineas_sin_referencia: 0 },
})
