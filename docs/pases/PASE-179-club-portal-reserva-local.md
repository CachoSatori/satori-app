# Pase a PROD de la mig 179 `club_portal_reserva_local` (origen club 124)

> **Lleva firma: esquema.** Decisión del dueño por el chat, 16-nov-2026 06:45 -06:00 (opción A): «Reservar» del
> portal del socio abre el link de reserva de OpenTable **del local del socio**, el que se edita en Club → Promociones,
> usado **tal cual**. El merge necesita el OK del dueño sobre el SHA exacto. Si algo no coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Orden obligatorio:** va **después de la 178** (#211). Necesita la 167 y la 173 (aborta si faltan).
> - **Regla del ledger:** exactamente 1 fila `179` con su `name`.

## 1. Qué cambia
- `club_portal` (envoltorio vigente de la 167; ninguna migración posterior lo tocó) suma `socio.reserva_url`: el link
  del local del socio, sin modificar. Sin fila de configuración, sin link o con un link que no sea de OpenTable → `null`
  y club-web usa el rid por defecto. El referente y los tokens inválidos, vencidos o dados de baja reciben lo mismo que hoy.
- `club_cumple_config_guardar` (la de la 173, igual byte a byte) suma la validación: `https://` y dominio de OpenTable
  (opentable.com, subdominios o variante regional). Probado contra ~20 ataques de dominio (verificador independiente).
- `club_reserva_url_ok`: interna, sin EXECUTE para la API. Nada nuevo ejecutable por `anon` ni por `authenticated`.
- No toca plata, sagrados, Edge ni datos.

## 2. Antes del merge (prod, solo lectura)
- Ledger: última versión = **178**.
- `select location_id, reserva_url from club_cumple_config;` → todos los links guardados pasan la validación nueva
  (16-nov: 2 filas, ambas `…?rid=…` de OpenTable → pasan; nadie queda bloqueado al guardar).

## 3. Después del merge (prod, solo lectura)
- Ledger con 1 fila `179`.
- `club_reserva_url_ok` existe y `has_function_privilege('anon', …, 'execute')` = false; lo mismo para `authenticated`.
- Grants de `club_portal` y `club_cumple_config_guardar` iguales a los de antes.
- **Validación física del dueño:** en el portal de un socio de cada local, «Reservar» abre el OpenTable de su local.
  Antes, el dueño pega en Promociones el link real de cada local (hoy los dos tienen el rid de Santa Teresa y ninguno trae
  el parámetro de canal).

## 4. Criterio de parada y vuelta atrás
- Si el Preview de Supabase falla por la migración (no por timeout de la API) o un control de §3 no da: se para y se avisa.
- Vuelta atrás: `scripts/sql/179_rollback.sql` (restaura `club_portal` de la 167 y `club_cumple_config_guardar` de la 173,
  borra la función interna y la fila 179 del ledger) + revert del merge. Regla §6: si se corre en prod, el `.sql` sale de `main`.

## 5. Pruebas
- Batería `scripts/sql/179_pruebas.*` en Postgres 16 local (main + 178): 12/12; 9/9 mutaciones muerden.
- Verificador independiente (16-nov): SQL y club-web OK. Staging: pendiente con el dueño (staging está en la 151).
