// Facturación Electrónica CR — capa de ABSTRACCIÓN del proveedor (ESTRUCTURA, no real).
//
// Toda emisión pasa por la interfaz `FeProvider.emitir()`. Hoy existe UN solo
// proveedor: `feProviderSim`, que SIMULA la emisión (estado 'emitido-sim') SIN llamar
// a Hacienda ni a ningún servicio externo. El día que se integre el proveedor real
// (TribuCR / Hacienda 4.4 / etc.) se agrega otra impl de esta misma interfaz y el
// resto de la app no cambia.
//
// Los totales (neto/IVA/servicio/total) los DERIVA computeTotals en el cobro y se pasan
// acá como snapshot — este módulo NO recalcula impuestos.

export type FeTipo = 'tiquete' | 'factura'

export interface FeReceptor {
  nombre?: string | null
  id?: string | null       // cédula física/jurídica
  email?: string | null
}

/** Lo que se le pide emitir al proveedor (snapshot fiscal del cobro). */
export interface FeDocumentoInput {
  tipo: FeTipo
  receptor?: FeReceptor | null     // opcional: el tiquete no requiere receptor
  total_neto: number
  total_iva: number
  total_servicio: number
  total: number
}

/** Resultado de una emisión. En SIM nunca falla; el campo error_msg queda para el real. */
export interface FeEmisionResult {
  estado: 'emitido' | 'error'
  consecutivo: string | null
  clave: string | null
  provider: string
  provider_ref: string | null
  error_msg?: string | null
}

export interface FeProvider {
  readonly nombre: string
  emitir(doc: FeDocumentoInput): Promise<FeEmisionResult>
}

const digits = (n: number, len: number): string => String(Math.abs(Math.floor(n))).padStart(len, '0').slice(-len)

/** Consecutivo SIM (20 dígitos, estructura CR: casa 3 + terminal 5 + tipo 2 + secuencia 10).
 *  Puro y testeable: dado el mismo `seed` produce el mismo consecutivo. */
export function buildSimConsecutivo(tipo: FeTipo, seed: number): string {
  const tipoCod = tipo === 'factura' ? '01' : '04'   // 01 factura · 04 tiquete (CR 4.4)
  return '001' + '00001' + tipoCod + digits(seed, 10)
}

/** Clave numérica SIM (50 dígitos). Estructura CR aproximada para el placeholder:
 *  país 506 + ddmmyy + cédula(12) + consecutivo(20) + situación 1 + seguridad(8). */
export function buildSimClave(consecutivo: string, seed: number, now: Date): string {
  const dd = digits(now.getDate(), 2), mm = digits(now.getMonth() + 1, 2), yy = digits(now.getFullYear() % 100, 2)
  const cedula = '0'.repeat(12)               // emisor pendiente de configurar (SIM)
  const situacion = '1'                        // 1 = normal
  const seguridad = digits(seed * 7 + 13, 8)   // código de seguridad simulado
  return ('506' + dd + mm + yy + cedula + consecutivo + situacion + seguridad).slice(0, 50)
}

/** Proveedor SIMULADO: marca el documento como emitido sin contactar a Hacienda. */
export const feProviderSim: FeProvider = {
  nombre: 'sim',
  async emitir(doc: FeDocumentoInput): Promise<FeEmisionResult> {
    // Semilla del documento: tiempo + componente pseudo-aleatorio. NO hay fetch.
    const seed = Date.now() % 1_0000000000 + Math.floor(Math.random() * 1000)
    const consecutivo = buildSimConsecutivo(doc.tipo, seed)
    const clave = buildSimClave(consecutivo, seed, new Date())
    return {
      estado: 'emitido',
      consecutivo,
      clave,
      provider: 'sim',
      provider_ref: 'emitido-sim',
      error_msg: null,
    }
  },
}

/** Proveedor activo de la app. Cambiar acá (o por config) cuando exista el real. */
export const feProvider: FeProvider = feProviderSim
