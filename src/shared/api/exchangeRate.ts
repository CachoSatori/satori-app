import { supabase } from './supabase'

export interface ExchangeRateRow {
  id:         string
  rate_date:  string
  usd_to_crc: number
  source:     string
  created_by: string | null
  created_at: string
}

export async function getCurrentRate(): Promise<number> {
  const { data, error } = await supabase
    .from('exchange_rates')
    .select('usd_to_crc')
    .order('rate_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as { usd_to_crc: number } | null)?.usd_to_crc ?? 640
}

export async function getRateHistory(limit = 30): Promise<ExchangeRateRow[]> {
  const { data, error } = await supabase
    .from('exchange_rates')
    .select('*')
    .order('rate_date', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as ExchangeRateRow[]
}

export async function saveRate(params: {
  rate_date:  string
  usd_to_crc: number
  source?:    string
  created_by: string
}): Promise<void> {
  const { error } = await supabase
    .from('exchange_rates')
    .upsert({
      rate_date:  params.rate_date,
      usd_to_crc: params.usd_to_crc,
      source:     params.source ?? 'manual',
      created_by: params.created_by,
    }, { onConflict: 'rate_date' })
  if (error) throw new Error(error.message)
}
