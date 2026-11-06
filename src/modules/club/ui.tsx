/** Piezas de UI del Club. */
import type { CSSProperties, ReactNode } from 'react'
import { C } from './estilos'

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: '1rem', ...style }}>
      {children}
    </div>
  )
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
export function Btn({ children, onClick, disabled, variant = 'primary', big, style, type = 'button', title }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: Variant; big?: boolean
  style?: CSSProperties; type?: 'button' | 'submit'; title?: string
}) {
  const v: Record<Variant, CSSProperties> = {
    primary:   { background: C.ink, color: '#c8a96e', border: `1px solid ${C.ink}` },
    secondary: { background: '#fff', color: C.ink, border: `1px solid ${C.border}` },
    danger:    { background: '#fff', color: C.red, border: `1px solid ${C.red}` },
    ghost:     { background: 'transparent', color: C.muted, border: '1px solid transparent' },
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      style={{
        ...v[variant], borderRadius: 8, fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
        padding: big ? '1.1rem 1rem' : '0.65rem 0.9rem', fontSize: big ? '1.15rem' : '0.9rem',
        opacity: disabled ? 0.4 : 1, minHeight: 44, ...style,
      }}>
      {children}
    </button>
  )
}

export function Aviso({ tono, children, onClose }: { tono: 'ok' | 'error' | 'info'; children: ReactNode; onClose?: () => void }) {
  const col = tono === 'ok' ? C.teal : tono === 'error' ? C.red : C.muted
  const bg = tono === 'ok' ? 'rgba(42,122,106,0.10)' : tono === 'error' ? 'rgba(194,59,34,0.08)' : 'rgba(0,0,0,0.04)'
  return (
    <div role={tono === 'error' ? 'alert' : 'status'}
      style={{ border: `1px solid ${col}`, background: bg, color: col, borderRadius: 8, padding: '0.75rem 0.9rem',
               fontWeight: 600, fontSize: '0.95rem', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ flex: 1 }}>{children}</span>
      {onClose && <button onClick={onClose} aria-label="Cerrar" style={{ background: 'none', border: 'none', color: col, cursor: 'pointer', fontSize: '1rem' }}>✕</button>}
    </div>
  )
}

export function Chip({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span style={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
                   color: color ?? C.muted, border: `1px solid ${color ?? C.border}`, borderRadius: 999, padding: '1px 7px' }}>
      {children}
    </span>
  )
}

