/**
 * Wrapper de datos de Mi Rendimiento ("casa del empleado").
 * Carga en paralelo:
 *   - Ventas (ventas_dias 365d + product_map + metas + comps) para las sub-vistas de ventas
 *   - Propinas (empleado vinculado + historial de asistencia 12m) para la pestaña Propinas
 * Mantiene el bundle separado del VentasModule completo.
 */
import { useState, useEffect } from 'react'
import { getVentasDias, getProductMap, getMetas, getComps } from '../../shared/api/ventas'
import { getAttendanceHistory } from '../../shared/api/tips'
import { getEmployeeByProfileId } from '../../shared/api/admin'
import { useAuth } from '../../shared/hooks/useAuth'
import type { DiasMap, ProductMap, Meta, Comp } from '../../shared/types/ventas'
import type { Employee } from '../../shared/types/database'
import type { AttendanceRow } from '../../shared/api/tips'
import MiRendimiento from './MiRendimiento'

export default function MiRendimientoWrap() {
  const { profile } = useAuth()
  const [dias,  setDias]  = useState<DiasMap>({})
  const [pm,    setPm]    = useState<ProductMap>({})
  const [metas, setMetas] = useState<Meta>({ restaurante:{}, margen:{}, global:{ promPax:15000, bebPax:1.2, ratioCB:3.0, ticketItem:7500, ventas:800000 }, salMetas:{} })
  const [comps, setComps] = useState<Comp[]>([])
  const [employee,   setEmployee]   = useState<Employee | null>(null)
  const [attendance, setAttendance] = useState<AttendanceRow[]>([])
  const [noLink,     setNoLink]     = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    // Ventas: no bloquean la vista si fallan (un empleado de cocina igual ve propinas).
    const ventasP = Promise.all([getVentasDias(365), getProductMap(), getMetas(), getComps()])
      .then(([d, p, m, c]) => { if (!alive) return; setDias(d); setPm(p); setMetas(m); setComps(c) })
      .catch(() => { /* ventas opcionales para roles sin venta individual */ })

    // Propinas: empleado vinculado + su historial (getAttendanceHistory trae TODAS
    // las filas → sirve para el benchmark del equipo). Null-safe si no hay perfil.
    const propinasP = (async () => {
      if (!profile) { setNoLink(true); return }
      try {
        const emp = await getEmployeeByProfileId(profile.id)
        if (!alive) return
        if (!emp) { setNoLink(true); return }
        setEmployee(emp)
        const rows = await getAttendanceHistory(12)
        if (alive) setAttendance(rows)
      } catch { if (alive) setNoLink(true) }
    })()

    Promise.allSettled([ventasP, propinasP]).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [profile])

  if (loading) return <div className="module-loading"><span className="loading-mark">人</span></div>

  return (
    <MiRendimiento
      dias={dias} pm={pm} metas={metas} comps={comps}
      employee={employee} attendance={attendance} noLink={noLink}
    />
  )
}
