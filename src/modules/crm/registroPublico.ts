/**
 * Registro público de clientes (/registro + QR de CrmQR) — APAGADO.
 *
 * SEC-03 / Club Satori F0 (mig 072): `anon` ya no puede insertar en `customers`.
 * El registro vuelve en la F1 del Club Satori con una función SECURITY DEFINER
 * (validación de cada campo + límite de tasa). Los componentes se conservan para reusarlos.
 */
export const REGISTRO_PUBLICO_ACTIVO = false

export const AVISO_REGISTRO = 'El registro de clientes vuelve pronto con el Club Satori'
