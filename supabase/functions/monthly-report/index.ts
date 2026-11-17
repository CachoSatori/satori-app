/**
 * Supabase Edge Function — Reportes Mensuales Satori
 * Ported from SATORI PROPINAS standalone satori_apps_script_v4.1.js
 *
 * Sends TWO emails (same as standalone):
 *   1. 📈 Reporte de Ventas — IRS saloneros, top productos, tendencia semanal
 *   2. 💰 Reporte de Propinas — distribución sector, AM/PM split, top take-home
 *
 * Triggers:
 *   - pg_cron (día 1 y día 15) con Authorization: Bearer <service_role, desde Vault>
 *   - Botón de Admin (owner activo) con su JWT
 *   - body { "month"?: "YYYY-MM", "periodo"?: "mes"|"quincena", "tipo"?: "ventas"|"propinas"|"ambos", "dry_run"?: boolean }
 *     · periodo "mes" (o sin periodo): mes completo vs mes anterior (cron del día 1, botón de Admin).
 *     · periodo "quincena": días 1–14 del mes vs 1–14 del mes anterior (cron del día 15). Ver periodo.ts.
 *
 * SEC-02 (06/11): exige service_role u owner activo; CORS con allowlist; parámetros validados;
 * la respuesta NO trae montos ni nombres; errores fijos. Deploy A MANO con verify_jwt = true
 * (regla: ningún PR a main con supabase/functions/ hasta el ítem 11).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { poolTotalSesion, type PoolEntry } from './pool.ts'
import { mesActualCR, type RangoMes } from './fechas.ts'
import { elegirPeriodo } from './periodo.ts'
import { buildVentasEmail, buildPropinasEmail } from './plantilla.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TO_EMAIL       = Deno.env.get('REPORT_TO_EMAIL') ?? 'cachorrogp@gmail.com'
const FROM_EMAIL     = 'Satori App <onboarding@resend.dev>'

// Plantillas de los correos (estándar de reportes Satori adaptado a correo): ./plantilla.ts

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
// supabase-js NO tira cuando PostgREST responde 400/500: devuelve { data: null, error }. Antes el error se
// ignoraba y un rango inválido («2026-09-31») se leía como «mes sin datos» → no salía el correo, sin aviso.
// Ahora cualquier error de lectura corta el reporte: 500 con ref y la etapa en el log (sin montos ni nombres).
function exigirLectura(etapa: string, error: { message?: string } | null | undefined): void {
  if (error) throw new Error(`lectura ${etapa}: ${error.message ?? 'error'}`)
}

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

// `r` = período reportado; `rPrev` = mismo período del mes anterior (mes completo o días 1–14): ver periodo.ts.
async function calcVentas(supabase: ReturnType<typeof createClient>, r: RangoMes, rPrev: RangoMes): Promise<VentasCalc> {

  // Fetch ventas_dias for current and previous month
  const { data: dias, error: eDias } = await supabase.from('ventas_dias' as never)
    .select('session_date, data')
    .gte('session_date', r.desde)
    .lte('session_date', r.hasta) as { error: { message?: string } | null; data: Array<{session_date: string; data: {saloneros: Record<string, {total?:number;iva?:number;serv?:number;pax?:number;iCom?:number;iBeb?:number;esCajero?:boolean;delivery?:number;prods?:[string,number,number][]}>}}> | null }

  exigirLectura('ventas_mes', eDias)

  const { data: prevDias, error: ePrev } = await supabase.from('ventas_dias' as never)
    .select('data').gte('session_date', rPrev.desde).lte('session_date', rPrev.hasta)
  exigirLectura('ventas_mes_anterior', ePrev)

  // Product classifications
  const { data: prodMap_, error: eProd } = await supabase.from('product_map' as never).select('nombre, tipo')
  exigirLectura('product_map', eProd)
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

async function calcPropinas(supabase: ReturnType<typeof createClient>, r: RangoMes): Promise<PropinasCalc> {
  const { data: sessions, error: eSes } = await supabase.from('tip_sessions')
    .select('id, shift_type, session_date').eq('status','closed')
    .gte('session_date', r.desde).lte('session_date', r.hasta)
  exigirLectura('tip_sessions', eSes)
  const sids = (sessions ?? []).map((s: {id:string}) => s.id)

  if (!sids.length) return {pool:0,barra:0,turnos:0,amCount:0,pmCount:0,amPool:0,pmPool:0,topProp:[],sectores:[],semanas:[],diasSem:[]}

  // Pool totals from sessions
  const { data: sessData, error: eSesData } = await supabase.from('tip_sessions')
    .select('id,pool_efectivo_crc,pool_efectivo_usd,pool_barra_crc,pool_barra_electronico_crc,exchange_rate,shift_type,session_date')
    .in('id', sids)
  exigirLectura('tip_sessions_pool', eSesData)

  // Entries + empleados PRIMERO: el pool de cada sesión = calcTurno.totalPool (sagrado) necesita la
  // propinaSala — las propinas INDIVIDUALES de sala, que viven en tip_entries.tip_amount_crc/usd, NO en
  // las columnas de la sesión. El correo viejo sumaba solo las columnas → perdía propinaSala.
  const { data: entries, error: eEnt } = await supabase.from('tip_entries')
    .select('employee_id, payout_crc, session_id, tip_amount_crc, tip_amount_usd, covered_role').in('session_id', sids)
  exigirLectura('tip_entries', eEnt)
  const { data: emps, error: eEmp } = await supabase.from('employees').select('id, full_name, role')
  exigirLectura('employees', eEmp)
  const empInfo: Record<string,{name:string;role:string}> = {}
  for (const e of (emps ?? []) as Array<{id:string;full_name:string;role:string}>) empInfo[e.id] = {name:e.full_name, role:e.role}

  // Agrupar las entries por sesión clasificando sala vs barra por el ROL EFECTIVO = covered_role ?? rol
  // base — CANÓNICO (decisión del dueño: el número REAL es lo que la persona CUBRIÓ ese turno). Igual que
  // calcHistory (sagrado) y Quincenal/TipHistory. Jul-2026 = ₡2.167.131 (== payout distribuido, conserva).
  const entriesBySesion: Record<string, PoolEntry[]> = {}
  for (const e of (entries ?? []) as Array<{employee_id:string;session_id:string;tip_amount_crc:number|null;tip_amount_usd:number|null;covered_role:string|null}>) {
    const effectiveRole = e.covered_role ?? empInfo[e.employee_id]?.role ?? ''
    ;(entriesBySesion[e.session_id] ??= []).push({ role: effectiveRole, tip_amount_crc: e.tip_amount_crc, tip_amount_usd: e.tip_amount_usd })
  }

  let pool=0, barra=0, amCount=0, pmCount=0, amPool=0, pmPool=0
  const semMap: Record<string,number[]> = {}
  const dowMap: Record<string,number[]> = {}
  const DAYS_ES: Record<number,string> = {0:'Domingo',1:'Lunes',2:'Martes',3:'Miércoles',4:'Jueves',5:'Viernes',6:'Sábado'}

  for (const s of (sessData ?? []) as Array<{id:string;pool_efectivo_crc:number;pool_efectivo_usd:number;pool_barra_crc:number;pool_barra_electronico_crc:number;exchange_rate:number;shift_type:string;session_date:string}>) {
    // Pool por sesión = calcTurno.totalPool (sagrado, replicado en ./pool.ts): efectivo + propinaSala(sala)
    // + barra (efectivo + electrónica). Atado al peso por el oracle test pool.test.ts.
    const p = poolTotalSesion(s, entriesBySesion[s.id] ?? [])
    pool += p; barra += (s.pool_barra_crc??0) + (s.pool_barra_electronico_crc??0)
    const isAM = s.shift_type === 'AM' || s.shift_type === 'Mediodía'
    if (isAM) { amCount++; amPool += p } else { pmCount++; pmPool += p }
    const dNum = Number(s.session_date.slice(8,10))
    const sem = dNum<=7?'1':dNum<=14?'2':dNum<=21?'3':dNum<=28?'4':'5'
    if (!semMap[sem]) semMap[sem] = []; semMap[sem].push(p)
    const dow = DAYS_ES[new Date(s.session_date+'T12:00:00').getDay()] ?? ''
    if (!dowMap[dow]) dowMap[dow] = []; dowMap[dow].push(p)
  }

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

// ── SEC-02 (06/11): autenticación, CORS y validación ─────────────────────────
// Antes la función corría con service_role SIN pedir nada (verify_jwt off): cualquiera podía pedirle
// el total de ventas y el top salonero del mes, y disparar los correos del reporte.
// Ahora: Authorization = service_role (el cron, desde Vault) o el JWT de un OWNER ACTIVO (botón de
// Admin). La respuesta ya no trae montos ni nombres; los errores son fijos (+ ref en el log).
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

function origenPermitido(origin: string): boolean {
  return origin === 'https://cachosatori.github.io'
    || /^https:\/\/([a-z0-9-]+\.)?satori-staging\.pages\.dev$/.test(origin)
}
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  if (origenPermitido(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}
function igualConstante(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}
// month: YYYY-MM entre 2024-01 y el mes en curso (CR). tipo: ventas | propinas | ambos.
function mesValido(ym: string): boolean {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym)
  if (!m) return false
  return ym >= '2024-01' && ym <= mesActualCR(new Date())
}

// ── Main handler ─────────────────────────────────────────────
Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  const ref = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  const responder = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  const falla = (status: number, code: string, error: string) => responder(status, { ok: false, code, error, ref })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return falla(405, 'metodo', 'Método no permitido')

  try {
    // 1) Quién llama: service_role (cron) u owner activo (botón de Admin). Nada más.
    const auth = req.headers.get('Authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!token) return falla(401, 'sin_sesion', 'No autorizado')
    let quien = 'service_role'
    // service_role: igual a la del entorno, o verificada POR EL SERVIDOR (un endpoint de admin de GoTrue
    // solo responde a una clave service_role real; sirve para el JWT viejo y para las claves nuevas).
    const esServiceRole = igualConstante(token, SUPABASE_KEY) || await (async () => {
      try {
        const c = createClient(SUPABASE_URL, token, { auth: { persistSession: false, autoRefreshToken: false } })
        const { error } = await c.auth.admin.listUsers({ page: 1, perPage: 1 })
        return !error
      } catch { return false }
    })()
    if (!esServiceRole) {
      const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: ud } = await comoUsuario.auth.getUser()
      if (!ud?.user) return falla(401, 'sin_sesion', 'No autorizado')
      const admin = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
      const { data: owner, error: oe } = await admin.from('profiles').select('id')
        .eq('id', ud.user.id).eq('role', 'owner').eq('is_active', true).maybeSingle()
      if (oe) { console.error(JSON.stringify({ ref, etapa: 'owner', detalle: oe.message })); return falla(500, 'interno', 'No se pudo generar el reporte') }
      if (!owner) return falla(403, 'no_autorizado', 'Solo un owner activo puede pedir el reporte')
      quien = `owner:${ud.user.id}`
    }

    // 2) Parámetros.
    const body = await req.json().catch(() => ({})) as { month?: unknown; periodo?: unknown; tipo?: unknown; dry_run?: unknown }
    if (body === null || typeof body !== 'object') return falla(400, 'entrada', 'Datos inválidos')
    let ym = ''
    if (body.month !== undefined && body.month !== null && body.month !== '') {
      if (typeof body.month !== 'string' || !mesValido(body.month)) return falla(400, 'mes', 'Mes inválido (YYYY-MM)')
      ym = body.month
    }
    // Período: "mes" (por defecto; sin month = mes anterior en CR) o "quincena" (días 1–14; sin month = la
    // última 1.ª quincena completa en CR, el día 15 = la del mes en curso). Ver periodo.ts.
    const elegido = elegirPeriodo(body.periodo, ym, new Date())
    if (!elegido.ok) return falla(400, elegido.code, elegido.error)
    const plan = elegido.plan
    const tipo = body.tipo === undefined || body.tipo === null || body.tipo === '' ? 'ambos' : body.tipo
    if (tipo !== 'ventas' && tipo !== 'propinas' && tipo !== 'ambos') return falla(400, 'tipo', 'Tipo inválido (ventas, propinas o ambos)')
    if (body.dry_run !== undefined && typeof body.dry_run !== 'boolean') return falla(400, 'dry_run', 'dry_run inválido')
    const dry = body.dry_run === true   // modo seco: calcula todo, NO manda correos

    // 3) Reporte. La respuesta dice qué se envió, sin montos ni nombres (van solo en el correo).
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    const enviados: string[] = [], sinDatos: string[] = []

    if (tipo === 'ventas' || tipo === 'ambos') {
      const v = await calcVentas(supabase, plan.rango, plan.rangoComparado)
      if (v.diasVentas > 0) {
        const html = buildVentasEmail(v, plan)
        if (!dry) await send(plan.asuntoVentas, html)
        enviados.push('ventas')
      } else sinDatos.push('ventas')
    }
    if (tipo === 'propinas' || tipo === 'ambos') {
      const p = await calcPropinas(supabase, plan.rango)
      if (p.turnos > 0) {
        const html = buildPropinasEmail(p, plan)
        if (!dry) await send(plan.asuntoPropinas, html)
        enviados.push('propinas')
      } else sinDatos.push('propinas')
    }

    console.log(JSON.stringify({ ref, quien, ym: plan.ym, periodo: plan.periodo, desde: plan.rango.desde, hasta: plan.rango.hasta, tipo, dry, enviados, sinDatos }))
    return responder(200, { ok: true, month: plan.etiqueta, periodo: plan.periodo, dry_run: dry, enviados, sin_datos: sinDatos })
  } catch (err) {
    console.error(JSON.stringify({ ref, etapa: 'no_controlado', detalle: String(err) }))
    return falla(500, 'interno', 'No se pudo generar el reporte')
  }
})
