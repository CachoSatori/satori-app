# Pase a STAGING · acta

**Rama desplegada:** `staging` ← `feat/t2-cierre-pozo` (fast-forward, sin merge commit).
**Commit:** `5f78b56` · **`main` intacto en `9fc1147`.**
**Fecha de corte activa:** **2026-07-23** · **Apertura del pozo: ₡744.575 · $3.441,00**

---

## 1 · Refresh de datos prod → staging

Copiados los **DATOS** (nunca la estructura) de **11 tablas · 3.451 filas**. Cero migraciones.
PROD **nunca se tocó**: el smoke de rechazo de escritura (`25006`) se verificó antes de leer un
solo dato, y todas las lecturas fueron con `read_only: true`.

| tabla | staging antes | prod | staging después |
|---|---|---|---|
| `employees` | 31 | 35 | **35** ✅ |
| `suppliers` | 85 | 75 | **75** ✅ |
| `exchange_rates` | 3 | 3 | **3** ✅ |
| `role_tip_points` | 7 | 7 | **7** ✅ |
| `cash_sessions` | 169 | 167 | **167** ✅ |
| `tip_sessions` | 177 | 239 | **239** ✅ |
| `cash_movements` | 978 | 1423 | **1423** ✅ |
| `tip_entries` | 1047 | 1332 | **1332** ✅ |
| `documents` | 107 | 79 | **79** ✅ |
| `movement_deletions` | 797 | 74 | **74** ✅ |
| `cash_cierres_dia` | 16 | 17 | **17** ✅ |

**Conteos prod == staging en las 11.** Integridad verificada: **0** movimientos con sesión
colgada · **0** con perfil inexistente · **0** con proveedor inexistente · **0** entradas de
propina sin sesión o sin empleado.

Backup previo: `_backups-staging/2026-07-22-pre-refresh-2/` (gitignoreado, con su `RESTAURAR.md`).

### Remapeo de perfiles (opción 2, firmada) — **49 valores, no 14**

> ⚠️ La estimación de 14 del PLAN era **incompleta**: se habían medido 5 de las **13** columnas
> con FK a `profiles`. El número real, medido sobre las 13, es **49**.

| columna | valores | destino |
|---|---|---|
| `movement_deletions.authorized_by` | 28 | owner |
| `cash_movements.created_by` | 9 | owner |
| `tip_sessions.opened_by` | 3 | owner |
| `tip_sessions.closed_by` | 3 | owner |
| `cash_sessions.closed_by` | 2 | owner |
| `cash_sessions.opened_by` | 1 | owner |
| `movement_deletions.deleted_by` | 1 | owner |
| `employees.profile_id` | 2 | **NULL** |
| **total** | **49** | |

Owner destino: `cb2b00f2-b1eb-4f27-9bf1-f23cebcd1888` — *Caja Satori · satorisushibar@gmail.com*.

**Los 2 de `employees.profile_id` van a NULL, no al owner.** Esa columna no es un sello de
auditoría: es el vínculo entre un empleado y su cuenta. Apuntarla al owner diría que esos dos
empleados **son** la dueña. `NULL` es un valor legítimo (la FK es `ON DELETE SET NULL`). Prod
tenía exactamente 2 empleados con perfil vinculado y son esos dos, así que staging queda con 0.

El remapeo se hace **en memoria antes de insertar**: nunca se le manda a la base un valor que
la FK vaya a rechazar.

## 2 · Harness sobre los datos frescos

Reportes regenerados (`REPORTE-T0-RECONCILIACION.md`) y red de regresión (`run-t2.ts`) **en
verde**. Como staging ahora tiene los datos de prod, los números coinciden con los del T0-B:
15 cierres completos · 10 CUADRÓ · 3 CANDIDATO-HUECO-1 · 2 NO-EXPLICADO · pozo −₡3.394.461,21.

### 🆕 Hallazgo nuevo que destapó la red de regresión

Los campos sellados **`propinas_m/n` incluyen propinas pagadas por TRANSFERENCIA**:
**₡15.000 el 2026-07-19** y **₡9.000 el 2026-07-20**. Esa plata **nunca salió del efectivo**.
El modelo viejo la restaba del "debería"; el pozo, con razón, no. Es la misma clase de bug que
T2 arregla, ahora medida en otra columna.

`run-t2.ts` ya no compara solo conteos: por cada par donde el modelo nuevo difiere del núcleo
T1 calcula la porción NO-efectivo metida en el sello y **exige** que explique la diferencia. Las
dos divergencias cierran al céntimo; cualquier otra aborta la corrida.

### 🆕 Gap de T2 encontrado y cerrado

Al sembrar la apertura salió que `basePozoParaCierre` sumaba la apertura **más toda la historia
previa** — sobre un ledger con historial el "debería" quedaba inservible. El pozo ahora
**arranca en el asiento de apertura más reciente**: corte por arriba `<= fecha` (independencia
del orden de sellado) y por abajo `>= apertura` (esa cifra ya contiene lo anterior). 4 tests
nuevos, incluido el caso sin apertura, donde el comportamiento previo queda intacto.

## 3 · Apertura del pozo sembrada

```
  ╔════════════════════════════════════════════════════════╗
  ║   APERTURA DEL POZO — STAGING                          ║
  ║   Fecha del asiento : 2026-07-23                       ║
  ║   Origen            : cierre completo del 2026-07-21   ║
  ║   ────────────────────────────────────────────────     ║
  ║   COLONES : ₡ 744.575                                  ║
  ║   DÓLARES : $ 3.441,00                                 ║
  ╚════════════════════════════════════════════════════════╝
```

Sale del **conteo físico sellado** de ese cierre: `sep_diaria 100.000 + sep_registradora 99.575
+ remanente 545.000`. **Éste es el número que la dueña verifica** contra lo que contó esa noche.
El asiento es idempotente por descripción: re-sembrarlo corrige, no duplica.

## 4 · Cómo quedó activada la fecha de corte

**Por el PLAN B: commit solo-staging `5f78b56`**, que adelanta `POZO_CORTE_FALLBACK` a
`2026-07-23`. Marcado en el código y en el commit: **NO CHERRY-PICKEAR A MAIN** (en `main` debe
seguir siendo `2026-08-01`).

**Por qué el plan B y no la variable de entorno:** el repo solo tiene workflow para **prod**
(`.github/workflows/deploy.yml` → GitHub Pages). **Staging es Cloudflare Pages con configuración
externa** — no hay workflow en el repo, la integración git de CF buildea el push sola. La
variable `VITE_POZO_CORTE` solo se puede cargar desde el dashboard de Cloudflare, y desde acá no
hay forma de setearla ni de verificarla.

**Las dos vías conviven.** `resolverCorte()` devuelve la variable de entorno si es válida y solo
cae al fallback si no está. Si cargás `VITE_POZO_CORTE` en Cloudflare, **gana sobre este commit**
y el plan B queda inerte — no hay que revertir nada.

Verificado: `VITE_APP_ENV=staging npm run build` deja `2026-07-23` en `dist/assets/cierrePozo-*.js`.

## 5 · Deploy verificado ✅

| Verificación | Resultado |
|---|---|
| `staging` remoto | `5f78b56` (app) → `c837cc5` (este reporte, solo docs) |
| `main` | **intacto en `9fc1147`** |
| Cloudflare Pages | publicado — `builtAt` 2026-07-22T17:08:22Z |
| `version.json` | `{"commit":"5f78b56"}` ✅ |
| Sitio | `/` HTTP 200 · `/sw.js` HTTP 200 ✅ |
| **Fecha de corte en el bundle desplegado** | `assets/cierrePozo-C4juHvCa.js` contiene **`2026-07-23`** y **no** contiene `2026-08-01` ✅ |
| **Etiqueta del cierre desplegado** | `assets/CashCierre-DyitJ5Pd.js` trae *"Ventas en efectivo BRUTAS ₡ (sin restar propinas)"* ✅ |

> El chunk del corte es **lazy** (cuelga de `CashModule`), así que no aparece en el HTML: se lo
> alcanza desde `CashModule-*.js`. Queda anotado porque buscarlo en la raíz da un falso negativo.

Tras verificar, se pushó `c837cc5` con este reporte (**solo `.md`**, sin cambios de app), así que
Cloudflare va a republicar y `version.json` pasará a `c837cc5`. **El bundle de la aplicación es el
mismo.**

Para re-verificar en cualquier momento:

```bash
curl -s https://satori-staging.pages.dev/version.json
curl -s https://satori-staging.pages.dev/assets/cierrePozo-C4juHvCa.js | grep -o 2026-07-23
```

## 6 · Limitaciones conocidas

- **Fotos de facturas: no se ven.** El Storage no se copia; las filas de `documents` apuntan a
  paths del bucket de prod que en staging no existen. No afecta ningún número.
- **`tip_sessions.pool_pos_*` en 0** — columnas del PoS que prod no tiene.
- **49 valores de "quién" remapeados** (§1): 47 movimientos/sesiones figuran a nombre de *Caja
  Satori* y 2 empleados quedaron sin cuenta vinculada. Montos, cajas, métodos y fechas están
  intactos.
- **`supplier_item_map`** quedó con referencias a proveedores reemplazados (dominio inventario,
  fuera del alcance).
- **`product_map` NO se refrescó** (tiene 8 columnas del PoS que prod no tiene).

## 7 · Pasos para la validación en piso

1. **Verificá el deploy**: `version.json` debe decir `5f78b56` (§5).
2. **Entrá a Caja → Cierre del Día** y elegí una fecha **≥ 2026-07-23**. La etiqueta de ventas
   tiene que decir **"Ventas en efectivo BRUTAS ₡ (sin restar propinas)"**. Si dice
   *"Ventas PoS ₡"*, el corte no está activo — parar y avisar.
3. **Verificá la apertura**: en Movimientos buscá `Apertura pozo 2026-07-23`. Tiene que decir
   **₡744.575** y **$3.441,00**. Compará contra tu conteo físico del 21/07.
4. **Probá el aviso de venta neta**: cargá una venta MENOR que las propinas pagadas del día. Tiene
   que aparecer el aviso rojo y el botón de sellar queda **bloqueado** hasta tildar la casilla.
   Es la trampa que causó el sobrante de ₡58.737,07 del 18/07.
5. **Probá el pago de proveedor desde el fondo**: pagá un proveedor en efectivo desde
   `Caja Proveedores` y cerrá el día. **Ya no debe aparecer faltante fantasma**: ese pago ahora
   baja el "debería" solo.
6. **Probá una propina**: pagala por la vía normal y cerrá. Tiene que restar **una sola vez**.
7. **Probá el guard de cadena**: si quedó un día anterior (≥ corte) con plata movida y sin cerrar,
   el cierre **no deja sellar** y dice qué día falta y cuánto se movió.
8. **Cuadre final**: contá el físico y confirmá que el "debería" coincide. En el resumen de
   verificación el desglose ahora es *pozo + ventas brutas − retiro*, y **suma exacto**.

> ⚠️ Los días **anteriores al 2026-07-23** siguen con el modelo viejo, sin ningún cambio. Si abrís
> un cierre histórico, tiene que verse y calcular **igual que siempre**.

## 8 · Si hay que volver atrás

```bash
# datos de staging
node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
  scripts/refresh-staging/restaurar.ts --sello 2026-07-22-pre-refresh-2

# código
git push origin 933c387:staging --force-with-lease
```
