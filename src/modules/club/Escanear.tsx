/**
 * Escanear — un solo botón en caja (SPEC §2.4).
 *  · Cupón vigente → personas + PEDIDO (de los abiertos en el PoS) → confirmar → «+N personas a {referente}».
 *    Plan B si el pedido ya se cerró o la lista no carga: elegir la factura de las últimas 2 h.
 *  · Pase de referente (/r/) → saldo y «Tarjeta física». NO habilita el canje (R-01): cualquiera puede
 *    tener una foto del QR de la recepción.
 *  · Código de canje (/k/, 6 caracteres, lo genera el referente en su portal y vence a los 10 min) →
 *    canje (1 / 1,5 / 2). Respaldo sin celular: «Canje sin celular», solo owner o manager, con nota.
 *  · Usado, vencido, dado de baja o desconocido → una línea clara.
 *  Plan B: código a mano y búsqueda (nombre, negocio o últimos 4 del teléfono).
 * Idempotencia: un `p_op` por intento; si falla la red, el reintento usa el mismo.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  resolverQR, resolverMiembro, usarCupon, canjear, canjeAprobado, avisoCanje, tarjetaManual, buscar, aClubError, nuevoOp,
  opcionesCanje, fmtCreditos, MSG_REFERENTE_INACTIVO, getPedidosAbiertos, getFacturasRecientes, posDePedido, posDeFactura,
  describirPos, describirPedido, describirFactura, socioAltaCaja, socioValidar,
  type ResolverCupon, type ResolverReferente, type ResolverCanje, type ResolverSocio, type BusquedaFila, type ClubError, type PosRef, type PedidoAbierto,
  type FacturaReciente,
} from '../../shared/api/club'
import { parsearQR } from './qrFormato'
import { Aviso, Btn, Card, Chip } from './ui'
import { C, inputStyle, labelStyle, fmtFechaHora, TIPO_MIEMBRO_LABEL } from './estilos'
import { useAuth } from '../../shared/hooks/useAuth'

const LectorQR = lazy(() => import('./LectorQR'))

type Actual =
  | { kind: 'cupon'; r: ResolverCupon; codigo: string }
  | { kind: 'referente'; r: ResolverReferente; codigo: string }
  | { kind: 'canje'; r: ResolverCanje; codigo: string }
  | { kind: 'socio'; r: ResolverSocio; codigo: string }
type Accion = 'usar' | 'canje' | 'tarjeta' | 'aprobado'
type ModoRef = 'tarjeta' | 'aprobado'
type Mensaje = { tono: 'ok' | 'error' | 'info'; texto: string; link?: { href: string; texto: string } }

export default function Escanear() {
  const { profile } = useAuth()
  const gestiona = profile?.role === 'owner' || profile?.role === 'manager'
  const [camara, setCamara]       = useState(false)
  const [manual, setManual]       = useState('')
  const [q, setQ]                 = useState('')
  const [resultados, setResultados] = useState<BusquedaFila[] | null>(null)
  const [cargando, setCargando]   = useState(false)
  const [actual, setActual]       = useState<Actual | null>(null)
  const [msg, setMsg]             = useState<Mensaje | null>(null)

  // formularios
  const [personas, setPersonas]   = useState('')
  const [pos, setPos]             = useState<PosRef | null>(null)
  const [creditos, setCreditos]   = useState<number | null>(null)
  const [modoRef, setModoRef]     = useState<ModoRef>('tarjeta')
  const [nota, setNota]           = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando]   = useState(false)
  const [errAccion, setErrAccion] = useState<ClubError | null>(null)

  // un p_op por intento y por acción; se descarta al terminar bien o al cambiar de cuenta
  const ops = useRef<Partial<Record<Accion, string>>>({})
  const opDe = (a: Accion) => (ops.current[a] ??= nuevoOp())

  function limpiarFormularios() {
    setPersonas(''); setPos(null); setCreditos(null); setConfirmando(false); setErrAccion(null); setModoRef('tarjeta'); setNota('')
  }

  async function resolver(texto: string, silencioso = false) {
    const p = parsearQR(texto)
    if (p.tipo === 'desconocido' || !p.codigo) {
      setActual(null); setMsg({ tono: 'error', texto: 'Código no reconocido. Probá de nuevo o buscá por nombre.' })
      return
    }
    setCargando(true); if (!silencioso) setMsg(null)
    try {
      const r = await resolverQR(texto)
      if (r.tipo === 'cupon') {
        setActual({ kind: 'cupon', r, codigo: p.codigo })
      } else if (r.tipo === 'referente') {
        setActual({ kind: 'referente', r, codigo: p.codigo })
      } else if (r.tipo === 'canje') {
        setActual({ kind: 'canje', r, codigo: p.codigo })
      } else if (r.tipo === 'socio') {
        setActual({ kind: 'socio', r, codigo: p.codigo })
      } else {
        setActual(null); setMsg({ tono: 'error', texto: 'Código no reconocido: no es un cupón, un código de canje ni un pase vigente. Probá de nuevo, escribilo a mano o buscá al referente por nombre.' })
      }
      if (!silencioso) { ops.current = {}; limpiarFormularios() }
    } catch (e) {
      setMsg({ tono: 'error', texto: aClubError(e).message })
    } finally {
      setCargando(false)
    }
  }

  async function onBuscar() {
    setCargando(true); setMsg(null); setResultados(null)
    try { setResultados(await buscar(q)) }
    catch (e) { setMsg({ tono: 'error', texto: aClubError(e).message }) }
    finally { setCargando(false) }
  }

  async function elegir(f: BusquedaFila) {
    setResultados(null); setQ('')
    if (f.estado !== 'activo') { setActual(null); setMsg({ tono: 'error', texto: MSG_REFERENTE_INACTIVO }); return }
    setCargando(true)
    try {
      // CLUB-AUD-30: la caja no lee el código del QR; la ficha llega por función (saldo, sin canje: R-01).
      const r = await resolverMiembro(f.id)
      if (r.tipo !== 'referente') throw new Error('No se encontró la cuenta del referente: buscalo de nuevo o escaneá su QR')
      setActual({ kind: 'referente', r, codigo: '' }); ops.current = {}; limpiarFormularios()
    } catch (e) {
      setMsg({ tono: 'error', texto: aClubError(e).message })
    } finally {
      setCargando(false)
    }
  }

  function cerrarCuenta() { setActual(null); ops.current = {}; limpiarFormularios() }

  async function confirmar() {
    if (!actual) return
    setEnviando(true); setErrAccion(null)
    try {
      if (actual.kind === 'cupon') {
        const n = Number(personas)
        await usarCupon(actual.codigo, n, pos!, opDe('usar'))
        setMsg({ tono: 'ok', texto: `+${n} ${n === 1 ? 'persona' : 'personas'} a ${actual.r.datos.referente}` })
        cerrarCuenta()
      } else if (actual.kind === 'canje' && creditos != null) {
        // El código queda usado: se cierra la cuenta (volver a escanearlo diría «ya se usó»).
        const s = await canjear(actual.r.datos.id, actual.codigo, creditos, pos!, opDe('canje'))
        const texto = `Canje de ${fmtCreditos(creditos)} ${creditos === 1 ? 'crédito' : 'créditos'} a ${actual.r.datos.nombre}. Le ${Number(s.creditos) === 1 ? 'queda' : 'quedan'} ${fmtCreditos(s.creditos)} ${Number(s.creditos) === 1 ? 'crédito' : 'créditos'}.`
        setMsg({ tono: 'ok', texto })
        cerrarCuenta()
        // Aviso al referente (hasta que lo mande el pase de Wallet): link de WhatsApp con el canje y el saldo.
        if (s.movimiento) {
          avisoCanje(s.movimiento)
            .then(href => { if (href) setMsg({ tono: 'ok', texto, link: { href, texto: 'Avisarle por WhatsApp' } }) })
            .catch(() => { /* sin aviso: el canje ya quedó */ })
        }
      } else if (modoRef === 'aprobado' && creditos != null) {
        const s = await canjeAprobado(actual.r.datos.id, creditos, pos!, opDe('aprobado'), nota.trim())
        setMsg({ tono: 'ok', texto: `Canje sin celular de ${fmtCreditos(creditos)} ${creditos === 1 ? 'crédito' : 'créditos'} a ${actual.r.datos.nombre}. Le ${Number(s.creditos) === 1 ? 'queda' : 'quedan'} ${fmtCreditos(s.creditos)} ${Number(s.creditos) === 1 ? 'crédito' : 'créditos'}.` })
        delete ops.current.aprobado; limpiarFormularios()
        await resolver(actual.codigo, true)
      } else if (modoRef === 'tarjeta') {
        const n = Number(personas)
        await tarjetaManual(actual.r.datos.id, n, pos!, opDe('tarjeta'))
        setMsg({ tono: 'ok', texto: `Tarjeta física: +${n} ${n === 1 ? 'persona' : 'personas'} a ${actual.r.datos.nombre}` })
        delete ops.current.tarjeta; limpiarFormularios()
        await resolver(actual.codigo, true)
      }
    } catch (e) {
      // El p_op se conserva: si fue la red, el reintento no duplica.
      setErrAccion(aClubError(e)); setConfirmando(false)
    } finally {
      setEnviando(false)
    }
  }

  const nPersonas = Number(personas)
  const personasOk = Number.isInteger(nPersonas) && nPersonas >= 1 && nPersonas <= 30
  const facturaOk = pos !== null

  return (
    <div className="tips-body" style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {msg && (
        <Aviso tono={msg.tono} onClose={() => setMsg(null)}>
          {msg.texto}
          {msg.link && (
            <div style={{ marginTop: 8 }}>
              <a href={msg.link.href} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700, color: 'inherit' }}>{msg.link.texto} ↗</a>
            </div>
          )}
        </Aviso>
      )}

      {!actual && (
        <>
          {camara ? (
            <Suspense fallback={<div style={{ textAlign: 'center', padding: '2rem', color: C.muted }}>Abriendo cámara…</div>}>
              <LectorQR onCerrar={() => setCamara(false)} onDetectar={t => { setCamara(false); resolver(t) }} />
            </Suspense>
          ) : (
            <Btn big onClick={() => { setMsg(null); setCamara(true) }} style={{ fontSize: '1.35rem', padding: '1.6rem 1rem' }}>
              📷 Escanear
            </Btn>
          )}

          <Card>
            <form onSubmit={e => { e.preventDefault(); if (manual.trim()) { resolver(manual); setManual('') } }}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <label style={{ flex: 1 }}>
                <span style={labelStyle}>Código a mano</span>
                <input value={manual} onChange={e => setManual(e.target.value)} placeholder="Cupón, canje, socio o pase" aria-label="Código a mano: cupón (10), canje (6), socio (9) o pase (8)"
                  autoCapitalize="characters" autoComplete="off" style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '0.12em' }} />
              </label>
              <Btn type="submit" disabled={cargando || !manual.trim()}>Ver</Btn>
            </form>
          </Card>

          <Card>
            <form onSubmit={e => { e.preventDefault(); onBuscar() }} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <label style={{ flex: 1 }}>
                <span style={labelStyle}>Buscar referente (plan B)</span>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Nombre, negocio o tel." aria-label="Buscar referente por nombre, negocio o últimos 4 del teléfono"
                  autoComplete="off" style={inputStyle} />
              </label>
              <Btn type="submit" variant="secondary" disabled={cargando || q.trim().length < 3}>Buscar</Btn>
            </form>
            {resultados && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {resultados.length === 0 && <div style={{ color: C.muted, fontSize: '0.9rem' }}>Sin resultados.</div>}
                {resultados.map(f => (
                  <button key={f.id} onClick={() => elegir(f)}
                    style={{ textAlign: 'left', background: C.paper, border: `1px solid ${C.border}`, borderRadius: 8, padding: '0.7rem 0.8rem', cursor: 'pointer', minHeight: 44 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{f.nombre}</strong>
                      <span>{fmtCreditos(f.creditos)} cr.</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: C.muted, display: 'flex', gap: 6, alignItems: 'center' }}>
                      {f.negocio ?? 'Sin negocio'} · {TIPO_MIEMBRO_LABEL[f.tipo] ?? f.tipo}
                      {f.estado !== 'activo' && <Chip color={C.red}>baja</Chip>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
          <NuevoSocio onHecho={t => setMsg({ tono: 'ok', texto: t })} />
          {cargando && <div style={{ textAlign: 'center', color: C.muted }}>Buscando…</div>}
        </>
      )}

      {actual?.kind === 'cupon' && (
        <PanelCupon a={actual} personas={personas} setPersonas={setPersonas} pos={pos} setPos={setPos}
          personasOk={personasOk} facturaOk={facturaOk} confirmando={confirmando} setConfirmando={setConfirmando}
          enviando={enviando} err={errAccion} onConfirmar={confirmar} onCerrar={cerrarCuenta} />
      )}

      {actual?.kind === 'socio' && (
        <PanelSocio d={actual.r.datos} onCerrar={cerrarCuenta}
          onValidado={async t => { await resolver(actual.codigo, true); setMsg({ tono: 'ok', texto: t }) }} />
      )}

      {(actual?.kind === 'referente' || actual?.kind === 'canje') && (
        <PanelReferente a={actual} gestiona={gestiona} nota={nota} setNota={setNota}
          modo={modoRef} setModo={m => { setModoRef(m); setCreditos(null); setConfirmando(false); setErrAccion(null) }}
          creditos={creditos} setCreditos={setCreditos} personas={personas} setPersonas={setPersonas}
          pos={pos} setPos={setPos} personasOk={personasOk} facturaOk={facturaOk}
          confirmando={confirmando} setConfirmando={setConfirmando} enviando={enviando} err={errAccion}
          onConfirmar={confirmar} onCerrar={cerrarCuenta} />
      )}
    </div>
  )
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function CampoPersonas({ v, set }: { v: string; set: (s: string) => void }) {
  const n = Number(v) || 0
  return (
    <label>
      <span style={labelStyle}>Personas de la mesa (1 a 30)</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <Btn variant="secondary" onClick={() => set(String(Math.max(1, n - 1)))} style={{ width: 52 }}>−</Btn>
        <input value={v} onChange={e => set(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="0"
          style={{ ...inputStyle, textAlign: 'center', fontSize: '1.3rem', fontWeight: 700 }} />
        <Btn variant="secondary" onClick={() => set(String(Math.min(30, n + 1)))} style={{ width: 52 }}>+</Btn>
      </div>
    </label>
  )
}

/**
 * Pedido del PoS: lista de pedidos abiertos del local (puente, ~75 s). Un toque elige; el servidor guarda
 * el pedido y la hora del escaneo. Plan B si el pedido ya se cerró o la lista no carga: la lista de
 * facturas cerradas de las últimas 2 h (hora, total, mesa si tiene). No se tipea nada.
 */
function SelectorPedido({ v, set }: { v: PosRef | null; set: (p: PosRef | null) => void }) {
  const [pedidos, setPedidos] = useState<PedidoAbierto[] | null>(null)
  const [facturas, setFacturas] = useState<FacturaReciente[] | null>(null)
  const [err, setErr] = useState<string | false>(false)
  const [errB, setErrB] = useState(false)
  const [planB, setPlanB] = useState(v?.modo === 'factura')
  const cargar = useCallback(() => {
    setErr(false); setPedidos(null)
    getPedidosAbiertos().then(p => { setPedidos(p); if (p.length === 0) setPlanB(true) })
      .catch(e => {
        // CLUB-AUD-27: sin puente al día, la lista no es confiable → plan B con el motivo.
        const m = aClubError(e).message
        setErr(/puente sin datos/i.test(m) ? 'Puente sin datos.' : 'No se pudo cargar la lista de pedidos.'); setPedidos([]); setPlanB(true)
      })
  }, [])
  const cargarB = useCallback(() => {
    setErrB(false); setFacturas(null)
    getFacturasRecientes().then(setFacturas).catch(() => { setErrB(true); setFacturas([]) })
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar() }, [cargar])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (planB) cargarB() }, [planB, cargarB])
  const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Costa_Rica' })
  const opcion = (sel: boolean) => ({ textAlign: 'left' as const, minHeight: 52, borderRadius: 8, cursor: 'pointer', padding: '0.6rem 0.8rem',
                                      border: `2px solid ${sel ? C.ink : C.border}`, background: sel ? C.paper : '#fff' })
  return (
    <div>
      <span style={labelStyle}>{planB ? 'Factura (plan B)' : 'Pedido'}</span>
      {!planB && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pedidos === null && <div style={{ color: C.muted }}>Cargando pedidos abiertos…</div>}
          {pedidos?.map(p => {
            const sel = v?.modo === 'pedido' && v.pedido === p.pedido
            return (
              <button key={p.pedido} onClick={() => set(posDePedido(p))} aria-pressed={sel} style={opcion(sel)}>
                <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>
                  {describirPedido(p)} · <span style={{ fontWeight: 500 }}>{p.salonero ?? 'sin salonero'}</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: C.muted }}>
                  {p.pax ? `${p.pax} pax · ` : ''}act. {hora(p.actualizado)}
                </div>
              </button>
            )
          })}
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn variant="secondary" onClick={cargar} style={{ flex: 1 }}>Actualizar</Btn>
            <Btn variant="ghost" onClick={() => { setPlanB(true); set(null) }} style={{ flex: 2 }}>El pedido no está</Btn>
          </div>
        </div>
      )}
      {planB && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: '0.85rem', color: C.muted }}>
            {err ? `${err} Elegí` : pedidos?.length === 0 ? 'No hay pedidos abiertos en el PoS. Elegí' : 'Pedido ya cerrado: elegí'}{' '}
            la factura de la lista (cerradas en las últimas 2 horas).
          </div>
          {facturas === null && <div style={{ color: C.muted }}>Cargando facturas…</div>}
          {errB && <div style={{ color: C.red, fontSize: '0.85rem' }}>No se pudo cargar la lista de facturas. Probá «Actualizar».</div>}
          {facturas?.length === 0 && !errB && <div style={{ color: C.muted, fontSize: '0.85rem' }}>No hay facturas cerradas en las últimas 2 horas. Cobrá la cuenta en el PoS y tocá «Actualizar».</div>}
          {facturas?.map(f => {
            const sel = v?.modo === 'factura' && v.numero_factura === f.numero_factura
            return (
              <button key={f.numero_factura} onClick={() => set(posDeFactura(f))} aria-pressed={sel} style={opcion(sel)}>
                <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{describirFactura(f)}</div>
              </button>
            )
          })}
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn variant="secondary" onClick={cargarB} style={{ flex: 1 }}>Actualizar</Btn>
            {!err && <Btn variant="ghost" onClick={() => { setPlanB(false); set(null); cargar() }} style={{ flex: 2 }}>Volver a los pedidos abiertos</Btn>}
          </div>
        </div>
      )}
    </div>
  )
}

function Confirmacion({ texto, enviando, onConfirmar, onVolver }: { texto: string; enviando: boolean; onConfirmar: () => void; onVolver: () => void }) {
  return (
    <div style={{ border: `2px solid ${C.ink}`, borderRadius: 10, padding: '0.9rem', background: C.paper }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{texto}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="secondary" onClick={onVolver} disabled={enviando} style={{ flex: 1 }}>Volver</Btn>
        <Btn onClick={onConfirmar} disabled={enviando} style={{ flex: 2 }}>{enviando ? 'Guardando…' : 'Confirmar'}</Btn>
      </div>
    </div>
  )
}

function ErrorAccion({ err, onReintentar }: { err: ClubError; onReintentar: () => void }) {
  return (
    <Aviso tono="error">
      {err.message}
      {err.esRed && <div style={{ marginTop: 8 }}><Btn variant="danger" onClick={onReintentar}>Reintentar</Btn></div>}
    </Aviso>
  )
}

interface PanelBase {
  personas: string; setPersonas: (s: string) => void; pos: PosRef | null; setPos: (p: PosRef | null) => void
  personasOk: boolean; facturaOk: boolean; confirmando: boolean; setConfirmando: (b: boolean) => void
  enviando: boolean; err: ClubError | null; onConfirmar: () => void; onCerrar: () => void
}

function PanelCupon({ a, ...p }: PanelBase & { a: Extract<Actual, { kind: 'cupon' }> }) {
  const d = a.r.datos
  const linea =
    d.referente_estado !== 'activo' ? MSG_REFERENTE_INACTIVO
    : d.estado === 'usado'   ? `Este cupón ya se usó (${fmtFechaHora(d.usado_en)}): no suma personas; seguí con la cuenta normal.`
    : d.estado === 'vencido' ? `Cupón vencido el ${fmtFechaHora(d.vence_en)}: no suma personas; seguí con la cuenta normal.`
    : d.estado === 'anulado' ? 'Cupón anulado: no suma personas; seguí con la cuenta normal.'
    : null
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cupón 10 %</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: '0.1em' }}>{d.codigo}</div>
        </div>
        <Btn variant="ghost" onClick={p.onCerrar} aria-label="Cerrar">✕</Btn>
      </div>
      <div style={{ margin: '0.5rem 0 1rem', color: C.muted }}>Referente: <strong style={{ color: C.ink }}>{d.referente}</strong>
        {!linea && <> · vence {fmtFechaHora(d.vence_en)}</>}</div>

      {linea ? (
        <>
          <Aviso tono="error">{linea}</Aviso>
          <Btn variant="secondary" onClick={p.onCerrar} style={{ marginTop: 10, width: '100%' }}>Escanear otro</Btn>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <CampoPersonas v={p.personas} set={s => { p.setPersonas(s); p.setConfirmando(false) }} />
          <SelectorPedido v={p.pos} set={x => { p.setPos(x); p.setConfirmando(false) }} />
          {p.err && <ErrorAccion err={p.err} onReintentar={p.onConfirmar} />}
          {p.confirmando ? (
            <Confirmacion texto={`+${p.personas} personas a ${d.referente} · ${p.pos ? describirPos(p.pos) : ''}`}
              enviando={p.enviando} onConfirmar={p.onConfirmar} onVolver={() => p.setConfirmando(false)} />
          ) : (
            <Btn big disabled={!p.personasOk || !p.facturaOk} onClick={() => p.setConfirmando(true)}>Continuar</Btn>
          )}
        </div>
      )}
    </Card>
  )
}

/** Cuenta regresiva del código de canje (vence a los 10 min). */
function CuentaRegresiva({ hasta }: { hasta: string }) {
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(id) }, [])
  const s = Math.max(0, Math.round((new Date(hasta).getTime() - ahora) / 1000))
  if (s === 0) return <Aviso tono="error">El código de canje venció: pedile que genere otro en su portal.</Aviso>
  return <span>vence en {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>
}

const MSG_CODIGO: Record<string, string> = {
  vencido: 'El código de canje venció: pedile que genere otro en su portal.',
  usado: 'Este código de canje ya se usó: pedile uno nuevo.',
  reemplazado: 'Este código fue reemplazado por uno más nuevo: escaneá el último que generó.',
}

function PanelReferente({ a, modo, setModo, creditos, setCreditos, gestiona, nota, setNota, ...p }: PanelBase & {
  a: Extract<Actual, { kind: 'referente' | 'canje' }>; modo: ModoRef; setModo: (m: ModoRef) => void
  creditos: number | null; setCreditos: (n: number | null) => void
  gestiona: boolean; nota: string; setNota: (s: string) => void
}) {
  const d = a.r.datos
  const conCodigo = a.kind === 'canje'
  const codigoMal = a.kind === 'canje' && a.r.datos.codigo_estado !== 'vigente' ? MSG_CODIGO[a.r.datos.codigo_estado] : null
  const canjea = conCodigo || modo === 'aprobado'
  const notaOk = nota.trim().length >= 5
  const opciones = opcionesCanje(d)
  const alcanza = (v: number) => d.personas >= v * d.personas_por_credito
  const dentroTope = (v: number) => Number(d.canjeado_hoy) + v <= Number(d.max_creditos_por_visita) + 1e-9
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {conCodigo ? 'Código de canje · ' : ''}{TIPO_MIEMBRO_LABEL[d.tipo_miembro] ?? 'Referente'}{d.negocio ? ` · ${d.negocio}` : ''}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{d.nombre}</div>
          {a.kind === 'canje' && !codigoMal && (
            <div style={{ fontSize: '0.85rem', color: C.muted }}>
              Código <strong style={{ color: C.ink, letterSpacing: '0.1em' }}>{a.r.datos.codigo_canje}</strong> · <CuentaRegresiva hasta={a.r.datos.codigo_vence_en} />
            </div>
          )}
        </div>
        <Btn variant="ghost" onClick={p.onCerrar} aria-label="Cerrar">✕</Btn>
      </div>

      {d.estado !== 'activo' || codigoMal ? (
        <div style={{ marginTop: 10 }}>
          <Aviso tono="error">{d.estado !== 'activo' ? MSG_REFERENTE_INACTIVO : codigoMal}</Aviso>
          <Btn variant="secondary" onClick={p.onCerrar} style={{ marginTop: 10, width: '100%' }}>Escanear otro</Btn>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, margin: '0.9rem 0' }}>
            <div style={{ flex: 1, background: C.paper, borderRadius: 8, padding: '0.7rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', fontWeight: 800 }}>{fmtCreditos(d.creditos)}</div>
              <div style={{ fontSize: '0.72rem', color: C.muted }}>créditos ({d.personas} personas)</div>
            </div>
            <div style={{ flex: 1, background: C.paper, borderRadius: 8, padding: '0.7rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', fontWeight: 800 }}>{d.personas_proximo}</div>
              <div style={{ fontSize: '0.72rem', color: C.muted }}>personas para el próximo medio crédito</div>
            </div>
          </div>
          {Number(d.canjeado_hoy) > 0 && (
            <div style={{ fontSize: '0.82rem', color: C.muted, marginBottom: 8 }}>
              Hoy ya canjeó {fmtCreditos(d.canjeado_hoy)} de {fmtCreditos(d.max_creditos_por_visita)}.
            </div>
          )}

          {!conCodigo && (
            <>
              <Aviso tono="info">
                Para canjear, pedile al referente su <strong>código de canje</strong>: lo genera en su portal con el botón
                «Canjear» y vale 10 minutos. Escanealo o escribí los 6 caracteres en «Código a mano».
              </Aviso>
              <div style={{ display: 'flex', gap: 6, margin: '12px 0' }}>
                {d.tarjeta_manual_activa && (
                  <Btn variant={modo === 'tarjeta' ? 'primary' : 'secondary'} onClick={() => setModo('tarjeta')} style={{ flex: 1 }}>Tarjeta física</Btn>
                )}
                {gestiona && (
                  <Btn variant={modo === 'aprobado' ? 'primary' : 'secondary'} onClick={() => setModo('aprobado')} style={{ flex: 1 }}>Canje sin celular</Btn>
                )}
              </div>
            </>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {canjea ? (
              <>
                {modo === 'aprobado' && !conCodigo && (
                  <label>
                    <span style={labelStyle}>Por qué se canjea sin código (obligatorio)</span>
                    <input value={nota} onChange={e => { setNota(e.target.value); p.setConfirmando(false) }} maxLength={300}
                      placeholder="Ej.: no tiene el celular; lo conozco" style={inputStyle} />
                  </label>
                )}
                <div>
                  <span style={labelStyle}>Créditos a canjear</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {opciones.map(v => {
                      const ok = alcanza(v) && dentroTope(v)
                      return (
                        <Btn key={v} big variant={creditos === v ? 'primary' : 'secondary'} disabled={!ok}
                          title={!alcanza(v) ? 'No alcanza el saldo' : !dentroTope(v) ? 'Supera el máximo del día' : ''}
                          onClick={() => { setCreditos(v); p.setConfirmando(false) }} style={{ flex: 1 }}>
                          {fmtCreditos(v)}
                        </Btn>
                      )
                    })}
                  </div>
                  {!opciones.some(v => alcanza(v) && dentroTope(v)) && (
                    <div style={{ fontSize: '0.85rem', color: C.muted, marginTop: 6 }}>
                      {opciones.some(alcanza) ? 'Ya llegó al máximo de créditos de hoy: el resto lo puede canjear mañana. Cobrá la cuenta sin canje.' : 'Todavía no le alcanza para canjear: cobrá la cuenta sin canje.'}
                    </div>
                  )}
                </div>
                <SelectorPedido v={p.pos} set={x => { p.setPos(x); p.setConfirmando(false) }} />
                {p.err && <ErrorAccion err={p.err} onReintentar={p.onConfirmar} />}
                {p.confirmando && creditos != null ? (
                  <Confirmacion texto={`${conCodigo ? 'Canjear' : 'Canje sin celular:'} ${fmtCreditos(creditos)} ${creditos === 1 ? 'crédito' : 'créditos'} a ${d.nombre} · ${p.pos ? describirPos(p.pos) : ''}`}
                    enviando={p.enviando} onConfirmar={p.onConfirmar} onVolver={() => p.setConfirmando(false)} />
                ) : (
                  <Btn big disabled={creditos == null || !p.facturaOk || (!conCodigo && !notaOk)} onClick={() => p.setConfirmando(true)}>Continuar</Btn>
                )}
              </>
            ) : d.tarjeta_manual_activa ? (
              <>
                <div style={{ fontSize: '0.85rem', color: C.muted }}>
                  Piloto en paralelo: la tarjeta impresa del comercio se carga acá además del proceso de siempre. Queda como
                  excepción «Tarjeta física» para que la revise otra persona.
                </div>
                <CampoPersonas v={p.personas} set={s => { p.setPersonas(s); p.setConfirmando(false) }} />
                <SelectorPedido v={p.pos} set={x => { p.setPos(x); p.setConfirmando(false) }} />
                {p.err && <ErrorAccion err={p.err} onReintentar={p.onConfirmar} />}
                {p.confirmando ? (
                  <Confirmacion texto={`Tarjeta física: +${p.personas} personas a ${d.nombre} · ${p.pos ? describirPos(p.pos) : ''}`}
                    enviando={p.enviando} onConfirmar={p.onConfirmar} onVolver={() => p.setConfirmando(false)} />
                ) : (
                  <Btn big disabled={!p.personasOk || !p.facturaOk} onClick={() => p.setConfirmando(true)}>Continuar</Btn>
                )}
              </>
            ) : null}
          </div>
        </>
      )}
    </Card>
  )
}

/**
 * LC-A1/A2: QR fijo del socio del Local Club. Solo identifica (10 % y cortesía); NUNCA da créditos.
 * Pendiente (autoalta) → «Validar socio» con «verifiqué residencia» → activo provisional (LC-DES-01).
 * «Qué aplicar» (10 % + cortesía, visita por factura con el 856) llega en la etapa A4.
 */
function PanelSocio({ d, onCerrar, onValidado }: {
  d: ResolverSocio['datos']; onCerrar: () => void; onValidado: (texto: string) => Promise<void>
}) {
  const [verifico, setVerifico] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const baja = d.persona_estado !== 'activo' || d.estado === 'baja'
  const pendiente = !baja && d.estado === 'pendiente'
  async function validar() {
    setEnviando(true); setErr(null)
    try {
      const r = await socioValidar(d.id, verifico)
      await onValidado(`${d.nombre} quedó activo provisional hasta el ${fmtFechaHora(r.provisional_hasta)}. Ya tiene el beneficio; un manager confirma el alta.`)
    } catch (e) { setErr(aClubError(e).message) }
    finally { setEnviando(false) }
  }
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Socio del Local Club{d.es_anfitrion ? ' · también anfitrión' : ''}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{d.nombre}</div>
          <div style={{ fontSize: '0.85rem', color: C.muted }}>Socio desde {fmtFechaHora(d.desde)}</div>
        </div>
        <Btn variant="ghost" onClick={onCerrar} aria-label="Cerrar">✕</Btn>
      </div>
      {baja && <div style={{ marginTop: 10 }}><Aviso tono="error">Socio dado de baja: seguí con la cuenta normal, sin beneficio.</Aviso></div>}
      {pendiente && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Aviso tono="error">Socio pendiente: todavía no tiene beneficio. Validalo si confirmás que es local.</Aviso>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" checked={verifico} onChange={e => setVerifico(e.target.checked)} />
            <span>Verifiqué que es local (no anotes ningún número de documento)</span>
          </label>
          {err && <Aviso tono="error">{err}</Aviso>}
          <Btn onClick={validar} disabled={!verifico || enviando}>{enviando ? 'Validando…' : 'Validar socio'}</Btn>
        </div>
      )}
      {!baja && !pendiente && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {d.provisional_hasta && (
            <Aviso tono="info">Alta provisional hasta el {fmtFechaHora(d.provisional_hasta)}: tiene el beneficio; falta que la confirme un manager.</Aviso>
          )}
          <Aviso tono="info">
            Este QR identifica al socio (10 % y cortesía). No sirve para créditos: para canjear, el anfitrión muestra el código
            de «Canjear».
          </Aviso>
        </div>
      )}
      <Btn variant="secondary" onClick={onCerrar} style={{ marginTop: 10, width: '100%' }}>Escanear otro</Btn>
    </Card>
  )
}

/** LC-A2: alta de socio en caja. Nombre y WhatsApp obligatorios; «verifiqué residencia»; NUNCA un número de documento. */
function NuevoSocio({ onHecho }: { onHecho: (texto: string) => void }) {
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [tel, setTel] = useState('')
  const [email, setEmail] = useState('')
  const [verifico, setVerifico] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!abierto) {
    return <Btn variant="secondary" onClick={() => setAbierto(true)}>＋ Nuevo socio del Local Club</Btn>
  }
  async function guardar() {
    setEnviando(true); setErr(null)
    try {
      const r = await socioAltaCaja(nombre.trim(), tel.trim(), email.trim() || null, verifico)
      onHecho(`${nombre.trim()} es socio (activo provisional hasta el ${fmtFechaHora(r.provisional_hasta)}). Ya tiene el beneficio hoy; un manager confirma el alta.`)
      setAbierto(false); setNombre(''); setTel(''); setEmail(''); setVerifico(false)
    } catch (e) { setErr(aClubError(e).message) }
    finally { setEnviando(false) }
  }
  return (
    <Card>
      <form onSubmit={e => { e.preventDefault(); guardar() }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <strong>Nuevo socio del Local Club</strong>
        <label><span style={labelStyle}>Nombre y apellido</span>
          <input value={nombre} onChange={e => setNombre(e.target.value)} autoComplete="off" style={inputStyle} /></label>
        <label><span style={labelStyle}>WhatsApp</span>
          <input value={tel} onChange={e => setTel(e.target.value)} inputMode="tel" autoComplete="off" placeholder="8 dígitos o con código de país" style={inputStyle} /></label>
        <label><span style={labelStyle}>Email (opcional)</span>
          <input value={email} onChange={e => setEmail(e.target.value)} inputMode="email" autoComplete="off" style={inputStyle} /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
          <input type="checkbox" checked={verifico} onChange={e => setVerifico(e.target.checked)} />
          <span>Verifiqué que es local (no anotes ningún número de documento)</span>
        </label>
        {err && <Aviso tono="error">{err}</Aviso>}
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn type="submit" disabled={enviando || nombre.trim().length < 2 || !tel.trim() || !verifico}>{enviando ? 'Guardando…' : 'Dar de alta'}</Btn>
          <Btn type="button" variant="ghost" onClick={() => { setAbierto(false); setErr(null) }}>Cancelar</Btn>
        </div>
      </form>
    </Card>
  )
}
