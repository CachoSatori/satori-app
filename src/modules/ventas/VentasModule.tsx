import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import {
  getVentasDias, getAllVentasDias, getVentasHist, getProductMap, getMetas, getComps,
} from '../../shared/api/ventas'
import type { DiasMap, HistMap, ProductMap, Meta, Comp } from '../../shared/types/ventas'
import VentasHoy         from './VentasHoy'
import VentasContabilidad from './VentasContabilidad'
import VentasSaloneros   from './VentasSaloneros'
import VentasHistorico   from './VentasHistorico'
import VentasMix         from './VentasMix'
import VentasAnalisis    from './VentasAnalisis'
import VentasMetas       from './VentasMetas'
import VentasCompetencias from './VentasCompetencias'
import VentasXLS         from './VentasXLS'
import VentasConfig      from './VentasConfig'
import VentasCajeros     from './VentasCajeros'
import VentasEvaluacion  from './VentasEvaluacion'
import VentasICP         from './VentasICP'

type Tab = 'hoy'|'ventas'|'saloneros'|'evaluacion'|'icp'|'cajeros'|'historico'|'mix'|'analisis'|'metas'|'competencias'|'xls'|'config'

interface TabDef { id: Tab; label: string; group: string; roles: string[] }
const TABS: TabDef[] = [
  { id: 'hoy',          label: 'Hoy',          group: 'ops',   roles: ['owner','manager','contador'] },
  { id: 'saloneros',    label: 'Saloneros',     group: 'ops',   roles: ['owner','manager'] },
  { id: 'evaluacion',   label: 'Evaluación',    group: 'team',  roles: ['owner','manager'] },
  { id: 'icp',          label: 'ICP',           group: 'team',  roles: ['owner','manager','contador'] },
  { id: 'cajeros',      label: 'Cajeros',       group: 'ops',   roles: ['owner','manager','contador'] },
  { id: 'ventas',       label: 'Ventas',        group: 'fin',   roles: ['owner','manager','contador'] },
  { id: 'historico',    label: 'Histórico',     group: 'fin',   roles: ['owner','manager','contador'] },
  { id: 'mix',          label: 'Mix Ventas',    group: 'fin',   roles: ['owner','manager','contador'] },
  { id: 'analisis',     label: 'Análisis',      group: 'fin',   roles: ['owner','manager','contador'] },
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
      const [d, h, p, m, c] = await Promise.all([
        getVentasDias(),        // last 90 days eager
        getVentasHist(),
        getProductMap(),
        getMetas(),
        getComps(),
      ])
      setDias(d)
      setHist(h)
      setPm(p)
      setMetas(m)
      setComps(c)
      // Load full history lazily in background for Análisis year-over-year
      getAllVentasDias().then(setDiasFull).catch(() => setDiasFull(d))
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
          <div>
            <div style={{ fontFamily: 'Syne, var(--font-serif)', fontSize: '0.9rem', fontWeight: 800, color: 'var(--vt-gold)', letterSpacing: '0.1em' }}>
              SATORI
            </div>
            <div style={{ fontSize: '0.6rem', letterSpacing: '0.3em', color: '#444', textTransform: 'uppercase' }}>
              Ventas
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="cash-back-btn" style={{ borderColor: '#333', color: '#888' }}
            onClick={() => navigate('/')}>← Inicio</button>
        </div>
      </div>

      {/* Nav tabs */}
      <div className="vt-nav-tabs">
        {visibleTabs.map(t => (
          <div
            key={t.id}
            className={`vt-nav-tab ${tab === t.id ? 'active' : ''}`}
            style={tab === t.id ? { borderBottomColor: GROUP_COLORS[t.group], color: GROUP_COLORS[t.group] } : {}}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </div>
        ))}
      </div>

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
          <div className="vt-content">
            {tab === 'hoy'         && <VentasHoy         dias={allDias} pm={pm} metas={metas} />}
            {tab === 'ventas'      && <VentasContabilidad dias={allDias} hist={hist} metas={metas} pm={pm} />}
            {tab === 'saloneros'   && <VentasSaloneros    dias={allDias} pm={pm} metas={metas} />}
            {tab === 'evaluacion'  && <VentasEvaluacion   dias={allDias} pm={pm} metas={metas} />}
            {tab === 'icp'         && <VentasICP          dias={allDias} pm={pm} />}
            {tab === 'cajeros'     && <VentasCajeros      dias={allDias} />}
            {tab === 'historico'   && <VentasHistorico    dias={allDias} hist={hist} pm={pm} />}
            {tab === 'mix'         && <VentasMix          dias={allDias} pm={pm} hist={hist} />}
            {tab === 'analisis'    && <VentasAnalisis     dias={allDias} hist={hist} metas={metas} />}
            {tab === 'metas'       && <VentasMetas        dias={allDias} hist={hist} metas={metas} onMetasUpdated={setMetas} />}
            {tab === 'competencias'&& <VentasCompetencias dias={allDias} pm={pm} comps={comps} onRefresh={loadAll} />}
            {tab === 'xls'         && <VentasXLS          dias={allDias} onRefresh={loadAll} />}
            {tab === 'config'      && <VentasConfig       dias={allDias} pm={pm} onRefresh={loadAll} />}
          </div>
        )
      })()}
    </div>
  )
}
