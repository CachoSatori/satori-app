// T1 · Las dos preguntas obligatorias de la adenda, resueltas sobre datos de PROD.
//
// P1. De dónde sale el SOBRANTE del 2026-07-18 (+₡58.737,07), colón por colón.
// P2. Por qué el "hueco 2" (egresos de proveedor en efectivo) NO se comporta igual todos
//     los días: 07-09 y 07-20 casi cuadraron pese a egresos grandes, y el caso Ronny del
//     07-21 fue el que dio el faltante completo hasta que lo recategorizaron.
//
// Todo se calcula; nada se afirma de memoria. Cuando un número no cierra, queda como
// residuo declarado y no se fuerza la conclusión.

import { contribucionCajaFuerte } from './pozo.ts'
import { dateCR, fechaDeMov, TOLERANCIA_CRC, type Cierre, type Mov, type Sesion } from './analisis.ts'

export const SUBCAT_VENTAS_CIERRE = 'Ventas cierre'
export const SUBCAT_AJUSTE_CIERRE = 'Ajuste de cierre'
export const SUBCAT_PROPINA_TURNO = 'Propinas por turno'

const contadoDe = (c: Cierre): number =>
  (c.sep_diaria_crc || 0) + (c.sep_registradora_crc || 0) + (c.remanente_crc || 0)

// ── P1 · Replay mecánico de un cierre ────────────────────────────────────────

export type PropinaDelDia = {
  id: string
  caja: string
  method: string
  monto: number
  aporteASaldoCF: number
  descripcion: string
}

export type ReplayCierre = {
  fecha: string
  // Piernas, tal como las arma CashCierre.tsx
  efRealM: number
  propinasM: number
  netoM: number
  efRealN: number
  propinasN: number
  otrosN: number
  netoN: number
  /** saldoCajaFuerte con el MISMO filtro anti-doble-conteo que usa el cierre, y sobre el
   *  ledger tal como estaba AL SELLAR (created_at ≤ el del cierre). */
  saldoBaseCF: number
  selladoEn: string
  /** Movimientos que ya existían al sellar (los posteriores no podían estar en `deberia`). */
  filasAlSellar: number
  filasHoy: number
  deberia: number
  contado: number
  difCalculada: number
  difSellada: number
  /** El replay reproduce la diferencia sellada. */
  coincide: boolean
  /** Lo que `recordCierreSales` debió escribir al ledger por cada pierna. */
  ventasCierreEsperado: { mediodia: number; noche: number }
  /** Lo que efectivamente hay en el ledger. */
  ventasCierreReal: { mediodia: number | null; noche: number | null }
  propinasDelDia: PropinaDelDia[]
  /** Lo que `saldoCajaFuerte` ve de esas propinas (0 si salieron de otra caja). */
  aporteCFdeLasPropinas: number
  /** Diferencia que habría quedado si las propinas NO se restaran del ledger de Caja Fuerte. */
  difSinRestarPropinas: number
  /** Efectivo que salió de una caja física ese día que NO sean las propinas: candidatos a
   *  explicar el residuo. Si da 0, el residuo no tiene ningún movimiento que lo cubra. */
  otroEfectivoDelDia: { n: number; crc: number }
}

export function replayCierre(
  cierre: Cierre,
  movs: Mov[],
  sesiones: Sesion[],
  saldoCajaFuerteReal: (m: Mov[]) => { crc: number; usd: number },
): ReplayCierre {
  const porSesion = new Map(sesiones.map(s => [s.id, s]))
  const fecha = cierre.session_date

  const efRealM = cierre.ef_real_m_crc || 0
  const propinasM = cierre.propinas_m_crc || 0
  const efRealN = cierre.ef_real_n_crc || 0
  const propinasN = cierre.propinas_n_crc || 0
  const otrosN = cierre.otros_n_crc || 0
  const netoM = efRealM - propinasM
  const netoN = efRealN - propinasN - otrosN

  // El ledger TAL COMO ESTABA AL SELLAR. `deberia` se calculó contra el saldo de ese
  // instante, no contra el de hoy: replicar con el ledger actual da un número distinto
  // (y es la misma fragilidad que se detectó en staging con el orden de sellado).
  const selladoEn = cierre.created_at ?? ''
  const alSellar = selladoEn ? movs.filter(m => m.created_at <= selladoEn) : movs
  // MISMO filtro que CashCierre.tsx: excluye las 'Ventas cierre'/'Ajuste de cierre' de ESTA
  // fecha para no contarlas dos veces (el resto del ledger sí cuenta).
  const base = alSellar.filter(
    m =>
      !(
        (m.subcategory === SUBCAT_VENTAS_CIERRE || m.subcategory === SUBCAT_AJUSTE_CIERRE) &&
        String(m.description ?? '').includes(fecha)
      ),
  )
  const saldoBaseCF = saldoCajaFuerteReal(base).crc
  const deberia = saldoBaseCF + netoM + netoN
  const contado = contadoDe(cierre)
  const difCalculada = contado - deberia
  const difSellada = cierre.diferencia_crc

  const ventasReales = movs.filter(
    m => m.subcategory === SUBCAT_VENTAS_CIERRE && String(m.description ?? '').includes(fecha),
  )
  const buscar = (txt: string): number | null => {
    const hit = ventasReales.find(m => String(m.description ?? '').includes(txt))
    return hit ? hit.amount_crc : null
  }

  const propinasDelDia: PropinaDelDia[] = movs
    .filter(m => m.subcategory === SUBCAT_PROPINA_TURNO && fechaDeMov(m, porSesion) === fecha)
    .map(m => ({
      id: m.id,
      caja: m.caja_origen ?? '(null)',
      method: m.method ?? '(null)',
      monto: m.amount_crc,
      aporteASaldoCF: contribucionCajaFuerte(m).crc,
      descripcion: m.description ?? '',
    }))
    .sort((a, b) => b.monto - a.monto)

  return {
    fecha,
    efRealM,
    propinasM,
    netoM,
    efRealN,
    propinasN,
    otrosN,
    netoN,
    saldoBaseCF,
    selladoEn,
    filasAlSellar: alSellar.length,
    filasHoy: movs.length,
    deberia,
    contado,
    difCalculada,
    difSellada,
    coincide: Math.abs(difCalculada - difSellada) < 0.005,
    ventasCierreEsperado: { mediodia: netoM, noche: netoN },
    ventasCierreReal: { mediodia: buscar('Mediodía'), noche: buscar('Noche') },
    propinasDelDia,
    aporteCFdeLasPropinas: propinasDelDia.reduce((a, x) => a + x.aporteASaldoCF, 0),
    difSinRestarPropinas: difCalculada - (propinasM + propinasN),
    otroEfectivoDelDia: (() => {
      const CAJAS = ['Caja Fuerte', 'Caja Proveedores', 'Registradora']
      const otros = movs.filter(
        m =>
          fechaDeMov(m, porSesion) === fecha &&
          m.movement_type.startsWith('egreso') &&
          m.status !== 'rechazado' &&
          CAJAS.includes(m.caja_origen ?? '') &&
          (m.method === 'Efectivo' || !m.method) &&
          m.subcategory !== SUBCAT_PROPINA_TURNO &&
          m.subcategory !== SUBCAT_AJUSTE_CIERRE &&
          m.subcategory !== SUBCAT_VENTAS_CIERRE,
      )
      return { n: otros.length, crc: otros.reduce((a, m) => a + m.amount_crc, 0) }
    })(),
  }
}

// ── P2 · ¿La plata del fondo estaba dentro del pool? ─────────────────────────

export type EgresoEfectivo = {
  id: string
  caja: string
  subcategoria: string
  monto: number
  /** Baja `deberia` por el ledger de Caja Fuerte (solo si caja_origen = 'Caja Fuerte'). */
  viaLedgerCF: number
  /** Baja `deberia` por los campos sellados propinas_m/n (solo propinas del día). */
  viaPropinasSelladas: number
  /** Cuenta por los DOS canales: el cierre lo resta dos veces. */
  dobleConteo: boolean
  descripcion: string
}

export type DiaFondo = {
  fecha: string
  difSellada: number
  cuadro: boolean
  porCaja: { caja: string; n: number; crc: number }[]
  egresos: EgresoEfectivo[]
  totalEfectivo: number
  /** Bajó `deberia` por el ledger de Caja Fuerte. */
  viaLedgerCF: number
  /** `propinas_m + propinas_n` del cierre: lo que `deberia` restó por propinas. */
  propinasSelladas: number
  /** Restado DOS veces: está en Caja Fuerte (ledger) y además en propinas_m/n. */
  dobleConteo: number
  /** Salió de una caja física y NO bajó `deberia` por ningún canal. */
  invisible: number
  /**
   * Si TODO ese efectivo salió del pool contado, el conteo baja `totalEfectivo` mientras que
   * `deberia` solo bajó `viaLedgerCF + propinasSelladas`. La diferencia que el cierre tendría
   * que haber mostrado es exactamente:
   *     difEsperada = −totalEfectivo + viaLedgerCF + propinasSelladas
   * (el término de doble conteo aparece solo porque una misma fila baja `deberia` dos veces).
   */
  difEsperada: number
  /** difSellada − difEsperada. ~0 ⇒ la plata sí salió del pool contado. */
  brecha: number
  explicado: boolean
  sepDiaria: number
}

export function analisisFondo(
  cierres: Cierre[],
  movs: Mov[],
  sesiones: Sesion[],
  fechas: string[],
): DiaFondo[] {
  const porSesion = new Map(sesiones.map(s => [s.id, s]))
  const CAJAS = ['Caja Fuerte', 'Caja Proveedores', 'Registradora']

  return fechas.map(fecha => {
    const cierre = cierres.find(c => c.session_date === fecha && c.tipo === 'completo')
    // Efectivo que SALIÓ de una caja física ese día. Se excluyen las filas que genera el
    // propio cierre: no son causas, son su consecuencia.
    const delDia = movs.filter(
      m =>
        (fechaDeMov(m, porSesion) || dateCR(m.created_at)) === fecha &&
        m.movement_type.startsWith('egreso') &&
        m.status !== 'rechazado' &&
        CAJAS.includes(m.caja_origen ?? '') &&
        (m.method === 'Efectivo' || !m.method) &&
        m.subcategory !== SUBCAT_AJUSTE_CIERRE &&
        m.subcategory !== SUBCAT_VENTAS_CIERRE,
    )

    // Las propinas del día que el cierre selló en propinas_m/n. `propinasPagadasEnFecha`
    // (la regla de la app) cuenta las de esa fecha con method ≠ 'Transferencia'.
    const propinasSelladas = (cierre?.propinas_m_crc || 0) + (cierre?.propinas_n_crc || 0)
    const esPropinaSellada = (m: Mov): boolean =>
      m.subcategory === SUBCAT_PROPINA_TURNO && m.method !== 'Transferencia' && propinasSelladas > 0

    const egresos: EgresoEfectivo[] = delDia.map(m => {
      const viaLedgerCF = -contribucionCajaFuerte(m).crc // en positivo: cuánto baja `deberia`
      const viaPropinasSelladas = esPropinaSellada(m) ? m.amount_crc : 0
      return {
        id: m.id,
        caja: m.caja_origen ?? '(null)',
        subcategoria: m.subcategory ?? '(null)',
        monto: m.amount_crc,
        viaLedgerCF,
        viaPropinasSelladas,
        dobleConteo: viaLedgerCF > 0 && viaPropinasSelladas > 0,
        descripcion: m.description ?? '',
      }
    })

    const grupos = new Map<string, { caja: string; n: number; crc: number }>()
    for (const e of egresos) {
      const g = grupos.get(e.caja) ?? { caja: e.caja, n: 0, crc: 0 }
      g.n += 1
      g.crc += e.monto
      grupos.set(e.caja, g)
    }

    const totalEfectivo = egresos.reduce((a, e) => a + e.monto, 0)
    const viaLedgerCF = egresos.reduce((a, e) => a + e.viaLedgerCF, 0)
    const dobleConteo = egresos.filter(e => e.dobleConteo).reduce((a, e) => a + e.monto, 0)
    // Lo que `deberia` restó por propinas sale del CAMPO SELLADO, no de adivinar qué
    // movimientos cubría: es el número que el cierre realmente usó.
    const invisible = Math.max(0, totalEfectivo - viaLedgerCF - propinasSelladas + dobleConteo)
    const difSellada = cierre?.diferencia_crc ?? 0
    const difEsperada = -totalEfectivo + viaLedgerCF + propinasSelladas
    const brecha = difSellada - difEsperada

    return {
      fecha,
      difSellada,
      cuadro: Math.abs(difSellada) < TOLERANCIA_CRC,
      porCaja: [...grupos.values()].sort((a, b) => b.crc - a.crc),
      egresos: egresos.sort((a, b) => b.monto - a.monto),
      totalEfectivo,
      viaLedgerCF,
      propinasSelladas,
      dobleConteo,
      invisible,
      difEsperada,
      brecha,
      explicado: Math.abs(brecha) <= TOLERANCIA_CRC,
      sepDiaria: cierre?.sep_diaria_crc ?? 0,
    }
  })
}
