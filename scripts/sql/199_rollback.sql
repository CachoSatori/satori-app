-- 199 · vuelta atrás. ANTES: guardar lo que cargó una persona (no se puede rehacer):
--   select * from public.fe_receptores order by cedula;
-- Con comprobantes reales ingeridos NO se borra (satori-migraciones-y-prod §6): se apaga el disparador del script
-- (o se quita el secreto FE_INGESTA_SECRET) y se corrige con una migración nueva.
-- Este .sql NO toca storage.buckets ni storage.objects: Supabase frena todo `delete` directo sobre esas tablas (trigger
-- storage.protect_delete, 42501 «Use the Storage API») y eso pararía la transacción entera. El bucket `fe-xml` se vacía
-- y se borra DESPUÉS, como paso aparte por la API de Storage (docs/pases/PASE-199-fe-ingesta.md §6, con el comando).
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
