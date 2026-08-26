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
  pos_name: string | null   // nombre exacto en el XLS de ventas/POS (clave de dias.saloneros); null = sin vincular
  // ── Salarios · Fase 0 (mig 055) ──────────────────────────────────────────────
  // Datos maestros de nómina. Opcionales a propósito: las lecturas castean la fila
  // cruda (data as Employee[]) y hay código que arma Employees a mano en tests y
  // fixtures; declararlos requeridos rompería esas construcciones sin ganar nada.
  // En la base son NOT NULL con default (0 / 0 / true) y NULL en code/fecha.
  hourly_rate_crc?: number             // tarifa por hora en colones; 0 = no cobra por hora
  fixed_salary_crc?: number            // salario fijo por quincena en colones; 0 = no aplica
  participa_servicio?: boolean         // Y/N del reparto del 10% de servicio (R4)
  biotime_emp_code?: string | null     // código en BioTime (A3); único cuando no es null; null = sin mapear
  fecha_ingreso?: string | null        // date (YYYY-MM-DD); para vacaciones/aguinaldo (Fase 5)
  // ── Salarios · U0b (mig 058) ─────────────────────────────────────────────────
  nombre_homebanking?: string | null   // nombre del beneficiario TAL CUAL en el homebanking (col A del archivo del banco); null = usar full_name
  // ── Salarios · Capa 3 (mig 061) ──────────────────────────────────────────────
  // Hora de reloj de pared ("HH:MM:SS" tal como la devuelve una columna `time`), no un
  // instante. Solo PRE-RELLENAN la mitad que falta de un fichaje impar; nunca escriben
  // horas por su cuenta. null = este empleado no tiene regla → corrección manual.
  hora_entrada_habitual?: string | null
  hora_salida_habitual?: string | null
  created_at: string
  updated_at: string
}

// ── Salarios · ciclo de nómina (mig 056) ─────────────────────────────────────────
// Estas tablas NO están en supabase.gen.ts (no lo regeneramos; ver el cast acotado de
// shared/api/salarios.ts). Estos tipos son el contrato del lado de la app.

// Tarifa VERSIONADA. La vigente a una fecha = la de mayor efectivo_desde <= fecha.
// `tipo` es la modalidad principal y NO excluye la otra columna: el caso real del Excel
// cobra fijo por quincena Y tarifa por hora a la vez.
export interface EmployeeWageRate {
  id:               string
  employee_id:      string
  tipo:             'hora' | 'quincena' | 'mes'
  hourly_rate_crc:  number
  fixed_salary_crc: number
  efectivo_desde:   string   // date (YYYY-MM-DD)
  nota:             string | null
  created_at:       string
  updated_at:       string
}

export type SalaryPeriodEstado = 'abierto' | 'en_revision' | 'cerrado' | 'pagado'

export interface SalaryPeriod {
  id:         string
  tipo:       'quincena' | 'adhoc'
  fecha_ini:  string   // date
  fecha_fin:  string   // date
  estado:     SalaryPeriodEstado
  local:      string | null   // solo etiqueta; el pay run es global
  created_by:    string | null
  closed_by:     string | null
  closed_at:     string | null
  paid_by:    string | null
  paid_at:    string | null
  // Rastro de la reapertura (mig 056). El motivo es obligatorio y lo exige la app:
  // volver atrás un período cerrado o pagado nunca queda sin explicación.
  reopened_by:   string | null
  reopened_at:   string | null
  reopen_motivo: string | null
  created_at: string
  updated_at: string
}

// Horas por empleado/día/local. U0b las carga a mano; Fase 1 (BioTime) escribe las
// mismas filas con source='biotime'.
export interface WorkDay {
  employee_id: string
  work_date:   string   // date
  local:       string
  hours:       number
  es_feriado:  boolean
  source:      'manual' | 'biotime'
  // F1d escribe acá el recuento del emparejamiento (marcas/pares/impares/solapados/
  // turno_largo) y el override manual deja su rastro de auditoría.
  flags:       Record<string, unknown> | null
  created_at:  string
  updated_at:  string
}

// ── BioTime (migs 057 F1a / 059 F1d) ────────────────────────────────────────────

// La marca cruda del reloj, tal cual la dejó el agente. NADIE la edita: las
// correcciones van a work_days (override manual) o a punch_exceptions.
export interface TimePunch {
  id:          string
  local:       string
  biotime_id:  number
  emp_code:    string
  employee_id: string | null
  punch_at:    string   // timestamptz
  punch_state: 'in' | 'out'
  terminal:    string | null
  synced_at:   string
  created_at:  string
  updated_at:  string
}

export type PunchExceptionTipo = 'impar' | 'turno_largo' | 'sin_mapear' | 'solapado'

// Lo que el emparejamiento de F1d no pudo resolver solo. `employee_id` es null
// justo en el caso sin_mapear (todavía no hay a quién acreditarle la marca).
export interface PunchException {
  id:          string
  employee_id: string | null
  emp_code:    string | null
  work_date:   string | null   // date
  local:       string | null
  tipo:        PunchExceptionTipo
  detalle:     Record<string, unknown> | null
  estado:      'abierta' | 'resuelta'
  resuelto_by: string | null
  resuelto_at: string | null
  created_at:  string
  updated_at:  string
}

// Registro del pago por transferencia. NO genera movimiento de caja.
export interface EmployeePayment {
  id:          string
  period_id:   string
  employee_id: string
  monto_neto:  number
  metodo:      string
  referencia:  string | null
  estado:      string
  paid_by:     string | null
  paid_at:     string | null
  created_at:  string
  updated_at:  string
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
  // Total real del pool del turno = calcTurno/calcHistory().totalPool (efectivo + propinaSala
  // por covered_role + barra ef+elec). Lo escribe el cierre/edición del turno (mig 051). NULL =
  // sin calcular → la lectura cae al fallback poolTotalOf. Derivado persistido, no entra al reparto.
  pool_total_crc: number | null
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
  proveedor_notificado_at?: string | null  // mig 047 — cuándo la Edge Function envió el comprobante al proveedor (NULL = no enviado)
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
  email: string | null            // mig 047 — correo del proveedor (para el comprobante por email)
  whatsapp: string | null         // mig 047 — número para el botón wa.me (envío manual)
  notificar_pago: string          // mig 047 — 'no' | 'email' (default 'no')
  created_at: string
  updated_at: string
}

// ── Saldo a favor de proveedores (mig 053/054) ──
export interface SupplierCredit {
  id: string
  supplier_id: string
  origin: string                  // 'sobrepago' | 'nota_credito'
  amount_crc: number
  amount_usd: number
  currency: string
  fecha_origen: string | null
  motivo: string | null
  referencia: string | null
  source_movement_id: string | null
  document_id: string | null
  created_by: string | null
  created_at: string
  client_op_id: string | null
}
export interface CreditApplication {
  id: string
  credit_id: string
  applied_to_movement_id: string | null
  amount_applied: number
  currency: string
  applied_at: string
  applied_by: string | null
  client_op_id: string | null
  reversed: boolean
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
