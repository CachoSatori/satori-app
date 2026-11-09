# club-web: páginas públicas del Club Satori (F1d)

Es un mini-sitio aparte de la app. No tiene React, ni PWA, ni service worker. Lo usa un turista que escanea un QR con la cámara, sin login, a veces con mala señal.

| Ruta | Qué muestra |
|---|---|
| `/r/{codigo8}` | El turista obtiene su cupón 10 % (o ve el que ya tiene en ese teléfono). Debajo del cupón hay un opt-in opcional, con casilla de consentimiento. |
| `/c/{codigo10}` | El cupón. Si está vigente, lo muestra; si está usado o vencido, muestra un aviso. |
| `/p/{token64}` | El portal: del anfitrión (saldo, personas que le faltan para el próximo medio crédito, su QR para compartir, «Canjear» e historial) y del socio del Local Club (estado y «Darme de baja»). El botón de Wallet queda oculto hasta la F1e. |
| `/k/{codigo6}` · `/s/{codigo9}` | Código de canje y QR del socio: los lee la caja; en un navegador, solo un aviso. |
| `/alta` (`?ref={codigo8}`) | Autoalta del socio del Local Club (LC-DES-07): nombre, WhatsApp, aviso de privacidad versionado y Turnstile. Queda **pendiente** hasta que la caja lo valida. |
| `/w/{token64}` | Botón «Canjear» del pase de Wallet (CLUB-AUD-69): con el **token de pase**, solo genera el código de canje. |

El formato de las URL está en `src/qrFormato.ts`. Es una copia de `src/modules/club/qrFormato.ts` de la app, y las dos tienen que coincidir.

- **Idiomas:** español e inglés. Por defecto toma el del navegador, y hay un selector arriba.
- **Peso:** unos 8 KB gzip entre HTML, JS y CSS. El generador de QR (unos 9 KB gzip) se carga aparte, cuando hace falta.
- **Lighthouse en móvil, en `/r/`:** performance 100, accesibilidad 100 y buenas prácticas 100.

## API (`functions/`, una Pages Function)
El navegador solo llama a `/api/*`. La función llama a las RPC de Supabase con la anon key y agrega un **tope por IP** (`CF-Connecting-IP`).

| Ruta | RPC | Tope por IP (por defecto) |
|---|---|---|
| `POST /api/cupon` `{referente}` | `club_cupon_crear` | 5 cada 10 min |
| `GET /api/cupon/{codigo}` | `club_cupon_ver` | 60 por minuto |
| `POST /api/cupon/{codigo}/contacto` `{contacto}` | `club_cupon_contacto` | 5 cada 10 min |
| `GET /api/portal/{token}` | `club_portal` | 60 por minuto |
| `POST /api/portal/{token}/canje` | `club_canje_codigo_generar` | 5 por minuto |
| `POST /api/portal/{token}/baja` | `club_socio_baja_portal` | 5 por minuto |
| `POST /api/portal/{token}/wallet` | Edge `club-pase` (B1) → link «Save to Google Wallet» | 5 por minuto |
| `POST /api/pase/{token_pase}/canje` | `club_canje_codigo_generar_pase` | 5 por minuto |
| `POST /api/alta` `{nombre, whatsapp, acepto, ref?, turnstile}` | `club_socio_autoalta` (después de Turnstile) | 5 por minuto · tope global por día en SQL (`socio_autoalta_max_dia`, 60) |

- **Cómo cuenta el tope (CLUB-AUD-14 y 24):** un binding de Rate Limiting por endpoint, por IP:
  - `RL_CREAR`: crear cupón, opt-in y código de canje, **5 por 60 s**;
  - `RL_LEER`: ver cupón y portal, **60 por 60 s**.

  **Si falta alguno, ese endpoint responde 503**: falla cerrada. Al turista le aparece «Demasiados intentos seguidos. Esperá unos minutos…». Cada tope que salta deja una línea `{"alerta":"club-web-tope",…}` en los logs de la función, y sobre ese texto se puede armar una notificación. No hay respaldo en KV ni en memoria; la memoria queda solo para `dev-server.mjs` (`CLUB_DEV=1`).
- **Una sola puerta (CLUB-AUD-06):** cada llamada lleva el header `x-club-web` con el secreto `CLUB_WEB_KEY`. La base solo responde a las funciones públicas si el sha256 de ese header es el de la clave vigente. Llamar directo con la anon key ya no funciona. **Sin `CLUB_WEB_KEY`, la API responde 503.**
- **Red de seguridad en SQL:** el tope por referente y por día, y el tope global de cupones por local y por minuto (`club_config.cupones_max_minuto_local`, 20 por defecto).
- **Turnstile (LC-DES-07):** `/api/alta` verifica el token con Cloudflare (`TURNSTILE_SECRET`, Secret de Pages) antes de
  llamar a la base. **Sin el secreto, responde 503.** En staging se usan las claves de prueba de Cloudflare (siempre
  pasan): la del sitio por defecto en `src/config.ts` y la secreta `1x0000000000000000000000000000000AA`. En prod,
  `VITE_TURNSTILE_SITEKEY` (variable de build) y `TURNSTILE_SECRET` las carga Ismael.
- **Google Wallet (B2):** el botón «Agregar a Google Wallet» (portal y final de la autoalta) aparece solo si el build
  tiene `VITE_WALLET_GOOGLE=1`. Va **apagado** hasta que el Edge `club-pase` esté desplegado con sus secretos.
- **Dominio (08-nov noche):** sale de la variable de build **`VITE_CLUB_URL`** (`https://<dominio>`, sin barra final);
  no está escrito en el código ni en los textos de club-web. **Sin la variable (o mal formada) el build de producción
  falla y el sitio no arranca** (09-nov; en desarrollo usa el origen donde corre). Para
  cambiar de dominio: cambiar la variable y redesplegar. **Ojo:** la base (los links del pase, el portal, el código de
  canje y la baja) y la app de caja (`src/modules/club/qrFormato.ts`, que reconoce los QR) todavía tienen el dominio
  escrito: ver AVANCE-LC.md.
- **Aviso de privacidad:** su versión (`AVISO_PRIVACIDAD_VERSION` en `src/config.ts`) tiene que ser igual a
  `club_config.aviso_privacidad_version`; si no, la base rechaza el alta. Al cambiar el texto se suben las dos.
- **Errores:** la función nunca devuelve el mensaje crudo de la base. Lo traduce a un código fijo (`referente_invalido`, `cupon_invalido`, `tope_referente`, `demasiados_pedidos` y otros).

## Desarrollo local
```bash
cd club-web && npm ci && npm run build
SUPABASE_URL=https://<ref-staging>.supabase.co SUPABASE_ANON_KEY=<anon> CLUB_WEB_KEY=<clave de staging> node dev-server.mjs 8788
```
`dev-server.mjs` sirve `dist/` con las mismas reglas de `_redirects` y monta `/api/*` con el mismo código de la función. Para probar en el runtime real de Cloudflare:

```bash
npx wrangler pages dev dist --binding SUPABASE_URL=… --binding SUPABASE_ANON_KEY=… --binding CLUB_WEB_KEY=…
```

## Despliegue en Cloudflare Pages (lo hace Ismael)
1. En Cloudflare, ir a Workers & Pages → Create → Pages → Connect to Git y elegir este repo.
   - Nombre del proyecto: `satori-club`.
   - **Root directory:** `club-web`.
   - **Build command:** `npm ci && npm run build`.
   - **Output directory:** `dist`.
2. En Settings → Variables and Secrets, cargar las variables. Todas son públicas (la anon key también lo es, igual que en la app) **menos `CLUB_WEB_KEY`, que va como Secret** (ver el paso 3).
   - `SUPABASE_URL` = la URL del proyecto de **staging** (para la prueba).
   - `SUPABASE_ANON_KEY` = la anon key de ese mismo proyecto.
   - Opcionales: `RL_CREAR_MAX`, `RL_CREAR_VENTANA_S`, `RL_LECTURA_MAX`, `RL_LECTURA_VENTANA_S`.
3. **Clave de club-web** (`CLUB_WEB_KEY`). La carga Ismael; nunca va por chat, ni al repo, ni a un mensaje:
   1. Generar una clave larga al azar en la propia computadora, por ejemplo `openssl rand -hex 32`.
   2. En Pages → `satori-club` → Settings → Variables and Secrets → **Add** → Type: **Secret** → nombre **`CLUB_WEB_KEY`** → pegar la clave. Va en Production; para probar en preview, también en Preview.
   3. Calcular su sha256 en la misma computadora: `printf %s '<la clave>' | shasum -a 256`, o `sha256sum` en Linux.
   4. En Supabase (staging; prod con su firma) → SQL Editor: `select public.club_web_clave_cargar('<el sha256>');`. **Va el sha256, nunca la clave.**
   5. Para rotarla, repetir los pasos 1 a 4 con una clave nueva. La anterior deja de valer cuando se carga el sha256 nuevo, así que conviene cargar primero el secreto en Pages y redesplegar.
4. **Topes por IP** (`RL_CREAR` y `RL_LEER`): están declarados en `wrangler.toml`. **Verificación, después de cada deploy:**
   - abrir `https://<dominio>/api/salud` (o la URL del deploy de prueba);
   - tiene que decir `"rl_crear": true, "rl_leer": true, "club_web_key": true, "turnstile": true, "supabase": true`. No muestra ningún valor;
   - si `rl_crear` o `rl_leer` sale en `false`, Pages no tomó el binding. Esos endpoints responden 503: fallan cerrados, el sitio no queda abierto;
   - prueba de fuego: 6 «Obtener mi cupón» seguidos desde un mismo teléfono. El sexto tiene que mostrar «Demasiados intentos seguidos».

   **Plan B, si Pages no admite los bindings: `/api` en un Worker.**
   1. Crear un Worker `satori-club-api` con el mismo `functions/_lib/api.js`. Su `fetch(request, env)` llama a `manejar(request, env, path)`.
   2. Declarar en el `wrangler.toml` del Worker los dos `[[unsafe.bindings]]` de arriba, más `SUPABASE_URL`, `SUPABASE_ANON_KEY` y el secreto `CLUB_WEB_KEY`.
   3. Agregar la ruta `<dominio>/api/*` → Worker `satori-club-api` (Workers Routes), y sacar `functions/api` de Pages.
   4. Repetir la verificación con `/api/salud`.
5. Las ramas que no son la de producción se publican como *preview* (`<rama>.satori-club.pages.dev`).

## DNS: apuntar el dominio del Club (lo hace Ismael)
1. En el proyecto de Pages, ir a **Custom domains → Set up a custom domain** y escribir el dominio del Club (`<dominio>`, el mismo de `VITE_CLUB_URL`).
2. **Si el DNS del dominio está en Cloudflare**, Cloudflare crea solo el registro CNAME. Hay que confirmar.
3. **Si el DNS está en otro proveedor**, crear allá el registro: tipo **CNAME**, nombre **el subdominio del Club**, destino **`satori-club.pages.dev`**. Después, volver a Pages y verificar.
4. Esperar a que el certificado SSL quede en «Active» (suele tardar unos minutos). Probar `https://<dominio>/r/<código de prueba>`.
5. **Recién para el piloto:** cambiar `SUPABASE_URL` y `SUPABASE_ANON_KEY` a los de prod, con la 075 ya aplicada en prod y la firma de Ismael.
