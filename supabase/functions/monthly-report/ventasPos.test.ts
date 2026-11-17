// monthly-report · ventas desde el PoS (16-nov, decisión firmada del dueño). Datos ficticios.
//   1. PARIDAD con la app: el paquete `ventasPos.gen.js` da `__paridad__/esperado.json`, el MISMO archivo
//      que fija la app (src/modules/ventas/ventasPosPuro.paridad.test.ts, rama claude/ventas-desde-pos).
//   2. La lectura de las tablas replica la 067: estado 'C', local, ventana [desde, hasta), paginada.
//   3. Los totales del correo y el control del dry_run (sin montos).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as V from './ventasPos.gen.js'
import { diasDelPos, leerLineas, leerTickets, netaDelPeriodo, totalesDelPeriodo, type DiaData } from './ventasPos'
import { compararConXls } from './controlXls'

const DIR = dirname(fileURLToPath(import.meta.url))
const caso = JSON.parse(readFileSync(join(DIR, '__paridad__/caso.json'), 'utf8'))
const esperado = JSON.parse(readFileSync(join(DIR, '__paridad__/esperado.json'), 'utf8'))

// El MISMO cálculo que hace la prueba de la app.
function calcular() {
  const avisos: string[] = []
  const { dias, pm } = V.armarDiasMap(caso.tickets, caso.lineas, caso.rango,
    { uploadedAt: caso.uploadedAt, nombres: caso.nombres, avisar: (s: string) => avisos.push(s) })
  const stats = Object.fromEntries(Object.entries(dias).map(([f, d]) => [f, V.getDayStats(d)]))
  return {
    ventana: V.ventanaRangoJornadas(caso.rango.desde, caso.rango.hasta),
    dias, pm, hist: V.aHistMap(dias), stats, avisos,
    pmFusionado: V.fusionarProductMap(caso.curado, pm),
    cols: { tickets: [...V.COLS_TICKETS_067], lineas: [...V.COLS_LINEAS_067] },
  }
}

describe('paridad con la app (paquete generado)', () => {
  it('el paquete da EXACTAMENTE esperado.json (el de la app)', () => {
    expect(JSON.parse(JSON.stringify(calcular()))).toEqual(esperado)
  })

  it('el paquete no fue tocado a mano: la huella de la cabecera es la del cuerpo', () => {
    const txt = readFileSync(join(DIR, 'ventasPos.gen.js'), 'utf8')
    const m = /sha256\(cuerpo\) ([0-9a-f]{64})\n/.exec(txt)
    expect(m).not.toBeNull()
    const cuerpo = txt.slice(txt.indexOf('// @ts-nocheck\n') + '// @ts-nocheck\n'.length)
    expect(createHash('sha256').update(cuerpo).digest('hex')).toBe(m![1])
    expect(txt).not.toMatch(/^import /m)
  })

  it('privacidad (D3): el paquete no trae el roster de nombres ni comentarios', () => {
    const txt = readFileSync(join(DIR, 'ventasPos.gen.js'), 'utf8')
    const cuerpo = txt.slice(txt.indexOf('// @ts-nocheck\n') + '// @ts-nocheck\n'.length)
    expect(cuerpo).toMatch(/const SALONEROS_CONOCIDOS = \{\}/)
    expect(cuerpo).not.toMatch(/\/\/|\/\*/)
    // Las únicas etiquetas con texto son las de caja, turno y genéricas; las de personas son «<código> · sin asignar».
    const etiquetas = [...new Set([...cuerpo.matchAll(/etiqueta: "([^"]*)"/g)].map(m => m[1]))]
    const permitidas = /^(\d+ · sin asignar|Caja (mañana|noche|bar)|Login compartido \(xx\)|Mañana · almuerzo|Tarde · noche|Sin código)$/
    expect(etiquetas.filter(e => !permitidas.test(e))).toEqual([])
  })
})

// ── Cliente falso: registra la cadena y devuelve páginas ─────────────────────────────────────
type Llamada = { tabla: string; ops: Array<[string, unknown[]]> }
function clienteFalso(filas: Record<string, Record<string, unknown>[]>) {
  const llamadas: Llamada[] = []
  return {
    llamadas,
    from(tabla: string) {
      const ll: Llamada = { tabla, ops: [] }
      llamadas.push(ll)
      const q: Record<string, unknown> = {}
      const encadenar = (op: string) => (...args: unknown[]) => { ll.ops.push([op, args]); return q }
      for (const op of ['select', 'eq', 'gte', 'lt', 'lte', 'in', 'order', 'not']) q[op] = encadenar(op)
      q.range = (a: number, b: number) => {
        ll.ops.push(['range', [a, b]])
        let todas = filas[tabla] ?? []
        const ids = ll.ops.find(o => o[0] === 'in')?.[1][1] as string[] | undefined
        if (ids) todas = todas.filter(f => ids.includes(String(f.ticket_id)))
        return Promise.resolve({ data: todas.slice(a, b + 1), error: null })
      }
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: filas[tabla] ?? [], error: null }).then(ok)
      return q
    },
  }
}

describe('lectura de las tablas (lo mismo que la 067)', () => {
  it('tickets: estado C, local, ventana [desde, hasta) del superset y orden total', async () => {
    const sb = clienteFalso({ pos_ndf_tickets: [] })
    await leerTickets(sb, { desde: '2026-10-01', hasta: '2026-10-31' }, 'santa-teresa')
    const ops = sb.llamadas[0].ops
    expect(sb.llamadas[0].tabla).toBe('pos_ndf_tickets')
    expect(ops).toContainEqual(['eq', ['local', 'santa-teresa']])
    expect(ops).toContainEqual(['eq', ['estado', 'C']])
    expect(ops).toContainEqual(['gte', ['fecha_registra', '2026-09-30T00:00:00-06:00']])
    expect(ops).toContainEqual(['lt', ['fecha_registra', '2026-11-02T00:00:00-06:00']])
    expect(ops).toContainEqual(['select', [V.COLS_TICKETS_067.join(',')]])
    expect(ops).toContainEqual(['order', ['id', { ascending: true }]])
  })

  it('pagina de a 1000 (PostgREST corta callado): 2.500 filas = 3 páginas, ninguna perdida', async () => {
    const muchas = Array.from({ length: 2500 }, (_, i) => ({ id: `t${i}` }))
    const sb = clienteFalso({ pos_ndf_tickets: muchas })
    const r = await leerTickets(sb, { desde: '2026-10-01', hasta: '2026-10-31' })
    expect(r).toHaveLength(2500)
    expect(sb.llamadas.length).toBe(3)
  })

  it('líneas: por tandas de 200 ids', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `t${i}`)
    const sb = clienteFalso({ pos_ndf_ticket_lines: ids.map(id => ({ ticket_id: id })) })
    const r = await leerLineas(sb, ids)
    expect(r).toHaveLength(450)
    expect(sb.llamadas.map(l => (l.ops.find(o => o[0] === 'in')![1][1] as string[]).length).sort((a, b) => b - a)).toEqual([200, 200, 50])
    expect(r.map(f => f.ticket_id)).toEqual(ids)            // en paralelo, pero en orden
  })
})

describe('diasDelPos: de las filas al día, igual que la app', () => {
  it('con las filas del caso da los mismos días que esperado.json (y el 7, fuera de rango, no)', async () => {
    const sb = clienteFalso({
      pos_ndf_tickets: caso.tickets, pos_ndf_ticket_lines: caso.lineas,
      employees: Object.entries(caso.nombres).map(([pos_login, full_name]) => ({ pos_login, full_name })),
    })
    const { dias } = await diasDelPos(sb, caso.rango)
    expect(JSON.parse(JSON.stringify(dias))).toEqual(
      JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(esperado.dias).map(([f, d]) => [f, { ...(d as object), uploadedAt: caso.rango.hasta }])))))
    expect(Object.keys(dias).sort()).toEqual(['2026-10-05', '2026-10-06'])
  })

  it('un login que no está en employees sale «sin asignar» y no rompe', async () => {
    const tickets = [{ ...caso.tickets[0], id: 'z1', numero_factura: 'z1', salonero_login: '023' }]
    const lineas = [{ ...caso.lineas[0], ticket_id: 'z1', usuario_registra: '023' }]
    const sb = clienteFalso({ pos_ndf_tickets: tickets, pos_ndf_ticket_lines: lineas, employees: [] })
    const { dias } = await diasDelPos(sb, caso.rango)
    expect(Object.keys(dias['2026-10-05'].saloneros)).toContain('023 · sin asignar')
  })

  it('sin tickets → sin días (el correo sale «sin datos», no con ceros)', async () => {
    expect(await diasDelPos(clienteFalso({}), { desde: '2026-11-01', hasta: '2026-11-14' })).toEqual({ dias: {}, pm: {} })
  })
})

describe('totales del correo', () => {
  const dias = esperado.dias as Record<string, DiaData>

  it('total = neta del módulo Ventas; salón + caja + delivery = total', () => {
    const t = totalesDelPeriodo(dias)
    expect(t.total).toBe(Object.values(esperado.stats as Record<string, { ventaNeta: number }>).reduce((s, x) => s + x.ventaNeta, 0))
    expect(t.salon + t.caj + t.delivery).toBe(t.total)
    expect(t.delivery).toBe(15_000)            // el delivery del mesero va a delivery, no a salón
    expect(t.salon).toBe(20_000 + 30_000 + 10_000)   // meseros SIN su delivery
    expect(t.caj).toBe(10_000)                 // salón cobrado con login de caja
    expect(t.diasVentas).toBe(2)
    expect(netaDelPeriodo(dias)).toBe(t.total)
  })
})

describe('control del dry_run contra el xls (sin montos)', () => {
  const dias = esperado.dias as Record<string, DiaData>
  const netaDia = (f: string) => netaDelPeriodo({ [f]: dias[f] })

  it('mismos días y mismos montos → razones 1; un día del PoS sin xls cuenta solo en dias_pos', () => {
    const xls = [{ session_date: '2026-10-05', data: { saloneros: { X: { total: netaDia('2026-10-05') } } } }]
    const c = compararConXls(dias, xls)
    expect(c).toMatchObject({ dias_pos: 2, dias_xls: 1, dias_en_comun: 1, dias_xls_sin_pos: 0, razon_neta_dias_en_comun: 1 })
    expect(c.razon_total_pos_vs_xls).toBeCloseTo((netaDia('2026-10-05') + netaDia('2026-10-06')) / netaDia('2026-10-05'), 4)
  })

  it('no trae montos: solo conteos y razones', () => {
    const c = compararConXls(dias, [{ session_date: '2026-10-05', data: { saloneros: { X: { total: 123_456 } } } }])
    expect(Object.keys(c).sort()).toEqual(['dias_en_comun', 'dias_pos', 'dias_xls', 'dias_xls_sin_pos',
      'razon_neta_dias_en_comun', 'razon_total_pos_vs_xls'])
    for (const v of Object.values(c)) expect(v === null || Math.abs(v as number) < 1000).toBe(true)
  })
})

describe('guarda: el correo ya no lee el xls', () => {
  it('index.ts no consulta `ventas_dias`; solo controlXls.ts (dry_run) la lee', () => {
    const idx = readFileSync(join(DIR, 'index.ts'), 'utf8')
    expect(idx).not.toMatch(/from\(\s*['"]ventas_dias['"]/)
    expect(idx).toMatch(/if \(dry\) control = await controlContraXls/)
  })
})
