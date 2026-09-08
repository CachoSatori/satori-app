// ── P3 · Paridad xls ↔ pos_ndf (diagnóstico TEMPORAL) ──────────────────────────────────────
//
// Pantalla de VALIDACIÓN, no de operación: compara día por día lo que dice el xls
// (`ventas_dias`) contra lo que dice el PoS (`getDiasMapDesdePos`), para poder firmar el swap
// de fuente (P2) con números en la mano en vez de con fe.
//
// ⚠️ SE SACA DESPUÉS DE P3. No es una pestaña del producto: existe para tomar UNA decisión.
//
// ── SOLO LECTURA ───────────────────────────────────────────────────────────────────────────
// Ni una escritura. Los dos lados se leen con funciones que ya existen y el reporte lo arma
// `ventasParidadCalc.ts`, que es puro. Esta pantalla no puede modificar un dato ni por accidente.
//
// ⚠️ EL SUFIJO `Calc` NO ES DECORATIVO. El módulo puro se llamaba `ventasParidad.ts` y colisionaba
// con este archivo (`VentasParidad.tsx`) en filesystems case-insensitive: en macOS
// `import './VentasParidad'` resolvía al `.ts`, que no tiene default export, y se rompía la ruta
// Ventas ENTERA. Los dos nombres tienen que diferir en algo más que el case.

import { useCallback, useMemo, useState } from 'react'

import { getAllVentasDias, getProductMap } from '../../shared/api/ventas'
import type { DiasMap, ProductMap } from '../../shared/types/ventas'
import { getDiasMapDesdePos } from './ventasDiasDesdePos'
import {
  compararParidad, TOLERANCIA_POR_DEFECTO,
  type Comparacion, type FilaParidad, type ReporteParidad, type Tolerancia,
} from './ventasParidadCalc'
import { fi } from './ventasUtils'
import './ventasEnVivo.css'

/** `2026-09-05` → `2026-08-06` (un mes atrás), para el rango que abre por defecto. */
function haceUnMes(hoy: Date): string {
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, hoy.getUTCDate()))
  return d.toISOString().slice(0, 10)
}

const hoyISO = (): string => new Date().toISOString().slice(0, 10)

/** Recorta un `DiasMap` al rango pedido. El xls se lee entero y se filtra acá. */
function enRango(dias: DiasMap, desde: string, hasta: string): DiasMap {
  const out: DiasMap = {}
  for (const [f, d] of Object.entries(dias)) if (f >= desde && f <= hasta) out[f] = d
  return out
}

const pct = (v: number | null): string =>
  v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`

const num = (c: Comparacion, v: number): string =>
  c.unidad === 'pax' ? v.toLocaleString('es-CR') : fi(v)

const signo = (c: Comparacion): string =>
  c.diff === 0 ? '—' : `${c.diff > 0 ? '+' : '−'}${num(c, Math.abs(c.diff))}`

function FilaTabla({ fila, total }: { fila: FilaParidad; total?: boolean }) {
  return (
    <>
      <tr className={total ? 'apos-fila-total' : fila.flag ? 'apos-fila-flag' : undefined}>
        <td rowSpan={2}>
          <strong>{fila.fecha}</strong>
          {!total && fila.flag && (
            <div className="apos-mini">
              {!fila.enXls ? 'solo en el PoS' : !fila.enPos ? 'solo en el xls' : 'revisar'}
            </div>
          )}
        </td>
        <td className="apos-mini">xls</td>
        {fila.comparaciones.map(c => (
          <td key={c.clave} className="r">{num(c, c.xls)}</td>
        ))}
      </tr>
      <tr className={total ? 'apos-fila-total' : fila.flag ? 'apos-fila-flag' : undefined}>
        <td className="apos-mini">PoS · diff</td>
        {fila.comparaciones.map(c => (
          <td key={c.clave} className={`r ${c.fuera ? 'apos-celda-fuera' : ''}`}>
            {num(c, c.pos)}
            <div className="apos-mini">{signo(c)} · {pct(c.diffPct)}</div>
          </td>
        ))}
      </tr>
    </>
  )
}

export default function VentasParidad() {
  const [desde, setDesde] = useState(() => haceUnMes(new Date()))
  const [hasta, setHasta] = useState(hoyISO)
  const [tol, setTol]     = useState<Tolerancia>(TOLERANCIA_POR_DEFECTO)

  /**
   * Lo que se comparó, CON el rango con el que se comparó.
   *
   * El rango viaja adentro a propósito: si el usuario mueve las fechas y no vuelve a correr,
   * hay que poder decir que lo que está en pantalla es de OTRO rango. Guardarlo aparte de los
   * inputs es lo que evita mostrar un reporte viejo bajo fechas nuevas.
   */
  const [corrida, setCorrida] = useState<
    { desde: string; hasta: string; xls: DiasMap; pos: DiasMap; pm: ProductMap } | null
  >(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const correr = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      // Las tres lecturas son SELECT. Nada de esto escribe.
      const [todosXls, delPos, mapa] = await Promise.all([
        getAllVentasDias(),
        getDiasMapDesdePos({ desde, hasta }),
        getProductMap(),
      ])
      setCorrida({ desde, hasta, xls: enRango(todosXls, desde, hasta), pos: delPos, pm: mapa })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCargando(false)
    }
  }, [desde, hasta])

  // No se corre solo al montar: barrer un rango largo del PoS cuesta, y esta pantalla se abre a
  // propósito. El botón es el disparador. Y «vigente» se DERIVA, no se sincroniza con un efecto.
  const vigente = corrida !== null && corrida.desde === desde && corrida.hasta === hasta

  const reporte: ReporteParidad | null = useMemo(
    () => (corrida ? compararParidad(corrida.xls, corrida.pos, corrida.pm, tol) : null),
    [corrida, tol],
  )

  return (
    <div className="vt-section">
      <div className="apos">

        <div className="apos-panel">
          <div className="apos-panel-hd">
            <h3>Paridad · xls ↔ PoS</h3>
            <span className="apos-tag-diag">diagnóstico temporal · se saca después de validar</span>
          </div>
          <p className="apos-nota">
            Compara, día por día, lo que dice <code>ventas_dias</code> (el xls) contra lo que dice{' '}
            <code>pos_ndf</code>. <strong>Solo lectura</strong>: esta pantalla no escribe nada.
            Correr <strong>después</strong> del re-backfill completo — si al PoS le falta
            historia, los días que le falten van a aparecer como «solo en el xls».
          </p>

          <div className="apos-bar">
            <label className="apos-fecha">
              Desde <input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} />
            </label>
            <label className="apos-fecha">
              Hasta <input type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} />
            </label>
            <span className="apos-spacer" />
            <label className="apos-fecha">
              Tolerancia %{' '}
              <input
                type="number" step="0.1" min="0" style={{ width: '4.5rem' }}
                value={tol.pct}
                onChange={e => setTol(t => ({ ...t, pct: Number(e.target.value) || 0 }))}
              />
            </label>
            <label className="apos-fecha">
              y ₡{' '}
              <input
                type="number" step="100" min="0" style={{ width: '6rem' }}
                value={tol.abs}
                onChange={e => setTol(t => ({ ...t, abs: Number(e.target.value) || 0 }))}
              />
            </label>
            <label className="apos-fecha">
              y pax{' '}
              <input
                type="number" step="1" min="0" style={{ width: '4rem' }}
                value={tol.absPax}
                onChange={e => setTol(t => ({ ...t, absPax: Number(e.target.value) || 0 }))}
              />
            </label>
            <button type="button" className="apos-btn-hoy" disabled={cargando} onClick={correr}>
              {cargando ? 'Comparando…' : vigente ? 'Volver a comparar' : 'Comparar'}
            </button>
          </div>
          <p className="apos-nota" style={{ marginBottom: 0 }}>
            Un día se marca cuando la diferencia pasa <strong>las dos</strong> cosas: más de{' '}
            {tol.pct}% <em>y</em> más de {fi(tol.abs)} (el PAX usa su propio umbral, ±{tol.absPax}{' '}
            personas, porque no se cuenta en colones).
          </p>
        </div>

        {error && (
          <div className="apos-panel">
            <p className="apos-nota" style={{ marginBottom: 0 }}>
              <strong>No se pudo comparar:</strong> {error}
            </p>
          </div>
        )}

        {reporte && !vigente && (
          <div className="apos-panel">
            <p className="apos-nota" style={{ marginBottom: 0 }}>
              <strong>Moviste el rango.</strong> Lo de abajo es la comparación de{' '}
              {corrida?.desde} → {corrida?.hasta}. Tocá <strong>Comparar</strong> para el rango
              nuevo.
            </p>
          </div>
        )}

        {reporte && (
          <>
            {/* ── El veredicto, arriba ────────────────────────────────────── */}
            <div className="apos-kpis">
              <div className="apos-kpi is-principal">
                <span className="apos-kpi-lbl">Días comparados</span>
                <span className="apos-kpi-val">{reporte.resumen.dias.toLocaleString('es-CR')}</span>
                <span className="apos-kpi-sub">{corrida?.desde} → {corrida?.hasta}</span>
              </div>
              <div className="apos-kpi">
                <span className="apos-kpi-lbl">Dentro de tolerancia</span>
                <span className="apos-kpi-val">{reporte.resumen.ok.toLocaleString('es-CR')}</span>
                <span className="apos-kpi-sub">
                  {reporte.resumen.dias > 0
                    ? `${((reporte.resumen.ok / reporte.resumen.dias) * 100).toFixed(1)}% de los días`
                    : '—'}
                </span>
              </div>
              <div className="apos-kpi">
                <span className="apos-kpi-lbl">Para revisar</span>
                <span className="apos-kpi-val">{reporte.resumen.flag.toLocaleString('es-CR')}</span>
                <span className="apos-kpi-sub">
                  {reporte.resumen.soloXls > 0 && `${reporte.resumen.soloXls} solo en el xls · `}
                  {reporte.resumen.soloPos > 0 && `${reporte.resumen.soloPos} solo en el PoS · `}
                  pasan la tolerancia
                </span>
              </div>
              <div className={`apos-kpi ${reporte.total.flag ? '' : 'is-proyeccion'}`}>
                <span className="apos-kpi-lbl">TOTAL del rango</span>
                <span className="apos-kpi-val">
                  {reporte.total.flag ? '⚠ no cuadra' : '✓ cuadra'}
                </span>
                <span className="apos-kpi-sub">
                  es la señal que manda para firmar
                </span>
              </div>
            </div>

            {/* ── Por qué el total manda ──────────────────────────────────── */}
            <div className="apos-panel">
              <p className="apos-nota" style={{ marginBottom: 0 }}>
                <strong>Los diffs por día no son necesariamente errores.</strong> El xls y{' '}
                <code>pos_ndf</code> <strong>no cortan el día igual</strong>: el xls usa el corte
                del reporte del PoS, y <code>pos_ndf</code> usa el <strong>lote de cierre</strong>{' '}
                (la factura de después de medianoche cuenta en la jornada que ABRIÓ). La misma
                plata puede caer en días distintos según quién la mire — y eso{' '}
                <strong>se cancela en el total del rango</strong>. Por eso el TOTAL es lo que se
                mira para firmar la paridad, y las filas por día sirven para investigar las
                diferencias grandes, no para exigir cero.
              </p>
            </div>

            {/* ── TOTAL y detalle por día ─────────────────────────────────── */}
            <section className="apos-panel">
              <div className="apos-panel-hd">
                <h3>Total del rango</h3>
                <span className="apos-panel-sub">la suma de las dos fuentes · xls arriba, PoS y diff abajo</span>
              </div>
              <div className="apos-tabla-wrap">
                <table className="apos-tabla apos-tabla-paridad">
                  <thead>
                    <tr>
                      <th>Rango</th>
                      <th>Fuente</th>
                      {reporte.total.comparaciones.map(c => <th key={c.clave} className="r">{c.etiqueta}</th>)}
                    </tr>
                  </thead>
                  <tbody><FilaTabla fila={reporte.total} total /></tbody>
                </table>
              </div>
            </section>

            <section className="apos-panel">
              <div className="apos-panel-hd">
                <h3>Día por día</h3>
                <span className="apos-panel-sub">
                  {reporte.resumen.flag > 0
                    ? `${reporte.resumen.flag} día(s) marcado(s) — mirar los grandes primero`
                    : 'ningún día pasa la tolerancia'}
                </span>
              </div>
              {reporte.filas.length === 0 ? (
                <p className="apos-nota" style={{ marginBottom: 0 }}>
                  Sin días en el rango, en ninguna de las dos fuentes.
                </p>
              ) : (
                <div className="apos-tabla-wrap">
                  <table className="apos-tabla apos-tabla-paridad">
                    <thead>
                      <tr>
                        <th>Jornada</th>
                        <th>Fuente</th>
                        {reporte.total.comparaciones.map(c => <th key={c.clave} className="r">{c.etiqueta}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {reporte.filas.map(f => <FilaTabla key={f.fecha} fila={f} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {!reporte && !error && !cargando && (
          <div className="apos-panel">
            <p className="apos-nota" style={{ marginBottom: 0 }}>
              Elegí el rango y tocá <strong>Comparar</strong>. Un rango largo tarda: se lee el
              histórico del xls y se barren las facturas del PoS de todo el período.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
