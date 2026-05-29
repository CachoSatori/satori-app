/**
 * XLS Parser for SATORI POS exports (SheetJS-based)
 *
 * File structure (confirmed from real files):
 * Col 0   Salonero              — employee name
 * Col 1   Producto              — product name
 * Col 2   Cantidad              — quantity (also PAX count on PAX row)
 * Col 3   MontoTotal            — net amount for THIS product on THIS row
 * Col 4   IVA                   — 13% tax for THIS product (per-row)
 * Col 5   Servicio              — 10% service for THIS product (per-row)
 * Col 6   TotalPersonas         — restaurant total PAX (cumulative, same every row)
 * Col 7   CantidadPersonasMesero— employee PAX (cumulative, not reliable — use PAX row instead)
 * Col 8   ComidasMesero         — employee food count (CUMULATIVE — same on every row!)
 * Col 9   BebidasMesero         — employee bev count  (CUMULATIVE — same on every row!)
 * Col 10  OtrosProductosMesero  — other count         (cumulative)
 * Col 11  VentasBebidasMesero   — employee bev sales ₡ (CUMULATIVE — same on every row!)
 * Col 12  VentasComidasMesero   — employee food sales ₡(CUMULATIVE — same on every row!)
 * Col 14  VentasTotalesMesero   — employee total sales ₡(cumulative, = col11+col12)
 * Col 29  TipoVenta             — "MESA" | "DELIVERY/LLEVAR"
 *
 * PAX ROW: Producto="PAX", Cantidad=table/customer count for that employee.
 * Cumulative columns (8,9,11,12) have the SAME value on every row of the same
 * employee — they must be read ONCE, NOT summed across rows.
 */

import * as XLSX from 'xlsx'
import type { DiaData, SaloneroDay, CajeroDay } from '../../shared/types/ventas'
import { isCajeroName as isCajero } from '../../shared/utils'

// ── Date from filename ─────────────────────────────────────────
export function extractDateFromFilename(name: string): string | null {
  const n = name.replace(/[_\-]/g, ' ')

  // DD MM YYYY  (e.g. "salon 28 05 2026.xls")
  let m = n.match(/\b(\d{1,2})\s+(\d{1,2})\s+(\d{4})\b/)
  if (m) {
    const d = m[1].padStart(2, '0')
    const mo = m[2].padStart(2, '0')
    const y = m[3]
    // Sanity check: month 1-12, day 1-31
    if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${mo}-${d}`
    }
  }

  // YYYY MM DD  (e.g. "salon 2026 05 28.xls")
  m = n.match(/\b(\d{4})\s+(\d{1,2})\s+(\d{1,2})\b/)
  if (m) {
    const [, y, mo, d] = m
    return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
  }

  // DDMMYYYY compact
  m = n.match(/\b(\d{2})(\d{2})(\d{4})\b/)
  if (m) {
    return `${m[3]}-${m[2]}-${m[1]}`
  }

  return null
}

// ── Column index map ───────────────────────────────────────────
interface ColIdx {
  salonero: number
  producto: number
  cantidad: number
  monto:    number
  iva:      number
  serv:     number
  iCom:     number
  iBeb:     number
  vBeb:     number
  vCom:     number
  tipo:     number
}

function buildColIndex(headerRow: (string | number | null | undefined)[]): ColIdx {
  // Default positional indices — confirmed from real Satori POS exports
  // These are used as fallback if header detection fails
  const idx: ColIdx = {
    salonero: 0,
    producto: 1,
    cantidad: 2,
    monto:    3,   // MontoTotal  (per-product net amount)
    iva:      4,
    serv:     5,
    iCom:     8,   // ComidasMesero (cumulative — read from PAX row)
    iBeb:     9,   // BebidasMesero (cumulative — read from PAX row)
    vBeb:     11,  // VentasBebidasMesero (cumulative)
    vCom:     12,  // VentasComidasMesero (cumulative)
    tipo:     29,  // TipoVenta
  }

  if (!headerRow.length) return idx

  // EXACT header matching only — the POS has many columns containing "venta",
  // "total", "mesero" as SUBSTRINGS (e.g. VentasComidasMesero, TotalPersonas,
  // PromVentaPersonaMesero). Substring/fuzzy matching causes ci.monto to end up
  // as col 29 (TipoVenta) because "tipoventa" contains "venta". Use exact names.
  const EXACT_MAP: Record<string, keyof ColIdx> = {
    'salonero':            'salonero',
    'mesero':              'salonero',
    'empleado':            'salonero',
    'producto':            'producto',
    'concepto':            'producto',
    'cantidad':            'cantidad',
    'montototal':          'monto',   // ONLY this exact name for the per-product amount
    'montoneto':           'monto',
    'iva':                 'iva',
    'impuestoventas':      'iva',
    'servicio':            'serv',
    'impuestoservicio':    'serv',
    'comidasmesero':       'iCom',
    'bebidasmesero':       'iBeb',
    'ventasbebidasmesero': 'vBeb',
    'ventascomidasmesero': 'vCom',
    'tipoventa':           'tipo',
    'tipodeventa':         'tipo',
    'canal':               'tipo',
  }

  headerRow.forEach((h, colIdx) => {
    if (h == null) return
    const norm = String(h).toLowerCase().replace(/[^a-z0-9]/g, '')
    const key = EXACT_MAP[norm]
    if (key !== undefined) idx[key] = colIdx
  })

  return idx
}

// ── Raw accumulator per employee ───────────────────────────────
interface RawEmployee {
  // Per-row sums (correct to add up)
  total:    number
  iva:      number
  serv:     number
  salon:    number
  delivery: number
  // Cumulative totals — read ONCE from PAX row (same on all rows)
  pax:    number
  iCom:   number
  iBeb:   number
  com:    number  // VentasComidasMesero
  beb:    number  // VentasBebidasMesero
  // Product detail
  prods:  Record<string, [number, number]>  // name → [qty, amount]
  hasPAX: boolean
}

// ── Main parser ────────────────────────────────────────────────
export function parseVentasFile(buffer: ArrayBuffer, fileName: string): DiaData {
  // SheetJS type:'array' requires Uint8Array, NOT ArrayBuffer
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const sheet    = workbook.Sheets[workbook.SheetNames[0]]
  const rows     = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw:    true,
    defval: null,
  })

  if (!rows.length) {
    return { fileName, uploadedAt: new Date().toISOString().slice(0, 10), saloneros: {} }
  }

  // Find header row (search first 5 rows)
  let headerRowIdx = 0
  let ci: ColIdx = buildColIndex([])

  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i]
    const rowStr = row.map(c => String(c ?? '').toLowerCase())
    if (rowStr.some(c => c.includes('salonero') || c.includes('mesero') || c.includes('producto'))) {
      headerRowIdx = i
      ci = buildColIndex(row)
      break
    }
  }

  // Accumulate data per employee
  const employees: Record<string, RawEmployee> = {}

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row || !row.length) continue

    const salName = String(row[ci.salonero] ?? '').trim()
    if (!salName) continue
    // Skip header-looking rows in the data
    if (salName.toLowerCase() === 'salonero' || salName.toLowerCase() === 'mesero') continue

    const producto   = String(row[ci.producto] ?? '').trim().toUpperCase()
    const cantidad   = Number(row[ci.cantidad]  ?? 0) || 0
    const monto      = Number(row[ci.monto]     ?? 0) || 0
    const iva        = Number(row[ci.iva]        ?? 0) || 0
    const serv       = Number(row[ci.serv]       ?? 0) || 0
    const iComVal    = Number(row[ci.iCom]       ?? 0) || 0
    const iBebVal    = Number(row[ci.iBeb]       ?? 0) || 0
    const vBebVal    = Number(row[ci.vBeb]       ?? 0) || 0
    const vComVal    = Number(row[ci.vCom]       ?? 0) || 0
    const tipoStr    = String(row[ci.tipo]       ?? '').toLowerCase()
    const isDelivery = tipoStr.includes('delivery') || tipoStr.includes('llevar') || tipoStr.includes('domicilio')

    if (!employees[salName]) {
      employees[salName] = {
        total: 0, iva: 0, serv: 0, salon: 0, delivery: 0,
        pax: 0, iCom: 0, iBeb: 0, com: 0, beb: 0,
        prods: {}, hasPAX: false,
      }
    }
    const emp = employees[salName]

    // PAX row: read the CUMULATIVE stats for this employee
    if (producto === 'PAX' || producto === 'PAXS') {
      emp.pax    = cantidad   // col 2 = table/customer count
      // Cumulative fields — authoritative values from the POS
      emp.iCom   = iComVal    // ComidasMesero: total food items
      emp.iBeb   = iBebVal    // BebidasMesero: total bev items
      emp.beb    = vBebVal    // VentasBebidasMesero: total bev ₡
      emp.com    = vComVal    // VentasComidasMesero: total food ₡
      emp.hasPAX = true
      continue
    }

    // Product row: accumulate per-row values
    emp.total += monto
    emp.iva   += iva
    emp.serv  += serv
    if (isDelivery) emp.delivery += monto
    else emp.salon += monto

    // Product detail
    if (producto && monto !== 0) {
      if (!emp.prods[producto]) emp.prods[producto] = [0, 0]
      emp.prods[producto][0] += cantidad
      emp.prods[producto][1] += monto
    }
  }

  // Build final DiaData
  const saloneros: Record<string, SaloneroDay | CajeroDay> = {}

  for (const [name, emp] of Object.entries(employees)) {
    // Skip employees with no data at all
    if (emp.total === 0 && !emp.hasPAX) continue

    const sortedProds: [string, number, number][] = Object.entries(emp.prods)
      .sort((a, b) => b[1][1] - a[1][1])
      .map(([n, [q, m]]) => [n, q, m])

    if (isCajero(name)) {
      saloneros[name] = {
        esCajero:   true,
        total:      emp.total,
        salon:      emp.salon,
        delivery:   emp.delivery,
        iva:        emp.iva,
        serv:       emp.serv,
        ordenes:    emp.pax,          // PAX row gives order count for cajero
        ticketProm: emp.pax > 0 ? emp.total / emp.pax : 0,
        prods:      sortedProds,
      } as CajeroDay
    } else {
      const pax = emp.pax
      saloneros[name] = {
        pax,
        total:      emp.total,
        com:        emp.com,          // VentasComidasMesero (from PAX row)
        beb:        emp.beb,          // VentasBebidasMesero (from PAX row)
        iCom:       emp.iCom,         // ComidasMesero count (from PAX row)
        iBeb:       emp.iBeb,         // BebidasMesero count (from PAX row)
        iva:        emp.iva,
        serv:       emp.serv,
        promPax:    pax > 0 ? emp.total / pax : 0,
        promPlato:  emp.iCom > 0 ? emp.com / emp.iCom : 0,
        promBebida: emp.iBeb > 0 ? emp.beb / emp.iBeb : 0,
        ratioCB:    emp.beb > 0 ? emp.com / emp.beb : 0,
        ratioU:     emp.iBeb > 0 ? emp.iCom / emp.iBeb : 0,
        bebPax:     pax > 0 ? emp.iBeb / pax : 0,
        prods:      sortedProds,
      } as SaloneroDay
    }
  }

  return {
    fileName,
    uploadedAt: new Date().toISOString().slice(0, 10),
    saloneros,
  }
}
