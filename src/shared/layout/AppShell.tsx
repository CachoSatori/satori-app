// Shell global (rediseño B3): menú lateral desde 1024 px y barra inferior en pantallas más chicas.
//
// Solo pantalla. El menú sale de `MODULES` con el mismo filtro por rol de la grilla del Inicio;
// no reemplaza ningún permiso: las rutas y `PrivateRoute` (App.tsx) siguen igual, y el aterrizaje
// del cajero lo sigue haciendo el Inicio. El personal con 3 módulos o menos no lleva menú.
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { ROLE_LABELS } from '../constants'
import { entradaDe, resolverTab } from '../../modules/ventas/ventasTabs'
import { barraPara, menuPara, type ItemMenu } from './modulos'
import { useMenuVisible } from './useMenuVisible'
import './AppShell.css'

const DARUMA = `${import.meta.env.BASE_URL}marca/daruma.png`

function esActivo(item: { to: string; entrada?: string }, pathname: string, search: string, role: string): boolean {
  const path = item.to.split('?')[0]
  if (path === '/') return pathname === '/'
  const enRuta = pathname === path || pathname.startsWith(path + '/')
  if (!enRuta) return false
  if (!item.entrada) return true
  const tab = resolverTab(role, new URLSearchParams(search).get('tab'))
  return entradaDe(tab).id === item.entrada
}

const INICIO = { to: '/', label: 'Inicio', kanji: '家' }

export default function AppShell({ children }: { children: React.ReactNode }) {
  const visible = useMenuVisible()
  const { profile, signOut } = useAuth()
  const { pathname, search } = useLocation()
  // La hoja «Más» queda abierta solo en la pantalla donde se abrió: al navegar se cierra sola.
  const aqui = pathname + search
  const [masEn, setMasEn] = useState<string | null>(null)
  const masAbierto = masEn === aqui
  const setMasAbierto = (v: boolean | ((prev: boolean) => boolean)) => {
    const abrir = typeof v === 'function' ? v(masAbierto) : v
    setMasEn(abrir ? aqui : null)
  }

  // Hoja «Más» accesible (B6, auditoría 202): al abrir, el foco va a «Cerrar»; Escape la cierra;
  // al cerrar, el foco vuelve al botón «Más».
  const masBotonRef  = useRef<HTMLButtonElement>(null)
  const cerrarRef    = useRef<HTMLButtonElement>(null)
  const estabaAbierto = useRef(false)
  useEffect(() => {
    if (masAbierto) {
      estabaAbierto.current = true
      cerrarRef.current?.focus()
      const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') setMasEn(null) }
      document.addEventListener('keydown', alTeclear)
      return () => document.removeEventListener('keydown', alTeclear)
    }
    if (estabaAbierto.current) {
      estabaAbierto.current = false
      masBotonRef.current?.focus()
    }
  }, [masAbierto])

  if (!visible || !profile) return <>{children}</>

  const role   = profile.role
  const grupos = menuPara(role)
  const barra  = barraPara(role)
  const activo = (i: { to: string; entrada?: string }) => esActivo(i, pathname, search, role)
  const directoActivo = barra.directos.some(m => activo({ to: m.path })) || activo(INICIO)

  const listaMenu = (alElegir?: () => void) => (
    <>
      <Link
        to="/"
        className={`shell-item ${activo(INICIO) ? 'activo' : ''}`}
        aria-current={activo(INICIO) ? 'page' : undefined}
        onClick={alElegir}
      >
        <span className="shell-item-kanji" aria-hidden="true">{INICIO.kanji}</span>
        {INICIO.label}
      </Link>
      {grupos.map(g => (
        <div key={g.id} className="shell-grupo">
          <div className="shell-grupo-titulo">{g.label}</div>
          {g.items.map((it: ItemMenu) => {
            const a = activo(it)
            return (
              <Link
                key={it.key}
                to={it.to}
                className={`shell-item ${a ? 'activo' : ''}`}
                aria-current={a ? 'page' : undefined}
                onClick={alElegir}
              >
                <span className="shell-item-kanji" aria-hidden="true">{it.kanji}</span>
                {it.label}
              </Link>
            )
          })}
        </div>
      ))}
    </>
  )

  return (
    <div className="shell">
      <nav className="shell-lateral" aria-label="Menú principal">
        <div className="shell-marca">
          <img src={DARUMA} alt="" className="shell-daruma" width={28} height={31} />
          <span className="shell-marca-nombre">Satori</span>
        </div>
        <div className="shell-lista">{listaMenu()}</div>
        <div className="shell-usuario">
          <span className="shell-usuario-nombre">{profile.full_name}</span>
          <span className="shell-usuario-rol">{ROLE_LABELS[role] ?? role}</span>
          <button type="button" className="shell-salir" onClick={signOut}>Cerrar sesión</button>
        </div>
      </nav>

      <div className="shell-contenido">{children}</div>

      <nav className="shell-barra" aria-label="Menú principal">
        <Link
          to="/"
          className={`shell-boton ${activo(INICIO) ? 'activo' : ''}`}
          aria-current={activo(INICIO) ? 'page' : undefined}
        >
          <span className="shell-boton-kanji" aria-hidden="true">{INICIO.kanji}</span>
          <span className="shell-boton-label">{INICIO.label}</span>
        </Link>
        {barra.directos.map(m => {
          const a = activo({ to: m.path })
          return (
            <Link
              key={m.id}
              to={m.path}
              className={`shell-boton ${a ? 'activo' : ''}`}
              aria-current={a ? 'page' : undefined}
            >
              <span className="shell-boton-kanji" aria-hidden="true">{m.kanji}</span>
              <span className="shell-boton-label">{m.menuLabel ?? m.label}</span>
            </Link>
          )
        })}
        {barra.conMas && (
          <button
            ref={masBotonRef}
            type="button"
            className={`shell-boton ${masAbierto || !directoActivo ? 'activo' : ''}`}
            aria-expanded={masAbierto}
            aria-controls="shell-mas"
            onClick={() => setMasAbierto(v => !v)}
          >
            <span className="shell-boton-kanji" aria-hidden="true">⋯</span>
            <span className="shell-boton-label">Más</span>
          </button>
        )}
      </nav>

      {masAbierto && (
        <div className="shell-mas-fondo" onClick={() => setMasAbierto(false)}>
          <div
            id="shell-mas"
            className="shell-mas"
            role="dialog"
            aria-modal="true"
            aria-label="Todos los módulos"
            onClick={e => e.stopPropagation()}
          >
            <div className="shell-mas-cabeza">
              <span>Todos los módulos</span>
              <button ref={cerrarRef} type="button" className="shell-mas-cerrar" onClick={() => setMasAbierto(false)} aria-label="Cerrar">✕</button>
            </div>
            <div className="shell-lista">{listaMenu(() => setMasAbierto(false))}</div>
          </div>
        </div>
      )}
    </div>
  )
}
