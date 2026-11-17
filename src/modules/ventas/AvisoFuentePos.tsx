/**
 * La franja de «no se pudo leer el PoS». Se muestra cuando `cargarDias` no devolvió `'ok'`: la
 * pantalla NO tiene ventas que mostrar (desde el 16-nov el Excel ya no es respaldo), y eso no
 * puede pasar desapercibido. La usan Mi Rendimiento y el módulo Ventas.
 */
import type { EstadoPos } from './ventasFuente'

const TEXTOS: Record<Exclude<EstadoPos, 'ok'>, string> = {
  sin_acceso: 'Tu usuario no puede ver las ventas del PoS.',
  vacio:      'El PoS no tiene ventas en este período.',
  error:      'No se pudieron leer las ventas del PoS. Probá recargar en un rato.',
}

export default function AvisoFuentePos({ estado }: { estado: EstadoPos | null | undefined }) {
  if (!estado || estado === 'ok') return null
  return (
    <div
      role="status"
      data-estado-pos={estado}
      style={{
        margin: '0.75rem 1rem', padding: '0.55rem 0.8rem', borderRadius: 4,
        background: 'var(--c-oro-fondo)', color: 'var(--c-oro-texto)', border: '1px solid var(--c-oro)',
        fontSize: '0.8rem', fontWeight: 600,
      }}
    >
      {TEXTOS[estado]}
    </div>
  )
}
