-- 203 · vuelta atrás. Saca la puerta y devuelve el comentario de la 198. Los nombres que el owner ya cambió QUEDAN como
-- quedaron (son datos y no se pueden rehacer; el nombre real no se copia al repo). Si hiciera falta volver a los rótulos
-- neutros, es una migración nueva con su firma. La app sin la función: «Ajustes → Catálogo» muestra el error al guardar
-- un nombre y todo lo demás sigue igual (no hace falta revertir código).
-- Y, en el mismo momento, el PR que saca el .sql de main (si queda, Branching lo reaplica). Si la 203 ya está en el
-- ledger de prod, el .sql NO se borra (regla 10): la vuelta atrás es una migración nueva con este cuerpo.
drop function if exists public.pos_familia_nombre_guardar(text, integer, text);
comment on table public.pos_familias is
  'Mig 198. Familias del PoS (FAC_Clasificaciones) por local: nombre y categoría por defecto de sus productos. La carga la migración; nadie la edita desde la app. Una familia sin fila se muestra «Familia N» en «otros».';
