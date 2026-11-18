// ── Resumen de ventas de UNA jornada, para el correo del cierre de caja (Edge `cierre-email`) ──
//
// Pedido del dueño (18-nov-2026, etapa 1): el correo del cierre trae un resumen de ventas del día. La
// Edge no puede importar `src/` (Deno, otra rama de despliegue), así que esta entrada se EMPAQUETA con
// `scripts/edge/empaquetar-ventas-pos.mjs --entrada src/modules/ventas/resumenCierrePuro.ts`
// → `supabase/functions/cierre-email/ventasPos.gen.js`, como `monthly-report` y `ventas-dia-contador`.
//
// Acá NO hay fórmulas nuevas: solo se juntan las de la app.
//   · Día = la JORNADA de la sesión de caja (`ubicarFacturas`, indicadores.ts, decisión del dueño 17/11):
//     una factura de las 00:30 cobrada por la caja de la noche es del día del cierre.
//   · Bruta, neta, salón, delivery y pax: `armarDia` + `getDayStats` (lo mismo que Contabilidad / Resumen
//     hacen con un día), sobre las facturas de esa jornada.
//   · Promedio por pax: LA venta por persona D4 (`ventaPorPersona`): neta de salón ÷ personas de salón,
//     sin mesas de dueños ni regalías totales, con las personas estimadas de mesas sin pax (estimador v1).
//     Referencia del estimador: las facturas con pax de ESA jornada (la Edge solo lee ese día; ver la
//     cabecera de `cierre-email/index.ts`), no las 4 semanas de respaldo.
//   · Bebidas por pax: `aggGeneral().bebPax` = unidades de bebida (familia 5) de los meseros ÷ pax de los
//     meseros. Es el «Beb/PAX» de En vivo, Histórico, Metas y el reporte mensual.
//   · Salonero destacado: `ventaPorPersonaPorSalonero` (lente «mesa», el salonero de la factura): «más
//     vendió» = mayor neta de salón; «mejor promedio por pax» = mayor venta por persona entre los que
//     tienen al menos MIN_MESAS mesas y MIN_PERSONAS personas que cuentan. Solo meseros (`claveSalonero`).
//
// Módulo PURO: sin I/O, sin reloj. Lo prueban `resumenCierrePuro.test.ts` y el contrato de la Edge.

import type { LineaNdfRow, TicketVentaRow } from '../../shared/api/posNdf'
import { armarDia, claveSalonero } from './ventasEnVivoDatos'
import { aggGeneral, getDayStats } from './ventasUtils'
import { facturasDesdePos, ubicarFacturas, ventaPorPersona, ventaPorPersonaPorSalonero } from './indicadores'

export { ventanaRangoJornadas } from '../../shared/api/posNdf'
export { COLS_TICKETS_067, COLS_LINEAS_067 } from './ventasPosPuro'
export { sumarDias } from './periodosPromPax'

/** Mínimos para «mejor promedio por pax»: con 1 mesa de 2 personas el promedio no dice nada. */
export const MIN_MESAS = 3
export const MIN_PERSONAS = 6

export interface Destacado {
  login:   string
  /** Nombre de `nombres` (employees.pos_login → full_name); `null` si no está. */
  nombre:  string | null
  netaSalon: number
  /** Venta por persona D4 del salonero (`null` sin personas). */
  promPax: number | null
  mesas:   number
  personas: number
}

export interface ResumenVentasDia {
  dia:        string
  /** Facturas cerradas de la jornada (todas, salón y delivery). 0 = día sin ventas. */
  facturas:   number
  ventaBruta: number
  ventaNeta:  number
  salon:      number
  delivery:   number
  pax:        number
  /** D4. `null` sin personas. */
  promPax:    number | null
  /** % de personas estimadas en el promedio (0–100). */
  pctEstimado: number
  mesasDuenos: number
  regaliasTotales: number
  /** Unidades de bebida ÷ pax de meseros. `null` sin pax de meseros. */
  bebPax:     number | null
  masVendio:  Destacado | null
  mejorPromPax: Destacado | null
}

const enDia = (dia: string) => ({ desde: dia, hasta: dia })

/**
 * El resumen de la jornada `dia`. `tickets` y `lineas` pueden traer de más (la ventana de
 * `ventanaRangoJornadas`): solo cuentan las facturas cuya sesión de caja es de `dia`.
 */
export function resumenVentasDia(
  tickets: readonly TicketVentaRow[],
  lineas: readonly LineaNdfRow[],
  dia: string,
  nombres: Record<string, string> = {},
): ResumenVentasDia {
  // 1. Las facturas de la jornada (por su lote de caja, no por el reloj).
  const facturasTodas = facturasDesdePos(tickets, lineas)
  const ubic = ubicarFacturas(facturasTodas)
  const ids = new Set(facturasTodas.filter(f => ubic.get(f)?.dia === dia).map(f => f.id))
  const delDia = tickets.filter(t => ids.has(t.id))
  const lineasDelDia = lineas.filter(l => ids.has(l.ticket_id))
  const facturas = facturasTodas.filter(f => ids.has(f.id))

  // 2. Totales del día: el mismo armado que Contabilidad.
  const armado = armarDia(dia, [...delDia], [...lineasDelDia], dia, nombres)
  const st = getDayStats(armado.dia)
  const gen = aggGeneral([dia], { [dia]: armado.dia }, armado.pm)

  // 3. Venta por persona D4 (local y por salonero).
  const r = enDia(dia)
  const vpp = ventaPorPersona(facturas, r)
  const meseros = new Set(delDia.map(t => claveSalonero(t)).filter((l): l is string => !!l))
  const porSal = ventaPorPersonaPorSalonero(facturas, r).porSalonero
    .filter(s => meseros.has(s.salonero_login))
    .map((s): Destacado => ({
      login: s.salonero_login,
      nombre: nombres[s.salonero_login] ?? null,
      netaSalon: s.netaSalon,
      promPax: s.valor,
      mesas: s.facturasSalon - s.mesasDuenos - s.regaliasTotales,
      personas: s.personasCargadas + s.personasEstimadas,
    }))
  const porLogin = (a: Destacado, b: Destacado) => a.login.localeCompare(b.login)
  const masVendio = [...porSal].filter(s => s.netaSalon > 0)
    .sort((a, b) => b.netaSalon - a.netaSalon || porLogin(a, b))[0] ?? null
  const mejorPromPax = [...porSal]
    .filter(s => s.promPax !== null && s.mesas >= MIN_MESAS && s.personas >= MIN_PERSONAS)
    .sort((a, b) => (b.promPax as number) - (a.promPax as number) || b.personas - a.personas || porLogin(a, b))[0] ?? null

  return {
    dia,
    facturas:   delDia.filter(t => t.estado === 'C').length,
    ventaBruta: st.ventaBruta,
    ventaNeta:  st.ventaNeta,
    salon:      st.salon,
    delivery:   st.delivery,
    pax:        st.pax,
    promPax:    vpp.valor,
    pctEstimado: vpp.pctEstimado,
    mesasDuenos: vpp.mesasDuenos,
    regaliasTotales: vpp.regaliasTotales,
    bebPax:     gen.paxSaloneros > 0 ? gen.bebPax : null,
    masVendio,
    mejorPromPax,
  }
}
