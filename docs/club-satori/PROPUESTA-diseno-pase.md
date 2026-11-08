# Propuesta · diseño del pase de Google Wallet (08-nov-2026) — **la aprueba Ismael**

> **MAQUETA v2 (08-nov), APAGADA hasta el OK de Ismael.** Ismael pidió el daruma de la página web de Satori; **no está
> en el repo ni en club-web** (solo el ícono 祭 de la app y esta propuesta). Por eso, como indicó, va el kanji **悟**
> («satori») en el mismo estilo. Franja: **«SATORI · CLUB»** (sin local). Si aparece el archivo del daruma, se cambia
> solo el logo y la franja, con este mismo script. Hasta el OK, `WALLET_DISENO` no se carga y el pase sale solo con el
> fondo `#0d0d0d`.

Sale de la identidad que ya usan la app y club-web:
- **Color de fondo:** tinta `#0d0d0d`, el negro del encabezado de club-web y de la app.
- **Oro:** `#c8a96e` (`--gold` de club-web), solo sobre la tinta, como en la web.
- **Logo:** el kanji **悟** en Noto Serif JP (la serif de la app), oro sobre un círculo negro con un filete dorado.
  660×660, como pide Google.
- **Franja** (`heroImage`, 1032×336): 悟 + «SATORI · CLUB» con un filete dorado debajo, con margen a los lados por si
  Google recorta.

![Maqueta del pase (datos ficticios)](img/pase-propuesta.png)

| Pieza | Archivo | URL pública cuando se publique club-web |
|---|---|---|
| Logo | `club-web/public/pase/logo.png` | `https://club.satoricostarica.com/pase/logo.png` |
| Franja | `club-web/public/pase/hero.png` | `https://club.satoricostarica.com/pase/hero.png` |

- La maqueta es una **aproximación**: Google arma el diseño final del pase genérico con estos datos (el color de fondo,
  el logo y la franja son nuestros; la tipografía y la disposición son de Google).
- Las imágenes se regeneran con `docs/club-satori/img/pase-render.mjs` (Playwright + Google Fonts).

## Cómo se enciende (después de aprobar)
- En el Edge `club-pase`, secreto/variable
  `WALLET_DISENO = {"colorFondo":"#0d0d0d","logoUrl":"https://club.satoricostarica.com/pase/logo.png","heroUrl":"https://club.satoricostarica.com/pase/hero.png"}`.
- Es la constante `DISENO_PROPUESTO` de `src/shared/wallet/googlePase.ts`.
- Hasta entonces el pase sale solo con el fondo `#0d0d0d`, sin logo ni franja.
