# Pase a PROD de la mig 197 `ventas_comps_sin_contador` (origen club 141) — **en espera de firma**

> **⛔ Esquema y permisos: firma del dueño sobre el SHA exacto.** Decisión del dueño D18 ampliada (23-nov ~23:50 CR): las
> competencias de Ventas las crean y dan de baja solo owner y manager; el contador solo mira. La app ya lo cumple
> (`src/shared/permisosCompetencias.ts`); la 197 lo cierra también en la base. Si algo no coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Número definitivo:** 197. **Orden con la 196 (PR #357):** la 196 entra antes o la 197 se renumera. Si la 197 llega
>   primero a prod, la 196 ya no entra por Branching (versión menor que la última aplicada) y habría que renumerarla.
>   Si al momento del merge el ledger de prod ya pasó la 197, se para y se renumera al siguiente libre (archivo,
>   registro, ESTADO, PASE, scripts).
> - **Ledger:** exactamente 1 fila `197` con su `name`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§5).

## 1. Qué pasa y qué no
**Pasa:**
- `ventas_comps_write` (`FOR ALL to authenticated`) queda con USING y WITH CHECK
  `(select public.get_my_role()) in ('owner', 'manager')`, con un `comment on policy` que empieza con «Mig 197:».
- `alter table public.ventas_comps enable row level security`: en prod y staging ya está encendida (no-op); en una base
  armada desde el árbol la deja como prod.
- Efecto: el contador deja de poder crear, cambiar o borrar competencias por la API; las sigue viendo.

**No pasa:** `ventas_comps_read` (la de la 093), datos, otras tablas, funciones, Edge, sagrados. `ventas_comps` no tiene
columna de local: el manager sigue escribiendo cualquier competencia, como hoy.

## 2. Prerrequisitos (prod, solo lectura, antes del merge)
Lectura del verificador independiente, 24-nov (prod `yiczgdti…` y staging `hwiatgic…`, idénticas):
- Ledger prod: `select max(version) from supabase_migrations.schema_migrations` = **195** (o 196 si #357 entró antes).
- `pg_class.relrowsecurity` de `public.ventas_comps` = true; `relforcerowsecurity` = false.
- Exactamente 2 policies en `ventas_comps`:
  - `ventas_comps_write`: `ALL` · `{authenticated}` · qual = with_check =
    `(get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role]))` · sin comentario.
  - `ventas_comps_read`: `SELECT` · `{authenticated}` · `(( SELECT get_my_role() AS get_my_role) IS NOT NULL)`.

## 3. Pruebas
- **Local** (Postgres 16 desde el árbol, `197_pruebas.py --local`): 19/19 y las 7 mutaciones muerden. El verificador
  además mutó la migración (contador de vuelta, sin manager, sin `enable` RLS, WITH CHECK abierto) y la vuelta atrás
  (sin contador): cae la batería y el contrato `ventasComps.contrato197.test.ts` en todas.
- **Staging:** **NO PROBADO** al 24-nov (el conector de Supabase pidió confirmación y no llegó; el proxy bloquea la
  Management API). Pendiente: el SQL de `python3 scripts/sql/197_pruebas.py --armar` (termina en ROLLBACK).

## 4. Antes del merge (prod, solo lectura, `begin read only` … `rollback`)
- Lo de §2. Si no coincide, **no se mergea**.

## 5. Después del merge (prod, solo lectura)
- Ledger: 1 fila `197` / `ventas_comps_sin_contador`; check «Supabase Preview» en success, «All migrations are up to date».
- `relrowsecurity` = true; siguen siendo 2 policies; `ventas_comps_read` igual que en §2.
- `ventas_comps_write`: `ALL` · `{authenticated}` · qual = with_check =
  `(( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['owner'::user_role, 'manager'::user_role]))`; comentario
  empieza con «Mig 197:».
- **Humo** (JWT simulado con `request.jwt.claims` y `set local role authenticated`, `begin read only` … `rollback`):
  como un contador activo, `select count(*) from public.ventas_comps` = lo mismo que como owner (sigue leyendo). En
  modo solo lectura no se prueban escrituras; las cubre la batería.
- **App:** como manager, «+ Nueva» y «×» en Competencias siguen andando (el dueño, en su validación física).

## 6. Criterios de parada
- §2 no coincide (otra policy, texto distinto, RLS apagada, ledger inesperado): no se mergea.
- Después del merge: el ledger no tiene 1 fila `197`, la policy no es la de §5, el contador deja de leer o el manager no
  puede crear/borrar: se para, se avisa al dueño y se evalúa la vuelta atrás (§7). No se improvisa en prod.

## 7. Vuelta atrás (regla 10: la fila 197 y su `.sql` se quedan)
`scripts/sql/197_rollback.sql`, sin numerar: se copia a `supabase/migrations/NNN_ventas_comps_contador_vuelve.sql` con el
siguiente número libre (registro y ESTADO en el mismo PR), con firma, y entra por merge → Branching. Deja
`ventas_comps_write` exactamente como en §2 (owner, manager y contador; sin comentario) y la RLS encendida. La app no se
toca: la pantalla sigue sin dejar escribir al contador.

## 8. Firma y bitácora
| Fecha y hora (-06:00) | Qué | Quién |
|---|---|---|
| 2026-11-24 | Verificador independiente: lecturas de §2, batería local y mutaciones | verificador |
| | Firma del dueño sobre el SHA | dueño |
| | Merge a `main`; Branching aplica la 197 | merge |
| | Control §5 | control |
