/**
 * CrmMetricas — Dashboard de métricas de fidelización (Fase 2.5)
 * Adquisición · Retención · Valor (LTV) · Puntos · Comportamiento.
 * Data: customers (agregados) + customer_interactions (puntos/canales).
 */
import { useState, useEffect, useMemo } from 'react'
import type { Customer, CustomerTier } from '../../shared/types/crm'
import { TIER_LABELS, TIER_COLORS } from '../../shared/types/crm'
import { getAllInteractionAggs, type InteractionAgg } from '../../shared/api/crm'

interface Props { customers: Customer[] }

const MUTED = '#5a5040', BORDER = 'var(--t-border,#d4cfc4)'
const SERIF = 'var(--font-serif)'
function fi(n: number) { return '₡ ' + Math.round(n).toLocaleString('es-CR') }
function daysSince(iso: string | null) { return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null }

// Tarjeta KPI oscura (estilo foto 1) con número en serif
function Stat({ label, val, sub, color }: { label: string; val: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--t-ink,#0d0d0d)', borderRadius: 3, padding: '0.7rem 0.9rem', minWidth: 120 }}>
      <div style={{ fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8a8170', marginBottom: '0.3rem' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: color ?? '#f0ece4', fontFamily: SERIF, lineHeight: 1 }}>{val}</div>
      {sub && <div style={{ fontSize: '0.62rem', color: '#8a8170', marginTop: '0.25rem' }}>{sub}</div>}
    </div>
  )
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#a07830', margin: '1.25rem 0 0.6rem' }}>{children}</div>
}
function Bar({ label, val, max, color, note }: { label: string; val: number; max: number; color: string; note?: string }) {
  const w = max > 0 ? Math.round(val / max * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.2rem 0' }}>
      <span style={{ width: 90, fontSize: '0.72rem', color: MUTED, textAlign: 'right', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 9, background: 'rgba(0,0,0,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${w}%`, background: color, borderRadius: 2 }} />
      </div>
      <span style={{ width: 110, fontSize: '0.72rem', fontFamily: SERIF, fontWeight: 600, textAlign: 'right', flexShrink: 0 }}>
        {Math.round(val).toLocaleString('es-CR')}{note ? ` ${note}` : ''}
      </span>
    </div>
  )
}

export default function CrmMetricas({ customers }: Props) {
  const [inter, setInter] = useState<InteractionAgg[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAllInteractionAggs().then(setInter).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const m = useMemo(() => {
    const now = new Date()
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    // Adquisición
    const nuevoSemana = customers.filter(c => { const d = daysSince(c.first_seen); return d !== null && d <= 7 }).length
    const nuevoMes    = customers.filter(c => c.first_seen?.slice(0, 7) === ym).length
    const porCanal: Record<string, number> = {}
    customers.forEach(c => { const k = c.channel_origin || 'manual'; porCanal[k] = (porCanal[k] ?? 0) + 1 })
    // Retención
    const activos30 = customers.filter(c => { const d = daysSince(c.last_seen); return d !== null && d <= 30 }).length
    const enRiesgo  = customers.filter(c => { const d = daysSince(c.last_seen); return d !== null && d > 30 && d <= 90 }).length
    const dormidos  = customers.filter(c => { const d = daysSince(c.last_seen); return d === null || d > 90 }).length
    const visitasTot = customers.reduce((s, c) => s + c.total_visits, 0)
    const frecProm  = customers.length ? visitasTot / customers.length : 0
    // Valor
    const gastoTot  = customers.reduce((s, c) => s + c.total_spent_crc, 0)
    const ltvProm   = customers.length ? gastoTot / customers.length : 0
    const ticketProm = visitasTot > 0 ? gastoTot / visitasTot : 0
    const top = [...customers].sort((a, b) => b.total_spent_crc - a.total_spent_crc).slice(0, 5)
    // Puntos
    const puntosVigentes = customers.reduce((s, c) => s + c.points, 0)
    const emitidos  = inter.reduce((s, i) => s + (i.points_earned ?? 0), 0)
    const canjeados = inter.reduce((s, i) => s + (i.points_spent ?? 0), 0)
    const porTier: Record<string, number> = {}
    customers.forEach(c => { porTier[c.tier] = (porTier[c.tier] ?? 0) + 1 })
    // Comportamiento
    const porTipo: Record<string, number> = {}
    inter.forEach(i => { const k = i.type || 'otro'; porTipo[k] = (porTipo[k] ?? 0) + 1 })

    return { nuevoSemana, nuevoMes, porCanal, activos30, enRiesgo, dormidos, frecProm,
      ltvProm, ticketProm, top, puntosVigentes, emitidos, canjeados, porTier, porTipo, totalClientes: customers.length }
  }, [customers, inter])

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: MUTED }}>Cargando métricas…</div>

  const maxCanal = Math.max(1, ...Object.values(m.porCanal))
  const maxTipo  = Math.max(1, ...Object.values(m.porTipo))

  return (
    <div className="tips-body">
      {/* Adquisición */}
      <SectionTitle>Adquisición</SectionTitle>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Stat label="Clientes totales" val={String(m.totalClientes)} />
        <Stat label="Nuevos (7d)" val={String(m.nuevoSemana)} color="#7ec8a0" />
        <Stat label="Nuevos del mes" val={String(m.nuevoMes)} color="#7ec8a0" />
      </div>
      <div style={{ marginTop: '0.6rem' }}>
        {Object.entries(m.porCanal).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
          <Bar key={k} label={k} val={v} max={maxCanal} color="#2a7a6a" />)}
      </div>

      {/* Retención */}
      <SectionTitle>Retención</SectionTitle>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Stat label="Activos (30d)" val={String(m.activos30)} color="#7ec8a0" />
        <Stat label="En riesgo (30–90d)" val={String(m.enRiesgo)} color="#c8a030" />
        <Stat label="Dormidos (+90d)" val={String(m.dormidos)} color="#c89a9a" />
        <Stat label="Frecuencia prom." val={m.frecProm.toFixed(1)} sub="visitas/cliente" />
      </div>

      {/* Valor */}
      <SectionTitle>Valor</SectionTitle>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Stat label="LTV promedio" val={fi(m.ltvProm)} color="#c8b88a" />
        <Stat label="Ticket promedio" val={fi(m.ticketProm)} color="#c8b88a" />
      </div>
      {m.top.length > 0 && (
        <div style={{ marginTop: '0.6rem' }}>
          <div style={{ fontSize: '0.62rem', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>Top 5 por gasto</div>
          {m.top.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0', borderBottom: `1px solid ${BORDER}`, fontSize: '0.82rem' }}>
              <span><span style={{ color: MUTED, marginRight: 6 }}>{i + 1}</span>{c.name || c.phone}
                <span style={{ fontSize: '0.6rem', color: TIER_COLORS[c.tier], marginLeft: 6, fontWeight: 800, textTransform: 'uppercase' }}>{TIER_LABELS[c.tier]}</span></span>
              <strong style={{ fontFamily: SERIF, color: '#a07830' }}>{fi(c.total_spent_crc)}</strong>
            </div>
          ))}
        </div>
      )}

      {/* Puntos */}
      <SectionTitle>Puntos</SectionTitle>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Stat label="Puntos vigentes" val={m.puntosVigentes.toLocaleString('es-CR')} color="#c8b88a" />
        <Stat label="Emitidos" val={m.emitidos.toLocaleString('es-CR')} color="#7ec8a0" />
        <Stat label="Canjeados" val={m.canjeados.toLocaleString('es-CR')} color="#c89a9a" />
      </div>
      <div style={{ marginTop: '0.6rem' }}>
        <div style={{ fontSize: '0.62rem', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>Clientes por tier</div>
        {(['embajador', 'vip', 'regular', 'nuevo'] as CustomerTier[]).filter(t => m.porTier[t]).map(t =>
          <Bar key={t} label={TIER_LABELS[t]} val={m.porTier[t] ?? 0} max={m.totalClientes} color={TIER_COLORS[t]} />)}
      </div>

      {/* Comportamiento */}
      {Object.keys(m.porTipo).length > 0 && (
        <>
          <SectionTitle>Comportamiento</SectionTitle>
          <div style={{ fontSize: '0.62rem', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>Interacciones por tipo</div>
          {Object.entries(m.porTipo).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
            <Bar key={k} label={k} val={v} max={maxTipo} color="#2a4a6b" />)}
        </>
      )}
    </div>
  )
}
