// T1 · Corrida PARALELA ANCLADA por día — análisis puro, sin red.
//
// El T0 comparó saldos ACUMULADOS desde el principio de los tiempos, y por eso el pozo daba
// negativo: el histórico no tiene asiento de apertura. Acá se ataca por otro lado: en vez de
// acumular desde cero, se **ancla en el conteo físico** que el dueño selló el día anterior y
// se pregunta qué debería haber al cierre del día siguiente.
//
//   ancla(d−1) = sep_diaria + sep_registradora + remanente   ← lo que se contó a mano
//   esperado(d) = ancla(d−1)
//               + ef_real_m + ef_real_n      ventas en efectivo BRUTAS del día d
//               − propinas_m − propinas_n    propinas pagadas (campos sellados)
//               − otros_n                    retiro de dueños
//               + neto del período (d−1, d]  según el POZO (la función real de src/)
//
// Que el ancla sea el conteo físico es lo que hace la prueba honesta: no arrastra el error
// del día anterior, así que cada día se evalúa solo.
//
// ⚠️ `ef_real_*` es BRUTO. Verificado contra CashCierre.tsx: `efRealM = vm_crc − vm_usd·tc`,
// sin restar propinas; el neto se arma después (`netoM = ef_real_m − propinas_m`). Sumarle las
// propinas "de vuelta" —como sugería la hipótesis inicial— las contaría al revés.
//
// ⚠️ DOS TRAMPAS DE DOBLE CONTEO, las dos evitadas por exclusión explícita y reportada:
//   1. Las filas 'Ventas cierre' que genera el cierre son NETAS de propinas. Si se cuentan
//      ellas Y los egresos de 'Propinas por turno', las propinas restan dos veces.
//   2. El retiro de dueños NO es un movimiento aparte: `recordCierreRetiro` lo graba como
//      traspaso 'Caja Fuerte → Banco'. Contarlo como `otros_n` Y como traspaso con Banco del
//      período lo restaría dos veces.

import { contribucionPozo, type ClasePozo } from '../../src/modules/cash/pozo.ts'
import { dateCR, diasEntre, fechaDeMov, TOLERANCIA_CRC, type Cierre, type Mov, type Sesion } from './analisis.ts'

/** Subcategorías que el propio cierre escribe en el ledger. */
export const SUBCAT_VENTAS_CIERRE = 'Ventas cierre'
export const SUBCAT_AJUSTE_CIERRE = 'Ajuste de cierre'
export const SUBCAT_PROPINA_TURNO = 'Propinas por turno'
/** La vía VIEJA de cargar la venta del día (antes de que el cierre generara 'Ventas cierre'). */
export const SUBCATS_VENTA_LEDGER = ['Ventas efectivo mediodía', 'Ventas efectivo noche']
/** `recordCierreRetiro` graba el retiro con esta descripción, como traspaso a Banco. */
export const DESC_RETIRO_CIERRE = 'Retiro dueños a banco'

export type MotivoExclusion =
  | 'ventas-cierre'        // ya viene de ef_real (y además es NETA de propinas)
  | 'ajuste-cierre'        // es el sello de la diferencia, no una causa
  | 'propinas-del-dia'     // ya viene de propinas_m/n selladas
  | 'retiro-del-cierre'    // ya viene de otros_n
  | 'ventas-ledger-vieja'  // ya viene de ef_real

export type Excluido = { motivo: MotivoExclusion; n: number; crc: number; movs: Mov[] }

export type ParAnclado = {
  fechaAnterior: string
  fecha: string
  diasDeGap: number
  /** Conteo físico sellado el día anterior — el ancla. */
  ancla: number
  /** Conteo físico sellado el día d. */
  contado: number
  ventasBrutas: number
  propinasSelladas: number
  retiro: number
  /** Suma de las propinas del día d que se excluyeron del período (debería igualar `propinasSelladas`). */
  propinasEnMovimientos: number
  periodo: {
    netoPozo: number
    porClase: { clase: ClasePozo; n: number; crc: number }[]
    indeterminados: { n: number; crc: number }
    excluidos: Excluido[]
    nMovs: number
  }
  esperado: number
  /** contado − esperado: la diferencia que el modelo anclado predice. */
  difReconstruida: number
  /** La diferencia que el cierre selló en su momento. */
  difSellada: number
  /** difReconstruida − difSellada. Si es ~0, el modelo reprodujo el día. */
  residuo: number
  reproduce: boolean
  cuadro: boolean
  /** El cierre del día d se selló ANTES que el del día d−1 (se cargaron fuera de orden). */
  selladoFueraDeOrden: boolean
  /**
   * Lo que el cierre de d−1 posteó al ledger de Caja Fuerte: (ventas netas de cada fase) + su
   * propia diferencia. Si d se selló primero, `deberia` de d leyó un ledger que todavía NO
   * tenía esto — y el residuo de d es exactamente este monto con el signo cambiado.
   */
  aporteLedgerDelAnterior: number
  diagnostico: Diagnostico
}

export type Diagnostico =
  | 'reproduce'
  | 'orden-de-sellado'        // el residuo es el aporte del cierre anterior, sellado después
  | 'invisible-al-modelo'     // el residuo es exactamente el neto del período que hoy nadie ve
  | 'hueco-en-la-cadena'      // días sin cerrar en el medio: plata que nadie contó
  | 'sin-diagnostico'

/** Lo que un cierre posteó al ledger de Caja Fuerte: ventas netas de cada fase + su diferencia. */
const aporteAlLedger = (c: Cierre): number =>
  (c.ef_real_m_crc || 0) - (c.propinas_m_crc || 0) +
  ((c.ef_real_n_crc || 0) - (c.propinas_n_crc || 0) - (c.otros_n_crc || 0)) +
  (c.diferencia_crc || 0)

const contadoDe = (c: Cierre): number =>
  (c.sep_diaria_crc || 0) + (c.sep_registradora_crc || 0) + (c.remanente_crc || 0)

/**
 * Decide si una fila del período ya está contabilizada por los campos sellados del cierre `d`.
 * Devolver un motivo = excluirla. Nada se excluye en silencio: todo va al reporte.
 */
export function motivoExclusion(m: Mov, fechaCierre: string, fechaMov: string): MotivoExclusion | null {
  const sub = m.subcategory ?? ''
  if (sub === SUBCAT_VENTAS_CIERRE) return 'ventas-cierre'
  if (sub === SUBCAT_AJUSTE_CIERRE) return 'ajuste-cierre'
  if (SUBCATS_VENTA_LEDGER.includes(sub) && m.movement_type === 'ingreso') return 'ventas-ledger-vieja'
  if (
    m.movement_type === 'traspaso' &&
    sub === 'Caja Fuerte → Banco' &&
    String(m.description ?? '').startsWith(DESC_RETIRO_CIERRE)
  ) {
    return 'retiro-del-cierre'
  }
  // OJO: solo las propinas del DÍA DEL CIERRE están en propinas_m/n. Las de días intermedios
  // (períodos con hueco) NO están selladas en ningún lado y tienen que contar como egreso.
  if (sub === SUBCAT_PROPINA_TURNO && fechaMov === fechaCierre) return 'propinas-del-dia'
  return null
}

export function corridaAnclada(movs: Mov[], sesiones: Sesion[], cierres: Cierre[]): ParAnclado[] {
  const porSesion = new Map(sesiones.map(s => [s.id, s]))
  const completos = cierres
    .filter(c => c.tipo === 'completo')
    .sort((a, b) => a.session_date.localeCompare(b.session_date))

  // Fecha operativa de cada movimiento, calculada una sola vez.
  const conFecha = movs.map(m => ({ m, fecha: fechaDeMov(m, porSesion) || dateCR(m.created_at) }))

  const pares: ParAnclado[] = []
  for (let i = 1; i < completos.length; i++) {
    const anterior = completos[i - 1]
    const actual = completos[i]
    const ancla = contadoDe(anterior)
    const contado = contadoDe(actual)

    // Período (d−1, d] — abierto en el ancla, cerrado en el día evaluado.
    const delPeriodo = conFecha.filter(
      x => x.fecha > anterior.session_date && x.fecha <= actual.session_date,
    )

    const excluidosMap = new Map<MotivoExclusion, Excluido>()
    const clases = new Map<ClasePozo, { n: number; crc: number }>()
    let netoPozo = 0
    let indetN = 0
    let indetCrc = 0
    let propinasEnMovimientos = 0
    let nContados = 0

    for (const { m, fecha } of delPeriodo) {
      const motivo = motivoExclusion(m, actual.session_date, fecha)
      if (motivo) {
        const g = excluidosMap.get(motivo) ?? { motivo, n: 0, crc: 0, movs: [] }
        g.n += 1
        g.crc += m.amount_crc
        g.movs.push(m)
        excluidosMap.set(motivo, g)
        if (motivo === 'propinas-del-dia') propinasEnMovimientos += m.amount_crc
        continue
      }
      // La contribución la decide la FUNCIÓN REAL promovida a src/ — de eso se trata T1.
      const c = contribucionPozo(m as never)
      netoPozo += c.crc
      nContados += 1
      const g = clases.get(c.clase) ?? { n: 0, crc: 0 }
      g.n += 1
      g.crc += c.crc
      clases.set(c.clase, g)
      if (c.clase === 'traspaso-indeterminado') {
        indetN += 1
        indetCrc += m.amount_crc
      }
    }

    const ventasBrutas = (actual.ef_real_m_crc || 0) + (actual.ef_real_n_crc || 0)
    const propinasSelladas = (actual.propinas_m_crc || 0) + (actual.propinas_n_crc || 0)
    const retiro = actual.otros_n_crc || 0

    const esperado = ancla + ventasBrutas - propinasSelladas - retiro + netoPozo
    const difReconstruida = contado - esperado
    const difSellada = actual.diferencia_crc
    const residuo = difReconstruida - difSellada
    const reproduce = Math.abs(residuo) <= TOLERANCIA_CRC

    // El orden de SELLADO importa: `deberia` se calcula contra el ledger tal como estaba en
    // ese instante. Si d se selló antes que d−1, leyó un ledger incompleto.
    const selladoFueraDeOrden =
      !!anterior.created_at && !!actual.created_at && actual.created_at < anterior.created_at
    const aporteLedgerDelAnterior = aporteAlLedger(anterior)

    let diagnostico: Diagnostico = 'reproduce'
    if (!reproduce) {
      if (selladoFueraDeOrden && Math.abs(residuo + aporteLedgerDelAnterior) <= TOLERANCIA_CRC) {
        diagnostico = 'orden-de-sellado'
      } else if (netoPozo !== 0 && Math.abs(residuo + netoPozo) <= TOLERANCIA_CRC) {
        diagnostico = 'invisible-al-modelo'
      } else if (diasEntre(anterior.session_date, actual.session_date) > 1) {
        diagnostico = 'hueco-en-la-cadena'
      } else {
        diagnostico = 'sin-diagnostico'
      }
    }

    pares.push({
      fechaAnterior: anterior.session_date,
      fecha: actual.session_date,
      diasDeGap: diasEntre(anterior.session_date, actual.session_date),
      ancla,
      contado,
      ventasBrutas,
      propinasSelladas,
      retiro,
      propinasEnMovimientos,
      periodo: {
        netoPozo,
        porClase: [...clases.entries()]
          .map(([clase, v]) => ({ clase, n: v.n, crc: v.crc }))
          .sort((a, b) => Math.abs(b.crc) - Math.abs(a.crc) || a.clase.localeCompare(b.clase)),
        indeterminados: { n: indetN, crc: indetCrc },
        excluidos: [...excluidosMap.values()].sort((a, b) => b.n - a.n),
        nMovs: nContados,
      },
      esperado,
      difReconstruida,
      difSellada,
      residuo,
      reproduce,
      cuadro: Math.abs(difSellada) < TOLERANCIA_CRC,
      selladoFueraDeOrden,
      aporteLedgerDelAnterior,
      diagnostico,
    })
  }
  return pares
}
