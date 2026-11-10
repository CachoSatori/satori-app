// Primer ingreso con contraseña temporal (firmado por el dueño, 05/11): hay que elegir una nueva
// antes de usar la app. El flag `app_metadata.cambiar_password` lo baja SOLO la Edge Function
// `alta-empleado`, en la misma llamada que cambia la contraseña (el usuario no puede bajarlo solo).
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../../shared/hooks/useAuth'
import { supabase } from '../../shared/api/supabase'
import { cambiarPasswordInicial, AltaEmpleadoError, PASSWORD_MIN } from '../../shared/api/altaEmpleado'

export default function CambiarPasswordInicial() {
  const { user, profile, signOut } = useAuth()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [nueva2, setNueva2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (nueva.length < PASSWORD_MIN) { setError(`La contraseña nueva debe tener al menos ${PASSWORD_MIN} caracteres`); return }
    if (nueva !== nueva2) { setError('Las contraseñas nuevas no coinciden'); return }
    if (nueva === actual) { setError('La contraseña nueva tiene que ser distinta de la temporal'); return }
    setSaving(true)
    try {
      await cambiarPasswordInicial(actual, nueva)
      // Al cambiar la contraseña, GoTrue revoca los refresh tokens de la cuenta (probado en staging):
      // se vuelve a entrar con la nueva → sesión nueva, con el app_metadata ya sin el flag
      // (onAuthStateChange actualiza `user` y la app sigue sola).
      const { error: le } = await supabase.auth.signInWithPassword({ email: user?.email ?? '', password: nueva })
      if (le) {
        await signOut()
        return
      }
    } catch (err) {
      setError(err instanceof AltaEmpleadoError ? err.message : 'No se pudo cambiar la contraseña')
      setSaving(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <header className="login-header">
          <div className="login-mark">鍵</div>
          <h1>Elegí tu contraseña</h1>
          <p className="login-subtitle">
            Hola{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}. Entraste con una contraseña temporal: elegí una nueva para seguir.
          </p>
        </header>
        <form onSubmit={submit} className="login-form">
          <div className="field">
            <label htmlFor="pw-actual">Contraseña temporal</label>
            <input id="pw-actual" type="password" autoComplete="current-password" value={actual}
              onChange={e => setActual(e.target.value)} required disabled={saving} />
          </div>
          <div className="field">
            <label htmlFor="pw-nueva">Contraseña nueva (mínimo {PASSWORD_MIN})</label>
            <input id="pw-nueva" type="password" autoComplete="new-password" value={nueva}
              onChange={e => setNueva(e.target.value)} required disabled={saving} />
          </div>
          <div className="field">
            <label htmlFor="pw-nueva2">Repetir contraseña nueva</label>
            <input id="pw-nueva2" type="password" autoComplete="new-password" value={nueva2}
              onChange={e => setNueva2(e.target.value)} required disabled={saving} />
          </div>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" className="login-btn" disabled={saving}>{saving ? 'Guardando…' : 'Guardar y entrar'}</button>
          <button type="button" className="login-btn" style={{ background: 'var(--gray-pale)', marginTop: '0.5rem' }}
            onClick={() => signOut()} disabled={saving}>Cerrar sesión</button>
        </form>
      </div>
    </div>
  )
}
