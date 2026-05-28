// Tipos generados del schema de Supabase — Satori App v1.0

export type UserRole =
  | 'owner'
  | 'contador'
  | 'manager'
  | 'cajero'
  | 'salonero'
  | 'barman'
  | 'barback'
  | 'runner'
  | 'cocina'

export type Currency = 'CRC' | 'USD'

export type MovementType =
  | 'ingreso'
  | 'egreso_mercaderia'
  | 'egreso_personal'
  | 'egreso_operativo'
  | 'egreso_socios'
  | 'traspaso'

export type SessionStatus = 'open' | 'closed'
export type MovementStatus = 'pendiente' | 'aprobado' | 'rechazado'

// ── Tablas ──────────────────────────────────────────────────

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Employee {
  id: string
  full_name: string
  role: UserRole
  profile_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface TipSession {
  id: string
  session_date: string
  shift_type: 'AM' | 'PM'
  opened_by: string
  closed_by: string | null
  status: SessionStatus
  exchange_rate: number
  pool_efectivo_crc: number
  pool_efectivo_usd: number
  pool_barra_crc: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface TipEntry {
  id: string
  session_id: string
  employee_id: string
  hours_worked: number
  tip_amount_crc: number
  tip_amount_usd: number
  points: number | null
  payout_crc: number | null
  created_at: string
  updated_at: string
}

export interface RoleTipPoints {
  role: UserRole
  points: number
}

export interface CashSession {
  id: string
  session_date: string
  opened_by: string
  closed_by: string | null
  status: SessionStatus
  initial_service_crc: number
  initial_suppliers_crc: number
  final_service_crc: number | null
  final_suppliers_crc: number | null
  final_safe_crc: number | null
  final_bank_crc: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CashMovement {
  id: string
  session_id: string
  created_by: string
  movement_type: MovementType
  amount_crc: number
  currency: Currency
  exchange_rate: number | null
  description: string
  supplier_id: string | null
  status: MovementStatus
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export interface Supplier {
  id: string
  name: string
  category: string | null
  contact: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ExchangeRate {
  id: string
  rate_date: string
  usd_to_crc: number
  source: string
  created_by: string | null
  created_at: string
}

// ── Tipo Database para el cliente de Supabase ────────────────

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Omit<Profile, 'created_at' | 'updated_at'>
        Update: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>
      }
      employees: {
        Row: Employee
        Insert: Omit<Employee, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Employee, 'id' | 'created_at' | 'updated_at'>>
      }
      tip_sessions: {
        Row: TipSession
        Insert: Omit<TipSession, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<TipSession, 'id' | 'created_at' | 'updated_at'>>
      }
      tip_entries: {
        Row: TipEntry
        Insert: Omit<TipEntry, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<TipEntry, 'id' | 'created_at' | 'updated_at'>>
      }
      role_tip_points: {
        Row: RoleTipPoints
        Insert: RoleTipPoints
        Update: Partial<RoleTipPoints>
      }
      cash_sessions: {
        Row: CashSession
        Insert: Omit<CashSession, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<CashSession, 'id' | 'created_at' | 'updated_at'>>
      }
      cash_movements: {
        Row: CashMovement
        Insert: Omit<CashMovement, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<CashMovement, 'id' | 'created_at' | 'updated_at'>>
      }
      suppliers: {
        Row: Supplier
        Insert: Omit<Supplier, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Supplier, 'id' | 'created_at' | 'updated_at'>>
      }
      exchange_rates: {
        Row: ExchangeRate
        Insert: Omit<ExchangeRate, 'id' | 'created_at'>
        Update: Partial<Omit<ExchangeRate, 'id' | 'created_at'>>
      }
    }
  }
}
