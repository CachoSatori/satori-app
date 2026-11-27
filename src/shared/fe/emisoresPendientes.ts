// ── Compras F1 (mig 203): emisores no conocidos que esperan «Es un proveedor real · recordar» ───────────────────────
//
// La 201 suma este motivo (texto EXACTO de `fe_ingestar`) a todo comprobante cuyo emisor no está en
// `fe_emisores_conocidos`; la 203 lo quita al recordar. Lo cuida src/shared/api/feIngesta.contrato203.test.ts.
export const MOTIVO_EMISOR = 'emisor no conocido (cédula sin cargar en emisores conocidos)'
const SEP = ' · '

/** Fila de `fe_comprobantes` que lee la pestaña (RLS: owner y contador ven todo). */
export interface ComprobantePendiente {
  clave: string
  fecha_emision: string | null
  emisor_cedula: string | null
  emisor_nombre: string | null
  emisor_nombre_comercial: string | null
  total_comprobante: number | string | null
  moneda: string
  estado_parseo: string
  motivo: string | null
}

export interface EmisorPendiente {
  cedula: string
  nombre: string
  comprobantes: { clave: string; fin_clave: string; fecha: string | null; total: number | null; moneda: string; otros_motivos: string[] }[]
}

/** Motivos del comprobante, en orden, partidos como los arma `fe_motivo_sumar`. */
export function motivos(m: string | null): string[] {
  return (m ?? '').split(SEP).map(x => x.trim()).filter(Boolean)
}

/** Agrupa por cédula los comprobantes «revisar» cuyo motivo incluye EXACTAMENTE el del emisor. «Receptor distinto» no
 *  entra: una factura que no era para Satori no habilita un emisor (la 203 tampoco lo deja). */
export function agruparPendientes(filas: ComprobantePendiente[]): EmisorPendiente[] {
  const por = new Map<string, EmisorPendiente>()
  for (const f of filas) {
    if (!f.emisor_cedula || f.estado_parseo !== 'revisar') continue
    const ms = motivos(f.motivo)
    if (!ms.includes(MOTIVO_EMISOR)) continue
    let e = por.get(f.emisor_cedula)
    if (!e) {
      e = { cedula: f.emisor_cedula, nombre: (f.emisor_nombre || f.emisor_nombre_comercial || '').trim() || 'Sin nombre en el XML', comprobantes: [] }
      por.set(f.emisor_cedula, e)
    }
    const total = f.total_comprobante == null ? null : Number(f.total_comprobante)
    e.comprobantes.push({
      clave: f.clave, fin_clave: f.clave.slice(-10), fecha: f.fecha_emision, total: Number.isFinite(total) ? total : null,
      moneda: f.moneda, otros_motivos: ms.filter(x => x !== MOTIVO_EMISOR),
    })
  }
  return [...por.values()].sort((a, b) => b.comprobantes.length - a.comprobantes.length || a.nombre.localeCompare(b.nombre) || a.cedula.localeCompare(b.cedula))
}
