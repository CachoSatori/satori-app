/**
 * Escanear — un solo botón en caja (SPEC §2.4).
 *  · Cupón vigente → personas + factura → confirmar → «+N personas a {referente}».
 *  · Pase de referente → saldo + canje (1 / 1,5 / 2) o «Tarjeta física».
 *  · Usado, vencido, dado de baja o desconocido → una línea clara.
 *  Plan B: código a mano y búsqueda (nombre, negocio o últimos 4 del teléfono).
 * Idempotencia: un `p_op` por intento; si falla la red, el reintento usa el mismo.
 */
import { lazy, Suspense, useRef, useState } from 'react'
import {
  resolverQR, usarCupon, canjear, tarjetaManual, buscar, getMiembro, aClubError, nuevoOp,
  opcionesCanje, fmtCreditos, MSG_REFERENTE_INACTIVO,
  type ResolverCupon, type ResolverReferente, type BusquedaFila, type ClubError,
} from '../../shared/api/club'
import { parsearQR } from './qrFormato'
import { Aviso, Btn, Card, Chip } from './ui'
import { C, inputStyle, labelStyle, fmtFechaHora, TIPO_MIEMBRO_LABEL } from './estilos'

const LectorQR = lazy(() => import('./LectorQR'))

type Actual =
  | { kind: 'cupon'; r: ResolverCupon; codigo: string }
  | { kind: 'referente'; r: ResolverReferente; codigo: string }
type Accion = 'usar' | 'canje' | 'tarjeta'
type Mensaje = { tono: 'ok' | 'error' | 'info'; texto: string }

export default function Escanear() {
  const [camara, setCamara]       = useState(false)
  const [manual, setManual]       = useState('')
  const [q, setQ]                 = useState('')
  const [resultados, setResultados] = useState<BusquedaFila[] | null>(null)
  const [cargando, setCargando]   = useState(false)
  const [actual, setActual]       = useState<Actual | null>(null)
  const [msg, setMsg]             = useState<Mensaje | null>(null)

  // formularios
  const [personas, setPersonas]   = useState('')
  const [factura, setFactura]     = useState('')
  const [creditos, setCreditos]   = useState<number | null>(null)
  const [modoRef, setModoRef]     = useState<'canje' | 'tarjeta'>('canje')
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando]   = useState(false)
  const [errAccion, setErrAccion] = useState<ClubError | null>(null)

  // un p_op por intento y por acción; se descarta al terminar bien o al cambiar de cuenta
  const ops = useRef<Partial<Record<Accion, string>>>({})
  const opDe = (a: Accion) => (ops.current[a] ??= nuevoOp())

  function limpiarFormularios() {
    setPersonas(''); setFactura(''); setCreditos(null); setConfirmando(false); setErrAccion(null); setModoRef('canje')
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
      } else {
        setActual(null); setMsg({ tono: 'error', texto: 'Código no reconocido: no es un cupón ni un pase vigente.' })
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
      const m = await getMiembro(f.id)
      if (!m) throw new Error('No se encontró la cuenta')
      await resolver(m.codigo)
    } catch (e) {
      setMsg({ tono: 'error', texto: aClubError(e).message }); setCargando(false)
    }
  }

  function cerrarCuenta() { setActual(null); ops.current = {}; limpiarFormularios() }

  async function confirmar() {
    if (!actual) return
    setEnviando(true); setErrAccion(null)
    try {
      if (actual.kind === 'cupon') {
        const n = Number(personas)
        await usarCupon(actual.codigo, n, factura, opDe('usar'))
        setMsg({ tono: 'ok', texto: `+${n} ${n === 1 ? 'persona' : 'personas'} a ${actual.r.datos.referente}` })
        cerrarCuenta()
      } else if (modoRef === 'canje' && creditos != null) {
        const s = await canjear(actual.r.datos.id, creditos, factura, opDe('canje'))
        setMsg({ tono: 'ok', texto: `Canje de ${fmtCreditos(creditos)} ${creditos === 1 ? 'crédito' : 'créditos'} a ${actual.r.datos.nombre}. Le quedan ${fmtCreditos(s.creditos)}.` })
        delete ops.current.canje; limpiarFormularios()
        await resolver(actual.codigo, true)
      } else if (modoRef === 'tarjeta') {
        const n = Number(personas)
        await tarjetaManual(actual.r.datos.id, n, factura, opDe('tarjeta'))
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
  const facturaOk = factura.replace(/\s/g, '').length > 0

  return (
    <div className="tips-body" style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {msg && <Aviso tono={msg.tono} onClose={() => setMsg(null)}>{msg.texto}</Aviso>}

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
            <form onSubmit={e => { e.preventDefault(); if (manual.trim()) resolver(manual) }}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <label style={{ flex: 1 }}>
                <span style={labelStyle}>Código a mano</span>
                <input value={manual} onChange={e => setManual(e.target.value)} placeholder="Cupón (10) o pase (8)"
                  autoCapitalize="characters" autoComplete="off" style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '0.12em' }} />
              </label>
              <Btn type="submit" disabled={cargando || !manual.trim()}>Ver</Btn>
            </form>
          </Card>

          <Card>
            <form onSubmit={e => { e.preventDefault(); onBuscar() }} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <label style={{ flex: 1 }}>
                <span style={labelStyle}>Buscar referente (plan B)</span>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Nombre, negocio o últimos 4 del tel."
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
          {cargando && <div style={{ textAlign: 'center', color: C.muted }}>Buscando…</div>}
        </>
      )}

      {actual?.kind === 'cupon' && (
        <PanelCupon a={actual} personas={personas} setPersonas={setPersonas} factura={factura} setFactura={setFactura}
          personasOk={personasOk} facturaOk={facturaOk} confirmando={confirmando} setConfirmando={setConfirmando}
          enviando={enviando} err={errAccion} onConfirmar={confirmar} onCerrar={cerrarCuenta} />
      )}

      {actual?.kind === 'referente' && (
        <PanelReferente a={actual} modo={modoRef} setModo={m => { setModoRef(m); setConfirmando(false); setErrAccion(null) }}
          creditos={creditos} setCreditos={setCreditos} personas={personas} setPersonas={setPersonas}
          factura={factura} setFactura={setFactura} personasOk={personasOk} facturaOk={facturaOk}
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

function CampoFactura({ v, set }: { v: string; set: (s: string) => void }) {
  return (
    <label>
      <span style={labelStyle}>Número de factura del PoS</span>
      <input value={v} onChange={e => set(e.target.value)} placeholder="Ej. FE-12345" autoCapitalize="characters"
        autoComplete="off" style={{ ...inputStyle, textTransform: 'uppercase' }} />
    </label>
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
  personas: string; setPersonas: (s: string) => void; factura: string; setFactura: (s: string) => void
  personasOk: boolean; facturaOk: boolean; confirmando: boolean; setConfirmando: (b: boolean) => void
  enviando: boolean; err: ClubError | null; onConfirmar: () => void; onCerrar: () => void
}

function PanelCupon({ a, ...p }: PanelBase & { a: Extract<Actual, { kind: 'cupon' }> }) {
  const d = a.r.datos
  const linea =
    d.referente_estado !== 'activo' ? MSG_REFERENTE_INACTIVO
    : d.estado === 'usado'   ? `Este cupón ya se usó (${fmtFechaHora(d.usado_en)}).`
    : d.estado === 'vencido' ? `Cupón vencido el ${fmtFechaHora(d.vence_en)}.`
    : d.estado === 'anulado' ? 'Cupón anulado.'
    : null
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cupón 10 %</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: '0.1em' }}>{d.codigo}</div>
        </div>
        <Btn variant="ghost" onClick={p.onCerrar}>✕</Btn>
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
          <CampoFactura v={p.factura} set={s => { p.setFactura(s); p.setConfirmando(false) }} />
          {p.err && <ErrorAccion err={p.err} onReintentar={p.onConfirmar} />}
          {p.confirmando ? (
            <Confirmacion texto={`+${p.personas} personas a ${d.referente} · factura ${p.factura.replace(/\s/g, '').toUpperCase()}`}
              enviando={p.enviando} onConfirmar={p.onConfirmar} onVolver={() => p.setConfirmando(false)} />
          ) : (
            <Btn big disabled={!p.personasOk || !p.facturaOk} onClick={() => p.setConfirmando(true)}>Continuar</Btn>
          )}
        </div>
      )}
    </Card>
  )
}

function PanelReferente({ a, modo, setModo, creditos, setCreditos, ...p }: PanelBase & {
  a: Extract<Actual, { kind: 'referente' }>; modo: 'canje' | 'tarjeta'; setModo: (m: 'canje' | 'tarjeta') => void
  creditos: number | null; setCreditos: (n: number | null) => void
}) {
  const d = a.r.datos
  const opciones = opcionesCanje(d)
  const alcanza = (v: number) => d.personas >= v * d.personas_por_credito
  const dentroTope = (v: number) => Number(d.canjeado_hoy) + v <= Number(d.max_creditos_por_visita) + 1e-9
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {TIPO_MIEMBRO_LABEL[d.tipo_miembro] ?? 'Referente'}{d.negocio ? ` · ${d.negocio}` : ''}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{d.nombre}</div>
        </div>
        <Btn variant="ghost" onClick={p.onCerrar}>✕</Btn>
      </div>

      {d.estado !== 'activo' ? (
        <div style={{ marginTop: 10 }}>
          <Aviso tono="error">{MSG_REFERENTE_INACTIVO}</Aviso>
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

          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <Btn variant={modo === 'canje' ? 'primary' : 'secondary'} onClick={() => setModo('canje')} style={{ flex: 1 }}>Canjear</Btn>
            <Btn variant={modo === 'tarjeta' ? 'primary' : 'secondary'} onClick={() => setModo('tarjeta')} style={{ flex: 1 }}>Tarjeta física</Btn>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {modo === 'canje' ? (
              <>
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
                      {opciones.some(alcanza) ? 'Ya llegó al máximo de créditos de hoy.' : 'Todavía no le alcanza para canjear.'}
                    </div>
                  )}
                </div>
                <CampoFactura v={p.factura} set={s => { p.setFactura(s); p.setConfirmando(false) }} />
                {p.err && <ErrorAccion err={p.err} onReintentar={p.onConfirmar} />}
                {p.confirmando && creditos != null ? (
                  <Confirmacion texto={`Canjear ${fmtCreditos(creditos)} ${creditos === 1 ? 'crédito' : 'créditos'} a ${d.nombre} · factura ${p.factura.replace(/\s/g, '').toUpperCase()}`}
                    enviando={p.enviando} onConfirmar={p.onConfirmar} onVolver={() => p.setConfirmando(false)} />
                ) : (
                  <Btn big disabled={creditos == null || !p.facturaOk} onClick={() => p.setConfirmando(true)}>Continuar</Btn>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: '0.85rem', color: C.muted }}>Para tarjetas impresas que ya están repartidas. Queda marcada «manual».</div>
                <CampoPersonas v={p.personas} set={s => { p.setPersonas(s); p.setConfirmando(false) }} />
                <CampoFactura v={p.factura} set={s => { p.setFactura(s); p.setConfirmando(false) }} />
                {p.err && <ErrorAccion err={p.err} onReintentar={p.onConfirmar} />}
                {p.confirmando ? (
                  <Confirmacion texto={`Tarjeta física: +${p.personas} personas a ${d.nombre} · factura ${p.factura.replace(/\s/g, '').toUpperCase()}`}
                    enviando={p.enviando} onConfirmar={p.onConfirmar} onVolver={() => p.setConfirmando(false)} />
                ) : (
                  <Btn big disabled={!p.personasOk || !p.facturaOk} onClick={() => p.setConfirmando(true)}>Continuar</Btn>
                )}
              </>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
