# Pase a PROD de la mig 194 `mi_rendimiento_equipo` (origen club 138) — **número definitivo**

> **⛔ Esquema y permisos: firma del dueño sobre el SHA exacto.** Pedido del dueño del 18-nov 12:55 («quiero que ellos
> evalúen su propio rendimiento personal […] y poder evaluarlos personalmente además de en equipo»), opción A. Si algo no
> coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Número definitivo:** 194 (la 193 entró con #294; ledger de prod = 193 el 18-nov). Si al momento del merge el ledger de
>   prod ya pasó la 194, se para y se renumera al siguiente libre (archivo, registro, ESTADO, PASE, scripts).
> - **Orden:** después de la 191 (#292, en `main` desde el 18-nov 13:05) y de la 192 (`propinas_cada_uno_lo_suyo`,
>   #295, en prod 13:41). La 194 usa `pos_mis_logins()` de la 191; no toca la 192 ni la 193.
> - **Ledger:** exactamente 1 fila `194` con su `name`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§4 y §5).

## 1. Qué pasa y qué no
**Pasa (solo funciones nuevas, todas con `search_path = public, pg_temp`):**
- API (`authenticated`; sin EXECUTE para `public`/`anon`; rol validado adentro, 42501):
  - `pos_mi_rendimiento_equipo(p_local, p_desde, p_hasta) → jsonb`: posición propia en ventas, «general» del
    restaurante, mediana y promedio por persona y mi posición en cada indicador, Prom/PAX del restaurante por día de
    semana, ICP del equipo (sesiones cerradas del mismo local). Rango máximo 401 días (22023).
  - `pos_mi_competencia(p_local, p_comp) → jsonb`: mi posición, de cuántos, mis puntos, el nombre y los puntos del
    líder **siempre** (decisiones «A» y «B»), y la mediana de puntos solo con 4+ participantes.
- Internas (sin EXECUTE para `public`, `anon` ni `authenticated`): `pos_persona_clave` (espejo de `personasNdf.ts`),
  `pos_rend_base`, `pos_rend_productos`, `pos_rend_yo`.
- Quién: personal activo con login del PoS (solo si vendió en el período: si no, `motivo = 'sin_ventas'` y nada más);
  owner/contador cualquier local; manager **y personal** solo sus locales (`mis_locales()`; otro local: 42501). Cajero,
  inactivos, personal sin login: 42501.
- **Decisión del dueño 18-nov 13:58 (opción C, K = 4):** siempre las proporciones del local (venta por PAX, comida/PAX,
  bebidas/PAX, ticket/ítem; también por día de semana y en la ventana corrida −364 días, `anio_pasado`). Posición,
  mediana/promedio en colones y **cuántas personas son** (`personas`) **solo con 4 o más**: con menos, la función no
  los devuelve (`motivo = 'grupo_chico'`). Competencias: el líder con su nombre (decisión «A»). ₡ a 100, razones a 2
  decimales.
- **Decisiones del dueño 18-nov 15:03 (tras el verificador independiente):**
  - **ICP del equipo siempre** («B»), también con menos de 4 personas: fuera del umbral K, en la SQL y en la pantalla.
  - **Líder de competencias con nombre y puntos siempre** («B»).
  - **⚠ Riesgo aceptado por el dueño («B», se deja como está):** con llamadas a mano a la API, restando dos rangos
    (por ejemplo, la semana con y sin una noche) se puede despejar el PAX y la venta de un compañero en una noche
    en la que trabajaron solo 2 personas. La pantalla no lo hace; queda documentado y no se mitiga en la 194.
- Guarda R13 al inicio: si cualquiera de las 6 funciones ya existe, la migración aborta sin tocar nada (no pisa un
  cuerpo distinto con `create or replace`).
- App: pestaña nueva «📈 Mi evolución» (sale de las propias facturas, sin base) y las comparaciones con el equipo de
  vuelta para el personal, con lo que devuelve la 194. Guía 6.5 al día.

**No pasa:** tablas, columnas, policies (regla 6), datos, las funciones de la 067/190/191, sagrados.

## 2. Prerrequisitos (prod, solo lectura, antes del merge)
- Ledger prod = **193** (#294 entró el 18-nov). `to_regprocedure('public.pos_mis_logins()')` y
  `to_regprocedure('public.propinas_mis_empleados()')` no null.
- `to_regprocedure('public.pos_mi_rendimiento_equipo(text,date,date)')` = null.
- `tip_sessions.location_id` usa los mismos ids que `pos_ndf_tickets.local` (`santa-teresa`).

## 3. Pruebas en staging (`hwiatgic…`, transacción que termina en ROLLBACK, 18-nov-2026)
- `scripts/sql/194_pruebas.py --armar --compacto --sin-drops --mutar todas`: la batería y cada mutación encima en la
  misma transacción. Staging está en 188: **190, 191 y 192 se aplican antes, tal cual, en la misma transacción** (con
  sus guardas md5). Única diferencia, por el conector (cancela todo `drop`): el `drop policy` + `create policy` de la
  192 va como `alter policy` de la vieja al mismo predicado (RLS equivalente). Se omitieron sus `comment on`.
  **18-nov-2026 ~16:00 -06:00 (ronda 4, decisiones de las 15:03): sin mutar 56/56, las 13 mutaciones muerden:**
  `sin_k` 9, `corrido_365` 2, `sin_ventas_ve` 2, `neta_con_17` 6, `sin_rol` 2, `locales_libres` 2,
  `personal_sin_local` 1, `icp_con_k` 1, `personas_sin_k` 2, `sin_multiplicador` 3, `delivery_en_salon` 2,
  `sin_alias` 1, `base_abierta` 1. Casos nuevos: ICP del equipo con 2 personas; `personas` null con 2 y con 3;
  salonero pidiendo otro local 42501; guarda R13 (segunda pasada aborta con P0001). Paridad igual (`personas` 8).
  Corrida anterior, **~15:10 (opción C): sin mutar 53/53** (incluye: con 3 personas no salen posición ni promedios,
  ni la palabra en la respuesta; con 4 sí; año pasado sin datos; corrimiento de 364 días; con la 192 el salonero lee
  solo su fila de `tip_entries` y el ICP del equipo sale igual). Las 10 mutaciones muerden: `sin_k` 8,
  `corrido_365` 2, `sin_ventas_ve` 2, `neta_con_17` 6, `sin_rol` 2, `manager_sin_local` 1, `sin_multiplicador` 3,
  `delivery_en_salon` 2, `sin_alias` 1, `base_abierta` 1. En la misma corrida (`--paridad`) se capturó
  `equipo194.staging.json`.
- Sin choques: nombres distintos de `propinas_mis_empleados()` (192), `pos_ventas_resumen` (190) y las de la 191; la
  194 no reemplaza ninguna función existente ni toca policies.
- Paridad con la app: la fixture ficticia `src/modules/ventas/__paridad__/equipo194.fixture.ts` cargada en staging; la
  salida de la función (`equipo194.staging.json`) = lo que calcula la app con `armarDiasMap → aggSalonero/aggGeneral`
  (`equipo194.paridad.test.ts`, 6/6).
- **NO PROBADO en staging:** los `drop` de la vuelta atrás (el conector los cancela; caso 09 con `--local`).

## 4. Antes del merge (prod, solo lectura, `begin read only` … `rollback`)
- Ledger y funciones de §2. Si no coinciden, **no se mergea**.

## 5. Después del merge (prod, solo lectura)
- Ledger: 1 fila `194` / `mi_rendimiento_equipo`; check «Supabase Preview» en success.
- Las 6 funciones con `search_path=public, pg_temp`; `has_function_privilege('anon', …, 'execute')` = false en las 6;
  `authenticated` = false en las 4 internas.
- **Humo** (JWT simulado, `begin read only` … `rollback`, este mes): como un salonero activo, la salida tiene solo las
  claves de la lista blanca (sin logins ni nombres) y `ranking.de` = cantidad de personas con venta; como cajero 42501;
  como owner, `personas` igual.

## 6. Vuelta atrás (regla 10: la fila 194 y su `.sql` se quedan)
`scripts/sql/194_rollback.sql`, sin numerar: se copia a `supabase/migrations/NNN_mi_rendimiento_equipo_fuera.sql` con el
siguiente número libre (registro y ESTADO en el mismo PR), con firma, y entra por merge → Branching. Borra las seis
funciones. La app sigue andando: el personal ve «La comparación con el equipo no está disponible ahora.» y «Mi
evolución» igual.

## 7. Firma y bitácora
| Fecha y hora (-06:00) | Qué | Quién |
|---|---|---|
| | Firma del dueño sobre el SHA | |
| | Merge / Branching | |
| | Control §5 | |
