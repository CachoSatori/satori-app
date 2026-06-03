/**
 * VentasMix — Mix de ventas por producto
 * Exact port of SATORI DASHBOARD standalone renderMixVentas (v6)
 *
 * Structure: Section header → Clas row (▶ collapsed) → Subcl row (hidden) → Prod row (hidden)
 * Modes: "Ver período" (single) | "Comparar" (up to 6 periods)
 */
import { useState, useMemo, useCallback, type ReactElement } from 'react'
import type { DiasMap, ProductMap, HistMap } from '../../shared/types/ventas'
import { availableMonths, availableYears, fi } from './ventasUtils'
import { isCajeroName } from '../../shared/utils'

// ── Types ─────────────────────────────────────────────────────────
interface PMItem {
  nombre: string; tipo: string; clas: string; subcl: string
  monto: number; unidades: number; salon: number; delivery: number
}
interface CMSubcl { monto: number; unidades: number; salon: number; delivery: number; prods: PMItem[] }
interface CMClas  { monto: number; unidades: number; salon: number; delivery: number; subcls: Record<string, CMSubcl> }
type ClassMap = Record<string, CMClas>
interface Tots { totG: number; totBeb: number; totCom: number; totMerch: number; totLC: number; totUn: number }

// ── Constants ─────────────────────────────────────────────────────
const CMP_COLORS = ['#c8a96e','#4a9a6a','#c890e8','#8ab4d4','#d4a84b','#c23b22']
const MAX_CMP    = 6
const MSHORT     = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const CLAS_ORDER_COM = [
  'TAPAS ASIATICAS','POKES BOWLS CEVICHES','SUSHI ROLLS','NIGIRIS','SASHIMIS',
  'COMBOS','HOSOMAKIS','ESPECIALES','POSTRES','KIDS MENU',
  'GREENSEASON','EVENTOS TERRAZA','MENU AÑO NUEVO','PROMOCIONES',
]
const TIPOS_BASE = ['bebida','comida','comensales','local club','invitados','cortesia','personal']

type Section = { label: string; color: string; filterFn: (p: PMItem) => boolean; clasOrder?: string[] }
const SECTIONS: Section[] = [
  { label: 'BEBIDAS',               color: '#7ec8a0', filterFn: p => p.tipo === 'bebida' },
  { label: 'COMIDAS',               color: '#c8a96e', filterFn: p => p.tipo === 'comida', clasOrder: CLAS_ORDER_COM },
  { label: 'MERCHANDISING / OTROS', color: '#c890e8', filterFn: p => !TIPOS_BASE.includes(p.tipo) },
  { label: 'PERSONAL',              color: '#888',    filterFn: p => p.tipo === 'personal' },
  { label: 'LOCAL CLUB',            color: '#d4a84b', filterFn: p => p.tipo === 'local club' || p.tipo === 'invitados' || p.clas.toLowerCase().includes('local club') || p.clas.toLowerCase().includes('invitado') },
  { label: 'CORTESÍAS',             color: '#555',    filterFn: p => p.tipo === 'cortesia' },
  { label: 'COMENSALES / A PAX',    color: '#666',    filterFn: p => p.tipo === 'comensales' },
]

// ── Helpers ───────────────────────────────────────────────────────
function getMonto(p: PMItem | { monto: number; salon: number; delivery: number }, canal: 'todos'|'salon'|'delivery'): number {
  if (canal === 'salon')    return (p as PMItem).salon
  if (canal === 'delivery') return (p as PMItem).delivery
  return p.monto
}

function sortClas(arr: string[], order?: string[]): string[] {
  if (!order) return [...arr].sort()
  const ordered: string[] = []
  const rest: string[] = []
  for (const o of order) { if (arr.includes(o)) ordered.push(o) }
  for (const a of arr)   { if (!order.includes(a)) rest.push(a) }
  return [...ordered, ...rest.sort()]
}

function buildPMRaw(dates: string[], dias: DiasMap, pm: ProductMap, canal: 'todos'|'salon'|'delivery'): Record<string, PMItem> {
  const result: Record<string, PMItem> = {}
  for (const date of dates) {
    const dia = dias[date]
    if (!dia) continue
    for (const [salName, s] of Object.entries(dia.saloneros)) {
      const isCaj = isCajeroName(salName)
      if (canal === 'salon'    && isCaj)  continue
      if (canal === 'delivery' && !isCaj) continue
      const prods = (s as { prods?: [string, number, number][] }).prods ?? []
      for (const [name, qty, monto] of prods) {
        if (!name) continue
        const info = pm[name]
        if (!result[name]) {
          result[name] = {
            nombre: name,
            tipo:  info?.tipo ?? 'desconocido',
            clas:  info?.clasificacion ?? 'SIN CLASIFICAR',
            subcl: info?.subclasificacion ?? '',
            monto: 0, unidades: 0, salon: 0, delivery: 0,
          }
        }
        const mult = info?.multiplicador ?? 1
        result[name].monto    += monto
        result[name].unidades += qty * mult
        if (isCaj) result[name].delivery += monto
        else       result[name].salon    += monto
      }
    }
  }
  return result
}

function groupPM(PM: Record<string, PMItem>): ClassMap {
  const CM: ClassMap = {}
  for (const p of Object.values(PM)) {
    const c = p.clas || 'SIN CLASIFICAR'
    const s = p.subcl || c   // standalone: if no subcl, use clas as key
    if (!CM[c]) CM[c] = { monto: 0, unidades: 0, salon: 0, delivery: 0, subcls: {} }
    if (!CM[c].subcls[s]) CM[c].subcls[s] = { monto: 0, unidades: 0, salon: 0, delivery: 0, prods: [] }
    CM[c].monto    += p.monto;  CM[c].unidades  += p.unidades
    CM[c].salon    += p.salon;  CM[c].delivery  += p.delivery
    CM[c].subcls[s].monto    += p.monto;  CM[c].subcls[s].unidades += p.unidades
    CM[c].subcls[s].salon    += p.salon;  CM[c].subcls[s].delivery += p.delivery
    CM[c].subcls[s].prods.push(p)
  }
  return CM
}

function calcTotals(PM: Record<string, PMItem>, canal: 'todos'|'salon'|'delivery'): Tots {
  let totG=0, totBeb=0, totCom=0, totMerch=0, totLC=0, totUn=0
  for (const p of Object.values(PM)) {
    const m = getMonto(p, canal)
    if (!['cortesia','comensales'].includes(p.tipo)) { totG += m; totUn += p.unidades }
    if (p.tipo === 'bebida') totBeb += m
    else if (p.tipo === 'comida') totCom += m
    else if (['merchandising','nofood','desconocido'].includes(p.tipo) || !TIPOS_BASE.includes(p.tipo)) totMerch += m
    else if (p.tipo === 'local club' || p.tipo === 'invitados') totLC += m
  }
  return { totG, totBeb, totCom, totMerch, totLC, totUn }
}

function datesForPeriod(key: string, dias: DiasMap, hist: HistMap): string[] {
  const allD = [...new Set([...Object.keys(dias), ...Object.keys(hist)])].sort()
  if (key.startsWith('todo-')) return allD.filter(d => d.startsWith(key.slice(5)))
  return allD.filter(d => d.startsWith(key))
}

function labelPeriod(key: string): string {
  if (key.startsWith('todo-')) return `Todo ${key.slice(5)}`
  const [y, m] = key.split('-')
  return `${MSHORT[Number(m)-1]} ${y}`
}

function pctBarColor(pct: number, min: number, max: number): string {
  if (!pct) return '#555'
  const ratio = Math.max(0, Math.min(1, (pct - min) / (max - min || 1)))
  let r, g, b: number
  if (ratio < 0.5) {
    const t = ratio * 2
    r = Math.round(194 + (200-194)*t); g = Math.round(59 + (169-59)*t); b = Math.round(34 + (110-34)*t)
  } else {
    const t = (ratio - 0.5) * 2
    r = Math.round(200 + (46-200)*t);  g = Math.round(169 + (169-169)*t); b = Math.round(110 + (50-110)*t)
  }
  return `rgb(${r},${g},${b})`
}

function tipColor(tipo: string): string {
  switch (tipo) {
    case 'bebida':    return '#7ec8a0'
    case 'comida':    return '#c8a96e'
    case 'merchandising': case 'nofood': return '#c890e8'
    case 'local club': case 'invitados': return '#d4a84b'
    case 'comensales': return '#666'
    case 'cortesia':   return '#555'
    case 'personal':   return '#999'
    default:           return '#777'
  }
}

// ── Component ─────────────────────────────────────────────────────
interface Props { dias: DiasMap; pm: ProductMap; hist?: HistMap }

export default function VentasMix({ dias, pm, hist = {} }: Props) {
  const [mode,    setMode]    = useState<'ver' | 'comparar'>('ver')
  const [canal,   setCanal]   = useState<'todos'|'salon'|'delivery'>('todos')
  const [search,  setSearch]  = useState('')

  // Ver mode
  const allMonths = useMemo(() => availableMonths(dias, hist), [dias, hist])
  const allYears  = useMemo(() => availableYears(dias, hist),  [dias, hist])
  const [period, setPeriod]   = useState(() => allMonths[0] ?? '')

  // Open/collapsed state — empty = all collapsed
  const [openClas,  setOpenClas]  = useState<Set<string>>(new Set())
  const [openSubcl, setOpenSubcl] = useState<Set<string>>(new Set())

  const toggleClas  = useCallback((id: string) => setOpenClas(prev  => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }), [])
  const toggleSubcl = useCallback((id: string) => setOpenSubcl(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }), [])

  // Expand/collapse all
  const [allExpanded, setAllExpanded] = useState(false)

  // Comparar mode
  const [cmpPeriods, setCmpPeriods] = useState<string[]>(() => allMonths.slice(0, 2))

  function toggleCmpPeriod(key: string) {
    setCmpPeriods(prev => {
      const idx = prev.indexOf(key)
      if (idx >= 0) return prev.filter((_, i) => i !== idx)
      if (prev.length >= MAX_CMP) return prev
      return [...prev, key]
    })
  }

  // ── VER mode data ──────────────────────────────────────────────
  const verDates = useMemo(() => {
    const all = [...new Set([...Object.keys(dias), ...Object.keys(hist)])].sort()
    if (period.startsWith('todo-')) return all.filter(d => d.startsWith(period.slice(5))).filter(d => dias[d])
    return all.filter(d => d.startsWith(period)).filter(d => dias[d])
  }, [dias, hist, period])

  const verPM  = useMemo(() => buildPMRaw(verDates, dias, pm, canal), [verDates, dias, pm, canal])
  const verCM  = useMemo(() => groupPM(verPM),                         [verPM])
  const verTots = useMemo(() => calcTotals(verPM, canal),              [verPM, canal])

  // pct color scale for products
  const verAllPcts = useMemo(() => {
    const pcts = Object.values(verPM).filter(p => getMonto(p,canal)>0).map(p => verTots.totG ? getMonto(p,canal)/verTots.totG*100 : 0)
    return { min: Math.min(...pcts, 0), max: Math.max(...pcts, 1) }
  }, [verPM, verTots, canal])

  // ── COMPARAR mode data ─────────────────────────────────────────
  const cmpData = useMemo(() => {
    return cmpPeriods.map(key => {
      const dates = datesForPeriod(key, dias, hist).filter(d => dias[d])
      const PM    = buildPMRaw(dates, dias, pm, canal)
      const CM    = groupPM(PM)
      const tots  = calcTotals(PM, canal)
      return { key, label: labelPeriod(key), PM, CM, tots }
    })
  }, [cmpPeriods, dias, hist, pm, canal, allMonths])

  // Union PM for comparar table
  const masterPM = useMemo(() => {
    const r: Record<string, PMItem> = {}
    for (const c of cmpData)
      for (const [n, p] of Object.entries(c.PM))
        if (!r[n]) r[n] = { ...p, monto: 0, unidades: 0, salon: 0, delivery: 0 }
    return r
  }, [cmpData])
  const masterCM = useMemo(() => groupPM(masterPM), [masterPM])

  // ── Expand/Collapse all handler ────────────────────────────────
  function handleExpandAll(expand: boolean, CM: ClassMap) {
    if (expand) {
      const clsIds  = new Set<string>()
      const subIds  = new Set<string>()
      for (const [clas, cd] of Object.entries(CM)) {
        const cId = slugify(clas)
        clsIds.add(cId)
        for (const subcl of Object.keys(cd.subcls)) subIds.add(`${cId}_s_${slugify(subcl)}`)
      }
      setOpenClas(clsIds)
      setOpenSubcl(subIds)
    } else {
      setOpenClas(new Set())
      setOpenSubcl(new Set())
    }
    setAllExpanded(expand)
  }

  function slugify(s: string) { return s.replace(/[^a-zA-Z0-9]/g,'_') }

  return (
    <div className="vt-section">

      {/* ── Top controls ── */}
      <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1.25rem', flexWrap:'wrap', alignItems:'center' }}>
        <div className="vt-tab-group">
          <button className={`vt-tab-btn ${mode==='ver'     ?'active':''}`} onClick={() => setMode('ver')}>📊 Ver período</button>
          <button className={`vt-tab-btn ${mode==='comparar'?'active':''}`} onClick={() => setMode('comparar')}>⇄ Comparar</button>
        </div>
        <div className="vt-tab-group">
          {(['todos','salon','delivery'] as const).map(c => (
            <button key={c} className={`vt-tab-btn ${canal===c?'active':''}`} onClick={() => setCanal(c)}>
              {c === 'todos' ? 'Salón + Delivery' : c === 'salon' ? 'Solo Salón' : 'Solo Delivery'}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════ VER PERÍODO ══════════════ */}
      {mode === 'ver' && (
        <>
          {/* Period selector */}
          <PeriodSelector
            allYears={allYears} allMonths={allMonths}
            selected={period} onSelect={p => { setPeriod(p); setOpenClas(new Set()); setOpenSubcl(new Set()) }}
          />

          {/* KPIs */}
          <VerKPIs tots={verTots} />

          {/* Table controls */}
          <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'center', marginBottom:'0.75rem' }}>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar producto…"
              style={{ background:'var(--vt-ink)', color:'var(--vt-paper)', border:'1px solid #2a2a2a', padding:'5px 10px', fontSize:'0.8rem', borderRadius:2, width:180 }}
            />
            <button
              onClick={() => handleExpandAll(!allExpanded, verCM)}
              style={{ padding:'5px 12px', border:'1px solid #2a2a2a', borderRadius:2, fontSize:'0.72rem', cursor:'pointer', color:'#888', background:'transparent', marginLeft:'auto', whiteSpace:'nowrap' }}>
              {allExpanded ? '▲ Colapsar todo' : '▼ Expandir todo'}
            </button>
          </div>

          {/* Main table */}
          {verTots.totG > 0 ? (
            <VerTable
              CM={verCM} PM={verPM} tots={verTots}
              canal={canal} search={search}
              pctScale={verAllPcts}
              openClas={openClas} openSubcl={openSubcl}
              onToggleClas={toggleClas} onToggleSubcl={toggleSubcl}
            />
          ) : (
            <div style={{ padding:'2rem', textAlign:'center', color:'#888', fontSize:'0.85rem' }}>
              Sin datos para este período.
            </div>
          )}

          {/* ⚠ Productos sin ventas en el período */}
          <NoVendidos PM={verPM} pm={pm} />
        </>
      )}

      {/* ══════════════ COMPARAR ══════════════ */}
      {mode === 'comparar' && (
        <>
          {/* Period chip selector */}
          <CmpSelector
            allYears={allYears} allMonths={allMonths}
            cmpPeriods={cmpPeriods} onToggle={toggleCmpPeriod}
            onClear={() => setCmpPeriods([])}
          />

          {cmpPeriods.length < 2 ? (
            <div style={{ padding:'2rem', textAlign:'center', color:'#555', fontSize:'0.85rem' }}>
              Seleccioná al menos <strong style={{ color:'#888' }}>2 períodos</strong> para comparar.<br/>
              <span style={{ fontSize:'0.72rem', color:'#444' }}>Hasta {MAX_CMP} períodos simultáneos.</span>
            </div>
          ) : (
            <>
              {/* Multi-period KPI table */}
              <CmpKPIs cmpData={cmpData} />

              {/* Table controls */}
              <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'center', marginBottom:'0.75rem' }}>
                <input
                  type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar producto…"
                  style={{ background:'var(--vt-ink)', color:'var(--vt-paper)', border:'1px solid #2a2a2a', padding:'5px 10px', fontSize:'0.8rem', borderRadius:2, width:180 }}
                />
                <button
                  onClick={() => handleExpandAll(!allExpanded, masterCM)}
                  style={{ padding:'5px 12px', border:'1px solid #2a2a2a', borderRadius:2, fontSize:'0.72rem', cursor:'pointer', color:'#888', background:'transparent', marginLeft:'auto', whiteSpace:'nowrap' }}>
                  {allExpanded ? '▲ Colapsar todo' : '▼ Expandir todo'}
                </button>
              </div>

              {/* Multi-period table */}
              <CmpTable
                cmpData={cmpData} masterCM={masterCM} masterPM={masterPM}
                canal={canal} search={search}
                openClas={openClas} openSubcl={openSubcl}
                onToggleClas={toggleClas} onToggleSubcl={toggleSubcl}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Period selector
// ═══════════════════════════════════════════════════════════════
function PeriodSelector({ allYears, allMonths, selected, onSelect }: {
  allYears: number[]; allMonths: string[]
  selected: string; onSelect: (p: string) => void
}) {
  return (
    <div style={{ background:'var(--vt-ink)', borderRadius:2, padding:'0.75rem 1rem', marginBottom:'1rem' }}>
      {allYears.map(y => (
        <div key={y} style={{ display:'flex', gap:'0.3rem', flexWrap:'wrap', alignItems:'center', marginBottom:'0.35rem' }}>
          <span style={{ fontSize:'0.65rem', color:'#555', minWidth:42, textTransform:'uppercase', letterSpacing:'0.1em' }}>{y}:</span>
          <button
            className={`vt-range-btn ${selected === `todo-${y}` ? 'active' : ''}`}
            onClick={() => onSelect(`todo-${y}`)}>
            Todo {y}
          </button>
          <select
            className={`date-filter ${!selected.startsWith('todo-') && selected.startsWith(String(y)) ? 'active' : ''}`}
            value={!selected.startsWith('todo-') && selected.startsWith(String(y)) ? selected : ''}
            onChange={e => { if (e.target.value) onSelect(e.target.value) }}>
            <option value="">mes ▾</option>
            {allMonths.filter(m => m.startsWith(String(y))).map(m => (
              <option key={m} value={m}>{MSHORT[Number(m.split('-')[1]) - 1]}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// VER mode KPIs
// ═══════════════════════════════════════════════════════════════
function VerKPIs({ tots }: { tots: Tots }) {
  const { totG, totBeb, totCom, totMerch, totLC, totUn } = tots
  const kpis = [
    { label:'Total Mix',     val:fi(totG),                                                                    color:'var(--vt-gold)' },
    { label:'Bebidas',       val:fi(totBeb) + (totG ? ' · ' + (totBeb/totG*100).toFixed(1)+'%' : ''),        color:'#7ec8a0' },
    { label:'Comidas',       val:fi(totCom) + (totG ? ' · ' + (totCom/totG*100).toFixed(1)+'%' : ''),        color:'#c8a96e' },
    { label:'Local Club',    val:fi(totLC)  + (totG ? ' · ' + (totLC/totG*100).toFixed(1)+'%' : ''),         color:'#d4a84b' },
    { label:'Merchandising', val:fi(totMerch) + (totG ? ' · ' + (totMerch/totG*100).toFixed(1)+'%' : ''),    color:'#c890e8' },
    { label:'Unidades',      val:Math.round(totUn).toLocaleString('es-CR'),                                   color:'#aaa' },
    { label:'Ticket / item', val:fi(totUn ? totG / totUn : 0),                                               color:'var(--vt-gold)' },
  ]
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))', gap:'0.5rem', marginBottom:'1rem' }}>
      {kpis.map(k => (
        <div key={k.label} style={{ background:'var(--vt-ink)', padding:'0.625rem 0.75rem', borderRadius:2 }}>
          <div style={{ fontSize:'0.6rem', letterSpacing:'0.12em', textTransform:'uppercase', color:'#555', marginBottom:4 }}>{k.label}</div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:'clamp(0.65rem,1.1vw,0.85rem)', fontWeight:800, color:k.color }}>{k.val}</div>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Comparar selector (chips + period buttons)
// ═══════════════════════════════════════════════════════════════
function CmpSelector({ allYears, allMonths, cmpPeriods, onToggle, onClear }: {
  allYears: number[]; allMonths: string[]
  cmpPeriods: string[]; onToggle: (k: string) => void; onClear: () => void
}) {
  return (
    <div style={{ background:'var(--vt-ink)', borderRadius:2, padding:'0.75rem 1rem', marginBottom:'1rem' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem' }}>
        <span style={{ fontSize:'0.65rem', letterSpacing:'0.15em', textTransform:'uppercase', fontWeight:700, color:'#888' }}>
          PERÍODOS A COMPARAR{' '}
          <span style={{ color:'#555', fontWeight:400 }}>(click · máx {MAX_CMP})</span>
        </span>
        {cmpPeriods.length > 0 && (
          <button onClick={onClear}
            style={{ padding:'0.2rem 0.5rem', border:'1px solid #3a2a2a', color:'#c23b22', background:'transparent', borderRadius:2, fontSize:'0.65rem', cursor:'pointer' }}>
            × Limpiar
          </button>
        )}
      </div>

      {/* Selected chips */}
      {cmpPeriods.length > 0 && (
        <div style={{ display:'flex', gap:'0.35rem', flexWrap:'wrap', marginBottom:'0.6rem', paddingBottom:'0.6rem', borderBottom:'1px solid #1a1a1a' }}>
          {cmpPeriods.map((p, i) => {
            const col = CMP_COLORS[i % CMP_COLORS.length]
            return (
              <div key={p} style={{ display:'flex', alignItems:'center', gap:'0.35rem', padding:'0.25rem 0.5rem', border:`1px solid ${col}`, color:col, background:col+'18', borderRadius:2, fontSize:'0.7rem' }}>
                <span style={{ fontWeight:700, minWidth:14 }}>{i+1}</span>
                {labelPeriod(p)}
                <span onClick={() => onToggle(p)} style={{ cursor:'pointer', opacity:0.7, fontSize:'0.88rem' }}>×</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Selector rows */}
      {/* Year row */}
      <div style={{ display:'flex', gap:'0.25rem', flexWrap:'wrap', alignItems:'center', marginBottom:'0.3rem' }}>
        <span style={{ fontSize:'0.62rem', color:'#555', minWidth:42, textTransform:'uppercase', letterSpacing:'0.1em' }}>Año:</span>
        {allYears.map(y => {
          const key = `todo-${y}`
          const selIdx = cmpPeriods.indexOf(key)
          const isSel = selIdx >= 0
          const col = isSel ? CMP_COLORS[selIdx % CMP_COLORS.length] : ''
          return (
            <div key={key} onClick={() => onToggle(key)}
              style={{ padding:'0.2rem 0.5rem', borderRadius:2, fontSize:'0.7rem', cursor:'pointer', border:`1px solid ${isSel ? col : '#2a2a2a'}`, color:isSel ? col : '#888', background:isSel ? col+'18' : 'transparent', fontWeight:isSel ? 700 : 400, transition:'all .12s', userSelect:'none' }}>
              Todo {y}{isSel ? ' ✓' : ''}
            </div>
          )
        })}
      </div>
      {/* Month rows by year */}
      {allYears.map(y => (
        <div key={y} style={{ display:'flex', gap:'0.2rem', flexWrap:'wrap', alignItems:'center', marginBottom:'0.25rem' }}>
          <span style={{ fontSize:'0.62rem', color:'#444', minWidth:42, textTransform:'uppercase', letterSpacing:'0.08em' }}>{y}:</span>
          {allMonths.filter(m => m.startsWith(String(y))).map(key => {
            const mo = Number(key.split('-')[1])
            const selIdx = cmpPeriods.indexOf(key)
            const isSel = selIdx >= 0
            const col = isSel ? CMP_COLORS[selIdx % CMP_COLORS.length] : ''
            return (
              <div key={key} onClick={() => onToggle(key)}
                style={{ padding:'0.18rem 0.45rem', borderRadius:2, fontSize:'0.68rem', cursor:'pointer', border:`1px solid ${isSel ? col : '#2a2a2a'}`, color:isSel ? col : '#888', background:isSel ? col+'18' : 'transparent', fontWeight:isSel ? 700 : 400, transition:'all .12s', userSelect:'none' }}>
                {MSHORT[mo-1]}{isSel ? ' ✓' : ''}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Comparar KPI table
// ═══════════════════════════════════════════════════════════════
function CmpKPIs({ cmpData }: { cmpData: Array<{ key: string; label: string; PM: Record<string, PMItem>; tots: Tots }> }) {
  const metrics: Array<{ label: string; fn: (t: Tots) => number }> = [
    { label:'Total ventas', fn: t => t.totG },
    { label:'Bebidas',      fn: t => t.totBeb },
    { label:'Comidas',      fn: t => t.totCom },
    { label:'Local Club',   fn: t => t.totLC },
    { label:'Ticket/item',  fn: t => t.totUn ? t.totG / t.totUn : 0 },
  ]
  return (
    <div style={{ background:'var(--vt-ink)', borderRadius:2, padding:'0.75rem', marginBottom:'1rem', overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem', minWidth:360 }}>
        <thead>
          <tr style={{ borderBottom:'1px solid #222' }}>
            <th style={{ textAlign:'left', padding:'0.4rem 0.625rem', fontSize:'0.65rem', color:'#555', fontWeight:400, letterSpacing:'0.1em', textTransform:'uppercase', whiteSpace:'nowrap' }}>Métrica</th>
            {cmpData.map((c, i) => (
              <th key={c.key} style={{ textAlign:'right', padding:'0.4rem 0.625rem', fontSize:'0.65rem', color:CMP_COLORS[i%CMP_COLORS.length], fontWeight:700, whiteSpace:'nowrap' }}>
                ({i+1}) {c.label}
              </th>
            ))}
            {cmpData.length > 1 && (
              <th style={{ textAlign:'right', padding:'0.4rem 0.625rem', fontSize:'0.65rem', color:'#555', fontWeight:400, whiteSpace:'nowrap' }}>vs ①</th>
            )}
          </tr>
        </thead>
        <tbody>
          {metrics.map(m => {
            const vals = cmpData.map(c => m.fn(c.tots))
            const base = vals[0]
            return (
              <tr key={m.label} style={{ borderBottom:'1px solid #111' }}>
                <td style={{ padding:'0.45rem 0.625rem', color:'#aaa', fontWeight:600, whiteSpace:'nowrap' }}>{m.label}</td>
                {vals.map((v, i) => (
                  <td key={i} style={{ padding:'0.45rem 0.625rem', textAlign:'right', color:CMP_COLORS[i%CMP_COLORS.length], fontWeight:700, whiteSpace:'nowrap' }}>
                    {fi(v)}
                  </td>
                ))}
                {cmpData.length > 1 && (
                  <td style={{ padding:'0.45rem 0.625rem', textAlign:'right', whiteSpace:'nowrap' }}>
                    {vals.slice(1).map((v, i) => {
                      if (!base) return <span key={i} style={{ color:'#444' }}>—</span>
                      const pct = (v - base) / Math.abs(base) * 100
                      const col = pct > 0 ? '#7ec8a0' : pct < 0 ? '#c23b22' : '#888'
                      return <span key={i} style={{ color:col, fontSize:'0.68rem', fontWeight:700, marginLeft: i > 0 ? '0.3rem' : 0 }}>
                        {pct >= 0 ? '▲ +' : '▼ '}{pct.toFixed(1)}%
                      </span>
                    })}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// VER mode table
// ═══════════════════════════════════════════════════════════════
function VerTable({ CM, PM, tots, canal, search, pctScale, openClas, openSubcl, onToggleClas, onToggleSubcl }: {
  CM: ClassMap; PM: Record<string, PMItem>; tots: Tots
  canal: 'todos'|'salon'|'delivery'; search: string
  pctScale: { min: number; max: number }
  openClas: Set<string>; openSubcl: Set<string>
  onToggleClas: (id: string) => void; onToggleSubcl: (id: string) => void
}) {
  function slugify(s: string) { return s.replace(/[^a-zA-Z0-9]/g,'_') }

  const rows: ReactElement[] = []
  let gT = 0, gU = 0

  for (const sec of SECTIONS) {
    // Filter which clas belong to this section
    const secClas = Object.keys(CM).filter(c =>
      Object.values(CM[c].subcls).some(sd =>
        sd.prods.some(p => {
          if (!sec.filterFn(p)) return false
          if (search && !p.nombre.toLowerCase().includes(search.toLowerCase())) return false
          return getMonto(p, canal) > 0
        })
      )
    )
    if (!secClas.length) continue

    const orderedClas = sortClas(secClas, sec.clasOrder)
    let secTotal = 0
    for (const c of orderedClas)
      for (const sd of Object.values(CM[c].subcls))
        for (const p of sd.prods)
          if (sec.filterFn(p)) secTotal += getMonto(p, canal)

    // Section header
    rows.push(
      <tr key={`sec-${sec.label}`} style={{ background:'#0a0a14', borderTop:`3px solid #1a1a2a` }}>
        <td colSpan={8} style={{ padding:'0.45rem 0.625rem', fontSize:'0.7rem', letterSpacing:'0.2em', textTransform:'uppercase', color:sec.color, fontWeight:700 }}>
          {sec.label}
          <span style={{ color:'#444', fontWeight:400, marginLeft:'0.5rem', fontSize:'0.72rem' }}>
            {fi(secTotal)} · {tots.totG ? (secTotal/tots.totG*100).toFixed(1)+'%' : '—'}
          </span>
        </td>
      </tr>
    )

    for (const clas of orderedClas) {
      const cd = CM[clas]
      // Build filtered subcl list
      const subKeys = Object.keys(cd.subcls).sort()
      // If subcl === clas, put it first
      const subFirst = subKeys.includes(clas) ? [clas, ...subKeys.filter(s => s !== clas)] : subKeys
      const subFil: Array<{ subcl: string; prods: PMItem[] }> = []
      for (const subcl of subFirst) {
        const pf = cd.subcls[subcl].prods.filter(p => {
          if (!sec.filterFn(p)) return false
          if (search && !p.nombre.toLowerCase().includes(search.toLowerCase())) return false
          return getMonto(p, canal) > 0
        })
        if (pf.length) subFil.push({ subcl, prods: pf })
      }
      if (!subFil.length) continue

      let cM=0, cU=0, cSal=0, cDel=0
      for (const sf of subFil) for (const p of sf.prods) { cM+=getMonto(p,canal); cU+=p.unidades; cSal+=p.salon; cDel+=p.delivery }
      gT += cM; gU += cU

      const cId  = slugify(clas)
      const pC   = tots.totG ? cM/tots.totG*100 : 0
      const open = openClas.has(cId)

      rows.push(
        <tr key={`clas-${cId}`}
          style={{ background:'#1c1c1c', borderTop:'2px solid #2a2a2a', cursor:'pointer' }}
          onClick={() => onToggleClas(cId)}>
          <td style={{ padding:'0.6rem 0.625rem', fontSize:'0.72rem', letterSpacing:'0.1em', textTransform:'uppercase', fontWeight:700, color:sec.color }}>
            <span style={{ display:'inline-block', width:12, fontSize:'0.6rem' }}>{open ? '▼' : '▶'}</span> {clas}
          </td>
          <td style={{ padding:'0.6rem 0.5rem', textAlign:'right', color:'#aaa', fontSize:'0.8rem' }}>{Math.round(cU).toLocaleString('es-CR')}</td>
          <td style={{ padding:'0.6rem 0.5rem', textAlign:'right', color:sec.color, fontWeight:700 }}>₡{Math.round(cM).toLocaleString('es-CR')}</td>
          <td style={{ padding:'0.6rem 0.5rem', textAlign:'right', color:sec.color, fontWeight:700 }}>{pC.toFixed(2)}%</td>
          <td style={{ padding:'0.6rem 0.5rem', textAlign:'right', color:'#333' }}>—</td>
          <td style={{ padding:'0.6rem 0.5rem', textAlign:'right', color:'#7aaa7a', fontSize:'0.78rem' }}>{cSal>0?'₡'+Math.round(cSal).toLocaleString('es-CR'):'—'}</td>
          <td style={{ padding:'0.6rem 0.5rem', textAlign:'right', color:'#8ab4d4', fontSize:'0.78rem' }}>{cDel>0?'₡'+Math.round(cDel).toLocaleString('es-CR'):'—'}</td>
          <td/>
        </tr>
      )

      if (!open) continue

      // Subcl rows
      for (const sf of subFil) {
        const { subcl, prods } = sf
        let sM=0, sU=0, sSal=0, sDel=0
        for (const p of prods) { sM+=getMonto(p,canal); sU+=p.unidades; sSal+=p.salon; sDel+=p.delivery }

        const sId    = `${cId}_s_${slugify(subcl)}`
        const pS     = tots.totG ? sM/tots.totG*100 : 0
        const pSClas = cM ? sM/cM*100 : 0
        const clColorS = pSClas > 40 ? '#7ec8a0' : pSClas > 15 ? '#c8a96e' : '#888'
        const sOpen  = openSubcl.has(sId)

        rows.push(
          <tr key={`sub-${sId}`}
            style={{ background:'#141414', cursor:'pointer' }}
            onClick={e => { e.stopPropagation(); onToggleSubcl(sId) }}>
            <td style={{ padding:'0.5rem 0.625rem 0.5rem 1.5rem', fontSize:'0.7rem', letterSpacing:'0.08em', textTransform:'uppercase', color:'#bbb' }}>
              <span style={{ display:'inline-block', width:12, fontSize:'0.6rem' }}>{sOpen ? '▼' : '▶'}</span> {subcl}
            </td>
            <td style={{ padding:'0.5rem 0.5rem', textAlign:'right', color:'#666', fontSize:'0.8rem' }}>{Math.round(sU).toLocaleString('es-CR')}</td>
            <td style={{ padding:'0.5rem 0.5rem', textAlign:'right', color:'#aaa', fontSize:'0.8rem' }}>₡{Math.round(sM).toLocaleString('es-CR')}</td>
            <td style={{ padding:'0.5rem 0.5rem', textAlign:'right', color:'#888', fontSize:'0.8rem' }}>{pS.toFixed(2)}%</td>
            <td style={{ padding:'0.5rem 0.5rem', textAlign:'right' }}>
              <span style={{ fontSize:'0.78rem', fontWeight:600, color:clColorS }}>{pSClas.toFixed(1)}%</span>
            </td>
            <td style={{ padding:'0.5rem 0.5rem', textAlign:'right', color:'#7aaa7a', fontSize:'0.75rem' }}>{sSal>0?'₡'+Math.round(sSal).toLocaleString('es-CR'):'—'}</td>
            <td style={{ padding:'0.5rem 0.5rem', textAlign:'right', color:'#8ab4d4', fontSize:'0.75rem' }}>{sDel>0?'₡'+Math.round(sDel).toLocaleString('es-CR'):'—'}</td>
            <td/>
          </tr>
        )

        if (!sOpen) continue

        // Product rows
        const sorted = [...prods].sort((a,b) => a.nombre < b.nombre ? -1 : 1)
        sorted.forEach((p, pi) => {
          const pm  = getMonto(p, canal)
          const pct = tots.totG ? pm/tots.totG*100 : 0
          const pctClas = sM ? pm/sM*100 : 0
          const pColor    = pctBarColor(pct, pctScale.min, pctScale.max)
          const clColorP  = pctClas > 30 ? '#7ec8a0' : pctClas > 10 ? '#c8a96e' : '#888'
          const bg = pi % 2 === 0 ? '#0d0d0d' : '#111'
          const tc = tipColor(p.tipo)

          rows.push(
            <tr key={`prod-${sId}-${p.nombre}`} style={{ background:bg, borderBottom:'1px solid #161616' }}>
              <td style={{ padding:'0.45rem 0.625rem 0.45rem 2.5rem', color:'var(--vt-paper)', fontSize:'0.78rem' }}>{p.nombre}</td>
              <td style={{ padding:'0.45rem 0.5rem', textAlign:'right', color:'#888', fontSize:'0.78rem' }}>{Math.round(p.unidades).toLocaleString('es-CR')}</td>
              <td style={{ padding:'0.45rem 0.5rem', textAlign:'right', color:'var(--vt-paper)', fontSize:'0.78rem' }}>{pm?'₡'+Math.round(pm).toLocaleString('es-CR'):'—'}</td>
              <td style={{ padding:'0.45rem 0.5rem', textAlign:'right' }}>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2 }}>
                  <span style={{ fontSize:'0.7rem', color:pColor, whiteSpace:'nowrap' }}>{pct.toFixed(2)}%</span>
                  <div style={{ height:2, width:'100%', background:'#1a1a1a', borderRadius:1, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${Math.min(pct*8,100).toFixed(0)}%`, background:pColor, borderRadius:1 }}/>
                  </div>
                </div>
              </td>
              <td style={{ padding:'0.45rem 0.5rem', textAlign:'right' }}>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2 }}>
                  <span style={{ fontSize:'0.7rem', fontWeight:600, color:clColorP, whiteSpace:'nowrap' }}>{pctClas.toFixed(1)}%</span>
                  <div style={{ height:2, width:'100%', background:'#1a1a1a', borderRadius:1, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${Math.min(pctClas*2,100).toFixed(0)}%`, background:clColorP, borderRadius:1 }}/>
                  </div>
                </div>
              </td>
              <td style={{ padding:'0.45rem 0.5rem', textAlign:'right', color:'#7aaa7a', fontSize:'0.75rem' }}>{p.salon>0?'₡'+Math.round(p.salon).toLocaleString('es-CR'):'—'}</td>
              <td style={{ padding:'0.45rem 0.5rem', textAlign:'right', color:'#8ab4d4', fontSize:'0.75rem' }}>{p.delivery>0?'₡'+Math.round(p.delivery).toLocaleString('es-CR'):'—'}</td>
              <td style={{ padding:'0.45rem 0.5rem', textAlign:'center' }}>
                <span style={{ fontSize:'0.58rem', letterSpacing:'0.06em', textTransform:'uppercase', color:tc, padding:'1px 4px', border:`1px solid ${tc}44`, borderRadius:2, whiteSpace:'nowrap' }}>{p.tipo}</span>
              </td>
            </tr>
          )
        })
      }
    }
  }

  const nProds = Object.values(PM).filter(p => getMonto(p, canal) > 0).length

  return (
    <div style={{ overflowX:'auto', marginBottom:'1.25rem' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem', tableLayout:'fixed' }}>
        <thead>
          <tr style={{ background:'var(--vt-ink)', color:'#aaa' }}>
            {[
              ['Clasificacion / Producto','left','28%'],['Uds','right','7%'],['Monto','right',''],
              ['% Total','right','8%'],['% Secc','right','8%'],['Salón','right',''],['Delivery','right',''],['Tipo','center','7%'],
            ].map(([h,a,w]) => (
              <th key={h} style={{ padding:'0.55rem 0.5rem', textAlign:a as 'left'|'right'|'center', fontSize:'0.62rem', letterSpacing:'0.12em', textTransform:'uppercase', fontWeight:500, whiteSpace:'nowrap', ...(w ? {width:w} : {}) }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
        <tfoot>
          <tr style={{ background:'var(--vt-ink)', borderTop:'2px solid #2a2a2a' }}>
            <td style={{ padding:'0.625rem 0.625rem', fontSize:'0.72rem', letterSpacing:'0.1em', textTransform:'uppercase', fontWeight:700, color:'var(--vt-gold)' }}>
              TOTAL · {nProds} productos
            </td>
            <td style={{ padding:'0.625rem 0.5rem', textAlign:'right', color:'var(--vt-gold)', fontWeight:700 }}>{Math.round(gU).toLocaleString('es-CR')}</td>
            <td style={{ padding:'0.625rem 0.5rem', textAlign:'right', color:'var(--vt-gold)', fontWeight:700 }}>₡{Math.round(gT).toLocaleString('es-CR')}</td>
            <td style={{ padding:'0.625rem 0.5rem', textAlign:'right', color:'var(--vt-gold)', fontWeight:700 }}>100%</td>
            <td colSpan={4}/>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// COMPARAR mode table (N periods)
// ═══════════════════════════════════════════════════════════════
function CmpTable({ cmpData, masterCM, masterPM, canal, search, openClas, openSubcl, onToggleClas, onToggleSubcl }: {
  cmpData: Array<{ key: string; label: string; PM: Record<string, PMItem>; tots: Tots }>
  masterCM: ClassMap; masterPM: Record<string, PMItem>
  canal: 'todos'|'salon'|'delivery'; search: string
  openClas: Set<string>; openSubcl: Set<string>
  onToggleClas: (id: string) => void; onToggleSubcl: (id: string) => void
}) {
  function slugify(s: string) { return s.replace(/[^a-zA-Z0-9]/g,'_') }
  const N = cmpData.length

  function varVsFirst(vals: number[]): ReactElement {
    const base = vals[0]
    if (!base || N < 2) return <span style={{ color:'#333' }}>—</span>
    return (
      <>
        {vals.slice(1).map((v, i) => {
          const pct = (v - base) / Math.abs(base) * 100
          const col = pct > 0 ? '#7ec8a0' : pct < 0 ? '#c23b22' : '#888'
          return <span key={i} style={{ color:col, fontSize:'0.68rem', fontWeight:700, marginLeft: i>0 ? '0.25rem' : 0 }}>
            {pct >= 0 ? '▲ +' : '▼ '}{pct.toFixed(1)}%
          </span>
        })}
      </>
    )
  }

  const rows: ReactElement[] = []
  let gTs = new Array(N).fill(0)

  for (const sec of SECTIONS) {
    const secClas = Object.keys(masterCM).filter(c =>
      Object.values(masterCM[c].subcls).some(sd =>
        sd.prods.some(p => {
          if (!sec.filterFn(p)) return false
          if (search && !p.nombre.toLowerCase().includes(search.toLowerCase())) return false
          return cmpData.some(cd => getMonto(cd.PM[p.nombre] as PMItem ?? { monto:0, salon:0, delivery:0 }, canal) > 0)
        })
      )
    )
    if (!secClas.length) continue

    const orderedClas = sortClas(secClas, sec.clasOrder)
    const secTots = cmpData.map(cd => {
      let t = 0
      for (const c of orderedClas)
        for (const sd of Object.values(masterCM[c].subcls))
          for (const p of sd.prods)
            if (sec.filterFn(p)) { const pp = cd.PM[p.nombre]; if (pp) t += getMonto(pp, canal) }
      return t
    })

    rows.push(
      <tr key={`sec-${sec.label}`} style={{ background:'#0a0a14', borderTop:'3px solid #1a1a2a' }}>
        <td colSpan={2 + N*3 + (N>1?1:0)} style={{ padding:'0.45rem 0.625rem', fontSize:'0.7rem', letterSpacing:'0.2em', textTransform:'uppercase', color:sec.color, fontWeight:700 }}>
          {sec.label}
          <span style={{ fontWeight:400, fontSize:'0.68rem', marginLeft:'0.5rem' }}>
            {secTots.map((t, i) => (
              <span key={i} style={{ color:CMP_COLORS[i%CMP_COLORS.length], marginLeft: i>0 ? '0.5rem' : 0 }}>
                ₡{Math.round(t).toLocaleString('es-CR')}
              </span>
            ))}
          </span>
        </td>
      </tr>
    )

    for (const clas of orderedClas) {
      const cd = masterCM[clas]
      const subKeys = Object.keys(cd.subcls).sort()
      const subFirst = subKeys.includes(clas) ? [clas, ...subKeys.filter(s => s !== clas)] : subKeys
      const subFil: Array<{ subcl: string; prods: PMItem[] }> = []
      for (const subcl of subFirst) {
        const pf = cd.subcls[subcl].prods.filter(p => {
          if (!sec.filterFn(p)) return false
          if (search && !p.nombre.toLowerCase().includes(search.toLowerCase())) return false
          return cmpData.some(c => { const pp = c.PM[p.nombre]; return !!pp && getMonto(pp, canal) > 0 })
        })
        if (pf.length) subFil.push({ subcl, prods: pf })
      }
      if (!subFil.length) continue

      const clasTots = cmpData.map(c => {
        let t = 0
        for (const sf of subFil) for (const p of sf.prods) { const pp=c.PM[p.nombre]; if(pp&&sec.filterFn(p)) t+=getMonto(pp,canal) }
        return t
      })
      clasTots.forEach((t,i) => gTs[i] += t)

      const cId  = slugify(clas)
      const open = openClas.has(cId)

      rows.push(
        <tr key={`clas-${cId}`} style={{ background:'#1c1c1c', borderTop:'2px solid #2a2a2a', cursor:'pointer' }}
          onClick={() => onToggleClas(cId)}>
          <td style={{ padding:'0.6rem 0.625rem', fontSize:'0.72rem', letterSpacing:'0.1em', textTransform:'uppercase', fontWeight:700, color:sec.color }}>
            <span style={{ display:'inline-block', width:12, fontSize:'0.6rem' }}>{open ? '▼' : '▶'}</span> {clas}
          </td>
          <td/>
          {clasTots.map((t, i) => {
            const col = CMP_COLORS[i%CMP_COLORS.length]
            const pctT = cmpData[i].tots.totG ? t/cmpData[i].tots.totG*100 : 0
            return [
              <td key={`m${i}`} style={{ padding:'0.6rem 0.5rem', textAlign:'right', color:col, fontWeight:700, whiteSpace:'nowrap' }}>
                {t ? '₡'+Math.round(t).toLocaleString('es-CR') : '—'}
              </td>,
              <td key={`p${i}`} style={{ padding:'0.6rem 0.4rem', textAlign:'right', color:sec.color, fontSize:'0.72rem' }}>{pctT.toFixed(1)}%</td>,
              <td key={`s${i}`} style={{ padding:'0.6rem 0.4rem', textAlign:'right', color:'#333', fontSize:'0.72rem' }}>—</td>,
            ]
          })}
          {N > 1 && <td style={{ padding:'0.6rem 0.5rem', textAlign:'right' }}>{varVsFirst(clasTots)}</td>}
        </tr>
      )

      if (!open) continue

      for (const sf of subFil) {
        const { subcl, prods } = sf
        const subTots = cmpData.map(c => { let t=0; for(const p of prods){const pp=c.PM[p.nombre]; if(pp&&sec.filterFn(p))t+=getMonto(pp,canal)} return t })
        const sId  = `${cId}_s_${slugify(subcl)}`
        const sOpen = openSubcl.has(sId)

        rows.push(
          <tr key={`sub-${sId}`} style={{ background:'#141414', cursor:'pointer' }}
            onClick={e => { e.stopPropagation(); onToggleSubcl(sId) }}>
            <td style={{ padding:'0.5rem 0.625rem 0.5rem 1.5rem', fontSize:'0.7rem', letterSpacing:'0.08em', textTransform:'uppercase', color:'#bbb' }}>
              <span style={{ display:'inline-block', width:12, fontSize:'0.6rem' }}>{sOpen ? '▼' : '▶'}</span> {subcl}
            </td>
            <td/>
            {subTots.map((t, i) => {
              const col = CMP_COLORS[i%CMP_COLORS.length]
              const pctT = cmpData[i].tots.totG ? t/cmpData[i].tots.totG*100 : 0
              const pctC = clasTots[i] ? t/clasTots[i]*100 : 0
              const clColorS = pctC > 40 ? '#7ec8a0' : pctC > 15 ? '#c8a96e' : '#888'
              return [
                <td key={`m${i}`} style={{ padding:'0.5rem 0.5rem', textAlign:'right', color:col, fontSize:'0.78rem', whiteSpace:'nowrap' }}>
                  {t ? '₡'+Math.round(t).toLocaleString('es-CR') : '—'}
                </td>,
                <td key={`p${i}`} style={{ padding:'0.5rem 0.4rem', textAlign:'right', color:'#888', fontSize:'0.7rem' }}>{pctT.toFixed(1)}%</td>,
                <td key={`s${i}`} style={{ padding:'0.5rem 0.4rem', textAlign:'right', fontSize:'0.7rem' }}>
                  <span style={{ color:clColorS, fontWeight:600 }}>{pctC.toFixed(1)}%</span>
                </td>,
              ]
            })}
            {N > 1 && <td style={{ padding:'0.5rem 0.5rem', textAlign:'right' }}>{varVsFirst(subTots)}</td>}
          </tr>
        )

        if (!sOpen) continue

        const sorted = [...prods].sort((a,b) => a.nombre < b.nombre ? -1 : 1)
        sorted.forEach((p, pi) => {
          const prodTots = cmpData.map(c => { const pp=c.PM[p.nombre]; return pp ? getMonto(pp,canal) : 0 })
          if (prodTots.every(v => v === 0)) return
          const tc = tipColor(p.tipo)
          const bg = pi % 2 === 0 ? '#0d0d0d' : '#111'

          rows.push(
            <tr key={`prod-${sId}-${p.nombre}`} style={{ background:bg, borderBottom:'1px solid #161616' }}>
              <td style={{ padding:'0.45rem 0.625rem 0.45rem 2.5rem', color:'var(--vt-paper)', fontSize:'0.75rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:180 }}>
                {p.nombre}
              </td>
              <td style={{ padding:'0.45rem 0.4rem', textAlign:'center' }}>
                <span style={{ fontSize:'0.58rem', letterSpacing:'0.06em', textTransform:'uppercase', color:tc, padding:'1px 3px', border:`1px solid ${tc}44`, borderRadius:2, whiteSpace:'nowrap' }}>{p.tipo}</span>
              </td>
              {prodTots.map((pm, i) => {
                const col = CMP_COLORS[i%CMP_COLORS.length]
                const pctT = cmpData[i].tots.totG ? pm/cmpData[i].tots.totG*100 : 0
                const pctC = subTots[i] ? pm/subTots[i]*100 : 0
                const clColorP = pctC > 30 ? '#7ec8a0' : pctC > 10 ? '#c8a96e' : '#888'
                return [
                  <td key={`m${i}`} style={{ padding:'0.45rem 0.5rem', textAlign:'right', color: pm>0 ? col : '#555', fontSize:'0.75rem', whiteSpace:'nowrap' }}>
                    {pm > 0 ? '₡'+Math.round(pm).toLocaleString('es-CR') : '—'}
                  </td>,
                  <td key={`p${i}`} style={{ padding:'0.45rem 0.4rem', textAlign:'right', color:'#666', fontSize:'0.68rem' }}>{pctT.toFixed(2)}%</td>,
                  <td key={`s${i}`} style={{ padding:'0.45rem 0.4rem', textAlign:'right', fontSize:'0.68rem' }}>
                    <span style={{ color:clColorP, fontWeight:600 }}>{pctC.toFixed(1)}%</span>
                  </td>,
                ]
              })}
              {N > 1 && <td style={{ padding:'0.45rem 0.5rem', textAlign:'right' }}>{varVsFirst(prodTots)}</td>}
            </tr>
          )
        })
      }
    }
  }

  const nProds = Object.values(masterPM).filter(p => cmpData.some(c => getMonto(c.PM[p.nombre] as PMItem ?? { monto:0, salon:0, delivery:0 }, canal) > 0)).length

  return (
    <div style={{ overflowX:'auto', marginBottom:'1.25rem' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
        <thead>
          <tr style={{ background:'var(--vt-ink)', color:'#aaa' }}>
            <th style={{ padding:'0.55rem 0.625rem', textAlign:'left', fontSize:'0.62rem', letterSpacing:'0.12em', textTransform:'uppercase', fontWeight:500, whiteSpace:'nowrap', minWidth:180 }}>Clas / Producto</th>
            <th style={{ padding:'0.55rem 0.4rem', fontSize:'0.6rem', letterSpacing:'0.1em', textTransform:'uppercase', fontWeight:400, whiteSpace:'nowrap' }}>Tipo</th>
            {cmpData.map((c, i) => (
              [
                <th key={`m${i}`} style={{ padding:'0.55rem 0.5rem', textAlign:'right', fontSize:'0.62rem', letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:700, color:CMP_COLORS[i%CMP_COLORS.length], whiteSpace:'nowrap', minWidth:90 }}>
                  ({i+1}) {c.label}
                </th>,
                <th key={`p${i}`} style={{ padding:'0.55rem 0.4rem', textAlign:'right', fontSize:'0.58rem', color:'#555', whiteSpace:'nowrap' }}>%Tot</th>,
                <th key={`s${i}`} style={{ padding:'0.55rem 0.4rem', textAlign:'right', fontSize:'0.58rem', color:'#555', whiteSpace:'nowrap' }}>%Sec</th>,
              ]
            ))}
            {N > 1 && <th style={{ padding:'0.55rem 0.5rem', textAlign:'right', fontSize:'0.58rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'#555', whiteSpace:'nowrap' }}>vs ①</th>}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
        <tfoot>
          <tr style={{ background:'var(--vt-ink)', borderTop:'2px solid #2a2a2a' }}>
            <td style={{ padding:'0.625rem 0.625rem', fontSize:'0.72rem', letterSpacing:'0.1em', textTransform:'uppercase', fontWeight:700, color:'var(--vt-gold)' }}>
              TOTAL · {nProds} prods
            </td>
            <td/>
            {gTs.map((t, i) => [
              <td key={`m${i}`} style={{ padding:'0.625rem 0.5rem', textAlign:'right', color:CMP_COLORS[i%CMP_COLORS.length], fontWeight:700, whiteSpace:'nowrap' }}>
                ₡{Math.round(t).toLocaleString('es-CR')}
              </td>,
              <td key={`p${i}`} style={{ padding:'0.625rem 0.4rem', textAlign:'right', color:CMP_COLORS[i%CMP_COLORS.length], fontWeight:700 }}>100%</td>,
              <td key={`s${i}`}/>,
            ])}
            {N > 1 && <td style={{ padding:'0.625rem 0.5rem', textAlign:'right' }}>{(() => { const pct = gTs[0] ? (gTs[1]-gTs[0])/gTs[0]*100 : null; const col = pct!=null?(pct>=0?'#7ec8a0':'#c23b22'):'#555'; return <span style={{color:col,fontWeight:700,fontSize:'0.72rem'}}>{pct!=null?(pct>=0?'▲ +':'▼ ')+pct.toFixed(1)+'%':'—'}</span> })()}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// ⚠ Productos sin ventas en el período seleccionado
// ═══════════════════════════════════════════════════════════════
function NoVendidos({ PM, pm }: { PM: Record<string, PMItem>; pm: ProductMap }) {
  const [open, setOpen] = useState(false)
  const vendidos = new Set(Object.keys(PM))
  const noVendidos = Object.entries(pm)
    .filter(([n, info]) => !vendidos.has(n) && info.tipo !== 'cortesia' && info.tipo !== 'personal' && info.tipo !== 'comensales')
    .map(([nombre, info]) => ({ nombre, tipo: info.tipo ?? 'desconocido' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
  if (!noVendidos.length) return null
  const byTipo: Record<string, string[]> = {}
  for (const p of noVendidos) {
    if (!byTipo[p.tipo]) byTipo[p.tipo] = []
    byTipo[p.tipo].push(p.nombre)
  }
  const tipCol = (tipo: string) => ({ bebida:'#7ec8a0', comida:'#c8a96e', merchandising:'#c890e8', nofood:'#c890e8' }[tipo] ?? '#555')
  return (
    <div style={{ marginTop:'0.75rem', marginBottom:'1.5rem' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.5rem 0.75rem', background:'#0d0d0d', borderTop:'3px solid #2a2a2a', cursor:'pointer', userSelect:'none' }}>
        <span style={{ fontSize:'0.65rem', letterSpacing:'0.2em', textTransform:'uppercase', color:'#555', fontWeight:700 }}>
          ⚠ PRODUCTOS SIN VENTAS EN ESTE PERÍODO
        </span>
        <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
          <span style={{ fontSize:'0.68rem', color:'#666', background:'#1a1a1a', padding:'2px 8px', borderRadius:10, border:'1px solid #2a2a2a' }}>{noVendidos.length} productos</span>
          <span style={{ fontSize:'0.72rem', color:'#555' }}>{open ? '▼ ocultar' : '▶ mostrar'}</span>
        </div>
      </div>
      {open && (
        <div style={{ padding:'0.625rem 0.75rem', background:'#080808', display:'flex', flexWrap:'wrap', gap:'0.3rem' }}>
          {Object.entries(byTipo).sort().map(([tipo, nombres]) =>
            nombres.map(n => (
              <span key={n} style={{ fontSize:'0.68rem', color:tipCol(tipo), background:'#0a0a0a', padding:'2px 8px', border:`1px solid ${tipCol(tipo)}22`, borderRadius:2 }}>{n}</span>
            ))
          )}
        </div>
      )}
    </div>
  )
}
