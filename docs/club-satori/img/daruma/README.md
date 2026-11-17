# Daruma del Club

- `daruma-original.jpg`: la imagen final del dueño (08-nov), hecha a partir de una foto del daruma real del restaurante.
  Se puede publicar. **No se edita:** es la fuente de todas las piezas.
- Piezas (sin filtros ni retoques de estilo: solo se recorta el fondo blanco, se escala y se compone sobre tinta):

  ```bash
  python3 -I docs/club-satori/img/daruma/daruma_assets.py docs/club-satori/img/daruma/daruma-original.jpg <salida>
  ```

  | Pieza | Medida | Dónde va |
  |---|---|---|
  | `marca.png` | 128 px de alto, sin fondo | `club-web/public/marca/daruma.png` (encabezado) |
  | `favicon-32.png`, `favicon-64.png` | cuadrados, sin fondo | `club-web/public/marca/` |
  | `logo.png` | 990×990, daruma entero en un círculo tinta | logo del pase (rama `claude/club-wallet`) |
  | `hero.png` | 1032×336, la cara sobre tinta | hero del pase (rama `claude/club-wallet`) |

- Íconos de la app (PWA, raíz `public/`), mismo criterio:

  ```bash
  python3 -I docs/club-satori/img/daruma/iconos_pwa.py docs/club-satori/img/daruma/daruma-original.jpg <salida>
  ```

  `icon-192.png` y `icon-512.png` (purpose `any`: cuadro tinta `#0a0a0a` redondeado con margen), `icon-maskable-512.png`
  (purpose `maskable`: tinta a sangre, daruma dentro del círculo seguro del 80 %), `apple-touch-icon.png` (180×180,
  sin transparencia) y `favicon-32.png` / `favicon-64.png` (sin fondo). Se copian a `public/` tal cual.
- `recortar.py` saca solo el blanco unido al borde de la imagen (el blanco de la cara queda) y suaviza 4 px de
  contorno sin dejar halo.
- El daruma dibujado (SVG) que hubo antes se borró por decisión del dueño.
