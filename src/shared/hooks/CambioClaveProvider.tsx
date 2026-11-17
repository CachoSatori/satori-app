// Cambio de contraseña obligatorio (mig 185). Consulta a la base si el usuario de la sesión tiene que cambiar la
// contraseña y lo expone a las rutas: con `debe` en true, PrivateRoute y OwnerRoute solo dejan estar en /mi-cuenta.
//
// Cuándo consulta: al entrar o cambiar de usuario, al reconectar (evento `online`) y al volver a la pestaña si pasaron
// más de 5 minutos desde la última consulta (una PC del PoS que queda abierta todo el día también se entera).
// Sin conexión NO bloquea (decisión del dueño: la caja offline sigue andando como hoy) y exige al reconectar.
// Si la consulta falla o vence (null), tampoco bloquea: es un empujón de la app, no la barrera de seguridad; la
// barrera real es el cambio de contraseña en sí.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from './useAuth'
import { deboCambiarClave } from '../api/cambioClave'
import { CambioClaveContext, RECONSULTA_AL_VOLVER_MS, type CambioClaveCtx } from './useCambioClave'

function enLineaAhora(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

export function CambioClaveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  // Respuesta de la base, atada al usuario al que corresponde (otro usuario no hereda la marca).
  const [marca, setMarca] = useState<{ uid: string; valor: boolean } | null>(null)
  // Usuario cuya PRIMERA consulta ya terminó (o se salteó por estar sin red). Mientras no coincida con el de la sesión,
  // `consultando` es true desde el primer render: no se ve ni un instante de otra pantalla antes de redirigir.
  const [verificado, setVerificado] = useState<string | null>(null)
  const [enLinea, setEnLinea] = useState(enLineaAhora)
  const ultima = useRef(0)
  const actual = useRef<string | null>(null)   // usuario de la sesión (descarta respuestas de otro usuario)

  const recargar = useCallback(async (): Promise<boolean | null> => {
    const uid = actual.current
    if (!uid || !enLineaAhora()) return null
    ultima.current = Date.now()
    const r = await deboCambiarClave()
    if (actual.current !== uid) return null          // cambió el usuario mientras tanto
    if (r !== null) setMarca({ uid, valor: r })      // null (sin red / error): se queda como estaba
    return r
  }, [])

  // Al entrar o cambiar de usuario: primera consulta (sin red se saltea y se consulta al reconectar)
  useEffect(() => {
    actual.current = userId
    if (!userId) return
    let vivo = true
    const consulta = enLineaAhora() ? recargar() : Promise.resolve(null)
    consulta.finally(() => { if (vivo) setVerificado(userId) })
    return () => { vivo = false }
  }, [userId, recargar])

  // Conexión: sin red no bloquea; al volver, consulta de nuevo. Al volver a la pestaña, si pasó un rato, también.
  useEffect(() => {
    const on = () => { setEnLinea(true); void recargar() }
    const off = () => setEnLinea(false)
    const visible = () => {
      if (document.visibilityState === 'visible' && Date.now() - ultima.current > RECONSULTA_AL_VOLVER_MS) void recargar()
    }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [recargar])

  const marcado = !!userId && marca?.uid === userId && marca.valor
  const valor: CambioClaveCtx = { debe: marcado && enLinea, consultando: !!userId && verificado !== userId, recargar }
  return <CambioClaveContext.Provider value={valor}>{children}</CambioClaveContext.Provider>
}
