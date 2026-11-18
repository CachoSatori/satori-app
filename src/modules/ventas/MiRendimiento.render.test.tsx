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
const H = vi.hoisted(() => ({ profile: null as unknown, equipo: null as unknown, comp: null as unknown,
                              llamadas: [] as string[][] }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: H.profile }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
// Mig 194: las comparaciones del personal vienen agregadas de la base. Acá se simula lo que devuelve.
vi.mock('../../shared/api/rendimientoEquipo', () => ({
  getEquipoAgregado: (local: string, desde: string, hasta: string) => { H.llamadas.push([local, desde, hasta]); return Promise.resolve(H.equipo) },
  getMiCompetencia: () => Promise.resolve(H.comp),
}))

import MiRendimiento from './MiRendimiento'
import { _vaciarCacheEquipo } from './useEquipoAgregado'

/** Lo que devuelve la 194 con 5 personas (ficticio). Solo agregados: ni nombres ni ventas de otros. */
const EQUIPO_OK = {
  desde: '2026-01-01', hasta: '2026-01-31', k_min: 4, yo: true, personas: 5, motivo: null,
  ranking: { posicion: 2, de: 5 },
  general: { prom_pax: 9000, pax: 120, comida_pax: 2.5, beb_pax: 0.9, prom_ticket: 3100 },
  equipo: { de: 5,
    mediana:  { prom_pax: 9500, beb_pax: 0.8, comida_pax: 2.4, prom_ticket: 3000, pax_dia: 12.0 },
    promedio: { prom_pax: 9800, beb_pax: 0.85, comida_pax: 2.5, prom_ticket: 3050, pax_dia: 11.5 },
    mi_posicion: { prom_pax: 1, beb_pax: 3, comida_pax: 2, prom_ticket: 4, pax_dia: 2, ventas: 2 } },
  por_dow: [0, 1, 2, 3, 4, 5, 6].map(dow => ({ dow, prom_pax: 8800 })),
  icp_equipo: 3.4,
}
const EQUIPO_CHICO = { ...EQUIPO_OK, personas: 2, motivo: 'grupo_chico', ranking: { posicion: 1, de: 2 },
  general: null, equipo: null, icp_equipo: null, por_dow: [0, 1, 2, 3, 4, 5, 6].map(dow => ({ dow, prom_pax: null })) }
const COMP_OK = { participa: true, motivo: null, de: 4, posicion: 2, mis_puntos: 26, lider_puntos: 40, mediana_puntos: 20, sin_resolver: 0 }

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
// Asistencia: propina COBRADA (payout, take-home) + propina electrónica GENERADA (tip_amount_*).
// Fila mía con USD (×TC), fila mía null-safe (tip_amount NULL) y fila de otro empleado (benchmark equipo).
const ATT: AttendanceRow[] = [
  { session_date:d0, shift_type:'PM', employee_id:'e1', hours_worked:8, payout_crc:15000, points:10, tip_amount_crc:8000, tip_amount_usd:5,    exchange_rate:520 },
  { session_date:d1, shift_type:'PM', employee_id:'e1', hours_worked:6, payout_crc:null,  points:8,  tip_amount_crc:null, tip_amount_usd:null, exchange_rate:520 },
  { session_date:d0, shift_type:'PM', employee_id:'e2', hours_worked:8, payout_crc:12000, points:10, tip_amount_crc:6000, tip_amount_usd:0,    exchange_rate:520 },
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
const TAB = { evolucion: 0, resumen: 1, dia: 2, productos: 3, semana: 4, propinas: 5, competencias: 6 } as const

beforeEach(() => { _vaciarCacheEquipo(); H.llamadas = []; H.equipo = EQUIPO_OK; H.comp = COMP_OK })

describe('MiRendimiento · render (salonero con match)', () => {
  beforeEach(() => { H.profile = { id:'u1', role:'salonero', full_name:'ANA' } })

  it('monta el hub, arranca en «Mi evolución» y muestra 7 pestañas', async () => {
    const { container, getAllByText, findByText } = renderHub()
    expect(getAllByText(/Mi Rendimiento/).length).toBeGreaterThan(0)
    expect(tabsOf(container)).toHaveLength(7)
    expect(tabsOf(container)[TAB.evolucion].className).toContain('active')
    expect(await findByText('Esta semana vs la semana pasada')).toBeTruthy()
    expect(await findByText('Este mes vs el mes pasado')).toBeTruthy()
    expect(await findByText('Últimas 12 semanas')).toBeTruthy()
  })

  it('Mi evolución: «Tu lugar en el equipo» con posiciones y mediana, sin nombres de otros', async () => {
    const { findByTestId, getByTestId, queryByText } = renderHub()
    expect((await findByTestId('evo-ranking')).textContent).toContain('2.º de 5')
    expect(getByTestId('evo-equipo').textContent).toContain('1.º de 5')   // venta por persona
    expect(getByTestId('evo-equipo').textContent).toContain('₡9.500')     // mediana
    expect(queryByText('BETO')).toBeNull()
  })

  it('recorre TODAS las pestañas sin reventar (incluye fixtures null-safe)', () => {
    const { container } = renderHub()
    expect(() => { for (const t of tabsOf(container)) fireEvent.click(t) }).not.toThrow()
  })

  it('Resumen muestra KPIs de unidades/promedios (sin Ventas ₡)', () => {
    const { container, getByText, queryByText } = renderHub()
    fireEvent.click(tabsOf(container)[TAB.resumen])
    expect(getByText('Prom/PAX')).toBeTruthy()
    expect(getByText('Comida/PAX (uds)')).toBeTruthy()
    expect(getByText('Bebida/PAX (uds)')).toBeTruthy()
    expect(queryByText('Ventas')).toBeNull()   // el empleado ya no ve ventas ₡ del local
  })

  // Mig 194: el ranking y «vs general» vuelven, con lo que devuelve la base (agregados).
  it('Resumen: ranking y «vs general» salen de la 194', async () => {
    const { container, findByText, findAllByText } = renderHub()
    fireEvent.click(tabsOf(container)[TAB.resumen])
    expect(await findByText(/de 5 en ventas ·/)).toBeTruthy()
    expect((await findAllByText(/vs general/)).length).toBeGreaterThan(0)
  })

  it('Por día: «Yo vs restaurante» con el Prom/PAX del restaurante de la 194', async () => {
    const { container, findByText, getAllByText } = renderHub()
    fireEvent.click(tabsOf(container)[TAB.dia])
    expect(await findByText(/Yo vs restaurante/)).toBeTruthy()
    expect(getAllByText('₡8.800').length).toBeGreaterThan(0)
  })

  it('Productos separa Comidas / Bebidas en unidades (sin toggle ₡/uds)', () => {
    const { container, getByText, getAllByText, queryByText } = renderHub()
    fireEvent.click(tabsOf(container)[TAB.productos])
    expect(getByText('Comidas')).toBeTruthy()
    expect(getByText('Bebidas')).toBeTruthy()
    expect(queryByText('Ver por')).toBeNull()          // toggle removido: siempre unidades
    expect(getAllByText(/uds/).length).toBeGreaterThan(0)
    expect(getAllByText(/Sushi Roll/).length).toBeGreaterThan(0)
  })

  it('Propinas: ICP electrónico propio + benchmark del equipo de la 194', async () => {
    const { container, getByText, getAllByText, findByText } = renderHub()
    fireEvent.click(tabsOf(container)[TAB.propinas])
    expect(getAllByText(/ICP electrónico/).length).toBeGreaterThan(0)  // no "propinas cobradas"
    expect(getByText(/generado/)).toBeTruthy()                          // numerador = generado
    expect(getByText(/Total cobrado/)).toBeTruthy()                     // take-home (payout) intacto
    expect(await findByText(/Equipo \(benchmark\)/)).toBeTruthy()
    expect(getByText('3.4%')).toBeTruthy()
    expect(() => fireEvent.click(getByText(/Mes ant\./))).not.toThrow()
  })

  it('Competencias: mi posición y los puntos del líder SIN su nombre ni la tabla de otros', async () => {
    const { container, getByText, findByText, queryByText } = renderHub()
    fireEvent.click(tabsOf(container)[TAB.competencias])
    expect(getByText('Reto Sushi')).toBeTruthy()
    expect(getByText('Mis puntos')).toBeTruthy()
    expect(await findByText('de 4')).toBeTruthy()
    expect(getByText('40')).toBeTruthy()
    expect(queryByText('BETO')).toBeNull()
    expect(queryByText('Líder')).toBeNull()
  })

  it('grupo chico: solo la posición; sin «vs general», sin restaurante y con el aviso', async () => {
    H.equipo = EQUIPO_CHICO
    const { container, findByText, queryAllByText, queryByText, findAllByText } = renderHub()
    fireEvent.click(tabsOf(container)[TAB.resumen])
    expect(await findByText(/de 2 en ventas ·/)).toBeTruthy()
    expect(queryAllByText(/vs general/)).toHaveLength(0)
    expect((await findAllByText(/al menos 4 personas/)).length).toBeGreaterThan(0)
    fireEvent.click(tabsOf(container)[TAB.dia])
    expect(queryByText(/Yo vs restaurante/)).toBeNull()
    fireEvent.click(tabsOf(container)[TAB.propinas])
    expect(queryByText(/Equipo \(benchmark\)/)).toBeNull()
  })

  it('sin la 194 (función no aplicada o error): avisa y no inventa comparaciones', async () => {
    H.equipo = null
    const { container, findAllByText, queryAllByText } = renderHub()
    fireEvent.click(tabsOf(container)[TAB.resumen])
    expect((await findAllByText(/no está disponible ahora/)).length).toBeGreaterThan(0)
    expect(queryAllByText(/vs general/)).toHaveLength(0)
  })
})

describe('MiRendimiento · gerencia (manager) ve las comparaciones con el equipo', () => {
  beforeEach(() => { H.profile = { id:'u2', role:'manager', full_name:'ANA' } })

  it('Por día, Resumen, Propinas y Competencias comparan con sus propios datos (sin pedir el período a la 194)', () => {
    const { container, getByText, getAllByText } = renderHub()
    fireEvent.click(tabsOf(container)[TAB.resumen])
    expect(getByText(/en ventas ·/)).toBeTruthy()
    expect(getAllByText(/vs general/).length).toBeGreaterThan(0)
    fireEvent.click(tabsOf(container)[TAB.dia])
    expect(getByText(/Yo vs restaurante/)).toBeTruthy()
    fireEvent.click(tabsOf(container)[TAB.propinas])
    expect(getByText(/Equipo \(benchmark\)/)).toBeTruthy()
    fireEvent.click(tabsOf(container)[TAB.competencias])
    expect(getByText('Líder')).toBeTruthy()
    // Solo «Tu lugar en el equipo» (mes a la fecha) consulta la 194; el período y el ICP no.
    expect(H.llamadas).toHaveLength(1)
  })
})

describe('MiRendimiento · «Ver como» (owner) no consulta la 194', () => {
  beforeEach(() => { H.profile = { id:'u3', role:'owner', full_name:'Dueño' } })
  it('no llama a la función y no muestra «Tu lugar en el equipo»', () => {
    const { container, queryByText } = renderHub({ verComo: true })
    fireEvent.click(tabsOf(container)[TAB.evolucion])
    expect(queryByText(/Tu lugar en el equipo/)).toBeNull()
    expect(H.llamadas).toHaveLength(0)
  })
})

describe('MiRendimiento · rol propinas-primero (cocina, sin match de ventas)', () => {
  beforeEach(() => { H.profile = { id:'u9', role:'cocina', full_name:'ZZZ NoMatch' } })

  it('arranca en Propinas y las sub-vistas de ventas invitan a ir a propinas', () => {
    const { container, getAllByText, getByText } = renderHub()
    expect(getAllByText(/Total cobrado/).length).toBeGreaterThan(0)
    expect(() => fireEvent.click(tabsOf(container)[TAB.resumen])).not.toThrow()
    expect(getByText(/Tu rol trabaja con propinas/)).toBeTruthy()
    expect(H.llamadas).toHaveLength(0)   // sin ventas propias no se pide nada al equipo
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
