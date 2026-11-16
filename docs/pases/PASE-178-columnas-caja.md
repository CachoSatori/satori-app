# Pase a PROD de la mig 178 `esquema_columnas_caja_como_prod` (origen caja 098)

> **Lleva firma: esquema (sin efecto en prod).** Decisión del dueño por el chat, 16-nov-2026 06:45 -06:00: «177 firmo A»
> (opción A del PASE-177 §2b: declarar las 5 columnas en el repo sin efecto en prod). El merge sigue necesitando el OK
> del dueño sobre el SHA exacto. Si algo no coincide con lo que dice acá, **se para y se avisa**.
>
> - **Vía:** merge → Branching (como la 177). No se aplica nada a mano.
> - **Orden:** va después de la 177 (ya en el ledger de prod). La **179** está reservada para otra rama del 16/11: si
>   la 179 entra antes a `main`, la 178 ya no puede entrar con su número (Branching no aplica una versión menor que la
>   última) y hay que renumerarla.
> - **Regla del ledger:** exactamente 1 fila `178` con su `name`. No se compara md5.

## 1. Qué pasa y qué no
- **Pasa en PROD:** nada. La 178 lee `pg_attribute`, ve que las 5 columnas ya existen y no ejecuta ningún `ALTER` (ni
  lock de tabla: se mira el catálogo **antes**, porque un `ALTER TABLE … ADD COLUMN IF NOT EXISTS` toma el lock
  exclusivo de la tabla aunque la columna exista). Después verifica que las 5 son idénticas a lo de §2 (en prod lo
  son). Solo agrega la fila 178 al ledger.
- **Pasa en una base nueva armada desde el repo:** se crean las 5 columnas con el tipo, default y nullability de prod
  (quedan al final de la tabla; en prod están en otra posición, nadie depende del orden).
- **No pasa:** ni datos, ni funciones, ni políticas, ni comentarios, ni sagrados, ni Edge. Nada que vea el personal.

## 2. Las 5 columnas (lectura en PROD, solo `SELECT`, 16-nov-2026 mañana -06:00)
| Columna | Tipo (`format_type`) | Null | Default | Comentario | Constraints | Índices | Repo antes de la 178 |
|---|---|---|---|---|---|---|---|
| `cash_movements.amount_usd` | `numeric` | sí | `0` | — | — | — | no existe |
| `cash_sessions.initial_cash_crc` | `numeric` | sí | `0` | — | — | — | no existe |
| `cash_sessions.initial_cash_usd` | `numeric` | sí | `0` | — | — | — | no existe |
| `cash_sessions.final_cash_crc` | `numeric` | sí | (sin default) | — | — | — | no existe |
| `cash_sessions.final_cash_usd` | `numeric` | sí | (sin default) | — | — | — | no existe |

Sin identity ni columnas generadas; sin ACL por columna. Están en la publicación `supabase_realtime` (las dos tablas
van completas).

### 2b. Quién las usa
- **Prod:** ninguna vista ni política. Funciones que leen o escriben `cash_movements.amount_usd`: `cerrar_dia_completo`
  (071/074) y `log_movement_edit` (trigger de auditoría de ediciones). Ninguna función usa las 4 de `cash_sessions`.
- **App:** `CashTurno` abre el turno con `initial_cash_crc` (0: la registradora la maneja el PoS) e `initial_cash_usd`, y
  lo cierra con `final_cash_crc` / `final_cash_usd`; `CashResumen` y `ResumenDiario` las muestran; los pagos y
  movimientos guardan `amount_usd` (`src/shared/api/cash.ts`, `CashTurno`, `CashMovimientos`, Bandeja). Los tipos
  generados (`supabase.gen.ts`) ya las tienen.
- **Por qué existen:** se crearon a mano en prod antes del baseline (como los tipos que arregló la 177) y nunca se
  escribieron en una migración. En prod tienen uso real (todos los movimientos y todos los turnos tienen valor).

## 3. Prerrequisitos
- PR en borrador con revisión y OK del dueño sobre el SHA exacto (decisión: «177 firmo A»).
- La 177 en el ledger de prod (sí: lectura del 16/11, ledger **91 filas, última 177**).
- Que la 179 no haya entrado antes (ver arriba).
- Ventana de merge (regla D1): libre de 23:30 a 15:50; nunca de 15:50 a 19:00.

## 4. Lecturas previas en prod (solo lectura)
Tomadas el 16-nov-2026 por la mañana (-06:00): ledger 91 filas, última 177, sin fila 178; las 5 columnas como §2.
Re-tomar justo antes del merge; si alguna columna no coincide con §2, **se para**:
```sql
begin read only;
select c.relname||'.'||a.attname as col, format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull,
       pg_get_expr(d.adbin, d.adrelid) as def, col_description(c.oid, a.attnum) as comentario
  from pg_attribute a join pg_class c on c.oid = a.attrelid
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 where c.relnamespace = 'public'::regnamespace and not a.attisdropped
   and ((c.relname = 'cash_movements' and a.attname = 'amount_usd')
     or (c.relname = 'cash_sessions' and a.attname in ('initial_cash_crc','initial_cash_usd','final_cash_crc','final_cash_usd')))
 order by 1;
select relname, relfilenode from pg_class where relnamespace = 'public'::regnamespace
   and relname in ('cash_movements','cash_sessions') order by 1;
select count(*), max(version) from supabase_migrations.schema_migrations;
rollback;
```
Anotar los `relfilenode` el día del pase (antes del merge).

## 5. Pruebas
- **Base local** (Postgres 16, `PGHOST=/tmp PGPORT=5499`): `bash scripts/sql/178_pruebas.sh` → arma una base desde el
  repo y corre `scripts/sql/178_pruebas.sql` en dos transacciones descartadas. Resultado: **12/12** y **6/6 mutaciones
  muerden**.
  - Parte A (base «repo antes de la 178»: la batería borra las 5 columnas): después de la 178 las 5 son idénticas a prod
    (tipo, null, default, sin comentario, constraint, índice, identity) · 5 `ALTER TABLE` en la 1.ª corrida · 0 en la
    2.ª (idempotente) · un insert sin esas columnas guarda 0 / 0 / 0 / null / null · si una existe distinta a prod
    (p. ej. `numeric(12,2)`), aborta con «178: …» y no cambia nada.
  - Parte B (base «como PROD», con las 5 ya creadas, transacción nueva): **0 `ALTER TABLE`** (trigger de evento
    `ddl_command_end`, cuyo funcionamiento prueba un ALTER de control), **0 locks** sobre `cash_movements` y
    `cash_sessions` (`pg_locks` de la sesión) y ninguna tabla reescrita (`relfilenode` igual).
  - Mutaciones: sin la guarda del catálogo → caen 04, 08 y 09 (en prod tomaría el lock) · sin `amount_usd` en la lista,
    default distinto, escala `numeric(12,2)` o `not null` → cae 02 · sin la verificación final → cae 07.
- Regresión: `scripts/sql/177_pruebas.sh` sigue 10/10 y 4/4 (su caso 08 ya no encuentra columnas faltantes).
- **Staging:** no aplica (la batería borra columnas y crea un trigger de evento: solo base local).

## 6. Humo después (solo lectura)
- Ledger: exactamente 1 fila `178` con `name = esquema_columnas_caja_como_prod`; check «Supabase Preview» en success con
  «All migrations are up to date».
- La consulta de §4: **igual que antes** (mismas definiciones y mismos `relfilenode`).
- Caja sigue registrando: un turno se abre y se cierra y un pago en dólares se guarda como antes.

## 7. Criterios de parada
Un error de Branching, un `relfilenode` distinto, una definición distinta de §2, o la 179 ya en el ledger → se para, se
avisa y se evalúa §8.

## 8. Vuelta atrás
- En prod **no hay nada que deshacer** (la 178 no ejecutó ningún ALTER). `scripts/sql/178_rollback.sql` parte A solo
  lee y confirma las 5 columnas (esperado: 0 filas). **No** se borran las columnas en prod (tienen datos reales de caja y
  la app las usa), **no** se borra la fila 178 del ledger y **no** se saca el `.sql` de `main` (regla 10). Cualquier
  ajuste: migración nueva.
- En una base **nueva** armada desde el repo: parte B del mismo archivo (comentada; `drop column if exists` de las 5,
  aborta si la base tiene turnos o movimientos). Probada en local.

## 9. Responsables
- **Ejecución:** el dueño (merge, o autoriza el merge).
- **Control:** otra persona o sesión que no ejecuta (lecturas de §4 y §6).

## 10. Firma y bitácora
| Cuándo (-06:00) | Qué | Quién | Resultado |
|---|---|---|---|
| 2026-11-16 06:45 | Decisión «177 firmo A» (esquema, sin efecto en prod) | dueño (chat) | — |
| 2026-11-16 mañana | Lectura previa en prod (solo `SELECT`) | sesión de Claude Code | ledger 91 filas, última 177; 5 columnas como §2 |
| | Merge → Branching | | |
| | Humo después | | |
