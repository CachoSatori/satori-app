/**
 * 158 · «Link de reseña de Google» por local (pestaña Locales, solo owner). club-web lo muestra al turista después de usar
 * su cupón («Gracias por su visita» + «Escribir una reseña en Google», durante 7 días). Solo direcciones de Google; vacío =
 * sin link (el turista ve el aviso corto de siempre). Cada cambio queda en club_config_historial.
 * 167 · El mismo link lo usa la tarjeta «¿Nos cuenta cómo le fue?» de los socios en «Mi Club» (cada N visitas, máx. una
 * vez cada X días; N y X en club_config_global, hoy 5 y 90).
 */
import { useEffect, useState } from 'react'
import { C, inputStyle } from './estilos'
import { getResenasLocales, setResenaUrl, aClubError, type LocalClub } from '../../shared/api/club'
import { normalizarResenaUrl } from './resenaUrl'

export default function ResenaLocales({ locales }: { locales: LocalClub[] }) {
  const [valores, setValores] = useState<Record<string, string>>({})
  const [guardados, setGuardados] = useState<Record<string, string | null>>({})
  const [msg, setMsg] = useState<{ id: string; ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    getResenasLocales()
      .then(r => { if (!vivo) return; setGuardados(r); setValores(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? '']))) })
      .catch(e => { if (vivo) setError(aClubError(e).message) })
    return () => { vivo = false }
  }, [])

  async function guardar(l: LocalClub) {
    setMsg(null)
    let url: string | null
    try { url = normalizarResenaUrl(valores[l.id] ?? '') }
    catch (e) { setMsg({ id: l.id, ok: false, texto: (e as Error).message }); return }
    setOcupado(l.id)
    try {
      await setResenaUrl(l.id, url)
      setGuardados(g => ({ ...g, [l.id]: url }))
      setValores(v => ({ ...v, [l.id]: url ?? '' }))
      setMsg({ id: l.id, ok: true, texto: url ? `${l.nombre}: link de reseña guardado.` : `${l.nombre}: sin link de reseña.` })
    } catch (e) { setMsg({ id: l.id, ok: false, texto: aClubError(e).message }) }
    finally { setOcupado(null) }
  }

  const campo = { ...inputStyle, padding: '0.55rem 0.7rem' }
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', display: 'grid', gap: 8 }}>
      <strong style={{ fontSize: 13 }}>Reseña de Google (cupón y socios)</strong>
      <p style={{ fontSize: 12, color: C.ink, margin: 0 }}>
        Cuando la caja usa el cupón de un turista, su página le muestra «Gracias por su visita» y el botón «Escribir una
        reseña en Google» durante 7 días. A los socios del Local Club, «Mi Club» les muestra «¿Nos cuenta cómo le fue?»
        cada 5 visitas con beneficio (máximo una vez cada 90 días), con el link del local de su última visita. Pegá el
        link de reseña de Google de cada local (maps.app.goo.gl, g.page, google.com/maps o
        search.google.com/local/writereview). Vacío = no se pide reseña en ese local.
      </p>
      {error && <p style={{ color: C.red, fontSize: 13, margin: 0 }}>{error}</p>}
      {!error && locales.map(l => {
        const cambio = (valores[l.id] ?? '').trim() !== (guardados[l.id] ?? '')
        return (
          <div key={l.id} style={{ display: 'grid', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }} htmlFor={`resena-${l.id}`}>{l.nombre}</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input id={`resena-${l.id}`} aria-label={`Link de reseña de Google de ${l.nombre}`} placeholder="https://g.page/r/…/review"
                     value={valores[l.id] ?? ''} maxLength={500} style={{ ...campo, flex: 1 }}
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
