// Aviso verde «el cambio ya estaba terminado» (hallazgo 252, #361). UNA sola pieza para la Caja Diaria y el Cierre del
// día: el mismo texto (mensajeNoTerminable('resuelto')) con el mismo `Aviso tipo="hecho"` del estándar. Cada pantalla
// lo muestra atado a su turno (Caja Diaria) o a su fecha (Cierre): al cerrar el turno, cambiar de día o salir de la
// pantalla (las pestañas de Caja se desmontan), desaparece solo.
import { Aviso } from '../../shared/ui/estandar'
import { mensajeNoTerminable } from './reemplazoPago'

export default function AvisoCambioTerminado() {
  return <Aviso tipo="hecho" titulo={mensajeNoTerminable('resuelto')} />
}
