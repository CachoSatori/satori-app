# FASE A — Reconciliación del ledger de migraciones · DIAGNÓSTICO READ-ONLY

**Fecha:** 2026-07-23 · **Alcance:** solo lectura. **Cero** `repair`, `db push/pull`, DDL o mutación.

**Canal usado:** Management API `POST /v1/projects/<ref>/database/query` con `read_only: true`, cada
sentencia pasada por `assertSoloSelect()` (candado de `scripts/t0-reconciliacion-cajas/db.ts`).
Antes de leer un solo dato, en **ambos** entornos se mandó a propósito un `create temp table` y el
servidor lo **rechazó con `25006`** — el candado no es una promesa del cliente, es una transacción
read-only de Postgres.

> **Ritual del ref.** El link del CLI (`supabase/.temp/project-ref`) apuntaba a **staging**
> (`hwiatgicyyqyezqwldia`) durante toda la corrida y **nunca se movió**. La lectura de prod NO usó el
> CLI: fue por Management API con el ref **clavado en código** (`yiczgdtirrkdvohdquzf`) y verificado
> antes de cada request. La firma de prod (`2026-07-23`) se pasó por entorno; **`prod-gate.ts` no se
> modificó** (su `FIRMA_REQUERIDA` sigue en `'2026-07-22'`).

**Backups del ledger:** [`ledger-staging-2026-07-23.json`](ledger-staging-2026-07-23.json) (39 filas) ·
[`ledger-prod-2026-07-23.json`](ledger-prod-2026-07-23.json) (4 filas).

---

## ⚠️ El ledger vivo NO coincide con ESTADO §(c) — reportado, no corregido

| | ESTADO §(c) decía | El ledger vivo dice |
|---|---|---|
| **STAGING** | ledger `022–038` | **`001–038` completo (39 filas)**, incluido `0095` y el fantasma `035` |
| **PROD** | ledger `≤021` | **solo `018, 019, 020, 021` (4 filas)** — `001–017` y `0095` **no están** |

`≤021` se leía como "las 21 primeras están registradas". No: en prod el ledger tiene **cuatro** filas.
La deuda out-of-band de prod es mucho mayor que la estimada (28 versiones, no 10).

---

## Tabla 1 — STAGING (`hwiatgicyyqyezqwldia`, rama `origin/staging`)

Ledger: **39 filas** (`001`…`038`). Archivos: **47**. Tablas public: 50 · funciones: 20 · policies: 103.

| version | archivo local | en ledger | aplicada realmente (evidencia) | veredicto |
|---|---|---|---|---|
| `001–021` | ✅ | ✅ | ✅ `employees`, `cash_sessions`, `cash_movements`, `get_my_role`, `documents`, `verify_manager`, `client_op_id`, `account_id` | **alineada** |
| `0095` | ✅ | ✅ | ✅ `sops` + `cash_cierres_dia` | **alineada** |
| `022–034`, `036`, `037` | ✅ | ✅ | ✅ `pos_orders`, `pos_payments` | **alineada** (PoS) |
| **`035`** | ❌ **solo en `propina-pool`** | ✅ **sí** | ✅ **`tip_sessions.pool_pos_crc` + `pool_pos_usd` + fn `sync_pos_tips_to_pool`** | 🔴 **FANTASMA — único bloqueante de `db push`** |
| `038` | ✅ | ✅ | ✅ `factura_verified_by` + fn `mark_factura_verified` | **alineada** (repair del `038-apply.log`) |
| `039` | ✅ | ❌ | ✅ tabla `movement_deletions` + fn `delete_movement_cascade` | 🟠 out-of-band |
| `040` | ✅ | ❌ | ✅ tabla `inventory_review_task` | 🟠 out-of-band |
| `041` | ✅ | ❌ | ✅ `cash_movements.classification` | 🟠 out-of-band |
| `042` | ✅ | ❌ | ✅ tabla `accounting_entries` + fn `post_accounting_entry` | 🟠 out-of-band |
| `043` | ✅ | ❌ | ✅ fn `complete_inventory_review` | 🟠 out-of-band |
| `044` | ✅ | ❌ | ✅ `movement_deletions.authorized_by` + `delete_movement_cascade` **con 4 args** | 🟠 out-of-band |
| `045` | ✅ | ❌ | ✅ fn `verify_manager_password`, **`prosecdef=true`**, **`anon` execute = `false`** | 🟠 out-of-band |
| `046` | ✅ | ❌ | ✅ `tip_sessions.pool_barra_electronico_crc` | 🟠 out-of-band |
| `048` | ✅ | ❌ | ✅ `role_tip_points.recibe_propina` | 🟠 out-of-band |

## Tabla 2 — PROD (`yiczgdtirrkdvohdquzf`, rama `origin/main`)

Ledger: **4 filas** (`018`–`021`). Archivos: **32**. Tablas public: 33 · funciones: 13 · policies: 73.

| version | archivo local (main) | en ledger | aplicada realmente (evidencia) | veredicto |
|---|---|---|---|---|
| `001–017` | ✅ | ❌ **no** | ✅ todas las sondas base verdes (`employees`…`supplier_item_map`) | 🟠 out-of-band |
| `0095` | ✅ | ❌ | ✅ `sops` + `cash_cierres_dia` | 🟠 out-of-band |
| `018–021` | ✅ | ✅ | ✅ `cash_cierres_dia`, fn `verify_manager`, `client_op_id` | **alineada** (las únicas 4) |
| **`026` (subset core)** | ❌ **no está en `main`** | ❌ | ✅ enum `user_role`+`'proveedor'`, `cash_movements.attachments`, bucket `facturas` (privado) + políticas `facturas_insert/select/delete` | ⚠️ **caso especial** (ver Fase B) |
| `038–046`, `048` | ✅ | ❌ | ✅ mismas sondas que staging, todas verdes (incl. `044` 4 args y `045` blindada) | 🟠 out-of-band |
| `035` | ❌ | ❌ | ❌ `pool_pos_crc`/`pool_pos_usd`/`sync_pos_tips_to_pool` **ausentes** | ✅ **correcto** (es de `propina-pool`) |
| PoS `022–037` | ❌ | ❌ | ❌ `pos_orders`/`pos_payments` **ausentes** | ✅ **correcto** (PoS no va a prod) |

**Prod NO tiene filas de ledger sin archivo** → a diferencia de staging, su historial **no está
divergido**; solo está **incompleto**.

---

## Los 3 nudos, resueltos con datos

**1. `009` drift — NO existe como problema.** En staging, `009` y `0095` están **ambos en el ledger y
ambos con archivo local**; el orden lexicográfico `009 < 0095 < 010` es el correcto. En prod ninguno
de los dos está en el ledger, pero por la misma razón que `001–017` (deuda out-of-band), no por drift.
El `repair --status reverted 009` que sugiere el CLI **no corresponde**: `009` está aplicado (`profiles.email`
+ fn `handle_new_user` presentes) y tiene archivo.

**2. `035` fantasma — CONFIRMADO, y confirma la trampa.** Está en el ledger de staging (`035 |
propina_pos_pool`), **no** tiene archivo en `origin/staging`, y **sí está realmente aplicado**: las dos
columnas y la función existen. Es el **único** motivo por el que `db push` se niega en staging.
`repair --status reverted 035` **haría mentir al ledger** sobre plata aplicada → descartado, tal como
advertía el prompt. En prod no está ni registrado ni aplicado: correcto.

**3. Out-of-band — cuantificado.**

- **STAGING → 9 versiones:** `039, 040, 041, 042, 043, 044, 045, 046, 048`
- **PROD → 28 versiones:** `001–017`, `0095`, `038, 039, 040, 041, 042, 043, 044, 045, 046, 048`

Todas verificadas **por objeto/privilegio**, no por el ledger.

---

## Propuesta de FASE B — NO EJECUTADA

> `migration repair` **ESCRIBE** en `supabase_migrations.schema_migrations`. No es read-only: todo lo
> de abajo queda fuera del alcance de esta fase y **espera firma**.

### B1 · STAGING — desbloquear `db push` (bajo riesgo)

Primero resolver el `035` (ver opciones), y después registrar lo out-of-band:

```
supabase migration repair --status applied 039 040 041 042 043 044 045 046 048
```

Los 9 objetos ya fueron verificados como presentes → marcarlos `applied` es **honesto**.

### B2 · PROD — 28 repairs ⚠️ TOCA PRODUCCIÓN

```
supabase migration repair --status applied 001 002 003 004 005 006 007 008 009 0095 \
  010 011 012 013 014 015 016 017 038 039 040 041 042 043 044 045 046 048
```

**Requiere: firma del dueño + doble check del ref.** Riesgo operativo real: `migration repair` va por
el **CLI linkeado**, y el link vive hoy en **staging**. Correrlo contra prod obliga a re-linkear —
exactamente el escenario en que "el CLI apareció linkeado a PROD sin avisar". Recomendación: hacerlo
en sesión dedicada, re-verificando `cat supabase/.temp/project-ref` **entre cada paso**, y devolviendo
el link a staging al terminar.

### B3 · El caso `026` en PROD — decisión, no repair

El **subset core** de la `026` está **aplicado en prod** (rol `proveedor`, `attachments`, bucket
`facturas` + 3 políticas) pero su archivo **no existe en `main`** (es del PoS, solo-staging). Es el
**espejo del `035`**: efecto aplicado sin archivo en la rama. No se puede `repair --status applied 026`
en prod sin que el CLI vuelva a quejarse por falta de archivo local. Opciones: (a) extraer el subset
core a una migración propia numerada en `main` que refleje lo ya aplicado; (b) dejarlo documentado como
excepción permanente. **Decisión del dueño.**

### Opciones para el `035` (staging) — sin recomendación ejecutada

| | Qué es | Costo / riesgo |
|---|---|---|
| **A — traer el archivo** (recomendada) | Copiar `035_propina_pos_pool.sql` de `propina-pool` a `supabase/migrations/` en staging, **sin mergear el código** de la feature | Ledger y repo vuelven a coincidir → `db push` desbloqueado. Honesto: el DDL **ya está aplicado**. Riesgo: el archivo sugiere que la feature está viva cuando su código sigue sin merge → mitigable con una nota en el encabezado |
| **B — `repair --status reverted 035`** | Lo que sugiere el CLI | ❌ **Descartada.** Haría mentir al ledger sobre plata aplicada y realmente presente |
| **C — no hacer nada** | Seguir aplicando siempre out-of-band | `db push` queda inutilizable para siempre y la deuda sigue creciendo |
| **D — revertir el DDL** | `drop` de las 2 columnas + la función, y luego marcar `reverted` | Consistente pero **destructivo sobre plata**; exige certeza de que nadie lee `pool_pos_crc`. Desaconsejada |

---

## Estado al cerrar

- **Cero escrituras** en ambas bases (smoke `25006` verificado en las 4 corridas).
- `main` y `staging` **sin tocar**; `prod-gate.ts` **sin modificar**.
- Archivos nuevos, **sin commitear**: los 2 JSON de backup + este reporte.

**STOP.** La Fase B espera la firma del dueño.
