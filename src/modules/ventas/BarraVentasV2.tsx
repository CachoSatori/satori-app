// Ventas v2 · la barra global: Local · Período (con flechas) · Comparar con (dos bases).
// El estado vive en la URL (`barraVentasV2.ts`); este componente solo lo pinta y lo cambia.
import type { BaseId, PeriodoV2, TipoPeriodoV2 } from './periodos'
import { BASES } from './periodos'
import { OPCIONES_PERIODO, elegirBase, rotuloBase, moverPeriodo, periodoEnPalabras, type EstadoBarra } from './barraVentasV2'
import type { LocalVentas } from './resumenV2Datos'

interface Props {
  estado:   EstadoBarra
  periodo:  PeriodoV2
  locales:  LocalVentas[]
  aviso?:   string | null
  onCambio: (e: EstadoBarra) => void
}

export default function BarraVentasV2({ estado, periodo, locales, aviso, onCambio }: Props) {
  const anterior = moverPeriodo(estado, periodo, -1)
  const siguiente = moverPeriodo(estado, periodo, 1)
  const local = estado.local ?? locales[0]?.id ?? ''
  return (
    <div className="vt2-barra" role="group" aria-label="Período y comparación">
      <div className="vt2-barra-fila">
        {locales.length > 1 && (
          <label className="vt2-campo">
            <span>Local</span>
            <select className="date-filter" value={local} aria-label="Local"
              onChange={e => onCambio({ ...estado, local: e.target.value })}>
              {locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
          </label>
        )}
        <label className="vt2-campo">
          <span>Período</span>
          <select className="date-filter active" value={estado.tipo} aria-label="Período"
            onChange={e => {
              const tipo = e.target.value as TipoPeriodoV2
              onCambio(tipo === 'rango'
                ? { ...estado, tipo, dia: undefined, desde: estado.desde ?? periodo.desde, hasta: estado.hasta ?? periodo.hasta }
                : { ...estado, tipo, dia: undefined, desde: undefined, hasta: undefined })
            }}>
            {OPCIONES_PERIODO.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <div className="vt2-flechas">
          <button type="button" className="vt-period-btn" aria-label="Período anterior" disabled={!anterior}
            onClick={() => anterior && onCambio(anterior)}>‹</button>
          <button type="button" className="vt-period-btn" aria-label="Período siguiente" disabled={!siguiente}
            onClick={() => siguiente && onCambio(siguiente)}>›</button>
        </div>
        {estado.tipo === 'rango' && (
          <>
            <label className="vt2-campo"><span>Desde</span>
              <input type="date" className="date-filter" aria-label="Desde" value={estado.desde ?? ''} max={periodo.N}
                onChange={e => onCambio({ ...estado, desde: e.target.value || undefined })} />
            </label>
            <label className="vt2-campo"><span>Hasta</span>
              <input type="date" className="date-filter" aria-label="Hasta" value={estado.hasta ?? ''} max={periodo.N}
                onChange={e => onCambio({ ...estado, hasta: e.target.value || undefined })} />
            </label>
          </>
        )}
        {estado.tipo !== 'hoy' && (['A', 'B'] as const).map(cual => (
          <label className="vt2-campo" key={cual}>
            <span>{cual === 'A' ? 'Comparar con' : 'y con'}</span>
            <select className="date-filter" aria-label={`Base ${cual}`} value={cual === 'A' ? estado.baseA : estado.baseB}
              onChange={e => onCambio(elegirBase(estado, cual, e.target.value as BaseId))}>
              {BASES.map(id => <option key={id} value={id}>{rotuloBase(periodo, id)}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="vt2-barra-palabras">{periodoEnPalabras(periodo, estado.baseA, estado.baseB)}</div>
      {aviso && <div className="vt2-aviso" role="status">{aviso}. Se muestra «Ayer».</div>}
    </div>
  )
}
