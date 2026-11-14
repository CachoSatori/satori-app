-- Rollback de la 169 (origen 115): salen los retos de temporada baja — triggers (club_retos_visita_trg sobre
-- club_visitas_socio y club_retos_reglas_trg), las funciones club_reto*/club_retos*/club_portal_retos y las tablas
-- club_retos_ganados y club_retos. NO toca club_socio_visita, club_pase_datos ni club_portal (la 169 no los cambia), así
-- que vale igual con o sin la 168. Las filas de club_auditoria (reto_*) quedan: son historial de solo inserción.
-- Borra la fila 169 del ledger (la 115 nunca se aplicó con ese número).
--
-- ⚠ SKILL satori-migraciones-y-prod §6: si se corre en prod, EN EL MISMO MOMENTO sale el .sql de main en un PR propio
-- (si queda, Branching la vuelve a aplicar; si sale sin este rollback, Branching falla). Orden: primero el revert del
-- código (caja y club-web), así nadie llama a club_reto_en_visita ni a club_portal_retos (si se llaman sin la 169, la caja
-- sigue igual: el paso del reto es opcional y su error no se muestra).
-- ⚠ CON PREMIOS YA GANADOS (alguna fila en club_retos_ganados) NO SE CORRE: aborta sin tocar nada. Con actividad real
-- no se borra: se TERMINA el reto (Club → Promociones → Retos → «Terminar») y se arregla con una migración nueva. Así
-- no se pierde qué socio ganó o usó su premio (es plata).
begin;

do $$
begin
  -- GUARDA-169 (inicio)
  if to_regclass('public.club_retos_ganados') is not null and exists (select 1 from public.club_retos_ganados) then
    raise exception '169 rollback: hay premios de retos ya ganados (club_retos_ganados no está vacía): no se borra; se termina el reto y se arregla con una migración nueva';
  end if;
  -- GUARDA-169 (fin)
end
$$;

drop trigger if exists club_retos_visita_trg on public.club_visitas_socio;
drop function if exists public.club_portal_retos(text);
drop function if exists public.club_reto_en_visita(uuid, text);
drop function if exists public.club_reto_borrar(uuid);
drop function if exists public.club_reto_terminar(uuid);
drop function if exists public.club_reto_armar(uuid);
drop function if exists public.club_reto_guardar(uuid, jsonb);
drop function if exists public.club_reto_cortesias_validar(text[], jsonb, boolean);
drop function if exists public.club_retos_listar();
drop function if exists public.club_retos_del_socio(uuid);
drop function if exists public.club_retos_visita_trg();
drop function if exists public.club_retos_evaluar(uuid);
drop function if exists public.club_reto_avance(public.club_retos, uuid);
drop function if exists public.club_reto_en_franja(public.club_retos, timestamptz);
drop function if exists public.club_reto_participa(public.club_retos, uuid);
drop function if exists public.club_reto_control(uuid, int, uuid);
drop table if exists public.club_retos_ganados;
drop trigger if exists club_retos_reglas_trg on public.club_retos;
drop function if exists public.club_retos_reglas();
drop table if exists public.club_retos;

delete from supabase_migrations.schema_migrations where version = '169';

do $$
begin
  if to_regclass('public.club_retos') is not null or to_regclass('public.club_retos_ganados') is not null
     or to_regprocedure('public.club_reto_en_visita(uuid,text)') is not null
     or exists (select 1 from pg_trigger where tgname = 'club_retos_visita_trg') then
    raise exception '169 rollback: quedaron objetos de la 169';
  end if;
  if not has_function_privilege('authenticated', 'public.club_socio_visita(uuid,jsonb,uuid,text)', 'EXECUTE') then
    raise exception '169 rollback: la caja perdió club_socio_visita';
  end if;
end
$$;

commit;
