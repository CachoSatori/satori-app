#!/usr/bin/env node
// PRINT-BRIDGE — puente de impresión LAN (embrión del HUB LOCAL F5).
// Recibe trabajos por HTTP desde las tablets/KDS y los manda por TCP raw (9100)
// a las térmicas ESC/POS (3nStar RPT004). Sin hardware: modo SIM (renderiza el
// ticket a texto y lo loguea). Sin dependencias — corre con `node server.js`.
//
// Config por variables de entorno (ver README):
//   PORT (7070) · SIM (1=simulación, 0=imprime de verdad) · PAPER_WIDTH (42)
//   Impresoras: PRINTER_CAJA, PRINTER_BARRA, PRINTER_SALON = "ip:puerto" (puerto 9100 default)

const http = require('http')
const net = require('net')
const { render } = require('./render')

const PORT = Number(process.env.PORT || 7070)
const SIM = process.env.SIM !== '0'                 // por defecto simulación (seguro)
const PAPER_WIDTH = Number(process.env.PAPER_WIDTH || 42)

// Estaciones de impresión (ROADMAP: CAJA / BARRA / SALÓN). Las "previas" → SALÓN.
const PRINTERS = {
  caja:  process.env.PRINTER_CAJA  || '',
  barra: process.env.PRINTER_BARRA || '',
  salon: process.env.PRINTER_SALON || '',
}

function parseTarget(addr) {
  const [ip, port] = String(addr).split(':')
  return { ip, port: Number(port || 9100) }
}

// Envía un Buffer ESC/POS por TCP raw a la impresora. Promesa con timeout.
function sendToPrinter(addr, buf) {
  return new Promise((resolve, reject) => {
    const { ip, port } = parseTarget(addr)
    if (!ip) return reject(new Error('impresora sin IP configurada'))
    const sock = net.createConnection({ host: ip, port }, () => sock.end(buf))
    sock.setTimeout(5000)
    sock.on('timeout', () => { sock.destroy(); reject(new Error(`timeout conectando a ${ip}:${port}`)) })
    sock.on('error', reject)
    sock.on('close', () => resolve())
  })
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(obj))
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,GET' })
    return res.end()
  }
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, mode: SIM ? 'sim' : 'real', printers: Object.keys(PRINTERS).filter(k => PRINTERS[k]) })
  }
  if (req.method === 'POST' && req.url === '/print') {
    let body = ''
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy() })
    req.on('end', async () => {
      let job
      try { job = JSON.parse(body || '{}') } catch { return send(res, 400, { ok: false, error: 'JSON inválido' }) }
      job.width = job.width || PAPER_WIDTH
      const station = (job.station_route || job.station || 'salon').toLowerCase()
      const doc = render(job)   // EscPos: .buffer() para TCP, .text() para preview

      if (SIM) {
        const preview = doc.text()
        console.log(`\n──── [SIM] estación=${station} tipo=${job.type || 'raw'} ────\n${preview}\n────────────────────────────────`)
        return send(res, 200, { ok: true, mode: 'sim', station, preview })
      }
      const addr = PRINTERS[station] || PRINTERS.salon
      try {
        await sendToPrinter(addr, doc.buffer())
        send(res, 200, { ok: true, mode: 'real', station, target: addr })
      } catch (e) {
        console.error(`[ERR] ${station}: ${e.message}`)
        send(res, 502, { ok: false, mode: 'real', station, error: e.message })
      }
    })
    return
  }
  send(res, 404, { ok: false, error: 'ruta no encontrada — usá POST /print o GET /health' })
})

server.listen(PORT, () => {
  console.log(`print-bridge escuchando en :${PORT} · modo=${SIM ? 'SIMULACIÓN (no imprime)' : 'REAL'} · ancho=${PAPER_WIDTH}`)
  console.log(`estaciones: ${Object.entries(PRINTERS).map(([k, v]) => `${k}=${v || '(sin config)'}`).join(' · ')}`)
})
