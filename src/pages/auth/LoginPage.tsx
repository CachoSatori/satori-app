import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../../shared/hooks/useAuth'
import {
  pedirEnlaceRecuperacion, esperaParaPedir, tomarAvisoLogin,
  MENSAJE_ENLACE_ENVIADO, MENSAJE_ENLACE_VENCIDO, MENSAJE_SIN_CONEXION_ENVIO,
} from '../../shared/api/recuperarClave'

// Solo ingreso: el auto-registro está cerrado desde SEC-01 (04/11, `disable_signup`). Las cuentas
// las crea el owner desde Admin → Usuarios → «+ Nuevo empleado» (Edge Function `alta-empleado`).
export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // «¿Olvidaste tu contraseña?»: se abre al tocar el enlace, o sola si se volvió de un enlace vencido.
  const [aviso] = useState(tomarAvisoLogin)
  const [olvide, setOlvide] = useState(aviso === 'vencido')

  if (olvide) {
    return <OlvideClave correoInicial={email} vencido={aviso === 'vencido'} onVolver={() => setOlvide(false)} />
  }

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
          <img src={`${import.meta.env.BASE_URL}marca/daruma.png`} alt="" className="login-daruma" width={58} height={64} />
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
          <button type="button" className="login-btn secundario" style={{ marginTop: '0.25rem' }}
            onClick={() => { setError(null); setOlvide(true) }} disabled={loading}>
            ¿Olvidaste tu contraseña?
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

// ── «¿Olvidaste tu contraseña?» ──────────────────────────────────────────────────────────────────
// Pide el correo y manda el enlace. El mensaje es siempre el mismo, exista o no la cuenta. Freno: un pedido por minuto.
function OlvideClave({ correoInicial, vencido, onVolver }: { correoInicial: string; vencido: boolean; onVolver: () => void }) {
  const [correo, setCorreo] = useState(correoInicial)
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [espera, setEspera] = useState(() => esperaParaPedir())

  // Cuenta regresiva del freno (solo corre mientras hay que esperar).
  useEffect(() => {
    if (espera <= 0) return
    const t = setInterval(() => setEspera(esperaParaPedir()), 1000)
    return () => clearInterval(t)
  }, [espera])

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (enviando || espera > 0) return
    setError(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())) { setError('Escribí tu correo completo'); return }
    setEnviando(true)
    const r = await pedirEnlaceRecuperacion(correo)
    setEnviando(false)
    setEspera(esperaParaPedir())
    if (!r.ok) {
      if (r.motivo === 'sin_conexion') setError(MENSAJE_SIN_CONEXION_ENVIO)
      return
    }
    setEnviado(true)
  }

  const segundos = Math.ceil(espera / 1000)
  return (
    <div className="login-container">
      <div className="login-card">
        <header className="login-header">
          <img src={`${import.meta.env.BASE_URL}marca/daruma.png`} alt="" className="login-daruma" width={58} height={64} />
          <h1>¿Olvidaste tu contraseña?</h1>
          <p className="login-subtitle">Te mandamos un enlace al correo para crear una nueva.</p>
        </header>
        <form onSubmit={enviar} className="login-form" noValidate>
          {vencido && !enviado && <p className="login-error" role="alert" data-testid="aviso-enlace-vencido">{MENSAJE_ENLACE_VENCIDO}</p>}
          <div className="field">
            <label htmlFor="olvide-correo">Correo electrónico</label>
            <input id="olvide-correo" type="email" autoComplete="email" value={correo}
              onChange={e => setCorreo(e.target.value)} disabled={enviando} placeholder="usuario@ejemplo.com" />
          </div>
          {enviado && (
            <p className="mi-cuenta-ok" role="status">
              {MENSAJE_ENLACE_ENVIADO} El enlace vence en una hora. Si no aparece, mirá en «Spam».
            </p>
          )}
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" className="login-btn" disabled={enviando || espera > 0}>
            {enviando ? 'Enviando…' : espera > 0 ? `Podés pedir otro en ${segundos} s` : enviado ? 'Mandar otro enlace' : 'Mandar enlace'}
          </button>
          <button type="button" className="login-btn secundario" style={{ marginTop: '0.25rem' }} onClick={onVolver} disabled={enviando}>
            Volver a ingresar
          </button>
        </form>
      </div>
    </div>
  )
}
