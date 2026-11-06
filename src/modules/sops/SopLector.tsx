// Lector de un SoP (modal de detalle) y su impresión, con el Estándar de SOP Satori:
// Cormorant Garamond en títulos, DM Sans en texto, tinta/gris/línea/panel, oro solo en
// líneas y en el texto de acento, laca solo en alertas. Títulos en minúscula normal.
//
// · «Ver PDF» abre el PDF del bucket con una URL firmada (10 min). En los documentos
//   tipo «Documento» (menú, platos, plano…) es la acción principal y el texto queda
//   plegado: el markdown no tiene las fotos y se lee peor.
// · Imprimir usa la misma página (no una ventana nueva), así las fuentes ya están
//   cargadas: se monta una copia para imprimir en <body> y el CSS de impresión oculta
//   el resto de la app.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import DOMPurify from 'dompurify'
import '@fontsource/cormorant-garamond/latin-500.css'
import '@fontsource/cormorant-garamond/latin-600.css'
import '@fontsource/cormorant-garamond/latin-500-italic.css'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import type { SOP } from '../../shared/api/sops'
import { renderContent } from './sopsRender'
import { etiquetaCodigo, grupoDe, nombreCorto } from './sopsOrden'
import { abrirPdf, mesVersion } from './sopsPdf'

function htmlSeguro(content: string): string {
  return DOMPurify.sanitize(renderContent(content), { ADD_ATTR: ['target'] })
}

interface Props {
  sop: SOP
  canEdit: boolean
  onClose: () => void
  onEdit: () => void
}

export default function SopLector({ sop, canEdit, onClose, onEdit }: Props) {
  const esDocumento = sop.doc_type === 'Documento'
  const tienePdf = !!sop.pdf_path
  const pdfPrincipal = esDocumento && tienePdf
  const [verTexto, setVerTexto] = useState(!pdfPrincipal)
  const [abriendo, setAbriendo] = useState(false)
  const [errorPdf, setErrorPdf] = useState<string | null>(null)
  const [linkPdf, setLinkPdf] = useState<string | null>(null)
  const [imprimiendo, setImprimiendo] = useState(false)

  const etiqueta = etiquetaCodigo(sop)
  const area = nombreCorto(grupoDe(sop))
  const mes = mesVersion(sop.version)

  const verPdf = async () => {
    if (!sop.pdf_path) return
    setAbriendo(true); setErrorPdf(null); setLinkPdf(null)
    try { setLinkPdf(await abrirPdf(sop.pdf_path)) }
    catch (e) { setErrorPdf(e instanceof Error ? e.message : 'No se pudo abrir el PDF.') }
    finally { setAbriendo(false) }
  }

  // Impresión en la misma página: montar la copia, imprimir y desmontar.
  useEffect(() => {
    if (!imprimiendo) return
    document.body.classList.add('sop-imprimiendo')
    const fin = () => { document.body.classList.remove('sop-imprimiendo'); setImprimiendo(false) }
    window.addEventListener('afterprint', fin, { once: true })
    const t = window.setTimeout(() => window.print(), 50)
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', fin); document.body.classList.remove('sop-imprimiendo') }
  }, [imprimiendo])

  // Escape cierra el lector.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const botonPdf = tienePdf && (
    <button className={pdfPrincipal ? 'sopl-btn sopl-btn-principal' : 'sopl-btn'} onClick={verPdf} disabled={abriendo}>
      {abriendo ? 'Abriendo…' : 'Ver PDF'}
    </button>
  )

  return (
    <div className="sop-overlay" onClick={onClose}>
      <div className="sop-lector" role="dialog" aria-modal="true" aria-label={sop.title} onClick={e => e.stopPropagation()}>
        <header className="sopl-head">
          <div className="sopl-head-txt">
            <div className="sopl-kicker">{[etiqueta, area, mes].filter(Boolean).join(' · ')}</div>
            <h2 className="sopl-titulo">{sop.title}</h2>
          </div>
          <button className="sopl-cerrar" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>

        <div className="sopl-acciones">
          {botonPdf}
          {!pdfPrincipal && <button className="sopl-btn" onClick={() => setImprimiendo(true)}>Imprimir</button>}
          {canEdit && <button className="sopl-btn sopl-btn-suave" onClick={onEdit}>Editar</button>}
        </div>
        {errorPdf && <div className="sopl-aviso sopl-aviso-alerta">No se pudo abrir el PDF: {errorPdf}</div>}
        {linkPdf && (
          <div className="sopl-aviso">
            El navegador bloqueó la pestaña. <a href={linkPdf} target="_blank" rel="noopener noreferrer">Abrir el PDF</a>
          </div>
        )}

        <div className="sopl-cuerpo">
          {pdfPrincipal && (
            <div className="sopl-doc-nota">
              Este documento tiene fotos y diseño que el texto no muestra: leelo en el PDF.
              <button className="sopl-link" onClick={() => setVerTexto(v => !v)}>
                {verTexto ? 'Ocultar el texto' : 'Ver solo el texto'}
              </button>
            </div>
          )}
          {verTexto && <div className="sopl-contenido" dangerouslySetInnerHTML={{ __html: htmlSeguro(sop.content) }} />}
        </div>
      </div>

      {imprimiendo && createPortal(
        <div id="sop-print-root" className="sopl-print">
          <div className="sopl-print-cab">
            <div className="sopl-print-marca">Satori</div>
            <div className="sopl-print-ref">
              <div>Procedimientos operativos</div>
              <div>{[etiqueta, sop.title, mes].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
          <h1 className="sopl-titulo sopl-print-titulo">{sop.title}</h1>
          <div className="sopl-contenido" dangerouslySetInnerHTML={{ __html: htmlSeguro(sop.content) }} />
          <div className="sopl-print-pie">Satori, {etiqueta ?? 'SOP'} {sop.title.toLowerCase()}{mes ? `, ${mes}` : ''}</div>
        </div>,
        document.body,
      )}
    </div>
  )
}
