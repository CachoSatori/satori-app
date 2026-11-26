-- 200 · vuelta atrás. Solo saca la función: la 200 no crea tablas ni cambia datos (los pagos que ya cambió quedan
-- como quedaron, igual que con el camino viejo). Antes de correrla, la app tiene que volver al camino de #361: el
-- aparato lo hace solo si la función no está (cae al alta + borrado de siempre), así que no hace falta revertir código.
-- Y, en el mismo momento, el PR que saca el .sql de main (si queda, Branching lo reaplica). Si la 200 ya está en el
-- ledger de prod, el .sql NO se borra (regla 10): la vuelta atrás es una migración nueva con este cuerpo.
drop function if exists public.reemplazar_pago_caja(uuid, jsonb, text, text);
drop function if exists public._reemplazo_pago_coincide(public.cash_movements, jsonb);
