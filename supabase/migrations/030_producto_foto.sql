-- 030: Foto de producto (patrón Lavu — foto en el tile del menú).
-- ADITIVA e idempotente. No toca caja ni la matemática.

-- ── 1. URL de la foto del producto (nullable: el tile cae con gracia si no hay) ──
alter table public.product_map add column if not exists photo_url text;

-- ── 2. Bucket PÚBLICO 'productos': las fotos de menú no son sensibles → URL pública
--       (cacheable por el navegador/SW, sirve offline una vez vista, sin firmas que
--       expiren). Sube admin (owner/manager); lee cualquiera. ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('productos', 'productos', true, 2097152,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- lectura pública (cualquiera, incl. anon — es un bucket público)
drop policy if exists "productos_select" on storage.objects;
create policy "productos_select" on storage.objects for select
  using (bucket_id = 'productos');

-- escritura/borrado: solo gerencia (Gestor de Productos)
drop policy if exists "productos_insert" on storage.objects;
create policy "productos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'productos' and get_my_role()::text in ('owner','manager'));

drop policy if exists "productos_update" on storage.objects;
create policy "productos_update" on storage.objects for update to authenticated
  using (bucket_id = 'productos' and get_my_role()::text in ('owner','manager'));

drop policy if exists "productos_delete" on storage.objects;
create policy "productos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'productos' and get_my_role()::text in ('owner','manager'));
