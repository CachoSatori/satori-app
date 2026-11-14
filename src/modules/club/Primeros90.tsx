/**
 * Mig 168 · Primeros 90 días (ítem #15 del Club v2).
 *  · `AvisoPrimeros90` (Caja → Escanear, visita del socio): si la base ofrece la cortesía especial de bienvenida en esta
 *    visita, un recuadro aparte con el artículo y «una sola vez»; si la tiene guardada o el local no la tiene cargada,
 *    un aviso de NO ofrecerla. La regla la decide la base (`club_socio_visita`); acá solo se muestra.
 *  · `ConfigPrimeros90` (Club → Promociones): el owner la enciende (para todo el Club) y elige la cortesía de ESTE local
 *    entre las activas. Manager la ve. Apagada por defecto. Cada cambio queda en el historial/auditoría de la base.
 */
import { useEffect, useState } from 'react'
import {
  getPrimeros90Config, guardarPrimeros90Config, getCortesias, aClubError,
  type Primeros90EnCaja, type Primeros90Config, type Cortesia,
} from '../../shared/api/club'
import { Aviso, Btn, Card, Chip } from './ui'
import { C, inputStyle, labelStyle } from './estilos'

export const MSG_P90_GUARDADA = 'Cortesía especial de bienvenida guardada: NO va en esta factura (queda para su próxima visita).'
export const MSG_P90_SIN_CONFIGURAR = 'Cortesía especial de bienvenida: NO la ofrezcas. En este local no está configurada o el artículo está apagado; queda guardada. Avisale al owner.'

export function AvisoPrimeros90({ p }: { p: Primeros90EnCaja | undefined }) {
  if (!p) return null
  if (p.estado === 'ofrecida') {
    return (
      <div role="status" style={{ marginTop: 8, border: `2px dashed ${C.gold}`, borderRadius: 8, padding: '0.6rem 0.7rem', background: C.paper }}>
        <div style={{ fontSize: '0.7rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Cortesía especial de bienvenida · una sola vez
        </div>
        <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>{p.nombre}</div>
        <div style={{ fontSize: '0.85rem' }}>Marcá el artículo <strong>{p.codigo}</strong> de «CORTESÍA CLUB».</div>
      </div>
    )
  }
  return <div style={{ marginTop: 8 }}><Aviso tono="info">{p.estado === 'guardada' ? MSG_P90_GUARDADA : MSG_P90_SIN_CONFIGURAR}</Aviso></div>
}

export function ConfigPrimeros90({ owner }: { owner: boolean }) {
  const [cfg, setCfg] = useState<Primeros90Config | null>(null)
  const [cortesias, setCortesias] = useState<Cortesia[]>([])
  const [elegida, setElegida] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  useEffect(() => {
    let vivo = true
    Promise.all([getPrimeros90Config(), getCortesias()])
      .then(([c, l]) => { if (vivo) { setCfg(c); setCortesias(l); setElegida(c.cortesia?.id ?? '') } })
      .catch(e => { if (vivo) setError(aClubError(e).message) })
    return () => { vivo = false }
  }, [])
  async function guardar(activo: boolean | null) {
    setEnviando(true); setError(null); setOk(null)
    try {
      const c = await guardarPrimeros90Config(activo, elegida || null)
      setCfg(c); setElegida(c.cortesia?.id ?? '')
      setOk(activo === true ? 'Encendido: los socios nuevos ven su avance y la ganan en la visita ' + c.visitas + '.'
        : activo === false ? 'Apagado: nadie nuevo la gana (las ya ganadas se respetan).' : 'Cortesía del local guardada.')
    } catch (e) { setError(aClubError(e).message) }
    finally { setEnviando(false) }
  }
  const activas = cortesias.filter(c => c.activa)
  return (
    <Card>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <strong style={{ flex: 1 }}>Cortesía especial de bienvenida (primeros 90 días)</strong>
        {cfg && <Chip color={cfg.activo ? C.teal : C.muted}>{cfg.activo ? 'encendida' : 'apagada'}</Chip>}
      </div>
      <div style={{ fontSize: '0.82rem', color: C.muted, margin: '4px 0 8px' }}>
        El socio nuevo ve «Visita 2 de {cfg?.visitas ?? 4}» (el alta cuenta como la 1.ª). Si llega a la visita {cfg?.visitas ?? 4} dentro
        de sus primeros {cfg?.dias ?? 90} días, gana una cortesía especial, una sola vez, que la caja ofrece en esa visita o en la
        siguiente (vale {cfg?.vence_dias ?? 60} días). El encendido es para todo el Club; la cortesía es la de cada local.
      </div>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      {ok && <Aviso tono="ok" onClose={() => setOk(null)}>{ok}</Aviso>}
      {cfg === null ? (!error && <div style={{ color: C.muted }}>Cargando…</div>) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!cfg.lista_para_caja && (
            <Aviso tono="error">
              En este local no hay una cortesía especial cargada y activa: la caja no la ofrece (las ganadas quedan guardadas).
            </Aviso>
          )}
          <div style={{ fontSize: '0.85rem' }}>
            Cortesía de este local: <strong>{cfg.cortesia ? `${cfg.cortesia.nombre} · ${cfg.cortesia.codigo}` : 'ninguna'}</strong>
            {cfg.cortesia && !cfg.cortesia.activa && ' (apagada)'} · Guardadas: {cfg.disponibles} · Usadas: {cfg.usadas}
          </div>
          {owner && (
            <>
              <label><span style={labelStyle}>Elegí la cortesía de este local (solo las activas)</span>
                <select value={elegida} onChange={e => setElegida(e.target.value)} style={inputStyle} aria-label="Cortesía especial de este local">
                  <option value="">— ninguna —</option>
                  {activas.map(c => <option key={c.id} value={c.id}>{c.nombre} · {c.codigo_producto}</option>)}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn variant="secondary" onClick={() => guardar(null)} disabled={enviando}>Guardar cortesía del local</Btn>
                {cfg.activo
                  ? <Btn variant="secondary" onClick={() => guardar(false)} disabled={enviando}>Apagar</Btn>
                  : <Btn onClick={() => guardar(true)} disabled={enviando || !elegida}>Encender</Btn>}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}
