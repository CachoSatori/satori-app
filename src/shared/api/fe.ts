// Facturación Electrónica — API de persistencia (ESTRUCTURA, proveedor SIM).
// Genera y guarda un fe_documento por cobro. La emisión la hace feProvider (SIM hoy;
// NO llama a Hacienda). Idempotente por payment_id: re-emitir el mismo pago no duplica.
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { feProvider, type FeReceptor, type FeTipo } from '../fe/feProvider'

const sb = supabase as unknown as SupabaseClient

export interface FeDocumento {
  id: string
  order_id: string
  payment_id: string | null
  check_id: string | null
  tipo: FeTipo
  estado: 'pendiente' | 'emitido' | 'error'
  receptor_nombre: string | null
  receptor_id: string | null
  receptor_email: string | null
  consecutivo: string | null
  clave: string | null
  total_neto: number
  total_iva: number
  total_servicio: number
  total: number
  provider: string
  provider_ref: string | null
  error_msg: string | null
  created_at: string
  updated_at: string
}

export interface EmitirFeInput {
  order_id: string
  payment_id?: string | null
  check_id?: string | null
  tipo?: FeTipo
  receptor?: FeReceptor | null
  total_neto: number
  total_iva: number
  total_servicio: number
  total: number
}

/** Emite (SIM) y persiste el documento del cobro. Idempotente por payment_id. */
export async function emitirFeDocumento(input: EmitirFeInput): Promise<FeDocumento> {
  const tipo: FeTipo = input.tipo ?? 'tiquete'
  // 1) Emisión por el proveedor activo (SIM: sin llamada externa)
  const r = await feProvider.emitir({
    tipo, receptor: input.receptor ?? null,
    total_neto: input.total_neto, total_iva: input.total_iva,
    total_servicio: input.total_servicio, total: input.total,
  })
  // 2) Persistir el documento con el resultado de la emisión
  const row = {
    order_id: input.order_id,
    payment_id: input.payment_id ?? null,
    check_id: input.check_id ?? null,
    tipo,
    estado: r.estado,
    receptor_nombre: input.receptor?.nombre ?? null,
    receptor_id: input.receptor?.id ?? null,
    receptor_email: input.receptor?.email ?? null,
    consecutivo: r.consecutivo,
    clave: r.clave,
    total_neto: input.total_neto,
    total_iva: input.total_iva,
    total_servicio: input.total_servicio,
    total: input.total,
    provider: r.provider,
    provider_ref: r.provider_ref,
    error_msg: r.error_msg ?? null,
  }
  // Idempotencia: si ya hay documento para este pago, devolvemos el existente.
  const query = input.payment_id
    ? sb.from('fe_documentos').upsert(row, { onConflict: 'payment_id' }).select().single()
    : sb.from('fe_documentos').insert(row).select().single()
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as FeDocumento
}

/** Documentos de una orden (para auditar / reimprimir). */
export async function getFeDocumentosByOrder(orderId: string): Promise<FeDocumento[]> {
  const { data, error } = await sb.from('fe_documentos').select('*').eq('order_id', orderId).order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as FeDocumento[]
}
