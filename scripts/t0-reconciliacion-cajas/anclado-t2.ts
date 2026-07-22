// T2 · La corrida anclada, pero con las funciones REALES del modelo nuevo de src/.
//
// El T1 validó el núcleo (`saldoPozoEfectivo`) reconstruyendo el conteo físico día a día.
// Acá se sube un escalón: se usan las MISMAS funciones que va a usar el Cierre del Día
// post-corte —`basePozoParaCierre` y `deberiaPozo` de src/modules/cash/cierrePozo.ts— sobre
// el histórico anclado de staging. Si el recableado del cierre cambia, este número cambia.
//
// El histórico es PRE-corte, así que se corre con un corte artificial (el harness pasa el
// suyo): no se está afirmando que el modelo nuevo describa el pasado, se está comprobando
// que la mecánica reproduce el conteo físico de los días que ya cuadraban.

import { basePozoParaCierre, deberiaPozo, fechaOperativa } from '../../src/modules/cash/cierrePozo.ts'
import { TOLERANCIA_CRC, type Cierre, type Mov, type Sesion } from './analisis.ts'

export type ParT2 = {
  fechaAnterior: string
  fecha: string
  diasDeGap: number
  /** Conteo físico sellado el día anterior — el ancla. */
  ancla: number
  contado: number
  /** El "debería" que produciría el Cierre post-corte, anclado en el día anterior. */
  deberiaNuevo: number
  difNueva: number
  difSellada: number
  residuo: number
  reproduce: boolean
}

const contado = (c: Cierre): number =>
  (c.sep_diaria_crc || 0) + (c.sep_registradora_crc || 0) + (c.remanente_crc || 0)

/**
 * Para cada par de cierres completos consecutivos, calcula el "debería" con las funciones
 * reales del modelo nuevo, anclando el pozo en el conteo físico del día anterior.
 *
 * El ancla se inyecta como un asiento de apertura sintético (mismo mecanismo que
 * `recordAperturaPozo` en producción) y se restringe la base al período (d−1, d].
 */
export function corridaAncladaT2(movs: Mov[], sesiones: Sesion[], cierres: Cierre[]): ParT2[] {
  // MISMA atribución de fecha que usa el cierre: las filas que genera un cierre pertenecen al
  // día que dice su descripción, no al día en que se sellaron. Usar una convención distinta acá
  // metía las ventas del día del ancla —selladas después— dentro del período, y las contaba dos
  // veces (ya estaban adentro del conteo físico del ancla).
  const sesionFecha = new Map(sesiones.map(x => [x.id, x.session_date]))
  // El modelo real arranca el pozo en el asiento de 'Apertura pozo' más reciente. Esta corrida
  // RE-ANCLA en cada par, así que tiene que ser dueña del ancla: si quedara la apertura real de
  // la base (sembrada para la validación en piso), taparía la sintética y el corte por abajo
  // se llevaría todo el período.
  const sinApertura = movs.filter(m => m.subcategory !== 'Apertura pozo')
  const completos = cierres
    .filter(c => c.tipo === 'completo')
    .sort((a, b) => a.session_date.localeCompare(b.session_date))

  const out: ParT2[] = []
  for (let i = 1; i < completos.length; i++) {
    const ant = completos[i - 1]
    const act = completos[i]
    const ancla = contado(ant)

    // Apertura sintética en el día del ancla: es exactamente lo que hace el asiento
    // 'Apertura pozo' en producción, pero acá se re-ancla en cada par para evaluar el día solo.
    const apertura = {
      id: `__ancla_${ant.session_date}`,
      session_id: null,
      created_at: `${ant.session_date}T12:00:00+00:00`,
      updated_at: `${ant.session_date}T12:00:00+00:00`,
      movement_type: 'ingreso',
      subcategory: 'Apertura pozo',
      description: `Apertura pozo ${ant.session_date}`,
      method: 'Efectivo',
      caja_origen: 'Caja Fuerte',
      status: 'aprobado',
      amount_crc: ancla,
      amount_usd: 0,
      shift: null,
    } as unknown as Mov

    // Base = apertura + lo que pasó DESPUÉS del ancla y hasta el día evaluado. Se usa la
    // función real; el filtro por fecha operativa y la exclusión de las filas del propio
    // cierre los hace ella.
    const base = basePozoParaCierre(
      [apertura, ...sinApertura] as never[],
      sesiones as never[],
      act.session_date,
    ).filter(m => {
      const d = String((m as unknown as Mov).description ?? '')
      if (d === `Apertura pozo ${ant.session_date}`) return true
      // Todo lo anterior o igual al ancla ya está dentro del conteo físico del ancla.
      return fechaOperativa(m as never, sesionFecha) > ant.session_date
    })

    const d = deberiaPozo({
      base: base as never[],
      efRealM: act.ef_real_m_crc || 0,
      efRealN: act.ef_real_n_crc || 0,
      vmUsd: 0,
      vnUsd: 0,
      retiroCrc: act.otros_n_crc || 0,
    })

    const difNueva = contado(act) - d.crc
    const residuo = difNueva - act.diferencia_crc
    out.push({
      fechaAnterior: ant.session_date,
      fecha: act.session_date,
      diasDeGap: Math.round(
        (Date.parse(`${act.session_date}T00:00:00Z`) - Date.parse(`${ant.session_date}T00:00:00Z`)) / 86_400_000,
      ),
      ancla,
      contado: contado(act),
      deberiaNuevo: d.crc,
      difNueva,
      difSellada: act.diferencia_crc,
      residuo,
      reproduce: Math.abs(residuo) <= TOLERANCIA_CRC,
    })
  }
  return out
}

