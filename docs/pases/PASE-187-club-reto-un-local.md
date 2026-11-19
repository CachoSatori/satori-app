# Pase a PROD de la mig 187 `club_reto_un_local` (origen club 131)

> **⛔ Esquema: firma del dueño sobre el SHA exacto.** Backlog del Club firmado el 16-nov (arreglo 3 de 4) + decisión del
> dueño 17-nov ~16:50 -06:00: el tope de 3 retos armados por año es **por local**. Si algo no coincide, **se para y se
> avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Orden obligatorio:** **186 → 187 → 188**, un merge por vez, cada uno con su §6 en verde antes del siguiente.
>   Branching rechaza una versión menor que la última aplicada (R16): si la 187 entra antes que la 186, la 186 ya no entra.
> - **Ledger:** exactamente 1 fila `187` con su `name`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§5 y §6).

## 1. Qué pasa y qué no
**Pasa:**
1. CHECK `club_retos_un_local` (`cardinality(locales) = 1`) y trigger `club_retos_a_un_local_trg` con el mensaje «Un reto
   es de un solo local: elegí uno…» (P0001). Función del trigger sin EXECUTE para `anon` / `authenticated`.
2. `club_retos_reglas` (169): el tope de **3 armados por año cuenta solo los del mismo local**; mensaje «Ya hay 3 retos
   armados en <año> en «<local>»: es el máximo por año y local». Un fragmento exacto con guarda de md5 (R13): antes
   `000ef92116630f046136fc56a90f5b6f` (leído en prod, solo lectura, 17-nov), después `badac2f48c64e3c57db7af170be173d0`.
3. App: formulario con un solo «Local»; la lista dice «armados en <año>: <local> N»; guía 6.13 al día.

**No pasa:** superposición por local, armado inmutable, exigir factura y el candado de `club_retos_reglas`;
`club_retos_listar`, `club_reto_guardar/_armar/_terminar/_borrar`, portal, caja, datos, sagrados.

**Qué ve el owner / manager:** al armar, cada local tiene sus 3 por año; el manager sigue viendo solo los retos de su local.

## 2. Prerrequisitos
- La **186** mergeada y con su §6 OK (ledger prod = **186**).
- Prod el 17-nov (solo lectura): ledger 185, **0 retos**, `club_retos_reglas` md5 `000ef921…`.

## 3. Pruebas (antes de aplicar, R15)
- `scripts/sql/187_pruebas.py --local … --semilla-local` sobre Postgres 16 local (`local_armar_base.sh`, sin la 187):
  **11/11** en transacción descartada. Casos nuevos: 09 (A arma 3 en un año, el 4.º de A se rechaza, B arma igual) y 10
  (guarda de md5: sobre una función distinta aborta sin tocarla).
- `--mutar todas`: **6/6 muerden** (`tope_global` → cae 09; `sin_guarda_md5` → cae 10; `sin_check`, `sin_trigger`,
  `trigger_solo_insert`, `sin_prechequeo`).
- Aplicar + rollback reales en una copia local: md5 `badac2f4…` → `000ef921…`.

## 4. Antes del merge (prod, solo lectura, `begin read only` … `rollback`)
- Ledger: última = **186**. Si no, **no se mergea**.
- `md5(pg_get_functiondef('public.club_retos_reglas()'::regprocedure))` = `000ef92116630f046136fc56a90f5b6f`.
- `select count(*) from club_retos where cardinality(locales) <> 1` = 0 (si no, la 187 aborta sin tocar nada).
- No existen `club_retos_a_un_local()` ni el CHECK `club_retos_un_local`. Anotar `count(*)` de `club_retos`.

## 5. Después del merge (prod, solo lectura)
- Ledger: 1 fila `187` / `club_reto_un_local`; check «Supabase Preview» en success («All migrations are up to date»).
- md5 de `club_retos_reglas` = `badac2f48c64e3c57db7af170be173d0`; CHECK validado; trigger presente y antes de
  `club_retos_reglas_trg`; sin EXECUTE de `anon` / `authenticated` en `club_retos_a_un_local()`.
- **Humo:** `count(*)` de `club_retos` = §4; `club_retos_listar()` como owner responde sin error.

## 6. Criterios de parada
- Ledger distinto de 186, md5 distinto o algún reto con ≠ 1 local en §4: **no se mergea**.
- Branching en rojo o §5 distinto de lo esperado: se para, se avisa y se decide la vuelta atrás. No se arregla a mano.

## 7. Vuelta atrás
`scripts/sql/187_rollback.sql` (exige md5 `badac2f4…`, devuelve `club_retos_reglas` a `000ef921…`, saca trigger, función
y CHECK, borra la fila `187`). **En el mismo momento**, un PR que saca el `.sql` de `main` (regla 10) y revierte la app.
Si también se vuelve la 188, primero la 188. Con retos armados reales, el rollback no toca datos; si hay más de 3 armados
en un año sumando locales, la 169 solo frena armar nuevos.

## 8. Firma y bitácora
| Cuándo (-06:00) | Quién | Qué |
|---|---|---|
| 2026-11-16 | dueño | Firma el backlog del Club (arreglo 3 de 4: un local por reto) |
| 2026-11-17 ~16:50 | dueño | Decide: tope de 3 armados por año **por local** |
| | dueño | Firma de esquema sobre el SHA exacto (OK de merge) |
| | control | §4 y §5 |
