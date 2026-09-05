import type { VentasPorTurnoPoS } from '../../shared/api/posNdf'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ Cierre · pre-carga desde el PoS — lo PURO (Track B)                                    ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// ── QUÉ ES Y QUÉ NO ES ─────────────────────────────────────────────────────────────────────
// Esto NO calcula plata. El PoS pre-llena los campos de venta del cierre y nada más: el cajero
// los puede pisar, y lo que entra a `deberia`, a los gates y al sellado es —igual que siempre—
// el valor del campo. Con el MISMO input, el cierre da idéntico a como daba antes de que este
// archivo existiera.
//
// Lo único que se agrega es TESTIGO: si lo declarado no coincide con lo que el PoS esperaba, la
// diferencia queda escrita en las notas del cierre. No bloquea, no corrige, no avisa dos veces.
// El cajero cuenta plata física y el PoS cuenta facturas: que difieran es información, no un
// error a impedir. Lo que sí sería un problema es que difieran y nadie se entere.

/** Un campo del cierre donde lo declarado no coincide con lo que el PoS esperaba. */
export interface DesfasePoS {
  turno:     'Mediodía' | 'Noche'
  moneda:    'CRC' | 'USD'
  esperado:  number
  declarado: number
  /** `declarado − esperado`. Positivo = se declaró de más. */
  diferencia: number
}

/** Lo que el cajero efectivamente dejó en los campos, por turno. */
export interface VentasDeclaradas {
  mediodia: { crc: number; usd: number }
  noche:    { crc: number; usd: number }
}

/**
 * Tolerancias. En colones no hay centavos, así que ₡1 ya es una diferencia real. En dólares el
 * cajero cuenta billetes y monedas: un centavo es la unidad más chica que puede existir, y por
 * debajo de eso lo único que hay es ruido de punto flotante.
 */
export const TOLERANCIA_CRC = 1
export const TOLERANCIA_USD = 0.01

/**
 * Compara lo declarado contra lo que el PoS esperaba, campo por campo.
 *
 * Sin datos del PoS (`null`) no hay contra qué comparar y la lista viene vacía — que es
 * distinto de «coincide todo». Un turno que el PoS reporta en cero SÍ se compara: si el cajero
 * declaró plata donde el PoS no vio ninguna factura, eso es exactamente lo que hay que anotar.
 */
export function desfasesPoS(
  esperado: VentasPorTurnoPoS | null,
  declarado: VentasDeclaradas,
): DesfasePoS[] {
  if (esperado === null) return []
  const out: DesfasePoS[] = []
  const mirar = (
    turno: DesfasePoS['turno'], moneda: DesfasePoS['moneda'],
    esp: number, dec: number, tolerancia: number,
  ) => {
    const diferencia = dec - esp
    if (Math.abs(diferencia) >= tolerancia) out.push({ turno, moneda, esperado: esp, declarado: dec, diferencia })
  }
  mirar('Mediodía', 'CRC', esperado.mediodia.crc, declarado.mediodia.crc, TOLERANCIA_CRC)
  mirar('Mediodía', 'USD', esperado.mediodia.usd, declarado.mediodia.usd, TOLERANCIA_USD)
  mirar('Noche',    'CRC', esperado.noche.crc,    declarado.noche.crc,    TOLERANCIA_CRC)
  mirar('Noche',    'USD', esperado.noche.usd,    declarado.noche.usd,    TOLERANCIA_USD)
  return out
}

const montoDe = (d: DesfasePoS): string =>
  d.moneda === 'CRC'
    ? `₡${Math.round(d.esperado).toLocaleString('es-CR')} → ₡${Math.round(d.declarado).toLocaleString('es-CR')}`
    : `$${d.esperado.toFixed(2)} → $${d.declarado.toFixed(2)}`

const signo = (n: number): string => (n > 0 ? '+' : '−')

const difDe = (d: DesfasePoS): string =>
  d.moneda === 'CRC'
    ? `${signo(d.diferencia)}₡${Math.abs(Math.round(d.diferencia)).toLocaleString('es-CR')}`
    : `${signo(d.diferencia)}$${Math.abs(d.diferencia).toFixed(2)}`

/** Marca del bloque, para poder reconocerlo (y no duplicarlo) si el cierre se vuelve a guardar. */
export const MARCA_DESFASE = '— PoS vs declarado —'

/** El bloque de texto que se agrega a las notas. Vacío si no hay nada que anotar. */
export function notaDesfasePoS(desfases: DesfasePoS[]): string {
  if (desfases.length === 0) return ''
  const filas = desfases.map(d => `${d.turno} ${d.moneda}: ${montoDe(d)} (${difDe(d)})`)
  return [MARCA_DESFASE, ...filas].join('\n')
}

/**
 * Las notas del cierre con el testigo del desfase pegado al final.
 *
 * Lo que escribió la persona se respeta ENTERO y va primero: es lo que alguien va a leer. Un
 * bloque anterior de esta misma marca se reemplaza en vez de acumularse, para que volver a
 * guardar el cierre no deje tres versiones del mismo desfase.
 */
export function notasConDesfasePoS(notas: string, desfases: DesfasePoS[]): string {
  const propias = notas.split(MARCA_DESFASE)[0].trimEnd()
  const bloque = notaDesfasePoS(desfases)
  if (bloque === '') return propias
  return propias === '' ? bloque : `${propias}\n\n${bloque}`
}
