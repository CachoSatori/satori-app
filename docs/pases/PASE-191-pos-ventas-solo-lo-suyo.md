# Pase a PROD de la mig 191 `pos_ventas_solo_lo_suyo` (origen club 135)

> **⛔ Esquema y permisos: firma del dueño sobre el SHA exacto.** Decisiones del dueño del 18-nov: 11:44 («Salonero A»:
> cerrar la fuga de la 067) y 11:50 («C»: el contador ve el nombre del salonero en «Ayer: mesas sin pax»). Si algo no
> coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Orden:** la **190** (`pos_ventas_resumen`, #290) va **antes** si va a entrar pronto: con la 191 en el ledger,
>   Branching rechaza la 190 (versión menor) y habría que renumerarla. Si la 191 entra primero, la 190 se renumera a la
>   siguiente libre del bloque 150–199 en su PR.
> - **Ledger:** exactamente 1 fila `191` con su `name`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§4 y §5).

## 1. Qué pasa y qué no
**Pasa:**
- `pos_ventas_tickets_rango`, `pos_ventas_lineas`, `pos_ventas_latido` (067): **misma firma, mismas columnas**, nuevo
  criterio: owner/contador activos → todo; manager activo → solo `mis_locales()`; salonero/barman/barback/runner/cocina
  activos → solo las facturas con `btrim(salonero_login)` en sus `employees.pos_login`; el resto → nada. Las líneas,
  por la factura de la línea. `search_path = public, pg_temp`.
- Nuevas: `pos_mis_logins()` (interna: sin EXECUTE para `anon` ni `authenticated`) y `pos_nombres_por_login()` →
  `(pos_login, nombre)` solo para owner/manager/contador (el resto 0 filas; `anon` sin EXECUTE).
- App: `getSaloneroNombres` suma `pos_nombres_por_login` (si falta la función, se ignora). Mi Rendimiento oculta, para
  el personal, todo lo que compara contra el equipo (saldría con sus propios números). Guía 6.5 al día.

**No pasa:** policies (ni `pos_ndf_*` ni `employees`: regla 6), columnas, datos, `pos_ventas_resumen` (190), sagrados.

## 2. Prerrequisitos y lecturas previas (prod, 18-nov, solo lectura)
- Ledger prod = **189** (`cron_ventas_dia_contador`).
- Las tres funciones de la 067 en prod tienen el mismo `md5(pg_get_functiondef)` que en staging (cuerpo de la 067):
  `pos_ventas_tickets_rango` `ce7245d0…`, `pos_ventas_lineas` `ba41d0d5…`, `pos_ventas_latido` `22ff3225…`.
- `pos_ndf_tickets`: un solo local (`santa-teresa`). Manager activo: asignado a `santa-teresa` (no cambia lo que ve).
- Personal activo con perfil: todos con `pos_login` cargado (si falta, ese usuario deja de ver ventas en Mi Rendimiento).
- `employees` en prod **no** tiene `unique (pos_login)` (staging sí: deriva). Un login con dos filas → gana la activa.

## 3. Pruebas en staging (`hwiatgic…`, transacción que termina en ROLLBACK)
- `scripts/sql/191_pruebas.py --armar --compacto` (casos 01–10, sin la sección 11 de la vuelta atrás): **35/35**.
- **Sin el arreglo** (staging con la 067 tal cual, casos 01–07): **caen 9** (manager ve el local B, salonero ve
  facturas y líneas de otros, barman y cocina sin login ven todo, latido del manager en B).
- Humo con datos de staging (120 días, primera página): owner/contador/manager 1000 → 1000; salonero real 1000 → 554
  (= sus facturas); barman y cocina sin login 1000 → 0.
- **NO PROBADO en staging:** la sección 11 (vuelta atrás dentro de la batería: el conector pide confirmación para `drop`
  y la cancela) y las mutaciones `nombres_todos` y `sin_trim` del runner (están; correrlas con `--local`).

## 4. Antes del merge (prod, solo lectura, `begin read only` … `rollback`)
- Ledger: última = **189** (o **190** si entró antes). Si no, **no se mergea**.
- md5 de las tres funciones = los de §2. `to_regprocedure('public.pos_nombres_por_login()')` = null.

## 5. Después del merge (prod, solo lectura)
- Ledger: 1 fila `191` / `pos_ventas_solo_lo_suyo`; check «Supabase Preview» en success.
- Las 5 funciones: SECURITY DEFINER, `search_path=public, pg_temp`; `has_function_privilege('anon', …, 'execute')` =
  false en las 5; `authenticated` = false en `pos_mis_logins`.
- **Humo** (JWT simulado en `begin read only` … `rollback`, 30 días, contar filas, sin mirar montos):
  owner = contador = manager = lo de antes; cada salonero activo = `count(*)` de `pos_ndf_tickets` C con su login;
  `pos_nombres_por_login()` como contador ≥ como owner sobre activos, y 0 filas como salonero.

## 6. Criterios de parada
- Ledger distinto o md5 distinto: **no se mergea**.
- Branching en rojo o §5 distinto: se para, se avisa y se decide la vuelta atrás. No se arregla a mano.

## 7. Vuelta atrás
`scripts/sql/191_rollback.sql` (cuerpo exacto de la 067 + borra las dos funciones nuevas y la fila `191`). **Reabre la
fuga.** En el mismo momento, un PR que saca el `.sql` de `main` (regla 10) y revierte la app.

## 8. Firma y bitácora
| Cuándo (-06:00) | Quién | Qué |
|---|---|---|
| 2026-11-18 11:44 | dueño | Decisión «Salonero A»: cada uno ve solo lo suyo |
| 2026-11-18 11:50 | dueño | Decisión «C»: el contador ve nombres en el Resumen (`pos_nombres_por_login`) |
| | dueño | Firma de esquema/permisos sobre el SHA exacto (OK de merge) |
| | control | §4 y §5 |
