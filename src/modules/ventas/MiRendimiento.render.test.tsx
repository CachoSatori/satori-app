// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addDays } from './miRendimientoUtils'
import { todayCR } from '../../shared/utils'
import type { DiasMap, SaloneroDay, ProductMap, ProductInfo, Meta, Comp } from '../../shared/types/ventas'
import type { Employee } from '../../shared/types/database'
import type { AttendanceRow } from '../../shared/api/tips'

// useAuth mutable vía vi.hoisted → permite cambiar el perfil entre tests.
const H = vi.hoisted(() => ({ profile: null as unknown }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: H.profile }) }))

import MiRendimiento from './MiRendimiento'

// ── Fixtures ──────────────────────────────────────────────────
function sal(o: Partial<SaloneroDay>): SaloneroDay {
  return { pax:0,total:0,com:0,beb:0,iCom:0,iBeb:0,iva:0,serv:0,promPax:0,promPlato:0,promBebida:0,ratioCB:0,ratioU:0,bebPax:0,prods:[],...o }
}
function dia(saloneros: Record<string, SaloneroDay>): DiasMap[string] {
  return { fileName:'x.xls', uploadedAt:'2026-01-01', saloneros }
}
function pinfo(tipo: string): ProductInfo {
  return { tipo, clasificacion:'', subclasificacion:'', multiplicador:1, costo_unitario:0 }
}

const today = todayCR()
const d0 = today
const d1 = addDays(today, -2)
const d2 = addDays(today, -9)

const DIAS: DiasMap = {
  [d0]: dia({
    ANA:  sal({ pax:10, total:100000, com:60000,  beb:20000, iCom:30, iBeb:10, prods:[['Sushi Roll',5,50000],['Cerveza',10,20000]] }),
    BETO: sal({ pax:8,  total:60000,  com:40000,  beb:15000, iCom:20, iBeb:8,  prods:[['Sushi Roll',3,30000]] }),
  }),
  [d1]: dia({
    ANA:  sal({ pax:20, total:200000, com:120000, beb:40000, iCom:60, iBeb:20, prods:[['Sushi Roll',8,80000]] }),
  }),
  // Día null-safe: salonero sin pax/prods (campos faltantes → NULL desde base vieja)
  [d2]: dia({ ANA: sal({ total:50000 }) }),
}
const PM: ProductMap = { 'Sushi Roll': pinfo('comida'), 'Cerveza': pinfo('bebida') }
const METAS: Meta = { restaurante:{}, margen:{}, global:{ promPax:12000, bebPax:1.0, ratioCB:3.0, ticketItem:6000, ventas:150000 }, salMetas:{} }
const COMPS: Comp[] = [
  { id:'c1', nombre:'Reto Sushi', tipo:'semanal', inicio:d2, fin:d0, premio:'Cena', prods:[{ name:'Sushi Roll', pts:2 }], parts:['ANA','BETO'] },
]
const EMP = { id:'e1', full_name:'ANA', role:'salonero' } as unknown as Employee
// Asistencia: filas mías (una con payout NULL → null-safe) + fila de otro empleado (benchmark equipo)
const ATT: AttendanceRow[] = [
  { session_date:d0, shift_type:'PM', employee_id:'e1', hours_worked:8, payout_crc:15000, points:10 },
  { session_date:d1, shift_type:'PM', employee_id:'e1', hours_worked:6, payout_crc:null,  points:8 },
  { session_date:d0, shift_type:'PM', employee_id:'e2', hours_worked:8, payout_crc:12000, points:10 },
]

function renderHub(props?: Partial<React.ComponentProps<typeof MiRendimiento>>) {
  return render(
    <MemoryRouter initialEntries={['/mi-rendimiento']}>
      <MiRendimiento
        dias={DIAS} pm={PM} metas={METAS} comps={COMPS}
        employee={EMP} attendance={ATT} noLink={false}
        {...props}
      />
    </MemoryRouter>,
  )
}

const tabsOf = (c: HTMLElement) => Array.from(c.querySelectorAll('.cd-nav-tab')) as HTMLElement[]

describe('MiRendimiento · render (salonero con match)', () => {
  beforeEach(() => { H.profile = { id:'u1', role:'salonero', full_name:'ANA' } })

  it('monta el hub y muestra header + 6 pestañas', () => {
    const { container, getAllByText } = renderHub()
    expect(getAllByText(/Mi Rendimiento/).length).toBeGreaterThan(0)
    expect(tabsOf(container)).toHaveLength(6)
  })

  it('recorre TODAS las pestañas sin reventar (incluye fixtures null-safe)', () => {
    const { container } = renderHub()
    const tabs = tabsOf(container)
    expect(() => {
      for (const t of tabs) fireEvent.click(t)
    }).not.toThrow()
  })

  it('Resumen muestra KPIs de ventas', () => {
    const { container, getByText } = renderHub()
    fireEvent.click(tabsOf(container)[0])
    expect(getByText('Ventas')).toBeTruthy()
    expect(getByText('Prom/PAX')).toBeTruthy()
  })

  it('Por día muestra la comparación yo-vs-restaurante', () => {
    const { container, getByText } = renderHub()
    fireEvent.click(tabsOf(container)[1])
    expect(getByText(/Yo vs restaurante/)).toBeTruthy()
  })

  it('Productos separa Comidas / Bebidas con toggle ₡/uds', () => {
    const { container, getByText, getAllByText } = renderHub()
    fireEvent.click(tabsOf(container)[2])
    expect(getByText('Comidas')).toBeTruthy()
    expect(getByText('Bebidas')).toBeTruthy()
    // toggle a unidades no revienta
    expect(() => fireEvent.click(getByText(/Unidades/))).not.toThrow()
    expect(getAllByText(/Sushi Roll/).length).toBeGreaterThan(0)
  })

  it('Propinas muestra ICP + benchmark del equipo y navega meses', () => {
    const { container, getByText, getAllByText } = renderHub()
    fireEvent.click(tabsOf(container)[4])
    expect(getAllByText(/ICP/).length).toBeGreaterThan(0)
    expect(getByText(/Equipo \(benchmark\)/)).toBeTruthy()
    expect(() => fireEvent.click(getByText(/Mes ant\./))).not.toThrow()
  })

  it('Competencias lista la competencia del empleado', () => {
    const { container, getByText } = renderHub()
    fireEvent.click(tabsOf(container)[5])
    expect(getByText('Reto Sushi')).toBeTruthy()
  })
})

describe('MiRendimiento · rol propinas-primero (cocina, sin match de ventas)', () => {
  beforeEach(() => { H.profile = { id:'u9', role:'cocina', full_name:'ZZZ NoMatch' } })

  it('arranca en Propinas y las sub-vistas de ventas invitan a ir a propinas', () => {
    const { container, getAllByText, getByText } = renderHub()
    // Sin match: la pestaña Propinas es la activa por defecto → muestra totales de propinas
    expect(getAllByText(/Total cobrado/).length).toBeGreaterThan(0)
    // Ir a Resumen (ventas) → estado que empuja a propinas, sin romper
    expect(() => fireEvent.click(tabsOf(container)[0])).not.toThrow()
    expect(getByText(/Tu rol trabaja con propinas/)).toBeTruthy()
  })
})

describe('MiRendimiento · perfil no vinculado', () => {
  beforeEach(() => { H.profile = { id:'u0', role:'runner', full_name:'Sin Empleado' } })

  it('sin ventas ni empleado → aviso de perfil no vinculado (no revienta)', () => {
    const { getByText } = render(
      <MemoryRouter>
        <MiRendimiento dias={{}} pm={{}} metas={METAS} comps={[]} employee={null} attendance={[]} noLink={true} />
      </MemoryRouter>,
    )
    expect(getByText(/Perfil no vinculado/)).toBeTruthy()
  })
})
