// Smoke test del print-bridge: levanta el server en SIM, manda una comanda y una
// pre-cuenta, y verifica que el render contiene lo esperado. `node smoke.js`.
const http = require('http')
const { spawn } = require('child_process')

const PORT = 7099
const post = (path, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body)
  const req = http.request({ host: '127.0.0.1', port: PORT, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
    res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(JSON.parse(b))) })
  req.on('error', reject); req.end(data)
})

const srv = spawn('node', [__dirname + '/server.js'], { env: { ...process.env, PORT: String(PORT), SIM: '1' }, stdio: 'inherit' })

setTimeout(async () => {
  let failed = false
  const check = (cond, msg) => { console.log((cond ? '✓' : '✗') + ' ' + msg); if (!cond) failed = true }
  try {
    const comanda = await post('/print', {
      type: 'comanda', station: 'cocina', table: 'Mesa 5', pax: 4, salonero: 'Ana',
      items: [{ qty: 1, name: 'SATORI ROLL', course: 'principal', seat: 2 }, { qty: 1, name: 'MOJITO', modifiers: ['Zacapa'], course: 'bebida', seat: 1 }],
    })
    check(comanda.ok && comanda.mode === 'sim', 'comanda OK en modo sim')
    check(/SATORI ROLL/.test(comanda.preview) && /Zacapa/.test(comanda.preview), 'comanda renderiza ítems y modificadores')

    const precuenta = await post('/print', {
      type: 'precuenta', table: 'Mesa 5', channel: 'salon', pax: 4,
      items: [{ qty: 1, name: 'MOJITO ZACAPA 23', price: 7500 }],
      totals: { consumo: 7500, neto: 6637.17, iva: 862.83, servicio: 663.72, total: 8163.72 },
    })
    check(/TOTAL/.test(precuenta.preview) && /8163,72/.test(precuenta.preview.replace(/\s/g, '')), 'pre-cuenta renderiza TOTAL con servicio')
  } catch (e) {
    console.error('✗ error:', e.message); failed = true
  } finally {
    srv.kill()
    console.log(failed ? '\nSMOKE FAIL' : '\nSMOKE OK')
    process.exit(failed ? 1 : 0)
  }
}, 600)
