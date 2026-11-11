# Material del piloto · BORRADORES

Todo esto es **borrador**: Ismael lo revisa antes de usarlo. Sin datos personales (lo que va entre `<…>` se completa al
mandarlo).

| Archivo | Para quién | Idioma |
|---|---|---|
| `guia-rapida-caja.html` (+ `.pdf` para imprimir, una página A4) | Caja: escanear, qué marcar en el PoS, si sale rojo, canje con código, alta en caja | ES |
| `mensaje-anfitriones.md` | Hoteles y concierges: qué cambia, cómo guardan el pase, cómo comparten su link, cómo canjean | ES y EN |
| `mensaje-socios.md` | Socios del Local Club: el pase, el beneficio, «vale en todos los Satori» | ES y EN |
| `cartel-caja-tarjeta-vieja.html` (+ `.pdf`, A4) | Caja: el QR único de caja para «Tarjeta vieja (sin QR)» (modo transición). Se genera con `node scripts/club/cartel_caja.mjs`. No es para el cliente | ES |
| `modo-transicion.md` | Dueño y gerencia: qué es el modo transición, cómo se enciende, cómo se mide y cuándo se apaga | ES |

- La guía rápida sale de `docs/sop-app/6.13 Club Satori.md`: si la guía cambia, se actualiza. El PDF se regenera
  imprimiendo el HTML (Chromium, A4, «gráficos de fondo» activado).
- Las partes **[con el pase]** van solo cuando el pase de Google Wallet esté encendido.
