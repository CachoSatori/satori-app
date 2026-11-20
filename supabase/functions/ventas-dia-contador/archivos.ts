// ─────────────────────────────────────────────────────────────────────────────────────────
//  Los dos adjuntos del correo al contador — PURO (sin red, sin reloj, sin dependencias).
//
//  CSV: como el botón «⬇ CSV» de Contabilidad: separador `,`, cada valor entre comillas, UTF-8 con BOM
//  (Excel lo abre con tildes). Agrega la columna «#» y la fila TOTAL (pedido del dueño) y redondea la
//  plata a 2 decimales (el botón escribe el número crudo, con ruido de coma flotante).
//
//  XLSX: escrito a mano (SpreadsheetML + ZIP «store» + CRC-32, ~200 líneas). Por qué no una librería:
//    · SheetJS Community (la `xlsx` que ya usa la app) no escribe estilos: sin negrita, relleno ni bordes.
//    · ExcelJS pesa ~1 MB, arrastra streams de Node y en Deno Edge necesita `npm:` + polyfills.
//    · Este archivo no tiene dependencias: corre igual en Deno (Edge) y en Node (vitest), es
//      determinista (misma entrada → mismos bytes, fecha fija en el ZIP) y no suma cadena de suministro
//      al despliegue. La prueba lo abre con SheetJS (lectura) para confirmar que es un .xlsx válido.
// ─────────────────────────────────────────────────────────────────────────────────────────
import { COLUMNAS, r2, type Detalle } from './detalle.ts'

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────
const BOM = '﻿'
const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`

export function aCsv(d: Detalle): string {
  const filas = d.filas.map(f => [
    f.n, f.fecha, f.dia, r2(f.ventaBruta), r2(f.iva), r2(f.serv), r2(f.ventaNeta), r2(f.salon), r2(f.delivery),
    f.pax, Math.round(f.promPax),
  ].map(q).join(','))
  const t = d.total
  const total = ['TOTAL', '', '', r2(t.ventaBruta), r2(t.iva), r2(t.serv), r2(t.ventaNeta), r2(t.salon), r2(t.delivery),
    t.pax, Math.round(t.promPax)].map(q).join(',')
  return BOM + [COLUMNAS.join(','), ...filas, total].join('\n') + '\n'
}

// ── XLSX ─────────────────────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const LETRAS = 'ABCDEFGHIJK'
/** Serie de Excel (días desde 1899-12-30) de `YYYY-MM-DD`. */
export function serieExcel(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number)
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000
}

// Estilos (índice en cellXfs):
//  0 normal · 1 título · 2 subtítulo · 3 encabezado · 4 entero · 5 fecha · 6 texto · 7 colones · 8 miles
//  9 TOTAL texto · 10 TOTAL colones · 11 TOTAL miles · 12 TOTAL vacío
const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2A24"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E2D0"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"/><bottom style="double"/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="3" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

type Celda = { t: 'n'; v: number; s: number; f?: string } | { t: 's'; v: string; s: number } | { t: 'vacia'; s: number }
const num = (v: number, s: number, f?: string): Celda => ({ t: 'n', v, s, f })
const txt = (v: string, s: number): Celda => ({ t: 's', v, s })

function celdaXml(c: Celda, ref: string): string {
  if (c.t === 'vacia') return `<c r="${ref}" s="${c.s}"/>`
  if (c.t === 's') return `<c r="${ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`
  const f = c.f ? `<f>${esc(c.f)}</f>` : ''
  return `<c r="${ref}" s="${c.s}">${f}<v>${c.v}</v></c>`
}

/** Fila de encabezado del Excel (las primeras 3 son título, subtítulo y vacía). */
export const FILA_ENCABEZADO_XLSX = 4

export function hojaXml(d: Detalle, titulo: string, subtitulo: string): string {
  const filas: Celda[][] = []
  filas.push([txt(titulo, 1)])
  filas.push([txt(subtitulo, 2)])
  filas.push([])
  filas.push(COLUMNAS.map(c => txt(c, 3)))
  const primera = FILA_ENCABEZADO_XLSX + 1
  for (const f of d.filas) {
    filas.push([
      num(f.n, 4), num(serieExcel(f.fecha), 5), txt(f.dia, 6),
      num(r2(f.ventaBruta), 7), num(r2(f.iva), 7), num(r2(f.serv), 7), num(r2(f.ventaNeta), 7),
      num(r2(f.salon), 7), num(r2(f.delivery), 7), num(f.pax, 8), num(Math.round(f.promPax), 8),
    ])
  }
  const ultima = primera + d.filas.length - 1
  const t = d.total
  const suma = (col: string) => `SUM(${col}${primera}:${col}${ultima})`
  const fTotal = FILA_ENCABEZADO_XLSX + d.filas.length + 1
  filas.push([
    txt('TOTAL', 9), { t: 'vacia', s: 12 }, { t: 'vacia', s: 12 },
    num(r2(t.ventaBruta), 10, suma('D')), num(r2(t.iva), 10, suma('E')), num(r2(t.serv), 10, suma('F')),
    num(r2(t.ventaNeta), 10, suma('G')), num(r2(t.salon), 10, suma('H')), num(r2(t.delivery), 10, suma('I')),
    num(t.pax, 11, suma('J')),
    // Prom/PAX del período = Σ salón ÷ Σ pax (como la pantalla), no el promedio de los diarios.
    num(Math.round(t.promPax), 11, `IF(J${fTotal}>0,ROUND(H${fTotal}/J${fTotal},0),0)`),
  ])
  const filasXml = filas.map((cs, i) => {
    const r = i + 1
    return `<row r="${r}">${cs.map((c, j) => celdaXml(c, `${LETRAS[j]}${r}`)).join('')}</row>`
  }).join('')
  const anchos = [5, 12, 6, 15, 13, 13, 15, 15, 13, 8, 11]
  const cols = anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:K${filas.length}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${FILA_ENCABEZADO_XLSX}" topLeftCell="A${primera}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols>
<sheetData>${filasXml}</sheetData>
<mergeCells count="2"><mergeCell ref="A1:K1"/><mergeCell ref="A2:K2"/></mergeCells>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
const WB_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
const libro = (hoja: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(hoja)}" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`

export function aXlsx(d: Detalle, titulo: string, subtitulo: string): Uint8Array {
  const hoja = `Ventas ${d.quincena.clave}`   // ≤ 31 caracteres, sin caracteres prohibidos
  return zipStore([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', RELS],
    ['xl/workbook.xml', libro(hoja)],
    ['xl/_rels/workbook.xml.rels', WB_RELS],
    ['xl/styles.xml', ESTILOS],
    ['xl/worksheets/sheet1.xml', hojaXml(d, titulo, subtitulo)],
  ])
}

// ── ZIP «store» (sin compresión) ───────────────────────────────────────────────────────────────
const TABLA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = TABLA_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function zipStore(archivos: Array<[string, string]>): Uint8Array {
  const enc = new TextEncoder()
  const partes: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  // Fecha fija (1980-01-01 00:00) → mismo contenido, mismos bytes.
  const HORA = 0, FECHA = (0 << 9) | (1 << 5) | 1
  for (const [nombre, texto] of archivos) {
    const n = enc.encode(nombre), datos = enc.encode(texto), crc = crc32(datos)
    const loc = new DataView(new ArrayBuffer(30))
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true)
    loc.setUint16(8, 0, true); loc.setUint16(10, HORA, true); loc.setUint16(12, FECHA, true)
    loc.setUint32(14, crc, true); loc.setUint32(18, datos.length, true); loc.setUint32(22, datos.length, true)
    loc.setUint16(26, n.length, true); loc.setUint16(28, 0, true)
    partes.push(new Uint8Array(loc.buffer), n, datos)
    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true)
    cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true); cen.setUint16(12, HORA, true); cen.setUint16(14, FECHA, true)
    cen.setUint32(16, crc, true); cen.setUint32(20, datos.length, true); cen.setUint32(24, datos.length, true)
    cen.setUint16(28, n.length, true); cen.setUint16(30, 0, true); cen.setUint16(32, 0, true)
    cen.setUint16(34, 0, true); cen.setUint16(36, 0, true); cen.setUint32(38, 0, true); cen.setUint32(42, offset, true)
    central.push(new Uint8Array(cen.buffer), n)
    offset += 30 + n.length + datos.length
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0)
  const fin = new DataView(new ArrayBuffer(22))
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true)
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true)
  const todo = [...partes, ...central, new Uint8Array(fin.buffer)]
  const out = new Uint8Array(todo.reduce((s, p) => s + p.length, 0))
  let i = 0
  for (const p of todo) { out.set(p, i); i += p.length }
  return out
}
