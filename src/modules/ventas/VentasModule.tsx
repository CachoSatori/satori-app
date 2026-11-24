import { useState, useEffect, useCallback, useRef, Suspense, lazy, type KeyboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { getProductMap, getMetas, getComps } from '../../shared/api/ventas'
import { fusionarProductMap } from './ventasUtils'
import type { DiasMap, HistMap, ProductMap, Meta, Comp } from '../../shared/types/ventas'
// La fuente de las ventas: SOLO el PoS (decisión del dueño, 16-nov). `ventas_hist` aporta solo
// lo anterior al corte del PoS (2023); ver `ventasFuente.ts`.
import { cargarDeFondo, cargarDiasEager, cargarHistEager, type EstadoPos } from './ventasFuente'
import AvisoFuentePos from './AvisoFuentePos'
import './ventasNav.css'
import {
  type Tab, resolverDireccion, direccionDe, entradasVisibles, entradaDe, labelDe, VISTAS_SIN_DIAS, VISTAS_CON_FONDO,
} from './ventasTabs'

// Lazy-load every tab — each becomes its own JS chunk (loaded on first access)
// Pestaña ADITIVA (preliminar, datos simulados). No recibe props: lee su propio snapshot del
// mock y no toca `dias`, `pm` ni ninguna otra pestaña.
const VentasEnVivo       = lazy(() => import('./VentasEnVivo'))
const VentasSaloneroLineas = lazy(() => import('./VentasSaloneroLineas'))
const VentasMix          = lazy(() => import('./VentasMix'))
const VentasMetas        = lazy(() => import('./VentasMetas'))
const VentasCompetencias = lazy(() => import('./VentasCompetencias'))
const VentasConfig       = lazy(() => import('./VentasConfig'))
const VentasCajeros      = lazy(() => import('./VentasCajeros'))
const VentasICP          = lazy(() => import('./VentasICP'))
const VentasMenuEng      = lazy(() => import('./VentasMenuEng'))
// Ventas v2 · fase 2.1: lee el PoS por su cuenta (no usa `dias`), con la barra global.
const VentasResumen      = lazy(() => import('./VentasResumen'))
const VentasTiempos      = lazy(() => import('./VentasTiempos'))
const VentasMesasInternas = lazy(() => import('./VentasMesasInternas'))
// Ventas v2 · 3.5.2 (D11 = A): lee lo suyo para el período de la barra.
const VentasRegalias     = lazy(() => import('./VentasRegalias'))
// Ventas v2 · 3.5.4: junta «Saloneros» y «Evaluación», con la barra global; lee lo suyo para el período.
const VentasEquipo       = lazy(() => import('./VentasEquipo'))

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

  // La vista activa vive en la URL (`/ventas?tab=<entrada>&v=<sub-vista>`, 3.5.1). Sin `tab`
  // abre «Resumen». Un `?tab=<vista vieja>` abre la misma vista de antes y la dirección se
  // reemplaza por la nueva; uno que el rol no ve, o que no existe, abre «Resumen». Las vistas
  // retiradas en el 3.5.2 («Hoy», «Ventas», «Histórico») abren «Resumen» con su período (`p`); las del 3.5.3
  // («Análisis», «Calendario»), «Tiempos»; las del 3.5.4 («Saloneros», «Evaluación»), «Equipo» con el suyo.
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const vParam   = searchParams.get('v')
  const tab = resolverDireccion(role, tabParam, vParam).vista
  // Cambiar de pestaña agrega una entrada al historial: «Atrás» vuelve a la pestaña anterior.
  // Los demás parámetros (la barra: local, período, comparación) se conservan.
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(searchParams)
    const d = direccionDe(t)
    next.set('tab', d.tab)
    if (d.v) next.set('v', d.v)
    else next.delete('v')
    setSearchParams(next)
  }
  // Redirección: la dirección vieja o inválida se corrige sin entrada nueva en el historial.
  // Se espera a tener el rol, para no tocar un `tab` válido mientras carga el perfil.
  useEffect(() => {
    if (!role) return
    const { corregir } = resolverDireccion(role, tabParam, vParam)
    if (!corregir) return
    const next = new URLSearchParams(searchParams)
    if (corregir.tab) next.set('tab', corregir.tab)
    else next.delete('tab')
    if (corregir.v) next.set('v', corregir.v)
    else next.delete('v')
    if (corregir.p) {
      next.set('p', corregir.p)
      next.delete('d'); next.delete('desde'); next.delete('hasta')
      if (corregir.desde && corregir.hasta) { next.set('desde', corregir.desde); next.set('hasta', corregir.hasta) }
    }
    setSearchParams(next, { replace: true })
  }, [role, tabParam, vParam, searchParams, setSearchParams])
  const entradas  = entradasVisibles(role)
  const entrada   = entradas.find(e => e.id === entradaDe(tab).id)
  const [error, setError]   = useState<string | null>(null)

  const [dias,     setDias]     = useState<DiasMap>({})
  const [diasFull, setDiasFull] = useState<DiasMap>({})
  /** La carga de fondo (historia completa del PoS) sigue corriendo. Solo para avisar. */
  const [cargandoFondo, setCargandoFondo] = useState(false)
  const [fuentePos, setFuentePos] = useState<EstadoPos | null>(null)
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
  //   · base  — lo liviano (hist anterior al corte, product_map, metas, comps). Siempre; bloquea.
  //   · eager — los 90 días del PoS. Solo al abrir una vista que usa `dias`; En vivo y Por línea
  //             se pintan sin esperarla.
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
        cargarHistEager(),      // `ventas_hist` antes del corte (2023); el PoS llega en el fondo
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
      // ── LA FUENTE ES EL PoS (sin Excel de respaldo desde el 16-nov) ─────────────────
      eagerP.current = Promise.all([pedirBase(), cargarDiasEager()]).then(([{ h, p }, d]) => {
        if (vigente()) {
          setDias(d.dias)
          setFuentePos(d.estadoPos ?? null)
          // ── El ProductMap que ven las pantallas: curado + FAMILIA del PoS ───────────────
          // La fusión es CONSERVADORA (ver `fusionarProductMap`): la familia solo rellena lo
          // que no tiene un tipo válido puesto a mano. Un `cortesia`/`personal` curado no se
          // pisa, así que `cortTotal`/`persTotal` y Menu Engineering no se mueven.
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
      // La historia completa, en segundo plano: la necesitan las vistas que miran más atrás de
      // los 90 días (`VISTAS_CON_FONDO`). Hasta que llegue, muestran 2023 (`ventas_hist`) y los
      // 90 días del eager.
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

  /** «Recargar» (Competencias, Productos): vuelve a pedir todo, como antes. */
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

      <AvisoFuentePos estado={fuentePos} />

      {/* La historia completa llega en segundo plano (P2-perf). Sin este aviso, las vistas que la
          usan (Mix → Comparar, Metas…) parecen "mal" (sin 2024 en adelante) hasta que el PoS entra. */}
      {cargandoFondo && (
        <div style={{ margin: '0.75rem 1.5rem', fontSize: '0.75rem', color: 'var(--c-gris)' }}>
          Cargando la historia completa del PoS… mientras tanto se ven los últimos 90 días y 2023.
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
              {tab === 'resumen'     && <VentasResumen metas={metas} />}
              {tab === 'tiempos'     && <VentasTiempos hist={hist} />}
              {tab === 'regalias'    && <VentasRegalias />}
              {tab === 'internas'    && <VentasMesasInternas />}
              {tab === 'envivo'      && <VentasEnVivo       metas={metas} />}
              {tab === 'equipo'      && <VentasEquipo       metas={metas} />}
              {tab === 'salolineas'  && <VentasSaloneroLineas />}
              {tab === 'icp'         && <VentasICP          dias={allDias} pm={pm} />}
              {tab === 'cajeros'     && <VentasCajeros      dias={allDias} />}
              {tab === 'mix'         && <VentasMix          dias={allDias} pm={pm} hist={hist} />}
              {tab === 'menueng'    && <VentasMenuEng      dias={allDias} pm={pm} />}
              {tab === 'metas'       && <VentasMetas        dias={allDias} hist={hist} metas={metas} onMetasUpdated={setMetas} />}
              {tab === 'competencias'&& <VentasCompetencias dias={allDias} pm={pm} comps={comps} onRefresh={loadAll} />}
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
