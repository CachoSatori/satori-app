/**
 * InvFeEmisores — Compras F1 (mig 203): la lista de emisores conocidos se arma sola mientras se revisa.
 * Cada factura «para revisar» por emisor no conocido aparece bajo su emisor (nombre y cédula del XML) con el botón
 * «Es un proveedor real · recordar» (owner y contador; la base lo valida). Al tocarlo, el emisor queda conocido y sus
 * facturas cuyo ÚNICO motivo era ése pasan a «ok»; las que tienen otro motivo (otro XML con la misma clave, respuesta
 * de Hacienda distinta…) siguen para revisar. Abajo, la lista de emisores conocidos; «Desactivar» solo para el owner.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  desactivarEmisor, getEmisoresConocidos, getEmisoresPendientes, recordarEmisor, type EmisorConocido,
} from '../../shared/api/feEmisores'
import type { EmisorPendiente } from '../../shared/fe/emisoresPendientes'
import { dateCR } from '../../shared/utils'

const PUEDEN_RECORDAR = ['owner', 'contador']

function monto(total: number | null, moneda: string): string {
  if (total == null) return '—'
  return `${moneda} ${total.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const ENVUELVE = { minWidth: 0, overflowWrap: 'anywhere' as const }

export default function InvFeEmisores({ rol, onCambio }: { rol: string; onCambio?: () => void }) {
  const [pend, setPend] = useState<EmisorPendiente[] | null>(null)
  const [conocidos, setConocidos] = useState<EmisorConocido[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const puedeRecordar = PUEDEN_RECORDAR.includes(rol)
  const esOwner = rol === 'owner'

  const cargar = useCallback(async () => {
    const [p, c] = await Promise.all([getEmisoresPendientes(), getEmisoresConocidos()])
    if (!p.ok) { setError(p.error); return }
    if (!c.ok) { setError(c.error); return }
    setError(null); setPend(p.data); setConocidos(c.data)
  }, [])
  useEffect(() => {
    let vivo = true
    void Promise.all([getEmisoresPendientes(), getEmisoresConocidos()]).then(([p, c]) => {
      if (!vivo) return
      if (!p.ok) { setError(p.error); return }
      if (!c.ok) { setError(c.error); return }
      setPend(p.data); setConocidos(c.data)
    })
    return () => { vivo = false }
  }, [])

  async function recordar(e: EmisorPendiente) {
    if (!window.confirm(`¿${e.nombre} (cédula ${e.cedula}) es un proveedor real?\n\nQueda como emisor conocido: sus facturas que estaban para revisar solo por eso pasan a «ok», y las próximas entran directo.`)) return
    setOcupado(e.cedula); setAviso(null)
    const r = await recordarEmisor(e.cedula)
    setOcupado(null)
    if (!r.ok) { setAviso(r.error); return }
    const { pasan_a_ok: ok, siguen_revisar: siguen } = r.data
    setAviso(r.data.resultado === 'ya_estaba'
      ? `${e.nombre} ya era conocido; no cambió nada.`
      : `Listo: ${e.nombre} quedó como proveedor real. ${ok} ${ok === 1 ? 'factura pasó' : 'facturas pasaron'} a «ok»`
        + (siguen ? ` · ${siguen} ${siguen === 1 ? 'sigue' : 'siguen'} para revisar por otro motivo.` : '.'))
    await cargar()
    onCambio?.()
  }

  async function desactivar(c: EmisorConocido) {
    const quien = c.nombre || c.cedula
    if (!window.confirm(`¿Desactivar a ${quien}?\n\nSus facturas nuevas vuelven a entrar «para revisar». Lo que ya está «ok» no cambia.`)) return
    setOcupado(c.cedula); setAviso(null)
    const r = await desactivarEmisor(c.cedula)
    setOcupado(null)
    if (!r.ok) { setAviso(r.error); return }
    setAviso(r.data === 'desactivar' ? `${quien} quedó desactivado.` : `${quien} ya estaba desactivado.`)
    await cargar()
  }

  if (error) return <div className="tips-error" style={{ margin: '0.75rem 0' }} data-testid="fe-emisores-error"><span>{error}</span></div>
  if (!pend || !conocidos) return <div style={{ padding: '1rem', textAlign: 'center', opacity: 0.5 }} data-testid="fe-emisores-cargando">Cargando emisores…</div>

  return (
    <div data-testid="fe-emisores">
      <div className="vt-sl">Emisores por confirmar</div>
      {aviso && <p role="status" style={{ margin: '0.25rem 0 0.75rem', fontWeight: 600 }}>{aviso}</p>}
      {pend.length === 0
        ? <p style={{ opacity: 0.7 }} data-testid="fe-emisores-vacio">No hay facturas esperando que se confirme su emisor.</p>
        : pend.map(e => (
          <div key={e.cedula} className="vt-kpi" data-testid="fe-emisor" style={{ marginBottom: '0.75rem', textAlign: 'left', ...ENVUELVE }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
              <div style={ENVUELVE}>
                <div style={{ fontWeight: 700, ...ENVUELVE }}>{e.nombre}</div>
                <div className="vt-kpi-sub">Cédula {e.cedula} · {e.comprobantes.length} {e.comprobantes.length === 1 ? 'factura' : 'facturas'}</div>
              </div>
              {puedeRecordar && (
                <button className="vt-range-btn active" style={{ whiteSpace: 'normal', maxWidth: '100%' }}
                        disabled={ocupado !== null} onClick={() => void recordar(e)}>
                  {ocupado === e.cedula ? 'Guardando…' : 'Es un proveedor real · recordar'}
                </button>
              )}
            </div>
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', fontSize: '0.85rem', ...ENVUELVE }}>
              {e.comprobantes.map(c => (
                <li key={c.clave} style={ENVUELVE}>
                  {c.fecha ? dateCR(c.fecha) : 'sin fecha'} · {monto(c.total, c.moneda)} · clave …{c.fin_clave}
                  {c.otros_motivos.length > 0 && (
                    <span style={{ display: 'block', opacity: 0.75 }}>Sigue para revisar aunque lo recordés: {c.otros_motivos.join(' · ')}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}

      <div className="vt-sl">Emisores conocidos ({conocidos.filter(c => c.activo).length} activos)</div>
      {conocidos.length === 0
        ? <p style={{ opacity: 0.7 }}>Todavía no hay ninguno: se arma solo al confirmar los de arriba.</p>
        : (
          <div className="vt-tbl-wrap">
            <table className="vt-tbl">
              <thead><tr><th>Emisor</th><th>Cédula</th><th>Desde</th><th>Estado</th>{esOwner && <th />}</tr></thead>
              <tbody>
                {conocidos.map(c => (
                  <tr key={c.cedula} data-testid="fe-conocido">
                    <td style={ENVUELVE}>{c.nombre || '—'}</td>
                    <td>{c.cedula}</td>
                    <td>{c.aprobado_en ? dateCR(c.aprobado_en) : c.origen === 'manual' ? 'carga manual' : '—'}</td>
                    <td>{c.activo ? 'Activo' : 'Desactivado'}</td>
                    {esOwner && (
                      <td>
                        {c.activo && (
                          <button className="vt-range-btn" disabled={ocupado !== null} onClick={() => void desactivar(c)}>Desactivar</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
