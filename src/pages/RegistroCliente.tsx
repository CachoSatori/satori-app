/**
 * RegistroCliente — Auto-registro público de clientes (QR → este formulario)
 * Página pública (sin login). El cliente escanea el QR compartido por WhatsApp,
 * completa sus datos y queda en la base de clientes (channel_origin='whatsapp').
 * Requiere migration 007 (policy de insert anónimo).
 */
import { useState } from 'react'
import { supabase } from '../shared/api/supabase'

const GOLD = '#c8a96e', INK = '#0d0d0d', PAPER = '#f5f0e8'

export default function RegistroCliente() {
  const [name, setName]   = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [bday, setBday]   = useState('')
  const [state, setState] = useState<'form' | 'saving' | 'ok' | 'dup'>('form')
  const [error, setError] = useState<string | null>(null)

  const phoneDigits = phone.replace(/[^\d]/g, '')

  async function submit() {
    setError(null)
    if (!name.trim())       { setError('Poné tu nombre'); return }
    if (phoneDigits.length < 8) { setError('Poné un teléfono válido (8 dígitos)'); return }
    setState('saving')
    try {
      const { error } = await supabase.from('customers').insert({
        phone:          phoneDigits,
        name:           name.trim(),
        email:          email.trim() || null,
        birth_date:     bday || null,
        channel_origin: 'whatsapp',
      })
      if (error) {
        if (/duplicate|unique|23505/i.test(error.message)) { setState('dup'); return }
        throw new Error(error.message)
      }
      setState('ok')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar')
      setState('form')
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: '#fff', border: '1px solid #d4cfc4',
    borderRadius: 4, padding: '0.8rem 0.9rem', fontSize: '1rem', color: INK, marginTop: '0.3rem',
  }
  const labelStyle: React.CSSProperties = { fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8a7340', fontWeight: 700 }

  return (
    <div style={{ minHeight: '100vh', background: INK, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0', fontFamily: 'var(--font-sans)' }}>
      {/* Header de marca */}
      <div style={{ textAlign: 'center', padding: '2.5rem 1.5rem 1.5rem' }}>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: '2.6rem', color: GOLD, lineHeight: 1 }}>里</div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem', color: GOLD, letterSpacing: '0.25em', fontWeight: 700, marginTop: '0.4rem' }}>SATORI</div>
        <div style={{ fontSize: '0.62rem', letterSpacing: '0.3em', color: '#777', textTransform: 'uppercase', marginTop: '0.3rem' }}>Sushi Bar · Santa Teresa</div>
      </div>

      {/* Tarjeta */}
      <div style={{ background: PAPER, color: INK, width: '100%', maxWidth: 440, borderRadius: '16px 16px 0 0', flex: 1, padding: '1.75rem 1.5rem 2.5rem', marginTop: '0.5rem' }}>
        {state === 'ok' ? (
          <div style={{ textAlign: 'center', paddingTop: '2rem' }}>
            <div style={{ fontSize: '3rem' }}>🎉</div>
            <h2 style={{ color: INK, margin: '0.5rem 0', fontFamily: 'var(--font-serif)' }}>¡Listo, {name.split(' ')[0]}!</h2>
            <p style={{ color: '#5a5040', fontSize: '0.95rem', lineHeight: 1.5 }}>
              Ya sos parte de <strong>Satori</strong>. Te vamos a sumar <strong>puntos</strong> en cada visita
              y tenés beneficios exclusivos. ¡Nos vemos pronto! 🍣
            </p>
          </div>
        ) : state === 'dup' ? (
          <div style={{ textAlign: 'center', paddingTop: '2rem' }}>
            <div style={{ fontSize: '3rem' }}>✅</div>
            <h2 style={{ color: INK, margin: '0.5rem 0', fontFamily: 'var(--font-serif)' }}>¡Ya estabas registrado!</h2>
            <p style={{ color: '#5a5040', fontSize: '0.95rem', lineHeight: 1.5 }}>
              Ese teléfono ya está en nuestra base. No hace falta registrarte de nuevo — seguís sumando puntos. 🙌
            </p>
          </div>
        ) : (
          <>
            <h2 style={{ color: INK, margin: '0 0 0.25rem', fontFamily: 'var(--font-serif)', fontSize: '1.3rem' }}>Unite al club Satori</h2>
            <p style={{ color: '#5a5040', fontSize: '0.85rem', margin: '0 0 1.25rem', lineHeight: 1.4 }}>
              Registrate y sumá puntos en cada visita. Solo te pedimos lo básico.
            </p>

            {error && <div style={{ background: 'rgba(194,59,34,.1)', border: '1px solid #c23b22', color: '#c23b22', borderRadius: 4, padding: '0.6rem 0.8rem', fontSize: '0.85rem', marginBottom: '1rem' }}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <label>
                <span style={labelStyle}>Nombre *</span>
                <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Tu nombre" autoComplete="name" />
              </label>
              <label>
                <span style={labelStyle}>Teléfono / WhatsApp *</span>
                <input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="8888-8888" inputMode="tel" autoComplete="tel" />
              </label>
              <label>
                <span style={labelStyle}>Email <span style={{ textTransform: 'none', color: '#aa9', fontWeight: 400 }}>(opcional)</span></span>
                <input style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} placeholder="vos@email.com" inputMode="email" autoComplete="email" />
              </label>
              <label>
                <span style={labelStyle}>Cumpleaños <span style={{ textTransform: 'none', color: '#aa9', fontWeight: 400 }}>(opcional · te damos un regalo 🎁)</span></span>
                <input style={inputStyle} type="date" value={bday} onChange={e => setBday(e.target.value)} />
              </label>

              <button onClick={submit} disabled={state === 'saving'}
                style={{ marginTop: '0.5rem', background: INK, color: GOLD, border: 'none', borderRadius: 6, padding: '0.95rem', fontSize: '1rem', fontWeight: 700, letterSpacing: '0.05em', cursor: state === 'saving' ? 'default' : 'pointer' }}>
                {state === 'saving' ? 'Registrando…' : 'Registrarme'}
              </button>
              <p style={{ fontSize: '0.66rem', color: '#8a8170', textAlign: 'center', margin: '0.25rem 0 0', lineHeight: 1.4 }}>
                Usamos tus datos solo para el programa de fidelización de Satori. No compartimos tu info.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
