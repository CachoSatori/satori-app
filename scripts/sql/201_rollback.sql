-- 201 · vuelta atrás. ANTES: guardar lo que no se puede rehacer (lo cargó una persona o llegó por correo):
--   select * from public.fe_emisores_conocidos order by cedula;
--   select v.*, c.clave from public.fe_comprobante_versiones v join public.fe_comprobantes c on c.id = v.comprobante_id
--    where v.comprobante_id in (select comprobante_id from public.fe_comprobante_versiones group by 1 having count(*) > 1);
--   select * from public.fe_respuesta_versiones where clave in (select clave from public.fe_respuesta_versiones group by 1 having count(*) > 1);
-- Con versiones en conflicto reales NO se borra (satori-migraciones-y-prod §6): se corrige con una migración nueva.
-- Deja las funciones de la Edge y el resumen EXACTOS como en la 199 (copiados de supabase/migrations/199_fe_ingesta.sql;
-- la batería 201 compara su definición antes y después). Los comprobantes que la 201 pasó a «revisar» quedan así (dato).
-- Las filas con ruta nueva (AAAA/MM/<clave>/<sha>.xml) siguen apuntando a su archivo: la 199 no mira la forma de la ruta.
-- OJO: con la Edge de la 201 desplegada y este rollback aplicado, la Edge sigue andando (manda la ruta nueva; la 199 la
-- acepta), pero vuelve «el primero gana». Si la 201 ya está en el ledger de prod, el .sql NO se borra (regla 10).
-- Sin storage.buckets/objects por SQL (Supabase lo frena): los archivos del bucket se quedan.
drop table if exists public.fe_comprobante_versiones;
drop table if exists public.fe_respuesta_versiones;
drop table if exists public.fe_emisores_conocidos;
alter table public.fe_respuestas
  drop constraint if exists fe_respuestas_motivo_chk,
  drop constraint if exists fe_respuestas_huella_chk,
  drop column if exists huella,
  drop column if exists estado,
  drop column if exists motivo;

-- ── funciones de la 199, tal cual ──
create or replace function public.fe_ingestar(p jsonb)
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

create or replace function public.fe_respuesta_registrar(p jsonb)
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

drop function if exists public.fe_motivo_sumar(text, text);
