// Piezas del estándar de los SOP (SPEC-caja-estandar §3). Solo presentación, sin estado ni datos.
// Viven bajo `.est` (src/styles/estandar.css): fuera de un módulo con esa clase se ven sin estilo.
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { IconCheck } from './iconos'

export type Tono = 'musgo' | 'laca' | 'oro'

/** §3.1 Cifra: etiqueta + valor + nota, sin caja. `principal` = la que decide (ocupa el ancho en celular). */
export function Cifra({ etiqueta, valor, nota, tono, principal }: {
  etiqueta: string; valor: ReactNode; nota?: ReactNode; tono?: Tono; principal?: boolean
}) {
  return (
    <div className={`est-cifra${principal ? ' principal' : ''}`}>
      <span className="est-etq">{etiqueta}</span>
      <span className="est-cifra-val" data-tono={tono}>{valor}</span>
      {nota != null && <span className="est-cifra-nota" data-tono={tono}>{nota}</span>}
    </div>
  )
}

/** Grupo de cifras: filete de oro arriba; debería llevar una sola `principal`. */
export function Cifras({ children }: { children: ReactNode }) {
  return <div className="est-cifras">{children}</div>
}

/** §3.3 Aviso: primero qué pasa (en negrita), después qué hacer. */
export function Aviso({ tipo = 'info', titulo, children }: {
  tipo?: 'info' | 'atencion' | 'error' | 'hecho'; titulo: string; children?: ReactNode
}) {
  return (
    <div className={`est-aviso ${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
      <strong>{titulo}</strong>{children != null && <> {children}</>}
    </div>
  )
}

export type EstadoPildora = 'pagado' | 'pendiente' | 'rechazado' | 'neutro'
/** Píldora de estado (Pagado / Pendiente / Rechazado / neutro). */
export function Pildora({ estado, children }: { estado: EstadoPildora; children: ReactNode }) {
  return <span className={`est-pildora ${estado}`}>{children}</span>
}

export type EstadoPaso = 'hecho' | 'actual' | 'espera'
/** §3.2 Barra de fases: número (pendiente / en curso) o tilde (hecho). El estado lo decide quien la usa. */
export function Fases({ pasos }: { pasos: { titulo: string; estado: EstadoPaso; detalle: string }[] }) {
  return (
    <ol className="est-fases">
      {pasos.map((p, i) => (
        <li key={p.titulo} className={p.estado} aria-current={p.estado === 'actual' ? 'step' : undefined}>
          <span className="est-paso">
            {p.estado === 'hecho' ? <IconCheck size={16} stroke={2} aria-hidden /> : i + 1}
          </span>
          <span className="est-fase-txt"><strong>{p.titulo}</strong><em>{p.detalle}</em></span>
        </li>
      ))}
    </ol>
  )
}

export type VarianteBoton = 'primario' | 'secundario' | 'texto' | 'peligro' | 'peligro-lleno'
/**
 * §3.4 Botón. Uno `primario` por pantalla. `peligro`: texto en laca sin caja, con `detalle` gris que dice
 * qué borra (va al pie, en «Correcciones»); el relleno laca (`peligro-lleno`) solo en el botón que confirma.
 */
export function Boton({ variante = 'secundario', ancho, icono, detalle, children, type = 'button', ...resto }: {
  variante?: VarianteBoton; ancho?: boolean; icono?: ReactNode; detalle?: string; children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} {...resto} className={`est-btn ${variante}${ancho ? ' ancho' : ''}`}>
      {icono}<span>{children}</span>
      {detalle && variante === 'peligro' && <span className="est-btn-detalle">{detalle}</span>}
    </button>
  )
}
