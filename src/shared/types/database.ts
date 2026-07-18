// Tipos del schema de Supabase — Satori App v2.0

// Supabase Json type (required for JSONB columns in Database generic)
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

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
  | 'proveedor'   // la "bandeja": puesto fijo que registra pagos a proveedor con foto (mig 026)

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
  email: string | null
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
  pool_barra_electronico_crc: number
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
  covered_role: UserRole | null
  created_at: string
  updated_at: string
}

export interface RoleTipPoints {
  role: UserRole
  points: number
  // Elegibilidad de propina por rol (mig 048). Null-safe: si viene null/ausente
  // (cache viejo, fila pre-migración) el consumidor lo trata como true (default esquema).
  recibe_propina?: boolean | null
}

export interface CashSession {
  id: string
  session_date: string
  shift_type: string                // 'Día' (modelo nuevo: 1 caja/día) · legacy: 'Mediodía' | 'Noche'
  opened_by: string
  closed_by: string | null
  status: SessionStatus
  cajero_name: string
  initial_cash_crc: number
  initial_cash_usd: number
  initial_service_crc: number
  initial_suppliers_crc: number
  final_cash_crc: number | null
  final_cash_usd: number | null
  final_service_crc: number | null
  final_suppliers_crc: number | null
  final_safe_crc: number | null
  final_bank_crc: number | null
  notes: string | null
  midday_check_by?: string | null   // mig. 018 — visto del check de mediodía (quién)
  midday_check_at?: string | null   // mig. 018 — visto del check de mediodía (cuándo)
  created_at: string
  updated_at: string
}

export interface CashMovement {
  id: string
  session_id: string | null         // null = movimiento a nivel día (sin turno)
  created_by: string
  movement_type: MovementType
  amount_crc: number
  amount_usd: number
  currency: Currency
  exchange_rate: number | null
  description: string
  subcategory: string
  supplier_id: string | null
  supplier_name: string | null    // NULLABLE en la base (supabase.gen.ts) — hay filas viejas con null
  employee_name: string | null    // ídem
  method: string                    // 'Efectivo' | 'Transferencia' | 'SINPE' | 'Bitcoin'
  shift: string                     // 'Mediodía' | 'Noche' | 'General' | ''
  caja_origen: string               // 'Caja Proveedores' | 'Caja Fuerte' | 'Registradora' | 'Banco'
  status: MovementStatus
  approved_by: string | null
  approved_at: string | null
  account_id: string | null         // cuenta contable explícita del P&L (FIX 4)
  created_at: string
  updated_at: string
  client_op_id?: string | null      // idempotencia del replay offline (mig 021)
  attachments?: string[]            // paths de fotos de factura en el bucket 'facturas' (mig 026)
  factura_verified_by?: string | null  // quién verificó la factura contra el movimiento (mig 038)
  factura_verified_at?: string | null  // cuándo se verificó (mig 038)
  _pending?: boolean                // SOLO cliente: encolado en la outbox, sin sincronizar
}

// ── Cierre del día (2 fases) ──────────────────────────────────
export interface CashCierreDia {
  id:                   string
  session_date:         string
  manager:              string
  tipo:                 'parcial_mediodia' | 'completo'
  // Fase 1 — mediodía
  vm_crc:               number
  vm_usd:               number
  propinas_m_crc:       number
  otros_m_crc:          number
  ef_real_m_crc:        number
  // Fase 2 — noche
  vn_crc:               number
  vn_usd:               number
  propinas_n_crc:       number
  otros_n_crc:          number
  ef_real_n_crc:        number
  // Separaciones (conteo físico)
  sep_diaria_crc:       number
  sep_diaria_usd:       number
  sep_registradora_crc: number
  sep_registradora_usd: number
  remanente_crc:        number
  remanente_usd:        number
  // Verificación
  diferencia_crc:       number
  ajuste_tipo:          string
  ajuste_motivo:        string
  notas:                string
  tipo_cambio:          number
  created_at:           string
  updated_at:           string
}

export interface Supplier {
  id: string
  name: string
  category: string | null
  contact: string | null
  moneda: string
  ciclo_pago: string
  metodo_pago: string
  cuenta_iban: string
  aliases: string[] | null
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

// ── Tablas de Ventas (JSONB) ─────────────────────────────────

export interface VentasDia {
  id:          string
  session_date: string       // DATE
  file_name:   string | null
  data:        Json           // DiaData as JSONB
  uploaded_by: string | null
  uploaded_at: string
}

export interface VentasHist {
  session_date: string
  data:         Json          // HistDay as JSONB
  source:       string
}

export interface VentasMeta {
  key:        string
  value:      Json
  updated_at: string
}

export interface VentasComp {
  id:         string
  data:       Json            // Comp as JSONB
  created_at: string
  updated_at: string
}

export interface ProductMapRow {
  nombre:           string
  tipo:             string
  clasificacion:    string
  subclasificacion: string
  multiplicador:    number
  costo_unitario:   number
  updated_at:       string
}

export interface SOP {
  id:            string
  title:         string
  category:      string
  content:       string
  display_order: number
  is_active:     boolean
  created_by:    string | null
  created_at:    string
  updated_at:    string
}

// ── Tipo Database para el cliente de Supabase ────────────────
// El `Database` real lo genera Supabase desde el esquema vivo → `supabase.gen.ts`
// (lo usa el cliente en `shared/api/supabase.ts`). Acá solo quedan los tipos de
// dominio (interfaces) que usa la app.
export type { Database } from './supabase.gen'
