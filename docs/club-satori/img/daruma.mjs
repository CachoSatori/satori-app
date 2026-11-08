// Daruma del Club Satori (diseño propio, a partir de la captura y los colores del PDF de Ismael, 08-nov):
// cuerpo rojo vivo, cara blanca, ojos con aro dorado, 悟り a los lados y 縁 dorado al centro.
// Exporta el SVG (con o sin los kanji de los costados) para que pase-render.mjs lo use en el logo, la franja y club-web.
export const ROJO = '#d42a1f', ROJO_OSC = '#9b120d', ORO = '#d9b45f', ORO_CLARO = '#f3dfa6', CARA = '#fbf5ea', TINTA = '#141010'
export function daruma({ costados = true, ancho = 600 } = {}) {
  const trazosIzq = [0, 1, 2, 3, 4].map(i => `<path d="M ${118 + i * 16} ${430 + i * 6} Q ${102 + i * 18} ${505} ${150 + i * 22} ${575 - i * 4}" />`).join('')
  const trazosDer = [0, 1, 2, 3, 4].map(i => `<path d="M ${482 - i * 16} ${430 + i * 6} Q ${498 - i * 18} ${505} ${450 - i * 22} ${575 - i * 4}" />`).join('')
  const barbaIzq = [0, 1, 2, 3, 4, 5].map(i => `<path d="M 262 ${352 + i * 3} Q ${228 - i * 6} ${358 + i * 8} ${196 - i * 4} ${336 + i * 12}" />`).join('')
  const barbaDer = [0, 1, 2, 3, 4, 5].map(i => `<path d="M 338 ${352 + i * 3} Q ${372 + i * 6} ${358 + i * 8} ${404 + i * 4} ${336 + i * 12}" />`).join('')
  const lado = (x, rot) => costados ? `<text x="${x}" y="300" font-size="74" fill="${ORO_CLARO}" font-family="'Noto Serif JP', serif" font-weight="700"
      writing-mode="tb" glyph-orientation-vertical="0" text-anchor="middle" transform="rotate(${rot} ${x} 330)">悟り</text>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 660" width="${ancho}" height="${Math.round(ancho * 1.1)}">
  <defs>
    <radialGradient id="cuerpo" cx="38%" cy="28%" r="78%"><stop offset="0" stop-color="#ef4b37"/><stop offset=".55" stop-color="${ROJO}"/><stop offset="1" stop-color="${ROJO_OSC}"/></radialGradient>
    <linearGradient id="oro" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ORO_CLARO}"/><stop offset="1" stop-color="${ORO}"/></linearGradient>
    <radialGradient id="mejilla" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#f2b39a" stop-opacity=".55"/><stop offset="1" stop-color="#f2b39a" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="200" y="600" width="200" height="42" rx="18" fill="${ROJO_OSC}"/>
  <ellipse cx="300" cy="345" rx="272" ry="285" fill="url(#cuerpo)"/>
  <ellipse cx="190" cy="95" rx="70" ry="24" fill="#fff" opacity=".2" transform="rotate(-20 190 95)"/>
  <g fill="none" stroke="${ORO_CLARO}" stroke-width="15" stroke-linecap="round">${trazosIzq}${trazosDer}</g>
  ${lado(78, -8)}${lado(522, 8)}
  <path d="M 150 236 Q 150 140 300 138 Q 450 140 450 236 L 450 318 Q 450 408 300 410 Q 150 408 150 318 Z" fill="${CARA}" stroke="${ORO}" stroke-width="5"/>
  <ellipse cx="214" cy="318" rx="40" ry="22" fill="url(#mejilla)"/><ellipse cx="386" cy="318" rx="40" ry="22" fill="url(#mejilla)"/>
  <g fill="${TINTA}">
    <path d="M 168 214 C 174 166 226 150 276 170 C 246 172 230 186 226 208 C 212 190 188 196 168 214 Z"/>
    <path d="M 432 214 C 426 166 374 150 324 170 C 354 172 370 186 374 208 C 388 190 412 196 432 214 Z"/>
    <path d="M 176 178 C 178 150 200 136 226 136 C 208 146 200 160 202 176 Z"/><path d="M 424 178 C 422 150 400 136 374 136 C 392 146 400 160 398 176 Z"/>
  </g>
  <g><circle cx="234" cy="256" r="45" fill="#fff" stroke="${ORO}" stroke-width="10"/><circle cx="234" cy="258" r="28" fill="${TINTA}"/><circle cx="244" cy="248" r="6" fill="#fff"/>
     <circle cx="366" cy="256" r="45" fill="#fff" stroke="${ORO}" stroke-width="10"/><circle cx="366" cy="258" r="28" fill="${TINTA}"/><circle cx="376" cy="248" r="6" fill="#fff"/></g>
  <path d="M 276 314 Q 288 298 300 312 Q 312 298 324 314" fill="none" stroke="${ROJO}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M 262 346 Q 300 326 338 346" fill="none" stroke="${ROJO}" stroke-width="10" stroke-linecap="round"/>
  <g fill="none" stroke="${TINTA}" stroke-width="5" stroke-linecap="round">${barbaIzq}${barbaDer}
     <path d="M 276 366 l -6 16"/><path d="M 288 368 l -3 18"/><path d="M 300 369 l 0 19"/><path d="M 312 368 l 3 18"/><path d="M 324 366 l 6 16"/></g>
  <text x="300" y="560" font-size="150" text-anchor="middle" font-family="'Noto Serif JP', serif" font-weight="700" fill="url(#oro)"
        stroke="${ROJO_OSC}" stroke-width="3" paint-order="stroke">縁</text>
</svg>`
}
