import { useState, useEffect, useCallback, Suspense, lazy, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { getProductMap, getMetas, getComps } from '../../shared/api/ventas'
import type { DiasMap, HistMap, ProductMap, Meta, Comp } from '../../shared/types/ventas'
// La fuente de las ventas (P2). `getVentasDias`/`getAllVentasDias`/`getVentasHist` siguen
// existiendo y se llaman desde acá adentro: el Excel es el piso de la fusión, no se retiró.
import { cargarDeFondo, cargarDiasEager, cargarHistEager } from './ventasFuente'

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

type Tab = 'hoy'|'envivo'|'paridad'|'ventas'|'saloneros'|'salolineas'|'evaluacion'|'icp'|'cajeros'|'historico'|'mix'|'analisis'|'calendario'|'menueng'|'metas'|'competencias'|'xls'|'config'

interface TabDef { id: Tab; label: string; group: string; roles: string[] }
const TABS: TabDef[] = [
  { id: 'hoy',          label: 'Hoy',          group: 'ops',   roles: ['owner','manager','contador'] },
  // Va DESPUÉS de 'hoy' a propósito: `visibleTabs[0]` es la pestaña por defecto, y con los
  // mismos roles que 'hoy' nadie puede ver esta sin ver aquella primero. La pestaña de
  // arranque no cambia para ningún rol.
  { id: 'envivo',       label: 'En vivo',       group: 'ops',   roles: ['owner','manager','contador'] },
  // P3, TEMPORAL: diagnóstico para firmar el swap de fuente. Solo owner, y se saca al cerrar P3.
  { id: 'paridad',      label: 'Paridad (validación)', group: 'ops', roles: ['owner'] },
  { id: 'saloneros',    label: 'Saloneros',     group: 'ops',   roles: ['owner','manager'] },
  // Saloneros por LÍNEA (Parte B): las dos lentes. Va al lado de 'saloneros' porque es la misma
  // pregunta con otra fuente — el mesero de la línea en vez del mesero del pedido.
  { id: 'salolineas',   label: 'Saloneros x línea', group: 'ops', roles: ['owner','manager'] },
  { id: 'evaluacion',   label: 'Evaluación',    group: 'team',  roles: ['owner','manager'] },
  { id: 'icp',          label: 'ICP',           group: 'team',  roles: ['owner','manager','contador'] },
  { id: 'cajeros',      label: 'Cajeros',       group: 'ops',   roles: ['owner','manager','contador'] },
  { id: 'ventas',       label: 'Ventas',        group: 'fin',   roles: ['owner','manager','contador'] },
  { id: 'historico',    label: 'Histórico',     group: 'fin',   roles: ['owner','manager','contador'] },
  { id: 'mix',          label: 'Mix Ventas',    group: 'fin',   roles: ['owner','manager','contador'] },
  { id: 'analisis',     label: 'Análisis',      group: 'fin',   roles: ['owner','manager','contador'] },
  { id: 'calendario',   label: 'Calendario',    group: 'fin',   roles: ['owner','manager','contador'] },
  { id: 'menueng',      label: 'Ing. Menú',     group: 'fin',   roles: ['owner','manager'] },
  { id: 'metas',        label: 'Metas',         group: 'fin',   roles: ['owner','manager','contador'] },
  { id: 'competencias', label: 'Competencias',  group: 'team',  roles: ['owner','manager'] },
  { id: 'xls',          label: 'Cargar XLS',    group: 'ops',   roles: ['owner','manager'] },
  { id: 'config',       label: 'Productos',     group: 'admin', roles: ['owner','manager'] },
]

const GROUP_COLORS: Record<string, string> = {
  ops:   '#c8a050',
  fin:   '#c8a96e',
  team:  '#6a9a6a',
  admin: '#8a8aaa',
}

// Etiquetas y orden de los grupos en el índice (como en el dashboard)
const GROUP_NAMES: Record<string, string> = {
  ops:   'Operaciones',
  team:  'Equipo',
  fin:   'Finanzas',
  admin: 'Config',
}
const GROUP_ORDER = ['ops', 'team', 'fin', 'admin']

export default function VentasModule() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const role        = profile?.role ?? ''

  const visibleTabs = TABS.filter(t => t.roles.includes(role))
  const [tab, setTab] = useState<Tab>(visibleTabs[0]?.id ?? 'hoy')
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  const [dias,     setDias]     = useState<DiasMap>({})
  const [diasFull, setDiasFull] = useState<DiasMap>({})
  /** La carga de fondo (historia completa del PoS) sigue corriendo. Solo para avisar. */
  const [cargandoFondo, setCargandoFondo] = useState(false)
  const [hist,  setHist]  = useState<HistMap>({})
  const [pm,    setPm]    = useState<ProductMap>({})
  const [metas, setMetas] = useState<Meta>({
    restaurante: {}, margen: {},
    global: { promPax: 15000, bebPax: 1.2, ratioCB: 3.0, ticketItem: 7500, ventas: 800000 },
    salMetas: {},
  })
  const [comps, setComps] = useState<Comp[]>([])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // ── P2 · LA FUENTE ES EL PoS, con el Excel de respaldo ──────────────────────────
      // Todo fusiona `{ ...xls, ...pos }` con la MISMA función (`ventasFuente.ts`): el PoS
      // pisa donde tiene lote, el Excel queda intacto en 2023 y en cualquier jornada sin lote.
      // Que la fusión sea una sola es lo que evita que «Hoy» y «Análisis» discrepen en las
      // fechas que se solapan, o que algo salte cuando el fondo termina de cargar.
      //
      // ── QUÉ BLOQUEA Y QUÉ NO (P2-perf) ──────────────────────────────────────────────
      // Bloquea solo lo barato: 90 días de días + el `hist` del Excel (una consulta a una
      // tabla ya resumida). El PoS no da resúmenes: hay que agregar tickets y líneas crudas,
      // así que el rango completo se lee en SEGUNDO PLANO y de un solo pase salen las dos
      // cosas que faltan (el `DiasMap` full y el `HistMap`).
      //
      // Con `FUENTE_VENTAS = 'xls'` nada de esto consulta el PoS.
      const [d, h, p, m, c] = await Promise.all([
        cargarDiasEager(),      // últimos DIAS_EAGER días, PoS + Excel
        cargarHistEager(),      // el hist del Excel; el overlay del PoS llega en el fondo
        getProductMap(),
        getMetas(),
        getComps(),
      ])
      setDias(d)
      setHist(h)
      setPm(p)
      setMetas(m)
      setComps(c)
      // La historia completa, en segundo plano: es lo que necesitan Análisis (año contra año),
      // Histórico y Calendario. Hasta que llegue, esas pestañas muestran el Excel — nunca
      // quedan vacías, porque el Excel cubre 2023-2025 entero.
      setCargandoFondo(true)
      cargarDeFondo(h)
        .then(({ dias, hist }) => { setDiasFull(dias); setHist(hist) })
        .catch(() => setDiasFull(d))
        .finally(() => setCargandoFondo(false))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  if (loading) {
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
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem', color: 'var(--vt-gold)' }}>里</span>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--vt-gold)', letterSpacing: '0.18em' }}>
            SATORI
          </div>
          {role && <span className="role-badge">{role}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="cash-back-btn" style={{ borderColor: '#333', color: '#888' }}
            onClick={() => navigate('/')}>← Inicio</button>
        </div>
      </div>

      {/* Nav tabs — agrupadas con etiqueta de grupo (estilo dashboard) */}
      <div className="vt-nav-tabs">
        {GROUP_ORDER.map(g => {
          const groupTabs = visibleTabs.filter(t => t.group === g)
          if (!groupTabs.length) return null
          return (
            <Fragment key={g}>
              <span className="vt-nav-group">{GROUP_NAMES[g]}</span>
              {groupTabs.map(t => (
                <div
                  key={t.id}
                  className={`vt-nav-tab ${tab === t.id ? 'active' : ''}`}
                  style={tab === t.id ? { borderBottomColor: GROUP_COLORS[t.group], color: GROUP_COLORS[t.group] } : {}}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </div>
              ))}
            </Fragment>
          )
        })}
      </div>

      {/* La historia completa llega en segundo plano (P2-perf). Sin este aviso, Análisis e
          Histórico muestran los años viejos del Excel y parecen "mal" hasta que el PoS entra. */}
      {cargandoFondo && (
        <div style={{ margin: '0.75rem 1.5rem', fontSize: '0.75rem', color: '#888' }}>
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
            <div className="vt-content">
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
