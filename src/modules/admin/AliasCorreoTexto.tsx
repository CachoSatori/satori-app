// Texto del alias de correo en Admin → Usuarios y en «+ Nuevo empleado» (mig 195: correo base por local).
import { FALTA_CORREO_LOCAL } from './aliasCorreo'

export type AliasEstado =
  | { estado: 'cargando' }
  | { estado: 'error' }
  | { estado: 'ok'; local: string | null; alias: string | null }

export const NO_SE_PUDO_LEER = 'No se pudo leer el correo del local'

export default function AliasCorreoTexto({ a }: { a: AliasEstado }) {
  if (a.estado === 'cargando') return <span data-testid="alias-correo">…</span>
  if (a.estado === 'error') return <strong data-testid="alias-correo">{NO_SE_PUDO_LEER}</strong>
  if (!a.alias) return <strong data-testid="alias-correo">{FALTA_CORREO_LOCAL}</strong>
  return (
    <span data-testid="alias-correo">
      <code>{a.alias}</code>{a.local && <> ({a.local})</>}
    </span>
  )
}
