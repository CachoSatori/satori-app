-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 199 · Compras F1: ingesta de XML de factura electrónica (tablas fe_*, bucket fe-xml)  ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- SPEC docs/inventario/SPEC-compras-stock-costos.md §4 (F1), con las respuestas del dueño del 25-nov (§12.1): cada
-- factura se asigna al local por la CÉDULA DEL RECEPTOR (tabla `fe_receptores`, la carga el owner). Entra a prod por
-- merge → Branching, SOLO con la firma del dueño sobre el SHA del PR (docs/pases/PASE-199-fe-ingesta.md).
-- Origen: 142 del bloque club (caja lleno), renumerada al bloque de pase como la 197 y la 198.
--
-- Agrega (no reemplaza nada vivo; no toca `documents`, `cash_movements`, la Bandeja ni la Caja):
--   1. `fe_receptores`        cédula del receptor → local. La edita SOLO el owner (sin borrar: se desactiva).
--   2. `fe_comprobantes`      un comprobante por CLAVE (única: idempotencia). Sin local si el receptor no está en 1.
--   3. `fe_lineas`            sus líneas (CABYS, código comercial, detalle, cantidad, unidad, precio, impuestos).
--   4. `fe_respuestas`        MensajeHacienda por clave (puede llegar antes que la factura).
--   5. `fe_ingesta_bitacora`  qué pasó con cada XML (nuevo / duplicado / revisar / no_comprobante / sin_xml / error),
--                             SIN contenido del correo.
--   6. `fe_ingesta_latido`    última corrida de cada script (una fila por cuenta de correo).
--   7. Bucket privado `fe-xml` (el XML original; solo la Edge con service role).
--   8. Funciones de la Edge (solo service_role): `fe_ingestar`, `fe_respuesta_registrar`, `fe_bitacora_anotar`, `fe_latido`.
--   9. `fe_ingesta_resumen(p_dias)` → jsonb de SOLO LECTURA para la pantalla de control (owner y contador).
--
-- Permisos: nadie escribe 2–6 por la API (solo las funciones de 8, que llama la Edge con service role). Leen owner y
-- contador todo; el manager lee comprobantes, líneas y respuestas de SU local (spec §4.6); bitácora y latido, no.
-- Vuelta atrás: scripts/sql/199_rollback.sql. Pruebas: scripts/sql/199_pruebas.sql (terminan en ROLLBACK).

-- ── 0. Guarda: si algo de esto ya existe, se para sin tocar nada ─────────────────────────
do $guarda199$
declare
  o text;
begin
  if to_regprocedure('public.puede_ver_local(text)') is null or to_regprocedure('public.get_my_role()') is null then
    raise exception '199: falta puede_ver_local (091) o get_my_role';
  end if;
  foreach o in array array['public.fe_receptores', 'public.fe_comprobantes', 'public.fe_lineas', 'public.fe_respuestas',
                           'public.fe_ingesta_bitacora', 'public.fe_ingesta_latido'] loop
    if to_regclass(o) is not null then
      raise exception '199: % ya existe: se para sin tocar nada', o;
    end if;
  end loop;
  foreach o in array array['public.fe_ingestar(jsonb)', 'public.fe_respuesta_registrar(jsonb)',
                           'public.fe_bitacora_anotar(text,text,text,text,text)', 'public.fe_latido(text)',
                           'public.fe_ingesta_resumen(integer)'] loop
    if to_regprocedure(o) is not null then
      raise exception '199: % ya existe: se para sin tocar nada', o;
    end if;
  end loop;
end
$guarda199$;

-- ── 1. Cédula del receptor → local ───────────────────────────────────────────────────────
create table public.fe_receptores (
  cedula          text        primary key check (cedula ~ '^[0-9A-Za-z]{9,20}$'),
  location_id     text        not null references public.locations (id),
  activo          boolean     not null default true,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid        default auth.uid()
);
comment on table public.fe_receptores is
  'Mig 199. Cédula del receptor de las facturas electrónicas → local. La carga el owner (sin borrar: activo = false). Una factura cuyo receptor no está acá (o está inactivo) queda «receptor_distinto», sin local, a revisión.';

-- ── 2. Comprobantes ──────────────────────────────────────────────────────────────────────
create table public.fe_comprobantes (
  id                 uuid        primary key default gen_random_uuid(),
  location_id        text        references public.locations (id),
  clave              text        not null unique check (clave ~ '^[0-9A-Za-z]{50}$'),
  tipo               text        not null check (tipo in ('factura', 'nota_credito', 'nota_debito', 'tiquete', 'factura_compra', 'otro')),
  version_xml        text,
  consecutivo        text,
  fecha_emision      timestamptz,
  emisor_cedula      text,
  emisor_tipo_id     text,
  emisor_nombre      text,
  emisor_nombre_comercial text,
  receptor_cedula    text,
  supplier_id        uuid        references public.suppliers (id),
  moneda             text        not null check (moneda ~ '^[A-Z]{3}$'),
  tipo_cambio        numeric     not null default 1 check (tipo_cambio > 0),
  condicion_venta    text,
  plazo_credito      text,
  medio_pago         text,
  total_venta_neta   numeric,
  total_impuesto     numeric,
  total_descuentos   numeric,
  total_otros_cargos numeric,
  total_comprobante  numeric,
  ref_tipo_doc       text,
  ref_clave          text,
  ref_codigo         text,
  ref_razon          text,
  xml_path           text        not null,
  xml_sha256         text        not null check (xml_sha256 ~ '^[0-9a-f]{64}$'),
  estado_parseo      text        not null check (estado_parseo in ('ok', 'revisar', 'receptor_distinto')),
  motivo             text,
  fuente             text        not null,
  recibido_en        timestamptz not null default now(),
  creado_en          timestamptz not null default now(),
  -- sin local solo si el receptor no se reconoció; con local, nunca «receptor_distinto»
  constraint fe_comprobantes_local_chk check ((location_id is null) = (estado_parseo = 'receptor_distinto')),
  constraint fe_comprobantes_motivo_chk check (estado_parseo = 'ok' or nullif(btrim(motivo), '') is not null)
);
create index fe_comprobantes_local_fecha_idx on public.fe_comprobantes (location_id, fecha_emision);
create index fe_comprobantes_ref_idx on public.fe_comprobantes (ref_clave) where ref_clave is not null;
create index fe_comprobantes_emisor_idx on public.fe_comprobantes (emisor_cedula);
comment on table public.fe_comprobantes is
  'Mig 199. Un comprobante electrónico por clave (idempotencia: el mismo XML diez veces deja una fila). Lo escribe SOLO fe_ingestar (Edge fe-ingesta, service role). supplier_id queda null en F1 (suppliers no tiene cédula todavía; lo resuelve F2).';

-- ── 3. Líneas ────────────────────────────────────────────────────────────────────────────
create table public.fe_lineas (
  comprobante_id        uuid    not null references public.fe_comprobantes (id),
  numero_linea          integer not null check (numero_linea > 0),
  cabys                 text,
  codigo_comercial_tipo text,
  codigo_comercial      text,
  detalle               text,
  cantidad              numeric,
  unidad                text,
  unidad_comercial      text,
  precio_unitario       numeric,
  monto_total           numeric,
  descuento             numeric,
  subtotal              numeric,
  impuesto_codigo       text,
  impuesto_tarifa       numeric,
  impuesto_monto        numeric,
  impuesto_neto         numeric,
  total_linea           numeric,
  primary key (comprobante_id, numero_linea)
);
comment on table public.fe_lineas is 'Mig 199. Líneas de cada comprobante tal cual el XML. Las escribe SOLO fe_ingestar.';

-- ── 4. Respuestas de Hacienda ────────────────────────────────────────────────────────────
create table public.fe_respuestas (
  clave           text        primary key check (clave ~ '^[0-9A-Za-z]{50}$'),
  mensaje         text        not null check (mensaje in ('aceptado', 'parcial', 'rechazado', 'desconocido')),
  detalle         text,
  receptor_cedula text,
  fuente          text        not null,
  recibido_en     timestamptz not null default now()
);
comment on table public.fe_respuestas is
  'Mig 199. MensajeHacienda (aceptado / rechazado) por clave. Puede llegar antes que su comprobante: se une por clave. La primera que llega queda (registro, no edición).';

-- ── 5. Bitácora de la ingesta (sin contenido del correo) ─────────────────────────────────
create table public.fe_ingesta_bitacora (
  id          bigint      generated always as identity primary key,
  ts          timestamptz not null default now(),
  fuente      text        not null,
  lote        text,
  location_id text        references public.locations (id),
  resultado   text        not null check (resultado in ('nuevo', 'duplicado', 'revisar', 'no_comprobante', 'sin_xml', 'error')),
  clave       text,
  motivo      text
);
create index fe_ingesta_bitacora_ts_idx on public.fe_ingesta_bitacora (ts desc);
comment on table public.fe_ingesta_bitacora is
  'Mig 199. Qué pasó con cada XML recibido. Sin cuerpo, remitente, asunto ni nombre de adjunto. La escriben solo las funciones de la Edge.';

-- ── 6. Latido de cada script ─────────────────────────────────────────────────────────────
create table public.fe_ingesta_latido (
  fuente    text        primary key check (fuente ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  ultimo_en timestamptz not null default now()
);
comment on table public.fe_ingesta_latido is
  'Mig 199. Última corrida de cada script de correo (una fila por cuenta). La pantalla de control avisa si pasa de 6 h.';

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────
alter table public.fe_receptores       enable row level security;
alter table public.fe_comprobantes     enable row level security;
alter table public.fe_lineas           enable row level security;
alter table public.fe_respuestas       enable row level security;
alter table public.fe_ingesta_bitacora enable row level security;
alter table public.fe_ingesta_latido   enable row level security;

create policy fe_receptores_leer on public.fe_receptores
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador'));
create policy fe_receptores_alta on public.fe_receptores
  for insert to authenticated
  with check ((select public.get_my_role()) = 'owner');
create policy fe_receptores_cambio on public.fe_receptores
  for update to authenticated
  using ((select public.get_my_role()) = 'owner')
  with check ((select public.get_my_role()) = 'owner');

create policy fe_comprobantes_leer on public.fe_comprobantes
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador')
         or ((select public.get_my_role()) = 'manager' and location_id is not null and public.puede_ver_local(location_id)));
create policy fe_lineas_leer on public.fe_lineas
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador')
         or ((select public.get_my_role()) = 'manager' and exists (
               select 1 from public.fe_comprobantes c
               where c.id = comprobante_id and c.location_id is not null and public.puede_ver_local(c.location_id))));
create policy fe_respuestas_leer on public.fe_respuestas
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador')
         or ((select public.get_my_role()) = 'manager' and exists (
               select 1 from public.fe_comprobantes c
               where c.clave = fe_respuestas.clave and c.location_id is not null and public.puede_ver_local(c.location_id))));
create policy fe_ingesta_bitacora_leer on public.fe_ingesta_bitacora
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador'));
create policy fe_ingesta_latido_leer on public.fe_ingesta_latido
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador'));

revoke all on table public.fe_receptores, public.fe_comprobantes, public.fe_lineas, public.fe_respuestas,
                    public.fe_ingesta_bitacora, public.fe_ingesta_latido from public, anon, authenticated;
grant select on table public.fe_receptores, public.fe_comprobantes, public.fe_lineas, public.fe_respuestas,
                      public.fe_ingesta_bitacora, public.fe_ingesta_latido to authenticated;
grant insert (cedula, location_id, activo), update (location_id, activo) on table public.fe_receptores to authenticated;

-- El owner no puede falsear quién ni cuándo cambió un receptor.
create function public.fe_receptores_sello()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end;
$function$;
revoke all on function public.fe_receptores_sello() from public, anon, authenticated;
create trigger trg_fe_receptores_sello before insert or update on public.fe_receptores
  for each row execute function public.fe_receptores_sello();

-- ── 7. Bucket privado del XML original ───────────────────────────────────────────────────
-- Sin políticas en storage.objects para este bucket: nadie lo lee ni lo escribe por la API, solo el service role.
insert into storage.buckets (id, name, public, file_size_limit)
values ('fe-xml', 'fe-xml', false, 1048576)
on conflict (id) do nothing;

-- ── 8. Funciones de la Edge (service_role) ───────────────────────────────────────────────
-- Un comprobante = una llamada = una transacción: cabecera + líneas + bitácora, o nada.
-- p = { fuente, lote, estado ('ok'|'revisar'), motivos[], xml_path, xml_sha256, comprobante{…}, lineas[{…}] }
-- Devuelve { resultado: 'nuevo'|'duplicado'|'revisar', id?, location_id? }.
create function public.fe_ingestar(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  c        jsonb := p -> 'comprobante';
  v_fuente text  := p ->> 'fuente';
  v_clave  text  := c ->> 'clave';
  v_loc    text;
  v_estado text  := p ->> 'estado';
  v_motivo text  := nullif(left(array_to_string(array(select jsonb_array_elements_text(coalesce(p -> 'motivos', '[]'::jsonb))), ' · '), 1000), '');
  v_id     uuid;
  v_res    text;
begin
  if v_estado is null or v_estado not in ('ok', 'revisar') then
    raise exception 'fe_ingestar: estado inválido' using errcode = '22023';
  end if;
  if v_fuente is null or v_clave is null then
    raise exception 'fe_ingestar: falta fuente o clave' using errcode = '22023';
  end if;

  select r.location_id into v_loc
  from public.fe_receptores r
  where r.cedula = c ->> 'receptor_cedula' and r.activo;
  if v_loc is null then
    v_estado := 'receptor_distinto';
    v_motivo := concat_ws(' · ', case when c ->> 'receptor_cedula' is null then 'sin cédula del receptor'
                                      else 'cédula del receptor no configurada' end, v_motivo);
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
    c ->> 'ref_tipo_doc', c ->> 'ref_clave', c ->> 'ref_codigo', c ->> 'ref_razon', p ->> 'xml_path', p ->> 'xml_sha256',
    v_estado, case when v_estado = 'ok' then null else v_motivo end, v_fuente, now())
  on conflict (clave) do nothing
  returning id into v_id;

  if v_id is null then
    insert into public.fe_ingesta_bitacora (fuente, lote, location_id, resultado, clave, motivo)
    select v_fuente, p ->> 'lote', x.location_id, 'duplicado', v_clave,
           case when x.xml_sha256 is distinct from p ->> 'xml_sha256' then 'misma clave con otro XML (queda el primero)' end
    from public.fe_comprobantes x where x.clave = v_clave;
    return jsonb_build_object('resultado', 'duplicado');
  end if;

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

-- p = { fuente, lote, respuesta{ clave, mensaje, detalle, receptor_cedula } } → { resultado: 'nuevo'|'duplicado' }
create function public.fe_respuesta_registrar(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  r       jsonb := p -> 'respuesta';
  v_clave text  := r ->> 'clave';
  v_loc   text;
  v_n     integer;
begin
  if p ->> 'fuente' is null or v_clave is null then
    raise exception 'fe_respuesta_registrar: falta fuente o clave' using errcode = '22023';
  end if;
  insert into public.fe_respuestas (clave, mensaje, detalle, receptor_cedula, fuente)
  values (v_clave, r ->> 'mensaje', left(r ->> 'detalle', 1000), r ->> 'receptor_cedula', p ->> 'fuente')
  on conflict (clave) do nothing;
  get diagnostics v_n = row_count;
  select coalesce((select c.location_id from public.fe_comprobantes c where c.clave = v_clave),
                  (select x.location_id from public.fe_receptores x where x.cedula = r ->> 'receptor_cedula' and x.activo))
    into v_loc;
  insert into public.fe_ingesta_bitacora (fuente, lote, location_id, resultado, clave, motivo)
  values (p ->> 'fuente', p ->> 'lote', v_loc, case when v_n = 1 then 'nuevo' else 'duplicado' end, v_clave,
          'respuesta de Hacienda: ' || coalesce(r ->> 'mensaje', '?'));
  return jsonb_build_object('resultado', case when v_n = 1 then 'nuevo' else 'duplicado' end);
end;
$function$;
revoke all on function public.fe_respuesta_registrar(jsonb) from public, anon, authenticated;
grant execute on function public.fe_respuesta_registrar(jsonb) to service_role;

-- no_comprobante / sin_xml / error (XML ilegible): solo la fila de bitácora.
create function public.fe_bitacora_anotar(p_fuente text, p_lote text, p_resultado text, p_clave text, p_motivo text)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $function$
  insert into public.fe_ingesta_bitacora (fuente, lote, resultado, clave, motivo)
  select p_fuente, p_lote, p_resultado, p_clave, left(p_motivo, 500)
  where p_resultado in ('no_comprobante', 'sin_xml', 'error');
$function$;
revoke all on function public.fe_bitacora_anotar(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.fe_bitacora_anotar(text, text, text, text, text) to service_role;

create function public.fe_latido(p_fuente text)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $function$
  insert into public.fe_ingesta_latido as l (fuente, ultimo_en) values (p_fuente, now())
  on conflict (fuente) do update set ultimo_en = now();
$function$;
revoke all on function public.fe_latido(text) from public, anon, authenticated;
grant execute on function public.fe_latido(text) to service_role;

-- ── 9. Pantalla de control (owner y contador) ────────────────────────────────────────────
-- Devuelve (arreglos por POSICIÓN; los lee src/shared/api/feIngesta.ts):
--   latidos:  [fuente, ultimo_en]
--   dias:     [dia CR, nuevo, duplicado, revisar, no_comprobante, sin_xml, error]   (últimos p_dias, del más nuevo)
--   revisar:  [estado_parseo, motivo, cantidad]                                     (comprobantes a revisar del período)
--   errores:  [ts, resultado, motivo, fin de la clave]                              (últimos 20 error / no_comprobante)
--   ultima:   ts de la última fila de bitácora (cualquier resultado)
create function public.fe_ingesta_resumen(p_dias integer default 14)
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
                               where c.estado_parseo <> 'ok' and c.creado_en >= v_desde
                               group by 1, 2) r), '[]'::jsonb),
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
