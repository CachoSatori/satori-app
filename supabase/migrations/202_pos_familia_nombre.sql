-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 202 · Ventas v2 3.1b: el dueño pone el NOMBRE de una familia del PoS desde la app      ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- PR 3.1b (SPEC docs/ventas/SPEC-3.1-catalogo.md §2.2, «Rótulos neutros», decisión del dueño 24-nov ~16:30 CR). La 198
-- cargó las familias 7, 8 y 9 con rótulos neutros («Grupo A (surf)»…) porque el nombre real es de terceros y el repo es
-- público. El nombre real lo carga el dueño desde «Ajustes → Catálogo»; hasta acá `pos_familias` no tenía puerta de
-- escritura desde la app. Esta migración trae UNA, la mínima: así el nombre real vive solo en la base, nunca en el repo.
--
-- Agrega (no reemplaza ningún objeto vivo; por eso la guarda no compara md5 de cuerpos, R13: solo frena si la función
-- ya existe o falta lo de la 198):
--   1. `pos_familia_nombre_guardar(p_local, p_familia, p_nombre) returns text`: cambia SOLO el nombre de una familia
--      que YA existe en ese local. Devuelve el nombre como quedó guardado.
--      · Solo el OWNER activo (`get_my_role()` exige `is_active`). Manager, contador y el resto → 42501. `anon` sin execute.
--      · Nombre: sin espacios a los costados ni repetidos, 1 a 40 caracteres, solo letras (con tildes y ñ), números,
--        espacio y ( ) . , - / & ' + #. Otra cosa → 22023 (corta la puerta a texto raro, saltos de línea y correos).
--      · Familia o local desconocidos → 22023. NO crea familias, NO toca categoría ni orden: las carga una migración.
--   2. El comentario de `pos_familias` se actualiza (decía «nadie la edita desde la app»).
--
-- La categoría y el orden de la familia NO se tocan: la categoría por defecto decide qué es venta (6, 17, 20) y su
-- cambio es esquema con firma. El nombre es solo un rótulo: no mueve ningún número.
-- NO toca `pos_ndf_*`, `product_map`, las funciones de la 198 ni la tabla de ajustes.
-- Vuelta atrás: scripts/sql/202_rollback.sql. Pruebas: scripts/sql/202_pruebas.sql (terminan en ROLLBACK).

-- ── 0. Guarda: si ya existe o falta la 198, se para sin tocar nada ───────────────────────
do $guarda202$
begin
  if to_regclass('public.pos_familias') is null or to_regprocedure('public.get_my_role()') is null then
    raise exception '202: falta pos_familias (198) o get_my_role';
  end if;
  if to_regprocedure('public.pos_familia_nombre_guardar(text,integer,text)') is not null then
    raise exception '202: pos_familia_nombre_guardar ya existe: se para sin tocar nada';
  end if;
end
$guarda202$;

-- ── 1. La puerta: solo el nombre, solo el owner ──────────────────────────────────────────
create function public.pos_familia_nombre_guardar(p_local text, p_familia integer, p_nombre text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rol public.user_role := public.get_my_role();
  v_nom text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
begin
  if v_rol is distinct from 'owner' then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_local is null or p_familia is null or v_nom = '' then
    raise exception 'Parámetros inválidos' using errcode = '22023';
  end if;
  if char_length(v_nom) > 40 then
    raise exception 'El nombre tiene más de 40 caracteres' using errcode = '22023';
  end if;
  -- Lista cerrada de caracteres (por punto de código: no depende del locale de la base).
  if v_nom !~ '^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ ().,/&''+#-]+$' then
    raise exception 'El nombre tiene caracteres no permitidos' using errcode = '22023';
  end if;

  update public.pos_familias f set nombre = v_nom
   where f.local = p_local and f.familia = p_familia;
  if not found then
    raise exception 'Familia desconocida en este local' using errcode = '22023';
  end if;
  return v_nom;
end;
$function$;
revoke all on function public.pos_familia_nombre_guardar(text, integer, text) from public, anon;
grant execute on function public.pos_familia_nombre_guardar(text, integer, text) to authenticated;
comment on function public.pos_familia_nombre_guardar(text, integer, text) is
  'Mig 202. Cambia SOLO el nombre de una familia del PoS que ya existe en el local (rótulo; no mueve ningún número). Solo owner activo. Nombre de 1 a 40 caracteres, letras, números y ( ) . , - / & '' + #. No crea familias ni toca categoría u orden.';

-- ── 2. El comentario de la tabla ─────────────────────────────────────────────────────────
comment on table public.pos_familias is
  'Mig 198 (+202). Familias del PoS (FAC_Clasificaciones) por local: nombre y categoría por defecto de sus productos. Las filas, la categoría y el orden los carga una migración; el NOMBRE lo puede cambiar el owner desde la app (pos_familia_nombre_guardar, 202). Una familia sin fila se muestra «Familia N» en «otros».';
