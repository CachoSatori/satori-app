// Ejemplo de alias de correo para empleados sin correo propio.
// Repo público: el correo del local no va escrito en el código. Se configura con
// VITE_CORREO_LOCAL en el entorno del build; sin configurar, se muestra un marcador.

export const MARCADOR_ALIAS = 'correo-del-local+nombre@…'

/** `local@dominio` → `local+nombre@dominio`; vacío o inválido → marcador. */
export function aliasCorreoEjemplo(base: string | undefined | null): string {
  const m = /^([A-Za-z0-9._%-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/.exec((base ?? '').trim())
  return m ? `${m[1]}+nombre@${m[2]}` : MARCADOR_ALIAS
}

export const ALIAS_CORREO_EJEMPLO = aliasCorreoEjemplo(import.meta.env.VITE_CORREO_LOCAL as string | undefined)
