# Pase a PROD de la mig 192 `mi_rendimiento_equipo` (origen club 136)

> **⛔ Esquema y permisos: firma del dueño sobre el SHA exacto.** Pedido del dueño del 18-nov 12:55 («quiero que ellos
> evalúen su propio rendimiento personal […] y poder evaluarlos personalmente además de en equipo»), opción A. Si algo no
> coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Orden:** la **191** (#292) primero; la 192 usa `pos_mis_logins()` de la 191. Este PR está **apilado sobre #292**:
>   se mergea a `main` después de #292 (al mergear #292, la base de este PR pasa a `main`).
> - **Ledger:** exactamente 1 fila `192` con su `name`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§4 y §5).

## 1. Qué pasa y qué no
**Pasa (solo funciones nuevas, todas con `search_path = public, pg_temp`):**
- API (`authenticated`; sin EXECUTE para `public`/`anon`; rol validado adentro, 42501):
  - `pos_mi_rendimiento_equipo(p_local, p_desde, p_hasta) → jsonb`: posición propia en ventas, «general» del
    restaurante, mediana y promedio por persona y mi posición en cada indicador, Prom/PAX del restaurante por día de
    semana, ICP del equipo (sesiones cerradas del mismo local). Rango máximo 401 días (22023).
  - `pos_mi_competencia(p_local, p_comp) → jsonb`: mi posición, de cuántos, mis puntos, y con 4+ participantes los
    puntos del líder y la mediana (sin nombre).
- Internas (sin EXECUTE para `public`, `anon` ni `authenticated`): `pos_persona_clave` (espejo de `personasNdf.ts`),
  `pos_rend_base`, `pos_rend_productos`, `pos_rend_yo`.
- Quién: personal activo con login del PoS (solo si vendió en el período: si no, `motivo = 'sin_ventas'` y nada más);
  owner/contador cualquier local; manager sus locales. Cajero, inactivos, personal sin login: 42501.
- **Anti-identificación (K = 4):** con menos de 4 personas con venta en el período no sale ningún agregado del equipo
  (`motivo = 'grupo_chico'`), solo la posición. ₡ redondeados a 100, razones a 2 decimales, ICP a 1. Sin cuartiles.
- App: pestaña nueva «📈 Mi evolución» (sale de las propias facturas, sin base) y las comparaciones con el equipo de
  vuelta para el personal, con lo que devuelve la 192. Guía 6.5 al día.

**No pasa:** tablas, columnas, policies (regla 6), datos, las funciones de la 067/190/191, sagrados.

## 2. Prerrequisitos (prod, solo lectura, antes del merge)
- Ledger prod = **191** (o 190 si #292 entra en el mismo merge). `to_regprocedure('public.pos_mis_logins()')` no null.
- `to_regprocedure('public.pos_mi_rendimiento_equipo(text,date,date)')` = null.
- `tip_sessions.location_id` usa los mismos ids que `pos_ndf_tickets.local` (`santa-teresa`).

## 3. Pruebas en staging (`hwiatgic…`, transacción que termina en ROLLBACK, 18-nov-2026)
- `scripts/sql/192_pruebas.py --armar --compacto --sin-drops --mutar todas` (la batería y cada mutación encima en la
  misma transacción; staging no tiene la 191: se crea solo su `pos_mis_logins` tal cual).
  **18-nov-2026 ~13:45 -06:00: sin mutar 44/44.** Las 9 mutaciones muerden: `sin_k` (caen 6), `sin_ventas_ve` (2),
  `neta_con_17` (5), `sin_rol` (2), `manager_sin_local` (1), `sin_multiplicador` (3), `delivery_en_salon` (2),
  `sin_alias` (1), `base_abierta` (1). SQL armado: md5 `6dcb525a…`.
- Paridad con la app: la fixture ficticia `src/modules/ventas/__paridad__/equipo192.fixture.ts` cargada en staging; la
  salida de la función (`equipo192.staging.json`) = lo que calcula la app con `armarDiasMap → aggSalonero/aggGeneral`
  (`equipo192.paridad.test.ts`, 6/6).
- **NO PROBADO en staging:** los `drop` de la vuelta atrás (el conector los cancela; caso 09 con `--local`).

## 4. Antes del merge (prod, solo lectura, `begin read only` … `rollback`)
- Ledger y funciones de §2. Si no coinciden, **no se mergea**.

## 5. Después del merge (prod, solo lectura)
- Ledger: 1 fila `192` / `mi_rendimiento_equipo`; check «Supabase Preview» en success.
- Las 6 funciones con `search_path=public, pg_temp`; `has_function_privilege('anon', …, 'execute')` = false en las 6;
  `authenticated` = false en las 4 internas.
- **Humo** (JWT simulado, `begin read only` … `rollback`, este mes): como un salonero activo, la salida tiene solo las
  claves de la lista blanca (sin logins ni nombres) y `ranking.de` = cantidad de personas con venta; como cajero 42501;
  como owner, `personas` igual.

## 6. Vuelta atrás (regla 10: la fila 192 y su `.sql` se quedan)
`scripts/sql/192_rollback.sql`, sin numerar: se copia a `supabase/migrations/NNN_mi_rendimiento_equipo_fuera.sql` con el
siguiente número libre (registro y ESTADO en el mismo PR), con firma, y entra por merge → Branching. Borra las seis
funciones. La app sigue andando: el personal ve «La comparación con el equipo no está disponible ahora.» y «Mi
evolución» igual.

## 7. Firma y bitácora
| Fecha y hora (-06:00) | Qué | Quién |
|---|---|---|
| | Firma del dueño sobre el SHA | |
| | Merge / Branching | |
| | Control §5 | |
