import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../api/supabase'

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
  opts?: { pauseWhileTyping?: boolean },
) {
  const cbRef = useRef(onChange)
  cbRef.current = onChange
  const pause = opts?.pauseWhileTyping ?? false

  useEffect(() => {
    let debounce: number | undefined
    let retry: number | undefined
    let reconnect: number | undefined
    let reconnectDelay = 2_000
    let disposed = false
    let channel: RealtimeChannel | null = null

    const isTyping = () => {
      const el = document.activeElement
      return !!el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
    }
    const fire = () => {
      if (disposed) return
      if (pause && isTyping()) {
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
    const subscribe = async () => {
      if (disposed) return
      // postgres_changes respeta RLS: el socket necesita el JWT del usuario
      // (sin esto el join va con la anon key y el canal queda en error).
      try {
        const { data } = await supabase.auth.getSession()
        if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token)
      } catch { /* sin sesión: el canal igual se intenta con la anon key */ }
      if (disposed) return
      const ch = supabase.channel(channelName)
      channel = ch
      for (const table of tables) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, schedule)
      }
      ch.subscribe((status, err) => {
        if (disposed) return
        if (status !== 'SUBSCRIBED') console.warn(`[rt] canal ${channelName}: ${status}`, err?.message ?? '')
        if (status === 'SUBSCRIBED') {
          reconnectDelay = 2_000
          schedule()  // ponerse al día con lo que pasó mientras no había canal
        } else if (status === 'CLOSED') {
          // CHANNEL_ERROR/TIMED_OUT NO desmontan el canal: el primer join suele dar
          // un error transitorio y el rejoin automático del SDK lo resuelve solo
          // (desmontarlo acá mataba ese reintento). Solo un cierre definitivo
          // recrea el canal, con backoff.
          supabase.removeChannel(ch).catch(() => { /* canal ya muerto */ })
          if (channel === ch) channel = null
          window.clearTimeout(reconnect)
          reconnect = window.setTimeout(subscribe, reconnectDelay)
          reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
        }
      })
    }
    subscribe()

    const onVis = () => { if (document.visibilityState === 'visible') schedule() }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVis)
      window.clearTimeout(debounce)
      window.clearTimeout(retry)
      window.clearTimeout(reconnect)
      if (channel) supabase.removeChannel(channel).catch(() => { /* ya removido */ })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, tables.join(','), pause])
}
