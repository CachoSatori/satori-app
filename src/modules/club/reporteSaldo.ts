import type { ReporteMes } from '../../shared/api/club'
/** Mes en curso (o futuro) según la hora de generación: el saldo es «a hoy», no «al cierre». */
export const esParcial = (r: Pick<ReporteMes, 'mes' | 'generado_en'>) =>
  r.mes >= new Date(r.generado_en).toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' }).slice(0, 7)
