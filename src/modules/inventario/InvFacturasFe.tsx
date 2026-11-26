/**
 * InvFacturasFe — Compras F1: pantalla de control de la ingesta de facturas electrónicas (owner y contador).
 * Solo lectura (mig 199, `fe_ingesta_resumen`). Responde tres preguntas: ¿el script del correo está corriendo?,
 * ¿cuántas facturas entraron por día?, ¿qué quedó para revisar o con error?
 * No toca la Bandeja ni la Caja. Spec: docs/inventario/SPEC-compras-stock-costos.md §4.5 y §9.
 */
import { useCallback, useEffect, useState } from 'react'
import { getResumenIngesta } from '../../shared/api/feIngesta'
import { haceCuanto, type ResumenIngesta } from '../../shared/fe/resumenIngesta'
import { dateCR, horaCR, todayCR } from '../../shared/utils'

const MOTIVO_ESTADO: Record<string, string> = {
  receptor_distinto: 'Receptor distinto',
  revisar: 'Para revisar',
  respuesta_revisar: 'Respuesta de Hacienda', // mig 201: respuesta en conflicto que todavía no tiene su factura
}

export default function InvFacturasFe() {
  const [resumen, setResumen] = useState<ResumenIngesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const aplicar = useCallback((r: Awaited<ReturnType<typeof getResumenIngesta>>) => {
    if (r.ok) { setResumen(r.resumen); setError(null) } else setError(r.error)
    setCargando(false)
  }, [])
  const cargar = useCallback(() => {
    setCargando(true)
    void getResumenIngesta(14).then(aplicar)
  }, [aplicar])
  useEffect(() => {
    let vivo = true
    void getResumenIngesta(14).then(r => { if (vivo) aplicar(r) })
    return () => { vivo = false }
  }, [aplicar])

  if (cargando && !resumen) return <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}>Cargando…</div>
  if (error) return <div className="tips-error" style={{ margin: '0.75rem 0' }}><span>{error}</span></div>
  if (!resumen) return null

  const ahora = new Date()
  const hoy = resumen.dias.find(d => d.dia === todayCR())
  const ultima = haceCuanto(resumen.ultima, ahora)
  const totalRevisar = resumen.revisar.reduce((a, r) => a + r.n, 0)

  return (
    <div className="vt-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div className="vt-sl" style={{ margin: 0 }}>📨 Facturas electrónicas · ingesta del correo</div>
        <button className="vt-range-btn" onClick={cargar} disabled={cargando}>Actualizar</button>
      </div>

      <div className="vt-kpi-grid" style={{ margin: '1rem 0' }}>
        <div className={`vt-kpi${ultima.alerta ? ' red' : ''}`} data-testid="fe-ultima">
          <div className="vt-kpi-label">Última ingesta</div>
          <div className="vt-kpi-val">{ultima.texto}</div>
          <div className="vt-kpi-sub">{ultima.alerta ? 'Revisar el script del correo' : 'Al día'}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Hoy</div>
          <div className="vt-kpi-val">{hoy?.nuevo ?? 0} nuevas</div>
          <div className="vt-kpi-sub">
            {hoy?.duplicado ?? 0} duplicadas · {hoy?.error ?? 0} con error · {hoy?.sin_xml ?? 0} correos sin XML
          </div>
        </div>
        <div className={`vt-kpi${totalRevisar ? ' red' : ''}`}>
          <div className="vt-kpi-label">Para revisar (14 días)</div>
          <div className="vt-kpi-val">{totalRevisar}</div>
          <div className="vt-kpi-sub">Lo dudoso no se descarta: queda acá</div>
        </div>
      </div>

      <div className="vt-sl">Cuentas de correo</div>
      {resumen.latidos.length === 0
        ? <p style={{ opacity: 0.7 }}>Todavía no corrió ningún script.</p>
        : (
          <div className="vt-tbl-wrap">
            <table className="vt-tbl">
              <thead><tr><th>Cuenta</th><th>Última corrida</th></tr></thead>
              <tbody>
                {resumen.latidos.map(l => {
                  const h = haceCuanto(l.ultimo_en, ahora)
                  return (
                    <tr key={l.fuente}>
                      <td>{l.fuente}</td>
                      <td style={h.alerta ? { color: 'var(--c-laca)', fontWeight: 600 } : undefined}>{h.texto}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      {resumen.revisar.length > 0 && (
        <>
          <div className="vt-sl">Para revisar</div>
          <div className="vt-tbl-wrap">
            <table className="vt-tbl">
              <thead><tr><th>Estado</th><th>Motivo</th><th className="r">Cantidad</th></tr></thead>
              <tbody>
                {resumen.revisar.map((r, i) => (
                  <tr key={i}><td>{MOTIVO_ESTADO[r.estado] ?? r.estado}</td><td>{r.motivo || '—'}</td><td className="r">{r.n}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="vt-sl">Por día</div>
      {resumen.dias.length === 0
        ? <p style={{ opacity: 0.7 }}>Sin actividad en los últimos 14 días.</p>
        : (
          <div className="vt-tbl-wrap">
            <table className="vt-tbl">
              <thead>
                <tr><th>Día</th><th className="r">Nuevas</th><th className="r">Duplicadas</th><th className="r">Revisar</th>
                  <th className="r">No comprobante</th><th className="r">Sin XML</th><th className="r">Error</th></tr>
              </thead>
              <tbody>
                {resumen.dias.map(d => (
                  <tr key={d.dia}>
                    <td>{d.dia}</td><td className="r">{d.nuevo}</td><td className="r">{d.duplicado}</td><td className="r">{d.revisar}</td>
                    <td className="r">{d.no_comprobante}</td><td className="r">{d.sin_xml}</td>
                    <td className="r" style={d.error ? { color: 'var(--c-laca)', fontWeight: 600 } : undefined}>{d.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {resumen.errores.length > 0 && (
        <>
          <div className="vt-sl">Últimos errores</div>
          <div className="vt-tbl-wrap">
            <table className="vt-tbl">
              <thead><tr><th>Cuándo</th><th>Qué</th><th>Motivo</th><th>Clave (final)</th></tr></thead>
              <tbody>
                {resumen.errores.map((e, i) => (
                  <tr key={i}>
                    <td>{dateCR(e.ts)} {horaCR(e.ts)}</td>
                    <td>{e.resultado === 'error' ? 'Error' : 'No es comprobante'}</td>
                    <td>{e.motivo ?? '—'}</td>
                    <td>{e.fin_clave ? `…${e.fin_clave}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
