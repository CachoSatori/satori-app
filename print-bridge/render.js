// Renderizadores de tickets del PoS a ESC/POS. Embrión del HUB LOCAL (F5):
// el formato vive acá para que las tablets manden datos, no bytes.
const { EscPos } = require('./escpos')

const money = n => '₡' + Number(n || 0).toLocaleString('es-CR')

/** Comanda de cocina (KDS en papel — modo contingencia): mesa, curso, ítems. */
function comanda(job) {
  const p = new EscPos(job.width)
  p.align('center').size(true).bold(true).line(job.station || 'COCINA').size(false).bold(false)
  p.line(new Date(job.at || Date.now()).toLocaleString('es-CR')).rule()
  p.align('left').size(true).bold(true).line(`${job.table || 'Mesa'}  (${job.pax || '?'}p)`).size(false).bold(false)
  if (job.salonero) p.line(`Salonero: ${job.salonero}`)
  p.rule()
  for (const it of job.items || []) {
    p.bold(true).line(`${it.qty > 1 ? it.qty + 'x ' : ''}${it.name}`).bold(false)
    if (it.modifiers && it.modifiers.length) p.line('  · ' + it.modifiers.join(', '))
    if (it.course || it.seat) p.line(`  [${it.course || ''}${it.seat ? ' · asiento ' + it.seat : ''}]`)
  }
  return p.rule().feed(2).cut()
}

/** Pre-cuenta / cuenta de mesa: desglose consumo · servicio · IVA · total. */
function precuenta(job) {
  const p = new EscPos(job.width)
  p.align('center').size(true).bold(true).line('SATORI SUSHI BAR').size(false).bold(false)
  p.line(job.location || 'Santa Teresa').line('PRE-CUENTA (no es factura)').rule()
  p.align('left').line(`${job.table || 'Mesa'}  ·  ${job.channel || 'salon'}  ·  ${job.pax || '?'}p`)
  if (job.salonero) p.line(`Atiende: ${job.salonero}`)
  p.rule()
  for (const it of job.items || []) {
    const sub = (it.price || 0)
    p.row(`${it.qty > 1 ? it.qty + 'x ' : ''}${it.name}`.slice(0, job.width - 10), money(sub))
    if (it.modifiers && it.modifiers.length) p.line('  · ' + it.modifiers.join(', '))
  }
  p.rule()
  const t = job.totals || {}
  p.row('Consumo (IVA incl.)', money(t.consumo))
  p.row('  Neto', money(t.neto))
  p.row('  IVA', money(t.iva))
  if (t.servicio) p.row('Servicio 10%', money(t.servicio))
  p.bold(true).size(true).row('TOTAL', money(t.total)).size(false).bold(false)
  return p.rule().feed(2).cut()
}

/** Texto plano arbitrario (prueba de impresora). */
function raw(job) {
  const p = new EscPos(job.width)
  p.align('center').bold(true).line('PRINT-BRIDGE · PRUEBA').bold(false).rule()
  p.align('left')
  for (const l of String(job.body || 'Hola desde el puente de impresión.').split('\n')) p.line(l)
  return p.feed(2).cut()
}

const RENDERERS = { comanda, precuenta, raw }

function render(job) {
  const fn = RENDERERS[job.type] || raw
  return fn(job)
}

module.exports = { render }
