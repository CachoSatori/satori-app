-- ── 065 · pos_ndf_open: productos comandados de la mesa abierta (desplegable de «En vivo») ───
--
-- UNA columna nueva, NULLABLE, SIN default, jsonb. Solo ADD COLUMN: no se toca ninguna columna
-- ni tipo existente. Es INFORMATIVA y PROVISIONAL: la arma el agente desde el detalle del
-- pedido abierto (FAC_PedidosDet ⋈ FAC_Productos.Nombre) mientras la mesa sigue abierta, y
-- NUNCA entra en la neta, en «Hoy», en el cuadre, en pos_ndf_tickets ni en ningún sagrado.
--
-- Forma: array de objetos { "nombre": text, "cantidad": numeric }, AGRUPADO por producto
-- (cantidad total), ordenado por cantidad desc. Alcance firmado por Ismael (2026-09-10): TODOS
-- los productos comandados —cortesías incluidas— EXCEPTO los marcadores de pax (677 / 678) y
-- las líneas anuladas. Sin ₡ por línea en v1.
--
-- Fail-closed en toda la cadena: si el agente no puede leer el detalle, o alguna línea viene
-- sin nombre de catálogo, manda null y la pantalla no muestra desplegable. Un array vacío no
-- se guarda: también viaja como null.
--
-- ⚠️ NO APLICAR sin la firma del SQL de Ismael. Compatible hacia atrás: el agente y la Edge que
-- corren hoy siguen escribiendo sin esta columna, y queda en null. El frontend que la lee
-- (`getMesasAbiertas`) NO puede desplegarse a staging antes que esta migración: PostgREST
-- rechaza el SELECT de una columna que no existe y el panel entero se cae.

alter table public.pos_ndf_open
  add column if not exists detalle_productos jsonb;

comment on column public.pos_ndf_open.detalle_productos is
  'Productos comandados en el pedido abierto, agrupados por producto: [{nombre, cantidad}], ordenado por cantidad desc. Excluye los marcadores de pax (677/678) y las lineas anuladas; incluye cortesias y todo lo demas. Informativo y provisional: NO es venta, nunca entra en neta ni en cuadre. null = no se pudo leer el detalle o alguna linea vino sin nombre de catalogo (fail-closed); nunca un array vacio.';
