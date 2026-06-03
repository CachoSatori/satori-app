import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../../shared/hooks/useAuth'

type Mode = 'login' | 'signup'

export default function LoginPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const switchMode = (m: Mode) => { setMode(m); setError(null) }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (mode === 'signup') {
      if (fullName.trim().length < 3) { setError('Escribí tu nombre completo'); return }
      if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres'); return }
      if (password !== password2) { setError('Las contraseñas no coinciden'); return }
      setLoading(true)
      const { error } = await signUp(fullName, email, password)
      if (error) {
        setError(error.includes('registered') ? 'Ese correo ya tiene una cuenta' : error)
        setLoading(false)
      }
      // On success: onAuthStateChange logs them in → App muestra pantalla "cuenta pendiente"
      return
    }

    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) {
      setError('Email o contraseña incorrectos')
      setLoading(false)
    }
    // On success: useAuth's onAuthStateChange fires, App re-renders and unmounts this page
  }

  const isSignup = mode === 'signup'

  return (
    <div className="login-container">
      <div className="login-card">
        <header className="login-header">
          <div className="login-mark">祭</div>
          <h1>Satori</h1>
          <p className="login-subtitle">Santa Teresa, Costa Rica</p>
        </header>

        {/* Toggle login / crear cuenta */}
        <div className="auth-toggle">
          <button type="button" className={`auth-toggle-btn ${!isSignup ? 'active' : ''}`} onClick={() => switchMode('login')} disabled={loading}>
            Ingresar
          </button>
          <button type="button" className={`auth-toggle-btn ${isSignup ? 'active' : ''}`} onClick={() => switchMode('signup')} disabled={loading}>
            Crear cuenta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {isSignup && (
            <div className="field">
              <label htmlFor="fullName">Nombre completo</label>
              <input
                id="fullName" type="text" autoComplete="name"
                value={fullName} onChange={e => setFullName(e.target.value)}
                required disabled={loading} placeholder="Nombre y apellido"
              />
            </div>
          )}
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
              id="password" type="password" autoComplete={isSignup ? 'new-password' : 'current-password'}
              value={password} onChange={e => setPassword(e.target.value)}
              required disabled={loading} placeholder="••••••••"
            />
          </div>
          {isSignup && (
            <div className="field">
              <label htmlFor="password2">Repetir contraseña</label>
              <input
                id="password2" type="password" autoComplete="new-password"
                value={password2} onChange={e => setPassword2(e.target.value)}
                required disabled={loading} placeholder="••••••••"
              />
            </div>
          )}
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? (isSignup ? 'Creando…' : 'Ingresando…') : (isSignup ? 'Crear cuenta' : 'Ingresar')}
          </button>
          {isSignup && (
            <p className="login-footer" style={{ marginTop: '0.25rem', lineHeight: 1.5 }}>
              Tu cuenta queda pendiente hasta que la gerencia la habilite.
            </p>
          )}
        </form>
        <footer className="login-footer"><span>v2.0</span></footer>
      </div>
    </div>
  )
}
