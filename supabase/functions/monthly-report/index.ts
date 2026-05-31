/**
 * Supabase Edge Function — Reportes Mensuales Satori
 * Ported from SATORI PROPINAS standalone satori_apps_script_v4.1.js
 *
 * Sends TWO emails (same as standalone):
 *   1. 📈 Reporte de Ventas — IRS saloneros, top productos, tendencia semanal
 *   2. 💰 Reporte de Propinas — distribución sector, AM/PM split, top take-home
 *
 * Triggers:
 *   - Día 1 del mes 08:00 CR (pg_cron → mes anterior)
 *   - Día 15 del mes 08:00 CR (pg_cron → mes actual acumulado)
 *   - POST manual: body { "month": "2026-04", "tipo": "ventas"|"propinas"|"ambos" }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TO_EMAIL       = Deno.env.get('REPORT_TO_EMAIL') ?? 'cachorrogp@gmail.com'
const FROM_EMAIL     = 'Satori App <onboarding@resend.dev>'

// ── Shared helpers (ported from Apps Script) ─────────────────
const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const INK = '#0d0d0d', PAPER = '#f5f0e8', GOLD = '#c8a96e'
const GREEN = '#4a7c59', RED = '#c23b22', BLUE = '#2a4a6b', TEAL = '#2a7a6a'
const MUTED = '#888'

const fi  = (v: number) => '₡ ' + Math.round(v).toLocaleString('es-CR')
const fiS = (v: number) => v > 0 ? fi(v) : '—'

const TH = `padding:8px 10px;text-align:left;color:#999;font-size:10px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;border-bottom:1px solid #ddd;background:${PAPER}`
const TD = `padding:8px 10px;border-bottom:1px solid #f0ece8;font-size:12px`

function kRow(label: string, val: string, gold = false): string {
  return `<tr><td style="padding:7px 0;color:#666;font-size:12px;width:55%">${label}</td>` +
    `<td style="padding:7px 0;font-size:13px;text-align:right;${gold?`font-weight:700;color:${GOLD}`:''}">${val}</td></tr>`
}
function barRow(label: string, val: number, max: number, color: string, note = ''): string {
  const w = max > 0 ? Math.round(val / max * 100) : 0
  return `<tr>
    <td style="padding:5px 0;color:#777;font-size:11px;width:90px;text-align:right;padding-right:10px">${label}</td>
    <td style="padding:5px 0"><div style="background:#ece8e0;height:10px">
      <div style="width:${w}%;height:10px;background:${color}"></div></div></td>
    <td style="padding:5px 0 5px 10px;font-size:11px;font-weight:500;white-space:nowrap">${fi(val)}${note?` <span style="color:#aaa;font-size:10px">${note}</span>`:''}</td>
  </tr>`
}
function emailHeader(title: string, mes: string, anio: number): string {
  return `<div style="background:${INK};padding:22px 28px 18px">
    <div style="font-family:Georgia,serif;font-size:22px;color:${GOLD};letter-spacing:.08em;font-weight:700">里 SATORI</div>
    <div style="font-size:10px;color:#555;letter-spacing:.25em;text-transform:uppercase;margin-top:3px">${title} · ${mes} ${anio}</div>
  </div>`
}
function emailFooter(mes: string, anio: number): string {
  return `<div style="padding:12px 28px;background:#f0ece4;border-top:1px solid #e0dbd2">
    <p style="font-size:10px;color:#aaa;margin:0">Generado automáticamente · Satori Sushi Bar · Santa Teresa, CR · ${mes} ${anio}</p>
  </div>`
}

async function send(subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: [TO_EMAIL], subject, html }),
  })
  const d = await res.json()
  if (!res.ok) throw new Error(`Resend: ${JSON.stringify(d)}`)
}

// ── Data fetching ─────────────────────────────────────────────
interface SaloneroData {
  nombre: string; ventas: number; pax: number; iCom: number; iBeb: number
  servicios: number; ticketProm: number; paxProm: number; constancia: number; irs: number
}
interface ProdData { nombre: string; qty: number; monto: number; tipo: string }
interface VentasCalc {
  total: number; salon: number; caj: number; delivery: number; iva: number; serv: number
  pax: number; iCom: number; iBeb: number; diasVentas: number; prevNeta: number
  topSal: SaloneroData[]; topComida: ProdData[]; topBebidas: ProdData[]
  semanas: Array<{ sem: string; total: number; dias: number; avg: number }>
  diasSem: Array<{ dia: string; avg: number; count: number }>
}
interface EmpPropina {
  nombre: string; take: number; dias: number; rol: string; prom: number; constancia: number
}
interface PropinasCalc {
  pool: number; barra: number; turnos: number
  amCount: number; pmCount: number; amPool: number; pmPool: number
  topProp: EmpPropina[]
  sectores: Array<{ rol: string; total: number; pct: number }>
  semanas: Array<{ sem: string; total: number; avg: number; count: number }>
  diasSem: Array<{ dia: string; avg: number; count: number }>
}

async function calcVentas(supabase: ReturnType<typeof createClient>, ym: string): Promise<VentasCalc> {
  const [year, month] = ym.split('-').map(Number)
  const prevYm = month === 1 ? `${year-1}-12` : `${year}-${String(month-1).padStart(2,'0')}`

  // Fetch ventas_dias for current and previous month
  const { data: dias } = await supabase.from('ventas_dias' as never)
    .select('session_date, data')
    .gte('session_date', `${ym}-01`)
    .lte('session_date', `${ym}-31`) as { data: Array<{session_date: string; data: {saloneros: Record<string, {total?:number;iva?:number;serv?:number;pax?:number;iCom?:number;iBeb?:number;esCajero?:boolean;delivery?:number;prods?:[string,number,number][]}>}}> | null }

  const { data: prevDias } = await supabase.from('ventas_dias' as never)
    .select('data').gte('session_date', `${prevYm}-01`).lte('session_date', `${prevYm}-31`)

  // Product classifications
  const { data: prodMap_ } = await supabase.from('product_map' as never).select('nombre, tipo')
  const tipoMap: Record<string, string> = {}
  for (const p of (prodMap_ ?? []) as {nombre: string; tipo: string}[]) tipoMap[p.nombre.toUpperCase().trim()] = p.tipo

  let total=0, salon=0, caj=0, delivery=0, iva=0, serv=0, pax=0, iCom=0, iBeb=0, diasVentas=0
  const salMap: Record<string, {total:number;pax:number;iCom:number;iBeb:number;dias:Set<string>}> = {}
  const prodAcc: Record<string, {qty:number;monto:number;tipo:string}> = {}
  const semMap: Record<string, {total:number;dias:number}> = {}
  const dowTotals: Record<string, number[]> = {}

  const DAYS_ES: Record<number, string> = {0:'Domingo',1:'Lunes',2:'Martes',3:'Miércoles',4:'Jueves',5:'Viernes',6:'Sábado'}

  for (const row of (dias ?? [])) {
    diasVentas++
    const dNum = Number(row.session_date.slice(8,10))
    const sem = dNum<=7?'1':dNum<=14?'2':dNum<=21?'3':dNum<=28?'4':'5'
    if (!semMap[sem]) semMap[sem] = {total:0,dias:0}
    semMap[sem].dias++
    let dayTotal = 0
    const dow = DAYS_ES[new Date(row.session_date+'T12:00:00').getDay()] ?? ''
    for (const [nombre, s] of Object.entries(row.data?.saloneros ?? {})) {
      iva  += s.iva  ?? 0
      serv += s.serv ?? 0
      if (s.esCajero) {
        delivery += s.delivery ?? 0
        caj      += (s.total ?? 0) - (s.delivery ?? 0)
        total    += s.total ?? 0
      } else {
        const t = s.total ?? 0
        salon += t; total += t; pax += s.pax ?? 0
        iCom  += s.iCom ?? 0; iBeb += s.iBeb ?? 0
        dayTotal += t
        const k = nombre.toUpperCase().trim()
        if (!salMap[k]) salMap[k] = {total:0,pax:0,iCom:0,iBeb:0,dias:new Set()}
        salMap[k].total += t; salMap[k].pax += s.pax ?? 0
        salMap[k].iCom  += s.iCom ?? 0; salMap[k].iBeb += s.iBeb ?? 0
        salMap[k].dias.add(row.session_date)
        for (const [pname,,monto] of (s.prods ?? [])) {
          const qty = s.prods?.find(p => p[0]===pname)?.[1] ?? 0
          const pk = String(pname).toUpperCase().trim()
          const tipo = tipoMap[pk] ?? 'comida'
          if (!prodAcc[pk]) prodAcc[pk] = {qty:0,monto:0,tipo}
          prodAcc[pk].qty += qty; prodAcc[pk].monto += monto
        }
      }
    }
    semMap[sem].total += dayTotal
    if (!dowTotals[dow]) dowTotals[dow] = []
    dowTotals[dow].push(dayTotal)
  }

  // Previous month total
  let prevNeta = 0
  type DiaRow = { session_date: string; data: { saloneros: Record<string, { total?: number; iva?: number; serv?: number; pax?: number; iCom?: number; iBeb?: number; esCajero?: boolean; delivery?: number; prods?: [string, number, number][] }> } }
  for (const row of ((prevDias ?? []) as DiaRow[])) {
    for (const s of Object.values(row.data?.saloneros ?? {})) prevNeta += s.total ?? 0
  }

  // IRS = 45% ticket/PAX + 35% constancia + 20% PAX prom/servicio
  const salArr = Object.entries(salMap).map(([nombre, d]) => {
    const servicios = d.dias.size
    const ticketProm = d.pax > 0 ? d.total / d.pax : 0
    const paxProm    = servicios > 0 ? d.pax / servicios : 0
    const constancia = diasVentas > 0 ? Math.round(servicios / diasVentas * 100) : 0
    return { nombre, ventas: d.total, pax: d.pax, iCom: d.iCom, iBeb: d.iBeb, servicios, ticketProm, paxProm, constancia, irs: 0 }
  })
  const maxTick = Math.max(...salArr.map(s => s.ticketProm), 1)
  const maxPaxP = Math.max(...salArr.map(s => s.paxProm), 1)
  salArr.forEach(s => {
    s.irs = Math.round((s.ticketProm/maxTick*100)*0.45 + s.constancia*0.35 + (s.paxProm/maxPaxP*100)*0.20)
  })

  const allProds = Object.entries(prodAcc).map(([nombre,d]) => ({nombre,...d})).sort((a,b)=>b.monto-a.monto)
  const diasSem  = Object.entries(dowTotals)
    .map(([dia,v]) => ({dia, avg:Math.round(v.reduce((a,b)=>a+b,0)/v.length), count:v.length}))
    .sort((a,b) => b.avg-a.avg)
  const semanas  = Object.entries(semMap).sort()
    .map(([sem,{total,dias}]) => ({sem,total,dias,avg:dias>0?Math.round(total/dias):0}))

  return {
    total, salon, caj, delivery, iva, serv, pax, iCom, iBeb, diasVentas, prevNeta,
    topSal:     salArr.sort((a,b)=>b.irs-a.irs).slice(0,8),
    topComida:  allProds.filter(p=>p.tipo!=='bebida').slice(0,5),
    topBebidas: allProds.filter(p=>p.tipo==='bebida').slice(0,5),
    semanas, diasSem,
  }
}

async function calcPropinas(supabase: ReturnType<typeof createClient>, ym: string): Promise<PropinasCalc> {
  const { data: sessions } = await supabase.from('tip_sessions')
    .select('id, shift_type, session_date').eq('status','closed')
    .gte('session_date',`${ym}-01`).lte('session_date',`${ym}-31`)
  const sids = (sessions ?? []).map((s: {id:string}) => s.id)

  if (!sids.length) return {pool:0,barra:0,turnos:0,amCount:0,pmCount:0,amPool:0,pmPool:0,topProp:[],sectores:[],semanas:[],diasSem:[]}

  // Pool totals from sessions
  const { data: sessData } = await supabase.from('tip_sessions')
    .select('id,pool_efectivo_crc,pool_efectivo_usd,pool_barra_crc,exchange_rate,shift_type,session_date')
    .in('id', sids)

  let pool=0, barra=0, amCount=0, pmCount=0, amPool=0, pmPool=0
  const semMap: Record<string,number[]> = {}
  const dowMap: Record<string,number[]> = {}
  const DAYS_ES: Record<number,string> = {0:'Domingo',1:'Lunes',2:'Martes',3:'Miércoles',4:'Jueves',5:'Viernes',6:'Sábado'}

  for (const s of (sessData ?? []) as Array<{id:string;pool_efectivo_crc:number;pool_efectivo_usd:number;pool_barra_crc:number;exchange_rate:number;shift_type:string;session_date:string}>) {
    const p = (s.pool_efectivo_crc??0) + (s.pool_efectivo_usd??0)*(s.exchange_rate??640) + (s.pool_barra_crc??0)
    pool += p; barra += s.pool_barra_crc??0
    const isAM = s.shift_type === 'AM' || s.shift_type === 'Mediodía'
    if (isAM) { amCount++; amPool += p } else { pmCount++; pmPool += p }
    const dNum = Number(s.session_date.slice(8,10))
    const sem = dNum<=7?'1':dNum<=14?'2':dNum<=21?'3':dNum<=28?'4':'5'
    if (!semMap[sem]) semMap[sem] = []; semMap[sem].push(p)
    const dow = DAYS_ES[new Date(s.session_date+'T12:00:00').getDay()] ?? ''
    if (!dowMap[dow]) dowMap[dow] = []; dowMap[dow].push(p)
  }

  // Employee entries
  const { data: entries } = await supabase.from('tip_entries')
    .select('employee_id, payout_crc, session_id').in('session_id', sids)
  const { data: emps } = await supabase.from('employees').select('id, full_name, role')
  const empInfo: Record<string,{name:string;role:string}> = {}
  for (const e of (emps ?? []) as Array<{id:string;full_name:string;role:string}>) empInfo[e.id] = {name:e.full_name, role:e.role}

  const empMap: Record<string,{take:number;dias:number;rol:string}> = {}
  for (const e of (entries ?? []) as Array<{employee_id:string;payout_crc:number|null}>) {
    const info = empInfo[e.employee_id]
    if (!info) continue
    const k = info.name.toUpperCase().trim()
    if (!empMap[k]) empMap[k] = {take:0,dias:0,rol:info.role}
    empMap[k].take += e.payout_crc ?? 0
    empMap[k].dias++
  }

  // Sectors
  const sectBruto: Record<string,number> = {}
  for (const e of Object.values(empMap)) {
    const sec = e.rol === 'barback' ? 'barman' : e.rol
    sectBruto[sec] = (sectBruto[sec]??0) + e.take
  }

  const totalTurnos = sids.length
  const topProp = Object.entries(empMap)
    .map(([nombre,d]) => ({nombre,...d,prom:d.dias>0?d.take/d.dias:0,constancia:totalTurnos>0?Math.round(d.dias/totalTurnos*100):0}))
    .sort((a,b) => b.take-a.take).slice(0,8)
  const sectores = Object.entries(sectBruto)
    .map(([rol,total]) => ({rol,total,pct:pool>0?total/pool*100:0}))
    .sort((a,b) => b.total-a.total)
  const semanas = Object.entries(semMap).sort()
    .map(([sem,v]) => ({sem,total:v.reduce((a,b)=>a+b,0),avg:Math.round(v.reduce((a,b)=>a+b,0)/v.length),count:v.length}))
  const diasSem = Object.entries(dowMap)
    .map(([dia,v]) => ({dia,avg:Math.round(v.reduce((a,b)=>a+b,0)/v.length),count:v.length}))
    .sort((a,b) => b.avg-a.avg)

  return {pool,barra,turnos:totalTurnos,amCount,pmCount,amPool,pmPool,topProp,sectores,semanas,diasSem}
}

// ── Email builders ────────────────────────────────────────────
function buildVentasEmail(v: VentasCalc, mes: string, anio: number): string {
  const delta  = v.prevNeta > 0 ? ((v.total-v.prevNeta)/v.prevNeta*100) : null
  const dStr   = delta !== null ? (delta>=0?`+${delta.toFixed(1)}%`:`${delta.toFixed(1)}%`) : null
  const dColor = delta !== null ? (delta>=0 ? GREEN : RED) : MUTED
  const maxSem = v.semanas.length > 0 ? Math.max(...v.semanas.map(s=>s.total)) : 1
  const maxDia = v.diasSem.length > 0 ? v.diasSem[0].avg : 1
  const iTotal = v.iCom + v.iBeb

  return `<div style="font-family:'DM Mono',monospace,Georgia,sans-serif;max-width:640px;margin:0 auto;background:${PAPER}">
${emailHeader('Reporte de Ventas', mes, anio)}
<div style="padding:24px 28px">

<h2 style="font-size:14px;color:${BLUE};margin:0 0 14px;border-bottom:2px solid ${BLUE};padding-bottom:8px">📈 Ventas · ${mes} ${anio}</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
  ${kRow('Ventas totales restaurante', fi(v.total), true)}
  ${kRow('Salón', fiS(v.salon))}
  ${v.delivery>0?kRow('Delivery',fiS(v.delivery)):''}
  ${v.caj>0?kRow('Caja / Para llevar',fiS(v.caj)):''}
  ${kRow('Días con registro', v.diasVentas+' días')}
  ${v.pax>0?kRow('Comensales (PAX)', v.pax.toLocaleString('es-CR')+' personas'):''}
  ${v.pax>0&&v.salon>0?kRow('Ticket promedio / PAX', fi(v.salon/v.pax)):''}
  ${v.diasVentas>0?kRow('Promedio diario', fi(v.total/v.diasVentas)):''}
  ${dStr?kRow('vs mes anterior',`<span style="color:${dColor};font-weight:700">${dStr}</span>`):''}
</table>

${v.salon+v.caj+v.delivery>0?`
<h3 style="font-size:11px;color:#444;margin:0 0 8px;letter-spacing:.12em;text-transform:uppercase">Distribución por Canal</h3>
<table style="width:100%;border-collapse:collapse;margin-bottom:18px">
  ${v.salon>0?barRow('Salón',v.salon,v.total,BLUE,(v.salon/v.total*100).toFixed(0)+'%'):''}
  ${v.delivery>0?barRow('Delivery',v.delivery,v.total,GREEN,(v.delivery/v.total*100).toFixed(0)+'%'):''}
  ${v.caj>0?barRow('Caja',v.caj,v.total,GOLD,(v.caj/v.total*100).toFixed(0)+'%'):''}
</table>`:''}

${iTotal>0?`
<h3 style="font-size:11px;color:#444;margin:0 0 6px;letter-spacing:.12em;text-transform:uppercase">Mix Comida / Bebidas (ítems vendidos)</h3>
<table style="width:100%;border-collapse:collapse;margin-bottom:18px">
  <tr><td style="padding:5px 0;color:#777;font-size:11px;width:90px;text-align:right;padding-right:10px">Comida</td>
  <td style="padding:5px 0"><div style="background:#ece8e0;height:10px"><div style="width:${Math.round(v.iCom/iTotal*100)}%;height:10px;background:${GOLD}"></div></div></td>
  <td style="padding:5px 0 5px 10px;font-size:11px;font-weight:500">${Math.round(v.iCom).toLocaleString('es-CR')} ítems <span style="color:#aaa;font-size:10px">${(v.iCom/iTotal*100).toFixed(0)}%</span></td></tr>
  <tr><td style="padding:5px 0;color:#777;font-size:11px;width:90px;text-align:right;padding-right:10px">Bebidas</td>
  <td style="padding:5px 0"><div style="background:#ece8e0;height:10px"><div style="width:${Math.round(v.iBeb/iTotal*100)}%;height:10px;background:${TEAL}"></div></div></td>
  <td style="padding:5px 0 5px 10px;font-size:11px;font-weight:500">${Math.round(v.iBeb).toLocaleString('es-CR')} ítems <span style="color:#aaa;font-size:10px">${(v.iBeb/iTotal*100).toFixed(0)}%</span></td></tr>
</table>`:''}

${v.semanas.length>0?`
<h3 style="font-size:11px;color:#444;margin:0 0 6px;letter-spacing:.12em;text-transform:uppercase">Tendencia Semanal</h3>
<table style="width:100%;border-collapse:collapse;margin-bottom:18px">
  ${v.semanas.map((s,i)=>barRow('Sem.'+(i+1)+' ('+s.dias+'d)',s.total,maxSem,BLUE,'~'+fi(s.avg)+'/día')).join('')}
</table>`:''}

${v.diasSem.length>0?`
<h3 style="font-size:11px;color:#444;margin:0 0 6px;letter-spacing:.12em;text-transform:uppercase">Promedio por Día de Semana</h3>
<table style="width:100%;border-collapse:collapse;margin-bottom:18px">
  ${v.diasSem.map(d=>barRow(d.dia,d.avg,maxDia,GOLD,d.count+' día'+(d.count!==1?'s':''))).join('')}
</table>`:''}

${v.topSal.length>0?`
<h3 style="font-size:11px;color:#444;margin:0 0 4px;letter-spacing:.12em;text-transform:uppercase">🏆 Ranking Saloneros · IRS</h3>
<p style="font-size:9px;color:#999;margin:0 0 8px">IRS = 45% ticket/PAX + 35% constancia + 20% PAX prom/servicio</p>
<table style="width:100%;border-collapse:collapse;margin-bottom:18px">
  <tr><th style="${TH}">#</th><th style="${TH}">Empleado</th><th style="${TH};text-align:center">IRS</th>
  <th style="${TH};text-align:right">Ticket/PAX</th><th style="${TH};text-align:center">Días</th>
  <th style="${TH};text-align:center">Const.</th><th style="${TH};text-align:right">Ventas</th></tr>
  ${v.topSal.map((s,i)=>{
    const irsColor = s.irs>=80?GREEN:s.irs>=60?GOLD:MUTED
    return `<tr>
      <td style="${TD};color:#aaa">${i+1}</td>
      <td style="${TD};font-weight:bold">${s.nombre}</td>
      <td style="${TD};text-align:center;font-weight:700;font-size:15px;color:${irsColor}">${s.irs}</td>
      <td style="${TD};text-align:right;font-weight:700;color:${BLUE}">${fiS(s.ticketProm)}</td>
      <td style="${TD};text-align:center;color:#888">${s.servicios}</td>
      <td style="${TD};text-align:center;color:${s.constancia>=80?GREEN:s.constancia>=50?GOLD:'#aaa'}">${s.constancia}%</td>
      <td style="${TD};text-align:right;color:#555">${fi(s.ventas)}</td>
    </tr>`}).join('')}
</table>`:''}

${(v.topComida.length>0||v.topBebidas.length>0)?`
<h3 style="font-size:11px;color:#444;margin:0 0 8px;letter-spacing:.12em;text-transform:uppercase">🍣 Top 5 Productos</h3>
<table style="width:100%;border-collapse:collapse;margin-bottom:6px">
  <tr><th style="${TH}" colspan="2">🍱 Comida</th><th style="${TH}" colspan="2">🍺 Bebidas</th></tr>
  ${Array.from({length:5}).map((_,i)=>{
    const c=v.topComida[i], b=v.topBebidas[i]
    return `<tr>
      <td style="${TD};color:${GOLD};font-size:11px">${c?c.nombre:'—'}</td>
      <td style="${TD};text-align:right;font-size:11px;color:#888">${c?Math.round(c.qty)+' u · '+fi(c.monto):''}</td>
      <td style="${TD};color:${TEAL};font-size:11px">${b?b.nombre:'—'}</td>
      <td style="${TD};text-align:right;font-size:11px;color:#888">${b?Math.round(b.qty)+' u · '+fi(b.monto):''}</td>
    </tr>`}).join('')}
</table>`:''}

</div>${emailFooter(mes,anio)}</div>`
}

function buildPropinasEmail(p: PropinasCalc, mes: string, anio: number): string {
  const maxSem = p.semanas.length>0 ? Math.max(...p.semanas.map(s=>s.avg)) : 1
  const maxDia = p.diasSem.length>0 ? p.diasSem[0].avg : 1
  const maxSec = p.sectores.length>0 ? p.sectores[0].total : 1
  const SECLAB: Record<string,string> = {salonero:'Saloneros',barman:'Barra',cocina:'Cocina',runner:'Runners',manager:'Management',cajero:'Cajeros',barback:'Barback'}
  const SECCOL: Record<string,string> = {salonero:TEAL,barman:BLUE,cocina:GOLD,runner:GREEN,manager:'#8a8070',cajero:'#6a4a8a',barback:'#8a6a4a'}

  return `<div style="font-family:'DM Mono',monospace,Georgia,sans-serif;max-width:640px;margin:0 auto;background:${PAPER}">
${emailHeader('Reporte de Propinas', mes, anio)}
<div style="padding:24px 28px">

<h2 style="font-size:14px;color:${TEAL};margin:0 0 14px;border-bottom:2px solid ${TEAL};padding-bottom:8px">💰 Propinas · ${mes} ${anio}</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
  ${kRow('Turnos registrados', `${p.turnos} (${p.amCount} Mediodía · ${p.pmCount} Noche)`)}
  ${kRow('Pool total distribuido', fi(p.pool), true)}
  ${p.barra>0?kRow(`Pool barra (${p.pool>0?(p.barra/p.pool*100).toFixed(0):0}% del total)`,fi(p.barra)):''}
  ${p.turnos>0?kRow('Promedio por turno', fi(p.pool/p.turnos)):''}
  ${p.amCount>0?kRow('Promedio turno Mediodía', fi(p.amPool/p.amCount)):''}
  ${p.pmCount>0?kRow('Promedio turno Noche', fi(p.pmPool/p.pmCount)):''}
  ${p.diasSem.length>0?kRow('Mejor día', `${p.diasSem[0].dia} · ${fi(p.diasSem[0].avg)}`):''}
  ${p.diasSem.length>1?kRow('Día más bajo', `${p.diasSem[p.diasSem.length-1].dia} · ${fi(p.diasSem[p.diasSem.length-1].avg)}`):''}
</table>

${p.semanas.length>0?`
<h3 style="font-size:11px;color:#444;margin:0 0 8px;letter-spacing:.12em;text-transform:uppercase">Tendencia Semanal · Pool Promedio</h3>
<table style="width:100%;border-collapse:collapse;margin-bottom:18px">
  ${p.semanas.map((s,i)=>barRow('Semana '+(i+1),s.avg,maxSem,TEAL,'×'+s.count)).join('')}
</table>`:''}

${p.diasSem.length>0?`
<h3 style="font-size:11px;color:#444;margin:0 0 8px;letter-spacing:.12em;text-transform:uppercase">Pool Promedio por Día</h3>
<table style="width:100%;border-collapse:collapse;margin-bottom:18px">
  ${p.diasSem.map(d=>barRow(d.dia,d.avg,maxDia,GOLD,'×'+d.count)).join('')}
</table>`:''}

${p.topProp.length>0?`
<h3 style="font-size:11px;color:#444;margin:0 0 8px;letter-spacing:.12em;text-transform:uppercase">Top Empleados por Take-Home</h3>
<table style="width:100%;border-collapse:collapse;margin-bottom:18px">
  <tr><th style="${TH}">#</th><th style="${TH}">Empleado</th><th style="${TH}">Rol</th>
  <th style="${TH};text-align:center">Turnos</th><th style="${TH};text-align:right">Take-Home</th>
  <th style="${TH};text-align:right">Prom/turno</th><th style="${TH};text-align:center">Constancia</th></tr>
  ${p.topProp.map((e,i)=>`<tr>
    <td style="${TD};color:#aaa">${i+1}</td>
    <td style="${TD};font-weight:bold">${e.nombre}</td>
    <td style="${TD};color:#888;font-size:11px">${e.rol}</td>
    <td style="${TD};text-align:center;color:#888">${e.dias}</td>
    <td style="${TD};text-align:right;font-weight:700;color:${GOLD}">${fi(e.take)}</td>
    <td style="${TD};text-align:right;color:#666">${fi(e.prom)}</td>
    <td style="${TD};text-align:center"><span style="color:${e.constancia>=80?GREEN:e.constancia>=50?GOLD:'#aaa'}">${e.constancia}%</span></td>
  </tr>`).join('')}
</table>`:''}

${p.sectores.length>0?`
<h3 style="font-size:11px;color:#444;margin:0 0 8px;letter-spacing:.12em;text-transform:uppercase">Distribución por Sector</h3>
<table style="width:100%;border-collapse:collapse">
  ${p.sectores.map(s=>barRow(SECLAB[s.rol]??s.rol,s.total,maxSec,SECCOL[s.rol]??MUTED,s.pct.toFixed(1)+'%')).join('')}
</table>`:''}

</div>${emailFooter(mes,anio)}</div>`
}

// ── Main handler ─────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }
  })

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    const body = await req.json().catch(() => ({})) as { month?: string; tipo?: string }

    // Determine month
    let ym = body.month ?? ''
    if (!ym) {
      const now = new Date(new Date().toLocaleString('en-US', {timeZone: 'America/Costa_Rica'}))
      now.setMonth(now.getMonth() - 1)
      ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
    }

    const [y, m] = ym.split('-')
    const mes    = MONTHS_ES[Number(m)-1] ?? m
    const anio   = Number(y)
    const tipo   = body.tipo ?? 'ambos'

    const results: string[] = []

    if (tipo === 'ventas' || tipo === 'ambos') {
      const v = await calcVentas(supabase, ym)
      if (v.diasVentas > 0) {
        await send(`📈 Satori — Ventas ${mes} ${anio}`, buildVentasEmail(v, mes, anio))
        results.push(`ventas: ${fi(v.total)} · ${v.diasVentas} días · IRS top: ${v.topSal[0]?.nombre??'—'} (${v.topSal[0]?.irs??0})`)
      } else results.push('ventas: sin datos')
    }

    if (tipo === 'propinas' || tipo === 'ambos') {
      const p = await calcPropinas(supabase, ym)
      if (p.turnos > 0) {
        await send(`💰 Satori — Propinas ${mes} ${anio}`, buildPropinasEmail(p, mes, anio))
        results.push(`propinas: ${fi(p.pool)} pool · ${p.turnos} turnos`)
      } else results.push('propinas: sin datos')
    }

    return new Response(JSON.stringify({ ok: true, month: `${mes} ${anio}`, results }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  } catch(err) {
    console.error(err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})
