// ── Ventas v2 · 3.5.2 · «Regalías» con lo que hoy existe (SPEC-ventas-v2 §5.5, D11 = A) ───────────
//
// Con la barra global (local y período). Muestra, para el período:
//   · Lo que mostraba «Hoy» en «Regalías, Personal & Desconocidos», llevado al período: cortesías, comida
//     del personal y desconocidos, con la MISMA cuenta (productos que «Ajustes → Productos» clasifica así;
//     `salonDetalle.ts` → `regaliasDeLineas`).
//   · Mesas de dueños y regalías totales del período: las mismas que el «Resumen» saca de la venta por
//     persona (`vpp.mesasDuenos`, `vpp.regaliasTotales`, función 190), con su neta.
//   · Un aviso de lo que falta y llega con la 3.4 (firma): descuentos por programa, anulaciones y
//     refacturas, por salonero y por día, el cambio contra las bases y el control de la quincena.
// El contador la ve completa (D7). Solo lectura.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import BarraVentasV2 from './BarraVentasV2'
import { escribirBarra, leerBarra, periodoDeBarra } from './barraVentasV2'
import { fechasCortas } from './periodos'
import { cifrasDelRango, type CifrasRango } from './resumenV2'
import { cargarLecturaResumen, getLocalesVentas, type LocalVentas } from './resumenV2Datos'
import { cargarLineasPeriodo, fechasDe } from './lineasPeriodo'
import { FALTA_EN_REGALIAS, regaliasDeLineas, type GrupoRegalia, type RegaliasDeLineas } from './salonDetalle'
import { LOCAL_POR_DEFECTO } from './ventasDiasDesdePos'
import { localPorDefecto } from '../../shared/utils/ordenLocales'
import { fi } from './ventasUtils'

const pct1 = (x: number) => `${x.toFixed(1).replace('.', ',')} %`

export default function VentasRegalias() {
  const { profile } = useAuth()
  const role = profile?.role ?? ''
  const [sp, setSp] = useSearchParams()
  const estado = useMemo(() => leerBarra(sp), [sp])
  const { tipo, dia, desde, hasta } = estado
  const { periodo, aviso } = useMemo(() => periodoDeBarra({ tipo, dia, desde, hasta }), [tipo, dia, desde, hasta])

  const [locales, setLocales] = useState<LocalVentas[]>([])
  useEffect(() => {
    let vivo = true
    getLocalesVentas(role).then(l => { if (vivo) setLocales(l) }).catch(() => { if (vivo) setLocales([]) })
    return () => { vivo = false }
  }, [role])
  // D16 (#333): el elegido en la URL si lo ve; si no, Santa Teresa; si no, el primero que ve. Antes de que lleguen
  // los locales se respeta la URL y, sin URL, Santa Teresa. Igual que «Resumen» y «Tiempos».
  const local = locales.length === 0
    ? (estado.local ?? LOCAL_POR_DEFECTO)
    : (localPorDefecto(locales, estado.local) ?? LOCAL_POR_DEFECTO)

  const clave = `${local}|${periodo.tipo}|${periodo.desde}|${periodo.hasta}`
  const [datos, setDatos] = useState<{ clave: string; cifras: CifrasRango; lineas: RegaliasDeLineas } | null>(null)
  const [fallo, setFallo] = useState<{ clave: string; msg: string } | null>(null)
  useEffect(() => {
    const p = periodo
    if (p.tipo === 'hoy') return
    let vivo = true
    Promise.all([cargarLecturaResumen(local, p), cargarLineasPeriodo(local, p)])
      .then(([l, lin]) => {
        if (!vivo) return
        setDatos({ clave, cifras: cifrasDelRango(l, p), lineas: regaliasDeLineas(lin.dias, lin.pm, fechasDe(lin.dias, p)) })
      })
      .catch(e => { if (vivo) setFallo({ clave, msg: e instanceof Error ? e.message : 'No se pudo leer el PoS' }) })
    return () => { vivo = false }
  }, [clave, local, periodo])

  const barra = <BarraVentasV2 estado={estado} periodo={periodo} locales={locales} aviso={aviso}
    onCambio={e => setSp(escribirBarra(sp, e))} />

  if (periodo.tipo === 'hoy') {
    return (
      <div className="vt-section">
        {barra}
        <div className="vt2-hoy">Hoy está en curso: las regalías del día se miran cuando cierra. Elegí «Ayer» u otro período.</div>
      </div>
    )
  }

  const error = fallo && fallo.clave === clave ? fallo.msg : null
  const d = datos && datos.clave === clave ? datos : null
  const fechas = fechasCortas(periodo, Number(periodo.ancla.slice(0, 4)))
  return (
    <div className="vt-section">
      {barra}
      {error && <div className="tips-error" role="alert"><span>No se pudo leer el PoS: {error}</span></div>}
      {!d && !error && (
        <div className="vt2-cargando" role="status">
          Leyendo las regalías del PoS{periodo.dias > 62 ? ' (período largo: puede tardar unos segundos)' : ''}…
        </div>
      )}
      {d && <Contenido c={d.cifras} r={d.lineas} fechas={fechas} />}
      <AvisoFalta />
    </div>
  )
}

interface Fila { id: string; label: string; detalle: string; valor: number; cantidad: string }

function Contenido({ c, r, fechas }: { c: CifrasRango; r: RegaliasDeLineas; fechas: string }) {
  const neta = c.totales.ventaNeta
  const v = c.vpp
  const filas: Fila[] = [
    { id: 'cortesias', label: 'Cortesías', detalle: 'productos clasificados como cortesía', valor: r.cortesias.total, cantidad: unidades(r.cortesias) },
    { id: 'personal', label: 'Consumo del personal', detalle: 'productos clasificados como comida del personal', valor: r.personal.total, cantidad: unidades(r.personal) },
    { id: 'duenos', label: 'Mesas de dueños', detalle: 'cuentas de salón de los dueños', valor: v.netaMesasDuenos, cantidad: `${v.mesasDuenos} ${v.mesasDuenos === 1 ? 'mesa' : 'mesas'}` },
    { id: 'regaliasTotales', label: 'Regalías totales', detalle: 'cuentas de salón cerradas enteras como cortesía o sin cobro', valor: v.netaRegaliasTotales, cantidad: `${v.regaliasTotales} ${v.regaliasTotales === 1 ? 'cuenta' : 'cuentas'}` },
    { id: 'desconocidos', label: 'Desconocidos', detalle: 'productos sin clasificar (los 8 más grandes)', valor: r.desconocidos.total, cantidad: unidades(r.desconocidos) },
  ]
  const hayAlgo = filas.some(f => f.valor > 0) || v.mesasDuenos > 0 || v.regaliasTotales > 0
  const baseTxt = `% de la venta neta del período (${fechas}: ${fi(neta)})`
  return (
    <>
      <p className="vt2-bajada" data-testid="regalias-bajada">
        {hayAlgo
          ? `En ${fechas}: ${fi(r.cortesias.total)} en cortesías, ${fi(r.personal.total)} en consumo del personal y ${v.mesasDuenos} ${v.mesasDuenos === 1 ? 'mesa' : 'mesas'} de dueños (${fi(v.netaMesasDuenos)}).`
          : `En ${fechas} no hay cortesías, consumo del personal ni mesas de dueños registradas.`}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="vt-tbl" aria-label="Regalías por tipo">
          <thead><tr><th>Tipo</th><th className="r">Valor</th><th className="r">{baseTxt}</th><th className="r">Cantidad</th></tr></thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.id} data-regalia={f.id}>
                <td><strong>{f.label}</strong><span className="vt2-sub">{f.detalle}</span></td>
                <td className="r">{fi(f.valor)}</td>
                <td className="r">{neta > 0 ? pct1(f.valor / neta * 100) : '—'}</td>
                <td className="r">{f.cantidad}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: '0.75rem', marginTop: '1rem' }}>
        {r.cortesias.total > 0 && <Tarjeta icono="🎁" titulo="Regalías / Cortesías" color="var(--c-oro-texto)" g={r.cortesias} />}
        {r.personal.total > 0 && <Tarjeta icono="👨‍🍳" titulo="Comida Personal" color="var(--c-azul)" g={r.personal} />}
        {r.desconocidos.prods.length > 0 && <Tarjeta icono="❓" titulo="Desconocidos" color="var(--c-gris)" g={r.desconocidos} />}
      </div>
    </>
  )
}

const unidades = (g: GrupoRegalia) => {
  const u = g.prods.reduce((s, p) => s + p.q, 0)
  return g.prods.length ? `${u} uds (los ${g.prods.length} más grandes)` : '—'
}

function Tarjeta({ icono, titulo, color, g }: { icono: string; titulo: string; color: string; g: GrupoRegalia }) {
  return (
    <div data-tarjeta={titulo} style={{ background: 'var(--c-panel)', borderRadius: 2, padding: '0.875rem', borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, color }}>{icono} {titulo}</div>
        <div style={{ fontFamily: 'var(--font-serif)', fontVariantNumeric: 'tabular-nums', fontSize: '1rem', fontWeight: 800, color }}>{fi(g.total)}</div>
      </div>
      {g.prods.map(p => (
        <div key={p.nombre} style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', padding: '0.25rem 0', borderBottom: '1px solid var(--c-linea)' }}>
          <span style={{ flex: 1, fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--c-gris)', whiteSpace: 'nowrap' }}>{p.q} uds</span>
          <span style={{ fontSize: '0.78rem', color, fontWeight: 600, whiteSpace: 'nowrap' }}>{fi(p.m)}</span>
        </div>
      ))}
    </div>
  )
}

function AvisoFalta() {
  return (
    <div className="vt2-aviso" role="note" data-bloque="regalias-falta" style={{ color: 'var(--c-gris)' }}>
      <strong>Todavía no se ve acá:</strong> {FALTA_EN_REGALIAS.join(' · ')}. Llegan con la fase 3.4, que necesita una
      función nueva en la base (con firma del dueño). Las cortesías y el consumo del personal de esta pantalla son los
      productos que «Ajustes → Productos» clasifica así (la misma cuenta que mostraba «Hoy»).
    </div>
  )
}
