/**
 * Mig 173 (D-cumple-2, firmada por el dueño el 15-nov) · Inicio de owner y manager: «Cumpleaños en los próximos N días».
 * N = «días antes» del beneficio del local (Club → Promociones). Socios ACTIVOS que dieron su cumpleaños con permiso
 * (no hace falta el opt-in de ofertas: el beneficio es parte de su cuenta). Cada socio tiene «WhatsApp ↗»: la base marca
 * «enviado» (una vez por socio y por año del cumpleaños; queda auditado) y devuelve el número; se abre WhatsApp con el
 * saludo en «usted», el beneficio vigente y el link de reserva. Lo manda la persona a mano.
 * Si el beneficio está apagado, no hay nadie o la lectura falla (p. ej. la base sin la 173), no se muestra nada.
 * Mig 186 (backlog del Club firmado el 16-nov): el OWNER ve además «Ya saludados» (los marcados de esta ventana) y puede
 * «Deshacer enviado» con una nota obligatoria (queda auditada); el socio vuelve a la lista. El manager no lo ve. Si la
 * base no tiene la 186, esa parte no se muestra.
 */
import { useEffect, useState } from 'react'
import type { CumpleEnviado, CumpleProximos } from '../../shared/api/club'
import { todayCR } from '../../shared/utils'
import { cuandoCumple, linkCumpleWhatsApp } from './cumple'

export function CumplesInicio({ rol }: { rol: string | null | undefined }) {
  const [datos, setDatos] = useState<CumpleProximos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [enviados, setEnviados] = useState<CumpleEnviado[]>([])
  const [recarga, setRecarga] = useState(0)
  const esOwner = rol === 'owner'
  useEffect(() => {
    let vivo = true
    import('../../shared/api/club')
      .then(async m => {
        await m.asegurarLocalParaRol(rol)
        const d = await m.getCumpleProximos()
        if (vivo) setDatos(d)
        // «Ya saludados»: solo owner; sin la 186 (o con error) no se muestra
        const e = esOwner ? await m.getCumplesEnviados().catch(() => [] as CumpleEnviado[]) : []
        if (vivo) setEnviados(e)
      })
      .catch(() => { if (vivo) setDatos(null) })
    return () => { vivo = false }
  }, [rol, esOwner, recarga])
  if (!datos || !datos.activo || (datos.socios.length === 0 && enviados.length === 0)) return null

  async function deshacer(s: CumpleEnviado) {
    const nota = window.prompt(`Deshacer «enviado» del saludo a ${s.nombre}. Vuelve a la lista para mandárselo de nuevo. Motivo (queda registrado):`)
    if (nota === null) return
    setError(null); setEnviando(s.miembro_id)
    try {
      const m = await import('../../shared/api/club')
      await m.deshacerEnvioCumple(s.miembro_id, nota.trim())
      setRecarga(n => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo deshacer: probá de nuevo.')
    } finally { setEnviando(null) }
  }

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
      {esOwner && enviados.length > 0 && (
        <>
          <p className="inicio-vacio">Ya saludados ({enviados.length}). Si se marcó por error, deshacelo con un motivo:</p>
          <ul className="inicio-pendientes">
            {enviados.map(s => (
              <li key={s.miembro_id}>
                <button type="button" className="inicio-pendiente" disabled={enviando !== null}
                  onClick={() => deshacer(s)} aria-label={`Deshacer «enviado» del saludo a ${s.nombre}`}>
                  <span className="inicio-pendiente-texto">
                    {s.nombre}
                    <span className="inicio-pendiente-detalle">{`Cumple ${cuandoCumple(s.faltan)}. Saludo marcado como enviado.`}</span>
                  </span>
                  <span className="pildora pildora-pendiente">{enviando === s.miembro_id ? 'Deshaciendo…' : 'Deshacer'}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
