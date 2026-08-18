# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Al día: 2026-08-17.** Hoy cerró el **pase de PROVEEDORES a PROD** (`main` `73352ba` → **`3e54aa4`**, 9 commits):
> notificación de pago (mig **047**), **saldo a favor** (migs **053/054**) y los **comprobantes** (liquidación,
> post-pago y **WhatsApp mandando la IMAGEN** por Web Share). Ledger de prod = **39 filas, 0 pendientes**.
> Además se congeló y **FIRMÓ el SPEC del módulo SALARIOS** (docs en `claude/`, construcción **no iniciada**).
>
> Detalle histórico → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) · Fases → [ROADMAP.md](ROADMAP.md) ·
> Backlog → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · Hallazgos → [HALLAZGOS.md](HALLAZGOS.md) ·
> SPECs e índice → [docs/README.md](docs/README.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → **PROD** (GitHub Pages, base `/satori-app/`) · `staging` → **Cloudflare Pages**.

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
| `staging` | **`134893c`** | **Fuente de verdad del desarrollo** = `main` + PoS/KDS/comandero + FE (SIM) + inventario COGS + los **docs de Salarios** (`claude/`). Su base está en **CERO** ([ARRANQUE-CERO.md](scripts/refresh-staging/ARRANQUE-CERO.md)). |

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

**Solo en STAGING:** **el PoS completo** (catálogo/salón, comandero, KDS, cobro+splits+ticket SIM, FE SIM, inventario activo COGS) — migs 022–037, y **`posFiscal.ts` no existe en `main`**. **DIFERIDO**, bloqueado por el PILAR de auth. También los **docs de Salarios** (`claude/`, solo diseño). En rama aparte sin merge: `propina-pool`.

> **Contrato de divergencia:** lo legítimo en `main..staging` es **PoS/FE/inventario + config Cloudflare + docs
> de trabajo**. La parte no-PoS de plata/negocio está **convergida**. Cualquier otro archivo que difiera es
> **DEUDA, no divergencia** — lista archivo por archivo en
> [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md#-2026-07-23--re-sync-mainstaging--reconciliación-del-ledger-fase-a--b1).

## (c) Migraciones

| Entorno | Ledger (`schema_migrations`) |
|---|---|
| **PROD** | **✅ 39 filas — contiguo `040–054`** (001–008, 0090, 0095, 010–021, 038–054). **0 pendientes.** |
| **STAGING** | **✅ mismo rango `040–054`** + las del PoS (022–037). `db push` desbloqueado. |

- **047/053/054 aplicadas a prod el 2026-08-17** con `db push --include-all` desde un worktree linkeado a prod.
  La **047 entró fuera de orden** (después de la 052 ya aplicada) y `--include-all` lo resolvió **sin ningún
  `repair`**. 🚫 **Nunca** `repair --status applied` sobre la 047: la marcaría aplicada **sin crear las columnas**.
- **La 053 hace `create or replace` de `delete_movement_cascade`** (que ya corría en prod): cuerpo de la 044
  **intacto** (autorización, reversa de asientos, borrado, limpieza de docs) + snapshot de aplicaciones de crédito
  + **FASE 6b** que repone el saldo. El `revoke` final quedó más duro (`revoke all … from public, anon`).
- **🚫 NUNCA `repair --status reverted`** sobre algo aplicado: le mentiría al ledger sobre plata real.
- **⚠️ El CLI ordena archivos por NOMBRE y el ledger por VERSIÓN** (por eso `009` → `0090`; persiste en 2.109.1).
  **`026` en PROD = excepción permanente documentada**, no se repara.
- **Próximo número libre: `055`** (lo reclama Salarios Fase 0). ⚠️ La rama `metas_personales` también reclamaba
  051/052/053 → **renumerar** antes de traerla.

## (d) Build por módulo

**Gate de todo pase:** `npm run build` → **EXIT 0** (`tsc -b`; ⚠️ **`tsc --noEmit` es FALSO VERDE** por el `tsconfig` raíz con `files:[]`) + suite verde (**605 tests** staging · **525** prod) + **sagrados por hash de blob** + **ESLint delta 0** contra la rama destino.

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
| **Salarios** (SPEC firmado, Fase 0 no iniciada) | 🔲 **solo diseño** — [`claude/SPEC-modulo-salarios.md`](claude/SPEC-modulo-salarios.md) |
| PoS (comandero/KDS/cobro/ticket SIM) · FE SIM · Inventario activo COGS | 🧪 staging (migs 022–037) |

## (e) Pendientes de PLATA — esperan FIRMA del dueño

1. **🖊️ SALARIOS — Fase 0** (extender `employees` con tarifa/hora, salario fijo, `participa_servicio`, `biotime_emp_code`, `fecha_ingreso` + UI de tarifas). SPEC **FIRMADO**; falta el **insumo humano**: lista maestra con **código BioTime + fecha de ingreso** por empleado. Prompt listo → [`claude/PROMPT-salarios-fase0.md`](claude/PROMPT-salarios-fase0.md).
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
2. **🔑 Credenciales del Postgres de BioTime + PC siempre encendida** — **depende del dueño**. Bloquea Salarios Fase 1 (puente de horas).
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

- **Verificar un deploy por CONTENIDO, nunca por HTTP 200:** pedir un asset por el hash del build local siempre
  da 200 (el fallback SPA devuelve el `index.html`). **Caminar el grafo de chunks** desde el entry y comprobar
  marcadores. ⚠️ El hash del chunk que emite CI **≠** el local.
- **Los untracked del árbol principal bloquean `git checkout main`.** Para cherry-picks a prod: **git worktree aislado**. Para avanzar `main` sin checkout: `git push origin <rama>:main` (FF directo).
- **Flake TZ de tests: MUERTO.** Los fixtures usaban `new Date().toISOString()` (UTC) contra un filtro con `todayCR()`. Corregido. **No re-diagnosticar.**
- **`database.ts` puede mentir la nullability** vs `supabase.gen.ts` (la verdad): las lecturas castean la fila cruda (`data as T[]`), los NULL fluyen sin coerción y **solo revientan con datos viejos**.
- **`navigator.share` es NO-opcional en el lib DOM de TS** → chequear con `typeof nav.share === 'function'`, nunca `nav.share &&` (da TS2774).
