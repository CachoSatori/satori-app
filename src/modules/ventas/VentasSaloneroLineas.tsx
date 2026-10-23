// ── Saloneros por LÍNEA · las dos lentes (Parte B, paso 4) ─────────────────────────────────
//
// Una fila por PERSONA × TURNO, en dos bloques SEPARADOS que nunca se suman.
//
// ⚠️ POR QUÉ DOS TABLAS Y NO DOS COLUMNAS DE LA MISMA. Cada lente parte la neta del día
// ENTERA, por un eje distinto. Ponerlas lado a lado invita a sumarlas de un vistazo, y esa
// suma cuenta dos veces toda mesa partida entre dos meseros. Están separadas a propósito, con
// su propio total cada una y el mismo número de día abajo de las dos.
//
// ⚠️ SOLO LECTURA. Todo lo que se lee son SELECT (`saloneroLentesDatos.ts`) y todo lo que se
// calcula es puro (`saloneroLentes.ts`). Esta pantalla no puede escribir un dato ni por error.
//
// El nombre del archivo NO puede diferir solo en el case de otro módulo del directorio: en
// macOS eso rompió la ruta Ventas entera una vez (ver `VentasParidad.tsx`). Acá el par es
// `VentasSaloneroLineas.tsx` / `saloneroLentes.ts` — distintos de verdad.

import { useCallback, useState } from 'react'

import { nombreDePersona, type RolCodigo } from '../../shared/ndf/personasNdf'
import {
  turnosSalonero,
  type FilaMesaPropia, type FilaVentaPropia, type LentesSaloneros,
} from './saloneroLentes'
import { getLentesDesdePos, type LentesConNombres } from './saloneroLentesDatos'
import { fi } from './ventasUtils'
import './ventasEnVivo.css'

const hoyISO = (): string => new Date().toISOString().slice(0, 10)

/** `2026-09-05` → `2026-08-29` (una semana atrás), el rango que abre por defecto. */
function haceUnaSemana(hoy: Date): string {
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - 6))
  return d.toISOString().slice(0, 10)
}

const ROL_ETIQUETA: Record<RolCodigo, string> = {
  mesero:   'Mesero',
  caja:     'Caja',
  generico: 'Login compartido',
  otro:     'Sin clasificar',
}

const ent = (n: number): string => n.toLocaleString('es-CR')
const opt = (n: number | null): string => (n === null ? '—' : fi(n))

/** Las filas de un turno, ya ordenadas por el módulo puro. */
function porTurno<T extends { turno: string }>(filas: T[], turno: string): T[] {
  return filas.filter(f => f.turno === turno)
}

interface Props { lentes: LentesSaloneros; nombres: Record<string, string> }

// ── Lente A ────────────────────────────────────────────────────────────────────────────────

function TablaVentaPropia({ filas, nombres }: { filas: FilaVentaPropia[]; nombres: Record<string, string> }) {
  const total = filas.reduce((s, f) => s + f.netaCrc, 0)
  const pax   = filas.reduce((s, f) => s + f.paxPropio, 0)
  return (
    <div className="apos-tabla-wrap">
      <table className="apos-tabla">
        <thead>
          <tr>
            <th>Persona</th>
            <th className="r">Venta propia</th>
            <th className="r">IVA</th>
            <th className="r">Servicio</th>
            <th className="r">PAX propio</th>
            <th className="r">Prom/pax</th>
            <th className="r">Líneas</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(f => (
            <tr key={`${f.personaId}|${f.turno}`}>
              <td>
                {nombreDePersona(f.persona, nombres)}
                {f.rol !== 'mesero' && <div className="apos-mini">{ROL_ETIQUETA[f.rol]}</div>}
                {f.persona.inactivo && <div className="apos-mini">inactivo</div>}
              </td>
              <td className="r">{fi(f.netaCrc)}</td>
              <td className="r">{fi(f.ivaCrc)}</td>
              <td className="r">{fi(f.servicioCrc)}</td>
              <td className="r">{ent(f.paxPropio)}</td>
              <td className="r">{opt(f.promPorPax)}</td>
              <td className="r">{ent(f.lineas)}</td>
            </tr>
          ))}
          {filas.length === 0 && (
            <tr><td colSpan={7} className="apos-mini">Sin ventas en este turno.</td></tr>
          )}
          {filas.length > 0 && (
            <tr className="apos-fila-total">
              <td><strong>Total del turno</strong></td>
              <td className="r"><strong>{fi(total)}</strong></td>
              <td className="r">{fi(filas.reduce((s, f) => s + f.ivaCrc, 0))}</td>
              <td className="r">{fi(filas.reduce((s, f) => s + f.servicioCrc, 0))}</td>
              <td className="r">{ent(pax)}</td>
              <td className="r">{pax > 0 ? fi(Math.round(total / pax)) : '—'}</td>
              <td className="r">{ent(filas.reduce((s, f) => s + f.lineas, 0))}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Lente B ────────────────────────────────────────────────────────────────────────────────

function TablaMesaPropia({ filas, nombres }: { filas: FilaMesaPropia[]; nombres: Record<string, string> }) {
  const neta    = filas.reduce((s, f) => s + f.netaMesasCrc, 0)
  const tickets = filas.reduce((s, f) => s + f.tickets, 0)
  const pax     = filas.reduce((s, f) => s + f.paxMesas, 0)
  return (
    <div className="apos-tabla-wrap">
      <table className="apos-tabla">
        <thead>
          <tr>
            <th>Persona</th>
            <th className="r">Mesas</th>
            <th className="r">Facturas</th>
            <th className="r">Neta de sus mesas</th>
            <th className="r">Ticket promedio</th>
            <th className="r">PAX de mesa</th>
            <th className="r">Prom/pax</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(f => (
            <tr key={`${f.personaId}|${f.turno}`}>
              <td>
                {nombreDePersona(f.persona, nombres)}
                {f.rol !== 'mesero' && <div className="apos-mini">{ROL_ETIQUETA[f.rol]}</div>}
              </td>
              <td className="r">{ent(f.mesas)}</td>
              <td className="r">{ent(f.tickets)}</td>
              <td className="r">{fi(f.netaMesasCrc)}</td>
              <td className="r">{opt(f.ticketPromedio)}</td>
              <td className="r">{ent(f.paxMesas)}</td>
              <td className="r">{opt(f.promPorPaxMesa)}</td>
            </tr>
          ))}
          {filas.length === 0 && (
            <tr><td colSpan={7} className="apos-mini">Sin mesas en este turno.</td></tr>
          )}
          {filas.length > 0 && (
            <tr className="apos-fila-total">
              <td><strong>Total del turno</strong></td>
              <td className="r">{ent(filas.reduce((s, f) => s + f.mesas, 0))}</td>
              <td className="r">{ent(tickets)}</td>
              <td className="r"><strong>{fi(neta)}</strong></td>
              <td className="r">{tickets > 0 ? fi(Math.round(neta / tickets)) : '—'}</td>
              <td className="r">{ent(pax)}</td>
              <td className="r">{pax > 0 ? fi(Math.round(neta / pax)) : '—'}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Los dos bloques ────────────────────────────────────────────────────────────────────────

export function BloquesLentes({ lentes, nombres }: Props) {
  const turnos = turnosSalonero().filter(t =>
    lentes.ventaPropia.some(f => f.turno === t.turno) ||
    lentes.mesaPropia.some(f => f.turno === t.turno))

  return (
    <>
      <div className="apos-panel">
        <div className="apos-panel-hd">
          <h3>Lente A · Venta propia <span className="apos-mini">(por línea — el ranking)</span></h3>
        </div>
        <p className="apos-nota">
          Lo que cada uno <strong>comandó</strong>, línea por línea. En una factura partida cada
          quien se lleva lo suyo. <strong>Σ de todas las personas = neta del día</strong>, así que
          esta lente es exactamente aditiva: premia el upsell en mesa ajena y no castiga al dueño
          de la mesa. El <strong>PAX propio</strong> son las unidades del artículo 677 que esa
          persona registró.
        </p>
        {turnos.map(t => (
          <div key={t.turno} style={{ marginBottom: '1rem' }}>
            <h4 className="apos-mini" style={{ margin: '0 0 .35rem' }}>{t.etiqueta}</h4>
            <TablaVentaPropia filas={porTurno(lentes.ventaPropia, t.turno)} nombres={nombres} />
          </div>
        ))}
      </div>

      <div className="apos-panel">
        <div className="apos-panel-hd">
          <h3>Lente B · Mesa propia <span className="apos-mini">(por factura — contexto)</span></h3>
        </div>
        <p className="apos-nota">
          Quién <strong>corrió la mesa</strong>: el dueño es quien registró el 677, y se lleva la
          factura <strong>entera</strong>, incluidas las líneas que comandó otro. Sirve para el
          ticket promedio, no para el ranking — la plata del ayudante ya está en su venta propia,
          arriba.
        </p>
        {turnos.map(t => (
          <div key={t.turno} style={{ marginBottom: '1rem' }}>
            <h4 className="apos-mini" style={{ margin: '0 0 .35rem' }}>{t.etiqueta}</h4>
            <TablaMesaPropia filas={porTurno(lentes.mesaPropia, t.turno)} nombres={nombres} />
          </div>
        ))}
      </div>
    </>
  )
}

// ── La pantalla ────────────────────────────────────────────────────────────────────────────

export default function VentasSaloneroLineas() {
  const [desde, setDesde] = useState(() => haceUnaSemana(new Date()))
  const [hasta, setHasta] = useState(hoyISO)

  /**
   * Lo que se leyó, CON el rango con el que se leyó.
   *
   * El rango viaja adentro a propósito: si se mueven las fechas y no se vuelve a correr, hay
   * que poder avisar que lo de abajo es de OTRO rango. Guardarlo aparte de los inputs es lo
   * que evita mostrar números viejos bajo fechas nuevas.
   */
  const [corrida, setCorrida] = useState<
    ({ desde: string; hasta: string } & LentesConNombres) | null
  >(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const correr = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const datos = await getLentesDesdePos({ desde, hasta })
      setCorrida({ desde, hasta, ...datos })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCargando(false)
    }
  }, [desde, hasta])

  // No corre sola al montar: barrer un rango largo del PoS cuesta. El botón es el disparador.
  const vigente = corrida !== null && corrida.desde === desde && corrida.hasta === hasta

  return (
    <div className="vt-section">
      <div className="apos">

        <div className="apos-panel">
          <div className="apos-panel-hd">
            <h3>Saloneros por línea</h3>
            <span className="apos-tag-diag">solo lectura</span>
          </div>
          <p className="apos-nota">
            Atribución por <strong>línea</strong> (<code>UsuarioRegistra</code>), no un mesero por
            factura: con dos meseros en la misma mesa cada uno se lleva lo suyo, en vez de
            acreditarle todo a uno. Una fila por <strong>persona × turno</strong>; el turno lo
            define la caja que cobró (<code>111</code> / <code>222</code>), no el reloj.
          </p>
          <div className="apos-bar">
            <label className="apos-fecha">
              Desde <input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} />
            </label>
            <label className="apos-fecha">
              Hasta <input type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} />
            </label>
            <span className="apos-spacer" />
            <button type="button" className="apos-btn-hoy" disabled={cargando} onClick={correr}>
              {cargando ? 'Leyendo…' : vigente ? 'Volver a leer' : 'Leer'}
            </button>
          </div>
        </div>

        {error && (
          <div className="apos-panel">
            <p className="apos-nota" style={{ marginBottom: 0 }}>
              <strong>No se pudo leer:</strong> {error}
            </p>
          </div>
        )}

        {corrida && !vigente && (
          <div className="apos-panel">
            <p className="apos-nota" style={{ marginBottom: 0 }}>
              <strong>Moviste el rango.</strong> Lo de abajo es de {corrida.desde} → {corrida.hasta}.
              Tocá <strong>Leer</strong> para el rango nuevo.
            </p>
          </div>
        )}

        {corrida && (
          <>
            <div className="apos-kpis">
              <div className="apos-kpi is-principal">
                <span className="apos-kpi-lbl">Neta del período</span>
                <span className="apos-kpi-val">{fi(corrida.lentes.netaDiaCrc)}</span>
                <span className="apos-kpi-sub">{corrida.desde} → {corrida.hasta}</span>
              </div>
              <div className="apos-kpi">
                <span className="apos-kpi-lbl">Facturas</span>
                <span className="apos-kpi-val">{ent(corrida.tickets)}</span>
                <span className="apos-kpi-sub">cerradas, en jornadas del rango</span>
              </div>
              <div className="apos-kpi">
                <span className="apos-kpi-lbl">Descuadre líneas ↔ facturas</span>
                <span className="apos-kpi-val">{fi(corrida.lentes.descuadreCrc)}</span>
                <span className="apos-kpi-sub">
                  {corrida.lentes.descuadreCrc === 0
                    ? 'las líneas suman lo que dicen las facturas'
                    : 'hay facturas sin su detalle: el reparto no cubre todo el período'}
                </span>
              </div>
            </div>

            {/* Las dos lentes NUNCA se suman: por eso van en dos bloques, con este aviso en medio. */}
            <BloquesLentes lentes={corrida.lentes} nombres={corrida.nombres} />

            <div className="apos-panel">
              <p className="apos-nota" style={{ marginBottom: 0 }}>
                <strong>Las dos lentes no se suman.</strong> Cada una reparte la misma neta
                ({fi(corrida.lentes.netaDiaCrc)}) por un eje distinto: A por quién comandó, B por
                quién corrió la mesa. Sumarlas contaría dos veces cada mesa partida.{' '}
                <strong>Caja</strong>, <strong>login compartido</strong> y{' '}
                <strong>sin clasificar</strong> aparecen marcados: no son del ranking, pero su
                plata cuenta en el total del día — no se le tira la venta a nadie. El{' '}
                <strong>IVA</strong> y el <strong>servicio</strong> de la lente A van{' '}
                <em>prorrateados</em> por la plata de cada uno en la factura: el PoS no los manda
                por línea.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
