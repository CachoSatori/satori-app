/**
 * VentasHistImport — Importar datos históricos de ventas desde CSV
 * Popula la tabla ventas_hist para que VentasAnalisis tenga años anteriores
 *
 * CSV format esperado:
 *   fecha,ventaNeta,ventaBruta,iva,serv,salon,delivery,pax,promPax
 *   2025-01-15,1250000,1537500,162500,125000,1200000,50000,85,14706
 */
import { useState, useCallback } from 'react'
import { useAuth } from '../../shared/hooks/useAuth'
import { saveVentasHist } from '../../shared/api/ventas'
import type { HistDay } from '../../shared/types/ventas'

interface ParsedRow {
  fecha: string
  data:  HistDay
  error?: string
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (!lines.length) return []

  // ── Detect Google Sheets JSON format (key,data / hist,"{...}")  ──────────
  const histLine = lines.find(l => l.startsWith('hist,'))
  if (histLine) {
    try {
      const jsonStr = histLine.slice(5).replace(/^"|"$/g, '').replace(/""/g, '"')
      const hist = JSON.parse(jsonStr) as Record<string, HistDay>
      return Object.entries(hist)
        .filter(([fecha]) => /^\d{4}-\d{2}-\d{2}$/.test(fecha))
        .map(([fecha, d]) => ({
          fecha,
          data: {
            ventaBruta: +(d.ventaBruta ?? 0),
            ventaNeta:  +(d.ventaNeta  ?? 0),
            iva:        +(d.iva        ?? 0),
            serv:       +(d.serv       ?? 0),
            salon:      +(d.salon      ?? 0),
            delivery:   +(d.delivery   ?? 0),
            pax:        Math.round(+(d.pax ?? 0)),
            promPax:    +(d.promPax    ?? 0),
            source:     'hist' as const,
          },
        }))
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
    } catch { /* fall through to CSV parser */ }
  }

  // ── Standard CSV rows ──────────────────────────────────────────────────────
  const first = lines[0].toLowerCase()
  const hasHeader = first.includes('fecha') || first.includes('date') || first.includes('ventaneta')
  const dataLines = hasHeader ? lines.slice(1) : lines

  return dataLines.map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/"/g, ''))
    if (cols.length < 2) return { fecha: '', data: {} as HistDay, error: 'Fila inválida: ' + line.slice(0, 40) }

    // Try to find fecha (YYYY-MM-DD format)
    const fechaCol = cols.find(c => /^\d{4}-\d{2}-\d{2}$/.test(c))
    if (!fechaCol) return { fecha: '', data: {} as HistDay, error: 'Sin fecha válida: ' + line.slice(0, 40) }

    const nums = cols.filter(c => /^[\d.]+$/.test(c)).map(Number)
    return {
      fecha: fechaCol,
      data: {
        ventaNeta:  nums[0] ?? 0,
        ventaBruta: nums[1] ?? nums[0] ?? 0,
        iva:        nums[2] ?? 0,
        serv:       nums[3] ?? 0,
        salon:      nums[4] ?? nums[0] ?? 0,
        delivery:   nums[5] ?? 0,
        pax:        Math.round(nums[6] ?? 0),
        promPax:    nums[7] ?? (nums[6] > 0 ? (nums[0] ?? 0) / nums[6] : 0),
        source:     'hist' as const,
      },
    }
  }).filter(r => r.fecha)
}

export default function VentasHistImport() {
  const { profile }       = useAuth()
  const [rows, setRows]   = useState<ParsedRow[]>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]     = useState<string | null>(null)
  const [preview, setPreview] = useState(false)

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const parsed = parseCSV(text)
      setRows(parsed)
      setPreview(true)
      setMsg(null)
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const parsed = parseCSV(ev.target?.result as string)
      setRows(parsed)
      setPreview(true)
    }
    reader.readAsText(file)
  }, [])

  const handleSave = async () => {
    if (!profile || !rows.length) return
    setSaving(true)
    setMsg(null)
    try {
      const hist: Record<string, HistDay> = {}
      rows.filter(r => !r.error).forEach(r => { hist[r.fecha] = r.data })
      await saveVentasHist(hist)
      setMsg(`✓ ${Object.keys(hist).length} días importados a ventas_hist`)
      setRows([])
      setPreview(false)
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : 'Error'}`)
    } finally {
      setSaving(false)
    }
  }

  const validRows  = rows.filter(r => !r.error)
  const errorRows  = rows.filter(r => r.error)

  return (
    <div>
      <div className="vt-sl" style={{ marginBottom: '0.75rem' }}>Importar datos históricos</div>

      {/* Info box */}
      <div style={{ padding: '0.875rem 1rem', background: 'rgba(42,122,106,0.07)', borderLeft: '3px solid var(--vt-green)', borderRadius: '0 2px 2px 0', marginBottom: '1.25rem', fontSize: '0.82rem', lineHeight: 1.6 }}>
        <strong>Formato CSV esperado:</strong> una fila por día con columnas en este orden:<br />
        <code style={{ fontSize: '0.72rem', background: 'rgba(0,0,0,0.05)', padding: '0.1rem 0.3rem', borderRadius: 2 }}>
          fecha, ventaNeta, ventaBruta, iva, servicio, salon, delivery, pax, promPax
        </code>
        <br />
        La <strong>fecha</strong> debe estar en formato <code>YYYY-MM-DD</code>.
        Podés exportar desde la planilla de Google Sheets de SATORI DASHBOARD como CSV.
      </div>

      {/* Drop zone */}
      {!preview && (
        <div
          onDragOver={e => { e.preventDefault() }}
          onDrop={handleDrop}
          style={{
            border: '2px dashed var(--vt-border)',
            borderRadius: 3,
            padding: '3rem 2rem',
            textAlign: 'center',
            cursor: 'pointer',
            background: 'var(--vt-paper)',
            marginBottom: '1rem',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
          <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>Arrastrá el CSV aquí</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--vt-muted)', marginBottom: '0.875rem' }}>
            o hacé click para seleccionar el archivo
          </div>
          <label className="tips-btn-teal" style={{ cursor: 'pointer', fontSize: '0.82rem' }}>
            Seleccionar CSV
            <input type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: 'none' }} />
          </label>
        </div>
      )}

      {/* Preview */}
      {preview && rows.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <div style={{ fontSize: '0.82rem' }}>
              <strong style={{ color: 'var(--vt-green)' }}>{validRows.length} días válidos</strong>
              {errorRows.length > 0 && <span style={{ color: 'var(--vt-red)', marginLeft: '0.5rem' }}>{errorRows.length} con error</span>}
            </div>
            <button className="tips-btn-ghost" style={{ fontSize: '0.75rem' }}
              onClick={() => { setRows([]); setPreview(false) }}>
              Cancelar
            </button>
          </div>

          <div className="vt-tbl-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
            <table className="vt-tbl">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="r">Venta Neta</th>
                  <th className="r">PAX</th>
                  <th className="r">Prom/PAX</th>
                  <th className="r">Salón</th>
                  <th className="r">Delivery</th>
                </tr>
              </thead>
              <tbody>
                {validRows.slice(0, 50).map(r => (
                  <tr key={r.fecha}>
                    <td>{r.fecha}</td>
                    <td className="r">₡ {Math.round(r.data.ventaNeta).toLocaleString('es-CR')}</td>
                    <td className="r">{r.data.pax}</td>
                    <td className="r">₡ {Math.round(r.data.promPax).toLocaleString('es-CR')}</td>
                    <td className="r">₡ {Math.round(r.data.salon).toLocaleString('es-CR')}</td>
                    <td className="r">₡ {Math.round(r.data.delivery).toLocaleString('es-CR')}</td>
                  </tr>
                ))}
                {validRows.length > 50 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: '#888', fontSize: '0.78rem' }}>
                    ... y {validRows.length - 50} filas más
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {errorRows.length > 0 && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--vt-red)' }}>
              {errorRows.slice(0, 3).map((r, i) => <div key={i}>✗ {r.error}</div>)}
              {errorRows.length > 3 && <div>... y {errorRows.length - 3} más</div>}
            </div>
          )}

          <button className="tips-btn-teal"
            style={{ marginTop: '0.875rem', fontSize: '0.85rem' }}
            disabled={saving || validRows.length === 0}
            onClick={handleSave}>
            {saving ? '⟳ Importando…' : `✓ Importar ${validRows.length} días a historial`}
          </button>
        </div>
      )}

      {msg && (
        <div style={{ padding: '0.625rem 0.875rem', background: msg.startsWith('✓') ? 'rgba(78,164,126,0.1)' : 'rgba(192,57,43,0.1)', borderRadius: 2, fontSize: '0.82rem', color: msg.startsWith('✓') ? 'var(--vt-green)' : 'var(--vt-red)', fontWeight: 600 }}>
          {msg}
        </div>
      )}

      {/* Template download */}
      <div style={{ marginTop: '1rem', fontSize: '0.72rem', color: 'var(--vt-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span>💡</span>
        <span>
          Podés generar el CSV desde Google Sheets:
          seleccionás las columnas correctas → Archivo → Descargar → CSV.
        </span>
      </div>
    </div>
  )
}
