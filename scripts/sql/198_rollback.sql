-- 198 · vuelta atrás. ANTES: guardar lo que cargó una persona («rinde» y categoría; no se puede rehacer):
--   select * from public.pos_producto_ajustes order by local, codigo;
-- Y, en el mismo momento, el PR que saca el .sql de main (si queda, Branching lo reaplica). Si la 198 ya está
-- en el ledger de prod, el .sql NO se borra (regla 10): la vuelta atrás es una migración nueva con este cuerpo.
drop trigger if exists trg_pos_catalogo_registrar on public.pos_ndf_ticket_lines;
drop function if exists public.pos_ventas_productos(text, date, date);
drop function if exists public.pos_catalogo_productos(text);
drop function if exists public.pos_producto_ajuste_guardar(text, text, integer, text);
drop function if exists public.pos_categoria_efectiva(integer, text, text);
drop function if exists public.pos_catalogo_refrescar(text);
drop function if exists public.pos_catalogo_registrar();
drop function if exists public.pos_catalogo_absorber(uuid[]);
drop table if exists public.pos_producto_ajustes;
drop table if exists public.pos_productos;
drop table if exists public.pos_familias;
