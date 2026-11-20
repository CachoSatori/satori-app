/**
 * Mi evolución — la pestaña principal de Mi Rendimiento para el personal (pedido del dueño, 18-nov-2026 12:55):
 * «que ellos evalúen su propio rendimiento personal, así pueden ver realmente si cambia algo con su esfuerzo».
 *
 * Todo sale de SUS facturas (191) con las reglas de Ventas (`evolucionPersonal.ts`): esta semana y este mes a la
 * fecha contra los mismos días del período anterior y contra la misma semana/mes del año pasado (−364 días, mismo día
 * de semana), y las últimas 12 semanas. Las proporciones del local (siempre) y su lugar en el equipo (con 4+
 * personas) salen de la mig 194: nunca la venta de otra persona.
 */
import { useMemo } from 'react'
import type { DiasMap, ProductMap } from '../../shared/types/ventas'
import { fi } from './ventasUtils'
import {
  comparacionesPersonales, semanasPersonales, tendenciaVentaPersona, variacionPct,
  type MisIndicadores,
} from './evolucionPersonal'
import { useEquipoAgregado, type EstadoEquipo } from './useEquipoAgregado'
import { SIN_DATOS_ANIO_PASADO, textoMotivoEquipo } from './equipoTextos'
import type { ProporcionesLocal } from '../../shared/api/rendimientoEquipo'

type Fila = { session_date: string; tip_amount_crc?: number | null; tip_amount_usd?: number | null; exchange_rate?: number | null }

interface Props {
  nombre:   string
  fechas:   string[]
  dias:     DiasMap
  pm:       ProductMap
  hoy:      string
  propinas: Fila[]
  /** Consultar la 194 (proporciones del local y lugar en el equipo). `false` en «Ver como». */
  consultarEquipo: boolean
}

const IND: { k: keyof MisIndicadores; label: string; fmt: (v: number) => string }[] = [
  { k: 'ventaPersona', label: 'Venta por persona', fmt: v => fi(v) },
  { k: 'ventas',       label: 'Ventas',            fmt: v => fi(v) },
  { k: 'pax',          label: 'Personas (PAX)',    fmt: v => String(Math.round(v)) },
  { k: 'ticketItem',   label: 'Ticket / ítem',     fmt: v => fi(v) },
  { k: 'bebidasPax',   label: 'Bebidas / PAX',     fmt: v => v.toFixed(2) },
  { k: 'icp',          label: 'ICP electrónico',   fmt: v => `${v.toFixed(1)}%` },
]

function Cambio({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="muted">—</span>
  return (
    <span className={`mr-delta ${pct >= 0 ? 'up' : 'down'}`} style={{ marginTop: 0 }}>
      {pct >= 0 ? '▲ +' : '▼ '}{Math.abs(pct).toFixed(1)}%
    </span>
  )
}

const val = (m: MisIndicadores | null, k: keyof MisIndicadores): number | null => {
  if (!m || m.dias === 0) return null
  const v = m[k]
  return typeof v === 'number' ? v : null
}

export default function MiEvolucion({ nombre, fechas, dias, pm, hoy, propinas, consultarEquipo }: Props) {
  const comps = useMemo(() => comparacionesPersonales(nombre, fechas, dias, pm, hoy, propinas), [nombre, fechas, dias, pm, hoy, propinas])
  // Las proporciones del local (y su año pasado) de los mismos dos períodos: semana y mes a la fecha.
  const eqSemana = useEquipoAgregado(consultarEquipo, comps[0].rango.desde, comps[0].rango.hasta)
  const eqMes    = useEquipoAgregado(consultarEquipo, comps[1].rango.desde, comps[1].rango.hasta)
  const equipos  = [eqSemana, eqMes]
  const semanas = useMemo(() => semanasPersonales(nombre, fechas, dias, pm, hoy, 12, propinas), [nombre, fechas, dias, pm, hoy, propinas])
  const tendencia = useMemo(() => tendenciaVentaPersona(semanas), [semanas])
  const conDatos = semanas.filter(s => s.dias > 0)
  const maxVp = Math.max(1, ...conDatos.map(s => s.ventaPersona ?? 0))

  return (
    <>
      <div className="mr-icp-sub" style={{ marginBottom: '0.75rem' }}>
        Te comparás con vos mismo, con las mismas reglas de Ventas: hasta ayer, y la base se corta a los mismos días.
      </div>

      {comps.map((c, ci) => (
        <div key={c.titulo} className="mr-card" data-testid="evo-comparacion">
          <div style={{ fontWeight: 800, color: 'var(--c-tinta)' }}>{c.titulo}</div>
          <div className="mr-icp-sub" style={{ marginBottom: '0.5rem' }}>
            {c.rotulo}{c.rotuloBase ? ` · contra ${c.rotuloBase}` : ' · sin período anterior para comparar'}
            {c.notaLargo ? ` (${c.notaLargo})` : ''}
          </div>
          {c.ahora.dias === 0 && (!c.antes || c.antes.dias === 0) ? (
            <div className="mr-icp-sub">Sin turnos tuyos en estos días.</div>
          ) : (
            <div className="mr-tbl-wrap" style={{ marginBottom: 0 }}>
              <table className="mr-tbl">
                <thead><tr>
                  <th>Indicador</th><th className="r">Ahora</th><th className="r">Antes</th><th className="r">Cambio</th>
                  <th className="r">Hace un año</th><th className="r">Cambio</th>
                </tr></thead>
                <tbody>
                  <tr><td>Días trabajados</td><td className="r">{c.ahora.dias}</td><td className="r muted">{c.antes?.dias ?? '—'}</td><td className="r" />
                      <td className="r muted">{c.anioPasado?.dias ?? '—'}</td><td className="r" /></tr>
                  {IND.map(i => {
                    const a = val(c.ahora, i.k), b = val(c.antes, i.k), y = val(c.anioPasado, i.k)
                    return (
                      <tr key={i.k}>
                        <td>{i.label}</td>
                        <td className="r" style={{ fontWeight: 700 }}>{a === null ? '—' : i.fmt(a)}</td>
                        <td className="r muted">{b === null ? '—' : i.fmt(b)}</td>
                        <td className="r"><Cambio pct={variacionPct(a, b)} /></td>
                        <td className="r muted">{y === null ? '—' : i.fmt(y)}</td>
                        <td className="r"><Cambio pct={variacionPct(a, y)} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mr-icp-sub" data-testid="evo-anio">
            {c.tituloAnio}{c.rotuloAnio ? ` · ${c.rotuloAnio}` : ''}
            {!c.anioPasado || c.anioPasado.dias === 0 ? ` · ${SIN_DATOS_ANIO_PASADO}` : ''}
          </div>
          {consultarEquipo && <ProporcionesDelLocal estado={equipos[ci]} titulo={c.tituloAnio} />}
        </div>
      ))}

      <div className="vt-sl">Últimas 12 semanas</div>
      {tendencia !== null && (
        <div className="mr-card accent" data-testid="evo-tendencia">
          Venta por persona, últimas 4 semanas contra las 4 anteriores: <Cambio pct={tendencia} />
        </div>
      )}
      {conDatos.length === 0 ? (
        <div className="mr-icp-sub">Todavía no hay semanas con turnos tuyos.</div>
      ) : (
        <div className="mr-tbl-wrap">
          <table className="mr-tbl" data-testid="evo-semanas">
            <thead><tr>
              <th>Semana</th><th className="r">Días</th><th className="r">Venta/persona</th><th />
              <th className="r">PAX</th><th className="r">Ticket/ítem</th><th className="r">Beb/PAX</th><th className="r">ICP</th>
            </tr></thead>
            <tbody>
              {semanas.map(s => (
                <tr key={s.lunes} className={s.enCurso ? 'best' : ''}>
                  <td>{s.rotulo}{s.enCurso ? ' · en curso' : ''}</td>
                  <td className="r muted">{s.dias}</td>
                  <td className="r" style={{ fontWeight: 700 }}>{s.dias && s.ventaPersona !== null ? fi(s.ventaPersona) : '—'}</td>
                  <td style={{ minWidth: 70 }}>
                    {s.dias > 0 && s.ventaPersona !== null && (
                      <div className="mr-prod-bar"><div className="mr-prod-bar-fill" style={{ width: `${(s.ventaPersona / maxVp) * 100}%` }} /></div>
                    )}
                  </td>
                  <td className="r">{s.dias ? Math.round(s.pax) : '—'}</td>
                  <td className="r muted">{s.dias && s.ticketItem !== null ? fi(s.ticketItem) : '—'}</td>
                  <td className="r muted">{s.dias && s.bebidasPax !== null ? s.bebidasPax.toFixed(2) : '—'}</td>
                  <td className="r muted">{s.dias && s.icp !== null ? `${s.icp.toFixed(1)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {consultarEquipo && <MiLugarEnElEquipo estado={eqMes} />}
    </>
  )
}

const PROP: { k: keyof ProporcionesLocal; label: string; fmt: (v: number) => string }[] = [
  { k: 'prom_pax',    label: 'Venta por PAX',  fmt: v => fi(v) },
  { k: 'beb_pax',     label: 'Bebidas / PAX',  fmt: v => v.toFixed(2) },
  { k: 'prom_ticket', label: 'Ticket / ítem',  fmt: v => fi(v) },
]

/** Las proporciones del local en estos días y en los mismos del año pasado (siempre; sin plata total ni posición). */
function ProporcionesDelLocal({ estado, titulo }: { estado: EstadoEquipo; titulo: string }) {
  if (estado.cargando || !estado.datos?.general) return null
  const g = estado.datos.general
  const y = estado.datos.anio_pasado?.general ?? null
  return (
    <div className="mr-tbl-wrap" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
      <table className="mr-tbl" data-testid="evo-local">
        <thead><tr><th>El local</th><th className="r">Ahora</th><th className="r">{titulo}</th><th className="r">Cambio</th></tr></thead>
        <tbody>
          {PROP.map(p => {
            const a = g[p.k], b = y ? y[p.k] : null
            return (
              <tr key={p.k}>
                <td>{p.label}</td>
                <td className="r">{a === null ? '—' : p.fmt(a)}</td>
                <td className="r muted">{b === null ? (y ? '—' : SIN_DATOS_ANIO_PASADO) : p.fmt(b)}</td>
                <td className="r"><Cambio pct={variacionPct(a, b)} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Mi lugar en el equipo este mes a la fecha: posiciones y mediana, sin ventas de nadie. Solo con 4+ personas. */
function MiLugarEnElEquipo({ estado }: { estado: EstadoEquipo }) {
  const d = estado.datos
  if (estado.cargando) return <div className="mr-icp-sub">Cargando la comparación con el equipo…</div>
  const aviso = textoMotivoEquipo(d)
  const eq = d?.equipo
  const filas: { label: string; pos: number | null | undefined; med: string | null }[] = eq ? [
    { label: 'Ventas',            pos: eq.mi_posicion?.ventas,      med: null },
    { label: 'Venta por persona', pos: eq.mi_posicion?.prom_pax,    med: eq.mediana.prom_pax === null ? null : fi(eq.mediana.prom_pax) },
    { label: 'Ticket / ítem',     pos: eq.mi_posicion?.prom_ticket, med: eq.mediana.prom_ticket === null ? null : fi(eq.mediana.prom_ticket) },
    { label: 'Bebidas / PAX',     pos: eq.mi_posicion?.beb_pax,     med: eq.mediana.beb_pax === null ? null : eq.mediana.beb_pax.toFixed(2) },
    { label: 'PAX por día',       pos: eq.mi_posicion?.pax_dia,     med: eq.mediana.pax_dia === null ? null : eq.mediana.pax_dia.toFixed(1) },
  ] : []
  return (
    <>
      <div className="vt-sl">Tu lugar en el equipo · este mes a la fecha</div>
      {!d?.ranking && !eq && !aviso && <div className="mr-icp-sub">Sin datos del equipo para este mes.</div>}
      {d?.ranking && (
        <div className="mr-card accent" data-testid="evo-ranking">
          <strong>{d.ranking.posicion}.º de {d.ranking.de}</strong> en ventas
        </div>
      )}
      {eq && (
        <div className="mr-tbl-wrap">
          <table className="mr-tbl" data-testid="evo-equipo">
            <thead><tr><th>Indicador</th><th className="r">Tu lugar</th><th className="r">Mediana del equipo</th></tr></thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.label}>
                  <td>{f.label}</td>
                  <td className="r" style={{ fontWeight: 700 }}>{f.pos ? `${f.pos}.º de ${eq.de}` : '—'}</td>
                  <td className="r muted">{f.med ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {aviso && <div className="mr-icp-sub" role="note">{aviso}</div>}
      <div className="mr-icp-sub" style={{ marginTop: '0.25rem' }}>
        Solo posiciones y medianas del equipo, y solo con 4 o más personas: nadie ve las ventas de otra persona.
      </div>
    </>
  )
}
