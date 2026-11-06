# club-web: páginas públicas del Club Satori (F1d)

Es un mini-sitio aparte de la app. No tiene React, ni PWA, ni service worker. Lo usa un turista que escanea un QR con la cámara, sin login, a veces con mala señal.

| Ruta | Qué muestra |
|---|---|
| `/r/{codigo8}` | El turista obtiene su cupón 10 % (o ve el que ya tiene en ese teléfono). Debajo del cupón hay un opt-in opcional, con casilla de consentimiento. |
| `/c/{codigo10}` | El cupón. Si está vigente, lo muestra; si está usado o vencido, muestra un aviso. |
| `/p/{token64}` | El portal del referente: saldo, personas que le faltan para el próximo medio crédito, su QR (para compartir o descargar) e historial. El botón de Wallet queda oculto hasta la F1e. |

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

- **Cómo cuenta el tope:** usa el binding de Rate Limiting de Workers (`RATE_LIMITER`) si existe; si no, un KV (`CLUB_RL`) con un contador por ventana; y si tampoco hay KV, la memoria de la instancia, que es el respaldo más débil.
- **Red de seguridad:** el tope por referente y por día en SQL sigue valiendo aunque falle este.
- **Errores:** la función nunca devuelve el mensaje crudo de la base. Lo traduce a un código fijo (`referente_invalido`, `cupon_invalido`, `tope_referente`, `demasiados_pedidos` y otros).

## Desarrollo local
```bash
cd club-web && npm ci && npm run build
SUPABASE_URL=https://<ref-staging>.supabase.co SUPABASE_ANON_KEY=<anon> node dev-server.mjs 8788
```
`dev-server.mjs` sirve `dist/` con las mismas reglas de `_redirects` y monta `/api/*` con el mismo código de la función. Para probar en el runtime real de Cloudflare:

```bash
npx wrangler pages dev dist --kv CLUB_RL --binding SUPABASE_URL=… --binding SUPABASE_ANON_KEY=…
```

## Despliegue en Cloudflare Pages (lo hace Ismael)
1. En Cloudflare, ir a Workers & Pages → Create → Pages → Connect to Git y elegir este repo.
   - Nombre del proyecto: `satori-club`.
   - **Root directory:** `club-web`.
   - **Build command:** `npm ci && npm run build`.
   - **Output directory:** `dist`.
2. En Settings → Variables and Secrets, cargar las variables. Ninguna es secreta: la anon key es pública, igual que en la app.
   - `SUPABASE_URL` = la URL del proyecto de **staging** (para la prueba).
   - `SUPABASE_ANON_KEY` = la anon key de ese mismo proyecto.
   - Opcionales: `RL_CREAR_MAX`, `RL_CREAR_VENTANA_S`, `RL_LECTURA_MAX`, `RL_LECTURA_VENTANA_S`.
3. Tope por IP:
   - en Workers & Pages → KV, crear el namespace `satori-club-rl`;
   - en el proyecto, ir a Settings → Bindings → KV namespace y agregar el binding `CLUB_RL` apuntando a ese namespace.
4. Las ramas que no son la de producción se publican como *preview* (`<rama>.satori-club.pages.dev`).

## DNS: apuntar `club.satoricostarica.com` (lo hace Ismael)
1. En el proyecto de Pages, ir a **Custom domains → Set up a custom domain** y escribir `club.satoricostarica.com`.
2. **Si el DNS de `satoricostarica.com` está en Cloudflare**, Cloudflare crea solo el registro CNAME. Hay que confirmar.
3. **Si el DNS está en otro proveedor**, crear allá el registro: tipo **CNAME**, nombre **`club`**, destino **`satori-club.pages.dev`**. Después, volver a Pages y verificar.
4. Esperar a que el certificado SSL quede en «Active» (suele tardar unos minutos). Probar `https://club.satoricostarica.com/r/<código de prueba>`.
5. **Recién para el piloto:** cambiar `SUPABASE_URL` y `SUPABASE_ANON_KEY` a los de prod, con la 075 ya aplicada en prod y la firma de Ismael.
