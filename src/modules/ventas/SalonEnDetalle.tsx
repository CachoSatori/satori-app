// ── Ventas v2 · 3.5.2 · «Resumen» → «Salón en detalle» (SPEC-ventas-v2 §5.1 ítem 10) ──────────────
//
// Lo que mostraba «Hoy» del salón, para el período de la barra: precio promedio por plato y por bebida,
// bebidas por persona, relación comida/bebida, comidas y bebidas (₡ y unidades), venta de los saloneros,
// los productos más vendidos (hasta que exista «Productos», 3.2) y el 📤 para compartir. Las cuentas son
// las de «Hoy» (`salonDetalle.ts`). Necesita las LÍNEAS del PoS: se leen recién al abrir el desplegable
// (`lineasPeriodo.ts`), así abrir «Resumen» no las baja.
import { useEffect, useMemo, useState } from 'react'
import type { Meta } from '../../shared/types/ventas'
import type { Rango } from './periodos'
import { cargarLineasPeriodo, fechasDe, type LineasPeriodo } from './lineasPeriodo'
import { masVendidos, salonEnDetalle, textoCompartir, type OrdenProductos, type VistaProductos } from './salonDetalle'
import { fi, getMeta, metaColor, ratioCBClass } from './ventasUtils'

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
}

export default function SalonEnDetalle({ local, nombreLocal, periodo, rotulo, metas, abierto = false }: Props) {
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

  const l = lineas && lineas.clave === clave ? lineas.l : null
  const error = fallo && fallo.clave === clave ? fallo.msg : null
  return (
    <details className="vt2-detalle" data-bloque="salon-detalle" open={abrio}
      onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) setAbrio(true) }}>
      <summary>Salón en detalle (platos, bebidas y lo más vendido)</summary>
      {abrio && error && <div className="tips-error" role="alert"><span>No se pudo leer el PoS: {error}</span></div>}
      {abrio && !l && !error && <div className="vt2-cargando" role="status">Leyendo las líneas del PoS…</div>}
      {l && <Contenido l={l} periodo={periodo} rotulo={rotulo} nombreLocal={nombreLocal} metas={metas} />}
    </details>
  )
}

function Contenido({ l, periodo, rotulo, nombreLocal, metas }: { l: LineasPeriodo; periodo: Rango; rotulo: string; nombreLocal: string; metas?: Meta }) {
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
            onClick={() => compartir(textoCompartir(d, rotulo, nombreLocal), setCopiado)}>
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
        <div className="vt-kpi" data-salon="bebPax"><div className="vt-kpi-label">Bebidas/PAX</div>
          <div className="vt-kpi-val" style={{ color: metaColor(d.gen.bebPax, metaBebPax) }}>{d.gen.bebPax.toFixed(2)}</div>
          <div className="vt-kpi-sub">bebidas ÷ PAX de los saloneros</div>
        </div>
        <div className="vt-kpi" data-salon="ratioCB"><div className="vt-kpi-label">Ratio C/B (₡)</div>
          <div className={`vt-kpi-val ${ratioCBClass(d.ratioCB)}`}>{d.ratioCB.toFixed(2)}:1</div>
        </div>
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
