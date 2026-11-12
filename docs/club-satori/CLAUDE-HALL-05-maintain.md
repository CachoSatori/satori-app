# CLAUDE-HALL-05 · `authenticated` con MAINTAIN en 75 tablas de `public` — diagnóstico y propuesta

> Hallazgo propio (no es un ítem del auditor). 09-nov. **Solo diagnóstico y propuesta: no se aplicó nada.** Lecturas en
> STAGING, de solo lectura, **después** de la 089 y la 090 de caja (aplicadas esta mañana).

## 1. Qué hay hoy (staging, 09-nov)
| | Tablas de `public` | Con MAINTAIN para `authenticated` | Con MAINTAIN para `anon` |
|---|---|---|---|
| Total | 105 | **75** | 63 |
| Del Club (`club_*`) | — | **10** | 0 |
| Del puente (`pos_*`) | — | 10 | — |
| Otras (caja, ventas, propinas, CRM, SOPs…) | — | 55 | — |

- No hay vistas materializadas.
- Las 75 son de `postgres`.
- Las 10 del Club son exactamente: `club_config`, `club_negocios`, `club_miembros`, `club_miembros_contacto`,
  `club_cupones`, `club_cupones_contactos`, `club_movimientos`, `club_pm_pagos`, `club_pm_cargos` y `club_visitas`.

## 2. Quién lo dio
1. **Los privilegios por defecto de `postgres` en `public`** (`pg_default_acl`) dicen hoy
   `authenticated=arwdDxtm/postgres`. La `m` es **MAINTAIN**, que PostgreSQL 17 sumó a «ALL».
   - Toda tabla que crea `postgres` nace con eso: migraciones, editor SQL y editor de tablas del panel.
   - La 090 sacó a `anon` de esa regla; `authenticated` quedó igual.
   - Los de `supabase_admin` también lo dan, pero `postgres` no los puede cambiar: es el residual que el dueño aceptó en
     la 090.
2. **En el Club, un hueco de la 075 (§3, ~502).** El bucle de «RLS y privilegios de tabla» le saca a `authenticated` una
   **lista** de privilegios: `revoke insert, update, delete, truncate, references, trigger`.
   - La lista se escribió como si fuera PostgreSQL 16: le falta `maintain`.
   - Las demás tablas del Club usan `revoke all … from authenticated` y están limpias. Por eso son justo esas 10.
3. **Prod** es PostgreSQL 17: la cabecera de la 090 leyó en prod, el 08-nov, `anon=arwdDxtm`. Lo mismo vale allá,
   **sin verificar hoy** (nada en prod).

## 3. Qué permite MAINTAIN
- `VACUUM`, `ANALYZE`, `REINDEX`, `CLUSTER`, `REFRESH MATERIALIZED VIEW` y **`LOCK TABLE`** en cualquier modo, incluido
  `ACCESS EXCLUSIVE`.
- No permite leer ni escribir datos.
- **El riesgo es de disponibilidad**, no de datos. Con una sesión SQL como `authenticated`, alguien podría:
  - trabar una tabla (`LOCK TABLE club_movimientos IN ACCESS EXCLUSIVE MODE` dentro de una transacción larga);
  - o lanzar un `REINDEX` o `CLUSTER` pesado en plena hora de servicio.

**Por dónde se podría usar hoy: por ninguna vía conocida.**
- La app y club-web hablan con PostgREST, que no ejecuta SQL suelto.
- Las funciones del Club son `SECURITY DEFINER` y ninguna arma SQL dinámico con datos del usuario.
- En las migraciones y en `src/` no hay ningún `REFRESH`, `VACUUM`, `REINDEX`, `CLUSTER` ni `LOCK TABLE` que corra como
  `authenticated`. El único `lock table` (la carga de papel, 075 ~6767) lo corre la herramienta como dueño, sobre
  `club_cargas_papel`, que no está en la lista.

Es higiene de **mínimo privilegio**: hoy no hay una vía abierta, pero el permiso sobra.

## 4. Propuesta (sin aplicar; dos bloques, porque 65 de las 75 tablas no son del Club)

### Bloque A — Club (075), lo mío
1. En el bucle de la 075 §3, sumar `maintain` a la lista:
   `revoke insert, update, delete, truncate, references, trigger, maintain on public.%I from authenticated`.
2. Aplicarlo en staging, que es una re-ejecución idempotente de ese bucle. Así la paridad sigue en 974 = 974: el
   catálogo del Club compara los ACL (`club_catalogo.sql`).
3. **Prueba nueva en la batería:** «ninguna tabla `club_*` tiene MAINTAIN para `authenticated` ni `anon`».
   - Con la mutación que vuelve a la lista vieja, **cae** (10 tablas).
   - Va a `mutaciones_r7.json`.
4. No toca funciones, políticas ni datos. **Rollback:** `grant maintain on <las 10> to authenticated` (no hace falta: no
   lo usa nadie).

### Bloque B — el resto de `public` (caja y puente), NO lo toco
Lo propongo para la sesión de caja, en una migración del mismo bloque que la 090 («privilegios por defecto»). El número
lo reserva caja: la 091 y la 092 ya las usan otras ramas (`multilocal-fase0` y `employees-borrado-owner`).
```sql
revoke maintain on all tables in schema public from authenticated, anon;
alter default privileges for role postgres in schema public revoke maintain on tables from authenticated;
```
- La primera línea saca MAINTAIN de las 75 tablas (las 10 del Club repiten el bloque A sin problema) y de las 63 de
  `anon`.
- La segunda hace que las tablas **nuevas** nazcan sin MAINTAIN para `authenticated`. `anon` ya no lo recibe desde la
  090.
- **Las 10 `pos_*` son del puente.** Hoy no se tocan: el pase es hoy y 120/121 quedan para después. Esta línea las
  incluye, así que el bloque B va **después del pase**, con el OK del puente.
- **Qué podría romper:** nada que se sepa. El Edge del puente usa `service_role` y la ingesta corre en una función de la
  082. Igual, antes de aplicarla, conviene un `grep` del agente y de los Edge por `VACUUM`, `ANALYZE` y `REFRESH`.
- **Residual:** los privilegios por defecto de `supabase_admin`, el mismo caso que en la 090.
- **Prueba:** la 82 del Club ya recorre las tablas de `public`; se le suma «ninguna tabla de `public` con MAINTAIN para
  `authenticated` o `anon`», con la misma salida que la 82 de hoy.

**Orden:**
1. Bloque A en la rama del Club, cuando el dueño dé el OK.
2. Bloque B en la rama de caja, después del pase del puente.
3. Prod: con el resto de la 075 y en el pase de caja, cada uno con su firma.
