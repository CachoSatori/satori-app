# Pase a PROD de la mig 181 `club_tope_almuerzo_cena` (origen club 126)

> **⛔ Toca plata (descuentos del Local Club): lleva la firma del dueño sobre el SQL final y el SHA exacto.** Decisiones
> firmadas por el dueño por el chat, 16-nov-2026: **opción B** (13:36 -06:00) el tope del socio pasa de «una visita con
> beneficio por día» a **una en el almuerzo y una en la cena por día**, en cualquier Satori (no son 2 libres); **corte**
> (13:59) 16:00 CR como el PoS; **opción A** (14:51) las alertas antiabuso siguen con la misma sensibilidad contando
> **días con visita**. Si algo no coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano en prod.
> - **Orden:** **la 181 entra a prod ANTES que la 182** (#226, `club_portal_reserva_anfitrion`): Branching rechaza un número
>   menor después de uno mayor. Va después de la 180 (en prod). Necesita la 168 y la 170 (en prod desde el 15/11).
> - **Regla del ledger:** exactamente 1 fila `181` con su `name`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§2 y §3).

## 1. Qué cambia y qué no
- **Corte almuerzo/cena = el que ya existe:** `club_config.turno_corte` (time, por local, hora de Costa Rica; 16:00 en
  Santa Teresa y Nosara, leído en prod y staging el 16/11). Es el corte «mañana/tarde» de las excepciones del Club y el
  del PoS en la app (`HORA_CORTE_TURNO = 16`). Almuerzo hasta 15:59:59; cena desde 16:00:00 hasta el cierre. El día
  sigue siendo el calendario de CR (cambia a medianoche). Lo cambia el owner por local (queda en el historial).
- `club_config_global.socio_visitas_por_comida` (nueva, 1, entre 1 y 3; solo owner). `socio_visitas_por_dia` queda **sin
  uso** (no se borra: la vuelta atrás la necesita).
- Internas nuevas, **cerradas a la API**: `club_comida(local, momento)` y `club_socio_tope_comida(socio, local, momento)`.
  Cuentan las visitas con beneficio del mismo día CR y la misma comida en TODOS los locales; cada visita, con el corte
  de su propio local.
- `club_socio_visita_base` (cuerpo de la 150, envuelto por la 168 y la 170): **solo** cambia el bloque del tope. Con el
  tope cumplido sigue devolviendo `estado = 'ya_uso_hoy'` (la app no cambia de contrato) con el texto nuevo y dos campos:
  `comida` y `vuelve`.
- **Alertas antiabuso (opción A), mismos umbrales:**
  - `club_excepciones__nucleo` (155; el envoltorio de la 170 no se toca): `SOCIO_USO_ANOMALO` «dos mesas el mismo día»
    pasa a **«dos mesas en la misma comida»** (ref `socio-comida:<socio>:<día>:<almuerzo|cena>`; en prod **no hay**
    ninguna resuelta con el ref viejo, leído el 16/11) y el máximo semanal (`club_config.socio_visitas_semana_max`, 5)
    cuenta **días con visita**.
  - `club_alertas_inicio` (164): `MISMO_USUARIO` de socios cuenta **días con visita** del mismo usuario (umbral
    `alerta_mismo_usuario_max` / `_dias`, 2 en 3). Las tarjetas del equipo, igual que antes. La app dice «registró al
    socio … en N días distintos de los últimos D días».
- **No cambia:** envoltorios 168/170, invitados sin límite, 857 si ya hay socio con beneficio en la factura, paga con
  créditos, mismo pedido = misma visita, sorteo, premios, el resto de las excepciones y alertas, sagrados, cierres, Edge.

**Qué va a ver el cajero** (Escanear → socio → «Registrar visita y ver qué aplicar»), con el corte de las 16:00:
| Hora | Antes ese día | Recuadro |
|---|---|---|
| 13:10 | nada | verde: 10 % LC + cortesía (igual que hoy) |
| 14:30 | beneficio a las 13:10 (cualquier local) | **rojo:** «Ya usó su beneficio del almuerzo hoy: NO aplicar beneficio» · «Vuelve a tenerlo en la cena, desde las 16:00.» · «Una visita con beneficio en el almuerzo y una en la cena, en cualquier Satori. Si viene con otro socio, puede ir como su invitado (857).» |
| 19:30 | beneficio a las 13:10 | verde (la cena está libre) |
| 21:00 | beneficio a las 13:10 y a las 19:30 | **rojo:** «Ya usó su beneficio de la cena hoy: NO aplicar beneficio» · «Vuelve a tenerlo mañana en el almuerzo.» |

## 1b. Qué cambia respecto de lo revisado (verificador, antes de la opción A)
Lo revisado (commit `224c352`) cambiaba solo el tope. Ahora la 181 suma las secciones **5** y **6**. Diff SQL resumido
(`-` antes = prod hoy, `+` después):

```diff
 -- club_excepciones__nucleo (5 fragmentos; la migración exige md5 5ad4ff8c… antes y 94cf0df9… después)
-    select 'SOCIO_USO_ANOMALO', 'socio-dia:' || v.miembro_id || ':' || v.fecha, …
-           jsonb_build_object(…, 'motivo', 'dos mesas el mismo día',
+    select 'SOCIO_USO_ANOMALO', 'socio-comida:' || v.miembro_id || ':' || v.fecha || ':' || public.club_comida(v.location_id, v.registrada_en),
+           …, jsonb_build_object(…, 'motivo', 'dos mesas en la misma comida',
+                              'comida', public.club_comida(v.location_id, v.registrada_en),
-     group by v.miembro_id, v.fecha
+     group by v.miembro_id, v.fecha, public.club_comida(v.location_id, v.registrada_en)
     having count(distinct v.location_id || ':' || coalesce(v.pos_ref->>'mesa', v.visita_clave)) > 1   -- igual
 …
-    'motivo', 'muchas visitas en la semana', 'visitas', count(*), 'maximo', …
+    'motivo', 'muchos días con visita en la semana', 'visitas', count(*), 'dias', count(distinct v.fecha), 'maximo', …
-    having count(*) > v_cfg.socio_visitas_semana_max and bool_or(…)
+    having count(distinct v.fecha) > v_cfg.socio_visitas_semana_max and bool_or(…)

 -- club_alertas_inicio, (b) MISMO_USUARIO
-           (select count(*) from rg b where …) as n
+           (select case when a.que = 'socio' then count(distinct (b.f at time zone 'America/Costa_Rica')::date) else count(*) end
+              from rg b where …) as n
 …
-                            'dias', v_cfg.alerta_mismo_usuario_dias)
+                            'dias', v_cfg.alerta_mismo_usuario_dias,
+                            'cuenta', case when mx.que = 'socio' then 'dias' else 'veces' end)
```
- El núcleo de excepciones **no se copia entero**: la migración toma la definición viva, exige el md5 de la 155, cambia
  solo esos 5 fragmentos (cada uno tiene que estar una sola vez) y exige el md5 final. Si prod no tiene exactamente la
  función esperada, **la migración aborta sin tocar nada**. (Además evita copiar al repo un comentario viejo de la 155
  con un nombre de persona; `scripts/sql/` lo escanea la guarda de privacidad.)
- La app: el aviso del Inicio para socios dice «en N días distintos…» y la ficha de la excepción, «dos mesas en la misma
  comida (almuerzo o cena), o más días con visita en la semana».

## 2. Antes del merge (prod `yiczgdtirrkdvohdquzf`, solo lectura, `begin read only` … `rollback`)
Leído el 16/11 entre 13:3x y 14:5x -06:00:
- Ledger: última versión = **180**; ninguna ≥ 181.
- `turno_corte`: santa-teresa 16:00, nosara 16:00. `socio_visitas_por_dia` = 1.
- md5 de `pg_get_functiondef`: `club_socio_visita_base` **`a5765518…`** · `club_excepciones__nucleo` **`5ad4ff8c…`** ·
  `club_alertas_inicio` **`493eb9cb…`** · `club_excepciones` (envoltorio) **`7e0b7ae5…`** (iguales en staging antes de la
  181 y en la base local). El día del pase se vuelven a leer: si alguno no da eso, **se para**.
- `club_excepciones_resueltas` con tipo `SOCIO_USO_ANOMALO`: 0 filas.

## 3. Después del merge (prod, solo lectura)
- Ledger con 1 fila `181` `club_tope_almuerzo_cena` (y la 182 recién después, en su propio merge).
- md5 esperados (los de staging y de la base local con el archivo exacto):
  `club_socio_visita_base` = `b667df18b4f4f2cad7a4973f5407a580` · `club_socio_tope_comida` = `e2fd0df33ac201059d32ad5db95ad05d` ·
  `club_comida` = `83c561818c98f1a32a1ffce3a2bd3a34` · `club_excepciones__nucleo` = `94cf0df9d0b189322b27d4d8b208a3e0` ·
  `club_alertas_inicio` = `9401ce68615c1dee0ee185c02deb07f3` · sin cambios: `club_socio_visita` = `0d7a0e3f75d96b0620afe754fd64d16a`,
  `club_excepciones` = `7e0b7ae5c466b5885de3b8d7547381f5`.
- `has_function_privilege('authenticated'|'anon', …, 'execute')` = false para `club_comida`, `club_socio_tope_comida`,
  `club_socio_visita_base` y `club_excepciones__nucleo`; true (authenticated) para `club_socio_visita`,
  `club_excepciones` y `club_alertas_inicio`; false (anon) para `club_alertas_inicio`.
- `select socio_visitas_por_comida from club_config_global` = 1.
- Humo: `club_comida('santa-teresa', '2026-12-01 15:59:59-06')` = almuerzo · `… 16:00:00-06` = cena ·
  `club_socio_tope_comida('00000000-0000-0000-0000-000000000000', 'santa-teresa', '2026-12-01 13:00-06')->>'vuelve'` =
  «Vuelve a tenerlo en la cena, desde las 16:00.».
- **Validación física del dueño:** un socio de prueba con beneficio en el almuerzo; segundo escaneo en otro pedido antes
  de las 16:00 → rojo con «almuerzo» y «desde las 16:00»; después de las 16:00 → verde; segundo en la cena → rojo con
  «mañana en el almuerzo». Al día siguiente, en Excepciones no sale «Uso raro del QR de socio» por ese almuerzo + cena.

## 4. Criterio de parada y vuelta atrás
- Si un md5 de §2 no coincide, si la migración aborta por su guarda, si el Preview de Supabase falla por la migración (no
  por timeout de la API) o un control de §3 no da: se para y se avisa.
- Vuelta atrás: `scripts/sql/181_rollback.sql` — `club_socio_visita_base` vuelve al cuerpo exacto de la 150, el núcleo
  de excepciones vuelve con el reemplazo inverso de los 5 fragmentos (exige el md5 de la 181 antes y el de prod después),
  `club_alertas_inicio` vuelve al cuerpo de la 164; borra las dos internas, la columna y la fila 181. Las cuatro funciones
  quedan con el **md5 de prod de §2** (probado en la batería, caso 12). No hay datos nuevos: se puede correr en cualquier
  momento. Regla §6: si se corre en prod, en el mismo momento un PR saca el `.sql` de `main` (si ya pasó tiempo, la
  vuelta atrás es una migración nueva hacia adelante; regla 10). Si la 182 ya está en prod, se revisa antes que su
  rollback no dependa de la 181 (hoy no: toca el portal del anfitrión).

## 5. Pruebas
- Batería `scripts/sql/181_pruebas.sql` (runner `181_pruebas.py`) en Postgres 16 local armado con
  `scripts/sql/local_armar_base.sh` (**sin** la 181; las funciones de §2 con el md5 de prod), en transacción descartada,
  ANTES de aplicar: **17/17**. Tope: almuerzo + cena; dos en el almuerzo; dos en la cena; borde 15:59:59.999 / 16:00:00;
  cruce de locales con cortes distintos; medianoche CR; sin beneficio no gasta; extremo a extremo con `club_socio_visita`
  como cajero; invitados/857 y reescaneo; tope configurable; internas cerradas. **Alertas:** (13) `SOCIO_USO_ANOMALO`:
  almuerzo + cena no, dos almuerzos sí, 15:59:59 / 16:00:00 no, almuerzo en dos locales sí; (14) semana: 6 visitas en 3
  días no, 6 días sí, 5 días justos no; (15) `MISMO_USUARIO`: 4 visitas en 2 días no, 3 días sí («dias»); (16) con horas fijas en CR que cruzan la medianoche UTC (12:00 y 19:00 CR de ayer + anteayer = 2 días CR) no dispara. (12) rollback
  con los 4 md5 de prod.
- Mutaciones: **20/20 muerden** (incluye `mu_utc`: días contados en UTC → cae el 16) (`--mutar todas`), entre ellas: tope por día, corte de la caja, corte inclusivo, hora y
  día en UTC, anomalía por día, semana por visitas, mismo usuario por visitas, rollback que deja la base, las alertas o
  las excepciones.
- App: `alertasInicio.test.ts` (aviso por días) y `Escanear.topeComida.test.tsx` (rojo con comida y hora).
- **Staging (`hwiatgicyyqyezqwldia`):**
  - 16/11 ~13:46 -06:00: 181 (solo el tope) aplicada con su fila `181` del ledger.
  - 16/11 ~15:00 -06:00: **181 corregida**: se aplicaron, en una transacción, **solo las secciones 5 y 6 del archivo
    final** (el texto exacto; las secciones 1–4 ya eran iguales byte a byte), sin tocar el ledger. Resultado verificado:
    los **7 md5** de §3 iguales a una base local con la 181 corregida aplicada limpia; ledger `180, 181, 182` (una fila
    181); permisos de §3 OK. No quedan versiones mezcladas: staging = la 181 final.
  - La batería completa no se pudo correr en staging (el conector cancela sentencias que modifican y el proxy bloquea
    `api.supabase.com` para el runner).

## 6. Riesgos conocidos
- **Después de medianoche** (00:00–corte) cuenta como almuerzo del día nuevo. Con los horarios actuales no pasa.
- Las baterías históricas de la 150 (`150_pruebas_staging.sql`, casos 67 y 76) buscan el ref `socio-dia:`: si se
  vuelven a correr después de la 181, esos dos casos caen por el cambio de ref (esperado).

## 7. Firma y bitácora
| Qué | Quién | Fecha y hora (-06:00) | SHA |
|---|---|---|---|
| Decisión (opción B) | dueño | 2026-11-16 13:36 | — |
| Corte 16:00 CR como el PoS (almuerzo hasta 15:59:59, cena desde 16:00 hasta el cierre); se reusa `turno_corte` | dueño | 2026-11-16 13:59 | — |
| Alertas por comida y por días (opción A) | dueño | 2026-11-16 14:51 | — |
| Aplicación en staging (tope) | sesión de CC | 2026-11-16 ~13:46 | `ad50d28` |
| Aplicación en staging (secciones 5 y 6) | sesión de CC | 2026-11-16 ~15:00 | rama `claude/club-tope-almuerzo-cena` |
| Firma del dueño (SQL final, prod) | dueño (chat) | 2026-11-16 | `34a4627` |
| Merge (Branching), ANTES que la 182 | sesión de la cola nocturna | 2026-11-16 23:37 | `3794d8d` (cabeza `a6de595` = `34a4627` + main, solo ESTADO) |
| Control §3 | sesión de la cola nocturna (lectura) | 2026-11-16 23:40 y 2026-11-17 01:35 | ledger 1 fila 181 · 7 md5 = §3 · permisos y humo OK |
