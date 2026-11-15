/**
 * Mig 173 (D-cumple-2, firmada por el dueño el 15-nov) · Club → Promociones → «Beneficio de cumpleaños».
 * Por local: encendido, texto del beneficio (por defecto «postre de cortesía»; sirve para ofrecer otra cosa cambiando el
 * texto), mínimo de personas, días antes y después del cumpleaños, uno por mesa, solo con reserva, link de reserva
 * (OpenTable por defecto) y el artículo de «CORTESÍA CLUB» que marca la caja (₡0; el tablero lo cuenta a costo).
 * Lo editan el owner y el manager de SU local (la base corta al manager en otro local). Cada cambio queda en la auditoría.
 * Lo que se guarda acá es lo que dice el WhatsApp del Inicio y lo que ve el cajero en Escanear.
 */
import { useEffect, useState } from 'react'
import {
  getCumpleConfig, guardarCumpleConfig, getCortesias, aClubError,
  type CumpleConfig as Cfg, type CumpleConfigDatos, type Cortesia,
} from '../../shared/api/club'
import { Aviso, Btn, Card, Chip } from './ui'
import { C, inputStyle, labelStyle } from './estilos'
import { condicionesCumple } from './cumple'

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
      const c = await guardarCumpleConfig({ ...d, ...cambio, beneficio: d.beneficio.trim(), reserva_url: d.reserva_url?.trim() || null })
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
              <label><span style={labelStyle}>Link de reserva de este local (https://…)</span>
                <input value={d.reserva_url ?? ''} onChange={e => setD({ ...d, reserva_url: e.target.value })} inputMode="url" style={inputStyle} aria-label="Link de reserva" /></label>
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
