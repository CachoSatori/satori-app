import { useState, useEffect, useCallback, useRef, Suspense, lazy, type KeyboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { getProductMap, getMetas, getComps } from '../../shared/api/ventas'
import { fusionarProductMap } from './ventasUtils'
import type { DiasMap, HistMap, ProductMap, Meta, Comp } from '../../shared/types/ventas'
// La fuente de las ventas (P2). `getVentasDias`/`getAllVentasDias`/`getVentasHist` siguen
// existiendo y se llaman desde acá adentro: el Excel es el piso de la fusión, no se retiró.
import { cargarDeFondo, cargarDiasEager, cargarHistEager, type EstadoPos } from './ventasFuente'
import AvisoFuentePos from './AvisoFuentePos'
import './ventasNav.css'
import {
  type Tab, resolverTab, puedeVer, entradasVisibles, entradaDe, labelDe, VISTAS_SIN_DIAS, VISTAS_CON_FONDO,
} from './ventasTabs'

// Lazy-load every tab — each becomes its own JS chunk (loaded on first access)
const VentasHoy          = lazy(() => import('./VentasHoy'))
// Pestaña ADITIVA (preliminar, datos simulados). No recibe props: lee su propio snapshot del
// mock y no toca `dias`, `pm` ni ninguna otra pestaña.
const VentasEnVivo       = lazy(() => import('./VentasEnVivo'))
const VentasParidad      = lazy(() => import('./VentasParidad'))
const VentasContabilidad = lazy(() => import('./VentasContabilidad'))
const VentasSaloneros    = lazy(() => import('./VentasSaloneros'))
const VentasSaloneroLineas = lazy(() => import('./VentasSaloneroLineas'))
const VentasHistorico    = lazy(() => import('./VentasHistorico'))
const VentasMix          = lazy(() => import('./VentasMix'))
const VentasAnalisis     = lazy(() => import('./VentasAnalisis'))
const VentasMetas        = lazy(() => import('./VentasMetas'))
const VentasCompetencias = lazy(() => import('./VentasCompetencias'))
const VentasXLS          = lazy(() => import('./VentasXLS'))
const VentasConfig       = lazy(() => import('./VentasConfig'))
const VentasCajeros      = lazy(() => import('./VentasCajeros'))
const VentasEvaluacion   = lazy(() => import('./VentasEvaluacion'))
const VentasICP          = lazy(() => import('./VentasICP'))
const VentasCalendario   = lazy(() => import('./VentasCalendario'))
const VentasMenuEng      = lazy(() => import('./VentasMenuEng'))

/** Ids de ARIA: cada pestaña controla el mismo panel de contenido. */
const PANEL_ID = 'vt-panel'
const idEntrada = (id: string) => `vt-tab-${id}`
const idVista   = (id: string) => `vt-subtab-${id}`

/**
 * Flechas izquierda/derecha (e Inicio/Fin) dentro de un `role="tablist"`: mueven el foco a la
 * pestaña vecina y la activan, como un clic. Solo teclado; no cambia qué abre cada pestaña.
 */
function moverConFlechas(e: KeyboardEvent<HTMLDivElement>) {
  const teclas = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!teclas.includes(e.key)) return
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  const actual = tabs.indexOf(document.activeElement as HTMLButtonElement)
  if (actual < 0 || tabs.length === 0) return
  e.preventDefault()
  const n = tabs.length
  const destino = e.key === 'Home' ? 0
    : e.key === 'End' ? n - 1
    : e.key === 'ArrowRight' ? (actual + 1) % n
    : (actual - 1 + n) % n
  tabs[destino].focus()
  tabs[destino].click()
}

export default function VentasModule() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const role        = profile?.role ?? ''

  // La vista activa vive en la URL (`/ventas?tab=<id>`). Sin `tab`, o con uno que el rol no
  // ve, se abre la misma pestaña de arranque de antes del rediseño.
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab = resolverTab(role, tabParam)
  // Cambiar de pestaña agrega una entrada al historial: «Atrás» vuelve a la pestaña anterior.
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', t)
    setSearchParams(next)
  }
  // Un `?tab=` inválido o de otro rol se limpia de la URL (sin entrada nueva en el historial).
  // Se espera a tener el rol, para no borrar un `tab` válido mientras carga el perfil.
  useEffect(() => {
    if (!role || !tabParam || puedeVer(role, tabParam)) return
    const next = new URLSearchParams(searchParams)
    next.delete('tab')
    setSearchParams(next, { replace: true })
  }, [role, tabParam, searchParams, setSearchParams])
  const entradas  = entradasVisibles(role)
  const entrada   = entradas.find(e => e.id === entradaDe(tab).id)
  const [error, setError]   = useState<string | null>(null)

  const [dias,     setDias]     = useState<DiasMap>({})
  const [diasFull, setDiasFull] = useState<DiasMap>({})
  /** La carga de fondo (historia completa del PoS) sigue corriendo. Solo para avisar. */
  const [cargandoFondo, setCargandoFondo] = useState(false)
  const [fuentePos, setFuentePos] = useState<{ estado: EstadoPos | null; ultimoDiaXls: string | null }>({ estado: null, ultimoDiaXls: null })
  const [hist,  setHist]  = useState<HistMap>({})
  const [pm,    setPm]    = useState<ProductMap>({})
  const [metas, setMetas] = useState<Meta>({
    restaurante: {}, margen: {},
    global: { promPax: 15000, bebPax: 1.2, ratioCB: 3.0, ticketItem: 7500, ventas: 800000 },
    salMetas: {},
  })
  const [comps, setComps] = useState<Comp[]>([])

  // ── A5 · CUÁNDO se pide cada cosa (qué se pide y cómo se calcula, igual que antes) ────────
  // Tres cargas, cada una UNA vez por entrada al módulo (o por «recargar»):
  //   · base  — lo liviano (hist del Excel, product_map, metas, comps). Siempre; bloquea el módulo.
  //   · eager — los 90 días (PoS + Excel). Solo al abrir una vista que usa `dias`; En vivo,
  //             Paridad y Por línea se pintan sin esperarla.
  //   · fondo — la historia completa del PoS. Solo al abrir una vista de `VISTAS_CON_FONDO`.
  // `gen` invalida lo que llega tarde de una carga anterior a un «recargar».
  const gen    = useRef(0)
  const baseP  = useRef<Promise<{ h: HistMap; p: ProductMap }> | null>(null)
  const eagerP = useRef<Promise<{ h: HistMap; dias: DiasMap }> | null>(null)
  const fondoP = useRef<Promise<void> | null>(null)
  const [recarga,    setRecarga]    = useState(0)
  const [baseListo,  setBaseListo]  = useState(false)
  const [eagerListo, setEagerListo] = useState(false)

  const msg = (e: unknown) => e instanceof Error ? e.message : 'Error cargando datos'

  const pedirBase = useCallback(() => {
    if (!baseP.current) {
      const g = gen.current
      const vigente = () => g === gen.current
      baseP.current = Promise.all([
        cargarHistEager(),      // el hist del Excel; el overlay del PoS llega en el fondo
        getProductMap(),
        getMetas(),
        getComps(),
      ]).then(([h, p, m, c]) => {
        if (vigente()) { setHist(h); setMetas(m); setComps(c) }
        return { h, p }
      })
      baseP.current
        .catch(e => { if (vigente()) setError(msg(e)) })
        .finally(() => { if (vigente()) setBaseListo(true) })
    }
    return baseP.current
  }, [])

  const pedirEager = useCallback(() => {
    if (!eagerP.current) {
      const g = gen.current
      const vigente = () => g === gen.current
      // ── P2 · LA FUENTE ES EL PoS, con el Excel de respaldo ──────────────────────────
      // Todo fusiona `{ ...xls, ...pos }` con la MISMA función (`ventasFuente.ts`): el PoS
      // pisa donde tiene lote, el Excel queda intacto en 2023 y en cualquier jornada sin lote.
      // Con `FUENTE_VENTAS = 'xls'` nada de esto consulta el PoS.
      eagerP.current = Promise.all([pedirBase(), cargarDiasEager()]).then(([{ h, p }, d]) => {
        if (vigente()) {
          setDias(d.dias)
          setFuentePos({ estado: d.estadoPos ?? null, ultimoDiaXls: d.ultimoDiaXls ?? null })
          // ── El ProductMap que ven las pantallas: curado + FAMILIA del PoS ───────────────
          // La fusión es CONSERVADORA (ver `fusionarProductMap`): la familia solo rellena lo
          // que no tiene un tipo válido puesto a mano. Un `cortesia`/`personal` curado no se
          // pisa, así que `cortTotal`/`persTotal`, Menu Engineering y la Paridad no se mueven.
          setPm(fusionarProductMap(p, d.pm))
        }
        return { h, dias: d.dias }
      })
      eagerP.current
        .catch(e => { if (vigente()) setError(msg(e)) })
        .finally(() => { if (vigente()) setEagerListo(true) })
    }
    return eagerP.current
  }, [pedirBase])

  const pedirFondo = useCallback(() => {
    if (!fondoP.current) {
      const g = gen.current
      const vigente = () => g === gen.current
      // La historia completa, en segundo plano: es lo que necesitan Análisis (año contra año),
      // Histórico y Calendario. Hasta que llegue, esas pestañas muestran el Excel — nunca
      // quedan vacías, porque el Excel cubre 2023-2025 entero.
      fondoP.current = Promise.all([pedirBase(), pedirEager()]).then(([{ p }, { h, dias: d90 }]) => {
        if (!vigente()) return
        setCargandoFondo(true)
        return cargarDeFondo(h)
          .then(({ dias, hist, pm }) => {
            if (!vigente()) return
            setDiasFull(dias)
            setHist(hist)
            // El rango completo ve más productos que los 90 días del eager: se vuelve a fusionar
            // sobre el curado ORIGINAL (`p`), no sobre el ya fusionado, para que la regla se
            // aplique una sola vez y el resultado no dependa del orden de llegada.
            setPm(fusionarProductMap(p, pm))
          })
          .catch(() => { if (vigente()) setDiasFull(d90) })
          .finally(() => { if (vigente()) setCargandoFondo(false) })
      }, () => { /* el error de base/eager ya se mostró */ })
    }
    return fondoP.current
  }, [pedirBase, pedirEager])

  /** «Recargar» (Competencias, Cargar XLS, Productos): vuelve a pedir todo, como antes. */
  const loadAll = () => {
    gen.current += 1
    baseP.current = null
    eagerP.current = null
    fondoP.current = null
    setError(null)
    setBaseListo(false)
    setEagerListo(false)
    setCargandoFondo(false)
    setRecarga(r => r + 1)
  }

  const usaDias  = !VISTAS_SIN_DIAS.has(tab)
  const usaFondo = VISTAS_CON_FONDO.has(tab)
  useEffect(() => {
    pedirBase()
    if (usaDias) pedirEager()
    if (usaFondo) pedirFondo()
  }, [usaDias, usaFondo, recarga, pedirBase, pedirEager, pedirFondo])

  if (!baseListo) {
    return (
      <div className="module-loading">
        <span className="loading-mark">売</span>
      </div>
    )
  }

  return (
    <div className="vt-module">

      {/* Header */}
      <div className="vt-module-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem', color: 'var(--c-oro-texto)' }}>里</span>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--c-oro-texto)', letterSpacing: '0.18em' }}>
            SATORI
          </div>
          {role && <span className="role-badge">{role}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="cash-back-btn" style={{ borderColor: 'var(--c-linea)', color: 'var(--c-gris)' }}
            onClick={() => navigate('/')}>← Inicio</button>
        </div>
      </div>

      {/* Menú de Ventas: entradas y, si la entrada agrupa varias vistas, sub-pestañas */}
      <div className="vt-nav-tabs" role="tablist" aria-label="Vistas de Ventas" onKeyDown={moverConFlechas}>
        {entradas.map(e => {
          const activa = e.id === entrada?.id
          return (
            <button
              type="button"
              role="tab"
              aria-selected={activa}
              aria-controls={PANEL_ID}
              id={idEntrada(e.id)}
              tabIndex={activa ? 0 : -1}
              key={e.id}
              className={`vt-nav-tab ${activa ? 'active' : ''}`}
              style={activa ? { borderBottomColor: 'var(--c-oro)', color: 'var(--c-oro-texto)' } : {}}
              onClick={() => { if (!activa) setTab(e.vistas[0]) }}
            >
              {e.label}
            </button>
          )
        })}
      </div>

      {entrada && entrada.vistas.length > 1 && (
        <div className="vt-subnav" role="tablist" aria-label={`Vistas de ${entrada.label}`} onKeyDown={moverConFlechas}>
          {entrada.vistas.map(v => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === v}
              aria-controls={PANEL_ID}
              id={idVista(v)}
              tabIndex={tab === v ? 0 : -1}
              key={v}
              className={`vt-subnav-tab ${tab === v ? 'active' : ''}`}
              style={tab === v ? { borderColor: 'var(--c-oro)', color: 'var(--c-oro-texto)' } : {}}
              onClick={() => setTab(v)}
            >
              {labelDe(v)}
            </button>
          ))}
        </div>
      )}

      <AvisoFuentePos estado={fuentePos.estado} ultimoDiaXls={fuentePos.ultimoDiaXls} />

      {/* La historia completa llega en segundo plano (P2-perf). Sin este aviso, Análisis e
          Histórico muestran los años viejos del Excel y parecen "mal" hasta que el PoS entra. */}
      {cargandoFondo && (
        <div style={{ margin: '0.75rem 1.5rem', fontSize: '0.75rem', color: 'var(--c-gris)' }}>
          Cargando la historia completa del PoS… mientras tanto, los años anteriores se muestran
          desde el Excel.
        </div>
      )}

      {error && (
        <div className="tips-error" style={{ margin: '0.75rem 1.5rem' }}>
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Content — allDias: full history (diasFull when loaded, else 400-day dias) */}
      {(() => {
        const allDias = Object.keys(diasFull).length > 0 ? diasFull : dias
        return (
          <Suspense fallback={<TabLoader />}>
            {usaDias && !eagerListo ? <TabLoader /> : (
            <div
              className="vt-content"
              role="tabpanel"
              id={PANEL_ID}
              aria-labelledby={entrada && entrada.vistas.length > 1 ? idVista(tab) : idEntrada(entradaDe(tab).id)}
            >
              {tab === 'hoy'         && <VentasHoy         dias={allDias} pm={pm} metas={metas} />}
              {tab === 'envivo'      && <VentasEnVivo       metas={metas} />}
              {tab === 'paridad'     && <VentasParidad     />}
              {tab === 'ventas'      && <VentasContabilidad dias={allDias} hist={hist} metas={metas} pm={pm} />}
              {tab === 'saloneros'   && <VentasSaloneros    dias={allDias} pm={pm} metas={metas} />}
              {tab === 'salolineas'  && <VentasSaloneroLineas />}
              {tab === 'evaluacion'  && <VentasEvaluacion   dias={allDias} pm={pm} metas={metas} />}
              {tab === 'icp'         && <VentasICP          dias={allDias} pm={pm} />}
              {tab === 'cajeros'     && <VentasCajeros      dias={allDias} />}
              {tab === 'historico'   && <VentasHistorico    dias={allDias} hist={hist} pm={pm} />}
              {tab === 'mix'         && <VentasMix          dias={allDias} pm={pm} hist={hist} />}
              {tab === 'analisis'    && <VentasAnalisis     dias={allDias} hist={hist} metas={metas} />}
              {tab === 'calendario'  && <VentasCalendario   dias={allDias} hist={hist} pm={pm} />}
              {tab === 'menueng'    && <VentasMenuEng      dias={allDias} pm={pm} />}
              {tab === 'metas'       && <VentasMetas        dias={allDias} hist={hist} metas={metas} onMetasUpdated={setMetas} />}
              {tab === 'competencias'&& <VentasCompetencias dias={allDias} pm={pm} comps={comps} onRefresh={loadAll} />}
              {tab === 'xls'         && <VentasXLS          dias={allDias} onRefresh={loadAll} />}
              {tab === 'config'      && <VentasConfig       dias={allDias} pm={pm} onRefresh={loadAll} />}
            </div>
            )}
          </Suspense>
        )
      })()}
    </div>
  )
}

// Minimal inline spinner shown while a lazy tab chunk downloads (first access only)
function TabLoader() {
  return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', padding:'3rem', opacity:0.4 }}>
      <span className="loading-mark" style={{ fontSize:'1.5rem' }}>売</span>
    </div>
  )
}
