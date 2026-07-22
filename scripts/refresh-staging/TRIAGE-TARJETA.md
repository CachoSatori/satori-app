# Triage · la tarjeta de Caja Fuerte mostraba números absurdos

**Commit desplegado en staging: `de3e423`** · `main` intacto en `9fc1147`.
Dos bugs independientes, los dos confirmados con números exactos.

---

## BUG 1 · El fetch venía truncado

`getAllCashMovements` hacía `select('*').gte(...).order('created_at', desc)` — **sin `.range()`
ni `.limit()`**. PostgREST corta en `max_rows` y devuelve esa página **sin ningún aviso**: no hay
error, no hay flag, la app cree que tiene todo.

### Corrección a la hipótesis: no es el conteo de filas, es el conteo contra el cap de CADA proyecto

| proyecto | `max_rows` | filas | ¿trunca? |
|---|---|---|---|
| **PROD** `yiczgdtir…` | **10.000** | 1.423 | **NO** |
| **STAGING** `hwiatgic…` | **1.000** | 1.425 | **SÍ** |

Prod **no "da bien de casualidad"**: da bien porque su cap está 10× más alto. El código es igual
de frágil en las dos, pero hoy prod no miente. Se rompe pasadas las 10.000 filas.

> Este dato salió de la config real (`GET /v1/projects/{ref}/postgrest`), no de suponer que
> Supabase usa 1.000 en todos lados.

### Reproducción al colón

Reproduciendo el fetch exacto de la app contra staging (`order by created_at desc limit 1000`) y
recalculando `saldoCajaFuerte` sobre ese subconjunto:

| | CRC | USD |
|---|---|---|
| Lo que ve la app (1.000 filas) | **₡630.218,92** | **−$3.607,00** |
| Lo que vio la dueña | ₡630.219 | −$3.607 |
| La verdad (1.425 filas) | ₡6.677.254,00 | $3.961,00 |

### El delta NO fue una fila expulsada: fueron dos moviéndose en el borde

La dueña registró **un** egreso de ₡10.000 (Caja Proveedores, aporte CERO a `saldoCajaFuerte`) y
la tarjeta se movió **−₡114.351 / −$7.048**. La explicación exacta:

| fila | qué es | aporte a `saldoCajaFuerte` | qué pasó |
|---|---|---|---|
| `93b3d491` | ingreso Caja Fuerte, 2026-02-25 | **+₡114.351,18 / +$150,00** | **SALIÓ** de la ventana |
| `a757b30d` | egreso_socios Caja Fuerte, 2026-02-25 | **₡0,00 / −$6.898,00** | **ENTRÓ** a la ventana |

```
Δ CRC = −114.351,18            → observado −114.351  ✅
Δ USD = −(+150) + (−6.898)     = −7.048  → observado −7.048  ✅
```

### Por qué el borde se mueve solo

**1.242 de las 1.425 filas comparten `created_at` con otra** (166 grupos): las cargas históricas
entraron con la hora en `12:00:00`. En el borde exacto de la ventana hay **12 filas con el mismo
timestamp**.

Con `order by created_at` y **sin desempate**, cuáles de esas 12 caen dentro de las 1.000 es
**arbitrario**. Consecuencia: **la tarjeta podía cambiar sin que se registrara ningún movimiento**,
solo por volver a cargar la pantalla.

### Blast radius

Todos comían del mismo plato truncado:

| consumidor | qué mostraba mal |
|---|---|
| `CashModule` → tarjeta, Pendientes, Resumen | el saldo y los totales |
| `CashCierre` → `saldoBase` **y el `deberia` del pozo** | el cuadre del día |
| `InboxModule` | conciliación de la bandeja |
| `FinanzasModule` | P&L / actuals |
| `CierreSimulator` | la simulación |

### El fix

Paginación real (`.range()` en loop de 500 hasta agotar) **y desempate por `id`**.

> **El desempate no es cosmético.** Sin una clave única en el `ORDER BY`, el propio paginado
> **saltea y duplica** filas entre páginas: la página 2 puede repetir filas de la 1 y perder otras.
> Paginar sobre `created_at` con 1.242 empates habría cambiado un bug por otro peor.

Página de 500 a propósito: tiene que ser ≤ al `max_rows` del proyecto más chico (staging, 1.000).

6 tests con un universo de 1.425 filas y empates masivos, incluido uno que deja constancia de que
el fetch viejo perdía **425 filas**.

---

## BUG 2 · La tarjeta había perdido la regla original

Confirmado contra el repo viejo (`satori-caja`, `buildSaldos`, commit 49d9fd1 *"restar todos los
egresos en efectivo de CF"*): la regla era **todos los egresos en EFECTIVO restan, vengan de la
caja que vengan**; ventas brutas; propinas como egreso visible; traspasos y transferencias neutros.

Al portar la app, `saldoCajaFuerte` se achicó a `caja_origen = 'Caja Fuerte'` y **pagar del fondo
dejó de mover la tarjeta**. Es la misma enfermedad que T2 ya curó en el cierre.

### El fix

`src/modules/cash/tarjetaPozo.ts` (nuevo, puro):

- **Post-corte** → la tarjeta muestra el **POZO** desde el asiento de apertura, con subtítulo
  *"Caja Fuerte + Proveedores + Registradora"* y aviso de traspasos sin dirección.
- **Pre-corte** → `saldoCajaFuerte` tal cual, byte por byte.
- **`saldoCajaFuerte` NO se tocó** — sigue siendo sagrado y lo usa el pre-corte.

9 tests cubren los dos lados, incluido el criterio de éxito y que Transferencia/Banco no muevan
la tarjeta.

---

## Limpieza de staging — y un error mío en el camino

| acción | resultado |
|---|---|
| Borrar el traspaso manual `₡5.932.684/$520` del 22/07 | ✅ hecho |
| Re-sembrar la apertura (**estaba borrada**, 0 filas) | ✅ ₡744.575 / $3.441 |
| Egreso *"Encomienda Envio"* ₡10.000 y su turno | se dejaron (prueba legítima) |

> ⚠️ **Me pasé borrando y lo corregí.** El primer script borraba por DESCRIPCIÓN, y
> `'Ingreso de Banco → Caja Fuerte'` la comparten **5 filas**: 1 era la prueba manual y **4 eran
> datos legítimos venidos de prod**. Se borraron las 5. Las 4 legítimas se **re-copiaron desde
> prod** y se verificó que staging vuelve a coincidir exacto (4 filas · ₡575.734 · $2.469).
> El script ahora identifica por **tupla completa** (descripción + montos + fecha) y **exige que
> el conteo sea el esperado**: si no coincide, aborta sin borrar nada.

Estado final: **staging 1.425 movimientos** = 1.423 de prod + apertura + el egreso de prueba.

---

## Qué debe mostrar la tarjeta ahora

**₡744.575 / $3.441** — exactamente el asiento de apertura.

El egreso de prueba de ₡10.000 es del **22/07**, anterior al corte del **23/07**, así que
correctamente **no** entra al pozo post-corte.

> ⚠️ **La tarjeta recién empieza a moverse el 23/07.** Hoy (22/07) cualquier movimiento nuevo cae
> pre-corte y no la toca. Eso es correcto, pero conviene saberlo para no confundirlo con el bug.
>
> ⚠️ **La cifra de apertura sale del sello del 21/07**, y entre medio quedó el egreso de prueba de
> ₡10.000 del 22/07. Si al abrir el 23/07 tu conteo físico real no da ₡744.575, **re-sembrá** con
> el número correcto — el seed es idempotente:
> ```bash
> node --import ./scripts/t0-reconciliacion-cajas/register.mjs \
>   scripts/refresh-staging/seed-apertura.ts --fecha 2026-07-23
> ```

---

## Verificación en el sitio desplegado

| | resultado |
|---|---|
| `version.json` | `de3e423` · `builtAt` 2026-07-22T20:53:19Z ✅ |
| FIX 2 en el bundle | `CashMovimientos-aS4BFBTY.js` trae *"Efectivo en caja"* y *"Caja Fuerte + Proveedores + Registradora"* ✅ |
| FIX 1 en el bundle | el chunk de la API trae `.range(` y el cinturón de 200.000 ✅ |
| Harness `run-t2.ts` | sin regresiones ✅ |
| Suite | 465/465 ✅ |

### Criterio de éxito, a validar en piso el 23/07

1. La tarjeta dice **₡744.575** y abajo *"Caja Fuerte + Proveedores + Registradora · desde la
   apertura del 2026-07-23"*.
2. Registrar un egreso **en efectivo de ₡10.000 desde Caja Proveedores** → la tarjeta baja
   **exactamente ₡10.000** (a ₡734.575).
3. Registrar algo por **Transferencia/Banco** → la tarjeta **no se mueve**.
4. Recargar la pantalla varias veces → **el número no cambia solo**.
5. Borrar los movimientos de prueba al terminar.

---

## Pendiente: pasar el FIX 1 a PROD

**No es urgente pero sí importante.** `main` tiene el mismo `select` sin paginar. Hoy prod no
miente porque su `max_rows` es 10.000 y tiene 1.423 filas — pero está a **8.577 movimientos** de
empezar a mentir, y lo haría **en silencio**.

Es un pase **independiente del rediseño del pozo**: toca solo `getAllCashMovements` + su test.
Candidato a pase propio a `main` con firma de la dueña.

> Alternativa/complemento inmediato y sin deploy: **subir `max_rows` de staging a 10.000** para
> igualarlo a prod. No arregla el código, pero elimina la divergencia entre entornos que hizo que
> el bug apareciera solo en staging.
