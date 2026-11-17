// «Mi cuenta» → «Cambiar mi contraseña», para cualquier usuario logueado (todas las cuentas, todos los roles).
// La lógica está en `shared/api/miPassword.ts`. Las contraseñas viven solo en el estado de este formulario:
// no se loguean, no se guardan y no pasan por la cola offline. Sin conexión, el botón queda apagado.
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { useCambioClave } from '../../shared/hooks/useCambioClave'
import {
  PASSWORD_MIN_CAMBIO, validarCambio, evaluarPassword, FUERZA_TEXTO, MOTIVO_DEBIL, MENSAJE_FALLO, cambiarMiPassword,
} from '../../shared/api/miPassword'

function useEnLinea(): boolean {
  const [enLinea, setEnLinea] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setEnLinea(true)
    const off = () => setEnLinea(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return enLinea
}

type Listo = { otrasSesionesCerradas: boolean }

export default function MiCuenta() {
  const { user, profile, signOut } = useAuth()
  // Cambio obligatorio (mig 185): el owner lo pidió; las rutas solo dejan estar acá hasta cambiarla.
  const { debe: obligado, recargar } = useCambioClave()
  const navigate = useNavigate()
  const enLinea = useEnLinea()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [nueva2, setNueva2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [listo, setListo] = useState<Listo | null>(null)

  const evaluada = nueva ? evaluarPassword(nueva) : null
  const fuerza = evaluada?.fuerza ?? null

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (guardando || !enLinea) return
    setError(null)
    const msg = validarCambio(actual, nueva, nueva2)
    if (msg) { setError(msg); return }
    setGuardando(true)
    const r = await cambiarMiPassword(user?.email, actual, nueva)
    setGuardando(false)
    if (!r.ok) {
      setError(MENSAJE_FALLO[r.motivo])
      if (r.motivo === 'actual_incorrecta') setActual('')
      return
    }
    // Hecho: los campos se vacían para que la contraseña no quede en pantalla ni en memoria del formulario.
    setActual(''); setNueva(''); setNueva2('')
    // Si estaba obligado, se vuelve a preguntar a la base: con la contraseña nueva la marca se borra y se libera.
    await recargar()
    setListo({ otrasSesionesCerradas: r.otrasSesionesCerradas })
  }

  return (
    <div className="login-container mi-cuenta">
      <div className="login-card">
        <header className="login-header">
          <img src={`${import.meta.env.BASE_URL}marca/daruma.png`} alt="" className="login-daruma" width={58} height={64} />
          <h1>Cambiar mi contraseña</h1>
          <p className="login-subtitle">
            {profile?.full_name ?? ''}{user?.email ? ` · ${user.email}` : ''}
          </p>
        </header>

        {obligado && !listo && (
          <p className="login-error" role="alert" data-testid="aviso-cambio-obligatorio">
            Por seguridad tenés que cambiar tu contraseña antes de seguir.
          </p>
        )}

        {listo ? (
          <div className="login-form">
            <p className="mi-cuenta-ok" role="status">
              Listo: tu contraseña cambió.{' '}
              {listo.otrasSesionesCerradas
                ? 'Cerramos tu sesión en los otros equipos: ahí vas a tener que entrar con la contraseña nueva.'
                : 'No pudimos confirmar que se cerró tu sesión en otros equipos: si usaste la app en otro lado, cerrá sesión ahí.'}
            </p>
            <button type="button" className="login-btn" onClick={() => navigate('/')}>Volver al inicio</button>
          </div>
        ) : (
          <form onSubmit={enviar} className="login-form" noValidate>
            <div className="field">
              <label htmlFor="mc-actual">Contraseña actual</label>
              <input id="mc-actual" type="password" autoComplete="current-password" value={actual}
                onChange={e => setActual(e.target.value)} disabled={guardando} />
            </div>
            <div className="field">
              <label htmlFor="mc-nueva">Contraseña nueva (mínimo {PASSWORD_MIN_CAMBIO})</label>
              <input id="mc-nueva" type="password" autoComplete="new-password" value={nueva}
                onChange={e => setNueva(e.target.value)} disabled={guardando} aria-describedby="mc-fuerza" />
              <div id="mc-fuerza" className="mi-cuenta-medidor" aria-live="polite">
                {fuerza && (
                  <div className="mi-cuenta-fuerza">
                    <span className={`mi-cuenta-barra ${fuerza}`} aria-hidden="true"><span /></span>
                    <span>Fuerza: {FUERZA_TEXTO[fuerza]}</span>
                  </div>
                )}
                {/* Si sale «Débil», el motivo concreto (reclamo del dueño 17-nov: decía «Débil» sin explicar). */}
                {evaluada?.motivo && <p className="mi-cuenta-ayuda">{MOTIVO_DEBIL[evaluada.motivo]}</p>}
              </div>
            </div>
            <div className="field">
              <label htmlFor="mc-nueva2">Repetir contraseña nueva</label>
              <input id="mc-nueva2" type="password" autoComplete="new-password" value={nueva2}
                onChange={e => setNueva2(e.target.value)} disabled={guardando} />
            </div>
            <p className="mi-cuenta-ayuda">
              Tiene que salir «Aceptable» o «Fuerte»: una frase de varias palabras con un número es fácil de recordar
              y difícil de adivinar. No uses la misma contraseña de otro lado.
            </p>
            {error && <p className="login-error" role="alert">{error}</p>}
            <button type="submit" className="login-btn" disabled={guardando || !enLinea}>
              {!enLinea ? 'Necesitás conexión' : guardando ? 'Guardando…' : 'Cambiar contraseña'}
            </button>
            {obligado ? (
              <button type="button" className="login-btn secundario" style={{ marginTop: '0.5rem' }}
                onClick={() => { void signOut() }} disabled={guardando}>Cerrar sesión</button>
            ) : (
              <button type="button" className="login-btn secundario" style={{ marginTop: '0.5rem' }}
                onClick={() => navigate('/')} disabled={guardando}>Cancelar</button>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
