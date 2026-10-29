/**
 * Wrapper de datos de Mi Rendimiento ("casa del empleado").
 * Carga en paralelo:
 *   - Ventas (365d según FUENTE_VENTAS, como el módulo Ventas + product_map + metas + comps)
 *   - Propinas (empleado vinculado + historial de asistencia 12m) para la pestaña Propinas
 * Mantiene el bundle separado del VentasModule completo.
 *
 * «Ver como» (firmado por Ismael, 2026-10-29): SOLO el OWNER puede elegir a otro empleado
 * (`?empleado=<id>`), en solo lectura. Cualquier otro rol —manager incluido— ve SOLO su propio
 * rendimiento: el parámetro se ignora y no se ofrece el selector. No cambia permisos ni RLS:
 * el owner ya lee empleados, propinas y ventas de todos.
 */
import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getProductMap, getMetas, getComps } from '../../shared/api/ventas'
import { cargarDias } from './ventasFuente'
import { fusionarProductMap } from './ventasUtils'
import { getAttendanceHistory } from '../../shared/api/tips'
import { getAllEmployees, getEmployeeByProfileId } from '../../shared/api/admin'
import { useAuth } from '../../shared/hooks/useAuth'
import type { DiasMap, ProductMap, Meta, Comp } from '../../shared/types/ventas'
import type { Employee } from '../../shared/types/database'
import type { AttendanceRow } from '../../shared/api/tips'
import MiRendimiento from './MiRendimiento'

/** El parámetro de «Ver como». Solo lo lee el owner. */
export const PARAM_VER_COMO = 'empleado'

export default function MiRendimientoWrap() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const esOwner  = profile?.role === 'owner'
  // Para cualquier rol que no sea owner, el parámetro NO existe.
  const verComoId = esOwner ? params.get(PARAM_VER_COMO) : null

  const [dias,  setDias]  = useState<DiasMap>({})
  const [pm,    setPm]    = useState<ProductMap>({})
  const [metas, setMetas] = useState<Meta>({ restaurante:{}, margen:{}, global:{ promPax:15000, bebPax:1.2, ratioCB:3.0, ticketItem:7500, ventas:800000 }, salMetas:{} })
  const [comps, setComps] = useState<Comp[]>([])
  const [employee,   setEmployee]   = useState<Employee | null>(null)
  const [empleados,  setEmpleados]  = useState<Employee[]>([])
  const [attendance, setAttendance] = useState<AttendanceRow[]>([])
  const [noLink,     setNoLink]     = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    // Ventas: no bloquean la vista si fallan (un empleado de cocina igual ve propinas).
    // Los días salen de la MISMA carga que el módulo Ventas (`FUENTE_VENTAS`), y el `pm` con la
    // misma fusión curado + familia. En 'xls' es `getVentasDias(365)` y el curado tal cual.
    const ventasP = Promise.all([cargarDias(365), getProductMap(), getMetas(), getComps()])
      .then(([d, p, m, c]) => {
        if (!alive) return
        setDias(d.dias); setPm(fusionarProductMap(p, d.pm)); setMetas(m); setComps(c)
      })
      .catch(() => { /* ventas opcionales para roles sin venta individual */ })

    // Propinas: empleado vinculado (o el elegido por el owner) + su historial (getAttendanceHistory
    // trae TODAS las filas → sirve para el benchmark del equipo). Null-safe si no hay perfil.
    const propinasP = (async () => {
      if (!profile) { setNoLink(true); return }
      try {
        let emp: Employee | null
        if (esOwner) {
          const todos = await getAllEmployees()
          if (!alive) return
          setEmpleados(todos)
          emp = verComoId
            ? todos.find(e => e.id === verComoId) ?? null
            : await getEmployeeByProfileId(profile.id)
        } else {
          emp = await getEmployeeByProfileId(profile.id)
        }
        if (!alive) return
        setEmployee(emp)
        setNoLink(!emp)
        if (!emp) return
        const rows = await getAttendanceHistory(12)
        if (alive) setAttendance(rows)
      } catch { if (alive) setNoLink(true) }
    })()

    Promise.allSettled([ventasP, propinasP]).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [profile, esOwner, verComoId])

  // El selector: activos primero, después por nombre.
  const opciones = useMemo(
    () => [...empleados].sort((a, b) =>
      Number(b.is_active) - Number(a.is_active) || a.full_name.localeCompare(b.full_name)),
    [empleados],
  )

  const elegir = (id: string) => {
    const p = new URLSearchParams(params)
    if (id) p.set(PARAM_VER_COMO, id)
    else p.delete(PARAM_VER_COMO)
    setParams(p, { replace: true })
  }

  if (loading) return <div className="module-loading"><span className="loading-mark">人</span></div>

  const verComo = esOwner && verComoId !== null && employee !== null

  return (
    <>
      {esOwner && (
        <div className="vt-period-picker" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', margin: '0.75rem 1rem 0' }}>
          <label htmlFor="mr-ver-como" style={{ fontSize: '0.8rem' }}>Ver como</label>
          <select
            id="mr-ver-como"
            className={`date-filter ${verComoId ? 'active' : ''}`}
            value={verComoId ?? ''}
            onChange={e => elegir(e.target.value)}
          >
            <option value="">— mi propio perfil —</option>
            {opciones.map(e => (
              <option key={e.id} value={e.id}>
                {e.full_name}{e.is_active ? '' : ' (inactivo)'}
              </option>
            ))}
          </select>
          {verComo && (
            <span role="status" style={{ fontSize: '0.75rem', fontWeight: 600 }}>
              Viendo como {employee?.full_name} · solo lectura
            </span>
          )}
        </div>
      )}
      <MiRendimiento
        dias={dias} pm={pm} metas={metas} comps={comps}
        employee={employee} attendance={attendance} noLink={noLink}
        verComo={verComo}
      />
    </>
  )
}
