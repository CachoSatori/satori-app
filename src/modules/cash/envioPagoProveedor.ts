// (19-nov, dueño) Comprobante de pago por correo: UN envío por proveedor con TODAS las facturas que se pagaron en esa
// acción («✓ Pagado» = lista de 1, selección o «Marcar todos pagados»). Antes salía un correo por factura.
// Puro: agrupa los receptores (ya filtrados a notificar_pago='email' + email) por proveedor, en el orden en que llegan.

export interface ReceptorPago { id: string; supplierId: string; name: string; email: string }
export interface EnvioPago { supplierId: string; name: string; email: string; ids: string[] }

export function agruparEnvios(receptores: ReceptorPago[]): EnvioPago[] {
  const porProveedor = new Map<string, EnvioPago>()
  for (const r of receptores) {
    const e = porProveedor.get(r.supplierId)
    if (e) { if (!e.ids.includes(r.id)) e.ids.push(r.id) }
    else porProveedor.set(r.supplierId, { supplierId: r.supplierId, name: r.name, email: r.email, ids: [r.id] })
  }
  return [...porProveedor.values()]
}
