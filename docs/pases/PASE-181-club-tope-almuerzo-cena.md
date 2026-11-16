# Pase a PROD de la mig 181 `club_tope_almuerzo_cena` (origen club 126)

> **⛔ Toca plata (descuentos del Local Club): lleva la firma del dueño sobre el SQL final y el SHA exacto.** Decisión
> firmada por el dueño por el chat, 16-nov-2026 13:36 -06:00, **opción B**: el tope del socio pasa de «una visita con
> beneficio por día» a **una en el almuerzo y una en la cena por día**, en cualquier Satori. No son 2 libres: no puede
> usarlo dos veces en la misma comida. El resto de las reglas, igual. Si algo no coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano en prod.
> - **Orden:** va **después de la 180** (en prod). Necesita la 168 (`club_socio_visita_base`): en prod desde el 15/11.
> - **Regla del ledger:** exactamente 1 fila `181` con su `name`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§2 y §3).

## 1. Qué cambia y qué no
- **Corte almuerzo/cena = el que ya existe:** `club_config.turno_corte` (time, por local, hora de Costa Rica; 16:00 en
  Santa Teresa y Nosara, leído en prod y staging el 16/11). Es el corte «mañana/tarde» de las excepciones del Club y el
  del PoS en la app (`HORA_CORTE_TURNO = 16`). Almuerzo = antes del corte; cena = desde el corte (16:00:00 ya es cena).
  El día sigue siendo el calendario de CR (cambia a medianoche). Lo cambia el owner por local (queda en el historial).
- `club_config_global.socio_visitas_por_comida` (nueva, 1, entre 1 y 3; solo owner). `socio_visitas_por_dia` queda **sin
  uso** (no se borra: la vuelta atrás la necesita).
- Internas nuevas, **cerradas a la API**: `club_comida(local, momento)` y `club_socio_tope_comida(socio, local, momento)`.
  Cuentan las visitas con beneficio del mismo día CR y la misma comida en TODOS los locales; cada visita, con el corte
  de su propio local.
- `club_socio_visita_base` (cuerpo de la 150, envuelto por la 168 y la 170): **solo** cambia el bloque del tope. Con el
  tope cumplido sigue devolviendo `estado = 'ya_uso_hoy'` (la app no cambia de contrato) con el texto nuevo y dos campos:
  `comida` y `vuelve`.
- **No cambia:** envoltorios 168/170, invitados sin límite, 857 si ya hay socio con beneficio en la factura, paga con
  créditos, mismo pedido = misma visita, sorteo, premios, excepciones, alertas, sagrados, cierres, Edge.

**Qué va a ver el cajero** (Escanear → socio → «Registrar visita y ver qué aplicar»), con el corte de las 16:00:
| Hora | Antes ese día | Recuadro |
|---|---|---|
| 13:10 | nada | verde: 10 % LC + cortesía (igual que hoy) |
| 14:30 | beneficio a las 13:10 (cualquier local) | **rojo:** «Ya usó su beneficio del almuerzo hoy: NO aplicar beneficio» · «Vuelve a tenerlo en la cena, desde las 16:00.» · «Una visita con beneficio en el almuerzo y una en la cena, en cualquier Satori. Si viene con otro socio, puede ir como su invitado (857).» |
| 19:30 | beneficio a las 13:10 | verde (la cena está libre) |
| 21:00 | beneficio a las 13:10 y a las 19:30 | **rojo:** «Ya usó su beneficio de la cena hoy: NO aplicar beneficio» · «Vuelve a tenerlo mañana en el almuerzo.» |

## 2. Antes del merge (prod `yiczgdtirrkdvohdquzf`, solo lectura, `begin read only` … `rollback`)
Leído el 16/11 13:3x -06:00:
- Ledger: última versión = **180**; ninguna ≥ 181.
- `turno_corte`: santa-teresa 16:00, nosara 16:00. `socio_visitas_por_dia` = 1.
- `md5(pg_get_functiondef('public.club_socio_visita_base(uuid,jsonb,uuid,text)'::regprocedure))` = **`a5765518898bbdd297336582a146a5df`**
  (= la de la 150; igual en staging y en la base local). El día del pase se vuelve a leer: si no da eso, **se para**.

## 3. Después del merge (prod, solo lectura)
- Ledger con 1 fila `181` `club_tope_almuerzo_cena`.
- md5 esperados (los de staging y de la base local con el archivo exacto):
  `club_socio_visita_base` = `b667df18b4f4f2cad7a4973f5407a580` · `club_socio_tope_comida` = `e2fd0df33ac201059d32ad5db95ad05d` ·
  `club_comida` = `83c561818c98f1a32a1ffce3a2bd3a34` · `club_socio_visita` (envoltorio, sin cambios) = `0d7a0e3f75d96b0620afe754fd64d16a`.
- `has_function_privilege('authenticated'|'anon', …, 'execute')` = false para `club_comida`, `club_socio_tope_comida` y
  `club_socio_visita_base`; true para `club_socio_visita` (authenticated).
- `select socio_visitas_por_comida from club_config_global` = 1.
- Humo: `club_comida('santa-teresa', '2026-12-01 15:59:59-06')` = almuerzo · `… 16:00:00-06` = cena ·
  `club_socio_tope_comida('00000000-0000-0000-0000-000000000000', 'santa-teresa', '2026-12-01 13:00-06')->>'vuelve'` =
  «Vuelve a tenerlo en la cena, desde las 16:00.».
- **Validación física del dueño:** un socio de prueba con beneficio en el almuerzo; segundo escaneo en otro pedido antes
  de las 16:00 → rojo con «almuerzo» y «desde las 16:00»; después de las 16:00 → verde; segundo en la cena → rojo con
  «mañana en el almuerzo».

## 4. Criterio de parada y vuelta atrás
- Si el md5 de §2 no coincide, si el Preview de Supabase falla por la migración (no por timeout de la API) o un control
  de §3 no da: se para y se avisa.
- Vuelta atrás: `scripts/sql/181_rollback.sql` — vuelve `club_socio_visita_base` al cuerpo exacto de la 150 (md5
  `a5765518…`, probado en la batería), borra las dos internas y la columna y la fila 181 del ledger. No hay datos nuevos:
  se puede correr en cualquier momento. Regla §6: si se corre en prod, en el mismo momento un PR saca el `.sql` de `main`
  (si ya pasó tiempo, la vuelta atrás es una migración nueva hacia adelante con ese cuerpo; regla 10).

## 5. Pruebas
- Batería `scripts/sql/181_pruebas.sql` (runner `181_pruebas.py`) en Postgres 16 local armado con
  `scripts/sql/local_armar_base.sh` (main `240bd39`, **sin** la 181), en transacción descartada, ANTES de aplicar:
  **13/13**. Casos: almuerzo + cena el mismo día; dos en el almuerzo; dos en la cena; borde exacto del corte (15:59:59.999 /
  16:00:00); cruce de locales con cortes distintos; medianoche CR; visitas sin beneficio no gastan; extremo a extremo con
  `club_socio_visita` como cajero (A almuerzo / B cena); invitados/857 y reescaneo sin cambios; tope configurable (2);
  internas cerradas; rollback (md5 de prod, vuelve «una por día»).
- Mutaciones: **14/14 muerden** (`--mutar todas`): tope por día, corte del local de la caja, tope por local, corte
  inclusivo, comida en UTC, día en UTC, cuenta visitas sin beneficio, tope fijo, caja sin tope, texto viejo, sin «vuelve»,
  interna abierta, rollback sin la base, rollback que deja la columna.
- Migración + rollback aplicados en una base local copia: el rollback deja la base con el md5 de prod.
- **Staging (`hwiatgicyyqyezqwldia`):** aplicada el **16/11 ~13:46 -06:00** (archivo exacto + fila `181` del ledger, en
  una transacción, vía el conector). Verificado: ledger 179/180/181, los 4 md5 de §3 idénticos a la base local donde pasó
  la batería, internas cerradas, humo de §3 OK. La batería completa NO se pudo correr en staging: el conector cancela
  las sentencias que modifican (pasa igual con los `drop` de la 158) y el proxy bloquea `api.supabase.com` para el
  runner. Queda para una sesión del dueño si se quiere: **sobre staging ya con la 181, solo los casos 00–11** (el 12
  supone la migración sin aplicar).

## 6. Riesgos conocidos (decisiones aparte, no bloquean)
- **Excepción `SOCIO_USO_ANOMALO` «dos mesas el mismo día»** (155) sigue por día: un socio que usa almuerzo y cena va a
  salir como «probable» en Excepciones. Propuesta: PR aparte que la pase a «dos mesas en la misma comida».
- **Alerta `MISMO_USUARIO`** (164: el mismo usuario registra al mismo socio más de 2 veces en 3 días): con almuerzo y
  cena puede saltar más seguido. Si molesta, el owner sube `club_config.alerta_mismo_usuario_max` del local.
- **Después de medianoche** (00:00–corte) cuenta como almuerzo del día nuevo: una cena que se registra pasada la
  medianoche deja libre el almuerzo de ese día. Con los horarios actuales no pasa.

## 7. Firma y bitácora
| Qué | Quién | Fecha y hora (-06:00) | SHA |
|---|---|---|---|
| Decisión (opción B) | dueño | 2026-11-16 13:36 | — |
| Corte 16:00 CR como el PoS (almuerzo hasta 15:59:59, cena desde 16:00 hasta el cierre); se reusa `turno_corte` | dueño | 2026-11-16 13:59 | — |
| Aplicación en staging | sesión de CC | 2026-11-16 ~13:46 | rama `claude/club-tope-almuerzo-cena` |
| Firma del dueño (SQL final, prod) | | | |
| Merge (Branching) | | | |
| Control §3 | | | |
