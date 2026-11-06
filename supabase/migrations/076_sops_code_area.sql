-- ============================================================================
-- 076_sops_code_area.sql — SoP noviembre 2026: código, área y metadatos
-- ----------------------------------------------------------------------------
-- El paquete de SoP de noviembre 2026 ordena los documentos por área
-- (1. Cultura y servicio … 5. Equipo) y por código (1.1, 2.5, 4.1…).
-- Esta migración SOLO AGREGA columnas, todas opcionales:
--   · code          → código del documento ("2.5"). Único entre las filas que lo tienen.
--   · area          → una de las 5 áreas ("2. Salón y recepción").
--   · doc_type      → 'SOP' o 'Documento'.
--   · version       → versión del paquete ("2026-11").
--   · employee_book → si va en el libro del empleado.
--   · pdf_path      → ruta del PDF en Storage (se usa en un PR posterior).
-- `category`, `display_order` y la RLS (010) no cambian: el editor y las filas
-- viejas siguen funcionando igual. Las filas sin `code` (las viejas) quedan con NULL.
-- Número 076: el ledger de STAGING ya tiene 074 (cierre_primer_conteo) y
-- 075 (club_satori_esquema).
-- Idempotente.
-- ============================================================================

begin;

alter table public.sops
  add column if not exists code          text,
  add column if not exists area          text,
  add column if not exists doc_type      text,
  add column if not exists version       text,
  add column if not exists employee_book boolean not null default false,
  add column if not exists pdf_path      text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sops_doc_type_check') then
    alter table public.sops
      add constraint sops_doc_type_check check (doc_type is null or doc_type in ('SOP', 'Documento'));
  end if;
end $$;

-- Único solo entre filas con código: las filas viejas (code NULL) no chocan entre sí.
create unique index if not exists sops_code_key on public.sops (code) where code is not null;

comment on column public.sops.code          is 'Código del documento (ej. 2.5). Único cuando no es NULL.';
comment on column public.sops.area          is 'Área del paquete de SoP (ej. "2. Salón y recepción"). NULL = sin área (se agrupa por category).';
comment on column public.sops.doc_type      is 'SOP o Documento.';
comment on column public.sops.version       is 'Versión del paquete (ej. 2026-11).';
comment on column public.sops.employee_book is 'Si el documento va en el libro del empleado.';
comment on column public.sops.pdf_path      is 'Ruta del PDF en Storage (bucket documents), NULL si no tiene.';

commit;
