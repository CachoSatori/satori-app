// @vitest-environment happy-dom
//
// Rediseño B4, en el DOM: frase, 3 números, «Para hacer hoy» y el estado «todo en orden».
// La base está simulada (solo lecturas); los datos son ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

let role = 'owner'
vi.mock('../shared/hooks/useAuth', () => ({
  useAuth: () => ({
    profile: { id: 'p1', role, is_active: true, full_name: 'Persona Ficticia' },
    signOut: vi.fn(),
  }),
}))

// Respuestas por tabla: { data, count, error }. Cualquier cadena de filtros devuelve lo mismo.
let tablas: Record<string, { data?: unknown; count?: number; error?: unknown }> = {}
let baseCaida = false   // `supabase.from` explota: `fetchHomeStatus` falla entero
vi.mock('../shared/api/supabase', () => {
  const cadena = (t: string): unknown => {
    const r = tablas[t]?.error
      ? { data: null, count: null, error: tablas[t].error }
      : { data: tablas[t]?.data ?? null, count: tablas[t]?.count ?? 0, error: null }
    const p: Record<string, unknown> = {
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(r).then(ok, ko),
    }
    return new Proxy(p, { get: (o, k) => (k in o ? o[k as string] : () => cadena(t)) })
  }
  return { supabase: { from: (t: string) => {
    if (baseCaida) throw new Error('sin conexión')
    return cadena(t)
  } } }
})

let alertaDias: string[] = []
let cierresFalla = false
let jornadasFalla = false
let cierresLecturas = 0
let cierresEnEspera: Promise<void> | null = null   // la alerta tarda hasta que se resuelva
vi.mock('../shared/api/cash', () => ({
  getCierresDia: async () => {
    cierresLecturas++
    if (cierresEnEspera) await cierresEnEspera
    if (cierresFalla) throw new Error('sin conexión')
    return []
  },
  getAllCashMovements: async () => [],
  getCashSessions: async () => alertaDias.map((f, i) => ({ id: `s${i}`, status: 'open', session_date: f, cajero_name: null })),
}))
vi.mock('../shared/api/jornadasConVentas', () => ({
  getJornadasConVentas: async () => { if (jornadasFalla) throw new Error('sin conexión'); return [] },
}))

let clubFalla = false
let clubExcepciones = 0
let clubAlertas: unknown[] = []
let clubAlertasFalla = false
let clubAlertasLecturas = 0
let clubAlertasLocalPedido: unknown = 'sin llamar'
let clubLocalActual: string | null = null
vi.mock('../shared/api/club', () => ({
  getExcepcionesAbiertas: async () => { if (clubFalla) throw new Error('sin conexión'); return clubExcepciones },
  getAlertasInicio: async (local?: string | null) => {
    clubAlertasLecturas++; clubAlertasLocalPedido = local
    if (clubAlertasFalla) throw new Error('sin conexión'); return clubAlertas
  },
  localActual: () => clubLocalActual,
}))

import HomePage from './HomePage'
import { olvidarAlertaInicio } from './alertaInicio'

function montar() {
  return render(<MemoryRouter><HomePage /></MemoryRouter>)
}

beforeEach(() => {
  cleanup()
  role = 'owner'
  tablas = { sops: { count: 7 } }
  alertaDias = []
  cierresFalla = false
  jornadasFalla = false
  baseCaida = false
  cierresLecturas = 0
  cierresEnEspera = null
  clubFalla = false
  clubExcepciones = 0
  clubAlertas = []
  clubAlertasFalla = false
  clubAlertasLecturas = 0
  clubAlertasLocalPedido = 'sin llamar'
  clubLocalActual = null
  olvidarAlertaInicio()
  sessionStorage.clear()
})

describe('Inicio (B4)', () => {
  it('owner sin pendientes: «Todo en orden.», Daruma y los 3 números', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Todo en orden.')).toBeTruthy())
    expect(screen.getByText('Todo en orden')).toBeTruthy()
    for (const t of ['Venta de hoy', 'Propinas del día', 'Caja de hoy']) expect(screen.getByText(t)).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('owner con movimientos por revisar y un turno viejo: lista con píldoras, lo malo primero', async () => {
    tablas.cash_movements = { data: [], count: 3 }
    alertaDias = ['2026-01-05']
    montar()
    await waitFor(() => expect(screen.getByText('Hay una cosa para resolver hoy.')).toBeTruthy())
    const items = within(screen.getByRole('list')).getAllByRole('button')
    expect(items.map(b => b.textContent)).toEqual([
      expect.stringContaining('1 turno abierto'),
      expect.stringContaining('3 por revisar'),
    ])
    expect(screen.queryByText('Todo en orden')).toBeNull()
  })

  it('contador: no carga la alerta de cierres (como en Caja) y ve igual sus pendientes', async () => {
    role = 'contador'
    tablas.cash_movements = { data: [], count: 2 }
    alertaDias = ['2026-01-05']
    montar()
    await waitFor(() => expect(screen.getByText('Queda un pendiente para hoy.')).toBeTruthy())
    expect(screen.getByText('2 por revisar')).toBeTruthy()
    expect(screen.queryByText(/turno abierto/)).toBeNull()
  })

  it('roles de operación: solo la grilla, sin frase ni números', async () => {
    role = 'barman'
    montar()
    expect(screen.getByText('Tus módulos')).toBeTruthy()
    expect(screen.queryByText('Para hacer hoy')).toBeNull()
    expect(screen.queryByText('Venta de hoy')).toBeNull()
    expect(screen.getByText('Mi Rendimiento')).toBeTruthy()
  })
})

// B5: cada falla de lectura se ve en pantalla; nunca «Todo en orden» ni el Daruma.
describe('Inicio (B5) · si una lectura falla', () => {
  const FRASE = 'No se pudo comprobar todo — revisá Caja.'
  const sinOrden = () => {
    expect(screen.queryByText('Todo en orden')).toBeNull()
    expect(screen.queryByText('Todo en orden.')).toBeNull()
    expect(document.querySelector('.inicio-en-orden')).toBeNull()
  }
  const avisoACaja = () => {
    const boton = screen.getByText('sin comprobar', { selector: '.inicio-pendiente .pildora' }).closest('button')
    expect(boton?.textContent).toContain('Revisar Caja')
  }

  it.each([
    ['tip_sessions'], ['cash_sessions'], ['cash_movements'], ['sops'], ['ingredients'],
    ['ventas_dias'], ['ventas_metas'],
  ])('falla la lectura de %s: frase de error y «sin comprobar»', async (tabla) => {
    tablas[tabla] = { error: { message: 'falló' } }
    montar()
    await waitFor(() => expect(screen.getByText(FRASE)).toBeTruthy())
    avisoACaja()
    sinOrden()
  })

  it('procedimientos que no se pudieron leer no salen como «sin contenido»', async () => {
    tablas.sops = { error: { message: 'falló' } }
    montar()
    await waitFor(() => expect(screen.getByText(FRASE)).toBeTruthy())
    expect(screen.queryByText('sin contenido')).toBeNull()
  })

  it('la venta del día que no se pudo leer muestra «—» y la píldora, no «Sin datos hoy»', async () => {
    tablas.ventas_dias = { error: { message: 'falló' } }
    montar()
    await waitFor(() => expect(screen.getByText(FRASE)).toBeTruthy())
    expect(screen.queryByText('Sin datos hoy')).toBeNull()
    expect(screen.getAllByText('sin comprobar', { selector: '.inicio-cifra-sub .pildora' })).toHaveLength(1)
  })

  it('falla la alerta de cierres (cierres del día)', async () => {
    cierresFalla = true
    montar()
    await waitFor(() => expect(screen.getByText(FRASE)).toBeTruthy())
    avisoACaja()
    sinOrden()
  })

  it('falla la lectura de jornadas con ventas del PoS', async () => {
    jornadasFalla = true
    montar()
    await waitFor(() => expect(screen.getByText(FRASE)).toBeTruthy())
    sinOrden()
  })

  it('falla todo el día: «No se pudo cargar el día.», no «Revisando el día…» para siempre', async () => {
    baseCaida = true
    montar()
    await waitFor(() => expect(screen.getByText('No se pudo cargar el día.')).toBeTruthy())
    expect(screen.queryByText('Revisando el día…')).toBeNull()
    expect(screen.queryByText('Cargando…')).toBeNull()
    avisoACaja()
    sinOrden()
  })

  it('contador: una falla también le cambia la frase', async () => {
    role = 'contador'
    tablas.cash_movements = { error: { message: 'falló' } }
    montar()
    await waitFor(() => expect(screen.getByText(FRASE)).toBeTruthy())
    sinOrden()
  })
})

// B5 · auditoría 197 (DECISIONES 11-nov 15:55): la alerta se lee una vez por sesión.
describe('Inicio (B5) · alerta de días sin cierre una vez por sesión', () => {
  it('la segunda visita al Inicio reusa la alerta: no la vuelve a leer', async () => {
    const { unmount } = montar()
    await waitFor(() => expect(screen.getByText('Todo en orden.')).toBeTruthy())
    expect(cierresLecturas).toBe(1)
    unmount()
    montar()
    await waitFor(() => expect(screen.getByText('Todo en orden.')).toBeTruthy())
    expect(cierresLecturas).toBe(1)
  })

  it('si la lectura falló no se guarda: la próxima visita reintenta', async () => {
    cierresFalla = true
    const { unmount } = montar()
    await waitFor(() => expect(screen.getByText('No se pudo comprobar todo — revisá Caja.')).toBeTruthy())
    unmount()
    cierresFalla = false
    montar()
    await waitFor(() => expect(screen.getByText('Todo en orden.')).toBeTruthy())
    expect(cierresLecturas).toBe(2)
  })

  it('mientras llega la alerta, los otros pendientes ya se ven (y nada de «Todo en orden»)', async () => {
    let soltar = () => {}
    cierresEnEspera = new Promise<void>(r => { soltar = r })
    tablas.cash_movements = { data: [], count: 3 }
    montar()
    await waitFor(() => expect(screen.getByText('3 por revisar')).toBeTruthy())
    expect(screen.getByText('Revisando los días sin cierre…')).toBeTruthy()
    soltar()
    await waitFor(() => expect(screen.queryByText('Revisando los días sin cierre…')).toBeNull())
    expect(screen.getByText('Queda un pendiente para hoy.')).toBeTruthy()
  })

  it('sin otros pendientes, no dice «Todo en orden» hasta que llega la alerta', async () => {
    let soltar = () => {}
    cierresEnEspera = new Promise<void>(r => { soltar = r })
    montar()
    await waitFor(() => expect(screen.getByText('Venta de hoy')).toBeTruthy())
    await new Promise(r => setTimeout(r, 20))
    expect(screen.getByText('Revisando el día…')).toBeTruthy()
    expect(screen.queryByText('Todo en orden')).toBeNull()
    soltar()
    await waitFor(() => expect(screen.getByText('Todo en orden.')).toBeTruthy())
  })
})

// Pase a producción (auditoría 208): la lectura de excepciones del Club también cuenta.
describe('Inicio · Club (pase a producción)', () => {
  it('owner: si falla la lectura del Club, nunca «Todo en orden»; sale «sin comprobar»', async () => {
    clubFalla = true
    montar()
    await waitFor(() => expect(screen.getByText('No se pudo comprobar todo — revisá Caja.')).toBeTruthy())
    expect(screen.queryByText('Todo en orden.')).toBeNull()
    expect(screen.getByText('sin comprobar', { selector: '.inicio-pendiente .pildora' })).toBeTruthy()
  })
  it('owner con 0 excepciones y todo bien: «Todo en orden.»', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Todo en orden.')).toBeTruthy())
  })
  it('owner con excepciones abiertas: sale «Revisar las excepciones del Club»', async () => {
    clubExcepciones = 2
    montar()
    await waitFor(() => expect(screen.getByText('Revisar las excepciones del Club')).toBeTruthy())
    expect(screen.queryByText('Todo en orden.')).toBeNull()
  })
  it('contador: la lectura del Club no le afecta (no ve el Club)', async () => {
    role = 'contador'
    clubFalla = true
    montar()
    await waitFor(() => expect(screen.getByText('Todo en orden.')).toBeTruthy())
  })
})

// 164 (SPEC-club-v2 ítem 10, B6): «Club · Para revisar hoy». Datos ficticios.
function Destino() {
  const l = useLocation()
  return <p>destino {l.pathname}{l.search}</p>
}
function montarConRutas() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/club" element={<Destino />} />
      </Routes>
    </MemoryRouter>)
}
const bloque = () => screen.getByRole('region', { name: 'Club · Para revisar hoy' })

describe('Inicio · Club · Para revisar hoy (164)', () => {
  it('owner con cero datos: «Nada para revisar», sin lista', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Nada para revisar en el Club (ayer y hoy).')).toBeTruthy())
    expect(within(bloque()).queryByRole('list')).toBeNull()
  })
  it('manager ve los 4 avisos, cada uno con qué pasó, el umbral y adónde ir', async () => {
    role = 'manager'
    clubAlertas = [
      { tipo: 'ANFITRION_24H', ref: 'a1', cantidad: 7, umbral: 5, fecha: '2001-03-01T12:00:00Z',
        detalle: { miembro_id: 'm-1', miembro: 'Anfitrion Ficticio', tipo_miembro: 'referente' } },
      { tipo: 'MISMO_USUARIO', ref: 'b1', cantidad: 3, umbral: 2, fecha: '2001-03-01T12:00:00Z',
        detalle: { miembro_id: 'm-2', miembro: 'Socio Ficticio', que: 'socio', usuario: 'Cajero Ficticio', dias: 3 } },
      { tipo: 'VISITAS_SIN_FACTURA', ref: 'c1', cantidad: 2, umbral: 0, fecha: '2001-03-01T12:00:00Z', detalle: {} },
      { tipo: 'CANJE_SIN_CODIGO', ref: 'd1', cantidad: 1, umbral: 0, fecha: '2001-03-01T12:00:00Z', detalle: { dias: 30 } },
    ]
    montar()
    await waitFor(() => expect(within(bloque()).getAllByRole('listitem')).toHaveLength(4))
    const b = within(bloque())
    expect(b.getByText('Anfitrion Ficticio sumó 7 visitas con cupón o tarjeta en 24 horas')).toBeTruthy()
    expect(b.getByText(/el aviso salta con más de 5/)).toBeTruthy()
    expect(b.getByText('Cajero Ficticio registró al socio Socio Ficticio 3 veces en 3 días')).toBeTruthy()
    expect(b.getByText('2 visitas de socio sin factura (ayer y hoy)')).toBeTruthy()
    expect(b.getByText('1 canje sin código sin resolver')).toBeTruthy()
    expect(b.getByText('7 en 24 h')).toBeTruthy()
  })
  it('tocar un aviso lleva a la pantalla donde se revisa (ficha del anfitrión; Excepciones filtradas)', async () => {
    clubAlertas = [
      { tipo: 'ANFITRION_24H', ref: 'a1', cantidad: 6, umbral: 5, fecha: '2001-03-01T12:00:00Z',
        detalle: { miembro_id: 'm-1', miembro: 'Anfitrion Ficticio', tipo_miembro: 'equipo' } },
    ]
    montarConRutas()
    await waitFor(() => expect(screen.getByText(/Anfitrion Ficticio \(equipo\) sumó 6 visitas/)).toBeTruthy())
    screen.getByText(/Anfitrion Ficticio \(equipo\) sumó 6 visitas/).closest('button')!.click()
    await waitFor(() => expect(screen.getByText('destino /club?vista=miembros&miembro=m-1')).toBeTruthy())
  })
  it('canjes sin código → Excepciones con el tipo elegido', async () => {
    clubAlertas = [{ tipo: 'CANJE_SIN_CODIGO', ref: 'd1', cantidad: 2, umbral: 0, fecha: '2001-03-01T12:00:00Z', detalle: {} }]
    montarConRutas()
    await waitFor(() => expect(screen.getByText('2 canjes sin código sin resolver')).toBeTruthy())
    screen.getByText('2 canjes sin código sin resolver').closest('button')!.click()
    await waitFor(() => expect(screen.getByText('destino /club?vista=excepciones&tipo=CANJE_SIN_CODIGO')).toBeTruthy())
  })
  it('si falla la lectura: «sin comprobar», nunca «Nada para revisar»', async () => {
    clubAlertasFalla = true
    montar()
    await waitFor(() => expect(within(bloque()).getByText('sin comprobar')).toBeTruthy())
    expect(screen.queryByText('Nada para revisar en el Club (ayer y hoy).')).toBeNull()
  })
  it('contador, cajero y salonero: no ven el bloque ni lo leen', async () => {
    for (const r of ['contador', 'cajero', 'salonero']) {
      cleanup(); sessionStorage.clear(); role = r; clubAlertasLecturas = 0
      montar()
      await new Promise(res => setTimeout(res, 20))
      expect(screen.queryByRole('region', { name: 'Club · Para revisar hoy' })).toBeNull()
      expect(clubAlertasLecturas).toBe(0)
    }
  })
})

// Verificador #183: varios locales y el canje sin código que no sale dos veces.
describe('Inicio · Club · Para revisar hoy · locales y duplicados (164)', () => {
  const canje = (cantidad: number, local: string) => ({ tipo: 'CANJE_SIN_CODIGO', ref: `d:${local}`, cantidad, umbral: 0,
    fecha: '2001-03-01T12:00:00Z', detalle: { local, local_nombre: `Local ${local}`, multilocal: false } })
  it('pide las alertas SIN local (todos los encendidos que ve), no el elegido en el aparato', async () => {
    clubLocalActual = 'local-a'
    montar()
    await waitFor(() => expect(screen.getByText('Nada para revisar en el Club (ayer y hoy).')).toBeTruthy())
    expect(clubAlertasLocalPedido).toBeNull()
  })
  it('dos locales: cada aviso dice su local', async () => {
    clubAlertas = [{ tipo: 'VISITAS_SIN_FACTURA', ref: 'c:b', cantidad: 1, umbral: 0, fecha: '2001-03-01T12:00:00Z',
      detalle: { local: 'local-b', local_nombre: 'Local Bee', multilocal: true } }]
    montar()
    await waitFor(() => expect(screen.getByText('Local Bee · 1 visita de socio sin factura (ayer y hoy)')).toBeTruthy())
  })
  it('el canje sin código del bloque no se cuenta otra vez en «Revisar las excepciones del Club»', async () => {
    clubExcepciones = 1
    clubAlertas = [canje(1, 'local-a')]
    montar()
    await waitFor(() => expect(screen.getByText('1 canje sin código sin resolver')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('Todo en orden.')).toBeTruthy())
    expect(screen.queryByText('Revisar las excepciones del Club')).toBeNull()
  })
  it('las demás excepciones siguen: 3 abiertas − 1 canje del bloque = «2 excepciones»', async () => {
    clubExcepciones = 3
    clubLocalActual = 'local-a'
    clubAlertas = [canje(1, 'local-a'), canje(5, 'local-b')]   // el de otro local no se descuenta
    montar()
    await waitFor(() => expect(screen.getByText('Revisar las excepciones del Club')).toBeTruthy())
    expect(screen.getByText('2 excepciones')).toBeTruthy()
  })
})
