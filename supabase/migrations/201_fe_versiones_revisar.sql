-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 201 · Compras F1: misma clave con otro XML → «revisar», no «duplicado» (hallazgos 257 y 258) ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Hallazgo 257 (auditor, Media): con la 199 «el primero gana». `fe_ingestar` y `fe_respuesta_registrar` hacían
-- `on conflict (clave) do nothing`: un XML falso (o equivocado) que llega ANTES deja al real como «duplicado» y se pierde.
-- Hallazgo 258 (Baja): la Edge subía a `fe-xml/AAAA/MM/<clave>.xml` y trataba «ya existe» como éxito: la copia guardada
-- podía no ser el XML cuyo sha quedó en la base.
--
-- Qué cambia (no se toca el .sql de la 199, regla 10; esto la completa):
--   1. `fe_comprobante_versiones`: cada XML DISTINTO (por sha256) que llegó para una clave, con su ruta, fuente, lote y
--      hora. El primero también queda (se rellena con lo que ya hay). Mismo sha = duplicado de verdad (sin fila nueva).
--      Otro sha para la misma clave = se guarda la versión y el comprobante pasa a «revisar» con motivo; NADA se pisa:
--      la cabecera y las líneas siguen siendo las del primero hasta que una persona decida.
--   2. `fe_respuestas` gana `huella` (sha256 del contenido: mensaje, detalle y cédula del receptor), `estado` y `motivo`;
--      `fe_respuesta_versiones` guarda cada respuesta distinta. Otra respuesta para la misma clave = «revisar» (la
--      respuesta y, si existe, su comprobante).
--   3. `fe_emisores_conocidos`: cédulas de emisor que el owner da por conocidas (lista mínima viable: `suppliers` no tiene
--      cédula todavía). Un comprobante de un emisor que no está (o está inactivo) entra igual, a «revisar». No crea
--      proveedores. La edita SOLO el owner (sin borrar: se desactiva), igual que `fe_receptores`.
--   4. La ruta del XML lleva su sha (`AAAA/MM/<clave>/<sha256>.xml`): `fe_ingestar` rechaza (P0001, la Edge reintenta)
--      una ruta que no termina en el sha que trae, así la fila SIEMPRE apunta al archivo de SU sha. Las filas viejas
--      (ruta `AAAA/MM/<clave>.xml`) quedan como estaban (la restricción de versiones es NOT VALID).
--   5. `fe_ingesta_resumen`: «revisar» también cuenta las respuestas en conflicto sin comprobante y los comprobantes
--      viejos que recibieron una versión nueva en el período. Mismo orden de arreglos que la 199.
-- Un candado por clave (`pg_advisory_xact_lock`) ordena dos llegadas simultáneas de la misma clave.
--
-- Permisos: igual que la 199. Nadie escribe por la API las tablas nuevas salvo el owner en `fe_emisores_conocidos`;
-- las funciones de la Edge son SECURITY DEFINER con search_path fijo y solo las ejecuta service_role; leen owner y
-- contador; el manager lee las versiones de SU local (como las líneas).
-- Entra a prod por merge → Branching, con la firma del dueño (docs/pases/PASE-201-fe-versiones.md), junto con la Edge.
-- Vuelta atrás: scripts/sql/201_rollback.sql. Pruebas: scripts/sql/201_pruebas.sql (terminan en ROLLBACK).

-- ── 0. Guarda: necesita la 199 y no puede correr dos veces ───────────────────────────────
do $guarda201$
declare
  o text;
begin
  foreach o in array array['public.fe_comprobantes', 'public.fe_respuestas', 'public.fe_receptores', 'public.fe_ingesta_bitacora'] loop
    if to_regclass(o) is null then
      raise exception '201: falta % (migración 199)', o;
    end if;
  end loop;
  if to_regprocedure('public.fe_ingestar(jsonb)') is null or to_regprocedure('public.fe_respuesta_registrar(jsonb)') is null
     or to_regprocedure('public.fe_ingesta_resumen(integer)') is null or to_regprocedure('public.fe_receptores_sello()') is null then
    raise exception '201: faltan funciones de la 199';
  end if;
  foreach o in array array['public.fe_comprobante_versiones', 'public.fe_respuesta_versiones', 'public.fe_emisores_conocidos'] loop
    if to_regclass(o) is not null then
      raise exception '201: % ya existe: se para sin tocar nada', o;
    end if;
  end loop;
  if to_regprocedure('public.fe_motivo_sumar(text,text)') is not null
     or exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'fe_respuestas' and column_name in ('huella', 'estado', 'motivo')) then
    raise exception '201: ya corrió (fe_motivo_sumar o columnas nuevas de fe_respuestas): se para sin tocar nada';
  end if;
end
$guarda201$;

-- ── 1. Motivo: suma uno al principio sin repetirlo ───────────────────────────────────────
create function public.fe_motivo_sumar(p_motivo text, p_nuevo text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $function$
  select left(case when p_nuevo is null or position(p_nuevo in coalesce(p_motivo, '')) > 0 then p_motivo
                   else concat_ws(' · ', p_nuevo, nullif(btrim(p_motivo), '')) end, 1000);
$function$;
revoke all on function public.fe_motivo_sumar(text, text) from public, anon, authenticated;

-- ── 2. Versiones de cada comprobante (una por sha) ───────────────────────────────────────
create table public.fe_comprobante_versiones (
  id             bigint      generated always as identity primary key,
  comprobante_id uuid        not null references public.fe_comprobantes (id),
  xml_sha256     text        not null check (xml_sha256 ~ '^[0-9a-f]{64}$'),
  xml_path       text        not null,
  fuente         text        not null,
  lote           text,
  recibido_en    timestamptz not null default now(),
  constraint fe_comprobante_versiones_sha_uq unique (comprobante_id, xml_sha256)
);
comment on table public.fe_comprobante_versiones is
  'Mig 201. Cada XML distinto (por sha256) recibido para una clave, con la ruta de SU archivo en fe-xml. Más de una fila para un comprobante = alguien mandó otro XML con la misma clave: el comprobante queda «revisar». La escribe SOLO fe_ingestar.';
insert into public.fe_comprobante_versiones (comprobante_id, xml_sha256, xml_path, fuente, lote, recibido_en)
select c.id, c.xml_sha256, c.xml_path, c.fuente, null, c.recibido_en from public.fe_comprobantes c;
-- Desde la 201 la ruta lleva el sha. Las filas rellenadas de la 199 (AAAA/MM/<clave>.xml) quedan como están: NOT VALID
-- (las versiones no se editan nunca). En `fe_comprobantes` NO va la restricción: un NOT VALID se vuelve a mirar en cada
-- UPDATE y frenaría pasar a «revisar» un comprobante viejo; ahí lo cuida fe_ingestar (P0001).
alter table public.fe_comprobante_versiones
  add constraint fe_comprobante_versiones_ruta_sha_chk check (right(xml_path, 69) = '/' || xml_sha256 || '.xml') not valid;

-- ── 3. Respuestas de Hacienda: huella, estado y versiones ────────────────────────────────
alter table public.fe_respuestas
  add column huella text,
  add column estado text not null default 'ok' check (estado in ('ok', 'revisar')),
  add column motivo text;
update public.fe_respuestas
   set huella = encode(sha256(convert_to(concat_ws(chr(31), mensaje, coalesce(detalle, ''), coalesce(receptor_cedula, '')), 'UTF8')), 'hex');
alter table public.fe_respuestas
  alter column huella set not null,
  add constraint fe_respuestas_huella_chk check (huella ~ '^[0-9a-f]{64}$'),
  add constraint fe_respuestas_motivo_chk check (estado = 'ok' or nullif(btrim(motivo), '') is not null);
comment on column public.fe_respuestas.huella is
  'Mig 201. sha256 de mensaje · detalle · cédula del receptor. Otra huella para la misma clave = respuesta en conflicto («revisar»).';

create table public.fe_respuesta_versiones (
  id              bigint      generated always as identity primary key,
  clave           text        not null references public.fe_respuestas (clave),
  huella          text        not null check (huella ~ '^[0-9a-f]{64}$'),
  mensaje         text        not null check (mensaje in ('aceptado', 'parcial', 'rechazado', 'desconocido')),
  detalle         text,
  receptor_cedula text,
  fuente          text        not null,
  lote            text,
  recibido_en     timestamptz not null default now(),
  constraint fe_respuesta_versiones_huella_uq unique (clave, huella)
);
comment on table public.fe_respuesta_versiones is
  'Mig 201. Cada respuesta de Hacienda distinta recibida para una clave. La escribe SOLO fe_respuesta_registrar.';
insert into public.fe_respuesta_versiones (clave, huella, mensaje, detalle, receptor_cedula, fuente, lote, recibido_en)
select r.clave, r.huella, r.mensaje, r.detalle, r.receptor_cedula, r.fuente, null, r.recibido_en from public.fe_respuestas r;

-- ── 4. Emisores conocidos (los carga el owner) ───────────────────────────────────────────
create table public.fe_emisores_conocidos (
  cedula          text        primary key check (cedula ~ '^[0-9A-Za-z]{9,20}$'),
  activo          boolean     not null default true,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid        default auth.uid()
);
comment on table public.fe_emisores_conocidos is
  'Mig 201. Cédulas de emisor que el owner da por conocidas. Un comprobante de un emisor que no está acá (o inactivo) entra a «revisar». No crea proveedores. Sin borrar: activo = false.';
create trigger trg_fe_emisores_conocidos_sello before insert or update on public.fe_emisores_conocidos
  for each row execute function public.fe_receptores_sello();

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────
alter table public.fe_comprobante_versiones enable row level security;
alter table public.fe_respuesta_versiones   enable row level security;
alter table public.fe_emisores_conocidos    enable row level security;

create policy fe_comprobante_versiones_leer on public.fe_comprobante_versiones
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador')
         or ((select public.get_my_role()) = 'manager' and exists (
               select 1 from public.fe_comprobantes c
               where c.id = comprobante_id and c.location_id is not null and public.puede_ver_local(c.location_id))));
create policy fe_respuesta_versiones_leer on public.fe_respuesta_versiones
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador')
         or ((select public.get_my_role()) = 'manager' and exists (
               select 1 from public.fe_comprobantes c
               where c.clave = fe_respuesta_versiones.clave and c.location_id is not null and public.puede_ver_local(c.location_id))));
create policy fe_emisores_conocidos_leer on public.fe_emisores_conocidos
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador'));
create policy fe_emisores_conocidos_alta on public.fe_emisores_conocidos
  for insert to authenticated
  with check ((select public.get_my_role()) = 'owner');
create policy fe_emisores_conocidos_cambio on public.fe_emisores_conocidos
  for update to authenticated
  using ((select public.get_my_role()) = 'owner')
  with check ((select public.get_my_role()) = 'owner');

revoke all on table public.fe_comprobante_versiones, public.fe_respuesta_versiones, public.fe_emisores_conocidos
  from public, anon, authenticated;
grant select on table public.fe_comprobante_versiones, public.fe_respuesta_versiones, public.fe_emisores_conocidos to authenticated;
grant insert (cedula, activo), update (activo) on table public.fe_emisores_conocidos to authenticated;
-- las columnas nuevas de fe_respuestas heredan el revoke de la 199 (solo select para authenticated)

-- ── 5. fe_ingestar: versiones, emisor conocido y ruta con sha ────────────────────────────
-- p = { fuente, lote, estado ('ok'|'revisar'), motivos[], xml_path, xml_sha256, comprobante{…}, lineas[{…}] }
-- Devuelve { resultado: 'nuevo'|'duplicado'|'revisar', id?, location_id?, versiones? }.
create or replace function public.fe_ingestar(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  c         jsonb := p -> 'comprobante';
  v_fuente  text  := p ->> 'fuente';
  v_clave   text  := c ->> 'clave';
  v_sha     text  := p ->> 'xml_sha256';
  v_path    text  := p ->> 'xml_path';
  v_loc     text;
  v_estado  text  := p ->> 'estado';
  v_motivo  text  := nullif(left(array_to_string(array(select jsonb_array_elements_text(coalesce(p -> 'motivos', '[]'::jsonb))), ' · '), 1000), '');
  v_id      uuid;
  v_res     text;
  v_prev    record;
  v_ver     bigint;
  v_n       integer;
  m_version constant text := 'misma clave con otro XML: revisar cuál es el real (quedan todas las versiones)';
  m_resp    constant text := 'respuesta de Hacienda repetida con otro contenido: revisar';
begin
  if v_estado is null or v_estado not in ('ok', 'revisar') then
    raise exception 'fe_ingestar: estado inválido' using errcode = '22023';
  end if;
  if v_fuente is null or v_clave is null then
    raise exception 'fe_ingestar: falta fuente o clave' using errcode = '22023';
  end if;
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'fe_ingestar: falta xml_sha256' using errcode = '22023';
  end if;
  -- 258: la fila apunta al archivo de SU sha. P0001 (no 22/23): la Edge responde 500 y el script reintenta.
  if v_path is null or right(v_path, 69) <> '/' || v_sha || '.xml' then
    raise exception 'fe_ingestar: xml_path no termina en /<xml_sha256>.xml (Edge anterior a la 201)';
  end if;

  -- dos llegadas de la misma clave a la vez: la segunda espera a la primera
  perform pg_advisory_xact_lock(hashtextextended('fe:' || v_clave, 201));

  select x.id, x.location_id into v_prev from public.fe_comprobantes x where x.clave = v_clave for update;
  if found then
    insert into public.fe_comprobante_versiones (comprobante_id, xml_sha256, xml_path, fuente, lote)
    values (v_prev.id, v_sha, v_path, v_fuente, p ->> 'lote')
    on conflict (comprobante_id, xml_sha256) do nothing
    returning id into v_ver;
    if v_ver is null then
      -- mismo XML (mismo sha) otra vez: duplicado de verdad
      insert into public.fe_ingesta_bitacora (fuente, lote, location_id, resultado, clave, motivo)
      values (v_fuente, p ->> 'lote', v_prev.location_id, 'duplicado', v_clave, null);
      return jsonb_build_object('resultado', 'duplicado');
    end if;
    -- 257: otro XML con la misma clave. No se descarta ni se pisa: versión guardada y comprobante a revisar.
    select count(*) into v_n from public.fe_comprobante_versiones v where v.comprobante_id = v_prev.id;
    update public.fe_comprobantes x
       set estado_parseo = case when x.location_id is null then 'receptor_distinto' else 'revisar' end,
           motivo = public.fe_motivo_sumar(x.motivo, m_version)
     where x.id = v_prev.id;
    insert into public.fe_ingesta_bitacora (fuente, lote, location_id, resultado, clave, motivo)
    values (v_fuente, p ->> 'lote', v_prev.location_id, 'revisar', v_clave, m_version || ' (' || v_n || ' versiones)');
    return jsonb_build_object('resultado', 'revisar', 'id', v_prev.id, 'location_id', v_prev.location_id, 'versiones', v_n);
  end if;

  -- comprobante nuevo
  if not exists (select 1 from public.fe_emisores_conocidos e where e.cedula = c ->> 'emisor_cedula' and e.activo) then
    v_estado := 'revisar';
    v_motivo := public.fe_motivo_sumar(v_motivo, case when c ->> 'emisor_cedula' is null then 'sin cédula del emisor'
                                                      else 'emisor no conocido (cédula sin cargar en emisores conocidos)' end);
  end if;
  if exists (select 1 from public.fe_respuestas r where r.clave = v_clave and r.estado = 'revisar') then
    v_estado := 'revisar';
    v_motivo := public.fe_motivo_sumar(v_motivo, m_resp);
  end if;

  select r.location_id into v_loc
  from public.fe_receptores r
  where r.cedula = c ->> 'receptor_cedula' and r.activo;
  if v_loc is null then
    v_estado := 'receptor_distinto';
    v_motivo := public.fe_motivo_sumar(v_motivo, case when c ->> 'receptor_cedula' is null then 'sin cédula del receptor'
                                                      else 'cédula del receptor no configurada' end);
  end if;

  insert into public.fe_comprobantes (
    location_id, clave, tipo, version_xml, consecutivo, fecha_emision, emisor_cedula, emisor_tipo_id, emisor_nombre,
    emisor_nombre_comercial, receptor_cedula, moneda, tipo_cambio, condicion_venta, plazo_credito, medio_pago,
    total_venta_neta, total_impuesto, total_descuentos, total_otros_cargos, total_comprobante,
    ref_tipo_doc, ref_clave, ref_codigo, ref_razon, xml_path, xml_sha256, estado_parseo, motivo, fuente, recibido_en)
  values (
    v_loc, v_clave, c ->> 'tipo', c ->> 'version', c ->> 'consecutivo', (c ->> 'fecha_emision')::timestamptz,
    c ->> 'emisor_cedula', c ->> 'emisor_tipo_id', c ->> 'emisor_nombre', c ->> 'emisor_nombre_comercial',
    c ->> 'receptor_cedula', c ->> 'moneda', coalesce((c ->> 'tipo_cambio')::numeric, 1), c ->> 'condicion_venta',
    c ->> 'plazo_credito', c ->> 'medio_pago', (c ->> 'total_venta_neta')::numeric, (c ->> 'total_impuesto')::numeric,
    (c ->> 'total_descuentos')::numeric, (c ->> 'total_otros_cargos')::numeric, (c ->> 'total_comprobante')::numeric,
    c ->> 'ref_tipo_doc', c ->> 'ref_clave', c ->> 'ref_codigo', c ->> 'ref_razon', v_path, v_sha,
    v_estado, case when v_estado = 'ok' then null else v_motivo end, v_fuente, now())
  returning id into v_id;

  insert into public.fe_comprobante_versiones (comprobante_id, xml_sha256, xml_path, fuente, lote)
  values (v_id, v_sha, v_path, v_fuente, p ->> 'lote');

  insert into public.fe_lineas (
    comprobante_id, numero_linea, cabys, codigo_comercial_tipo, codigo_comercial, detalle, cantidad, unidad,
    unidad_comercial, precio_unitario, monto_total, descuento, subtotal, impuesto_codigo, impuesto_tarifa,
    impuesto_monto, impuesto_neto, total_linea)
  select v_id, (l ->> 'numero_linea')::integer, l ->> 'cabys', l ->> 'codigo_comercial_tipo', l ->> 'codigo_comercial',
         l ->> 'detalle', (l ->> 'cantidad')::numeric, l ->> 'unidad', l ->> 'unidad_comercial',
         (l ->> 'precio_unitario')::numeric, (l ->> 'monto_total')::numeric, (l ->> 'descuento')::numeric,
         (l ->> 'subtotal')::numeric, l ->> 'impuesto_codigo', (l ->> 'impuesto_tarifa')::numeric,
         (l ->> 'impuesto_monto')::numeric, (l ->> 'impuesto_neto')::numeric, (l ->> 'total_linea')::numeric
  from jsonb_array_elements(coalesce(p -> 'lineas', '[]'::jsonb)) l;

  v_res := case when v_estado = 'ok' then 'nuevo' else 'revisar' end;
  insert into public.fe_ingesta_bitacora (fuente, lote, location_id, resultado, clave, motivo)
  values (v_fuente, p ->> 'lote', v_loc, v_res, v_clave, case when v_res = 'revisar' then v_motivo end);
  return jsonb_build_object('resultado', v_res, 'id', v_id, 'location_id', v_loc);
end;
$function$;
revoke all on function public.fe_ingestar(jsonb) from public, anon, authenticated;
grant execute on function public.fe_ingestar(jsonb) to service_role;

-- ── 6. fe_respuesta_registrar: otra respuesta para la misma clave → «revisar» ────────────
-- p = { fuente, lote, respuesta{ clave, mensaje, detalle, receptor_cedula } } → { resultado: 'nuevo'|'duplicado'|'revisar' }
create or replace function public.fe_respuesta_registrar(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  r        jsonb := p -> 'respuesta';
  v_clave  text  := r ->> 'clave';
  v_det    text  := left(r ->> 'detalle', 1000);
  v_huella text;
  v_loc    text;
  v_ver    bigint;
  v_res    text;
  m_resp   constant text := 'respuesta de Hacienda repetida con otro contenido: revisar';
begin
  if p ->> 'fuente' is null or v_clave is null then
    raise exception 'fe_respuesta_registrar: falta fuente o clave' using errcode = '22023';
  end if;
  v_huella := encode(sha256(convert_to(concat_ws(chr(31), r ->> 'mensaje', coalesce(v_det, ''), coalesce(r ->> 'receptor_cedula', '')), 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('fe:' || v_clave, 201));

  if not exists (select 1 from public.fe_respuestas x where x.clave = v_clave) then
    insert into public.fe_respuestas (clave, mensaje, detalle, receptor_cedula, fuente, huella)
    values (v_clave, r ->> 'mensaje', v_det, r ->> 'receptor_cedula', p ->> 'fuente', v_huella);
    insert into public.fe_respuesta_versiones (clave, huella, mensaje, detalle, receptor_cedula, fuente, lote)
    values (v_clave, v_huella, r ->> 'mensaje', v_det, r ->> 'receptor_cedula', p ->> 'fuente', p ->> 'lote');
    v_res := 'nuevo';
  else
    insert into public.fe_respuesta_versiones (clave, huella, mensaje, detalle, receptor_cedula, fuente, lote)
    values (v_clave, v_huella, r ->> 'mensaje', v_det, r ->> 'receptor_cedula', p ->> 'fuente', p ->> 'lote')
    on conflict (clave, huella) do nothing
    returning id into v_ver;
    if v_ver is null then
      v_res := 'duplicado';
    else
      v_res := 'revisar';
      update public.fe_respuestas x set estado = 'revisar', motivo = public.fe_motivo_sumar(x.motivo, m_resp) where x.clave = v_clave;
      update public.fe_comprobantes x
         set estado_parseo = case when x.location_id is null then 'receptor_distinto' else 'revisar' end,
             motivo = public.fe_motivo_sumar(x.motivo, m_resp)
       where x.clave = v_clave;
    end if;
  end if;

  select coalesce((select c.location_id from public.fe_comprobantes c where c.clave = v_clave),
                  (select x.location_id from public.fe_receptores x where x.cedula = r ->> 'receptor_cedula' and x.activo))
    into v_loc;
  insert into public.fe_ingesta_bitacora (fuente, lote, location_id, resultado, clave, motivo)
  values (p ->> 'fuente', p ->> 'lote', v_loc, v_res, v_clave,
          case when v_res = 'revisar' then m_resp || ' (' || coalesce(r ->> 'mensaje', '?') || ')'
               else 'respuesta de Hacienda: ' || coalesce(r ->> 'mensaje', '?') end);
  return jsonb_build_object('resultado', v_res);
end;
$function$;
revoke all on function public.fe_respuesta_registrar(jsonb) from public, anon, authenticated;
grant execute on function public.fe_respuesta_registrar(jsonb) to service_role;

-- ── 7. Pantalla de control: «revisar» también ve versiones y respuestas nuevas ───────────
-- Mismo contrato que la 199 (arreglos por POSICIÓN; los lee src/shared/api/feIngesta.ts). En «revisar» entran:
--   · comprobantes no «ok» creados en el período, o que recibieron una versión o una respuesta nueva en el período;
--   · respuestas en conflicto SIN comprobante, con estado 'respuesta_revisar'.
create or replace function public.fe_ingesta_resumen(p_dias integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rol   text := (select public.get_my_role())::text;
  v_desde timestamptz;
begin
  if v_rol is null or v_rol not in ('owner', 'contador') then
    raise exception 'Solo owner y contador' using errcode = '42501';
  end if;
  v_desde := ((now() at time zone 'America/Costa_Rica')::date - greatest(1, least(coalesce(p_dias, 14), 92)) + 1)::timestamp
             at time zone 'America/Costa_Rica';
  return jsonb_build_object(
    'latidos', coalesce((select jsonb_agg(jsonb_build_array(l.fuente, l.ultimo_en) order by l.fuente)
                         from public.fe_ingesta_latido l), '[]'::jsonb),
    'dias', coalesce((select jsonb_agg(jsonb_build_array(d.dia, d.nuevo, d.duplicado, d.revisar, d.no_comprobante, d.sin_xml, d.error)
                                       order by d.dia desc)
                      from (select (b.ts at time zone 'America/Costa_Rica')::date as dia,
                                   count(*) filter (where b.resultado = 'nuevo')          as nuevo,
                                   count(*) filter (where b.resultado = 'duplicado')      as duplicado,
                                   count(*) filter (where b.resultado = 'revisar')        as revisar,
                                   count(*) filter (where b.resultado = 'no_comprobante') as no_comprobante,
                                   count(*) filter (where b.resultado = 'sin_xml')        as sin_xml,
                                   count(*) filter (where b.resultado = 'error')          as error
                            from public.fe_ingesta_bitacora b
                            where b.ts >= v_desde
                            group by 1) d), '[]'::jsonb),
    'revisar', coalesce((select jsonb_agg(jsonb_build_array(r.estado_parseo, r.motivo, r.n) order by r.n desc, r.estado_parseo, r.motivo)
                         from (select c.estado_parseo, coalesce(c.motivo, '') as motivo, count(*) as n
                               from public.fe_comprobantes c
                               where c.estado_parseo <> 'ok'
                                 and (c.creado_en >= v_desde
                                      or exists (select 1 from public.fe_comprobante_versiones v
                                                 where v.comprobante_id = c.id and v.recibido_en >= v_desde)
                                      or exists (select 1 from public.fe_respuesta_versiones rv
                                                 where rv.clave = c.clave and rv.recibido_en >= v_desde))
                               group by 1, 2
                               union all
                               select 'respuesta_revisar', coalesce(x.motivo, ''), count(*)
                               from public.fe_respuestas x
                               where x.estado = 'revisar'
                                 and not exists (select 1 from public.fe_comprobantes c where c.clave = x.clave)
                                 and exists (select 1 from public.fe_respuesta_versiones rv
                                             where rv.clave = x.clave and rv.recibido_en >= v_desde)
                               group by 2) r), '[]'::jsonb),
    'errores', coalesce((select jsonb_agg(jsonb_build_array(e.ts, e.resultado, e.motivo, e.fin) order by e.ts desc, e.id desc)
                         from (select b.id, b.ts, b.resultado, b.motivo, right(b.clave, 10) as fin
                               from public.fe_ingesta_bitacora b
                               where b.resultado in ('error', 'no_comprobante') and b.ts >= v_desde
                               order by b.ts desc, b.id desc
                               limit 20) e), '[]'::jsonb),
    'ultima', (select max(b.ts) from public.fe_ingesta_bitacora b)
  );
end;
$function$;
revoke all on function public.fe_ingesta_resumen(integer) from public, anon;
grant execute on function public.fe_ingesta_resumen(integer) to authenticated;
