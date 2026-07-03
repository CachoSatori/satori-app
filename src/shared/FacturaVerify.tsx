import { useState, useEffect, useCallback } from 'react'
import { supabase } from './api/supabase'
import { useAuth } from './hooks/useAuth'
import { signedUrl, getDocByMovement, type DocumentRow } from './api/documents'
import type { CashMovement, UserRole } from './types/database'

/**
 * Verificado de factura (feat/bandeja-fusion).
 * Dado un cash_movement: busca el `documents` enlazado (linked_movement_id = movement.id),
 * muestra la factura (signedUrl del image_path) y permite marcarla "verificada".
 *  · Sin documento enlazado → "⚠ falta factura".
 *  · Ya verificada → "✓ verificado por [nombre] · dd/mm".
 *  · Botón "✓ Verificar" → RPC mark_factura_verified (mig 038). Visible para
 *    owner/manager/cajero/contador (el RPC además lo valida en el servidor).
 *
 * Se monta en Finanzas (lo usan contador/owner/manager) y en Caja → Movimientos
 * (lo usa el cajero/manager/owner). `doc` opcional permite precargar el documento
 * desde el padre y evitar una consulta por fila; si se omite, el componente lo busca.
 */
const VERIFIER_ROLES: UserRole[] = ['owner', 'manager', 'cajero', 'contador']

function ddmm(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface Props {
  movement: CashMovement
  doc?: DocumentRow | null   // documento precargado; `undefined` ⇒ el componente lo busca
  compact?: boolean          // versión chica para filas de tabla
  onVerified?: () => void
}

export default function FacturaVerify({ movement, doc, compact, onVerified }: Props) {
  const { profile } = useAuth()
  // `doc` precargado por el padre manda; si es undefined, lo buscamos nosotros.
  const [fetchedDoc, setFetchedDoc] = useState<DocumentRow | null | undefined>(undefined)
  const linkedDoc: DocumentRow | null | undefined = doc !== undefined ? doc : fetchedDoc
  const [imgUrl, setImgUrl]   = useState<string | null>(null)
  const [zoom, setZoom]       = useState(false)
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  // Estado de verificado: del movimiento o, tras verificar acá, optimista.
  const [verifiedBy, setVerifiedBy] = useState<string | null>(movement.factura_verified_by ?? null)
  const [verifiedAt, setVerifiedAt] = useState<string | null>(movement.factura_verified_at ?? null)
  const [verifierName, setVerifierName] = useState<string>('')

  // Buscar el documento enlazado si el padre no lo precargó.
  useEffect(() => {
    if (doc !== undefined) return
    let on = true
    getDocByMovement(movement.id).then(d => { if (on) setFetchedDoc(d) }).catch(() => { if (on) setFetchedDoc(null) })
    return () => { on = false }
  }, [doc, movement.id])

  // Firmar la URL de la factura cuando hay documento.
  useEffect(() => {
    if (!linkedDoc) return
    let on = true
    signedUrl(linkedDoc.image_path).then(u => { if (on) setImgUrl(u) }).catch(() => {})
    return () => { on = false }
  }, [linkedDoc])

  // Resolver el nombre de quién verificó.
  useEffect(() => {
    if (!verifiedBy) return
    let on = true
    supabase.from('profiles').select('full_name').eq('id', verifiedBy).maybeSingle()
      .then(({ data }) => { if (on) setVerifierName((data as { full_name?: string } | null)?.full_name ?? '') })
    return () => { on = false }
  }, [verifiedBy])

  const canVerify = !!profile && VERIFIER_ROLES.includes(profile.role)

  const handleVerify = useCallback(async () => {
    if (!profile) return
    setBusy(true); setErr(null)
    try {
      const rpc = supabase.rpc.bind(supabase) as unknown as
        (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
      const { error } = await rpc('mark_factura_verified', { p_movement_id: movement.id })
      if (error) throw new Error(error.message)
      setVerifiedBy(profile.id)
      setVerifiedAt(new Date().toISOString())
      setVerifierName(profile.full_name)
      onVerified?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo verificar')
    } finally { setBusy(false) }
  }, [profile, movement.id, onVerified])

  const fontSize = compact ? '0.66rem' : '0.78rem'

  // Sin factura enlazada
  if (linkedDoc === null) {
    return <span style={{ fontSize, color: '#c8a030', fontWeight: 700 }}>⚠ falta factura</span>
  }
  // Aún cargando el documento
  if (linkedDoc === undefined) {
    return <span style={{ fontSize, color: 'var(--t-muted, #888)' }}>…</span>
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize }}>
      {imgUrl && (
        <button type="button" onClick={() => setZoom(true)} title="Ver factura"
          style={{ padding: 0, border: '1px solid var(--t-border, #d4cfc4)', borderRadius: 4, overflow: 'hidden', cursor: 'zoom-in', lineHeight: 0, background: '#fff' }}>
          <img src={imgUrl} alt="Factura" style={{ width: compact ? 26 : 40, height: compact ? 26 : 40, objectFit: 'cover', display: 'block' }} />
        </button>
      )}
      {verifiedBy ? (
        <span style={{ color: '#1f6f3f', fontWeight: 700 }}>
          ✓ verificado{verifierName ? ` por ${verifierName}` : ''}{verifiedAt ? ` · ${ddmm(verifiedAt)}` : ''}
        </span>
      ) : canVerify ? (
        <button type="button" onClick={handleVerify} disabled={busy}
          style={{ background: '#a07830', color: '#fff', border: 'none', borderRadius: 4, padding: compact ? '2px 7px' : '4px 10px', fontSize, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? '…' : '✓ Verificar'}
        </button>
      ) : (
        <span style={{ color: 'var(--t-muted, #888)' }}>sin verificar</span>
      )}
      {err && <span style={{ color: '#c0392b' }}>{err}</span>}

      {zoom && imgUrl && (
        <span onClick={() => setZoom(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', cursor: 'zoom-out' }}>
          <img src={imgUrl} alt="Factura ampliada" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          <button onClick={() => setZoom(false)} style={{ position: 'fixed', top: 16, right: 16, background: 'rgba(255,255,255,.15)', color: '#fff', border: '1px solid rgba(255,255,255,.3)', borderRadius: 6, padding: '6px 12px', fontSize: '1rem', cursor: 'pointer' }}>✕ Cerrar</button>
        </span>
      )}
    </span>
  )
}
