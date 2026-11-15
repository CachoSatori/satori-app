/**
 * D7 (#2, firma del dueño 14-nov; mig 157) · Ranking del equipo: por persona del equipo y mes, cupones usados, personas,
 * mesas, facturas y venta respaldada (facturas cerradas del PoS que cruzan con esas visitas) y altas de socios que se
 * anotaron con su link. Solo owner y manager (la base lo exige y deja rastro). El equipo no acumula créditos: el ranking
 * es lo que decide los premios de desempeño, por eso los controles del PoS siguen iguales.
 */
import { useEffect, useState } from 'react'
import { getReporteEquipo, aClubError, type FilaEquipo } from '../../shared/api/club'
import { Aviso, Card } from './ui'
import { C } from './estilos'

const n0 = (n: number) => Number(n ?? 0).toLocaleString('de-DE', { maximumFractionDigits: 0 })

export default function RankingEquipo({ mes, local }: { mes: string; local: string | null }) {
  const [filas, setFilas] = useState<FilaEquipo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilas(null); setError(null)
    getReporteEquipo(`${mes}-01`, local)
      .then(f => { if (vivo) setFilas(f) })
      .catch(e => { if (vivo) setError(aClubError(e).message) })
    return () => { vivo = false }
  }, [mes, local])
  const tot = (k: keyof FilaEquipo) => (filas ?? []).reduce((s, f) => s + Number(f[k] ?? 0), 0)
  return (
    <Card>
      <h3 style={{ margin: '0 0 6px', fontSize: '1rem' }}>Ranking del equipo</h3>
      <div style={{ fontSize: '0.8rem', color: C.muted, marginBottom: 8 }}>
        El equipo no acumula créditos: suma personas con sus cupones. «Venta respaldada» son las facturas cerradas del PoS que
        cruzan con esas mesas (cada factura una vez). «Altas» son los socios que se anotaron con su link en el mes.
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}
      {filas === null && !error ? <div style={{ color: C.muted }}>Cargando…</div> : filas && filas.length === 0 ? (
        <div style={{ color: C.muted }}>Sin cuentas del equipo en este local.</div>
      ) : filas && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead><tr style={{ textAlign: 'left', color: C.muted }}>
              <th>#</th><th>Persona</th><th>Cupones usados</th><th>Personas</th><th>Mesas</th><th>Venta respaldada</th><th>Altas de socios</th>
            </tr></thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={f.miembro_id} style={{ borderTop: `1px solid ${C.panel}`, color: f.estado !== 'activo' ? C.muted : undefined }}>
                  <td>{i + 1}</td><td>{f.nombre}{f.estado !== 'activo' ? ' (baja)' : ''}</td>
                  <td>{n0(f.cupones_usados)}</td><td>{n0(f.personas)}</td><td>{n0(f.mesas)}</td>
                  <td>₡{n0(f.venta_respaldada_crc)}{f.facturas ? <span style={{ color: C.muted }}> · {n0(f.facturas)} fact.</span> : null}</td>
                  <td>{n0(f.altas_socios)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: `2px solid ${C.panel}`, fontWeight: 700 }}>
                <td /><td>Total</td><td>{n0(tot('cupones_usados'))}</td><td>{n0(tot('personas'))}</td><td>{n0(tot('mesas'))}</td>
                <td>₡{n0(tot('venta_respaldada_crc'))}</td><td>{n0(tot('altas_socios'))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
