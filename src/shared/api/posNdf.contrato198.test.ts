// Mig 198 — catálogo por código (Ventas v2 3.1a). Lee la migración (patrón de contrato067/191) y frena:
//   · que cambie el orden de un arreglo que la app lee por posición (leería «unidades» donde va «monto»);
//   · que se cuele un medio de pago, mesa, salonero, número de factura o `clase_ingreso` (regla 6);
//   · que las TRES copias de la lista de categorías que una persona puede elegir dejen de coincidir, o que alguna
//     habilite algo que no es venta (cortesia, personal, ingredientes);
//   · que la definición firmada de lo que no es venta quede en dos lugares distintos;
//   · que la 198 llegue a la firma con un nombre de familia «POR CONFIRMAR» o con una familia sin cargar;
//   · que la vuelta atrás se olvide de algo que la 198 crea.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { FAMILIAS_CATALOGO, FAMILIAS_NO_VENTA } from '../../modules/ventas/netaVenta'
import { CATEGORIAS_EDITABLES, CATEGORIAS_FIJAS, CATEGORIAS_NO_VENTA } from '../../modules/ventas/catalogoPos'
import { parsearCatalogoProductos, parsearVentasProductos } from './posNdf'

const raiz = path.resolve(__dirname, '../../..')
const sql = fs.readFileSync(path.join(raiz, 'supabase/migrations/198_pos_catalogo_productos.sql'), 'utf8')
const rollback = fs.readFileSync(path.join(raiz, 'scripts/sql/198_rollback.sql'), 'utf8')
const sinComentarios = (s: string) => s.replace(/--.*$/gm, '')
const codigo = sinComentarios(sql)
const plano = (s: string) => s.replace(/\s+/g, ' ')

/** El cuerpo de una función (de `create function public.<fn>(` hasta el `$function$;` / `$$;` que la cierra). */
function funcion(fn: string): string {
  const i = codigo.indexOf(`create function public.${fn}(`)
  expect(i, fn).toBeGreaterThanOrEqual(0)
  const fin = codigo.slice(i).search(/\$(function)?\$;/)
  return codigo.slice(i, i + fin)
}

/** Los elementos de un `jsonb_build_array(...)` que sigue a `'<clave>', coalesce((select jsonb_agg(` en una función. */
function arreglo(fn: string, clave: string): string[] {
  const f = plano(funcion(fn))
  const i = f.indexOf(`'${clave}', coalesce((select jsonb_agg(jsonb_build_array(`)
  expect(i, `${fn}.${clave}`).toBeGreaterThanOrEqual(0)
  const desde = f.indexOf('jsonb_build_array(', i) + 'jsonb_build_array('.length
  let prof = 1, j = desde
  for (; j < f.length && prof > 0; j++) { if (f[j] === '(') prof++; else if (f[j] === ')') prof-- }
  const partes: string[] = []
  let p = 0, actual = ''
  for (const ch of f.slice(desde, j - 1)) {
    if (ch === '(') p++
    if (ch === ')') p--
    if (ch === ',' && p === 0) { partes.push(actual.trim()); actual = '' } else actual += ch
  }
  partes.push(actual.trim())
  return partes
}

const listaSql = (s: string): string[] => [...s.matchAll(/'([a-z_]+)'/g)].map(m => m[1])

describe('mig 198 — forma de lo que devuelve (la app lee por posición)', () => {
  it('pos_ventas_productos.productos: [codigo, nombre, familia, canal, unidades, monto_cts, facturas, categoria, unidades_cero]', () => {
    expect(arreglo('pos_ventas_productos', 'productos')).toEqual([
      'pr.codigo', 'pr.nombre', 'pr.familia', 'pr.canal', 'pr.unidades', 'pr.monto_cts', 'pr.facturas', 'pr.categoria', 'pr.unidades_cero'])
  })
  it('pos_ventas_productos.meses: [mes, familia, canal, unidades, monto_cts, categoria]', () => {
    expect(arreglo('pos_ventas_productos', 'meses')).toEqual(['ms.mes', 'ms.familia', 'ms.canal', 'ms.unidades', 'ms.monto_cts', 'ms.categoria'])
  })
  it('pos_ventas_productos.catalogo: [codigo, nombre, familia, rinde, visto_desde, visto_hasta, categoria]', () => {
    expect(arreglo('pos_ventas_productos', 'catalogo')).toEqual([
      'cat.codigo', 'cat.nombre', 'cat.familia', 'cat.rinde', 'cat.visto_desde', 'cat.visto_hasta', 'cat.categoria'])
  })
  it('familias: [familia, nombre, categoria, orden], igual en las dos lecturas', () => {
    const esperado = ['f.familia', 'f.nombre', 'f.categoria', 'f.orden']
    expect(arreglo('pos_ventas_productos', 'familias')).toEqual(esperado)
    expect(arreglo('pos_catalogo_productos', 'familias')).toEqual(esperado)
  })
  it('pos_catalogo_productos.productos: [codigo, nombre, familia, categoria vigente, categoria propia, rinde, visto_desde, visto_hasta]', () => {
    expect(arreglo('pos_catalogo_productos', 'productos')).toEqual([
      'p.codigo', 'p.nombre', 'p.familia', 'public.pos_categoria_efectiva(p.familia, f.categoria, a.categoria)', 'a.categoria',
      'coalesce(a.rinde_personas, 1)', 'p.visto_desde', 'p.visto_hasta'])
  })
  it('jsonb, no setof: el tope de filas de PostgREST no corta un año', () => {
    expect(plano(funcion('pos_ventas_productos'))).toMatch(/returns jsonb/)
    expect(plano(funcion('pos_catalogo_productos'))).toMatch(/returns jsonb/)
    expect(codigo).not.toMatch(/returns (setof|table)/i)
  })
  it('el lector parsea cada posición donde la 198 la pone', () => {
    const r = parsearVentasProductos({
      productos: [['9001', 'X', 3, 'salon', 3, 710000, 2, 'comida', 1]], meses: [['2026-11', 3, 'salon', 3, 710000, 'comida']],
      catalogo: [['9001', 'X', 3, 2, '2026-11-01', '2026-11-20', 'comida']], familias: [[3, 'F', 'comida', 20]],
      sin_lineas: { facturas: 1, cts: 50 }, neta_cts: 710050,
    })
    expect(r.productos[0]).toEqual({ codigo: '9001', nombre: 'X', familia: 3, canal: 'salon', unidades: 3, montoCts: 710000, facturas: 2, categoria: 'comida', unidadesCero: 1 })
    expect(r.meses[0]).toEqual({ mes: '2026-11', familia: 3, canal: 'salon', unidades: 3, montoCts: 710000, categoria: 'comida' })
    expect(r.catalogo[0]).toEqual({ codigo: '9001', nombre: 'X', familia: 3, rinde: 2, vistoDesde: '2026-11-01', vistoHasta: '2026-11-20', categoria: 'comida' })
    expect(r.familias[0]).toEqual({ familia: 3, nombre: 'F', categoria: 'comida', orden: 20 })
    expect(r).toMatchObject({ sinLineas: { facturas: 1, cts: 50 }, netaCts: 710050 })
    const c = parsearCatalogoProductos({
      productos: [['9001', 'X', 3, 'bebida', 'bebida', 4, '2026-11-01', '2026-11-20']], familias: [],
      categorias_editables: ['comida'], categorias_fijas: ['pax'],
    })
    expect(c.productos[0]).toEqual({ codigo: '9001', nombre: 'X', familia: 3, categoria: 'bebida', categoriaPropia: 'bebida', rinde: 4, vistoDesde: '2026-11-01', vistoHasta: '2026-11-20' })
    expect(() => parsearVentasProductos({ productos: 'x' })).toThrow(/forma inesperada/)
  })
})

describe('mig 198 — regla 6: nada de pagos, mesas, saloneros ni números de factura', () => {
  const PROHIBIDAS = /efectivo|tarjeta|electronico|deposito|cheque|cxc|dolares|vuelto|descuento|clase_ingreso|salonero|cajero|mesa|numero_factura|numero_pedido|regalia|consecutivo|clave_fe/i
  for (const fn of ['pos_ventas_productos', 'pos_catalogo_productos', 'pos_catalogo_absorber', 'pos_producto_ajuste_guardar']) {
    it(`${fn} no nombra ninguna`, () => { expect(funcion(fn)).not.toMatch(PROHIBIDAS) })
  }
  it('ninguna tabla de pos_ndf_* recibe una policy nueva: solo el disparador', () => {
    expect(codigo).not.toMatch(/(create|alter) policy [^;]* on public\.pos_ndf_/i)
    expect(codigo).not.toMatch(/alter table public\.pos_ndf_/i)
    expect(plano(codigo)).toContain('create trigger trg_pos_catalogo_registrar after insert on public.pos_ndf_ticket_lines referencing new table as nuevas for each statement')
  })
})

describe('mig 198 — la categoría nunca decide la venta', () => {
  it('las tres copias de la lista que una persona puede elegir son iguales y = CATEGORIAS_EDITABLES', () => {
    const check = /categoria\s+text\s+check \(categoria in \(([^)]*)\)\)/.exec(codigo)
    expect(check, 'check de pos_producto_ajustes').not.toBeNull()
    const enGuardar = /p_categoria not in \(([^)]*)\)/.exec(funcion('pos_producto_ajuste_guardar'))
    const enLectura = /'categorias_editables', jsonb_build_array\(([^)]*)\)/.exec(plano(funcion('pos_catalogo_productos')))
    const tres = [check, enGuardar, enLectura].map(m => listaSql(m?.[1] ?? ''))
    for (const l of tres) expect(l).toEqual([...CATEGORIAS_EDITABLES])
    for (const l of tres) for (const c of CATEGORIAS_NO_VENTA) expect(l).not.toContain(c)
    const fijas = /'categorias_fijas',\s+jsonb_build_array\(([^)]*)\)/.exec(plano(funcion('pos_catalogo_productos')))
    expect(listaSql(fijas?.[1] ?? '')).toEqual([...CATEGORIAS_FIJAS])
  })
  it('FAMILIAS_NO_VENTA (netaVenta.ts, firmada) = el conjunto del .sql = las familias de cortesia/personal/ingredientes de la carga', () => {
    const conjunto = [...FAMILIAS_NO_VENTA].sort((a, b) => a - b)
    expect(conjunto).toEqual([6, 17, 20])
    // la neta, en la lectura
    expect(plano(funcion('pos_ventas_productos'))).toContain(`l.familia not in (${conjunto.join(', ')})`)
    // el check de pos_familias
    expect(plano(codigo)).toContain(`check ((familia in (${conjunto.join(', ')})) = (categoria in ('cortesia', 'personal', 'ingredientes')))`)
    // pos_categoria_efectiva: la familia de la línea manda sobre lo que no es venta
    const efectiva = plano(funcion('pos_categoria_efectiva'))
    expect(efectiva).toContain("when p_familia = 17 then 'cortesia' when p_familia = 6 then 'personal' when p_familia = 20 then 'ingredientes'")
    // la carga
    const noVenta = carga().filter(f => CATEGORIAS_NO_VENTA.includes(f.categoria as never)).map(f => f.familia).sort((a, b) => a - b)
    expect(noVenta).toEqual(conjunto)
  })
  it('neta_cts se calcula sin mirar categorías', () => {
    const f = plano(funcion('pos_ventas_productos'))
    const neta = f.slice(f.indexOf("'neta_cts',"), f.indexOf(') into v_out'))
    expect(neta).not.toMatch(/categoria/)
    expect(neta).toContain('l.familia is null or l.familia not in (6, 17, 20)')
  })
  it('el guardado no deja recategorizar lo que fija la familia', () => {
    expect(plano(funcion('pos_producto_ajuste_guardar'))).toContain("if p_categoria is not null and (v_fam in (6, 17, 20) or v_cat_fam in ('giftcard', 'pax', 'duenos')) then")
  })
})

/** La carga de `pos_familias` de la 198: familia, nombre, categoría y la línea entera (con su comentario). */
function carga(): { familia: number; nombre: string; categoria: string; linea: string }[] {
  const i = sql.indexOf('insert into public.pos_familias (local, familia, nombre, categoria, orden) values')
  expect(i).toBeGreaterThan(0)
  const bloque = sql.slice(i, sql.indexOf(';\n', i))
  return bloque.split('\n').slice(1).map(linea => {
    const m = /\('santa-teresa',\s*(\d+),\s*'([^']*)',\s*'([a-z_]+)'/.exec(linea)
    return m ? { familia: Number(m[1]), nombre: m[2], categoria: m[3], linea } : null
  }).filter((x): x is NonNullable<typeof x> => x !== null)
}

describe('mig 198 — la carga de familias de santa-teresa', () => {
  it('toda familia de FAMILIAS_CATALOGO (netaVenta.ts) tiene su fila, y ninguna de más', () => {
    expect(carga().map(f => f.familia).sort((a, b) => a - b)).toEqual([...FAMILIAS_CATALOGO].sort((a, b) => a - b))
  })
  // Prerrequisito de la firma (SPEC §7.3, D-4 = A): los nombres de 11, 15 y 25 (confirmar) y de 1, 9 y 27 (traer) se
  // leen en la PC del PoS. Mientras alguno diga «POR CONFIRMAR» —en el nombre o en el comentario de su fila— esta
  // prueba FALLA A PROPÓSITO: la 198 no se firma ni se mergea así (PASE-198, prerrequisitos).
  it('ningún nombre de familia queda «POR CONFIRMAR» (falla hasta que el dueño lea los seis en la PC del PoS)', () => {
    const pendientes = carga().filter(f => /POR CONFIRMAR/i.test(f.linea)).map(f => f.familia)
    expect(pendientes, `familias con el nombre sin confirmar: ${pendientes.join(', ')}`).toEqual([])
  })
})

describe('mig 198 — seguridad y vuelta atrás', () => {
  const FUNCIONES = ['pos_catalogo_absorber', 'pos_catalogo_registrar', 'pos_catalogo_refrescar', 'pos_categoria_efectiva',
    'pos_ventas_productos', 'pos_catalogo_productos', 'pos_producto_ajuste_guardar']
  it('las siete funciones tienen search_path fijo; las de la API son security definer y revocadas a public/anon', () => {
    for (const fn of FUNCIONES) expect(plano(funcion(fn)), fn).toContain('set search_path = public, pg_temp')
    for (const fn of ['pos_ventas_productos', 'pos_catalogo_productos', 'pos_producto_ajuste_guardar']) {
      expect(plano(funcion(fn))).toContain('security definer')
      expect(codigo).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`))
      expect(codigo).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`))
    }
    for (const fn of ['pos_catalogo_absorber', 'pos_catalogo_registrar', 'pos_catalogo_refrescar', 'pos_categoria_efectiva']) {
      expect(codigo).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`))
      expect(codigo).not.toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to (anon|authenticated)`))
    }
  })
  it('las tablas: RLS, una sola policy de lectura cada una, y la API solo con select', () => {
    for (const t of ['pos_familias', 'pos_productos', 'pos_producto_ajustes']) {
      expect(codigo).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security;`))
      expect((codigo.match(new RegExp(`create policy \\w+ on public\\.${t}\\b`, 'g')) ?? []).length, t).toBe(1)
    }
    expect(codigo).not.toMatch(/for (insert|update|delete|all)/i)
    expect(codigo).toContain('revoke all on table public.pos_familias, public.pos_productos, public.pos_producto_ajustes from public, anon, authenticated;')
    expect(codigo).toContain('grant select on table public.pos_familias, public.pos_productos, public.pos_producto_ajustes to authenticated;')
  })
  it('el disparador captura cualquier error (la factura entra igual)', () => {
    expect(plano(funcion('pos_catalogo_registrar'))).toMatch(/exception when others then raise warning/)
  })
  it('la guarda va antes de crear nada y conoce las siete funciones y las tres tablas', () => {
    const g = codigo.indexOf('do $guarda198$')
    expect(g).toBeGreaterThan(0)
    expect(g).toBeLessThan(codigo.indexOf('create table'))
    const guarda = codigo.slice(g, codigo.indexOf('$guarda198$;'))
    for (const fn of FUNCIONES) expect(guarda).toContain(`public.${fn}(`)
    for (const t of ['pos_familias', 'pos_productos', 'pos_producto_ajustes']) expect(guarda).toContain(`public.${t}'`)
  })
  it('la vuelta atrás saca todo lo que la 198 crea y no toca el ledger', () => {
    const rb = sinComentarios(rollback)
    expect(rb).not.toMatch(/schema_migrations/i)
    expect(rb).toContain('drop trigger if exists trg_pos_catalogo_registrar on public.pos_ndf_ticket_lines;')
    for (const fn of FUNCIONES) expect(rb).toMatch(new RegExp(`drop function if exists public\\.${fn}\\(`))
    for (const t of ['pos_familias', 'pos_productos', 'pos_producto_ajustes']) expect(rb).toContain(`drop table if exists public.${t};`)
    expect(rb.indexOf('pos_producto_ajustes;')).toBeLessThan(rb.indexOf('pos_productos;'))   // la FK primero
  })
})
