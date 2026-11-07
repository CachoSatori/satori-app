# Club Satori

Módulo propio de la app que reemplaza la página externa de créditos (Firebase `creditos-73bac`): une referentes y créditos, concierges PM y, más adelante, el Local Club con pases de Wallet.

**Fase actual:** F0 ✅ en prod (05/11, migs 072 y 073). **F1a ✅ en staging** (05/11): esquema, RLS y funciones en la **mig 075** (`supabase/migrations/075_club_satori_esquema.sql`), solo staging; el PR **no se mergea hasta el piloto** (Branching la aplicaría en prod). Pruebas: `scripts/sql/075_pruebas_staging.sql` (48/48) · rollback: `scripts/sql/075_rollback.sql` (probado). Ajustes del 05/11: personas para el próximo **medio** crédito (múltiplo de 3); factura obligatoria y normalizada (sin espacios, en mayúsculas) en cupón y canje; tope de créditos canjeados por día (hora CR) = `max_creditos_por_visita`. Sigue F1b (migración desde Firestore) y F1c (pantallas de staff).

**F1c ✅ en staging** (05/11): funciones de staff en la misma 075 (alta y edición de miembros y negocios, búsqueda sin contactos, tarjeta manual, `club_resolver`, regenerar QR, historial de `club_config`, `REFERENTE_INACTIVO`; la caja ya no lee `token_portal`), 77/77 pruebas. Front en `src/modules/club` (ruta `/club`: Escanear, Miembros, Negocios), en una rama apilada sobre la de la F1a; no se mergea a `main`. Formato de los QR: `src/modules/club/qrFormato.ts` (`/r/{8}`, `/c/{10}`, `/p/{token}`). Falta el recorrido real con usuarios de staging. Para la F1d: tope por IP en `club_cupon_crear`.

- [SPEC.md](SPEC.md) — el spec: objetivo, fases F0–F3, flujos, modelo de datos, pantallas, seguridad y migración.
- [PERFIL-SISTEMA-ACTUAL.md](PERFIL-SISTEMA-ACTUAL.md) — relevamiento de solo lectura del sistema actual (bot de Grok, 05-nov). Sin datos de contacto.

Backlog → [PROMPT-CONTINUACION.md](../../PROMPT-CONTINUACION.md) («🟧 Después») · Fases → [ROADMAP.md](../../ROADMAP.md).

**F1f ✅ en staging** (05/11): en `/club` se sumaron **Excepciones** y **Reportes** (owner y manager), con un contador de excepciones abiertas en la tarjeta Club del inicio.
- **SQL, en la 075:**
  - `club_excepciones`: `REGISTRO_SIN_FACTURA` es exacta; `CREDITOS_SIN_CANJE` y `CANJE_MONTO_DISTINTO` son probables, porque se infieren del `cxc` en múltiplos de medio crédito; `PROMO_SIN_CUPON` se enciende sola cuando se carga `club_config.promo_articulo_codigo`.
  - `club_excepcion_resolver` y `club_reporte_mes`.
- **Pruebas:** 100/100.
- **PDF:** sigue el [estándar de reportes](ESTANDAR-reportes.md), con 3 páginas A4, fuentes incrustadas y un anexo CSV.
- **Factura:** se compara solo por dígitos y sin ceros a la izquierda. Falta confirmar qué número ve el cajero.


**Cruce por PEDIDO ✅ en staging** (07/11, decisión de Ismael: con la mesa se confunde cuando se divide la cuenta). En la 075 y en Escanear/Excepciones:
- **Escanear:** después del QR, la lista de pedidos abiertos del local (`club_pedidos_abiertos`): «Pedido 14 · Mesa 20 · ₡48.500 · salonero». Un toque elige. El servidor guarda el pedido, la mesa, el total, cuándo lo vio abierto el puente (`visto`) y la **hora del escaneo** (la del servidor). Si el pedido ya no está abierto, la función lo rechaza y la caja pasa al plan B.
- **Cruce** (`club_cruce_auto`): la **primera factura cerrada con ese `numero_pedido` después de que el puente vio el pedido abierto, con tope de 18 h**. No usa el día de la factura (así se esquiva la medianoche) ni `fecha_cierra` (viene agrupada al cierre). Margen de 2 min por el reloj de la PC del PoS. El mismo número de pedido al día siguiente no cruza con el viejo.
- **`SIN_CRUCE`** (Excepciones, «posible cuenta dividida»): un registro con pedido que no encontró su factura, una vez que el pedido ya no está abierto (o pasaron las 18 h). El PoS cobra las cuentas divididas y las refacturas en facturas **sin pedido**. El manager elige la factura de la lista de facturas sin pedido de ese día (`club_sin_cruce_candidatas`, `club_sin_cruce_elegir`). Queda anotado quién y cuándo (`club_cruces_manuales`) y la excepción queda resuelta con «Factura N elegida». No toca el libro.
- **Plan B:** si el pedido ya se cerró o la lista no carga, la caja elige la factura de la lista de cerradas en las últimas 2 h (`club_facturas_recientes`: hora, total y mesa si tiene). El cruce es exacto. **Ya no se tipean los 4 dígitos del tiquete.**
- **Pruebas:** `075_pruebas_staging.sql`, 128/128 (pedido normal, medianoche, mismo número al día siguiente, tope de 18 h, cuenta dividida → Excepciones → elegir, plan B). vitest en verde.
- **Falta (ítem 11 del puente, en el backlog):** el campo que une las facturas sin pedido con su pedido, la fecha de apertura del pedido y el consecutivo fiscal.

**Cruce v2 con el ítem 11 ✅ en staging** (07/11, firma de Ismael para staging). Hallazgos de Ismael en el PoS: la unión pedido → factura es `FAC_Pedidos.NumeroFactura` (una factura por pedido); las cuentas divididas son facturas **sin pedido** con la mesa en la factura.
- **Escaneo:** se guardan el pedido, la mesa, la apertura del pedido (`pos_ndf_open.pedido_abierto_en`, mig 081) y la hora del escaneo.
- **Cruce** (`club_cruce_facturas`, devuelve la lista):
  1. La **principal** es la factura del pedido: número + apertura, exacto cuando la factura trae `pedido_abierto_en`. Sin ese dato (antes del backfill), la primera con ese número desde la apertura, con tope de 18 h.
  2. Más las facturas **sin pedido de la misma mesa** (`mesa_factura`) registradas entre la apertura y 30 min después de la principal (la cuenta dividida).
  3. Sin principal → `SIN_CRUCE` en Excepciones. El manager ve las facturas sin pedido del día (la misma mesa primero) o busca por los **últimos dígitos del consecutivo** del tiquete.
- **Excepciones:** `CANJE_MONTO_DISTINTO` compara contra la suma del `cxc` de todas las facturas de la visita.
- **Plan B:** la lista de 2 h muestra los últimos 4 dígitos del tiquete cuando llega el consecutivo.
- **Pruebas:** 135/135 en staging. Incluyen los casos reales: el pedido 14 del 05-nov → 112430, y la mesa 19 del 31-oct → 112313 (pedido 33) + 112310 + 112311 (la mesa de la factura se simula hasta que llegue el backfill). También la medianoche y el mismo número al día siguiente.

**Auditoría técnica (Grok, CLUB-AUD-01..13) — correcciones en la 075, en staging** (07/11). Decisiones de Ismael: las correcciones van en la 075; un referente tiene una tarjeta por visita; la restitución reinicia el plazo; la tasa se protege con una guarda (opción a); el cierre de mes se congela con snapshot (opción A).
- **01:** los contactos de los turistas están en `club_cupones_contactos` (solo owner y manager).
- **02:** `club_visita_control` (advisory lock por visita, una tarjeta por referente, Σ personas ≤ pax) más el índice único (miembro, visita) y las excepciones `VISITA_REPETIDA` y `PERSONAS_SOBRE_PAX`.
- **03:** `club_vencer` recalcula el saldo después del lock.
- **04:** `club_reportes_cerrados` + `club_reporte_cerrar` (sha256), y el PM se calcula al cierre por eventos.
- **05:** guarda de la tasa.
- **07 y 08:** locks del miembro y del `p_op`.
- **09:** `club_ajuste` con `p_op`.
- **10:** la restitución cuenta como actividad.
- **11 y 12:** barrido de privilegios y precheck de la 069.
- **13:** las excepciones se acotan por rango, con índices.
- **06:** propuesta en [PROPUESTA-AUD-06.md](PROPUESTA-AUD-06.md).
- **Pruebas:** 167/167 en staging. Las carreras 03, 07 y 08 se verificaron con dos sesiones reales.
- **Las 115 cuentas que vencería `club_vencer` hoy** (simulación de solo lectura, 07/11): suman **174 personas y 0 créditos**. Son 56 cuentas con 1 persona y 59 con 2: restos de menos de medio crédito. **Ninguna** está entre las 37 con saldo activo (66 créditos). Todas son migradas (110 referentes, 3 de equipo y 2 PM), con la última actividad entre oct-2022 y el 03-nov-2025; 62 ya tenían un vencimiento del sistema viejo.
  - **Cómo se calcula `ultima_actividad`:** es la `fecha_visita` más tardía entre tarjetas, canjes y restituciones; los vencimientos no cuentan. En los datos migrados, la tarjeta lleva el `createdAt` de Firestore, que es la fecha de carga y por eso aproximada, y el canje lleva el `createdAt` de su grupo (un canje por referente y minuto UTC). Los vencimientos de la D1 y los del 05-nov no cuentan como actividad.

**Cuenta dividida AMBIGUA** (07/11, decisión de Ismael). Una factura sin pedido que cae en la ventana de **dos** pedidos de la misma mesa (de la apertura a 30 min después de la factura de cada uno) no se asigna a ninguno: va a Excepciones como `AMBIGUA`, con los pedidos que la tocan (`club_cruce_detalle` devuelve el rol: principal, dividida o ambigua). Prueba 35. **Pruebas:** 169/169. Después del backfill del puente, `scripts/sql/club_verificar_backfill.sql` vuelve a correr la mesa 19 del 31-oct con los datos reales.

**Vencimiento seguro** (07/11, decisión de Ismael):
- `club_vencer_simular(p_corte)`: solo owner. Devuelve la lista (miembro, personas, créditos, última actividad) y no escribe nada.
- `club_vencer(p_corte, p_confirmo_total)`: solo vence si el total confirmado coincide con lo que da la simulación en ese momento; si no, error «volvé a simular». Además toma un lock para que haya una sola corrida a la vez.
- **Pantalla:** en Reportes, «Simular vencimiento» → lista → «Confirmar», solo para el owner.
- **Pruebas:** 36. La batería da 174/174.
- **⚠️ Regla para todas las sesiones de Claude Code:** nunca correr `club_vencer` fuera de una transacción que termine en ROLLBACK. Vence todas las cuentas del local, no una (el 07-nov venció por error 115 cuentas de staging; se revirtió).
