/**
 * CrmQR — QR de auto-registro de clientes (gerencia)
 * Genera el QR del formulario público /registro para compartir por WhatsApp.
 * El cliente lo escanea → se registra solo en la base.
 */
import { useState, useEffect } from 'react'
import QRCode from 'qrcode'

const MUTED = '#5a5040', GOLD = '#a07830'

export default function CrmQR() {
  const [dataUrl, setDataUrl] = useState('')
  const [copied, setCopied]   = useState(false)

  // URL pública del formulario de registro (respeta el base /satori-app/)
  const regUrl = `${window.location.origin}${import.meta.env.BASE_URL}registro`

  useEffect(() => {
    QRCode.toDataURL(regUrl, { width: 720, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0d0d0d', light: '#f5f0e8' } })
      .then(setDataUrl).catch(() => {})
  }, [regUrl])

  function copy() {
    navigator.clipboard?.writeText(regUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500) }).catch(() => {})
  }

  return (
    <div className="tips-body">
      <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
        <h3 style={{ fontFamily: 'var(--font-serif)', color: 'var(--t-ink,#0d0d0d)', fontSize: '1.2rem', marginBottom: '0.25rem' }}>
          QR de registro de clientes
        </h3>
        <p style={{ fontSize: '0.85rem', color: MUTED, lineHeight: 1.5, marginBottom: '1.25rem' }}>
          Compartí este QR por el grupo de WhatsApp. Cuando un cliente lo escanea con la cámara del celular,
          se abre un formulario y <strong>se registra solo</strong> en la base de clientes.
        </p>

        {/* QR */}
        <div style={{ background: '#f5f0e8', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 12, padding: '1.25rem', display: 'inline-block', marginBottom: '1.25rem' }}>
          {dataUrl
            ? <img src={dataUrl} alt="QR registro Satori" style={{ width: 'min(280px, 70vw)', height: 'auto', display: 'block' }} />
            : <div style={{ width: 280, height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED }}>Generando…</div>}
          <div style={{ marginTop: '0.5rem', fontFamily: 'var(--font-serif)', color: GOLD, letterSpacing: '0.2em', fontWeight: 700 }}>里 SATORI</div>
          <div style={{ fontSize: '0.6rem', color: MUTED, letterSpacing: '0.15em', textTransform: 'uppercase' }}>Escaneá y sumá puntos</div>
        </div>

        {/* Acciones */}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href={dataUrl} download="satori-qr-registro.png"
            style={{ padding: '8px 16px', borderRadius: 4, background: 'var(--t-teal,#2a7a6a)', color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: '0.85rem' }}>
            ⬇ Descargar PNG
          </a>
          <button onClick={copy}
            style={{ padding: '8px 16px', borderRadius: 4, background: 'transparent', border: '1px solid var(--t-border,#d4cfc4)', color: MUTED, fontSize: '0.85rem', cursor: 'pointer' }}>
            {copied ? '✓ Copiado' : '⎘ Copiar link'}
          </button>
        </div>

        <div style={{ fontSize: '0.72rem', color: MUTED, marginTop: '1rem', wordBreak: 'break-all' }}>
          Link directo: <a href={regUrl} target="_blank" rel="noreferrer" style={{ color: GOLD }}>{regUrl}</a>
        </div>

        <div style={{ fontSize: '0.7rem', color: MUTED, marginTop: '1.25rem', background: 'rgba(0,0,0,0.03)', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 4, padding: '0.75rem', textAlign: 'left', lineHeight: 1.5 }}>
          <strong>Cómo usarlo:</strong> Descargá el PNG y mandalo al grupo de WhatsApp con un mensaje tipo
          "¡Registrate en el club Satori y sumá puntos! 📸 Escaneá este QR". También podés imprimirlo y ponerlo
          en las mesas o la entrada.
        </div>
      </div>
    </div>
  )
}
