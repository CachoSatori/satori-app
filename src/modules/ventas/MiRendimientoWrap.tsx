/**
 * Lightweight wrapper: loads ventas_dias (90d) + product_map + metas + comps
 * Keeps the bundle separate from full VentasModule.
 */
import { useState, useEffect } from 'react'
import { getVentasDias, getProductMap, getMetas, getComps } from '../../shared/api/ventas'
import type { DiasMap, ProductMap, Meta, Comp } from '../../shared/types/ventas'
import MiRendimiento from './MiRendimiento'

export default function MiRendimientoWrap() {
  const [dias,  setDias]  = useState<DiasMap>({})
  const [pm,    setPm]    = useState<ProductMap>({})
  const [metas, setMetas] = useState<Meta>({ restaurante:{}, margen:{}, global:{ promPax:15000, bebPax:1.2, ratioCB:3.0, ticketItem:7500, ventas:800000 }, salMetas:{} })
  const [comps, setComps] = useState<Comp[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getVentasDias(90), getProductMap(), getMetas(), getComps()])
      .then(([d, p, m, c]) => { setDias(d); setPm(p); setMetas(m); setComps(c) })
      .catch(e => setError(e instanceof Error ? e.message : 'Error cargando datos'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading-screen"><span className="loading-mark">人</span></div>
  if (error)   return <div style={{ padding:'2rem', color:'var(--vt-red)', textAlign:'center' }}>{error}</div>

  return <MiRendimiento dias={dias} pm={pm} metas={metas} comps={comps} />
}
