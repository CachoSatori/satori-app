// Alerta de días sin cierre del Inicio, leída UNA VEZ POR SESIÓN (rediseño B5, auditoría 197,
// aprobada en `docs/rediseno/DECISIONES.md` el 11-nov 15:55).
//
// Solo cambia *cuándo* se lee: las mismas funciones con los mismos argumentos que usa Caja. El
// resultado vive en la memoria del módulo, así que se reusa hasta cerrar la app o recargar. Si la
// lectura falla, NO se guarda: se reintenta en la próxima visita al Inicio.
import { getCashSessions, getAllCashMovements, getCierresDia } from '../shared/api/cash'
import { getJornadasConVentas } from '../shared/api/jornadasConVentas'
import { calcularAlertaCierres, desdeVentanaVentas, type AlertaCierres } from '../modules/cash/diasSinCierre'

// Clave = usuario + día: otro usuario en la misma pestaña, o el cambio de día, vuelve a leer.
let guardada: { clave: string; alerta: AlertaCierres } | null = null

/** La alerta ya leída en esta sesión, o `null` si todavía no se leyó. */
export function alertaGuardada(usuario: string, hoy: string): AlertaCierres | null {
  return guardada && guardada.clave === `${usuario}|${hoy}` ? guardada.alerta : null
}

/** Lee la alerta (rechaza si falla alguna de sus lecturas) y la guarda para la sesión. */
export async function leerAlertaInicio(usuario: string, hoy: string): Promise<AlertaCierres> {
  const [y, m, d] = hoy.split('-').map(Number)
  const ayer = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
  const [cierres, movements, sessions, jornadasConVentas] = await Promise.all([
    getCierresDia(),
    getAllCashMovements(),
    getCashSessions(),
    getJornadasConVentas(desdeVentanaVentas(hoy), ayer),
  ])
  const alerta = calcularAlertaCierres({ hoy, cierres, movements, sessions, jornadasConVentas })
  guardada = { clave: `${usuario}|${hoy}`, alerta }
  return alerta
}

/** Solo para los tests. */
export function olvidarAlertaInicio(): void {
  guardada = null
}
