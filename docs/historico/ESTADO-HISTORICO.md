# ESTADO — histórico (foto íntegra al 2026-11-17, `main` @ `36de2362`)

> **Esto NO es la fuente viva.** Es el `ESTADO.md` completo, movido TAL CUAL el 17-nov-2026 cuando se podó el original
> (`git show 36de2362:ESTADO.md` da el mismo texto). Lo vigente está resumido en [../../ESTADO.md](../../ESTADO.md); acá queda el
> detalle: la tabla de PRs del 15–17/11, la tabla larga de migraciones con su bitácora por número, los ledgers de prod y
> staging con sus filas, el camino de las ventas, lo que hay en prod y en staging, pendientes de estabilización, seguridad
> y notas. Si algo de acá contradice a `ESTADO.md`, gana `ESTADO.md`. Anterior a esto: [../../ESTADO-ARCHIVO.md](../../ESTADO-ARCHIVO.md).

---

# Satori App — Estado del proyecto

## ⚡ ARRANQUE — foto real del repo y de las bases (se REEMPLAZA en cada entrega, no se acumula)
**Al día: 2026-11-17, 03:10 hora de Costa Rica.** `main` = merge del #250 (`c775b3d`, 03:10). Con OK y firma del dueño por el chat a las 02:53 CR entraron: **#247** (Mix sin filas repetidas, merge `f3df931`, 02:57), **#240** (mig 183, merge `51a765a`, 03:06) y **#250** (mig 184, merge `c775b3d`, 03:10). **Ledger de prod = 184.** El bloque anterior (02:25 del 17/11) queda reemplazado; el de las 06:45 del 15/11 está en [ESTADO-ARCHIVO.md](../../ESTADO-ARCHIVO.md).
**Punto de entrada: [docs/handoffs/HANDOFF-2026-11-13.md](../../docs/handoffs/HANDOFF-2026-11-13.md)** (el handoff del 15/16-nov está en el proyecto privado).
- **PASE 183 y 184 (§6 OK, bitácora en cada PASE):** md5 de `pg_get_functiondef` en prod: núcleo de excepciones `0b7b956e`, núcleo del reporte de descuentos `7a5e33e2`; el contador `3c3c963d` y el envoltorio `7e0b7ae5` quedaron sin cambio. Branching, Pages, satori-club, Worker y deploy de la app dieron success.
- **#248 (el puente lee el descuento por línea):** mergeado en la rama del agente `claude/puente-item11-prod-v2` (`578f38c`), **NO en `main`**. Falta que el dueño cambie la carpeta del agente en la PC del PoS y corra el backfill 00:00–06:00 según PASE-D9.
- **Validaciones del dueño en la apertura:** #229, #225, #226, #234, #238, #244, #247 y Marcadores con «todas las líneas».
- **Cron del Club (PASE `docs/pases/PASE-cron-club-mantenimiento.md`):** jobid 8 (`15 9 * * *`, 03:15 CR). **Pendiente confirmar la corrida de las 03:15 CR del 17/11** (§5.6 del PASE) y repetir el 23-nov.
- **Otros pendientes:** reintentar el `drop` del índice de la v1 de la 183 en staging (`pos_ndf_tickets_local_fecha_efectiva_idx`); confirmar el deploy de correos (#245/#242/#243); #231, #232 y #235 sin entrar.

> **Regla (Definition of Done):** ninguna entrega se cierra sin ⚡ARRANQUE al día; puede ir en el mismo PR o
> en un PR de docs inmediato después del merge. **El repo manda:** si este archivo y la realidad no coinciden, gana la realidad y se
> corrige el archivo.

| Puntero | Hash | Qué es |
|---|---|---|
| `main` | **`c775b3d`** (merge del #250, 17/11 03:10 -06:00; antes `51a765a` = #240, 03:06). **Sin regla de protección.** | **PROD.** GitHub Pages (base `/satori-app/`). Ledger de prod: **184** (17/11 03:10 CR). |
| `staging` | rama sin cambios desde el 13/11 (`4726b7f`); **base de staging con ledger 184** (181 versión final ~15:00 y 182 ~13:50 del 16/11; mismas versiones y nombres que prod) | Proyecto Supabase de staging. |
| `feat/pos-desglose` | **`14bd278`** | Rama del **agente** del PoS (`pos-bridge/`). No se mergea a `main`. |

- **Entraron entre el 15/11 06:32 y el 16/11 00:11** (hora CR, merge SHA):

| PR | Mig. | Merge | Hora CR | Nota |
|---|---|---|---|---|
| #198 | | `c32646a` | 15/11 06:41 | docs: cómo funcionaba el sistema viejo de créditos (`docs/club-satori/historico/`) |
| #199 | | `5596c8b` | 21:52 | docs: base del 10 % del concierge = subtotal (decisión A del dueño); 153 en prod |
| #200 | | `1cc0645` | 21:56 | avisos del Inicio directo a la vista (`/caja?vista=pendientes`, `/club?vista=excepciones`). Validado en el local |
| #201 | | `bbac16e` | 22:03 | montos ₡ con un solo separador (créditos de proveedor) + aviso cuando la fecha de la clave FE difiere de la impresa. Validado |
| #202 | 172 | `5bf5ecf` | 22:11 | el manager solo opera fichas de su local (20 funciones más; `club_exigir_local_de`) |
| #203 | 173 | `4ba922e` | 22:17 | cumpleaños en caja y portal + beneficio configurable en Promociones (apagado) + aviso v1.3. Validado |
| #206 | 174 | `dd7a070` | 23:50 | tarjeta física: facturas cobradas hoy + búsqueda por tiquete hasta 3 días (solo tarjeta; cupón/canje/socio siguen 2 h 15) |
| #205 | 175 | `9da06d8` | 23:55 | beneficio de cumpleaños una vez por año (servidor; cruce de locales; deshacer solo owner) |
| #204 | 176 | `aa32dfe` | 23:59 | el manager ve en las listas solo sus locales (funciones + 17 políticas RLS) |
| #208 | | `ed92dbb` | 16/11 ~00:05 | pruebas del Inicio con fecha fija: los lunes rompían CI (el deploy de `aa32dfe` falló en Tests y quedó resuelto acá) |
| #207 | 177 | `003e8b6` | 00:11 | el repo declara los tipos numéricos como prod (39 columnas; **sin efecto en prod**, verificado). Supabase Preview falló por timeout de `api.supabase.com` → la 177 entra con el merge siguiente |
| #209 | | `33cf9a4` | 00:20 | docs ESTADO (con este merge Branching aplicó la 177) |
| #210 | | `d9d1814` | 07:02 | alta en caja: «¿Este es su WhatsApp?» antes del alta (hallazgo 230) + «Reservar» en el portal |
| #211 | 178 | `637b9f2` | 07:30 | el repo declara las 5 columnas de Caja que ya existían en prod (sin efecto en prod) |
| #212 | 179 | `ec14883` | 07:35 | «Reservar» del portal abre el OpenTable del local del socio; Promociones exige link de OpenTable |
| #213 | | `034416d` | 08:33 | móvil: se ven todas las pestañas de cada módulo (antes se escondían de la 9.ª en adelante) |
| #214 | | `6bb68a4` | 08:38 | widget de OpenTable en «Mi Club» como iframe aislado (sin script de terceros) + el token del portal sale de la barra |
| #215 | 180 | `e59b52a` | 08:44 | link de reservas por local en Club → Locales; «Reservar una mesa» en la página del cupón del turista |
| #216 | | `3791496` | 09:06 | link del portal (copiar y WhatsApp con confirmación) también en la ficha del socio |
| #217 | | `2f54b19` | ~09:15 | docs ESTADO 16-nov 09:15 |
| #218 | | `5395d41` | 12:36 | docs ESTADO (foto de las 11:45; ledger prod y staging 180) |
| #219 | | `9225d87` | 12:43 | batería 173 que no se traga el error + manager de prueba en staging (`scripts/sql/`, `STAGING.md`; sin efecto en prod) |
| #220 | | `5396649` | 12:57 | campañas de OpenTable por grupo (club-web; OK del dueño 16/11 12:47, Decisión 2 opción A) |
| #221 | | `8f8ec54` | 13:46 | privacidad del repo público: guarda `src/privacidadRepo.test.ts` (sin nombres, correos ni cédulas en el repo). Firma del dueño 13:38 |
| #222 | | `2a07cdf` | 13:49 | Ventas: «hoy» en hora de Costa Rica (rangos por defecto) |
| #227 | | `872c212` | 14:02 | textos del piloto: carteles (scripts + docs), mensajes en «usted». Conflicto de docs resuelto juntando líneas |
| #223 | | `e40ffd4` | 14:08 | spec de clics y embudo del Club (solo docs) |
| #229 | 181 | `3794d8d` | 23:37 | tope del socio por comida (almuerzo y cena, corte 16:00 CR) + alertas por comida y por días. Branching aplicó la 181; md5 finales = PASE §3. Rebase: solo ESTADO |
| #226 | 182 | `8112b90` | 23:43 | «Reservar una mesa» del portal para todo anfitrión. Branching aplicó la 182; `club_portal` = `1b716215…`. Rebase: solo docs y registro de migraciones |
| #225 | | `0e0d1bc` | 23:50 | «Tarjeta vieja» (nombre único, PROMO CLUB 10 % en el PoS, QR de caja). Rebase: solo docs; PDF de la guía rápida regenerado del HTML combinado |
| #230 | | `cfe5190` | 23:55 | docs del pase de Google Wallet |
| #234 | | `aaba8f9` | 17/11 01:39 | cola offline sin pérdidas (aviso de caja offline) |
| #236 | | `fedf54a` | 01:45 | guarda de privacidad con tope de tiempo |
| #237 | | `1c075ba` | 01:52 | club-web: token del pase fuera de la barra |
| #238 | | `3b3c730` | 01:58 | Bandeja: firmas de facturas de a poco |
| #239 | | `0def66a` | 02:03 | fechas en hora CR en Inventario y archivos |
| #244 | | `2c29918` | 02:12 | todas las pantallas de ventas leen del PoS (Resumen, P&L, Inventario). Sin conflicto con #239 |
| #233 | | `a699d17` | 02:21 | docs y scripts del pase del cron del Club (el pase se corrió a mano a las 02:15) |
| #247 | | `f3df931` | 02:57 | Mix sin filas repetidas (claves únicas). OK del dueño 02:53 |
| #240 | 183 | `51a765a` | 03:06 | contador de excepciones rápido. Branching aplicó la 183; núcleo `100caed1…`. Firma 02:53 |
| #250 | 184 | `c775b3d` | 03:10 | reporte de descuentos suma todas las líneas. Branching aplicó la 184. Firma 02:53 |

- **Pendiente del dueño / de la sesión:**
  - **Validación física pendiente del dueño (apertura del 17/11):** caja almuerzo/cena — segundo escaneo del mismo socio en la misma comida sale rojo con «almuerzo»/«desde las 16:00», la cena libre (#229) · «Tarjeta vieja» en Escanear y en el PoS (#225) · portal del anfitrión: «Reservar una mesa» con `ot_campaign=referente` (#226) · aviso de caja offline (#234) · Bandeja (#238) · Resumen / P&L / Inventario leyendo del PoS (#244) · cron del Club: confirmar la corrida de las 03:15 CR (`cron.job_run_details`, jobid 8). Si entra el #247: Mix, expandir GREENSEASON varias veces sin filas repetidas.
  - **No verificable desde la sesión:** `version.json` de Pages y `/api/salud` del Club (el proxy de la sesión responde 403/000); verificado por el run «Deploy to GitHub Pages», «Cloudflare Pages: satori-club» y «Workers Builds: satori-club-api» en success en cada merge.
  - **Validación física pendiente del dueño (#222):** esta noche después de las 18:00 en Ventas: Paridad, Por línea, Cajeros y Competencias.
  - **Decisiones firmadas el 16/11:** beneficio de almuerzo y cena (B, en construcción) · cumpleaños automático por Wallet (A, spec §13) ·
    spec de clics D1–D9 con las recomendaciones (firmado) · cartel por referente (B: el mismo cartel del hotel cambiando solo el QR; PR aparte
    después de clics) · privacidad D3 (A: nombres de empleados a la base, correos y cédula de Edge a secretos, montos en un PR chico) ·
    tarjeta vieja (artículo PROMO CLUB 10 %, nombre único «Tarjeta vieja», migración de «Reservar» para todo anfitrión).
  - **Mig 181 (tope del socio por comida, opción B firmada 16/11 13:36):** PR en borrador; aplicada en staging; prod espera la **firma del dueño sobre el SQL final** (PASE `docs/pases/PASE-181-club-tope-almuerzo-cena.md`). Corte = `club_config.turno_corte` (16:00 CR). Alertas por comida y por días (opción A, 14:51) en la misma 181. **Orden: la 181 entra antes que la 182 (#226).**
  - **Staging 16/11 ~13:50 CR: ledger 182** (181 `club_tope_almuerzo_cena` de otra rama; **182** `club_portal_reserva_anfitrion` del PR #226, aplicada con la batería 9/9 ANTES). **Prod sigue en 180.** La 182 espera la firma del dueño sobre el SQL final (`docs/pases/PASE-182-club-portal-reserva-anfitrion.md`); si entra antes que la 181, la 181 se renumera.
  - **Staging (16/11):** las 27 migraciones aplicaron sin error. Las baterías corridas DESPUÉS de aplicar (como se hizo) no son
    válidas para la mayoría: suponen la migración sin aplicar (casos «antes»/rollback) y varias piden un manager activo que staging
    no tiene. Pasaron 160, 161, 162, 164, 165, 166 (y 173 salvo el caso 18). Desde ahora: correr la batería ANTES de aplicar
    (base local de `scripts/sql/local_armar_base.sh`) y aplicar a staging antes del merge.
    **16/11 11:46:** el ASSERT de la 173 se tragaba su propio error (`exception when others`): arreglado en el PR
    `claude/bateria-173-y-manager-staging` (cada caso caído = WARNING + resumen «pasaron X / fallaron Y» + error); la
    173 contra una base local con ≤172: 20/20. Era la única batería con ese defecto (prueba estática
    `scripts/sql/baterias_assert.test.ts`). **Staging ya tiene un manager activo de prueba** (ficticio, Santa Teresa;
    `STAGING.md` «Manager de prueba», SQL idempotente `scripts/sql/staging_manager_prueba.sql`); su contraseña nadie la
    conoce: resetearla para usarlo en la app.
  - **Beneficio de cumpleaños:** prendido por el dueño (16/11).
  - **Links de Santa Teresa en Club → Locales (16/11):** ubicación (Maps), reseña de Google y reservas de OpenTable con origen
    «Club Satori», cargados. Nosara se completa cuando abra (decisión del dueño: no volver a preguntar; pensar todo multi-local).
  - **Validación física pendiente del dueño (#220):** 2 reservas de prueba (portal del socio → campaña `local`; cupón del turista → `turista`). La campaña `referente` queda lista sin punto de uso hasta el rebase del #117.
  - **Validación física:** #210, #213, #214, #215 y #216 ya validados por el dueño el 16/11 (incluidas la reserva por el
    widget y el QR de turista). **«Origen Club Satori en OpenTable»: CONFIRMADA por el dueño (16/11 12:15).** No queda validación física pendiente de estos PRs.
  - **5 columnas de Caja que existen en prod y en ninguna migración** (`cash_movements.amount_usd`,
    `cash_sessions.initial_cash_crc/_usd`, `final_cash_crc/_usd`): decidido (16/11 06:45, «177 firmo A») → **migración 178**
    (PR en borrador, sin efecto en prod; paquete `docs/pases/PASE-178-columnas-caja.md`). La **179** queda reservada para otra rama del 16/11.
  - **Triage de PRs/issues viejos (16/11):** cerrados #99, #65, #12, #84, #72, #30, #74, #95 y #68. **Vigente (de #30):** 2 cierres
    de Fase 1 nunca completados en prod (07/06 y 06/07).
  - **Wallet:** aviso de cumpleaños al Google Wallet con link de OpenTable (PR aparte, Edge `club-pase`).
  - **Edge `extract-document`:** staging v29 desde `190b5f5`; prod sigue en la versión de `8a8dfb6`; falta prueba funcional en staging.
- **Backlog (sin fecha):** el contador ve «Cohortes» · buscador de Escanear con socios · botón anfitrión → socio · fecha elegida en
  Bandeja · unificar la auditoría de la 161 y la 162 · SQL fijo de la 162 · `p_factura` tipeada por API sin ventana (174) · tarjeta del
  día 1 con factura del mes anterior cuenta en el mes nuevo (174) · `getEdadSocio` lee tabla directo (176) · retos de varios locales
  cuentan el total (176) · el botón de WhatsApp de cumpleaños marca «enviado» sin deshacer (173) · topes por IP del portal (232).
- **Local Club sigue en 15 %** hasta el lanzamiento del Club.
- **Regla de merges D1 vigente:** libre 23:30–15:50 · bloqueado 15:50–19:00 · 19:00–23:30 solo con OK del dueño.
- **Sagrados (hash de blob):** `tipCalculations.ts` **`7603ba5a`** · `cashUtils.ts` **`b597c697`** · `cierrePozo.ts` **`bf22ee44`** (referencia registrada el 16/11) (verificados en cada PR del 15/16-nov).
- **Gate de `main` (17/11 02:21, main + #233):** `vitest run` 2653 pasan / 4 skip · eslint **80** (tope 83) · club-web: 176 pruebas, build OK.
- **Refs Supabase:** **PROD = `yiczgdtirrkdvohdquzf`** (`satori-app`) · **STAGING = `hwiatgicyyqyezqwldia`** (`satori-staging`).

Documentos: fases → [ROADMAP.md](../../ROADMAP.md) · backlog → [PROMPT-CONTINUACION.md](../../PROMPT-CONTINUACION.md) ·
hallazgos → [HALLAZGOS.md](../../HALLAZGOS.md) · historial → [ESTADO-ARCHIVO.md](../../ESTADO-ARCHIVO.md) ·
pozo de caja → [PASE-POZO-A-PROD.md](../../PASE-POZO-A-PROD.md) · índice de SPECs → [docs/README.md](../../docs/README.md).

---

## 🛑 Reglas operativas (leer antes de tocar `main` o una base)

1. **Supabase Branching corre `migrate` contra PROD en cada push a `main`.** La integración de GitHub está atada
   a `main` (una sola rama, `main`, sin previews). El log del run lo dice explícito
   (`Connecting to database... All migrations are up to date.`). **Desde la 085, las migraciones entran por
   merge → Supabase Branching**: el PR con el `.sql` se mergea y Branching corre `migrate` contra prod (así
   entraron 085 y 089–095). **Lo de «a mano antes del merge» es histórico** (Management API, una
   transacción con el archivo exacto + su fila en `supabase_migrations.schema_migrations`): así entraron 062–077
   y la 081–082 del puente. Sigue valiendo solo si el dueño lo firma como excepción, y antes se verifica
   el ref de la base.
2. **Ningún PR a `main` con archivos bajo `supabase/functions/` hasta cerrar el ítem 11** (versionar
   `ingest-ndf` con `config.toml`). Sin `config.toml`, Branching despliega las funciones que cambian con
   `verify_jwt=true`, y el agente del PoS solo manda `x-ingest-secret` → 401 en cada ciclo.
   **Ojo:** `supabase/functions/monthly-report/` de `main` es el código **anterior a SEC-02** (sin chequeo de
   service_role/owner). El ítem 11 tiene que traer el código de la **v10** (y el de `alta-empleado`, que vive en
   `claude/alta-empleado-fn`) **antes** de que Branching despliegue funciones; si no, pisaría la v10 de prod.
   **Ojo (12/11):** lo mismo con `extract-document`. El código desplegado en prod (v9 del 12/11, `8a8dfb6`, rama
   `claude/busy-brown-ssjq4e`) **no está en `main`**: `main` tiene el código anterior, que lee `content[0].text` y con
   `claude-sonnet-5-5` (el modelo de prod desde el 12/11) devuelve la Bandeja vacía sin error. El ítem 11 tiene que
   traer `8a8dfb6` **antes** de que Branching despliegue funciones; si no, un despliegue desde `main` pisaría prod con
   el código viejo y la lectura de facturas dejaría de funcionar.
   **`club-pase` (Google Wallet, 12-nov):** cuando entre a `main` con el ítem 11, el `config.toml` tiene que declararla
   con **`verify_jwt = false`**. club-web (Pages y el Worker) la llama solo con `apikey` y el portón es `x-club-web`: con
   `verify_jwt = true`, «Agregar a Google Wallet» y «Actualizar mi pase» responden 401. Hasta el ítem 11 su código vive
   en la rama `claude/club-pase-edge` y se despliega a mano (`docs/club-satori/WALLET-GOOGLE-ACTIVACION.md`).
3. **Regla de merges D1 (decidida por el dueño el 13/11, hora de Costa Rica):** libre de 23:30 a 15:50 ·
   bloqueado de 15:50 a 19:00 (cierre de caja de la mañana y preparación del servicio) · de 19:00 a 23:30 solo
   con OK explícito del dueño en el momento. Una sola sesión de CC mergea a `main` a la vez, cada una
   solo sus PRs, y con el OK del dueño.
4. **«Ver como» usa los permisos del owner.** Sirve para ver lo que ve otro empleado, no para probar permisos:
   **los permisos se prueban con un usuario real de ese rol** (o simulando su JWT en una transacción
   `read only` + `rollback`).
5. **ICP = propina electrónica declarada (solo la voluntaria del cliente: tarjeta/SINPE) / neta de sus mesas.**
   El 10 % de servicio es un impuesto aparte: **no entra** ni al numerador ni al denominador. Lo cobrado del
   reparto del pool (`payout_crc`) no es ICP. Barra (barman/barback): «no aplica».
6. **La lectura del PoS para cualquier rol va por las funciones de la 067** (`pos_ventas_tickets_rango`,
   `pos_ventas_lineas`, `pos_ventas_latido`), **sin medios de pago ni `clase_ingreso`**. **Las tablas
   `pos_ndf_*` quedan cerradas a gerencia** (`owner/manager/contador`); no se les abre una policy.
   Excepción vigente y legítima: «En vivo» (solo gerencia) todavía lee las tablas directo
   (`getTicketsJornada`, `getTicketsDeJornadas`, `getMesasAbiertas`, `getUltimoPollPoS`,
   `getPedidosCerradosJornada`).
7. **Ritual antes de cualquier comando de base:** confirmar el *ref* del proyecto (`yiczgdti…` = PROD,
   `hwiatgic…` = staging). Nunca correr SQL de escritura sin haber leído el ref.
8. **Sagrados por hash de blob, no por `git diff`** (ver arriba). Nunca reimplementarlos sin acuerdo explícito.
9. **Verificar un deploy por contenido, no por HTTP 200:** el fallback del SPA devuelve `index.html` para
   cualquier ruta.
10. **Nunca revertir (ni borrar) el `.sql` de una migración que ya está en el ledger de prod.** Si se revierte el
    código de un PR, el archivo de su migración se queda en `supabase/migrations/`; si no, Branching falla en cada
    push a `main` (pasó con la 074 entre el 05 y el 06/11).
11. **La fecha del movimiento de caja es el día en que se registró (el turno), nunca la fecha de la factura** (regla del
    dueño, 14/11). La fecha de la factura es un dato aparte (va a la descripción, «· fact AAAA-MM-DD»): los proveedores
    suelen facturar el día del pedido y entregar 1–3 días después. La fecha de factura se analiza por calendario
    (`src/shared/utils/fechaFactura.ts`): la clave FE manda; sin clave, de las dos lecturas día/mes se toma la única
    posible (no futura, ≤ 60 días) y, si las dos lo son, la pantalla pregunta y no deja guardar hasta elegir; una
    factura de más de 7 días avisa «Factura de hace X días: revisá la fecha.» (no bloquea).
12. **Bitácora de permisos (165, B10) caída = no se cambian roles ni activaciones (fail closed, decisión del dueño
    14/11).** Si hay que cortarle el acceso a alguien igual: (1) ban o cambio de clave en Supabase Auth (no pasa por
    `profiles`); (2) si además hay que desactivarla, soporte, como dueño de la tabla y en UNA transacción:
    `alter table public.profiles disable trigger trg_profiles_bitacora_permisos;` →
    `update public.profiles set is_active = false where id = '<UUID>';` →
    `alter table public.profiles enable trigger trg_profiles_bitacora_permisos;`; (3) anotarlo a mano con
    `origen = 'manual'` y la hora real cuando la bitácora vuelva. SQL completo y pasos: guía 6.6, «Urgencia».
    Vale solo después del merge del PR de la 165.

---

## 🔁 El camino de las ventas: PoS → app

```
PoS «Nube de Fuego» (SQL Server, PC del PoS)
   │  lee FAC_* (read-only)
   ▼
agente pos-bridge (tarea programada de Windows; dos instancias, una por entorno)
   │  POST + x-ingest-secret
   ▼
Edge Function ingest-ndf (verify_jwt = false; service-role)  ──►  escribe
   ▼
pos_ndf_tickets · pos_ndf_ticket_lines · pos_ndf_open · pos_ndf_cursor   (RLS: solo gerencia; sin policies de escritura)
   │
   ├──► funciones 067 (SECURITY DEFINER, rol chequeado adentro, sin medios de pago)
   │        pos_ventas_tickets_rango · pos_ventas_lineas · pos_ventas_latido
   │        ▼
   │     app: ventasFuente.cargarDias / cargarDiasEager / cargarDeFondo / ventasDelRango (SOLO PoS)
   │          → Ventas · Mi Rendimiento · Resumen · Semana · Reporte mensual · Inicio · Inventario · Finanzas
   │          → si el PoS no se puede leer: estadoPos ≠ 'ok' + franja, sin ventas (no hay respaldo)
   │
   └──► lectura directa (solo gerencia): «En vivo» (mesas abiertas, jornada, latido del agente)
```

- **Tickets en prod:** 40.549 (2024-01-06 → 2026-10-30). En staging: 40.781.
- **Día del reporte** = fecha CR de `fecha_registra` (el mismo corte que el reporte del PoS). «En vivo» y los
  turnos siguen usando la jornada por lote de cierre.
- **Todo del PoS (decisión firmada del dueño, 16/11 22:20):** ninguna pantalla lee `ventas_dias` (xls; último día
  cargado en prod: 20/10). «Cargar XLS» y Paridad retiradas de la interfaz (PR `claude/ventas-desde-pos`); las tablas
  quedan como histórico. **Corte:** `ventas_hist` solo antes del **2024-01-05** (primer día del PoS, leído de prod);
  desde ahí, solo PoS. Guarda: `src/ventasSoloPos.test.ts`. La Edge `monthly-report` pasa al PoS en su propio PR.

### Agentes en las PCs

| Agente | PC | Carpeta / versión | Publica a | Latido 30/10 |
|---|---|---|---|---|
| «Satori PoS Bridge» | PC del PoS | carpeta de staging @ `14bd278` ¹ | staging · `ingest-ndf` v10 | `last_poll_at` 18:13 UTC, `last_error` null |
| «Satori PoS Bridge PROD» | PC del PoS | carpeta de prod nueva @ **`5da233a`** (pase del agente nuevo, 10/11 23:37:18 -06:00, cerrado el 11/11; la tarea corre el `.cmd` nuevo con la cuenta SYSTEM). La carpeta de prod vieja (@ `4d3513a`) y el `.cmd` viejo se quedan 7 días como vuelta atrás. Los nombres y las rutas, en el registro privado del dueño | **prod** · `ingest-ndf` **v3** (09/11) | `last_poll_at` 18:12 UTC, `last_error` null |
| `biotime-bridge` | PC del reloj (ST) | — | staging · `ingest-punches` v6 | ⚠️ **última sync 14/09 17:12 UTC** (22.969 marcas): parado desde entonces |

¹ Versión según el backlog del 29/10 (no verificable desde fuera de la PC). Las dos tareas del PoS arrancan
solas tras un reinicio (validado el 29/10).

### Edge Functions (Management API, 12/11)

«on» / «off» = `verify_jwt`. Cambiar un secreto de Edge **puede o no** subir la versión de las funciones (el 13/11 se
cargaron secretos en prod y ninguna cambió de versión): la versión no prueba nada. Para confirmar un secreto, mirar la lista
de secretos (nombre + huella); para saber si cambió el código, el hash (`ezbr_sha256`) y la fecha de actualización.

| Función | PROD | STAGING |
|---|---|---|
| `monthly-report` | **v12 · on** (código de la v10 del 06/11, SEC-02; a mano, código en `claude/sec-02-monthly-report-fn`) | v9 · on |
| `extract-document` | **v10 · on** (código de la v9 del 12/11 15:32 CR, desde `8a8dfb6`, hash `2f88ef52…`; `ANTHROPIC_MODEL` = `claude-sonnet-5-5` desde las 16:19 CR) | v23 · on (código de la v21 del 12/11 14:07 CR, desde `8a8dfb6`, hash `67095c19…`; 5.5) |
| `cierre-email` | v4 · on | v15 · on |
| `pago-notificar` | v4 · on | — |
| `ingest-ndf` | **v4 · off** (código de la v3 del 09/11, pase del puente, desde `5da233a` con `--use-api`; su código vive en `claude/puente-item11-prod-v2`, no en `main`) | v21 · off |
| `ingest-punches` | — | v13 · off |
| `alta-empleado` | v3 · on (código de la v1 del 06/11, a mano; código en `claude/alta-empleado-fn`, no en `main`) | v8 · on |
| `club-pase` | **v6 · off** (15/11 de madrugada, a mano desde `claude/club-pase-edge` @ `6c5848e`: pase del equipo con «Personas registradas» y avance de 90 días del socio) | v1 · off (12/11, desde `c6b54fc`, rama `claude/club-pase-edge`; `WALLET_ENTORNO` = `stg`) |

Leídas el 12/11 a la noche (solo lectura). En staging, los cambios de secretos del 12/11 (evaluación del modelo y `club-pase`) subieron las versiones sin tocar el código.

---

## 🗃️ Migraciones

### Numeración de migraciones (regla del dueño, 08/11)

> **Fuente de verdad:** `supabase/migraciones-reservadas.json`, que lee el test del gate
> `supabase/migraciones.test.ts`. Esta tabla lo repite para leerlo rápido; el test exige que coincidan.

**Reglas**
1. **Bloques por rama:**
   - **CAJA / operación: 087–99** (caja, Salarios, PoS propio, seguridad de la app);
   - **CLUB SATORI + puente: 100–149**;
   - **PASE A PROD: 150–199**, que no es de creación: solo recibe renumeraciones del pase (regla 3).

   La **086** queda libre, fuera de bloque. Si un bloque se acaba, se le asigna uno nuevo **en esta tabla y
   en el registro antes de usarlo**.
2. **Cada PR que agrega una migración actualiza esta tabla y el registro** (`asignadas`, con el siguiente
   número libre de su bloque). El gate falla si una migración nueva no está registrada, si queda fuera del
   bloque de su rama o si repite un número.
3. **Pase a prod:** ninguna migración entra a prod con número **≤ al último del ledger de prod**. Si pasa,
   se renombra al **siguiente libre del bloque de PASE (150–199)**, nunca dentro de un bloque de creación
   (ahí chocaría con números reservados que todavía no se desplegaron; ajuste del dueño tras la auditoría,
   hallazgo 97). Va en el mismo PR del pase: archivo, rollback, pruebas, scripts y la fila del ledger de
   staging. En el registro se anota con bloque `pase` y su `origen` (ej. `083 → 150`); el gate lo exige.
   (Branching rechaza una versión menor que la última aplicada: por eso la 078 de Prom/PAX pasó a 080.)
4. Un número usado no se reutiliza aunque la rama se abandone. Las versiones son **texto**, como en el
   ledger: `0090` y `0095` son históricas y distintas de una futura `090` / `095`.

**Orden del pase a prod** (prod va hasta la **151** desde el 11/11): **085 ✅ → 089 ✅ → 090 ✅ → 091 ✅ → 092–095 ✅ (tanda, un merge) → Club ✅ (075 como 150 y 100 como 151, 11/11) → sigue el bloque 152+.**
1. ~~**081 → 082** (puente) primero, con su número.~~ **Hecho el 09/11** (pase del puente).
2. ~~Después la **085** (SEC-01c), con su número: queda arriba de la 082.~~ **Hecho el 10/11** (#80, `bb12652`).
3. Las que queden atrás (≤ al último de prod en su momento) toman **150+**, en el orden en que pasen:
   **150 ← 075 y 151 ← 100** (pase del Club, `docs/pases/PASE-150-151-club.md`); la **083**, la **084**, la 087 y la 088
   (y cualquier migración de caja posterior al Club) toman **152+** cuando se arme su paquete.
4. **Hecho el 10/11:** la **089** (#90, `fa1cbef`), la **090** (#97, `7543347`), la **091** (#103, `b8cb74d`) y la tanda
   **092–095** (#107, `c41e18b`). Detalle en el §9 de cada PASE (`docs/pases/`).
5. **Hecho el 11/11:** el Club (#59, `17a9efd`), la 075 como **150** y la 100 como **151**. La MAINTAIN de `authenticated` va después de abrir el
   Club, en el bloque 152+ (decisión del dueño).

**Ya usados (antes de los bloques)**

| Número | Nombre | De | Rama | Dónde está aplicada |
|---|---|---|---|---|
| 075 | `club_satori_esquema` | Club | `claude/brave-brown-m45jd7` y ramas del Club | **Renumerada a 150** en el pase del Club (`claude/pase-club`, 10-nov; regla 3). En staging la fila ya es la 150 |
| 078 | — | — | — | **No usar** (fue Prom/PAX, renumerada a 080) |
| 080 | `pos_prompax_agregado` | Prom/PAX | `main` (#58) | staging y prod (último de prod al 08/11) |
| 081 | `pos_ndf_campos_factura` | puente (Club) | `main` (#71, 09/11) | staging y **prod** (09/11 10:57 -06:00, a mano en el pase del puente) |
| 082 | `pos_ndf_ingesta_transaccional` (v3) | puente (Club) | `main` (#71, 09/11) | staging (v3, 09/11 01:43) y **prod** (v3, 09/11 ~12:00 -06:00, a mano en el pase del puente) |
| 083 | `my_turno_stats_higiene` | caja | `claude/higiene-r5` | staging (08/11). Va a prod con el PoS propio; ahí toma 150+ (regla 3) |
| 084 | `employee_payroll` (SAL-AUD-01, paso 1) | caja | `claude/salarios-rls` | staging (08/11). Va a prod con Salarios; ahí toma 150+ (regla 3) |
| 085 | `rls_lectura_rol_activo` (SEC-01c) | caja | `main` (#80, 10/11) | staging (08/11) y **prod** (10/11 08:24:48 -06:00, Branching al mergear el #80, `bb12652`) |
| 087 | `employee_edits_audit` (propuesta, sin firma) — **no se usa con este número: cuando esté lista va al bloque de pase (152+) con origen 087** (dueño, 10/11) | caja | `claude/employees-audit` | ninguna: propuesta |
| 088 | `employees_recibe_reparto_cocina` (PROP-AUD-01, sin firma) — **no se usa con este número: cuando esté lista va al bloque de pase (152+) con origen 088** (dueño, 10/11) | caja | `claude/prop-aud-01` | ninguna |
| 089 | `anon_sin_politica` | caja | `main` (#90, 10/11) | staging (09/11 08:27 CR) y **prod** (10/11 10:22:11 -06:00, Branching al mergear el #90, `fa1cbef`, 3 statements) |
| 090 | `anon_privilegios_por_defecto` | caja | `main` (#97, 10/11) | staging (09/11 08:28 CR) y **prod** (10/11 11:33:38 -06:00, Branching al mergear el #97, `7543347`, 4 statements) |
| 091 | `multilocal_fase0` | caja | `main` (#103, 10/11) | staging (10/11 11:02 CR) y **prod** (10/11 22:44:57 -06:00, Branching al mergear el #103, `b8cb74d`, 31 statements) |
| 092 | `employees_borrado_solo_owner` | caja | `main` (#107, tanda 092–095, 10/11) | staging (10/11 11:03 CR) y **prod** (10/11 22:57:17 -06:00, Branching al mergear el #107, `c41e18b`, 12 statements) |
| 093 | `ventas_lectura_rol_activo` | caja | `main` (#107, tanda 092–095, 10/11) | staging (10/11 11:03 CR) y **prod** (10/11 22:57:17 -06:00, Branching al mergear el #107, `c41e18b`, 7 statements) |
| 094 | `anon_sin_maintain` | caja | `main` (#107, tanda 092–095, 10/11) | staging (10/11 11:03 CR) y **prod** (10/11 22:57:17 -06:00, Branching al mergear el #107, `c41e18b`, 3 statements) |
| 095 | `contador_lee_caja` | caja | `main` (#107, tanda 092–095, 10/11) | staging (10/11 11:03 CR) y **prod** (10/11 22:57:17 -06:00, Branching al mergear el #107, `c41e18b`, 9 statements) |

**Bloques**

| Bloque | Rango | Asignadas | Próximo libre |
|---|---|---|---|
| CAJA / operación | 087–99 | 087, 088, 089, 090, 091, 092, 093, 094, 095, 096, 097 (→ 177), 098 (→ 178) | **099** |
| CLUB SATORI + puente | 100–149 | 100 (`club_catalogo_locales`; renumerada a 151 en el pase) · 101 (`club_aviso_v1_2`, #140; renumerada a 159) · 102 (`club_tope_sin_carga_inicial`; renumerada a 155) · 103 (`club_alta_caja_link_portal`; renumerada a 156) · 104 (→ 157) · 105 (→ 158) | **106** |
| PASE A PROD (solo renumeraciones) | 150–199 | 150 (← 075), 151 (← 100): pase del Club, rama `claude/pase-club` · 153 (← 096): `claude/alias-proveedor-rpc` · 155 (← 102): `claude/club-tope-sin-carga-inicial` (en prod desde el merge del #168) · 156 (← 103): `claude/club-link-portal-cajero` · 157 (← 104): `claude/club-equipo-sin-creditos` · 158 (← 105): `claude/club-resena-cupon` (#174/#176/#177, en prod desde el 14/11) · 159 (← 101): `claude/club-aviso-v1.2` (#140, en prod desde el 15/11) | **160** (la 152 y la 154 no se usan: prod ya pasó la 153) |
| (fuera de bloque) | 086 | — | libre |

**Asignadas en los bloques**

| Número | Nombre | Bloque | Rama | Dónde está aplicada |
|---|---|---|---|---|
| 096 | `proveedor_agregar_alias` (RPC atómica para el alias del proveedor; sin firma) | caja | `claude/alias-proveedor-rpc` | **renumerada a 153** en el mismo PR (13-nov; regla 3: prod va por la 151). El número 096 no se reutiliza (regla 4) |
| 097 | `esquema_centimos_como_prod` | caja | `claude/esquema-centimos-alinear` | **renumerada a 177** en el mismo PR (15-nov; regla 3: prod va por la 173). El número 097 no se reutiliza (regla 4) |
| 098 | `esquema_columnas_caja_como_prod` | caja | `claude/esquema-columnas-caja-faltantes` | **renumerada a 178** en el mismo PR (16-nov; regla 3: prod va por la 177). El número 098 no se reutiliza (regla 4) |
| 100 | `club_catalogo_locales` | club | `claude/club-100-catalogo` | **renumerada a 151** en el pase del Club (`claude/pase-club`, 10-nov). El número 100 no se reutiliza (regla 4) |
| 101 | `club_aviso_v1_2` (aviso v1.2 + D6 A) | club | `claude/club-aviso-v1.2` | **renumerada a 159** en el mismo PR (#140; 12-nov como 152, 14-nov a 159: prod va por la 155 y 156–158 son de otros PRs). El número 101 no se reutiliza (regla 4) |
| 102 | `club_tope_sin_carga_inicial` (D5 A del dueño: ANFITRION_SOBRE_TOPE sin la carga inicial) | club | `claude/club-tope-sin-carga-inicial` | **renumerada a 155** en el mismo PR (14-nov; regla 3: prod va por la 153). El número 102 no se reutiliza (regla 4) |
| 103 | `club_alta_caja_link_portal` (firma del dueño 14-nov 06:04: el cajero manda el link del portal al socio que acaba de dar de alta) | club | `claude/club-link-portal-cajero` | **renumerada a 156** en el mismo PR (14-nov; regla 3: prod va por la 155). El número 103 no se reutiliza (regla 4) |
| 104 | `club_equipo_sin_creditos` (D7 A + saldos A, firma del dueño 14-nov: el equipo no canjea, no vence ni cuenta en el pasivo; saldos congelados) | club | `claude/club-equipo-sin-creditos` | **renumerada a 157** en el mismo PR (14-nov; regla 3: prod va por la 155 y la 156 es del #174). El número 104 no se reutiliza (regla 4) |
| 105 | `club_resena_cupon` (ítem #13 de la spec del Club v2: reseña de Google tras el cupón; firma del dueño 14-nov) | club | `claude/club-resena-cupon` | **renumerada a 158** en el mismo PR (14-nov; regla 3: prod va por la 155; la 156 es del #174 y la 157 queda para D7). El número 105 no se reutiliza (regla 4) |
| 106 | `club_tablero_plata` (SPEC Club v2 ítems 3–5, Fase 1B: tablero «¿El Club deja plata?», pasivo de créditos, contador lee) | club | `claude/club-tablero-plata` | **renumerada a 160** en el mismo PR (14-nov; regla 3: prod va por la 155; 156–159 son de otros PRs). El número 106 no se reutiliza (regla 4) |
| 107 | `club_cohortes_ranking` (SPEC Club v2 ítems 6 y 7, Fase 1C: cohortes del Local Club y ranking de socios por consumo) | club | `claude/club-cohortes-ranking` | **renumerada a 161** en el mismo PR (14-nov; regla 3: prod va por la 155; 156–160 son de otros PRs). El número 107 no se reutiliza (regla 4) |
| 108 | `club_embudo_anfitrion` (SPEC Club v2 ítem 8, Fase 1D: embudo del anfitrión) | club | `claude/club-embudo-anfitrion` | **renumerada a 162** en el mismo PR (14-nov; regla 3: prod va por la 155; 156–161 son de otros PRs). El número 108 no se reutiliza (regla 4) |
| 109 | `club_edad_validar_reactivar` (D6 A, 2.ª parte: «Validar socio» y la reactivación piden «es mayor de 18» si falta) | club | `claude/club-edad-validar` | **renumerada a 163** en el mismo PR (14-nov; regla 3: prod va por la 155; 156–162 son de otros PRs). El número 109 no se reutiliza (regla 4) |
| 110 | `club_alertas_umbral` (SPEC-club-v2 ítem 10, alertas con umbral del Inicio) | club | `claude/club-alertas-umbral` | **renumerada a 164** en el mismo PR (14-nov; regla 3; número asignado por el coordinador). El número 110 no se reutiliza (regla 4) |
| 111 | `admin_bitacora_permisos` (B10: bitácora de permisos de Admin, solo inserción) | club | `claude/admin-bitacora-permisos` | **renumerada a 165** en el mismo PR (14-nov; número asignado por el coordinador, regla 3). El número 111 no se reutiliza (regla 4) |
| 112 | `club_grupo_control` (SPEC Club v2 ítem 12, B8, Fase 2D: campañas con grupo de control) | club | `claude/club-grupo-control` | **renumerada a 166** en el mismo PR (14-nov; regla 3: prod va por la 155; 156–165 son de otros PRs). El número 112 no se reutiliza (regla 4) |
| 113 | `club_resena_socios` (ítem #14 de la spec del Club v2: reseña de Google a socios cada N visitas; decisión 3 del dueño, 14-nov) | club | `claude/club-resena-socios` | **renumerada a 167** en el mismo PR (14-nov; regla 3: prod va por la 155; 156–166 asignadas a otros PRs del Club). El número 113 no se reutiliza (regla 4) |
| 114 | `club_primeros_90` (ítem #15 del Club v2: primeros 90 días y cortesía especial; **toca plata**) | club | `claude/club-primeros-90` | **renumerada a 168** en el mismo PR (14-nov; regla 3: prod va por la 155). El número 114 no se reutiliza (regla 4) |
| 115 | `club_retos` (ítem #16 del Club v2: retos de temporada baja; **toca plata**) | club | `claude/club-retos` | **renumerada a 169** en el mismo PR (14-nov; regla 3: prod va por la 155). El número 115 no se reutiliza (regla 4) |
| 116 | `club_local_manager` (seguridad: el manager solo ve y opera el Club en sus locales) | club | `claude/club-local-manager` | **renumerada a 170** en el mismo PR (14-nov; regla 3: prod va por la 155; 156–169 son de otros PRs). El número 116 no se reutiliza (regla 4) |
| 117 | `club_miembro_guardar_reune_156_157` (HOTFIX 14-nov: la 157 pisó lo de la 156 en `club_miembro_guardar`) | club | `claude/hotfix-miembro-guardar` | **renumerada a 171** en el mismo PR (14-nov; regla 3: entra después de la 158–170). El número 117 no se reutiliza (regla 4) |
| 118 | `club_local_manager_2` (seguridad, hallazgo 231: el manager solo en sus locales, segunda tanda) | club | `claude/club-local-manager-2` | **renumerada a 172** en el mismo PR (15-nov; regla 3: prod va por la 171). El número 118 no se reutiliza (regla 4) |
| 119 | `club_cumple_caja_portal_beneficio` (D-cumple-1 A + D-cumple-2, 15-nov: cumpleaños en el alta en caja y en el portal una vez; beneficio configurable; aviso v1.3) | club | `claude/club-cumple-promo` | **renumerada a 173** en el mismo PR (15-nov; regla 3: prod va por la 171; la 118/172 es del #202). El número 119 no se reutiliza (regla 4) |
| 120 | `club_facturas_dia_busqueda` (plan B de Escanear: facturas cobradas hoy + búsqueda por tiquete de 3 días; decisión del dueño, 15-nov, opción A) | club | `claude/club-facturas-dia-busqueda` | **renumerada a 174** en el mismo PR (15-nov; regla 3: va DESPUÉS de la 172 (#202) y la 173 (#203), ya en prod). El número 120 no se reutiliza (regla 4) |
| 121 | `club_cumple_uso_anual` (decisión del dueño 15-nov 21:49: beneficio de cumpleaños una vez por año por socio, lo marca la caja) | club | `claude/club-cumple-uso-anual` | **renumerada a 175** en el mismo PR (15-nov; regla 3: va después de la 173 y de la 174; 176 y 177 son de otros PRs). El número 121 no se reutiliza (regla 4) |
| 122 | `club_local_manager_listas` (el manager ve en las listas del Club solo sus locales; decisión del dueño 15-nov) | club | `claude/club-local-manager-3` | **renumerada a 176** en el mismo PR (15-nov; regla 3: va después de la 172–175; 174 y 175 reservadas para otras ramas). El número 122 no se reutiliza (regla 4) |
| 124 | `club_portal_reserva_local` («Reservar» del portal del socio abre el OpenTable de SU local; decisión del dueño 16-nov, opción A) | club | `claude/club-portal-reserva-local` | **renumerada a 179** en el mismo PR (16-nov; regla 3: va después de la 177 y de la 178 de otra rama del 16-nov). La 178 es de otra rama (origen caja 098); el 124 no se reutiliza (regla 4) |
| 125 | `club_reserva_url_por_local` (el link de reservas de OpenTable es de CADA LOCAL, en Club → Locales, y la página del cupón muestra «Reservar una mesa»; pedido del dueño 16-nov 08:02) | club | `claude/club-link-reserva-local` | **renumerada a 180** en el mismo PR (16-nov; regla 3: va después de la 179, ya en prod). El 125 no se reutiliza (regla 4) |
| 126 | `club_tope_almuerzo_cena` (firma del dueño 16-nov 13:36, opción B: el tope del socio pasa de una visita con beneficio por día a una en el almuerzo y una en la cena, en cualquier Satori) | club | `claude/club-tope-almuerzo-cena` | **renumerada a 181** en el mismo PR (16-nov; regla 3: prod va por la 180). El 126 no se reutiliza (regla 4) |
| 127 | `club_portal_reserva_anfitrion` («Reservar una mesa» en el portal para TODO anfitrión, no solo si también es socio; decisión del dueño 16-nov 13:38) | club | `claude/club-portal-link-v2` | **renumerada a 182** en el mismo PR (16-nov; regla 3: va después de la 180, ya en prod; la **181** la tomó otra rama del 16-nov, `club_tope_almuerzo_cena`, ya en el ledger de staging; el **126** se deja libre por si esa rama lo usa como origen). El 127 no se reutiliza (regla 4) |
| 128 | `club_excepciones_rapida` (el contador de excepciones del Inicio tardaba hasta 9,3 s; firma del dueño 16-nov 21:40) | club | `claude/club-excepciones-abiertas-rapida` | **renumerada a 183** en el mismo PR (16-nov; regla 3: va después de la 181 y la 182, que entran a prod el 16/11 23:31; la 126 y la 127 son sus orígenes). El 128 no se reutiliza (regla 4) |
| 129 | `club_descuentos_todas_lineas` (el reporte de descuentos del Club suma TODAS las líneas sin respaldo de cada factura, cada una con su clasificación; firma del dueño 17-nov 02:13, opción A) | club | `claude/club-descuentos-todas-lineas` | **renumerada a 184** en el mismo PR (17-nov; regla 3: va después de la 183, que exige). El 129 no se reutiliza (regla 4) |
| 150 | `club_satori_esquema` | pase (origen **075**) | `claude/pase-club` | staging (desde el 10/11 con la fila **150**: la 075 se renumeró con el texto del archivo). Prod: con el merge del pase del Club (Branching), después de la 091–093. Paquete: `docs/pases/PASE-150-151-club.md` · **En prod desde el 11/11 23:22:08 -06:00** (merge del #59, `17a9efd`; pase cerrado, local apagado) |
| 151 | `club_catalogo_locales` | pase (origen **100**) | `claude/pase-club` | staging (10/11, con su fila). Prod: en el mismo merge, justo después de la 150; necesita la 091 en prod. Paquete: `docs/pases/PASE-150-151-club.md` · **En prod desde el 11/11 23:22:08 -06:00** (merge del #59, `17a9efd`; pase cerrado, local apagado) |
| 153 | `proveedor_agregar_alias` | pase (origen **096**) | `claude/alias-proveedor-rpc` | **Aplicada en prod** (verificado 15/11 06:50 CR: ledger y función `proveedor_agregar_alias` presentes). RPC `proveedor_agregar_alias` (SECURITY INVOKER) para que dos cajas no se pisen los alias. (El #140 pasó de la 152 a la **159**.) Rollback: `scripts/sql/153_rollback.sql` |
| 155 | `club_tope_sin_carga_inicial` | pase (origen **102**) | `claude/club-tope-sin-carga-inicial` | **En prod desde el 14/11 00:48 -06:00** (merge del #168, `dac805d`, vía Branching). `create or replace` de `club_excepciones`: ANFITRION_SOBRE_TOPE no cuenta `club_movimientos.origen = 'migracion'` (la carga inicial del 12/11), como el reporte del mes. Prueba en staging en transacción descartada: 9/9. Rollback: `scripts/sql/155_rollback.sql` |
| 156 | `club_alta_caja_link_portal` | pase (origen **103**) | `claude/club-link-portal-cajero` | **Aplicada en prod el 14/11 22:19 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera OK; vía merge → Branching). `create or replace` de `club_socio_alta_caja`: devuelve `token_portal` solo si esa alta creó a la persona (número que no era de nadie), y lo audita como `ver_link_portal`. `club_miembro_token` sigue solo owner/manager. Además (verificador, 14/11) `club_rol_activar_anfitrion` regenera `token_portal` al activar a un socio como anfitrión (el link del alta deja de servir para canjes), y `club_miembro_guardar` hace lo mismo al pasar un socio a anfitrión desde «Editar» (y acepta editar a un socio como socio, sin reactivarlo si está de baja: LC-DES-01). Prueba en staging en transacción descartada: 20/20; mutaciones muerden. Rollback: `scripts/sql/156_rollback.sql` |
| 157 | `club_equipo_sin_creditos` | pase (origen **104**) | `claude/club-equipo-sin-creditos` | **Aplicada en prod el 14/11 22:33 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera OK y verificador independiente; vía merge → Branching). D7 A: guarda del equipo en `club_canje_codigo_generar` y `club_canje_aplicar`; `club_saldo_canjeable` / `club_corte_equipo` (saldo congelado que no revive, foto en `club_auditoria`); portal, pase, ficha de caja, vencimiento, reporte del mes, baja (`club_miembro_guardar`), `club_ajuste` y `club_alertas_pendientes` con lo canjeable; `club_reporte_equipo` (ranking). Pruebas: `scripts/sql/157_pruebas.sql` (batería + 13 mutaciones en una transacción descartada; **pendiente de correr en staging**). Rollback: `scripts/sql/157_rollback.sql` |
| 158 | `club_resena_cupon` | pase (origen **105**) | `claude/club-resena-cupon` | **Aplicada en prod el 14/11 23:35 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera OK). Columnas `club_config.resena_url` (CHECK: solo direcciones de Google) y `club_cupones.resena_clic_en`; `club_cupon_ver` devuelve `resena` solo con el cupón usado hace < 7 días; función pública nueva `club_cupon_resena_clic`. Prueba en staging en transacción descartada: 16/16; el caso 15 (rollback limpia todo, también el historial de `resena_url`) queda pendiente con el dueño (el conector cancela los `drop`). Rollback: `scripts/sql/158_rollback.sql` |
| 159 | `club_aviso_v1_2` | pase (origen **101**) | `claude/club-aviso-v1.2` | **Aplicada en prod el 15/11 01:15 -06:00** (merge → Branching; era: 14/11: #140 en borrador, espera firma). Aviso del Club v1.2 («usted» + edad + cumpleaños) y **D6 A**: `mayor_edad_en` en `club_miembro_roles` (trigger diferido: alta de socio por caja o autoalta sin él → rechazada), cumpleaños día/mes con permiso en `club_miembros_contacto` (guardia: solo en el alta, por el dueño real de la autoalta; después solo el owner; se borra con la baja o al eliminar el rol), autoalta con edad y cumpleaños, `club_socio_alta_caja_v2` (la de 5 argumentos queda interna). Entra en el MISMO merge que club-web y la app. Pruebas: `scripts/sql/159_pruebas.sql` (22 casos; local 22/22 con funciones de `postgres` y de otro dueño, con y sin la 156; 12/12 mutaciones; staging pendiente con el dueño). Rollback: `scripts/sql/159_rollback.sql` |
| 160 | `club_tablero_plata` | pase (origen **106**) | `claude/club-tablero-plata` | **Aplicada en prod el 15/11 01:20 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera firma). Columna `club_config.cortesia_costo_pct` (default 35, 0–100; la edita el owner, queda en `club_config_historial`) y función `club_tablero_mes(date, text)` (SECURITY DEFINER, owner/manager/contador activos + `puede_ver_local`; solo totales; rastro en `club_auditoria`). Funciona con y sin la 157 (D7). Batería en Postgres 16 local en transacción descartada: 32/32, 15/15 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/160_rollback.sql` |
| 161 | `club_cohortes_ranking` | pase (origen **107**) | `claude/club-cohortes-ranking` | **Aplicada en prod el 15/11 01:24 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera firma). Sin tablas ni columnas: funciones `club_cohortes_socios(text, uuid)` (owner/manager/contador activos; solo conteos) y `club_ranking_socios(date, date, text, boolean, uuid)` (solo owner/manager activos; nombres sin contactos; descuento estimado con la regla del cambio de lista), más las internas `club_locales_de_reporte(text)` y `club_auditar_lectura(text, text, uuid, jsonb)`. SECURITY DEFINER, `puede_ver_local`, rastro en `club_auditoria` (una fila por apertura de la pantalla y una por exporte). No depende de la 160. Batería en Postgres 16 local en transacción descartada: 45/45, 33/33 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/161_rollback.sql` |
| 162 | `club_embudo_anfitrion` | pase (origen **108**) | `claude/club-embudo-anfitrion` | **Aplicada en prod el 15/11 01:31 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera firma). Sin tablas ni columnas: función `club_embudo_anfitrion(date, text, boolean, uuid)` (solo owner/manager activos; nombres sin contactos; SECURITY DEFINER, `puede_ver_local`) y la interna `club_embudo_auditar_lectura` (rastro en `club_auditoria`: una fila por apertura de la pantalla cada 12 h, el exporte siempre; copia de `club_auditar_lectura` de la 161: unificar cuando las dos estén en `main`). Funciona con y sin la 157 (D7) y la 158 (clic de reseña: se detecta en cada llamada; seguimiento: pasarlo a SQL fijo cuando 158 y 162 estén en prod). No depende de la 160 ni de la 161. Batería en Postgres 16 local en transacción descartada: 37/37 con y sin 157/158, mutaciones 31/31 y 32/32; staging pendiente con el dueño. Rollback: `scripts/sql/162_rollback.sql` |
| 163 | `club_edad_validar_reactivar` | pase (origen **109**) | `claude/club-edad-validar` | **Aplicada en prod el 15/11 01:36 -06:00** (merge → Branching; era: 14/11: PR en borrador apilado sobre el #140, espera firma; va DESPUÉS de la 159). Decisión del dueño (14-nov): el trigger de edad de la 159 también mira el paso a activo del rol de socio (validar o reactivar, cualquier origen); `club_socio_validar_v2` y `club_miembro_guardar_v2` envuelven a las vigentes (sin reescribirlas, siguen abiertas para clientes viejos) y piden/registran la edad si falta, auditada (`socio_mayor_edad`, con la vía). Entra en el MISMO merge que la app. Pruebas: `scripts/sql/163_pruebas.sql` (18 casos; Postgres 16 local sobre 155→156→159: 18/18, 12/12 mutaciones; staging pendiente con el dueño). Rollback: `scripts/sql/163_rollback.sql` |
| 164 | `club_alertas_umbral` | pase (origen **110**) | `claude/club-alertas-umbral` | **Aplicada en prod el 15/11 01:41 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera OK; vía merge → Branching). SPEC-club-v2 ítem 10 (B6): 5 umbrales por local en `club_config` (solo owner; historial) + `club_alertas_inicio` (Inicio, «Club · Para revisar hoy»). Pruebas: `scripts/sql/164_pruebas.sql` (41 casos + 26 mutaciones, Postgres 16 local con y sin la 157; **staging pendiente con el dueño**). Rollback: `scripts/sql/164_rollback.sql` (borra también la fila 164 del ledger; en prod, la vuelta atrás es una migración nueva hacia adelante: el `.sql` de la 164 se queda en `main`, regla 10) |
| 165 | `admin_bitacora_permisos` | pase (origen **111**) | `claude/admin-bitacora-permisos` | **Aplicada en prod el 15/11 01:46 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera OK; vía merge → Branching). B10: tabla `bitacora_permisos` solo inserción (nadie la edita ni la borra) + triggers sobre `profiles` (rol, activación) y `profile_locations` (local); lee solo owner. Arranca vacía. Pruebas: `scripts/sql/165_pruebas.sql` (21 casos + 12 mutaciones en una transacción descartada; verde en base local nueva con `local_armar_base.sh` + `--local`, 14/11; **staging pendiente con el dueño**). Rollback: `scripts/sql/165_rollback.sql` |
| 166 | `club_grupo_control` | pase (origen **112**) | `claude/club-grupo-control` | **Aplicada en prod el 15/11 01:51 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera firma). Tablas `club_campanas` y `club_campana_asignaciones` (RLS sin políticas, sin grants; UPDATE/DELETE/TRUNCATE rechazados por trigger; el grupo lo pone el sorteo fijo md5(semilla:campaña:miembro) en un trigger BEFORE INSERT). Funciones solo owner activo: `club_campana_crear`, `club_campana_sumar_nuevos`, `club_campana_cerrar`, `club_campanas_listar`, `club_campana_lista` (solo el grupo con oferta; con exporte, contacto con optin) y `club_campana_reporte` (los dos grupos a 30 días, venta respaldada neta − regalía, aviso «no concluyente» bajo 30 por grupo). Una campaña ABIERTA por local y fuente (índice único parcial + chequeo; `club_campana_cerrar` explícito, con motivo y auditado). El CSV filtra al exportar (activos hoy, optin de hoy). Batería en Postgres 16 local en transacción descartada: 51/51, 37/37 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/166_rollback.sql` (frena si hay campañas reales; borra la fila 166 del ledger) |
| 167 | `club_resena_socios` | pase (origen **113**) | `claude/club-resena-socios` (apilada sobre #177: necesita la 158) | **Aplicada en prod el 15/11 01:55 -06:00** (merge → Branching; era: 14/11: PR en borrador, espera OK). `club_config_global.resena_socio_cada` (5) y `resena_socio_espera_dias` (90); tabla `club_resena_socio` (pedidos sin datos personales); `club_portal` pasa a envolver a `club_portal_datos` (la de antes, 150 o 157) y suma `resena`; función pública nueva `club_portal_resena` (marcas mostrada/cerrada/clic). Va DESPUÉS de la 157 y aborta si falta la 158; vuelta atrás: primero 167, después 157 y 158 (sus rollbacks abortan si la 167 sigue). Prueba local (Postgres 16, con y sin la 157): 21/21 y 14 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/167_rollback.sql` |
| 168 | `club_primeros_90` | pase (origen **114**) | `claude/club-primeros-90` | **Aplicada en prod el 15/11 02:02 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, **toca plata: espera firma**). Apagado por defecto (`club_config_global.primeros90_activo = false`). Envuelve `club_socio_visita` (→ `club_socio_visita_base`) y `club_pase_datos` (→ `club_pase_datos_base`; necesita la 157 ANTES si entra); `club_portal_avance` nueva (club-web); tabla `club_primeros90` (una por socio). Conteo opción B (`primeros90_exige_factura`, true; **firma del dueño**): días anteriores solo con factura C con 856/857. Vence al final del día CR mostrado. **Orden: #176 (157) antes que #187 (168). PASE al mergear** (`docs/pases/`). Pruebas: `scripts/sql/168_pruebas.py` (22/22 local, con y sin la 157) y `168_concurrencia.sh`. Rollback: `scripts/sql/168_rollback.sql` (aborta si hay cortesías ganadas) |
| 169 | `club_retos` | pase (origen **115**) | `claude/club-retos` | **Aplicada en prod el 15/11 02:08 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, **toca plata: espera firma**). Sin ningún reto armado (los arma el owner). Tablas `club_retos` (tope 3 armados por año y sin superposición por local, en un trigger) y `club_retos_ganados` (uno por reto y socio); gana con un trigger AFTER INSERT en `club_visitas_socio` y la caja ofrece con `club_reto_en_visita` (paso aparte): **no toca `club_socio_visita` ni `club_pase_datos`** (convive con la 168 en cualquier orden). `club_portal_retos` nueva (club-web). Opción B (`club_config_global.retos_exige_factura`, true: los días anteriores cuentan solo con factura C con 856/857; no se arma un reto en un local sin PoS), jornada de servicio, vence al final del día CR, una cortesía de premio por factura. Pase: `docs/pases/PASE-169-club-retos.md` (orden con la 168: da igual). Pruebas: `scripts/sql/169_pruebas.py` (24/24 local, con y sin la 168; 24 mutaciones muerden) y `169_concurrencia.sh`. Rollback: `scripts/sql/169_rollback.sql` (aborta si hay premios ganados) |
| 170 | `club_local_manager` | pase (origen **116**) | `claude/club-local-manager` | **Aplicada en prod el 15/11 05:34 -06:00** (merge del #190 → Branching; era: 14/11: PR en borrador a `main`, espera firma). Helpers `club_puede_ver_local(text)` y `club_exigir_local(text)`; 26 funciones `club_*` con `p_location` quedan como envoltorio (la original pasa a `<nombre>__nucleo`, mismo cuerpo, sin EXECUTE para la API): el manager solo en `mis_locales()` (091); owner, contador, cajero, salonero y anon igual que hoy. Batería en Postgres 16 local en transacción descartada: 19/19, 9/9 mutaciones muerden; staging pendiente con el dueño. Guardia en el gate (`supabase/club_local_manager.test.ts`): después de la 170 se cambia el `__nucleo`, no el envoltorio. Rollback: `scripts/sql/170_rollback.sql` |
| 171 | `club_miembro_guardar_reune_156_157` | pase (origen **117**) | `claude/hotfix-miembro-guardar` | **Aplicada en prod el 15/11 05:44 -06:00** (merge del #193 → Branching; era: 14/11: PR en borrador a `main`, espera firma, DESPUÉS de la 158–170). HOTFIX: la 157 redefinió `club_miembro_guardar` desde la versión de la 150 y se perdió lo de la 156 (en prod «Editar» un socio da «Tipo no válido»; socio → anfitrión sin link nuevo). Cuerpo = fusión de tres vías 150/156/157 (md5 `e004268d…`); con la 170 cambia el `__nucleo` (no el envoltorio). Pruebas: `scripts/sql/171_pruebas.sql` (Postgres 16 local con 155→157 y con 158–170: verde + 11 mutaciones; **staging pendiente**). Rollback: `scripts/sql/171_rollback.sql` |
| 172 | `club_local_manager_2` | pase (origen **118**) | `claude/club-local-manager-2` | 15/11: PR en borrador a `main`, **lleva firma: esquema** (vía: merge → Branching; va DESPUÉS de la 170, aborta si falta). Hallazgo 231: 20 funciones más con la receta de la 170 (envoltorio + `<nombre>__nucleo`, sin EXECUTE para la API). Con `p_location`: `club_reporte_equipo`, `club_primeros90_config_ver`; `club_reto_en_visita` por el local de la VISITA. Por id, el local del objeto con `club_exigir_local_de` (nueva; manager solo; objeto inexistente → el «no encontrado» de siempre): miembro (`club_miembro_contacto_ver`, `_codigo`, `_token`, `_regenerar_codigo`, `club_pase_token`, `club_rol_activar_anfitrion`, `club_socio_confirmar`, `club_resolver_miembro`, `club_canje`, `club_canje_aprobado`, `club_tarjeta_manual`), cupón (`club_cupon_usar`), movimiento (`club_canje_aviso`, `club_sin_cruce_candidatas`, `club_sin_cruce_elegir`), pendiente (`club_pendiente_resolver`) y alerta (`club_alerta_revisar`). Owner, contador, cajero y anon igual que hoy. Quedan afuera (listas sin local; PR aparte): `club_buscar`, `club_resolver`, `club_socios_por_confirmar`, `club_socio_solicitudes_abiertas`, `club_retos_listar` y la lectura por RLS. Guardia en el gate (`supabase/club_local_manager.test.ts`): también falla con toda función SECURITY DEFINER con `p_location` y EXECUTE para authenticated que no chequee el local. Batería en Postgres 16 local en transacción descartada: 16/16, 9/9 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/172_rollback.sql` (ANTES que el de la 170) |
| 173 | `club_cumple_caja_portal_beneficio` | pase (origen **119**) | `claude/club-cumple-promo` | 15/11: PR #203 en borrador a `main`, **lleva firma: esquema y cortesías** (vía: merge → Branching; necesita la 159 y la 170; con o sin la 172). **ORDEN: el #202 (172) entra ANTES que el #203 (173)** — Branching rechaza un número menor después de uno mayor. Paquete: `docs/pases/PASE-173-club-cumple.md`. Aviso **v1.3** (huellas nuevas; club-web y app en el MISMO merge). Guardia del cumpleaños rehecha: además de la autoalta, carga a quien no lo tiene solo `club_socio_alta_caja_v3` (caja, con permiso) o `club_portal_cumple_agregar` (portal, UNA vez: `club_miembros_contacto.cumple_portal_en`). `club_cumple_config` por local (apagado; owner y manager de su local; OpenTable rid 1347736 por defecto; artículo de CORTESÍA CLUB), `club_cumple_envios` (marca «enviado» por socio y año del cumpleaños), `club_cumple_proximos` / `club_cumple_enviar` (Inicio + WhatsApp, auditado) y `club_cumple_en_caja` (solo socios del local; sin la fecha). Funciones con `p_location` llaman a `club_exigir_local`. Batería en Postgres 16 local en transacción descartada: 20/20 (con y sin la 172), 24/24 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/173_rollback.sql` (ANTES que el de la 172/170) |
| 174 | `club_facturas_dia_busqueda` | pase (origen **120**) | `claude/club-facturas-dia-busqueda` | **Aplicada en prod** (ledger 180 el 16/11; también en staging) · antes: **Sin aplicar** (15/11: PR #206 en borrador a `main`, **lleva firma: esquema**; va **después de la 172 y la 173** (ya en `main` y en prod con #202/#203, `4ba922e`); cambia solo el núcleo de `club_tarjeta_manual`, el envoltorio de la 172 queda). **Solo la tarjeta física** del referente (decisión del dueño, 15-nov, opción A; acotado tras el verificador independiente): su «Factura (plan B)» muestra las cobradas **hoy** (día CR) y se busca por los últimos dígitos del tiquete hasta **3 días CR** atrás (`club_facturas_buscar`, envoltorio + núcleo con la receta de la 170); `club_pos_ref_tarjeta` (interna) acepta esa ventana y el núcleo frena una factura del plan B que ya tiene tarjeta, cupón o personas pendientes. **Cupón, canje y visita de socio: igual que antes** (`club_pos_ref`, `club_visita_control` y `club_facturas_recientes` byte a byte; 2 h 15 min). Batería en Postgres 16 local (base nueva con `main`): 31/31 + 15/15 mutaciones; staging pendiente con el dueño. Paquete: `docs/pases/PASE-174-club-facturas-dia.md`. Rollback: `scripts/sql/174_rollback.sql` |
| 175 | `club_cumple_uso_anual` | pase (origen **121**) | `claude/club-cumple-uso-anual` | **Aplicada en prod** (ledger 180 el 16/11; también en staging) · antes: 15/11: PR en borrador a `main`, **lleva firma: esquema y cortesías** (vía: merge → Branching; necesita la 173; **ORDEN: #203 (173) y la 174 ANTES**). Paquete: `docs/pases/PASE-175-club-cumple-uso.md`. Tabla `club_cumple_usos` (marca por socio y AÑO DEL CUMPLEAÑOS, vinculada a la visita/factura; índice único parcial por socio y año y por visita entre las vigentes; guardia: solo se deshace una vez). `club_cumple_en_caja_dia` suma `ya_uso` (sin fecha ni año) y abre el **cruce de socios** (dueño 15-nov: socio de cualquier local, con la configuración del local de la caja; una vez por año en total). `club_cumple_usar` (candado del socio ANTES de la fila de la visita, como la 169; caja: owner/manager/cajero, `club_exigir_local`; núcleo `club_cumple_usar_dia` sin EXECUTE), `club_cumple_uso_deshacer` (solo owner, con nota, auditado), `club_cumple_usos_listar` (owner/manager) y `club_cumple_usos_resumen` (Tablero y Excepciones: owner/manager/contador, solo totales; solo la unidad vinculada a la marca, a costo con la moda de 30 días como el Tablero). Sin plata nueva. Batería en Postgres 16 local (main + 174) en transacción descartada: 17/17, 24/24 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/175_rollback.sql` (ANTES que el de la 173; aborta si hay marcas) |
| 176 | `club_local_manager_listas` | pase (origen **122**) | `claude/club-local-manager-3` | **Aplicada en prod** (ledger 180 el 16/11; también en staging) · antes: 15/11: PR en borrador a `main`, **lleva firma: esquema** (vía: merge → Branching; va DESPUÉS de la 174 y la 175, en ese orden; aborta si falta la 170/172). Decisión del dueño: el manager ve en las LISTAS solo las fichas de sus locales (`mis_locales()`); owner y contador, todos; cajero, igual que hoy (sin filtro). Receta de la 170/172 (envoltorio + `<nombre>__nucleo` byte a byte, sin EXECUTE para la API) en `club_buscar`, `club_socios_por_confirmar`, `club_socio_solicitudes_abiertas` (filtran por el local del miembro), `club_retos_listar` (retos con algún local suyo y sus cortesías) y `club_resolver` (cupón / QR de anfitrión / código de canje de otro local → 42501; el QR del **socio** no se corta: Club compartido). `club_ve_ficha(text)` nueva (interna). `club_exigir_local_de` (172) corta con «Ficha de otro local» (la app: «Esta ficha es de otro local…»). RLS: 17 políticas de tablas `club_*` que dejan entrar al manager suman `mis_locales()` solo para él (por el miembro en roles, pases y donde el local es nulo; movimientos: el local o el miembro, para que `club_saldos` quede completo); `club_config` sin cambios. `club_buscar__nucleo` es la única con el núcleo cambiado: el de la 150 + el filtro ANTES del `limit 20` (verificador del #204). Orden obligatorio 174 → 175 → 176. Batería en Postgres 16 local (main + 174 + 175) en transacción descartada: 22/22, 15/15 mutaciones muerden; staging pendiente con el dueño. Guardia en el gate (`supabase/club_local_manager.test.ts`). Pase: `docs/pases/PASE-176-club-listas-manager.md`. Rollback: `scripts/sql/176_rollback.sql` (ANTES que el de la 172) |
| 177 | `esquema_centimos_como_prod` | pase (origen **097**) | `claude/esquema-centimos-alinear` | **Aplicada en prod** (ledger 180 el 16/11; también en staging) · antes: 15/11: PR en borrador a `main`, **lleva firma: esquema (sin efecto en prod)** (firmado por el chat: «177 Mergea»; vía: merge → Branching; va DESPUÉS de la 174, 175 y 176). El repo declara los tipos numéricos como PROD: 39 columnas en las que una base armada desde el repo difería de prod (cash_movements.amount_crc, 6 de cash_sessions y tip_entries.tip_amount_crc/payout_crc en NUMERIC(12,0) contra (12,2); otras escalas de tip_entries y role_tip_points; 18 de cash_cierres_dia y 7 de inventario/recetas que la 0095 crea sin escala). Cada ALTER solo si el tipo actual difiere y sin redondear datos (si un valor cambiaría, aborta): **en prod no ejecuta ningún ALTER**. Batería en Postgres 16 local (`scripts/sql/177_pruebas.sh`, transacción descartada): 10/10, 4/4 mutaciones muerden. Paquete: `docs/pases/PASE-177-esquema-centimos.md`. Rollback: `scripts/sql/177_rollback.sql` (en prod no hay nada que deshacer) |
| 178 | `esquema_columnas_caja_como_prod` | pase (origen **098**) | `claude/esquema-columnas-caja-faltantes` | **Aplicada en prod** (ledger 180 el 16/11; también en staging) · antes: 16/11: PR en borrador a `main`, **lleva firma: esquema (sin efecto en prod)** (decisión del dueño por el chat, 16/11 06:45: «177 firmo A»; vía: merge → Branching; va DESPUÉS de la 177). El repo declara las 5 columnas que existen en PROD y en ninguna migración: `cash_movements.amount_usd`, `cash_sessions.initial_cash_crc`, `initial_cash_usd` (numeric, null, default 0) y `final_cash_crc`, `final_cash_usd` (numeric, null, sin default). `alter table … add column if not exists` solo si la columna falta (mira el catálogo antes: **en prod no ejecuta ningún ALTER ni toma locks**) y verifica que queden idénticas a prod (si una existe distinta, aborta). Batería en Postgres 16 local (`scripts/sql/178_pruebas.sh`, transacciones descartadas): 12/12, 6/6 mutaciones muerden. Paquete: `docs/pases/PASE-178-columnas-caja.md`. Rollback: `scripts/sql/178_rollback.sql` (en prod no hay nada que deshacer) |
| 179 | `club_portal_reserva_local` | pase (origen **124**) | `claude/club-portal-reserva-local` | **Aplicada en prod** (ledger 180 el 16/11; también en staging) · antes: **Sin aplicar** (16/11: PR #212 en borrador, **lleva firma: esquema**; PASE `docs/pases/PASE-179-club-portal-reserva-local.md`; vía: merge → Branching; va DESPUÉS de la 178; necesita la 167 y la 173, aborta si faltan). Decisión del dueño (opción A): «Reservar» de «Mi Club» abre el link de reserva del local del socio (`club_cumple_config.reserva_url`, Promociones) **tal cual**. `club_portal` (envoltorio de la 167) suma `socio.reserva_url` (sin fila, sin link o no OpenTable → null; club-web cae al rid por defecto); `club_portal_datos` igual. `club_cumple_config_guardar` = la 173 + exige https de OpenTable (opentable.com, subdominios o variante regional). `club_reserva_url_ok` interna, sin EXECUTE para la API. Nada nuevo para anon. Batería en Postgres 16 local en transacción descartada: 12/12, 9/9 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/179_rollback.sql` |
| 180 | `club_reserva_url_por_local` | pase (origen **125**) | `claude/club-link-reserva-local` | **Aplicada en prod** (ledger 180 el 16/11; también en staging) · antes: **Sin aplicar** (16/11: PR en borrador, **lleva firma: esquema**; PASE `docs/pases/PASE-180-club-reserva-url-por-local.md`; vía: merge → Branching; va DESPUÉS de la 179, aborta si falta). Pedido del dueño: el link de reservas es de cada local y para todos. `club_config.reserva_url` nueva (Club → Locales, solo owner) con trigger `club_config_reserva_url_trg` que valida con `club_reserva_url_ok` (179) y no deja heredar el link al copiar un local; copia los links de OpenTable de `club_cumple_config.reserva_url`, que queda **deprecada sin uso** (no se borra). `club_portal`, `club_cumple_cfg_json` (Promociones, Inicio/WhatsApp) leen del local; `club_cumple_config_guardar` ignora el link y «solo con reserva» exige el del local; `club_cupon_ver` suma `local.reserva`. Nada nuevo para anon. Batería en Postgres 16 local en transacción descartada: 11/11, 12/12 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/180_rollback.sql` |
| 181 | `club_tope_almuerzo_cena` | pase (origen **126**) | `claude/club-tope-almuerzo-cena` | **Aplicada en prod** (merge del #229 `3794d8d`, 16/11 23:37 CR, por Branching; 1 fila en el ledger; md5 de §3 del PASE verificados 23:40 y 17/11 01:35; también en staging). PASE `docs/pases/PASE-181-club-tope-almuerzo-cena.md` |
| 182 | `club_portal_reserva_anfitrion` | pase (origen **127**) | `claude/club-portal-link-v2` | **Aplicada en prod** (merge del #226 `8112b90`, 16/11 23:43 CR, por Branching, después de la 181; 1 fila; `club_portal` `1b716215…`, permisos de §3 OK; también en staging). PASE `docs/pases/PASE-182-club-portal-reserva-anfitrion.md` |
| 183 | `club_excepciones_rapida` | pase (origen **128**) | `claude/club-excepciones-abiertas-rapida` | **Aplicada en prod** (merge del #240 `51a765a`, 17/11 03:06 CR, por Branching; 1 fila; núcleo `100caed1…`; PASE §6 OK) · antes: **Aplicada en staging** (16/11 22:04 CR la v1 con su fila; 22:30 núcleo final `100caed1…`; falta borrar en staging el índice de la v1, `pos_ndf_tickets_local_fecha_efectiva_idx`, con una sesión de CC: la herramienta cancela los `drop`). **Prod: sin aplicar**, PR #240 en borrador, **firma SQL del dueño** (núcleo de excepciones; fija el monto que suma el reporte de descuentos en facturas con empate). PASE `docs/pases/PASE-183-club-excepciones-rapida.md`; vía: merge → Branching; **va DESPUÉS de la 181 y la 182** (exige el núcleo de la 181 `94cf0df9…` y `fecha_registra` NOT NULL; si no, para sin tocar nada). 4 fragmentos del núcleo, sin índices nuevos: `tk` por `fecha_registra` (índice existente), regla del cambio de lista con un join, desempate fijo de la línea ejemplo de DESCUENTO_SIN_RESPALDO (antes el total de `club_reporte_descuentos` dependía del plan). Staging: `club_excepciones_abiertas(30)` ~441 → ~175 ms. Batería `scripts/sql/183_pruebas.sql` ANTES de aplicar: local 10/10, 5/5 mutaciones muerden. Rollback: `scripts/sql/183_rollback.sql` |
| 184 | `club_descuentos_todas_lineas` | pase (origen **129**) | `claude/club-descuentos-todas-lineas` | **Aplicada en prod** (merge del #250 `c775b3d`, 17/11 03:10 CR, por Branching; 1 fila; PASE §6 OK) · antes: **Aplicada en staging** (17/11 02:22 CR, con su fila 184). **Prod: sin aplicar**, PR en borrador, **firma SQL del dueño + verificador** (plata: cambia el monto del reporte de descuentos). PASE `docs/pases/PASE-184-club-descuentos-todas-lineas.md`; vía: merge → Branching; **va DESPUÉS de la 183** (exige el núcleo `100caed1…` y el reporte `30bba89b…`; si no, para sin tocar nada). Núcleo de excepciones: 3 fragmentos (clasificación por línea; `lineas_sin_respaldo` y `descuento_crc_lineas` en el detalle; la línea ejemplo, la lista y el contador no cambian) y `club_reporte_descuentos__nucleo` suma las líneas por su clasificación. Staging, 400 días: el reporte pasa a 2,92 veces el monto de antes; lista de Excepciones idéntica (md5) y contador igual. Batería `scripts/sql/184_pruebas.sql` (local 13/13, 6/6 mutaciones muerden). Rollback: `scripts/sql/184_rollback.sql` |


| Entorno | Ledger (`schema_migrations`) | Detalle |
|---|---|---|
| **PROD** | **85 filas, de 001 a 171** (leído de `schema_migrations` de prod el 15/11 05:50 -06:00, solo lectura); última fila **171** (15/11 05:44 -06:00). Coincide con los 85 archivos de `supabase/migrations/`. La lista de abajo llega solo hasta la 151 (11/11) | `001–008 · 0090 · 0095 · 010–021 · 038–054 · 062–069 · 071–074 · 076–077 · 079–082 · 085 · 089 · 090 · 091 · 092 · 093 · 094 · 095 · 150 · 151` (**092, 093, 094 y 095 el 10/11 22:57:17 -06:00, en UN merge del #107 (`c41e18b`), Branching las aplicó en orden: 12, 7, 3 y 9 statements; pase de la tanda cerrado**; **091 el 10/11 22:44:57 -06:00, Branching al mergear el #103 (`b8cb74d`), 31 statements; pase cerrado 22:51**; **090 el 10/11 11:33:38 -06:00, Branching al mergear el #97 (`7543347`), 4 statements; pase cerrado**; **089 el 10/11 10:22:11 -06:00, Branching al mergear el #90 (`fa1cbef`), 3 statements; pase cerrado**; **085 el 10/11 08:24:48 -06:00, Branching al mergear el #80 (`bb12652`), 9 statements**; **081 y 082 v3 el 09/11, a mano en el pase del puente, antes del merge del #71**; 068 el 05/11 05:30 UTC, SEC-01; 069 el 05/11 15:22 UTC, SEC-01b; 071 el 05/11 19:20 UTC, cierre atómico; 072 y 073 el 05/11 ~20:05 UTC, SEC-03 y SEC-04; 074 el 05/11 20:20 UTC, conteo ciego; **076 y 077 el 06/11 entre 18:03:48 y 18:05:14 UTC**, SoP, una después de la otra — ver abajo; **079 el 06/11 21:22 UTC** y **080 el 07/11**, las dos aplicadas por Branching al mergear). **055–061 NO están en prod** (Salarios/BioTime, solo staging). La 067 se aplicó a mano el 30/10 antes del merge de #15. |
| **STAGING** | **91 filas, última 151** (leído el 11/11; el 10/11 a las 11:03 CR entraron la 091–095, y después la sesión del Club renumeró la 075 a 150 y aplicó la 151) | Hasta la 064 + la 067 + **la 068 (04/11, SEC-01) + la 070 y la 069 (05/11, SEC-01b; la 070 se aplicó primero) + la 071 (cierre atómico) + la 072 y la 073 (05/11, SEC-03 y SEC-04) + la 074 (05/11, conteo ciego) + la 075 (Club Satori F1a, reservada, solo staging) + la 076 y la 077 (SoP; 076 el 06/11 ~06:00–06:07 UTC, 077 el 06/11 ~16:36–16:40 UTC) + la 079 (SoP solo para usuarios activos, 06/11 ~21:08 UTC) + la 080 (Prom/PAX; aplicada el 06/11 como 078 y renumerada el 07/11, antes de ir a prod)**. Además, desde el 08/11: la 081 (puente), la 083, la 084 y la 085 (auditoría r5); la 082 del puente está aplicada **sin su fila**. ⚠️ **Le faltan las filas 065 y 066** aunque sus columnas existen (deuda de ledger, en el backlog). **10/11 tarde:** la 150 nueva (auditoría A/B, md5 `919bcd54…`) aplicada encima con su fila, con el OK del dueño; batería 613/613 y paridad 992 = 992 sin `--antes`. **10/11 18:10 CR:** la 150 de la segunda vuelta (Grok 162–164, md5 `04681f41…`) con su fila, mismo procedimiento; batería 623/623, paridad 992 = 992. La 082 del puente está aplicada **con su fila**: la v3 (09/11), md5 `edb7ffc58976804e55968f75df530a05`, igual al archivo de `main`. ⚠️ **Le faltan las filas 065 y 066** aunque sus columnas existen (deuda de ledger, en el backlog). |

- **Próximo número libre: por bloque** (08/11; caja al 13/11): **CAJA / operación 099** (097 usada y renumerada a 177, 15/11; 098 usada y renumerada a 178, 16/11), **CLUB SATORI + puente 100**. Ver «Numeración de migraciones» abajo. Antes de crear una migración, leer esa sección **en `main`** y registrar el número en el mismo PR.
  - La **076** (`sops_code_area`: columnas `code`, `area`, `doc_type`, `version`, `employee_book`, `pdf_path` en `public.sops` + índice único parcial `sops_code_key` + check `sops_doc_type_check`) y la **077** (`sops_pdf_storage`: policies `sops_storage_read` y `sops_franquicia_solo_gerencia` en `storage.objects`, bucket privado `documents`) están **en staging y en prod**. Prod: 06/11 entre 18:03:48 y 18:05:14 UTC, aplicadas a mano por la Management API (sesión de Claude Code de los SoP, con OK del dueño), verificando el ref antes de cada escritura y **antes** del merge del código (PR #49). Sus `.sql` son **idénticos byte a byte** a los statements del ledger de prod y de staging (md5 `fc26bfea…` y `ef17f371…`). Rollback: `scripts/sql/077_rollback.sql` y, solo después de revertir el sync de SoP, `scripts/sql/076_rollback.sql`.
  - **⚠️ Si se corre un rollback de la 076 o la 077, en el mismo momento hay que quitar su `.sql` de `supabase/migrations/` en `main`** (PR propio). Los rollbacks borran la fila del ledger; si el archivo sigue en `main`, Branching intentaría volver a aplicarla en el próximo push, y si el archivo sale de `main` sin el rollback, falla con «Remote migration versions not found in local migrations directory» (regla 10: nunca sacar de `main` el `.sql` de algo que está en el ledger).
  - La **079** (`sops_lectura_activos`, PR de `claude/mig-079-sops-activos`) cierra el hueco de lectura de SoP para usuarios **inactivos** con sesión vigente: `sops_read` (010) pasa de `USING (true)` a `USING (public.get_my_role() is not null)`, y `sops_storage_read` (077) suma `and public.get_my_role() is not null`. Nada más cambia (`sops_write`, `sops_franquicia_solo_gerencia`, `documents_storage_rw` y el resto quedan igual; usa `ALTER POLICY`). **Staging: aplicada el 06/11 ~21:08 UTC** y probada en solo lectura: owner, cajero y salonero reales (y los 5 roles simulados) leen igual que antes —47 filas de `sops` (27 activas), 27 PDF y el libro del empleado; la franquicia solo owner y manager—, un manager inactivo real ve **0 filas y 0 objetos** de `sops/*`, y `anon` 0. **Prod: la aplica Supabase Branching con el merge del PR** (Branching ON auto-aplica las migraciones de `main`), con OK del dueño y respaldo previo de las dos policies. Rollback: `scripts/sql/079_rollback.sql` (y quitar el `.sql` de `main` en el mismo momento).
  - La **074** (`cash_cierres_dia.primer_conteo_crc/usd` + `cerrar_dia_completo` las escribe; null si no vienen) está en staging y en prod (prod: 05/11 20:20 UTC). Su primer cliente, el conteo ciego (#31), se revirtió (#32). Desde el 06/11 la usa el «Recontar» del cierre del día (`claude/recontar-cierre`). El `.sql` y su rollback volvieron a `main` el 06/11 (`supabase/migrations/074_cierre_primer_conteo.sql` y `scripts/sql/074_rollback.sql`, byte a byte desde `d4012ec`).
  - La **072** (SEC-03, cierre de la escritura anónima del CRM) y la **073** (SEC-04, lecturas sin sesión → `authenticated`) están en staging y en prod (prod: 05/11 ~20:05 UTC, a mano antes del merge del PR #28).
  - La **071** (cierre del día atómico, `claude/cierre-atomico`, PR #29) está en staging y en prod (prod: 05/11 19:20 UTC, a mano antes del merge).
  - La 068 está en staging y en prod (PR de `claude/sec-01-perfiles`).
  - La **069** (SEC-01b, `claude/sec-01b-is-active`) está **aplicada en staging y en prod** (prod: 05/11 15:22 UTC, a mano antes del merge).
  - La **070** (guardas del PoS propio, `claude/sec-01b-pos-guardas`, desde `staging`) está **aplicada solo en staging**. Se aplicó antes que la 069 y no va a prod hasta el pase del PoS.
- 🚫 Nunca `repair --status reverted` sobre algo aplicado. El CLI ordena archivos por **nombre** y el ledger por
  **versión** (por eso `009` → `0090`). La `026` en prod es una excepción permanente documentada.

**Mig 067 · `pos_ventas_lectura_equipo`** (prod y staging): tres funciones `SECURITY DEFINER`, `search_path=public`,
rol chequeado adentro (`owner, manager, contador, salonero, barman, barback, runner, cocina`), `revoke` a
`public`/`anon`, paginación con orden total adentro. `pos_ventas_tickets_rango` devuelve **17 columnas** (las que
usan `armarDia` y las lentes); nunca medios de pago, vuelto, dólares, cxc, `numero_pedido`, `total_fuente`,
`ingested_at` ni `clase_ingreso`. Verificada en prod (30/10): owner y manager función = tabla fila por fila
(40.538 tickets / 3.476 líneas de octubre, 0 diferencias) · salonero: tabla 0, función 563 tickets de octubre ·
cajero y sin perfil: 0 · `anon`: `permission denied`. El contrato de columnas lo fija
`src/shared/api/posNdf.contrato067.test.ts`.

---

## 🧩 Qué hay en PROD y qué solo en STAGING

Leyenda: ✅ en prod y validado en piso · 🟢 en prod, falta validar en piso · 🧪 solo staging · 🔲 no construido.

| Módulo | Estado |
|---|---|
| **Caja: POZO único + T3 (los 8 ítems)** | ✅ prod |
| Propinas (pool por `covered_role`, `pool_total_crc` fuente única) | ✅ prod |
| Bandeja unificada + Revisión de inventario · autorización por contraseña (045) · elegibilidad de propina (048) | ✅ prod |
| Finanzas/P&L · reportes + emails · admin · auth · realtime · offline | ✅ prod |
| Proveedores A (notificación de pago, mig 047) + B (saldo a favor, migs 053/054) + comprobantes | 🟢 prod, sin validar en piso; el correo sale recién con el DNS de Resend |
| **Ventas desde el PoS** (puente, migs 062–066, `FUENTE_VENTAS='pos'`, Paridad, En vivo, Frente C, lentes por línea) | ✅ prod (30/10) |
| **Mi Rendimiento** (casa del empleado; «Ver como» solo owner; sigue `FUENTE_VENTAS`) | ✅ prod |
| **ICP** (propina electrónica declarada; barra «no aplica»; benchmark único) | ✅ prod (30/10) |
| **Lectura del PoS para el equipo** (mig 067 + franja de aviso) | ✅ prod (30/10); probada con salonero real en staging |
| Salarios F0 (055) · U0a/U0b (056/058) · BioTime F1 (057, `ingest-punches`) | 🧪 staging · BioTime parado desde el 14/09 |
| PoS propio (comandero, KDS, cobro + splits, ticket/FE SIM, inventario COGS; migs 022–037, `posFiscal.ts`) | 🧪 staging · bloqueado por el PILAR de auth |
| PILAR de auth multi-tenant · FE-CR real | 🔲 |

### Pendientes de estabilización

- **Caja · documentos huérfanos al borrar un movimiento. DESPUÉS DEL PILOTO** (decisión del dueño, 12-nov: Inventario
  todavía no se usa). Sin migración ni script por ahora.
  - **Qué pasa:** `delete_movement_cascade` (en prod, la versión de la 053; el bug viene desde la 043) busca los
    documentos por `linked_movement_id = p_movement_id` en la FASE 8, **después** de que la FASE 7 borró el movimiento.
    Para entonces la FK `documents_linked_movement_id_fkey … ON DELETE SET NULL` ya dejó el vínculo en null: el
    documento queda `procesado`, sin vínculo y sin limpiar (huérfano). Solo se limpian los que salen de
    `inventory_movements` (`v_doc_ids`).
  - **Medido en prod (solo lectura, 12-nov):** 114 documentos `procesado` sin vínculo. 112 se pueden limpiar; los
    otros 2 los referencian `inventory_movements` o `ingredient_prices` y se deciden aparte. 9 de ellos se
    ven hoy en «Inventario pendiente» de la Bandeja.
  - **No tocan la plata:** caja, caja fuerte y cierres leen solo `cash_movements` (confirmado leyendo el código, 12-nov).
    En el front, `documents` solo da la foto (FacturaVerify) y la nota «⚠ sin foto» de CashTurno. En la base, solo la
    leen `delete_movement_cascade` y el trigger `unif_on_cash_movement`, que toma el `document_id` para la tarea de
    revisión de inventario. Ninguna vista la usa.
  - **Propuesta:**
    1. Una migración nueva que, antes de la FASE 7, sume a `v_doc_ids` los documentos con
       `linked_movement_id = p_movement_id`, con una prueba que falla sin el arreglo.
    2. Un script en una transacción, con conteo antes y después y respaldo, que limpie los 112. Hay que decidir si se
       marcan `descartado`, que guarda la fila y la foto (lo recomendado), o si se borran como pretendía la D5.
    3. Las dos cosas, con la firma del dueño.
  - **Mientras tanto:** el control de duplicados del #149 ignora los huérfanos y los descartados, así que un huérfano no
    bloquea la recarga legítima de su factura.

- **Lectura de facturas (después del piloto; salieron del pase de `extract-document` del 12/11, nada construido):**
  - **«Agregar» de Caja** (`AgregarAsistente.tsx`): guarda solo el **primer** documento de una foto (una foto con dos
    proformas registra una) y **no detecta duplicados** (la misma foto entra dos veces). La Bandeja sí hace las dos cosas.
  - **Caja/Proveedores** («➕ Agregar foto», `CashProveedores.tsx`): cuando la lectura falla, crea el documento vacío
    **sin avisar**. Ninguna pantalla muestra el motivo (`extractImage` descarta el error de la función).
  - **Validación de la clave FE:** 50 dígitos, empieza con 506, y la fecha, la cédula y el consecutivo que lleva adentro
    coinciden con lo leído. En la evaluación de staging habría marcado todas las claves mal leídas, con 4.5 y con 5.5.
  - **Texto «Requiere revisión»:** el aviso «⚠ Confianza baja» del «Agregar» de Caja sale también cuando el modelo marca
    `requiere_revision` con confianza alta (85 %). Cuando ese es el motivo, el texto tiene que decir «Requiere revisión».
- **Propinas · reparto semanal de cocina:** mover la exclusión del reparto de cocina de un nombre fijo en el código a una marca en la base (requiere spec y firma: toca propinas).
- **Privacidad · datos reales que siguen en el repo público** (tras #56 y #57, que limpiaron comentarios, tests y docs).
  No se sacaron porque hacerlo cambia el comportamiento o porque la zona está bloqueada:
  - **Listas de personal que usa la app** (`src/shared/ndf/personasNdf.ts`, `src/modules/ventas/ventasEnVivoDatos.ts`
    y los tests que dependen de ellas): la app las usa para mapear los tickets del PoS a personas. Moverlas a la base
    pide spec y firma.
  - **Correo y filtro por correo en `scripts/`** (`scripts/clone_prod_to_staging.py` y 4 scripts `.ts` de
    `refresh-staging/` y `t0-reconciliacion-cajas/`): sacarlos cambia cómo se ubica la cuenta. Pasar a una variable
    de entorno o a una búsqueda por rol.
  - **Nombres de proveedores** en los docs de `scripts/refresh-staging/` (corte e informes T0) y en
    `ESTADO-ARCHIVO.md`: son registros históricos. Anonimizarlos en un PR de docs.
  - **Alias de correo** en la pantalla de alta (`NuevoEmpleado` / `UserApprovals`) y en la función `cierre-email`:
    bloqueado hasta el ítem 11 (`supabase/functions/` no se toca).

### Seguridad que sigue abierta en prod (medido 30/10; SEC-01 al 04/11)

- **SEC-01 (escalada de roles):** ✅ cerrada en prod: Paso A (signup apagado + bans) y mig 068 (05/11). Rollback: `scripts/sql/068_rollback.sql`.
- **SEC-03 y SEC-04:** ✅ cerradas en prod con la 072 y la 073 (05/11). `anon` ya no escribe en el CRM ni lee propinas, sesiones, puntos por rol, tipo de cambio ni empleados.
- **SEC-01b:** ✅ cerrada en prod con la 069 (05/11). Las cuentas inactivas pierden permisos. Rollback: `scripts/sql/069_rollback.sql`. Ver [HALLAZGOS.md](../../HALLAZGOS.md).

- **4 funciones `SECURITY DEFINER` ejecutables por `anon`:** `get_my_role`, `handle_new_user`,
  `log_movement_edit` (052) y `unif_on_cash_movement`. Las de la 067 y las de plata no.
- **Sin `supabase/config.toml`:** el `verify_jwt` de las funciones no está versionado.
- **`deploy.yml` no corre `vitest`** antes de publicar a prod.
- ~~**`monthly-report` con `verify_jwt` off.**~~ ✅ Cerrado el 06/11 (SEC-02).

---

## 📝 Notas que ahorran una sesión

- **Análisis mediodía, Local Club y descuentos (nov 2026), cerrado:** conclusiones vigentes en `docs/analisis/2026-11-mediodia-localclub/README.md` §0. Resumen: menú por temporada (inserto en baja, a pedido en alta) sin platos que canibalizan; Local Club 2.0 al 10 % + regalo; créditos de ₡18.000 cada 6 personas; conciliar comisiones PM; código de empleado para el 30 %. Escenario 2027: +₡3,9–9,1M de margen por año.

- **Qué cubre cada fuente de ventas:** `ventas_dias` (detalle diario con saloneros) = enero 2026 → 20/10/2026 en
  prod · `ventas_hist` (reporte general, sin salonero) = 2023–2025 · `pos_ndf_*` = 6-ene-2024 → hoy. 2023 no tiene
  detalle diario en ninguna fuente; sobrevive por `ventas_hist`.
- **El delivery baja ~4-5 % con el PoS y no es un bug:** el Excel llamaba delivery a toda venta sin servicio; el PoS
  usa el canal real.
- **La historia 2024-2025 da −0,057 % contra el Excel** (concentrado en días viejos puntuales, p. ej. 7-mar-2024).
  Ruido para analítica; resolver el drill-down antes de usarlo para algo contable.
- **2024 no tiene salonero** (cobertura 0 %): Saloneros/Evaluación/ICP salen vacíos en 2024. No es regresión.
- **ICP del equipo de octubre:** con el Excel daba 15,7 % (inflado: ventas al 20/10, propinas al 28/10); con el PoS
  da 10,6 %. Los umbrales de la pestaña (≥13 % excelente, <10 % a mejorar) están pendientes de recalibrar.
- **`version.json` desde el navegador lleva al login:** el service worker responde `index.html` a toda navegación
  bajo `/satori-app/` (su denylist solo tiene `/inbox/share`). Con Cmd+Shift+R, `view-source:` o una ventana de
  incógnito nueva se ve el JSON. Arreglo en el backlog.
- **`database.ts` puede mentir la nullability** frente a `supabase.gen.ts`; las lecturas castean la fila cruda.
- **`navigator.share` es no-opcional en el lib DOM de TS:** chequear con `typeof nav.share === 'function'`.
- **Para cherry-picks a prod, usar un git worktree aislado**; los untracked del árbol principal bloquean el checkout.

## Movido de ESTADO ⚡ARRANQUE el 18-nov-2026 (poda 15 KB, #296)

- **Entró a `main` el 17–18-nov:** #255–#258, #260, #261, #263, #265, #266, #268 (mig 185), #269, #270, #271–#273 (migs 186–188), #274, #284 (correo del contador y mig 189), #285 (resumen del cierre como función pura, sin Edge) y #282 (guía 6.13 del Club).
- **Hallazgos nuevos (no es plata):** (1) el agente toma `clave_fe` por número de consecutivo sin filtrar el tipo de documento: tiquetes tipo 04 de mar/abr-2026 quedan con la clave de la factura 01 del mismo consecutivo (675 filas al 18-nov) y crece con cada factura nueva; arreglo en curso. (2) El reporte de ventas redondea por grupo (salonero) y después suma: el total del día puede moverse ±₡1 si cambia el salonero; arreglo propuesto: sumar y redondear por día. Detalle en [HALLAZGOS.md](HALLAZGOS.md).
- (Movido el 18-nov tarde, misma poda, #296) **Cola (Menor):** `cierre_read` deja leer cierres a cualquier usuario autenticado del local (cualquiera puede disparar el correo con resumen; los datos solo llegan al dueño); la Edge del cierre lee filas crudas de 4 días.


---

## ESTADO.md completo al 20-nov-2026 05:30 CR, previo a la poda (movido tal cual; incluye ARRANQUE del 19-nov, tabla de Edge, tabla de migraciones número a número y reglas con su redacción original)

# Satori App — Estado del proyecto

> Vivo y corto (poda >15 KB: lo viejo va a [docs/historico/ESTADO-HISTORICO.md](docs/historico/ESTADO-HISTORICO.md)).
> Ahí está la foto íntegra del 17/11: tabla de PRs del 15–17/11, bitácora por migración, filas de los ledgers, camino de las
> ventas, qué hay en prod y en staging, pendientes de estabilización, seguridad abierta y notas. Más viejo: [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md).

## ⚡ ARRANQUE — foto real (se REEMPLAZA en cada entrega, no se acumula)
**Al día: 2026-11-19 (~08:30 -06:00).** `main` = `1abcc825`. **Ledger de prod = 194. Staging = 191** (190 y 191 aplicadas el 19-nov, md5 de funciones = prod; la 189 se OMITE a propósito: agenda un cron con la URL de prod; 192–194 pendientes, las corre la CC de la Mac del dueño). Cron jobid 10 `satori-ventas-dia-contador` (1 y 16; primer envío 1-dic). **Punto de entrada:** [docs/handoffs/HANDOFF-2026-11-19.md](docs/handoffs/HANDOFF-2026-11-19.md).
- **Entró hoy (19-nov):** #264 · #257 (R23, R24) · #299 (`scripts/ci/gate.sh` único; trailer `Verificado:` = línea GATE) · #301 (guardas de CI: R04, R14, sagrados por hash leídos de este archivo, R16 con `ultimo_ledger_prod` = 194) · #300 (comprobantes de proveedores).
- **Protección de `main` (19-nov 08:34):** «Gate» requerido · rama al día (`strict=true`) · sin excepción para admins (`enforce_admins=true`). Las sesiones en la nube no pueden cambiarla (403 del proxy): se cambia en GitHub → Settings → Branches. A prueba hasta el 3-dic.
- **Edge de prod (sin cambios):** `ventas-dia-contador` v5 · `cierre-email` v17 · `pago-notificar` v15 · `monthly-report` v24 · `club-pase` v7 · `ingest-ndf` v13 · `extract-document` v20 · `alta-empleado` v12. Agente PoS `agente-fe` @ `07782e49`.
- **Cerrados hoy:** #276, #231, #246, #232, #60. **Abiertos:** lista en el handoff (esperan ítem 11, rama del agente, por revisar, #252 con firma).
- **Validado por el dueño:** correo de cierre del 18-nov (bien; pidió resumirlo) y Club 186–188. **#300 VALIDADO (19-nov, comprobante post-pago con 2 facturas).** **Pendiente:** #229 al lanzar el Club (0 visitas de socios desde el 17-nov) · correo de pago agrupado en curso (PR #303 + `claude/pago-notificar-agrupado`; Edge con firma).
- **Decisiones del dueño (19-nov):** Club en PAUSA hasta la Wallet · WhatsApp automático a proveedores: spec en curso, prioridad alta (foto en la base, migración con firma) · sin alerta de latido por ahora · arnés a prueba hasta el 3-dic (detalle en el handoff).
- **Cron:** job 4 (quincena) aplicado el 16-nov, **NO volver a aplicar**. Job 8 (Club): repetir la verificación el 23-nov.
- **Deploy:** `version.json` y `/api/salud` no se ven desde la sesión (proxy 403): verificar por los runs «Deploy to GitHub Pages», «Cloudflare Pages: satori-club» y «Supabase Preview».

> **Definition of Done:** ninguna entrega se cierra sin ⚡ARRANQUE al día (mismo PR o PR de docs inmediato). **El repo manda:** si este archivo y la realidad no coinciden, gana la realidad y se corrige el archivo.

| Puntero | Valor |
|---|---|
| `main` (PROD, Pages `/satori-app/`; «Gate» requerido) | `1abcc825` |
| `staging` | sin cambios desde el 13/11 (`4726b7f`); su base está en ledger 184 (ponerla al día: en cola) |
| `feat/pos-desglose` | `14bd278`: rama del **agente** del PoS (`pos-bridge/`), no se mergea a `main` |
| Refs Supabase | **PROD `yiczgdtirrkdvohdquzf`** (`satori-app`) · **STAGING `hwiatgicyyqyezqwldia`** (`satori-staging`) |
| Gate | `bash scripts/ci/gate.sh` (único; mismo en CI y local) |
| Merges (regla D1) | libre 23:30–15:50 · bloqueado 15:50–19:00 · 19:00–23:30 solo con OK del dueño en el momento |

**Sagrados (por hash de blob):**

| Archivo | Hash |
|---|---|
| `src/shared/utils/tipCalculations.ts` | `7603ba5a` |
| `src/modules/cash/cashUtils.ts` | `b597c697` |
| `cierrePozo.ts` | `bf22ee44` (referencia del 16/11) |
| `posFiscal.ts` (con `computeTotals`) | `a3fd445f`, solo en `staging`; en `main` no existe |

Docs: [ROADMAP.md](ROADMAP.md) · backlog [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · [HALLAZGOS.md](HALLAZGOS.md) · [PASE-POZO-A-PROD.md](PASE-POZO-A-PROD.md) · SPECs [docs/README.md](docs/README.md) · incidentes → reglas [docs/REGLAS-POR-INCIDENTE.md](docs/REGLAS-POR-INCIDENTE.md).

---

## 🛑 Reglas operativas (leer antes de tocar `main` o una base)
1. **Branching corre `migrate` contra PROD en cada push a `main`** Desde la 085 las migraciones entran **por merge → Branching**. «A mano antes del merge» es histórico: solo con firma del dueño y verificando antes el ref.
2. **Ningún PR a `main` con archivos bajo `supabase/functions/` hasta cerrar el ítem 11** (versionar `ingest-ndf` con `config.toml`): sin `config.toml`, Branching despliega con `verify_jwt=true` y el agente del PoS (solo `x-ingest-secret`) recibe 401. El código de `main` está atrasado y pisaría prod: `monthly-report` (anterior a SEC-02), `extract-document` (prod = `8a8dfb6`, rama `claude/busy-brown-ssjq4e`; el de `main` deja la Bandeja vacía con `claude-sonnet-5-5`), `ingest-ndf` y `alta-empleado` (ramas aparte). `club-pase` entra con **`verify_jwt = false`** (el portón es `x-club-web`); hasta el ítem 11 se despliega a mano desde `claude/club-pase-edge`.
3. **Merges D1 (13/11):** libre 23:30–15:50 · bloqueado 15:50–19:00 · 19:00–23:30 solo con OK explícito del dueño en el momento. Una sola sesión de CC mergea a la vez, solo sus PRs.
4. **«Ver como» usa los permisos del owner:** probar permisos con un usuario real del rol o su JWT en `begin read only` … `rollback`.
5. **ICP = propina electrónica declarada (voluntaria: tarjeta/SINPE) / neta de sus mesas.** El 10 % de servicio no entra al numerador ni al denominador; `payout_crc` no es ICP; barra: «no aplica».
6. **El PoS se lee por las funciones de la 067** (`pos_ventas_tickets_rango`, `pos_ventas_lineas`, `pos_ventas_latido`), sin medios de pago ni `clase_ingreso`. **`pos_ndf_*` cerradas a gerencia** (`owner/manager/contador`), sin policy nueva. Excepción: «En vivo» (solo gerencia).
7. **Ritual antes de cualquier comando de base:** confirmar el ref (`yiczgdti…` PROD, `hwiatgic…` staging); nunca SQL de escritura sin haberlo leído.
8. **Sagrados por hash de blob, no por `git diff`.** Nunca reimplementarlos sin acuerdo explícito.
9. **Un deploy se verifica por contenido, no por HTTP 200** (el fallback del SPA devuelve `index.html` a cualquier ruta).
10. **Nunca revertir ni borrar el `.sql` de una migración que está en el ledger de prod** (si no, Branching falla en cada push; pasó con la 074). Si se revierte el código, el archivo se queda.
11. **La fecha del movimiento de caja es el día en que se registró (el turno), nunca la de la factura** (14/11). La de factura va a la descripción («· fact AAAA-MM-DD») y se analiza con `src/shared/utils/fechaFactura.ts` (clave FE manda; sin clave, la única lectura día/mes posible; si hay dos, la pantalla pregunta; más de 7 días avisa, no bloquea).
12. **Bitácora de permisos (165) caída = no se cambian roles ni activaciones** (fail closed, 14/11). Si hay que cortar un acceso igual: (1) ban o cambio de clave en Supabase Auth; (2) si además hay que desactivar, soporte, como dueño de la tabla y en UNA transacción: `alter table public.profiles disable trigger trg_profiles_bitacora_permisos;` → `update public.profiles set is_active = false where id = '<UUID>';` → `alter table public.profiles enable trigger trg_profiles_bitacora_permisos;`; (3) anotarlo a mano con `origen = 'manual'` y la hora real cuando vuelva.  Guía 6.6.
13. **Turno de prod (18/11):** una sola sesión toca prod o `main` a la vez. Un prompt de CC que toca prod empieza con «TURNO DE PROD: esta sesión de CC».
14. **Staging, conector (18/11):** si el conector cancela una confirmación (`drop`, `delete`), NO se reescribe el SQL para esquivarla. La batería la corre la sesión de CC del dueño (Management API, ref de staging fijo, ROLLBACK).

---

## ☁️ Edge, Cloudflare, cron y agentes (leído 12–17/11; solo lectura)
`on`/`off` = `verify_jwt`. Confirmar secretos por su lista (nombre + huella); el código, por `ezbr_sha256`

| Función | PROD | STAGING |
|---|---|---|
| `monthly-report` | v24 · on (desde `50831a8e`, #245+#241, + remitente propio 18-nov) | v9 · on |
| `extract-document` | v20 · on (código desde `8a8dfb6`, rama `claude/busy-brown-ssjq4e`, modelo `claude-sonnet-5-5`) | v29 desde `190b5f5` |
| `cierre-email` | v17 · on (v16 desde `f8b6c2a6`, rama de #283, + remitente propio) | v15 · on |
| `pago-notificar` | v15 · on (desde `588c5593`, #243, + remitente propio) | — |
| `ventas-dia-contador` | v5 · on (v4 desde `060b539`, rama de #281) | — |
| `ingest-ndf` | v13 · off (código v3 del 09/11 desde `5da233a`; vive en `claude/puente-item11-prod-v2`) | v21 · off |
| `ingest-punches` | — | v13 · off |
| `alta-empleado` | v12 · on (rama `claude/alta-empleado-fn`) | v8 · on |
| `club-pase` | v7 · off (rama `claude/club-pase-edge` @ `6c5848e`) | v1 · off (`WALLET_ENTORNO` = `stg`) |

- **Cloudflare:** Pages `satori-club` y Worker `satori-club-api` (Workers Builds desde `main`; secretos a mano; `/api/salud`). **Cron del Club:** jobid 8.
- **Agentes del PoS:** «Satori PoS Bridge» (staging, @ `14bd278`) y «… PROD» (`agente-fe` @ `07782e49` desde el 18/11, cuenta SYSTEM). `biotime-bridge` publica solo a staging (`ingest-punches`).
- **Ventas = solo PoS** (firmado 16/11): ninguna pantalla lee `ventas_dias`; `ventas_hist` solo antes del 2024-01-05. Guarda: `src/ventasSoloPos.test.ts`.

---

## 🗃️ Migraciones

### Numeración de migraciones (regla del dueño, 08/11)
> **Fuente de verdad:** `supabase/migraciones-reservadas.json`, que lee `supabase/migraciones.test.ts`. La bitácora larga de cada número está en el [histórico](docs/historico/ESTADO-HISTORICO.md).

1. **Bloques por rama:** CAJA / operación **087–99** (**lleno**: la 099 fue la última, 17/11; un número nuevo de caja hay que pedirlo al dueño) · CLUB SATORI + puente **100–149** (próximo libre **139**; 134, 135, 136, 137 y 138 se reservaron para pasar directo a 190, 191, 193, 192 y 194) · PASE A PROD **150–199** (solo renumeraciones del pase; **190–194** en prod desde el 18-nov; **194** (#296, `mi_rendimiento_equipo`) también; próximo libre **195**). La **086** queda libre.
2. Cada PR que agrega una migración actualiza esta tabla y el registro. El gate falla si no está registrada, queda fuera del bloque de su rama o repite número.
3. **Pase a prod:** ninguna migración entra con número ≤ al último del ledger de prod; se renombra al siguiente libre del bloque 150–199 (nunca a uno de creación), en el mismo PR (archivo, rollback, pruebas, scripts, fila del ledger de staging), con `origen` en el registro. Branching rechaza una versión menor que la última aplicada.
4. Un número usado no se reutiliza. Las versiones son **texto**: `0090` y `0095` son históricas y distintas de `090` / `095`.

**Ledger de prod: 194** (150–194 por merge → Branching, 11/11–18/11; PASE de cada una en `docs/pases/`). Staging: 191 (189 se omite; 192–194 sin aplicar); le faltan las filas viejas 065 y 066.

| Número | Detalle (nombre en el registro JSON; `←` origen, `→` renumerada) |
|---|---|
| 075 | → 150 |
| 078 | no usar (fue Prom/PAX, pasó a 080) |
| 080 | prod |
| 081 | prod |
| 082 | prod |
| 083 | solo staging |
| 084 | solo staging |
| 085 | prod |
| 087 | propuesta sin firma; irá a 152+ |
| 088 | propuesta sin firma; irá a 152+ |
| 089 | prod |
| 090 | prod |
| 091 | prod |
| 092 | prod |
| 093 | prod |
| 094 | prod |
| 095 | prod |
| 096 | → 153 |
| 097 | → 177 |
| 098 | → 178 |
| 099 | → 185 (seguridad: obligar a cambiar la contraseña; PR en borrador, sin firma) |
| 100 | → 151 |
| 101 | → 159 |
| 102 | → 155 |
| 103 | → 156 |
| 104 | → 157 |
| 105 | → 158 |
| 106 | → 160 |
| 107 | → 161 |
| 108 | → 162 |
| 109 | → 163 |
| 110 | → 164 |
| 111 | → 165 |
| 112 | → 166 |
| 113 | → 167 |
| 114 | → 168 |
| 115 | → 169 |
| 116 | → 170 |
| 117 | → 171 |
| 118 | → 172 |
| 119 | → 173 |
| 120 | → 174 |
| 121 | → 175 |
| 122 | → 176 |
| 124 | → 179 |
| 125 | → 180 |
| 126 | → 181 |
| 127 | → 182 |
| 128 | → 183 |
| 129 | → 184 |
| 130 | → 186 (cumpleaños: el owner deshace «enviado»; #271, en prod 17-nov) |
| 131 | → 187 (retos: un local por reto + tope de 3 armados por año por local; #272, en prod 17-nov) |
| 132 | → 188 (getEdadSocio por función con control de local; #273, en prod 17-nov) |
| 133 | → 189 (cron del correo quincenal de ventas por día al contador; reservado para pasar directo a 189) |
| 134 | → 190 (Ventas v2: `pos_ventas_resumen`, solo lectura; reservado para pasar directo a 190) |
| 135 | → 191 (ventas del PoS: cada uno ve solo lo suyo + `pos_nombres_por_login`; reservado para pasar directo a 191; la 134 → 190 es de `claude/ventas-v2-resumen-fn`) |
| 136 | → 193 (Ventas v2 «Tiempos»: `pos_ventas_tiempos`, `pos_ventas_internas`, `pos_mesas_internas`; reservado para pasar directo a 193; en prod) |
| 137 | → 192 (`propinas_cada_uno_lo_suyo`, lectura de `tip_entries`; reservado para pasar directo a 192) |
| 138 | → 194 (`mi_rendimiento_equipo`; reservado para pasar directo a 194) |
| 150 | ← 075 |
| 151 | ← 100 |
| 153 | ← 096 |
| 155 | ← 102 |
| 156 | ← 103 |
| 157 | ← 104 |
| 158 | ← 105 |
| 159 | ← 101 |
| 160 | ← 106 |
| 161 | ← 107 |
| 162 | ← 108 |
| 163 | ← 109 |
| 164 | ← 110 |
| 165 | ← 111 |
| 166 | ← 112 |
| 167 | ← 113 |
| 168 | ← 114 |
| 169 | ← 115 |
| 170 | ← 116 |
| 171 | ← 117 |
| 172 | ← 118 |
| 173 | ← 119 |
| 174 | ← 120 |
| 175 | ← 121 |
| 176 | ← 122 |
| 177 | ← 097 |
| 178 | ← 098 |
| 179 | ← 124 |
| 180 | ← 125 |
| 181 | ← 126 |
| 182 | ← 127 |
| 183 | ← 128 |
| 184 | ← 129 |
| 185 | ← 099 (#268, en prod 17-nov) |
| 186 | ← 130 (#271, en prod 17-nov) |
| 187 | ← 131 (#272, en prod 17-nov) |
| 188 | ← 132 (#273, en prod 17-nov) |
| 189 | ← 133 (cron `satori-ventas-dia-contador`, 1 y 16 a las 07:00 CR; en prod 18-nov, jobid 10; PASE-189) |
| 190 | ← 134 (`pos_ventas_resumen`, Ventas v2 «Resumen»; en prod 18-nov por #291; PASE-190) |
| 191 | ← 135 (cierra la fuga de la 067: personal solo lo suyo, manager sus locales; + `pos_nombres_por_login`; #292, en prod 18-nov; PASE-191) |
| 192 | ← 137 (`propinas_cada_uno_lo_suyo`: lectura de `tip_entries`, cada uno lo suyo; #295, en prod 18-nov; PASE-192) |
| 193 | ← 136 (`pos_ventas_tiempos`: horas de todos los canales, tiempo sentado, `pos_mesas_internas` + `pos_ventas_internas`; #294, en prod 18-nov; PASE-193) |
| 194 | ← 138 (`mi_rendimiento_equipo`: el equipo en agregados; #296, en prod 18-nov; PASE-194) |


## 🔒 Abierto que sigue vigente
- **Seguridad en prod:** 4 `SECURITY DEFINER` ejecutables por `anon` (`get_my_role`, `handle_new_user`, `log_movement_edit`, `unif_on_cash_movement`); sin `supabase/config.toml`.
- **Caja · documentos huérfanos al borrar un movimiento** (`delete_movement_cascade`): después del piloto, con firma.
