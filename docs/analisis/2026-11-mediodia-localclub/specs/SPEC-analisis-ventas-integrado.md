# SPEC v1 — Análisis de ventas integrado: Mediodía · Local Club · Delivery · Productos · 2026-11-03

> **Qué es este documento:** junta en un solo módulo todo lo analizado el 03/11 y le suma la regla de comparación de períodos que pidió Ismael.
> **Absorbe** a `claude/SPEC-reporte-mediodia.md` (v2, queda como anexo de la pestaña Mediodía). **Se apoya** en `claude/SPEC-prompax-explicado.md` (descomposición, temporadas, RPC).
> **EN ESPERA:** necesita el arreglo de roles (SEC-01, P0) y las firmas de datos de §6. Mientras tanto se pueden avanzar en rama aparte los módulos puros y sus tests (§7, Fase 1), porque no tocan base ni UI.
> **Reportes de la investigación:**
> - [Reporte resumido (principal)](https://claude.ai/artifact/2ZWjtnE72jC28A5kSvjQyf)
> - [Reporte de detalle](https://claude.ai/artifact/UFxajJtFfVkVGHUHL5x8HG)
>
> **Consultas:** `claude/SQL-analisis-mediodia.md` (Q0–Q10), `claude/SQL-analisis-mediodia-ronda5.md` (Q11–Q17) y `claude/SQL-analisis-ronda6.md` (Q18–Q20, D1–D3).

## 1. Objetivo
Una sola pantalla, **Ventas → Análisis**, que responda tres preguntas para el período elegido y contra los períodos de comparación:
1. **Qué cambió:** venta, personas, gasto por persona y margen.
2. **Por qué cambió:** mezcla, canales, Local Club, menú y productos.
3. **Qué hacer:** palancas con su efecto en ₡ por mes.

- **Roles:** owner, manager y contador, **activos**.
- **Acceso:** solo lectura.
- **Límites:** no toca caja, propinas ni archivos sagrados. Es multi-local: Nosara aparece cuando tenga PoS.

## 2. Comparación de períodos (regla central)
Cada vista muestra **dos comparaciones a la vez** (A y B), con su Δ en ₡ y en %.

| Lo que elegís | Comparación A | Comparación B |
|---|---|---|
| **Mes** | mes anterior | mismo mes del año anterior |
| **Temporada** (tramo) | **mismo tramo del año anterior** | **tramo inmediatamente anterior** (otra temporada) |
| **Semana ISO** | semana anterior | misma semana ISO del año anterior |
| **Día** | mismo día de la semana anterior | mismo día de la semana, 52 semanas antes |
| **Rango libre** | período anterior de igual largo | mismo rango del año anterior |

**Reglas:**
- **Temporadas:** las de SPEC-prompax §4. Alta va del 15-dic al 30-abr, baja-may es mayo, media va de jun a ago y baja-sepdic del 1-sep al 14-dic.
  - Para la comparación B, el «tramo inmediatamente anterior» es el que terminó justo antes de que empiece el elegido. Ejemplo: si elegís alta 2026, la B es baja-sepdic 2025.
  - Esa columna se rotula «otra temporada: mirá la dirección, no el nivel».
- **Período en curso:** si el período elegido no terminó, las dos comparaciones usan **los mismos días transcurridos**. Ejemplo: 1 al 3 de noviembre contra 1 al 3 de octubre y contra 1 al 3 de noviembre del año anterior. El rótulo dice «a la fecha».
- **Días distintos:** cuando los dos períodos tienen distinta cantidad de días o de fines de semana, se muestra también la **venta por día abierto**. Un día abierto es un día con al menos una factura.
- **Sin datos:** si el período de comparación no tiene datos (antes del PoS, o un local nuevo), se muestra «sin comparación». Nunca 0 ni −100 %.
- **Fuente única:** las fechas de comparación salen de un **módulo puro** (`periodosComparacion.ts`). Test: para cada día de 2024 a 2030 y cada tipo de selección, la A y la B son únicas, tienen el largo correcto y no se pisan con el período elegido.

## 3. Pestañas

### 3.1 Resumen
- **Tarjetas, cada una con A y B:** venta neta · personas (pax reconstruido) · prom/pax · margen · % de pax en mesas con menú · personas Local Club · pedidos de delivery.
- **«Qué explica el cambio»:** la descomposición en mezcla y rendimiento de SPEC-prompax §6 (corte por turno, día, salonero, **tipo de mesa** y **canal**), en 1 a 3 frases.
- **Calidad de los datos del período:** el aviso de §3.6, si corresponde.

### 3.2 Mediodía
Todo lo de `SPEC-reporte-mediodia.md` v2:
- Mesas con y sin menú, prom/pax de cada grupo y % de pax con menú.
- Margen por persona y **umbral de conveniencia**: margen del menú ÷ margen de la carta. Con los costos de hoy, conviene si ≥ 44 % de los pax son nuevos.
- **Pax nuevos estimados**, con dos escenarios: tendencia de la mañana y de la noche. Si se contradicen, se muestra «no concluyente».
- Platos por 100 pax, ranking, Bento por sección, agregados (entrada, postre, bebida), cumplimiento por salonero y caja.
- **Hitos fijos:** 2025-07-01 Bento · 2025-09-01 menú completo · 2026-02-20 «solo a pedido».

### 3.3 Local Club
Por turno, y en mesas con y sin menú:
- **Asistencia:** personas Local Club (artículo 856) e Invitados (857), invitados por cada Local Club y % de los pax.
- **Plata:** venta y margen por persona y por mesa, contra los clientes normales.
- **Consumo:** productos, platos, entradas, postres y bebidas por persona.
- **Descuento real:**
  - **Implícito**, mientras no se ingeste el descuento: precio neto del mismo producto en mesas Local Club ÷ el de mesas normales, ponderado por venta. Hoy da 13,4 %.
  - **Real**, desde `MontoDescuento` del pedido, cuando se ingeste (§6).
  - **Costo del descuento:** personas LC × (venta por persona normal − venta por persona LC).
- **Cuándo vienen:** % de mesas de lunes a miércoles y de viernes a sábado, y hora media.
- **Avisos:**
  - Al mediodía, si los Local Club son < 3 % de los pax, se muestra «Local Club no cargado al mediodía» en vez de un %.
  - Las cuentas divididas que pierden la marca (Q16) son menores. v1 no las corrige.

**Aceptación (noche, mar–ago 2026):**

| Métrica | Normal | LC con carta |
|---|---|---|
| Venta por persona | 16.934 | 14.205 |
| Margen por persona | 12.732 | 10.365 |
| Productos por persona | 3,02 | 2,96 |

- **LC con menú (sep–nov 2025):** venta 13.246 y margen 8.926 por persona. El 57 % de esas mesas vino de lunes a miércoles.
- **Descuento implícito:** 13,4 %.

### 3.4 Delivery
- **Qué es un pedido:** una factura cerrada de canal delivery, llevar u otro (en jun–ago 2024 el canal vino como «otro»). Control cruzado: `con_servicio = false`.
- **Métricas:**
  - Pedidos, venta, ticket medio y margen por pedido.
  - % con menú.
  - Por turno, día de la semana y hora.
  - Top de productos.
- **BOXING** (código 1075, cargo de empaque): % de pedidos con BOXING. Si es < 95 %, se avisa. BOXING cuenta en la neta y su costo se toma igual al cargo.

**Aceptación (mar–oct):**

| Año | Pedidos mañana | Venta mañana | Pedidos noche | Venta noche |
|---|---|---|---|---|
| 2024 | 341 | ₡5,22 M | 1.389 | ₡26,6 M |
| 2025 | 363 | ₡5,54 M | 991 | ₡20,0 M |
| 2026 | 439 | ₡5,56 M | 930 | ₡17,9 M |

BOXING presente en el 84 % de los pedidos desde dic-2025.

### 3.5 Productos
- **Ranking:** unidades (el Bento cuenta 1), venta, margen, % de mesas y Δ contra A y B. Con flechas y con los que más suben y más bajan.
- **Altas y bajas:** productos nuevos (primera venta en el período) y discontinuados (sin venta en el período, con venta en la comparación).
- **Ingeniería de menú:** matriz popularidad × margen por plato.
  - **Cuadrantes:** estrella, caballo de batalla, puzzle y perro.
  - **Corte:** el popular está por encima del 70 % de la participación promedio; el rentable, por encima del margen promedio ponderado.
- **Pares de canibalización** (menú → carta). Mapa editable en código: Bowl Teriyaki Lunch → Pollo Teriyaki · Sakura Poke → Poke Wave · Ceviche Tico-Nikkei → Ceviche Peruano · Sushi Duo → California.
- **Agregados por mesa:** % de mesas con entrada, postre y bebida, por salonero. Sirve para medir la venta sugerida.
- **Precio neto por unidad en el tiempo:** detecta cambios de precio y deja ver qué pasó con las unidades después del cambio.

### 3.6 Calidad de datos (siempre visible si algo falla)

| Señal | Umbral para avisar |
|---|---|
| Mesas de salón sin pax | > 5 % |
| Local Club sin cargar al mediodía | < 3 % de los pax |
| Pedidos de delivery sin BOXING | > 5 % |
| Facturas sin mesa | > 10 % |
| Venta de productos sin costo real | > 10 % |
| Producto de familia 29 sin mapa | cualquiera |
| Comidas de dueños, personal o errores mezcladas en la venta | cualquiera (necesita `NombreCliente`, §6) |

## 4. Definiciones (las mismas de toda la app)
- **Neta:** Σ de líneas menos las familias {6, 17, 20}. El día se toma en hora CR, solo `estado='C'`.
- **Pax reconstruido:**
  - Si la mesa tiene pax, se usa ese.
  - Si no tiene, se estima con el promedio de pax de las mesas con pax que tienen la misma combinación de turno, con/sin menú, platos (0–6, el Bento cuenta 1) y bebidas (0–6). La calibración es desde 2025-09-01.
  - **Aceptación del modelo:** error ≤ 0,6 pax por mesa y sesgo entre −8 % y +5 %.
- **Prom/pax** = neta ÷ pax reconstruido. El **prom/pax limpio** (solo mesas con pax) va rotulado.
- **Margen** = neta − costo. El costo es costo unitario × cantidad, sacado de `costos_producto` (§6). Si no hay costo, se usa un % por familia (comida 22 %, bebida 33 %, menú 37 %), rotulado «estimado».
- **Menú** = familia 29.
  - **Bebidas del menú:** 1048–1055 y 310. **Extra:** 1077.
  - **Bento:** 4 líneas = 1 box.
- **Local Club** = mesa con el artículo 856. **Invitado** = artículo 857.
- **Turno** = `pos_ndf_tickets.turno`. Los canales son los de `pos_ndf_tickets.canal`.

## 5. Arquitectura
- **Módulos puros (TS), sin I/O:**
  - `periodosComparacion.ts` (§2)
  - `paxReconstruido.ts`
  - `margen.ts` (costos con fallback)
  - `descomposicion.ts` (reusa el de Prom/PAX explicado)
  - `localClub.ts`
  - `delivery.ts`
  - `productos.ts` (ranking, matriz, canibalización)

  Cada uno lleva tests de propiedad y tests con los números de aceptación de §3.
- **Datos:** RPC de agregado de solo lectura (extiende el de Prom/PAX explicado) que devuelve, por día CR, turno, canal, salonero, con_menu y es_lc:
  - tickets, pax, neta;
  - conteos por mesa (platos, bebidas, entradas, postres, LC, invitados, BOXING).

  Más un RPC de productos por período y segmento.
- **Seguridad:** rol validado en la base (`role` + `is_active`).
- **Migraciones:** se aplican a mano, con firma, antes del merge. Nada en `supabase/functions/` va en un PR a main.
- **Rendimiento:** agregar en SQL; nunca traer líneas crudas al navegador.

## 6. Datos que faltan (cada uno con su firma)

| # | Qué | Para qué | Cambio |
|---|---|---|---|
| 1 | **Tabla `costos_producto`** (local, código, costo unitario, vigente desde, fuente), cargada desde Satori_CoGS.xlsx y el PoS | Margen. v1 puede ser un CSV versionado en el repo | Esquema → firma |
| 2 | **Ingestar `FAC_Pedidos.NombreCliente`** (texto libre) | Separar «DUEÑOS», «COMIDA PERSONAL» y «ERRORES» de la venta y del pax. Marcar Local Club aunque falte el artículo | Bridge + Edge + columna → firma |
| 3 | **Ingestar el % de descuento por línea** (`FAC_PedidosDet.Descuento` / `TipoDescuento`; los campos del encabezado vienen vacíos, ver ronda 7) | Separar Local Club 15 %, tarjeta 10 %, personal 30 % y cortesías al 100 %. Hoy se infiere por precio de lista y la inferencia está validada contra el PoS | Igual que #2 |
| 4 | **Arreglar la ingesta de `descuento_crc`, `dolares_*` y `electronico_crc`** (hoy llegan siempre en 0) | Medios de pago y descuento por factura | Revisar el bridge |
| 5 | **Número de socio Local Club** en el pedido (IDCliente / CodigoCliente, con FAC_Clientes del PoS) | Medir **frecuencia de visita** por socio, el dato más valioso para diseñar la oferta | **Operativo** (cómo se carga en caja) + #2 |
| 6 | **Ingestar `FAC_Facturas.CuentaCobrar`** (medio «a crédito») | Los canjes de créditos de comercios (`NombreCliente` «CREDITO…») se cierran «a crédito»: ~₡260 mil/mes en 2026 (~1 % de la venta). El PoS los cuenta como venta y la app coincide con el PoS. No es un error: es venta «a crédito» que nunca se cobra. Para gestión hay que mostrarlos aparte, como costo del programa de tarjetas. Otra opción, operativa: cerrarlos como regalía | Bridge + Edge + columna → firma |
| 7 | **Revisar `regalia_crc` en tickets `cortesia`** | Q26: 9–51 tickets/mes `cortesia` con `valor_servido` > 0 y `regalia_crc` = 0. Ver si las líneas 17 vienen a ₡0 o si el mapper se desvió de la SPEC de regalías | Revisión (sin esquema) |

**Qué NO se ingesta:** teléfono, dirección ni cédula. Son datos personales y no hacen falta.

## 7. Fases
0. **Datos:** CSV de costos (#1 en su versión v1). Pedirle a la operación que cargue LOCAL CLUB al mediodía y que cargue BOXING siempre. Firmar #2 y #3.
1. **Módulos puros + tests** (rama aparte, sin base ni UI): §2, pax reconstruido, margen, descomposición. Puede arrancar ya.
2. **Pantallas Resumen + Mediodía** (después de SEC-01): RPC + UI.
3. **Pestañas Local Club, Delivery y Productos.**
4. **Calidad de datos + ingesta #2/#3**, que mejora Local Club y descuento.

## 8. Más información que conviene sumar (orden de valor)
1. **Delivery de noche:** −33 % desde 2024. Analizar por día, hora, ticket, productos y si hay apps de terceros. Pesa más que todo lo de mediodía.
2. **Frecuencia de Local Club** (#5): cuántos socios distintos vienen y cada cuánto. Define si conviene descuento, menú o puntos.
3. **Costo de regalías** (cortesías, dueños, personal), con `NombreCliente`. Ya existe el valor servido de regalías; falta separar a los dueños del pax.
4. **Venta sugerida por salonero:** % de mesas con entrada, postre y bebida. Hoy las mesas con menú piden entrada el 8–19 % de las veces, contra 35–50 % en carta.
5. **Elasticidad de precio:** qué pasó con las unidades después de cada cambio de precio (precio neto por unidad en el tiempo).
6. **Ritmo por hora y ocupación por turno** (ya está en «En vivo»): ver si el mediodía tiene una hora pico que justifique más personal o promociones de horario.
7. **Contexto externo (opcional, v2):** tipo de cambio y ocupación turística de la zona, para separar temporada de gestión.

## 9. Hallazgos que el módulo tiene que poder reproducir (aceptación global)
- **Mañana, prom/pax reconstruido:**

| Período | Prom/pax |
|---|---|
| 2024 | 12.753 |
| ene–jun 2025 | 11.956 |
| jul–nov 2025 | 10.700 |
| dic 2025 – feb 2026 | 10.476 |
| mar–oct 2026 | 11.232 |

  Pax jul–nov 2025 = 1.666 (+40 % contra 2024).
- **Margen por persona en salón (mañana):** carta 10.500–11.800, menú 5.900–6.500.
- **Mesas con menú en salón, margen y pax por mes:**

| Período | Margen | Pax |
|---|---|---|
| jul–nov 2025 | ₡843 mil | 127 |
| dic 2025 – feb 2026 | ₡1,92 M | 296 |
| mar–jul 2026 | ₡691 mil | 117 |
| ago–oct 2026 | ₡565 mil | 91 |

- **Efecto del menú contra no tenerlo:** baja 2025 +₡470 mil/mes; alta 2025-26 −₡625 mil/mes (escenario con la noche: +₡530 mil, así que «no concluyente»).
- **Descomposición dic–feb → mar–oct 2026:** Δ +906 = mezcla +1.474 · menú −295 · sin menú −273 (test 1e-9).
- **Noche, Local Club:**

| Período | LC total | LC con carta | LC con menú |
|---|---|---|---|
| sep–nov 2025 | 353 | 282 | 71 |
| jul–ago 2025 | 165 | — | — |
| sep–oct 2026 | 116 | — | — |

- **Comparación de períodos (§2):**
  - Mes oct-2026 → A sep-2026 · B oct-2025.
  - Temporada alta 2026 (15-dic-2025 a 30-abr-2026) → A alta 2025 (15-dic-2024 a 30-abr-2025) · B baja-sepdic 2025 (1-sep a 14-dic-2025).

## 10. Fuera de alcance (v1)
- **Nosara:** hasta que tenga PoS.
- **Temporadas e hitos editables:** quedan para v2.
- **Fuentes externas:** quedan para v2.
- **Datos personales de clientes:** no se traen.
