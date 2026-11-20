// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Resumen de ventas del día para el correo del cierre (pedido del dueño 18-nov, etapa 1; opción B).
//
//  Orquesta, sin red (las lecturas entran por parámetro):
//    1. Guarda: solo cierres RECIENTES (creados en las últimas 36 h y con `session_date` entre el día CR de
//       hace 36 h y hoy CR). Así la función no sirve para leer ventas de días viejos con service_role.
//    2. La jornada del cierre y la del mismo día de la semana pasada (−7), cada una con su ventana.
//    3. Los números salen del paquete de la app (`ventasPos.gen.js` = `resumenCierrePuro.ts`), sin
//       fórmulas propias. Los nombres se leen al final, solo para los (máximo 2) logins destacados.
//  Cualquier falla → `resumen: null` con un motivo fijo (sin montos): el correo sale igual, con la línea
//  «Resumen de ventas no disponible», y el cierre nunca se entera.
// ───────────────────────────────────────────────────────────────────────────────────────────

/** Lo que devuelve `resumenVentasDia` (forma fijada por la prueba de contrato). */
export interface Destacado {
  login: string
  nombre: string | null
  netaSalon: number
  promPax: number | null
  mesas: number
  personas: number
}
export interface ResumenDia {
  dia: string
  facturas: number
  ventaBruta: number
  ventaNeta: number
  salon: number
  delivery: number
  pax: number
  promPax: number | null
  pctEstimado: number
  mesasDuenos: number
  regaliasTotales: number
  bebPax: number | null
  masVendio: Destacado | null
  mejorPromPax: Destacado | null
}
export interface ResumenCorreo {
  actual: ResumenDia
  /** El mismo día de la semana pasada (−7). `null` si no se pudo leer. */
  anterior: ResumenDia | null
  minMesas: number
  minPersonas: number
}

type Fila = Record<string, unknown>
/** La parte del paquete que se usa acá. */
export interface LogicaResumen {
  resumenVentasDia(tickets: Fila[], lineas: Fila[], dia: string, nombres?: Record<string, string>): ResumenDia
  sumarDias(d: string, n: number): string
  MIN_MESAS: number
  MIN_PERSONAS: number
}

export interface DepsResumen {
  logica: LogicaResumen
  leerVentana: (dia: string, local: string) => Promise<{ tickets: Fila[]; lineas: Fila[] }>
  leerNombres: (logins: string[]) => Promise<Record<string, string>>
  ahora: Date
}

export interface CierreParaResumen {
  session_date: string
  created_at?: string | null
  location_id?: string | null
}

export type MotivoSinResumen = 'cierre_viejo' | 'sin_fecha' | 'error_lectura'

export const VENTANA_HORAS = 36
const HORA_MS = 3_600_000
export const LOCAL_POR_DEFECTO = 'santa-teresa'

/** Día CR (UTC−6 fijo, sin horario de verano) de un instante. */
export function diaCR(ms: number): string {
  return new Date(ms - 6 * HORA_MS).toISOString().slice(0, 10)
}

/** ¿El cierre es de las últimas 36 h? Las DOS condiciones: creado hace ≤ 36 h y fecha de sesión reciente. */
export function cierreReciente(c: CierreParaResumen, ahora: Date): boolean {
  const creado = Date.parse(String(c.created_at ?? ''))
  if (Number.isNaN(creado)) return false
  const t = ahora.getTime()
  if (creado > t + 5 * 60_000 || t - creado > VENTANA_HORAS * HORA_MS) return false
  const fecha = String(c.session_date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false
  return fecha >= diaCR(t - VENTANA_HORAS * HORA_MS) && fecha <= diaCR(t)
}

export async function resumenParaCierre(
  c: CierreParaResumen,
  d: DepsResumen,
): Promise<{ resumen: ResumenCorreo | null; motivo: MotivoSinResumen | null }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.session_date ?? ''))) return { resumen: null, motivo: 'sin_fecha' }
  if (!cierreReciente(c, d.ahora)) return { resumen: null, motivo: 'cierre_viejo' }
  const local = (c.location_id ?? '').trim() || LOCAL_POR_DEFECTO
  try {
    const dia = c.session_date
    const v = await d.leerVentana(dia, local)
    const actual = d.logica.resumenVentasDia(v.tickets, v.lineas, dia, {})
    let anterior: ResumenDia | null = null
    try {
      const dia7 = d.logica.sumarDias(dia, -7)
      const v7 = await d.leerVentana(dia7, local)
      anterior = d.logica.resumenVentasDia(v7.tickets, v7.lineas, dia7, {})
    } catch { anterior = null }   // sin comparación, pero con el día
    const logins = [...new Set([actual.masVendio?.login, actual.mejorPromPax?.login].filter((x): x is string => !!x))]
    let nombres: Record<string, string> = {}
    try { nombres = await d.leerNombres(logins) } catch { nombres = {} }
    for (const s of [actual.masVendio, actual.mejorPromPax]) if (s) s.nombre = nombres[s.login] ?? null
    return { resumen: { actual, anterior, minMesas: d.logica.MIN_MESAS, minPersonas: d.logica.MIN_PERSONAS }, motivo: null }
  } catch {
    return { resumen: null, motivo: 'error_lectura' }
  }
}
