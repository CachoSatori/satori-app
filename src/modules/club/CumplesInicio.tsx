/**
 * Mig 173 (D-cumple-2, firmada por el dueño el 15-nov) · Inicio de owner y manager: «Cumpleaños en los próximos N días».
 * N = «días antes» del beneficio del local (Club → Promociones). Socios ACTIVOS que dieron su cumpleaños con permiso
 * (no hace falta el opt-in de ofertas: el beneficio es parte de su cuenta). Cada socio tiene «WhatsApp ↗»: la base marca
 * «enviado» (una vez por socio y por año del cumpleaños; queda auditado) y devuelve el número; se abre WhatsApp con el
 * saludo en «usted», el beneficio vigente y el link de reserva. Lo manda la persona a mano.
 * Si el beneficio está apagado, no hay nadie o la lectura falla (p. ej. la base sin la 173), no se muestra nada.
 */
import { useEffect, useState } from 'react'
import type { CumpleProximos } from '../../shared/api/club'
import { todayCR } from '../../shared/utils'
import { cuandoCumple, linkCumpleWhatsApp } from './cumple'

export function CumplesInicio({ rol }: { rol: string | null | undefined }) {
  const [datos, setDatos] = useState<CumpleProximos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    import('../../shared/api/club')
      .then(async m => { await m.asegurarLocalParaRol(rol); return m.getCumpleProximos() })
      .then(d => { if (vivo) setDatos(d) })
      .catch(() => { if (vivo) setDatos(null) })
    return () => { vivo = false }
  }, [rol])
  if (!datos || !datos.activo || datos.socios.length === 0) return null

  async function enviar(miembro: string) {
    setError(null); setEnviando(miembro)
    // la pestaña se abre YA (en el clic): si se abre después de esperar a la base, el navegador la bloquea
    const w = typeof window !== 'undefined' ? window.open('', '_blank') : null
    try {
      const m = await import('../../shared/api/club')
      const e = await m.enviarCumple(miembro)
      const link = linkCumpleWhatsApp(e, todayCR())
      if (!link) { w?.close(); setError('Ese socio no tiene un WhatsApp válido: quedó marcado como enviado; avisale por otro medio.') }
      else if (w) w.location.href = link
      else window.location.assign(link)
      setDatos(d => d && { ...d, socios: d.socios.filter(s => s.miembro_id !== miembro) })
    } catch (e) {
      w?.close()
      setError(e instanceof Error ? e.message : 'No se pudo marcar: probá de nuevo.')
    } finally { setEnviando(null) }
  }

  const n = datos.socios.length
  return (
    <section className="inicio-seccion" aria-labelledby="inicio-club-cumples">
      <h2 id="inicio-club-cumples" className="inicio-subtitulo">
        Cumpleaños en los próximos {datos.dias_antes} {datos.dias_antes === 1 ? 'día' : 'días'}: {n} {n === 1 ? 'socio' : 'socios'}
      </h2>
      <p className="inicio-vacio">Beneficio: {datos.beneficio}. Cada saludo se manda una vez por año; al tocar WhatsApp queda marcado como enviado.</p>
      {error && <p className="inicio-vacio" role="alert"><span className="pildora pildora-pendiente">error</span> {error}</p>}
      <ul className="inicio-pendientes">
        {datos.socios.map(s => (
          <li key={s.miembro_id}>
            <button type="button" className="inicio-pendiente" disabled={!s.con_whatsapp || enviando !== null}
              onClick={() => enviar(s.miembro_id)} aria-label={`Mandar saludo de cumpleaños por WhatsApp a ${s.nombre}`}>
              <span className="inicio-pendiente-texto">
                {s.nombre}
                <span className="inicio-pendiente-detalle">{s.con_whatsapp ? `Cumple ${cuandoCumple(s.faltan)}.` : 'Sin WhatsApp cargado.'}</span>
              </span>
              <span className="pildora pildora-pendiente">{enviando === s.miembro_id ? 'Abriendo…' : 'WhatsApp ↗'}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
