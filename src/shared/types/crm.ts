// ── CRM / Clientes types ─────────────────────────────────────────

export type CustomerTier = 'nuevo' | 'regular' | 'vip' | 'embajador'

export interface Customer {
  id:              string
  phone:           string
  name:            string | null
  email:           string | null
  birth_date:      string | null
  channel_origin:  string          // 'whatsapp' | 'presencial' | 'manual'
  first_seen:      string
  last_seen:       string | null
  total_visits:    number
  total_spent_crc: number
  points:          number
  tier:            CustomerTier
  wallet_pass_id:  string | null
  notes:           string | null
  active:          boolean
  created_at:      string
  updated_at:      string
}

export interface CustomerInteraction {
  id:            string
  customer_id:   string
  type:          string     // 'visita' | 'delivery' | 'reserva' | 'puntos_canje' | 'nota'
  channel:       string     // 'whatsapp' | 'presencial' | 'qr_scan' | 'manual'
  amount_crc:    number
  points_earned: number
  points_spent:  number
  reference_id:  string | null
  notes:         string | null
  created_by:    string | null
  created_at:    string
}

export const TIER_LABELS: Record<CustomerTier, string> = {
  nuevo:     'Nuevo',
  regular:   'Regular',
  vip:       'VIP',
  embajador: 'Embajador',
}

export const TIER_COLORS: Record<CustomerTier, string> = {
  nuevo:     '#888',
  regular:   '#7ec8a0',
  vip:       '#c8a96e',
  embajador: '#c890e8',
}

export const INTERACTION_TYPES = ['visita', 'delivery', 'reserva', 'puntos_canje', 'nota'] as const
export const INTERACTION_CHANNELS = ['presencial', 'whatsapp', 'qr_scan', 'manual'] as const

// Tier sugerido según visitas / gasto acumulado (regla simple, ajustable)
export function suggestedTier(visits: number, spent: number): CustomerTier {
  if (visits >= 10 || spent >= 80000) return 'vip'
  if (visits >= 3  || spent >= 25000) return 'regular'
  return 'nuevo'
}
