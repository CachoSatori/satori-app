// Maqueta v3 del pase (08-nov): daruma propio (daruma.mjs). Genera, en la carpeta actual:
//   daruma.png (sin fondo, grande) · marca.png (sin fondo, sin los kanji de los costados: el encabezado de club-web)
//   logo.png (660×660, círculo tinta) · hero.png y hero-rojo.png (1032×336) · mock-oscuro.png y mock-rojo.png (maquetas)
import pw from '/opt/node-tools/node_modules/playwright/index.js'
import { writeFileSync } from 'node:fs'
import { daruma, ROJO, ORO, ORO_CLARO } from './daruma.mjs'
const { chromium } = pw
const FUENTE = `<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;600;700&family=Noto+Sans+JP:wght@400;500&display=block" rel="stylesheet">`
const base = `*{margin:0;padding:0;box-sizing:border-box} body{background:transparent}`
const pagina = (css, cuerpo) => `<!doctype html><html><head>${FUENTE}<style>${base}${css}</style></head><body>${cuerpo}</body></html>`
const b = await chromium.launch()
const p = await b.newPage({ deviceScaleFactor: 1 })
async function png(nombre, html, w, h, escala = 1) {
  const pg = escala === 1 ? p : await b.newPage({ deviceScaleFactor: escala })
  await pg.setViewportSize({ width: w, height: h })
  await pg.setContent(html, { waitUntil: 'networkidle' }); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(300)
  await pg.screenshot({ path: `${nombre}.png`, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } })
  if (pg !== p) await pg.close()
}
await png('daruma', pagina('', daruma({ ancho: 600 })), 600, 660, 2)
await png('marca', pagina('', daruma({ costados: false, ancho: 192 })), 192, 212, 2)
await png('logo', pagina(`.l{width:660px;height:660px;border-radius:50%;background:#0d0d0d;display:flex;align-items:center;justify-content:center;position:relative}
  .l::after{content:'';position:absolute;inset:26px;border:5px solid ${ORO};border-radius:50%;opacity:.85}.l svg{margin-top:8px}`,
  `<div class="l">${daruma({ costados: false, ancho: 470 })}</div>`), 660, 660)
const hero = (fondo, texto, linea) => pagina(`.h{width:1032px;height:336px;background:${fondo};display:flex;align-items:center;justify-content:center;gap:44px}
  .n{font:600 58px/1 'Noto Serif JP',serif;letter-spacing:.18em;color:${texto};white-space:nowrap}.r{height:2px;background:${linea};opacity:.7;margin-top:16px}`,
  `<div class="h">${daruma({ ancho: 268 })}<div><div class="n">SATORI · CLUB</div><div class="r"></div></div></div>`)
await png('hero', hero('#0d0d0d', ORO, ORO), 1032, 336)
await png('hero-rojo', hero(ROJO, '#fbf5ea', ORO_CLARO), 1032, 336)
// Maquetas (aproximación del pase genérico de Google Wallet), datos ficticios
const mock = (fondo, titulo, heroArchivo) => pagina(`body{background:#e8e6e1;font-family:'Noto Sans JP',system-ui,sans-serif;padding:24px}
.c{width:360px;border-radius:24px;overflow:hidden;background:${fondo};color:#f5f0e8;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.top{display:flex;align-items:center;gap:12px;padding:16px 18px}.top img{width:40px;height:40px;border-radius:50%}
.top b{font:600 16px 'Noto Serif JP',serif}.body{padding:4px 18px 18px}.sub{font-size:12px;opacity:.8;letter-spacing:.04em}
.nom{font:600 30px 'Noto Serif JP',serif;margin:2px 0 14px}.row{display:flex;gap:28px;margin-bottom:16px}
.f .lb{font-size:11px;opacity:.75;text-transform:uppercase;letter-spacing:.06em}.f .v{font-size:16px;font-weight:500;margin-top:2px}
.qr{background:#fff;border-radius:12px;width:180px;margin:6px auto 8px;padding:12px;text-align:center;color:#0d0d0d}
.qr .m{width:156px;height:156px;background:repeating-conic-gradient(#0d0d0d 0 25%,#fff 0 50%) 0 0/24px 24px;margin:auto}
.qr .a{font:500 13px monospace;margin-top:6px;letter-spacing:.12em}.hero{width:360px;display:block}.cap{font-size:12px;color:#333;margin-top:8px;width:360px}`,
`<div class="c"><div class="top"><img src="logo.png"><b>Club Satori</b></div><div class="body"><div class="sub">Socio y anfitrión</div><div class="nom">Ana</div>
<div class="row"><div class="f"><div class="lb">Local Club</div><div class="v">Vale en todos los Satori</div></div></div>
<div class="row"><div class="f"><div class="lb">Créditos</div><div class="v">2 · 14 personas</div></div><div class="f"><div class="lb">Próxima visita</div><div class="v">1 cortesía sorpresa</div></div></div>
<div class="qr"><div class="m"></div><div class="a">ABCD2345K</div></div></div><img class="hero" src="${heroArchivo}"></div>
<div class="cap">${titulo}</div>`)
for (const [n, f, t, h] of [['mock-oscuro', '#0d0d0d', 'v3 · fondo tinta #0d0d0d (recomendado)', 'hero.png'], ['mock-rojo', ROJO, 'v3 · fondo rojo', 'hero-rojo.png']]) {
  writeFileSync(`${n}.html`, mock(f, t, h))
  const pg = await b.newPage({ deviceScaleFactor: 2 }); await pg.setViewportSize({ width: 410, height: 740 })
  await pg.goto('file://' + process.cwd() + `/${n}.html`, { waitUntil: 'networkidle' }); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(300)
  await pg.screenshot({ path: `${n}.png`, fullPage: true }); await pg.close()
}
await b.close()
