-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 090 — las tablas NUEVAS de public dejan de nacer con permisos para anon. BORRADOR.      ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ BORRADOR. NO APLICAR NI MERGEAR SIN FIRMA DE ISMAEL. Va después de la 089 (que limpia las tablas que ya existen).
--
-- ── QUÉ CAMBIA ─────────────────────────────────────────────────────────────────────────────
-- Hoy, en prod (leído el 08-nov), los privilegios por defecto del rol `postgres` en el esquema `public` le dan a anon
-- TODO en cada tabla nueva: `anon=arwdDxtm` (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN).
-- Todas las tablas de `public` son de `postgres` (las crean las migraciones, el editor SQL y el editor de tablas del
-- panel). La red de hoy es la prueba 82 del Club, que marca cualquier tabla nueva con permisos de anon sin política.
-- Con esta migración, una tabla nueva de `public` creada por `postgres` nace SIN nada para anon. authenticated y
-- service_role siguen recibiendo lo de siempre.
--
-- ── QUÉ NO CAMBIA ──────────────────────────────────────────────────────────────────────────
--   · Las tablas que YA existen (eso lo hace la 089, tabla por tabla).
--   · Secuencias (`anon=rwU`) y funciones (`anon=X`) nuevas: quedan como están. Una secuencia sin la tabla no sirve de
--     nada, y las funciones del Club que anon tiene que ejecutar se crean con grants explícitos. Si se quiere, es otra
--     migración (y en funciones rompe más: ver «Qué podría romper»).
--   · Los privilegios por defecto del rol `supabase_admin` en `public` (también dan todo a anon): `postgres` no es
--     miembro de `supabase_admin` y no puede cambiarlos. Solo afectan a lo que cree la plataforma en `public` (raro).
--   · Los otros esquemas (`storage`, `graphql`, `realtime`, `auth`, `cron`, `extensions`): no se tocan.
--
-- ── QUÉ PODRÍA ROMPER (y por qué es poco) ───────────────────────────────────────────────────
--   · Una tabla nueva que una pantalla SIN login tenga que leer o escribir (como `customers` en /registro): ya no anda
--     sola; su migración tiene que traer `grant select|insert … on public.X to anon` (y su política). Es lo correcto:
--     abrirle algo a anon pasa a ser explícito. Hoy la única pantalla sin login que escribe es /registro (customers,
--     que ya existe: no cambia).
--   · Supabase / PostgREST: anon deja de ver las tablas nuevas en la API (en el esquema que publica PostgREST y en
--     GraphQL). Es lo buscado. authenticated y service_role no cambian. El panel (editor de tablas) sigue andando: entra
--     como `postgres`, que es dueño.
--   · Realtime: se suscriben sesiones logueadas (authenticated): no cambia. Un canal que escuche como anon una tabla
--     nueva dejaría de recibir eventos (hoy no hay ninguno).
--   · Funciones: SECURITY DEFINER (todas las del Club que anon ejecuta) corren como su dueño: no cambian. Una función
--     SECURITY INVOKER que anon ejecute y lea una tabla NUEVA daría «permission denied» (hoy no hay ninguna: verificado
--     en la 089).
--   · Edge Functions: usan service_role o el JWT del usuario (authenticated): no cambian.
--   · La prueba 82 del Club tiene un caso «negativa» que crea una tabla nueva y ESPERA que anon tenga SELECT
--     (`has_table_privilege('anon', 'public.prueba_rls_82', 'SELECT')`). Con la 090 ese caso falla a propósito: hay que
--     invertirlo (esperar que anon NO tenga nada) en el mismo PR que aplique la 090.
--
-- ── CÓMO SE PRUEBA (staging, antes de firmar) ───────────────────────────────────────────────
--   1. scripts/sql/090_pruebas.sql: en una transacción descartada, aplica la 090, crea una tabla de prueba en public y
--      mira los permisos (anon nada; authenticated y service_role todo), y deja la base como estaba (rollback).
--   2. Con la 090 aplicada en staging: la prueba 82 del Club (con el caso negativo invertido), el recorrido de la app
--      sin sesión (/login, /registro) y con sesión (cajero, manager, owner), y crear una tabla de prueba desde el
--      editor del panel y borrarla.
--   3. Una migración de prueba que cree una tabla y le dé SELECT a anon con grant explícito: anon la lee.
--
-- Gate de catálogo (Grok, 09-nov): docs/pases/GATE-090-catalogo.md — todas las tablas de public son de postgres y
-- Branching crea como postgres.
--
-- Rollback: scripts/sql/090_rollback.sql (vuelve a dar todo a anon en las tablas nuevas, como hoy).

begin;

alter default privileges for role postgres in schema public revoke all on tables from anon;

-- Verificación: el valor por defecto de public para tablas de postgres ya no menciona a anon.
do $$
declare v_acl text;
begin
  select d.defaclacl::text into v_acl
    from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
   where d.defaclrole = 'postgres'::regrole and n.nspname = 'public' and d.defaclobjtype = 'r';
  if v_acl is not null and v_acl ~ '(^|[{,])anon=' then
    raise exception '090: los privilegios por defecto de public todavía dan permisos a anon: %', v_acl;
  end if;
end $$;

commit;
