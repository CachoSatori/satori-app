# Refresh de datos STAGING ← PROD · plan read-only

> **Estado: FRENADO en el paso 3 (la copia), a la espera de una decisión.** El esquema cierra,
> pero hay una **FK dura de `created_by` contra `profiles`** y `profiles.id` cascadea a
> `auth.users`. La consigna era explícita: *"si `created_by` tiene FK dura contra usuarios, pará
> y reportá opciones en vez de forzar"*. Las opciones están en §4.
>
> **STAGING quedó ÍNTEGRO** — los 11 conteos coinciden con el backup previo (§5).

## 1 · Diff de esquema (read-only, ambas bases)

| | prod `yiczgdtirrkdvohdquzf` | staging `hwiatgicyyqyezqwldia` |
|---|---|---|
| Tablas en `public` | 33 | 50 |

- **Solo en staging (17)** — el PoS y los backups viejos: `pos_orders`, `pos_order_items`,
  `pos_checks`, `pos_payments`, `pos_prices`, `pos_kds_settings`, `menu_categories`,
  `menu_families`, `modifier_groups`, `modifiers`, `product_modifier_groups`,
  `product_modifier_options`, `salon_tables`, `locations`, `fe_documentos`,
  `cash_movements_pre_migracion_2026_07`, `suppliers_pre_migracion_2026_07`. **No se tocan.**
- **Solo en prod: ninguna.** Nada que copiar quedaría sin destino.
- **Compartidas: 33**, de las cuales **31 con columnas idénticas**.

### Las 2 que difieren

| Tabla | Diferencia | Decisión |
|---|---|---|
| `product_map` | staging tiene 8 columnas del PoS que prod no (`station`, `allergens`, `cabys`, `ciiu`, `photo_url`, `prep_time_min`, `is_active`, `aplica_servicio`) | **EXCLUIDA.** Copiar prod las dejaría en default y rompería el PoS de staging |
| `tip_sessions` | staging tiene `pool_pos_crc` y `pool_pos_usd` (NOT NULL, propinas del PoS) | **Incluida**, omitiendo esas dos columnas: toman su DEFAULT. Limitación conocida: las propinas del PoS quedan en 0 |

**Ninguna columna existe solo en prod** → la copia no pierde datos por estructura.

## 2 · Grafo de FKs — 🔴 acá está el bloqueo

> ⚠️ **`information_schema` NO reporta estas FKs.** La primera auditoría se hizo con
> `information_schema.table_constraints` y devolvió *cero* constraints en ambas bases. Es falso.
> El grafo real sale de `pg_catalog.pg_constraint`, y fue la propia base la que lo corrigió,
> rechazando el primer INSERT. **Para auditar FKs en este proyecto, usar `pg_constraint`.**

FKs que afectan al alcance:

| FK | `on delete` | Impacto |
|---|---|---|
| `cash_movements.created_by → profiles` | NO ACTION | 🔴 **el bloqueo** |
| `cash_movements.approved_by → profiles` | NO ACTION | 🔴 ídem |
| `cash_movements.factura_verified_by → profiles` | NO ACTION | 🔴 ídem |
| `cash_sessions.opened_by / closed_by / midday_check_by → profiles` | NO ACTION | 🔴 ídem |
| `tip_sessions.opened_by / closed_by → profiles` | NO ACTION | 🔴 ídem |
| `exchange_rates.created_by → profiles` | NO ACTION | 🔴 ídem |
| `movement_deletions.deleted_by / authorized_by → profiles` | NO ACTION | 🔴 ídem |
| `documents.created_by → profiles` | NO ACTION | 🔴 ídem |
| `employees.profile_id → profiles` | SET NULL | tolerable |
| **`profiles.id → auth.users`** | **CASCADE** | 🔴 no se puede crear un profile sin su usuario de auth |
| `cash_movements.session_id → cash_sessions` | **CASCADE** | ⚠️ orden de borrado (ver §5) |
| `tip_entries.session_id → tip_sessions` | CASCADE | ⚠️ orden |
| `tip_entries.employee_id → employees` | NO ACTION | ⚠️ orden |
| `cash_movements.supplier_id → suppliers` | SET NULL | ⚠️ orden |
| `documents.linked_movement_id → cash_movements` | SET NULL | ⚠️ orden |

## 3 · Alcance de la copia

**Se copian los DATOS (nunca la estructura) de 11 tablas** — el dominio Caja + Propinas, que es
lo que se valida en piso:

`cash_movements` · `cash_sessions` · `cash_cierres_dia` · `suppliers` · `tip_sessions` ·
`tip_entries` · `role_tip_points` · `employees` · `exchange_rates` · `movement_deletions` ·
`documents`

**Excluidas a propósito:** `profiles` (auth) · `product_map` (columnas del PoS) · las 17 tablas
del PoS · `finance_*` · `ventas_*` · `accounting_entries` · inventario (`ingredients`,
`ingredient_prices`, `recipes`, `recipe_ingredients`, `inventory_*`) · `customers`,
`customer_interactions`, `loyalty_*`, `sops`, `supplier_item_map`.

> Efecto lateral asumido: al reemplazar `suppliers`, las filas de `supplier_item_map` de staging
> quedan apuntando a proveedores que ya no existen. Es cosmético y del dominio inventario, fuera
> del alcance de esta validación.

## 4 · 🔴 EL BLOQUEO, con números — y las opciones

`profiles`: **prod 7 · staging 5 · solo 3 ids en común.**

Cuatro perfiles existen en prod y **no** en staging:

| id | rol | nombre |
|---|---|---|
| `c10f2ddf-535a-4c2d-99db-30d5084629c6` | manager | Ignacio aristiaran |
| `f54e3eff-7751-4b3c-a94e-c9d26c98a80e` | manager | Rosaura |
| `973fb3c5-26b9-4c96-a816-e951967d5b45` | barman | NACHO |
| `98a300a3-a16a-4d97-b8b9-e549a2510e81` | contador | Kiumarz Tavakoly |

Filas de prod que los referencian y que **la FK va a rechazar**:

| columna | filas |
|---|---|
| `cash_movements.created_by` | 9 |
| `cash_sessions.opened_by` | 1 |
| `tip_sessions.opened_by` | 3 |
| `movement_deletions.deleted_by` | 1 |
| **total** | **14** |

Son pocas filas, pero **una de ellas es un `cash_session`**: si se descartara, su CASCADE se
llevaría también los movimientos de ese turno.

### Opciones (la decisión es de la dueña)

| # | Qué es | Toca auth | Toca esquema | Fidelidad | Reversible |
|---|---|---|---|---|---|
| **1** | **Sembrar los 4 perfiles faltantes en staging**: crear 4 usuarios en `auth.users` de staging con los MISMOS uuid de prod (lo exige `profiles.id → auth.users`), y luego sus 4 `profiles`. | **Sí** (aditivo: 4 usuarios nuevos, ninguno existente se modifica) | No | **100%** | Sí (borrar los 4 usuarios; el cascade limpia los profiles) |
| **2** | **Remapear los 14 registros**: copiar todo, reescribiendo esos 4 uuid a un perfil que ya existe en staging. | No | No | Alta — cambian montos: ninguno; cambia **quién** registró 14 filas | Sí (backup) |
| **3** | Copiar solo lo que no rompe (descartar las 14 filas). | No | No | **Baja** — y el `cash_session` descartado arrastra sus movimientos por CASCADE | Sí |
| **4** | Dropear/recrear las FKs alrededor de la copia. | No | **Sí** | 100% | — |

**Recomendación: opción 2.** Es la única que no toca ni auth ni esquema, es reversible con el
backup, y las 14 filas afectadas **no influyen en ningún número que la dueña valida**: ni el pozo
ni el cierre leen `created_by` — solo montos, cajas, métodos y fechas, que se copian intactos. Lo
único que se pierde es de quién fue la mano en 14 registros.

**Opción 4 descartada de plano:** el guardrail dice cero migraciones de esquema.

## 5 · Backup y estado actual

Backup completo de las 11 tablas **antes** de tocar nada:
`_backups-staging/2026-07-22-pre-refresh/` (carpeta gitignoreada) — **3.415 filas**, con su
`RESTAURAR.md`.

El primer intento de copia **falló en la primera tabla** (`cash_movements`) por la FK de
`session_id`, dejando esa tabla vacía. Se restauró desde el backup. La restauración destapó una
segunda trampa: **borrar `cash_sessions` cascadea sobre `cash_movements`**, así que restaurar en
el orden del alcance se llevaba puesto lo ya restaurado (quedaron 19 filas: justo las de
`session_id` nulo). `restaurar.ts` ahora restaura en orden **padres → hijos** y acepta `--solo`.

**Verificación final: las 11 tablas coinciden con el backup, 0 movimientos con sesión colgada,
los 5 `documents.linked_movement_id` intactos.** Staging quedó como estaba.

## 6 · Limitaciones conocidas de un refresh (cuando se ejecute)

- **Storage NO se copia.** Las fotos de facturas viven en el bucket `facturas` de prod; las filas
  de `documents` copiadas apuntarán a paths que en staging no existen → las imágenes no van a
  renderizar. Es esperable y no afecta ningún número.
- **`tip_sessions.pool_pos_*`** quedan en 0 (columnas del PoS que prod no tiene).
- **`created_by` sin perfil** — según la opción que se elija (§4), algunos movimientos pueden
  quedar atribuidos a otra persona.
- **`supplier_item_map`** queda con referencias colgadas a proveedores reemplazados.

## 7 · Cómo se corre (una vez decidida la opción)

```bash
# 1. Backup SIEMPRE primero
node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
  scripts/refresh-staging/backup.ts --sello <AAAA-MM-DD>-pre-refresh

# 2. Copia (exige firma de prod + confirmación explícita + backup previo)
T0_PROD_FIRMADO=2026-07-22 node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
  scripts/refresh-staging/refresh.ts --confirmo-borrar-staging --sello <AAAA-MM-DD>-pre-refresh

# Restaurar si algo sale mal
node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
  scripts/refresh-staging/restaurar.ts --sello <AAAA-MM-DD>-pre-refresh
```

`refresh.ts` aborta si falta la firma, si falta `--confirmo-borrar-staging`, o si no existe el
backup. Las tres cosas fueron probadas.
