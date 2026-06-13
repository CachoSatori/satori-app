-- 032: Jerarquía de menú — nivel FAMILIA por encima de la categoría (editable por la
-- dueña desde el Gestor; NO hardcodeado). ADITIVA e idempotente.

-- ── 1. Familias (4, con orden e ícono) ──
create table if not exists public.menu_families (
  id         text primary key,            -- comida | bebida | merch | interno
  label      text not null,
  icon       text not null default '',
  sort_order int  not null default 0
);
insert into public.menu_families (id, label, icon, sort_order) values
  ('comida',  'Comida',  '🍱', 1),
  ('bebida',  'Bebida',  '🍹', 2),
  ('merch',   'Merch',   '🛍️', 3),
  ('interno', 'Interno', '🏠', 4)
on conflict (id) do nothing;

-- ── 2. Mapeo categoría → familia (editable). category = product_map.tipo ──
create table if not exists public.menu_categories (
  category          text primary key,     -- = product_map.tipo
  family_id         text references public.menu_families(id),
  subfamily         text not null default '',   -- agrupador opcional dentro de Interno
  hidden_comandero  boolean not null default false,  -- A PAX = true
  sort_order        int not null default 0
);

-- seed del mapeo EXACTO del sprint (idempotente: solo categorías nuevas).
-- hidden_comandero default false; A PAX se marca en el UPDATE de abajo.
insert into public.menu_categories (category, family_id, subfamily, sort_order) values
  -- 🍱 Comida
  ('SUSHI ROLLS',          'comida',  '', 1),
  ('TAPAS ASIATICAS',      'comida',  '', 2),
  ('POKES BOWLS CEVICHES', 'comida',  '', 3),
  ('POSTRES',              'comida',  '', 4),
  ('GREENSEASON',          'comida',  '', 5),
  ('KIDS MENU',            'comida',  '', 6),
  ('comida',               'comida',  '', 7),     -- legacy
  -- 🍹 Bebida
  ('BEBIDAS',              'bebida',  '', 1),
  ('bebida',               'bebida',  '', 2),     -- legacy
  -- 🛍️ Merch
  ('TSHIRTS',              'merch',   '', 1),
  ('REMERAS',              'merch',   '', 2),
  ('T-GORRAS',             'merch',   '', 3),
  ('T-STICKERS',           'merch',   '', 4),
  ('T-DARUMAS',            'merch',   '', 5),
  ('GIFT CARDS',           'merch',   '', 6),
  ('merchandising',        'merch',   '', 7),     -- legacy
  ('nofood',               'merch',   '', 8),     -- legacy
  -- 🏠 Interno
  ('PERSONAL',             'interno', 'In-House',  1),
  ('XX DUEÑOS',            'interno', 'In-House',  2),
  ('personal',             'interno', 'In-House',  3),   -- legacy
  ('X CORTESIAS',          'interno', 'Cortesías', 4),
  ('cortesia',             'interno', 'Cortesías', 5),   -- legacy
  ('PROMOCIONES',          'interno', 'Eventos',   6),
  ('EVENTOS TERRAZA',      'interno', 'Eventos',   7),
  ('MENU AÑO NUEVO',       'interno', 'Eventos',   8),
  -- oculto del comandero (el pax se pide al abrir la mesa)
  ('A PAX',                'interno', 'Eventos',   99)
on conflict (category) do nothing;

update public.menu_categories set hidden_comandero = true where category = 'A PAX';

-- ── 3. Bebidas → estación 'barra' (el XLS no traía estación; default era 'cocina').
--       La dueña ajusta excepciones después en el Gestor. ──
update public.product_map pm
set station = 'barra', updated_at = now()
from public.menu_categories mc
where upper(trim(pm.tipo)) = upper(trim(mc.category))
  and mc.family_id = 'bebida'
  and pm.station <> 'barra';

-- ── RLS (lectura para todos los autenticados; escritura gerencia) ──
alter table public.menu_families  enable row level security;
alter table public.menu_categories enable row level security;
drop policy if exists "menu_families_select" on public.menu_families;
create policy "menu_families_select" on public.menu_families for select using (auth.role() = 'authenticated');
drop policy if exists "menu_families_write" on public.menu_families;
create policy "menu_families_write" on public.menu_families for all
  using (get_my_role() = any (array['owner'::user_role, 'manager'::user_role]));
drop policy if exists "menu_categories_select" on public.menu_categories;
create policy "menu_categories_select" on public.menu_categories for select using (auth.role() = 'authenticated');
drop policy if exists "menu_categories_write" on public.menu_categories;
create policy "menu_categories_write" on public.menu_categories for all
  using (get_my_role() = any (array['owner'::user_role, 'manager'::user_role]));
