// B10 (mig 165): Admin → Usuarios → «Cambios». Quién cambió el rol, la activación o el local de este usuario, cuándo
// y de qué a qué. Solo lectura (la bitácora no se edita ni se borra) y solo owner (Admin entero es solo owner; la base
// lo vuelve a exigir con RLS).
import { useEffect, useState } from 'react'
import { getCambiosPermisos } from '../../shared/api/admin'
import { describirCambio, fechaHoraCR, ordenarCambios, quienCambio, type CambioPermiso } from './bitacoraPermisos'

interface Props {
  profileId: string
  /** id → nombre de los usuarios (para mostrar quién hizo el cambio). */
  nombres: Map<string, string>
}

export default function CambiosPermisos({ profileId, nombres }: Props) {
  const [cambios, setCambios] = useState<CambioPermiso[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    getCambiosPermisos(profileId)
      .then(xs => { if (vivo) setCambios(ordenarCambios(xs)) })
      .catch(e => { if (vivo) setError(e instanceof Error ? e.message : 'Error cargando los cambios') })
    return () => { vivo = false }
  }, [profileId])

  const caja = { padding: '0.6rem 0.75rem', background: 'var(--c-panel)', borderLeft: '2px solid var(--c-linea)',
    fontSize: '0.74rem', lineHeight: 1.6 } as const

  if (error) return <div style={caja}><span className="field-error">No se pudieron cargar los cambios: {error}</span></div>
  if (!cambios) return <div style={{ ...caja, color: 'var(--c-gris)' }}>Cargando cambios…</div>

  return (
    <div style={caja} data-testid="cambios-permisos">
      <strong style={{ color: 'var(--c-tinta)' }}>Cambios</strong>
      <span style={{ color: 'var(--c-gris)' }}> · rol, cuenta y local · más reciente primero</span>
      {cambios.length === 0 ? (
        <p style={{ margin: '0.3rem 0 0', color: 'var(--c-gris)' }}>
          Sin cambios registrados. La bitácora empezó vacía con esta versión: los cambios anteriores no quedaron
          registrados.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: '0.3rem 0 0', padding: 0 }}>
          {cambios.map(c => (
            <li key={c.id} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--c-gris)', minWidth: '8.5rem' }}>{fechaHoraCR(c.cambiado_en)}</span>
              <span style={{ color: 'var(--c-tinta)' }}>{describirCambio(c)}</span>
              <span style={{ color: 'var(--c-gris)' }}>por {quienCambio(c, nombres)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
