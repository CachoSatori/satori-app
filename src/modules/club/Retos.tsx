/**
 * Retos de temporada baja (mig 169, ítem #16 del Club v2) — en Club → Promociones.
 *  · El owner arma un reto («3 almuerzos este mes»): nombre ES/EN, local (mig 187: UNO por reto; para otro local, otro
 *    reto), fechas (un mismo año, hasta 92 días), días y franja horaria (igual que las promociones, hora de Costa Rica),
 *    meta de visitas, premio = una cortesía de «CORTESÍA CLUB» del local, días que vale el premio y «Reservar 15 % sin
 *    reto» (grupo de control). El manager ve solo los retos de sus locales; el owner, todos.
 *  · Borrador → Armado (vigente) → Terminado. Un borrador no cuenta para nada. Armado ya no se edita: solo se termina.
 *  · La base rechaza un 4.º reto armado en el año y dos retos que se pisen en fechas en un mismo local.
 *  · Solo socios activos del Local Club (el equipo nunca). El manager ve la lista; solo el owner edita.
 */
import { useEffect, useState } from 'react'
import {
  getRetos, guardarReto, armarReto, terminarReto, borrarReto, getCortesiasDe, getLocalesClub, setRetosExigeFactura, aClubError,
  type Reto, type RetoDatos, type LocalClub, type Cortesia, type RetosLista,
} from '../../shared/api/club'
import { Aviso, Btn, Card, Chip } from './ui'
import { C, inputStyle, labelStyle, fmtFecha } from './estilos'
import { todayCR } from '../../shared/utils'
import { DIAS, problemaReto, resumenFranja } from './retosReglas'

export default function Retos({ owner }: { owner: boolean }) {
  const [datos, setDatos] = useState<RetosLista | null>(null)
  const lista = datos?.retos ?? null
  const [locales, setLocales] = useState<LocalClub[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [editando, setEditando] = useState<Reto | 'nuevo' | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [enviando, setEnviando] = useState(false)
  useEffect(() => {
    let vivo = true
    getRetos().then(l => { if (vivo) setDatos(l) }).catch(e => { if (vivo) setError(aClubError(e).message) })
    getLocalesClub().then(l => { if (vivo) setLocales(l) }).catch(() => { /* sin nombres: se muestran los ids */ })
    return () => { vivo = false }
  }, [recarga])
  const nombreLocal = (id: string) => locales.find(l => l.id === id)?.nombre ?? id
  const anio = todayCR().slice(0, 4)
  // mig 187: el tope de 3 armados por año es POR LOCAL (un reto es de un solo local)
  const armadosPorLocal = new Map<string, number>()
  for (const r of lista ?? []) {
    if (!r.armado || !r.desde.startsWith(anio)) continue
    for (const l of r.locales) armadosPorLocal.set(l, (armadosPorLocal.get(l) ?? 0) + 1)
  }
  const armadosTexto = [...armadosPorLocal].map(([l, n]) => `${nombreLocal(l)} ${n}`).sort().join(' · ') || 'ninguno'

  async function accion(r: Reto, que: 'armar' | 'terminar' | 'borrar') {
    const msg = que === 'armar'
      ? `¿Armar «${r.nombre}»? Desde el ${fmtFecha(r.desde)} los socios lo ven y pueden ganar el premio. Armado ya no se edita, y cuenta para el máximo de 3 por año de su local.`
      : que === 'terminar' ? `¿Terminar «${r.nombre}»? Nadie más lo gana; los premios ya ganados se respetan. Sigue contando para el máximo del año de su local, pero ya no bloquea su local.` : `¿Borrar el borrador «${r.nombre}»?`
    if (!window.confirm(msg)) return
    setEnviando(true); setError(null); setOk(null)
    try {
      setDatos(await (que === 'armar' ? armarReto(r.id) : que === 'terminar' ? terminarReto(r.id) : borrarReto(r.id)))
      setOk(que === 'armar' ? `«${r.nombre}» armado.` : que === 'terminar' ? `«${r.nombre}» terminado.` : 'Borrador borrado.')
    } catch (e) { setError(aClubError(e).message) }
    finally { setEnviando(false) }
  }
  async function alternarExige() {
    if (!datos) return
    const v = !datos.exige_factura
    if (!window.confirm(v ? '¿Exigir factura? Los días anteriores cuentan solo si la visita cruza con una factura cerrada con el 856/857.'
                          : '¿Dejar de exigir factura? Cuenta cualquier visita registrada en caja, aunque el pedido no se haya cobrado.')) return
    setEnviando(true); setError(null); setOk(null)
    try { await setRetosExigeFactura(v); setOk(v ? 'Ahora se exige factura.' : 'Ya no se exige factura.'); setRecarga(n => n + 1) }
    catch (e) { setError(aClubError(e).message) }
    finally { setEnviando(false) }
  }

  if (editando) {
    return <FormReto inicial={editando === 'nuevo' ? null : editando} locales={locales} onCancelar={() => setEditando(null)}
      onGuardado={t => { setEditando(null); setOk(t); setRecarga(n => n + 1) }} />
  }
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <strong>Retos de temporada baja</strong>
        {owner && <Btn onClick={() => setEditando('nuevo')}>+ Nuevo reto</Btn>}
      </div>
      <div style={{ fontSize: '0.82rem', color: C.muted, marginBottom: 8 }}>
        Ej. «3 almuerzos este mes»: el socio ve su avance en «Mi Club» y, al cumplir, gana una cortesía que la caja ofrece una sola vez.
        Solo socios del Local Club (el equipo no). Máximo 3 retos armados por año en cada local (armados en {anio}: {armadosTexto}). Cuenta una visita por
        jornada (una noche que pasa la medianoche es una sola) y una sola cortesía de premio por factura.
      </div>
      {datos && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.82rem', marginBottom: 8 }}>
          <span>
            {datos.exige_factura
              ? 'Exige factura: los días anteriores cuentan solo si la visita cruza con una factura cerrada con el 856/857. No se arma un reto en un local sin facturas del PoS en la app.'
              : 'No exige factura: cuenta cualquier visita registrada en caja.'}
          </span>
          {owner && <Btn variant="secondary" onClick={alternarExige} disabled={enviando}>{datos.exige_factura ? 'Dejar de exigir' : 'Exigir factura'}</Btn>}
        </div>
      )}
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      {ok && <Aviso tono="ok" onClose={() => setOk(null)}>{ok}</Aviso>}
      {lista === null ? <div style={{ color: C.muted }}>Cargando…</div> : lista.length === 0 ? (
        <div style={{ color: C.muted }}>Sin retos. Nada se activa hasta que el owner arme uno.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {lista.map(r => {
            const faltan = r.locales.filter(l => !r.cortesias[l] || !r.cortesias[l].activa)
            return (
              <div key={r.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '0.6rem 0.7rem', background: '#fff' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{r.nombre}</strong>
                  <Chip color={r.estado === 'vigente' ? C.teal : r.estado === 'borrador' ? C.gold : C.muted}>
                    {r.estado === 'vigente' ? 'armado' : r.estado}
                  </Chip>
                  {r.en_curso && <Chip color={C.teal}>en curso</Chip>}
                  {r.control_pct > 0 && <Chip color={C.muted}>15 % sin reto</Chip>}
                  <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{r.meta} visitas</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: C.muted, marginTop: 2 }}>
                  {fmtFecha(r.desde)} a {fmtFecha(r.hasta)} · {resumenFranja(r)} · {r.locales.map(nombreLocal).join(', ')}
                </div>
                <div style={{ fontSize: '0.8rem', marginTop: 2 }}>
                  Premio: {r.locales.map(l => `${nombreLocal(l)}: ${r.cortesias[l] ? r.cortesias[l].nombre + (r.cortesias[l].activa ? '' : ' (inactiva)') : '—'}`).join(' · ')}
                  {' '}· vale {r.vence_dias} días
                </div>
                {r.armado && (
                  <div style={{ fontSize: '0.8rem', color: C.muted, marginTop: 2 }}>
                    Ganados {r.ganados} · usados {r.usados} · por usar {r.disponibles}
                  </div>
                )}
                {r.estado === 'vigente' && faltan.length > 0 && (
                  <Aviso tono="error">Sin cortesía activa en {faltan.map(nombreLocal).join(', ')}: ahí la caja NO ofrece el premio (queda guardado).</Aviso>
                )}
                {owner && r.estado !== 'terminada' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {r.estado === 'borrador' && <Btn variant="secondary" onClick={() => setEditando(r)} disabled={enviando}>Editar</Btn>}
                    {r.estado === 'borrador' && <Btn onClick={() => accion(r, 'armar')} disabled={enviando}>Armar</Btn>}
                    {r.estado === 'borrador' && <Btn variant="ghost" onClick={() => accion(r, 'borrar')} disabled={enviando}>Borrar</Btn>}
                    {r.estado === 'vigente' && <Btn variant="danger" onClick={() => accion(r, 'terminar')} disabled={enviando}>Terminar</Btn>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function FormReto({ inicial, locales, onCancelar, onGuardado }: {
  inicial: Reto | null; locales: LocalClub[]; onCancelar: () => void; onGuardado: (texto: string) => void
}) {
  const [d, setD] = useState<RetoDatos>(() => ({
    nombre: inicial?.nombre ?? '', nombre_en: inicial?.nombre_en ?? '', locales: inicial?.locales ?? [],
    desde: inicial?.desde ?? '', hasta: inicial?.hasta ?? '', dias: inicial?.dias ?? [1, 2, 3, 4, 5],
    hora_desde: inicial?.hora_desde ?? '', hora_hasta: inicial?.hora_hasta ?? '', meta: inicial?.meta ?? 3,
    vence_dias: inicial?.vence_dias ?? 30, control_pct: inicial?.control_pct ?? 0,
    cortesias: Object.fromEntries(Object.entries(inicial?.cortesias ?? {}).map(([l, k]) => [l, k.id])),
  }))
  const [cortDe, setCortDe] = useState<Record<string, Cortesia[]>>({})
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alterna = <T,>(lista: T[], v: T) => (lista.includes(v) ? lista.filter(x => x !== v) : [...lista, v])
  useEffect(() => {
    let vivo = true
    for (const l of d.locales) {
      if (cortDe[l]) continue
      getCortesiasDe(l).then(c => { if (vivo) setCortDe(m => ({ ...m, [l]: c })) }).catch(() => { if (vivo) setCortDe(m => ({ ...m, [l]: [] })) })
    }
    return () => { vivo = false }
  }, [d.locales, cortDe])

  async function guardar() {
    const p = problemaReto(d, todayCR())
    if (p) { setError(p); return }
    setEnviando(true); setError(null)
    const cortesias = Object.fromEntries(Object.entries(d.cortesias).filter(([l, k]) => d.locales.includes(l) && k))
    try {
      await guardarReto(inicial?.id ?? null, { ...d, nombre: d.nombre.trim(), nombre_en: d.nombre_en.trim(), cortesias,
        hora_desde: d.hora_desde || null, hora_hasta: d.hora_hasta || null })
      onGuardado(`Reto «${d.nombre.trim()}» guardado como borrador. Para que cuente, tocá «Armar».`)
    } catch (e) { setError(aClubError(e).message) }
    finally { setEnviando(false) }
  }
  return (
    <Card>
      <form onSubmit={e => { e.preventDefault(); guardar() }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <strong>{inicial ? 'Editar reto (borrador)' : 'Nuevo reto'}</strong>
        <label><span style={labelStyle}>Nombre (lo ve el socio)</span>
          <input value={d.nombre} onChange={e => setD({ ...d, nombre: e.target.value })} maxLength={80} placeholder="3 almuerzos este mes" style={inputStyle} /></label>
        <label><span style={labelStyle}>Nombre en inglés</span>
          <input value={d.nombre_en} onChange={e => setD({ ...d, nombre_en: e.target.value })} maxLength={80} placeholder="3 lunches this month" style={inputStyle} /></label>
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={labelStyle}>Local (uno por reto; para otro local, armá otro reto)</legend>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {locales.map(l => (
              <Btn key={l.id} variant={d.locales.includes(l.id) ? 'primary' : 'secondary'}
                onClick={() => setD({ ...d, locales: [l.id] })}>{l.nombre}</Btn>
            ))}
          </div>
        </fieldset>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <label><span style={labelStyle}>Desde</span>
            <input type="date" value={d.desde} onChange={e => setD({ ...d, desde: e.target.value })} style={inputStyle} /></label>
          <label><span style={labelStyle}>Hasta</span>
            <input type="date" value={d.hasta} onChange={e => setD({ ...d, hasta: e.target.value })} style={inputStyle} /></label>
          <label><span style={labelStyle}>Hora desde (opcional)</span>
            <input type="time" value={d.hora_desde ?? ''} onChange={e => setD({ ...d, hora_desde: e.target.value })} style={inputStyle} /></label>
          <label><span style={labelStyle}>Hora hasta</span>
            <input type="time" value={d.hora_hasta ?? ''} onChange={e => setD({ ...d, hora_hasta: e.target.value })} style={inputStyle} /></label>
          <label><span style={labelStyle}>Meta (visitas)</span>
            <select value={d.meta} onChange={e => setD({ ...d, meta: Number(e.target.value) })} style={inputStyle}>
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}
            </select></label>
          <label><span style={labelStyle}>El premio vale (días)</span>
            <input value={String(d.vence_dias)} onChange={e => setD({ ...d, vence_dias: Number(e.target.value.replace(/\D/g, '')) || 0 })}
              inputMode="numeric" style={inputStyle} /></label>
        </div>
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={labelStyle}>Días que cuentan</legend>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {DIAS.map(([n, t]) => (
              <Btn key={n} variant={d.dias.includes(n) ? 'primary' : 'secondary'} onClick={() => setD({ ...d, dias: alterna(d.dias, n).sort() })}>{t}</Btn>
            ))}
          </div>
        </fieldset>
        <div style={{ fontSize: '0.8rem', color: C.muted }}>
          Cuenta una visita por día, registrada en caja dentro de la franja (hora de Costa Rica), en el local del reto.
        </div>
        {d.locales.map(l => (
          <label key={l}><span style={labelStyle}>Premio en {locales.find(x => x.id === l)?.nombre ?? l} (cortesía de «CORTESÍA CLUB»)</span>
            <select value={d.cortesias[l] ?? ''} onChange={e => setD({ ...d, cortesias: { ...d.cortesias, [l]: e.target.value } })} style={inputStyle}>
              <option value="">— Elegir —</option>
              {(cortDe[l] ?? []).filter(k => k.activa).map(k => <option key={k.id} value={k.id}>{k.nombre} · {k.codigo_producto}</option>)}
            </select></label>
        ))}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.88rem' }}>
          <input type="checkbox" checked={d.control_pct === 15} onChange={e => setD({ ...d, control_pct: e.target.checked ? 15 : 0 })} />
          Reservar 15 % sin reto (grupo de control: esos socios no lo ven; su beneficio de siempre no cambia)
        </label>
        {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn type="submit" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar borrador'}</Btn>
          <Btn variant="ghost" onClick={onCancelar}>Cancelar</Btn>
        </div>
      </form>
    </Card>
  )
}
