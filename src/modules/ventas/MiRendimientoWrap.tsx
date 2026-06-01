/**
 * Lightweight wrapper: loads only ventas_dias (last 90 days) + product_map
 * then renders MiRendimiento. Keeps the bundle separate from full VentasModule.
 */
import { useState, useEffect } from 'react'
import { getVentasDias, getProductMap } from '../../shared/api/ventas'
import type { DiasMap, ProductMap } from '../../shared/types/ventas'
import MiRendimiento from './MiRendimiento'

export default function MiRendimientoWrap() {
  const [dias, setDias] = useState<DiasMap>({})
  const [pm,   setPm]   = useState<ProductMap>({})
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getVentasDias(90), getProductMap()])
      .then(([d, p]) => { setDias(d); setPm(p) })
      .catch(e => setError(e instanceof Error ? e.message : 'Error cargando datos'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading-screen"><span className="loading-mark">人</span></div>
  if (error)   return <div style={{ padding:'2rem', color:'var(--vt-red)', textAlign:'center' }}>{error}</div>

  return <MiRendimiento dias={dias} pm={pm} />
}
