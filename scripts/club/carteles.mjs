#!/usr/bin/env node
// Carteles del piloto del Club (10-nov): HTML A4 imprimible + PDF, con la estética de los reportes nuevos
// (docs/club-satori/ESTANDAR-reportes.md: papel blanco, Cormorant Garamond + DM Sans incrustadas, oro solo como filete).
// ES (usted) y EN en el mismo cartel. Sin datos personales.
//
//   node scripts/club/carteles.mjs --dominio https://<dominio del Club> [--local santa-teresa] [--codigo <código del anfitrión>]
//
//   · cartel-socios-local-club : mesa y caja. «Hágase socio del Local Club», con el QR del alta del local
//                                (<dominio>/alta?local=<local>).
//   · cartel-hotel-cupon       : recepción de hoteles. El cupón del 10 % y cómo se usa. El QR es el link del anfitrión
//                                (<dominio>/r/<código>): con --codigo se imprime el de ese hotel; sin él, el cartel sale con
//                                el lugar del QR marcado (para la muestra del repo).
// El dominio NO se escribe en el código (src/dominioRepo.test.ts): va por --dominio (el de VITE_CLUB_URL).
// Salida: docs/club-satori/piloto/<nombre>.html y .pdf (el PDF con el Chromium de Playwright). Con --codigo, la salida va a
// --salida <carpeta> (por defecto la carpeta actual): un cartel con el QR de un hotel no va al repo.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(join(RAIZ, 'package.json'))
const QRCode = require('qrcode')

function arg(nombre, def) {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const dominio = String(arg('dominio', '')).replace(/\/+$/, '')
if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/.test(dominio)) {
  console.error('uso: node scripts/club/carteles.mjs --dominio https://<dominio del Club> [--local santa-teresa] [--codigo <código>]')
  process.exit(1)
}
const local = arg('local', 'santa-teresa')
if (!/^[a-z0-9-]{2,40}$/.test(local)) { console.error('local no válido'); process.exit(1) }
const codigo = arg('codigo', null)
if (codigo !== null && !/^[A-HJ-NP-Z2-9]{8}$/.test(codigo)) { console.error('código de anfitrión no válido (8 caracteres)'); process.exit(1) }
const salida = codigo ? resolve(arg('salida', '.')) : join(RAIZ, 'docs/club-satori/piloto')
mkdirSync(salida, { recursive: true })

const b64 = (ruta) => readFileSync(join(RAIZ, ruta)).toString('base64')
const fuente = (pkg, archivo) => b64(`node_modules/@fontsource/${pkg}/files/${archivo}`)
const FUENTES = `
@font-face{font-family:'Cormorant Garamond';font-weight:500;src:url(data:font/woff2;base64,${fuente('cormorant-garamond', 'cormorant-garamond-latin-500-normal.woff2')}) format('woff2')}
@font-face{font-family:'Cormorant Garamond';font-weight:600;src:url(data:font/woff2;base64,${fuente('cormorant-garamond', 'cormorant-garamond-latin-600-normal.woff2')}) format('woff2')}
@font-face{font-family:'Cormorant Garamond';font-weight:500;font-style:italic;src:url(data:font/woff2;base64,${fuente('cormorant-garamond', 'cormorant-garamond-latin-500-italic.woff2')}) format('woff2')}
@font-face{font-family:'DM Sans';font-weight:400;src:url(data:font/woff2;base64,${fuente('dm-sans', 'dm-sans-latin-400-normal.woff2')}) format('woff2')}
@font-face{font-family:'DM Sans';font-weight:500;src:url(data:font/woff2;base64,${fuente('dm-sans', 'dm-sans-latin-500-normal.woff2')}) format('woff2')}
@font-face{font-family:'DM Sans';font-weight:600;src:url(data:font/woff2;base64,${fuente('dm-sans', 'dm-sans-latin-600-normal.woff2')}) format('woff2')}`
const DARUMA = `data:image/png;base64,${b64('club-web/public/marca/daruma.png')}`

const CSS = `${FUENTES}
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:#1f2120}
body{font:400 11pt/1.5 'DM Sans',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pagina{width:210mm;height:297mm;padding:16mm 18mm 14mm;position:relative;overflow:hidden;display:flex;flex-direction:column}
.cab{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:.75pt solid #b48e50;padding-bottom:2.5mm}
.marca{display:flex;align-items:center;gap:3mm;font:600 19pt/1 'Cormorant Garamond',serif;letter-spacing:.02em}
.marca img{height:11mm}
.cab-der{text-align:right;color:#6e706c;font-size:9pt;line-height:1.35}
h1{font:500 38pt/1.02 'Cormorant Garamond',serif;margin:9mm 0 2mm}
.en-h{font:500 italic 20pt/1.1 'Cormorant Garamond',serif;color:#6e706c;margin:0 0 6mm}
.cuerpo{display:grid;grid-template-columns:1fr 78mm;gap:10mm;align-items:start}
.qr{border:.75pt solid #b48e50;border-radius:2mm;padding:5mm;text-align:center}
.qr svg{width:100%;height:auto;display:block}
.qr .falta{aspect-ratio:1;border:1.5pt dashed #b48e50;display:flex;align-items:center;justify-content:center;color:#8a6a33;font:500 italic 15pt/1.2 'Cormorant Garamond',serif;padding:6mm}
.qr .leyenda{font-size:9pt;color:#6e706c;margin-top:2.5mm;line-height:1.35}
h2{font:600 15pt/1.2 'Cormorant Garamond',serif;margin:0 0 1.5mm}
ul,ol{margin:0 0 5mm;padding-left:5mm}
li{margin:0 0 1.6mm}
.en{color:#4a4c48}
.en h2{color:#4a4c48}
.filete{border-top:.75pt solid #b48e50;margin:2mm 0 5mm}
.pie{margin-top:auto;display:flex;justify-content:space-between;color:#9a9b96;font-size:8.5pt;border-top:.5pt solid #e6e4de;padding-top:2mm}
`

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
async function qrSvg(url) {
  return QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#1f2120', light: '#ffffff' } })
}

function pagina({ titulo, tituloEn, cabDer, qr, leyendaQr, es, en, pie }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} · Satori</title>
<!-- Generado por scripts/club/carteles.mjs (10-nov). No editar a mano: cambiar el script y volver a generar. Sin datos personales. -->
<style>${CSS}</style>
</head>
<body>
<section class="pagina">
  <div class="cab">
    <div class="marca"><img src="${DARUMA}" alt="">Satori</div>
    <div class="cab-der">${cabDer}</div>
  </div>
  <h1>${esc(titulo)}</h1>
  <p class="en-h">${esc(tituloEn)}</p>
  <div class="cuerpo">
    <div>${es}<div class="filete"></div><div class="en">${en}</div></div>
    <div class="qr">${qr}<div class="leyenda">${leyendaQr}</div></div>
  </div>
  <div class="pie"><span>${pie}</span><span>Club Satori</span></div>
</section>
</body>
</html>
`
}

const urlAlta = `${dominio}/alta?local=${local}`
const urlPriv = `${dominio}/privacidad`
const carteles = []

// (a) Mesa y caja: alta de socios del Local Club
carteles.push({
  nombre: 'cartel-socios-local-club',
  html: pagina({
    titulo: 'Hágase socio del Local Club',
    tituloEn: 'Join the Local Club',
    cabDer: 'Para quienes viven en la zona<br>For locals',
    qr: await qrSvg(urlAlta),
    leyendaQr: `Escanee con la cámara de su teléfono<br>Scan with your phone camera<br><b>${esc(urlAlta.replace(/^https:\/\//, ''))}</b>`,
    es: `<h2>Su beneficio</h2>
      <ul>
        <li><b>10 % en su cuenta</b> y una <b>cortesía sorpresa</b> en cada visita.</li>
        <li>Una visita con beneficio por día.</li>
        <li><b>Vale en Satori Santa Teresa (y pronto en Nosara).</b></li>
        <li>Sus invitados en la misma mesa también.</li>
      </ul>
      <h2>Cómo se hace socio</h2>
      <ol>
        <li>Escanee el código y complete su nombre y su WhatsApp.</li>
        <li>En su próxima visita, muestre su QR de socio en caja: ahí validamos su alta.</li>
        <li>Desde su portal puede darse de baja cuando quiera.</li>
      </ol>`,
    en: `<h2>Your benefit</h2>
      <ul>
        <li><b>10% off your bill</b> and a <b>surprise treat</b> on every visit.</li>
        <li>One visit with the benefit per day.</li>
        <li><b>Valid at Satori Santa Teresa (and soon in Nosara).</b></li>
        <li>Your guests at the same table too.</li>
      </ul>
      <h2>How to join</h2>
      <ol>
        <li>Scan the code and enter your name and WhatsApp.</li>
        <li>On your next visit, show your member QR at the register to validate your sign-up.</li>
        <li>You can leave at any time from your portal.</li>
      </ol>`,
    pie: `Aviso de privacidad · Privacy notice: ${esc(urlPriv.replace(/^https:\/\//, ''))} · Sin costo · Free`,
  }),
})

// (b) Recepción de hoteles: el cupón del 10 %
carteles.push({
  nombre: codigo ? `cartel-hotel-cupon-${codigo}` : 'cartel-hotel-cupon',
  html: pagina({
    titulo: '10 % en Satori Sushi Bar',
    tituloEn: '10% off at Satori Sushi Bar',
    cabDer: 'Cortesía de su hotel<br>Courtesy of your hotel',
    qr: codigo ? await qrSvg(`${dominio}/r/${codigo}`) : '<div class="falta">QR del hotel<br>Hotel QR</div>',
    leyendaQr: 'Escanee con la cámara de su teléfono<br>Scan with your phone camera',
    es: `<h2>Cómo usa su cupón</h2>
      <ol>
        <li>Escanee el código con la cámara de su teléfono: le aparece su <b>cupón del 10 %</b>.</li>
        <li>Venga a Satori Santa Teresa y <b>muestre el cupón en caja al pagar</b>.</li>
        <li>Es de <b>un solo uso</b>; la fecha de vencimiento está en el cupón.</li>
      </ol>
      <p>Si quiere, puede dejarnos su WhatsApp o su email para recibir ofertas: es opcional.</p>`,
    en: `<h2>How to use your coupon</h2>
      <ol>
        <li>Scan the code with your phone camera: you get your <b>10% coupon</b>.</li>
        <li>Come to Satori Santa Teresa and <b>show the coupon at the register when you pay</b>.</li>
        <li>It is <b>single use</b>; the expiry date is on the coupon.</li>
      </ol>
      <p>If you like, you can leave your WhatsApp or email to get offers: it is optional.</p>`,
    pie: `Aviso de privacidad · Privacy notice: ${esc(urlPriv.replace(/^https:\/\//, ''))}`,
  }),
})

let chromium
try { ({ chromium } = require('playwright')) } catch { chromium = null }
const navegador = chromium ? await chromium.launch() : null
for (const c of carteles) {
  const html = join(salida, `${c.nombre}.html`)
  writeFileSync(html, c.html)
  if (navegador) {
    const p = await navegador.newPage()
    await p.setContent(c.html, { waitUntil: 'load' })
    await p.pdf({ path: join(salida, `${c.nombre}.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true })
    await p.close()
  }
  console.log(`${c.nombre}: ${html}${navegador ? ' (+ .pdf)' : ' (sin Playwright: solo HTML)'}`)
}
if (navegador) await navegador.close()
