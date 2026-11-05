/**
 * Reporte mensual del Club → HTML A4 imprimible, según docs/club-satori/ESTANDAR-reportes.md:
 * papel blanco, Cormorant Garamond + DM Sans incrustadas en base64, oro solo como filete,
 * máximo 3 páginas, tablas de hasta 10 filas, nada truncado, sin contactos.
 * También arma el CSV (anexo) con todas las filas.
 */
import cg500 from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-500-normal.woff2?inline'
import cg600 from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2?inline'
import cg500i from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-500-italic.woff2?inline'
import dm400 from '@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2?inline'
import dm500 from '@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff2?inline'
import dm600 from '@fontsource/dm-sans/files/dm-sans-latin-600-normal.woff2?inline'
import type { ReporteMes, FilaReporte } from '../../shared/api/club'
import { esParcial } from './reporteSaldo'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const TIPO_EXC: Record<string, string> = {
  REGISTRO_SIN_FACTURA: 'Registro sin factura', CREDITOS_SIN_CANJE: 'Créditos sin canje (probable)',
  CANJE_MONTO_DISTINTO: 'Canje con monto distinto (probable)', PROMO_SIN_CUPON: 'Promo sin cupón',
}

// ── Formatos (ESTANDAR §7): punto de miles, coma decimal, ₡ pegado, % con espacio ──
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const num = (n: number, dec = 0) => Number(n ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: dec })
const cred = (n: number) => num(n, 1)
const crc = (n: number) => `₡${num(Math.round(Number(n ?? 0)))}`
const pct = (n: number) => `${num(Math.round(n))} %`
const fechaCorta = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }))
  return `${d.getDate()} ${MES_CORTO[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
}
export const nombreMes = (yyyymm: string) => { const [y, m] = yyyymm.split('-').map(Number); return `${MESES[m - 1]} ${y}` }
const Titulo = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Variación según §5: ▲ musgo > 130 %, ▼ laca < 70 %, resto gris sin flecha. */
function variacion(actual: number, anterior: number): string {
  if (!anterior) return actual > 0 ? '<span class="var nuevo">nuevo ritmo</span>' : ''
  const r = actual / anterior
  const txt = `${r >= 1 ? '+' : '−'}${pct(Math.abs(r - 1) * 100)} vs. ${num(anterior, 1)}`
  if (r > 1.3) return `<span class="var sube">▲ ${txt}</span>`
  if (r < 0.7) return `<span class="var baja">▼ ${txt}</span>`
  return `<span class="var">${txt}</span>`
}

const quien = (f: FilaReporte) => `<span class="n">${esc(f.nombre)}</span>${f.negocio ? `<span class="neg"> · ${esc(f.negocio)}</span>` : ''}`

function tabla(cols: Array<{ t: string; w: string; der?: boolean }>, filas: string[][], vacio: string): string {
  if (filas.length === 0) return `<p class="nota">${esc(vacio)}</p>`
  return `<table><colgroup>${cols.map(c => `<col style="width:${c.w}">`).join('')}</colgroup>
    <thead><tr>${cols.map(c => `<th class="${c.der ? 'der' : ''}">${esc(c.t)}</th>`).join('')}</tr></thead>
    <tbody>${filas.slice(0, 10).map(f => `<tr>${f.map((v, i) => `<td class="${cols[i].der ? 'der' : ''}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}

const CSS = `
@font-face{font-family:'Cormorant Garamond';font-weight:500;font-style:normal;src:url(${cg500}) format('woff2')}
@font-face{font-family:'Cormorant Garamond';font-weight:600;font-style:normal;src:url(${cg600}) format('woff2')}
@font-face{font-family:'Cormorant Garamond';font-weight:500;font-style:italic;src:url(${cg500i}) format('woff2')}
@font-face{font-family:'DM Sans';font-weight:400;src:url(${dm400}) format('woff2')}
@font-face{font-family:'DM Sans';font-weight:500;src:url(${dm500}) format('woff2')}
@font-face{font-family:'DM Sans';font-weight:600;src:url(${dm600}) format('woff2')}
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:#1f2120}
body{font:400 9.5pt/1.5 'DM Sans',sans-serif;font-variant-numeric:tabular-nums lining-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pagina{width:210mm;height:297mm;padding:13mm 17mm 14mm;position:relative;overflow:hidden;page-break-after:always;break-after:page}
.pagina:last-child{page-break-after:auto;break-after:auto}
.cab{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:.75pt solid #b48e50;padding-bottom:2mm}
.marca{font:600 17pt/1 'Cormorant Garamond',serif;letter-spacing:.02em}
.cab-der{text-align:right;color:#6e706c;font-size:8.2pt;line-height:1.35}
h1{font:500 26pt/1.05 'Cormorant Garamond',serif;margin:5.5mm 0 1.5mm}
.bajada{color:#6e706c;font-size:9.8pt;line-height:1.5;max-width:150mm;margin:0 0 5mm}
h2{font:600 14pt/1.2 'Cormorant Garamond',serif;margin:5mm 0 .5mm}
.nota{color:#6e706c;font-size:8.2pt;margin:0 0 2mm}
.cifras{display:grid;grid-template-columns:repeat(4,1fr);margin:0 0 2mm}
.cifra{padding:0 4mm;border-left:.75pt solid #e6e4de}.cifra:first-child{padding-left:0;border-left:0}
.cifra .v{font:500 28pt/1 'Cormorant Garamond',serif}
.cifra .e{color:#6e706c;font-size:8.2pt;margin-top:1mm}
.var{display:block;font-size:8.5pt;font-weight:600;color:#6e706c;margin-top:.8mm}
.var.sube{color:#3e6a4c}.var.baja{color:#a3392d}.var.nuevo{color:#3e6a4c;font-style:italic;font-weight:500}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9pt;line-height:1.35}
th{font-size:7.8pt;font-weight:500;color:#6e706c;text-align:left;padding:0 2mm 1.2mm 0;border-bottom:.75pt solid #b48e50}
td{padding:1.4mm 2mm 1.4mm 0;border-bottom:.5pt solid #e6e4de;vertical-align:top;overflow-wrap:break-word}
th:last-child,td:last-child{padding-right:0}
.der{text-align:right}
.n{font-weight:600}.neg{color:#6e706c}
.acciones{border-top:.75pt solid #1f2120;margin:1mm 0 0}
.accion{display:grid;grid-template-columns:30mm 1fr 30mm;border-bottom:.5pt solid #e6e4de;padding:1.6mm 0;align-items:baseline}
.verbo{font:500 13pt/1 'Cormorant Garamond',serif;font-style:italic}
.verbo.laca{color:#a3392d}.verbo.musgo{color:#3e6a4c}.verbo.oro{color:#8a6a33}
.accion .cif{text-align:right;font-weight:600}
.aviso{background:#f6f5f2;border-radius:1.5mm;padding:3mm 4mm;margin:2mm 0 0;font-size:9pt}
.dos{display:grid;grid-template-columns:1fr 1fr;gap:8mm}
.calidad{display:grid;grid-template-columns:42mm 18mm 1fr;border-bottom:.5pt solid #e6e4de;padding:1.4mm 0;font-size:9pt}
.calidad .cod{color:#8a6a33;font-weight:600}.calidad .ab{color:#a3392d}.calidad .ce{color:#3e6a4c}
.pie{position:absolute;left:17mm;right:17mm;bottom:8mm;display:flex;justify-content:space-between;color:#9a9b96;font-size:7.5pt}
`

export function reporteHtml(r: ReporteMes): string {
  const k = r.kpis
  const mes = nombreMes(r.mes)
  const loc = r.local === 'santa-teresa' ? 'Santa Teresa' : r.local === 'nosara' ? 'Nosara' : r.local
  const pie = (n: number) => `<div class="pie"><span>Satori, Club Satori, ${esc(mes)}</span><span>${n} de 3</span></div>`
  const parcial = esParcial(r)
  const cab = `<div class="cab"><div class="marca">Satori</div><div class="cab-der">Club Satori · ${esc(loc)}<br>Reporte de ${esc(mes)}${parcial ? ` (parcial al ${esc(fechaCorta(r.generado_en))})` : ''}</div></div>`

  const bajada1 = k.personas > 0
    ? `${num(k.personas)} personas llegaron por referentes en ${num(k.tarjetas)} visitas, y se canjearon ${cred(k.creditos_canjeados)} créditos (${crc(k.valor_canjeado_crc)}).`
    : `No hubo visitas de referentes registradas este mes; se canjearon ${cred(k.creditos_canjeados)} créditos (${crc(k.valor_canjeado_crc)}).`

  const acciones: string[] = []
  for (const f of r.a_contactar.slice(0, 2))
    acciones.push(`<div class="accion"><span class="verbo laca">Llamar</span><span>${quien(f)}<br><span class="neg">Sus créditos vencen el ${esc(fechaCorta(f.vence_en))}.</span></span><span class="cif">${cred(f.creditos ?? 0)} cr.</span></div>`)
  for (const f of r.subiendo.slice(0, 2))
    acciones.push(`<div class="accion"><span class="verbo musgo">Agradecer</span><span>${quien(f)}<br><span class="neg">${f.nuevo_ritmo ? 'Empezó a mandar gente este mes.' : `Mandó ${num(f.personas ?? 0)} personas contra ${num(f.prom_3m ?? 0, 1)} de promedio.`}</span></span><span class="cif">${num(f.personas ?? 0)} p.</span></div>`)
  if (r.dormidos.cuentas > 0 && acciones.length < 5)
    acciones.push(`<div class="accion"><span class="verbo oro">Reactivar</span><span>${num(r.dormidos.cuentas)} cuentas con saldo y sin actividad hace más de 60 días.</span><span class="cif">${cred(r.dormidos.creditos)} cr.</span></div>`)
  if (r.calidad.abiertas > 0 && acciones.length < 5)
    acciones.push(`<div class="accion"><span class="verbo">Revisar</span><span>${num(r.calidad.abiertas)} excepciones abiertas del puente en el mes.</span><span class="cif">${num(r.calidad.abiertas)}</span></div>`)

  const p1 = `<section class="pagina">${cab}
    <h1>${esc(Titulo(mes))}</h1><p class="bajada">${esc(bajada1)}</p>
    <div class="cifras">
      <div class="cifra"><div class="v">${num(k.personas)}</div><div class="e">personas referidas</div>${variacion(k.personas, k.anterior.personas)}</div>
      <div class="cifra"><div class="v">${cred(k.creditos_canjeados)}</div><div class="e">créditos canjeados</div>${variacion(k.creditos_canjeados, k.anterior.creditos_canjeados)}</div>
      <div class="cifra"><div class="v">${cred(k.saldo_creditos_al_cierre)}</div><div class="e">${parcial ? 'créditos en saldo hoy' : 'créditos en saldo al cierre'}</div><span class="var">${num(k.cuentas_con_saldo)} cuentas</span></div>
      <div class="cifra"><div class="v">${num(k.cupones_usados)}</div><div class="e">cupones usados</div><span class="var">de ${num(k.cupones_generados)} generados</span></div>
    </div>
    <h2>Acciones</h2><p class="nota">Lo que conviene hacer este mes, en orden.</p>
    ${acciones.length ? `<div class="acciones">${acciones.slice(0, 5).join('')}</div>` : '<p class="nota">Sin acciones pendientes.</p>'}
    <h2>Ranking del mes</h2><p class="nota">Referentes por personas que llegaron; el promedio es el de los 3 meses previos.</p>
    ${tabla([{ t: 'referente', w: '58%' }, { t: 'visitas', w: '12%', der: true }, { t: 'personas', w: '14%', der: true }, { t: 'promedio', w: '16%', der: true }],
      r.ranking.map(f => [quien(f), num(f.tarjetas ?? 0), num(f.personas ?? 0), num(f.prom_3m ?? 0, 1)]), 'Ningún referente mandó gente este mes.')}
    ${pie(1)}</section>`

  const p2 = `<section class="pagina">${cab}
    <h1>Referentes</h1><p class="bajada">${esc(`${num(r.dormidos.cuentas)} cuentas tienen saldo y no se mueven hace más de 60 días; ${r.a_contactar.length === 1 ? '1 vence en los próximos 30 días.' : r.a_contactar.length ? `${r.a_contactar.length} vencen en los próximos 30 días.` : 'ninguna vence en los próximos 30 días.'}`)}</p>
    <div class="dos">
      <div><h2>Vienen subiendo</h2><p class="nota">Más de 30 % sobre su promedio.</p>
        ${tabla([{ t: 'referente', w: '70%' }, { t: 'personas', w: '30%', der: true }], r.subiendo.map(f => [quien(f), f.nuevo_ritmo ? '<span class="var nuevo" style="display:inline">nuevo ritmo</span>' : `${num(f.personas ?? 0)} <span class="neg">vs. ${num(f.prom_3m ?? 0, 1)}</span>`]), 'Nadie subió este mes.')}</div>
      <div><h2>Vienen bajando</h2><p class="nota">Menos de 70 % de su promedio.</p>
        ${tabla([{ t: 'referente', w: '70%' }, { t: 'personas', w: '30%', der: true }], r.bajando.map(f => [quien(f), `${num(f.personas ?? 0)} <span class="neg">vs. ${num(f.prom_3m ?? 0, 1)}</span>`]), 'Nadie bajó este mes.')}</div>
    </div>
    <h2>A contactar</h2><p class="nota">Créditos que vencen en los próximos 30 días si no vuelven.</p>
    ${tabla([{ t: 'referente', w: '60%' }, { t: 'vence', w: '20%', der: true }, { t: 'créditos', w: '20%', der: true }], r.a_contactar.map(f => [quien(f), esc(fechaCorta(f.vence_en)), cred(f.creditos ?? 0)]), 'Nadie vence en los próximos 30 días.')}
    <h2>Dormidos</h2><p class="nota">Con saldo y sin actividad hace más de 60 días: los 6 de más saldo (todos, en el CSV).</p>
    ${tabla([{ t: 'referente', w: '60%' }, { t: 'última actividad', w: '22%', der: true }, { t: 'créditos', w: '18%', der: true }], r.dormidos.lista.slice(0, 6).map(f => [quien(f), esc(fechaCorta(f.ultima_actividad)), cred(f.creditos ?? 0)]), 'No hay cuentas dormidas.')}
    <div class="dos">
      <div><h2>Nuevos</h2><p class="nota">${num(r.nuevos.cuentas)} referentes mandaron gente por primera vez.</p>
        ${tabla([{ t: 'referente', w: '70%' }, { t: 'personas', w: '30%', der: true }], r.nuevos.lista.slice(0, 3).map(f => [quien(f), num(f.personas ?? 0)]), 'Ningún referente nuevo.')}</div>
      <div><h2>Equipo Satori</h2><p class="nota">Aparte: ${num(r.equipo.personas_mes)} personas en el mes y ${cred(r.equipo.creditos)} créditos en saldo.</p>
        ${tabla([{ t: 'persona', w: '70%' }, { t: 'créditos', w: '30%', der: true }], r.equipo.lista.slice(0, 3).map(f => [quien(f), cred(f.creditos ?? 0)]), 'Sin movimientos del equipo.')}</div>
    </div>
    ${pie(2)}</section>`

  const totalAnt = r.antiguedad.reduce((s, b) => s + Number(b.valor_crc), 0)
  const viejos = r.antiguedad.find(b => b.tramo === 'más de 12 meses')
  const cal = Object.entries(TIPO_EXC).map(([cod, desc]) => {
    const n = r.calidad.por_tipo[cod] ?? 0
    const apagada = cod === 'PROMO_SIN_CUPON' && !r.calidad.promo_activa
    return `<div class="calidad"><span class="cod">${esc(desc)}</span><span class="${apagada ? '' : n > 0 ? 'ab' : 'ce'}">${apagada ? 'apagada' : n > 0 ? `${num(n)} abiertas` : 'al día'}</span><span class="neg">${apagada ? 'Se enciende cuando exista el artículo «PROMO CLUB 10%» en el PoS.' : n > 0 ? 'Revisar en Club → Excepciones.' : 'Sin pendientes en el mes.'}</span></div>`
  }).join('')
  const p3 = `<section class="pagina">${cab}
    <h1>Plata</h1><p class="bajada">${esc(`Los créditos en saldo valen ${crc(totalAnt)} a ₡${num(r.config.valor_credito_crc)} cada uno${viejos ? `; ${crc(viejos.valor_crc)} son de cuentas sin actividad hace más de 12 meses` : ''}.`)}</p>
    <h2>Saldos por antigüedad</h2><p class="nota">Cuentas activas con saldo, según su última visita o canje.</p>
    ${tabla([{ t: 'última actividad', w: '40%' }, { t: 'cuentas', w: '18%', der: true }, { t: 'créditos', w: '18%', der: true }, { t: 'valor', w: '24%', der: true }],
      r.antiguedad.map(b => [esc(b.tramo), num(b.cuentas), cred(b.creditos), crc(b.valor_crc)]), 'No hay saldos.')}
    <h2>Concierges PM</h2><p class="nota">Comisiones pendientes de cuentas activas y movimientos del mes.</p>
    <div class="cifras" style="grid-template-columns:repeat(3,1fr)">
      <div class="cifra"><div class="v">${crc(r.pm.pendiente_crc)}</div><div class="e">pendiente</div></div>
      <div class="cifra"><div class="v">${crc(r.pm.cargos_mes_crc)}</div><div class="e">cargado en el mes</div></div>
      <div class="cifra"><div class="v">${crc(r.pm.pagos_mes_crc)}</div><div class="e">pagado en el mes</div></div>
    </div>
    ${r.pm.pausado ? `<div class="aviso">${esc(r.pm.nota ?? 'Programa PM en pausa.')}</div>` : ''}
    <h2>Calidad de datos</h2><p class="nota">Control del puente con el PoS en el mes. «Probable»: se infiere por el monto «a crédito».</p>
    ${cal}
    ${pie(3)}</section>`

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Satori · Club · ${esc(mes)}</title><style>${CSS}</style></head><body>${p1}${p2}${p3}</body></html>`
}

/** Anexo CSV: todas las filas de cada sección (sin contactos). */
export function reporteCsv(r: ReporteMes): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const L: string[] = ['seccion;nombre;negocio;tipo;personas;promedio_3m;creditos;fecha']
  const add = (sec: string, fs: FilaReporte[]) => fs.forEach(f =>
    L.push([sec, f.nombre, f.negocio ?? '', f.tipo, f.personas ?? '', f.prom_3m ?? '', f.creditos ?? '', f.vence_en ?? f.ultima_actividad ?? ''].map(q).join(';')))
  add('ranking', r.ranking); add('subiendo', r.subiendo); add('bajando', r.bajando); add('a_contactar', r.a_contactar)
  add('dormidos', r.dormidos.lista); add('nuevos', r.nuevos.lista); add('equipo', r.equipo.lista)
  for (const b of r.antiguedad) L.push(['antiguedad', b.tramo, '', '', '', '', b.creditos, ''].map(q).join(';'))
  const k = r.kpis
  for (const [n, v] of Object.entries({ tarjetas: k.tarjetas, personas: k.personas, canjes: k.canjes, creditos_canjeados: k.creditos_canjeados,
    valor_canjeado_crc: k.valor_canjeado_crc, saldo_creditos_al_cierre: k.saldo_creditos_al_cierre, pm_pendiente_crc: r.pm.pendiente_crc,
    excepciones_abiertas: r.calidad.abiertas }))
    L.push(['kpi', n, '', '', '', '', v, ''].map(q).join(';'))
  return '﻿' + L.join('\r\n')
}
