# Pase del POZO a PRODUCCIÓN · rama lista para revisión

**Rama:** `fix/pozo-a-prod` · commit **`cda3375`** · construida **DESDE `main` (9fc1147)**.
**`main` INTACTO en `9fc1147`. NO se mergeó nada. NO se escribió NADA en prod.**

> El merge lo confirma **el dueño** tras la revisión del asesor. Los pasos 5–8 (merge, deploy,
> asiento de arranque y verificación en pantalla) están descritos abajo y **no se ejecutaron**.

---

## 0 · La regla crítica de ramas se respetó

**No se mergeó `staging` → `main`.** `staging` trae 140 archivos de diferencia, **40 de ellos
del PoS**, que no van a prod. Se creó una rama nueva desde `main` y se trajeron **solo** las
rutas autorizadas, con `git checkout origin/staging -- <rutas>`.

### Auditoría del diff (el gate de "si aparece cualquier archivo del PoS, parás")

| chequeo | resultado |
|---|---|
| Archivos del PoS en el diff (`pos*`, comandero, kds, salon, menu, modifier, fe, print-bridge, inventario, ProductosAdmin, PosF1Admin) | **CERO** ✅ |
| Archivos de `src/` fuera de las rutas autorizadas | **CERO** ✅ |
| Migraciones (`supabase/`) | **CERO** ✅ |
| Sagrados vs `main` | **byte-idénticos** ✅ `tipCalculations` **7603ba5a** · `cashUtils` **b597c697** · `posFiscal` sin tocar |
| Imports del PoS dentro del código traído | **ninguno** ✅ |
| Commits solo-staging del corte (`5f78b56`, `9328bec`) | **no cherry-pickeados** ✅ (el valor se fijó a mano, con comentario reescrito) |

> La prueba dura de que no falta ni sobra nada es el **build de producción**: `tsc -b` resuelve
> todos los imports contra `main`. Si algo del pozo dependiera de un archivo del PoS, no
> compilaría. Compila. Además el bundle bajó a **92 entradas** de precache (staging: 101),
> consistente con que no hay chunks del PoS.

---

## 1 · Diff exacto vs `main` — 58 archivos

### Código de la app · 15 archivos

| archivo | Δ | qué es |
|---|---:|---|
| `src/modules/cash/pozo.ts` | **+155** | núcleo puro del pozo único de efectivo (nuevo) |
| `src/modules/cash/cierrePozo.ts` | **+277** | corte, "debería" del cierre, guard de cadena (nuevo) |
| `src/modules/cash/tarjetaPozo.ts` | **+83** | qué muestra la tarjeta de efectivo (nuevo) |
| `src/modules/cash/CashCierre.tsx` | +166 | el cierre sobre el pozo, post-corte |
| `src/modules/cash/CashTurno.tsx` | +44 | "Gastado efectivo" y Resumen del Turno |
| `src/modules/cash/CashMovimientos.tsx` | +40 | tarjeta al pozo + filtro "Desde" en el corte |
| `src/shared/api/cash.ts` | +98 | paginación real con desempate por `id` |
| `src/modules/ventas/VentasHoy.tsx` | +11 | bloqueo del canal duplicado de ventas |
| `cierrePozo.test.ts` · `pozo.test.ts` · `tarjetaPozo.test.ts` | +930 | tests del núcleo |
| `CashCierre.postCorte.test.tsx` · `CashTurno.gastadoEfectivo.test.tsx` | +326 | tests de UI |
| `CashMovimientos.filtroCorte.test.tsx` | **+145** | tests del filtro (nuevo, este pase) |
| `cash.paginado.test.ts` | +108 | tests de la paginación |

### Documentación · 43 archivos

`scripts/refresh-staging/` (18) y `scripts/t0-reconciliacion-cajas/` (25): harness **read-only**
y actas del diagnóstico. **Ningún código de la app los importa** — entran por trazabilidad, no
se ejecutan en el build ni en el sitio.

---

## 2 · Los dos cambios de este pase

### a) `POZO_CORTE = '2026-07-22'`

El valor coincidía con el de staging, pero **el comentario se reescribió por completo**: decía
*"COMMIT SOLO-STAGING — NO CHERRY-PICKEAR A MAIN · en main debe seguir siendo 2026-08-01"*.
Traerlo tal cual a prod habría dejado el archivo **contradiciéndose a sí mismo**. Ahora dice lo
que es: el corte firmado de producción, igual en las dos ramas.

Queda anotado ahí mismo que **el corte no alcanza solo**: sin el asiento de arranque,
`fechaAperturaPozo` devuelve `null` y el saldo se calcula sobre TODO el ledger — un número
inservible. Por eso el paso 6 existe.

### b) Filtro "Desde" = fecha de corte

`defaultFrom` pasa de *hoy − 60 días* a **`POZO_CORTE`**. Consecuencias, todas verificadas:

| tarjeta | fuente | con el filtro por defecto |
|---|---|---|
| Ingresos (período) | `filtered` | **0** — arranca limpio |
| Egresos (período) | `filtered` | **0** |
| Ajustes de cierre | cierres del período | **"Sin diferencias"** |
| **Pend. Transferencia** | `movements` **sin filtrar** | **los pendientes reales** (hoy ₡250.573 · 4 pagos) |
| **Efectivo en caja** | `movements` **sin filtrar** | el saldo real |

Las dos últimas **ya estaban bien** en el código — no se tocaron; se les pusieron tests para que
nadie las "arregle" después. Un pendiente anterior al corte **sigue siendo plata que se debe
hoy**: si el filtro lo escondiera, la deuda desaparecería de la pantalla.

**El histórico no se toca:** sigue completo en la base y a un cambio de fecha de distancia.

> **Los tests se validaron contra el código viejo**: con el default anterior, **4 de los 8
> fallan**. Los otros 4 son invariantes *por diseño* (Pend. Transferencia y la tarjeta de
> efectivo **no deben** moverse con el filtro) y pasan en los dos mundos — que es exactamente lo
> que tienen que hacer.
>
> Un detalle que casi se cuela: la primera versión usaba una fecha histórica **fuera** de la
> ventana vieja de 60 días, así que los tests pasaban con y sin el cambio — no probaban nada.
> Y `getByText('Caja Fuerte')` también matcheaba la columna `caja_origen` de la tabla. Los dos
> se corrigieron: la fecha cayó dentro de la ventana y el helper se acotó a `.cd-saldos-bar`.

---

## 3 · Hallazgo que vale la pena mirar: el canal duplicado de ventas

`VentasHoy.tsx` trae un bloqueo que **no es cosmético**. El botón *"→ Caja"* crea un ingreso por
la venta del día en **Registradora**; el Cierre del Día crea otro por **la misma venta** en
**Caja Fuerte**. Con el modelo viejo no chocaban (`saldoCajaFuerte` ignora Registradora). **Con
el pozo las tres cajas suman al mismo saldo, así que la venta entraría DOS VECES.**

Post-corte el atajo queda bloqueado con un aviso, y la venta entra por un solo canal: las
ventas brutas del Cierre. (Verificado: el `return` temprano está dentro del `try` que tiene
`finally { setRegistrando(false) }`, así que el botón no queda trabado.)

---

## 4 · Gate técnico

| gate | resultado |
|---|---|
| Suite completa | **407/407** · 50 archivos ✅ |
| Build de **PRODUCCIÓN** (`tsc -b` + vite) | verde ✅ |
| Corte en el bundle | `cierrePozo-*.js` trae **`2026-07-22`** · **0** ocurrencias de `2026-08-01` ✅ |
| Migraciones | **cero** ✅ |
| Sagrados | byte-idénticos a `main` ✅ |
| Escrituras en prod | **ninguna** ✅ |

> **Lint:** queda 1 error en `CashMovimientos.tsx` (`no-unused-expressions`, en `toggleSel`).
> **Es preexistente en `main`** — mismo código, misma regla, línea 96 allá y 109 acá por los
> comentarios agregados. No es una regresión de este pase y no se tocó para no ensuciar el diff.

---

# ⏸️ LO QUE FALTA — sólo tras "MERGE CONFIRMADO"

## Paso 5 · Merge y deploy

```bash
git checkout main && git merge --ff-only fix/pozo-a-prod && git push origin main
```

Verificar GitHub Pages **caminando el grafo de chunks** desde el entry.
⚠️ Pedir un asset por el hash del build local **siempre devuelve 200**: el fallback SPA responde
el `index.html` (~2,7 kB). Se comprueba por **tamaño y contenido**, nunca por el código HTTP.

## Paso 6 · Asiento de arranque — el ÚNICO write autorizado en prod

`'Apertura pozo 2026-07-22'` · **₡744.570 / $3.441** · idempotente por descripción.
Con conteo de filas **antes/después (+1 exacto)** y verificación de que ningún otro dato cambió.

## Paso 7 · Verificación en pantalla, con el dueño mirando

| # | qué | esperado |
|---|---|---|
| 1 | Efectivo en caja | **₡744.570 / $3.441** exactos |
| 2 | Pend. Transferencia | **₡250.573 · 4 pagos** exactos |
| 3 | Ingresos / Egresos / Ajustes (período) | **0 / 0 / "sin diferencias"** |
| 4 | Ampliando el filtro | histórico **idéntico** a antes |
| 5 | Movimiento de prueba ₡1.000 efectivo (Caja Proveedores) | la tarjeta baja **exactamente ₡1.000** → borrarlo → vuelve exacta |

**Si un número no da EXACTO: rollback y reporte. Nada se ajusta a mano.**

## Paso 8 · Rollback

```bash
# 1 · código
git revert -m 1 <sha-del-merge> && git push origin main

# 2 · dato (una sola fila)
# delete from public.cash_movements where description = 'Apertura pozo 2026-07-22';
```

Prod queda **exactamente** como antes: el revert devuelve el bundle y el delete quita la única
fila escrita. No hay migraciones que deshacer ni datos históricos tocados.

---

## Dos cosas para decidir antes del merge

1. **La cifra ₡744.570 la verifica el dueño** contra lo que el sistema muestra HOY en prod. Es
   continuidad exacta, no un conteo nuevo — pero si prod muestra otro número, **el asiento debe
   llevar ése**, no éste, o la tarjeta arrancará descuadrada desde el primer minuto.
2. **`main` se queda sin el resto de `staging`.** Este pase trae el pozo y sus fixes; el PoS, la
   FE y el inventario activo **siguen solo en staging**, como estaba previsto. La divergencia
   entre ramas crece: conviene tenerlo presente para el próximo pase.
