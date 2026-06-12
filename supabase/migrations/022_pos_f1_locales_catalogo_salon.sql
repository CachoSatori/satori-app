-- 022: PoS F1 — multi-local + catálogo con modificadores + salón (ROADMAP "PoS Satori + KDS").
-- ADITIVA e idempotente: solo CREA tablas nuevas; las existentes NO se alteran.
-- Adopción futura de location_id en tablas existentes (cash_*, tip_*, ventas_*):
-- se hará en F4 (réplica Nosara) como columnas nullable con backfill 'santa-teresa',
-- para no tocar el flujo de producción en F1. Las tablas NUEVAS del PoS ya nacen
-- con location_id obligatorio.

-- ── Locales ──────────────────────────────────────────────────
create table if not exists public.locations (
  id          text primary key,              -- slug estable ('santa-teresa', 'nosara')
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.locations (id, name) values
  ('santa-teresa', 'Satori Santa Teresa'),
  ('nosara',       'Satori Nosara')
on conflict (id) do nothing;

-- ── Catálogo: grupos de modificadores ────────────────────────
-- Montado SOBRE product_map (no lo altera): el vínculo vive en una tabla puente.
-- Caso de referencia: "Mojito" + grupo OBLIGATORIO "Licor" (Flor de Caña +0 / Zacapa +X).
create table if not exists public.modifier_groups (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  required        boolean not null default false,   -- obligatorio: bloquea el envío sin selección
  min_selections  int not null default 0 check (min_selections >= 0),
  max_selections  int not null default 1 check (max_selections >= 1),
  location_id     text not null default 'santa-teresa' references public.locations(id),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (max_selections >= min_selections)
);

create table if not exists public.modifiers (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.modifier_groups(id) on delete cascade,
  name            text not null,
  price_delta_crc numeric(12,2) not null default 0,  -- delta sobre el precio base (puede ser 0)
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists idx_modifiers_group on public.modifiers(group_id);

-- Vínculo producto ↔ grupo de modificadores. product_map tiene PK por NOMBRE
-- (text) — el vínculo usa ese nombre, igual que ventas/recetas.
create table if not exists public.product_modifier_groups (
  product_name text not null references public.product_map(nombre) on delete cascade,
  group_id     uuid not null references public.modifier_groups(id) on delete cascade,
  sort_order   int not null default 0,
  primary key (product_name, group_id)
);

-- ── Salón ────────────────────────────────────────────────────
create table if not exists public.salon_tables (
  id          uuid primary key default gen_random_uuid(),
  location_id text not null references public.locations(id),
  name        text not null,                    -- "Mesa 1", "Barra 2", "Deck A"
  capacity    int not null default 2 check (capacity >= 1),
  shape       text not null default 'square' check (shape in ('square', 'round', 'bar')),
  pos_x       int not null default 0,           -- posición en el plano (px del editor)
  pos_y       int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_salon_tables_location on public.salon_tables(location_id);

-- ── RLS (patrón real del esquema: lectura autenticada, gestión owner/manager) ──
alter table public.locations               enable row level security;
alter table public.modifier_groups         enable row level security;
alter table public.modifiers               enable row level security;
alter table public.product_modifier_groups enable row level security;
alter table public.salon_tables            enable row level security;

do $$
declare t text;
begin
  foreach t in array array['locations','modifier_groups','modifiers','product_modifier_groups','salon_tables'] loop
    execute format('drop policy if exists "pos_%s_select" on public.%I', t, t);
    execute format('create policy "pos_%s_select" on public.%I for select using (auth.role() = ''authenticated'')', t, t);
    execute format('drop policy if exists "pos_%s_write" on public.%I', t, t);
    execute format(
      'create policy "pos_%s_write" on public.%I for all using (get_my_role() = any (array[''owner''::user_role, ''manager''::user_role]))', t, t);
  end loop;
end $$;
