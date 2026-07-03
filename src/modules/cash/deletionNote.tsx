import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode, FormEvent } from 'react'

/**
 * Nota de motivo OBLIGATORIA para borrar un movimiento de caja, vía modal in-app.
 *
 * Reemplaza al viejo `window.prompt`: en MÓVIL el prompt corría DESPUÉS de awaits
 * (confirm → requireManager → prompt) → fuera del gesto del usuario, y los navegadores
 * móviles lo suprimen → note=null → el borrado salía en silencio. Un modal React no
 * depende del gesto, así que funciona igual en teléfono y PC.
 *
 * Mismo patrón que ManagerOverride: un Provider que monta el modal + un hook
 * useDeletionNote() que devuelve askNote(context) => Promise<string|null>. La nota
 * saneada se exige NO vacía; si el usuario cancela o la deja vacía → resuelve null y
 * el caller ABORTA el borrado (no se borra sin motivo registrado). El borrado en sí
 * (delete_movement_cascade, mig 039) queda intacto: arrastra el inventario ligado y
 * guarda la nota en movement_deletions (auditoría).
 */
type AskNote = (context?: string) => Promise<string | null>
const Ctx = createContext<AskNote>(() => Promise.resolve(null))

/** Devuelve `askNote(context?)` que resuelve la nota saneada, o null si se cancela/vacía. */
export const useDeletionNote = () => useContext(Ctx)

type Pending = { context?: string; resolve: (note: string | null) => void }

export function DeletionNoteProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)

  const askNote = useCallback<AskNote>((context?: string) =>
    new Promise<string | null>(resolve => setPending({ context, resolve })), [])

  const finish = (note: string | null) => { pending?.resolve(note); setPending(null) }

  return (
    <Ctx.Provider value={askNote}>
      {children}
      {pending && <DeletionNoteModal context={pending.context} onResult={finish} />}
    </Ctx.Provider>
  )
}

function DeletionNoteModal({ context, onResult }: { context?: string; onResult: (note: string | null) => void }) {
  const [note, setNote] = useState('')
  const label = context
    ? `Motivo del borrado (${context}) — OBLIGATORIO para la auditoría`
    : 'Motivo del borrado — OBLIGATORIO para la auditoría'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const clean = note.trim()
    if (!clean) return   // exige no vacío (defensa extra; el botón ya está deshabilitado)
    onResult(clean)
  }

  return (
    <div className="cd-modal-overlay" onClick={() => onResult(null)}>
      <form className="cd-modal" onClick={e => e.stopPropagation()} onSubmit={submit} style={{ maxWidth: 420 }}>
        <div className="cd-modal-title">🗑 Motivo del borrado</div>
        <p style={{ fontSize: '0.8rem', color: 'var(--t-muted)', margin: '0 0 0.75rem' }}>
          {label}. Queda registrado en la auditoría (el borrado arrastra el inventario ligado).
        </p>
        <textarea className="tips-input-dark" autoFocus value={note} onChange={e => setNote(e.target.value)}
          rows={3} placeholder="Por qué se borra…" style={{ width: '100%', resize: 'vertical' }} />
        <div className="cd-modal-actions" style={{ marginTop: '0.875rem' }}>
          <button type="button" className="tips-btn-ghost" onClick={() => onResult(null)}>Cancelar</button>
          <button type="submit" className="cd-btn-green" disabled={!note.trim()}>Borrar</button>
        </div>
      </form>
    </div>
  )
}
