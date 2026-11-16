/**
 * Hallazgo 230 (D 16-nov, el dueño): «¿Este es su WhatsApp? +506 8888 0000» antes de mandar el link del portal.
 * Pantalla del personal (voseo). Sin dígitos no hay «Sí, es este». La usan el alta en caja (Escanear) y la ficha del
 * socio en Miembros («Mandar por WhatsApp»).
 */
import { formatoWhatsApp } from './altaWhatsApp'
import { Aviso, Btn } from './ui'
import { C } from './estilos'

export function ConfirmarWhatsApp({ tel, enviando, onSi, onCorregir }: {
  tel: string; enviando: boolean; onSi: () => void; onCorregir: () => void
}) {
  const f = formatoWhatsApp(tel)
  return (
    <div role="alertdialog" aria-label="Confirmar el WhatsApp" style={{ border: `2px solid ${C.gold}`, borderRadius: 8, padding: '0.6rem 0.7rem', background: C.paper, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {f ? <>
        <div style={{ fontSize: '0.85rem' }}>Leéselo a la persona y confirmalo antes de seguir: a este número le llega el link de su portal.</div>
        <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>¿Este es su WhatsApp? {f}</div>
      </> : <Aviso tono="error">Ese WhatsApp no tiene números: corregilo.</Aviso>}
      <div style={{ display: 'flex', gap: 8 }}>
        {f && <Btn type="button" onClick={onSi} disabled={enviando}>{enviando ? 'Guardando…' : 'Sí, es este'}</Btn>}
        <Btn type="button" variant="secondary" onClick={onCorregir} disabled={enviando}>Corregir</Btn>
      </div>
    </div>
  )
}
