-- 016 — Bandeja de documentos (Fase 2D-B: ingesta por foto)
-- Fotos de facturas/comprobantes entran acá; la IA las lee (raw_json) y el
-- humano confirma → se enlaza a un cash_movements.

create table if not exists public.documents (
  id                 uuid primary key default gen_random_uuid(),
  image_path         text not null,                 -- ruta en Storage bucket 'documents'
  sha256             text,                            -- hash de la imagen (anti-duplicado)
  clave_fe           text,                            -- clave Factura Electrónica CR (50 díg.)
  tipo               text,                            -- factura | comprobante_pago | otro
  raw_json           jsonb,                           -- salida de la IA de visión
  estado             text not null default 'nuevo',   -- nuevo | procesado | descartado
  linked_movement_id uuid references public.cash_movements(id) on delete set null,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now()
);
create index if not exists documents_estado_idx on public.documents (estado, created_at desc);
create index if not exists documents_sha_idx     on public.documents (sha256);
create index if not exists documents_clavefe_idx  on public.documents (clave_fe);

-- Alias de proveedores para fuzzy-match de la IA (Fase C lo usará a fondo)
alter table public.suppliers add column if not exists aliases text[];

-- RLS: operativo + administración pueden ver/cargar/confirmar
alter table public.documents enable row level security;
drop policy if exists documents_rw on public.documents;
create policy documents_rw on public.documents for all
  using      (public.get_my_role() in ('owner','manager','contador','cajero'))
  with check (public.get_my_role() in ('owner','manager','contador','cajero'));

-- Storage: bucket privado 'documents'
insert into storage.buckets (id, name, public)
values ('documents','documents', false)
on conflict (id) do nothing;

drop policy if exists documents_storage_rw on storage.objects;
create policy documents_storage_rw on storage.objects for all
  using      (bucket_id = 'documents' and public.get_my_role() in ('owner','manager','contador','cajero'))
  with check (bucket_id = 'documents' and public.get_my_role() in ('owner','manager','contador','cajero'));
