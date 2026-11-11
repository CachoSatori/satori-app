// ¿Se muestra el menú global (rediseño B3)? Lo usan el shell y el botón 🏠 flotante de App.tsx.
import { useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { debeCambiarPassword } from '../api/altaEmpleado'
import { llevaMenu } from './modulos'

/** Rutas sin menú: las públicas. */
const SIN_MENU = ['/login', '/registro']

export function useMenuVisible(): boolean {
  const { user, profile, loading } = useAuth()
  const { pathname } = useLocation()
  if (loading || !user || !profile || !profile.is_active) return false
  if (debeCambiarPassword(user)) return false
  if (SIN_MENU.includes(pathname)) return false
  return llevaMenu(profile.role)
}

