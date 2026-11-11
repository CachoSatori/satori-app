-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 089 — anon sin permisos que ninguna política justifique (fuera del Club). ENDURECE.     ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ NO APLICAR NI MERGEAR SIN FIRMA DE ISMAEL. Va DESPUÉS de la 085 (y del puente y del PR de sincronía #71).
--   Staging primero (prueba 82 del Club + scripts/sql/089_pruebas.sql), prod después.
--
-- ── QUÉ CIERRA ─────────────────────────────────────────────────────────────────────────────
-- Los privilegios por defecto de Supabase le dan a `anon` TODO en cada tabla nueva de `public`. La prueba 82 del
-- Club (rama claude/epic-tesla-pyo77m) marcó 22 tablas fuera del Club (23 con `salary_periods`, que solo existe en staging) donde anon tiene SELECT/INSERT/UPDATE/DELETE
-- que ninguna política para anon o public justifica, y además TRUNCATE, REFERENCES y TRIGGER en todas (las
-- políticas no aplican a esos tres; TRUNCATE ni siquiera pasa por RLS).
-- Hoy NO hay fuga: las 23 tienen RLS prendida y ninguna política deja pasar a anon (las que van «TO public» exigen
-- get_my_role(), que para anon es null; leído en prod el 08-nov). Esto es defensa en profundidad: si mañana alguien
-- apaga la RLS de una tabla o agrega una política floja, anon no hereda nada.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────
--   · A anon le revoca, en cada tabla de la lista que EXISTA (prod no tiene time_punches, punch_exceptions ni
--     salary_periods):
--       - TRUNCATE, REFERENCES y TRIGGER, siempre;
--       - de SELECT/INSERT/UPDATE/DELETE, SOLO los que ninguna política para anon/public justifica (la regla exacta
--         de la prueba 82). Los que sí tienen política «TO public» se dejan: anon igual no pasa (get_my_role() null)
--         y así esta migración no cambia el comportamiento de ninguna política.
--   · Lo mismo a PUBLIC (el pseudo-rol que hereda todo rol, anon incluido): si PUBLIC conservara un permiso, anon lo
--     heredaría aunque se le revoque a anon (Grok, 09-nov). En prod hoy PUBLIC no tiene ninguno (leído el 09-nov); el
--     revoke deja la regla escrita y la verificación lo exige.
--   · Al final verifica (y si no, aborta todo): en ninguna tabla de la lista anon conserva un permiso sin política
--     (has_table_privilege: cuenta lo heredado de PUBLIC) y PUBLIC no tiene ningún permiso (aclexplode, grantee 0).
--   · No toca: authenticated, service_role, políticas, RLS, funciones, vistas, el Club (`club_*` ya está limpio, prueba
--     82) ni los privilegios por defecto (cambiarlos es otra decisión: ver «Después»).
--
-- ── LISTA DE VERIFICACIÓN (antes de firmar; hecha el 08-nov sobre `main` @ 2a05196 y las bases) ─────────────────
--   [x] Rutas sin login de la app (src/App.tsx): `/login` (solo Supabase Auth) y `/registro` (RegistroCliente: inserta
--       en `customers`, que NO está en la lista). Todo lo demás va detrás de PrivateRoute/OwnerRoute (sesión = rol
--       authenticated, no anon).
--   [x] Edge Functions: monthly-report usa service_role; cierre-email, extract-document y pago-notificar usan el JWT
--       del usuario (rol authenticated, después de auth.getUser()); ingest-ndf usa service_role. Ninguna lee estas
--       tablas como anon.
--   [x] club-web (rama del Club): no lee ninguna de estas tablas (solo RPC públicas del Club, SECURITY DEFINER).
--   [x] Funciones SECURITY INVOKER que anon puede ejecutar y nombran alguna de estas tablas: ninguna (prod y staging).
--   [x] Vistas que anon puede leer y usan alguna de estas tablas: ninguna (prod y staging).
--   [x] Realtime (supabase_realtime: tip_sessions, tip_entries, cash_sessions, cash_movements): lo usan sesiones
--       logueadas (authenticated); no cambia.
--   [x] Agentes de las PCs (PoS, BioTime): escriben por Edge con service_role; no cambia.
--   [ ] En staging, con la 089 aplicada: abrir la app SIN sesión (pantalla de login y /registro) y CON sesión de
--       cajero, manager y owner (Caja, Propinas, Ventas, Admin, SoP): nada nuevo en rojo; prueba 82 del Club con
--       «conocidas» = 0 fuera del Club; scripts/sql/089_pruebas.sql en verde.
--
-- ── DESPUÉS (no es parte de esta migración) ──────────────────────────────────────────────────
--   · Privilegios por defecto: cada tabla NUEVA vuelve a nacer con todo para anon. La red es la prueba 82; cambiar
--     `alter default privileges … revoke … from anon` es decisión aparte (afecta a todo lo que se cree después).
--   · Sacar estas tablas de la lista «conocidas» de la prueba 82 cuando la 089 esté en las dos bases.
--
-- Rollback: scripts/sql/089_rollback.sql (devuelve a anon lo que tenía en prod el 08-nov, por tabla, si existe).

begin;

do $$
declare
  v_tablas text[] := array[
    'accounting_entries','cash_movements','cash_sessions','credit_applications','movement_deletions','movement_edits',
    'pos_ndf_cursor','pos_ndf_open','pos_ndf_ticket_lines','pos_ndf_tickets','product_map','punch_exceptions','sops',
    'supplier_credits','suppliers','time_punches','tip_entries','tip_sessions','ventas_comps','ventas_dias','ventas_hist',
    'ventas_metas','salary_periods'];
  v_t text; v_p text; v_resto text;
begin
  foreach v_t in array v_tablas loop
    continue when to_regclass('public.' || v_t) is null;
    execute format('revoke truncate, references, trigger on table public.%I from anon', v_t);
    execute format('revoke all on table public.%I from public', v_t);   -- nada heredable por anon
    foreach v_p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if has_table_privilege('anon', ('public.' || v_t)::regclass, v_p)
         and not exists (select 1 from pg_policies pp
                          where pp.schemaname = 'public' and pp.tablename = v_t
                            and pp.roles && array['anon','public']::name[] and pp.cmd in ('ALL', v_p)) then
        execute format('revoke %s on table public.%I from anon', lower(v_p), v_t);
        raise notice '089: revoke % on % from anon', v_p, v_t;
      end if;
    end loop;
  end loop;

  -- Verificación: si queda algo, se aborta TODO (no queda a medias).
  select string_agg(r.t || ':' || r.p, ', ') into v_resto
    from (select t, p from unnest(v_tablas) t cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
           where to_regclass('public.' || t) is not null
             and has_table_privilege('anon', ('public.' || t)::regclass, p)
             and (p in ('TRUNCATE','REFERENCES','TRIGGER')
                  or not exists (select 1 from pg_policies pp where pp.schemaname = 'public' and pp.tablename = t
                                   and pp.roles && array['anon','public']::name[] and pp.cmd in ('ALL', p)))) r;
  if v_resto is not null then
    raise exception '089: anon conserva permisos sin política: %', v_resto;
  end if;
  select string_agg(c.relname || ':' || a.privilege_type, ', ') into v_resto
    from unnest(v_tablas) t
    join pg_class c on c.oid = to_regclass('public.' || t)
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where a.grantee = 0;
  if v_resto is not null then
    raise exception '089: PUBLIC conserva permisos (anon los heredaría): %', v_resto;
  end if;
end $$;

commit;
