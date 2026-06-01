import { useState, useRef, useCallback } from 'react'
import type { DiasMap } from '../../shared/types/ventas'
import VentasHistImport from './VentasHistImport'
import { parseVentasFile, extractDateFromFilename } from './xlsParser'
import { saveVentasDia, deleteVentasDia } from '../../shared/api/ventas'
import { fmtDate } from './ventasUtils'
import { useAuth } from '../../shared/hooks/useAuth'

interface Props {
  dias:      DiasMap
  onRefresh: () => void
}

interface QueueItem {
  name:   string
  date:   string | null
  status: 'pending' | 'processing' | 'done' | 'error'
  error?: string
}

export default function VentasXLS({ dias, onRefresh }: Props) {
  const { profile }     = useAuth()
  const fileInputRef    = useRef<HTMLInputElement>(null)
  const [queue, setQueue]         = useState<QueueItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [dragOver, setDragOver]   = useState(false)

  // Date modal state
  const [pendingModal, setPendingModal] = useState<{
    name: string
    file: File
    resolve: (d: string) => void
  } | null>(null)
  const [manualDate, setManualDate] = useState('')

  // ── Ask user for date (returns '' if cancelled) ──────────────
  const askDate = useCallback((file: File): Promise<string> => {
    return new Promise(resolve => {
      setManualDate('')
      setPendingModal({ name: file.name, file, resolve })
    })
  }, [])

  // ── Process file list ─────────────────────────────────────────
  const processFiles = useCallback(async (files: File[]) => {
    const xls = files.filter(f =>
      f.name.toLowerCase().endsWith('.xls') || f.name.toLowerCase().endsWith('.xlsx')
    )
    if (!xls.length) return

    // Build queue items, asking date for files without detectable date
    const items: Array<{ file: File; date: string }> = []
    for (const file of xls) {
      const detected = extractDateFromFilename(file.name)
      if (detected) {
        items.push({ file, date: detected })
      } else {
        const date = await askDate(file)
        if (date) items.push({ file, date })
        // if user cancelled, skip file
      }
    }
    if (!items.length) return

    // Show all items as pending
    setQueue(items.map(it => ({ name: it.file.name, date: it.date, status: 'pending' })))
    setProcessing(true)

    for (const { file, date } of items) {
      // Mark as processing
      setQueue(prev => prev.map(q =>
        q.name === file.name ? { ...q, status: 'processing' } : q
      ))

      try {
        // Timeout: abort if takes more than 30 seconds
        await Promise.race([
          (async () => {
            const buf  = await file.arrayBuffer()
            const data = parseVentasFile(buf, file.name)
            await saveVentasDia(date, data, profile?.id ?? '')
            return 'ok'
          })(),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Tiempo de espera agotado (30s)')), 30_000)
          ),
        ])

        setQueue(prev => prev.map(q =>
          q.name === file.name ? { ...q, status: 'done' } : q
        ))
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error desconocido'
        setQueue(prev => prev.map(q =>
          q.name === file.name ? { ...q, status: 'error', error: msg } : q
        ))
      }
    }

    setProcessing(false)
    onRefresh()
  }, [profile, askDate, onRefresh])

  // ── File input change ─────────────────────────────────────────
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // reset so same file can be re-selected
    if (files.length) processFiles(files)
  }

  // ── Drag & Drop ───────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }
  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the drop zone entirely (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false)
    }
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) processFiles(files)
  }

  // ── Delete ────────────────────────────────────────────────────
  const handleDelete = async (date: string) => {
    if (!window.confirm(`¿Eliminar datos del ${fmtDate(date)}?`)) return
    await deleteVentasDia(date)
    onRefresh()
  }

  const sortedDates = Object.keys(dias).sort().reverse()

  return (
    <div className="vt-section">

      {/* Drop zone */}
      <div
        className={`vt-drop-zone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="vt-drop-icon">📂</div>
        <div className="vt-drop-title">Arrastrá los archivos XLS aquí</div>
        <div className="vt-drop-sub">.xls y .xlsx — POS de turnos diarios</div>

        {/* Button triggers the hidden input via ref — more reliable than label click */}
        <button
          className="tips-btn-teal"
          style={{ marginTop: '0.75rem' }}
          disabled={processing}
          onClick={() => fileInputRef.current?.click()}
        >
          {processing ? '⟳ Procesando…' : 'Seleccionar archivos'}
        </button>

        {/* Hidden file input — outside button to avoid click propagation issues */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xls,.xlsx"
          multiple
          onChange={handleFileInput}
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
          tabIndex={-1}
        />
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <div style={{ marginTop: '1.25rem' }}>
          <div className="vt-sl">Archivos procesados</div>
          {queue.map((q, i) => (
            <div key={i} className={`vt-queue-item ${q.status}`}>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{q.name}</div>
                {q.date && <div style={{ fontSize: '0.72rem', color: '#888' }}>{fmtDate(q.date)}</div>}
                {q.status === 'error' && q.error && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--vt-red)', marginTop: '0.2rem' }}>
                    {q.error}
                  </div>
                )}
              </div>
              <div style={{ flexShrink: 0 }}>
                {q.status === 'pending'    && <span style={{ color: '#888', fontSize: '0.78rem' }}>En espera…</span>}
                {q.status === 'processing' && (
                  <span style={{ color: 'var(--vt-gold)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span className="vt-spin">⟳</span> Procesando…
                  </span>
                )}
                {q.status === 'done'  && <span style={{ color: 'var(--vt-green)', fontSize: '0.78rem' }}>✓ Guardado</span>}
                {q.status === 'error' && <span style={{ color: 'var(--vt-red)', fontSize: '0.78rem' }}>✗ Error</span>}
              </div>
            </div>
          ))}
          {!processing && (
            <button className="tips-btn-ghost" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}
              onClick={() => setQueue([])}>
              Limpiar lista
            </button>
          )}
        </div>
      )}

      {/* Loaded files */}
      <div className="vt-sl" style={{ marginTop: '1.5rem' }}>
        Datos cargados ({sortedDates.length} días)
      </div>
      <div className="vt-file-list">
        {sortedDates.map(date => {
          const dia  = dias[date]
          const nSals = Object.keys(dia.saloneros).length
          return (
            <div key={date} className="vt-file-row">
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{fmtDate(date)}</div>
                <div style={{ fontSize: '0.72rem', color: '#888' }}>
                  {dia.fileName} · {nSals} empleado{nSals !== 1 ? 's' : ''}
                </div>
              </div>
              <button className="cd-mov-del" onClick={() => handleDelete(date)} title="Eliminar">×</button>
            </div>
          )
        })}
        {sortedDates.length === 0 && (
          <div style={{ color: '#888', padding: '1rem', textAlign: 'center', fontSize: '0.85rem' }}>
            Sin archivos cargados — arrastrá un XLS para empezar
          </div>
        )}
      </div>

      {/* Date modal for files without detectable date */}
      {pendingModal && (
        <div className="cd-modal-overlay"
          onClick={() => { setPendingModal(null); pendingModal.resolve('') }}>
          <div className="cd-modal" onClick={e => e.stopPropagation()}>
            <div className="cd-modal-title">¿Qué fecha es este archivo?</div>
            <p style={{ fontSize: '0.85rem', marginBottom: '1rem', color: '#888' }}>
              No se pudo detectar la fecha de <strong>{pendingModal.name}</strong>.<br />
              Ingresala manualmente para continuar.
            </p>
            <div className="tips-field">
              <div className="tips-field-label">Fecha del turno</div>
              <input
                type="date"
                className="tips-input-dark"
                value={manualDate}
                onChange={e => setManualDate(e.target.value)}
                autoFocus
              />
            </div>
            <div className="cd-modal-actions" style={{ marginTop: '1rem' }}>
              <button className="tips-btn-ghost"
                onClick={() => { setPendingModal(null); pendingModal.resolve('') }}>
                Saltar archivo
              </button>
              <button className="tips-btn-teal" disabled={!manualDate}
                onClick={() => {
                  const d = manualDate
                  setPendingModal(null)
                  pendingModal.resolve(d)
                }}>
                Confirmar fecha
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Historical import separator ── */}
      <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--vt-border)' }}>
        <VentasHistImport />
      </div>
    </div>
  )
}
