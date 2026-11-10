# Material del piloto · BORRADORES

Todo esto es **borrador**: el dueño lo revisa antes de usarlo. Sin datos personales (lo que va entre `<…>` se completa al
mandarlo).

| Archivo | Para quién | Idioma |
|---|---|---|
| `guia-rapida-caja.html` (+ `.pdf` para imprimir, una página A4) | Caja: escanear, qué marcar en el PoS, si sale rojo, canje con código, alta en caja | ES |
| `mensaje-anfitriones.md` | Hoteles y concierges: qué cambia, cómo guardan el pase, cómo comparten su link, cómo canjean | ES (usted) y EN |
| `mensaje-socios.md` | Socios del Local Club: el pase, el beneficio, «vale en Satori Santa Teresa (y pronto en Nosara)» | ES (usted) y EN |
| `cartel-socios-local-club.html` (+ `.pdf`, A4) | Mesa y caja: «Hágase socio del Local Club», con el QR del alta de Santa Teresa | ES y EN |
| `cartel-hotel-cupon.html` (+ `.pdf`, A4) | Recepción de hoteles: el cupón del 10 % y cómo se usa. La muestra lleva el lugar del QR; el de cada hotel se genera con su código | ES y EN |

- La guía rápida sale de `docs/sop-app/6.13 Club Satori.md`: si la guía cambia, se actualiza. El PDF se regenera
  imprimiendo el HTML (Chromium, A4, «gráficos de fondo» activado).
- Las partes **[con el pase]** van solo cuando el pase de Google Wallet esté encendido.
- **Carteles (10-nov):** los genera `scripts/club/carteles.mjs` (no se editan a mano):
  `node scripts/club/carteles.mjs --dominio https://<dominio del Club>` arma los dos de muestra acá. Para el cartel de un
  hotel con **su** QR: `node scripts/club/carteles.mjs --dominio https://<dominio> --codigo <código del anfitrión> --salida
  <carpeta fuera del repo>`. Estética de los reportes nuevos (`ESTANDAR-reportes.md`). Sin datos personales.

