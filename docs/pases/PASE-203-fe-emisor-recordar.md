# Pase a PROD de la mig 203 `fe_emisor_recordar` («Es un proveedor real · recordar») — EN ESPERA DE FIRMA

Corto: contexto en [PASE-201](PASE-201-fe-versiones.md). Formato de `PASE-089`. Vía: **merge → Branching** (nada a mano;
sin Edge). Responsables: ejecución = sesión coordinadora del día · control = el dueño (firma por chat sobre el SHA de cabeza).
**Urgente:** tiene que entrar antes de la carga real del 30-nov (con `fe_emisores_conocidos` vacía todo entra «revisar»).

## 1. Qué pasa y qué no

- `fe_emisores_conocidos` gana `nombre`, `origen` (`manual` | `revision`), `aprobado_por`, `aprobado_en`.
- Tabla nueva `fe_emisores_bitacora` (RLS: leen owner y contador; nadie escribe por la API).
- `fe_emisor_recordar(cedula)` (owner y contador; 42501 al resto): alta del emisor (o reactivación, solo owner) y, en la
  misma transacción, quita SOLO el motivo «emisor no conocido» de sus comprobantes: si era el único y estaban «revisar»
  → «ok»; con otro motivo (otro XML con la misma clave, respuesta distinta, receptor, Edge) siguen. Idempotente.
- `fe_emisor_desactivar(cedula)` (solo owner). No toca comprobantes.
- Pantalla: «📨 Facturas electrónicas» → «Emisores por confirmar» + «Emisores conocidos».
- No toca: 199/200/201 (sus `.sql` ni sus funciones), la Edge `fe-ingesta`, Caja, Bandeja, sagrados. No escribe
  `fe_ingesta_bitacora` (así «Última ingesta» no se ve «al día» por un toque en la app).

## 2. Lecturas previas en prod (solo lectura)

```sql
begin read only;
select (select max(version) from supabase_migrations.schema_migrations)                    as ledger,     -- 201 (o 202 si entró la de Caja)
       to_regclass('public.fe_emisores_bitacora')                                           as ya_203,     -- null
       (select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where proname = 'fe_ingestar')     as md5_ing, -- = el de la guarda de la 203
       (select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where proname = 'fe_motivo_sumar') as md5_mot, -- = el de la guarda de la 203
       (select count(*) from public.fe_emisores_conocidos)                                  as emisores,
       (select count(*) from public.fe_comprobantes where motivo like '%emisor no conocido%') as pendientes;
rollback;
```
`md5_ing`/`md5_mot` distintos = la guarda de la 203 va a parar el merge (Branching falla): no mergear, avisar.

## 3. Orden

1. Batería 203 en staging por la sesión de CC del dueño (regla 14): `python3 scripts/sql/203_pruebas.py --psql "<staging>"
   --mutar todas` (17 casos, 16 mutaciones; termina en ROLLBACK). Local ya corrió (PR).
2. Firma por chat sobre el SHA de cabeza (Gate verde) + lecturas del §2.
3. Merge en ventana D1 (código → con OK). Branching aplica la 203.
4. Después (solo lectura): ledger con **una** fila `203` / `fe_emisor_recordar` · `fe_emisores_bitacora` con RLS ·
   4 columnas nuevas · las 2 funciones `prosecdef` con `search_path` y `EXECUTE` solo para `authenticated` · Edge sin cambios.
5. Validación física del dueño (lo ve el contador): owner y contador ven el botón; tocarlo con una factura de prueba o la
   primera real del 30-nov; la factura pasa a «ok» y el emisor aparece en «Emisores conocidos».

**Parada:** guarda de la 203 (md5) · otra Edge cambia de hash · el ledger no queda con una fila 203.

## 4. Vuelta atrás

`scripts/sql/203_rollback.sql` (borra funciones, bitácora y columnas; los emisores recordados se quedan activos y lo
que pasó a «ok» queda «ok») + PR que saca el `.sql` de `main` solo si la 203 no está en el ledger (regla 10). Con uso
real: `revoke execute` de las dos funciones y migración nueva.

## 5. Firma y bitácora

| Cuándo (-06:00) | Qué | Quién |
|---|---|---|
| | | |
