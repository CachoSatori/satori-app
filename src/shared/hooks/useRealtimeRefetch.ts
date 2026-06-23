import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, ensureRealtimeHealthy } from '../api/supabase'

// R1 (freno anti-loop): tras N fallos seguidos (CLOSED/CHANNEL_ERROR/TIMED_OUT) sin lograr
// SUBSCRIBED, dejamos de recrear el canal automáticamente y esperamos 'rt:healthy' (que llega
// de ensureRealtimeHealthy con token+socket sanos). Evita los cientos de recreate que trababan
// la app tras suspensión profunda. Se resetea en SUBSCRIBED y en onHealthy.
const MAX_FAIL_STREAK = 5

/**
 * Tiempo real multi-dispositivo (estrategia refetch): se suscribe a cambios de
 * Postgres en las tablas dadas y dispara `onChange` (debounced) para que el
 * módulo recargue de la fuente de verdad. No se aplican payloads parciales —
 * recargar todo es más simple y a esta escala (cientos de filas) es barato.
 *
 * Degradación elegante:
 *  - si el canal cae (error/timeout/cierre), reintenta con backoff exponencial
 *    (2s → 30s máx) y al re-suscribirse hace un refetch de "ponerse al día";
 *  - al volver la pestaña a foco, refetch de seguridad (por si el websocket
 *    murió en background);
 *  - `pauseWhileTyping`: si el usuario tiene un input enfocado, pospone el
 *    refetch (reintenta cada 4s) para no pisarle lo que está escribiendo.
 */
export function useRealtimeRefetch(
  channelName: string,
  tables: string[],
  onChange: () => void,
  opts?: { pauseWhileTyping?: boolean; pauseWhile?: () => boolean },
) {
  const cbRef = useRef(onChange)
  cbRef.current = onChange
  const pause = opts?.pauseWhileTyping ?? false
  // Predicado de pausa (ej. "hay un modal abierto"): si devuelve true, el refetch se
  // pospone para no refrescar la lista bajo los pies del salonero. Ref para no re-suscribir.
  const pauseWhileRef = useRef(opts?.pauseWhile)
  pauseWhileRef.current = opts?.pauseWhile

  useEffect(() => {
    let debounce: number | undefined
    let retry: number | undefined
    let reconnect: number | undefined
    let reconnectDelay = 2_000
    let disposed = false
    let channel: RealtimeChannel | null = null
    let authErrors = 0       // CHANNEL_ERROR/TIMED_OUT seguidos sin JWT → recrea al 2º (el 1º suele ser transitorio)
    let failStreak = 0       // R1: fallos seguidos sin SUBSCRIBED → al llegar a MAX_FAIL_STREAK, freno

    // R1: recrea, pero si ya van demasiados fallos seguidos, FRENA (no recrea más) y patea la
    // recuperación de fondo (ensureRealtimeHealthy) — el re-subscribe vendrá por 'rt:healthy'.
    const recreateOrFreno = () => {
      failStreak++
      if (failStreak >= MAX_FAIL_STREAK) {
        console.warn('[rt-diag]', channelName, `FRENO: ${failStreak} fallos seguidos sin SUBSCRIBED → paro recreate, espero rt:healthy`)
        void ensureRealtimeHealthy()
        return
      }
      recreate()
    }

    const isTyping = () => {
      const el = document.activeElement
      return !!el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
    }
    const fire = () => {
      if (disposed) return
      if ((pause && isTyping()) || pauseWhileRef.current?.()) {
        window.clearTimeout(retry)
        retry = window.setTimeout(fire, 4_000)
        return
      }
      cbRef.current()
    }
    const schedule = () => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(fire, 600)
    }
    // Recrea el canal con backoff exponencial (2s → 30s máx): lo saca, lo nulea y agenda un
    // re-subscribe. Antes esto vivía sólo en el branch 'CLOSED'; ahora también cura el canal
    // clavado por JWT vencido (CHANNEL_ERROR/TIMED_OUT en loop).
    const recreate = () => {
      if (disposed) return
      if (channel) {
        supabase.removeChannel(channel).catch(() => { /* canal ya muerto */ })
        channel = null
      }
      window.clearTimeout(reconnect)
      reconnect = window.setTimeout(subscribe, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
    }
    const subscribe = () => {
      if (disposed) return
      // postgres_changes respeta RLS: el socket necesita el JWT del usuario. NO lo pedimos acá:
      // el onAuthStateChange global de supabase.ts ya hace realtime.setAuth en cada cambio de sesión,
      // así que el socket (único y compartido) viene autenticado. El getSession() por-hook que vivía
      // acá tomaba el candado de auth (navigator.locks) en cada subscribe/recreate → con varios módulos
      // y reconexiones se apilaban pedidos al candado ("[auth] lock no adquirido en 10s" → app trabada).
      const ch = supabase.channel(channelName)
      channel = ch
      for (const table of tables) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, schedule)
      }
      ch.subscribe((status, err) => {
        // ch !== channel ⇒ este callback es de un canal ya reemplazado (join tardío): ignorarlo,
        // para no disparar recreate() sobre el canal nuevo (repone el guard original channel===ch).
        if (disposed || ch !== channel) return
        if (status !== 'SUBSCRIBED') console.warn(`[rt] canal ${channelName}: ${status}`, err?.message ?? '')
        if (status === 'SUBSCRIBED') {
          reconnectDelay = 2_000
          authErrors = 0
          failStreak = 0   // R1: recuperado → reset del freno
          schedule()  // ponerse al día con lo que pasó mientras no había canal
        } else if (status === 'CLOSED') {
          console.log('[rt-diag]', channelName, 'CLOSED → recreate, intento', failStreak + 1)
          recreateOrFreno()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Token JWT vencido (InvalidJWTToken: "Token has expired") o error persistente:
          // el rejoin automático del SDK reintenta con el MISMO token muerto → loop infinito.
          // Recreamos el canal (la Capa 1 ya repuso el JWT fresco en el socket). PERO el primer
          // CHANNEL_ERROR suelto suele ser un parpadeo transitorio del join → lo dejamos pasar:
          // recreamos si el error es de JWT, o si ya van 2 errores seguidos.
          const msg = err?.message ?? ''
          if (/jwt|token|expired/i.test(msg) || ++authErrors >= 2) recreateOrFreno()
        }
      })
    }
    subscribe()

    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      schedule()  // refetch de seguridad por si el websocket murió en background
    }
    document.addEventListener('visibilitychange', onVis)

    // 'rt:healthy' lo emite el singleton de supabase.ts (ensureRealtimeHealthy) DESPUÉS de
    // forzar refreshSession() + setAuth + revivir el socket. Recién entonces re-suscribimos:
    // recreación limpia con token fresco y socket vivo. Antes esto lo intentaba onVis sobre
    // el JWT muerto y loopeaba; ahora el re-subscribe ocurre con la sesión ya garantizada.
    const onHealthy = () => {
      if (disposed) return
      console.log('[rt-diag]', channelName, 're-subscribe por rt:healthy')
      if (channel) {
        supabase.removeChannel(channel).catch(() => { /* ya removido */ })
        channel = null
      }
      reconnectDelay = 2_000
      failStreak = 0   // R1: rt:healthy llegó (socket sano) → reset del freno
      window.clearTimeout(reconnect)
      subscribe()
    }
    window.addEventListener('rt:healthy', onHealthy)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('rt:healthy', onHealthy)
      window.clearTimeout(debounce)
      window.clearTimeout(retry)
      window.clearTimeout(reconnect)
      if (channel) supabase.removeChannel(channel).catch(() => { /* ya removido */ })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, tables.join(','), pause])
}
