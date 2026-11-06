// Sección «Libros» del módulo SoP: descarga del Libro del empleado (todos) y del
// Libro de franquicia (solo owner y manager). La UI oculta el botón y, además, la
// policy de Storage (mig 077) rechaza la firma del libro de franquicia a otros roles.

import { useState } from 'react'
import { abrirPdf, librosVisibles } from './sopsPdf'

export default function SopLibros({ rol }: { rol: string | null | undefined }) {
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const libros = librosVisibles(rol)

  const abrir = async (id: string, ruta: string, archivo: string) => {
    setAbriendo(id); setError(null); setLink(null)
    try { setLink(await abrirPdf(ruta, archivo)) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo abrir el libro.') }
    finally { setAbriendo(null) }
  }

  return (
    <section className="sop-libros" aria-label="Libros">
      <div className="sop-libros-tit">Libros</div>
      <div className="sop-libros-lista">
        {libros.map(l => (
          <button key={l.id} className="sop-libro" onClick={() => abrir(l.id, l.ruta, l.archivo)} disabled={abriendo !== null}>
            <span className="sop-libro-nombre">{l.nombre}</span>
            <span className="sop-libro-accion">{abriendo === l.id ? 'Abriendo…' : 'Descargar PDF'}</span>
          </button>
        ))}
      </div>
      {error && <div className="sop-libros-error">No se pudo abrir: {error}</div>}
      {link && <div className="sop-libros-aviso">El navegador bloqueó la pestaña. <a href={link} target="_blank" rel="noopener noreferrer">Abrir el libro</a></div>}
    </section>
  )
}
