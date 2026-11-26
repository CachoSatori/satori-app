// Ventas → Ajustes → «Catálogo» (Ventas v2 3.1b; SPEC-3.1-catalogo §1.3, D-5 = B). Reemplaza a «Ajustes → Productos»
// (`VentasConfig.tsx`, retirada): todos los productos que el PoS facturó en el local, por CÓDIGO (mig 198), con buscador
// y filtros. Por producto se editan dos cosas: cuántas personas RINDE y la CATEGORÍA (cuando no es la de su familia).
// Ninguna de las dos cambia la venta neta (la decide la familia de cada línea). El costo ya no se carga acá (D-6 = A).
//
// Quién: owner y manager (este, solo de sus locales: lo cuidan `getLocalesVentas` y la base). El contador no ve la vista
// (D-7). El NOMBRE de una familia lo cambia solo el owner (mig 202).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../shared/hooks/useAuth'
import { todayCR } from '../../shared/utils'
import { alEscribir, errorDeNumeros, leerCuadro, valorInput } from '../../shared/cuadrosNumericos'
import {
  getCatalogoProductos, guardarAjusteProducto, guardarNombreFamilia, type CatalogoProductosRpc,
} from '../../shared/api/posNdf'
import { getLocalesVentas, type LocalVentas } from './resumenV2Datos'
import { LOCAL_POR_DEFECTO } from './ventasDiasDesdePos'
import { localPorDefecto } from '../../shared/utils/ordenLocales'
import { CATEGORIAS } from './catalogoPos'
import {
  armarCatalogo, errorNombreFamilia, fichaConCategoria, fichaConRinde, filtrarCatalogo, mensajeError, normalizarNombreFamilia,
  rotuloCategoria, FILTROS_VACIOS, DIAS_NUEVO, POR_PAGINA, RINDE_MAX, RINDE_MIN, ROLES_EDITAN_CATALOGO,
  type FilaCatalogo, type Ficha, type FiltrosCatalogo,
} from './catalogoAjustes'
import './ventasCatalogo.css'

/** Lo leído, con el local y la vuelta a la que corresponde: lo de otro local (o de antes de «Reintentar») no se muestra. */
type Leido = { local: string; vuelta: number } & ({ tipo: 'error'; msg: string } | { tipo: 'listo'; rpc: CatalogoProductosRpc })
type Estado = { tipo: 'cargando' } | { tipo: 'sinLocal' } | Leido

const REGLA_RINDE = { entero: true, min: RINDE_MIN, max: RINDE_MAX } as const

export default function VentasCatalogo() {
  const { profile } = useAuth()
  const role = profile?.role ?? ''
  const edita = ROLES_EDITAN_CATALOGO.includes(role)
  const editaFamilias = role === 'owner'

  const [locales, setLocales] = useState<LocalVentas[] | null>(null)
  const [local, setLocal] = useState<string>(LOCAL_POR_DEFECTO)
  const [leido, setLeido] = useState<Leido | null>(null)
  const [recarga, setRecarga] = useState(0)
  /** Vuelta de «Reintentar» (un error viejo no tapa la carga nueva). Releer después de guardar no la cambia. */
  const [vuelta, setVuelta] = useState(0)
  const [filtros, setFiltros] = useState<FiltrosCatalogo>(FILTROS_VACIOS)
  const [pagina, setPagina] = useState(1)
  /** Lo que se está guardando, por código (la fila muestra esto mientras tanto). */
  const [pendiente, setPendiente] = useState<Record<string, Ficha>>({})
  /** Lo que la persona está escribiendo en «rinde» (NaN = ilegible, '' = vacío). */
  const [borrador, setBorrador] = useState<Record<string, number | ''>>({})
  const [errorFila, setErrorFila] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)

  // Locales que el rol puede ver (el manager, solo los suyos). Santa Teresa primero (D16).
  useEffect(() => {
    let vivo = true
    getLocalesVentas(role).then(l => {
      if (!vivo) return
      setLocales(l)
      if (l.length) setLocal(act => localPorDefecto(l, act) ?? act)
    }).catch(() => { if (vivo) setLocales([]) })
    return () => { vivo = false }
  }, [role])

  const sinLocales = locales !== null && locales.length === 0 && role === 'manager'
  useEffect(() => {
    if (locales === null || sinLocales) return
    let vivo = true
    const v = vuelta
    getCatalogoProductos(local)
      .then(rpc => { if (vivo) setLeido({ local, vuelta: v, tipo: 'listo', rpc }) })
      .catch(e => { if (vivo) setLeido({ local, vuelta: v, tipo: 'error', msg: e instanceof Error ? e.message : 'No se pudo leer el catálogo' }) })
    return () => { vivo = false }
  }, [local, locales, sinLocales, recarga, vuelta])

  // Mientras llega el catálogo de OTRO local (o el de «Reintentar») no se muestra el anterior: no se edita lo que no es.
  const estado: Estado = sinLocales ? { tipo: 'sinLocal' }
    : leido && leido.local === local && (leido.tipo === 'listo' || leido.vuelta === vuelta) ? leido
    : { tipo: 'cargando' }

  const hoy = todayCR()
  const rpc = estado.tipo === 'listo' ? estado.rpc : null
  const filas = useMemo(() => (rpc ? armarCatalogo(rpc, hoy) : []), [rpc, hoy])
  const filtradas = useMemo(() => filtrarCatalogo(filas, filtros), [filas, filtros])
  const visibles = filtradas.slice(0, pagina * POR_PAGINA)
  const familiasSinFila = useMemo(
    () => [...new Set(filas.filter(f => f.familiaSinFila).map(f => f.familia as number))].sort((a, b) => a - b), [filas])
  const familiasConProductos = useMemo(() => {
    const vistas = new Set(filas.map(f => f.familia).filter((f): f is number => f !== null))
    return [...vistas].sort((a, b) => a - b)
  }, [filas])

  const releer = () => setRecarga(x => x + 1)
  const reintentar = () => setVuelta(x => x + 1)
  const elegirLocal = (l: string) => { setLocal(l); setPagina(1); setPendiente({}); setBorrador({}); setErrorFila({}); setAviso(null); setHecho(null) }

  const guardar = useCallback(async (p: FilaCatalogo, ficha: Ficha) => {
    setAviso(null); setHecho(null)
    setErrorFila(prev => { const n = { ...prev }; delete n[p.codigo]; return n })
    setPendiente(prev => ({ ...prev, [p.codigo]: ficha }))
    try {
      await guardarAjusteProducto(local, p.codigo, ficha.rinde, ficha.categoria)
      setHecho(`Guardado: ${p.nombre}.`)
      releer()
    } catch (e) {
      const msg = mensajeError(e)
      setErrorFila(prev => ({ ...prev, [p.codigo]: msg }))
      setAviso(`${p.nombre}: ${msg} Quedó como estaba.`)
    } finally {
      setPendiente(prev => { const n = { ...prev }; delete n[p.codigo]; return n })
      setBorrador(prev => { const n = { ...prev }; delete n[p.codigo]; return n })
    }
  }, [local])

  const elegirCategoria = (p: FilaCatalogo, valor: string) => {
    const ficha = fichaConCategoria(p, valor)
    if (ficha) void guardar(p, ficha)
  }

  const avisoRinde = (p: FilaCatalogo): string | null => {
    if (!(p.codigo in borrador)) return null
    return errorDeNumeros([{ nombre: `Rinde · ${p.nombre}`, valor: borrador[p.codigo], ...REGLA_RINDE }])
  }
  const confirmarRinde = (p: FilaCatalogo) => {
    if (!(p.codigo in borrador)) return
    if (avisoRinde(p)) return            // fuera de 1–20 o ilegible: no se manda
    const ficha = fichaConRinde(p, borrador[p.codigo])
    if (ficha) void guardar(p, ficha)
    else setBorrador(prev => { const n = { ...prev }; delete n[p.codigo]; return n })
  }

  const filtro = <K extends keyof FiltrosCatalogo>(k: K, v: FiltrosCatalogo[K]) => { setFiltros(f => ({ ...f, [k]: v })); setPagina(1) }

  return (
    <div className="vt-section vc-catalogo">
      <div className="vt-sl">Catálogo</div>
      <p className="vt2-nota">
        Todos los productos que el PoS facturó en este local, por código. La categoría sale de su familia del PoS; acá
        podés cambiar dos cosas por producto: <strong>cuántas personas rinde</strong> y la <strong>categoría</strong>.
        Ninguna de las dos cambia la venta neta. El costo ya no se carga acá: queda el que estaba y se actualiza desde
        Inventario → Recetas.
      </p>
      <p className="vt2-nota">
        Lo que cambiés acá todavía no se ve en «Mix» ni en «Ing. Menú»: lo va a leer la pantalla nueva de Productos.
      </p>

      {locales && locales.length > 1 && (
        <label className="vt2-campo"><span>Local</span>
          <select className="date-filter" aria-label="Local" value={local} onChange={e => elegirLocal(e.target.value)}>
            {locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </label>
      )}

      {estado.tipo === 'cargando' && <div className="vt2-cargando" role="status">Leyendo el catálogo…</div>}
      {estado.tipo === 'sinLocal' && <div className="vt2-aviso" role="alert">No tenés ningún local asignado: pedile al dueño que te asigne uno.</div>}
      {estado.tipo === 'error' && (
        <div className="vt2-aviso" role="alert">
          No se pudo leer el catálogo ({estado.msg}).{' '}
          <button type="button" className="vt-period-btn" onClick={reintentar}>Reintentar</button>
        </div>
      )}

      {rpc && (
        <>
          {aviso && <div className="vt2-aviso" role="alert">{aviso}</div>}
          {hecho && !aviso && <div className="vt2-nota" role="status">{hecho}</div>}
          {familiasSinFila.length > 0 && (
            <div className="vt2-aviso" role="note">
              Hay productos de {familiasSinFila.map(f => `la familia ${f}`).join(', ')}, que todavía no tiene fila: salen
              como «Familia N» en «Otros». Su venta ya cuenta; la familia se carga con una migración.
            </div>
          )}

          {filas.length === 0 ? (
            <p className="vt2-nota" data-estado="vacio">
              Todavía no hay productos de este local en el catálogo: aparecen solos con la primera factura del PoS.
            </p>
          ) : (
            <>
              <div className="vc-filtros">
                <label className="vt2-campo vc-buscar"><span>Buscar</span>
                  <input className="date-filter" type="search" aria-label="Buscar producto" placeholder="Nombre o código"
                    value={filtros.buscar} onChange={e => filtro('buscar', e.target.value)} />
                </label>
                <label className="vt2-campo"><span>Categoría</span>
                  <select className="date-filter" aria-label="Filtrar por categoría" value={filtros.categoria}
                    onChange={e => filtro('categoria', e.target.value)}>
                    <option value="">Todas</option>
                    {CATEGORIAS.map(c => <option key={c} value={c}>{rotuloCategoria(c)}</option>)}
                  </select>
                </label>
                <label className="vt2-campo"><span>Familia</span>
                  <select className="date-filter" aria-label="Filtrar por familia" value={filtros.familia ?? ''}
                    onChange={e => filtro('familia', e.target.value === '' ? null : Number(e.target.value))}>
                    <option value="">Todas</option>
                    {familiasConProductos.map(f => (
                      <option key={f} value={f}>{f} · {filas.find(x => x.familia === f)?.familiaNombre}</option>
                    ))}
                  </select>
                </label>
                <label className="vc-check">
                  <input type="checkbox" checked={filtros.cambiados} onChange={e => filtro('cambiados', e.target.checked)} />
                  Los que cambié
                </label>
                <label className="vc-check">
                  <input type="checkbox" checked={filtros.nuevos} onChange={e => filtro('nuevos', e.target.checked)} />
                  Nuevos (últimos {DIAS_NUEVO} días)
                </label>
              </div>
              <p className="vt2-nota" aria-live="polite">{filtradas.length} de {filas.length} productos</p>

              {filtradas.length === 0 ? (
                <p className="vt2-nota" data-estado="sin-resultados">Ningún producto con estos filtros.</p>
              ) : (
                <ul className="vc-lista" aria-label="Productos del catálogo">
                  {visibles.map(p => (
                    <FilaProducto key={p.codigo} p={p} edita={edita} pendiente={pendiente[p.codigo]}
                      borrador={borrador[p.codigo]} tieneBorrador={p.codigo in borrador}
                      avisoRinde={avisoRinde(p)} error={errorFila[p.codigo]}
                      editables={rpc.categoriasEditables}
                      onCategoria={v => elegirCategoria(p, v)}
                      onRinde={v => setBorrador(prev => ({ ...prev, [p.codigo]: v }))}
                      onConfirmarRinde={() => confirmarRinde(p)} />
                  ))}
                </ul>
              )}
              {visibles.length < filtradas.length && (
                <button type="button" className="vt-period-btn" onClick={() => setPagina(x => x + 1)}>
                  Mostrar {Math.min(POR_PAGINA, filtradas.length - visibles.length)} más
                </button>
              )}
            </>
          )}

          <Familias rpc={rpc} local={local} edita={editaFamilias} onGuardado={releer} />
        </>
      )}
    </div>
  )
}

interface FilaProps {
  p: FilaCatalogo
  edita: boolean
  pendiente: Ficha | undefined
  borrador: number | '' | undefined
  tieneBorrador: boolean
  avisoRinde: string | null
  error: string | undefined
  editables: readonly string[]
  onCategoria: (v: string) => void
  onRinde: (v: number | '') => void
  onConfirmarRinde: () => void
}

function FilaProducto({ p, edita, pendiente, borrador, tieneBorrador, avisoRinde, error, editables, onCategoria, onRinde, onConfirmarRinde }: FilaProps) {
  const guardando = !!pendiente
  const valorCategoria = pendiente ? (pendiente.categoria ?? '') : (p.categoriaPropia ?? '')
  const valorRinde = pendiente ? pendiente.rinde : tieneBorrador ? borrador : p.rinde
  return (
    <li className="vc-fila" data-codigo={p.codigo}>
      <div className="vc-producto">
        <span className="vc-nombre">{p.nombre}</span>
        {p.nuevo && <span className="vc-marca">Nuevo</span>}
        {p.cambiado && <span className="vc-marca vc-marca-cambio">Cambiado</span>}
        <span className="vc-sub">Código {p.codigo} · {p.familia ?? '—'} {p.familiaNombre}</span>
      </div>
      <div className="vc-controles">
        <label className="vt2-campo"><span>Categoría</span>
          {p.bloqueada || !edita ? (
            <span className="vc-fija" aria-label={`Categoría · ${p.nombre}`}>
              {rotuloCategoria(p.categoria)}{p.bloqueada ? ' (la fija su familia)' : ''}
            </span>
          ) : (
            <select className="date-filter" aria-label={`Categoría · ${p.nombre}`} value={valorCategoria} disabled={guardando}
              onChange={e => onCategoria(e.target.value)}>
              <option value="">De su familia ({rotuloCategoria(p.categoriaFamilia)})</option>
              {editables.map(c => <option key={c} value={c}>{rotuloCategoria(c)}</option>)}
            </select>
          )}
        </label>
        <label className="vt2-campo vc-rinde"><span>Rinde</span>
          {edita ? (
            <input className="date-filter" type="number" min={RINDE_MIN} max={RINDE_MAX} step={1} inputMode="numeric"
              aria-label={`Rinde · ${p.nombre}`} disabled={guardando} value={valorInput(valorRinde ?? '')}
              {...alEscribir(el => onRinde(leerCuadro(el)))}
              onBlur={onConfirmarRinde}
              onKeyDown={e => { if (e.key === 'Enter') onConfirmarRinde() }} />
          ) : <span className="vc-fija">{p.rinde}</span>}
        </label>
        {guardando && <span className="vc-estado" role="status">Guardando…</span>}
      </div>
      {avisoRinde && <div className="vt2-aviso" role="alert">{avisoRinde}</div>}
      {error && <div className="vt2-aviso" role="alert">{error}</div>}
    </li>
  )
}

function Familias({ rpc, local, edita, onGuardado }: { rpc: CatalogoProductosRpc; local: string; edita: boolean; onGuardado: () => void }) {
  const [editando, setEditando] = useState<number | null>(null)
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  if (rpc.familias.length === 0) return null

  const abrir = (familia: number, nombre: string) => { setEditando(familia); setTexto(nombre); setError(null) }
  const guardar = async (familia: number, actual: string) => {
    const err = errorNombreFamilia(texto)
    if (err) { setError(err); return }
    const nombre = normalizarNombreFamilia(texto)
    if (nombre === actual) { setEditando(null); return }
    setGuardando(true); setError(null)
    try {
      await guardarNombreFamilia(local, familia, nombre)
      setEditando(null)
      onGuardado()
    } catch (e) {
      setError(mensajeError(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <details className="vc-familias">
      <summary>Familias del PoS ({rpc.familias.length})</summary>
      <p className="vt2-nota">
        La familia decide la categoría por defecto de sus productos y qué es venta. {edita
          ? 'Acá podés cambiar solo el nombre que se muestra (no mueve ningún número).'
          : 'El nombre lo cambia el dueño.'}
      </p>
      <ul className="vc-lista" aria-label="Familias del PoS">
        {rpc.familias.map(f => (
          <li key={f.familia} className="vc-fila">
            {editando === f.familia ? (
              <div className="vc-controles">
                <label className="vt2-campo vc-buscar"><span>Nombre de la familia {f.familia}</span>
                  <input className="date-filter" aria-label={`Nombre de la familia ${f.familia}`} value={texto} maxLength={60}
                    onChange={e => setTexto(e.target.value)} disabled={guardando} />
                </label>
                <button type="button" className="vt-period-btn active" disabled={guardando} onClick={() => guardar(f.familia, f.nombre)}>
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
                <button type="button" className="vt-period-btn" disabled={guardando} onClick={() => setEditando(null)}>Cancelar</button>
                {error && <div className="vt2-aviso" role="alert">{error}</div>}
              </div>
            ) : (
              <div className="vc-producto">
                <span className="vc-nombre">{f.familia} · {f.nombre}</span>
                <span className="vc-sub">{rotuloCategoria(f.categoria)}</span>
                {edita && (
                  <button type="button" className="vt-period-btn" aria-label={`Cambiar el nombre de la familia ${f.familia}`}
                    onClick={() => abrir(f.familia, f.nombre)}>Cambiar nombre</button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}
