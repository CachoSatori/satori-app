// Datos FICTICIOS para pruebas y vista previa (repo público: ningún nombre ni monto real).
import type { CierreCorreo } from './plantilla.ts'

export const cierreCuadraEjemplo: CierreCorreo = {
  session_date: '2026-11-15',
  manager: 'Ana Prueba',
  vm_crc: 812_400, vm_usd: 145,
  vn_crc: 2_315_900, vn_usd: 380.5,
  propinas_m_crc: 96_000, propinas_n_crc: 241_500,
  sep_diaria_crc: 650_000, sep_diaria_usd: 200,
  sep_registradora_crc: 100_000, sep_registradora_usd: 0,
  remanente_crc: 1_284_350, remanente_usd: 325.5,
  diferencia_crc: 150,
  ajuste_tipo: null, ajuste_motivo: null,
  notas: 'Se cambió el rollo de la impresora de la barra.',
  tipo_cambio: 505.2,
}

export const cierreFaltanteEjemplo: CierreCorreo = {
  ...cierreCuadraEjemplo,
  diferencia_crc: -12_500,
  ajuste_tipo: 'Faltante',
  ajuste_motivo: 'Vuelto de una mesa mal contado',
  notas: null,
}
