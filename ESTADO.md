# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-07-30.** `main` = **`8d41d1a`** en PROD: el **POZO ÚNICO** (validado 22/07, primer
> cierre real **cuadró**) **más los 3 pases de jul-2026** ya en prod — **vista del empleado**
> (Mi Rendimiento), **Reporte de Ventas** (comparaciones mismos-días + YoY + proyección) y el panel
> **"Nombres en ventas sin asignar"**. Los tres con **código real** en `main` (ya no "arriba solo docs").
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

El modelo viejo se enteraba de la plata por **tres canales** (ledger de Caja Fuerte · campos
sellados `propinas_m/n` · ninguno) y una misma fila podía restar **dos veces o ninguna**. Eso
produjo el sobrante de ₡58.737,07 del 18/07 y el "hueco 2" no uniforme.

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
| `main` | **`8d41d1a`** | **PROD, en uso.** Todo lo no-PoS: ola 2026-07 + Caja/Cierre/USD/Revisión/asistente + Bandeja + propinas ef/elec + Proveedores + elegibilidad de propina por rol + **el POZO completo** + los **3 pases de jul-2026** (vista del empleado · Reporte de Ventas · panel "Nombres en ventas sin asignar"). **SIN PoS.** |
| `staging` | **`1b79265`** | **Fuente de verdad del desarrollo.** Todo lo de `main` **+ PoS/KDS/comandero + FE (SIM) + inventario activo COGS** (migs 022–037). ⚠️ Su base está en **CERO** (vaciada a pedido del dueño para pruebas limpias — ver [ARRANQUE-CERO.md](scripts/refresh-staging/ARRANQUE-CERO.md)). |

> **Supabase refs:** **PROD = `yiczgdtirrkdvohdquzf`** · **STAGING = `hwiatgicyyqyezqwldia`**.
> 🛑 **RITUAL antes de CUALQUIER comando de base:** `cat supabase/.temp/project-ref` **y**
> `supabase/.temp/linked-project.json` (**SÍ existe**; su `name` — hoy `satori-staging` — es el
> desempate del entorno). **`db query --linked` CUELGA** en algunos entornos → workaround: curl a
> la Management API (`POST /v1/projects/<ref>/database/query`, token del Keychain, servicio
> `Supabase CLI`). Para PROD usar **siempre** el canal firmado de
> [`prod-gate.ts`](scripts/t0-reconciliacion-cajas/prod-gate.ts) (`read_only:true` + smoke `25006`).

⚠️ **La divergencia `main`/`staging` CRECE.** Los pases entran a prod por ramas construidas **desde
`main`** (nunca por merge de staging, que arrastra el PoS). El **merge `main → staging`** para
re-sincronizar la parte común quedó **hecho el 2026-07-23**. Para volver staging a espejo de prod:
runbook [`scripts/refresh-staging/`](scripts/refresh-staging/PLAN.md).

## (b) PROD vs solo-STAGING

**En PROD (`main`) — validado físicamente:** ventas/analítica · propinas (incl. efectivo/electrónico
y elegibilidad por rol) · caja (turnos + cierre 2 fases + movimientos + pendientes) · **🆕 el POZO**
· finanzas/P&L · reportes+emails · admin · auth Fase 2 · realtime · offline · Bandeja unificada +
Revisión de inventario · Proveedores (lista simple + buscador + 'Puntual' + Rechazar).

**Solo en STAGING:** **el PoS completo** (catálogo/salón, comandero, KDS, cobro+splits+ticket SIM,
FE estructura SIM, inventario activo COGS) — migs 022–037. **DIFERIDO**, bloqueado por el pilar de
auth. **En rama aparte (sin merge):** `propina-pool` (espera decisión del dueño).

## (c) Migraciones — el ledger vivo (reconciliado 2026-07-27)

Herramientas read-only del ledger → [`scripts/ledger-reconciliacion/`](scripts/ledger-reconciliacion/README.md).

| Entorno | En el ledger (`schema_migrations`) | Aplicadas FUERA del ledger (verificadas por objeto) |
|---|---|---|
| **PROD** | **✅ 33 filas: 001–008, 0090, 0095, 010–021, 038–046, 048, 049** — B2 reconcilió (2026-07-27) | **solo el subset core de la 026** (sin archivo en `main`) → excepción permanente |
| **STAGING** | **✅ 49 filas: 001–008, 0090, 0095, 010–046, 048, 049** — `db push` al día | **ninguna** — B1 las registró todas |

- **El rediseño del pozo no agregó ni una migración.** Es código puro + **1 fila** de datos (el asiento).
- **✅ B1 (staging, 2026-07-23):** las 9 out-of-band quedaron registradas; el `035` dejó de ser fantasma
  (su archivo se trajo de `propina-pool` — solo el DDL, el **código** de la feature sigue sin mergear); el
  `009` se resolvió renombrando a `0090_user_selfsignup.sql` + `UPDATE` de 1 fila → **`db push` DESBLOQUEADO**.
- **⚠️ El `009` NO era la base, era el CLI:** ordena archivos por **nombre** y el ledger por **versión**, y los
  órdenes eran opuestos (`0095…` < `009…` porque `'5'` < `'_'`). Persiste en CLI **2.109.1** → el fix es el
  nombre. **Si volvés a numerar `NNN` + `NNNx`, revisá esto.**
- **🚫 NUNCA `repair --status reverted` sobre algo aplicado** (el CLI lo sugiere para `009`/`035`): le mentiría
  al ledger sobre plata real.
- **026 subset core (PROD)** aplicado sin archivo en `main` → **excepción permanente documentada**, no se repara.
  **047 RESERVADA** (proveedores): el hueco 046 → 048 es intencional.
- **✅ B2 (prod, 2026-07-27, con firma):** 28 `repair --status applied` (con `0090`) → ledger de prod **4 → 33
  filas**, `migration list` alineado sin huérfanos; **mig 049** (`revoke all … from public, anon`) aplicada por
  `db push` → `delete_movement_cascade` y `mark_factura_verified` pasan a **`anon`=false** (ACL de prod 5/10 →
  **3/10**). PROD ya no arrastra deuda de ledger: **incompleto → reconciliado**.
- **🆕 mig `050_employee_pos_name.sql` = repo-truth de `employees.pos_name`.** La columna ya vive en prod y
  staging (agregada **fuera de banda**); la migración es **idempotente** (`add column if not exists`) → **no-op**
  donde ya existe, **cero cambio de datos**, **cero PoS**. **NO está aplicada por el ledger** (no cuenta entre las
  33 filas de prod); queda en el repo esperando un `db push` **firmado** si alguna vez se corre.

## (d) Build por módulo

Gate de todo pase: **`npm run build` → EXIT 0** (`tsc -b`; **`tsc --noEmit` es FALSO VERDE** por el
`tsconfig` raíz con `files:[]`) + suite completa verde. El check **"Supabase Preview"** es **rojo
crónico ajeno**; los que valen son `build`+`deploy` (Pages) y `Cloudflare Pages`.

Leyenda: ✅ en prod y validado en piso · 🟢 en prod, smoke pendiente · 🧪 solo staging.

| Módulo | Estado | Dónde |
|---|---|---|
| **🆕 POZO ÚNICO** (corte · asiento de arranque · tarjeta · "debería" del cierre · guard de cadena) | **✅ VALIDADO EN PROD** — primer cierre real (22/07) **CUADRÓ** | prod + staging |
| **🆕 Paginación del fetch** (`.range()` en loop de 500 **con desempate por `id`**) | ✅ VALIDADO EN PROD | prod + staging |
| **🆕 Tarjeta de Movimientos al pozo** post-corte + filtro `DESDE`=corte por defecto | ✅ VALIDADO EN PROD | prod + staging |
| **🆕 CashTurno**: "Gastado efectivo" suma otros egresos · Resumen del Turno reconstruible | ✅ VALIDADO EN PROD | prod + staging |
| Ventas · Propinas · Caja+cierre · Finanzas/P&L · Reportes · Admin · Auth · Realtime · Offline · Estabilidad (Olas 1/1.1 · pantalla negra · IDOR · outbox · render Propinas) | ✅ | prod (sagrados) |
| Bandeja unificada + Revisión · Tier 3 · autorización por contraseña (045) · propinas ef/elec (046) · elegibilidad por rol (048) · TipStats por puesto | ✅ | prod + staging |
| **🆕 Vista del empleado** (Mi Rendimiento: período global + propinas + métricas por PAX + gráfico Semana) · **🆕 Reporte de Ventas** (comparaciones mismos-días + YoY + proyección) · **🆕 panel "Nombres en ventas sin asignar"** | ✅ **EN PROD** (jul-2026) | prod + staging |
| Quick-wins C2 (historial over/short) + C3 (email del cierre, Edge Fn `cierre-email`) | 🟢 | prod + staging |
| PoS (comandero/KDS/cobro/ticket SIM) · FE SIM · Inventario activo COGS | 🧪 | staging (migs 022–037) |

> **Vínculo empleado↔ventas = `employees.pos_name`** (columna viva; mig 050 solo la registra, §c). El plan
> original de una columna nueva `ventas_nombre` quedó **SUPERADO**: se reusó `pos_name`, sin columna nueva.

## (e) Pendientes de PLATA — esperan FIRMA del dueño

1. **🖊️ T3 — endurecimiento de caja.** Sesión propia; los ítems que tocan plata van con firma.
   Detalle en [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).
2. **🖊️ SPEC notificación a proveedores** — firma + **mig 047** (reservada) + tarea de DNS.
3. **🖊️ Edición de propinas en Historial por CAJERO** con autorización de gerencia — FIRMADO
   2026-07-17, sin construir. Patrón mig 045 `requireManager`. Plata-adyacente.
4. **🖊️ Foto de comprobante obligatoria al pagar propina** — firmado, DIFERIDO.
5. **🖊️ `propina-pool`** (rama, sin merge) — ¿propina de tarjeta/SINPE al mismo pool que efectivo?
6. **🖊️ Reconciliación prod-vs-Excel** — **ahora es viable**: el pozo da **UN número por día**.

> **Tier 1 (monto-on-modify desde Revisión) = DESCARTADO por el dueño.** No reabrir sin nueva firma.

## (f) Pendientes humanos / fiscales / técnicos

1. **✅ Reconciliación del ledger de migraciones** (§c) — A + B1 (staging) + **B2 (prod, 2026-07-27)**.
   Reconciliado en **ambos entornos**; `db push` desbloqueado (mig 050 espera un push firmado, §c).
2. **✅ Mergear `main → staging`** — hecho **2026-07-23**; la parte común quedó re-sincronizada.
3. **🖊️👁️ Hora-CR en bordes de período** — las queries de plata acotan `created_at` en **UTC** (+6h vs
   CR) → un cierre de noche puede caer en el período equivocado. **Cambia números → valida el dueño.**
4. **🧾 FE-CR** (factura electrónica real) — hoy solo estructura SIM en staging.
5. **🚧 PILAR — arquitectura de sesión/auth escalable y multi-tenant.** **Bloquea el gran pase del PoS.**
6. **🧹 Limpieza de datos:** 2 huérfanos de **fecha imposible** — `9b79e731` (2020-07-09, ₡74.126,92)
   y uno de 2016 (₡54.978). **La app NO los muestra** (el fetch arranca 1.000 días atrás), por eso la
   verificación de pantalla no los ve. Van en T3.
7. **🧹 Comentarios "la dueña" → "el dueño"** en el código (el dueño es hombre; hay comentarios viejos
   mal generizados). Cosmético, sin riesgo.

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)

`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja (la matemática
del "debería") · cobro/vuelto/conversión · `posFiscal`.

**Gate de todo pase:** byte-idénticos contra la rama destino, **verificado por hash de blob**, no solo
por `git diff`:

| archivo | hash en `main` |
|---|---|
| `src/shared/utils/tipCalculations.ts` | **`7603ba5a`** |
| `src/modules/cash/cashUtils.ts` | **`b597c697`** |

> ⚠️ `posFiscal.ts` y `computeTotals` **no existen como archivo en `main`** (posFiscal sí en `staging`):
> chequearlos en `main` pasa **en vacío**. Los sagrados reales de `main` son los dos de arriba.
> El rediseño del pozo **no tocó ninguno**: `saldoCajaFuerte` sigue vivo y sirve al pre-corte.

## Notas que ahorran una sesión

- **Flake TZ de tests: MUERTO.** Los fixtures usaban `new Date().toISOString()` (UTC) contra un filtro
  con `todayCR()` → 5 tests fallaban solo de noche. Corregido a `todayCR()`. **No re-diagnosticar.**
- **Falso 200 al verificar un deploy:** pedir un asset por el hash del build **local** siempre devuelve
  200 — el fallback SPA responde el `index.html` (~2,7 kB). Verificar **caminando el grafo de chunks**
  desde el entry y comprobando **tamaño y contenido**, nunca el código HTTP.
- **`database.ts` puede mentir la nullability** vs `supabase.gen.ts` (la verdad). Las lecturas castean
  la fila cruda (`data as T[]`), así que los NULL fluyen sin coerción y **solo revientan con datos viejos**.
- **El SOP interino de recategorizar un pago de proveedor a `Caja Fuerte` queda RETIRADO** — era el
  parche al bug que el pozo eliminó de raíz. **No aplicarlo más.**
