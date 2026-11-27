// ── Ventas v2 · 3.2 — «Productos» definitiva (SPEC-ventas-v2 §5.2; SPEC-3.1-catalogo §2.5, §7.3 paso 4, §9.5) ─────
//
// Lee el catálogo por código (`pos_ventas_productos`, mig 198): una lectura del período y una por cada base de
// «Comparar con» (tope de 3 pedidos; no baja líneas). La categoría de cada producto la decide la base; la venta neta,
// la familia de la línea (cierra contra «Resumen» al céntimo). Con la barra global (local, período, comparación).
//
// Muestra: bajada · mix por categoría (participación, cambio en puntos contra cada base, venta, unidades, precio por
// ítem; se abre a familia y producto) · suben y bajan · los más vendidos · sin ventas en el período · popularidad de
// comida (ingeniería de menú, eje de popularidad; owner y manager, §6) · últimos 12 meses (a pedido) · lo que no es
// venta, aparte. Canal: todos, salón, delivery o para llevar.
//
// Convive con «Mix» e «Ing. Menú» viejos (sub-vistas de «Productos») hasta la 3.6, que los retira (SPEC §9).
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { getVentasProductos, type VentasProductosRpc } from '../../shared/api/posNdf'
import BarraVentasV2 from './BarraVentasV2'
import { baseConFechas, basesALeer, basesDe, escribirBarra, leerBarra, periodoDeBarra } from './barraVentasV2'
import { fechasCortas, type BaseId } from './periodos'
import { getLocalesVentas, type LocalVentas } from './resumenV2Datos'
import { LOCAL_POR_DEFECTO } from './ventasDiasDesdePos'
import { localPorDefecto } from '../../shared/utils/ordenLocales'
import { fi } from './ventasUtils'
import {
  CANALES_PRODUCTOS, ROLES_INGENIERIA, cambioEnPuntos, categoriaQueMasMovio, masVendidos, mesesPorCategoria, mixDelPeriodo, popularidad,
  rangoDoceMeses, sinVentas, subenYBajan, type CanalProductos, type MixV2,
} from './productosV2'
import { rotuloCategoria } from './catalogoAjustes'

const colones = (cts: number) => fi(Math.round(cts / 100))
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')} %`
const num = (x: number) => Math.round(x).toLocaleString('es-CR')
const puntos = (p: number | null) => {
  if (p === null) return '—'
  if (Math.abs(p) < 0.05) return '0,0 pts'
  return `${p > 0 ? '+' : '−'}${Math.abs(p).toFixed(1).replace('.', ',')} pts`
}
const claseDelta = (p: number | null) => (p === null || Math.abs(p) < 0.05 ? 'gris' : p > 0 ? 'sube' : 'baja')
const esCanal = (s: string | null): s is CanalProductos => !!s && CANALES_PRODUCTOS.some(c => c.id === s)

type Rango = { desde: string; hasta: string }
interface Lectura { clave: string; periodo: VentasProductosRpc; bases: Partial<Record<BaseId, VentasProductosRpc>> }

export default function VentasProductos() {
  const { profile } = useAuth()
  const role = profile?.role ?? ''
  const [sp, setSp] = useSearchParams()
  const estado = useMemo(() => leerBarra(sp), [sp])
  const { tipo, dia, desde, hasta } = estado
  const { periodo, aviso } = useMemo(() => periodoDeBarra({ tipo, dia, desde, hasta }), [tipo, dia, desde, hasta])
  const canalUrl = sp.get('canal')
  const canal: CanalProductos = esCanal(canalUrl) ? canalUrl : 'todos'

  const [locales, setLocales] = useState<LocalVentas[]>([])
  useEffect(() => {
    let vivo = true
    getLocalesVentas(role).then(l => { if (vivo) setLocales(l) }).catch(() => { if (vivo) setLocales([]) })
    return () => { vivo = false }
  }, [role])
  // D16: el de la URL si lo ve; si no, Santa Teresa; si no, el primero que ve (igual que «Resumen»).
  const local = locales.length === 0
    ? (estado.local ?? LOCAL_POR_DEFECTO)
    : (localPorDefecto(locales, estado.local) ?? LOCAL_POR_DEFECTO)

  // Qué se lee: el período y las bases de «Comparar con» que existen (una base sin datos es null y no se pide).
  const aLeer = useMemo(() => {
    const ids = [...new Set(basesALeer(estado.comparar))]
    return ids.flatMap(id => {
      const b = periodo.bases[id]
      return b ? [{ id, r: { desde: b.desde, hasta: b.hasta } as Rango }] : []
    })
  }, [estado.comparar, periodo])
  const clave = `${local}|${periodo.desde}|${periodo.hasta}|${aLeer.map(b => `${b.id}:${b.r.desde}:${b.r.hasta}`).join(',')}`

  const [lectura, setLectura] = useState<Lectura | null>(null)
  const [fallo, setFallo] = useState<{ clave: string; msg: string } | null>(null)
  useEffect(() => {
    if (periodo.tipo === 'hoy') return
    let vivo = true
    Promise.all([
      getVentasProductos(local, periodo.desde, periodo.hasta),
      ...aLeer.map(b => getVentasProductos(local, b.r.desde, b.r.hasta)),
    ])
      .then(([p, ...bs]) => {
        if (!vivo) return
        setLectura({ clave, periodo: p, bases: Object.fromEntries(aLeer.map((b, i) => [b.id, bs[i]])) })
      })
      .catch(e => { if (vivo) setFallo({ clave, msg: e instanceof Error ? e.message : 'No se pudo leer el PoS' }) })
    return () => { vivo = false }
  }, [clave, local, periodo, aLeer])

  const cambiarCanal = (c: CanalProductos) => {
    const n = new URLSearchParams(sp)
    if (c === 'todos') n.delete('canal'); else n.set('canal', c)
    setSp(n)
  }

  const barra = <BarraVentasV2 estado={estado} periodo={periodo} locales={locales} aviso={aviso}
    onCambio={e => setSp(escribirBarra(sp, e))} />

  if (periodo.tipo === 'hoy') {
    return (
      <div className="vt-section">
        {barra}
        <div className="vt2-hoy">Hoy está en curso: los productos del día se miran cuando cierra (o en «En vivo»). Elegí «Ayer» u otro período.</div>
      </div>
    )
  }

  const error = fallo && fallo.clave === clave ? fallo.msg : null
  const l = lectura && lectura.clave === clave ? lectura : null
  return (
    <div className="vt-section" data-vista="productos-v2">
      {barra}
      <div className="vt2-barra-fila" role="group" aria-label="Canal" style={{ marginBottom: '0.75rem' }}>
        {CANALES_PRODUCTOS.map(c => (
          <button key={c.id} type="button" className={`vt-tab-btn ${canal === c.id ? 'active' : ''}`}
            aria-pressed={canal === c.id} style={{ minHeight: 44 }} onClick={() => cambiarCanal(c.id)}>{c.label}</button>
        ))}
      </div>
      {error && <div className="tips-error" role="alert"><span>No se pudo leer el PoS: {error}</span></div>}
      {!l && !error && (
        <div className="vt2-cargando" role="status">
          Leyendo los productos del PoS{periodo.dias > 62 ? ' (período largo: puede tardar unos segundos)' : ''}…
        </div>
      )}
      {l && <Contenido l={l} periodo={periodo} bases={basesDe(estado.comparar)} canal={canal} local={local}
        veIngenieria={ROLES_INGENIERIA.includes(role)} />}
    </div>
  )
}

type Periodo = ReturnType<typeof periodoDeBarra>['periodo']

function Contenido({ l, periodo, bases, canal, local, veIngenieria }: {
  l: Lectura; periodo: Periodo; bases: BaseId[]; canal: CanalProductos; local: string; veIngenieria: boolean
}) {
  const mix = useMemo(() => mixDelPeriodo(l.periodo, canal), [l, canal])
  const mixBases = useMemo(() => Object.fromEntries(bases.map(id => {
    const r = l.bases[id]
    return [id, r ? mixDelPeriodo(r, canal) : null]
  })) as Record<BaseId, MixV2 | null>, [l, bases, canal])
  const fechas = fechasCortas(periodo, Number(periodo.ancla.slice(0, 4)))
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const alternar = (k: string) => setAbiertas(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const vacio = mix.categorias.length === 0 && mix.sinDetalleCts === 0 && mix.fueraDeVenta.length === 0
  if (vacio) {
    return <div className="vt2-hoy" data-testid="productos-vacio">En {fechas} no hay ventas registradas en el PoS{canal !== 'todos' ? ' para este canal' : ''}.</div>
  }

  const base0 = bases[0]
  const mix0 = base0 ? mixBases[base0] : null
  const movio = categoriaQueMasMovio(mix, mix0)
  const rpcBase0 = base0 ? l.bases[base0] ?? null : null
  const sube = rpcBase0 ? subenYBajan(l.periodo, rpcBase0, canal) : null
  const top = masVendidos(l.periodo, canal)
  const sin = sinVentas(l.periodo, periodo.desde)
  const pop = veIngenieria ? popularidad(l.periodo, 'comida', canal) : null

  return (
    <>
      <p className="vt2-bajada" data-testid="productos-bajada">
        {movio.categoria
          ? movio.puntos !== null && base0
            ? `${movio.categoria.rotulo} es la que más movió el mix: ${pct(movio.categoria.participacion)} de la venta, ${puntos(movio.puntos)} contra ${baseConFechas(periodo, base0)}.`
            : `${movio.categoria.rotulo} es la mayor parte de la venta: ${pct(movio.categoria.participacion)} en ${fechas}.`
          : `En ${fechas} no hay venta de carta.`}
      </p>

      <div className="vt-sl" role="heading" aria-level={3}>Mix por categoría</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="vt-tbl" aria-label="Mix por categoría">
          <thead>
            <tr>
              <th>Categoría</th>
              <th className="r">% de la venta</th>
              {bases.map(id => <th key={id} className="r" data-base={id}>vs {baseConFechas(periodo, id)}</th>)}
              <th className="r">Venta</th>
              <th className="r">Unidades</th>
              <th className="r">Precio por ítem</th>
            </tr>
          </thead>
          <tbody>
            {mix.categorias.map(c => {
              const kc = `c:${c.categoria}`
              const abierta = abiertas.has(kc)
              return (
                <Fragment key={kc}>
                  <tr data-categoria={c.categoria}>
                    <td>
                      <button type="button" aria-expanded={abierta} style={{ minHeight: 44, background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                        onClick={() => alternar(kc)}>{abierta ? '▾' : '▸'} <strong>{c.rotulo}</strong></button>
                    </td>
                    <td className="r">{pct(c.participacion)}</td>
                    {bases.map(id => {
                      const p = cambioEnPuntos(mix, mixBases[id], c.categoria)
                      return <td key={id} className="r"><span className={`vt2-delta ${claseDelta(p)}`}>{puntos(p)}</span></td>
                    })}
                    <td className="r">{colones(c.montoCts)}</td>
                    <td className="r">{num(c.unidades)}{c.unidadesCero > 0 && <span className="vt2-sub">{num(c.unidadesCero)} incluidas en ₡0</span>}</td>
                    <td className="r">{c.precioItemCts === null ? 'incluido' : colones(c.precioItemCts)}</td>
                  </tr>
                  {abierta && c.familias.map(f => {
                    const kf = `${kc}|f:${f.familia}`
                    const af = abiertas.has(kf)
                    return (
                      <Fragment key={kf}>
                        <tr data-familia={f.familia ?? 'sin'} className="vt2-sub-fila">
                          <td style={{ paddingLeft: '1.25rem' }}>
                            <button type="button" aria-expanded={af} style={{ minHeight: 44, background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                              onClick={() => alternar(kf)}>{af ? '▾' : '▸'} {f.nombre}</button>
                          </td>
                          <td className="r">{mix.netaCts ? pct(f.montoCts / mix.netaCts) : '—'}</td>
                          {bases.map(id => <td key={id} />)}
                          <td className="r">{colones(f.montoCts)}</td>
                          <td className="r">{num(f.unidades)}</td>
                          <td />
                        </tr>
                        {af && f.productos.map(p => (
                          <tr key={`${kf}|${p.clave}`} data-producto={p.codigo ?? p.nombre}>
                            <td style={{ paddingLeft: '2.5rem' }}>{p.nombre}{p.rinde > 1 && <span className="vt2-sub">rinde {p.rinde}</span>}</td>
                            <td className="r">{mix.netaCts ? pct(p.montoCts / mix.netaCts) : '—'}</td>
                            {bases.map(id => <td key={id} />)}
                            <td className="r">{colones(p.montoCts)}</td>
                            <td className="r">{num(p.unidades)}{p.unidadesCero > 0 && <span className="vt2-sub">{num(p.unidadesCero)} en ₡0</span>}</td>
                            <td className="r">{p.precioItemCts === null ? 'incluido' : colones(p.precioItemCts)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    )
                  })}
                </Fragment>
              )
            })}
            {mix.sinDetalleCts !== 0 && (
              <tr data-categoria="sin-detalle">
                <td>Facturas sin detalle<span className="vt2-sub">facturas que llegaron sin líneas: su valor servido</span></td>
                <td className="r">{pct(mix.netaCts ? mix.sinDetalleCts / mix.netaCts : 0)}</td>
                {bases.map(id => <td key={id} />)}
                <td className="r">{colones(mix.sinDetalleCts)}</td>
                <td /><td />
              </tr>
            )}
            <tr className="vt2-total" data-categoria="total">
              <td>Venta neta</td>
              <td className="r">{mix.netaCts ? '100,0 %' : '—'}</td>
              {bases.map(id => <td key={id} />)}
              <td className="r" data-testid="productos-neta">{colones(mix.netaCts)}</td>
              <td /><td />
            </tr>
          </tbody>
        </table>
      </div>
      {!mix.cierra && <div className="vt2-aviso" role="alert">Las categorías no cierran contra la venta neta: avisá al equipo técnico.</div>}
      <p className="vt2-nota">
        La venta neta es la misma de «Resumen» ({fechas}{canal !== 'todos' ? `, ${CANALES_PRODUCTOS.find(c => c.id === canal)?.label.toLowerCase()}` : ''}).
        La categoría de cada producto sale de su familia del PoS o de «Ajustes → Catálogo»; nunca cambia la venta.
        Las unidades en ₡0 (pasos de un menú cerrado, invitaciones) se cuentan aparte y no bajan el precio por ítem.
        {canal !== 'todos' && ' Con un canal elegido no entran las facturas sin detalle.'}
      </p>
      {mix.fueraDeVenta.some(f => f.montoCts > 0 || f.unidades > 0) && (
        <p className="vt2-nota" data-bloque="fuera-de-venta">
          Fuera de la venta (no suma): {mix.fueraDeVenta.map(f => `${f.rotulo} ${colones(f.montoCts)} (${num(f.unidades)} uds)`).join(' · ')}. El detalle está en «Regalías».
        </p>
      )}

      <div className="vt-sl" role="heading" aria-level={3}>Suben y bajan</div>
      {!sube || !base0 ? (
        <p className="vt2-nota" data-bloque="suben-sin-base">Sin comparación para este período: elegí otra base en «Comparar con».</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '0.75rem' }} data-bloque="suben-y-bajan">
          {([['suben', 'Los que más ganaron', sube.suben], ['bajan', 'Los que más perdieron', sube.bajan]] as const).map(([id, titulo, lista]) => (
            <div key={id} data-lista={id}>
              <div className="vt2-nota"><strong>{titulo}</strong> · vs {baseConFechas(periodo, base0)}</div>
              {lista.length === 0 ? <div className="vt2-nota">Ninguno.</div> : (
                <table className="vt-tbl" aria-label={titulo}>
                  <tbody>
                    {lista.map(m => (
                      <tr key={m.clave}>
                        <td>{m.nombre}<span className="vt2-sub">{rotuloCategoria(m.categoria)}</span></td>
                        <td className="r">{colones(m.actualCts)}<span className="vt2-sub">antes {colones(m.baseCts)}</span></td>
                        <td className="r"><span className={`vt2-delta ${m.deltaCts > 0 ? 'sube' : 'baja'}`}>{m.deltaCts > 0 ? '+' : '−'}{colones(Math.abs(m.deltaCts))}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="vt-sl" role="heading" aria-level={3}>Los más vendidos</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="vt-tbl" aria-label="Los más vendidos">
          <thead><tr><th>Producto</th><th className="r">Venta</th><th className="r">Unidades</th><th className="r">Precio por ítem</th></tr></thead>
          <tbody>
            {top.map(p => (
              <tr key={`${p.clave}|${p.categoria}`}>
                <td>{p.nombre}<span className="vt2-sub">{rotuloCategoria(p.categoria)}</span></td>
                <td className="r">{colones(p.montoCts)}</td>
                <td className="r">{num(p.unidades)}</td>
                <td className="r">{p.precioItemCts === null ? 'incluido' : colones(p.precioItemCts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pop && pop.productos.length > 0 && (
        <details className="vt2-detalle" data-bloque="popularidad">
          <summary>Ingeniería de menú · popularidad de comida ({pop.productos.filter(p => p.popular).length} de {pop.productos.length} populares)</summary>
          <p className="vt2-nota">
            Popular = su parte de las unidades servidas pasa de 0,70 ÷ {pop.productos.length} platos ({pct(pop.umbral)}). Cuenta todo lo
            servido, también lo incluido en ₡0, y el «rinde». El eje de margen llega con los costos por código (Inventario);
            mientras tanto el margen con los costos cargados a mano sigue en «Ing. Menú».
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="vt-tbl" aria-label="Popularidad de comida">
              <thead><tr><th>Plato</th><th className="r">Servidas</th><th className="r">% de unidades</th><th>Popular</th></tr></thead>
              <tbody>
                {pop.productos.map(p => (
                  <tr key={p.clave} data-popular={p.popular ? 'si' : 'no'}>
                    <td>{p.nombre}{p.incluido && <span className="vt2-sub">incluido (₡0)</span>}</td>
                    <td className="r">{num(p.servidas)}</td>
                    <td className="r">{pct(p.participacionUnidades)}</td>
                    <td>{p.popular ? 'Sí' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <details className="vt2-detalle" data-bloque="sin-ventas">
        <summary>Sin ventas en el período ({sin.length})</summary>
        <p className="vt2-nota">Productos de la carta vistos en el PoS desde 90 días antes de {fechas} que no vendieron nada en el período.</p>
        {sin.length === 0 ? <div className="vt2-nota">Todos los productos activos vendieron.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="vt-tbl" aria-label="Sin ventas en el período">
              <thead><tr><th>Producto</th><th>Familia</th><th className="r">Última vez</th></tr></thead>
              <tbody>
                {sin.map(s => (
                  <tr key={s.codigo}><td>{s.nombre}<span className="vt2-sub">{rotuloCategoria(s.categoria)}</span></td><td>{s.familiaNombre}</td><td className="r">{s.vistoHasta}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      <DoceMeses local={local} hasta={periodo.hasta} canal={canal} />

      <p className="vt2-nota" data-bloque="productos-falta">
        Todavía no se ve acá: el segundo nivel de bebida (cervezas, vinos, cocteles), que llega del PoS con la 3.1c; las
        bebidas por persona siguen en «Resumen → Salón en detalle».
      </p>
    </>
  )
}

/** Los últimos 12 meses por categoría (D5): un pedido más, solo al abrirlo. */
function DoceMeses({ local, hasta, canal }: { local: string; hasta: string; canal: CanalProductos }) {
  const rango = useMemo(() => rangoDoceMeses(hasta), [hasta])
  const clave = `${local}|${rango.desde}|${rango.hasta}`
  const [abierto, setAbierto] = useState(false)
  const [datos, setDatos] = useState<{ clave: string; rpc: VentasProductosRpc } | null>(null)
  const [fallo, setFallo] = useState<{ clave: string; msg: string } | null>(null)
  useEffect(() => {
    if (!abierto) return
    let vivo = true
    getVentasProductos(local, rango.desde, rango.hasta)
      .then(rpc => { if (vivo) setDatos({ clave, rpc }) })
      .catch(e => { if (vivo) setFallo({ clave, msg: e instanceof Error ? e.message : 'No se pudo leer el PoS' }) })
    return () => { vivo = false }
  }, [abierto, clave, local, rango])
  const d = datos && datos.clave === clave ? datos.rpc : null
  const error = fallo && fallo.clave === clave ? fallo.msg : null
  const meses = d ? mesesPorCategoria(d, canal) : []
  const cats = [...new Set(meses.flatMap(m => Object.keys(m.porCategoria)))]
  const orden = ['comida', 'bebida', 'menu_especial', 'extras', 'otros', 'merch', 'giftcard', 'pax', 'duenos']
  cats.sort((a, b) => orden.indexOf(a) - orden.indexOf(b))
  return (
    <details className="vt2-detalle" data-bloque="doce-meses" onToggle={e => setAbierto((e.target as HTMLDetailsElement).open)}>
      <summary>Últimos 12 meses por categoría</summary>
      {error && <div className="tips-error" role="alert"><span>No se pudo leer el PoS: {error}</span></div>}
      {abierto && !d && !error && <div className="vt2-cargando" role="status">Leyendo 12 meses del PoS…</div>}
      {d && (
        <div style={{ overflowX: 'auto' }}>
          <table className="vt-tbl" aria-label="Últimos 12 meses por categoría">
            <thead><tr><th>Mes</th>{cats.map(c => <th key={c} className="r">{rotuloCategoria(c)}</th>)}<th className="r">Venta del mes</th></tr></thead>
            <tbody>
              {meses.map(m => (
                <tr key={m.mes}>
                  <td>{m.mes}</td>
                  {cats.map(c => <td key={c} className="r">{m.netaCts ? pct((m.porCategoria[c] ?? 0) / m.netaCts) : '—'}</td>)}
                  <td className="r">{colones(m.netaCts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="vt2-nota">Del {rango.desde} al {rango.hasta}. % de la venta de cada mes, sin las facturas sin detalle.</p>
        </div>
      )}
    </details>
  )
}
