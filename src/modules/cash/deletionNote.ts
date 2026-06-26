// Nota de motivo OBLIGATORIA para borrar un movimiento de caja. El borrado corre por
// delete_movement_cascade (mig 039), que arrastra el inventario ligado y guarda la nota en
// movement_deletions (auditoría). Devuelve la nota saneada, o null si el usuario cancela o la
// deja vacía → en ese caso el caller ABORTA el borrado (no se borra sin motivo registrado).
export function askDeletionNote(context?: string): string | null {
  const label = context
    ? `Motivo del borrado (${context}) — OBLIGATORIO para la auditoría:`
    : 'Motivo del borrado — OBLIGATORIO para la auditoría:'
  const note = window.prompt(label)?.trim()
  return note ? note : null
}
