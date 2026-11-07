/**
 * Vencimiento por inactividad (solo owner). Nunca a ciegas: «Simular vencimiento» muestra la lista
 * (miembro, personas, créditos, última actividad) sin escribir nada; «Confirmar» manda el total de esa
 * lista y el servidor solo vence si la simulación en ese momento da el mismo número.
 */
import { useState } from 'react'
import { simularVencimiento, confirmarVencimiento, aClubError, fmtCreditos, type CandidatoVencer } from '../../shared/api/club'
import { Aviso, Btn, Card } from './ui'
import { C, labelStyle, fmtFecha, TIPO_MIEMBRO_LABEL } from './estilos'

const hoyCR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' })

export default function Vencimiento() {
  const [corte] = useState(hoyCR())
  const [lista, setLista] = useState<CandidatoVencer[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [msg, setMsg] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null)

  async function simular() {
    setCargando(true); setMsg(null)
    try { setLista(await simularVencimiento(corte)) }
    catch (e) { setLista(null); setMsg({ tono: 'error', texto: aClubError(e).message }) }
    finally { setCargando(false) }
  }
  async function confirmar() {
    if (!lista) return
    const personas = lista.reduce((a, x) => a + x.personas, 0)
    const creditos = lista.reduce((a, x) => a + Number(x.creditos), 0)
    if (!window.confirm(`¿Vencer ${lista.length} cuentas (${personas} personas, ${fmtCreditos(creditos)} créditos)? No se deshace desde la app.`)) return
    setCargando(true); setMsg(null)
    try {
      const n = await confirmarVencimiento(corte, lista.length)
      setMsg({ tono: 'ok', texto: `Vencidas ${n} cuentas.` }); setLista(null)
    } catch (e) {
      setMsg({ tono: 'error', texto: aClubError(e).message }); setLista(null)
    } finally { setCargando(false) }
  }

  const personas = lista?.reduce((a, x) => a + x.personas, 0) ?? 0
  const creditos = lista?.reduce((a, x) => a + Number(x.creditos), 0) ?? 0
  return (
    <Card>
      <span style={labelStyle}>Vencimiento por inactividad (solo owner)</span>
      <div style={{ fontSize: '0.85rem', color: C.muted, marginBottom: 8 }}>
        Vence el saldo de las cuentas sin tarjeta, canje ni restitución en el plazo configurado, al {fmtFecha(corte)}.
        Primero se simula; nada se escribe hasta confirmar.
      </div>
      {msg && <Aviso tono={msg.tono} onClose={() => setMsg(null)}>{msg.texto}</Aviso>}
      {!lista && <Btn variant="secondary" onClick={simular} disabled={cargando}>{cargando ? 'Simulando…' : 'Simular vencimiento'}</Btn>}
      {lista && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <strong>{lista.length} cuentas · {personas} personas · {fmtCreditos(creditos)} créditos</strong>
          {lista.length > 0 && (
            <div style={{ maxHeight: 280, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead><tr style={{ textAlign: 'left', color: C.muted }}>
                  <th style={{ padding: 6 }}>Miembro</th><th style={{ padding: 6 }}>Personas</th><th style={{ padding: 6 }}>Créditos</th><th style={{ padding: 6 }}>Última actividad</th>
                </tr></thead>
                <tbody>{lista.map(x => (
                  <tr key={x.miembro_id} style={{ borderTop: `1px solid ${C.panel}` }}>
                    <td style={{ padding: 6 }}>{x.nombre} <span style={{ color: C.muted }}>· {TIPO_MIEMBRO_LABEL[x.tipo] ?? x.tipo}</span></td>
                    <td style={{ padding: 6 }}>{x.personas}</td>
                    <td style={{ padding: 6 }}>{fmtCreditos(x.creditos)}</td>
                    <td style={{ padding: 6 }}>{x.ultima_actividad ? fmtFecha(x.ultima_actividad) : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="secondary" onClick={() => setLista(null)} disabled={cargando} style={{ flex: 1 }}>Cancelar</Btn>
            <Btn variant="danger" onClick={confirmar} disabled={cargando || lista.length === 0} style={{ flex: 2 }}>
              {cargando ? 'Venciendo…' : `Confirmar (${lista.length})`}
            </Btn>
          </div>
        </div>
      )}
    </Card>
  )
}
