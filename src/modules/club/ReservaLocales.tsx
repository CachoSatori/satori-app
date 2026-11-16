/**
 * 180 · «Link de reservas (OpenTable)» por local (pestaña Locales, solo owner). Es de CADA LOCAL y para todos: lo usan
 * «Reservar» del portal del socio («Mi Club»), el botón «Reservar una mesa» de la página del cupón del turista y el
 * WhatsApp de cumpleaños del Inicio. Antes vivía en Promociones → Cumpleaños (mig 173/179). Se guarda tal cual; vacío =
 * sin link (la página del cupón no muestra el botón; el portal usa el OpenTable por defecto). Cada cambio queda en
 * club_config_historial.
 */
import { useEffect, useState } from 'react'
import { C, inputStyle } from './estilos'
import { getReservasLocales, setReservaUrl, aClubError, type LocalClub } from '../../shared/api/club'
import { normalizarReservaUrl } from './reservaUrl'

export default function ReservaLocales({ locales }: { locales: LocalClub[] }) {
  const [valores, setValores] = useState<Record<string, string>>({})
  const [guardados, setGuardados] = useState<Record<string, string | null>>({})
  const [msg, setMsg] = useState<{ id: string; ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    getReservasLocales()
      .then(r => { if (!vivo) return; setGuardados(r); setValores(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? '']))) })
      .catch(e => { if (vivo) setError(aClubError(e).message) })
    return () => { vivo = false }
  }, [])

  async function guardar(l: LocalClub) {
    setMsg(null)
    let url: string | null
    try { url = normalizarReservaUrl(valores[l.id] ?? '') }
    catch (e) { setMsg({ id: l.id, ok: false, texto: (e as Error).message }); return }
    setOcupado(l.id)
    try {
      await setReservaUrl(l.id, url)
      setGuardados(g => ({ ...g, [l.id]: url }))
      setValores(v => ({ ...v, [l.id]: url ?? '' }))
      setMsg({ id: l.id, ok: true, texto: url ? `${l.nombre}: link de reservas guardado.` : `${l.nombre}: sin link de reservas.` })
    } catch (e) { setMsg({ id: l.id, ok: false, texto: aClubError(e).message }) }
    finally { setOcupado(null) }
  }

  const campo = { ...inputStyle, padding: '0.55rem 0.7rem' }
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', display: 'grid', gap: 8 }}>
      <strong style={{ fontSize: 13 }}>Link de reservas (OpenTable)</strong>
      <p style={{ fontSize: 12, color: C.ink, margin: 0 }}>
        El link de OpenTable de cada local. Lo usan «Reservar» en «Mi Club» de los socios de ese local, el botón «Reservar una
        mesa» en la página del cupón de los turistas y el WhatsApp de cumpleaños. Copialo tal cual del navegador (trae el
        seguimiento de OpenTable). Vacío = la página del cupón no muestra el botón.
      </p>
      {error && <p style={{ color: C.red, fontSize: 13, margin: 0 }}>{error}</p>}
      {!error && locales.map(l => {
        const cambio = (valores[l.id] ?? '').trim() !== (guardados[l.id] ?? '')
        return (
          <div key={l.id} style={{ display: 'grid', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }} htmlFor={`reserva-${l.id}`}>{l.nombre}</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input id={`reserva-${l.id}`} aria-label={`Link de reservas de OpenTable de ${l.nombre}`}
                     placeholder="https://www.opentable.com/restref/client/?rid=…" inputMode="url"
                     value={valores[l.id] ?? ''} maxLength={300} style={{ ...campo, flex: 1 }}
                     onChange={e => setValores(v => ({ ...v, [l.id]: e.target.value }))} />
              <button className="cash-back-btn" disabled={ocupado !== null || !cambio} onClick={() => void guardar(l)}>Guardar</button>
            </div>
            {msg?.id === l.id && <p style={{ color: msg.ok ? C.teal : C.red, fontSize: 12, margin: 0 }}>{msg.texto}</p>}
          </div>
        )
      })}
    </div>
  )
}
