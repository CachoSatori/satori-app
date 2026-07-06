# SPEC — Unificación Bandeja ↔ Caja Diaria

> **Estado:** ✅ v1 — DECISIONES DE DISEÑO FIRMADAS · 2026-06-26
> **Alcance de este documento:** SOLO diseño. No autoriza una línea de código.
> Las 7 decisiones de diseño (§18) están **firmadas por la dueña** (todas en su opción recomendada).
> ⚠️ **Firmar el diseño ≠ autorizar construcción ni aplicar migraciones.** La construcción arranca tras
> cumplir las precondiciones F0 (§17); cada migración 040+ exige firma SEPARADA antes de aplicarse a una base.
> **Destino:** `docs/specs/` en `staging` (lo commitea Claude Code).
> **Sagrados que NO se tocan en ninguna fase:** `cashUtils`, `tipCalculations`, `computeTotals`,
> cierres de caja, `posFiscal`. El arqueo del efectivo no cambia.

---

## 0. Convenciones del documento

- Prosa en español; identificadores (tablas, columnas, funciones, estados) en el inglés/forma real del repo.
- Toda referencia a esquema fue verificada contra `origin/staging` (migraciones 006–039). Donde se propone
  esquema **nuevo**, va marcado `🆕 PROPUESTO` y queda sujeto a firma.
- Marcadores: **🖊️** = decisión de plata/esquema que exige firma · **⚠️** = riesgo/dependencia ·
  **INV-n** = invariante de integridad · **RN-n** = regla de negocio.

---

## 1. Objetivo y principios de diseño

**Objetivo.** Colapsar la Bandeja (`/inbox`) y Caja Diaria (`/caja`, `CashTurno.tsx`) en **un solo flujo de
entrada** para el cajero, moviendo el trabajo de inventario y contable a quien corresponde
(contador/manager), sin perder integridad entre Caja, Movimientos e Inventario.

**Principios (en orden de prioridad, para resolver disputas de diseño):**

1. **Integridad de datos primero.** Nunca un movimiento de mercadería sin su inventario o sin una tarea
   visible de inventario pendiente. Nunca un inventario huérfano. Nunca un asiento que no se pueda
   reversar. El borrado revierte **todo** el grafo ligado, con auditoría.
2. **Simplicidad de operación para el cajero.** El cajero registra **pago + foto** y nada más. No clasifica
   contablemente, no ingresa inventario, no arma asientos. Un solo botón, pocos taps, funciona offline.
3. **Mantenibilidad y extensibilidad a largo plazo.** Vías desacopladas (pago / inventario / contable),
   esquema aditivo, libros append-only, RPCs idempotentes y transaccionales, un solo punto de borrado.
   Debe ser auditable y mantenible por más de una persona.
4. **Auditabilidad.** Todo evento de plata deja rastro: quién, cuándo, qué, y cómo se revirtió.

**No-objetivos de este SPEC:** rendimiento extremo, multi-tenant/multi-local a escala (eso es el PILAR de
sesión/auth, aparte), y facturación electrónica real.

---

## 2. Alcance

### 2.1 En alcance (esta fase)

- Un único botón **"Agregar"** en Caja Diaria que reemplaza los tres caminos actuales de `CashTurno.tsx`
  (`+ Agregar` ingreso · `+ Agregar pago` a proveedor · `+ Agregar egreso`).
- Captura **foto-primero** (con IA, reusando la Bandeja Etapa 1) **o manual**.
- **Auto-clasificación advisory** Mercadería(Proveedores) / Operativa: sugiere, el humano confirma.
- **Vía de pago** intacta en su matemática: respeta la **matriz de pago por rol** existente (efectivo
  descuenta caja, transferencia → pendiente, etc.).
- **Tarea de revisión de inventario** (`inventory_review_task` 🆕): se crea automáticamente para Mercadería;
  el **contador/manager** la completa en un módulo de Inventarios; el cajero NO la toca.
- **Asiento contable automático** (libro `accounting_entries` 🆕) al completarse cada vía, idempotente y
  reversible, que alimenta el `finance_actuals` existente (P&L).
- **Borrado y reversión:** extender `delete_movement_cascade` (mig 039) para revertir asiento + cerrar la
  tarea de inventario + (decisión 🖊️ D5) borrar el documento.

### 2.2 Fuera de alcance (queda para después)

- **Libro de doble partida completo** (débitos/créditos formales, balance) — ver D1; se diseña una capa
  reversible más liviana, no un GL contable.
- **IVA crédito fiscal de compras** (CABYS/CIIU) — bloqueado por la contadora; ver D3.
- **Orden de compra** y puente compra→caja→stock proactivo (es fase posterior del inventario).
- **Pase a PROD** de este módulo (depende de la cadena Bandeja E1 + 037 + 039, hoy solo en staging — §16).
- Cualquier cambio a los **sagrados** o al arqueo de efectivo.
- Multi-local / multi-tenant a escala de dispositivos.

---

## 3. Estado actual (anclado al repo)

| Pieza | Dónde (real) | Nota |
|---|---|---|
| Caja Diaria, 3 caminos "Agregar" | `src/modules/cash/CashTurno.tsx` | `openNewIngreso` / `openNewPago` / `openNewEgreso` |
| Movimientos / Pendientes / Proveedores / Cierre | `CashMovimientos.tsx`, `CashPendientes.tsx`, `CashProveedores.tsx`, `CashCierre.tsx` | |
| Nota de borrado obligatoria | `src/modules/cash/deletionNote.ts` | exigida por mig 039 |
| Matemática de arqueo | `src/modules/cash/cashUtils.ts` | **SAGRADO** |
| Bandeja unificada foto+IA | `src/modules/inbox/InboxModule.tsx` | Etapa 1, validada en staging |
| Entrada de inventario actual | `src/modules/inbox/InventoryStep.tsx` | **hoy la hace el cajero dentro del inbox** |
| Tabla de pagos de caja | `public.cash_movements` | `session_id, status, type, amount, description, account_id→finance_accounts, supplier_id, attachments(jsonb), client_op_id(uuid unique), factura_verified_by/at` |
| Inventario | `public.inventory_movements` | `ingredient_id, movement_type, qty_delta, unit, unit_cost, reference_id, document_id, cash_movement_id` |
| Mapa proveedor→ingrediente | `public.supplier_item_map` (mig 017) | `codigo, descripcion_factura, ingredient_id, es_inventario, factor_conversion` |
| Documentos / dedupe | `public.documents` (`sha256`), `src/shared/api/documents.ts`, `InboxModule.tsx` | dedupe anti-duplicado por `sha256` |
| Plan de cuentas P&L | `public.finance_accounts` (mig 006) | `id text, code, name, parent_id, section, is_leaf`. Ej.: `a5200` (Food Costs), `a5320` (Beverage)… |
| Actuals mensuales (P&L) | `public.finance_actuals` (`account_id, year, month, amount`) | **NO es doble partida**; es suma mensual por cuenta |
| Borrado con cascada + auditoría | `delete_movement_cascade(p_movement_id, p_note)`, `movement_deletions` (mig 039) | SECURITY DEFINER; valida owner/manager; requiere conexión |
| Verificado de factura | `mark_factura_verified(p_movement_id)` (mig 038) | sella `factura_verified_*` |

**Hallazgo de diseño #1 — el módulo de Inventarios destino NO existe.** No hay `src/modules/inventory`. La
visión ("el contador completa el inventario en Inventarios") **requiere decidir si se construye ese módulo o
se reusa `InventoryStep`** — ver §10 y D4.

**Hallazgo de diseño #2 — no hay libro contable.** "Asiento contable automático" no puede apoyarse en algo
existente: hoy el P&L se llena vía `finance_actuals`. Hay que decidir el modelo — ver §11 y D1.

---

## 4. Modelo conceptual — tres vías desacopladas

Una "entrada" en Caja Diaria dispara hasta **tres vías independientes**. Desacoplarlas es lo que mantiene la
UX del cajero simple y la integridad robusta:

```
                ┌──────────────────────── Vía PAGO (cajero, sincrónica, offline-OK) ─┐
   AGREGAR ─────┤  crea cash_movement · matriz de pago por rol · arqueo intacto       │
   (foto/manual)│                                                                     │
                ├──────────── Vía INVENTARIO (contador/manager, asíncrona, online) ───┤
                │  si Mercadería → inventory_review_task PENDIENTE → COMPLETADA        │
                │                                                                     │
                └──────────── Vía CONTABLE (sistema, automática, reversible) ─────────┘
                   accounting_entries (append-only) → alimenta finance_actuals
```

**Regla de oro:** la vía de pago **nunca se bloquea** por las otras dos. El cajero termina su parte aunque
el inventario quede pendiente y el asiento se postee después.

---

## 5. Flujo objetivo "un solo Agregar" (UX del cajero)

Pantalla: Caja Diaria (`CashTurno`). Un único botón **"➕ Agregar"** abre un asistente de 1 pantalla con
secciones progresivas (no un wizard de muchos pasos):

1. **Captura.**
   - **Foto** (default, reusa la cámara/IA de la Bandeja Etapa 1) → IA pre-llena monto, proveedor, fecha de
     factura. **o** **Manual** (sin foto) → el cajero tipea.
   - La **fecha de registro** = hoy (CR), día en que la mercadería/gasto entra (RN-1). La fecha de la factura,
     si difiere, va a la descripción (comportamiento actual de la Bandeja).
2. **Clasificación (advisory).** El sistema muestra una **sugerencia** (Mercadería / Operativa / Ingreso) con
   un indicador de confianza. El cajero **confirma con un tap** o la cambia. Nunca se decide sola (§6, RN-2).
3. **Pago.** Según el **rol del usuario** y el tipo, se ofrecen SOLO las formas válidas de la matriz vigente
   (RN-3). El cajero elige forma + cuenta. Adjunta/confirma la foto.
4. **Confirmar.** Se crea el `cash_movement` (idempotente por `client_op_id`), se aplica la matriz (efectivo
   descuenta caja / transferencia → Pendiente), y —si la clasificación es Mercadería— se crea la
   `inventory_review_task` en estado `PENDIENTE`. El cajero ve "✓ Registrado" y, si aplica, "Inventario:
   pendiente de revisión". **Fin de su trabajo.**

> **UX no-negociable:** desde "Agregar" hasta "✓ Registrado" no debe haber ningún paso de inventario ni
> contable. Esos viven en otras pantallas y otros roles.

---

## 6. Auto-clasificación (advisory)

**RN-2 — la sugerencia nunca auto-confirma.** Es ayuda visual; el humano confirma siempre.

Señales (orden de peso), todas calculables sin servicios externos:
1. **Proveedor reconocido** (match de nombre/OCR contra `suppliers` o `supplier_item_map`) → sugiere
   **Mercadería**, confianza alta.
2. **Palabras clave operativas** en el texto OCR (alquiler, electricidad, servicios, mantenimiento…) o
   ausencia de proveedor → sugiere **Operativa**.
3. Heurística de monto/recurrencia → desempate, confianza baja.

La sugerencia y su confianza se snapshotean en `cash_movements.suggested_classification` /
`suggested_confidence` (🆕) y en la tarea, para auditar después qué propuso el sistema vs qué eligió el humano.
La **clasificación efectiva** (la que confirma el humano) va en `cash_movements.classification` (🆕).

---

## 7. Máquina de estados

### 7.1 Vía de pago (existente — NO se rediseña)
`cash_movement.status` sigue su ciclo actual (efectivo en caja / transferencia → `pendiente` → pagado desde
banco). Este SPEC **no toca** esa máquina ni el arqueo.

### 7.2 Vía de inventario — `inventory_review_task` 🆕

| Estado | Significado | Entra por | Actor |
|---|---|---|---|
| `PENDIENTE` | creada, esperando revisión | confirmación de un pago Mercadería | sistema |
| `EN_REVISION` *(opcional, D7)* | alguien la tomó | claim | contador/manager |
| `COMPLETADA` | inventario ingresado + asiento posteado | completar revisión | contador/manager |
| `DESCARTADA` | sin inventario aplicable / o el pago se borró | descarte manual o cascada de borrado | contador/manager o sistema |

**Transiciones (con guardas):**

| De → A | Disparador | Guarda | Efecto |
|---|---|---|---|
| ∅ → `PENDIENTE` | confirmar pago con `classification='mercaderia'` | RN-3 OK | crea tarea ligada al `cash_movement` |
| `PENDIENTE` → `EN_REVISION` | claim *(D7)* | rol ∈ {owner,manager,contador} | set `claimed_by/at` |
| `PENDIENTE`/`EN_REVISION` → `COMPLETADA` | `complete_inventory_review` | ≥1 línea válida; online | crea `inventory_movements`; postea asiento `compra_inventario`; sella `completed_by/at` |
| `PENDIENTE`/`EN_REVISION` → `DESCARTADA` | descarte manual (con motivo) | rol ∈ {owner,manager,contador} | set `discarded_by/at/reason` |
| `COMPLETADA` → `DESCARTADA` | **solo** vía borrado del pago (cascada 039) | — | revierte inventario + asiento; set motivo='cascade' |

**RN-4 — no hay "des-completar" manual.** Para corregir un inventario ya ingresado, se **borra el pago**
(cascada que revierte todo) y se vuelve a cargar. No se permite editar un `COMPLETADA` en sitio, para que
el rastro contable sea siempre lineal y reversible.

> Diagrama:
> `PENDIENTE → (EN_REVISION) → COMPLETADA`
> `PENDIENTE/EN_REVISION → DESCARTADA` (manual) · `COMPLETADA → DESCARTADA` (solo cascada)

---

## 8. Reglas de negocio e invariantes de integridad

- **RN-1.** Fecha relevante = **fecha de registro** (mercadería entra al local), no la de factura ni la de pago.
- **RN-2.** La auto-clasificación es advisory; el humano confirma (§6).
- **RN-3.** La forma de pago se restringe por la **matriz por rol vigente**: cajero/manager → Efectivo (caja
  abierta, descuenta caja) · Transferencia → Pendiente o Pagado-desde-Banco; contador/owner → solo Pendiente
  o Banco, nunca efectivo. **Esta matriz se reusa tal cual; este SPEC no la altera.**
- **RN-4.** No hay des-completar manual de inventario (§7.2).

**Invariantes (deben sostenerse siempre; son criterios de aceptación):**

- **INV-1.** Todo `cash_movement` con `classification='mercaderia'` tiene **exactamente una**
  `inventory_review_task` activa (`PENDIENTE`/`EN_REVISION`/`COMPLETADA`) **o** una `DESCARTADA` con motivo.
  Nunca cero, nunca dos.
- **INV-2.** Todo `inventory_movement` ligado a un pago tiene `cash_movement_id` no nulo y su pago existe;
  si el pago se borra, su inventario se revierte en la misma transacción (ya garantizado por mig 039 + esta
  extensión). **Cero huérfanos.**
- **INV-3.** Los asientos son **append-only**: jamás se hace `UPDATE`/`DELETE` de un asiento posteado. Revertir
  = insertar contra-asiento. El neto sobre `finance_actuals` queda en cero tras una reversión.
- **INV-4.** Idempotencia en toda escritura de plata: `client_op_id` único (cliente) + unicidad parcial
  `(source_type, source_id, kind)` mientras `status='posted'` (servidor). Reintentos no duplican.
- **INV-5.** Pendientes e inventario **nunca** entran al conteo de efectivo (ya es así; se preserva).
- **INV-6.** La vía de pago nunca se bloquea por inventario ni contable (§4).
- **INV-7.** Todo borrado de pago es atómico: cash_movement + inventario + asiento(reversa) + tarea(descartada)
  + auditoría, en una sola transacción, o nada.

---

## 9. Roles y permisos

| Acción | owner | manager | contador | cajero |
|---|:--:|:--:|:--:|:--:|
| Agregar (pago + foto) | ✅ | ✅ | ✅* | ✅ |
| Confirmar clasificación | ✅ | ✅ | ✅ | ✅ |
| Completar revisión de inventario | ✅ | ✅ | ✅ | ❌ |
| Descartar tarea de inventario | ✅ | ✅ | ✅ | ❌ |
| Borrar pago (cascada) | ✅ | ✅ | ❌ | ❌ |
| Verificar factura (`mark_factura_verified`) | ✅ | ✅ | ✅ | ❌ |

\* contador con su matriz (sin efectivo). El **cajero queda fuera del inventario y del borrado**, que es el
corazón de la separación de responsabilidades pedida.

---

## 10. Módulo de Inventarios destino

El contador/manager necesita una pantalla donde ver la **cola de tareas `PENDIENTE`** y completarlas. Hoy no
existe. Opciones en **D4**. Recomendación: un módulo nuevo y mínimo `src/modules/inventory/` con:
- **Cola** (lista de `inventory_review_task` por estado, filtrable por proveedor/fecha).
- **Detalle/completar:** muestra la foto + datos del pago; permite mapear líneas de factura → `ingredients`
  vía `supplier_item_map` (reusando la lógica de `InventoryStep.tsx`); valida cantidades/costos; confirma.
- Reusa, no reescribe, el motor de ingreso de `InventoryStep` (se extrae a un hook/servicio compartido).

---

## 11. Asientos contables automáticos

> Esta es la sección de mayor riesgo de plata. El **modelo** es la decisión D1; el **timing** es D2.

### 11.1 Modelo recomendado (D1 = C): libro de posteos append-only que alimenta el P&L

No se construye un GL de doble partida (over-engineering para lo que el negocio lleva hoy). Se construye un
**libro de posteos automáticos**, append-only y reversible, que es la **fuente de verdad de lo que el módulo
mete al P&L** y que **se acumula** en el `finance_actuals` existente.

**🆕 PROPUESTO — `public.accounting_entries`:**

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid pk | |
| `entry_date` | date not null | fecha de registro CR (RN-1) |
| `year`, `month` | int | derivados de `entry_date` en hora CR; clave de rollup a `finance_actuals` |
| `account_id` | text → `finance_accounts(id)` | cuenta de P&L (ej. `a5200` Food Costs) |
| `amount_crc` | numeric(12,2) not null | **firmado**: + suma al actual, − lo revierte |
| `currency` | text not null default 'CRC' | |
| `fx_rate` | numeric not null default 1 | a CRC, snapshot del día/orden |
| `source_type` | text not null | `'cash_movement' \| 'inventory_movement' \| 'reversal' \| 'manual'` |
| `source_id` | uuid | id del origen |
| `kind` | text not null | propósito: `'gasto_operativo' \| 'compra_inventario' \| 'cogs' \| …` |
| `status` | text not null default 'posted' | `'posted' \| 'reversed'` |
| `reverses_entry_id` | uuid → self | contra-asiento ← original |
| `client_op_id` | uuid unique | idempotencia de cliente |
| `note`, `created_by`, `created_at` | | auditoría |

Índices/constraints:
- `unique (source_type, source_id, kind) where status = 'posted'` → **un posteo activo por origen+propósito**
  (INV-4).
- `unique (client_op_id)`.

**Rollup a `finance_actuals`:** un **trigger** `after insert on accounting_entries` hace
`finance_actuals(account_id, year, month).amount += new.amount_crc` (upsert). Como las reversiones son filas
negativas, el neto cuadra solo. Se provee una función `recompute_finance_actuals(year, month)` (SECURITY
DEFINER) para reparar/recalcular desde `accounting_entries` si hiciera falta — auditabilidad total.

### 11.2 Timing recomendado (D2 = A): asiento al evento de completitud de cada vía

- **Operativa:** asiento al **confirmar el pago** (no hay inventario). `kind='gasto_operativo'`, cuenta de
  gasto según clasificación. Se postea vía **trigger** sobre `cash_movements` (así un movimiento creado
  offline postea solo al sincronizar — robusto sin conexión).
- **Mercadería:** asiento al **completar la revisión de inventario** (cuando el contador confirma cantidades y
  costo real). `kind='compra_inventario'`, cuenta de inventario/COGS (ej. `a5200`). Se postea **dentro de la
  RPC** `complete_inventory_review`, en la misma transacción que crea los `inventory_movements`.

> Por qué A y no "dos patas con cuenta puente": una pata por evento mantiene cada asiento como **una unidad
> atómica y reversible** atada a un único hecho, sin estados contables intermedios colgando. Más simple de
> auditar y de revertir. El costo es que el gasto de mercadería impacta el P&L al **completar inventario**, no
> al pagar — lo cual es correcto para costo real (COGS se conoce al ingresar stock).

### 11.3 Reversión (precisa)

Revertir el asiento `E`:
1. Insertar `E'` con `source_type='reversal'`, `amount_crc = -E.amount_crc`, mismas `account_id/year/month`,
   `reverses_entry_id = E.id`, `kind = E.kind`.
2. `update accounting_entries set status='reversed' where id = E.id` (el `status` es un marcador de estado, no
   una mutación del monto → no viola INV-3).
3. El trigger de rollup aplica el `-amount` → `finance_actuals` vuelve a cero neto para ese origen.

Idempotente: si `E` ya está `reversed`, la operación es no-op.

### 11.4 Fuera de alcance contable (v2+, ver D3)
IVA crédito fiscal de compras, cuentas por pagar como pasivo formal en libro, conciliación bancaria, y
cualquier cosa que requiera CABYS/CIIU o criterio de la contadora.

---

## 12. Borrado y reversión (extensión de mig 039)

`delete_movement_cascade(p_movement_id, p_note)` ya: valida owner/manager, snapshotea, audita en
`movement_deletions`, borra `inventory_movements` ligados + el `cash_movement`, en una transacción, idempotente.

**🆕 Se extiende (DDL aditivo, misma RPC o una 040) para, en la MISMA transacción:**
1. **Revertir** los `accounting_entries` con `source_id` del movimiento o de su inventario (contra-asientos, §11.3).
2. **Cerrar** la `inventory_review_task` ligada → `DESCARTADA` con `discard_reason='cascade'`.
3. (Decisión 🖊️ **D5**) **Borrar el `documents` ligado** (foto) si no lo referencia nada más, para que la
   factura se pueda **recargar** sin que el dedupe por `sha256` la frene.

**INV-7** cubre la atomicidad. La RPC sigue **requiriendo conexión** (offline BLOQUEA con mensaje claro, igual
que hoy — no se encola un borrado parcial).

---

## 13. Modelo de datos y migraciones propuestas

Todo **DDL aditivo**, numerado **040+**, idempotente (`if not exists` / `create or replace` /
`drop policy if exists`+`create`), con **firma de la dueña** antes de aplicarse a cualquier base.

- **`040_inventory_review_task.sql` 🆕**
  - `create table public.inventory_review_task (id, cash_movement_id uuid references cash_movements(id) on
    delete set null, supplier_id, document_id uuid references documents(id) on delete set null, status text
    check in ('PENDIENTE','EN_REVISION','COMPLETADA','DESCARTADA') default 'PENDIENTE', classification,
    suggested_classification, suggested_confidence numeric, amount, currency, fx_rate, entry_date,
    claimed_by/at, completed_by/at, discarded_by/at, discard_reason, created_by, created_at)`.
  - RLS: `select`/`write` para `owner/manager/contador` (cajero **no** completa).
- **`041_cash_movements_classification.sql` 🆕**
  - `add column if not exists classification text`, `suggested_classification text`,
    `suggested_confidence numeric` a `cash_movements`.
- **`042_accounting_entries.sql` 🆕** — tabla §11.1 + trigger de rollup a `finance_actuals` +
  `recompute_finance_actuals(year,month)`. RLS `select` owner/manager/contador.
- **`043_cascade_extends_accounting.sql` 🆕** — `create or replace` de `delete_movement_cascade` para
  revertir asientos + descartar tarea + (D5) borrar documento.
- **RPCs nuevas** (SECURITY DEFINER, transaccionales, idempotentes):
  - `complete_inventory_review(p_task_id uuid, p_lines jsonb, p_note text)` → crea `inventory_movements`,
    postea asiento `compra_inventario`, marca `COMPLETADA`.
  - `discard_inventory_review(p_task_id uuid, p_reason text)`.
  - `post_accounting_entry(...)` interna (no expuesta al cliente directamente).
- **Trigger** `after insert/update on cash_movements` → postea asiento `gasto_operativo` cuando
  `classification='operativa'` y el estado indica pagado (robusto para movimientos creados offline).

> ⚠️ **Nota de ledger:** la mig 039 se aplicó por dashboard y **no está en `schema_migrations`**. Antes de la
> 040, conviene reconciliar el ledger (o asumir el offset) para que `db push` no choque. Es trabajo de la
> sesión de migraciones, no de este SPEC.

---

## 14. Comportamiento offline (por paso)

| Paso | Offline | Mecanismo |
|---|---|---|
| Capturar + registrar pago | ✅ funciona | `cash_movement` con `client_op_id`, outbox durable (patrón existente) |
| Crear `inventory_review_task` PENDIENTE | ✅ (se materializa al sync) | trigger/RPC al insertarse el movimiento; o creación diferida en sync |
| Asiento operativo | ✅ (postea al sync) | trigger sobre `cash_movements` |
| Completar revisión de inventario | ❌ requiere conexión | RPC online (trabajo del contador, típicamente con red) |
| Borrar pago (cascada) | ❌ requiere conexión | igual que mig 039 hoy: BLOQUEA con mensaje |

---

## 15. Estrategia de testing

- **Unit (vitest, node):** matriz de pago por rol; clasificación advisory; idempotencia de asientos
  (`client_op_id` + unicidad parcial); reversión neta = 0; máquina de estados de la tarea; cascada extendida.
- **Integración de RPC** contra staging: `complete_inventory_review` (idempotente), cascada revierte asiento +
  descarta tarea, `recompute_finance_actuals` cuadra.
- ⚠️ **Gap conocido:** vitest corre en node, **sin DOM** (no hay RTL/jsdom) → los guards/flows de UI no se
  testean automáticamente (Hallazgo de HALLAZGOS.md). Recomendado sumar `happy-dom`+RTL **antes** de construir
  la UI de este módulo, para no repetir el loop `/`↔`/login` invisible que ya pasó.
- **Validación física** de la dueña obligatoria antes de cualquier pase, sobre staging desplegado.

---

## 16. ⚠️ Riesgos técnicos y dependencias (visibles)

1. **🔴 BUG ABIERTO — `Cmd+Shift+R` en `/caja` deja la app colgada** (PROMPT-CONTINUACION §0.1c, **sin RCA**).
   El nuevo "Agregar" vive en `CashTurno` = exactamente esa ruta. **No bloquea el diseño**, pero es
   **precondición de la fase de construcción de UI**: hacer el RCA + fix de ese cuelgue de arranque de `/caja`
   antes de apilarle el flujo nuevo. Documentado acá para que no se pierda.
2. **Cadena de dependencias de PROD.** Este módulo se apoya en **Bandeja Etapa 1 + inventario activo (mig 037)
   + cascada (mig 039)**, hoy **solo en staging, no en prod**. Aunque se construya y valide, su pase a prod
   arrastra esa cadena (+ el IDOR de `extract-document`, prerequisito de seguridad #1 de la Bandeja). No es un
   módulo que se pueda "subir solo".
3. **Módulo de Inventarios inexistente** (§10, D4): hay que construir/decidir el destino.
4. **Ledger de migraciones desincronizado** (mig 039 fuera de `schema_migrations`): reconciliar antes de la 040.
5. **Sin entorno DOM en tests** (§15): riesgo de regresiones de UI invisibles.

---

## 17. Plan de fases de implementación (post-firma, NO ahora)

1. **F0 — precondiciones:** RCA+fix del cuelgue `/caja` (riesgo #1); `happy-dom`+RTL; reconciliar ledger.
2. **F1 — esquema:** migraciones 040–043 (aditivas, firmadas) en staging; tipos regenerados.
3. **F2 — vía contable:** `accounting_entries` + trigger de rollup + reversión; tests; sin UI nueva todavía.
4. **F3 — módulo Inventarios:** cola + completar revisión (RPC `complete_inventory_review`).
5. **F4 — "un solo Agregar":** colapsar los 3 caminos de `CashTurno` en el asistente, con clasificación advisory.
6. **F5 — cascada extendida** (revertir asiento + descartar tarea + D5 foto).
7. **F6 — validación física** end-to-end de la dueña en staging → recién ahí se piensa el pase a prod (con su
   cadena de dependencias).

---

## 18. ✅ Decisiones de diseño — FIRMADAS (2026-06-26)

> Las 7 quedaron firmadas por la dueña, todas en su opción recomendada. El cuerpo del SPEC (§5–§14) ya
> refleja estas decisiones. Se conservan acá como **registro de decisión** (qué se eligió y por qué) para
> auditoría futura.

| # | Decisión | Elegida | Razón |
|---|---|:--:|---|
| **D1** | Modelo contable | **C** | Libro `accounting_entries` append-only y reversible que alimenta `finance_actuals`. Auditoría y reversión limpias sin doble partida formal; reusa el P&L existente; una sola tabla nueva. (A) over-engineering, (B) pierde el rastro reversible. |
| **D2** | Timing del asiento | **A** | Al evento de completitud de cada vía (operativa: al pagar; mercadería: al completar inventario). Cada asiento atómico y reversible, sin estados contables colgando. |
| **D3** | IVA crédito de compras | **B** | Diferir a v2. Bloqueado por CABYS/CIIU y criterio de la contadora; no atar este módulo a un bloqueo externo. |
| **D4** | Módulo de Inventarios destino | **A** | Construir `src/modules/inventory/` mínimo (cola + completar) reusando el motor de `InventoryStep` extraído a un servicio compartido. Limpio, extensible, separa responsabilidades. |
| **D5** | Foto al borrar una factura | **A** | Borrar el `documents` dentro de la cascada (si nada más lo referencia) → permite recargar sin que el dedupe por `sha256` frene. Coherente con "borrar = revertir todo". |
| **D6** | ¿Reemplaza la Etapa 2? | **A** | Reemplaza. Esta unificación ES la entrada foto-primero dentro de Caja Diaria que buscaba la Etapa 2; se marca la Etapa 2 como **subsumida por este SPEC**. |
| **D7** | Claim de tarea (`EN_REVISION`) | **B** | `claimed_by` como indicador suave en v1, sin estado duro. Suficiente con un contador; se endurece a estado `EN_REVISION` cuando haya varios revisores. |

> **Consecuencia de D6 para el roadmap:** marcar "Bandeja — Etapa 2" como **subsumida por este SPEC** en
> `ROADMAP.md` (ya no es una fase independiente).

---

*Fin del SPEC v1 — decisiones de diseño firmadas. La construcción exige cumplir F0 (§17); cada migración 040+
exige firma separada antes de aplicarse a una base. Este documento NO autoriza código.*

---

## 19. Visión de fases futuras — P&L granular y alertas inteligentes (FUERA DE ALCANCE v1)

> Registrada a pedido de la dueña (2026-06-26) como objetivo de fases posteriores. NO se construye en v1.
> v1 mantiene el P&L como está (derivación en vivo de getLiveActuals a nivel de movimiento + carga manual
> del contador). Esta sección describe la evolución hacia un P&L a nivel de línea de factura.

### 19.1 Problema que resuelve
Hoy muchos proveedores facturan rubros distintos en una sola factura (carnes, limpieza, insumos de cocina…).
Para clasificar correctamente en el P&L se piden facturas separadas por rubro, lo que duplica/triplica las
fotos a cargar, multiplica el trabajo de revisión del contador y obliga a diferenciar gastos a mano.

### 19.2 Visión: clasificación a nivel de LÍNEA
- Cada producto/ingrediente se crea con su categoría y subcategoría (= cuenta del P&L) definida.
- Al cargar UNA sola factura multi-rubro, la IA extrae las líneas y propone la clasificación por línea; el
  contador confirma (mismo principio advisory del v1, pero a nivel de línea).
- Una factura única alimenta el P&L granular automáticamente — se elimina la necesidad de facturas separadas.

### 19.3 Gastos operativos no-mercadería, estructurados
Registrar de forma estructurada electricidad, alquiler, suscripciones, etc., distinguiendo el medio de pago
(caja vs transferencia bancaria), para que también alimenten el P&L granular y las alertas.

### 19.4 Alertas inteligentes (capa sobre P&L granular + budget)
Con datos a nivel de línea + el finance_budget existente (proyección 2026): variación de precio de un
ingrediente entre facturas, faltantes/excesos de inventario (cruzando inventory_movements), anomalías y
desviaciones de costo vs proyección (actual vs budget por cuenta/mes).

### 19.5 Cómo encaja con v1 (relación con el doble-conteo)
Es la Opción B del análisis de doble-conteo, pero hecha bien: cuando exista clasificación a nivel de línea,
accounting_entries (o una estructura de líneas asociada) puede pasar a ser la fuente granular del P&L,
reemplazando la derivación gruesa de getLiveActuals. En v1 NO se hace porque getLiveActuals no tiene datos a
nivel de línea; meterlo ahora duplicaría el conteo. El accounting_entries de v1 (auditoría/reversión) es la
semilla de esa fuente granular futura.

### 19.6 Precondiciones técnicas
Catálogo de productos/ingredientes con categoría+subcategoría (cuenta P&L) por ítem; extracción IA a nivel de
línea de factura; supplier_item_map enriquecido (línea→ingrediente→cuenta); confirmación del contador por
línea; migración de getLiveActuals a la fuente granular (resolviendo el doble-conteo de raíz).
