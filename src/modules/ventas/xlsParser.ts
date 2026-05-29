/**
 * XLS Parser — ported directly from SATORI DASHBOARD standalone app
 * Source: /Desktop/Satori Dash/satori-dashboard/index.html parseBIFF8()
 *
 * Uses a native BIFF8/OLE2 binary reader — no third-party library needed
 * for the daily .xls POS exports. SheetJS kept only as fallback for .xlsx.
 */

import * as XLSX from 'xlsx'
import type { DiaData, SaloneroDay, CajeroDay } from '../../shared/types/ventas'
import { isCajeroName } from '../../shared/utils'

// ── Date from filename ─────────────────────────────────────────
export function extractDateFromFilename(name: string): string | null {
  const n = name.replace(/[_\-]/g, ' ')

  // DD MM YYYY  (e.g. "salon 28 05 2026.xls")
  let m = n.match(/\b(\d{1,2})\s+(\d{1,2})\s+(\d{4})\b/)
  if (m) {
    const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0'), y = m[3]
    if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31)
      return `${y}-${mo}-${d}`
  }
  // YYYY MM DD
  m = n.match(/\b(\d{4})\s+(\d{1,2})\s+(\d{1,2})\b/)
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`
  // DDMMYYYY compact
  m = n.match(/\b(\d{2})(\d{2})(\d{4})\b/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return null
}

// ── Main entry point ───────────────────────────────────────────
export function parseVentasFile(buffer: ArrayBuffer, fileName: string): DiaData {
  let saloneros: Record<string, SaloneroDay | CajeroDay>

  try {
    // Try the native BIFF8 parser first (handles .xls BIFF8/OLE2)
    saloneros = parseBIFF8(buffer)
  } catch {
    // Fallback: SheetJS for .xlsx or non-standard .xls
    saloneros = parseWithSheetJS(buffer)
  }

  return {
    fileName,
    uploadedAt: new Date().toISOString().slice(0, 10),
    saloneros,
  }
}

// ── BIFF8 / OLE2 native parser ─────────────────────────────────
// Ported 1:1 from the SATORI DASHBOARD standalone app (parseBIFF8)
function parseBIFF8(buffer: ArrayBuffer): Record<string, SaloneroDay | CajeroDay> {
  const data = new Uint8Array(buffer)
  const u16 = (o: number) => data[o] | (data[o + 1] << 8)
  const u32 = (o: number) => data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24)

  // OLE2 / CFB structure
  const secSize  = 1 << u16(0x1E)
  const fatCount = u32(0x2C)

  // Build FAT (File Allocation Table)
  const fat: number[] = []
  for (let i = 0; i < fatCount; i++) {
    const sec = u32(0x4C + i * 4)
    const off = (sec + 1) * secSize
    for (let j = 0; j < secSize / 4; j++) fat.push(u32(off + j * 4))
  }

  function readChain(start: number): Uint8Array {
    const chunks: Uint8Array[] = []
    let sec = start, guard = 0
    while (sec < 0xFFFFFFFE && guard++ < 4096) {
      const off = (sec + 1) * secSize
      chunks.push(data.slice(off, off + secSize))
      sec = fat[sec]
    }
    const total = chunks.reduce((s, c) => s + c.length, 0)
    const out = new Uint8Array(total)
    let pos = 0; chunks.forEach(c => { out.set(c, pos); pos += c.length })
    return out
  }

  // Directory
  const dirSec = u32(0x30)
  const dir    = readChain(dirSec)
  const du16   = (o: number) => dir[o] | (dir[o + 1] << 8)
  const du32   = (o: number) => dir[o] | (dir[o + 1] << 8) | (dir[o + 2] << 16) | (dir[o + 3] << 24)

  let wbStart = -1, wbSize = 0
  for (let i = 0; i * 128 < dir.length; i++) {
    const o = i * 128
    const nlen = du16(o + 0x40)
    let name = ''
    if (nlen > 2) for (let j = 0; j < (nlen - 2) / 2; j++) name += String.fromCharCode(dir[o + j * 2] | (dir[o + j * 2 + 1] << 8))
    const t     = dir[o + 0x42]
    const start = du32(o + 0x74)
    const size  = du32(o + 0x78)
    if ((name === 'Workbook' || name === 'Book') && t === 2) { wbStart = start; wbSize = size; break }
  }
  if (wbStart < 0) throw new Error('No se encontró la hoja de cálculo en el archivo')

  const wb  = readChain(wbStart).slice(0, wbSize)
  const wu16 = (o: number) => wb[o] | (wb[o + 1] << 8)
  const wu32 = (o: number) => wb[o] | (wb[o + 1] << 8) | (wb[o + 2] << 16) | (wb[o + 3] << 24)

  // SST (Shared String Table)
  const sst: string[] = []
  let pos = 0
  while (pos < wb.length - 4) {
    const rec = wu16(pos), rlen = wu16(pos + 2)
    if (rec === 0x00FC) {
      const unique = wu32(pos + 8)
      let p = pos + 12
      for (let s = 0; s < unique; s++) {
        const slen = wu16(p); const flags = wb[p + 2]; p += 3
        let str = ''
        if (flags & 1) { for (let k = 0; k < slen; k++) { str += String.fromCharCode(wb[p] | (wb[p + 1] << 8)); p += 2 } }
        else           { for (let k = 0; k < slen; k++) { str += String.fromCharCode(wb[p]); p++ } }
        sst.push(str)
      }
      break
    }
    pos += 4 + rlen
  }

  // Cell records
  const cellRows: Record<number, Record<number, string | number>> = {}
  pos = 0
  while (pos < wb.length - 4) {
    const rec = wu16(pos), rlen = wu16(pos + 2)

    if (rec === 0x00FD) { // LABELSST
      const r = wu16(pos + 4), c = wu16(pos + 6), si = wu32(pos + 10)
      if (!cellRows[r]) cellRows[r] = {}
      cellRows[r][c] = si < sst.length ? sst[si] : ''

    } else if (rec === 0x0203) { // NUMBER (IEEE 754 double)
      const r = wu16(pos + 4), c = wu16(pos + 6)
      const view = new DataView(wb.buffer, wb.byteOffset + pos + 10, 8)
      if (!cellRows[r]) cellRows[r] = {}
      cellRows[r][c] = Math.round(view.getFloat64(0, true) * 100) / 100

    } else if (rec === 0x027E) { // RK
      const r = wu16(pos + 4), c = wu16(pos + 6)
      const rk = wu32(pos + 10)
      let v: number
      if (rk & 2) { v = rk >> 2 } else {
        const tmp = new Uint8Array(8)
        const rkv = rk & 0xFFFFFFFC
        tmp[4] = rkv & 0xFF; tmp[5] = (rkv >> 8) & 0xFF; tmp[6] = (rkv >> 16) & 0xFF; tmp[7] = (rkv >> 24) & 0xFF
        v = new DataView(tmp.buffer).getFloat64(0, true)
      }
      if (rk & 1) v /= 100
      if (!cellRows[r]) cellRows[r] = {}
      cellRows[r][c] = Math.round(v * 100) / 100

    } else if (rec === 0x00BD) { // MULRK
      const r = wu16(pos + 4), firstC = wu16(pos + 6)
      const count = (rlen - 2) / 6
      for (let k = 0; k < count; k++) {
        const rk = wu32(pos + 10 + k * 6)
        let v: number
        if (rk & 2) { v = rk >> 2 } else {
          const tmp = new Uint8Array(8)
          const rkv = rk & 0xFFFFFFFC
          tmp[4] = rkv & 0xFF; tmp[5] = (rkv >> 8) & 0xFF; tmp[6] = (rkv >> 16) & 0xFF; tmp[7] = (rkv >> 24) & 0xFF
          v = new DataView(tmp.buffer).getFloat64(0, true)
        }
        if (rk & 1) v /= 100
        if (!cellRows[r]) cellRows[r] = {}
        cellRows[r][firstC + k] = Math.round(v * 100) / 100
      }
    }
    pos += 4 + rlen
  }

  // Build column index from header row (row 0)
  const hdr = cellRows[0] ?? {}
  const COL: Record<string, number> = {}
  Object.entries(hdr).forEach(([c, v]) => { if (typeof v === 'string') COL[v] = parseInt(c) })

  // Group rows by salonero (trim to avoid 'Jota ' !== 'Jota')
  const salRows: Record<string, Record<number, string | number>[]> = {}
  Object.entries(cellRows).forEach(([ri, row]) => {
    if (parseInt(ri) === 0) return
    const rawSal = row[COL['Salonero'] ?? 0]
    if (!rawSal || typeof rawSal !== 'string') return
    const sal = rawSal.trim()
    if (!sal) return
    if (!salRows[sal]) salRows[sal] = []
    salRows[sal].push(row)
  })

  // Build result
  const result: Record<string, SaloneroDay | CajeroDay> = {}

  Object.entries(salRows).forEach(([sal, srows]) => {
    let pax = 0, total = 0, com = 0, beb = 0, iCom = 0, iBeb = 0
    const prodMap: Record<string, { q: number; m: number }> = {}
    let sumIVA = 0, sumServ = 0

    srows.forEach(row => {
      const prod  = String(row[COL['Producto'] ?? 1] ?? '').trim().toUpperCase()
      const qty   = row[COL['Cantidad']  ?? 2] ?? 0
      const monto = row[COL['MontoTotal'] ?? 3] ?? 0
      const iva   = row[COL['IVA']        ?? 4] ?? 0
      const serv  = row[COL['Servicio']   ?? 5] ?? 0

      // PAX row — take max (in case of duplicate rows)
      if (prod === 'PAX') {
        if (typeof qty === 'number' && qty > 0) pax = Math.max(pax, Math.round(qty))
        return
      }

      // Sum per-product columns
      if (typeof monto === 'number' && monto > 0) total += monto
      if (typeof iva   === 'number' && iva   > 0) sumIVA  += iva
      if (typeof serv  === 'number' && serv  > 0) sumServ += serv

      // Products
      const hasMonto = typeof monto === 'number' && monto > 0
      const hasIva   = typeof iva   === 'number' && iva   > 0
      if ((hasMonto || hasIva) && prod) {
        const netMonto = hasMonto ? monto as number : Math.round((iva as number) / 0.13)
        if (!prodMap[prod]) prodMap[prod] = { q: 0, m: 0 }
        prodMap[prod].q += typeof qty === 'number' ? Math.round(qty) : 0
        prodMap[prod].m += netMonto
      }

      // Cumulative summary columns — overwrite (same value on every MESA row)
      if ((row[COL['VentasComidasMesero'] ?? 12] as number) > 0) com  = row[COL['VentasComidasMesero'] ?? 12] as number
      if ((row[COL['VentasBebidasMesero'] ?? 11] as number) > 0) beb  = row[COL['VentasBebidasMesero'] ?? 11] as number
      if ((row[COL['ComidasMesero']        ?? 8] as number) > 0) iCom = Math.round(row[COL['ComidasMesero']  ?? 8]  as number)
      if ((row[COL['BebidasMesero']         ?? 9] as number) > 0) iBeb = Math.round(row[COL['BebidasMesero'] ?? 9]  as number)
    })

    total = Math.round(total * 100) / 100

    // Cajero path
    const salNorm = sal.toLowerCase().replace('ñ', 'n')
    if (isCajeroName(salNorm)) {
      let cajTotal = 0, cajSalon = 0, cajDelivery = 0, cajOrdenes = 0
      let cajIVA = 0, cajServ = 0
      srows.forEach(row => {
        const prod  = String(row[COL['Producto'] ?? 1] ?? '').trim().toUpperCase()
        if (prod === 'PAX') return
        const monto = row[COL['MontoTotal'] ?? 3] ?? 0
        const iva   = row[COL['IVA']        ?? 4] ?? 0
        const serv  = row[COL['Servicio']   ?? 5] ?? 0
        if (typeof monto === 'number' && monto > 0) {
          cajTotal += monto; cajOrdenes++
          // Salon = has service charge, delivery = no service charge
          if (typeof serv === 'number' && serv > 0) cajSalon    += monto
          else                                      cajDelivery += monto
        }
        if (typeof iva  === 'number' && iva  > 0) cajIVA  += iva
        if (typeof serv === 'number' && serv > 0) cajServ += serv
      })
      if (cajTotal > 0) {
        result[sal] = {
          esCajero:   true,
          total:      Math.round(cajTotal    * 100) / 100,
          salon:      Math.round(cajSalon    * 100) / 100,
          delivery:   Math.round(cajDelivery * 100) / 100,
          iva:        Math.round(cajIVA      * 100) / 100,
          serv:       Math.round(cajServ     * 100) / 100,
          ordenes:    cajOrdenes,
          ticketProm: cajOrdenes ? Math.round(cajTotal / cajOrdenes * 100) / 100 : 0,
          prods:      Object.entries(prodMap).sort((a, b) => b[1].m - a[1].m).map(([n, { q, m }]) => [n, q, Math.round(m)]),
        } as CajeroDay
      }
      return
    }

    // Salonero — skip if no PAX or no revenue
    if (!pax || !total) return

    const prods = Object.entries(prodMap)
      .sort((a, b) => b[1].m - a[1].m)
      .map(([name, { q, m }]): [string, number, number] => [name, q, Math.round(m)])

    result[sal] = {
      pax, total, com, beb, iCom, iBeb,
      iva:        Math.round(sumIVA  * 100) / 100,
      serv:       Math.round(sumServ * 100) / 100,
      promPax:    pax   ? total / pax   : 0,
      promPlato:  iCom  ? com   / iCom  : 0,
      promBebida: iBeb  ? beb   / iBeb  : 0,
      ratioCB:    beb   ? com   / beb   : 0,
      ratioU:     iBeb  ? iCom  / iBeb  : 0,
      bebPax:     pax   ? iBeb  / pax   : 0,
      prods,
    } as SaloneroDay
  })

  return result
}

// ── SheetJS fallback (for .xlsx or non-standard formats) ────────
function parseWithSheetJS(buffer: ArrayBuffer): Record<string, SaloneroDay | CajeroDay> {
  const wb    = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows  = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: true, defval: null })
  if (!rows.length) return {}

  // Build COL from header row (exact match, same logic as BIFF8 path)
  const hdr = rows[0] ?? []
  const COL: Record<string, number> = {}
  hdr.forEach((h, i) => { if (h != null) COL[String(h).trim()] = i })

  // Re-use the same grouping/extraction logic
  const salRows: Record<string, (string | number | null)[][]> = {}
  rows.slice(1).forEach(row => {
    if (!row) return
    const rawSal = row[COL['Salonero'] ?? 0]
    if (!rawSal || typeof rawSal !== 'string') return
    const sal = rawSal.trim(); if (!sal) return
    if (!salRows[sal]) salRows[sal] = []
    salRows[sal].push(row)
  })

  const result: Record<string, SaloneroDay | CajeroDay> = {}
  Object.entries(salRows).forEach(([sal, srows]) => {
    let pax = 0, total = 0, com = 0, beb = 0, iCom = 0, iBeb = 0
    const prodMap: Record<string, { q: number; m: number }> = {}
    let sumIVA = 0, sumServ = 0

    srows.forEach(row => {
      const prod  = String(row[COL['Producto'] ?? 1] ?? '').trim().toUpperCase()
      const qty   = Number(row[COL['Cantidad']   ?? 2]) || 0
      const monto = Number(row[COL['MontoTotal']  ?? 3]) || 0
      const iva   = Number(row[COL['IVA']         ?? 4]) || 0
      const serv  = Number(row[COL['Servicio']    ?? 5]) || 0
      if (prod === 'PAX') { if (qty > 0) pax = Math.max(pax, Math.round(qty)); return }
      if (monto > 0) total += monto
      if (iva   > 0) sumIVA  += iva
      if (serv  > 0) sumServ += serv
      if ((monto > 0 || iva > 0) && prod) {
        if (!prodMap[prod]) prodMap[prod] = { q: 0, m: 0 }
        prodMap[prod].q += Math.round(qty); prodMap[prod].m += monto || Math.round(iva / 0.13)
      }
      const vCom = Number(row[COL['VentasComidasMesero'] ?? 12]) || 0
      const vBeb = Number(row[COL['VentasBebidasMesero'] ?? 11]) || 0
      const nCom = Number(row[COL['ComidasMesero']        ?? 8]) || 0
      const nBeb = Number(row[COL['BebidasMesero']         ?? 9]) || 0
      if (vCom > 0) com = vCom; if (vBeb > 0) beb = vBeb
      if (nCom > 0) iCom = Math.round(nCom); if (nBeb > 0) iBeb = Math.round(nBeb)
    })

    total = Math.round(total * 100) / 100
    const prods = Object.entries(prodMap).sort((a, b) => b[1].m - a[1].m).map(([n, { q, m }]): [string, number, number] => [n, q, Math.round(m)])
    const salNorm = sal.toLowerCase().replace('ñ', 'n')

    if (isCajeroName(salNorm)) {
      if (total > 0) result[sal] = { esCajero: true, total, salon: srows.filter(r => Number(r[COL['Servicio'] ?? 5]) > 0).reduce((s, r) => s + (Number(r[COL['MontoTotal'] ?? 3]) || 0), 0), delivery: srows.filter(r => !(Number(r[COL['Servicio'] ?? 5]) > 0)).reduce((s, r) => s + (Number(r[COL['MontoTotal'] ?? 3]) || 0), 0), iva: sumIVA, serv: sumServ, ordenes: srows.filter(r => String(r[COL['Producto'] ?? 1] ?? '').toUpperCase().trim() !== 'PAX' && Number(r[COL['MontoTotal'] ?? 3]) > 0).length, ticketProm: 0, prods } as CajeroDay
      return
    }
    if (!pax || !total) return
    result[sal] = { pax, total, com, beb, iCom, iBeb, iva: sumIVA, serv: sumServ, promPax: pax ? total / pax : 0, promPlato: iCom ? com / iCom : 0, promBebida: iBeb ? beb / iBeb : 0, ratioCB: beb ? com / beb : 0, ratioU: iBeb ? iCom / iBeb : 0, bebPax: pax ? iBeb / pax : 0, prods } as SaloneroDay
  })
  return result
}
