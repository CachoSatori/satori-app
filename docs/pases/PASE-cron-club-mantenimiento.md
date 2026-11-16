# Pase a PROD: recrear la tarea diaria del Club (`club_socios_mantenimiento`) — hallazgo A02

> **⛔ Lleva firma del dueño** (toca `pg_cron` de prod; no toca esquema, plata ni sagrados). Sin firma: solo lectura.
> Si algo no coincide con lo esperado, **se para y se avisa**.
>
> - **Vía:** a mano, editor SQL de Supabase (rol `postgres`), **no** es una migración y **no** depende del merge de este PR
>   (el PR solo trae scripts y este paquete; mergearlo no cambia nada en ninguna base).
> - **Responsables:** ejecución = el dueño o su sesión de CC con firma; control = otra persona/sesión que corre §3 y §5.
> - **Cuándo:** fuera de servicio y **antes del 23-nov 03:15 CR** (primera alta provisional que vence, §1.3).
>   Recomendado: mañana a la mañana (antes de las 15:50) o después de las 23:30.

## 1. Diagnóstico (16-nov, solo lectura en prod)

### 1.1 Qué hay
| Qué | Evidencia (prod, 16-nov ~16:30 CR) | Conclusión |
|---|---|---|
| Cómo se creó | `supabase/migrations/150_club_satori_esquema.sql` l. 5009–5013: `do $$ … perform cron.schedule('club_socios_mantenimiento', '15 9 * * *', …)`. Entró con el merge del #59 (11-nov 23:22 CR) **por Branching** (log de postgres 12-nov 05:23 UTC: CLI con `schema_migrations` y 704 statements). Ningún INSERT directo en `cron.job` en el repo. | Se creó por la API correcta (`cron.schedule`). |
| La fila | `cron.job` jobid 7: `15 9 * * *`, active, `postgres`/`postgres`, `localhost:5432`, comando correcto. `jobid_seq` = 7 (los 5 y 6 se consumieron y no existen). | La definición está bien. |
| Corridas | `cron.job_run_details`: job 7 = **0 filas**; job 4 corrió el **15-nov 08:00 UTC** (después de crear el 7); job 3 el 01-nov. 0 corridas colgadas. | El planificador está vivo y corre otras tareas. |
| Log 16-nov 09:10–09:25 UTC | Solo checkpoints. **Ningún** «cron job 7 starting». El 15-nov 08:00 sí aparece «cron job 4 starting … completed». (`cron.log_run` = on) | El planificador **ni intenta** la 7: no está en su lista en memoria. |
| Planificador | `pg_cron launcher` vivo desde el **28-may** (= `pg_postmaster_start_time`); pg_cron 1.6.4; `use_background_workers` off; `cron.database_name` = postgres; trigger `cron_job_cache_invalidate` habilitado en `cron.job`. | Sin reinicios desde mayo: la lista solo se recarga por el trigger. |
| Staging | Misma 150 aplicada **a mano** (no Branching); tarea jobid 3 corre todos los días (9 corridas, 08-nov → 16-nov 09:15 UTC); launcher vivo desde el 09-jun. | Mismo código, misma versión: en staging sí recargó. |

### 1.2 Causa
- **Comprobado:** la tarea está bien definida, pero el planificador de prod no la tiene en su lista en memoria (0 intentos,
  ni en `job_run_details` ni en el log) aunque sigue corriendo las tareas que cargó antes.
- **Probable, no demostrable en solo lectura:** la recarga que dispara el trigger `cron_job_cache_invalidate` no le llegó al
  planificador cuando Branching creó la tarea (en staging la misma 150 se aplicó a mano y sí llegó). El `do $$` no queda
  en el log (`log_statement` registra DDL; un `DO` no es DDL), así que no se puede ver con qué sesión ni con qué ajustes
  corrió. Para demostrarlo haría falta escribir en `cron.job` de prod (justo el arreglo) o reproducir un Branching en otra
  base.
- **No es:** permisos, horario, base o usuario equivocados, `pg_cron` ausente, ni una falla de la función (nunca se llamó).
- **Por qué el arreglo funciona igual sea cual sea la causa exacta:** cualquier escritura nueva en `cron.job` en una
  transacción propia dispara otra recarga. La tarea de humo (`* * * * *`, `select 1`) lo **prueba en 1–2 minutos** en vez de
  esperar a las 03:15. Si el humo no corre, la recarga no funciona en prod y se pasa al plan B (§7).

### 1.3 Impacto (prod, solo lectura, conteos sin datos personales)
| Qué haría la función hoy | Prod 16-nov | Próxima vez que haría algo |
|---|---|---|
| Altas provisionales vencidas → `pendiente` | **0** (hay 2 activas provisionales; vencen el **23-nov**) | 23-nov 03:15 CR |
| Autoaltas sin validar → purga (30 días) | **0** (1 pendiente, desde el 12-nov) | ~12-dic |
| Contactos de ofertas de turistas (> 24 meses) | **0** | — |
| Premios por referido (Santa Teresa encendido) | **0** candidatos (0 referidos sin premio; `club_premios` vacía; 1 visita de socio) | cuando un referido tenga su primera factura C con el artículo LC |
| Premios disponibles vencidos | **0** | — |

- **Efecto real hasta hoy: ninguno.** Los 5 días sin correr no dejaron nada atrasado.
- **¿Segura de correr de golpe?** Sí. Cada paso filtra lo ya procesado (`estado = 'activo'` y `provisional_hasta < now()`;
  la purga borra el rol que la selecciona; los premios tienen `not exists` por referido y un `pg_advisory_xact_lock`;
  el vencimiento de premios es por estado). Batería caso 6: dos corridas seguidas, la segunda da todo 0.

## 2. Qué pasa y qué no
- **Pasa:** se borra la tarea jobid 7 y se crea igual (mismo nombre, horario, comando y usuario; jobid nuevo). Se programa
  `club_cron_humo` por unos minutos y se borra (con sus filas de `job_run_details`).
- **No pasa:** no se ejecuta `club_socios_mantenimiento` a mano; no cambia esquema, ledger, funciones, Edge, secretos ni
  datos del Club; no se tocan las tareas de reportes (3 y 4).
- **Correr la función una vez a mano: no hace falta** (hoy daría todo 0, §1.3). La primera corrida programada es la
  03:15 CR siguiente al pase, que es fuera de servicio. Si el dueño igual quiere verla, `select public.club_socios_mantenimiento();`
  como `postgres` fuera de servicio, y anotar el JSON.

## 3. Antes (prod, solo lectura)
```sql
begin read only;
select jobid, jobname, schedule, active, username, database, command from cron.job order by jobid;   -- 3, 4, 7 como §1.1
select jobid, count(*), max(start_time) from cron.job_run_details group by 1 order by 1;             -- sin 7
select backend_start from pg_stat_activity where backend_type = 'pg_cron launcher';                  -- 2026-05-28…
rollback;
```

## 4. Prueba en staging
| Qué | Resultado |
|---|---|
| `scripts/sql/cron_club_mantenimiento_pruebas.sql` (begin … **rollback**, 16-nov 16:30 CR) | ✅ 6/6: recrea con jobid nuevo · idempotente (2 corridas → 1 y 1) · reactiva una tarea apagada · crea si falta · corrige el horario · la función 2 veces seguidas: la segunda da todo 0. Los asserts 3, 4 y 5 muerden (el chequeo detecta el estado roto antes de arreglarlo). Después: staging con su jobid 3 intacto. |
| `cron_club_mantenimiento.sql` + humo **confirmado** en staging | ⏳ **Pendiente.** La sesión no pudo escribir fuera de una transacción descartada (escritura bloqueada por el permiso de la sesión). Queda para una sesión con OK del dueño: correr los dos scripts en staging, ver el humo con corridas y la tarea diaria con jobid nuevo corriendo a las 03:15 CR del día siguiente. En staging no cambia nada visible (misma tarea, otro jobid). |

## 5. El pase (prod, con firma)
1. §3 «antes» y anotarlo en §9.
2. `scripts/sql/cron_club_mantenimiento.sql` completo. Esperado: `NOTICE OK: club_socios_mantenimiento = jobid 8, club_cron_humo = jobid 9`
   (números aproximados) y la lista final con las dos tareas.
3. Esperar **2–3 minutos**. Leer:
   ```sql
   select j.jobname, d.status, count(*) from cron.job_run_details d join cron.job j using (jobid)
    where j.jobname = 'club_cron_humo' group by 1, 2;            -- succeeded ≥ 1
   ```
4. `scripts/sql/cron_club_mantenimiento_humo_cierre.sql`. Esperado: `NOTICE OK: humo con N corridas, borrado…`.
5. **Después** (solo lectura): `cron.job` = 3, 4 y la nueva `club_socios_mantenimiento` (`15 9 * * *`, active, postgres);
   sin `club_cron_humo`. Tareas 3 y 4 sin cambios.
6. **Al día siguiente, 03:16 CR o después** (control):
   ```sql
   select d.status, d.return_message, d.start_time from cron.job_run_details d join cron.job j using (jobid)
    where j.jobname = 'club_socios_mantenimiento' order by d.start_time desc limit 3;   -- 1 fila succeeded, "1 row"
   ```
   El JSON de la corrida no queda en `job_run_details` (solo «1 row»); los efectos se ven en `club_miembro_roles` /
   `club_auditoria`. Repetir el chequeo el **23-nov** (primer vencimiento real): las 2 provisionales pasan a `pendiente`
   salvo que se hayan confirmado antes.

## 6. Criterios de parada
- §3 no coincide con §1.1 (p. ej. la 7 ya corrió, o alguien la tocó): se para y se rehace el diagnóstico.
- El script 1 aborta con «PARAR…»: no quedó nada (es una transacción); se avisa con el mensaje.
- Paso 3: el humo tiene **0 corridas a los 3 minutos** → §7 plan B. **No** correr el cierre del humo; dejarlo programado
  hasta decidir (es `select 1`, no hace nada).
- Paso 6: 0 filas o `failed` → avisar con el `return_message`.

## 7. Plan B (si el humo no corre)
El planificador de prod no recarga su lista. Opciones, por orden:
1. **Reiniciar la base** desde el panel de Supabase (Settings → General → Restart project), fuera de servicio: el
   planificador arranca de cero y carga todas las tareas de `cron.job` (los reportes 3 y 4 incluidos). Corte de 1–3 minutos
   de la app. Lleva firma aparte.
2. Ticket a soporte de Supabase con la evidencia de §1.1.
Después de cualquiera: repetir el paso 3 (humo) y el 4.

## 8. Vuelta atrás
- `scripts/sql/cron_club_mantenimiento_rollback.sql`: borra el humo si quedó. Con decisión del dueño, **apaga** (no borra) la
  tarea diaria (`cron.alter_job(…, active := false)`).
- Lo que la función ya haya hecho (vencer una provisional, purgar una autoalta) no se deshace con el script: queda en
  `club_auditoria` y se corrige caso por caso desde Club → Socios con el owner.
- No hay migración, ledger ni PR que revertir.

## 9. Firma y bitácora
| Paso | Esperado | Resultado (hora CR) |
|---|---|---|
| Firma del dueño (SHA de este PR) | | |
| §3 antes | 3, 4, 7 · sin corridas de la 7 · launcher 28-may | |
| §5.2 script | OK + 2 tareas | |
| §5.3 humo | succeeded ≥ 1 | |
| §5.4 cierre del humo | OK | |
| §5.5 después | 3, 4 y la nueva; sin humo | |
| §5.6 día siguiente | 1 succeeded | |

## 10. Aparte (visto durante el diagnóstico, no se toca acá)
- Log de prod 15-nov 08:00:02 UTC, 2 s después del reporte quincenal (job 4): `date/time field value out of range: "2026-09-31"`.
  Parece venir de `monthly-report` armando una fecha «día 31» para septiembre. Vale un hallazgo propio.
