# Pase a PROD de la mig 188 `club_socio_edad` (origen club 132)

> **⛔ Esquema y permisos: firma del dueño sobre el SHA exacto.** Backlog del Club firmado el 16-nov (arreglo 2 de 4):
> «¿Pide la casilla de mayor de 18?» se consulta por una función con control de local, no leyendo la tabla. Si algo no
> coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Orden obligatorio:** **186 → 187 → 188**, un merge por vez, cada uno con su §5 en verde antes del siguiente. La 188
>   va última (R16).
> - **Ledger:** exactamente 1 fila `188` con su `name`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§4 y §5).

## 1. Qué pasa y qué no
**Pasa:** una función **nueva** (R13 no aplica): `club_socio_edad(uuid)`, SECURITY DEFINER, EXECUTE solo
`authenticated`. Roles owner, manager, cajero, contador (el resto 42501 «Sin permiso»); el manager solo fichas de sus
locales (`club_exigir_local_de` → 42501 «Ficha de otro local»); cajero y contador sin filtro de local. Devuelve
`{estado, baja_por, alta_por, validado_en, mayor_edad_en}` del rol de socio o null. App: `getEdadSocio` (Miembros y
Escanear) la usa; ante un error muestra la casilla. Guía 6.13 al día.

**No pasa:** RLS de `club_miembro_roles` (la lectura directa sigue igual), otras funciones, datos, sagrados.

## 2. Prerrequisitos
- La **187** mergeada y con su §5 OK (ledger prod = **187**).
- Prod el 17-nov (solo lectura): existe `club_exigir_local_de(text)`; no existe `club_socio_edad(uuid)`.

## 3. Pruebas (antes de aplicar, R15)
- `scripts/sql/188_pruebas.py --local … --semilla-local` sobre Postgres 16 local (sin la 188): **8/8** en transacción
  descartada. `--mutar todas`: **4/4 muerden** (`sin_local`, `sin_rol`, `otro_rol`, `sin_mayor_edad`).

## 4. Antes del merge (prod, solo lectura, `begin read only` … `rollback`)
- Ledger: última = **187**. Si no, **no se mergea**.
- `to_regprocedure('public.club_socio_edad(uuid)')` = null; `club_exigir_local_de(text)` presente.

## 5. Después del merge (prod, solo lectura)
- Ledger: 1 fila `188` / `club_socio_edad`; check «Supabase Preview» en success.
- `club_socio_edad(uuid)`: SECURITY DEFINER, `search_path = public, pg_temp`, EXECUTE de `authenticated` sí, `anon` no.
- **Humo:** como owner (`set_config('request.jwt.claims', …)`), sobre un socio cualquiera, devuelve los mismos cinco
  campos que `club_miembro_roles` (rol `socio`); sobre un id inexistente, null.

## 6. Criterios de parada
- Ledger distinto de 187 o la función ya existe: **no se mergea**.
- Branching en rojo o §5 distinto: se para, se avisa y se decide la vuelta atrás. No se arregla a mano.

## 7. Vuelta atrás
`scripts/sql/188_rollback.sql` (borra la función y la fila `188`; no hay datos que volver). **En el mismo momento**, un PR
que saca el `.sql` de `main` (regla 10) y revierte la app (sin la función, la app muestra la casilla: no se rompe). Va
antes que los rollback de la 187 y la 186.

## 8. Firma y bitácora
| Cuándo (-06:00) | Quién | Qué |
|---|---|---|
| 2026-11-16 | dueño | Firma el backlog del Club (arreglo 2 de 4) |
| | dueño | Firma de esquema sobre el SHA exacto (OK de merge) |
| | control | §4 y §5 |
