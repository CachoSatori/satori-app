# Arranque de cero en STAGING · acta

**Decisión:** staging arranca de cero, como si el restaurante abriera por primera vez.
Se terminó validar contra números históricos. **`main` intacto en `9fc1147`.**

---

## ⚠️ Lo primero: la dueña empezó su arranque MIENTRAS corría esto

Staging se estuvo **mutando en vivo** durante todo el trabajo. Dos veces quedó registrado:

1. Antes del vaciado, 8 filas desaparecieron solas (el asiento de apertura del 22/07 que se
   había sembrado + los 7 movimientos del día). La sesión del 22/07 pasó de `1e53e04e`/cerrada
   a `f724e721`/abierta: un **descarte de turno** desde la app, que se lleva sus movimientos
   por CASCADE.
2. **Después del vaciado**, la dueña cargó su propio arranque.

**Por eso NO se volvió a vaciar la base.** El paso 6 pedía dejarla vacía *para que la dueña
haga su arranque* — y ya lo está haciendo. Borrarlo sería destruir exactamente lo que el
ejercicio buscaba habilitar. La base quedó **con los datos de ella**, no vacía.

### Lo que hay ahora en staging

| | |
|---|---|
| `cash_movements` | **1** — su ingreso `Banco → Caja Fuerte` **₡744.570 / $3.441** |
| `cash_sessions` | **1** — Caja Diaria del **22/07**, **abierta**, fondo **₡100.000**, cajero *Cacho* |
| `cash_cierres_dia` · `tip_sessions` · `tip_entries` · `documents` · `movement_deletions` | **0** |
| restos de las pruebas de este trabajo | **0** ✅ |

---

## 1 · Backup

Dos backups completos, **verificados fila por fila** (JSON parseado y contado, no solo escrito):

```
_backups-staging/2026-07-22-pre-arranque-cero/   ← primero
_backups-staging/2026-07-22-pre-vaciado/         ← el bueno, justo antes del delete
```

| tabla | filas |
|---|---:|
| cash_movements | 1.423 |
| tip_entries | 1.335 |
| tip_sessions | 240 |
| cash_sessions | 168 |
| movement_deletions | 98 |
| documents | 85 |
| suppliers | 75 |
| employees | 35 |
| cash_cierres_dia | 17 |
| role_tip_points | 7 |
| exchange_rates | 3 |
| **total** | **3.486** |

### 🔧 Bug encontrado en el runbook de restore

`restaurar.ts` tenía `ORDEN_RESTORE` **sin `cash_cierres_dia`**. El backup la guardaba, pero el
restore la **saltaba en silencio**: se podía "restaurar" y quedarse sin los 17 cierres. Se
corrigió antes de borrar nada — un backup del que no se puede volver no es un backup.
La tabla no tiene FKs (ni hijo ni padre), así que su posición en el orden es indiferente.

**El espejo de prod se repone con el refresh cuando haga falta.** No se perdió nada.

---

## 2 · Vaciado

`scripts/refresh-staging/vaciar-operacion.ts` — orden **hijos → padres** del grafo real de FKs
(`pg_catalog`), con tres candados: ref de staging clavado, `VACIAR ⊆ TABLAS_REFRESH` (solo se
borra lo que el backup sabe reponer) y `--confirmar` obligatorio.

### En cero ✅

| tabla | antes | después |
|---|---:|---:|
| tip_entries | 1.335 | **0** |
| tip_sessions | 240 | **0** |
| documents | 85 | **0** |
| movement_deletions | 98 | **0** |
| cash_movements | 1.423 | **0** |
| cash_sessions | 168 | **0** |
| cash_cierres_dia | 17 | **0** |

### Intactas ✅

| catálogo | filas |
|---|---:|
| suppliers | 75 |
| employees | 35 |
| exchange_rates | 3 |
| role_tip_points | 7 |
| **profiles** | 5 |

> `role_tip_points` se conservó aunque no estaba en la lista: es **configuración** (puntos de
> propina por rol), no operación, y no referencia sesiones — el mismo criterio que
> `exchange_rates`. Vaciarla habría roto el cálculo de propinas.
> `profiles` nunca se toca: sus ids son los de `auth.users` y copiarla/borrarla rompe el login.

### Residuo fuera de alcance (reportado, no tocado)

Tres tablas referencian lo borrado con `ON DELETE SET NULL`, así que **conservan sus filas con
los links en NULL**. No se vaciaron porque **están fuera de `TABLAS_REFRESH`: el backup no las
guarda**, y borrar lo que no se puede reponer no es aceptable.

| tabla | filas | qué le quedó colgando |
|---|---:|---|
| `inventory_review_task` | 135 | `cash_movement_id` y `document_id` en NULL |
| `inventory_movements` | 78 | ídem |
| `ingredient_prices` | 234 | `document_id` en NULL |

Si querés estas también en cero, hay que **extender el backup primero**. Decilo y lo hago.

---

## 3 · Nada sembrado ✅

Cero aperturas, cero movimientos, cero datos de ejemplo. La base quedó vacía y la dueña la
llenó con lo suyo.

---

## 4 · Estado vacío — un arreglo real

Verificado con base vacía: **Pendientes 0**, **Propinas por pagar 0**, listas vacías, y la Caja
Diaria **se puede abrir por primera vez** (sin cierres previos `getPreviousCierre` devuelve
`null` → no hay carryover sugerido ni confirmación que trabe).

### 🔧 La tarjeta se renombraba sola el primer día

Con base vacía el número era ₡0 y no había warnings — eso estaba bien. Pero el **modo** no:

`saldoTarjetaEfectivo` decide post-corte **por los datos**. Sin una sola fila no hay datos que
mirar, así que caía al **modelo viejo** y la tarjeta se rotulaba **"Caja Fuerte"**. Al registrar
el primer movimiento pasaba a pozo y **se renombraba sola a "Efectivo en caja"**, con subtítulo
nuevo. El número es ₡0 por las dos vías; lo que cambiaba era el significado, el primer día.

**Arreglo** (`tarjetaPozo.ts`): con `movements.length === 0` la tarjeta va **en modo pozo** con
₡0/$0 y `desdeApertura = null`. El modo pre-corte existe para **no tocar el histórico**; sin
histórico, no protege nada.

> **Deliberadamente NO se generalizó** a "solo hay filas pre-corte". Con los datos reales de
> prod (corte `2026-08-01`, todo el ledger anterior) la tarjeta **debe** seguir en
> `saldoCajaFuerte`. `length === 0` es el único borde donde no hay nada que preservar.
> `saldoCajaFuerte` **no se tocó** — sigue sagrado.

---

## 5 · Humo de la lógica — los 4 pasos

La base de staging ya es de la dueña, así que el ciclo se corrió **en test puro sobre una base
realmente vacía**, con los números absolutos pedidos:

| paso | movimiento | tarjeta | |
|---|---|---:|---|
| a | traspaso `Banco → Caja Fuerte` **₡500.000** | **₡500.000** | ✅ |
| b | egreso **EFECTIVO** ₡10.000 (Caja Proveedores) | **₡490.000** | ✅ baja exacto |
| c | egreso **TRANSFERENCIA** ₡50.000 | **₡490.000** | ✅ no se mueve |
| d | ingreso **EFECTIVO** ₡20.000 (Registradora) | **₡510.000** | ✅ sube exacto |

`500.000 − 10.000 − 0 + 20.000 = 510.000` — la transferencia no entra.

### Y además, contra la base viva (deltas exactos)

Antes de que se supiera que la dueña ya había cargado lo suyo, el mismo ciclo corrió contra
staging. Los **absolutos** no dieron los de la tabla porque su ₡744.570 estaba debajo — pero
**los cuatro deltas dieron exactos**, que es lo que prueba la lógica:

| paso | delta esperado | delta observado | |
|---|---:|---:|---|
| a | +500.000 | **+500.000** | ✅ |
| b | −10.000 | **−10.000** | ✅ |
| c | 0 | **0** | ✅ |
| d | +20.000 | **+20.000** | ✅ |

Las 4 filas de prueba se borraron (`finally`): **0 restos**.

---

## 6 · ⚠️ Su asiento de apertura está fechado 21/07 — cae PRE-corte

Su ingreso `Banco → Caja Fuerte` tiene `created_at = 2026-07-21 12:00:00+00` y `session_id`
nulo, así que su **fecha operativa es el 21/07** — **anterior al corte (22/07)**.

Consecuencia: hoy la tarjeta está en **modo viejo** (`esPozo=false`, rótulo *"Caja Fuerte"*).
El número que muestra, **₡744.570**, es correcto. Pero en cuanto registre el primer movimiento
del 22/07, la tarjeta **cambia de modo y de rótulo** a *"Efectivo en caja"* — el mismo salto que
se acaba de arreglar para la base vacía, que acá no aplica porque **sí** hay una fila.

**Recomendación:** que ese ingreso quede fechado **22/07** (o el día en que realmente arranca).
Así la tarjeta está en modo pozo desde el primer minuto y no cambia de significado sola. Es un
cambio de dato, de una fila, y no lo toco sin tu visto bueno.

---

## 7 · Guardrails

| gate | resultado |
|---|---|
| Sagrados byte-idénticos | `tipCalculations` **7603ba5a** · `cashUtils` **b597c697** · `posFiscal` **a3fd445f** ✅ |
| Suite | **479/479** · 57 archivos (+7: base vacía y ciclo de arranque) ✅ |
| `build:staging` y `build` de producción | verdes ✅ |
| Migraciones | **cero** ✅ |
| Escrituras | **solo staging**, por `gate.ts` con el ref clavado en código ✅ |
| PROD | **no se leyó ni se escribió una sola vez** en todo este trabajo ✅ |
| Push | **solo `staging`** ✅ |

---

## 8 · Si hay que volver atrás

```bash
node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
  scripts/refresh-staging/restaurar.ts --sello 2026-07-22-pre-vaciado
```

Repone las 11 tablas (ahora **sí** incluida `cash_cierres_dia`). Ojo: **pisa** lo que la dueña
cargó después del vaciado.
