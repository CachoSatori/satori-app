/** Negocios (owner, manager): lista, alta y edición, y cantidad de miembros. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getNegocios, getMiembros, guardarNegocio, aClubError, type ClubNegocio, type ClubMiembro, type TipoNegocio } from '../../shared/api/club'
import { Aviso, Btn, Card, Chip } from './ui'
import { C, inputStyle, labelStyle, TIPO_NEGOCIO_LABEL } from './estilos'

type Edit = { id: string | null; nombre: string; tipo: TipoNegocio; activo: boolean }

export default function Negocios() {
  const [negocios, setNegocios] = useState<ClubNegocio[]>([])
  const [miembros, setMiembros] = useState<ClubMiembro[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    try {
      const [n, m] = await Promise.all([getNegocios(), getMiembros()])
      setNegocios(n); setMiembros(m)
    } catch (e) { setError(aClubError(e).message) }
    finally { setCargando(false) }
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar() }, [cargar])

  const conteo = useMemo(() => {
    const c = new Map<string, number>()
    for (const m of miembros) if (m.negocio_id && m.estado === 'activo') c.set(m.negocio_id, (c.get(m.negocio_id) ?? 0) + 1)
    return c
  }, [miembros])

  async function guardar() {
    if (!edit) return
    setGuardando(true); setError(null)
    try { await guardarNegocio(edit); setEdit(null); await cargar() }
    catch (e) { setError(aClubError(e).message) }
    finally { setGuardando(false) }
  }

  return (
    <div className="tips-body" style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {error && <Aviso tono="error" onClose={() => setError(null)}>{error}</Aviso>}
      {edit ? (
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{edit.id ? 'Editar negocio' : 'Nuevo negocio'}</div>
          <label><span style={labelStyle}>Nombre</span>
            <input value={edit.nombre} onChange={e => setEdit({ ...edit, nombre: e.target.value })} style={inputStyle} />
          </label>
          <label><span style={labelStyle}>Tipo</span>
            <select value={edit.tipo} onChange={e => setEdit({ ...edit, tipo: e.target.value as TipoNegocio })} style={inputStyle}>
              {Object.entries(TIPO_NEGOCIO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={edit.activo} onChange={e => setEdit({ ...edit, activo: e.target.checked })} /> Activo
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="secondary" onClick={() => setEdit(null)} disabled={guardando} style={{ flex: 1 }}>Cancelar</Btn>
            <Btn onClick={guardar} disabled={guardando || !edit.nombre.trim()} style={{ flex: 2 }}>{guardando ? 'Guardando…' : 'Guardar'}</Btn>
          </div>
        </Card>
      ) : (
        <Btn onClick={() => setEdit({ id: null, nombre: '', tipo: 'hotel', activo: true })}>+ Nuevo negocio</Btn>
      )}
      {cargando ? <div style={{ textAlign: 'center', color: C.muted, padding: '2rem' }}>Cargando…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {negocios.length === 0 && <div style={{ color: C.muted, textAlign: 'center', padding: '1.5rem' }}>Todavía no hay negocios.</div>}
          {negocios.map(n => (
            <button key={n.id} onClick={() => setEdit({ id: n.id, nombre: n.nombre, tipo: n.tipo, activo: n.activo })}
              style={{ textAlign: 'left', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: '0.7rem 0.8rem', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong style={{ flex: 1 }}>{n.nombre}</strong>
              <Chip>{TIPO_NEGOCIO_LABEL[n.tipo]}</Chip>
              {!n.activo && <Chip color={C.red}>inactivo</Chip>}
              <span style={{ fontSize: '0.85rem', color: C.muted, minWidth: 80, textAlign: 'right' }}>
                {conteo.get(n.id) ?? 0} {(conteo.get(n.id) ?? 0) === 1 ? 'miembro' : 'miembros'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
