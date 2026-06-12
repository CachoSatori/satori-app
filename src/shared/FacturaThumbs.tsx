import { useState, useEffect } from 'react'
import { getFacturaUrl } from './api/facturas'

/** Miniaturas de fotos de factura de un pago a proveedor (bucket privado 'facturas').
 *  Tap en una miniatura → lightbox con la foto completa (para revisar nombres de
 *  productos y precios). Soporta varias fotos por pago (◀ ▶ navega). */
export default function FacturaThumbs({ paths, size = 34 }: { paths: string[]; size?: number }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    paths.forEach(p => {
      getFacturaUrl(p)
        .then(u => { if (!cancelled) setUrls(prev => prev[p] === u ? prev : { ...prev, [p]: u }) })
        .catch(() => { /* sin red o sin permiso → la miniatura queda como 📷 */ })
    })
    return () => { cancelled = true }
  }, [paths])

  // Cerrar lightbox con Escape, navegar con flechas
  useEffect(() => {
    if (open === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
      if (e.key === 'ArrowRight') setOpen(i => i === null ? i : (i + 1) % paths.length)
      if (e.key === 'ArrowLeft') setOpen(i => i === null ? i : (i - 1 + paths.length) % paths.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, paths.length])

  if (paths.length === 0) return null

  return (
    <>
      <span style={{ display: 'inline-flex', gap: 3, verticalAlign: 'middle' }}>
        {paths.map((p, i) => urls[p] ? (
          <img key={p} src={urls[p]} alt={`Factura ${i + 1}`}
            onClick={e => { e.stopPropagation(); setOpen(i) }}
            style={{ width: size, height: size, objectFit: 'cover', borderRadius: 4,
              border: '1px solid var(--t-border,#d4cfc4)', cursor: 'zoom-in' }} />
        ) : (
          <span key={p} title="Cargando foto…"
            style={{ width: size, height: size, borderRadius: 4, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', fontSize: size * 0.5,
              border: '1px dashed var(--t-border,#d4cfc4)', color: '#8a8378' }}>📷</span>
        ))}
      </span>

      {open !== null && (
        <div onClick={e => { e.stopPropagation(); setOpen(null) }}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          {urls[paths[open]]
            ? <img src={urls[paths[open]]} alt={`Factura ${open + 1}`}
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: '96vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 6 }} />
            : <span style={{ color: '#ccc' }}>Cargando foto…</span>}
          {paths.length > 1 && (
            <>
              <button onClick={e => { e.stopPropagation(); setOpen((open - 1 + paths.length) % paths.length) }}
                style={navBtn('left')}>‹</button>
              <button onClick={e => { e.stopPropagation(); setOpen((open + 1) % paths.length) }}
                style={navBtn('right')}>›</button>
            </>
          )}
          <button onClick={() => setOpen(null)}
            style={{ position: 'fixed', top: 12, right: 14, background: 'none', border: 'none',
              color: '#fff', fontSize: '1.8rem', cursor: 'pointer', lineHeight: 1 }}>✕</button>
          {paths.length > 1 && (
            <span style={{ position: 'fixed', bottom: 14, left: 0, right: 0, textAlign: 'center',
              color: '#ccc', fontSize: '0.8rem' }}>{open + 1} / {paths.length}</span>
          )}
        </div>
      )}
    </>
  )
}

function navBtn(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'fixed', top: '50%', [side]: 8, transform: 'translateY(-50%)',
    background: 'rgba(0,0,0,0.5)', border: '1px solid #555', color: '#fff',
    fontSize: '1.6rem', lineHeight: 1, borderRadius: '50%', width: 42, height: 42, cursor: 'pointer',
  }
}
