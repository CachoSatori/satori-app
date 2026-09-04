-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 062 — PoS "Nube de Fuego" (A1): tablas destino de la ingesta. ADITIVA e IDEMPOTENTE.   ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⛔ NO APLICADA. Se entrega en rama para revisión (`feat/pos-bridge-a1a2`).
-- ✅ Para STAGING (ref hwiatgicyyqyezqwldia; confirmar `cat supabase/.temp/project-ref` ANTES de tocar la DB).
--    NUNCA a prod sin firma de Ismael (pushear una mig a `main` la AUTO-APLICA a la base de prod).
-- ⚠ Número 062: verificado libre contra los archivos de TODAS las ramas del remoto (la última es
--   la 061). Confirmar igual contra el ledger real de staging (`supabase migration list --linked`)
--   antes de aplicar: si alguien subió una 062 en el ínterin, renumerar esta.
--
-- Base: Fase 1a del pos-bridge (`pos-bridge/README.md` + `src/shared/ndf/mapTicket.ts`), ya cuadrada
-- contra el reporte oficial del PoS ("Ventas Netas por Día", 1-sep-2026). Patrón: mig 057 (BioTime).
--
-- ── QUÉ AGREGA ─────────────────────────────────────────────────────────────────────────────
-- SOLO ESQUEMA: 4 tablas nuevas + 1 columna en `employees` + RLS + CHECKs + índices. Sin datos,
-- sin backfill, sin Edge Function (eso es A2), sin agente (A3), sin UI.
--   1. `pos_ndf_tickets`      — una factura CERRADA del PoS = una fila.
--   2. `pos_ndf_ticket_lines` — el detalle de esa factura (para el mix).
--   3. `pos_ndf_open`         — snapshot de mesas abiertas (se pisa entero en cada poll).
--   4. `pos_ndf_cursor`       — hasta dónde leyó el agente, por local.
--   5. `employees.pos_login`  — el LOGIN del PoS (`026` = MAXO), para atar ticket ↔ empleado.
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────
-- Destino NUEVO: no pisa las ventas históricas ni el `DiaData` que arma el Excel
-- (`src/modules/ventas/xlsParser.ts`), que sigue siendo la fuente del dashboard hasta que esto
-- esté validado. Sin FK a `cash_movements`, sin triggers de plata, sin RPCs de dinero. No toca
-- Caja, Tips, Proveedores, `auth`/`profiles`, el enum `user_role` ni los sagrados
-- (`posFiscal` · `tipCalculations` · `cashUtils`). Ninguna columna existente cambia.
-- Todo es `create ... if not exists` / `drop policy if exists` → re-ejecutable sin efecto.
--
-- ── POR QUÉ LA IDEMPOTENCIA ES `(local, numero_factura)` ───────────────────────────────────
-- Igual que en la 057 con BioTime: cada local tiene SU PoS con su propia numeración de facturas.
-- Un unique global haría que la factura 5001 de Nosara se comiera en silencio a la 5001 de Santa
-- Teresa (`on conflict` → factura PERDIDA, no error). La clave real es el par.
--
-- ── POR QUÉ `numero_factura` ES TEXT ───────────────────────────────────────────────────────
-- En el PoS es un `decimal`. Pasarlo por un número de JS pierde precisión arriba de 2^53 y dos
-- facturas distintas colapsarían en la misma clave. Viaja y se guarda SIEMPRE como string.
--
-- ── POR QUÉ `fecha_registra` ES timestamptz ────────────────────────────────────────────────
-- El PoS guarda un datetime NAIVE que es hora de pared de Costa Rica (UTC−6 fijo, sin horario de
-- verano). El agente le pone el offset `-06:00` explícito antes de mandarlo y la Edge Function
-- RECHAZA cualquier instante sin zona. Es la lección del desfase de 1 hora de BioTime: un naive
-- interpretado en la zona del runtime entra corrido SIN QUE NADA FALLE.

-- ── 1. pos_ndf_tickets — una factura cerrada del PoS ───────────────────────────────────────
-- `total_crc` = Σ medios de pago en colones − vuelto. El vuelto SE RESTA porque el campo
-- `Efectivo` del PoS guarda lo que el cliente entregó, no lo que quedó en la caja (cuadre contra
-- "Ventas Netas por Día", 1-sep-2026). Los dólares NO se suman (el PoS ya los convirtió) pero se
-- guardan igual para poder auditar el cambio.
--
-- `salonero_login` es NULLABLE a propósito: la factura que registró un cajero de turno (111/222),
-- un login de sistema (002/01/02) o que no tiene pedido (histórico 2024) NO se le acredita a
-- ningún mesero — pero SÍ cuenta en el total del día. `registrado_por` dice cuál de los cuatro
-- casos es, para que ningún reporte tenga que adivinarlo.
create table if not exists public.pos_ndf_tickets (
  id               uuid        primary key default gen_random_uuid(),
  local            text        not null default 'santa-teresa',
  numero_factura   text        not null,
  fecha_registra   timestamptz not null,
  fecha_cierra     timestamptz,
  estado           text        not null check (estado in ('C','X','R')),
  tipo             text,
  area             text,
  canal            text        not null check (canal in ('salon','barra','delivery','llevar','otro')),
  mesa             text,
  salonero_login   text,
  registrado_por   text        not null check (registrado_por in ('salonero','cajero','sistema','sin_pedido')),
  turno            text        check (turno in ('mañana','tarde','noche')),
  cajero_login     text,
  numero_pedido    text,
  efectivo_crc     numeric,
  tarjeta_crc      numeric,
  electronico_crc  numeric,
  deposito_crc     numeric,
  cheque_crc       numeric,
  cxc_crc          numeric,
  dolares_efectivo numeric,
  dolares_tarjeta  numeric,
  vuelto_crc       numeric,
  descuento_crc    numeric,
  con_servicio     boolean     not null,
  servicio_crc     numeric,
  pax_nativo       int         not null default 0,
  pax_articulo     int         not null default 0,
  pax              int         not null default 0,
  pax_alerta       text        not null check (pax_alerta in ('ok','falta_nativo','falta_articulo','difiere','sin_pax')),
  total_crc        numeric,
  total_fuente     text        not null default 'provisorio',
  ingested_at      timestamptz not null default now(),
  unique (local, numero_factura)
);

-- El `unique (local, numero_factura)` ya crea su índice: sirve el `on conflict` de la ingesta y el
-- `max(numero_factura) where local = ?` del cursor. Acá va solo lo que ese unique NO cubre: el día
-- (todo reporte arranca por fecha) y el mesero (la métrica individual).
create index if not exists pos_ndf_tickets_local_fecha_idx
  on public.pos_ndf_tickets (local, fecha_registra);
create index if not exists pos_ndf_tickets_salonero_fecha_idx
  on public.pos_ndf_tickets (salonero_login, fecha_registra)
  where salonero_login is not null;

comment on table public.pos_ndf_tickets is
  'PoS Nube de Fuego (A1): una factura CERRADA = una fila. Solo la escribe la Edge Function ingest-ndf (service-role). Destino nuevo: NO pisa las ventas historicas del Excel.';
comment on column public.pos_ndf_tickets.local is
  'Slug del local, mismos valores que public.locations.id. Parte de la clave de idempotencia: cada local tiene su PoS con su propia numeracion de facturas.';
comment on column public.pos_ndf_tickets.numero_factura is
  'TEXT a proposito: en el PoS es decimal y Number lo trunca arriba de 2^53. Unico junto con local.';
comment on column public.pos_ndf_tickets.fecha_registra is
  'Instante de la venta. El PoS lo guarda naive = hora de pared de Costa Rica (UTC-6 fijo); el agente le pone el offset explicito y la Edge rechaza lo que llegue sin zona.';
comment on column public.pos_ndf_tickets.estado is
  'C cerrada (la unica que se ingesta) | X anulada | R rara. Las X y las R no deberian llegar; el CHECK esta por si alguna vez se ingestan para auditoria.';
comment on column public.pos_ndf_tickets.canal is
  'Mapeado de Pedidos.Tipo: B barra | D delivery | M salon | L llevar | resto otro. El area se guarda CRUDA y no decide el canal en v1.';
comment on column public.pos_ndf_tickets.salonero_login is
  'employees.pos_login del mesero. null = lo registro un cajero de turno (111/222), un login de sistema o no hay pedido: el ticket cuenta en el dia pero no se le acredita a nadie.';
comment on column public.pos_ndf_tickets.registrado_por is
  'salonero | cajero (111/222) | sistema (002/01/02) | sin_pedido. Dice por que salonero_login es null, para que ningun reporte lo adivine.';
comment on column public.pos_ndf_tickets.turno is
  'Turno de caja: lo deciden 111 (manana) y 222 (noche); si registro un salonero se deriva de la hora. "tarde" queda reservado para el login 022 (sin confirmar). Sirve para saber quien tenia la caja, NO para inventar el mesero.';
comment on column public.pos_ndf_tickets.con_servicio is
  'SUM(ImpS del detalle) > 0. Es la particion del Excel: con 10% = consumo en salon, sin 10% = delivery/llevar. Cuadre PRIMARIO del dia.';
comment on column public.pos_ndf_tickets.total_crc is
  'Efectivo + Tarjeta + MontoElectronico + Deposito + Cheque + CuentaCobrar - Vuelto, todo con COALESCE(...,0). El vuelto SE RESTA: Efectivo lo trae adentro. Los dolares NO se suman (el PoS ya los convirtio).';
comment on column public.pos_ndf_tickets.total_fuente is
  'provisorio = el total sale de los medios de pago. Cambia cuando se valide una factura con efectivo + dolares contra el comprobante fiscal.';
comment on column public.pos_ndf_tickets.pax is
  'El pax resuelto: manda pax_nativo (Pedidos.Personas) cuando esta; si no, pax_articulo (677x1 + 678x2). NUNCA se suman las dos fuentes. pax_alerta dice de cual salio.';

-- ── 2. pos_ndf_ticket_lines — el detalle de la factura ─────────────────────────────────────
-- Es lo que alimenta el mix (comida 2,3,4,6,13,16 · bebida 5) y lo que deja ver aparte lo que NO
-- es ingreso (19 A PAX, 20 Ingredientes, 22 EXTRAS, 12 Gift Cards, merch) ni venta (17 Cortesías,
-- 28 Dueños). `on delete cascade`: las líneas no tienen vida propia — la Edge las reemplaza
-- enteras cuando reingesta la factura.
create table if not exists public.pos_ndf_ticket_lines (
  id              uuid    primary key default gen_random_uuid(),
  ticket_id       uuid    not null references public.pos_ndf_tickets(id) on delete cascade,
  codigo_producto text,
  nombre          text,
  cantidad        numeric,
  precio          numeric,
  monto           numeric,
  familia         int,
  es_pax          boolean default false,
  es_extra        boolean default false,
  es_cortesia     boolean default false
);

create index if not exists pos_ndf_ticket_lines_ticket_idx
  on public.pos_ndf_ticket_lines (ticket_id);
create index if not exists pos_ndf_ticket_lines_familia_idx
  on public.pos_ndf_ticket_lines (familia);

comment on table public.pos_ndf_ticket_lines is
  'PoS Nube de Fuego (A1): detalle de una factura. La Edge las reemplaza enteras al reingestar el ticket (borrar + insertar), asi que no llevan clave natural.';
comment on column public.pos_ndf_ticket_lines.familia is
  'FAC_Clasificaciones: comida 2,3,4,6,13,16 | bebida 5. Fuera del ingreso: 19 A PAX, 20 Ingredientes, 22 EXTRAS, 12 Gift Cards, merch 21,23,24,26,27. No son venta: 17 Cortesias, 28 Duenos.';
comment on column public.pos_ndf_ticket_lines.es_pax is
  'Familia 19. Las unidades de los codigos 677 (1 persona) y 678 (2 personas) son las que acreditan pax.';

-- ── 3. pos_ndf_open — mesas abiertas (SNAPSHOT, no historial) ──────────────────────────────
-- Esta tabla NO acumula: es una foto del local en el último poll. La Edge pisa las que vienen y
-- BORRA las que no vinieron (mesa cerrada = desaparece). Por eso no tiene `created_at` ni estado:
-- lo único que importa es qué hay abierto ahora y desde cuándo se sabe (`updated_at`).
create table if not exists public.pos_ndf_open (
  id             uuid        primary key default gen_random_uuid(),
  local          text        not null,
  clave          text        not null,
  numero_factura text,
  id_pedido      text,
  mesa           text,
  salonero_login text,
  canal          text,
  pax            int,
  pax_alerta     text,
  updated_at     timestamptz not null,
  unique (local, clave)
);

comment on table public.pos_ndf_open is
  'PoS Nube de Fuego (A1): SNAPSHOT de mesas abiertas por local. No es historial: la Edge borra las claves que no vinieron en el lote (mesa cerrada desaparece).';
comment on column public.pos_ndf_open.clave is
  'Identidad estable de la mesa abierta dentro del local (la arma el agente). Unica junto con local: es la clave del upsert del snapshot.';

-- ── 4. pos_ndf_cursor — hasta dónde leyó el agente ─────────────────────────────────────────
-- Una fila por local, la PK es el slug (el cursor ES del local). `last_error` guarda el último
-- fallo para que el problema se vea en la base y no solo en la consola de la PC del PoS.
create table if not exists public.pos_ndf_cursor (
  local               text        primary key,
  last_factura        text,
  last_fecha_registra timestamptz,
  last_poll_at        timestamptz,
  last_error          text
);

comment on table public.pos_ndf_cursor is
  'PoS Nube de Fuego (A1): hasta donde leyo el agente, por local. Una fila por local (la PK es el slug).';
comment on column public.pos_ndf_cursor.last_error is
  'Ultimo fallo de la ingesta, para que el problema se vea en la base y no solo en la consola de la PC del PoS. null = el ultimo lote entro limpio.';

-- ── 5. employees.pos_login — el LOGIN del PoS ──────────────────────────────────────────────
-- El login numérico con que el mesero entra al PoS (`026` = MAXO). Es lo que ata
-- `pos_ndf_tickets.salonero_login` con el empleado. NO es `pos_name` (mig 050), que es el nombre
-- tal cual aparece en el .xls del dashboard: son dos llaves distintas al mismo empleado y conviven.
--
-- NULL y sin backfill a propósito: cargar el login de cada quien es una decisión de Ismael
-- (empezando por si `022` es un mesero o el "cajero turno tarde" del maestro, que está sin
-- confirmar). Inventar el mapeo sería acreditarle ventas a la persona equivocada.
-- Unique PARCIAL: los null no compiten entre sí (mismo patrón que `biotime_emp_code`, mig 055).
alter table public.employees
  add column if not exists pos_login text;

create unique index if not exists employees_pos_login_key
  on public.employees (pos_login)
  where pos_login is not null;

comment on column public.employees.pos_login is
  'LOGIN del empleado en el PoS Nube de Fuego (023 Esteban, 024 Juancho, 025 Dolores, 026 MAXO, 027 GUILLE, 028 FRANCISCO). Ata pos_ndf_tickets.salonero_login con el empleado. Distinto de pos_name (nombre en el .xls). null = sin vincular.';

-- ── 6. RLS ─────────────────────────────────────────────────────────────────────────────────
-- Lectura para GERENCIA + CONTADOR (`get_my_role() in ('owner','manager','contador')`), el mismo
-- criterio que la mig 057 y el resto del repo. NO es `authenticated`: la venta completa del local
-- —el total del día, la de cada mesero, los medios de pago— no es un dato que deba ver cualquier
-- usuario logueado. Un salonero no ve la caja del local, y hoy no hay ninguna pantalla que se lo
-- muestre; el día que exista "Mi Rendimiento" contra estas tablas va a necesitar su propia policy
-- acotada al empleado (`pos_login`), no abrir la tabla entera.
--
-- La escritura es EXCLUSIVA de la Edge Function `ingest-ndf`, que corre con service-role y por lo
-- tanto bypassa RLS. Deliberadamente NO hay policy de insert/update/delete en ninguna de las
-- cuatro: el ticket del PoS es evidencia y no se edita desde la app.
alter table public.pos_ndf_tickets      enable row level security;
alter table public.pos_ndf_ticket_lines enable row level security;
alter table public.pos_ndf_open         enable row level security;
alter table public.pos_ndf_cursor       enable row level security;

drop policy if exists pos_ndf_tickets_select on public.pos_ndf_tickets;
create policy pos_ndf_tickets_select on public.pos_ndf_tickets for select
  using (get_my_role() in ('owner','manager','contador'));

drop policy if exists pos_ndf_ticket_lines_select on public.pos_ndf_ticket_lines;
create policy pos_ndf_ticket_lines_select on public.pos_ndf_ticket_lines for select
  using (get_my_role() in ('owner','manager','contador'));

drop policy if exists pos_ndf_open_select on public.pos_ndf_open;
create policy pos_ndf_open_select on public.pos_ndf_open for select
  using (get_my_role() in ('owner','manager','contador'));

drop policy if exists pos_ndf_cursor_select on public.pos_ndf_cursor;
create policy pos_ndf_cursor_select on public.pos_ndf_cursor for select
  using (get_my_role() in ('owner','manager','contador'));
