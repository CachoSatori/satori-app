// Alerta de días sin cierre (06/11) — SOLO LECTURA. No calcula plata ni toca el pozo: reusa
// `diasPendientesDeCierre` (cierrePozo.ts, sagrado, sin cambios) y suma dos señales más:
//   · jornadas con ventas en el PoS sin cierre completo;
//   · días con el Mediodía sellado (cierre parcial) y sin la Noche.
// Más los turnos de Caja Diaria que quedaron abiertos de un día anterior.
import type { CashCierreDia, CashMovement, CashSession } from '../../shared/types/database'
import { diasPendientesDeCierre, POZO_CORTE } from './cierrePozo'

export type MotivoDia = 'movimientos' | 'ventas' | 'cierre_parcial'
export interface DiaSinCierre {
  fecha: string
  motivos: MotivoDia[]
  movimientos: number
  crc: number
}
export interface TurnoSinCerrar {
  id: string
  fecha: string
  cajero: string | null
}
export interface AlertaCierres {
  dias: DiaSinCierre[]
  turnos: TurnoSinCerrar[]
}

export function calcularAlertaCierres(p: {
  hoy: string
  corte?: string
  cierres: CashCierreDia[]
  movements: CashMovement[]
  sessions: CashSession[]
  jornadasConVentas?: readonly string[]
}): AlertaCierres {
  const corte = p.corte ?? POZO_CORTE
  const enRango = (f: string) => !!f && f >= corte && f < p.hoy
  const completos = new Set(p.cierres.filter(c => c.tipo === 'completo').map(c => c.session_date))
  const porDia = new Map<string, DiaSinCierre>()
  const marcar = (fecha: string, motivo: MotivoDia): DiaSinCierre => {
    const d = porDia.get(fecha) ?? { fecha, motivos: [], movimientos: 0, crc: 0 }
    if (!d.motivos.includes(motivo)) d.motivos.push(motivo)
    porDia.set(fecha, d)
    return d
  }

  // 1) Plata de cajas físicas movida y sin cierre completo (la misma regla que traba el cierre).
  for (const d of diasPendientesDeCierre({ fecha: p.hoy, corte, cierres: p.cierres, movements: p.movements, sessions: p.sessions })) {
    const x = marcar(d.fecha, 'movimientos'); x.movimientos = d.movimientos; x.crc = d.crc
  }
  // 2) Ventas en el PoS (por jornada) sin cierre completo.
  for (const f of p.jornadasConVentas ?? []) if (enRango(f) && !completos.has(f)) marcar(f, 'ventas')
  // 3) Mediodía sellado sin Noche.
  for (const c of p.cierres) if (c.tipo === 'parcial_mediodia' && enRango(c.session_date) && !completos.has(c.session_date)) marcar(c.session_date, 'cierre_parcial')

  const turnos = p.sessions
    .filter(s => s.status === 'open' && s.session_date < p.hoy)
    .map(s => ({ id: s.id, fecha: s.session_date, cajero: s.cajero_name ?? null }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  return { dias: [...porDia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)), turnos }
}

/** Primer día de la ventana de ventas del PoS: el corte o `dias` atrás, el más nuevo. */
export function desdeVentanaVentas(hoy: string, corte: string = POZO_CORTE, dias = 60): string {
  const [y, m, d] = hoy.split('-').map(Number)
  const atras = new Date(Date.UTC(y, m - 1, d - dias)).toISOString().slice(0, 10)
  return atras > corte ? atras : corte
}

export const ETIQUETA_MOTIVO: Record<MotivoDia, string> = {
  movimientos: 'plata movida',
  ventas: 'ventas en el PoS',
  cierre_parcial: 'solo el Mediodía sellado',
}
