// Ventas v2 · la barra global: Local · Período (con flechas) · Comparar con (uno solo).
// El estado vive en la URL (`barraVentasV2.ts`); este componente solo lo pinta y lo cambia.
// Simplificada el 18-nov (pedido del dueño: «lo que más confunde es el menú principal»): un solo «Período» y un solo
// «Comparar con» (una base o «Los dos»); Desde y Hasta solo con Rango. Las opciones son todas las de antes (17:11).
import type { PeriodoV2, TipoPeriodoV2 } from './periodos'
import {
  OPCIONES_COMPARAR, PERIODOS, ROTULO_PERIODO, basesDe, cambiarTipo, moverPeriodo, periodoEnPalabras,
  rotuloComparar, type Comparar, type EstadoBarra,
} from './barraVentasV2'
import type { LocalVentas } from './resumenV2Datos'
import { localPorDefecto } from '../../shared/utils/ordenLocales'

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
  const local = localPorDefecto(locales, estado.local) ?? ''
  const valorPeriodo = estado.tipo === 'mesALaFecha' ? 'mes' : estado.tipo
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
          <select className="date-filter active" value={valorPeriodo} aria-label="Período"
            onChange={e => onCambio(cambiarTipo(estado, periodo, e.target.value as TipoPeriodoV2))}>
            {PERIODOS.map(id => <option key={id} value={id}>{ROTULO_PERIODO[id]}</option>)}
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
        {estado.tipo !== 'hoy' && (
          <label className="vt2-campo">
            <span>Comparar con</span>
            <select className="date-filter" aria-label="Comparar con" value={estado.comparar}
              onChange={e => onCambio({ ...estado, comparar: e.target.value as Comparar })}>
              {OPCIONES_COMPARAR.map(c => <option key={c} value={c}>{rotuloComparar(periodo, c)}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="vt2-barra-palabras">{periodoEnPalabras(periodo, basesDe(estado.comparar))}</div>
      {aviso && <div className="vt2-aviso" role="status">{aviso}. Se muestra «Ayer».</div>}
    </div>
  )
}
