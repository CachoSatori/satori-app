# Worker `satori-club-api`

API del Club Satori en Cloudflare Workers. El código vive en esta carpeta (`index.js`, `ruta.js`, `interno.js`,
`programado.js`) y su configuración en `wrangler.toml`.

## Despliegue

- Se construye y despliega solo con **Workers Builds** en cada merge a `main` que toque `club-web/**`
  (raíz `club-web/worker`, comando `npx wrangler deploy`).
- **Ojo con la ruta vigilada:** tiene que ser `club-web/**` (dos asteriscos). Con `club-web/*` Cloudflare no ve los
  cambios dentro de `club-web/worker/` y el Worker no se reconstruye (pasó con el merge del #148, 13-nov-2026).
- Los secretos (`CLUB_PASE_SYNC_KEY`, `CLUB_WEB_KEY`, `TURNSTILE_SECRET`) se cargan en el panel del Worker como
  **Secret**, solo en *Production*. Nunca van al repo.

## Cron

`[triggers] crons = ["*/10 * * * *"]`: cada 10 minutos `programado.js` le pide al Edge `club-pase` que venza en Google
Wallet los pases de las personas dadas de baja. Sin `CLUB_PASE_SYNC_KEY` no hace nada.
