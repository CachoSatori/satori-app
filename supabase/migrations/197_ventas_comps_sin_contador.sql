-- 197 (origen 141) · Competencias de Ventas: el contador SOLO MIRA (decisión del dueño D18 ampliada, 23-nov).
--
-- Qué cambia: `ventas_comps_write` (migración 011: FOR ALL to authenticated, owner/manager/contador) pasa a dejar
-- escribir (insert, update, delete) SOLO a owner y manager. El contador sigue leyendo por `ventas_comps_read`
-- (migración 093: cualquier perfil activo), que esta migración NO toca. La pantalla y `saveComp`/`deleteComp`
-- (src/shared/permisosCompetencias.ts) ya rechazan al contador; esto lo cierra también en la base.
--
-- Multi-local: `ventas_comps` NO tiene columna de local (id, data jsonb, created_at, updated_at). No se inventa: el
-- manager sigue escribiendo cualquier competencia, como hoy. Limitarlo a `mis_locales()` necesita antes la columna.
--
-- RLS: en prod y staging `ventas_comps` ya tiene la RLS encendida (leído el 24-nov), pero ninguna migración del repo la
-- enciende (deriva de antes del baseline: una base armada desde el árbol la tiene apagada y las políticas no muerden).
-- Se enciende acá: en prod es un no-op; en una base nueva deja la tabla como prod.
--
-- Idempotente (enable rls + drop if exists + create). No toca datos, ni otras tablas, ni la lectura.
-- Vuelta atrás: scripts/sql/197_rollback.sql (deja la política exactamente como en prod al 24-nov).
begin;

alter table public.ventas_comps enable row level security;

drop policy if exists ventas_comps_write on public.ventas_comps;
create policy ventas_comps_write on public.ventas_comps for all to authenticated
  using ((select public.get_my_role()) in ('owner', 'manager'))
  with check ((select public.get_my_role()) in ('owner', 'manager'));

comment on policy ventas_comps_write on public.ventas_comps is
  'Mig 197: crear, cambiar y borrar competencias solo owner y manager; el contador solo lee (ventas_comps_read).';

commit;
