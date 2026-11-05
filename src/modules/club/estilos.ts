/** Paleta, estilos y formatos del Club (paleta papel de `.tips-module`). */
import type { CSSProperties } from 'react'

export const C = {
  ink: 'var(--t-ink, #0d0d0d)', paper: 'var(--t-paper, #f5f0e8)', panel: 'var(--t-panel, #ede8de)',
  border: 'var(--t-border, #d4cfc4)', muted: 'var(--t-muted, #8a8070)', gold: 'var(--t-gold, #c8a96e)',
  teal: 'var(--t-teal, #2a7a6a)', red: 'var(--t-red, #c23b22)',
}

export const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#fff', border: `1px solid ${C.border}`,
  borderRadius: 6, padding: '0.75rem 0.85rem', fontSize: '1rem', color: C.ink,
}

export const labelStyle: CSSProperties = {
  display: 'block', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em',
  color: C.muted, fontWeight: 700, marginBottom: 4,
}

export const TIPO_MIEMBRO_LABEL: Record<string, string> = {
  referente: 'Referente', concierge_pm: 'Concierge PM', equipo: 'Equipo', socio: 'Socio', turista: 'Turista',
}
export const TIPO_NEGOCIO_LABEL: Record<string, string> = {
  hotel: 'Hotel', tienda: 'Tienda', host: 'Host', delivery: 'Delivery', concierge: 'Concierge', otro: 'Otro',
}
export const TIPO_MOV_LABEL: Record<string, string> = {
  tarjeta: 'Tarjeta', canje: 'Canje', vencimiento: 'Vencimiento', ajuste: 'Ajuste', restitucion: 'Restitución',
}

export const fmtFecha = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'America/Costa_Rica' }) : '—'
export const fmtFechaHora = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString('es-CR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Costa_Rica' }) : '—'
