import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../../shared/hooks/useAuth'

// Solo ingreso: el auto-registro está cerrado desde SEC-01 (04/11, `disable_signup`). Las cuentas
// las crea el owner desde Admin → Usuarios → «+ Nuevo empleado» (Edge Function `alta-empleado`).
export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) {
      setError('Email o contraseña incorrectos')
      setLoading(false)
    }
    // On success: useAuth's onAuthStateChange fires, App re-renders and unmounts this page
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <header className="login-header">
          <div className="login-mark">祭</div>
          <h1>Satori</h1>
          <p className="login-subtitle">Santa Teresa, Costa Rica</p>
        </header>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="field">
            <label htmlFor="email">Correo electrónico</label>
            <input
              id="email" type="email" autoComplete="email"
              value={email} onChange={e => setEmail(e.target.value)}
              required disabled={loading} placeholder="usuario@ejemplo.com"
            />
          </div>
          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password" type="password" autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)}
              required disabled={loading} placeholder="••••••••"
            />
          </div>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
          <p className="login-footer" style={{ marginTop: '0.25rem', lineHeight: 1.5 }}>
            ¿No tenés cuenta? Pedísela a la gerencia.
          </p>
        </form>
        <footer className="login-footer"><span>v2.0</span></footer>
      </div>
    </div>
  )
}
