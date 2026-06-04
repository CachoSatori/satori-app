import { Component } from 'react'
import type { ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * Captura excepciones de render de cualquier módulo para que un error en una
 * pantalla no deje toda la app en blanco. Muestra un fallback con opción de
 * recargar o volver al inicio.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Log para diagnóstico (visible en consola del navegador)
    console.error('Error capturado por ErrorBoundary:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="login-container">
        <div className="pending-card">
          <div className="pending-mark" style={{ color: 'var(--t-red)' }}>⚠</div>
          <h1>Algo salió mal</h1>
          <p>
            Ocurrió un error inesperado en esta pantalla. Probá recargar; si sigue,
            volvé al inicio y avisá a la gerencia.
          </p>
          <div style={{ display: 'flex', gap: '0.625rem' }}>
            <button className="login-btn" style={{ maxWidth: 160 }} onClick={() => window.location.reload()}>
              Recargar
            </button>
            <button className="login-btn" style={{ maxWidth: 160, background: 'var(--gray-pale)' }}
              onClick={() => { window.location.href = '/satori-app/' }}>
              Ir al inicio
            </button>
          </div>
        </div>
      </div>
    )
  }
}
