// Servidor LOCAL de prueba: sirve dist/ con las mismas reglas de _redirects y monta /api/*
// con el mismo código de la Pages Function. Lee SUPABASE_URL y SUPABASE_ANON_KEY del entorno.
// Uso: npm run build && SUPABASE_URL=… SUPABASE_ANON_KEY=… node dev-server.mjs [puerto]
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { manejar } from './functions/_lib/api.js'

const DIST = fileURLToPath(new URL('./dist/', import.meta.url))
const PORT = Number(process.argv[2] || 8788)
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain' }
// CLUB_DEV=1 habilita el contador en memoria (solo local). CLUB_WEB_KEY: la clave de staging, por entorno.
const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  CLUB_WEB_KEY: process.env.CLUB_WEB_KEY, CLUB_DEV: '1',
  RL_CREAR_MAX: process.env.RL_CREAR_MAX, RL_CREAR_VENTANA_S: process.env.RL_CREAR_VENTANA_S }

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (url.pathname.startsWith('/api/')) {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise(r => { let d = ''; req.on('data', c => (d += c)); req.on('end', () => r(d)) })
    const headers = new Headers()
    // En Cloudflare la IP llega en CF-Connecting-IP; acá se simula (o se toma del socket).
    headers.set('CF-Connecting-IP', req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'local')
    const r = await manejar(new Request(url, { method: req.method, headers, body }), env, url.pathname.slice(5))
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return
  }
  let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '')
  if (/^\/(r|c|p)\//.test(p) || p === '/') p = '/index.html'
  try {
    const f = await readFile(join(DIST, p))
    res.writeHead(200, { 'Content-Type': TIPOS[extname(p)] || 'application/octet-stream' }); res.end(f)
  } catch { res.writeHead(404); res.end('no encontrado') }
}).listen(PORT, () => console.log(`club-web local en http://localhost:${PORT}`))
