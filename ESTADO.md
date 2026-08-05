# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-08-05** → [HANDOFF-2026-08-05.md](HANDOFF-2026-08-05.md). Hoy, **2 pases a PROD firmados** que
> cierran la ola de propinas y el bloque de plata: (1) **plata ítems 2+3** (negativos MANUALES prohibidos +
> `ajuste_tipo` derivado del signo) → `8c65686`; (2) **`pool_total_crc` = fuente de verdad del total del pool**
> (mig 051 + escritura al cerrar/editar + backfill de **266 sesiones**) → **`5e85abc`**. Julio 2026 =
> **₡2.167.131** en TODOS los reportes. Sagrados byte-idénticos; **mig 051 aplicada OUT-OF-BAND en staging Y prod**
> (sin `schema_migrations`), cero `db push`. `main` = **`5e85abc`** · `staging` = **`129a516`**. El **POZO ÚNICO**
> sigue ✅ validado en prod desde el 22/07 (primer cierre real **cuadró**).
>
> **La cadena de propinas quedó CERRADA:** los 6 consumidores del pool clasifican sala↔barra por `covered_role`
> (canónico) y **`pool_total_crc` es la fuente única** del total. ⚠️ La rama `metas_personales` también usa mig
> **051** → **renumerar a `052+`** antes de que vaya a staging. Historia previa (ítems 6+4 `b36a382`, `covered_role`
> en correo/Estadísticas `723f734`, Quincenal `a6192cd`) → [HANDOFF-2026-08-03.md](HANDOFF-2026-08-03.md).
>
> Historia detallada → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) · Fases → [ROADMAP.md](ROADMAP.md) ·
> Backlog → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · Hallazgos → [HALLAZGOS.md](HALLAZGOS.md) ·
> SPECs → [docs/README.md](docs/README.md) · Acta del pase → [PASE-POZO-A-PROD.md](PASE-POZO-A-PROD.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → PROD (GitHub Pages, base `/satori-app/`) · `staging` → Cloudflare Pages.

---

## 🟢 EL MODELO DEL POZO — lo que hay que entender antes de tocar caja

**Firmado por el dueño (2026-07-22).** Todo movimiento de **efectivo físico** afecta **un solo
saldo, exactamente una vez**. Las tres cajas (Caja Fuerte · Caja Proveedores · Registradora) son
bolsillos del mismo pozo; **Banco no es efectivo**. Restaura la lógica del repo viejo
(`satori-caja`/`buildSaldos`) que la app había perdido al portarse.

El modelo viejo contaba la plata por **tres canales** distintos y una misma fila podía restar
**dos veces o ninguna** (de ahí el sobrante de ₡58.737,07 del 18/07) — detalle en
[PASE-POZO-A-PROD.md](PASE-POZO-A-PROD.md).

**Corte hacia adelante:** `POZO_CORTE = '2026-07-22'`. Los días anteriores se calculan y se ven
**exactamente como siempre** — el histórico no se toca. Desde el corte, modelo nuevo.

> ⚠️ **El corte NO alcanza solo.** La tarjeta y el "debería" cuentan desde el **asiento de
> arranque** (`fechaAperturaPozo`), no desde el corte. Sin asiento, el saldo se calcula sobre
> TODO el ledger y da un número inservible. En prod el asiento es **`296d032d`** ·
> *'Apertura pozo 2026-07-22'* · **₡744.570 / $3.441** (único write autorizado a prod).

Núcleo: [`pozo.ts`](src/modules/cash/pozo.ts) (puro) · [`cierrePozo.ts`](src/modules/cash/cierrePozo.ts)
(corte, "debería", guard de cadena) · [`tarjetaPozo.ts`](src/modules/cash/tarjetaPozo.ts) (la tarjeta).

## (a) Ramas y proyectos Supabase

| Rama | Hash | Qué es |
|---|---|---|
| `main` | **`5e85abc`** | **PROD, en uso.** Todo lo no-PoS: ola 2026-07, Caja/Cierre/USD/Revisión, Bandeja, propinas ef/elec **+ `covered_role` en TODOS los reportes** (correo/Estadísticas/Historial + **Quincenal** "Total mes"=pool) **+ `pool_total_crc` fuente de verdad del total del pool** (mig 051 + backfill 266, `5e85abc`), Proveedores, elegibilidad por rol, **el POZO**, el **endurecimiento de caja ítems 6+4** (Ingreso adicional + guard de fechas) y el **bloque de plata ítems 2+3** (negativos manuales prohibidos + `ajuste_tipo` por signo, `8c65686`). **SIN PoS.** |
| `staging` | **`129a516`** (sobre el reconciliado `7fb8f41`: docs `db4bbc2` + **plata 2+3** `6479eb8` + **`pool_total_crc`** `129a516`) | **Fuente de verdad del desarrollo** = `main` **+ PoS/KDS/comandero + FE (SIM) + inventario COGS**. Parte común **idéntica** a main (contrato en §b). ⚠️ Su base está en **CERO** ([ARRANQUE-CERO.md](scripts/refresh-staging/ARRANQUE-CERO.md)). |

> **Refs:** **PROD = `yiczgdtirrkdvohdquzf`** (`satori-app`) · **STAGING = `hwiatgicyyqyezqwldia`**
> (`satori-staging`).
> 🛑 **RITUAL antes de CUALQUIER comando de base:** `cat supabase/.temp/project-ref` **y**
> `supabase/.temp/linked-project.json` (existe, y su `name` es el desempate). **`db query --linked`
> CUELGA** → ir por Management API (`POST /v1/projects/<ref>/database/query`, token del Keychain,
> servicio `Supabase CLI`). Para PROD, **siempre** el canal firmado de
> [`prod-gate.ts`](scripts/t0-reconciliacion-cajas/prod-gate.ts) (`read_only:true` + smoke `25006`).

## (b) PROD vs solo-STAGING

**En PROD (`main`) — validado físicamente:** ventas/analítica · propinas (incl. efectivo/electrónico
y elegibilidad por rol) · caja (turnos + cierre 2 fases + movimientos + pendientes) · **🆕 el POZO**
· finanzas/P&L · reportes+emails · admin · auth Fase 2 · realtime · offline · Bandeja unificada +
Revisión de inventario · Proveedores (lista simple + buscador + 'Puntual' + Rechazar).

**Solo en STAGING:** **el PoS completo** (catálogo/salón, comandero, KDS, cobro+splits+ticket SIM,
FE estructura SIM, inventario activo COGS) — migs 022–037. **DIFERIDO**, bloqueado por el pilar de
auth. **En rama aparte (sin merge):** `propina-pool` (espera decisión del dueño).

### 📜 CONTRATO DE DIVERGENCIA — qué hay solo en STAGING (congelado 2026-07-23)

`git diff main..staging --name-only` = **75 archivos**, **cero de plata** (`tipCalculations`,
`cashUtils`, `cierre*`, caja, propinas, finanzas son **byte-idénticos**).

| Categoría | Nº | Qué |
|---|---|---|
| PoS/FE/inventario | 45 | `src/modules/pos/`, `posFiscal`/`posCobro`/`kds`/`comanderoMenu`… (+tests), `print-bridge/`, migs 022–034/036/037 |
| Enganche del PoS en archivos comunes | 4 | `App.tsx` (rutas), `HomePage.tsx` (rol salonero), `AdminModule.tsx` (pestaña PoS), `UserApprovals.tsx` (texto) |
| Config de Cloudflare | 2 | `public/_headers` (+) · `public/_redirects` (−) |
| Limpiezas que staging hizo y `main` no | 5 | `api/auth.ts` muerto · 3 assets sin uso · `_redirects` → **deuda de main** |
| Docs de trabajo | 11 | `docs/research/`, PROMPT-T*, `_handoff/`… |
| **Excepciones de la Fase B1** | 2 | `035_propina_pos_pool.sql` (solo DDL, feature sin mergear) · rename `009`→`0090` (`R100`) → **replicado en `main` (B2, 2026-07-27) ✅** |

**Cualquier archivo que difiera y NO entre en esas categorías es DEUDA, no divergencia legítima.**
Lista archivo por archivo → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md#-2026-07-23--re-sync-mainstaging--reconciliación-del-ledger-fase-a--b1).

## (c) Migraciones — el ledger vivo (auditado 2026-07-23)

> Diagnóstico + plan → [`_handoff/FASE-A-LEDGER-2026-07-23.md`](_handoff/FASE-A-LEDGER-2026-07-23.md) ·
> herramientas read-only → [`scripts/ledger-reconciliacion/`](scripts/ledger-reconciliacion/README.md) ·
> backups del ledger → `_handoff/ledger-*.json`.

| Entorno | En el ledger (`schema_migrations`) | Aplicadas FUERA del ledger (verificadas por objeto) |
|---|---|---|
| **PROD** | **✅ 33 filas: 001–008, 0090, 0095, 010–021, 038–046, 048, 049** — B2 reconcilió (2026-07-27) | subset core de la `026` (sin archivo en `main`) + **mig `051`** (`pool_total_crc`, 2026-08-05) |
| **STAGING** | **✅ 49 filas: 001–008, 0090, 0095, 010–046, 048, 049** — `db push` al día | **mig `051`** (`pool_total_crc`, 2026-08-05) — el `db push` volvió a estar frenado por el ledger |

- **El rediseño del pozo no agregó ni una migración.** Es código puro + **1 fila** de datos (el asiento).
- **B1 ✅ (staging, 2026-07-23):** el `035` dejó de ser fantasma (su archivo se trajo de
  `propina-pool` — solo el DDL; el **código** de la feature sigue sin mergear) · las 9 out-of-band
  quedaron registradas · el `009` se resolvió renombrando a `0090_user_selfsignup.sql` + `UPDATE` de
  1 fila → **`db push` DESBLOQUEADO**.
- **⚠️ El `009` NO era la base, era el CLI:** ordena archivos por **nombre** y el ledger por
  **versión**, y los órdenes eran opuestos (`0095_drift…` < `009_user…` porque `'5'`=53 < `'_'`=95).
  Persiste en CLI **2.109.1** → el fix es el nombre. **Si volvés a numerar `NNN` + `NNNx`, revisá esto.**
- **🚫 NUNCA `repair --status reverted` sobre algo aplicado** (el CLI lo sugiere para `009` y `035`):
  le mentiría al ledger sobre plata real.
- **`026` subset core (PROD):** aplicado sin archivo en `main` → **decidido: excepción permanente
  documentada**, no se repara. **047 RESERVADA** (proveedores): el hueco 046→048 es intencional.
- **🆕 mig `051` (`pool_total_crc`) — OUT-OF-BAND en STAGING y PROD (2026-08-05):** `ADD COLUMN IF NOT
  EXISTS pool_total_crc numeric` aplicada por Management API (`read_only:false`), **sin tocar
  `schema_migrations`** (el `db push` sigue frenado por el ledger). El backfill de las sesiones closed
  (**266 prod / 2 staging**) escribió **solo `pool_total_crc`** — checksum de las demás columnas idéntico
  antes/después. **⚠️ Colisión:** la rama `metas_personales` también reserva **051** → **renumerar a
  `052+`** antes de que vaya a staging.
- **✅ B2 (prod, 2026-07-27, con firma):** 28 `repair --status applied` (con `0090`) → ledger de prod
  **4 → 33 filas**, `migration list` alineado sin huérfanos; **rename `009`→`0090` replicado en `main`**
  por FF (cierra `R100` del §b); **mig 049** (`revoke all ... from public, anon`) aplicada por `db push`
  → `delete_movement_cascade` y `mark_factura_verified` pasan a **`anon`=false** (ACL de prod: 5/10 →
  **3/10**). Backups: `_handoff/ledger-prod-2026-07-27-{pre,post}-B2.json`. CLI devuelto a staging;
  el tooling `ledger-reconciliacion` se portó a `main`. PROD ya no arrastra deuda de ledger:
  **incompleto → reconciliado**.

## (d) Build por módulo

Gate de todo pase: **`npm run build` → EXIT 0** (`tsc -b`; **`tsc --noEmit` es FALSO VERDE** por el
`tsconfig` raíz con `files:[]`) + suite verde (**559 tests** en staging · 479 en prod). El check
**"Supabase Preview"** es **rojo crónico ajeno**; valen `build`+`deploy` (Pages) y `Cloudflare Pages`.

Leyenda: ✅ en prod y validado en piso · 🟢 en prod, smoke pendiente · 🧪 solo staging.

| Módulo | Estado |
|---|---|
| **POZO ÚNICO** (corte · asiento de arranque · tarjeta · "debería" · guard de cadena) | **✅ VALIDADO EN PROD** — 1er cierre real (22/07) **cuadró** |
| Paginación del fetch (`.range()` de 500 con desempate por `id`) · Tarjeta de Movimientos post-corte · CashTurno reconstruible | ✅ VALIDADO EN PROD |
| Ventas · Propinas · Caja+cierre · Finanzas/P&L · Reportes · Admin · Auth · Realtime · Offline · Estabilidad (Olas 1/1.1, pantalla negra, IDOR, outbox) | ✅ prod (sagrados) |
| Bandeja unificada + Revisión · Tier 3 · autorización por contraseña (045) · propinas ef/elec (046) · elegibilidad por rol (048) · TipStats por puesto | ✅ prod + staging |
| **Propinas — pool por `covered_role`** en los **6 consumidores** (cierre · edición · Historial · Estadísticas · Quincenal · correo) = **₡2.167.131** (Jul) **+ `pool_total_crc` = fuente única del total** (persistido al cerrar/editar + backfill de 266; Historial lo muestra sin recomputar). Correo replica `calcTurno.totalPool` (`monthly-report/pool.ts` + oracle test). | ✅ **prod + staging** (correo/Est./Hist. `723f734` · Quincenal `a6192cd` · **`pool_total_crc` `5e85abc`**) |
| **Endurecimiento de caja — ítems 6 (Ingreso adicional: categoría+motivo+umbral) + 4 (guard de fechas: apertura hoy · backdateo por rol)** | ✅ **prod + staging** (`b36a382`→`723f734`) |
| **Bloque de plata — ítems 2 (negativos MANUALES prohibidos: 4 puntos de carga) + 3 (`ajuste_tipo` del cierre derivado del signo)** | ✅ **prod + staging** (`8c65686`) |
| Quick-wins C2 (historial over/short) + C3 (email del cierre, Edge Fn `cierre-email`) | 🟢 smoke pendiente |
| PoS (comandero/KDS/cobro/ticket SIM) · FE SIM · Inventario activo COGS | 🧪 staging (migs 022–037) |

## (e) Pendientes de PLATA — esperan FIRMA del dueño

1. **T3 — endurecimiento de caja** (sesión propia; los ítems de plata van con firma).
2. **SPEC notificación a proveedores** — firma + **mig 047** (reservada) + tarea de DNS.
3. **Edición de propinas en Historial por CAJERO** con autorización de gerencia — firmado
   2026-07-17, sin construir. Patrón mig 045 `requireManager`.
4. **Foto de comprobante obligatoria al pagar propina** — firmado, DIFERIDO.
5. **`propina-pool`** (rama, sin merge) — ¿propina de tarjeta/SINPE al mismo pool que efectivo?
6. **Reconciliación prod-vs-Excel** — **ahora viable**: el pozo da **UN número por día**.

> **Tier 1 (monto-on-modify desde Revisión) = DESCARTADO por el dueño.** No reabrir sin nueva firma.

## (f) Pendientes humanos / fiscales / técnicos

1. **✅ Ledger** (§c) — A + B1 (staging) + **B2 (prod) ✅ 2026-07-27**. Reconciliado en ambos entornos.
2. **🔐 `revoke … from anon` — medido y endurecido en las 2 RPC de plata.** Prod dio **5/10**
   ejecutables por `anon`; la **mig 049** cerró `delete_movement_cascade` y `mark_factura_verified`
   → **3/10** (quedan `get_my_role` + 2 triggers, diferidos). Staging 12/17 → **10/17** (las `pos_*`
   con el pase del PoS). Ver [HALLAZGOS.md](HALLAZGOS.md).
3. **👁️ Hora-CR en bordes de período** — las queries de plata acotan `created_at` en **UTC** (+6h vs
   CR) → un cierre de noche puede caer en el período equivocado. **Cambia números → valida el dueño.**
4. **🧾 FE-CR** (factura electrónica real) — hoy solo estructura SIM en staging.
5. **🚧 PILAR — sesión/auth escalable y multi-tenant.** **Bloquea el gran pase del PoS.**
6. **🧹 Limpieza de datos:** 2 huérfanos de fecha imposible — `9b79e731` (2020-07-09, ₡74.126,92) y
   uno de 2016 (₡54.978). **La app NO los muestra** (el fetch arranca 1.000 días atrás). Van en T3.
7. **🧹 Comentarios "la dueña" → "el dueño"** en el código. Cosmético, sin riesgo.

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)

`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja (la matemática
del "debería") · cobro/vuelto/conversión · `posFiscal`.

**Gate de todo pase:** byte-idénticos contra la rama destino, **por hash de blob**, no por `git diff`:
`tipCalculations.ts` → **`7603ba5a`** · `cashUtils.ts` → **`b597c697`** (ambos en `main`).

> ⚠️ `posFiscal.ts` y `computeTotals` **no existen como archivo en `main`** (posFiscal sí en
> `staging`): chequearlos contra `main` pasa **en vacío**. El pozo **no tocó ninguno** —
> `saldoCajaFuerte` sigue vivo y sirve al pre-corte.

## Notas que ahorran una sesión

- **Flake TZ de tests: MUERTO.** Los fixtures usaban `new Date().toISOString()` (UTC) contra un filtro
  con `todayCR()` → 5 tests fallaban solo de noche. Corregido a `todayCR()`. **No re-diagnosticar.**
- **Falso 200 al verificar un deploy:** pedir un asset por el hash del build **local** siempre devuelve
  200 — el fallback SPA responde el `index.html` (~2,7 kB). Verificar **caminando el grafo de chunks**
  desde el entry y comprobando **tamaño y contenido**, nunca el código HTTP. Script listo:
  [`scripts/verificar-deploy-cloudflare.sh`](scripts/verificar-deploy-cloudflare.sh).
- **`database.ts` puede mentir la nullability** vs `supabase.gen.ts` (la verdad). Las lecturas castean
  la fila cruda (`data as T[]`), así que los NULL fluyen sin coerción y **solo revientan con datos viejos**.
- **El SOP interino de recategorizar un pago de proveedor a `Caja Fuerte` queda RETIRADO** — era el
  parche al bug que el pozo eliminó de raíz. **No aplicarlo más.**
