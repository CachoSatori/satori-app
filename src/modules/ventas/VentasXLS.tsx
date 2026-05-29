import { useState, useRef, useCallback } from 'react'
import type { DiasMap } from '../../shared/types/ventas'
import { parseVentasFile, extractDateFromFilename } from './xlsParser'
import { saveVentasDia, deleteVentasDia } from '../../shared/api/ventas'
import { fmtDate } from './ventasUtils'
import { useAuth } from '../../shared/hooks/useAuth'

interface Props {
  dias:      DiasMap
  onRefresh: () => void
}

interface QueueItem {
  file:   File
  date:   string | null
  status: 'pending' | 'processing' | 'done' | 'error'
  error?: string
}

export default function VentasXLS({ dias, onRefresh }: Props) {
  const { profile }   = useAuth()
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [dateModal, setDateModal]   = useState<{ file: File; resolve: (d: string) => void } | null>(null)
  const [manualDate, setManualDate] = useState('')
  const dropRef = useRef<HTMLDivElement>(null)

  const processFiles = useCallback(async (files: File[]) => {
    const items: QueueItem[] = files.map(f => ({
      file:   f,
      date:   extractDateFromFilename(f.name),
      status: 'pending',
    }))

    // For files without a detected date, ask user
    const confirmed: QueueItem[] = []
    for (const item of items) {
      if (!item.date) {
        const date = await new Promise<string>(resolve => {
          setManualDate('')
          setDateModal({ file: item.file, resolve })
        })
        if (!date) continue
        confirmed.push({ ...item, date })
      } else {
        confirmed.push(item)
      }
    }

    setQueue(prev => [...prev, ...confirmed])
    setProcessing(true)

    for (const item of confirmed) {
      setQueue(prev => prev.map(q =>
        q.file === item.file ? { ...q, status: 'processing' } : q
      ))
      try {
        const buf    = await item.file.arrayBuffer()
        const data   = parseVentasFile(buf, item.file.name)
        await saveVentasDia(item.date!, data, profile?.id ?? '')
        setQueue(prev => prev.map(q =>
          q.file === item.file ? { ...q, status: 'done' } : q
        ))
      } catch (e) {
        setQueue(prev => prev.map(q =>
          q.file === item.file
            ? { ...q, status: 'error', error: e instanceof Error ? e.message : 'Error' }
            : q
        ))
      }
    }

    setProcessing(false)
    onRefresh()
  }, [profile, onRefresh])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
      .filter(f => f.name.endsWith('.xls') || f.name.endsWith('.xlsx'))
    if (files.length) processFiles(files)
  }, [processFiles])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) processFiles(files)
    e.target.value = ''
  }

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
        ref={dropRef}
        className="vt-drop-zone"
        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
        onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
        onDrop={e => { e.currentTarget.classList.remove('drag-over'); handleDrop(e) }}
      >
        <div className="vt-drop-icon">📂</div>
        <div className="vt-drop-title">Arrastrá los archivos XLS aquí</div>
        <div className="vt-drop-sub">.xls y .xlsx — POS de turnos diarios</div>
        <label className="tips-btn-teal" style={{ cursor: 'pointer', marginTop: '0.75rem' }}>
          Seleccionar archivos
          <input type="file" accept=".xls,.xlsx" multiple onChange={handleFileInput} style={{ display: 'none' }} />
        </label>
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <>
          <div className="vt-sl" style={{ marginTop: '1.5rem' }}>Procesando archivos</div>
          {queue.map((q, i) => (
            <div key={i} className={`vt-queue-item ${q.status}`}>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{q.file.name}</div>
                {q.date && <div style={{ fontSize: '0.72rem', color: '#888' }}>{fmtDate(q.date)}</div>}
              </div>
              <div>
                {q.status === 'pending'    && <span style={{ color: '#888' }}>En espera</span>}
                {q.status === 'processing' && <span style={{ color: 'var(--vt-gold)' }}>⟳ Procesando...</span>}
                {q.status === 'done'       && <span style={{ color: 'var(--vt-green)' }}>✓ Listo</span>}
                {q.status === 'error'      && <span style={{ color: 'var(--vt-red)' }}>✗ {q.error}</span>}
              </div>
            </div>
          ))}
          {!processing && (
            <button className="tips-btn-ghost" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}
              onClick={() => setQueue([])}>
              Limpiar lista
            </button>
          )}
        </>
      )}

      {/* Storage stats */}
      <div className="vt-sl" style={{ marginTop: '1.5rem' }}>Datos cargados ({sortedDates.length} días)</div>
      <div className="vt-file-list">
        {sortedDates.map(date => {
          const dia = dias[date]
          const nSals = Object.keys(dia.saloneros).length
          return (
            <div key={date} className="vt-file-row">
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{fmtDate(date)}</div>
                <div style={{ fontSize: '0.72rem', color: '#888' }}>
                  {dia.fileName} · {nSals} empleados
                </div>
              </div>
              <button className="cd-mov-del" onClick={() => handleDelete(date)}>×</button>
            </div>
          )
        })}
        {sortedDates.length === 0 && (
          <div style={{ color: '#888', padding: '1rem', textAlign: 'center', fontSize: '0.85rem' }}>
            Sin archivos cargados
          </div>
        )}
      </div>

      {/* Date modal */}
      {dateModal && (
        <div className="cd-modal-overlay" onClick={() => { setDateModal(null); dateModal.resolve('') }}>
          <div className="cd-modal" onClick={e => e.stopPropagation()}>
            <div className="cd-modal-title">Fecha del archivo</div>
            <p style={{ fontSize: '0.85rem', marginBottom: '1rem', color: '#888' }}>
              No se pudo detectar la fecha de <strong>{dateModal.file.name}</strong>.<br/>
              Ingresala manualmente.
            </p>
            <div className="tips-field">
              <div className="tips-field-label">Fecha</div>
              <input type="date" className="tips-input-dark" value={manualDate}
                onChange={e => setManualDate(e.target.value)} />
            </div>
            <div className="cd-modal-actions">
              <button className="tips-btn-ghost" onClick={() => { setDateModal(null); dateModal.resolve('') }}>
                Cancelar
              </button>
              <button className="tips-btn-teal" disabled={!manualDate}
                onClick={() => { const d = manualDate; setDateModal(null); dateModal.resolve(d) }}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
