# RUNBOOK · pase a prod del Club Satori (piloto oficial)

> **No se ejecuta nada de este documento sin la firma de Ismael, paso por paso.** Es el orden obligatorio que pide la
> auditoría (ronda 3, CLUB-AUD-35): mergear el PR #59 equivale a migrar prod, porque Branching aplica la 075. Por eso
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
| 2 | Mig **081** (campos de la factura del puente) | 1 | `scripts/sql/081_rollback.sql` (solo si el paso 3 no se hizo) |
| 3 | Edge `ingest-ndf` desde `claude/puente-item11-prod`, y después el agente de prod | 2 | volver al Edge anterior **antes** de tocar la 081 |
| 4 | Mig **075** (Club) | 1 | `scripts/sql/075_rollback.sql` (no hay datos del Club todavía) |
| 5 | Clave de club-web (`CLUB_WEB_KEY` + su sha256) | 4 | `club_web_clave_cargar` con una clave nueva |
| 6 | Cloudflare (Pages `satori-club`: variables, bindings y dominio) | 5 | sacar el dominio; la base sigue cerrada |
| 7 | Pase de Wallet (F1e) | 6 | apagar la emisión; el portal sigue funcionando |
| 8 | Migración F1b con `--esperados` | 4 | volver a correrla (es re-ejecutable) o el rollback de la 075 |
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
  select version from supabase_migrations.schema_migrations where version in ('069','075','081') order by 1;
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

## 3. Edge `ingest-ndf` y agente de prod
**Hacer:**
1. Desde un checkout de `claude/puente-item11-prod` (hoy `d531809`):
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

## 4. Mig 075 (Club)
**Hacer:** aplicar `supabase/migrations/075_club_satori_esquema.sql` (la del PR #59, el mismo blob que se verificó en
staging) y registrar la fila `075` en el ledger.
**Verificar (solo lectura):**
- Catálogo `club_*` igual al de staging: correr `scripts/sql/club_catalogo.sql` en las dos bases y comparar (en staging
  da 528 objetos). Es la paridad del CLUB-AUD-17, hecha a mano contra prod.
- `anon` ejecuta solo `club_canje_codigo_generar`, `club_cupon_contacto`, `club_cupon_crear`, `club_cupon_ver` y
  `club_portal`.
- `select tarjeta_manual_activa from club_config;` → `false`.
- `club_web_clave` vacía: las puertas públicas fallan cerradas.

**Rollback:** `scripts/sql/075_rollback.sql`. Antes de la migración del paso 8 no hay datos del Club; después, solo con
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
(5 por 60 s) y `RL_LEER` (60 por 60 s) de `wrangler.toml`. Después, el deploy y el dominio `club.satoricostarica.com`.
**Verificar:**
- `/api/salud` → todo en `true`.
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
**Rollback:** volver a correr (es re-ejecutable por `legacy_id`) o, si todavía no hubo actividad, el rollback de la 075.

## 9. Tarjeta física apagada
**Hacer:** `update club_config set tarjeta_manual_activa = false;` (ya viene `false` por defecto; se confirma).
**Verificar:** en caja no aparece «Tarjeta física» y `club_tarjeta_manual` rechaza a todos los roles.

## 10. Merge del PR #59 (último)
**Antes:** el ledger de PROD tiene `069`, `075` y `081`, y los `.sql` del PR son los mismos blobs que se aplicaron.
Branching ve las versiones ya registradas y no las vuelve a aplicar.
**Hacer:** sacar el PR de borrador y mergear.
**Verificar:** el log de Branching sin errores; la app publicada tiene `/club`; humo: Escanear, Miembros y Reportes con
usuarios reales de gerencia.
**Rollback:** revertir el código del PR. **Los `.sql` de migraciones que ya están en el ledger de prod no se borran
nunca** (regla 10 de `ESTADO.md`).
