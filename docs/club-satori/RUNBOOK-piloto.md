# RUNBOOK · pase a prod del Club Satori (piloto oficial)

> **No se ejecuta nada de este documento sin la firma de Ismael, paso por paso.** Es el orden obligatorio que pide la
> auditoría (ronda 3, CLUB-AUD-35): mergear el PR #59 equivale a migrar prod, porque Branching aplica la migración del Club
> (hoy `075`; **en prod va con otro número**, ver «Regla de numeración» y el paso 3b). Por eso
> el merge va **al final**, cuando todo ya está aplicado y verificado a mano.
>
> Refs: **PROD = `yiczgdtirrkdvohdquzf`**, staging = `hwiatgicyyqyezqwldia`.
> **Ritual antes de cada comando de base:** leer el ref en la pantalla del editor SQL y decirlo en voz alta. Nunca
> SQL de escritura sin haber leído el ref.

## Orden (no se saltea ni se invierte)

| # | Paso | Depende de | Si falla |
|---|---|---|---|
| 0 | Preparación y lecturas (solo lectura) | — | no se sigue |
| 1 | Mig **069** (`get_my_role` con `is_active`) | 0 | `scripts/sql/069_rollback.sql` |
| 2 | Mig **081** (campos de la factura del puente; entra con su número si va primero, ver la regla) | 1 | `scripts/sql/081_rollback.sql` (solo si el paso 3 no se hizo) |
| 2b | Mig **082** (`pos_ndf_ingestar`: ingesta en una transacción por local, CLUB-AUD-44/45; entra con su número si va primero) | 2 | `drop function public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb);` (solo si el paso 3 no se hizo) |
| 3 | Edge `ingest-ndf` desde `claude/puente-item11-prod`, y después el agente de prod | 2b | volver al Edge anterior **antes** de tocar la 082 y la 081 |
| 3b | **Renumerar** lo que quede ≤ al último de prod (hoy: la 075 → 150) por la regla de numeración, en el **mismo PR del pase** | 0 | volver archivos, registro y filas del ledger de staging a sus números (ver 3b) |
| 4 | Mig **del Club** (hoy 075, con su número nuevo) | 1 y 3b | `scripts/sql/<N>_rollback.sql` (no hay datos del Club todavía) |
| 5 | Clave de club-web (`CLUB_WEB_KEY` + su sha256) | 4 | `club_web_clave_cargar` con una clave nueva |
| 6 | Cloudflare (Pages `satori-club`: variables, bindings y dominio) | 5 | sacar el dominio; la base sigue cerrada |
| 7 | Pase de Wallet (F1e) | 6 | apagar la emisión; el portal sigue funcionando |
| 8 | Migración F1b con `--esperados` | 4 | volver a correrla (es re-ejecutable) o el rollback de la migración del Club |
| 9 | `tarjeta_manual_activa = false` | 4 | — |
| 10 | Merge del PR #59 | todo lo anterior | revertir el código, **nunca** borrar los `.sql` del ledger |

---

## 0. Preparación (D-1, solo lectura)
**Hacer:**
- Firmas de Ismael para cada paso. Ventana de día, fuera del servicio (nunca de 17:00 a 23:00).
- Export de respaldo de las tablas que se tocan: `pos_ndf_tickets`, `pos_ndf_open`, `pos_ndf_cursor` y `profiles`.
- Lecturas en PROD (no escriben):
  ```sql
  -- ¿qué migraciones tiene el ledger?
  select version from supabase_migrations.schema_migrations order by version desc limit 5;   -- el último de prod manda (regla de numeración)
  select version from supabase_migrations.schema_migrations where version in ('069','075','081','082') or name in ('club_satori_esquema','pos_ndf_campos_factura','pos_ndf_ingesta_transaccional') order by 1;
  -- ¿get_my_role ya mira is_active? (si es true, la 069 ya está)
  select position('is_active' in pg_get_functiondef('public.get_my_role()'::regprocedure)) > 0 as tiene_069;
  -- CLUB-AUD-29: respaldos *_pre_migracion_2026_07 (en staging existen, con RLS y sin grants)
  select c.relname, c.relrowsecurity as rls, (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
         has_table_privilege('anon', c.oid, 'select') as anon_select,
         has_table_privilege('authenticated', c.oid, 'select') as authenticated_select
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname like '%pre_migracion%';
  ```
- CLUB-AUD-28: versión del Edge en prod: panel de Supabase → Edge Functions → `ingest-ndf` (versión y fecha). Anotarla:
  es el punto de vuelta del paso 3.

**LC-DES-10: si el ledger de prod ya tiene la migración del Club (`075` o cualquier fila `club_satori_esquema`), se
frena todo** y se avisa a Ismael: se sigue corrigiendo en el mismo archivo mientras no esté en prod, y una versión vieja
aplicada no coincidiría con la final.

**Verificar:** el export se abre; las lecturas están anotadas. Si los respaldos `*_pre_migracion_2026_07` existen con
`anon_select` o `authenticated_select` en `true`, se cierran **antes** de seguir (`enable row level security` +
`revoke all … from anon, authenticated`), o se borran si Ismael lo decide.

## 1. Mig 069
**Hacer** (solo si `tiene_069` dio `false`): aplicar `supabase/migrations/069_get_my_role_is_active.sql` en el editor SQL
de PROD y registrar la fila `069` en `supabase_migrations.schema_migrations`.
**Verificar:** `tiene_069 = true`; un usuario desactivado de prueba no ve nada.
**Rollback:** `scripts/sql/069_rollback.sql`.

## 2. Mig 081
**Hacer:** aplicar `supabase/migrations/081_pos_ndf_campos_factura.sql` (**la del PR #59; es la única versión**) y
registrar la fila `081` en el ledger.
**Verificar:**
- Las columnas existen: `pos_ndf_tickets.mesa_factura, consecutivo_fe, clave_fe, pedido_abierto_en, area_factura` y
  `pos_ndf_open.pedido_abierto_en, area`.
- El agente de prod **actual** sigue entrando: `pos_ndf_cursor.last_poll_at` avanza y `last_error` es null durante 3 ciclos.

**Rollback:** `scripts/sql/081_rollback.sql`, **solo si todavía no se desplegó el Edge del paso 3**. Con el Edge nuevo y
sin la 081, el upsert falla y no entra ninguna venta.

## 2b. Mig 082 (ingesta transaccional)
**Hacer:** aplicar `supabase/migrations/082_pos_ndf_ingesta_transaccional.sql` (hoy en `claude/puente-item11`; tiene que
estar en el PR #59 antes del merge, como la 081) y registrar la fila `082` en el ledger. En **staging** ya está aplicada
y con su fila (08-nov, texto idéntico: md5 `5db915c8a422519ce77050f1fb1b916a`).
**Verificar:** `select has_function_privilege('service_role', 'public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE');`
→ true; `anon` y `authenticated` → false. El agente actual sigue entrando (no usa la función).
**Rollback:** el `drop function` de la tabla de arriba, **solo** si el Edge nuevo no se desplegó.

## 3. Edge `ingest-ndf` y agente de prod
**Hacer:**
1. Desde un checkout de `claude/puente-item11-prod` (hoy `e4678b3`; el detalle, con smoke test y rollback, está en
   `docs/puente/PASE-PROD-2026-11-09.md` en esa rama; pase previsto el lunes 09-nov, antes que la 085):
   `supabase functions deploy ingest-ndf --no-verify-jwt --project-ref yiczgdtirrkdvohdquzf`.
2. Secreto por local (CLUB-AUD-32), en el panel de Supabase → Edge Functions → Secrets:
   `POS_INGEST_SECRETS = {"santa-teresa":"<secreto largo>"}`. Si no se carga, el `POS_INGEST_SECRET` de siempre sigue
   valiendo, pero solo para santa-teresa.
3. Agente de prod en `C:\satori\satori-app-prod`, con los mismos pasos del PLAN del agente
   (`docs/puente/PLAN-agente-item11.md`): `git fetch` + `git checkout claude/puente-item11-prod`, prueba en seco y
   reinicio de la tarea «Satori PoS Bridge PROD». El `.env` de prod lleva la firma `POS_AGENTE_PROD_FIRMADO=<fecha>`:
   el candado ahora mira `INGEST_URL` (CLUB-AUD-32).
4. Backfill del período que defina Ismael.

**Verificar:**
- La versión del Edge subió.
- `pos_ndf_cursor`: `last_poll_at` reciente y `last_error` null.
- Las facturas nuevas traen `mesa_factura`, `consecutivo_fe` y `area_factura`.
- `pos_ndf_open.clave` con fecha (`pedido:AAAA-MM-DD:N`).
- Log del agente sin errores: `C:\satori\logs\pos-agente-prod.log`.

**Rollback:** volver al agente anterior (`git checkout 4d3513a` en la carpeta de prod) y redesplegar el Edge desde el
commit anotado en el paso 0. **Recién después**, si hiciera falta, la 081.

## Regla de numeración (Ismael, 08-nov; `supabase/migraciones-reservadas.json` y `ESTADO.md`)
- El Club y el puente **crean** sus migraciones en el **bloque 100–149**. Cada migración nueva se registra en
  `supabase/migraciones-reservadas.json` («asignadas») **y** en la tabla de `ESTADO.md` **en el mismo commit**: el test
  `supabase/migraciones.test.ts` (corre en el gate) falla si no.
- **Pase a prod: ninguna migración entra a prod con un número ≤ al último del ledger de prod.** Si pasa, **se renombra al
  siguiente libre del bloque de PASE 150–199** (caja lo agrega a `main`), **nunca** a 100–149 (que es de creación), **en
  el mismo PR del pase**, con rollback, pruebas, paridad y la fila del ledger de staging (paso 3b).
- **Con el ledger de prod de hoy (último: `080`):** la `081` y la `082` son mayores que `080`, así que **entran con su
  número si van primero** (pasos 2 y 2b). La `075` queda por debajo: **tomaría la `150`**. Se recalcula el día del pase.
- **No se renombra nada antes del PR del pase.**

## 3b. Renumerar las migraciones del pase (en el PR del pase; antes, nada)
> Ejemplo con el ledger de prod de hoy (último: `080`): la `081` y la `082` no se renombran si van primero; la `075` pasa a
> `150` (el primero libre del bloque de PASE). **Se recalcula el día del pase** con el ledger de prod de ese día y el
> registro de `main`: lo que tenga número ≤ al último de prod va al siguiente libre de 150–199.

**Hacer** (en la rama del pase, un commit propio por migración que haya que renombrar, en el orden de aplicación):
1. `git mv supabase/migrations/<viejo>_<nombre>.sql supabase/migrations/<N>_<nombre>.sql` (y su `scripts/sql/<viejo>_rollback.sql`;
   para el Club, también `075_pruebas_staging.sql`). Dentro del rollback, el `delete … where version = '<viejo>'` pasa a `'<N>'`.
2. **Registro:** en `supabase/migraciones-reservadas.json`, `<N>` en «asignadas» (bloque de **pase**, mismo nombre) y el número
   viejo fuera de `usadas_antes_de_los_bloques` si corresponde; en `ESTADO.md`, la fila de `<N>` y la nota del viejo
   («renumerada a <N>»). Correr `npx vitest run supabase/migraciones.test.ts`.
3. Actualizar las referencias: `scripts/sql/club_paridad.sh`, `scripts/sql/club_carreras/*`, `scripts/club/migrar_firestore.py`,
   los docs del Club, el Edge (comentarios) y este RUNBOOK (`grep -rn "075_\|'075'\|081_\|082_" scripts docs supabase`).
4. **Ledger de staging** (las tablas y funciones no cambian; solo la fila):
   ```sql
   -- leer el ref de STAGING en pantalla antes de escribir
   update supabase_migrations.schema_migrations
      set version = '<N>', statements = array[$m$<texto exacto del <N>_….sql>$m$]
    where version = '<viejo>';
   ```
   **Verificar:** `md5(statements[1])` = md5 del archivo renombrado; no queda la fila vieja.
5. **Pruebas en staging con los archivos renombrados:** batería (todas en verde), carreras del Club y del puente
   (`scripts/sql/puente_carreras/correr.sh`), `club_paridad.sh` (sin diferencias), vitest. Si algo da distinto, se frena.

**Rollback de 3b** (si algo falla, antes del paso 4): `git revert` de los commits del renombre y, en staging,
`update supabase_migrations.schema_migrations set version = '<viejo>' where version = '<N>';` por cada una. Verificar el md5.

## 4. Mig del Club (hoy 075, con su número nuevo de 3b)
**Hacer:** aplicar `supabase/migrations/<N>_club_satori_esquema.sql` (ya renumerada en 3b, el mismo blob que se verificó en
staging) y registrar la fila `<N>` en el ledger de prod (texto idéntico al archivo; verificar el md5).
**Verificar (solo lectura):**
- Catálogo `club_*` igual al de staging: correr `scripts/sql/club_catalogo.sql` en las dos bases y comparar (en staging
  da 528 objetos). Es la paridad del CLUB-AUD-17, hecha a mano contra prod.
- `anon` ejecuta solo las 8 puertas públicas: `club_canje_codigo_generar`, `club_canje_codigo_generar_pase`,
  `club_cupon_contacto`, `club_cupon_crear`, `club_cupon_ver`, `club_portal`, `club_socio_autoalta` y
  `club_socio_baja_portal` (todas exigen `x-club-web`).
- Tarea diaria de socios (LC-A2): `select jobname, schedule from cron.job where jobname = 'club_socios_mantenimiento';`
  → `15 9 * * *` (03:15 en Costa Rica). Si prod no tiene `pg_cron`, la migración del Club no la programa: anotarlo y decidir con
  Ismael (sin ella, las altas provisionales no vuelven a pendiente y las autoaltas no se purgan).
- `select aviso_privacidad_version from club_config;` igual a `AVISO_PRIVACIDAD_VERSION` de `club-web/src/config.ts`.
- `select tarjeta_manual_activa from club_config;` → `false`.
- **CLUB-AUD-42:** `select count(*) from club_entorno;` → **0**. En prod no se corre `scripts/sql/club_marcar_staging.sql`
  nunca: sin esa marca no existe el modo `pruebas` (el libro y la auditoría no tienen otra puerta que la del migrador).
- `club_web_clave` vacía: las puertas públicas fallan cerradas.

**Rollback:** `scripts/sql/<N>_rollback.sql`. Antes de la migración del paso 8 no hay datos del Club; después, solo con
el export de Firestore a mano.

## 5. Clave de club-web
**Hacer:** generar una clave nueva **de prod** (`openssl rand -hex 32`); nunca se reusa la de staging.
- Cloudflare → Pages `satori-club` (producción) → Settings → Variables and Secrets → **Secret** `CLUB_WEB_KEY`.
- En el editor SQL de PROD: `select public.club_web_clave_cargar('<sha256 de la clave>');` (el sha256, nunca la clave).

**Verificar:** `/api/salud` → `"club_web_key": true`. Una llamada directa a `/rest/v1/rpc/club_cupon_crear` con la anon
key y sin el header responde «Código no válido».
**Rollback:** cargar otra clave (rota y revoca la anterior).

## 6. Cloudflare
**Hacer:** en Pages `satori-club` (producción): `SUPABASE_URL` y `SUPABASE_ANON_KEY` de PROD, y los bindings `RL_CREAR`
(5 por 60 s) y `RL_LEER` (60 por 60 s) de `wrangler.toml`. **Turnstile (LC-DES-07):** crear el widget en Cloudflare
para `club.satoricostarica.com`; la clave del sitio va en `VITE_TURNSTILE_SITEKEY` (variable de build) y la secreta en el
**Secret** `TURNSTILE_SECRET` (las carga Ismael; sin ella la autoalta responde 503). Después, el deploy y el dominio.
**Verificar:**
- `/api/salud` → todo en `true` (incluido `turnstile`).
- **CLUB-AUD-74: Turnstile de prod NO es el de prueba.** La clave del sitio del build (`VITE_TURNSTILE_SITEKEY`) no
  puede ser `1x00000000000000000000AA` (ni ninguna que empiece con `1x`, `2x` o `3x`, las de prueba de Cloudflare):
  abrir `/alta`, ver el código fuente del JS y buscar `1x0000`. El Secret `TURNSTILE_SECRET` tampoco puede ser
  `1x0000000000000000000000000000000AA` ni `2x…`/`3x…`: lo confirma Ismael en Cloudflare → Turnstile (el widget de
  `club.satoricostarica.com` muestra su sitekey; tiene que coincidir con la del build).
- Tope de `/alta` por IP **y por prefijo de red** (/24 IPv4, /64 IPv6): 6 altas seguidas desde dos teléfonos en el mismo
  wifi → la sexta dice «Demasiados intentos seguidos».
- Alerta de cupo: al 80 % de `socio_autoalta_max_dia` queda una fila `tipo = 'autoalta_cupo'` en `club_alertas`.
- `/alta`: el widget aparece; un alta de prueba queda **pendiente** y se borra a mano después.
- 6 «Obtener mi cupón» seguidos desde un teléfono: el sexto dice «Demasiados intentos seguidos».
- Las cabeceras de `_headers`: CSP `script-src 'self'` y no-store en `/api`.
- Si Pages no toma los bindings: el «Plan B» de `club-web/README.md` (`/api` en un Worker).

**Rollback:** sacar el dominio. La base sigue cerrada sin la clave.

## 7. Pase de Wallet (F1e)
**Hacer:** emisión de Google Wallet (Apple con el código listo y apagado hasta el D-U-N-S). El QR del pase es el
público (`/r/`, cupones); el canje sale del botón «Canjear» del pase o del portal (código de un solo uso, R-01).
**Verificar:** un pase de prueba de punta a punta: alta → pase → cupón de un turista → visita → canje con código → aviso.
**Rollback:** apagar la emisión. El portal y la caja siguen funcionando.

## 8. Migración F1b
**Hacer:**
1. Export de Firestore con `MANIFEST` **no provisional**.
2. `python3 scripts/club/migrar_firestore.py --dry-run …` → anotar los conteos.
3. `--ensayo` contra PROD: corre todo dentro de una transacción que termina en ROLLBACK.
4. `--apply --esperados '<json con los conteos del dry-run>'`.

**Verificar:** la validación dentro de la transacción da OK (si no, no se guarda nada). Ismael controla miembros, saldos y
los 136 vencimientos del 05-nov. El libro es de solo inserción: el migrador solo puede borrar sus propias filas
(`origen = 'migracion'`).
**Rollback:** volver a correr (es re-ejecutable por `legacy_id`) o, si todavía no hubo actividad, el rollback de la migración del Club.

## 8b. Arranque de las excepciones del Local Club (el día del lanzamiento)
**Hacer:** `update club_config set lc_excepciones_desde = '<fecha del lanzamiento>';` Antes de esa fecha el Local Club se
cobró sin la app y todas sus facturas saldrían como `LC_SIN_REGISTRO` (en staging: 275 en 120 días).
**Verificar:** en Excepciones no aparecen facturas LC anteriores a esa fecha.
**Con los códigos de Ismael:** `cortesia_familia` (sección «CORTESÍA CLUB»), `promo_articulo_codigo` (PROMO CLUB 10 %) y,
si corresponde, `articulos_cero_permitidos` (p. ej. el 857 «INVITADO»). Mientras falten, las excepciones que los usan
salen «pendiente de configuración».

## 9. Tarjeta física apagada
**Hacer:** `update club_config set tarjeta_manual_activa = false;` (ya viene `false` por defecto; se confirma).
**Verificar:** en caja no aparece «Tarjeta física» y `club_tarjeta_manual` rechaza a todos los roles.

## 10. Merge del PR #59 (último)
**Antes:** el ledger de PROD tiene la `069`, la `081`, la `082` y la del Club con su número de 3b (hoy, `150`), sin ninguna
aplicada con número ≤ al último de prod de ese momento, y los `.sql` del PR son los mismos blobs que se aplicaron.
Branching ve las versiones ya registradas y no las vuelve a aplicar.
**Hacer:** sacar el PR de borrador y mergear.
**Verificar:** el log de Branching sin errores; la app publicada tiene `/club`; humo: Escanear, Miembros y Reportes con
usuarios reales de gerencia.
**Rollback:** revertir el código del PR. **Los `.sql` de migraciones que ya están en el ledger de prod no se borran
nunca** (regla 10 de `ESTADO.md`).
