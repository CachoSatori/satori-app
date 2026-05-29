// XLS / XLSX parser using SheetJS (xlsx package)
// Replicates the parsing logic of the SATORI DASHBOARD standalone app

import * as XLSX from 'xlsx'
import type { DiaData, SaloneroDay, CajeroDay } from '../../shared/types/ventas'
import { isCajeroName as isCajero } from '../../shared/utils'

// ── Extract date from filename ────────────────────────────────
export function extractDateFromFilename(name: string): string | null {
  const n = name.replace(/[_-]/g, ' ')
  // YYYY MM DD
  let m = n.match(/(\d{4})\s+(\d{1,2})\s+(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`
  // DD MM YYYY
  m = n.match(/(\d{1,2})\s+(\d{1,2})\s+(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
  // DDMMYYYY
  m = n.match(/(\d{2})(\d{2})(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return null
}

// ── Main parser ───────────────────────────────────────────────
export function parseVentasFile(buffer: ArrayBuffer, fileName: string): DiaData {
  // SheetJS type:'array' requires Uint8Array, NOT ArrayBuffer — critical fix
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][]

  // Detect header row
  let headerRow = 0
  const headers: string[] = []
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i] as string[]
    if (row.some(c => String(c).toLowerCase().includes('salonero') || String(c).toLowerCase().includes('producto'))) {
      headerRow = i
      for (const h of row) headers.push(String(h ?? '').trim())
      break
    }
  }
  if (!headers.length) {
    // Fallback: assume positional columns
    headers.push('Salonero','Producto','Cantidad','MontoTotal','IVA','Servicio','','','ComidasMesero','BebidasMesero','','VentasBebidasMesero','VentasComidasMesero','TipoVenta')
  }

  // Map column names to indices
  const ci: Record<string, number> = {}
  const ALIASES: Record<string, string[]> = {
    salonero:   ['salonero','mesero','empleado'],
    producto:   ['producto','item','nombre'],
    cantidad:   ['cantidad','qty','unidades'],
    monto:      ['montototal','monto','total','venta'],
    iva:        ['iva','impuestoventas','impuesto ventas'],
    serv:       ['servicio','impuestoservicio','impuesto servicio'],
    iCom:       ['comidasmesero','comidas mesero','comidas'],
    iBeb:       ['bebidasmesero','bebidas mesero','bebidas'],
    vCom:       ['ventascomidasmesero','ventas comidas','ventascomidas'],
    vBeb:       ['ventasbebidasmesero','ventas bebidas','ventasbebidas'],
    tipo:       ['tipoventa','tipo venta','tipo','canal'],
  }
  headers.forEach((h, idx) => {
    const norm = h.toLowerCase().replace(/[^a-záéíóú0-9]/gi, '')
    for (const [key, aliases] of Object.entries(ALIASES)) {
      if (aliases.some(a => norm.includes(a.replace(/[^a-záéíóú0-9]/gi, '')))) {
        ci[key] = idx
      }
    }
  })

  // Process data rows
  const sal: Record<string, {
    total: number; com: number; beb: number; iva: number; serv: number
    iCom: number; iBeb: number; pax: number
    delivery: number; salon: number; ordenes: number
    prods: Record<string, [number, number]>
  }> = {}

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] as (string|number)[]
    if (!row || !row.length) continue
    const salonero = String(row[ci.salonero ?? 0] ?? '').trim()
    if (!salonero || salonero.toLowerCase() === 'salonero') continue

    const producto = String(row[ci.producto ?? 1] ?? '').trim().toUpperCase()
    const cantidad  = Number(row[ci.cantidad ?? 2]) || 0
    const monto     = Number(row[ci.monto    ?? 3]) || 0
    const iva       = Number(row[ci.iva      ?? 4]) || 0
    const serv      = Number(row[ci.serv     ?? 5]) || 0
    const iCom      = Number(row[ci.iCom     ?? 8]) || 0
    const iBeb      = Number(row[ci.iBeb     ?? 9]) || 0
    const vCom      = Number(row[ci.vCom     ?? 12]) || 0
    const vBeb      = Number(row[ci.vBeb     ?? 11]) || 0
    const tipo      = String(row[ci.tipo     ?? 13] ?? '').toLowerCase()
    const isDelivery= tipo.includes('delivery') || tipo.includes('domicilio')

    if (!sal[salonero]) {
      sal[salonero] = { total:0,com:0,beb:0,iva:0,serv:0,iCom:0,iBeb:0,pax:0,delivery:0,salon:0,ordenes:0,prods:{} }
    }
    const s = sal[salonero]

    // PAX row — counts unique tables/orders per salonero
    if (producto === 'PAX' || producto === 'PAXS') {
      s.pax += cantidad
      // Each PAX row = one table/order
      if (isDelivery) s.ordenes += cantidad
      else if (!isCajero(salonero)) s.ordenes += cantidad
      continue
    }

    s.total += monto
    s.iva   += iva
    s.serv  += serv
    s.iCom  += iCom
    s.iBeb  += iBeb
    s.com   += vCom
    s.beb   += vBeb
    if (isDelivery) s.delivery += monto
    else s.salon += monto

    if (!s.prods[producto]) s.prods[producto] = [0, 0]
    s.prods[producto][0] += cantidad
    s.prods[producto][1] += monto
  }

  // Build final DiaData
  const saloneros: Record<string, SaloneroDay | CajeroDay> = {}

  for (const [name, s] of Object.entries(sal)) {
    const sortedProds: [string, number, number][] =
      Object.entries(s.prods)
        .sort((a, b) => b[1][1] - a[1][1])
        .map(([n, [q, m]]) => [n, q, m])

    if (isCajero(name)) {
      saloneros[name] = {
        esCajero:   true,
        total:      s.total,
        salon:      s.salon,
        delivery:   s.delivery,
        iva:        s.iva,
        serv:       s.serv,
        ordenes:    s.ordenes,
        ticketProm: s.ordenes > 0 ? s.total / s.ordenes : 0,
        prods:      sortedProds,
      } as CajeroDay
    } else {
      const pax = s.pax
      saloneros[name] = {
        pax,
        total:      s.total,
        com:        s.com || (s.total - s.beb),
        beb:        s.beb,
        iCom:       s.iCom,
        iBeb:       s.iBeb,
        iva:        s.iva,
        serv:       s.serv,
        promPax:    pax > 0 ? s.total / pax : 0,
        promPlato:  s.iCom > 0 ? s.com / s.iCom : 0,
        promBebida: s.iBeb > 0 ? s.beb / s.iBeb : 0,
        ratioCB:    s.beb > 0 ? s.com / s.beb : 0,
        ratioU:     s.iBeb > 0 ? s.iCom / s.iBeb : 0,
        bebPax:     pax > 0 ? s.iBeb / pax : 0,
        prods:      sortedProds,
      } as SaloneroDay
    }
  }

  return {
    fileName:   fileName,
    uploadedAt: new Date().toISOString().slice(0, 10),
    saloneros,
  }
}
