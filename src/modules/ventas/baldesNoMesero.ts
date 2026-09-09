// ── Los baldes de lo que NO es un mesero, y cómo se dice un turno ──────────────────────────
//
// Módulo PURO: sin I/O, sin Supabase, sin reloj. Vive aparte de `ventasEnVivoDatos` a
// propósito — ese arrastra el cliente de Supabase, y estas constantes las necesitan las
// PANTALLAS, que no pueden depender de la capa de API solo para saber cómo se llama un balde.

import { LOGIN_CAJERO_MANANA, LOGIN_CAJERO_NOCHE } from '../../shared/ndf/mapTicket'

/**
 * El `turno` que guarda el PoS → cómo se dice en pantalla.
 *
 * El valor guardado del turno de la noche es `'noche'` y **no se toca**: está en la columna
 * `turno` de `pos_ndf_tickets`, lo escribe el mapper y lo defiende un CHECK. Pero el negocio a
 * ese turno le dice «tarde» (el cajero 222 arranca a las 16:00, no de noche), así que la
 * TRADUCCIÓN vive acá, en el borde de la pantalla, y en ningún lado más.
 */
export const ETIQUETA_TURNO_POS: Record<string, string> = {
  'mañana': 'Mañana',
  'manana': 'Mañana',
  'noche':  'Tarde',
  'tarde':  'Tarde',
}

export function etiquetaTurnoPoS(turno: string | null | undefined): string {
  if (!turno) return 'Sin turno'
  return ETIQUETA_TURNO_POS[turno] ?? turno
}

// ── Los baldes de lo que NO es un mesero ───────────────────────────────────────────────────
//
// REGLA FIRMADA (2026-09-08). El eje es **qué se vendió y quién lo cobró**, no el login que
// aparece en la factura. Antes cada login abría su propia tarjeta (`Caja · 388`,
// `Sistema · 002`, `Sin salonero`), lo que partía la caja en pedazos que no significan nada
// para el negocio y escondía el turno, que es lo que sí se mira.
//
//   CAJEROS  = `registrado_por = 'cajero'` **Y** `canal <> 'salon'`, partido por la CAJA QUE
//              COBRÓ: `111` → Mañana · `222` → Tarde. Cualquier otro login cobrando (el `388`
//              de barra, que casi no se usa, o una factura sin login) cae en **Mañana**.
//              NO se filtra por mesa. El «Total Cajeros» es la suma de estos dos y nada más.
//
//   SALÓN SIN MESERO = `cajero` + `canal = 'salon'`  ∪  `sin_pedido` + `canal = 'salon'`.
//              Es venta de SALÓN que la factura no le acredita a ningún mesero. Un solo
//              rótulo: no es una persona, así que no compite en el ranking ni entra a
//              Competencias o Empleados. Queda FUERA del Total Cajeros.
//              ⚠️ Que la FACTURA no tenga dueño no quiere decir que no se sepa quién comandó:
//              `pos_ndf_lineas.usuario_registra` lo dice LÍNEA POR LÍNEA, y eso ya está
//              resuelto en la lente «venta propia» de Saloneros por línea. Las dos lentes
//              NO se suman (regla firmada, ver `saloneroLentes.ts`): en la vista por FACTURA
//              el rótulo honesto es «Salón sin mesero», y el nombre se busca en la otra lente.
//
//   SISTEMA Y OTROS = todo el resto que no es mesero: `sistema` (el PoS facturando solo, en
//              cualquier canal) y `sin_pedido` fuera del salón. Se muestra aparte para que su
//              plata siga a la vista, y también queda FUERA del Total Cajeros.
//
// Los cuatro baldes siguen llevando la marca `esCajero`, que NO se toca: `getDayStats` y
// `aggGeneral` los suman igual que antes. Esto REAGRUPA, no recalcula — la neta y el total
// del día dan exactamente lo mismo que antes de este cambio.

export const CLAVE_CAJERO_MANANA = `Cajero turno ${ETIQUETA_TURNO_POS['mañana'].toLowerCase()}`
export const CLAVE_CAJERO_TARDE  = `Cajero turno ${ETIQUETA_TURNO_POS['noche'].toLowerCase()}`
/**
 * Venta de SALÓN que la factura no le acredita a ningún mesero.
 *
 * Se llama «Salón sin mesero» y NO «Sin asignar» a propósito: el roster ya usa
 * `«099 · sin asignar»` (`nombreSalonero`) para un MESERO real al que no se le pudo poner
 * nombre. Son cosas distintas —una factura sin dueño contra una persona sin nombre— y con el
 * rótulo viejo se leían igual.
 */
export const CLAVE_SALON_SIN_MESERO = 'Salón sin mesero'
export const CLAVE_SISTEMA_OTROS = 'Sistema y otros'

/** Las dos tarjetas que suman el «Total Cajeros», en orden de turno. */
export const CLAVES_CAJERO_TURNO = [CLAVE_CAJERO_MANANA, CLAVE_CAJERO_TARDE] as const

/**
 * El balde de una factura que no es de un mesero. Ver el bloque de arriba.
 *
 * `canal` llega crudo de `pos_ndf_tickets.canal`; lo único que se pregunta es si es `'salon'`,
 * así que barra / llevar / otro caen del lado de los cajeros sin necesidad de enumerarlos.
 */
export function claveNoMesero(
  registradoPor: string,
  cajeroLogin: string | null = null,
  canal: string | null = null,
): string {
  const esSalon = canal === 'salon'
  if (registradoPor === 'cajero') {
    if (esSalon) return CLAVE_SALON_SIN_MESERO
    // El turno lo da la caja QUE COBRÓ. El 222 se muestra «Tarde», nunca «noche».
    return cajeroLogin === LOGIN_CAJERO_NOCHE ? CLAVE_CAJERO_TARDE : CLAVE_CAJERO_MANANA
  }
  if (registradoPor === 'sin_pedido' && esSalon) return CLAVE_SALON_SIN_MESERO
  return CLAVE_SISTEMA_OTROS
}

/**
 * @deprecated Rotulaba por LOGIN (`Caja · 388`, `Sistema · 002`, `Sin salonero`). La reemplazó
 * `claveNoMesero`, que rotula por turno y canal. Se conserva solo para el histórico del .xls.
 */
export function etiquetaNoMesero(registradoPor: string, login: string | null = null): string {
  if (registradoPor === 'cajero') {
    if (login === LOGIN_CAJERO_MANANA) return CLAVE_CAJERO_MANANA
    if (login === LOGIN_CAJERO_NOCHE)  return CLAVE_CAJERO_TARDE
    return login ? `Caja · ${login}` : 'Caja'
  }
  if (registradoPor === 'sistema') return login ? `Sistema · ${login}` : 'Sistema'
  return 'Sin salonero'
}
