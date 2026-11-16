/**
 * Mig 173 (D-cumple-2, firmada por el dueño el 15-nov) · Club → Promociones → «Beneficio de cumpleaños».
 * Por local: encendido, texto del beneficio (por defecto «postre de cortesía»; sirve para ofrecer otra cosa cambiando el
 * texto), mínimo de personas, días antes y después del cumpleaños, uno por mesa, solo con reserva y el artículo de
 * «CORTESÍA CLUB» que marca la caja (₡0; el tablero lo cuenta a costo). Mig 180: el link de reservas (OpenTable) es del
 * LOCAL y se edita en Club → Locales; acá solo se muestra (la base ignora el que venga en el formulario).
 * Lo editan el owner y el manager de SU local (la base corta al manager en otro local). Cada cambio queda en la auditoría.
 * Lo que se guarda acá es lo que dice el WhatsApp del Inicio y lo que ve el cajero en Escanear.
 */
import { useEffect, useState } from 'react'
import {
  getCumpleConfig, guardarCumpleConfig, getCortesias, aClubError, getUsosCumple, deshacerUsoCumple, getResumenCumple,
  type CumpleConfig as Cfg, type CumpleConfigDatos, type Cortesia, type UsoCumple, type ResumenCumple as Resumen,
} from '../../shared/api/club'
import { Aviso, Btn, Card, Chip } from './ui'
import { C, inputStyle, labelStyle, mesActualCR, fmtFechaHora } from './estilos'
import { condicionesCumple, rangoMes, resumenCumpleTexto } from './cumple'

const aDatos = (c: Cfg): CumpleConfigDatos => ({
  activo: c.activo, beneficio: c.beneficio, min_personas: c.min_personas, dias_antes: c.dias_antes, dias_despues: c.dias_despues,
  uno_por_mesa: c.uno_por_mesa, solo_reserva: c.solo_reserva, reserva_url: c.reserva_url, cortesia_id: c.cortesia?.id ?? null,
})

export function ConfigCumple({ edita }: { edita: boolean }) {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [d, setD] = useState<CumpleConfigDatos | null>(null)
  const [cortesias, setCortesias] = useState<Cortesia[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  useEffect(() => {
    let vivo = true
    Promise.all([getCumpleConfig(), getCortesias()])
      .then(([c, l]) => { if (vivo) { setCfg(c); setD(aDatos(c)); setCortesias(l) } })
      .catch(e => { if (vivo) setError(aClubError(e).message) })
    return () => { vivo = false }
  }, [])
  async function guardar(cambio: Partial<CumpleConfigDatos> = {}) {
    if (!d) return
    setEnviando(true); setError(null); setOk(null)
    try {
      const c = await guardarCumpleConfig({ ...d, ...cambio, beneficio: d.beneficio.trim() })   // 180: reserva_url va como vino (la base lo ignora)
      setCfg(c); setD(aDatos(c))
      setOk(cambio.activo === true ? 'Encendido: el Inicio avisa los cumpleaños y la caja ofrece el beneficio en la ventana.'
        : cambio.activo === false ? 'Apagado: el Inicio no avisa y la caja no lo ofrece.' : 'Guardado.')
    } catch (e) { setError(aClubError(e).message) }
    finally { setEnviando(false) }
  }
  const num = (k: 'min_personas' | 'dias_antes' | 'dias_despues', v: string) => d && setD({ ...d, [k]: Math.max(0, Math.floor(Number(v) || 0)) })
  const activas = cortesias.filter(c => c.activa)
  return (
    <Card>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <strong style={{ flex: 1 }}>Beneficio de cumpleaños</strong>
        {cfg && <Chip color={cfg.activo ? C.teal : C.muted}>{cfg.activo ? 'encendido' : 'apagado'}</Chip>}
      </div>
      <div style={{ fontSize: '0.82rem', color: C.muted, margin: '4px 0 8px' }}>
        Para los socios que dieron su cumpleaños con permiso. El Inicio avisa los cumpleaños de los próximos días con un botón de
        WhatsApp (una vez por socio y por año) y la caja lo ofrece en la ventana de días. Cambiando el texto sirve para ofrecer otra cosa.
      </div>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      {ok && <Aviso tono="ok" onClose={() => setOk(null)}>{ok}</Aviso>}
      {cfg === null || d === null ? (!error && <div style={{ color: C.muted }}>Cargando…</div>) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cfg.activo && !cfg.lista_para_caja && (
            <Aviso tono="error">El artículo de cortesía está apagado o no es de este local: la caja no lo ofrece. Elegí uno activo.</Aviso>
          )}
          <div style={{ fontSize: '0.85rem' }}>
            Hoy: <strong>{cfg.beneficio}</strong>{condicionesCumple(cfg) ? ` ${condicionesCumple(cfg)}` : ''} · del día {cfg.dias_antes} antes al {cfg.dias_despues} después
            {' · '}Artículo: <strong>{cfg.cortesia ? `${cfg.cortesia.nombre} · ${cfg.cortesia.codigo}` : 'ninguno'}</strong>
          </div>
          {edita && (
            <>
              <label><span style={labelStyle}>Beneficio (lo lee el socio en el WhatsApp)</span>
                <input value={d.beneficio} onChange={e => setD({ ...d, beneficio: e.target.value })} maxLength={120} style={inputStyle} aria-label="Beneficio" /></label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label style={{ flex: 1, minWidth: 110 }}><span style={labelStyle}>Mínimo de personas</span>
                  <input type="number" min={1} max={50} value={d.min_personas} onChange={e => num('min_personas', e.target.value)} style={inputStyle} aria-label="Mínimo de personas" /></label>
                <label style={{ flex: 1, minWidth: 110 }}><span style={labelStyle}>Días antes</span>
                  <input type="number" min={0} max={30} value={d.dias_antes} onChange={e => num('dias_antes', e.target.value)} style={inputStyle} aria-label="Días antes" /></label>
                <label style={{ flex: 1, minWidth: 110 }}><span style={labelStyle}>Días después</span>
                  <input type="number" min={0} max={30} value={d.dias_despues} onChange={e => num('dias_despues', e.target.value)} style={inputStyle} aria-label="Días después" /></label>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
                <input type="checkbox" checked={d.uno_por_mesa} onChange={e => setD({ ...d, uno_por_mesa: e.target.checked })} />
                <span>Uno por mesa</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
                <input type="checkbox" checked={d.solo_reserva} onChange={e => setD({ ...d, solo_reserva: e.target.checked })} />
                <span>Solo con reserva</span>
              </label>
              <div>
                <span style={labelStyle}>Link de reservas de este local (OpenTable)</span>
                <div style={{ fontSize: '0.85rem', wordBreak: 'break-all' }} aria-label="Link de reservas del local">
                  {cfg.reserva_url ?? <span style={{ color: C.muted }}>sin link</span>}
                </div>
                <div style={{ fontSize: '0.78rem', color: C.muted }}>Se edita en Club → Locales (solo el owner).</div>
              </div>
              <label><span style={labelStyle}>Artículo de «CORTESÍA CLUB» que marca la caja (solo los activos)</span>
                <select value={d.cortesia_id ?? ''} onChange={e => setD({ ...d, cortesia_id: e.target.value || null })} style={inputStyle} aria-label="Artículo de cortesía del cumpleaños">
                  <option value="">— ninguno —</option>
                  {activas.map(c => <option key={c.id} value={c.id}>{c.nombre} · {c.codigo_producto}</option>)}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn variant="secondary" onClick={() => guardar()} disabled={enviando}>Guardar</Btn>
                {cfg.activo
                  ? <Btn variant="secondary" onClick={() => guardar({ activo: false })} disabled={enviando}>Apagar</Btn>
                  : <Btn onClick={() => guardar({ activo: true })} disabled={enviando || !d.cortesia_id}>Encender</Btn>}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}

/**
 * Mig 175 · Club → Promociones → «Usos del beneficio de cumpleaños» (owner y manager de su local): las marcas del mes
 * (día CR) con socio, quién la hizo y el pedido/factura. Solo el owner deshace una marca hecha por error, con nota (queda
 * en la auditoría); deshecha, la caja puede volver a marcarlo ese año.
 */
export function UsosCumple({ owner }: { owner: boolean }) {
  const [mes, setMes] = useState(mesActualCR())
  const [lista, setLista] = useState<UsoCumple[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [vuelta, setVuelta] = useState(0)
  useEffect(() => {
    let vivo = true
    const [desde, hasta] = rangoMes(mes)
    getUsosCumple(desde, hasta)
      .then(l => { if (vivo) setLista(l) })
      .catch(e => { if (vivo) { setLista([]); setError(aClubError(e).message) } })
    return () => { vivo = false }
  }, [mes, vuelta])
  async function deshacer(id: string) {
    setEnviando(true); setError(null)
    try { await deshacerUsoCumple(id, nota.trim()); setAbierta(null); setNota(''); setVuelta(v => v + 1) }
    catch (e) { setError(aClubError(e).message) }
    finally { setEnviando(false) }
  }
  return (
    <Card>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <strong style={{ flex: 1 }}>Usos del beneficio de cumpleaños</strong>
        <label><span style={labelStyle}>Mes</span>
          <input type="month" aria-label="Mes de los usos de cumpleaños" value={mes} onChange={e => e.target.value && setMes(e.target.value)} style={inputStyle} /></label>
      </div>
      <div style={{ fontSize: '0.82rem', color: C.muted, margin: '4px 0 8px' }}>
        Una vez por año por socio, en cualquier Satori: lo marca la caja al registrar la visita. {owner
          ? 'Si una marca fue un error, deshacela con una nota (queda en la auditoría).'
          : 'Si una marca fue un error, pedile al owner que la deshaga.'}
      </div>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      {lista === null ? <div style={{ color: C.muted }}>Cargando…</div>
        : lista.length === 0 ? <div style={{ color: C.muted }}>Sin usos en el mes.</div>
        : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lista.map(u => (
              <li key={u.id} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 6, opacity: u.deshecho_en ? 0.6 : 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ flex: 1 }}><strong>{u.socio}</strong> · {fmtFechaHora(u.usado_en)} · marcó {u.operador}
                    {u.visita_clave ? ` · ${u.visita_clave}` : ''}</span>
                  {u.deshecho_en ? <Chip color={C.muted}>deshecha</Chip>
                    : owner && abierta !== u.id && <Btn variant="ghost" onClick={() => { setAbierta(u.id); setNota('') }}>Deshacer</Btn>}
                </div>
                {u.deshecho_en && (
                  <div style={{ fontSize: '0.8rem', color: C.muted }}>
                    Deshecha el {fmtFechaHora(u.deshecho_en)}{u.deshecho_por ? ` por ${u.deshecho_por}` : ''}: {u.deshecho_nota}
                  </div>
                )}
                {owner && abierta === u.id && !u.deshecho_en && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <input value={nota} onChange={e => setNota(e.target.value)} maxLength={300} placeholder="Por qué se deshace (5 a 300 letras)"
                      aria-label="Nota para deshacer" style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
                    <Btn onClick={() => deshacer(u.id)} disabled={enviando || nota.trim().length < 5}>{enviando ? 'Deshaciendo…' : 'Deshacer marca'}</Btn>
                    <Btn variant="ghost" onClick={() => setAbierta(null)}>Cancelar</Btn>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
    </Card>
  )
}

const crcTxt = (n: number) => `₡${Number(n).toLocaleString('de-DE', { maximumFractionDigits: 0 })}`

/**
 * Mig 175 · Tablero y Excepciones: los usos del beneficio de cumpleaños del período (solo totales) y sus cortesías a
 * costo, con el mismo % del Tablero (club_config.cortesia_costo_pct). Esas cortesías ya están dentro de «Cortesías a
 * costo» del Tablero: acá se ve cuánto es de cumpleaños. Si la lectura falla (p. ej. sin la 175), no se muestra.
 */
export function ResumenCumpleTarjeta({ desde, hasta, local }: { desde: string; hasta: string; local?: string | null }) {
  const [r, setR] = useState<Resumen | null>(null)
  useEffect(() => {
    let vivo = true
    ;(local === undefined ? getResumenCumple(desde, hasta) : getResumenCumple(desde, hasta, local))
      .then(x => { if (vivo) setR(x) }).catch(() => { if (vivo) setR(null) })
    return () => { vivo = false }
  }, [desde, hasta, local])
  if (!r) return null
  return (
    <Card>
      <h3 style={{ margin: '0 0 6px', fontSize: '1rem' }}>Beneficio de cumpleaños</h3>
      <div data-testid="resumen-cumple" style={{ fontSize: '0.9rem' }}>{resumenCumpleTexto(r)}</div>
      <div style={{ fontSize: '0.9rem', marginTop: 4 }}>
        Cortesías de cumpleaños a costo ({r.cortesia_costo_pct ?? 0} %): <strong>{crcTxt(r.cortesias_costo_crc)}</strong>
        <span style={{ color: C.muted }}> · precio de lista {crcTxt(r.cortesias_lista_crc)} · {r.con_cortesia} con el artículo en la factura</span>
      </div>
      <div style={{ color: C.muted, fontSize: '0.8rem', marginTop: 4 }}>
        Una vez por año por socio. Estas cortesías ya están dentro de las cortesías del Club; acá se ve la parte de cumpleaños.
      </div>
    </Card>
  )
}
