# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-07-23** → [HANDOFF-2026-07-23.md](HANDOFF-2026-07-23.md). Hoy: **re-sync
> `main → staging`** + **reconciliación del ledger** (Fase A + B1 → `db push` destrabado en staging).
> El **POZO ÚNICO** sigue ✅ validado en prod desde el 22/07 (primer cierre real **cuadró**).
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
| `main` | **`c77ced0`** (código de app = `1c8a9ad`; arriba solo docs) | **PROD, en uso.** Todo lo no-PoS: ola 2026-07, Caja/Cierre/USD/Revisión, Bandeja, propinas ef/elec, Proveedores, elegibilidad por rol y **el POZO**. **SIN PoS.** |
| `staging` | **`02a012f`** | **Fuente de verdad del desarrollo** = `main` **+ PoS/KDS/comandero + FE (SIM) + inventario COGS**. Parte común **idéntica** a main (contrato en §b). ⚠️ Su base está en **CERO** ([ARRANQUE-CERO.md](scripts/refresh-staging/ARRANQUE-CERO.md)). |

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
| **Excepciones de la Fase B1** | 2 | `035_propina_pos_pool.sql` (solo DDL, feature sin mergear) · rename `009`→`0090` (`R100`) → **replicar en `main` en B2** |

**Cualquier archivo que difiera y NO entre en esas categorías es DEUDA, no divergencia legítima.**
Lista archivo por archivo → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md#-2026-07-23--re-sync-mainstaging--reconciliación-del-ledger-fase-a--b1).

## (c) Migraciones — el ledger vivo (auditado 2026-07-23)

> Diagnóstico + plan → [`_handoff/FASE-A-LEDGER-2026-07-23.md`](_handoff/FASE-A-LEDGER-2026-07-23.md) ·
> herramientas read-only → [`scripts/ledger-reconciliacion/`](scripts/ledger-reconciliacion/README.md) ·
> backups del ledger → `_handoff/ledger-*.json`.

| Entorno | En el ledger (`schema_migrations`) | Aplicadas FUERA del ledger (verificadas por objeto) |
|---|---|---|
| **PROD** | **solo 4 filas: 018–021** | **001–017 + 0095 + 038–046 + 048** (28) **+ subset core de la 026** (sin archivo en `main`) |
| **STAGING** | **✅ 48 filas: 001–008, 0090, 0095, 010–046, 048** — `db push` al día | **ninguna** — B1 las registró todas |

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
- **Falta B2 (prod):** 28 repairs + replicar el rename `009`→`0090` + medir el ACL de
  `delete_movement_cascade`. ⚠️ `repair` va por el **CLI linkeado** (hoy en staging) → el re-link es
  el riesgo. PROD **no tiene filas sin archivo**: su historial está **incompleto, no divergido**.

## (d) Build por módulo

Gate de todo pase: **`npm run build` → EXIT 0** (`tsc -b`; **`tsc --noEmit` es FALSO VERDE** por el
`tsconfig` raíz con `files:[]`) + suite verde (**490 tests** en staging). El check
**"Supabase Preview"** es **rojo crónico ajeno**; valen `build`+`deploy` (Pages) y `Cloudflare Pages`.

Leyenda: ✅ en prod y validado en piso · 🟢 en prod, smoke pendiente · 🧪 solo staging.

| Módulo | Estado |
|---|---|
| **POZO ÚNICO** (corte · asiento de arranque · tarjeta · "debería" · guard de cadena) | **✅ VALIDADO EN PROD** — 1er cierre real (22/07) **cuadró** |
| Paginación del fetch (`.range()` de 500 con desempate por `id`) · Tarjeta de Movimientos post-corte · CashTurno reconstruible | ✅ VALIDADO EN PROD |
| Ventas · Propinas · Caja+cierre · Finanzas/P&L · Reportes · Admin · Auth · Realtime · Offline · Estabilidad (Olas 1/1.1, pantalla negra, IDOR, outbox) | ✅ prod (sagrados) |
| Bandeja unificada + Revisión · Tier 3 · autorización por contraseña (045) · propinas ef/elec (046) · elegibilidad por rol (048) · TipStats por puesto | ✅ prod + staging |
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

1. **🟠 Ledger** (§c) — **B1 ✅ staging**; falta **B2 (prod)**.
2. **🔐 `revoke … from anon` inefectivo — 12 de 17 `SECURITY DEFINER` ejecutables por `anon`**
   (mitigadas por guard de rol interno). Varias están en prod → ver [HALLAZGOS.md](HALLAZGOS.md).
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
