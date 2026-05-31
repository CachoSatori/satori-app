/**
 * Supabase Edge Function — Reporte Mensual Satori
 * Genera y envía el resumen del mes anterior por email via Resend.
 *
 * Triggered:
 *   - Automáticamente el día 1 de cada mes (pg_cron)
 *   - Manualmente via POST /functions/v1/monthly-report
 *     body: { "month": "2026-04" }  (opcional, default = mes anterior)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// On Resend free tier without verified domain, can only send to the signup email.
// Once a domain is verified, change this to 'satorisushibar@gmail.com'
// or use env var: Deno.env.get('REPORT_EMAIL') ?? 'satorisushibar@gmail.com'
const TO_EMAIL       = Deno.env.get('REPORT_TO_EMAIL') ?? 'cachorrogp@gmail.com'
const FROM_EMAIL     = 'Satori App <onboarding@resend.dev>'

const MONTHS_ES: Record<string, string> = {
  '01':'Enero','02':'Febrero','03':'Marzo','04':'Abril','05':'Mayo','06':'Junio',
  '07':'Julio','08':'Agosto','09':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre',
}

// ── Helpers ──────────────────────────────────────────────────
function fi(n: number): string {
  return '₡ ' + Math.round(n).toLocaleString('es-CR')
}
function pct(a: number, b: number): string {
  if (!b) return '—'
  const p = ((a - b) / Math.abs(b)) * 100
  return (p >= 0 ? '+' : '') + p.toFixed(1) + '%'
}
function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── Email HTML template ───────────────────────────────────────
function buildEmail(data: ReportData): string {
  const { ym, year, monthLabel, ventas, prevVentas, propinas, caja, saloneros, icp } = data

  const inkBg    = '#0d0d0d'
  const gold     = '#c8a96e'
  const green    = '#4a7c59'
  const red      = '#c23b22'
  const paper    = '#f5f0e8'
  const muted    = '#888'
  const border   = '#e0dcd4'

  const varPct   = prevVentas > 0 ? pct(ventas.neta, prevVentas) : null
  const varColor = varPct && varPct.startsWith('+') ? green : red

  const topSals = [...saloneros]
    .sort((a, b) => b.promPax - a.promPax)
    .slice(0, 5)

  const icpColor = icp >= 13 ? green : icp >= 10 ? '#a07830' : red
  const icpLabel = icp >= 13 ? 'Excelente' : icp >= 10 ? 'Bueno' : 'A mejorar'

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reporte ${monthLabel} ${year} — Satori</title>
</head>
<body style="margin:0;padding:0;background:${paper};font-family:'DM Mono',monospace,system-ui;color:${inkBg};">

<!-- Header -->
<div style="background:${inkBg};padding:28px 32px;border-bottom:3px solid ${gold};">
  <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:${gold};letter-spacing:.1em;">
    里 SATORI
  </div>
  <div style="font-size:11px;letter-spacing:.3em;color:#555;text-transform:uppercase;margin-top:4px;">
    Reporte Mensual · ${monthLabel} ${year}
  </div>
</div>

<!-- Summary banner -->
<div style="background:#fff;border-bottom:1px solid ${border};padding:24px 32px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:0 16px 0 0;border-right:1px solid ${border};vertical-align:top;">
        <div style="font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:${muted};margin-bottom:6px;">Venta Neta</div>
        <div style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:${inkBg};line-height:1;">${fi(ventas.neta)}</div>
        ${varPct ? `<div style="font-size:12px;font-weight:700;color:${varColor};margin-top:4px;">${varPct} vs mes anterior</div>` : ''}
      </td>
      <td style="padding:0 16px;border-right:1px solid ${border};vertical-align:top;">
        <div style="font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:${muted};margin-bottom:6px;">PAX totales</div>
        <div style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:${inkBg};line-height:1;">${ventas.pax.toLocaleString('es-CR')}</div>
        <div style="font-size:12px;color:${muted};margin-top:4px;">Prom/PAX: ${fi(ventas.promPax)}</div>
      </td>
      <td style="padding:0 16px;border-right:1px solid ${border};vertical-align:top;">
        <div style="font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:${muted};margin-bottom:6px;">Propinas pagadas</div>
        <div style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:${green};line-height:1;">${fi(propinas.total)}</div>
        <div style="font-size:12px;color:${muted};margin-top:4px;">${propinas.turnos} turnos · ${propinas.empleados} empleados</div>
      </td>
      <td style="padding:0 0 0 16px;vertical-align:top;">
        <div style="font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:${muted};margin-bottom:6px;">ICP Restaurante</div>
        <div style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:${icpColor};line-height:1;">${icp.toFixed(1)}%</div>
        <div style="font-size:12px;color:${icpColor};margin-top:4px;font-weight:700;">${icpLabel}</div>
      </td>
    </tr>
  </table>
</div>

<!-- Caja -->
${caja.ingresos > 0 ? `
<div style="padding:20px 32px;border-bottom:1px solid ${border};background:#fff;">
  <div style="font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:${muted};margin-bottom:12px;font-weight:700;">Flujo de Caja</div>
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="font-size:13px;color:${inkBg};">Ingresos registrados</td>
      <td style="text-align:right;font-family:Georgia,serif;font-weight:700;font-size:14px;color:${green};">${fi(caja.ingresos)}</td>
    </tr>
    <tr>
      <td style="font-size:13px;color:${inkBg};padding-top:6px;">Egresos</td>
      <td style="text-align:right;font-family:Georgia,serif;font-weight:700;font-size:14px;color:${red};padding-top:6px;">- ${fi(caja.egresos)}</td>
    </tr>
    <tr>
      <td colspan="2" style="border-top:1px solid ${border};padding-top:8px;margin-top:8px;"></td>
    </tr>
    <tr>
      <td style="font-size:13px;font-weight:700;color:${inkBg};">Saldo neto</td>
      <td style="text-align:right;font-family:Georgia,serif;font-weight:800;font-size:16px;color:${caja.saldo >= 0 ? green : red};">${fi(caja.saldo)}</td>
    </tr>
  </table>
</div>
` : ''}

<!-- Saloneros ranking -->
${topSals.length > 0 ? `
<div style="padding:20px 32px;border-bottom:1px solid ${border};background:#fff;">
  <div style="font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:${muted};margin-bottom:12px;font-weight:700;">Ranking Saloneros — Prom/PAX</div>
  <table width="100%" cellpadding="0" cellspacing="6" style="border-collapse:separate;border-spacing:0 6px;">
    ${topSals.map((s, i) => `
    <tr>
      <td style="width:24px;font-size:12px;color:${muted};font-weight:700;">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</td>
      <td style="font-size:13px;font-weight:600;color:${inkBg};">${s.nombre}</td>
      <td style="text-align:right;font-size:11px;color:${muted};">PAX ${s.pax} · ${s.days}d</td>
      <td style="text-align:right;font-family:Georgia,serif;font-weight:700;font-size:14px;color:${gold};width:110px;">${fi(s.promPax)}</td>
    </tr>`).join('')}
  </table>
</div>
` : ''}

<!-- Ventas detail -->
<div style="padding:20px 32px;border-bottom:1px solid ${border};background:#faf8f4;">
  <div style="font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:${muted};margin-bottom:12px;font-weight:700;">Detalle financiero</div>
  <table width="100%" cellpadding="0" cellspacing="0">
    ${[
      ['Venta Bruta', fi(ventas.bruta)],
      ['IVA (13%)', fi(ventas.iva)],
      ['Servicio (10%)', fi(ventas.serv)],
      ['Venta Neta', fi(ventas.neta)],
      ['Salón', fi(ventas.salon)],
      ['Delivery', fi(ventas.delivery)],
    ].map(([label, val]) => `
    <tr>
      <td style="font-size:12px;color:${inkBg};padding:4px 0;">${label}</td>
      <td style="text-align:right;font-size:12px;color:${inkBg};font-family:Georgia,serif;font-weight:600;">${val}</td>
    </tr>`).join('')}
  </table>
</div>

<!-- Footer -->
<div style="background:${inkBg};padding:20px 32px;text-align:center;">
  <div style="font-family:Georgia,serif;font-size:14px;color:${gold};margin-bottom:4px;">里 Satori · Santa Teresa, Costa Rica</div>
  <div style="font-size:10px;color:#444;letter-spacing:.1em;">Reporte generado automáticamente · ${new Date().toLocaleDateString('es-CR', { timeZone: 'America/Costa_Rica' })}</div>
</div>

</body>
</html>`
}

// ── Types ────────────────────────────────────────────────────
interface SaloneroStats { nombre: string; pax: number; days: number; total: number; promPax: number }
interface ReportData {
  ym: string; year: string; monthLabel: string
  ventas:     { neta: number; bruta: number; iva: number; serv: number; salon: number; delivery: number; pax: number; promPax: number }
  prevVentas: number
  propinas:   { total: number; turnos: number; empleados: number }
  caja:       { ingresos: number; egresos: number; saldo: number }
  saloneros:  SaloneroStats[]
  icp:        number
}

// ── Main handler ─────────────────────────────────────────────
Deno.serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } })

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    // Determine month (default: previous month in CR time)
    let ym: string
    try {
      const body = await req.json().catch(() => ({}))
      ym = body.month ?? ''
    } catch { ym = '' }

    if (!ym) {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }))
      now.setMonth(now.getMonth() - 1)
      ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    }

    const [year, month] = ym.split('-')
    const monthLabel = MONTHS_ES[month] ?? month
    const prev = prevMonth(ym)

    // ── Fetch ventas ─────────────────────────────────────────
    const { data: ventasDias } = await supabase
      .from('ventas_dias' as never)
      .select('data')
      .gte('session_date', `${ym}-01`)
      .lte('session_date', `${ym}-31`)

    let ventaNeta = 0, ventaBruta = 0, ventaIVA = 0, ventaServ = 0
    let ventaSalon = 0, ventaDelivery = 0, ventaPax = 0
    const salMap: Record<string, SaloneroStats> = {}

    for (const row of (ventasDias ?? []) as Array<{ data: { saloneros: Record<string, { total?: number; iva?: number; serv?: number; pax?: number; esCajero?: boolean; delivery?: number; salon?: number; promPax?: number; iCom?: number; iBeb?: number }> } }>) {
      for (const [name, s] of Object.entries(row.data?.saloneros ?? {})) {
        const t = s.total ?? 0
        ventaNeta += t
        ventaIVA  += s.iva ?? 0
        ventaServ += s.serv ?? 0
        if (s.esCajero) {
          ventaDelivery += s.delivery ?? 0
          ventaSalon    += s.salon ?? 0
        } else {
          ventaSalon += t
          ventaPax   += s.pax ?? 0
          if (!salMap[name]) salMap[name] = { nombre: name, pax: 0, days: 0, total: 0, promPax: 0 }
          salMap[name].pax   += s.pax ?? 0
          salMap[name].total += t
          salMap[name].days++
        }
      }
    }
    ventaBruta = ventaNeta + ventaIVA + ventaServ
    for (const s of Object.values(salMap)) s.promPax = s.pax > 0 ? s.total / s.pax : 0

    // Previous month ventas
    const { data: prevDias } = await supabase
      .from('ventas_dias' as never)
      .select('data')
      .gte('session_date', `${prev}-01`)
      .lte('session_date', `${prev}-31`)
    let prevNeta = 0
    for (const row of (prevDias ?? []) as Array<{ data: { saloneros: Record<string, { total?: number }> } }>) {
      for (const s of Object.values(row.data?.saloneros ?? {})) prevNeta += s.total ?? 0
    }

    // ── Fetch propinas ────────────────────────────────────────
    const { data: tipSessions } = await supabase
      .from('tip_sessions')
      .select('id')
      .eq('status', 'closed')
      .gte('session_date', `${ym}-01`)
      .lte('session_date', `${ym}-31`)

    const sessionIds = (tipSessions ?? []).map((s: { id: string }) => s.id)
    let propTotal = 0, propEmpleados = 0
    if (sessionIds.length > 0) {
      const { data: entries } = await supabase
        .from('tip_entries')
        .select('payout_crc, employee_id')
        .in('session_id', sessionIds)
      const empSet = new Set<string>()
      for (const e of (entries ?? []) as Array<{ payout_crc: number | null; employee_id: string }>) {
        propTotal += e.payout_crc ?? 0
        if (e.payout_crc && e.payout_crc > 0) empSet.add(e.employee_id)
      }
      propEmpleados = empSet.size
    }

    // ── Fetch caja ────────────────────────────────────────────
    const { data: cashSessions } = await supabase
      .from('cash_sessions')
      .select('id')
      .eq('status', 'closed')
      .gte('session_date', `${ym}-01`)
      .lte('session_date', `${ym}-31`)

    const cashIds = (cashSessions ?? []).map((s: { id: string }) => s.id)
    let cajaIngresos = 0, cajaEgresos = 0
    if (cashIds.length > 0) {
      const { data: movs } = await supabase
        .from('cash_movements')
        .select('movement_type, amount_crc')
        .in('session_id', cashIds)
        .neq('status', 'rechazado')
      for (const m of (movs ?? []) as Array<{ movement_type: string; amount_crc: number }>) {
        if (m.movement_type === 'ingreso')    cajaIngresos += m.amount_crc
        else if (m.movement_type !== 'traspaso') cajaEgresos += m.amount_crc
      }
    }

    // ── ICP ───────────────────────────────────────────────────
    const icp = ventaNeta > 0 && propTotal > 0 ? (propTotal / ventaNeta * 100) : 0

    // ── Build report ──────────────────────────────────────────
    const reportData: ReportData = {
      ym, year, monthLabel,
      ventas: { neta: ventaNeta, bruta: ventaBruta, iva: ventaIVA, serv: ventaServ, salon: ventaSalon, delivery: ventaDelivery, pax: ventaPax, promPax: ventaPax > 0 ? ventaSalon / ventaPax : 0 },
      prevVentas: prevNeta,
      propinas: { total: propTotal, turnos: sessionIds.length, empleados: propEmpleados },
      caja: { ingresos: cajaIngresos, egresos: cajaEgresos, saldo: cajaIngresos - cajaEgresos },
      saloneros: Object.values(salMap),
      icp,
    }

    const html = buildEmail(reportData)

    // ── Send email via Resend ─────────────────────────────────
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    FROM_EMAIL,
        to:      [TO_EMAIL],
        subject: `📊 Reporte ${monthLabel} ${year} — Satori`,
        html,
      }),
    })

    const emailData = await emailRes.json()
    if (!emailRes.ok) throw new Error(`Resend error: ${JSON.stringify(emailData)}`)

    return new Response(JSON.stringify({
      ok:      true,
      month:   `${monthLabel} ${year}`,
      emailId: emailData.id,
      stats: {
        ventaNeta:  Math.round(ventaNeta),
        propinas:   Math.round(propTotal),
        icp:        +icp.toFixed(1),
        saloneros:  Object.keys(salMap).length,
        cajaMovs:   cashIds.length,
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})
