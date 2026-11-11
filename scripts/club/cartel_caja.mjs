#!/usr/bin/env node
// (11-nov, modo transición) Cartel del QR ÚNICO de caja: «Tarjeta vieja (sin QR)». HTML A4 imprimible + PDF, con la
// estética de los reportes (papel blanco, Cormorant Garamond + DM Sans incrustadas, oro solo como filete).
//
//   node scripts/club/cartel_caja.mjs
//
// El QR es un texto FIJO (el mismo en todos los locales; `QR_CAJA_TARJETA_VIEJA` de src/modules/club/qrFormato.ts): la
// pantalla «Escanear» lo reconoce y abre «Tarjeta vieja (sin QR)». No es un link y no da ningún permiso: el permiso es el
// usuario, su rol y `tarjeta_manual_activa` en el local. Es para la caja; no se le muestra al cliente.
// Sin dominio, sin locales y sin datos personales. Salida: docs/club-satori/piloto/cartel-caja-tarjeta-vieja.html y .pdf
// (el PDF con el Chromium de Playwright; sin Playwright, solo el HTML).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(join(RAIZ, 'package.json'))
const QRCode = require('qrcode')

// La misma constante que la app (qrFormato.test.ts comprueba que no se separen).
export const QR_CAJA_TARJETA_VIEJA = 'SATORI-CAJA:TARJETA-VIEJA'

const salida = join(RAIZ, 'docs/club-satori/piloto')
mkdirSync(salida, { recursive: true })
const b64 = (ruta) => readFileSync(join(RAIZ, ruta)).toString('base64')
const fuente = (pkg, archivo) => b64(`node_modules/@fontsource/${pkg}/files/${archivo}`)
const FUENTES = `
@font-face{font-family:'Cormorant Garamond';font-weight:500;src:url(data:font/woff2;base64,${fuente('cormorant-garamond', 'cormorant-garamond-latin-500-normal.woff2')}) format('woff2')}
@font-face{font-family:'Cormorant Garamond';font-weight:600;src:url(data:font/woff2;base64,${fuente('cormorant-garamond', 'cormorant-garamond-latin-600-normal.woff2')}) format('woff2')}
@font-face{font-family:'DM Sans';font-weight:400;src:url(data:font/woff2;base64,${fuente('dm-sans', 'dm-sans-latin-400-normal.woff2')}) format('woff2')}
@font-face{font-family:'DM Sans';font-weight:600;src:url(data:font/woff2;base64,${fuente('dm-sans', 'dm-sans-latin-600-normal.woff2')}) format('woff2')}`
const DARUMA = `data:image/png;base64,${b64('club-web/public/marca/daruma.png')}`

const CSS = `${FUENTES}
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:#1f2120}
body{font:400 12pt/1.5 'DM Sans',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pagina{width:210mm;height:297mm;padding:16mm 18mm 14mm;display:flex;flex-direction:column}
.cab{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:.75pt solid #b48e50;padding-bottom:2.5mm}
.marca{display:flex;align-items:center;gap:3mm;font:600 19pt/1 'Cormorant Garamond',serif;letter-spacing:.02em}
.marca img{height:11mm}
.cab-der{text-align:right;color:#6e706c;font-size:10pt;line-height:1.35}
h1{font:500 40pt/1.02 'Cormorant Garamond',serif;margin:9mm 0 1mm}
.sub{font:500 17pt/1.2 'Cormorant Garamond',serif;color:#6e706c;margin:0 0 7mm}
.cuerpo{display:grid;grid-template-columns:1fr 84mm;gap:10mm;align-items:start}
.qr{border:.75pt solid #b48e50;border-radius:2mm;padding:5mm;text-align:center}
.qr svg{width:100%;height:auto;display:block}
.qr .leyenda{font-size:10pt;color:#6e706c;margin-top:2.5mm;line-height:1.35}
h2{font:600 16pt/1.2 'Cormorant Garamond',serif;margin:0 0 2mm}
ol,ul{margin:0 0 6mm;padding-left:6mm}
li{margin:0 0 2.2mm}
.no{border-left:2.5pt solid #b48e50;padding:1mm 0 1mm 4mm;margin:0 0 6mm}
.pie{margin-top:auto;display:flex;justify-content:space-between;color:#9a9b96;font-size:8.5pt;border-top:.5pt solid #e6e4de;padding-top:2mm}
`

const qr = await QRCode.toString(QR_CAJA_TARJETA_VIEJA, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#1f2120', light: '#ffffff' } })
const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tarjeta vieja (sin QR) · QR de caja · Satori</title>
<!-- Generado por scripts/club/cartel_caja.mjs (11-nov). No editar a mano: cambiar el script y volver a generar. Sin datos personales. -->
<style>${CSS}</style>
</head>
<body>
<section class="pagina">
  <div class="cab">
    <div class="marca"><img src="${DARUMA}" alt="">Satori</div>
    <div class="cab-der">Solo para la caja<br>No es para el cliente</div>
  </div>
  <h1>Tarjeta vieja (sin QR)</h1>
  <p class="sub">El cliente llega con una tarjeta de papel de las de antes</p>
  <div class="cuerpo">
    <div>
      <h2>Qué hacer</h2>
      <ol>
        <li>En la app: <b>Club → Escanear → «📷 Escanear»</b> y apuntá a este código. (Es lo mismo que tocar <b>«Tarjeta vieja (sin QR)»</b>.)</li>
        <li><b>Buscá al anfitrión</b> que le dio la tarjeta: nombre, negocio o los últimos 4 del teléfono. Elegilo de la lista.</li>
        <li>Cargá las <b>personas de la mesa</b> y elegí el <b>pedido</b>.</li>
        <li><b>Continuar → Confirmar.</b> Tiene que decir «Tarjeta vieja: +N personas a …».</li>
      </ol>
      <div class="no">
        <b>Si el anfitrión no aparece en la búsqueda</b>, no está inscripto: no se carga a otro. Avisale al manager.
      </div>
      <h2>Para tener en cuenta</h2>
      <ul>
        <li>No le muestres ningún QR al cliente: este código es de la caja.</li>
        <li>Cada tarjeta vieja la revisa después otra persona (gerencia, todos los días).</li>
        <li>Hay un tope de personas por anfitrión y por día: si se pasa, la app avisa.</li>
        <li>Si el cliente trae el <b>cupón en su teléfono</b>, no es tarjeta vieja: escaneá su cupón.</li>
      </ul>
    </div>
    <div class="qr">${qr}<div class="leyenda">Escanealo con «📷 Escanear» de la app.<br>Con la cámara del teléfono no abre nada.</div></div>
  </div>
  <div class="pie"><span>Modo transición · mientras haya tarjetas de papel en la calle</span><span>Club Satori</span></div>
</section>
</body>
</html>
`
const destino = join(salida, 'cartel-caja-tarjeta-vieja.html')
writeFileSync(destino, html)
let chromium
try { ({ chromium } = require('playwright')) } catch { chromium = null }
if (chromium) {
  const navegador = await chromium.launch()
  const p = await navegador.newPage()
  await p.setContent(html, { waitUntil: 'load' })
  await p.pdf({ path: destino.replace(/\.html$/, '.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true })
  await navegador.close()
}
console.log(`cartel-caja-tarjeta-vieja: ${destino}${chromium ? ' (+ .pdf)' : ' (sin Playwright: solo HTML)'}`)
