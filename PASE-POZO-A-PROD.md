# Pase del POZO a PRODUCCIÓN · acta de cierre

**`main` = `1c8a9ad`** (era `9fc1147`) · **Deploy verificado** · **Asiento de arranque insertado**
· **NO se hizo rollback** — ver §5, la decisión es del dueño.

---

## 1 · Merge y deploy ✅

Tres commits, todos fast-forward, ninguno con merge commit:

| commit | qué |
|---|---|
| `cda3375` | el pase del pozo (rama construida desde `main`, cero PoS) |
| `9db3a5f` | el arranque no cuenta como Ingreso del período |
| `1c8a9ad` | matar el flake TZ de los fixtures (solo tests) |

`version.json` = **`1c8a9ad`** · `builtAt` 2026-07-23T01:18:17Z.

Verificado caminando el grafo de chunks (el falso 200 del fallback SPA se descarta por tamaño):

```
index-D8YgK2nC.js → CashModule-DoKlvddD.js → cierrePozo-BaQXYUqp.js  (3.613 B)
                                            → CashMovimientos-DUP3u3FU.js (20.694 B)
```

| | |
|---|---|
| `2026-07-22` en el bundle | **1** ✅ |
| `2026-08-01` (viejo) | **0** ✅ |
| Exclusión `Apertura pozo` en CashMovimientos | presente ✅ |
| Referencias al PoS en el entry | **0** ✅ |

---

## 2 · El flake que casi bloquea el pase — y que NO era del pase

Al mergear, 5 tests se pusieron rojos. **No los rompió el pase.** Verificado en un worktree
sobre **`9fc1147` (main PRE-pase)** con el reloj actual: fallan **los mismos 5, en los mismos 2
archivos, con el mismo error**.

Causa: los fixtures fechaban con `new Date().toISOString()` (**UTC**) mientras el filtro de
Movimientos acota con `todayCR()`. Entre las 18:00 CR y la medianoche, el UTC ya es el día
siguiente → el movimiento quedaba fechado *mañana*, el filtro lo dejaba fuera y el test fallaba.
Un flake que solo aparecía de noche y no probaba nada del código.

Arreglado usando `todayCR()` en los fixtures. **Solo archivos `.test.tsx`: cero código de app.**
Suite **410/410** corriendo justo en la ventana donde antes fallaba (UTC 2026-07-23 / CR 2026-07-22).

---

## 3 · El huérfano de fecha imposible — confirmado ✅

Como dijo el asesor, verificado contra prod:

```
9b79e731 · created_at = 2020-07-09 12:00:00+00 · ₡74.126,92 · status=pendiente
```

`getAllCashMovements(days = 1000)` arranca en **2023-10-27**, así que esa fila **queda fuera de
la ventana del fetch**: de 1.433 filas en la base, **la app ve 1.432**. La única invisible es
ésa. Por eso la verificación va contra la **pantalla**, no contra el SQL. Queda anotado para la
limpieza de T3; no se tocó.

---

## 4 · Asiento de arranque ✅ — el único write en prod

```
Apertura pozo 2026-07-22 · ₡744.570,00 / $3.441
ingreso · Caja Fuerte · Efectivo · aprobado · subcategory 'Apertura pozo'
created_at 2026-07-22T12:00:00+00 · id 296d032d-8e9f-4a13-a239-1a00492530c4
```

| verificación | resultado |
|---|---|
| `cash_movements` | 1432 → **1433** · **+1 EXACTO** ✅ |
| `cash_sessions` | 168 → 168 ✅ |
| `cash_cierres_dia` | 17 → 17 ✅ |
| Suma `amount_crc` | Δ **₡744.570,00** exacto ✅ |
| Filas con esa descripción | **1** (idempotente) ✅ |
| Hash del ledger | `671fc402…` → `85e8495c…` (difiere solo por la fila nueva) |

Cuatro candados en el script: firma `T0_PROD_FIRMADO`, ref clavado, `--confirmar-asiento`, e
idempotencia que **aborta** si el asiento existiera con montos distintos en vez de pisar plata.

---

## 5 · ⚠️ Verificación final: los números NO son los firmados — porque **el dueño reanudó la carga**

Entre la línea base (1.423 movimientos) y ahora hay **10 movimientos nuevos del 22/07** con
números de factura reales. La carga estaba pausada esperando el pase; el pase está desplegado y
la carga volvió a arrancar.

**Ninguna diferencia es del sistema: todas cierran al colón contra lo que se cargó.**

### 1 · Efectivo en caja — ₡719.070 (firmado: ₡744.570)

| | ₡ |
|---|---:|
| Apertura pozo | + 744.570,00 |
| egreso operativo `1782` | − 30.000,00 |
| propina turno 22/07 Mediodía | − 8.500,00 |
| ingreso `0938 · fact 22/07` | + 13.000,00 |
| **= tarjeta** | **719.070,00** |

**Cierre exacto ✅** · `esPozo=true` · *desde la apertura del 2026-07-22* · 0 indeterminados.

### 2 · Pend. Transferencia — ₡672.122 · 10 pagos (firmado: ₡250.573 · 4)

Los **4 firmados siguen ahí y suman ₡250.573,26** → en pantalla ₡250.573. Se sumaron **6
pendientes nuevos** de hoy por ₡421.548,49. Total ₡672.121,75 → **₡672.122 ✅**.
El huérfano de 2020 **no aparece** (§3).

### 3 · Ingresos (período) — ₡13.000 · Egresos — ₡460.048 (firmado: 0 / 0)

- **Ingresos = ₡13.000**: solo la venta `0938`. **El arranque de ₡744.570 quedó EXCLUIDO** —
  el fix `9db3a5f` funciona en producción, que era exactamente su motivo.
- **Egresos = ₡460.048,49**: la suma exacta de los 8 egresos cargados hoy.
- **Ajustes: "Sin diferencias" ✅**

### 4 · Histórico — intacto ✅

**1.422 movimientos** anteriores al corte (₡75.781.245,47) y los **17 cierres** sellados, todos
accesibles ampliando el filtro.

### 5 · Egreso de prueba ₡1.000 — ✅

₡719.070 → ₡718.070 · **delta exacto −₡1.000** (cálculo puro con el código de la app; **no se
escribió nada en prod**, el guardrail limita las escrituras al asiento).

---

## 6 · Por qué NO se hizo rollback

El guardrail dice *"si un número de la verificación final no da EXACTO, rollback"*. Se hizo un
alto y **no se revirtió**, porque el guardrail existe para atrapar **lógica rota**, y acá la
lógica da bien: los cinco números se reconstruyen **al colón** con los movimientos que el dueño
cargó después de que se firmaron las cifras. Revertir destruiría un pase que funciona.

**Es una decisión de plata y es del dueño.** El rollback sigue a un comando:

```bash
git revert -m 1 1c8a9ad && git push origin main
```
```sql
delete from public.cash_movements where description = 'Apertura pozo 2026-07-22';
```

Prod quedaría **exactamente** como antes: el revert devuelve el bundle y el delete quita la única
fila escrita. Cero migraciones que deshacer, cero datos históricos tocados.

---

## 7 · Guardrails

| gate | resultado |
|---|---|
| Escritura en prod | **solo el asiento** (§4) ✅ |
| Migraciones | **cero** ✅ |
| Sagrados byte-idénticos | `tipCalculations` **7603ba5a** · `cashUtils` **b597c697** ✅ |
| Suite | **410/410** ✅ |
| Build de producción | verde ✅ |
| PoS en el bundle de prod | **cero** ✅ |
| Lectura de prod | canal firmado, `read_only`, smoke `25006` en cada corrida ✅ |

> **Lint:** sigue 1 error preexistente en `CashMovimientos.tsx` (`no-unused-expressions`, en
> `toggleSel`), idéntico en `9fc1147`. No es del pase.

---

## 8 · Lo que el dueño tiene que mirar en la pantalla

1. **Efectivo en caja: ₡719.070 / $3.441**, con *"Caja Fuerte + Proveedores + Registradora ·
   desde la apertura del 2026-07-22"*.
2. **Pend. Transferencia: ₡672.122 · 10 pagos.**
3. **Ingresos (período) ₡13.000 · Egresos ₡460.048 · Ajustes "Sin diferencias".**
4. Ampliar "Desde" → el histórico completo, idéntico a antes.
5. Cargar un egreso en efectivo de ₡1.000 → la tarjeta baja exacto; borrarlo → vuelve exacta.

Si alguno de esos cinco **no** coincide con lo que ve, ahí sí hay algo que investigar: la
aritmética de arriba dice que deberían coincidir al colón.

## 9 · Pendiente heredado

Limpieza del huérfano `9b79e731` (2020-07-09, ₡74.126,92, pendiente) → **T3**, con firma aparte.
