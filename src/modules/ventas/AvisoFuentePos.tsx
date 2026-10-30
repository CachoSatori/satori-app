/**
 * La franja de «no se pudo leer el PoS». Se muestra cuando `cargarDias` no devolvió `'ok'`: la
 * pantalla está mostrando solo el Excel, y eso no puede pasar desapercibido (antes caía en
 * silencio). La usan Mi Rendimiento y el módulo Ventas.
 */
import { fmtDiaMes, type EstadoPos } from './ventasFuente'

export default function AvisoFuentePos({ estado, ultimoDiaXls }: {
  estado:       EstadoPos | null | undefined
  ultimoDiaXls: string | null | undefined
}) {
  if (!estado || estado === 'ok') return null
  return (
    <div
      role="status"
      data-estado-pos={estado}
      style={{
        margin: '0.75rem 1rem', padding: '0.55rem 0.8rem', borderRadius: 4,
        background: '#fff4e0', color: '#7a4b00', border: '1px solid #f0c27a',
        fontSize: '0.8rem', fontWeight: 600,
      }}
    >
      Mostrando solo el Excel (último día: {fmtDiaMes(ultimoDiaXls ?? null)}). No se pudo leer el PoS.
    </div>
  )
}
