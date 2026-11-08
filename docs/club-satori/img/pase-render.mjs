// Maqueta v4 del pase (08-nov): daruma real (foto de Ismael), fondo tinta. Usa las piezas ya publicadas en
// club-web/public/pase/ (las saca docs/club-satori/img/daruma/daruma_assets.py) y escribe pase-propuesta.png.
//   node docs/club-satori/img/pase-render.mjs        (desde la raíz del repo)
// Aproximación del pase genérico de Google Wallet; datos ficticios.
import pw from '/opt/node-tools/node_modules/playwright/index.js'
import { readFileSync } from 'node:fs'
const { chromium } = pw
const TINTA = '#0d0d0d'
const img = (f) => 'data:image/png;base64,' + readFileSync(`club-web/public/pase/${f}`).toString('base64')
const html = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@600&family=Noto+Sans+JP:wght@400;500&display=block" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}
body{background:#e8e6e1;font-family:'Noto Sans JP',system-ui,sans-serif;padding:24px}
.c{width:360px;border-radius:24px;overflow:hidden;background:${TINTA};color:#f5f0e8;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.top{display:flex;align-items:center;gap:12px;padding:16px 18px}.top img{width:40px;height:40px;border-radius:50%}
.top b{font:600 16px 'Noto Serif JP',serif}.body{padding:4px 18px 18px}.sub{font-size:12px;opacity:.8;letter-spacing:.04em}
.nom{font:600 30px 'Noto Serif JP',serif;margin:2px 0 14px}.row{display:flex;gap:28px;margin-bottom:16px}
.f .lb{font-size:11px;opacity:.75;text-transform:uppercase;letter-spacing:.06em}.f .v{font-size:16px;font-weight:500;margin-top:2px}
.qr{background:#fff;border-radius:12px;width:180px;margin:6px auto 8px;padding:12px;text-align:center;color:#0d0d0d}
.qr .m{width:156px;height:156px;background:repeating-conic-gradient(#0d0d0d 0 25%,#fff 0 50%) 0 0/24px 24px;margin:auto}
.qr .a{font:500 13px monospace;margin-top:6px;letter-spacing:.12em}.hero{width:360px;display:block}
.cap{font-size:12px;color:#333;margin-top:8px;width:360px}.logo{display:flex;gap:16px;align-items:center;margin-top:16px;width:360px}
.logo img{width:96px;height:96px;border-radius:50%}.logo span{font-size:12px;color:#333}</style></head><body>
<div class="c"><div class="top"><img src="${img('logo.png')}"><b>Club Satori</b></div><div class="body"><div class="sub">Socio y anfitrión</div><div class="nom">Ana</div>
<div class="row"><div class="f"><div class="lb">Local Club</div><div class="v">Vale en todos los Satori</div></div></div>
<div class="row"><div class="f"><div class="lb">Tu próxima visita</div><div class="v">1 cortesía sorpresa</div></div></div>
<div class="row"><div class="f"><div class="lb">Créditos</div><div class="v">₡36.000 disponibles</div></div></div>
<div class="row"><div class="f"><div class="lb">Referidos</div><div class="v">9 personas referidas este mes</div></div></div>
<div class="qr"><div class="m"></div><div class="a">ABCD2345K</div></div></div><img class="hero" src="${img('hero.png')}"></div>
<div class="cap">v4 · daruma real · fondo tinta ${TINTA} · créditos en colones (aprobado; apagado hasta la prueba en un teléfono)</div>
<div class="logo"><img src="${img('logo.png')}"><span>Logo 990×990 tal como lo recorta Google (círculo)</span></div>
</body></html>`
const b = await chromium.launch()
const pg = await b.newPage({ deviceScaleFactor: 2 }); await pg.setViewportSize({ width: 410, height: 860 })
await pg.setContent(html, { waitUntil: 'networkidle' }); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(300)
await pg.screenshot({ path: 'docs/club-satori/img/pase-propuesta.png', fullPage: true })
await b.close()
