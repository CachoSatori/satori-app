# Pase a PROD de la mig 202 `caja_reemplazo_pago_endurecer` — los 4 Menores de la 200, EN ESPERA DE FIRMA

> **⛔ Plata y esquema: firma del dueño sobre el SHA exacto del PR** (fecha y hora `-06:00`, §8). Si algo no coincide,
> **se para y se avisa**.
>
> - **Número:** 202 (bloque `operacion2`). La 201 es de #369 y la 203 de #374 (catálogo 3.1b), que espera a otra parte.
> - **⛔ Orden:** la 202 entra **DESPUÉS** de la 201 (#369) y **ANTES** de la 203 (#374) (Branching rechaza una versión menor que la última
>   aplicada). Orden: 201 (#369) → 202 (#373) → 203 (#374).
> - **Vía:** merge → Branching. No se aplica nada a mano en prod.
> - **Ledger:** exactamente 1 fila `202` con su `name` (`caja_reemplazo_pago_endurecer`).
> - **Franja:** la libre (23:30–15:00 CR), fuera del servicio. Control: una persona distinta de quien mergea.

## 1. Qué pasa y qué no
**Pasa:** `create or replace` de `reemplazar_pago_caja` y `_reemplazo_pago_coincide` (misma firma, `security definer`
solo la primera, `search_path = public, pg_temp`, mismos grants: EXECUTE solo `authenticated`; la de comparar, nadie):
- **M1:** «el nuevo ya está» con un id que choca con un pago de **otro local** → error `42501` **sin datos** (antes
  devolvía la fila ajena en `guardado`). El viejo no se toca.
- **M3:** la búsqueda por `id` / `client_op_id` es determinista (manda la fila con ESE id).
- **M4:** la comparación hace `btrim` del método de los dos lados (= el alta).
- **Guarda:** solo corre si los dos cuerpos en la base son **exactamente** los de la 200 (md5 de `prosrc` sin
  espacios: `636d3776…` / `98dae10d…`). Si ya son los de la 202 (`3ca92110…` / `ec56e5b7…`) o cualquier otra cosa, se
  para sin tocar nada.

**No pasa:** ninguna tabla, política, disparador, dato ni otra función. `delete_movement_cascade` igual. Ningún
sagrado. **La app no cambia:** el 42501 nuevo ya lo trata como «no» de la base (`sin_cambios`, sin caer al camino viejo).

## 2. Pruebas
`scripts/sql/202_pruebas.sql` (ROLLBACK; 39 casos: los 23 de la 200 como regresión + 24–39) con
`scripts/sql/202_pruebas.py`. Arma: la 200 tal cual (= prod) → guarda → la 202 → casos → re-correr (guarda) →
`202_rollback.sql` → la 202 otra vez.
- **Postgres 16 local descartable** (`HASTA=200 bash scripts/sql/local_armar_base.sh b202` + `--local`), 26-nov:
  **39/39 y las 32 mutaciones MUERDEN** (`--mutar todas`).
- **Staging:** NO CORRIDA (la corre la sesión de CC del dueño, regla 14). Esperado `{"ok": 39, "fallas": 0}`.

## 3. Lecturas previas en prod (`yiczgdtirrkdvohdquzf`, solo lectura)
```sql
select max(version) from supabase_migrations.schema_migrations;                     -- = 201 (la 201 ya entró y la 202 aún no); si no, SE PARA
select count(*) from supabase_migrations.schema_migrations where version = '202';   -- 0
select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc
 where oid in ('public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure,
               'public._reemplazo_pago_coincide(public.cash_movements,jsonb)'::regprocedure);
-- 636d3776826384ff46ed87a1cfe0db25 y 98dae10d63e704afd7ff02930e655bbd (si no, SE PARA: la guarda frenaría igual)
```

## 4. Humo después (solo lectura)
- Ledger: 1 fila `202`; «Supabase Preview» en success.
- Huellas: `3ca9211052b3b977f2e5a4f3432b99f1` (reemplazar) · `ec56e5b77dad0552543a037e0ccf34c3` (coincide).
- `has_function_privilege('anon', 'public.reemplazar_pago_caja(uuid,jsonb,text,text)', 'execute') = false`; `authenticated` = true.
- Validación física (dueño): editar un pago a proveedor guardado → queda solo el nuevo, igual que hoy.

## 5. Criterios de parada
Lecturas previas distintas · batería distinta de 39/39 · Branching en rojo · humo distinto de lo esperado.

## 6. Vuelta atrás
`scripts/sql/202_rollback.sql`: guarda (solo si los cuerpos son los de la 202) y vuelve **exactamente** a la 200
(huellas, atributos, grants y comentario; probado en el caso 20). Como la 202 quedaría en el ledger, su `.sql` no se
borra (regla 10): la vuelta atrás va como migración nueva con ese cuerpo.

## 7. Orden
0. ledger de prod = 201 (la 201 ya entró; la 202 todavía no) → 1. lecturas previas (§3) → 2. firma sobre el SHA → 3. merge en la franja libre →
4. Branching → 5. humo (§4) → 6. ⚡ARRANQUE de ESTADO con el ledger.

## 8. Firma y bitácora
| Qué | Quién | Fecha y hora (-06:00) | SHA |
|---|---|---|---|
| Firma del dueño | | | |
| Merge | | | |
| Control (humo) | | | |
