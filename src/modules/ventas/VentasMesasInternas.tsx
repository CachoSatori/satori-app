// Ventas → Ajustes → «Mesas internas» (mig 193). El owner agrega y quita; el manager la ve.
import { useEffect, useState } from 'react'
import { useAuth } from '../../shared/hooks/useAuth'
import { getLocalesVentas, type LocalVentas } from './resumenV2Datos'
import { LOCAL_POR_DEFECTO } from './ventasDiasDesdePos'
import { agregarMesaInterna, listarMesasInternas, normalizarMesa, quitarMesaInterna } from './mesasInternas'

export default function VentasMesasInternas() {
  const { profile } = useAuth()
  const role = profile?.role ?? ''
  const edita = role === 'owner'
  const [locales, setLocales] = useState<LocalVentas[]>([])
  const [local, setLocal] = useState<string>(LOCAL_POR_DEFECTO)
  const [mesas, setMesas] = useState<string[] | null>(null)
  const [nueva, setNueva] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    let vivo = true
    getLocalesVentas(role).then(l => {
      if (!vivo) return
      setLocales(l)
      if (l.length && !l.some(x => x.id === local)) setLocal(l[0].id)
    }).catch(() => {})
    return () => { vivo = false }
  }, [role]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let vivo = true
    listarMesasInternas(local)
      .then(m => { if (vivo) { setMesas(m); setError(null) } })
      .catch(e => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo leer la lista') })
    return () => { vivo = false }
  }, [local, recarga])

  const agregar = async () => {
    const m = normalizarMesa(nueva)
    if (!m) { setError('Escribí solo el número de la mesa (por ejemplo 51).'); return }
    try { await agregarMesaInterna(local, m); setNueva(''); setRecarga(x => x + 1) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo agregar') }
  }
  const quitar = async (m: string) => {
    try { await quitarMesaInterna(local, m); setRecarga(x => x + 1) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo quitar') }
  }

  return (
    <div className="vt-section">
      <div className="vt-sl">Mesas internas</div>
      <p className="vt2-nota">
        Mesas de uso interno (dueños, regalías, errores). Sus facturas son venta y cuentan en todo: Contabilidad, el
        Resumen, la venta por persona, la meta y «Tiempos». Esta lista sirve para dos cosas: que no aparezcan en la
        alerta de mesas sin pax (en esas mesas no se cargan personas) y que no entren en el tiempo sentado.
      </p>
      {locales.length > 1 && (
        <label className="vt2-campo"><span>Local</span>
          <select className="date-filter" aria-label="Local" value={local} onChange={e => setLocal(e.target.value)}>
            {locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </label>
      )}
      {error && <div className="vt2-aviso" role="alert">{error}</div>}
      {mesas === null ? <div className="vt2-cargando" role="status">Leyendo…</div> : (
        <ul aria-label="Mesas internas" data-lista="mesas-internas">
          {mesas.length === 0 && <li>Ninguna: todas las mesas entran en la alerta de pax y en el tiempo sentado.</li>}
          {mesas.map(m => (
            <li key={m}>
              Mesa {m}
              {edita && <button type="button" className="vt-period-btn" aria-label={`Quitar mesa ${m}`} onClick={() => quitar(m)}>Quitar</button>}
            </li>
          ))}
        </ul>
      )}
      {edita ? (
        <div className="vt2-barra-fila">
          <label className="vt2-campo"><span>Mesa</span>
            <input className="date-filter" aria-label="Mesa nueva" value={nueva} inputMode="numeric" onChange={e => setNueva(e.target.value)} />
          </label>
          <button type="button" className="vt-period-btn active" onClick={agregar}>Agregar</button>
        </div>
      ) : <p className="vt2-nota">Solo el owner cambia esta lista.</p>}
    </div>
  )
}
