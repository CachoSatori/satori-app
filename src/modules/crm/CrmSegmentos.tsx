/**
 * CrmSegmentos — Segmentos de marketing (Fase 2.3 parcial, solo datos propios)
 *
 * Identifica grupos accionables a partir de los clientes ya cargados:
 *  - Cumpleañeros del mes
 *  - Frecuentes / VIP
 *  - Dormidos (sin visita hace 30+ días)
 *  - Nuevos del mes
 * Para cada segmento: lista + copiar teléfonos + link wa.me por cliente (el usuario
 * inicia el chat; NO se envía nada automáticamente).
 *
 * Tema papel: tarjetas claras, texto oscuro, tokens legibles.
 */
import { useMemo, useState } from 'react'
import type { Customer } from '../../shared/types/crm'
import { TIER_LABELS, TIER_COLORS } from '../../shared/types/crm'

interface Props { customers: Customer[] }

// Paleta papel
const PAPER = '#faf7f0', BORDER = 'var(--t-border,#d4cfc4)', MUTED = '#5a5040', INK = 'var(--t-ink,#0d0d0d)'
const GOLD = '#a07830', TEAL = '#2a7a6a'

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DORMANT_DAYS = 30

function waLink(phone: string): string {
  let d = phone.replace(/[^\d]/g, '')
  if (d.length === 8) d = '506' + d          // CR sin código de país
  return `https://wa.me/${d}`
}
function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

interface Segment {
  key:   string
  title: string
  hint:  string
  color: string
  members: Customer[]
}

export default function CrmSegmentos({ customers }: Props) {
  const [open, setOpen]     = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const now = new Date()
  const curMonth = now.getMonth() + 1
  const curYM = `${now.getFullYear()}-${String(curMonth).padStart(2, '0')}`

  const segments = useMemo<Segment[]>(() => {
    const birthday = customers.filter(c => c.birth_date && Number(c.birth_date.slice(5, 7)) === curMonth)
    const frequent = customers.filter(c => c.tier === 'vip' || c.tier === 'embajador' || c.total_visits >= 5)
      .sort((a, b) => b.total_visits - a.total_visits)
    const dormant  = customers.filter(c => {
      const d = daysSince(c.last_seen)
      return c.total_visits > 0 && d !== null && d >= DORMANT_DAYS
    }).sort((a, b) => (daysSince(b.last_seen) ?? 0) - (daysSince(a.last_seen) ?? 0))
    const fresh    = customers.filter(c => c.first_seen?.slice(0, 7) === curYM)

    return [
      { key: 'bday',   title: `🎂 Cumpleañeros de ${MONTHS[curMonth - 1]}`, hint: 'Mandales un saludo + cortesía', color: GOLD, members: birthday },
      { key: 'freq',   title: '⭐ Frecuentes / VIP',                          hint: '5+ visitas o tier VIP', color: TEAL, members: frequent },
      { key: 'dorm',   title: '😴 Dormidos',                                  hint: `Sin venir hace ${DORMANT_DAYS}+ días`, color: '#c23b22', members: dormant },
      { key: 'fresh',  title: '🌱 Nuevos del mes',                            hint: 'Primera vez este mes', color: '#8a4ea0', members: fresh },
    ]
  }, [customers, curMonth, curYM])

  function copyPhones(seg: Segment) {
    const text = seg.members.map(m => `${m.name || '(sin nombre)'}: ${m.phone}`).join('\n')
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(seg.key); setTimeout(() => setCopied(null), 2500)
    }).catch(() => window.prompt('Copiá la lista:', text))
  }

  return (
    <div className="tips-body">
      <div style={{ fontSize: '0.72rem', color: MUTED, marginBottom: '1rem' }}>
        Segmentos calculados de tus clientes. Los links de WhatsApp abren el chat — vos enviás el mensaje.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
        {segments.map(seg => {
          const isOpen = open === seg.key
          return (
            <div key={seg.key} style={{ border: `1px solid ${BORDER}`, borderRadius: 4, background: PAPER, overflow: 'hidden' }}>
              <div onClick={() => setOpen(isOpen ? null : seg.key)}
                style={{ cursor: 'pointer', padding: '0.75rem 0.875rem', borderLeft: `3px solid ${seg.color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.88rem', color: INK }}>{seg.title}</span>
                  <span style={{ fontWeight: 800, fontSize: '1.1rem', color: seg.color }}>{seg.members.length}</span>
                </div>
                <div style={{ fontSize: '0.68rem', color: MUTED, marginTop: 2 }}>{seg.hint}</div>
              </div>

              {isOpen && (
                <div style={{ borderTop: `1px solid ${BORDER}`, padding: '0.5rem 0.875rem 0.875rem' }}>
                  {seg.members.length === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: MUTED, padding: '0.5rem 0' }}>Sin clientes en este segmento.</div>
                  ) : (
                    <>
                      <button onClick={() => copyPhones(seg)}
                        style={{ marginBottom: '0.5rem', fontSize: '0.72rem', padding: '4px 10px', borderRadius: 2, border: `1px solid ${BORDER}`, background: 'rgba(0,0,0,0.03)', color: MUTED, cursor: 'pointer' }}>
                        {copied === seg.key ? '✓ Copiado' : '⎘ Copiar lista'}
                      </button>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: '40vh', overflowY: 'auto' }}>
                        {seg.members.map(m => {
                          const d = daysSince(m.last_seen)
                          return (
                            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', borderBottom: `1px solid ${BORDER}`, padding: '0.3rem 0' }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ color: INK, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {m.name || '(sin nombre)'}
                                  <span style={{ fontSize: '0.62rem', color: TIER_COLORS[m.tier], marginLeft: 5, fontWeight: 800, textTransform: 'uppercase' }}>{TIER_LABELS[m.tier]}</span>
                                </div>
                                <div style={{ fontSize: '0.68rem', color: MUTED }}>
                                  {m.phone}
                                  {seg.key === 'dorm' && d !== null && ` · hace ${d}d`}
                                  {seg.key === 'freq' && ` · ${m.total_visits} vis.`}
                                </div>
                              </div>
                              <a href={waLink(m.phone)} target="_blank" rel="noreferrer"
                                style={{ fontSize: '0.7rem', padding: '3px 9px', borderRadius: 2, border: `1px solid ${TEAL}`, color: TEAL, textDecoration: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                WhatsApp
                              </a>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
