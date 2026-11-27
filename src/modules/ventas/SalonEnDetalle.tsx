// ── Ventas v2 · 3.5.2 · «Resumen» → «Salón en detalle» (SPEC-ventas-v2 §5.1 ítem 10) ──────────────
//
// Lo que mostraba «Hoy» del salón, para el período de la barra: precio promedio por plato y por bebida,
// bebidas por persona, relación comida/bebida, comidas y bebidas (₡ y unidades), venta de los saloneros,
// los productos más vendidos (hasta que exista «Productos», 3.2) y el 📤 para compartir. Las cuentas son
// las de «Hoy» (`salonDetalle.ts`). Necesita las LÍNEAS del PoS: se leen recién al abrir el desplegable
// (`lineasPeriodo.ts`), así abrir «Resumen» no las baja.
// 3.2b (SPEC-ventas-v2 §4.1): «Bebidas por persona» sale del catálogo por código (`pos_ventas_productos`, mig 198):
// bebidas VENDIDAS de salón × «rinde» ÷ las personas de salón de la venta por persona de «Resumen» (cargadas +
// estimadas). Se lee al abrir el desplegable, en paralelo con las líneas; si falla, se ve «—» y el resto sigue igual.
// 3.2c: de la misma lectura sale el «Ratio C/B»: neta de categoría comida ÷ de categoría bebida, en salón (la
// clasificación de «Productos»). La de antes (familias de los meseros) queda al lado.
import { useEffect, useMemo, useState } from 'react'
import type { Meta } from '../../shared/types/ventas'
import type { Rango } from './periodos'
import { cargarLineasPeriodo, fechasDe, type LineasPeriodo } from './lineasPeriodo'
import { masVendidos, salonEnDetalle, textoCompartir, type OrdenProductos, type VistaProductos } from './salonDetalle'
import { fi, getMeta, metaColor, ratioCBClass } from './ventasUtils'
import { getVentasProductos } from '../../shared/api/posNdf'
import { bebidasPorPersona, ratioComidaBebida, type BebidasPorPersona, type RatioComidaBebida } from './productosV2'

async function compartir(text: string, setCopiado: (v: boolean) => void) {
  if (navigator.share) {
    try { await navigator.share({ text }); return } catch { /* sigue con el portapapeles */ }
  }
  try {
    await navigator.clipboard.writeText(text)
    setCopiado(true); setTimeout(() => setCopiado(false), 2500)
  } catch { window.prompt('Copiá el texto:', text) }
}

interface Props {
  local:      string
  nombreLocal: string
  periodo:    Rango
  /** El período en palabras («1 al 17 de noviembre»): va en el 📤. */
  rotulo:     string
  metas?:     Meta
  /** Abierto al entrar (pruebas). */
  abierto?:   boolean
  /**
   * Personas de salón del período (las de la venta por persona de «Resumen»: cargadas + estimadas, sin mesas de dueños
   * ni regalías totales) y su % estimado. Sin esto, «Bebidas por persona» muestra la cifra de antes.
   */
  personas?:  { total: number; pctEstimado: number } | null
}

/** Lo que muestra la tarjeta «Bebidas por persona» (3.2b). */
type EstadoBebidas = { estado: 'leyendo' } | { estado: 'error' } | { estado: 'listo'; b: BebidasPorPersona; r: RatioComidaBebida; pctEstimado: number }

export default function SalonEnDetalle({ local, nombreLocal, periodo, rotulo, metas, abierto = false, personas = null }: Props) {
  const [abrio, setAbrio] = useState(abierto)
  const clave = `${local}|${periodo.desde}|${periodo.hasta}`
  const [lineas, setLineas] = useState<{ clave: string; l: LineasPeriodo } | null>(null)
  const [fallo, setFallo] = useState<{ clave: string; msg: string } | null>(null)
  useEffect(() => {
    if (!abrio) return
    let vivo = true
    cargarLineasPeriodo(local, periodo)
      .then(l => { if (vivo) setLineas({ clave, l }) })
      .catch(e => { if (vivo) setFallo({ clave, msg: e instanceof Error ? e.message : 'No se pudo leer el PoS' }) })
    return () => { vivo = false }
  }, [abrio, clave, local, periodo])

  const [beb, setBeb] = useState<{ clave: string; e: EstadoBebidas } | null>(null)
  const totalPersonas = personas?.total ?? null
  const pctEstimado = personas?.pctEstimado ?? 0
  useEffect(() => {
    if (!abrio || totalPersonas === null) return
    let vivo = true
    getVentasProductos(local, periodo.desde, periodo.hasta)
      .then(rpc => { if (vivo) setBeb({ clave, e: { estado: 'listo', b: bebidasPorPersona(rpc, totalPersonas), r: ratioComidaBebida(rpc), pctEstimado } }) })
      .catch(() => { if (vivo) setBeb({ clave, e: { estado: 'error' } }) })
    return () => { vivo = false }
  }, [abrio, clave, local, periodo, totalPersonas, pctEstimado])

  const l = lineas && lineas.clave === clave ? lineas.l : null
  const error = fallo && fallo.clave === clave ? fallo.msg : null
  const bebidas: EstadoBebidas | null = totalPersonas === null ? null : beb && beb.clave === clave ? beb.e : { estado: 'leyendo' }
  return (
    <details className="vt2-detalle" data-bloque="salon-detalle" open={abrio}
      onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) setAbrio(true) }}>
      <summary>Salón en detalle (platos, bebidas y lo más vendido)</summary>
      {abrio && error && <div className="tips-error" role="alert"><span>No se pudo leer el PoS: {error}</span></div>}
      {abrio && !l && !error && <div className="vt2-cargando" role="status">Leyendo las líneas del PoS…</div>}
      {l && <Contenido l={l} periodo={periodo} rotulo={rotulo} nombreLocal={nombreLocal} metas={metas} bebidas={bebidas} />}
    </details>
  )
}

function Contenido({ l, periodo, rotulo, nombreLocal, metas, bebidas }: {
  l: LineasPeriodo; periodo: Rango; rotulo: string; nombreLocal: string; metas?: Meta; bebidas: EstadoBebidas | null
}) {
  const { dias, pm } = l
  const d = useMemo(() => salonEnDetalle(dias, pm, fechasDe(dias, periodo)), [dias, pm, periodo])
  const [vista, setVista] = useState<VistaProductos>('general')
  const [orden, setOrden] = useState<OrdenProductos>('monto')
  const [salonero, setSalonero] = useState('')
  const [copiado, setCopiado] = useState(false)
  const prods = masVendidos(d, dias, pm, vista, orden, salonero)
  const metaBebPax = metas ? getMeta(metas, '', 'bebPax') : 0

  if (d.fechas.length === 0) return <p className="vt2-nota">No hay ventas del PoS en este período.</p>
  return (
    <div data-bloque="salon-detalle-contenido">
      <div className="vt-table-actions">
        {d.totales.ventaNeta > 0 && (
          <button type="button" className="vt-period-btn" aria-label="Compartir el resumen"
            onClick={() => compartir(textoCompartir(d, rotulo, nombreLocal, bebidas?.estado === 'listo' ? bebidas.b.valor : null, bebidas?.estado === 'listo' ? bebidas.r.valor : null), setCopiado)}>
            {copiado ? '✓ Copiado' : '📤 Compartir'}
          </button>
        )}
      </div>
      <div className="vt-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))' }}>
        <div className="vt-kpi" data-salon="ventaSaloneros" title="Lo que vendieron los saloneros (con su delivery), sin la caja.">
          <div className="vt-kpi-label">Venta de saloneros</div><div className="vt-kpi-val">{fi(d.gen.total)}</div>
          <div className="vt-kpi-sub">sin la caja; con su delivery</div>
        </div>
        <div className="vt-kpi" data-salon="promPlato"><div className="vt-kpi-label">Prom/Plato</div><div className="vt-kpi-val">{fi(d.promPlato)}</div></div>
        <div className="vt-kpi" data-salon="promBebida"><div className="vt-kpi-label">Prom/Bebida</div><div className="vt-kpi-val">{fi(d.promBebida)}</div></div>
        {bebidas === null ? (
          <div className="vt-kpi" data-salon="bebPax"><div className="vt-kpi-label">Bebidas/PAX</div>
            <div className="vt-kpi-val" style={{ color: metaColor(d.gen.bebPax, metaBebPax) }}>{d.gen.bebPax.toFixed(2)}</div>
            <div className="vt-kpi-sub">bebidas ÷ PAX de los saloneros</div>
          </div>
        ) : (
          <div className="vt-kpi" data-salon="bebPax" title="Bebidas vendidas en salón (sin las incluidas en ₡0, con «rinde») ÷ personas de salón (las de la venta por persona).">
            <div className="vt-kpi-label">Bebidas por persona</div>
            <div className="vt-kpi-val" data-testid="beb-pax-valor"
              style={bebidas.estado === 'listo' && bebidas.b.valor !== null ? { color: metaColor(bebidas.b.valor, metaBebPax) } : undefined}>
              {bebidas.estado === 'listo' ? (bebidas.b.valor === null ? '—' : bebidas.b.valor.toFixed(2).replace('.', ',')) : bebidas.estado === 'leyendo' ? '…' : '—'}
            </div>
            <div className="vt-kpi-sub" data-testid="beb-pax-sub">
              {bebidas.estado === 'listo'
                ? <>{bebidas.b.vendidas.toLocaleString('es-CR')} vendidas en salón{bebidas.pctEstimado > 0 ? ` · personas: incluye ${bebidas.pctEstimado.toFixed(1).replace('.', ',')} % estimado` : ''}{bebidas.b.incluidas > 0 ? ` · + ${bebidas.b.incluidas.toLocaleString('es-CR')} incluidas en menú` : ''}</>
                : bebidas.estado === 'leyendo' ? 'leyendo el catálogo del PoS…' : 'no se pudo leer el catálogo del PoS'}
              <span className="vt2-sub" data-testid="beb-pax-antes">antes: {d.gen.bebPax.toFixed(2).replace('.', ',')} (familia 5 de los meseros ÷ su PAX)</span>
            </div>
          </div>
        )}
        {bebidas === null ? (
          <div className="vt-kpi" data-salon="ratioCB"><div className="vt-kpi-label">Ratio C/B (₡)</div>
            <div className={`vt-kpi-val ${ratioCBClass(d.ratioCB)}`}>{d.ratioCB.toFixed(2)}:1</div>
          </div>
        ) : (
          <div className="vt-kpi" data-salon="ratioCB" title="Venta de comida ÷ venta de bebida en salón, por la categoría del catálogo (la de «Productos»).">
            <div className="vt-kpi-label">Ratio C/B (₡)</div>
            <div data-testid="ratio-cb-valor"
              className={`vt-kpi-val ${bebidas.estado === 'listo' && bebidas.r.valor !== null ? ratioCBClass(bebidas.r.valor) : ''}`}>
              {bebidas.estado === 'listo' ? (bebidas.r.valor === null ? '—' : `${bebidas.r.valor.toFixed(2).replace('.', ',')}:1`) : bebidas.estado === 'leyendo' ? '…' : '—'}
            </div>
            <div className="vt-kpi-sub" data-testid="ratio-cb-sub">
              {bebidas.estado === 'error' ? 'no se pudo leer el catálogo del PoS' : 'comida ÷ bebida en salón, por categoría'}
              <span className="vt2-sub" data-testid="ratio-cb-antes">antes: {d.ratioCB.toFixed(2).replace('.', ',')}:1 (familias de los meseros)</span>
            </div>
          </div>
        )}
        <div className="vt-kpi" data-salon="comidas" title="₡ por familia del PoS (comida = 2·3·4·13·16·29). No es la neta: la caja no trae desglose comida/bebida.">
          <div className="vt-kpi-label">Comidas</div><div className="vt-kpi-val" style={{ fontSize: '0.85rem' }}>{fi(d.com)}</div>
          <div className="vt-kpi-sub">{d.gen.iCom} platos · no neta</div>
        </div>
        <div className="vt-kpi blue" data-salon="bebidas" title="₡ por familia del PoS (bebida = familia 5). No es la neta: la caja no trae desglose comida/bebida.">
          <div className="vt-kpi-label">Bebidas</div><div className="vt-kpi-val" style={{ fontSize: '0.85rem' }}>{fi(d.beb)}</div>
          <div className="vt-kpi-sub">{d.gen.iBeb} bebidas · no neta</div>
        </div>
      </div>

      <div className="vt-sl" style={{ marginTop: '1rem' }}>Lo más vendido del período</div>
      <div className="vt-prod-controls">
        <div className="vt-tab-group">
          {(['general', 'comidas', 'bebidas'] as const).map(v => (
            <button key={v} type="button" className={`vt-tab-btn ${vista === v ? 'active' : ''}`} onClick={() => setVista(v)}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <div className="vt-tab-group">
          {(['monto', 'unidades'] as const).map(v => (
            <button key={v} type="button" className={`vt-tab-btn ${orden === v ? 'active' : ''}`} onClick={() => setOrden(v)}>Por {v}</button>
          ))}
        </div>
        <div className="vt-sal-pills">
          <button type="button" className={`vt-sal-pill ${salonero === '' ? 'active' : ''}`} onClick={() => setSalonero('')}>General</button>
          {d.saloneros.map(s => (
            <button key={s.nombre} type="button" className={`vt-sal-pill ${salonero === s.nombre ? 'active' : ''}`}
              onClick={() => setSalonero(s.nombre)}>{s.nombre}</button>
          ))}
        </div>
      </div>
      <div className="vt-prod-list" data-bloque="mas-vendidos">
        {prods.map((p, i) => (
          <div key={p.nombre} className="vt-prod-row">
            <div className="vt-prod-rank">{i + 1}</div>
            <div className="vt-prod-name">
              {p.nombre}
              {pm[p.nombre] && <span className={`vt-prod-tipo ${pm[p.nombre].tipo}`}>{pm[p.nombre].tipo}</span>}
            </div>
            <div className="vt-prod-stats"><span>{p.q} uds</span><span>{fi(p.m)}</span></div>
          </div>
        ))}
        {prods.length === 0 && <div style={{ color: 'var(--c-gris)', padding: '1rem', textAlign: 'center', fontSize: '0.85rem' }}>Sin datos de productos</div>}
      </div>
    </div>
  )
}
