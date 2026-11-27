# Pase a PROD de la mig 206 `caja_reemplazo_freno_clave`: freno de la clave de gerencia (hallazgo 259), EN ESPERA DE FIRMA

> **⛔ Plata y seguridad: firma del dueño sobre el SHA exacto del PR #383.** Si algo no coincide, **se para y se avisa**.
>
> - **Número:** 206, del bloque `operacion2` (200–249). La 204 ya está en prod (#374) y la 205 es de #380.
> - **⛔ Orden: 205 (#380) → 206 (este PR).** La 206 entra **DESPUÉS** de la 205, porque Branching rechaza una versión menor que la última aplicada. Si la 206 entrara primero, la 205 quedaría por debajo del ledger y habría que renumerarla.
>   Si el día del merge el ledger de prod ya pasó de 206, o la 205 se descartó, se renumera o se reordena en el mismo PR y se rehace este PASE.
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Ledger:** exactamente 1 fila `206` con su `name` (`caja_reemplazo_freno_clave`).
> - **Responsables:** ejecuta el merge (Branching). Controla una persona distinta de la que mergea (§4).
> - **Franja:** la libre (23:30–15:00 CR). Toca dos funciones de caja; no toca datos ni tablas.

## 1. Qué pasa y qué no
**Pasa:** se reescriben, con `create or replace`, las dos funciones que comparan la clave de gerencia:
- `reemplazar_pago_caja`: queda igual a la 202 más 1 línea.
- `delete_movement_cascade`: queda igual a la 053 más 1 línea.

La línea agregada es la misma en las dos: `perform pg_sleep(0.5)` antes del error, cuando quien llama no es owner ni manager y la clave de gerencia no autoriza a nadie. Es el mismo freno que tiene `verify_manager_password` (045). Firma, `SECURITY DEFINER`, `search_path` y grants quedan iguales.

**No pasa:**
- Ninguna tabla, política, disparador ni dato cambia.
- El contrato con la app es el mismo.
- `_reemplazo_pago_coincide` no se toca.
- El éxito no espera, y owner y manager sin clave tampoco.

**Qué ve el encargado:** nada distinto. Con la clave bien, todo igual. Con la clave mal, el mismo aviso, medio segundo más tarde.

## 2. Pruebas (antes de aplicar)
- `scripts/sql/206_pruebas.sql` se arma con `206_pruebas.py` y termina en `ROLLBACK`. Usa el local `prueba-206` y usuarios ficticios. Tiene **17 casos**:
  - Guardas.
  - Atributos y grants de las dos funciones.
  - Cada cuerpo es igual a la 202 / la 053 más 1 línea.
  - La clave correcta entra.
  - Clave mala, no-manager, clave vacía, correo inexistente y **manager inactivo**: error y ≥ 500 ms cada uno, sin cambios.
  - Owner y manager: sin freno (< 500 ms).
  - Todo o nada.
  - **`delete_movement_cascade` llamada directo:** clave mala o manager inactivo ≥ 500 ms; clave buena borra; owner y manager sin freno.
  - Vuelta atrás exacta, y la 206 entra de nuevo.
- **Postgres 16 local** (27-nov): **17/17**, y con `--mutar todas` **21/21 mutaciones muerden** (salida 0).
- **Staging: NO PROBADO desde el PR.** El conector no deja confirmar desde el agente. Lo corre la sesión del dueño o la coordinadora, con el ref `hwiatgic…` fijo:
  `python3 -I scripts/sql/206_pruebas.py --armar --staging` (supone staging en la 200 y la 053: huellas `636d3776…` / `acc79624…`, leídas el 27-nov).
  El md5 del archivo armado está en el cuerpo del PR, para la cabeza que se firme.
  Resultado esperado: `{"ok": 17, "fallas": 0}`.

## 3. Lecturas previas en prod (solo lectura; antes de la firma)
```sql
begin read only;
select max(version) from supabase_migrations.schema_migrations;   -- = 205 (la 205 de #380 ya entró) y la 206 libre
select proname, md5(regexp_replace(prosrc, '\s', '', 'g')), prosecdef, proconfig, proacl::text
  from pg_proc where oid in ('public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure,
                             'public._reemplazo_pago_coincide(public.cash_movements,jsonb)'::regprocedure,
                             'public.delete_movement_cascade(uuid,text,text,text)'::regprocedure);
-- esperado: reemplazar 3ca92110… · coincide ec56e5b7… · cascade acc79624… (leído el 27-nov); definer true;
-- search_path {public, pg_temp} / {public, pg_temp} / {public}; authenticated con execute y anon sin execute
rollback;
```

## 4. Después del merge (prod, solo lectura; controla alguien distinto de quien mergea)
- Ledger con 1 fila `206` / `caja_reemplazo_freno_clave`, y el check «Supabase Preview» en success.
- La misma consulta de §3 tiene que dar:
  - reemplazar = la huella de la 206 que está en la guarda de `206_caja_reemplazo_freno_clave.sql` (no se copia acá: sus primeros 8 dígitos parecen un teléfono);
  - cascade `bf0b1eda…`;
  - coincide sin cambios;
  - atributos y grants iguales a §3.
- Humo físico (el dueño): en Caja, cambiar un pago a proveedor como cajero con la clave correcta del encargado entra como siempre. Con una clave mala sale el mismo aviso.

## 5. Criterios de parada
Se para y se avisa si pasa cualquiera de estas:
- La guarda frena («no son los de la 202 y la 053» o «ya aplicada»).
- El ledger no queda con exactamente 1 fila.
- Algún atributo o grant cambió.
- El humo con la clave correcta falla.

## 6. Vuelta atrás
- `scripts/sql/206_rollback.sql` deja las dos funciones exactas a la 202 y la 053 (tiene guarda por huella de la 206).
- En el mismo momento, va el PR que saca el `.sql` de `main`.
- Si la 206 ya está en el ledger de prod, el `.sql` NO se borra (regla 10): la vuelta atrás es una migración nueva con ese cuerpo.

## 7. Firma y bitácora
| Fecha y hora (-06:00) | Qué | Quién | SHA |
|---|---|---|---|
| — | Firma del dueño | — | — |
