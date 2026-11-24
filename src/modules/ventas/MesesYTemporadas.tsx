// ── Ventas v2 · «Tiempos» → «Meses y temporadas» (SPEC-ventas-v2 §5.4 ítem 4, PR 3.5.3) ───────────────────────
// El año contra el anterior: por año, mes por mes y por trimestre, con lo que está en curso a la fecha (hasta ayer).
// Reemplaza a «Análisis» → «Año vs Año» (mismas cuentas: `mesesTemporadas.ts`). No depende del período de la barra:
// siempre el año de ayer contra los anteriores; solo el local de la barra.
//
// Lee por su cuenta (en paralelo al resto de «Tiempos», sin frenarlo): los días del PoS desde su corte, por la misma
// función de la 190 y la misma memoria por tramo (`cargarLecturaDeRangos`), y 2023 de `hist` (el resumen diario
// viejo, que el shell baja siempre). Si falla, el resto de la pestaña se ve igual.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { HistMap } from '../../shared/types/ventas'
import { fi } from './ventasUtils'
import { corteDe, nombreMes, rotulo } from './aLaFecha'
import { estimadorPorNeta, ventaPorPersona, type VentaPorPersona } from './indicadores'
import {
  CORTE_HIST, diasDeAnios, fechasConAnio, mesesTemporadas, rotuloCambio, type CambioAnio, type MesesTemporadas,
} from './mesesTemporadas'
import { cifrasDelRango, type Lectura } from './resumenV2'
import { claseDeCambio, fmtPctSigno } from './tiemposV2'
import { cargarLecturaDeRangos } from './tiemposV2Datos'
import { LOCAL_POR_DEFECTO } from './ventasDiasDesdePos'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre',
  'Noviembre', 'Diciembre']
const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

interface Props {
  local: string
  /** Hoy en CR (el `ancla` del período de la barra): el corte es ayer. */
  ancla: string
  /** `ventas_hist` (solo antes del corte del PoS). Es el resumen diario viejo de Santa Teresa: no tiene local. */
  hist:  HistMap
}

interface Leido {
  clave: string
  l:     Lectura
}

export default function MesesYTemporadas({ local, ancla, hist }: Props) {
  const c = useMemo(() => corteDe(ancla), [ancla])
  const clave = `${local}|${c.N}`
  const [leido, setLeido] = useState<Leido | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  useEffect(() => {
    if (c.N < CORTE_HIST) return
    let vivo = true
    cargarLecturaDeRangos(local, [{ desde: CORTE_HIST, hasta: c.N }])
      .then(l => { if (vivo) setLeido({ clave, l }) })
      .catch(() => { if (vivo) setFallo(clave) })
    return () => { vivo = false }
  }, [clave, local, c.N])

  // `ventas_hist` no tiene columna de local: es el histórico de Santa Teresa (el único local antes del PoS).
  const histDelLocal = useMemo(() => (local === LOCAL_POR_DEFECTO ? hist : {}), [local, hist])
  const listo = leido && leido.clave === clave ? leido.l : null
  const d = useMemo(() => {
    if (!listo) return null
    const r = { desde: CORTE_HIST, hasta: c.N }
    const mt = mesesTemporadas(diasDeAnios(histDelLocal, cifrasDelRango(listo, r).dias, c.N), c)
    // La venta por persona de cada año: LA de `indicadores.ts` (D4, con las mesas sin pax estimadas), como el resto
    // de «Tiempos». Un año sin facturas del PoS (2023: solo el resumen diario) no se puede estimar.
    const estimador = estimadorPorNeta(listo.facturas)
    const vpp = new Map<number, VentaPorPersona>()
    for (const t of mt.tarjetas) {
      if (t.rango && t.rango.hasta >= CORTE_HIST) vpp.set(t.anio, ventaPorPersona(listo.facturas, t.rango, { estimador }))
    }
    return { mt, vpp }
  }, [listo, histDelLocal, c])

  return (
    <section className="vt2t-bloque" data-bloque="meses">
      <div className="vt-sl">Meses y temporadas (año contra año)</div>
      {fallo === clave ? (
        <div className="vt2-aviso" role="status">No se pudieron leer los años anteriores. El resto de la pestaña está bien.</div>
      ) : !d ? (
        <div className="vt2-cargando" role="status">Leyendo los años anteriores del PoS…</div>
      ) : d.mt.anios.length === 0 ? (
        <p className="vt2-nota">Sin ventas para comparar.</p>
      ) : (
        <Cuerpo mt={d.mt} vpp={d.vpp} />
      )}
    </section>
  )
}

const pct = (x: CambioAnio | null, testid?: string) => x && (
  <span className={`vt2-delta ${claseDeCambio(x.pct)}`} title={rotuloCambio(x)} data-cambio={testid}>{fmtPctSigno(x.pct)}</span>
)

function Cuerpo({ mt, vpp }: { mt: MesesTemporadas; vpp: Map<number, VentaPorPersona> }) {
  const c = mt.corte
  const txtYTD = mt.rangoYTD ? rotulo(mt.rangoYTD, c) : ''
  const pares = mt.anios.slice(0, -1).map((y, i) => [y, mt.anios[i + 1]] as const)
  const celdaCambio = (x: CambioAnio, fuerte = false) => (
    <td key={`v${x.anio}`} className={`r vt2-delta ${claseDeCambio(x.pct)}`} title={rotuloCambio(x)} data-cambio={`${x.anio}-${x.contra}`}>
      {fuerte ? <b>{fmtPctSigno(x.pct)}</b> : fmtPctSigno(x.pct)}
    </td>
  )

  return (
    <>
      <p className="vt2-nota" data-nota="meses-que-compara">
        Cada año contra el anterior, con las mismas fechas (al pasar el dedo o el mouse por un % se ven las fechas de cada
        lado). No depende del período de la barra.
        {mt.anioVivo && <> {c.anio} va <strong>a la fecha</strong>: {txtYTD}, hasta ayer (hoy no entra); lo que está en curso se
          compara contra los mismos días de los otros años.</>}
      </p>

      {/* Por año */}
      {/* Las columnas por año van por variable y clase (no en línea): así la regla de pantalla chica de `index.css`
          las apila en el teléfono (un estilo en línea le ganaba y cortaba las tarjetas a 390 px). */}
      <div className="vt-kpi-grid vt-kpi-anios" style={{ '--vt-anios': Math.min(mt.anios.length, 4) } as CSSProperties}>
        {mt.tarjetas.map(t => {
          const v = vpp.get(t.anio)
          const vppTxt = v
            ? (v.valor === null ? '—' : `${fi(Math.round(v.valor))}${v.pctEstimado > 0 ? ` (incluye ${v.pctEstimado.toFixed(0)} % estimado)` : ''}`)
            : `${t.t.ventaPorPersona === null ? '—' : fi(t.t.ventaPorPersona)} (sin estimar: resumen diario viejo)`
          return (
            <div key={t.anio} className="vt-kpi" style={{ borderLeft: '3px solid var(--vt-gold)' }} data-anio={t.anio}>
              <div className="vt-kpi-label">{t.anio}{t.vivo ? ' · a la fecha' : ''} · {t.t.dias} días</div>
              <div className="vt-kpi-val">{fi(t.t.ventaNeta)}</div>
              {t.cambio && t.cambio.pct !== null && (
                <div className="vt-kpi-delta">
                  {pct(t.cambio, 'anio')} <span className="vt2-delta-base">vs {t.cambio.contra}{t.vivo ? ' a la misma fecha' : ''} ({fechasConAnio(t.cambio.rangoContra)})</span>
                </div>
              )}
              <div className="vt-kpi-sub" data-dato="personas">{t.t.pax.toLocaleString('es-CR')} personas · venta por persona {vppTxt}</div>
              {t.vivo && <div className="vt-kpi-sub">{txtYTD}</div>}
            </div>
          )
        })}
      </div>

      {/* Mes por mes */}
      <div className="vt-sl" style={{ marginTop: '1rem' }}>Mes por mes</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="vt-tbl" aria-label="Mes por mes">
          <thead>
            <tr>
              <th>Mes</th>
              {mt.anios.map(y => <th key={y} className="r">{y}</th>)}
              {pares.map(([a, b]) => <th key={`v${a}`} className="r" data-col="cambio">{a} vs {b}</th>)}
            </tr>
          </thead>
          <tbody>
            {mt.meses.map(f => (
              <tr key={f.mes} data-mes={f.mes} data-en-curso={f.vivo ? 'si' : undefined}>
                <td style={{ fontWeight: 600 }} title={f.rangoVivo ? rotulo(f.rangoVivo, c) : undefined}>
                  {MESES[f.mes]}{f.vivo && f.rangoVivo ? ` · a la fecha (1 al ${c.dia})` : ''}
                </td>
                {f.valores.map(v => <td key={v.anio} className="r vt-bold" data-anio={v.anio}>{v.t.dias > 0 ? fi(v.t.ventaNeta) : '—'}</td>)}
                {f.cambios.map(x => celdaCambio(x))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            {mt.aLaFecha && (
              <tr className="vt-tbl-footer" data-fila="a-la-fecha">
                <td title={txtYTD}>A LA FECHA (al {c.dia} de {nombreMes(c.mes)})</td>
                {mt.aLaFecha.valores.map(v => <td key={v.anio} className="r" data-anio={v.anio}>{fi(v.t.ventaNeta)}</td>)}
                {mt.aLaFecha.cambios.map(x => celdaCambio(x, true))}
              </tr>
            )}
            <tr className="vt-tbl-footer" data-fila="anio-completo">
              <td>{mt.anioVivo ? 'AÑO COMPLETO' : 'TOTAL'}</td>
              {mt.completo.valores.map(v => <td key={v.anio} className="r" data-anio={v.anio}>{fi(v.t.ventaNeta)}</td>)}
              {mt.completo.cambios.map(x => celdaCambio(x, true))}
            </tr>
          </tfoot>
        </table>
      </div>
      {mt.anioVivo && (
        <p className="vt2-nota">«AÑO COMPLETO» no compara {mt.corte.anio} (todavía en curso) contra un año entero: eso está en «A LA FECHA».</p>
      )}

      {/* Por trimestre */}
      <div className="vt-sl" style={{ marginTop: '1rem' }}>Por trimestre</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
        {mt.trimestres.map(q => (
          <div key={q.q} style={{ background: 'var(--c-panel)', borderRadius: 2, padding: '0.875rem' }} data-trimestre={q.q}>
            <div style={{ fontSize: '0.65rem', color: 'var(--c-gris)', marginBottom: '0.625rem', fontWeight: 700 }}>
              T{q.q} · {MESES_CORTOS[q.q * 3 - 3]}–{MESES_CORTOS[q.q * 3 - 1]}{q.vivo ? ` · a la fecha (al ${c.dia} de ${nombreMes(c.mes)})` : ''}
            </div>
            {q.valores.map((v, i) => {
              const x = q.cambios[i]
              return (
                <div key={v.anio} data-anio={v.anio} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--c-linea)' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--c-gris)' }}>{v.anio}</span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--c-oro-texto)' }} data-dato="neta">{v.t.dias > 0 ? fi(v.t.ventaNeta) : '—'}</div>
                    {x && x.pct !== null && <div style={{ fontSize: '0.68rem' }}>{pct(x, 'trimestre')} <span className="vt2-delta-base">vs {x.contra}</span></div>}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <p className="vt2-nota" data-nota="temporadas">
        Por temporada (alta, baja de mayo, media, baja de septiembre): elegí «Temporada» en el «Período» de arriba. Compara
        contra la temporada anterior y contra el mismo tramo del año pasado.
      </p>
    </>
  )
}
