# Pase a PROD de la mig 182 `club_portal_reserva_anfitrion` (origen club 127)

> **⛔ Lleva firma: esquema (SQL final).** Decisión del dueño por el chat, 16-nov-2026 13:38 -06:00: «Reservar una mesa»
> en la pestaña del anfitrión del portal para **todo** anfitrión, no solo para el que además es socio. El merge necesita
> el OK del dueño sobre el SHA exacto. Si algo no coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Orden:** va **después de la 180** (en prod). La **181** es de otra rama del 16-nov (`club_tope_almuerzo_cena`, ya en
>   staging): si esa entra antes, la 182 va después sin problema; si la 182 entra antes, **la 181 ya no puede entrar con
>   ese número** (Branching no aplica una versión menor que la última) y tiene que renumerarse. Coordinar antes del merge.
> - **Regla del ledger:** exactamente 1 fila `182` con su `name`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (lecturas de §2 y §3).

## 1. Qué cambia y qué no
- Solo `club_portal(text)` (`create or replace`, mismo SECURITY DEFINER, `search_path`, volatilidad y permisos): la de
  la 180 + la clave de arriba `reserva_url` **solo cuando `anfitrion` = true** (un rol que no es socio, activo: referente,
  concierge o equipo). Valor: el mismo link que ya recibe el socio, el de su local (`club_miembros.location_id` →
  `club_config.reserva_url`, con el filtro `club_reserva_url_ok` de la 179); sin link → null.
- El socio puro y el anfitrión con el rol de baja: portal **idéntico** al de hoy (sin clave nueva).
- `socio.reserva_url` igual que hoy. El club-web que está en prod ignora la clave nueva (compatible hacia atrás); el del
  PR la usa con la campaña de OpenTable `referente`.
- Sin tablas, columnas, datos, funciones nuevas ni permisos nuevos. Ningún dato personal nuevo: es el link público de
  OpenTable del restaurante. No toca plata, sagrados ni Edge.

## 2. Antes del merge (prod, solo lectura, `begin read only` … `rollback`)
- Ledger: última versión = **180** (o 181 si la otra rama entró antes).
- `select md5(prosrc) from pg_proc where oid = 'public.club_portal(text)'::regprocedure;` → **`e13efb39…`** (la de la 180).
  Si da otra cosa, alguien cambió `club_portal`: **se para**.
- `select location_id, club_reserva_url_ok(reserva_url) from club_config;` → anotar qué locales tienen link.

## 3. Después del merge (prod, solo lectura)
- Ledger con 1 fila `182` (`club_portal_reserva_anfitrion`).
- `md5(prosrc)` de `club_portal` = **`1b716215…`** (igual a staging y a la base local).
- `has_function_privilege('anon', 'public.club_portal(text)', 'execute')` = true; `club_portal_datos` y
  `club_reserva_url_ok` siguen sin EXECUTE para `anon`/`authenticated`; `prosecdef` = true.
- **Validación física del dueño:** el portal de un anfitrión que NO es socio muestra «Reservar una mesa» en su pestaña y
  abre el OpenTable de su local con `ot_campaign=referente`; el de un anfitrión que también es socio, igual (y «Mi Club»
  sigue con `local`); el de un socio puro, sin cambios.

## 4. Criterio de parada y vuelta atrás
- Si el Preview de Supabase falla por la migración (no por timeout de la API) o un control de §3 no da: se para y se avisa.
- Vuelta atrás: `scripts/sql/182_rollback.sql` — vuelve `club_portal` a la de la 180 byte a byte (cuerpo, comentario y
  permisos) y borra la fila 182 del ledger. club-web sigue andando (cae a `socio.reserva_url`; sin él, no muestra la
  tarjeta). Más revert del merge. Regla §6: si se corre en prod, el `.sql` sale de `main` en el mismo momento.

## 5. Pruebas
- Batería `scripts/sql/182_pruebas.sql` (+ `182_pruebas.py`), resumen «pasaron X / fallaron Y» y error si falla:
  Postgres 16 local (base nueva con `local_armar_base.sh` sobre `main` con la 180): **9/9**; mutaciones **6/6 muerden**
  (`python3 scripts/sql/182_pruebas.py --local --mutar todas`). Migración y rollback aplicados y deshechos en la base
  local: sin errores, `club_portal` vuelve a `e13efb39…`.
- **Staging** (`hwiatgic…`): la batería en transacción descartada ANTES de aplicar: **9/9** (los cuerpos de
  `club_portal`, `club_portal_datos`, `club_pase_datos` y sus internas son los mismos que en la base local). Aplicada el
  16/11 ~13:50 -06:00 (archivo exacto + fila del ledger): ledger 180 → 181 (otra rama) → **182**; humo después en
  transacción descartada: un anfitrión ficticio recibe `reserva_url` de OpenTable de su local.

## 6. Firma y bitácora
| Qué | Quién | Fecha y hora (-06:00) | SHA |
|---|---|---|---|
| Firma del dueño (esquema, SQL final) | | | |
| Merge (Branching) | | | |
| Control §3 | | | |
