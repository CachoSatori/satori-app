# Pase a PROD de la mig 180 `club_reserva_url_por_local` (origen club 125)

> **Lleva firma: esquema.** Pedido del dueño por el chat, 16-nov-2026 08:02 -06:00: el link de reservas de OpenTable
> es de **cada local** y es para **todos** (no solo el cumpleaños). Se edita en Club → Locales, junto a la reseña de
> Google. La página del cupón del turista suma «Reservar una mesa». El merge necesita el OK del dueño sobre el SHA exacto.
> Si algo no coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Orden obligatorio:** va **después de la 179** (en prod desde el merge del #212). Aborta si falta `club_reserva_url_ok`.
> - **Regla del ledger:** exactamente 1 fila `180` con su `name`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (lecturas de §2 y §3).

## 1. Qué cambia y qué no
- `club_config.reserva_url` (nueva, null): link de reservas del local, tal cual. Lo carga **solo el owner** en Club →
  Locales (RLS de la 150; queda en `club_config_historial`).
- Trigger `club_config_reserva_url_trg` (BEFORE INSERT OR UPDATE OF reserva_url): en UPDATE rechaza lo que no sea https
  de OpenTable con `club_reserva_url_ok` (179); vacío → null. En INSERT lo deja null: un local creado «copiando» otro no
  hereda su OpenTable. (No es un CHECK porque un CHECK corre la función con los permisos de quien escribe y la interna no
  se abre a `authenticated`.)
- Copia: cada local toma su link de `club_cumple_config.reserva_url` si es de OpenTable. Esa columna queda **deprecada,
  sin uso** (nadie la lee ni la escribe; se borra en una migración futura).
- `club_cumple_cfg_json` lee el link del local → Promociones (solo lectura: «Se edita en Club → Locales»), el aviso de
  cumpleaños del Inicio y su WhatsApp usan el del local. `club_cumple_config_guardar` ignora el link del formulario y
  «solo con reserva» exige el link del local.
- `club_portal`: «Reservar» lee de `club_config` (mismo filtro). Sin link → null → club-web usa el rid por defecto (ST).
- `club_cupon_ver` (pública): `local` suma `reserva` (link del local del cupón o null). Nada más se expone.
- Nada nuevo ejecutable por `anon` ni `authenticated`. No toca plata, sagrados, Edge ni datos fuera de la copia.

## 2. Antes del merge (prod, solo lectura, `begin read only` … `rollback`)
- Ledger: última versión = **179**.
- `select location_id, reserva_url, club_reserva_url_ok(reserva_url) from club_cumple_config;` → anotar. Los que den
  `true` se copian; si alguno da `false`, ese local queda sin link (cargarlo en Locales después) y, si tiene «solo con
  reserva», Promociones no deja guardar hasta cargarlo.
- `select count(*) from club_config;` → anotar.

## 3. Después del merge (prod, solo lectura)
- Ledger con 1 fila `180`.
- `select c.location_id from club_config c join club_cumple_config k using (location_id) where club_reserva_url_ok(k.reserva_url) and c.reserva_url is distinct from k.reserva_url;` → 0 filas.
- `club_config_reserva_url_validar()`: `has_function_privilege('anon'|'authenticated', …, 'execute')` = false.
- Grants de `club_portal`, `club_cupon_ver` (anon, authenticated) y `club_cumple_config_guardar` (authenticated) iguales.
- Humo: `club_cupon_ver` de un cupón vigente trae `local.reserva` con el link del local.
- **Validación física del dueño:** en Club → Locales aparece «Link de reservas (OpenTable)» con el link de cada local;
  un cupón de turista de cada local muestra «Reservar una mesa» y abre el OpenTable de ESE local; «Reservar» de «Mi Club»
  de un socio de cada local, igual. En Promociones → Cumpleaños el link se ve sin campo para editar.

## 4. Criterio de parada y vuelta atrás
- Si el Preview de Supabase falla por la migración (no por timeout de la API) o un control de §3 no da: se para y se avisa.
- Vuelta atrás: `scripts/sql/180_rollback.sql` — devuelve a `club_cumple_config.reserva_url` lo cargado en Locales,
  restaura `club_cupon_ver` (158), `club_portal` y `club_cumple_config_guardar` (179) y `club_cumple_cfg_json` (173) byte a
  byte, borra trigger, función y columna y la fila 180 del ledger. Más revert del merge. Regla §6: si se corre en prod, el
  `.sql` sale de `main` en el mismo momento.

## 5. Pruebas
- Batería `scripts/sql/180_pruebas.*` en Postgres 16 local (main `ec14883` con la 179) en transacción descartada: 11/11;
  12/12 mutaciones muerden (`python3 scripts/sql/180_pruebas.py --local --semilla-local --mutar todas`).
- Migración y rollback aplicados y deshechos dos veces seguidas en la base local: sin errores.
- Staging: pendiente con el dueño.

## 6. Firma y bitácora
| Qué | Quién | Fecha y hora (-06:00) | SHA |
|---|---|---|---|
| Firma del dueño (esquema) | | | |
| Merge (Branching) | | | |
| Control §3 | | | |
