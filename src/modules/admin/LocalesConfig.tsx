// Admin → Locales (mig 195): el correo base de cada local. Con él, Admin → Usuarios arma el alias
// «base+nombre@dominio» para dar de alta a alguien sin correo propio. Escribe solo el owner (RLS de locations).
import { useCallback, useEffect, useState } from 'react'
import { getLocalesCorreo, guardarCorreoBase } from '../../shared/api/locales'
import { aliasCorreoEjemplo, validarCorreoBase, type LocalCorreo } from './aliasCorreo'

export default function LocalesConfig() {
  const [locales, setLocales] = useState<LocalCorreo[] | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [editando, setEditando] = useState<Record<string, string>>({})
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState<string | null>(null)
  const [guardado, setGuardado] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try { setErrorCarga(null); setLocales(await getLocalesCorreo()) }
    catch (e) { setErrorCarga(e instanceof Error ? e.message : 'No se pudieron leer los locales'); setLocales([]) }
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const valor = (l: LocalCorreo) => editando[l.id] ?? l.correo_base ?? ''

  const guardar = async (l: LocalCorreo) => {
    const v = validarCorreoBase(valor(l))
    if (!v.ok) { setErrores(x => ({ ...x, [l.id]: v.error })); return }
    setGuardando(l.id); setErrores(x => ({ ...x, [l.id]: '' })); setGuardado(null)
    try {
      const nuevo = await guardarCorreoBase(l.id, valor(l))
      setLocales(xs => (xs ?? []).map(x => x.id === l.id ? { ...x, correo_base: nuevo } : x))
      setEditando(x => { const { [l.id]: _, ...resto } = x; void _; return resto })
      setGuardado(l.id)
    } catch (e) {
      setErrores(x => ({ ...x, [l.id]: e instanceof Error ? e.message : 'No se pudo guardar' }))
    } finally { setGuardando(null) }
  }

  if (locales === null) return <p style={{ fontSize: '0.8rem', color: 'var(--c-gris)' }}>Cargando locales…</p>

  return (
    <div className="admin-section" style={{ maxWidth: 820 }}>
      <div className="admin-section-header">
        <span className="admin-section-title">Locales</span>
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--c-gris)', marginBottom: '1rem', lineHeight: 1.5 }}>
        <strong>Correo base</strong> del local: con él, Admin → Usuarios arma el alias para dar de alta a alguien sin
        correo propio (<code>base+nombre@dominio</code>). Sin «+» y sin espacios. Vacío = sin correo base.
      </p>
      {errorCarga && <p className="field-error" style={{ marginBottom: '0.75rem' }}>{errorCarga}</p>}

      <table className="admin-table">
        <thead>
          <tr><th>Local</th><th>Correo base</th><th>Alias de ejemplo</th><th /></tr>
        </thead>
        <tbody>
          {locales.map(l => {
            const v = valor(l)
            const cambiado = (l.id in editando) && v.trim() !== (l.correo_base ?? '')
            const previo = validarCorreoBase(v)
            return (
              <tr key={l.id}>
                <td>
                  {l.name}
                  {!l.is_active && <span style={{ marginLeft: '0.4rem', fontSize: '0.65rem', color: 'var(--c-gris)' }}>(apagado)</span>}
                </td>
                <td>
                  <input type="email" aria-label={`Correo base de ${l.name}`} value={v} disabled={guardando === l.id}
                    placeholder="local@ejemplo.com" maxLength={254}
                    onChange={e => { const t = e.target.value; setEditando(x => ({ ...x, [l.id]: t })); setGuardado(null) }} />
                  {errores[l.id] && <div className="field-error" role="alert">{errores[l.id]}</div>}
                </td>
                <td style={{ fontSize: '0.75rem' }}>
                  {previo.ok && previo.valor ? <code>{aliasCorreoEjemplo(previo.valor)}</code> : '—'}
                </td>
                <td>
                  {cambiado && (
                    <button className="btn-save-inline" disabled={guardando === l.id} onClick={() => void guardar(l)}>
                      {guardando === l.id ? 'Guardando…' : 'Guardar'}
                    </button>
                  )}
                  {guardado === l.id && !cambiado && <span style={{ fontSize: '0.75rem', color: 'var(--c-teal)' }}>✓ Guardado</span>}
                </td>
              </tr>
            )
          })}
          {locales.length === 0 && !errorCarga && (
            <tr><td colSpan={4} style={{ fontSize: '0.8rem', color: 'var(--c-gris)' }}>No hay locales cargados.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
