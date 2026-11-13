# PASE a PROD — Edge `club-pase` (Google Wallet del Club, opción c)

> Repo público: sin valores de secretos, llaves, tokens ni Issuer ID. Los secretos van solo por **nombre** y por los
> primeros 8 caracteres de su **digest** (el sha256 que muestra la Management API; no permite recuperar el valor).

## Firma
- **Firmado por el dueño el 13-nov-2026** (en el chat del asesor), sobre **`d8f0280`** de la rama `claude/club-pase-edge`.
- Alcance: solo el Edge `club-pase` y 3 secretos de valor fijo. **Sin migraciones, sin tocar datos, sin merges.**
- Ejecutó: Claude, por la Management API de Supabase (equivalente a `supabase functions deploy … --use-api`; en la
  sesión no hay CLI). Proyecto **PROD `yiczgdtirrkdvohdquzf`** (`satori-app`), leído antes de cada paso.
- Fuente de lo desplegado: **el SHA `d8f0280`**: `supabase/functions/club-pase/index.ts` + `src/shared/wallet/`
  (`edgePase.ts`, `googlePase.ts`, `sincronizar.ts`, `applePase.ts`). No está en `main` (regla 2 de ESTADO, ítem 11).

## Paso 0 — antes (13-nov, 10:32 CR, solo lectura)
**Secretos que cargó el dueño hoy (tenían que existir):**

| Nombre | Digest | Cargado (UTC) |
|---|---|---|
| `GOOGLE_WALLET_SA_KEY` | `0c74a543` | 13-nov 15:46 |
| `GOOGLE_WALLET_ISSUER_ID` | `5d9bf496` | 13-nov 16:29 |
| `CLUB_WEB_KEY` | `d65e37c7` | 13-nov 16:30 |
| `CLUB_PASE_SYNC_KEY` | `0c21a15f` | 13-nov 15:54 |

- `CLUB_WEB_KEY` del Edge **coincide** con la clave activa de la base (`club_web_clave`, comparando sha256; nunca el valor).
- `club_config_global.club_url` = `https://club.satoricostarica.com` (igual al del doc de activación).
- `club-pase` **no existía** en prod.

## Paso 1 — secretos de valor fijo (10:33 CR)

| Nombre | Valor (público) | Digest |
|---|---|---|
| `WALLET_ENTORNO` | `prod` | `6754af96` |
| `CLUB_WEB_ORIGIN` | `https://club.satoricostarica.com` | `73ce68cc` |
| `WALLET_DISENO` | el JSON de §1 de `docs/club-satori/WALLET-GOOGLE-ACTIVACION.md` | `82e0c46e` |

Los tres digests son el sha256 del valor esperado (verificado). **Cambiar cualquier secreto sube la versión de TODAS
las funciones del proyecto sin cambiar su código ni su hash:** no es un despliegue (ver la tabla de abajo).

## Paso 2 — despliegue (10:33 CR)
`club-pase` **v1** · `verify_jwt` **off** · hash `63818f6d5458…` (desde `d8f0280`).

## Antes / después por función

| Función | Antes (10:32) | Después (10:44) | Hash |
|---|---|---|---|
| `club-pase` | — (no existía) | **v1** · off | `63818f6d5458` (nueva) |
| `extract-document` | v14 · on | v15 · on | `2f88ef52b498` = igual |
| `ingest-ndf` | v8 · **off** | v9 · **off** | `cf6442cf20a5` = igual |
| `monthly-report` | v16 · on | v17 · on | `12f040db8c16` = igual |
| `cierre-email` | v8 · on | v9 · on | `36ff59eed179` = igual |
| `pago-notificar` | v8 · on | v9 · on | `0e47a0350843` = igual |
| `alta-empleado` | v7 · on | v8 · on | `f11ee8d21994` = igual |

Las otras seis subieron una versión por el cambio de secretos; su código no cambió.

## Paso 3 — humo (10:33 CR, sin datos de nadie)
- `POST /club-pase/google` sin `x-club-web` → **401** `no_autorizado`.
- `POST /club-pase/vencer` sin `x-club-pase-sync` → **401** `no_autorizado`.

## Paso 4 — cron del Worker (cada 10 min)
- El cron está en `main` desde el #148 (`club-web/worker/wrangler.toml`: `*/10 * * * *`; `programado.js`).
- **Primera corrida con éxito:** el cursor `google` de `club_pase_cursor` apareció a las **10:43:45 CR** en **500** (antes
  no existía). `/vencer` solo guarda el cursor cuando responde 200; con un 401 (clave de sync distinta entre el Edge y el
  Worker) no hubiera avanzado. **La clave de sync coincide.**
- Procesó los primeros 500 de **3.002** eventos (el tope por llamada); quedan 2.502, unas 5 corridas más.
- **Vencidos: 0**: en prod no hay ningún pase emitido (`club_pases` = 0) ni objetos en Google; las bajas salen «sin pase».
- **No verificado:** el resumen exacto de la corrida (`errores`, `sin_pase`, `sin_cambio`) en los logs del Edge o del
  Worker. El endpoint de logs de la Management API cambió y su documentación no estaba al alcance de la sesión. Que el
  cursor llegara al último evento del lote indica que no hubo errores transitorios (un error transitorio lo frena antes).
  Para verlo: panel de Supabase → Edge Functions → `club-pase` → Logs, o los logs del Worker (`club-pase-vencer`).

## Paso 5 — el resto de prod
- Las seis funciones de antes tienen el **mismo hash** que en el paso 0; `ingest-ndf` sigue con `verify_jwt` off.
- Tickets del PoS: siguen entrando (4 ingestas después del despliegue; la última a las 10:43:36 CR).

## Vuelta atrás
- **Del Edge:** borrar la función (`supabase functions delete club-pase --project-ref yiczgdtirrkdvohdquzf`, o
  `DELETE /v1/projects/yiczgdtirrkdvohdquzf/functions/club-pase`) o borrar un secreto obligatorio (todo responde 503).
- El portal y la caja siguen funcionando sin el pase: los botones de Wallet siguen **apagados** (`VITE_WALLET_GOOGLE`).
- Sin migraciones ni datos que deshacer. El cursor `google` se puede dejar (solo indica hasta dónde se leyó).

## Pendiente
- Leer en los logs el resumen de las corridas del cron (`errores` vacío).
- Encender los botones (`VITE_WALLET_GOOGLE`) recién con la aprobación de publicación de Google y la firma del dueño.
- Imágenes del pase: verificar que `https://club.satoricostarica.com/pase/logo.png` y `hero.png` responden 200 (la
  sesión no llega a ese dominio). Solo se usan al emitir un pase; hoy no se emite ninguno.

## Redespliegue c0369d5 (13-nov)
**Firma:** el dueño, 13-nov-2026 (en el chat del asesor), sobre **`c0369d5`** de `claude/club-pase-edge` (PR #160: lote de
200, filtro por pases emitidos, tope de 90 s, timeout de 15 s por pedido a Google, purgados por id fijo, campo
`trabado_en`). Solo `club-pase`: **sin migraciones, sin tocar datos ni secretos, sin merges.** Probado antes en staging
(300 eventos de miembros sin pase en 2 corridas de menos de 1 s, ya vencido y purga simulada).

| Paso | Hora CR | Resultado |
|---|---|---|
| 0. Antes (solo lectura) | 12:00 | `club-pase` **v1** · off · `63818f6d5458` (= `d8f0280`, la vuelta atrás). Cursor `google` en **3002** (el último evento), 0 pendientes, 0 pases emitidos |
| 1. Despliegue | 12:00:25 | `club-pase` **v2** · `verify_jwt` **off** · hash `6fd3c5bb5d5a…` |
| 2. Humo | 12:00:29 | `/google` sin `x-club-web` → **401** · `/vencer` sin `x-club-pase-sync` → **401** |
| 3. Cron del Worker | 12:00:55 | Primera corrida sobre la v2: el contador de llamadas a `club_pase_cursor_leer` pasó de 10 a 11 (`pg_stat_statements`). `/vencer` lo llama **después** del portón: la clave del Worker pasó (un 401 no lo cuenta). 0 eventos: el cursor queda en 3002, lo esperado. **Segunda corrida** a las **12:10:56** (contador 11 → 12): el cron sigue llamando cada 10 min |
| 4. El resto | 12:01 | Las otras 6 funciones con **la misma versión y el mismo hash** que en el paso 0 (no hubo cambio de secretos) · tickets del PoS entrando (última ingesta 12:00:59) |

**Antes / después:**

| Función | Antes | Después |
|---|---|---|
| `club-pase` | v1 · off · `63818f6d5458` | **v2** · off · `6fd3c5bb5d5a` |
| `extract-document` | v15 · on · `2f88ef52b498` | igual |
| `ingest-ndf` | v9 · **off** · `cf6442cf20a5` | igual |
| `monthly-report` | v17 · on · `12f040db8c16` | igual |
| `cierre-email` | v9 · on · `36ff59eed179` | igual |
| `pago-notificar` | v9 · on · `0e47a0350843` | igual |
| `alta-empleado` | v8 · on · `f11ee8d21994` | igual |

**No verificado:** el código HTTP y la duración de la corrida del cron en los logs (el endpoint de logs no estaba al
alcance de la sesión). La señal usada es el contador de `pg_stat_statements`; para el 200 y el tiempo: panel de Supabase
→ Edge Functions → `club-pase` → Logs, o los logs del Worker (`club-pase-vencer`).

**Vuelta atrás:** volver a desplegar `d8f0280` (hash `63818f6d5458`), o borrar la función.
