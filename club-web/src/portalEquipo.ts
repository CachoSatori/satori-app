/**
 * D7 A (firma del dueño, 14-nov; mig 157): la cuenta del EQUIPO de Satori sigue con su QR y sus cupones y registra
 * personas a su nombre, pero no tiene créditos: su portal muestra «Personas registradas» (del mes y en total) y nunca el
 * botón «Canjear», aunque la base mande créditos (por ejemplo, una versión vieja de club_portal).
 */
export interface DatosModoPortal { equipo?: boolean | null; creditos: number }

export function modoPortal(p: DatosModoPortal): { equipo: boolean; canje: boolean } {
  const equipo = p.equipo === true
  return { equipo, canje: !equipo && Number(p.creditos) >= 1 }
}
