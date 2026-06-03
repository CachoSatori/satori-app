/**
 * FinanzasModule — Estado de Resultados (P&L) estilo QuickBooks
 * Plan de cuentas jerárquico + Presupuesto (proyección) vs Real, por mes.
 * Requiere migration 006_finance.sql aplicada.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import {
  getFinanceAccounts, getFinanceBudget, getFinanceActuals, getLiveActuals,
  type FinanceAccount, type FinanceCell,
} from '../../shared/api/finance'

const MN = ['Total año','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MUTED = '#5a5040', BORDER = 'var(--t-border,#d4cfc4)', INK = 'var(--t-ink,#0d0d0d)'
function fi(n: number) { return '₡ ' + Math.round(n).toLocaleString('es-CR') }

function Kpi({ label, val, color }: { label: string; val: string; color?: string }) {
  return (
    <div style={{ background: INK, borderRadius: 3, padding: '0.7rem 0.95rem', minWidth: 130 }}>
      <div style={{ fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8a8170', marginBottom: '0.3rem' }}>{label}</div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: color ?? '#f0ece4', fontFamily: 'var(--font-serif)' }}>{val}</div>
    </div>
  )
}

export default function FinanzasModule() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState<FinanceAccount[]>([])
  const [budget, setBudget]     = useState<FinanceCell[]>([])
  const [actuals, setActuals]   = useState<FinanceCell[]>([])
  const [year, setYear]         = useState(2026)
  const [month, setMonth]       = useState(0)      // 0 = total año
  const [loading, setLoading]   = useState(true)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [acc, bud, act, live] = await Promise.all([
        getFinanceAccounts(), getFinanceBudget(year), getFinanceActuals(year),
        getLiveActuals(year).catch(() => [] as FinanceCell[]),
      ])
      // Merge "Real" manual + automático (datos vivos de la app) por cuenta/mes
      const merged: Record<string, FinanceCell> = {}
      for (const c of [...act, ...live]) {
        const k = `${c.account_id}|${c.month}`
        if (!merged[k]) merged[k] = { account_id: c.account_id, year, month: c.month, amount: 0 }
        merged[k].amount += Number(c.amount) || 0
      }
      setAccounts(acc); setBudget(bud); setActuals(Object.values(merged)); setNeedsMigration(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error'
      if (/relation|does not exist|finance_/i.test(msg)) setNeedsMigration(true)
      else setError(msg)
    } finally { setLoading(false) }
  }, [year])
  useEffect(() => { load() }, [load])

  // amount por cuenta hoja para el período elegido
  const amount = useMemo(() => {
    const build = (cells: FinanceCell[]) => {
      const m: Record<string, number> = {}
      for (const c of cells) {
        if (month !== 0 && c.month !== month) continue
        m[c.account_id] = (m[c.account_id] ?? 0) + Number(c.amount || 0)
      }
      return m
    }
    return { bud: build(budget), act: build(actuals) }
  }, [budget, actuals, month])

  // árbol: hijos por parent
  const childrenOf = useMemo(() => {
    const m: Record<string, FinanceAccount[]> = {}
    for (const a of accounts) { const p = a.parent_id ?? '__root'; (m[p] ??= []).push(a) }
    return m
  }, [accounts])

  const depthOf = useMemo(() => {
    const byId = new Map(accounts.map(a => [a.id, a]))
    const d: Record<string, number> = {}
    const calc = (id: string): number => {
      if (d[id] != null) return d[id]
      const a = byId.get(id); const p = a?.parent_id
      d[id] = p ? calc(p) + 1 : 0
      return d[id]
    }
    accounts.forEach(a => calc(a.id))
    return d
  }, [accounts])

  // valor recursivo (hoja = amount; header = suma de hijos)
  function valueOf(id: string, src: Record<string, number>): number {
    const a = accounts.find(x => x.id === id)
    if (!a) return 0
    if (a.is_leaf) return src[id] ?? 0
    return (childrenOf[id] ?? []).reduce((s, c) => s + valueOf(c.id, src), 0)
  }

  // totales por sección
  const totals = useMemo(() => {
    const sum = (src: Record<string, number>, sec: string) =>
      accounts.filter(a => a.is_leaf && a.section === sec).reduce((s, a) => s + (src[a.id] ?? 0), 0)
    const t = (src: Record<string, number>) => {
      const income = sum(src, 'income'), cogs = sum(src, 'cogs'), exp = sum(src, 'expenses')
      return { income, cogs, gross: income - cogs, exp, net: income - cogs - exp }
    }
    return { bud: t(amount.bud), act: t(amount.act) }
  }, [accounts, amount])

  // orden de render (sort), saltando totales calculados
  const ordered = useMemo(() => [...accounts].sort((a, b) => a.sort - b.sort), [accounts])

  if (loading) return <div className="tips-module"><div className="module-loading"><span className="loading-mark">財</span></div></div>

  return (
    <div className="tips-module">
      {/* Header */}
      <div className="tips-header">
        <div className="tips-header-left">
          <span className="tips-kanji">財</span>
          <div>
            <h2 className="tips-title">Finanzas</h2>
            <p className="tips-subtitle">Estado de Resultados · P&amp;L</p>
          </div>
          {profile?.role && <span className="role-badge">{profile.role}</span>}
        </div>
        <button className="cash-back-btn" style={{ borderColor: '#333', color: '#888', whiteSpace: 'nowrap' }}
          onClick={() => navigate('/')}>← Inicio</button>
      </div>

      {error && <div className="tips-error"><span>{error}</span><button onClick={() => setError(null)}>✕</button></div>}

      {needsMigration ? (
        <div style={{ padding: '2rem', maxWidth: 620, margin: '2rem auto', textAlign: 'center', color: MUTED }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🗄</div>
          <div style={{ fontWeight: 700, color: INK, marginBottom: '0.5rem' }}>Falta aplicar la migración de Finanzas</div>
          <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
            Aplicá <code>supabase/migrations/006_finance.sql</code> en Supabase (carga el plan de cuentas + budget 2026)
            y recargá esta pantalla.
          </div>
        </div>
      ) : (
        <div className="tips-body">
          {/* Controles */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <select className="date-filter active" value={year} onChange={e => setYear(Number(e.target.value))}>
              {[2026, 2025, 2024, 2023].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className={`date-filter ${month !== 0 ? 'active' : ''}`} value={month} onChange={e => setMonth(Number(e.target.value))}>
              {MN.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <span style={{ fontSize: '0.7rem', color: MUTED, marginLeft: 'auto' }}>
              Presupuesto vs Real · {month === 0 ? `año ${year}` : `${MN[month]} ${year}`}
            </span>
          </div>

          {/* KPIs */}
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            <Kpi label="Ingresos" val={fi(totals.bud.income)} />
            <Kpi label="Costo de ventas" val={fi(totals.bud.cogs)} color="#c89a9a" />
            <Kpi label="Utilidad bruta" val={fi(totals.bud.gross)} color="#7ec8a0" />
            <Kpi label="Gastos" val={fi(totals.bud.exp)} color="#c89a9a" />
            <Kpi label="Utilidad neta" val={fi(totals.bud.net)} color={totals.bud.net >= 0 ? '#7ec8a0' : '#f08070'} />
          </div>

          {/* P&L detallado: Presupuesto | Real | Var */}
          <div className="vt-tbl-wrap">
            <table className="vt-tbl">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th className="r">Presupuesto</th>
                  <th className="r">Real</th>
                  <th className="r">Variación</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map(a => {
                  const bud = valueOf(a.id, amount.bud)
                  const act = valueOf(a.id, amount.act)
                  const isSection = !a.parent_id
                  const variance = act - bud
                  const d = Math.min(depthOf[a.id] ?? 0, 4)
                  if (bud === 0 && act === 0 && a.is_leaf) return null
                  return (
                    <tr key={a.id} style={{ background: isSection ? 'rgba(0,0,0,0.04)' : undefined }}>
                      <td style={{ paddingLeft: `${0.5 + d * 1.1}rem`, fontWeight: a.is_leaf ? 400 : 700, fontSize: '0.82rem', color: isSection ? INK : undefined }}>
                        {a.name}
                      </td>
                      <td className="r" style={{ fontWeight: a.is_leaf ? 400 : 700 }}>{bud ? fi(bud) : '—'}</td>
                      <td className="r" style={{ color: act ? '#2a7a6a' : '#999' }}>{act ? fi(act) : '—'}</td>
                      <td className="r" style={{ color: variance === 0 ? '#999' : variance > 0 ? '#c23b22' : '#4a7c59', fontSize: '0.78rem' }}>
                        {variance !== 0 ? (variance > 0 ? '+' : '') + fi(variance) : '—'}
                      </td>
                    </tr>
                  )
                })}
                {/* Líneas calculadas */}
                <tr style={{ borderTop: `2px solid ${BORDER}`, fontWeight: 800 }}>
                  <td>Utilidad Bruta</td>
                  <td className="r" style={{ color: '#4a7c59' }}>{fi(totals.bud.gross)}</td>
                  <td className="r" style={{ color: '#2a7a6a' }}>{totals.act.gross ? fi(totals.act.gross) : '—'}</td>
                  <td></td>
                </tr>
                <tr style={{ fontWeight: 800, background: 'rgba(74,124,89,0.08)' }}>
                  <td>Utilidad Neta</td>
                  <td className="r" style={{ color: totals.bud.net >= 0 ? '#4a7c59' : '#c23b22' }}>{fi(totals.bud.net)}</td>
                  <td className="r" style={{ color: '#2a7a6a' }}>{totals.act.net ? fi(totals.act.net) : '—'}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: '0.7rem', color: MUTED, marginTop: '0.75rem', lineHeight: 1.5 }}>
            Presupuesto 2026 importado de QuickBooks. El <strong>Real</strong> se calcula automáticamente:
            <strong> Ventas Salón/Delivery</strong> desde ventas, y los <strong>egresos de Caja</strong> mapeados
            a su cuenta por <strong>subcategoría</strong> (Gas→7780, Agua→7760, Luz→7770, Músicos→7500,
            Seguridad→7200, Mantenimiento→Repairs, Mercadería→Food 5200, Salarios→6200…). Las
            <strong> propinas por tarjeta se excluyen</strong> (son pass-through, no gasto). Lo ambiguo cae en el
            catch-all del tipo. También suma cargas manuales en finance_actuals.
          </div>
        </div>
      )}
    </div>
  )
}
