-- Vuelta atrás de la 197, como MIGRACIÓN NUEVA HACIA ADELANTE (regla 10 de ESTADO: la fila 197 del ledger y el archivo
-- supabase/migrations/197_ventas_comps_sin_contador.sql se QUEDAN; nunca se borran ni se revierten).
-- Listo para usar, SIN NUMERAR: si hace falta, se copia a supabase/migrations/NNN_ventas_comps_contador_vuelve.sql con
-- el siguiente número libre (registro + ESTADO en el mismo PR) y entra por merge → Branching, con firma.
-- Deja `ventas_comps_write` EXACTAMENTE como en prod antes de la 197 (la de la 011, leída en prod el 24-nov):
--   FOR ALL to authenticated, USING y WITH CHECK
--   (get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role]))
-- y sin comentario. La RLS de la tabla queda ENCENDIDA (así estaba en prod antes de la 197). No toca
-- `ventas_comps_read`, datos ni otras tablas. El contador vuelve a poder escribir en la base (la pantalla sigue sin
-- dejarlo: eso es código de la app, no se revierte acá).
begin;
drop policy if exists ventas_comps_write on public.ventas_comps;
create policy ventas_comps_write on public.ventas_comps for all to authenticated
  using (public.get_my_role() in ('owner', 'manager', 'contador'))
  with check (public.get_my_role() in ('owner', 'manager', 'contador'));
commit;
