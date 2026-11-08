import pw from '/opt/node-tools/node_modules/playwright/index.js'
const { chromium } = pw
const FUENTE = `<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;600&family=Noto+Sans+JP:wght@400;500&display=block" rel="stylesheet">`
const base = `*{margin:0;padding:0;box-sizing:border-box} body{background:transparent}`
const logo = `<!doctype html><html><head>${FUENTE}<style>${base}
.l{width:660px;height:660px;border-radius:50%;background:#0d0d0d;display:flex;align-items:center;justify-content:center;position:relative}
.l::after{content:'';position:absolute;inset:34px;border:5px solid #c8a96e;border-radius:50%;opacity:.85}
.k{font:600 360px/1 'Noto Serif JP',serif;color:#c8a96e;margin-top:-18px}
</style></head><body><div class="l"><span class="k">里</span></div></body></html>`
const hero = `<!doctype html><html><head>${FUENTE}<style>${base}
.h{width:1032px;height:336px;background:#0d0d0d;display:flex;align-items:center;justify-content:center;gap:44px;color:#c8a96e}
.k{font:600 168px/1 'Noto Serif JP',serif}
.t{display:flex;flex-direction:column;gap:14px}
.n{font:600 92px/1 'Noto Serif JP',serif;letter-spacing:.22em}
.s{font:400 30px/1 'Noto Sans JP',sans-serif;letter-spacing:.42em;color:#c8a96e;opacity:.85}
.r{height:2px;background:#c8a96e;opacity:.6;width:100%}
</style></head><body><div class="h"><span class="k">里</span><div class="t"><span class="n">SATORI</span><span class="r"></span><span class="s">CLUB · SANTA TERESA</span></div></div></body></html>`
const b = await chromium.launch()
const p = await b.newPage({ deviceScaleFactor: 1 })
for (const [n, html, w, h] of [['logo', logo, 660, 660], ['hero', hero, 1032, 336]]) {
  await p.setViewportSize({ width: w, height: h })
  await p.setContent(html, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready)
  await p.screenshot({ path: `${n}.png`, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } })
}
// Maqueta del pase (aproximación del diseño genérico de Google Wallet), datos ficticios
const mock = `<!doctype html><html><head>${FUENTE}<style>${base}
body{background:#e8e6e1;font-family:'Noto Sans JP',system-ui,sans-serif;padding:24px;display:flex;gap:24px}
.c{width:360px;border-radius:24px;overflow:hidden;background:#0d0d0d;color:#f5f0e8;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.top{display:flex;align-items:center;gap:12px;padding:16px 18px}
.top img{width:40px;height:40px;border-radius:50%}
.top b{font:600 16px 'Noto Serif JP',serif;color:#f5f0e8}
.body{padding:4px 18px 18px}
.sub{font-size:12px;opacity:.75;letter-spacing:.04em}
.nom{font:600 30px 'Noto Serif JP',serif;margin:2px 0 14px}
.row{display:flex;gap:28px;margin-bottom:16px}
.f .lb{font-size:11px;opacity:.7;text-transform:uppercase;letter-spacing:.06em}.f .v{font-size:16px;font-weight:500;margin-top:2px}
.qr{background:#fff;border-radius:12px;width:180px;margin:6px auto 8px;padding:12px;text-align:center;color:#0d0d0d}
.qr .m{width:156px;height:156px;background:repeating-conic-gradient(#0d0d0d 0 25%,#fff 0 50%) 0 0/24px 24px;margin:auto}
.qr .a{font:500 13px 'DM Mono',monospace;margin-top:6px;letter-spacing:.12em}
.hero{width:360px;display:block}
.cap{font-size:12px;color:#333;margin-top:8px;width:360px}
</style></head><body>
<div><div class="c"><div class="top"><img src="logo.png"><b>Club Satori</b></div>
<div class="body"><div class="sub">Socio y anfitrión</div><div class="nom">Ana</div>
<div class="row"><div class="f"><div class="lb">Local Club</div><div class="v">10 % + 1 cortesía</div></div>
<div class="f"><div class="lb">Créditos</div><div class="v">2 · 14 personas</div></div></div>
<div class="row"><div class="f"><div class="lb">Tu próxima visita</div><div class="v">1 cortesía sorpresa</div></div></div>
<div class="qr"><div class="m"></div><div class="a">ABCD2345K</div></div></div>
<img class="hero" src="hero.png"></div><div class="cap">Frente del pase (maqueta; Google arma el diseño final con estos datos). Fondo #0d0d0d, logo y franja en oro #c8a96e.</div></div>
</body></html>`
await p.setViewportSize({ width: 460, height: 760 })
const { writeFileSync } = await import('node:fs'); writeFileSync('mock.html', mock)
await p.goto('file://' + process.cwd() + '/mock.html', { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready)
await p.screenshot({ path: 'mock.png', fullPage: true })
const p2 = await b.newPage({ deviceScaleFactor: 2 }); await p2.setViewportSize({ width: 460, height: 760 })
await p2.goto('file://' + process.cwd() + '/mock.html', { waitUntil: 'networkidle' }); await p2.evaluate(() => document.fonts.ready)
await p2.screenshot({ path: 'mock@2x.png', fullPage: true })
await b.close()
