# Pase a PROD de la mig 176 `club_local_manager_listas` (origen 122)

> **Estado: preparado, SIN ejecutar.** Formato del `PASE-089`. **Toca el esquema (funciones y políticas RLS del Club):
> nada de este documento se ejecuta sin la firma del dueño (§9).** Si algo no coincide con lo que dice acá, **se para y
> se avisa**: no se improvisa en prod.
>
> - **Vía: merge → Branching** (la usada desde la 085). No se aplica nada a mano. Si el día del pase aparece una razón
>   para hacerlo a mano, se para y se rehace el paquete.
> - **Orden:** después de la **172** (#202; la 176 aborta si falta `club_exigir_local_de`) y de la 173–175 si entran antes.
>   No toca nada de la 173 (cumpleaños). Si 174/175 redefinen una de las cinco funciones de §1, se rebasea con la receta
>   (se cambia el `__nucleo`); la guardia del gate lo exige.
> - **Regla del ledger (Grok 122):** exactamente 1 fila 176 con su `name` + el catálogo (§5). No se compara md5.
> - **Repo público:** en la bitácora (§9) solo conteos, nunca nombres ni montos.

## 1. Qué pasa y qué no
- **Pasa (solo para el MANAGER):** en las listas del Club ve solo las fichas de sus locales (`mis_locales()`, 091):
  - Funciones con la receta de la 170/172 (original → `<nombre>__nucleo`, envoltorio que filtra): `club_buscar`,
    `club_socios_por_confirmar`, `club_socio_solicitudes_abiertas`, `club_retos_listar`, `club_resolver` (cupón, QR de
    anfitrión y código de canje de otro local → 42501 «Ficha de otro local»; el QR del **socio** sigue: Club compartido).
  - RLS: 17 políticas de tablas `club_*` (miembros, negocios, movimientos, visitas, roles, alertas, cupones, contactos,
    cruces, excepciones resueltas, carga vieja, pases, primeros 90, reseñas, premios de retos) suman el local para el
    manager. `club_config` / `club_config_global` sin cambios.
  - `club_exigir_local_de` (172) dice «Ficha de otro local» (la app: «Esta ficha es de otro local: la atiende el manager
    de ese local o el owner.»). Nueva `club_ve_ficha(text)` interna.
- **No pasa:** owner, contador, cajero, salonero y anon igual que hoy. Ninguna lógica de plata, caja, cierres ni
  propinas; ningún dato cambia. Sin Edge Functions ni secretos.

## 2. Prerrequisitos
- 172 en el ledger de prod (#202 mergeado y verificado).
- PR con revisión, verificador independiente (esquema y seguridad) y **firma del dueño sobre el SHA exacto**.
- Asignaciones de locales de los managers revisadas en Admin (`profile_locations`): un manager sin asignación queda con
  Santa Teresa (091).
- Ventana de merge (regla D1): libre de 23:30 a 15:50; nunca de 15:50 a 19:00.

## 3. Lecturas previas en prod (solo lectura, `begin read only` … `rollback`)
- Ledger: 172 presente y **sin** fila 176.
- `to_regproc('public.club_buscar__nucleo') is null` (y las otras cuatro).
- `select tablename, policyname, qual from pg_policies where tablename like 'club%'` (anotar: la vuelta atrás vuelve a esto).
- `select count(*) from profile_locations pl join profiles p on p.id = pl.profile_id where p.role = 'manager' and p.is_active`.

## 4. Prueba en staging (pendiente con el dueño)
`python3 scripts/sql/176_pruebas.py --armar` y correr el SQL en staging (ref `hwiatgic…`, nunca prod; transacción
descartada, no deja nada). Esperado: 21/21. En local (Postgres 16): 21/21 y `--mutar todas` 14/14 muerden.

## 5. Humo después (solo lectura)
- Ledger: exactamente 1 fila `176` con `name = club_local_manager_listas`; «Supabase Preview» en success con «All
  migrations are up to date».
- Cinco `__nucleo` nuevos sin EXECUTE para authenticated; los cinco envoltorios con EXECUTE para authenticated.
- Las 17 políticas con `mis_locales` en `qual` (y en `with_check` la de `club_miembros_contacto`).
- **En el local (validación física del dueño):** como manager de Santa Teresa: «Miembros», «Socios por confirmar»,
  «Retos», «Buscar» en Escanear muestran lo de Santa Teresa (no vacíos); «Excepciones», «Ranking» y «Tablero» como
  antes. Como cajero: buscar y escanear igual que antes. Como owner: todo como antes.

## 6. Criterios de parada
Cualquier diferencia con §5, un error de Branching, una pantalla del manager vacía en su propio local o un cajero que no
encuentra a un anfitrión → se para, se avisa y se evalúa el §7.

## 7. Vuelta atrás
`scripts/sql/176_rollback.sql` (ANTES que el de la 172) y, **en el mismo momento**, un PR que saca el `.sql` de `main`
(skill §6). No toca datos: se puede correr con actividad real. Vuelve lo de antes (el manager ve todos los locales en
las listas).

## 8. Responsables
- **Ejecución:** el dueño (firma y merge, o autoriza el merge).
- **Control:** el encargado del turno, que lee cada resultado esperado contra el obtenido. No es la misma persona.

## 9. Firma y bitácora
| Qué | Valor |
|---|---|
| SHA firmado | (pendiente) |
| Firma del dueño (fecha y hora −06:00) | (pendiente) |
| Merge (hora CR) | (pendiente) |
| Ledger antes → después | (pendiente) |
| Humo | (pendiente) |
