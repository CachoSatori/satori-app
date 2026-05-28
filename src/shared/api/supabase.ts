import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan variables de entorno de Supabase')
}

// Disable Web Locks for token refresh: the SDK uses navigator.locks to serialize
// refreshes across tabs. When a lock is never released (hard reload mid-refresh,
// expired session on first load, etc.) getSession() hangs forever.
// Using a no-op lock (direct execution) is safe for single-tab apps.
const noLock = async <R>(_name: string, _timeout: number, fn: () => Promise<R>): Promise<R> => fn()

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: { lock: noLock },
})
