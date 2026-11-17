// Paridad app ↔ Edge `monthly-report` (16-nov, todo del PoS). La Edge usa un PAQUETE de
// `ventasPosPuro.ts` (no una copia a mano). Esta prueba:
//   1. corre el caso ficticio de `__paridad__/caso.json` por la app y fija el resultado en
//      `__paridad__/esperado.json` (la Edge prueba su paquete contra ese MISMO archivo);
//   2. arma el paquete en memoria, igual que el script, y le exige el MISMO resultado;
//   3. exige que las columnas que la Edge lee de las tablas sean las que devuelven las funciones
//      de la 067 (las que usa la app).
// Si cambia la lógica de ventas, esta prueba cae: regenerar `esperado.json` (ACTUALIZAR_PARIDAD=1)
// y el paquete de la Edge (`node scripts/edge/empaquetar-ventas-pos.mjs …`).
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

vi.mock('../../shared/api/supabase', () => ({ supabase: null }))
import * as app from './ventasPosPuro'
import { SALONEROS_CONOCIDOS } from '../../shared/ndf/mapTicket'
import { personasConocidas } from '../../shared/ndf/personasNdf'

const DIR = new URL('./__paridad__/', import.meta.url).pathname
const RAIZ = new URL('../../../', import.meta.url).pathname
const caso = JSON.parse(readFileSync(join(DIR, 'caso.json'), 'utf8'))

type Modulo = typeof app
function calcular(m: Modulo) {
  const avisos: string[] = []
  const { dias, pm } = m.armarDiasMap(caso.tickets, caso.lineas, caso.rango,
    { uploadedAt: caso.uploadedAt, nombres: caso.nombres, avisar: (s: string) => avisos.push(s) })
  const stats = Object.fromEntries(Object.entries(dias).map(([f, d]) => [f, m.getDayStats(d)]))
  return {
    ventana: m.ventanaRangoJornadas(caso.rango.desde, caso.rango.hasta),
    dias, pm, hist: m.aHistMap(dias), stats, avisos,
    pmFusionado: m.fusionarProductMap(caso.curado, pm),
    cols: { tickets: [...m.COLS_TICKETS_067], lineas: [...m.COLS_LINEAS_067] },
  }
}

describe('paridad de ventas desde el PoS: app ↔ paquete de la Edge', () => {
  const deLaApp = JSON.parse(JSON.stringify(calcular(app)))

  it('la app da el resultado fijado en esperado.json', () => {
    if (process.env.ACTUALIZAR_PARIDAD === '1') writeFileSync(join(DIR, 'esperado.json'), JSON.stringify(deLaApp, null, 1) + '\n')
    const esperado = JSON.parse(readFileSync(join(DIR, 'esperado.json'), 'utf8'))
    expect(deLaApp).toEqual(esperado)
    // El caso muerde: dos días, el de las 00:30 va al día siguiente y el 7 queda afuera.
    expect(Object.keys(esperado.dias).sort()).toEqual(['2026-10-05', '2026-10-06'])
  })

  it('el paquete (lo que corre la Edge) da EXACTAMENTE lo mismo que la app', async () => {
    const { empaquetar, cabecera } = await import(pathToFileURL(join(RAIZ, 'scripts/edge/empaquetar-ventas-pos.mjs')).href)
    const codigo: string = await empaquetar()
    expect(codigo).not.toMatch(/^import /m)              // sin dependencias: Deno lo carga tal cual
    expect(codigo).not.toMatch(/import\.meta\.env/)
    // Privacidad (D3): el paquete NO copia el roster de nombres reales (va vacío; la Edge lee `employees`).
    expect(codigo).toMatch(/const SALONEROS_CONOCIDOS = \{\}/)
    expect(Object.keys(SALONEROS_CONOCIDOS).length).toBeGreaterThan(0)
    const meseros = personasConocidas().filter(p => p.rol === 'mesero')
    expect(meseros.length).toBeGreaterThan(0)
    const nombres = [...Object.values(SALONEROS_CONOCIDOS), ...meseros.map(p => p.etiqueta)]
    for (const n of nombres) expect(codigo.toLowerCase(), n).not.toMatch(new RegExp(`\\b${n.toLowerCase()}\\b`))
    expect(codigo).not.toMatch(/\/\/|\/\*/)            // sin comentarios
    const archivo = join(mkdtempSync(join(tmpdir(), 'paridad-')), 'ventasPos.gen.mjs')
    writeFileSync(archivo, cabecera(codigo) + codigo)
    const paquete = await import(/* @vite-ignore */ pathToFileURL(archivo).href) as Modulo
    expect(JSON.parse(JSON.stringify(calcular(paquete)))).toEqual(deLaApp)
  }, 60_000)

  it('las columnas que lee la Edge son las que devuelven las funciones de la 067', () => {
    const sql = readFileSync(join(RAIZ, 'supabase/migrations/067_pos_ventas_lectura_equipo.sql'), 'utf8')
    const columnas = (fn: string) => {
      const desde = sql.indexOf(`function public.${fn}(`)
      const bloque = sql.slice(sql.indexOf('returns table (', desde) + 15, sql.indexOf('\n)', sql.indexOf('returns table (', desde)))
      return bloque.split('\n').map(l => l.trim().split(/\s+/)[0]).filter(Boolean)
    }
    expect([...app.COLS_TICKETS_067]).toEqual(columnas('pos_ventas_tickets_rango'))
    expect([...app.COLS_LINEAS_067]).toEqual(columnas('pos_ventas_lineas'))
  })
})
