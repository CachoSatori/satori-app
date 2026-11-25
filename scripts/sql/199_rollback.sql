-- 199 · vuelta atrás. ANTES: guardar lo que cargó una persona (no se puede rehacer):
--   select * from public.fe_receptores order by cedula;
-- Con comprobantes reales ingeridos NO se borra (satori-migraciones-y-prod §6): se apaga el disparador del script
-- (o se quita el secreto FE_INGESTA_SECRET) y se corrige con una migración nueva.
-- El bucket `fe-xml` se vacía ANTES por la API de Storage (Storage no deja borrar objetos por SQL); si tiene objetos,
-- el `delete` del bucket de abajo falla y la vuelta atrás se para entera (es una sola transacción).
-- Y, en el mismo momento, el PR que saca el .sql de main (si queda, Branching lo reaplica). Si la 199 ya está en el
-- ledger de prod, el .sql NO se borra (regla 10): la vuelta atrás es una migración nueva con este cuerpo.
drop function if exists public.fe_ingesta_resumen(integer);
drop function if exists public.fe_latido(text);
drop function if exists public.fe_bitacora_anotar(text, text, text, text, text);
drop function if exists public.fe_respuesta_registrar(jsonb);
drop function if exists public.fe_ingestar(jsonb);
drop table if exists public.fe_ingesta_latido;
drop table if exists public.fe_ingesta_bitacora;
drop table if exists public.fe_respuestas;
drop table if exists public.fe_lineas;
drop table if exists public.fe_comprobantes;
drop table if exists public.fe_receptores;
drop function if exists public.fe_receptores_sello();
delete from storage.buckets where id = 'fe-xml';
