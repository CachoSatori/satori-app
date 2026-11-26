# Pase a PROD de la mig 200 `caja_reemplazo_pago_atomico` — cambio de pago en UNA transacción, EN ESPERA DE FIRMA

> **⛔ Plata y esquema: firma del dueño sobre el SHA exacto del PR** (con fecha y hora `-06:00`, §9). Antes de firmar:
> la batería entera en staging en verde con sus mutaciones (§3), las lecturas previas en prod (§4) y la validación
> física del dueño en staging (editar un pago guardado, §3.3). Si algo no coincide, **se para y se avisa**.
>
> - **Número:** 200 (bloque nuevo `operacion2` 200–249, abierto el 25-nov; **a ratificar por el dueño**). Si al
>   mergear ya está tomado, se renumera al siguiente libre en el mismo PR (archivo, rollback, pruebas, registro, ESTADO).
> - **Vía:** merge → Branching. No se aplica nada a mano en prod.
> - **Ledger:** exactamente 1 fila `200` con su `name` (`caja_reemplazo_pago_atomico`).
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§6).
> - **Franja:** la libre (23:30–15:00 CR), fuera del servicio.

## 1. Qué pasa y qué no
**Pasa** (solo funciones nuevas; una guarda frena sin tocar nada si ya existen):
- `public.reemplazar_pago_caja(p_viejo uuid, p_nuevo jsonb, p_manager_email text, p_manager_password text) → jsonb`,
  `security definer`, `search_path = public, pg_temp`. EXECUTE: solo `authenticated` (nada para `anon`/`public`).
  En una transacción: valida quién llama (owner, manager, cajero; el cajero con credenciales de un owner/manager
  activo, igual que `delete_movement_cascade`), el local (`puede_ver_local` de quien llama y el local del manager que
  autoriza), los montos (₡ > 0, $ ≥ 0, sin NaN/Infinity), el turno (regla 11: el del viejo), bloquea el viejo
  (`for update`), crea el nuevo con el id del cliente (= `client_op_id`) y borra el viejo con la cascada de siempre.
  Reintento con el mismo id = mismo resultado. Viejo inexistente = `P0002`. Nuevo ya guardado con otros datos =
  `{estado: 'distinto'}` sin borrar nada.
- `public._reemplazo_pago_coincide(cash_movements, jsonb)`: interna (sin EXECUTE para la app).

**No pasa:** ninguna tabla, columna, política, disparador ni otra función cambia (`delete_movement_cascade` se llama tal
cual). Ningún dato se toca. Ninguna Edge. Ningún sagrado. La lógica de cierres no se toca.

**La app:** el código del PR llama la función y, si no está (`PGRST202`), sin red, con la cola pendiente o si la
respuesta se pierde, sigue por el camino de #361 con el mismo id. Por eso el orden merge → Branching no deja ventana
rota: antes de que la 200 esté, la app hace lo de hoy.

## 2. Prerrequisitos
- [ ] El dueño ratifica el bloque `operacion2` (200–249) y el número 200.
- [ ] Ledger de prod = 198 (o 199 si entró #365) y **ninguna** fila `200` (§4).
- [ ] Nadie más pushea a `main` entre la firma y el humo de después (Branching).

## 3. Prueba en staging (`hwiatgicyyqyezqwldia`)
1. **Batería** (`scripts/sql/200_pruebas.sql`, termina en ROLLBACK; 20 casos): `python3 scripts/sql/200_pruebas.py
   --armar` y pegar, o `--psql "<conexión de staging>"`. Esperado: `{"ok": 20, "fallas": 0}`.
   **Mutaciones:** `--psql … --mutar todas`: cada una tiene que decir MUERDE (salvo `sin_clave`, que no tiene caso
   propio porque la cascada vuelve a verificar la clave).
   **Estado al 25-nov:** NO CORRIDA. El conector MCP canceló la confirmación de la batería (tiene `drop function if
   exists` al principio, para probar el archivo y no lo que haya en la base). Regla 14: no se reescribió para
   esquivarla. La corre la sesión de CC del dueño (Management API, ref de staging fijo, ROLLBACK).
2. **Aplicada en staging** el 25-nov ~22:55 CR (a mano, una transacción con su fila `200`); antes se compiló dentro
   de `begin … rollback`. El esquema que toca (`cash_movements`: columnas, políticas, disparadores;
   `delete_movement_cascade`, `mis_locales`, `puede_ver_local`, `get_my_role`) tiene el **mismo md5 en prod y en
   staging** (leído el 25-nov, solo lectura).
3. **Validación física del dueño** (staging, en su Chrome): editar un pago a proveedor guardado en la Caja Diaria →
   queda solo el nuevo, sin aviso rojo; con el cajero pide la autorización de gerencia como siempre.

## 4. Lecturas previas en prod (`yiczgdtirrkdvohdquzf`, solo lectura)
```sql
select max(version) from supabase_migrations.schema_migrations;                     -- 198 (o 199)
select count(*) from supabase_migrations.schema_migrations where version = '200';   -- 0
select to_regprocedure('public.reemplazar_pago_caja(uuid,jsonb,text,text)');        -- null
select md5(pg_get_functiondef('public.delete_movement_cascade(uuid,text,text,text)'::regprocedure));  -- 1cc160c60a059fccfbba80f5fdaf3be7
select count(*) from public.cash_movements;                                          -- anotar (humo)
```
Si el md5 de `delete_movement_cascade` no es el de arriba, **se para**: la 200 la llama y se probó contra esa versión.

## 5. Humo después (solo lectura)
- Ledger: exactamente 1 fila `200` `caja_reemplazo_pago_atomico`; check «Supabase Preview» en success.
- `to_regprocedure(...)` no null; `has_function_privilege('anon', …, 'execute') = false`;
  `has_function_privilege('authenticated', …, 'execute') = true`.
- `count(*)` de `cash_movements` = el de antes (la 200 no toca datos).
- Primer cambio de pago real: una fila nueva en `movement_deletions` con la nota «Reemplazo por edición de pago a
  proveedor» y ningún «Cambio de pago sin terminar.» en la Caja Diaria.

## 6. Criterios de parada
Cualquier lectura previa distinta de lo esperado · la batería no da 20/20 · Branching en rojo · el humo de después
distinto del de antes salvo lo esperado. Se para y se avisa; no se improvisa en prod.

## 7. Vuelta atrás
`scripts/sql/200_rollback.sql` (saca las dos funciones). La app vuelve sola al camino de #361 (ve `PGRST202`), así
que no hace falta revertir código. Como la 200 quedaría en el ledger de prod, el `.sql` **no** se borra (regla 10):
la vuelta atrás va como migración nueva hacia adelante con el cuerpo del rollback.

## 8. Orden
1. Lecturas previas (§4) → 2. firma del dueño sobre el SHA → 3. merge en la franja libre → 4. Branching → 5. humo (§5)
→ 6. ⚡ARRANQUE de ESTADO con «ledger prod = 200».

## 9. Firma y bitácora
| Qué | Quién | Fecha y hora (-06:00) | SHA |
|---|---|---|---|
| Firma del dueño | | | |
| Merge | | | |
| Control (humo) | | | |
