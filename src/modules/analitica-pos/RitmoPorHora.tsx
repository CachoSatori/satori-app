import { useState } from 'react'
import type { VentaPorHora } from './types'
import { fi } from '../../shared/utils'

// ── El ritmo del día, hora por hora ─────────────────────────────────────────────
//
// POR QUÉ BARRAS Y NO UNA LÍNEA: la venta por hora son baldes discretos, no una señal
// continua. Una línea dibujaría una pendiente entre las 19:00 y las 20:00 que sugiere valores
// intermedios que no existen — no se vendió nada "a las 19:30" en el sentido del gráfico.
//
// POR QUÉ UN SOLO COLOR: hay UNA serie. El color no lleva identidad (no hay nada que
// distinguir), lleva magnitud — y eso ya lo lleva la altura. Pintar cada hora de un color
// distinto sería un arcoíris que no codifica nada. Sin leyenda, por lo mismo: el título dice
// qué es.
//
// El SVG va a mano en vez de recharts: son barras y un eje. Traer la librería a un chunk nuevo
// por esto costaría ~300 KB y daría menos control sobre el detalle (las puntas redondeadas, el
// hueco de 2 px, la etiqueta selectiva).

interface Props {
  datos: VentaPorHora[]
  /** Hora de reloj CR actual: separa lo que ya pasó de lo que falta del servicio. */
  horaActual: number
}

// Geometría del dibujo. `viewBox` fijo + `preserveAspectRatio` = escala sola con el contenedor.
const W = 720
const H = 220
const PAD_IZQ = 52     // deja lugar a las etiquetas de monto del eje Y
const PAD_DER = 12
const PAD_ARR = 24     // deja lugar a la etiqueta directa del pico
const PAD_ABA = 28     // deja lugar a las horas del eje X
const GAP = 2          // el hueco entre barras: separa sin necesidad de borde

/** Redondea hacia arriba a una cifra "linda" para el tope del eje. */
function topeEje(max: number): number {
  if (max <= 0) return 1
  const exp  = Math.pow(10, Math.floor(Math.log10(max)))
  const paso = exp / 2
  return Math.ceil(max / paso) * paso
}

/** '₡ 1 850 000' → '₡1,9M' — el eje necesita etiquetas cortas o se pisan entre sí. */
function corto(n: number): string {
  if (n >= 1_000_000) return `₡${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `₡${Math.round(n / 1_000)}k`
  return `₡${n}`
}

export default function RitmoPorHora({ datos, horaActual }: Props) {
  const [hover, setHover] = useState<number | null>(null)

  if (datos.length === 0) {
    return <p className="apos-vacio">Sin movimiento todavía.</p>
  }

  const maxMonto = Math.max(...datos.map(d => d.monto))
  const tope     = topeEje(maxMonto)
  const anchoUtil = W - PAD_IZQ - PAD_DER
  const altoUtil  = H - PAD_ARR - PAD_ABA
  const anchoCol  = anchoUtil / datos.length
  const anchoBarra = Math.max(4, anchoCol - GAP)

  const y = (monto: number) => PAD_ARR + altoUtil - (monto / tope) * altoUtil

  // Etiqueta directa SOLO en el pico. Un número sobre cada barra es ruido: el ojo ya compara
  // alturas, y el resto de los valores está a un hover de distancia.
  const pico = datos.reduce((a, b) => (b.monto > a.monto ? b : a), datos[0])

  const ticks = [0, tope / 2, tope]
  const activo = hover != null ? datos.find(d => d.hora === hover) ?? null : null

  return (
    <div className="apos-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Venta por hora. Pico a las ${String(pico.hora).padStart(2, '0')}:00 con ${fi(pico.monto)}.`}
      >
        {/* Grilla: recesiva, solo tres líneas. Está para poder estimar, no para mirarse. */}
        {ticks.map(t => (
          <g key={t}>
            <line
              x1={PAD_IZQ} x2={W - PAD_DER} y1={y(t)} y2={y(t)}
              stroke="var(--apos-grid)" strokeWidth={1}
            />
            <text
              x={PAD_IZQ - 8} y={y(t) + 3.5}
              textAnchor="end" className="apos-axis"
            >
              {corto(t)}
            </text>
          </g>
        ))}

        {datos.map((d, i) => {
          const x = PAD_IZQ + i * anchoCol + GAP / 2
          const futura = d.hora > horaActual
          const alto = d.monto > 0 ? Math.max(2, PAD_ARR + altoUtil - y(d.monto)) : 0

          return (
            <g key={d.hora}>
              {/* Hora que todavía no llegó: un fantasma tenue. Deja ver la forma completa del
                  servicio sin fingir que hubo venta. */}
              {futura && (
                <rect
                  x={x} y={PAD_ARR + altoUtil - 3}
                  width={anchoBarra} height={3}
                  rx={1.5}
                  fill="var(--apos-grid)"
                />
              )}

              {alto > 0 && (
                <rect
                  x={x} y={y(d.monto)}
                  width={anchoBarra} height={alto}
                  // Punta redondeada arriba, anclada a la base: `rx` sobre el rect entero
                  // redondearía también abajo y despegaría la barra del eje.
                  rx={3}
                  fill={hover === d.hora ? 'var(--apos-mark-fuerte)' : 'var(--apos-mark)'}
                />
              )}

              {/* Zona de hover: toda la columna, de arriba abajo. El blanco de clic tiene que
                  ser más grande que la marca, o las horas flojas son imposibles de tocar. */}
              <rect
                x={PAD_IZQ + i * anchoCol} y={PAD_ARR}
                width={anchoCol} height={altoUtil}
                fill="transparent"
                onMouseEnter={() => setHover(d.hora)}
                onMouseLeave={() => setHover(null)}
              >
                <title>
                  {`${String(d.hora).padStart(2, '0')}:00 — ${fi(d.monto)} · ${d.tickets} ticket(s)`}
                </title>
              </rect>
            </g>
          )
        })}

        {/* La etiqueta del pico */}
        {pico.monto > 0 && (
          <text
            x={PAD_IZQ + datos.findIndex(d => d.hora === pico.hora) * anchoCol + anchoBarra / 2}
            y={y(pico.monto) - 7}
            textAnchor="middle"
            className="apos-pico"
          >
            {corto(pico.monto)}
          </text>
        )}

        {/* Eje X: una etiqueta cada dos horas, o se amontonan. */}
        {datos.map((d, i) => (
          d.hora % 2 === 0 ? (
            <text
              key={d.hora}
              x={PAD_IZQ + i * anchoCol + anchoBarra / 2}
              y={H - 10}
              textAnchor="middle"
              className="apos-axis"
            >
              {String(d.hora).padStart(2, '0')}
            </text>
          ) : null
        ))}
      </svg>

      {/* Tooltip: fuera del SVG, para que herede la tipografía y no pelee con el viewBox. */}
      <div className="apos-tip" role="status" aria-live="polite">
        {activo
          ? <>
              <b>{String(activo.hora).padStart(2, '0')}:00</b>
              <span>{fi(activo.monto)}</span>
              <span className="apos-tip-sec">{activo.tickets} ticket(s)</span>
            </>
          : <span className="apos-tip-sec">Pasá el cursor por una hora para ver el detalle</span>}
      </div>
    </div>
  )
}
