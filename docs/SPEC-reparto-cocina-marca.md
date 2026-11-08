# SPEC — Reparto de cocina por marca, no por nombre (PROP-AUD-01) · 2026-11-07

> Auditoría r5. **Solo spec** (propinas es sensible): la implementación va después de SEC-01c,
> higiene, SAL-AUD-01 y el ítem 11, con firma de Ismael.

## 1. Qué pasa hoy
- `src/modules/tips/TipCocina.tsx` (L24 y L101–102) deja afuera del reparto de cocina a un empleado
  **comparando una subcadena fija contra su nombre** (en minúscula).
- La vista es **de solo lectura**: arma, por semana ISO, el pozo de cocina (Σ `payout_crc` de las
  entradas de rol `cocina`) y lo divide en partes iguales entre los «receptores». No guarda nada.
- Problemas:
  - un **homónimo** (o cualquier nombre que contenga esa subcadena) queda afuera sin querer;
  - si a la persona excluida se le **cambia el nombre**, vuelve a recibir;
  - el **nombre real está en el código** de un repo público.

## 2. Qué se propone
- **Marca en la base:** `employees.recibe_reparto_cocina boolean not null default true`.
  - Migración aditiva, con su número al aplicarla. Sin nombres ni ids reales en el `.sql`.
  - El valor de la persona hoy excluida lo carga el **owner** (pantalla de Admin) o un `update … where
    id = '<id>'` que se corre **fuera del repo**, con firma.
- **Quién la edita:** solo el owner, en la ficha del empleado (Admin → Empleados), solo para rol cocina.
  RLS: la de `employees` (owner/manager gestionan); la UI solo la muestra al owner.
- **La regla en `TipCocina.tsx`:** receptor = empleado de cocina con `recibe_reparto_cocina !== false`.
  La función de la subcadena y el texto fijo **se borran** del código.
- **Lo que NO cambia:** el pozo (la persona excluida **aporta** al pozo pero no recibe), la división en
  partes iguales, el agrupado por semana ISO y todo `tipCalculations.ts` (sagrado, no se toca).

## 3. Pruebas
1. **Homónimo:** dos empleados de cocina cuyos nombres comparten la subcadena; solo uno tiene la marca
   en `false` → solo ese queda afuera; el otro recibe.
2. **Renombre:** al excluido se le cambia el nombre → sigue afuera.
3. **Sin marca:** un empleado con la subcadena en el nombre y la marca en `true` → recibe.
4. **Pozo igual:** para un mes de prueba, el pozo total por semana es el mismo antes y después, al
   colón; por persona = pozo ÷ receptores.
5. **Sin texto fijo:** test estático de que `TipCocina.tsx` no compara nombres contra literales.
6. **Pantalla:** la marca solo se ve y se edita con owner; manager y cajero no la ven.

## 4. Firma
Migración + cambio de `TipCocina.tsx` + editor en Admin, con firma de Ismael. Staging primero
(recorrido real y limpieza), prod después. Actualizar la guía `docs/sop-app/6.3 Propinas.md` y
`6.6 Admin.md` en el mismo PR.
