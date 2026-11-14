-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 162 (origen 108) — Club → Embudo del anfitrión (Fase 1D, SPEC Club v2 ítem 8 / brecha B7).      ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Una función nueva que lee plata y nombres de anfitriones: no se mergea sin el OK del dueño. Creada como 108 (bloque
-- CLUB); prod va por la 155, así que va al bloque de PASE con origen 108 (regla 3). 156–161 son de otros PRs.
-- Rama independiente desde main: NO llama a la 160 (#179) ni a la 161 (#180). Copia su criterio de venta (neta − regalía,
-- decisión del dueño 14-nov para el tablero) y su forma de elegir locales, sin depender de ellas.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
--   · public.club_embudo_anfitrion(p_mes date, p_location text default null, p_exporte boolean default false) → jsonb.
--     Solo owner y manager ACTIVOS (get_my_role() da null con la cuenta inactiva, 069): la respuesta tiene nombres.
--     Contador, cajero, salonero, anon, inactivo y manager de otro local: error 42501.
--   · Por anfitrión, mes (hora CR) y local: cupones generados → usados → (clic en reseña) → con factura → personas →
--     venta respaldada → tiquete promedio, con el % entre pasos. «QR visto» NO se guarda en la base: queda fuera.
--   · Nombre limpio del anfitrión y números; nunca teléfono, correo, código, token ni el contacto del turista.
--   · Rastro en club_auditoria: 'ver_embudo_anfitrion' o, con p_exporte, 'exporte_embudo_anfitrion_csv' (mes, local y
--     cuántas filas; sin datos). El CSV de la app SOLO sale de la llamada con p_exporte.
--   · p_location null = todos los locales del Club que el usuario ve (mis_locales(), 091). Con local: tiene que estar en
--     club_config (club_local) y en puede_ver_local (el manager ve solo sus locales).
--   · SECURITY DEFINER, search_path fijo, EXECUTE solo authenticated (anon no).
--
-- ── DEFINICIONES ───────────────────────────────────────────────────────────────────────────────
--   · Anfitrión: el dueño del cupón (club_cupones.referente_id). Tipo = su rol de anfitrión (club_miembro_roles, rol
--     distinto de 'socio') o, si no tiene, club_miembros.tipo. Grupo «equipo» (tipo equipo: con D7/157 no gana créditos
--     y su embudo es el ranking de DESEMPEÑO) y grupo «anfitrion» (referentes y concierges). Funciona con y sin la 157: el
--     tipo existe desde la 150; la 157 solo cambia los créditos. 'd7' en la respuesta dice si la 157 está aplicada.
--   · Cohorte de cupones: los GENERADOS en el mes (creado_en, hora CR) en los locales elegidos (el local del cupón).
--     Los demás pasos miran a esos mismos cupones, aunque se hayan usado el mes siguiente: así el % nunca pasa de 100.
--     Del mes en curso, los vigentes todavía pueden usarse (van aparte: vigentes, vencidos sin usar, anulados).
--   · Usado: estado 'usado'. Personas: Σ club_cupones.personas de los usados (las pendientes de aprobación también:
--     la gente vino; el crédito es otra cosa).
--   · Clic en reseña (opcional): club_cupones.resena_clic_en de la 158 (#177). Si la columna no existe, 'resena_disponible'
--     es false y el paso sale null (la pantalla no lo muestra). Se detecta en cada llamada (pg_attribute + SQL dinámico):
--     cuando entre la 158 se activa solo, sin otra migración.
--   · Facturas de un cupón usado: la elegida a mano en club_cruces_manuales (de su movimiento) o el cruce automático
--     (club_cruce_facturas con pos_ref y factura_pos del cupón: la principal + divididas). Solo cerradas (C): una anulada
--     (X) no cuenta (decisión del dueño 14-nov) ni una provisional (R).
--   · Con factura: cupones usados con al menos una factura C. Mesas: facturas principales distintas.
--   · Venta neta de una factura: Σ monto de sus líneas, menos las familias 6, 17 y 20 (netaVenta.ts, firmado).
--   · Venta respaldada (COBRADA, decisión del dueño 14-nov para el tablero): neta − regalia_crc de la factura (mínimo 0).
--     La neta va al lado. Una factura cuenta UNA vez por anfitrión; los totales (del grupo y generales) la cuentan una vez
--     aunque dos anfitriones compartan la mesa.
--   · Tiquete promedio = venta respaldada ÷ mesas.
--   · Anfitriones sin cupones en el mes: activos de los locales elegidos, contados (sin nombres), por grupo.
--   · Local sin facturas del PoS en el mes (Nosara hoy): sale en 'locales_sin_pos' (aviso en pantalla, no error).
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────────
--   · Ninguna tabla, columna, saldo ni movimiento. Solo lectura (más la fila de auditoría). Ninguna función existente.
--   · Ni sagrados, ni caja, ni Edge.
--
-- Pruebas: scripts/sql/162_pruebas.sql (transacción con rollback; Postgres 16 local, con y sin 157/158, y staging).
-- Rollback: scripts/sql/162_rollback.sql.

begin;

create or replace function public.club_embudo_anfitrion(p_mes date, p_location text default null,
                                                        p_exporte boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol    public.user_role := public.get_my_role();
  v_locs   text[];
  v_mes    date;
  v_ini    timestamptz;
  v_fin    timestamptz;
  v_hoy    date := (now() at time zone 'America/Costa_Rica')::date;
  -- 158 (#177): la columna del clic de reseña puede no estar. Se detecta acá, no al crear la función.
  v_resena boolean := exists (select 1 from pg_attribute a
                               where a.attrelid = 'public.club_cupones'::regclass and a.attname = 'resena_clic_en'
                                 and not a.attisdropped);
  -- 157 (#176, D7): el equipo no gana créditos. Solo se informa; el grupo sale del tipo (existe desde la 150).
  v_d7     boolean := to_regprocedure('public.club_saldo_canjeable(uuid)') is not null;
  v_clic   uuid[] := '{}';
  v_n      int;
  r        jsonb;
begin
  -- Rol primero (antes de decir si el local existe). Solo owner y manager: la respuesta tiene nombres.
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_mes is null then
    raise exception 'Mes no válido: elegí un mes' using errcode = 'P0001';
  end if;
  if p_location is null then
    select coalesce(array_agg(c.location_id order by c.location_id), array[]::text[]) into v_locs
      from public.club_config c where c.location_id = any (public.mis_locales());
  else
    p_location := public.club_local(p_location, false);   -- tiene que existir en club_config
    if not public.puede_ver_local(p_location) then         -- 091: el manager ve solo sus locales
      raise exception 'Sin permiso' using errcode = '42501';
    end if;
    v_locs := array[p_location];
  end if;
  v_mes := date_trunc('month', p_mes)::date;
  v_ini := v_mes::timestamp at time zone 'America/Costa_Rica';
  v_fin := (v_mes + interval '1 month')::timestamp at time zone 'America/Costa_Rica';

  if v_resena then
    execute 'select coalesce(array_agg(c.id), ''{}''::uuid[]) from public.club_cupones c
              where c.location_id = any ($1) and c.creado_en >= $2 and c.creado_en < $3 and c.resena_clic_en is not null'
       into v_clic using v_locs, v_ini, v_fin;
  end if;

  with
  -- Cupones GENERADOS en el mes (hora CR) en los locales elegidos
  cu as (
    select c.id, c.location_id, c.referente_id, c.estado, c.vence_en, c.personas, c.pos_ref, c.factura_pos,
           (c.id = any (v_clic)) as clic
      from public.club_cupones c
     where c.location_id = any (v_locs) and c.creado_en >= v_ini and c.creado_en < v_fin),
  -- Facturas de los cupones usados: la elegida a mano (club_cruces_manuales del movimiento) o el cruce automático
  cf as (
    select cu.id as cupon_id, cu.referente_id, x.tid, x.ord
      from cu
      left join public.club_movimientos m on m.cupon_id = cu.id
      left join public.club_cruces_manuales cm on cm.movimiento_id = m.id
      left join public.pos_ndf_tickets cm_t on cm_t.local = cu.location_id and cm_t.numero_factura = cm.numero_factura
      cross join lateral unnest(case when cm_t.id is not null then array[cm_t.id]
                                     else public.club_cruce_facturas(cu.location_id, cu.pos_ref, cu.factura_pos) end)
                 with ordinality as x(tid, ord)
     where cu.estado = 'usado'),
  -- Solo cerradas (C)
  ft as (
    select t.id, coalesce(t.regalia_crc, 0) as regalia
      from public.pos_ndf_tickets t where t.id in (select tid from cf) and t.estado = 'C'),
  neta as (
    select l.ticket_id, sum(l.monto) filter (where l.familia is null or l.familia not in (6, 17, 20)) as neta
      from public.pos_ndf_ticket_lines l join ft on ft.id = l.ticket_id
     group by l.ticket_id),
  -- Una fila por factura: neta y COBRADA (neta − regalía, mínimo 0; decisión del dueño 14-nov)
  fa as (
    select ft.id, coalesce(n.neta, 0) as neta, greatest(coalesce(n.neta, 0) - ft.regalia, 0) as cobrada
      from ft left join neta n on n.ticket_id = ft.id),
  cfc as (select cf.* from cf where cf.tid in (select id from fa)),
  -- Quién es cada anfitrión: su rol de anfitrión o, si no tiene, su tipo
  mi as (
    select m.id, public.club_nombre_limpio(m.nombre) as nombre, m.location_id, m.estado,
           coalesce((select rr.rol from public.club_miembro_roles rr where rr.miembro_id = m.id and rr.rol <> 'socio'
                      order by (rr.estado = 'activo') desc limit 1), m.tipo) as tipo
      from public.club_miembros m
     where m.id in (select referente_id from cu)),
  gi as (select mi.*, case when mi.tipo = 'equipo' then 'equipo' else 'anfitrion' end as grupo from mi),
  -- Pasos por anfitrión
  an as (
    select cu.referente_id as id,
           count(*) as generados,
           count(*) filter (where cu.estado = 'usado') as usados,
           count(*) filter (where cu.estado = 'vigente' and cu.vence_en > now()) as vigentes,
           count(*) filter (where cu.estado = 'vigente' and cu.vence_en <= now()) as vencidos,
           count(*) filter (where cu.estado = 'anulado') as anulados,
           count(*) filter (where cu.clic) as clics,
           count(*) filter (where cu.estado = 'usado' and exists (select 1 from cfc where cfc.cupon_id = cu.id)) as con_factura,
           coalesce(sum(cu.personas) filter (where cu.estado = 'usado'), 0) as personas
      from cu group by cu.referente_id),
  -- (anfitrión, factura): una factura cuenta UNA vez por anfitrión
  af as (select distinct cfc.referente_id, cfc.tid from cfc),
  av as (
    select af.referente_id as id, count(*) as facturas, sum(fa.cobrada) as venta, sum(fa.neta) as neta
      from af join fa on fa.id = af.tid group by af.referente_id),
  -- mesas = facturas principales distintas
  am as (select cfc.referente_id as id, count(distinct cfc.tid) as mesas from cfc where cfc.ord = 1 group by cfc.referente_id),
  fi as (
    select gi.id, gi.nombre, gi.tipo, gi.grupo, gi.estado, coalesce(cl.nombre, gi.location_id) as local_nombre,
           an.generados, an.usados, an.vigentes, an.vencidos, an.anulados, an.clics, an.con_factura, an.personas,
           coalesce(av.facturas, 0) as facturas, coalesce(av.venta, 0) as venta, coalesce(av.neta, 0) as neta,
           coalesce(am.mesas, 0) as mesas
      from gi join an on an.id = gi.id
      left join av on av.id = gi.id left join am on am.id = gi.id
      left join public.club_config cl on cl.location_id = gi.location_id),
  -- Facturas y mesas por grupo y en total: cada una UNA vez
  gf as (select distinct fi.grupo, af.tid from af join fi on fi.id = af.referente_id),
  gm as (select distinct fi.grupo, cfc.tid from cfc join fi on fi.id = cfc.referente_id where cfc.ord = 1),
  -- Anfitriones activos de los locales elegidos SIN cupones en el mes (solo conteo)
  sc as (
    select case when x.tipo = 'equipo' then 'equipo' else 'anfitrion' end as grupo, count(*) as n
      from (select m.id, coalesce((select rr.rol from public.club_miembro_roles rr
                                    where rr.miembro_id = m.id and rr.rol <> 'socio' and rr.estado = 'activo' limit 1),
                                  case when m.tipo in ('referente','concierge_pm','equipo') then m.tipo end) as tipo
              from public.club_miembros m
             where m.location_id = any (v_locs) and m.estado = 'activo'
               and not exists (select 1 from cu where cu.referente_id = m.id)) x
     where x.tipo is not null
     group by 1),
  -- Locales sin facturas del PoS en el mes (Nosara hoy): aviso
  sp as (
    select coalesce(jsonb_agg(coalesce(c.nombre, c.location_id) order by c.location_id), '[]'::jsonb) as l
      from public.club_config c
     where c.location_id = any (v_locs)
       and not exists (select 1 from public.pos_ndf_tickets t
                        where t.local = c.location_id and t.estado = 'C'
                          and coalesce(t.fecha_registra, t.fecha_cierra) >= v_ini
                          and coalesce(t.fecha_registra, t.fecha_cierra) < v_fin))
  select jsonb_build_object(
    'mes', to_char(v_mes, 'YYYY-MM'),
    'mes_en_curso', v_mes = date_trunc('month', v_hoy)::date,
    'local', coalesce(p_location, 'todos'),
    'locales', to_jsonb(v_locs),
    'locales_sin_pos', (select l from sp),
    'resena_disponible', v_resena,
    'd7', v_d7,
    'generado_en', now(),
    'anfitriones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', fi.id, 'nombre', fi.nombre, 'tipo', fi.tipo, 'grupo', fi.grupo, 'estado', fi.estado,
               'local', fi.local_nombre,
               'generados', fi.generados, 'usados', fi.usados, 'vigentes', fi.vigentes, 'vencidos', fi.vencidos,
               'anulados', fi.anulados,
               'clics_resena', case when v_resena then fi.clics end,
               'con_factura', fi.con_factura, 'mesas', fi.mesas, 'facturas', fi.facturas, 'personas', fi.personas,
               'venta_respaldada_crc', round(fi.venta), 'venta_neta_crc', round(fi.neta),
               'tiquete_promedio_crc', case when fi.mesas > 0 then round(fi.venta / fi.mesas) end,
               'pct_uso', case when fi.generados > 0 then round(100.0 * fi.usados / fi.generados, 1) end,
               'pct_resena', case when v_resena and fi.usados > 0 then round(100.0 * fi.clics / fi.usados, 1) end,
               'pct_con_factura', case when fi.usados > 0 then round(100.0 * fi.con_factura / fi.usados, 1) end,
               'personas_por_cupon', case when fi.usados > 0 then round(fi.personas::numeric / fi.usados, 1) end)
             order by (fi.grupo = 'equipo') desc, fi.personas desc, fi.venta desc, fi.nombre)
        from fi), '[]'::jsonb),
    'grupos', (
      select jsonb_object_agg(g.grupo, jsonb_build_object(
               'anfitriones', coalesce(t.anfitriones, 0),
               'sin_cupones', coalesce((select sc.n from sc where sc.grupo = g.grupo), 0),
               'generados', coalesce(t.generados, 0), 'usados', coalesce(t.usados, 0),
               'vigentes', coalesce(t.vigentes, 0), 'vencidos', coalesce(t.vencidos, 0), 'anulados', coalesce(t.anulados, 0),
               'clics_resena', case when v_resena then coalesce(t.clics, 0) end,
               'con_factura', coalesce(t.con_factura, 0), 'personas', coalesce(t.personas, 0),
               'facturas', (select count(*) from gf join fa on fa.id = gf.tid where gf.grupo = g.grupo),
               'mesas', (select count(*) from gm where gm.grupo = g.grupo),
               'venta_respaldada_crc', (select round(coalesce(sum(fa.cobrada), 0)) from gf join fa on fa.id = gf.tid where gf.grupo = g.grupo),
               'venta_neta_crc', (select round(coalesce(sum(fa.neta), 0)) from gf join fa on fa.id = gf.tid where gf.grupo = g.grupo)))
        from (values ('equipo'), ('anfitrion')) g(grupo)
        left join (select fi.grupo, count(*) as anfitriones, sum(fi.generados) as generados, sum(fi.usados) as usados,
                          sum(fi.vigentes) as vigentes, sum(fi.vencidos) as vencidos, sum(fi.anulados) as anulados,
                          sum(fi.clics) as clics, sum(fi.con_factura) as con_factura, sum(fi.personas) as personas
                     from fi group by fi.grupo) t on t.grupo = g.grupo),
    'totales', (select jsonb_build_object(
                  'anfitriones', (select count(*) from fi),
                  'sin_cupones', (select coalesce(sum(sc.n), 0) from sc),
                  'generados', (select count(*) from cu),
                  'usados', (select count(*) from cu where cu.estado = 'usado'),
                  'vigentes', (select count(*) from cu where cu.estado = 'vigente' and cu.vence_en > now()),
                  'vencidos', (select count(*) from cu where cu.estado = 'vigente' and cu.vence_en <= now()),
                  'anulados', (select count(*) from cu where cu.estado = 'anulado'),
                  'clics_resena', case when v_resena then (select count(*) from cu where cu.clic) end,
                  'con_factura', (select count(distinct cfc.cupon_id) from cfc),
                  'personas', (select coalesce(sum(cu.personas), 0) from cu where cu.estado = 'usado'),
                  -- cada factura UNA vez aunque la compartan dos anfitriones
                  'facturas', count(fa.id),
                  'mesas', (select count(distinct cfc.tid) from cfc where cfc.ord = 1),
                  'venta_respaldada_crc', round(coalesce(sum(fa.cobrada), 0)),
                  'venta_neta_crc', round(coalesce(sum(fa.neta), 0)))
                from fa)
  ) into r;

  v_n := jsonb_array_length(r->'anfitriones');
  perform public.club_auditar(case when p_exporte then 'exporte_embudo_anfitrion_csv' else 'ver_embudo_anfitrion' end,
    'club_embudo_anfitrion', null, null,
    jsonb_build_object('mes', to_char(v_mes, 'YYYY-MM'), 'local', coalesce(p_location, 'todos'), 'filas', v_n));
  return r;
end;
$$;

revoke all on function public.club_embudo_anfitrion(date, text, boolean) from public, anon, authenticated;
grant execute on function public.club_embudo_anfitrion(date, text, boolean) to authenticated;

comment on function public.club_embudo_anfitrion(date, text, boolean) is
  'Club → Embudo (162): por anfitrión, cupones generados en el mes (hora CR) → usados → clic en reseña (si está la 158) → con factura → personas → venta respaldada cobrada (neta − regalía; una factura una vez) → tiquete. Grupo equipo aparte. Solo owner y manager activos; sin contactos; cada lectura o exporte queda en club_auditoria.';

-- Verificación: la función existe, es SECURITY DEFINER con search_path fijo y anon no la ejecuta.
do $$
declare v_p pg_proc%rowtype;
begin
  select * into v_p from pg_proc where oid = 'public.club_embudo_anfitrion(date, text, boolean)'::regprocedure;
  if not v_p.prosecdef then raise exception '162: club_embudo_anfitrion no es SECURITY DEFINER'; end if;
  if not exists (select 1 from unnest(v_p.proconfig) c where c like 'search_path=%') then
    raise exception '162: club_embudo_anfitrion sin search_path fijo';
  end if;
  if has_function_privilege('anon', 'public.club_embudo_anfitrion(date, text, boolean)', 'execute') then
    raise exception '162: anon puede ejecutar club_embudo_anfitrion';
  end if;
end $$;

commit;
