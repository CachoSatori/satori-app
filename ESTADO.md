# Satori App — Estado del proyecto

## ⚡ ARRANQUE — foto real del repo (se REEMPLAZA en cada entrega, no se acumula)
**Al día: 2026-09-11**

- Punteros (verificados contra origin): `main = 3e54aa4` (PROD, intacto) · `staging ≡ integracion/analitica-staging = 35eeaff` (las DOS ramas, mismo hash) · agente del PoS `feat/pos-desglose = 14bd278` (origin y PC sincronizados, corriendo con el fix 388).
- **Ramas canónicas (fijado 2026-09-11):** `staging` e `integracion/analitica-staging` son **la misma verdad** — todo pase va en FF a las DOS (Cloudflare Pages despliega desde `integracion/analitica-staging`). `feat/pos-desglose` = la rama del **agente** que corre en la PC del PoS y publica a Supabase staging. La vieja `origin/staging` de handoffs anteriores es **legado**: la canónica es el par de arriba.
- Sagrados (blob): tipCalculations `7603ba5a` · cashUtils `b597c697` · posFiscal `a3fd445f` (posFiscal solo en staging).
- Migraciones: staging `040–065` (063 desglose fiscal · 064 monto/pax estimado de mesa abierta · 065 `detalle_productos`) · prod `040–054` · próximo libre `066`.
- EN STAGING, validados (todo en staging; `main` intacto): **Frente C** (≈₡ estimado + pax + prom/pax de mesa abierta, provisional, NUNCA entra en neta/Hoy/cuadre) · **atribución de salón por línea** (`claveNoMesero` + lentes A/B en Cajeros, sin doble conteo) · **desplegable de productos por mesa abierta** (mig 065) · **fix 388** (caja de barra = CAJA, `esCajeroTurno`; aplica hacia adelante, histórico pendiente de backfill con firma).
- Auditoría 388 + 266 (read-only, 2026-09-10/11): 388 limpio en código; 266 = fan-out del `LEFT JOIN FAC_Empleados` **confirmado cosmético** (el Edge deduplica por `numero_factura` y la tabla tiene `unique (local, numero_factura)`); sin bug de plata. Detalle → PROYECTO claude.ai.
- Sigue, en orden: (1) backfill histórico 388 (mapa read-only primero; toca datos → firma) · (2) pase de todo a `main` (bloqueado hasta validación física sostenida + firma; ⚠️ auto-aplica 064/065 a prod) · (3) catálogo del PoS (tildes en `FAC_Productos`, fuera de la app). Todo lo que toca plata/esquema/prod = firma.
- Detalle: SPECs/handoffs → PROYECTO claude.ai (no en el repo; CC no lo ve, se le pasa en TEXTO) · historial → ESTADO-ARCHIVO.md · fases → ROADMAP.md · backlog → PROMPT-CONTINUACION.md.

> **Regla (Definition of Done):** ninguna entrega se cierra sin actualizar este bloque ⚡ARRANQUE + su fila de tabla, EN EL MISMO COMMIT.

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> Foto viva → ⚡ ARRANQUE (arriba). Detalle por módulo abajo; historial → ESTADO-ARCHIVO.md.
>
> Detalle histórico → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) · Fases → [ROADMAP.md](ROADMAP.md) ·
> Backlog → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · Hallazgos → [HALLAZGOS.md](HALLAZGOS.md) ·
> SPECs e índice → [docs/README.md](docs/README.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → **PROD** (GitHub Pages, base `/satori-app/`) · `integracion/analitica-staging` (≡ `staging`) → **Cloudflare Pages**.

---

## 🟢 EL MODELO DEL POZO — leer antes de tocar caja

**Firmado por el dueño (2026-07-22), en prod y validado** (el primer cierre real cuadró). Todo movimiento de
**efectivo físico** afecta **un solo saldo, exactamente una vez**: las tres cajas (Caja Fuerte · Caja Proveedores ·
Registradora) son bolsillos del mismo pozo, y **Banco no es efectivo**. Corte: `POZO_CORTE = '2026-07-22'` — lo
anterior se ve **exactamente como siempre**.

> ⚠️ **El corte no alcanza solo:** la tarjeta y el "debería" cuentan desde el **asiento de arranque**
> (`fechaAperturaPozo`); sin asiento, el saldo se calcula sobre TODO el ledger y da un número inservible. En prod
> el asiento es **`296d032d`** · *'Apertura pozo 2026-07-22'* · **₡744.570 / $3.441**.

Núcleo: [`pozo.ts`](src/modules/cash/pozo.ts) · [`cierrePozo.ts`](src/modules/cash/cierrePozo.ts) ·
[`tarjetaPozo.ts`](src/modules/cash/tarjetaPozo.ts). Acta → [PASE-POZO-A-PROD.md](PASE-POZO-A-PROD.md).

## (a) Ramas y proyectos Supabase

| Rama | Hash | Qué es |
|---|---|---|
| `main` | **`3e54aa4`** | **PROD, en uso.** Todo lo no-PoS + **Proveedores Fases A y B** (notificación de pago, saldo a favor con reparto FIFO, comprobantes con imagen por WhatsApp). |
| `staging` **≡** `integracion/analitica-staging` | **`35eeaff`** (las dos) | **Fuente de verdad del desarrollo** = `main` + PoS/KDS/comandero + FE (SIM) + inventario COGS + los **docs de Salarios** (`claude/`) + **Salarios/Empleados U0–U0b** (migs 055–058) + **BioTime Fase 1** (057 + `ingest-punches` + agente en vivo) + **PoS "Nube de Fuego"** (migs 062–065, Edge `ingest-ndf`, módulo Ventas leyendo del PoS, En vivo, Frente C, atribución por línea, fix 388). Son la **misma verdad**: todo FF va a las DOS. Cloudflare Pages despliega desde `integracion/analitica-staging`. Su base está en **CERO** ([ARRANQUE-CERO.md](scripts/refresh-staging/ARRANQUE-CERO.md)). |
| `feat/pos-desglose` | **`14bd278`** | **Rama del AGENTE del PoS** (`pos-bridge/`), la que corre en la PC del PoS (`DESKTOP-25PRDR1`, tarea "Satori PoS Bridge") y publica a Supabase staging vía Edge `ingest-ndf`. Origin y PC sincronizados. **No se mergea a `main`.** |

> **Nombres de rama canónicos (fijado 2026-09-11):** `main` = PROD · `staging` ≡ `integracion/analitica-staging`
> (alineadas, mismo hash, FF a las dos en cada pase) · `feat/pos-desglose` = agente. La `origin/staging` "vieja" que
> citaban handoffs anteriores es **legado**; no hay una tercera verdad.

> **Refs Supabase:** **PROD = `yiczgdtirrkdvohdquzf`** (`satori-app`) · **STAGING = `hwiatgicyyqyezqwldia`** (`satori-staging`).
> 🛑 **RITUAL antes de CUALQUIER comando de base:** `cat supabase/.temp/project-ref` **y** `linked-project.json`
> (su `name` es el desempate). Truco que evita accidentes: **linkear dentro de un git worktree** — el `.temp` es
> propio y el link de staging del árbol principal no se toca.
> 🔌 **Branching ON en prod:** pushear una migración a `main` **la auto-aplica a la base de prod**. El check
> **"Supabase Preview"** verde = ya está aplicada (**no** correr apply/repair después). Detalle →
> [`_handoff/INTEGRACION-SUPABASE.md`](_handoff/INTEGRACION-SUPABASE.md).

## (b) PROD vs solo-STAGING

**En PROD (`main`):** ventas/analítica · propinas (efectivo/electrónico, `covered_role`, `pool_total_crc`) ·
caja completa (**el POZO** + T3 endurecimiento, los 8 ítems) · finanzas/P&L · reportes+emails · admin · auth
Fase 2 · realtime · offline · Bandeja unificada + Revisión de inventario · **Proveedores completo (A+B)**.

**Solo en STAGING:** **el PoS completo** (catálogo/salón, comandero, KDS, cobro+splits+ticket SIM, FE SIM, inventario activo COGS) — migs 022–037, y **`posFiscal.ts` no existe en `main`**. **DIFERIDO**, bloqueado por el PILAR de auth. También **SALARIOS Fase 0** (mig **055** + módulo `src/modules/salarios/` + ruta `/salarios`, owner/manager) y los **docs de Salarios** (`claude/`). En rama aparte sin merge: `propina-pool`.

> ⚠️ **Salarios NO está en prod.** U0 + BioTime Fase 1 viven solo en `staging` (`35eeaff`) y su pase a `main` es **su propio
> ciclo con firma** — la mig `055` toca esquema y, con Branching ON, **pushearla a `main` la aplica a la base de prod**.

> **Contrato de divergencia:** lo legítimo en `main..staging` es **PoS/FE/inventario + config Cloudflare + docs
> de trabajo**. La parte no-PoS de plata/negocio está **convergida**. Cualquier otro archivo que difiera es
> **DEUDA, no divergencia** — lista archivo por archivo en
> [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md#-2026-07-23--re-sync-mainstaging--reconciliación-del-ledger-fase-a--b1).

## (c) Migraciones

| Entorno | Ledger (`schema_migrations`) |
|---|---|
| **PROD** | **✅ 39 filas — contiguo `040–054`** (001–008, 0090, 0095, 010–021, 038–054). **0 pendientes.** |
| **STAGING** | **✅ rango 040–065** (055 F0 · 056 U0a · 057 F1a · 058 U0b · 059 F1d · 060 pago idempotente · 061 hora habitual · **062 PoS ndf** · **063 desglose fiscal** · **064 monto/pax estimado de mesa abierta** · **065 `detalle_productos`**, por `db push`, registradas) + PoS (022–037). |

- **047/053/054 aplicadas a prod el 2026-08-17** con `db push --include-all` desde un worktree linkeado a prod.
  La **047 entró fuera de orden** (después de la 052 ya aplicada) y `--include-all` lo resolvió **sin ningún
  `repair`**. 🚫 **Nunca** `repair --status applied` sobre la 047: la marcaría aplicada **sin crear las columnas**.
- **La 053 hace `create or replace` de `delete_movement_cascade`** (que ya corría en prod): cuerpo de la 044
  **intacto** (autorización, reversa de asientos, borrado, limpieza de docs) + snapshot de aplicaciones de crédito
  + **FASE 6b** que repone el saldo. El `revoke` final quedó más duro (`revoke all … from public, anon`).
- **🚫 NUNCA `repair --status reverted`** sobre algo aplicado: le mentiría al ledger sobre plata real.
- **⚠️ El CLI ordena archivos por NOMBRE y el ledger por VERSIÓN** (por eso `009` → `0090`; persiste en 2.109.1).
  **`026` en PROD = excepción permanente documentada**, no se repara.
- **`055 employees_payroll_master`** (Salarios Fase 0): **aplicada a STAGING el 2026-08-18 con `db push`** (aditiva
  e idempotente, sin backfill, sin tocar RLS ni el enum `user_role`). **NO está en prod.**
- **056 U0a (núcleo nómina) · 057 F1a (esquema de marcas BioTime) · 058 U0b (ciclo de pago + Excel homebanking):** aplicadas a STAGING (`db push`). **NO en prod.**
- **`062 pos_ndf_ingesta`** (puente del PoS "Nube de Fuego", A1): **aplicada a STAGING el 2026-09-04
  con `db push`** desde la rama `deploy/pos-bridge-staging` (= `feat/pos-bridge-a3`, `57b0aa0`).
  Aditiva e idempotente: crea las 4 tablas `pos_ndf_*` + `employees.pos_login` (unique parcial, sin
  backfill) y **no altera ninguna tabla existente** — el único `alter` sobre algo que ya existía es
  el `add column if not exists`. RLS: SELECT para `owner/manager/contador`, **cero policies de
  escritura** (solo la escribe la Edge `ingest-ndf` con service-role). **NO está en prod** y la rama
  **no se mergea**: `main` con Branching ON auto-aplicaría a la base de producción.
  Verificada antes de aplicar sobre un Postgres 16 descartable (2 corridas, misma foto del esquema).
- **059 · 060 · 061 ya estaban en el ledger de staging** al 2026-09-04: `supabase migration list --linked`
  las listó en la columna **Remote** — está confirmado, no es una inferencia del dry-run. Lo único que
  no se leyó son las **fechas exactas de aplicación** de esas tres.
- **`063 pos_ndf_desglose_fiscal`** (valor_servido / iva / regalia / clase_ingreso sobre `pos_ndf_tickets`),
  **`064 pos_ndf_open_monto_pax`** (`monto_estimado_crc numeric(14,2)`, `pax_pedido smallint`, `items_valor
  smallint`, todas nullable — Frente C) y **`065 pos_ndf_open_detalle_productos`** (`detalle_productos jsonb`,
  nullable): **aplicadas SOLO en STAGING y en el ledger**. Aditivas (`add column if not exists`). **NO en prod.**
  ⚠️ Al pasar el paquete PoS a `main`, Branching ON las **auto-aplica a la base de prod**: la firma del pase
  tiene que ser explícita sobre ese efecto.
- **Próximo número libre: `066`.** ⚠️ La rama `metas_personales` también reclamaba
  051/052/053 → **renumerar** antes de traerla.

## (d) Build por módulo

**Gate de todo pase:** `npm run build` → **EXIT 0** (`tsc -b`; ⚠️ **`tsc --noEmit` es FALSO VERDE** por el `tsconfig` raíz con `files:[]`) + suite verde (**685 tests** staging · **525** prod) + **sagrados por hash de blob** + **ESLint delta 0** contra la rama destino.

Leyenda: ✅ en prod y validado en piso · 🟢 en prod, smoke pendiente · 🔲 construido sin validar · 🧪 solo staging.

| Módulo | Estado |
|---|---|
| **POZO ÚNICO** (corte · asiento · tarjeta · "debería" · guard de cadena) | ✅ **VALIDADO EN PROD** (1er cierre real cuadró) |
| Ventas · Propinas · Caja+cierre · Finanzas/P&L · Reportes · Admin · Auth · Realtime · Offline | ✅ prod (sagrados) |
| **Propinas — pool por `covered_role`** en los 6 consumidores + **`pool_total_crc` fuente única** (Jul 2026 = **₡2.167.131**) | ✅ prod + staging |
| **T3 endurecimiento de caja — los 8 ítems** (traspasos · negativos manuales · `ajuste_tipo` por signo · fechas · **auditoría de EDICIONES** mig 052 · ingreso adicional · huérfano · cosmético) | ✅ prod + staging |
| Bandeja unificada + Revisión · Tier 3 · autorización por contraseña (045) · elegibilidad de propina por rol (048) | ✅ prod + staging |
| **🆕 Proveedores Fase A — notificación de pago** (mig 047: `email`/`whatsapp`/`notificar_pago` + `proveedor_notificado_at`; Edge Fn `pago-notificar` **v1 ACTIVE**) | 🔲 **en prod, SIN validar en piso.** ⚠️ El **correo está INERTE** hasta el DNS de Resend + `RESEND_API_KEY`; el **WhatsApp sí funciona** |
| **🆕 Proveedores Fase B — saldo a favor** (migs 053/054: `supplier_credits` + `credit_applications` append-only + RPCs `create`/`apply`/`delete`; residual en 3 superficies; reparto **FIFO** a una o varias facturas) | 🔲 **en prod, SIN validar en piso** (tablas en 0 filas: nadie lo usó todavía) |
| **🆕 Comprobantes** (liquidación de crédito · post-pago · **WhatsApp = imagen PNG por Web Share**, con fallback `wa.me` texto y descarga) | 🔲 **en prod, SIN validar en piso** (el share con archivo solo se prueba en celular real) |
| Quick-wins C2 (historial over/short) + C3 (email del cierre, Edge Fn `cierre-email`) | 🟢 smoke pendiente |
| **🆕 Salarios — Fase 0 · maestro de nómina** (mig **055**: `hourly_rate_crc`, `fixed_salary_crc`, `participa_servicio`, `biotime_emp_code` con índice único parcial, `fecha_ingreso` + sección **/salarios** → pestaña Empleados/Tarifas con alta de empleados sin login) | 🧪 **staging** — aplicada y **validada con datos reales: 18 empleados con código BioTime** (42 empleados · 24 activos · 6 activos sin código · `fecha_ingreso` null en todos). **Nada en prod.** SPEC → [`claude/SPEC-modulo-salarios.md`](claude/SPEC-modulo-salarios.md) |
| **Salarios/Empleados — U0a/U0b** (migs 056/058: núcleo del ciclo de nómina + pago del período por transferencia + Excel homebanking; **no toca caja**) | 🧪 **staging** |
| **Salarios — Fase 1 · Puente BioTime (F1a/F1b/F1c)** (mig 057 marcas + Edge `ingest-punches` + agente en ST) | 🧪 **EN VIVO en staging** — 22.403 marcas (`last_id=213972`, ~68% mapeadas). Falta **F1d** + **decisión identidad §7** |
| Salarios — Fases 2–5 (núcleo · consolidado · % ventas · liquidaciones) | 🔲 no iniciadas |
| PoS (comandero/KDS/cobro/ticket SIM) · FE SIM · Inventario activo COGS | 🧪 staging (migs 022–037) |
| **PoS "Nube de Fuego" — puente + Ventas desde el PoS** (migs 062/063 · Edge `ingest-ndf` · agente `pos-bridge/` en `feat/pos-desglose` · P2 `ventasFuente.ts` · En vivo · turnos por lote de cierre) | 🧪 **EN VIVO en staging** — agente corriendo en la PC del PoS (`14bd278`), backfill 5-ene-2024 → hoy |
| **Frente C — ≈₡ estimado + pax + prom/pax de mesa abierta** (mig 064; catálogo NET × canal − descuento; fail-closed `null` ≠ `0`) | 🧪 **VALIDADO EN VIVO en staging.** Provisional: **NUNCA entra en neta/Hoy/cuadre** (backtest 17/20 exacto) |
| **Atribución de salón por línea** (`claveNoMesero`: Cajero-salón + «Salón sin mesero» · lentes A ranking / B contexto en Cajeros, sin doble conteo · `armarDia` intacto) | 🧪 **VALIDADO en staging** (`89ae60e`) |
| **Desplegable de productos por mesa abierta** (mig 065 `detalle_productos`; nombre × cantidad, sin 677/678; fail-closed por mesa) | 🧪 **VALIDADO EN VIVO en staging** |
| **Fix 388 — caja de barra es CAJA** (`LOGIN_CAJERO_BAR` + `esCajeroTurno` en `mapTicket.ts`; agente `14bd278`) | 🧪 **hecho, aplica hacia adelante.** Histórico con `salonero_login='388'` → backfill con firma |

## (e) Pendientes de PLATA — esperan FIRMA del dueño

1. **✅🧪 SALARIOS — Fase 0: HECHA EN STAGING** (mig `055` + UI de tarifas, `82bd0ce`; **18 empleados con código
   BioTime** cargados). Lo que queda con firma: **(a)** el insumo humano que falta — **6 activos sin código** y
   **`fecha_ingreso` null en todos** —, y **(b)** el **pase a PROD**, que es su propio ciclo (toca esquema → con
   Branching ON, la `055` se aplica sola a la base de prod al pushear a `main`). Prompt de la fase →
   [`claude/PROMPT-salarios-fase0.md`](claude/PROMPT-salarios-fase0.md).
2. **🖊️ Edición de propinas en Historial por CAJERO** con autorización de gerencia — firmado 2026-07-17, sin
   construir. Patrón mig 045 `requireManager`.
3. **🖊️ Foto de comprobante obligatoria al pagar propina** — firmado, DIFERIDO.
4. **🖊️ `propina-pool`** (rama sin merge) — ¿la propina de tarjeta/SINPE va al mismo pool que la de efectivo?
5. **🖊️ Reconciliación prod-vs-Excel** — **viable ahora**: el pozo da UN número por día, que es lo que el Excel
   del dueño tiene enfrente.

> **⛔ Tier 1 (monto-on-modify desde Revisión) = DESCARTADO por el dueño.** No reabrir sin firma nueva.
> **⛔ El SOP de recategorizar un pago de proveedor a `Caja Fuerte` = RETIRADO** (era el parche al bug que el
> pozo eliminó de raíz).

## (f) Pendientes humanos / fiscales / técnicos

1. **📮 DNS de Resend + `RESEND_API_KEY` en prod** — **depende del dueño**. Hasta entonces el correo de Proveedores Fase A no sale (sin romper nada: la llamada es fire-and-forget).
2. **✅ Credenciales BioTime + PC del reloj — RESUELTO.** `satori_ro` creado, agente `biotime-bridge` corriendo en la PC de ST, 22.403 marcas ingeridas. **Nuevo pendiente humano:** dejar el agente en **Task Scheduler** (sin eso, un reinicio corta la captura sin avisar) + encender el 2º agente en **Nosara** cuando ST esté sólido.
3. **🧮 Contador: bruto vs neto y modelo de vacaciones** — decisión externa que condiciona Salarios Fases 2 y 5.
4. **👁️ Validación física en prod de Proveedores A+B** (registrar/aplicar saldo a favor, comprobantes, WhatsApp con imagen desde el celular).
5. **🔐 Hardening ACL** — quedan 3 `SECURITY DEFINER` ejecutables por `anon` en prod (`get_my_role` + 2 triggers); `get_my_role` exige un análisis read-only de policies **antes** del revoke.
6. **🧾 FE-CR** (factura electrónica real) — hoy solo estructura SIM en staging.
7. **🚧 PILAR — sesión/auth escalable y multi-tenant.** **Bloquea el gran pase del PoS.**
8. **🧹 Deuda de limpieza en `main`** (`src/shared/api/auth.ts` muerto, 3 assets sin uso, `public/_redirects`) — barrer **en un pase con firma**, jamás colado en un cleanup.

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)

`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja (la matemática del "debería") · cobro/vuelto/conversión · `posFiscal`.

**Gate de todo pase — por hash de blob, no por `git diff`:**
`tipCalculations.ts` → **`7603ba5a`** · `cashUtils.ts` → **`b597c697`** (ambos en `main`) ·
`posFiscal.ts` → **`a3fd445f`** (**solo staging**).

> ⚠️ `posFiscal.ts` y `computeTotals` **no existen como archivo en `main`**: chequearlos contra `main` pasa
> **en vacío**.

## Notas que ahorran una sesión

- **P2 · el módulo Ventas lee del PoS, con el Excel de RESPALDO.** `ventasFuente.ts` fusiona
  `{ ...xls, ...pos }`: el PoS pisa donde tiene lote, el Excel queda intacto donde no llega.
  **Qué cubre cada fuente (medido, NO confundir las dos tablas del Excel):** `ventas_dias`
  (detalle diario con saloneros) = **solo enero 2026 → hoy** · `ventas_hist` (reporte diario
  general, sin salonero) = **2023-2025** · `pos_ndf_*` = **5-ene-2024 → 3-sep-2026**
  (`PRIMERA_JORNADA_POS`, confirmado por `VALIDACION-cuadre-pos-agosto-2026-09-04`). O sea:
  **2023 no tiene detalle diario en ninguna fuente** —sobrevive por el `HistMap`, no por el
  `DiasMap`— y **2024-2025 tampoco lo tenía: el PoS se lo agrega**, que es ganancia del swap.
  Histórico/Análisis/Calendario/Metas no pierden años porque leen `hist`. Para volver atrás:
  `FUENTE_VENTAS = 'xls'` en `ventasFuente.ts` → Excel puro, sin una sola consulta a `pos_ndf_*`.
  `xlsParser`, `ventas_dias`, `ventas_hist` y la pestaña «Cargar XLS» siguen ahí, latentes.
- **P2-perf · qué bloquea el primer render de Ventas.** Bloquea solo lo barato: 90 días
  (`DIAS_EAGER`) + el `hist` del **Excel** (una consulta a una tabla ya resumida). El rango
  completo del PoS va en SEGUNDO PLANO (`cargarDeFondo`) y de **un solo pase** salen el `DiasMap`
  full y el `HistMap`. La primera versión de P2 metía el histórico entero del PoS en el
  `Promise.all` bloqueante y además lo agregaba dos veces: **615 → 42 requests** bloqueantes
  (~14,6×) a la escala medida de staging. **El PoS no da resúmenes**: cada día se DERIVA
  agregando tickets y líneas crudas en el navegador; si algún día hace falta más, el fix real es
  agregación server-side (`pos_ndf_dias` upserteada en el ingest con el MISMO `armarDia`, o un
  RPC) → toca ESQUEMA + INGEST, fase aparte con firma.
- **La historia 2024-2025 NO cuadra al céntimo, y está medido: −0,057 %.** Histórico 3 años =
  99,94 %; el PoS da sistemáticamente de menos, concentrado en días viejos puntuales (casi todo
  el −107k de marzo 2024 está en el **7-mar**). Causa pendiente de drill-down (vuelto/dólares
  viejos, o un tipo de factura filtrado en 2024-2025). **NO es borde de día.** Al correr Paridad
  sobre 2024-2025, esperar ESE delta: el objetivo es confirmar que aparece solo el −0,057 %
  conocido y nada nuevo. Para Histórico/Análisis/Mix es ruido → OK; **para algo contable u
  oficial, resolver el drill-down antes.**
- **2024 tiene 0 % de cobertura de salonero** (el mesero no se registraba; 2025 ~39-66 %, 2026
  ~71-76 %). Saloneros / Evaluación / ICP salen **vacíos en 2024**. No es regresión del swap —
  el Excel tenía el mismo hueco— pero hay que avisarlo antes de que alguien lo reporte como bug.
- **El "delivery" BAJA ~4-5 % con el swap del PoS. NO es un bug — el PoS es el correcto.** El xls
  marcaba delivery por "sin cargo de servicio", y ahí adentro caían también «para llevar» y la
  barra. El PoS usa el canal real (`canal = 'delivery'`), que es lo que de verdad salió en moto.
  La neta, el salón y el servicio NO se mueven: paridad de agosto 2026 = neta −0,4 %, salón
  −0,0 %, pax +1,5 %. **No re-diagnosticar como pérdida de datos.**

- **Verificar un deploy por CONTENIDO, nunca por HTTP 200:** pedir un asset por el hash del build local siempre
  da 200 (el fallback SPA devuelve el `index.html`). **Caminar el grafo de chunks** desde el entry y comprobar
  marcadores. ⚠️ El hash del chunk que emite CI **≠** el local.
- **Los untracked del árbol principal bloquean `git checkout main`.** Para cherry-picks a prod: **git worktree aislado**. Para avanzar `main` sin checkout: `git push origin <rama>:main` (FF directo).
- **Flake TZ de tests: MUERTO.** Los fixtures usaban `new Date().toISOString()` (UTC) contra un filtro con `todayCR()`. Corregido. **No re-diagnosticar.**
- **`database.ts` puede mentir la nullability** vs `supabase.gen.ts` (la verdad): las lecturas castean la fila cruda (`data as T[]`), los NULL fluyen sin coerción y **solo revientan con datos viejos**.
- **`navigator.share` es NO-opcional en el lib DOM de TS** → chequear con `typeof nav.share === 'function'`, nunca `nav.share &&` (da TS2774).
