# RUNBOOK · pase a prod del Club Satori (piloto oficial)

> **No se ejecuta nada de este documento sin la firma de Ismael, paso por paso.** Es el orden obligatorio que pide la
> auditoría (ronda 3, CLUB-AUD-35): mergear el PR #59 equivale a migrar prod, porque Branching aplica la migración del Club
> (hoy `075`; **en prod va con otro número**, ver «Regla de numeración» y el paso 3b). Por eso
> el merge va **al final**, cuando todo ya está aplicado y verificado a mano.
>
> Refs: **PROD = `yiczgdtirrkdvohdquzf`**, staging = `hwiatgicyyqyezqwldia`.
> **Ritual antes de cada comando de base:** leer el ref en la pantalla del editor SQL y decirlo en voz alta. Nunca
> SQL de escritura sin haber leído el ref.

> **⚠️ (10-nov) El orden del pase lo manda ahora el paquete [`docs/pases/PASE-150-151-club.md`](../pases/PASE-150-151-club.md).**
> La base del Club entra **con el merge** (Branching aplica la 150, antes 075, y la 151, antes 100), como la 085 y la 089:
> ya no se aplica a mano antes del merge (pasos 3b, 4 y 10 de abajo). Los locales se dan de alta **apagados** (no como dice
> el 4b) y Santa Teresa se enciende en la prueba interna. Este RUNBOOK sigue valiendo para el detalle de cada
> verificación (Cloudflare, clave, carga única, encender un local, gates).

## Orden (no se saltea ni se invierte)

| # | Paso | Depende de | Si falla |
|---|---|---|---|
| 0 | Preparación y lecturas (solo lectura) | — | no se sigue |
| 1 | Mig **069** (`get_my_role` con `is_active`) | 0 | `scripts/sql/069_rollback.sql` |
| 2 | Mig **081** (campos de la factura del puente; entra con su número si va primero, ver la regla) | 1 | `scripts/sql/081_rollback.sql` (solo si el paso 3 no se hizo) |
| 2b | Mig **082** (`pos_ndf_ingestar`: ingesta en una transacción por local, CLUB-AUD-44/45; entra con su número si va primero) | 2 | `drop function public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb);` (solo si el paso 3 no se hizo) |
| 3 | Edge `ingest-ndf` desde `claude/puente-item11-prod`, y después el agente de prod | 2b | volver al Edge anterior **antes** de tocar la 082 y la 081 |
| 3b | **Renumerar** lo que quede ≤ al último de prod (hoy: la 075 → 150) por la regla de numeración, en el **mismo PR del pase** | 0 | volver archivos, registro y filas del ledger de staging a sus números (ver 3b) |
| 4 | Mig **del Club** (hoy 075, con su número nuevo) | 1, 3b y el gate **G-61** (§12) | `scripts/sql/<N>_rollback.sql` (no hay datos del Club todavía) |
| 5 | Clave de club-web (`CLUB_WEB_KEY` + su sha256) | 4 | `club_web_clave_cargar` con una clave nueva |
| 6 | Cloudflare (Pages `satori-club`: variables, bindings y dominio) | 5 | sacar el dominio; la base sigue cerrada |
| 7 | Pase de Wallet (F1e) | 6 | apagar la emisión; el portal sigue funcionando |
| 8 | Migración F1b con `--esperados` | 4 y el gate **G-56** (§12: modo prod del migrador) | en prod no se re-ejecuta (G-56); antes de que haya actividad, el rollback de la migración del Club |
| 9 | `tarjeta_manual_activa = false` | 4 | — |
| 10 | Merge del PR #59 | todo lo anterior | revertir el código, **nunca** borrar los `.sql` del ledger |
| 4b | **Alta de los locales** (un INSERT; Santa Teresa encendido, Nosara apagado) | 4 | borrar las filas si no hay datos |
| 11 | **Encender un local** (cualquiera): alta + checklist de datos + interruptor del owner | 1–3 (puente de ese local), 4b | **Apagar** (mismo interruptor) |

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
1. Según el paquete vigente: `docs/puente/PASE-PROD-2026-11-09.md` en `claude/puente-item11-prod-v2` (código
   `5da233a`, con la 082 v3; smoke test y rollback ahí). El pase quedó **reprogramado, fecha a definir por el dueño tras la auditoría de la 082 v3**, y va antes que la 085.
   Lo corre el dueño desde el clon del pase:
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
  da 898 objetos al 08-nov). Es la paridad del CLUB-AUD-17, hecha a mano contra prod. **Más el catálogo extendido del
  gate G-61 (§12):** `bash scripts/sql/gate61.sh --prod-firmado` tiene que salir 0.
- `anon` ejecuta solo las 10 puertas públicas: `club_canje_codigo_generar`, `club_canje_codigo_generar_pase`,
  `club_cupon_contacto`, `club_cupon_contacto_baja`, `club_cupon_crear`, `club_cupon_ver`, `club_locales_activos`,
  `club_portal`, `club_socio_autoalta` y `club_socio_baja_portal` (todas exigen `x-club-web`).
- **LC-PRIV (08-nov):** `authenticated` no tiene SELECT en `club_miembros_contacto` ni en `club_cupones_contactos`
  (`select has_table_privilege('authenticated', 'public.club_miembros_contacto', 'SELECT');` → `false`); el contacto se
  lee solo con `club_miembro_contacto_ver`, que deja rastro. `select buscar_tope_minuto from club_config;` → 30.
- Tarea diaria de socios (LC-A2): `select jobname, schedule from cron.job where jobname = 'club_socios_mantenimiento';`
  → `15 9 * * *` (03:15 en Costa Rica). Si prod no tiene `pg_cron`, la migración del Club no la programa: anotarlo y decidir con
  Ismael (sin ella, las altas provisionales no vuelven a pendiente y las autoaltas no se purgan).
- **Dominio del Club (08-nov noche):** `update club_config_global set club_url = 'https://<dominio>';` (el mismo de
  `VITE_CLUB_URL` de club-web; no está escrito en el código). Verificar: `select club_url from club_config_global;` y que
  un QR de anfitrión de prueba se lea en caja. Sin dominio, los links del pase, el portal, el canje y la baja fallan
  cerrados con «Falta el dominio del Club».
- **Retención de contactos de ofertas:** `select contactos_ofertas_meses from club_config_global;` → **24** (confirmado
  por el dueño el 09-nov), contados **desde que la persona dejó el contacto** (aceptó el aviso; B7: las ofertas no salen
  de la app, así que no hay un «último contacto» confiable). Tiene que coincidir con el aviso de privacidad (una prueba
  de club-web compara el texto con el valor por defecto de la migración). El borrado lo hace `club_socios_mantenimiento`
  cada día.
- **Huella del aviso (B8):** `select version, sha256_es, sha256_en from club_avisos_privacidad;` → la versión de
  `club_config` está registrada (FK) con las mismas huellas que `AVISO_PRIVACIDAD_SHA256` de `club-web/src/config.ts`.
- `select aviso_privacidad_version from club_config;` igual a `AVISO_PRIVACIDAD_VERSION` de `club-web/src/config.ts` (hoy
  **v1.1**: v1 + el email en «Qué datos guardamos»; una prueba de club-web verifica que coincidan).
- `select tarjeta_manual_activa from club_config;` → `false`.
- **CLUB-AUD-42:** `select count(*) from club_entorno;` → **0**. En prod no se corre `scripts/sql/club_marcar_staging.sql`
  nunca: sin esa marca no existe el modo `pruebas` (el libro y la auditoría no tienen otra puerta que la del migrador).
- `club_web_clave` vacía: las puertas públicas fallan cerradas.

**Rollback:** `scripts/sql/<N>_rollback.sql`. Antes de la migración del paso 8 no hay datos del Club; después, solo con
el export de Firestore a mano.

## 4b. Alta de los locales (datos; justo después de la 075)
La 075 **no trae ningún local** (multilocal genérico). En el editor SQL de PROD, después del paso 4 y **antes** de la
migración F1b (paso 8, que necesita el local destino):
```sql
insert into public.club_config (location_id, nombre, direccion, mapa_url, club_activo) values
  ('santa-teresa', 'Santa Teresa', 'Santa Teresa, Puntarenas, Costa Rica', 'https://maps.google.com/?q=Satori+Sushi+Bar+Santa+Teresa+Costa+Rica', true),
  ('nosara',       'Nosara',       null, null, false);
```
**Verificar:** `select location_id, nombre, club_activo from club_config;` → dos filas; cada una con sus marcadores
(`club_marcadores_descuento`) y su promoción «Local Club» en borrador (los siembra el alta).
**Rollback:** `delete from club_config where location_id in (…)` solo si todavía no hay datos de esos locales.
Un local nuevo, más adelante: paso 11 («Encender un local»).

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
**Secret** `TURNSTILE_SECRET` (las carga Ismael; **sin ella la autoalta Y la creación de cupones responden 503**: desde
Grok 24 el cupón también pide Turnstile). Después, el deploy y el dominio.
**Verificar:**
- **Antes del deploy:** `grep -c 'CONFIRMAR ISMAEL' club-web/src/i18n.ts` → **0** (el aviso no sale con marcas
  pendientes: dirección del responsable y retención de contactos de ofertas).
- `/api/salud` → todo en `true` (incluido `turnstile`).
- **CLAUDE-HALL-04: Turnstile de prod NO es el de prueba.** La clave del sitio del build (`VITE_TURNSTILE_SITEKEY`) no
  puede ser `1x00000000000000000000AA` (ni ninguna que empiece con `1x`, `2x` o `3x`, las de prueba de Cloudflare):
  abrir `/alta`, ver el código fuente del JS y buscar `1x0000`. El Secret `TURNSTILE_SECRET` tampoco puede ser
  `1x0000000000000000000000000000000AA` ni `2x…`/`3x…`: lo confirma Ismael en Cloudflare → Turnstile (el widget de
  `club.satoricostarica.com` muestra su sitekey; tiene que coincidir con la del build).
- Tope de `/alta` por IP **y por prefijo de red** (/24 IPv4, /64 IPv6): 6 altas seguidas desde dos teléfonos en el mismo
  wifi → la sexta dice «Demasiados intentos seguidos».
- Alerta de cupo: al 80 % de `socio_autoalta_max_dia` queda una fila `tipo = 'autoalta_cupo'` en `club_alertas`.
- `/alta`: el widget aparece; un alta de prueba queda **pendiente** y se borra a mano después.
- 6 «Obtener mi cupón» seguidos desde un teléfono: el sexto dice «Demasiados intentos seguidos». Grok 24: lo mismo desde
  dos teléfonos en el mismo wifi (tope por prefijo de red), y `/r/…` muestra el widget de Turnstile antes del botón.
- Grok 63 + 136: en el cupón, «¿Querés recibir ofertas?» muestra el aviso resumido con «Aviso completo (v1)» (abre
  `/privacidad`) y «Cada mensaje de ofertas trae su link para darte de baja». Un opt-in de prueba queda en
  `club_cupones_contactos` con `aviso_version` = la vigente y su `baja_token`. El link del CSV «Contactos para ofertas»
  (`/b/<llave>`) lo borra (fila `baja_contacto_turista` en `club_auditoria`). `/b/<código del cupón>` dice «Este link de
  baja no es válido».
- Las cabeceras de `_headers`: CSP `script-src 'self'` y no-store en `/api`.
- Si Pages no toma los bindings: el «Plan B» de `club-web/README.md` (`/api` en un Worker).

**Rollback:** sacar el dominio. La base sigue cerrada sin la clave.

## 7. Pase de Wallet (F1e)
**Hacer:** emisión de Google Wallet (Apple con el código listo y apagado hasta el D-U-N-S). El QR del pase es el
público (`/r/`, cupones); el canje sale del botón «Canjear» del pase o del portal (código de un solo uso, R-01).
**Verificar:** un pase de prueba de punta a punta: alta → pase → cupón de un turista → visita → canje con código → aviso.
**Rollback:** apagar la emisión. El portal y la caja siguen funcionando.

## 8. Carga ÚNICA del lanzamiento (página vieja + tarjetas de papel), sobre la base vacía
> (09-nov, el dueño) **Una sola carga**, desde una fuente limpia que consolida todo, **fecha de carga para todos**, base del
> Club **vacía** («cero socios») y **sin borrar nada en prod**. Detalle completo: `docs/club-satori/piloto/saldos-papel.md` §A.

**Hacer:**
1. Export de Firestore con `MANIFEST` **no provisional** (depurado por el dueño) y el CSV de papel con `legacy_id`.
2. `python3 -I scripts/club/migrar_firestore.py --export <export> --local <id> --primera-carga --papel <papel.csv> --dry-run`
   → conteos, y el **chequeo de 12 meses sin actividad sobre la fuente** (frena si hay alguna; se decide en la fuente o
   con `--acepto-inactivos N`, el número exacto).
3. Ensayo en staging: lo mismo con `--ensayo --vaciar-para-ensayo` (vacía el Club dentro de la transacción y la deshace).
4. `--emitir <carpeta fuera del repo>` → `carga.sql` + `resumen.json` (sha256). El dueño firma el sha256.
5. En PROD, con la firma y fuera de servicio: `python3 -I scripts/club/migrar_firestore.py aplicar-firmado --archivo
   <carga.sql> --sha256 <el firmado> --ref <prod> --confirmo-ref <prod>` con `CLUB_G56_PROD=si`. Recalcula el sha256,
   vuelve a pasar la lista cerrada del migrador, exige `commit` al final y `standard_conforming_strings = on`, y lo
   manda tal cual. Una transacción; si la base no está vacía, aborta sin tocar nada.

**Verificar:** la validación dentro de la transacción da OK (si no, no se guarda nada); el dueño controla miembros,
saldos, los 136 vencimientos del 05-nov y el lote de papel (`select * from club_cargas_papel;`). No hay ningún `delete`.
**Rollback:** antes de que haya actividad, el rollback de la migración del Club (paso 4). **No se re-ejecuta:** la base
ya no está vacía y el migrador frena con una carga de papel.
**El modo de staging de siempre** (`--apply`, re-ejecutable, borra lo `origen = 'migracion'`) queda solo para staging y
frena si hay una carga de papel (nunca la borra).

## 8b. Arranque de las excepciones del Local Club (el día del lanzamiento)
**Hacer:** `update club_config set lc_excepciones_desde = '<fecha del lanzamiento>';` Antes de esa fecha el Local Club se
cobró sin la app y todas sus facturas saldrían como `LC_SIN_REGISTRO` (en staging: 275 en 120 días).
**Verificar:** en Excepciones no aparecen facturas LC anteriores a esa fecha.
**Códigos del PoS (Ismael, 08-nov), por local.** Los del local de Santa Teresa (ya cargados en staging):
```sql
update public.club_config set promo_articulo_codigo = '1123',            -- PROMO CLUB 10 % (clasificación 19, subclasif. 73 «LOCAL CLUB»)
                              cortesia_familia = 17, cortesia_subclasificacion = 40   -- sección «CORTESIAS» (17, 40)
 where location_id = 'santa-teresa';
```
Al cargar `promo_articulo_codigo` se siembra solo su marcador de descuento «PROMO CLUB 10 %» (con 10 % esperado) y R02 deja
de estar «pendiente de configuración». La subclasificación queda guardada: hoy las líneas del puente traen solo la
clasificación, así que se compara la clasificación (cuando el puente mande la subclasificación, se usan las dos).
**CORTESIA_SIN_SOCIO cuenta solo desde `lc_excepciones_desde`** (antes del lanzamiento la sección se usa fuera del Club).
Si corresponde, `articulos_cero_permitidos` (p. ej. el 857 «INVITADO»).

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

## 11. Encender un local (multilocal genérico, LC-ML) — checklist «Encender un local»
> **Regla (Ismael, 08-nov):** el Club es multilocal GENÉRICO. Los locales son filas de `club_config`: **ninguno está
> escrito** en el código, la migración, club-web ni el pase (las pruebas 70 y 72 lo verifican). Abrir un local nuevo en
> otra ciudad = **alta (un INSERT o la app) + su configuración (datos) + encender (un click)**, sin código ni migración.
> Hoy: el de Santa Teresa encendido y el de Nosara cargado y APAGADO. Mientras un local está apagado no hay altas
> (caja ni autoalta), visitas de socio, cupones, canjes, tarjeta manual, premios ni excepciones LC en ese local; sí se
> prepara su configuración y se leen sus reportes.

**A. Alta del local** (queda APAGADO). Una de dos:
- **App:** owner → Club → **Locales** → «Nuevo local»: id (minúsculas y guiones), nombre, dirección, mapa y, si
  conviene, «copiar la configuración de» otro local (códigos del PoS, topes y valores del crédito, para revisar).
- **Un único INSERT** (editor SQL, owner del proyecto):
  ```sql
  insert into public.club_config (location_id, nombre, direccion, mapa_url)
  values ('<id>', '<Nombre>', '<Dirección>', 'https://maps.google.com/?q=<…>');
  ```
En los dos casos el alta **siembra** sus marcadores de descuento (856 y 857 del PoS) y la promoción «Local Club» en
borrador, y queda en la auditoría (la app) o en `club_config_historial` (los cambios posteriores).

**B. Configuración del local** (todo es dato; con el local elegido en el selector de la app):

| # | Qué | Dónde | Verificar |
|---|---|---|---|
| 1 | **Puente del local** corriendo con **su propio secreto**: entrada `"<id>"` en `POS_INGEST_SECRETS` (32+ caracteres, distinto de los demás) y el agente de su PC con `LOCAL=<id>` | panel de Supabase + PC del PoS | `select now() - last_poll_at, last_error from pos_ndf_cursor where local = '<id>';` late y sin error. ⚠ El puente del pase (v2 con la 082 v3) acepta solo santa-teresa y nosara; un tercer local necesita desplegar antes `claude/puente-locales-genericos` (`docs/puente/LOCALES-GENERICOS.md`), que toma los locales del mapa de secretos |
| 2 | **Códigos del PoS:** `lc_articulo_codigo` (856, LOCAL CLUB), `lc_invitado_codigo` (857, INVITADO), `promo_articulo_codigo` (PROMO CLUB 10 %), `articulos_cero_permitidos` | `club_config` (fila del local) | existen en el catálogo de su PoS (Club → Promociones → buscar producto) |
| 3 | **Marcadores de descuento** (tarjetas de hoteles o tiendas, descuento de personal…) | Club → **Descuentos** | los sembrados (856, 857) más los propios del local |
| 4 | **Sección CORTESÍA CLUB:** `cortesia_familia` y las cortesías del sorteo | `club_config` + Club → Promociones | cortesías activas |
| 5 | **Promoción del Local Club** (sembrada en borrador) | Club → Promociones | pasarla a vigente el día del lanzamiento |
| 6 | **Topes:** `socios_por_factura`, `socio_visitas_semana_max`, `cupones_max_dia_referente`, `cupones_max_minuto_local`, `anfitrion_tope_mes_crc`, `socio_autoalta_max_dia`, valores del crédito | `club_config` | los que decida Ismael |
| 6b | **Tope diario del socio (ÚNICO para todo el Club, 08-nov noche):** `socio_visitas_por_dia` | `club_config_global` (una fila; no es por local) | 1 = «una visita con beneficio por día, en cualquier Satori» |
| 7 | `aviso_privacidad_version` = la de club-web (`v1`) | `club_config` | si no coincide, la autoalta del local rechaza todo |
| 8 | **`lc_excepciones_desde` = el día del lanzamiento** (vacío = las excepciones LC miran todo su historial) | `club_config` | — |
| 9 | **Empleados del local con su `pos_login`** (segregación de las excepciones del PoS) | Admin → Empleados | sin login, esas excepciones las resuelve solo el owner |
| 10 | **Anfitriones y negocios** del local, creados con ese local elegido | Club → Miembros / Negocios | `club_miembros.location_id = '<id>'` |
| 11 | **QR y enlace de alta** del local con `?local=<id>` (con dos o más locales encendidos, sin el parámetro el formulario pide elegir) | carteles / club-web | — |
| 12 | **Pase de Wallet:** es el mismo para todos los locales (franja «SATORI · CLUB») | — | — |

**C. Encender:** owner → Club → **Locales** → **Encender** (pide confirmación; queda auditado). En SQL:
`update public.club_config set club_activo = true where location_id = '<id>';`
**Verificar:** aparece el selector de local en la app; con el local elegido, Escanear muestra sus pedidos abiertos; un
alta en caja de prueba queda con su `location_id`; la tarea diaria (`club_socios_mantenimiento`) lo incluye en premios.
**Apagar (rollback):** el mismo botón o `club_activo = false`. No borra nada: corta las operaciones nuevas.

**CLUB COMPARTIDO (decisión de Ismael, 08-nov):** un **socio vale en todos los locales encendidos**. La visita es del
local de la caja (su pedido, promo, cortesías y códigos) y queda con ese local; el tope de visitas con beneficio por día es
**global**; el alta y la confirmación se hacen desde cualquier local (el alta queda con el local donde se hizo; si ese
local se apaga, el socio sigue valiendo en los demás); el premio por referir nace y se cobra en cualquier local. Los
**anfitriones, cupones, marcadores, cortesías, promociones y el interruptor siguen por local**. Encender un local nuevo no
pide migrar socios.

## 12. Gates de prod abiertos (Grok 56 y 61) — PROPUESTA, nada de esto corre en prod sin la firma de Ismael

Estos dos gates tienen que estar cerrados antes de los pasos 4 y 8 en prod. Hoy son **diseño**: lo que se hizo es
documentación y una consulta de solo lectura probada en staging. Ninguno toca prod.

### G-56 · Modo prod del migrador, revisable (bloquea el paso 8)
**Problema.** El migrador solo corre contra staging (`--ref` fijo), y su `--apply` de staging **borra y vuelve a cargar**
todo lo `origen = 'migracion'`: en prod, después de abrir, eso podría borrar movimientos de verdad. Además, lo que corre
en prod tiene que poder revisarse antes, sin exponer datos personales.

**Estado (09-nov):** hecho y probado en staging, para revisar:
- **Análisis real del SQL** (`scripts/club/sql_g56.py`, no regex): lista cerrada de sentencias, sin `execute`, `set local`
  solo para los dos timeouts, `insert` solo en `club_movimientos` (y el registro del lote, `club_cargas_papel`); los 4
  archivos trucados de la auditoría son pruebas y se rechazan. Lo usa la carga de papel al emitir y al aplicar.
- **Modo PROD de la carga de papel:** `saldos-papel --aplicar-firmado <carga.sql> --sha256 <firmado>` (contra prod,
  además `--confirmo-ref` y `CLUB_G56_PROD=si`). Probado solo en staging: el `carga.sql` de prod se niega solo.
- **Migrador, primera carga** (paso 8):
  - `--primera-carga --emitir`: sin `delete`, precondición «cero socios», fecha de carga, chequeo de 12 meses sobre la
    fuente, papel en la misma transacción.
  - **Lista cerrada propia** (`sql_g56.revisar_migrador`, con temporales `_… on commit drop` y los inserts solo en las
    tablas del migrador). `--emitir` se niega si no pasa.
  - **`aplicar-firmado`**: sha256 firmado, lista cerrada otra vez, `commit` al final y `standard_conforming_strings = on`.
    Contra prod, además `--confirmo-ref` y `CLUB_G56_PROD=si`.
  - Probado en staging: la primera carga firmada frena por «cero socios» y staging queda igual.
  - Detalle: `piloto/saldos-papel.md` §A.4 y §A.4b.

**Propuesta original (08-nov; queda como referencia de lo que se pidió):**
1. **Dos llaves para prod:** `--ref <prod> --prod`. Sin las dos, el script se niega igual que hoy. `--prod` nunca conecta
   en la misma corrida en que arma el plan.
2. **Emitir, no ejecutar:** `--prod --emitir <carpeta fuera del repo>` escribe tres archivos:
   - `migracion.sql`: **una transacción** con, en orden:
     a) `set local lock_timeout = '5s'` y `set local statement_timeout = '5min'` (si algo espera un lock o se cuelga,
        aborta entero en vez de trabar la base);
     b) precondiciones que abortan: la migración del Club está en el ledger con el md5 esperado; `club_entorno` vacío
        (no es staging); el local `--local` existe; **línea de base «cero socios en `club_*`»**: `club_miembros`,
        `club_miembro_roles`, `club_movimientos`, `club_cupones` y `club_visitas_socio` en **0 filas** (si hay algo, ya hubo
        actividad o una carga previa: se frena y se replanifica con firma; en prod no se re-ejecuta y no hay `delete`);
     c) las inserciones (solo `insert into public.club_…`);
     d) la validación contra `--esperados` dentro de la transacción (si no da, `raise` y no queda nada);
     e) `commit` solo al final.
   - **Filtro de sentencias (mecánico, al emitir y otra vez al aplicar):** el script recorre `migracion.sql` sacando los
     literales de texto y **rechaza** el archivo si aparece cualquiera de `delete`, `truncate`, `drop`, `update`,
     `alter`, `grant` o `revoke` (también dentro de bloques `do`), o cualquier sentencia que no sea `begin`, `set local`,
     `do` (precondiciones y validación), `insert into public.club_…` o `commit`. Prueba con un archivo trucado de cada
     tipo → niega.
   - **`migracion.sql` tiene datos personales** (nombres, teléfonos, emails del export): nunca al repo, ni por chat, ni
     adjunto al paquete; 0600, fuera del repo y se borra después de aplicar. **Lo único que viaja es su sha256** (en
     `resumen.json` y en el paquete del pase, para la firma).
   - `resumen.json`: conteos y totales (miembros por tipo, Σ personas, Σ créditos, vencimientos del 05-nov, duplicados),
     el sha256 de `migracion.sql` y la versión del script. **Sin nombres, teléfonos ni emails** (una prueba lo verifica
     con expresiones regulares).
   - `revision.md`: lo que hay que mirar y los conteos para firmar.
   Permisos 0600 y la carpeta fuera del repo, como hoy.
3. **Revisión:** Ismael (y Grok, si quiere) revisan `resumen.json` y el **código** que genera el SQL, no los datos. El
   mismo export corrido con `--ensayo` en staging tiene que dar el mismo `resumen.json` (salvo los ids).
4. **Ensayo en prod:** el mismo `migracion.sql` con `rollback` en vez de `commit` (lo genera `--emitir` como
   `migracion-ensayo.sql`, con su propio sha256), con la firma del día del pase y **fuera de horario**: antes de abrir o
   después del cierre de caja, nunca durante el servicio ni en una ventana de otra sesión (toma locks de `club_*` aunque
   termine en `rollback`).
5. **Aplicar:** `--prod --aplicar-archivo migracion.sql --sha256 <el firmado>`: el script recalcula el sha256 y se niega si
   no coincide. Una sola transacción. Rollback: no hay re-ejecución; antes de que haya actividad, el rollback de la
   migración del Club (paso 4); después, a mano y con firma.
6. **Pruebas a sumar al implementarlo** (`scripts/club/test_migrar_firestore.py`): prod sin `--prod` → niega;
   el filtro rechaza un archivo con `delete`, `truncate`, `drop`, `update`, `alter`, `grant` (uno por prueba, también
   escondido en un `do`) y deja pasar uno con esas palabras solo dentro de un literal; `lock_timeout` y
   `statement_timeout` presentes antes de todo; precondiciones (con la línea de base de cero socios) presentes y en
   orden; sha256 distinto → niega; `resumen.json` sin datos personales; `--prod` con `--apply` de staging → niega.

### G-61 · Diff exacto del catálogo staging ↔ prod (bloquea el cierre del paso 4)
**Problema.** `scripts/sql/club_catalogo.sql` (la paridad del CLUB-AUD-17) compara columnas, constraints, índices,
funciones (md5 con SECURITY DEFINER y search_path) y su ACL, policies, triggers, ACL de tablas y columnas y vistas, pero
**no** dueños, reloptions, FORCE RLS, privilegios por defecto ni lo que la 075 usa fuera de `club_*`. Una diferencia
ahí cambia permisos sin que el diff la vea. Ejemplo real de staging: los privilegios por defecto de `postgres` y
`supabase_admin` en `public` dan **todo** a `anon` en cada tabla nueva; la 075 lo revoca a mano, y si prod tuviera otros
privilegios por defecto el resultado podría ser distinto.

**Mecanismo (08-nov noche; probado solo en staging):** `scripts/sql/gate61.sh` + `scripts/sql/gate61_catalogo.sql` +
`scripts/sql/gate61_esperadas.txt`. Reemplaza a `club_catalogo_ext.sql` (borrado: una sola versión).
1. **Qué compara** (`gate61_catalogo.sql`, normalizado: `collate "C"`, ACL con `aclexplode` sin grantor, cuerpos en md5,
   espacios colapsados, sin OIDs): columnas, constraints, índices; relaciones con dueño, RLS, FORCE y `reloptions`; ACL de
   tablas, vistas, secuencias y columnas; **funciones en columnas** (dueño, lenguaje, SECURITY DEFINER, volatilidad,
   estricta, leakproof, paralelismo, retorno, `proconfig`, md5) y su ACL; **dueños de las SECURITY DEFINER con
   `rolsuper`/`rolbypassrls`**; policies con **PERMISSIVE/RESTRICTIVE**; triggers con **`tgenabled`**; **triggers sobre
   `auth.users`**; vistas; **secuencias con su OWNED BY**; **`pg_depend`** de todo lo que toca `club_*`; **publicaciones**;
   **jobs de `pg_cron`**; **extensiones por existencia, esquema y versión mínima** (`pgcrypto` ≥ 1.3, `pg_cron` ≥ 1.4);
   privilegios por defecto y esquema `public`; roles de la API; el enum `user_role`; columnas y RLS de `profiles`,
   `employees` y `pos_ndf_*`. En staging: 3.439 hechos, determinista (dos corridas iguales).
2. **Cómo decide** (`gate61.sh`): lee las dos bases en `begin; set transaction read only; …; rollback;` y compara los
   multiconjuntos (un hecho repetido en una sola base también es diferencia). **Sale 0 solo** si no hay diferencias fuera
   de `gate61_esperadas.txt` **y** no sobra ninguna esperada. 1 = diferencia sin esperar · 2 = esperada sobrante ·
   3 = salida vacía, `null` o con menos de `MIN_OBJETOS` hechos (por defecto el piso, 3.000; staging tiene 3.505) ·
   4 = firma ausente o inválida · 5 = uso incorrecto, **prod sin `--prod-firmado`** (no conecta) o, en **modo prod**
   (A o B es prod): **A = B** (el mismo ref, o el mismo archivo con `--archivos`: comparar una base consigo misma siempre
   pasa) o **`MIN_OBJETOS` por debajo del piso fijo** (3.000, no se baja por variable de entorno; cambiarlo es un PR
   revisado).
3. **Esperadas con firma** (`gate61_esperadas.txt`, versionado): `- <hecho>` / `+ <hecho>` copiados de la salida, con su
   motivo en un comentario, y la línea `firma: <quién> <fecha> sha256=<hex>` con el sha256 de las entradas. Editar una
   entrada sin volver a firmar → 4. **Esa línea es solo integridad** (el sha256 lo recalcula cualquiera): **la
   autorización de una esperada es el PR revisado y mergeado** que la agrega o la cambia. El archivo solo cambia por PR
   revisado por el dueño, y el gate se corre con el archivo de la rama ya mergeada. Hoy: sin entradas.
4. **Pruebas:** `bash scripts/sql/gate61_test.sh` (sin base): 19 casos, uno por código de salida, por tipo de firma
   mala y por regla del modo prod (A = B por ref y por archivo, `MIN_OBJETOS` bajo el piso; `--modo-prod` la fuerza sin
   conectar). En vivo, solo staging: `gate61.sh --ref-a <staging> --ref-b <staging>` → 0; con un hecho de más o repetido → 1.
5. **D-1 (paso 0) y después del paso 4, con la firma de Ismael para leer prod:**
   `bash scripts/sql/gate61.sh --prod-firmado --salida <carpeta>` (A = staging, B = prod). La carpeta (catálogos y
   diferencias, sin datos de personas) se adjunta al paquete del pase. Cada diferencia: se corrige o se anota en
   `gate61_esperadas.txt` con su motivo y la firma; se vuelve a correr hasta que dé 0.

