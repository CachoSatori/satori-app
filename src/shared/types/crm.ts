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

// ── Programa de puntos (Fase 2.2) ────────────────────────────────
export interface LoyaltyRules {
  points_per_1000:         number   // puntos por cada ₡1.000 gastados
  bonus_first_visit_month: number   // bonus en la primera visita del mes
  bonus_birthday:          number   // bonus en el mes de cumpleaños
  bonus_referral:          number   // bonus por referido
  tier_regular_visits:     number
  tier_regular_spent:      number
  tier_vip_visits:         number
  tier_vip_spent:          number
}

export const DEFAULT_RULES: LoyaltyRules = {
  points_per_1000:         10,
  bonus_first_visit_month: 50,
  bonus_birthday:          100,
  bonus_referral:          100,
  tier_regular_visits:     3,
  tier_regular_spent:      25000,
  tier_vip_visits:         10,
  tier_vip_spent:          80000,
}

export interface LoyaltyReward {
  id:          string
  name:        string
  description: string | null
  points_cost: number
  category:    string      // 'descuento' | 'cortesia' | 'experiencia'
  active:      boolean
  created_at:  string
}

export const REWARD_CATEGORIES = ['cortesia', 'descuento', 'experiencia'] as const

// Motor de puntos: cuántos puntos gana una interacción según las reglas
export function computeEarnedPoints(
  amountCrc: number,
  rules: LoyaltyRules,
  opts: { firstVisitThisMonth?: boolean; birthdayMonth?: boolean } = {},
): number {
  let pts = Math.floor((amountCrc / 1000) * rules.points_per_1000)
  if (opts.firstVisitThisMonth) pts += rules.bonus_first_visit_month
  if (opts.birthdayMonth)       pts += rules.bonus_birthday
  return Math.max(0, pts)
}

// Tier sugerido según visitas / gasto acumulado y las reglas configuradas
export function suggestedTier(visits: number, spent: number, rules: LoyaltyRules = DEFAULT_RULES): CustomerTier {
  if (visits >= rules.tier_vip_visits     || spent >= rules.tier_vip_spent)     return 'vip'
  if (visits >= rules.tier_regular_visits || spent >= rules.tier_regular_spent) return 'regular'
  return 'nuevo'
}
