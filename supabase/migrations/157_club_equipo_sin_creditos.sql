-- 157 · club_equipo_sin_creditos (origen 104, bloque CLUB → PASE por la regla 3: prod va por la 155 y la 156 es del
-- PR #174, sin mergear). Firma del dueño (14-nov): D7 A y saldos = A (congelar). SPEC-club-v2 §2 ítems #1 y #2, PR 1A.
--
-- Qué hace
--   · El tipo «equipo» sigue con QR y cupones y registra personas a su nombre, pero NO genera código de canje (portal ni
--     pase), NO se le aplica canje (con código ni «sin celular»), NO entra al vencimiento y NO cuenta en el pasivo ni en la
--     antigüedad del reporte. Su portal y su pase muestran personas registradas, sin créditos ni «Canjear». En caja, la
--     ficha dice `sin_creditos` y no se ofrece canje.
--   · Saldos que ya existen: CONGELADOS. No se escribe ningún movimiento. Se guarda en club_auditoria (solo inserción) una
--     foto por cuenta del equipo (accion 'equipo_corte', motivo 'd7_congelar': personas, créditos y valor del crédito al
--     corte; sin nombres). Cada vez que una cuenta entra o sale del equipo, un trigger deja otra foto con su hora.
--   · El saldo congelado no revive: lo canjeable de una cuenta es la suma de sus movimientos registrados DESPUÉS del último
--     corte (club_saldo_canjeable). Si alguien del equipo pasa a referente, empieza de cero; lo de antes queda en el libro,
--     intacto, y en el reporte como «saldo congelado, fuera del pasivo».
--   · club_reporte_equipo: ranking del equipo por persona y mes (cupones usados, personas, mesas, facturas, venta
--     respaldada y altas de socios que trajo). Solo owner y manager; deja rastro.
--
-- Funciones: copia exacta de la vigente en prod (md5 del cuerpo igual al de prod y staging, leído el 14-nov) + el cambio.
-- create or replace conserva dueño y permisos (security definer, search_path y grants iguales). Las nuevas: revoke de
-- public y anon (y de authenticated si son internas).
-- La baja (club_miembro_guardar) vence solo lo canjeable; club_ajuste topa contra lo canjeable; club_alertas_pendientes
-- (el «le quedan» del pase) muestra lo canjeable.
-- club_canje_aprobado y club_canje_codigo_generar_pase NO cambian: llaman a club_canje_aplicar y a club_canje_codigo_generar,
-- que tienen la guarda.
-- Rollback: scripts/sql/157_rollback.sql (las fotos de club_auditoria quedan: es de solo inserción).

begin;

-- ── 1. Corte del equipo y saldo canjeable (internas) ─────────────────────────────────────────────────────────────
-- Hora del último corte de la cuenta (entró o salió del equipo, o la foto del 14-nov). null = nunca fue del equipo.
create or replace function public.club_corte_equipo(p_miembro uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select max(a.en) from public.club_auditoria a where a.objeto_id = p_miembro and a.accion = 'equipo_corte'
$$;

-- Personas canjeables: 0 en el equipo; si la cuenta tuvo un corte, solo lo registrado después (el saldo congelado no
-- revive); si no, el saldo de siempre. Nunca negativo.
create or replace function public.club_saldo_canjeable(p_miembro uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when m.tipo = 'equipo' then 0
              else greatest(coalesce((select sum(mv.personas) from public.club_movimientos mv
                                       where mv.miembro_id = m.id and (k.corte is null or mv.registrado_en > k.corte)), 0), 0)::int
         end
    from public.club_miembros m
    cross join lateral (select public.club_corte_equipo(m.id) as corte) k
   where m.id = p_miembro
$$;

revoke all on function public.club_corte_equipo(uuid)    from public, anon, authenticated;
revoke all on function public.club_saldo_canjeable(uuid) from public, anon, authenticated;

-- Entrar o salir del equipo deja un corte con la foto del saldo (quién, cuándo, de qué tipo a qué tipo; sin nombres).
create or replace function public.club_equipo_corte_trg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_cfg public.club_config%rowtype; v_p int;
begin
  if (old.tipo = 'equipo') is distinct from (new.tipo = 'equipo') then
    select * into v_cfg from public.club_config c where c.location_id = new.location_id;
    v_p := public.club_saldo_personas(new.id);
    perform public.club_auditar('equipo_corte', 'club_miembros', new.id, jsonb_build_object('tipo', old.tipo),
      jsonb_build_object('motivo', case when new.tipo = 'equipo' then 'entra_al_equipo' else 'sale_del_equipo' end,
                         'tipo', new.tipo, 'personas', v_p,
                         'creditos', public.club_creditos(greatest(v_p, 0), v_cfg.personas_por_credito),
                         'personas_por_credito', v_cfg.personas_por_credito, 'valor_credito_crc', v_cfg.valor_credito_crc));
  end if;
  return null;
end;
$$;
revoke all on function public.club_equipo_corte_trg() from public, anon, authenticated;
drop trigger if exists club_equipo_corte_trg on public.club_miembros;
create trigger club_equipo_corte_trg after update of tipo on public.club_miembros
  for each row when (old.tipo is distinct from new.tipo) execute function public.club_equipo_corte_trg();

-- ── 2. Foto del corte (saldos = A, congelar): una fila por cuenta del equipo, sin movimientos ──────────────────────
insert into public.club_auditoria (actor, rol, accion, tabla, objeto_id, antes, despues)
select null, null, 'equipo_corte', 'club_miembros', m.id, null,
       jsonb_build_object('motivo', 'd7_congelar', 'tipo', m.tipo, 'estado', m.estado, 'personas', s.p,
                          'creditos', public.club_creditos(greatest(s.p, 0), c.personas_por_credito),
                          'personas_por_credito', c.personas_por_credito, 'valor_credito_crc', c.valor_credito_crc)
  from public.club_miembros m
  left join public.club_config c on c.location_id = m.location_id
  cross join lateral (select public.club_saldo_personas(m.id) as p) s
 where m.tipo = 'equipo'
   and not exists (select 1 from public.club_auditoria a
                    where a.objeto_id = m.id and a.accion = 'equipo_corte' and a.despues->>'motivo' = 'd7_congelar');

-- ── 3. Funciones vigentes + el cambio ────────────────────────────────────────────────────────────────────────────
create or replace function public.club_canje_codigo_generar(p_token text)
returns table (codigo text, vence_en timestamptz, url text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_tok   text := lower(btrim(coalesce(p_token, '')));
  v_id    uuid;
  v_m     public.club_miembros%rowtype;
  v_cfg   public.club_config%rowtype;
  v_cod   text;
  v_vence timestamptz := now() + interval '10 minutes';
  i       int;
begin
  if not public.club_web_ok() then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  if v_tok !~ '^[0-9a-f]{64}$' then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  select m.id into v_id from public.club_miembros m
   where m.token_portal = v_tok and m.estado = 'activo' and m.tipo in ('referente','concierge_pm','equipo');
  if v_id is null then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  perform 1 from public.club_codigos_canje k
    where k.miembro_id = v_id and k.usado_en is null and k.invalidado_en is null for update;
  select * into v_m from public.club_miembros m where m.id = v_id and m.estado = 'activo' for update;
  if not found then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  if found then perform public.club_local(v_m.location_id, true); end if;   -- LC-ML
  -- D7 A (firma del dueño, 14-nov; mig 157): el equipo registra personas pero no canjea créditos.
  if v_m.tipo = 'equipo' then
    raise exception 'Las cuentas del equipo no canjean créditos' using errcode = 'P0001';
  end if;
  select * into v_cfg from public.club_config c where c.location_id = v_m.location_id;
  if public.club_saldo_canjeable(v_m.id) < v_cfg.canje_min * v_cfg.personas_por_credito then
    raise exception 'Todavía no te alcanza para canjear' using errcode = 'P0001';
  end if;
  if (select count(*) from public.club_codigos_canje k
       where k.miembro_id = v_m.id and k.creado_en > now() - interval '1 hour') >= 5 then
    raise exception 'Demasiados códigos de canje' using errcode = 'P0001';
  end if;

  update public.club_codigos_canje k set invalidado_en = now()
   where k.miembro_id = v_m.id and k.usado_en is null and k.invalidado_en is null;
  for i in 1 .. 5 loop
    v_cod := public.club_gen_codigo(6);
    begin
      insert into public.club_codigos_canje (location_id, miembro_id, codigo_hash, vence_en)
      values (v_m.location_id, v_m.id, public.club_codigo_hash(v_cod), v_vence);
      codigo := v_cod; vence_en := v_vence; url := public.club_url() || '/k/' || v_cod;
      return next; return;
    exception when unique_violation then
      null;   -- choque de hash (muy raro): otro intento
    end;
  end loop;
  raise exception 'No se pudo generar el código' using errcode = 'P0001';
end;
$$;

create or replace function public.club_canje_aplicar(p_miembro uuid, p_codigo text, p_creditos numeric, p_factura text,
                                                     p_op uuid, p_pos jsonb, p_nota text)
returns table (personas int, creditos numeric, movimiento uuid, error text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_fac      text := public.club_norm_factura(p_factura);
  v_hash     text;
  v_pos      jsonb;
  v_sin_pos  boolean := p_pos is null or p_pos = '{}'::jsonb or jsonb_typeof(p_pos) = 'null';
  v_visita   text;
  v_m        public.club_miembros%rowtype;
  v_k        public.club_codigos_canje%rowtype;
  v_cfg      public.club_config%rowtype;
  v_prev     public.club_movimientos%rowtype;
  v_mov      uuid;
  v_saldo    int;
  v_necesita numeric;
  v_ya_fac   numeric;
  v_ya_dia   numeric;
  v_hoy      timestamptz;
  v_motivo   text;
begin
  if p_op is null then
    raise exception 'Falta el id de la operación: cerrá la cuenta en pantalla y escaneá de nuevo' using errcode = 'P0001';
  end if;

  -- 1. op
  perform pg_advisory_xact_lock(hashtextextended('club_op:' || p_op::text, 0));   -- CLUB-AUD-08
  select * into v_prev from public.club_movimientos where client_op_id = p_op;
  if found then
    if v_prev.tipo <> 'canje' or v_prev.miembro_id is distinct from p_miembro then
      raise exception 'Esta operación ya se usó para otro registro: cerrá la cuenta en pantalla y escaneá de nuevo' using errcode = 'P0001';
    end if;
    select * into v_cfg from public.club_config where location_id = v_prev.location_id;
    v_saldo := public.club_saldo_canjeable(p_miembro);   -- D7 A (mig 157)
    personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito); movimiento := v_prev.id;
    return next; return;
  end if;

  -- 2. código (R-01): vigente, del mismo miembro, sin usar. Se bloquea la fila hasta el commit.
  if p_nota is null then
    -- CLUB-AUD-38: contar y anotar el intento bajo un lock por actor y por miembro; sin él, N cajas a la vez
    -- cuentan «4» y anotan todas, y el tope de 5 se pasa. Orden: op → intentos (actor, miembro) → código → miembro.
    perform pg_advisory_xact_lock(hashtextextended('club_intentos_actor:' || coalesce(auth.uid()::text, '-'), 0));
    perform pg_advisory_xact_lock(hashtextextended('club_intentos_miembro:' || p_miembro::text, 0));
    if public.club_canje_bloqueado(auth.uid(), p_miembro) then
      raise exception 'Demasiados códigos equivocados: esperá 15 minutos o pedile al manager un canje sin celular'
        using errcode = 'P0001';
    end if;
    v_hash := public.club_codigo_hash(p_codigo);
    if upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g')) !~ '^[A-HJ-NP-Z2-9]{6}$' then
      v_motivo := 'Falta el código de canje: pedile al referente que lo genere en su portal';
    else
      select * into v_k from public.club_codigos_canje k where k.codigo_hash = v_hash for update;
      v_motivo := case
        when not found or v_k.miembro_id <> p_miembro then 'Código de canje no válido: pedile al referente el código de su portal'
        when v_k.usado_en is not null then 'Este código de canje ya se usó: pedile uno nuevo'
        when v_k.invalidado_en is not null then 'Este código de canje fue reemplazado por uno más nuevo: escaneá el último que generó'
        when v_k.vence_en <= now() then 'El código de canje venció: pedile uno nuevo'
      end;
    end if;
    if v_motivo is not null then
      insert into public.club_canje_intentos (actor, miembro_id, motivo) values (auth.uid(), p_miembro, v_motivo);
      error := v_motivo;
      return next; return;
    end if;
  end if;

  -- 3. miembro: serializa canjes simultáneos del mismo miembro.
  select * into v_m from public.club_miembros m where m.id = p_miembro for update;
  if not found then
    raise exception 'No se encontró la cuenta del referente: escaneá de nuevo o buscalo por nombre' using errcode = 'P0001';
  end if;
  if v_m.estado <> 'activo' then
    raise exception 'El referente está dado de baja: seguí con la cuenta sin canje' using errcode = 'P0001';
  end if;
  -- D7 A (firma del dueño, 14-nov; mig 157): el equipo no canjea, ni con código ni «sin celular».
  if v_m.tipo = 'equipo' then
    raise exception 'Es del equipo: las cuentas del equipo no canjean créditos. Seguí con la cuenta sin canje' using errcode = 'P0001';
  end if;
  select * into v_cfg from public.club_config where location_id = v_m.location_id;

  if p_creditos is null
     or p_creditos < v_cfg.canje_min
     or p_creditos > v_cfg.max_creditos_por_visita
     or mod(p_creditos, v_cfg.canje_paso) <> 0 then
    raise exception 'Créditos no válidos: de % a %, de a %. Elegí uno de los botones',
      public.club_num(v_cfg.canje_min), public.club_num(v_cfg.max_creditos_por_visita), public.club_num(v_cfg.canje_paso) using errcode = 'P0001';
  end if;
  if v_sin_pos and (v_fac = '' or length(v_fac) > 40) then
    raise exception 'Falta el pedido o la factura: elegí el pedido de la lista' using errcode = 'P0001';
  end if;
  perform public.club_local(v_m.location_id, true);   -- LC-ML: Club activo en el local del miembro
  v_pos := public.club_pos_ref(p_pos, v_m.location_id);   -- CLUB-AUD-18: local del miembro
  v_visita := coalesce(v_pos->>'visita', public.club_visita_canonica(v_m.location_id, null, v_fac));

  v_necesita := p_creditos * v_cfg.personas_por_credito;
  if v_necesita <> trunc(v_necesita) then
    raise exception 'Créditos no válidos para esta configuración: elegí uno de los botones' using errcode = 'P0001';
  end if;

  -- Máximo por visita: suma de canjes del miembro con la misma visita.
  select coalesce(sum(mv.creditos), 0) into v_ya_fac from public.club_movimientos mv
   where mv.miembro_id = p_miembro and mv.tipo = 'canje' and coalesce(mv.visita_clave, mv.factura_pos) = v_visita;
  if v_ya_fac + p_creditos > v_cfg.max_creditos_por_visita then
    raise exception 'Supera el máximo de % créditos por visita: elegí menos créditos (el resto, en otra visita)', public.club_num(v_cfg.max_creditos_por_visita)
      using errcode = 'P0001';
  end if;

  -- Tope por día (hora CR): suma de créditos canjeados hoy por el miembro, con cualquier factura.
  v_hoy := date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica';
  select coalesce(sum(mv.creditos), 0) into v_ya_dia from public.club_movimientos mv
   where mv.miembro_id = p_miembro and mv.tipo = 'canje' and mv.fecha_visita >= v_hoy;
  if v_ya_dia + p_creditos > v_cfg.max_creditos_por_visita then
    raise exception 'Supera el máximo de % créditos por día: el resto lo puede canjear mañana', public.club_num(v_cfg.max_creditos_por_visita)
      using errcode = 'P0001';
  end if;

  v_saldo := public.club_saldo_canjeable(p_miembro);   -- D7 A (mig 157): sin el saldo congelado
  if v_saldo < v_necesita then
    raise exception 'Saldo insuficiente: elegí menos créditos o cobrá la cuenta sin canje' using errcode = 'P0001';
  end if;

  insert into public.club_movimientos
    (location_id, miembro_id, tipo, personas, creditos, personas_por_credito, valor_credito_crc,
     factura_pos, fecha_visita, registrado_por, origen, client_op_id, pos_ref, visita_clave, nota)
  values
    (v_m.location_id, p_miembro, 'canje', -v_necesita::int, p_creditos, v_cfg.personas_por_credito,
     v_cfg.valor_credito_crc, nullif(v_fac, ''), now(), auth.uid(), 'app', p_op, v_pos, v_visita,
     case when p_nota is not null then 'Canje aprobado sin código: ' || p_nota end)
  returning id into v_mov;
  -- LC-A4 regla fija: si hay visita de socio en este pedido, queda marcada (pagada con créditos = sin descuento; A5 la cruza).
  update public.club_visitas_socio set con_canje = true where visita_clave = v_visita and not con_canje;

  if p_nota is null then
    update public.club_codigos_canje set usado_en = now(), usado_por = auth.uid(), movimiento_id = v_mov
     where id = v_k.id;
  end if;
  insert into public.club_alertas (location_id, tipo, miembro_id, movimiento_id) values (v_m.location_id, 'canje', p_miembro, v_mov);

  v_saldo := v_saldo - v_necesita::int;
  personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito); movimiento := v_mov;
  return next;
end;
$$;

create or replace function public.club_canje_aviso(p_movimiento uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_mv  public.club_movimientos%rowtype;
  v_tel text;
  v_nom text;
  v_cfg public.club_config%rowtype;
  v_txt text;
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into v_mv from public.club_movimientos where id = p_movimiento and tipo = 'canje';
  if not found or (v_rol = 'cajero' and (v_mv.registrado_por is distinct from auth.uid() or v_mv.registrado_en < now() - interval '15 minutes')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select c.telefono into v_tel from public.club_miembros_contacto c where c.miembro_id = v_mv.miembro_id;
  if v_tel is null then return null; end if;
  -- (09-nov, B3) mostrar el teléfono deja rastro, como cualquier lectura de datos personales (LC-PRIV): quién, cuándo y
  -- de qué canje; sin el teléfono.
  perform public.club_auditar('ver_telefono_canje', 'club_movimientos', p_movimiento, null,
                              jsonb_build_object('miembro', v_mv.miembro_id, 'local', v_mv.location_id));
  select public.club_nombre_pila(m.nombre) into v_nom from public.club_miembros m where m.id = v_mv.miembro_id;
  select * into v_cfg from public.club_config where location_id = v_mv.location_id;
  -- (Ismael, 08-nov noche) el vencimiento, con el mismo texto que los mensajes, el portal y las guías: se cuenta desde la
  -- última actividad (SPEC §5.1 y club_vencer).
  v_txt := format('Hola %s: en Satori se canjearon %s %s de tu cuenta el %s. Te quedan %s. Los créditos vencen a los %s meses sin actividad: cada persona que llega con tu cupón o cada canje vuelve a contar los %s meses. Si no fuiste vos, avisanos por acá.',
                  coalesce(v_nom, ''), public.club_num(v_mv.creditos), case when v_mv.creditos = 1 then 'crédito' else 'créditos' end,
                  to_char(v_mv.fecha_visita at time zone 'America/Costa_Rica', 'DD/MM HH24:MI'),
                  public.club_num(public.club_creditos(public.club_saldo_canjeable(v_mv.miembro_id), v_cfg.personas_por_credito)),
                  v_cfg.vencimiento_meses, v_cfg.vencimiento_meses);
  update public.club_alertas set canal = 'wa.me (link mostrado en caja)' where movimiento_id = p_movimiento and canal is null;
  return jsonb_build_object('tel', ltrim(v_tel, '+'), 'texto', v_txt);   -- la app arma https://wa.me/<tel>?text=…
end;
$$;

create or replace function public.club_portal(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tok   text := lower(btrim(coalesce(p_token, '')));
  v_m     public.club_miembros%rowtype;
  v_cfg   public.club_config%rowtype;
  v_saldo int;
  v_movs  jsonb;
  v_eq    boolean;       -- D7 A (mig 157)
  v_corte timestamptz;
  v_mes   timestamptz := date_trunc('month', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica';
begin
  if not public.club_web_ok() then   -- CLUB-AUD-06: solo por club-web
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  if v_tok !~ '^[0-9a-f]{64}$' then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  select * into v_m from public.club_miembros m where m.token_portal = v_tok and m.estado = 'activo';
  if not found then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  select * into v_cfg from public.club_config where location_id = v_m.location_id;
  -- D7 A (firma del dueño, 14-nov; mig 157): el equipo ve personas registradas, no créditos; quien salió del equipo ve solo lo de después del corte.
  v_eq := v_m.tipo = 'equipo';
  v_corte := public.club_corte_equipo(v_m.id);
  v_saldo := coalesce(public.club_saldo_canjeable(v_m.id), 0);

  select coalesce(jsonb_agg(x order by x.fecha desc), '[]'::jsonb) into v_movs
  from (
    select mv.tipo, mv.personas, mv.creditos, mv.fecha_visita as fecha
    from public.club_movimientos mv
    where mv.miembro_id = v_m.id
      and case when v_eq then mv.tipo = 'tarjeta' else (v_corte is null or mv.registrado_en > v_corte) end
    order by mv.fecha_visita desc
    limit 10
  ) x;

  return jsonb_build_object(
    'nombre',                   v_m.nombre,
    'codigo',                   v_m.codigo,
    'personas',                 v_saldo,
    'creditos',                 public.club_creditos(v_saldo, v_cfg.personas_por_credito),
    'valor_credito_crc',        v_cfg.valor_credito_crc,   -- (08-nov) el portal muestra créditos y colones juntos, como el pase
    'personas_proximo_credito', public.club_personas_proximo(v_saldo, v_cfg.personas_por_credito),
    'vencimiento_meses',        case when not v_eq then v_cfg.vencimiento_meses end,   -- (08-nov noche) «vencen a los N meses sin actividad»
    'movimientos',              v_movs,
    -- D7 A (mig 157): cuenta del equipo → personas registradas (total y del mes), sin créditos ni «Canjear»
    'equipo',                   v_eq,
    'personas_registradas',     case when v_eq then (select coalesce(sum(mv.personas), 0) from public.club_movimientos mv
                                                       where mv.miembro_id = v_m.id and mv.tipo = 'tarjeta') end,
    'personas_registradas_mes', case when v_eq then (select coalesce(sum(mv.personas), 0) from public.club_movimientos mv
                                                       where mv.miembro_id = v_m.id and mv.tipo = 'tarjeta' and mv.fecha_visita >= v_mes) end,
    -- LC-A2: el portal sirve también al socio (estado y link de baja del aviso de privacidad)
    'anfitrion',                exists (select 1 from public.club_miembro_roles r where r.miembro_id = v_m.id and r.rol <> 'socio' and r.estado = 'activo'),
    -- A4.5: la pestaña «Mi Club» del portal (los mismos datos del pase, sin contactos)
    'socio',                    (select jsonb_build_object('estado', r.estado, 'desde', r.desde, 'codigo_socio', v_m.codigo_socio,
                                          'beneficio', ps->'socio'->'beneficio', 'visitas_mes', ps->'socio'->'visitas_mes',
                                          'cortesias', ps->'socio'->'cortesias', 'promociones', ps->'promociones')
                                   from public.club_miembro_roles r
                                   cross join lateral (select public.club_pase_datos(v_m.id) as ps) x
                                  where r.miembro_id = v_m.id and r.rol = 'socio' and r.estado <> 'baja')
  );
end;
$$;

create or replace function public.club_pase_datos(p_miembro uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_m     public.club_miembros%rowtype;
  v_cfg   public.club_config%rowtype;
  v_anf   public.club_miembro_roles%rowtype;
  v_soc   public.club_miembro_roles%rowtype;
  v_saldo int;
  v_ver   bigint;
  v_mes   timestamptz := date_trunc('month', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica';
  v_base  text := public.club_url();   -- (08-nov noche) el dominio sale de la configuración
  j_anf   jsonb;
  j_soc   jsonb;
  j_prom  jsonb := '[]'::jsonb;
  v_roles text[] := '{}';
  v_pben  text;          -- beneficio de la promo vigente del socio (A3)
  v_pcor  int;
  v_pest  text[] := '{}';
begin
  select * into v_m from public.club_miembros where id = p_miembro;
  if not found then return null; end if;
  select * into v_cfg from public.club_config where location_id = v_m.location_id;
  select * into v_anf from public.club_miembro_roles where miembro_id = p_miembro and rol <> 'socio';
  select * into v_soc from public.club_miembro_roles where miembro_id = p_miembro and rol = 'socio';
  select coalesce(max(e.id), 0) into v_ver from public.club_pase_eventos e where e.miembro_id = p_miembro or e.miembro_id is null;

  -- A3: roles para las promociones (el socio pendiente no tiene beneficio todavía).
  if v_soc.miembro_id is not null and v_soc.estado = 'activo' then v_roles := v_roles || 'socio'::text; end if;
  if v_anf.miembro_id is not null and v_anf.estado = 'activo' then v_roles := v_roles || 'referente'::text; end if;
  if cardinality(v_roles) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'nombre', p.nombre, 'nombre_en', p.nombre_en, 'beneficio', public.club_promo_beneficio(p),
             'para', to_jsonb(p.para), 'vigente_hasta', p.hasta, 'dias', to_jsonb(p.dias),
             'horario', case when p.hora_desde is not null then jsonb_build_object('desde', to_char(p.hora_desde, 'HH24:MI'), 'hasta', to_char(p.hora_hasta, 'HH24:MI')) end)
             order by p.porcentaje desc, p.cortesias desc, p.nombre), '[]'::jsonb)
      into j_prom from public.club_promociones_vigentes(v_m.location_id, now(), v_roles) p;
  end if;
  if v_soc.miembro_id is not null and v_soc.estado in ('pendiente','activo') then
    v_pest := v_pest || 'mi_club'::text;
    select public.club_promo_beneficio(p), p.cortesias into v_pben, v_pcor
      from public.club_promociones_vigentes(v_m.location_id, now(), array['socio']) p limit 1;
    j_soc := jsonb_build_object(
      'estado', v_soc.estado, 'desde', (v_soc.desde at time zone 'America/Costa_Rica')::date,
      'qr_url', v_base || '/s/' || v_m.codigo_socio,
      -- Club compartido (08-nov): el beneficio del socio vale en todos los locales encendidos: texto GENÉRICO, no la promo de un local
      'beneficio', case when v_soc.estado = 'activo' then 'Vale en todos los Satori' end,
      'visitas_mes', (select count(*) from public.club_visitas_socio vs where vs.miembro_id = v_m.id
                        and vs.fecha >= date_trunc('month', now() at time zone 'America/Costa_Rica')::date),
      -- Cortesía SORPRESA (se sortea en caja): solo si es activo, la promo la da y hay cortesías activas; más los premios
      -- por referir disponibles (A4.3), cada uno con su vencimiento.
      'cortesias', case when v_soc.estado = 'activo' then
                     (case when coalesce(v_pcor, 0) > 0
                            and exists (select 1 from public.club_cortesias c where c.location_id = v_m.location_id and c.activa)
                           then jsonb_build_array(jsonb_build_object('sorpresa', true, 'cantidad', v_pcor, 'motivo', 'promo', 'vence_en', null))
                           else '[]'::jsonb end)
                     || coalesce((select jsonb_agg(jsonb_build_object('sorpresa', true, 'cantidad', 1, 'motivo', 'premio_referido',
                                                                     'vence_en', (p.vence_en at time zone 'America/Costa_Rica')::date) order by p.vence_en)
                                    from public.club_premios p where p.beneficiario = v_m.id and p.estado = 'disponible' and p.vence_en > now()), '[]'::jsonb)
                   else '[]'::jsonb end);
  end if;
  if v_anf.miembro_id is not null and v_anf.estado = 'activo' then
    v_pest := v_pest || 'anfitrion'::text;
    -- D7 A (firma del dueño, 14-nov; mig 157): el equipo no tiene créditos (con_creditos = false, saldo 0, sin «Canjear»).
    v_saldo := coalesce(public.club_saldo_canjeable(v_m.id), 0);
    j_anf := jsonb_build_object(
      'activo', true, 'tipo', v_anf.rol, 'codigo_publico', v_m.codigo,
      'qr_url', v_base || '/r/' || v_m.codigo,
      'personas', v_saldo,
      'creditos', public.club_creditos(v_saldo, v_cfg.personas_por_credito),
      'personas_proximo_medio', public.club_personas_proximo(v_saldo, v_cfg.personas_por_credito),
      'valor_credito_crc', v_cfg.valor_credito_crc,
      'con_creditos', v_m.tipo <> 'equipo',
      'referidos_mes', (select coalesce(sum(mv.personas), 0) from public.club_movimientos mv
                         where mv.miembro_id = v_m.id and mv.tipo = 'tarjeta' and mv.fecha_visita >= v_mes),
      'creditos_ganados_mes', case when v_m.tipo = 'equipo' then 0 else public.club_creditos((select coalesce(sum(mv.personas), 0) from public.club_movimientos mv
                         where mv.miembro_id = v_m.id and mv.tipo = 'tarjeta' and mv.fecha_visita >= v_mes), v_cfg.personas_por_credito) end);
  end if;

  return jsonb_build_object(
    'contrato', 1,
    'miembro_id', v_m.id,
    'version', v_ver,
    'actualizado_en', now(),
    'nombre_pila', public.club_nombre_pila(v_m.nombre),
    'estado', v_m.estado,
    'local', jsonb_build_object('id', v_m.location_id, 'nombre', coalesce(v_cfg.nombre, v_m.location_id)),   -- LC-ML: dato, no texto fijo
    'pestanas', to_jsonb(v_pest),
    'codigo_barras', case when j_soc is not null then jsonb_build_object('tipo', 'socio', 'valor', j_soc->>'qr_url')
                          when j_anf is not null then jsonb_build_object('tipo', 'cupones', 'valor', j_anf->>'qr_url') end,
    'socio', j_soc,
    'anfitrion', j_anf,
    'promociones', j_prom,   -- A3: vigentes hoy para sus roles activos
    -- CLUB-AUD-69: el pase lleva el token de PASE (propio, revocable), nunca el del portal
    'canjear_url', case when j_anf is not null and v_m.token_pase is not null and v_m.tipo <> 'equipo' then v_base || '/w/' || v_m.token_pase end);
end;
$$;

create or replace function public.club_vencer_candidatos(p_corte date)
returns table (miembro_id uuid, location_id text, personas int, creditos numeric, ultima_actividad timestamptz,
               personas_por_credito int, valor_credito_crc int, vencimiento_meses int, limite timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- D7 A (mig 157): el equipo no vence (no tiene créditos); quien salió del equipo vence solo lo de después del corte,
  -- y su plazo corre desde la última actividad posterior al corte (o desde el corte). Para el resto, igual que antes.
  select m.id, m.location_id, s.personas, public.club_creditos(s.personas, c.personas_por_credito), s.ultima_actividad,
         c.personas_por_credito, c.valor_credito_crc, c.vencimiento_meses,
         ((p_corte - make_interval(months => c.vencimiento_meses))::timestamp at time zone 'America/Costa_Rica')
    from public.club_miembros m
    join public.club_config c on c.location_id = m.location_id
    cross join lateral (select public.club_corte_equipo(m.id) as corte) k
    cross join lateral (
      select public.club_saldo_canjeable(m.id) as personas,
             max(mv.fecha_visita) filter (where mv.tipo in ('tarjeta','canje','restitucion')) as ultima_actividad
        from public.club_movimientos mv
       where mv.miembro_id = m.id and (k.corte is null or mv.registrado_en > k.corte)) s
   where m.tipo <> 'equipo'
     and s.personas > 0
     and coalesce(s.ultima_actividad, k.corte, m.created_at)
         < ((p_corte - make_interval(months => c.vencimiento_meses))::timestamp at time zone 'America/Costa_Rica')
   order by m.id;
$$;

create or replace function public.club_vencer(p_corte date, p_confirmo_total int)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol    public.user_role := public.get_my_role();
  v_n      int := 0;
  v_total  int;
  r        record;
  v_p      int;
  v_ult    timestamptz;
  v_creado timestamptz;
  v_tipo   text;          -- D7 A (mig 157)
  v_corte  timestamptz;
begin
  if v_rol is null or v_rol <> 'owner' then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_corte is null or p_corte > (now() at time zone 'America/Costa_Rica')::date then
    raise exception 'Fecha de corte no válida' using errcode = 'P0001';
  end if;
  -- Una sola corrida a la vez (dos owners confirmando a la par).
  perform pg_advisory_xact_lock(hashtextextended('club_vencer', 0));
  select count(*) into v_total from public.club_vencer_candidatos(p_corte);
  if p_confirmo_total is null or p_confirmo_total <> v_total then
    raise exception 'La simulación da % cuentas y confirmaste %: volvé a simular', v_total, coalesce(p_confirmo_total::text, 'ninguna')
      using errcode = 'P0001';
  end if;

  -- CLUB-AUD-03: por cada candidato se bloquea al miembro y recién ahí se recalculan el saldo y la
  -- última actividad (snapshot nuevo). Así un canje o una tarjeta simultáneos no dejan el saldo
  -- negativo ni se vence lo que acaba de tener actividad.
  for r in select * from public.club_vencer_candidatos(p_corte) loop
    select m.created_at, m.tipo into v_creado, v_tipo from public.club_miembros m where m.id = r.miembro_id for update;
    -- D7 A (mig 157): el equipo no vence; quien salió del equipo vence solo lo canjeable (sin el saldo congelado).
    continue when v_tipo = 'equipo';
    v_corte := public.club_corte_equipo(r.miembro_id);
    select max(mv.fecha_visita) filter (where mv.tipo in ('tarjeta','canje','restitucion'))   -- AUD-10
      into v_ult
      from public.club_movimientos mv where mv.miembro_id = r.miembro_id and (v_corte is null or mv.registrado_en > v_corte);
    v_p := public.club_saldo_canjeable(r.miembro_id);
    continue when v_p <= 0 or coalesce(v_ult, v_corte, v_creado) >= r.limite;
    insert into public.club_movimientos
      (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
       fecha_visita, registrado_por, origen, nota)
    values
      (r.location_id, r.miembro_id, 'vencimiento', -v_p, r.personas_por_credito, r.valor_credito_crc,
       now(), auth.uid(), 'app',
       format('Vencimiento automático: %s meses sin actividad al %s', r.vencimiento_meses, p_corte));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.club_referente_json(p_miembro uuid, p_k public.club_codigos_canje, p_codigo text, p_tipo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_m     public.club_miembros%rowtype;
  v_cfg   public.club_config%rowtype;
  v_saldo int;
  v_dia   numeric;
  v_neg   text;
begin
  select * into v_m from public.club_miembros m where m.id = p_miembro;
  if not found then return null; end if;
  select * into v_cfg from public.club_config where location_id = v_m.location_id;
  select n.nombre into v_neg from public.club_negocios n where n.id = v_m.negocio_id;
  -- D7 A (firma del dueño, 14-nov; mig 157): la caja ve el saldo canjeable (0 en el equipo) y si la cuenta tiene créditos.
  v_saldo := coalesce(public.club_saldo_canjeable(v_m.id), 0);
  select coalesce(sum(mv.creditos), 0) into v_dia from public.club_movimientos mv
   where mv.miembro_id = v_m.id and mv.tipo = 'canje'
     and mv.fecha_visita >= date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica';
  return jsonb_build_object('tipo', p_tipo, 'datos', jsonb_build_object(
    'codigo_canje',             case when p_k.id is not null then p_codigo end,
    'codigo_estado',            case when p_k.id is null then null
                                     when p_k.usado_en is not null then 'usado'
                                     when p_k.invalidado_en is not null then 'reemplazado'
                                     when p_k.vence_en <= now() then 'vencido' else 'vigente' end,
    'codigo_vence_en',          p_k.vence_en,
    'id',                       v_m.id,
    'nombre',                   v_m.nombre,
    'tipo_miembro',             v_m.tipo,
    'negocio',                  v_neg,
    'estado',                   v_m.estado,
    'personas',                 v_saldo,
    'creditos',                 public.club_creditos(v_saldo, v_cfg.personas_por_credito),
    'personas_proximo',         public.club_personas_proximo(v_saldo, v_cfg.personas_por_credito),
    'personas_por_credito',     v_cfg.personas_por_credito,
    'valor_credito_crc',        v_cfg.valor_credito_crc,   -- (08-nov) la caja muestra créditos y colones juntos, como el pase
    'canjeado_hoy',             v_dia,
    'canje_min',                v_cfg.canje_min,
    'canje_paso',               v_cfg.canje_paso,
    'max_creditos_por_visita',  v_cfg.max_creditos_por_visita,
    'tarjeta_manual_activa',    v_cfg.tarjeta_manual_activa,
    'sin_creditos',             v_m.tipo = 'equipo',
    'personas_mes',             (select coalesce(sum(mv.personas), 0) from public.club_movimientos mv
                                  where mv.miembro_id = v_m.id and mv.tipo = 'tarjeta'
                                    and mv.fecha_visita >= date_trunc('month', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica')));
end;
$$;

create or replace function public.club_reporte_mes(p_mes date, p_location text default null, p_vivo boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_cfg  public.club_config%rowtype;
  v_mes  date;
  v_ini  timestamptz;
  v_fin  timestamptz;
  v_pini timestamptz;   -- mes anterior
  v_3ini timestamptz;   -- 3 meses previos
  r      jsonb;
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into v_cfg from public.club_config c where c.location_id = p_location;
  if not found then
    raise exception 'Local no válido' using errcode = 'P0001';
  end if;
  v_mes  := date_trunc('month', coalesce(p_mes, now()::date))::date;
  -- LC-PRIV (Grok 41, 08-nov noche): ver el reporte del mes (nombres de anfitriones y sus saldos) deja rastro, como los
  -- exportes: quién, cuándo, mes, local y si es en vivo; sin datos. Un exporte deja esta fila y la suya.
  perform public.club_auditar('ver_reporte_mes', 'club_reporte_mes', null, null,
    jsonb_build_object('mes', to_char(v_mes, 'YYYY-MM'), 'local', p_location, 'vivo', coalesce(p_vivo, false)));
  -- Mes cerrado → la última versión congelada (CLUB-AUD-04).
  select rc.datos || jsonb_build_object('cerrado', true, 'version', rc.version, 'sha256', rc.sha256,
                                        'sha256_prev', rc.sha256_prev, 'cerrado_en', rc.cerrado_en, 'motivo', rc.motivo,
                                        'generado_en', rc.cerrado_en)   -- fuera del hash (CLUB-AUD-16)
    into r
    from public.club_reportes_cerrados rc
   where rc.location_id = p_location and rc.mes = v_mes and not coalesce(p_vivo, false)
   order by rc.version desc limit 1;
  if r is not null then
    return r;
  end if;
  v_ini  := v_mes::timestamp at time zone 'America/Costa_Rica';
  v_fin  := (v_mes + interval '1 month')::timestamp at time zone 'America/Costa_Rica';
  v_pini := (v_mes - interval '1 month')::timestamp at time zone 'America/Costa_Rica';
  v_3ini := (v_mes - interval '3 months')::timestamp at time zone 'America/Costa_Rica';

  with mi as (
    select m.id, m.tipo, m.estado, public.club_nombre_limpio(m.nombre) as nombre, n.nombre as negocio,
           public.club_corte_equipo(m.id) as corte   -- D7 A (mig 157)
      from public.club_miembros m left join public.club_negocios n on n.id = m.negocio_id
     where m.location_id = p_location and m.tipo in ('referente','concierge_pm','equipo')),
  mv as (select v.* from public.club_movimientos v join mi on mi.id = v.miembro_id where v.fecha_visita < v_fin),
  por_m as (
    select mi.id, mi.tipo, mi.estado, mi.nombre, mi.negocio, mi.corte,
           coalesce(sum(v.personas), 0)::int as saldo_p,
           -- D7 A (mig 157): canjeable = lo posterior al corte del equipo (todo, si nunca fue del equipo)
           coalesce(sum(v.personas) filter (where mi.corte is null or v.registrado_en > mi.corte), 0)::int as canj_p,
           coalesce(sum(v.personas) filter (where v.tipo = 'tarjeta' and v.origen = 'app' and v.fecha_visita >= v_ini), 0)::int as pers_mes,
           count(*) filter (where v.tipo = 'tarjeta' and v.origen = 'app' and v.fecha_visita >= v_ini)::int as t_mes,
           coalesce(sum(v.personas) filter (where v.tipo = 'tarjeta' and v.origen = 'app' and v.fecha_visita >= v_3ini and v.fecha_visita < v_ini), 0) / 3.0 as prom3,
           max(v.fecha_visita) filter (where v.tipo in ('tarjeta','canje','restitucion')
                                         and (mi.corte is null or v.registrado_en > mi.corte)) as ult,
           min(v.fecha_visita) filter (where v.tipo = 'tarjeta' and v.origen = 'app') as primera
      from mi left join mv v on v.miembro_id = mi.id
     group by 1,2,3,4,5,6),
  -- D7 A (mig 157): el pasivo (cr) es solo lo canjeable: el equipo y el saldo congelado quedan fuera (cr_cong, aparte).
  pm0 as (select p.*, case when p.tipo = 'equipo' then 0 else greatest(p.canj_p, 0) end as canj_ef from por_m p),
  pm as (select p.*, public.club_creditos(p.canj_ef, v_cfg.personas_por_credito) as cr,
                public.club_creditos(greatest(p.saldo_p - p.canj_ef, 0), v_cfg.personas_por_credito) as cr_cong from pm0 p),
  k as (
    select
      count(*) filter (where v.tipo = 'tarjeta' and v.origen = 'app' and v.fecha_visita >= v_ini)                              as tarjetas,
      coalesce(sum(v.personas) filter (where v.tipo = 'tarjeta' and v.origen = 'app' and v.fecha_visita >= v_ini), 0)          as personas,
      count(*) filter (where v.tipo = 'canje' and v.fecha_visita >= v_ini)                                as canjes,
      coalesce(sum(v.creditos) filter (where v.tipo = 'canje' and v.fecha_visita >= v_ini), 0)            as creditos_canjeados,
      coalesce(sum(v.creditos * v.valor_credito_crc) filter (where v.tipo = 'canje' and v.fecha_visita >= v_ini), 0) as valor_canjeado_crc,
      coalesce(-sum(v.personas) filter (where v.tipo = 'vencimiento' and v.fecha_visita >= v_ini), 0)     as personas_vencidas,
      count(*) filter (where v.tipo = 'tarjeta' and v.origen = 'app' and v.fecha_visita >= v_pini and v.fecha_visita < v_ini)  as tarjetas_ant,
      coalesce(sum(v.personas) filter (where v.tipo = 'tarjeta' and v.origen = 'app' and v.fecha_visita >= v_pini and v.fecha_visita < v_ini), 0) as personas_ant,
      count(*) filter (where v.tipo = 'canje' and v.fecha_visita >= v_pini and v.fecha_visita < v_ini)    as canjes_ant,
      coalesce(sum(v.creditos) filter (where v.tipo = 'canje' and v.fecha_visita >= v_pini and v.fecha_visita < v_ini), 0) as creditos_canjeados_ant
    from mv v),
  fila as (select p.*, jsonb_build_object('nombre', p.nombre, 'negocio', p.negocio, 'tipo', p.tipo) as base from pm p)
  select jsonb_build_object(
    'mes', to_char(v_mes, 'YYYY-MM'), 'local', p_location,
    'local_nombre', (select coalesce(c.nombre, c.location_id) from public.club_config c where c.location_id = p_location),   -- LC-ML
    'generado_en', now(),
    'config', jsonb_build_object('valor_credito_crc', v_cfg.valor_credito_crc, 'personas_por_credito', v_cfg.personas_por_credito,
                                 'vencimiento_meses', v_cfg.vencimiento_meses, 'pm_pausado', v_cfg.pm_pausado),
    -- Club compartido (08-nov): visitas de socios en ESTE local (donde ocurrieron), de cuántos socios, y cuántas de socios
    -- que se anotaron en otro local; altas hechas en este local.
    'socios', (select jsonb_build_object(
        'visitas', count(*), 'socios', count(distinct vs.miembro_id),
        'con_beneficio', count(*) filter (where vs.estado_beneficio in ('aplica','pendiente_configuracion')),
        'de_otro_local', count(*) filter (where m.location_id <> p_location),
        'socios_de_otro_local', count(distinct vs.miembro_id) filter (where m.location_id <> p_location),
        'altas', (select count(*) from public.club_miembro_roles rr join public.club_miembros mm on mm.id = rr.miembro_id
                   where rr.rol = 'socio' and mm.location_id = p_location and rr.desde >= v_ini and rr.desde < v_fin))
      from public.club_visitas_socio vs join public.club_miembros m on m.id = vs.miembro_id
     where vs.location_id = p_location and vs.registrada_en >= v_ini and vs.registrada_en < v_fin),
    -- (09-nov, B4) Las cargas iniciales (tarjetas de papel y página vieja) NO cuentan como actividad del mes: se muestran
    -- aparte. Sí suman al saldo (son créditos reales). La actividad de arriba y de abajo es solo la de la app.
    'carga_inicial', (select jsonb_build_object(
        'papel', jsonb_build_object('tarjetas', count(*) filter (where v.origen = 'papel'),
                                    'personas', coalesce(sum(v.personas) filter (where v.origen = 'papel'), 0)),
        'migracion', jsonb_build_object('tarjetas', count(*) filter (where v.origen = 'migracion'),
                                        'personas', coalesce(sum(v.personas) filter (where v.origen = 'migracion'), 0)))
      from mv v where v.tipo = 'tarjeta' and v.origen <> 'app' and v.fecha_visita >= v_ini),
    'kpis', (select jsonb_build_object(
        'tarjetas', k.tarjetas, 'personas', k.personas,
        'creditos_generados', round(k.personas::numeric / v_cfg.personas_por_credito, 1),
        'canjes', k.canjes, 'creditos_canjeados', k.creditos_canjeados, 'valor_canjeado_crc', k.valor_canjeado_crc,
        'personas_vencidas', k.personas_vencidas,
        'referentes_con_visitas', (select count(*) from pm where pm.tipo <> 'equipo' and pm.t_mes > 0),
        'cupones_generados', (select count(*) from public.club_cupones c where c.location_id = p_location and c.creado_en >= v_ini and c.creado_en < v_fin),
        'cupones_usados', (select count(*) from public.club_cupones c where c.location_id = p_location and c.usado_en >= v_ini and c.usado_en < v_fin),
        'saldo_creditos_al_cierre', (select coalesce(sum(cr), 0) from pm),
        'cuentas_con_saldo', (select count(*) from pm where pm.cr > 0),
        'anterior', jsonb_build_object('tarjetas', k.tarjetas_ant, 'personas', k.personas_ant, 'canjes', k.canjes_ant,
                                       'creditos_canjeados', k.creditos_canjeados_ant)) from k),
    'ranking', (select coalesce(jsonb_agg(f.base || jsonb_build_object('personas', f.pers_mes, 'tarjetas', f.t_mes, 'prom_3m', round(f.prom3, 1))
                                          order by f.pers_mes desc, f.nombre), '[]') from (select * from fila where tipo <> 'equipo' and pers_mes > 0 order by pers_mes desc, nombre limit 10) f),
    'subiendo', (select coalesce(jsonb_agg(f.base || jsonb_build_object('personas', f.pers_mes, 'prom_3m', round(f.prom3, 1), 'nuevo_ritmo', f.prom3 = 0)
                                           order by f.pers_mes - f.prom3 desc), '[]')
                   from (select * from fila where tipo <> 'equipo' and pers_mes > 0 and (prom3 = 0 or pers_mes > prom3 * 1.3)
                          order by pers_mes - prom3 desc limit 5) f),
    'bajando', (select coalesce(jsonb_agg(f.base || jsonb_build_object('personas', f.pers_mes, 'prom_3m', round(f.prom3, 1)) order by f.pers_mes - f.prom3), '[]')
                  from (select * from fila where tipo <> 'equipo' and prom3 > 0 and pers_mes < prom3 * 0.7 order by pers_mes - prom3 limit 5) f),
    'dormidos', (select jsonb_build_object('cuentas', count(*), 'creditos', coalesce(sum(cr), 0),
                   'lista', coalesce((select jsonb_agg(x.base || jsonb_build_object('creditos', x.cr, 'ultima_actividad', x.ult) order by x.cr desc)
                                        from (select * from fila where tipo <> 'equipo' and cr > 0 and (ult is null or ult < v_fin - interval '60 days')
                                               order by cr desc) x), '[]'))   -- lista completa: el PDF muestra 10, el CSV todas
                   from pm where tipo <> 'equipo' and cr > 0 and (ult is null or ult < v_fin - interval '60 days')),
    'a_contactar', (select coalesce(jsonb_agg(x.base || jsonb_build_object('creditos', x.cr, 'vence_en', x.vence) order by x.vence), '[]')
                      from (select f.*, f.ult + make_interval(months => v_cfg.vencimiento_meses) as vence from fila f
                             where f.tipo <> 'equipo' and f.cr > 0 and f.ult is not null
                               and f.ult + make_interval(months => v_cfg.vencimiento_meses) >= v_fin
                               and f.ult + make_interval(months => v_cfg.vencimiento_meses) < v_fin + interval '30 days'
                             order by vence limit 10) x),
    'nuevos', (select jsonb_build_object('cuentas', count(*),
                 'lista', coalesce((select jsonb_agg(x.base || jsonb_build_object('personas', x.pers_mes) order by x.pers_mes desc)
                                      from (select * from fila where tipo <> 'equipo' and primera >= v_ini order by pers_mes desc limit 10) x), '[]'))
                 from pm where tipo <> 'equipo' and primera >= v_ini),
    -- D7 A (mig 157): el equipo suma personas, no créditos. El saldo que tenía al corte queda congelado, fuera del
    -- pasivo, en una línea aparte (también el de quien salió del equipo).
    'equipo', (select jsonb_build_object('personas_mes', coalesce(sum(pers_mes) filter (where tipo = 'equipo'), 0),
                 'tarjetas_mes', coalesce(sum(t_mes) filter (where tipo = 'equipo'), 0),
                 'congelado_cuentas', count(*) filter (where cr_cong > 0),
                 'congelado_creditos', coalesce(sum(cr_cong), 0),
                 'congelado_valor_crc', coalesce(sum(cr_cong), 0) * v_cfg.valor_credito_crc,
                 'lista', coalesce((select jsonb_agg(x.base || jsonb_build_object('personas', x.pers_mes, 'tarjetas', x.t_mes) order by x.pers_mes desc, x.nombre)
                                      from (select * from fila where tipo = 'equipo' and pers_mes > 0
                                             order by pers_mes desc, nombre limit 10) x), '[]'))
                 from pm),
    'antiguedad', (select coalesce(jsonb_agg(jsonb_build_object('tramo', b.tramo, 'cuentas', b.cuentas, 'creditos', b.creditos,
                                                               'valor_crc', b.creditos * v_cfg.valor_credito_crc) order by b.orden), '[]')
                     from (select case when ult >= v_fin - interval '3 months' then 1 when ult >= v_fin - interval '6 months' then 2
                                       when ult >= v_fin - interval '12 months' then 3 else 4 end as orden,
                                  case when ult >= v_fin - interval '3 months' then 'menos de 3 meses'
                                       when ult >= v_fin - interval '6 months' then '3 a 6 meses'
                                       when ult >= v_fin - interval '12 months' then '6 a 12 meses' else 'más de 12 meses' end as tramo,
                                  count(*) as cuentas, sum(cr) as creditos
                             from pm where cr > 0 group by 1, 2) b),
    'pm', jsonb_build_object(
        'pausado', v_cfg.pm_pausado,
        'nota', case when v_cfg.pm_pausado then 'Programa PM en pausa por temas contables: los montos son informativos.' else null end,
        -- CLUB-AUD-04: pendiente AL CIERRE por eventos, no por el estado de hoy: todo cargo creado antes
        -- del cierre cuenta, salvo el anulado antes del cierre; se restan los pagos hechos antes del cierre.
        -- Un cargo pagado después ya no le baja el pendiente a un mes cerrado.
        'pendiente_crc', (select coalesce(sum(c.monto_crc), 0) from public.club_pm_cargos c join mi on mi.id = c.miembro_id
                           where c.created_at < v_fin
                             and not (c.estado = 'anulado' and coalesce(c.anulado_en, '-infinity') < v_fin))
                       - (select coalesce(sum(p.monto_crc), 0) from public.club_pm_pagos p join mi on mi.id = p.miembro_id
                           where p.pagado_en < v_fin),
        'cargos_mes_crc', (select coalesce(sum(c.monto_crc), 0) from public.club_pm_cargos c join mi on mi.id = c.miembro_id
                            where c.created_at >= v_ini and c.created_at < v_fin),
        'pagos_mes_crc', (select coalesce(sum(p.monto_crc), 0) from public.club_pm_pagos p join mi on mi.id = p.miembro_id
                           where p.pagado_en >= v_ini and p.pagado_en < v_fin)),
    'calidad', (select jsonb_build_object('abiertas', coalesce(sum(e.n_ab), 0), 'resueltas', coalesce(sum(e.n_res), 0),
                                          'por_tipo', coalesce(jsonb_object_agg(e.tipo, e.n_ab) filter (where e.n_ab > 0), '{}'),
                                          'promo_activa', v_cfg.promo_articulo_codigo is not null)
                  from (select x.tipo, count(*) filter (where not x.resuelta) as n_ab, count(*) filter (where x.resuelta) as n_res
                          from public.club_excepciones(v_mes, (v_mes + interval '1 month' - interval '1 day')::date, p_location) x
                         group by x.tipo) e)
  ) into r;
  return r || jsonb_build_object('cerrado', false);
end;
$$;

create or replace function public.club_miembro_guardar(
  p_id uuid, p_tipo text, p_nombre text, p_negocio_id uuid, p_estado text, p_contacto jsonb, p_location text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol    public.user_role := public.get_my_role();
  v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_id     uuid;
  v_tel    text;
  v_email  text;
  v_antes  text;
  v_saldo  int;
  v_cfg    public.club_config%rowtype;
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if length(v_nombre) not between 1 and 120 then
    raise exception 'El nombre es obligatorio (hasta 120 caracteres)' using errcode = 'P0001';
  end if;
  if p_tipo is null or p_tipo not in ('referente','concierge_pm','equipo') then
    raise exception 'Tipo no válido (referente, concierge_pm o equipo)' using errcode = 'P0001';
  end if;
  if p_estado is not null and p_estado not in ('activo','baja') then
    raise exception 'Estado no válido' using errcode = 'P0001';
  end if;
  if p_negocio_id is not null and not exists (select 1 from public.club_negocios n where n.id = p_negocio_id) then
    raise exception 'Negocio no encontrado' using errcode = 'P0001';
  end if;

  if p_contacto is not null then
    if jsonb_typeof(p_contacto) <> 'object' then
      raise exception 'Contacto no válido' using errcode = 'P0001';
    end if;
    v_tel := public.club_norm_telefono(p_contacto->>'telefono');
    v_email := nullif(lower(btrim(coalesce(p_contacto->>'email', ''))), '');
    if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      raise exception 'Email no válido' using errcode = 'P0001';
    end if;
  end if;

  if p_id is null then
    -- LC-ML: el local se elige (o sale del negocio); sin dato, el único local con el Club activo
    insert into public.club_miembros (location_id, tipo, nombre, negocio_id, estado, origen)
    values (public.club_local(coalesce(p_location, (select n.location_id from public.club_negocios n where n.id = p_negocio_id)), false),
            p_tipo, v_nombre, p_negocio_id, coalesce(p_estado, 'activo'), 'app')
    returning id into v_id;
  else
    select m.estado into v_antes from public.club_miembros m where m.id = p_id for update;
    update public.club_miembros
       set tipo = p_tipo, nombre = v_nombre, negocio_id = p_negocio_id,
           estado = coalesce(p_estado, estado), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Miembro no encontrado' using errcode = 'P0001';
    end if;
    -- Baja: el saldo vence en la misma transacción. Volver a activo NO restituye
    -- (eso es club_ajuste tipo restitucion, solo owner).
    if v_antes = 'activo' and p_estado = 'baja' then
      -- D7 A (mig 157): vence solo lo canjeable (0 en el equipo). El saldo congelado no se toca: si no, el vencimiento
      -- quedaría después del corte y se comería lo que la cuenta gane si la reactivan.
      v_saldo := coalesce(public.club_saldo_canjeable(v_id), 0);
      if v_saldo > 0 then
        select * into v_cfg from public.club_config c
         where c.location_id = (select m.location_id from public.club_miembros m where m.id = v_id);
        insert into public.club_movimientos
          (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
           fecha_visita, registrado_por, origen, nota)
        values
          (v_cfg.location_id, v_id, 'vencimiento', -v_saldo, v_cfg.personas_por_credito, v_cfg.valor_credito_crc,
           now(), auth.uid(), 'app', 'baja: saldo vencido');
      end if;
    end if;
  end if;

  if p_contacto is not null then
    insert into public.club_miembros_contacto (miembro_id, location_id, telefono, email, optin_whatsapp, optin_email)
    values (v_id, (select location_id from public.club_miembros where id = v_id), v_tel, v_email,
            coalesce((p_contacto->>'optin_whatsapp')::boolean, false) and v_tel is not null,
            coalesce((p_contacto->>'optin_email')::boolean, false) and v_email is not null)
    on conflict (miembro_id) do update
      set telefono = excluded.telefono, email = excluded.email,
          optin_whatsapp = excluded.optin_whatsapp, optin_email = excluded.optin_email, updated_at = now();
  end if;
  return v_id;
end;
$$;

create or replace function public.club_ajuste(p_miembro uuid, p_personas int, p_tipo text, p_nota text, p_op uuid)
returns table (personas int, creditos numeric)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol   public.user_role := public.get_my_role();
  v_nota  text := btrim(coalesce(p_nota, ''));
  v_m     public.club_miembros%rowtype;
  v_cfg   public.club_config%rowtype;
  v_prev  public.club_movimientos%rowtype;
  v_saldo int;
begin
  if v_rol is null or v_rol <> 'owner' then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_op is null then
    raise exception 'Falta el id de operación' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('club_op:' || p_op::text, 0));
  select * into v_prev from public.club_movimientos where client_op_id = p_op;
  if found then
    if v_prev.tipo is distinct from p_tipo or v_prev.miembro_id is distinct from p_miembro or v_prev.personas is distinct from p_personas then
      raise exception 'El id de operación ya se usó para otra cosa' using errcode = 'P0001';
    end if;
    select * into v_cfg from public.club_config where location_id = v_prev.location_id;
    v_saldo := coalesce(public.club_saldo_canjeable(p_miembro), 0);   -- D7 A (mig 157)
    personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
    return next; return;
  end if;
  if p_tipo is null or p_tipo not in ('ajuste','restitucion','vencimiento') then
    raise exception 'Tipo no válido (ajuste, restitucion o vencimiento)' using errcode = 'P0001';
  end if;
  if v_nota = '' then
    raise exception 'La nota es obligatoria' using errcode = 'P0001';
  end if;
  if p_personas is null or p_personas = 0
     or (p_tipo = 'restitucion' and p_personas < 0)
     or (p_tipo = 'vencimiento' and p_personas > 0) then
    raise exception 'Personas no válidas para el tipo %', p_tipo using errcode = 'P0001';
  end if;

  select * into v_m from public.club_miembros m where m.id = p_miembro for update;
  if not found then
    raise exception 'Miembro no encontrado' using errcode = 'P0001';
  end if;
  select * into v_cfg from public.club_config where location_id = v_m.location_id;

  -- D7 A (mig 157): el tope es lo canjeable, no el saldo total: un ajuste negativo no puede tocar el saldo congelado
  -- (en el equipo, lo canjeable es 0: solo admite ajustes positivos, que tampoco se pueden canjear).
  v_saldo := coalesce(public.club_saldo_canjeable(p_miembro), 0);
  if v_saldo + p_personas < 0 then
    raise exception 'El saldo no puede quedar negativo' using errcode = 'P0001';
  end if;

  insert into public.club_movimientos
    (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
     fecha_visita, registrado_por, origen, nota, client_op_id)
  values
    (v_m.location_id, p_miembro, p_tipo, p_personas, v_cfg.personas_por_credito, v_cfg.valor_credito_crc,
     now(), auth.uid(), 'app', v_nota, p_op);

  v_saldo := v_saldo + p_personas;
  personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
  return next;
end;
$$;

create or replace function public.club_alertas_pendientes(p_limite int default 100)
returns table (id bigint, miembro_id uuid, tipo text, creditos numeric, saldo_creditos numeric, fecha timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, a.miembro_id, a.tipo, mv.creditos,
         public.club_creditos(coalesce(public.club_saldo_canjeable(a.miembro_id), 0), c.personas_por_credito)   -- D7 A (mig 157), mv.fecha_visita
    from public.club_alertas a
    join public.club_movimientos mv on mv.id = a.movimiento_id
    join public.club_config c on c.location_id = a.location_id
   where a.enviado_en is null and a.tipo = 'canje'   -- las de cupo de autoalta no van al pase
   order by a.id limit least(greatest(coalesce(p_limite, 100), 1), 1000)
$$;

-- ── 4. Ranking del equipo (#2): por persona del equipo y mes. Solo owner y manager; deja rastro ──────────────────
-- cupones usados (sus cupones usados en el mes) · personas (tarjetas de la app) · mesas (visitas distintas) · facturas y
-- venta respaldada (facturas cerradas del PoS que cruzan con esas visitas, cada una una sola vez) · altas de socios (socios
-- que se anotaron con su link en el mes).
create or replace function public.club_reporte_equipo(p_mes date, p_location text default null)
returns table (miembro_id uuid, nombre text, estado text, cupones_usados int, personas int, mesas int, facturas int,
               venta_respaldada_crc numeric, altas_socios int)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_mes date;
  v_ini timestamptz;
  v_fin timestamptz;
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_mes is null then
    raise exception 'Falta el mes' using errcode = 'P0001';
  end if;
  v_mes := date_trunc('month', p_mes)::date;
  v_ini := v_mes::timestamp at time zone 'America/Costa_Rica';
  v_fin := (v_mes + interval '1 month')::timestamp at time zone 'America/Costa_Rica';
  perform public.club_auditar('ver_reporte_equipo', 'club_reporte_equipo', null, null,
    jsonb_build_object('mes', to_char(v_mes, 'YYYY-MM'), 'local', p_location));
  return query
    with eq as (
      select m.id, public.club_nombre_limpio(m.nombre) as nombre, m.estado from public.club_miembros m
       where m.location_id = p_location and m.tipo = 'equipo'),
    mv as (
      select v.* from public.club_movimientos v join eq on eq.id = v.miembro_id
       where v.tipo = 'tarjeta' and v.origen = 'app' and v.fecha_visita >= v_ini and v.fecha_visita < v_fin),
    fac as (
      select distinct v.miembro_id, t.id as ticket, t.total_crc
        from mv v
        cross join lateral unnest(public.club_cruce_facturas(v.location_id, v.pos_ref, v.factura_pos)) as u(tid)
        join public.pos_ndf_tickets t on t.id = u.tid),
    x as (
      select eq.id, eq.nombre, eq.estado,
             (select count(*) from public.club_cupones c where c.referente_id = eq.id and c.usado_en >= v_ini and c.usado_en < v_fin)::int as cup,
             (select coalesce(sum(v.personas), 0) from mv v where v.miembro_id = eq.id)::int as pers,
             (select count(distinct coalesce(v.visita_clave, v.factura_pos, v.id::text)) from mv v where v.miembro_id = eq.id)::int as mes_,
             (select count(*) from fac f where f.miembro_id = eq.id)::int as nfac,
             (select coalesce(sum(f.total_crc), 0) from fac f where f.miembro_id = eq.id)::numeric as venta,
             (select count(*) from public.club_miembro_roles r
               where r.rol = 'socio' and r.referido_por = eq.id and r.desde >= v_ini and r.desde < v_fin)::int as altas
        from eq)
    select x.id, x.nombre, x.estado, x.cup, x.pers, x.mes_, x.nfac, x.venta, x.altas
      from x
     where x.estado = 'activo' or x.cup + x.pers + x.altas > 0
     order by x.pers desc, x.venta desc, x.nombre;
end;
$$;
revoke all on function public.club_reporte_equipo(date, text) from public, anon, authenticated;
grant execute on function public.club_reporte_equipo(date, text) to authenticated;

-- Verificación (si algo no quedó como se espera, la migración entera se cae)
do $$
declare v_n int;
begin
  -- permisos de las vigentes: iguales a antes (create or replace los conserva)
  if not has_function_privilege('anon', 'public.club_canje_codigo_generar(text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.club_portal(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_canje_aplicar(uuid, text, numeric, text, uuid, jsonb, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_pase_datos(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_vencer_candidatos(date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_alertas_pendientes(int)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.club_miembro_guardar(uuid, text, text, uuid, text, jsonb, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.club_ajuste(uuid, int, text, text, uuid)', 'EXECUTE') then
    raise exception '157: los permisos de las funciones vigentes cambiaron';
  end if;
  -- las nuevas: internas cerradas; el ranking solo para authenticated (el rol se chequea adentro)
  if has_function_privilege('anon', 'public.club_saldo_canjeable(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_saldo_canjeable(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_corte_equipo(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_reporte_equipo(date, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.club_reporte_equipo(date, text)', 'EXECUTE') then
    raise exception '157: permisos de las funciones nuevas';
  end if;
  -- una foto por cuenta del equipo
  select count(*) into v_n from public.club_miembros m
   where m.tipo = 'equipo'
     and not exists (select 1 from public.club_auditoria a where a.objeto_id = m.id and a.accion = 'equipo_corte'
                       and a.despues->>'motivo' = 'd7_congelar');
  if v_n > 0 then
    raise exception '157: % cuentas del equipo sin foto del corte', v_n;
  end if;
end;
$$;

commit;
