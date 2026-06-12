import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../../shared/hooks/useAuth'
import { supabase } from '../../shared/api/supabase'
import { getSuppliers, getOpenCashSession, createCashMovement } from '../../shared/api/cash'
import { uploadFacturaPhoto, movementAttachments } from '../../shared/api/facturas'
import FacturaThumbs from '../../shared/FacturaThumbs'
import { fi } from '../cash/cashUtils'
import { tipShiftToCaja } from '../../shared/utils'
import type { CashSession, Supplier, CashMovement } from '../../shared/types/database'

/** Bandeja de proveedores — pantalla ÚNICA del rol `proveedor` (teléfono fijo en
 *  recepción de mercadería). Flujo: foto de la factura (botón gigante, cámara
 *  directa) → proveedor → monto → confirmar. El pago queda en la caja abierta del
 *  día como egreso de mercadería, igual que si lo registrara el cajero.
 *  RLS (mig 026): este rol solo puede insertar egresos de mercadería a su nombre
 *  y ver sus propios registros — nada más de la caja. */
export default function ProveedorBandeja() {
  const { profile, signOut } = useAuth()
  const [session, setSession]   = useState<CashSession | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [mios, setMios]         = useState<CashMovement[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [okMsg, setOkMsg]       = useState<string | null>(null)

  // Draft del pago
  const [fotos, setFotos]       = useState<File[]>([])
  const [supSearch, setSupSearch] = useState('')
  const [supId, setSupId]       = useState('')
  const [supOpen, setSupOpen]   = useState(false)
  const [crc, setCrc]           = useState<number | ''>('')
  const [method, setMethod]     = useState<'Efectivo' | 'Transferencia'>('Efectivo')
  const [nota, setNota]         = useState('')
  const [saving, setSaving]     = useState(false)

  const previews = useMemo(() => fotos.map(f => URL.createObjectURL(f)), [fotos])
  useEffect(() => () => { previews.forEach(u => URL.revokeObjectURL(u)) }, [previews])

  const load = useCallback(async () => {
    try {
      const [s, sups] = await Promise.all([getOpenCashSession(), getSuppliers()])
      setSession(s); setSuppliers(sups.filter(x => x.is_active))
      // Mis registros de hoy (RLS: el rol proveedor solo ve created_by = él)
      const today = new Date().toISOString().slice(0, 10)
      const { data } = await supabase.from('cash_movements').select('*')
        .gte('created_at', today + 'T00:00:00').order('created_at', { ascending: false })
      setMios(((data ?? []) as CashMovement[]).filter(m => m.created_by === profile?.id))
    } catch (e) { setError(e instanceof Error ? e.message : 'Error cargando') }
    finally { setLoading(false) }
  }, [profile?.id])
  useEffect(() => { load() }, [load])

  const confirmar = async () => {
    if (!profile || !session || !supId || !Number(crc) || saving) return
    setSaving(true); setError(null); setOkMsg(null)
    try {
      // Fotos primero — la razón de ser de esta pantalla. Si fallan, avisamos
      // pero el pago entra igual (la mercadería ya está en la puerta).
      const paths: string[] = []
      let fallidas = 0
      for (const f of fotos) {
        try { paths.push(await uploadFacturaPhoto(f)) } catch { fallidas++ }
      }
      const prov = suppliers.find(s => s.id === supId)
      await createCashMovement({
        session_id:    session.id,
        created_by:    profile.id,
        movement_type: 'egreso_mercaderia',
        amount_crc:    Number(crc) || 0,
        amount_usd:    0,
        currency:      'CRC',
        exchange_rate: null,
        description:   nota || prov?.name || 'Proveedor',
        subcategory:   'Proveedor mercadería',
        supplier_id:   supId,
        supplier_name: prov?.name ?? '',
        method,
        caja_origen:   method === 'Efectivo' ? 'Caja Proveedores' : 'Banco',
        shift:         tipShiftToCaja(session.shift_type),
        attachments:   paths,
      })
      setOkMsg(`✓ Pago a ${prov?.name ?? 'proveedor'} registrado (${fi(Number(crc))})${fallidas ? ` — ⚠ ${fallidas} foto(s) no subieron` : paths.length ? ` con ${paths.length} foto(s)` : ''}`)
      setFotos([]); setSupSearch(''); setSupId(''); setCrc(''); setNota(''); setMethod('Efectivo')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar el pago') }
    finally { setSaving(false) }
  }

  const matches = suppliers.filter(s => s.name.toLowerCase().includes(supSearch.toLowerCase()))

  return (
    <div style={{ minHeight: '100vh', background: 'var(--t-paper,#f5f1e8)', padding: '0.75rem', maxWidth: 560, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.6rem', color: '#c8a96e' }}>受</span>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '1.05rem', margin: 0 }}>Bandeja de proveedores</h1>
          <div style={{ fontSize: '0.7rem', color: '#5a5040' }}>{profile?.full_name}</div>
        </div>
        <button onClick={() => signOut()} title="Cerrar sesión"
          style={{ background: 'none', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 3, padding: '4px 10px', cursor: 'pointer', color: '#5a5040' }}>✕ Salir</button>
      </header>

      {loading && <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>Cargando…</div>}

      {!loading && !session && (
        <div style={{ padding: '1.25rem', borderRadius: 6, background: '#fff7e8', border: '1px solid #e0c878', fontSize: '0.9rem', color: '#7a5c20' }}>
          🔒 La caja del día <strong>no está abierta</strong>. Avisale al cajero o al encargado que abra la
          Caja Diaria — sin caja abierta no se pueden registrar pagos.
          <button onClick={load} style={{ display: 'block', marginTop: 10, padding: '8px 14px', borderRadius: 4, border: '1px solid #e0c878', background: '#fff', cursor: 'pointer', fontWeight: 700 }}>↻ Reintentar</button>
        </div>
      )}

      {!loading && session && (
        <>
          {/* 1. FOTO — el botón más grande de la pantalla */}
          <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
            border: '3px dashed #c8a96e', borderRadius: 10, padding: '1.6rem 1rem', cursor: 'pointer',
            background: '#fff', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '2.6rem', lineHeight: 1 }}>📷</span>
            <span style={{ fontWeight: 800, fontSize: '1.05rem' }}>SACAR FOTO DE LA FACTURA</span>
            <span style={{ fontSize: '0.72rem', color: '#5a5040' }}>Podés sacar varias (una por hoja)</span>
            <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }}
              onChange={e => {
                const files = Array.from(e.target.files ?? [])
                if (files.length) setFotos(prev => [...prev, ...files])
                e.target.value = ''
              }} />
          </label>
          {fotos.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '0.75rem' }}>
              {fotos.map((f, i) => (
                <span key={i} style={{ position: 'relative' }}>
                  <img src={previews[i]} alt={f.name} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--t-border,#d4cfc4)' }} />
                  <button onClick={() => setFotos(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: '#c0392b', color: '#fff', border: 'none', fontSize: '0.7rem', cursor: 'pointer', lineHeight: 1 }}>✕</button>
                </span>
              ))}
            </div>
          )}

          {/* 2. Proveedor */}
          <div style={{ position: 'relative', marginBottom: '0.6rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#5a5040', marginBottom: 3 }}>¿Quién es el proveedor?</div>
            <input type="text" className="tips-input-dark" style={{ width: '100%', fontSize: '1rem', padding: '0.7rem' }}
              placeholder="Escribí para buscar…" value={supSearch}
              onChange={e => { setSupSearch(e.target.value); setSupId(''); setSupOpen(true) }}
              onFocus={() => setSupOpen(true)}
              onBlur={() => setTimeout(() => setSupOpen(false), 150)} />
            {supOpen && (
              <div className="cd-sup-dropdown" style={{ maxHeight: 220, overflowY: 'auto' }}>
                {matches.length === 0 && <div className="cd-sup-empty">Sin coincidencias — pedile al cajero que lo cree</div>}
                {matches.map(s => (
                  <div key={s.id} className="cd-sup-option"
                    onMouseDown={() => {
                      setSupId(s.id); setSupSearch(s.name); setSupOpen(false)
                      if (s.metodo_pago) setMethod(s.metodo_pago === 'Efectivo' ? 'Efectivo' : 'Transferencia')
                    }}>
                    {s.name}{s.category && <span className="cd-sup-cat"> · {s.category}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3. Monto + método */}
          <div style={{ display: 'flex', gap: 8, marginBottom: '0.6rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#5a5040', marginBottom: 3 }}>Monto ₡</div>
              <input type="number" className="tips-input-dark" inputMode="numeric" style={{ width: '100%', fontSize: '1.15rem', padding: '0.7rem', fontWeight: 700 }}
                placeholder="0" value={crc} onChange={e => setCrc(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#5a5040', marginBottom: 3 }}>Método</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['Efectivo', 'Transferencia'] as const).map(m => (
                  <button key={m} onClick={() => setMethod(m)}
                    style={{ padding: '0.7rem 0.6rem', borderRadius: 5, cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem',
                      border: '1px solid var(--t-border,#d4cfc4)', background: method === m ? '#0d0d0d' : '#fff', color: method === m ? '#c8a96e' : '#5a5040' }}>
                    {m === 'Efectivo' ? '💵' : '🏦'} {m}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#5a5040', marginBottom: 3 }}>Nota / Nº factura (opcional)</div>
            <input type="text" className="tips-input-dark" style={{ width: '100%', padding: '0.6rem' }}
              value={nota} onChange={e => setNota(e.target.value)} placeholder="Nº factura, detalle…" />
          </div>

          {error && <div style={{ color: '#c0392b', fontSize: '0.82rem', marginBottom: 8 }} onClick={() => setError(null)}>⚠ {error}</div>}
          {okMsg && <div style={{ color: '#1f6f3f', fontSize: '0.85rem', fontWeight: 700, marginBottom: 8 }}>{okMsg}</div>}

          <button onClick={confirmar} disabled={!supId || !Number(crc) || saving}
            style={{ width: '100%', padding: '1rem', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: '#1f6f3f', color: '#fff', fontWeight: 800, fontSize: '1.05rem',
              opacity: !supId || !Number(crc) || saving ? 0.45 : 1 }}>
            {saving ? 'Registrando…' : '✓ REGISTRAR PAGO'}
          </button>

          {/* Mis registros de hoy */}
          {mios.length > 0 && (
            <div style={{ marginTop: '1.25rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#5a5040', marginBottom: 6 }}>Registrados hoy por vos ({mios.length})</div>
              {mios.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0', borderBottom: '1px solid var(--t-border,#d4cfc4)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.supplier_name || m.description}</div>
                    <div style={{ fontSize: '0.66rem', color: '#5a5040' }}>
                      {m.method === 'Efectivo' ? '💵' : '🏦'} {new Date(m.created_at).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  {movementAttachments(m).length > 0 && <FacturaThumbs paths={movementAttachments(m)} size={30} />}
                  <span style={{ fontWeight: 800 }}>{fi(m.amount_crc)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
