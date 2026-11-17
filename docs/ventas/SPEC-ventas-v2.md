# SPEC — Ventas v2: el módulo ordenado por preguntas

**Estado:** SPEC de **investigación / decisión** (16-nov-2026). No autoriza código: cada fase necesita el OK del
dueño, y las que tocan esquema, su firma.
**Insumos:** [AUDITORIA-VENTAS-2026-11.md](AUDITORIA-VENTAS-2026-11.md) · maqueta
[maqueta-ventas-v2.html](maqueta-ventas-v2.html) (datos ficticios) ·
`docs/analisis/2026-11-mediodia-localclub/specs/SPEC-analisis-ventas-integrado.md` (3-nov), que esta SPEC
extiende a todo el módulo · `docs/SPEC-prompax-explicado.md` · `docs/club-satori/ESTANDAR-reportes.md`.

## 1. Idea

Hoy Ventas tiene 18 vistas ordenadas por **tipo de reporte** (Histórico, Mix, Análisis, Calendario…). Para
usarlo hay que saber en cuál está cada número, y cada vista tiene su propio selector de fechas.

La v2 lo ordena por **las cinco preguntas** que se hace quien mira el negocio, con **un solo selector de
período y de comparación** arriba, que se conserva al pasar de una pregunta a otra:

| Pregunta | Qué contesta |
|---|---|
| **¿Cómo voy?** | Venta, personas, venta por persona, meta y proyección, contra una base justa |
| **¿Qué vende?** | Mix por categoría y producto, lo que sube y lo que baja, ingeniería de menú |
| **¿Quién vende?** | Saloneros, cajas y canales |
| **¿Cuándo vendo?** | Día de semana, hora, turno, quincena, temporada, calendario |
| **¿Cuánto regalo?** | Descuentos, cortesías, consumo del personal y de los dueños |

Aparte quedan **En vivo** (el servicio en curso; no lleva selector) y **Ajustes** (metas, catálogo, competencias).

**Reglas de diseño:**

1. **Nunca se compara un período en curso contra uno completo.** Si el período no terminó, la base se recorta
   a los mismos días y el rótulo dice «a la fecha».
2. **Un número, una definición.** Cada indicador tiene una fórmula (§4) y se calcula en un solo lugar.
3. **Cada pantalla abre con su conclusión** en una frase, y después el número protagonista (estándar de reportes §1).
4. **Lo que no se puede medir se dice:** «sin comparación», «dato incompleto», nunca 0 ni −100 %.
5. **No se pierde información:** todo lo que hoy se ve tiene destino en el mapa de §7.
6. **Se agrega en la base,** no en el navegador.

## 2. Qué dice la práctica del rubro

| Fuente | Qué hace | Qué tomamos |
|---|---|---|
| Toast, reporte «Sales Summary» ([ayuda de Toast](https://support.toasttab.com/en/article/Sales-Summary-Report)) | Un resumen en tarjetas: tendencia por fecha, por día de semana y por hora arriba de todo; después neta (bruta − descuentos − reembolsos), categorías, canal, franja del día, anulaciones, y por modo de servicio: comensales, promedio por comensal y tiempo de mesa | El orden: tendencia primero, neta con su puente desde la bruta, y anulaciones y descuentos con sección propia |
| Toast, buenas prácticas ([ayuda de Toast](https://support.toasttab.com/en/article/Reporting-Best-Practices-Weekly-Monthly-Quarterly-Reports)) | Ritmo de revisión: por semana, ventas, descuentos y reembolsos contra la semana anterior y ventas por hora; por mes, categorías por área. El mix de productos compara dos períodos lado a lado | Un ritmo fijo por rol (§6) y el Mix siempre con comparación |
| Lightspeed «Advanced Insights» ([Lightspeed](https://www.lightspeedhq.com/pos/restaurant/advanced-insights/)) | Organiza por lo que se quiere lograr: desempeño del menú, reportes por salonero para ver a quién formar, y un resumen diario por correo cada mañana | Pantallas por pregunta y no por tabla; el resumen de la mañana ya existe en la app |
| Lightspeed, indicadores ([Lightspeed](https://lightspeedhq.com/blog/restaurant-kpis)) | Cuenta promedio = ventas ÷ transacciones; gasto por comensal = ventas ÷ comensales; venta por asiento y hora; venta por salonero | Fórmulas de §4 |
| Revel ([guía de Revel](https://revelsystems.com/guides/intro-reporting-and-analytics-guide)) | Tres familias: ventas (resumen, mix, por hora, historial de órdenes), inventario y empleados | Confirma el corte qué / cuándo / quién |
| Kasavana y Smith, 1982 ([meez](https://www.getmeez.com/blog/menu-engineering-matrix)) | Popular = participación mayor a 70 % de la cuota pareja (1 ÷ cantidad de platos × 0,70). Rentable = margen de contribución en plata por encima del promedio. Cuatro cuadrantes con una acción cada uno | §5.2. Hoy la app usa mediana y margen en %, que no es el método |
| NRF, calendario 4-5-4 ([NRF](https://nrf.com/resources/4-5-4-calendar)) | El comercio minorista arma su calendario para que los meses comparables tengan la misma cantidad de sábados y domingos | Comparar contra el año anterior **alineado por día de semana** (−364 días) |
| Toast, indicadores ([Toast](https://pos.toasttab.com/blog/on-the-line/restaurant-kpis)) | Costo primo = costo de lo vendido + mano de obra, revisado por semana; RevPASH = ingreso ÷ (asientos × horas abiertas), de Sheryl Kimes (Cornell) | Fase 4: necesitan costos, planilla y asientos |
| TouchBistro, referencias ([TouchBistro](https://www.touchbistro.com/blog/important-restaurant-benchmarks)) | Costo primo sano: 55–60 % de la venta | Referencia para la Fase 4 |

**No verificado en esta sesión:** la página de reportes de Square for Restaurants no se pudo abrir (pedido de
permiso sin respuesta) y la de STR (hotelería) redirige a otro sitio. Lo de hotelería —mes a la fecha, año a la
fecha y comparación por día de semana como vistas estándar— queda como práctica conocida **sin fuente citada**.

## 3. Período y comparación: el motor

Un módulo puro, `periodos.ts`, que extiende `periodosPromPax.ts` y `temporadas.ts` (ya en `main`, con pruebas).
Toda vista recibe de ahí el período y sus bases; ninguna calcula fechas por su cuenta.

### 3.1 Conceptos

- **Día:** día de Costa Rica de la factura. Hoy = `todayCR()`.
- **Último día cerrado (`N`):** ayer. El día de hoy está en curso y **no entra** en ninguna comparación de
  períodos; se muestra aparte como «hoy, en curso».
- **Día abierto:** día con al menos una factura cerrada.
- **Semana:** lunes a domingo (ISO), como ya usa `periodosPromPax.ts`.
- **Quincena:** 1.ª = días 1 al 15; 2.ª = día 16 a fin de mes (13 a 16 días).
- **Temporada:** los cuatro tramos de `temporadas.ts` (alta 15-dic a 30-abr, baja de mayo, media jun–ago, baja
  1-sep a 14-dic).

### 3.2 Períodos del selector

Ejemplo con hoy = lunes 16-nov-2026, así que `N` = domingo 15-nov.

| Opción | Rango | ¿En curso? |
|---|---|---|
| **Hoy** | 16-nov, hasta la hora actual | Sí: compara contra la misma hora (§3.4) |
| **Ayer** | 15-nov | No |
| **Semana** | Lunes de la semana de `N` → `N`: 9 al 15-nov | Cerrada este lunes; de martes a domingo va «a la fecha» |
| **Quincena** | Quincena de `N` → `N`: 1 al 15-nov | Cerrada hoy; del 17 al 30 va «a la fecha» |
| **Mes a la fecha** | Día 1 → `N`: 1 al 15-nov | Sí |
| **Mes** | Último mes cerrado, o el que se elija: octubre | No |
| **Año a la fecha** | 1-ene → `N` | Sí |
| **Temporada** | Tramo de `N`, hasta `N` | Sí, salvo que se elija uno cerrado |
| **Rango** | Dos fechas | Si la punta final es hoy, se recorta a `N` |

Las flechas ‹ › mueven el período entero: semana anterior, quincena anterior, mes anterior.

### 3.3 Bases de comparación

Cada vista muestra **dos bases a la vez** (A y B), como la SPEC del 3-nov. Se eligen entre tres:

| Base | Regla | Para qué sirve |
|---|---|---|
| **Período anterior equivalente** | El período inmediato anterior del mismo tipo, **recortado a los mismos días transcurridos** | Tendencia reciente |
| **Año anterior, mismas fechas** | Las mismas fechas un año antes | Lo que pide el contador |
| **Año anterior, mismo día de semana** | El rango corrido 364 días (52 semanas): misma cantidad de viernes y sábados | La comparación más justa del nivel de venta |

**«Mismos días transcurridos», período por período** (`k` = días transcurridos):

| Período | Período anterior equivalente | Año anterior, mismas fechas | Año anterior, mismo día de semana |
|---|---|---|---|
| Hoy | Mismo día de la semana pasada, a la misma hora | — | Mismo día de semana 52 semanas antes, a la misma hora |
| Ayer | Mismo día de la semana anterior | Misma fecha | −364 días |
| Semana a la fecha | Lunes → mismo día de la semana anterior | — (una semana no tiene «mismas fechas») | Misma semana ISO −364 días, mismos `k` días |
| Quincena | Misma quincena del mes anterior, primeros `k` días | Misma quincena, primeros `k` días | Lo anterior −364 días |
| Mes a la fecha | Días 1 a `k` del mes anterior | Días 1 a `k` del mismo mes | Lo anterior −364 días |
| Mes cerrado | Mes anterior completo | Mismo mes | Mismo mes −364 días |
| Año a la fecha | — | 1-ene → misma fecha | Lo anterior −364 días |
| Temporada | Tramo anterior («otra temporada: mirá la dirección, no el nivel») | Mismo tramo, mismos `k` días | Lo anterior −364 días |
| Rango | Mismo largo, termina el día antes | Mismas fechas | −364 días |

**Bordes:**

- **Quincena contra la otra quincena del mismo mes no es base por defecto:** la 2.ª tiene entre 13 y 16 días.
  Por eso la base A es la misma quincena del mes anterior. La tabla de quincenas (§5.4) las muestra todas con
  su **venta por día abierto**.
- **Mes anterior más corto** (31-mar contra febrero): la base se corta en el último día del mes y se rotula
  «28 días contra 31».
- **Largo o días abiertos distintos:** además del total se muestra la **venta por día abierto**.
- **29 de febrero:** pasa al 28 (`mismoDiaAnioAnterior`, ya existe).
- **Sin datos en la base** (antes del 5-ene-2024 solo hay resumen diario; un local nuevo no tiene año anterior):
  si falta el dato que la vista necesita, «sin comparación».
- **Muestra chica:** con menos de 100 personas en una celda (un salonero en una semana), el cambio se muestra
  en gris, sin flecha.
- **Semana Santa y feriados móviles:** ninguna base los alinea. Fase 3: lista de fechas especiales que marca el
  gráfico y avisa «la base incluye Semana Santa».

### 3.4 «Hoy» contra la misma hora

El día en curso se compara contra lo vendido **hasta la misma hora** del mismo día de la semana pasada y del
promedio de las 4 anteriores. Es lo que ya hace el ritmo de «En vivo». «Hoy» en la v2 es un resumen de una
línea que lleva a «En vivo»; el detalle del último día cerrado es **Ayer**.

### 3.5 Pruebas del motor (aceptación)

- Para cada día de 2024 a 2030 y cada tipo de período: las bases no se pisan con el período, tienen el mismo
  largo en días (o declaran la diferencia) y el rótulo coincide con las fechas.
- Reloj fijo de noche en CR (23:30 CR = 05:30 UTC del día siguiente).
- Caso real de la auditoría: el 16-nov, «mes a la fecha» = 1–15 nov; base A = 1–15 oct; base B alineada =
  2–16 nov del año anterior.
- Mutación: comparar contra el mes anterior completo → cae.

## 4. Indicadores: definición exacta

Fuente: `pos_ndf_tickets` (`t`) y `pos_ndf_ticket_lines` (`l`), solo facturas `estado = 'C'`, día CR de
`fecha_registra`, por local. La lectura va siempre por funciones (regla 6 de `ESTADO.md`), sin medios de pago.

### 4.1 Ventas y personas

| Indicador | Fórmula | Nota |
|---|---|---|
| **Venta neta** | Σ `l.monto` con `l.familia` fuera de {6, 17, 20} | Definición firmada (`netaVenta.ts`). Sin IVA ni servicio |
| Venta bruta | Neta + Σ `t.iva_crc` + Σ `t.servicio_crc` | Para el contador |
| **Personas** | Σ pax de la factura (artículo pax; si falta, `t.pax`) | Se muestra con su **cobertura**: % de facturas de salón con pax |
| Facturas | Cantidad de facturas cerradas | |
| **Venta por persona** | Neta de salón ÷ personas de salón (`t.canal = 'salon'`), incluida la neta de facturas de salón sin pax | **La única**, firmada en `SPEC-prompax-explicado.md` §5. Reemplaza las cuatro de hoy |
| Venta por persona, limpia | Neta ÷ personas, solo facturas de salón con pax | Rotulada; para comparar saloneros |
| Cuenta promedio | Neta ÷ facturas | Por canal: en delivery es el indicador principal |
| Venta por día abierto | Neta ÷ días abiertos | Para períodos de distinto largo |
| **Salón / Delivery / Llevar / Barra** | Neta por `t.canal` | Canal de la factura, nunca «lo que cobró la caja» |
| Bebidas por persona | Unidades de familia 5 en salón ÷ personas de salón | |
| Relación comida/bebida | Neta de comida ÷ neta de bebida (familias 2, 3, 4, 13, 16, 29 contra 5) | |
| Participación en el mix | Neta del grupo ÷ neta de comida y bebida | Con la línea «otros» (merch, gift cards, promociones) que cierra contra la neta |

### 4.2 Personas que venden

| Indicador | Fórmula | Nota |
|---|---|---|
| Venta del salonero | Neta de las facturas con su `salonero_login` | Lente «mesa». La lente «línea» sigue en «Por línea» |
| Venta por persona del salonero | Su neta de salón ÷ sus personas | Contra el equipo en el mismo período **y turno** |
| ICP | Propina electrónica declarada ÷ neta de sus mesas | Regla 5 de `ESTADO.md`, sin cambios |
| Venta sugerida | % de mesas con entrada, con postre y con segunda bebida | Fase 3 |
| Consistencia, tendencia, racha | Las de «Evaluación» | Sin cambios |

### 4.3 Meta y proyección

| Indicador | Fórmula |
|---|---|
| Avance | Neta de días cerrados del mes ÷ meta del mes |
| **Ritmo** | Avance ÷ parte del mes que ya pasó, **ponderada por día de semana**: Σ peso de los días cerrados ÷ Σ peso de todos los días del mes. Peso de un día = promedio de la neta de ese día de semana en las últimas 8 semanas cerradas |
| **Proyección del mes** | Neta de días cerrados + Σ peso de los días que faltan × (neta de días cerrados ÷ Σ peso de los días cerrados) |
| Necesario por día | (Meta − neta de días cerrados) ÷ días que faltan |

La proyección va siempre con su rango (±, por el desvío de las últimas 8 semanas) y nunca usa el día en curso.
La proyección anual por promedio simple se retira: con la temporada alta de por medio no sirve; la reemplaza
«año a la fecha contra el año anterior a la misma fecha».

### 4.4 Regalos y descuentos

| Indicador | Fórmula | Disponible hoy |
|---|---|---|
| Cortesías | Σ valor a precio de lista de líneas de familia 17 + `regalia_crc` | Parcial: revisar el estado `X` (auditoría P2-7) |
| Consumo del personal | Líneas de familia 6 | Sí, a precio cargado |
| Consumo de dueños | Familia 28 y clase `duenos` | Sí |
| **Descuento** | Σ (precio de lista − precio cobrado) por línea, por programa (Local Club, tarjeta, personal) | **No:** falta ingestar el descuento por línea (P1-8) |
| % regalado | (Cortesías + descuentos) ÷ (neta + cortesías + descuentos) | Cuando haya descuento |
| Anulaciones | Facturas `X` que no son regalía: cantidad y valor | Sí |

### 4.5 Fase 4 (necesitan datos que hoy no están)

Margen por plato y **margen de contribución** (costo por producto), **costo primo** (costo de lo vendido +
planilla), **RevPASH** (asientos y horas abiertas), tiempo de mesa (`pedido_abierto_en`, que existe solo desde
nov-2026) y frecuencia de visita del socio (Club Satori).

## 5. Pantallas

Barra fija en todas: **Local** · **Período** (§3.2) con flechas · **Comparar con** (dos de las tres bases) ·
filtros opcionales **Canal** y **Turno**. Debajo, en gris, el período en palabras: «1 al 15 de noviembre (15
días) contra 1 al 15 de octubre y contra 2 al 16 de noviembre de 2025. Hoy, en curso, no entra.»

### 5.1 ¿Cómo voy?

1. **Bajada:** una frase armada con los datos. «Vas 9 % arriba de octubre a la misma fecha y 7 % abajo del año
   pasado. Entra más gente; gasta casi lo mismo.»
2. **Cuatro cifras,** cada una con A y B: venta neta · personas · venta por persona · cuenta promedio.
3. **Meta del mes:** avance, ritmo, proyección con rango y necesario por día.
4. **Gráfico por día:** barras del período, línea de la base B alineada y franja de temporada alta.
5. **Quincenas:** las últimas seis, con venta, venta por día abierto y A/B (§5.4).
6. **Qué explica el cambio:** 1 a 3 frases de la descomposición de «Prom/PAX explicado», que queda a un clic.
7. **Contabilidad:** la tabla por día de hoy (bruta, IVA, servicio, neta, canales, personas), CSV y reporte del mes.
8. **Calidad del dato:** aviso solo si algo pasa el umbral (facturas de salón sin pax > 5 %, PoS sin lecturas).

### 5.2 ¿Qué vende?

1. **Bajada:** la categoría que más movió el mix.
2. **Mix por categoría:** participación, cambio en puntos contra A y B, venta y unidades. Se abre a
   subcategoría y producto. **Cada categoría aparece una sola vez** (catálogo único, §8).
3. **Suben y bajan:** los cinco productos que más ganaron y más perdieron venta contra la base.
4. **Sin ventas en el período:** la lista de hoy, solo de productos activos.
5. **Ingeniería de menú (Kasavana–Smith):** por categoría de comida. Popular si su participación en unidades
   supera 0,70 ÷ cantidad de platos; rentable si su margen en ₡ supera el promedio ponderado. Hasta que haya
   costos (Fase 4) muestra solo el eje de popularidad y dice cuántos productos tienen costo.
6. **Canal:** el mismo mix filtrado por salón, delivery o llevar.

### 5.3 ¿Quién vende?

1. **Equipo:** una fila por salonero: venta, personas, venta por persona contra el equipo de su turno, bebidas
   por persona, ICP, días trabajados. Muestra chica en gris.
2. **Ficha del salonero:** tendencia de 12 semanas, consistencia, racha, sus productos, comparación A/B.
3. **Por línea:** las dos lentes de hoy, sin cambios.
4. **Cajas y canales:** lo de «Cajeros»: cajas de turno, delivery, cuenta promedio, atribución.
5. **Competencias:** se mantiene acá, como lista simple (decisión D6).

### 5.4 ¿Cuándo vendo?

1. **Día de semana:** índice de cada día (100 = día promedio) en el período y en la base.
2. **Hora y turno:** mapa de calor día × hora (hora CR de la factura; mediodía hasta las 16:59, noche desde
   las 17:00) y venta por turno. Franja por **hora**, no por turno de caja (trampa conocida).
3. **Quincenas:** tabla de las últimas 12, cada una con venta, venta por día abierto, personas y A/B.
4. **Meses y temporadas:** el comparativo año contra año de hoy, con el mes en curso **a la fecha** y rotulado.
5. **Calendario:** el detalle por fecha de hoy, con mejor y peor día y fechas especiales.

### 5.5 ¿Cuánto regalo?

1. **Bajada:** % de lo servido que no se cobró a precio de lista.
2. **Por tipo:** cortesías, personal, dueños, descuentos por programa: valor, % de la venta y A/B.
3. **Por salonero y por día:** dónde se concentran.
4. **Anulaciones:** cantidad y valor.
5. **Aviso de dato pendiente** mientras el descuento por línea no se ingeste: la pantalla muestra lo que hay
   (cortesías, personal, dueños, anulaciones) y dice qué falta.

### 5.6 En vivo y Ajustes

- **En vivo:** sin cambios de contenido. Gana el selector de local de la barra.
- **Ajustes:** Metas (por local), Productos (catálogo) y Competencias (alta y baja).

## 6. Qué ve cada rol

No cambia ningún permiso: es el mismo reparto de `ventasTabs.ts`, pasado a las pantallas nuevas.

| Pantalla | owner | manager | contador |
|---|---|---|---|
| ¿Cómo voy? | Sí | Sí | Sí (abre en «Contabilidad») |
| ¿Qué vende? — mix, suben y bajan | Sí | Sí | Sí |
| ¿Qué vende? — ingeniería de menú | Sí | Sí | No |
| ¿Quién vende? — equipo, ficha, por línea, competencias | Sí | Sí | No |
| ¿Quién vende? — ICP, cajas y canales | Sí | Sí | Sí |
| ¿Cuándo vendo? | Sí | Sí | Sí |
| ¿Cuánto regalo? | Sí | Sí | Sí (decisión D7) |
| En vivo | Sí | Sí | Sí |
| Ajustes — metas | Sí | Sí | Sí |
| Ajustes — productos, competencias | Sí | Sí | No |

El manager solo ve su local (como en el Club, mig. 176); el owner ve todos y el consolidado. Salonero y cajero
siguen sin entrar a Ventas: lo suyo es «Mi Rendimiento».

**Ritmo sugerido:** cada mañana, «¿Cómo voy?» con **Ayer** · lunes, **Semana** · días 1 y 16, **Quincena** ·
primer día del mes, **Mes** · con cada cambio de carta, «¿Qué vende?».

## 7. Mapa viejo → nuevo

| Vista de hoy | Destino | Se pierde |
|---|---|---|
| Hoy | «¿Cómo voy?» con período **Ayer** (último día cerrado) + línea «hoy, en curso» que lleva a En vivo. Ranking del día → «¿Quién vende?». Top del día → «¿Qué vende?». El mensaje para WhatsApp se queda | Nada |
| En vivo | En vivo | Nada |
| Saloneros | «¿Quién vende?» → Equipo | Nada |
| Por línea | «¿Quién vende?» → Por línea | Nada |
| Evaluación | «¿Quién vende?» → Ficha del salonero y columnas del equipo | Nada |
| ICP | «¿Quién vende?» → columna ICP y su tendencia | Nada |
| Competencias | «¿Quién vende?» → Competencias; alta en Ajustes | Nada |
| Análisis → Año vs Año | «¿Cuándo vendo?» → Meses y temporadas, a la fecha | El «−X %» engañoso |
| Análisis → Detalle anual | «¿Cómo voy?» con período Año + «¿Cuándo vendo?» → Quincenas | Nada |
| Análisis → Proyección | «¿Cómo voy?» → Meta del mes | La proyección anual lineal (§4.3) |
| Análisis → Prom/PAX explicado | «¿Cómo voy?» → Qué explica el cambio | Nada |
| Histórico | Rango → selector; indicadores → «¿Cómo voy?»; gráfico → Ficha del salonero; top → «¿Qué vende?» | La pestaña |
| Calendario | «¿Cuándo vendo?» → Día de semana y Calendario | Nada |
| Mix (ver y comparar) | «¿Qué vende?»: una sola tabla, siempre con comparación | Comparar 6 meses a la vez pasa a 2 bases; la serie larga va como gráfico de 12 meses por categoría (D5) |
| Ventas | «¿Cómo voy?» → Contabilidad | Nada |
| Cajeros | «¿Quién vende?» → Cajas y canales; bloque de día de semana → «¿Cuándo vendo?» | Nada |
| Ing. Menú | «¿Qué vende?» → Ingeniería de menú | Nada |
| Metas | Ajustes → Metas; avance en «¿Cómo voy?» | Nada |
| Productos | Ajustes → Productos | Nada |
| Cargar XLS, Paridad | Se retiran en `claude/ventas-desde-pos` | Ya decidido |

Los enlaces viejos (`/ventas?tab=mix`) redirigen a la pantalla nueva.

## 8. Datos y arquitectura

- **Agregados en la base.** Tres funciones de solo lectura, con rol validado adentro (`role` + `is_active`) y
  local como parámetro, sin medios de pago:
  1. `pos_prompax_agregado` (mig 080, **ya existe**): día × franja × salonero × canal → facturas, personas,
     neta. Alcanza para «¿Cómo voy?», «¿Quién vende?» y «¿Cuándo vendo?».
  2. **Nueva** `pos_ventas_productos`: período × canal → código, nombre, familia, unidades, neta.
  3. **Nueva** `pos_ventas_regalias`: día × tipo × salonero → cantidad y valor.
- **Catálogo único.** La categoría se resuelve por **código de producto**, no por nombre: una tabla de
  categorías (familia del PoS → categoría y subcategoría de la carta, con excepciones por código). Reemplaza la
  fusión por nombre y termina con los dos vocabularios. Lleva migración y firma.
- **Módulos puros con pruebas:** `periodos.ts`, `indicadores.ts`, `proyeccion.ts`, `menuEng.ts`.
- **Multi-local desde el día uno:** local en la barra, en cada función, en metas y en el catálogo. Nosara
  aparece sola cuando tenga PoS; el consolidado es la suma de locales.
- **Rendimiento (aceptación):** ninguna pantalla trae líneas crudas; «¿Cómo voy?» con un año de datos abre con
  3 pedidos o menos.
- **Sagrados:** no se toca ninguno. `netaVenta.ts` no es sagrado, pero su definición está firmada: no cambia.

## 9. Plan por fases (PRs chicos)

| Fase | PR | Qué | Toca | ¿Firma? |
|---|---|---|---|---|
| 0 | 0.1 | **Arreglo del Mix** (auditoría §3.4) | `VentasMix.tsx` + prueba | OK de merge + validación física |
| 0 | 0.2 | Fechas en hora CR en Análisis (P2-4) y rótulo «Mes en curso — meta» | `VentasAnalisis.tsx` | OK de merge |
| 1 | 1.1 | `periodos.ts` con pruebas (§3.5). Sin pantalla | Módulo puro | No |
| 1 | 1.2 | `indicadores.ts`: una sola venta por persona y un solo «salón», con prueba de contrato | Módulo puro | No |
| 1 | 1.3 | **«A la fecha» en lo que ya existe:** Análisis y Mix → Comparar usan el motor y rotulan | Pantallas actuales | OK + validación física |
| 2 | 2.1 | Barra global (local, período, comparar) + «¿Cómo voy?» sobre `pos_prompax_agregado` | Pantalla nueva; las viejas siguen | OK + validación física |
| 2 | 2.2 | `proyeccion.ts` y bloque de meta | Módulo puro + pantalla | OK |
| 2 | 2.3 | «¿Cuándo vendo?»: día de semana, hora, quincenas, calendario | Pantalla | OK + validación física |
| 3 | 3.1 | `pos_ventas_productos` + catálogo único | **Migración** | **Firma** |
| 3 | 3.2 | «¿Qué vende?» | Pantalla | OK + validación física |
| 3 | 3.3 | «¿Quién vende?» | Pantalla | OK + validación física |
| 3 | 3.4 | `pos_ventas_regalias` + «¿Cuánto regalo?» con lo disponible | **Migración** + pantalla | **Firma** |
| 3 | 3.5 | Retiro de las vistas viejas, redirecciones y guía `docs/sop-app/6.4` | Navegación + SOP | OK + validación física |
| 4 | 4.x | Descuento por línea (puente + Edge), costos por producto, margen, costo primo, RevPASH, fechas especiales | Puente, esquema | **Firma** cada uno |

Cada PR de pantalla dice en concreto qué va a ver el encargado y actualiza la guía SOP en el mismo PR. Las
pantallas nuevas conviven con las viejas hasta la 3.5.

## 10. Decisiones abiertas

**D1 — Estructura por preguntas**
- Opciones: (A) cinco preguntas + En vivo + Ajustes · (B) dejar las 8 entradas de hoy y solo unificar el
  selector · (C) tres: Resumen, Detalle, Equipo.
- Recomendación: **A.** Es lo pedido y lo que mejor ordena sin perder nada.
- ¿Firma?: OK del dueño (cambia lo que ve el encargado).

**D2 — Hasta qué día llega «a la fecha»**
- Opciones: (A) hasta ayer, con hoy aparte · (B) incluir hoy, comparando hasta la misma hora.
- Recomendación: **A.** B depende de que el PoS esté al día y complica cada base.
- ¿Firma?: OK.

**D3 — Bases que se muestran por defecto**
- Opciones: (A) período anterior equivalente + año anterior alineado por día de semana · (B) período anterior
  equivalente + año anterior mismas fechas (lo del contador) · (C) las tres.
- Recomendación: **A** en pantalla, con **B** a un clic y en el CSV del contador. Tres columnas de cambio no
  se leen.
- ¿Firma?: OK; conviene que opine el contador.

**D4 — Venta por persona única**
- Opciones: (A) la firmada: neta de salón ÷ personas de salón · (B) neta total ÷ personas · (C) solo mesas con pax.
- Recomendación: **A** como principal y **C** rotulada «limpia» para comparar saloneros. Los números de
  «Análisis» y de «Hoy» van a cambiar un poco: se avisa en el PR.
- ¿Firma?: **Sí**; cambia un indicador que se usa para evaluar al equipo.

**D5 — Mix → Comparar hasta 6 meses**
- Opciones: (A) reemplazar por dos bases + gráfico de 12 meses por categoría · (B) mantener la tabla de 6.
- Recomendación: **A.**
- ¿Firma?: OK.

**D6 — Competencias (0 cargadas en prod)**
- Opciones: (A) mantener, reubicada · (B) esconderla detrás de Ajustes hasta que se use · (C) sacarla.
- Recomendación: **A**, sin invertir en ella.
- ¿Firma?: OK.

**D7 — ¿El contador ve «¿Cuánto regalo?»?**
- Opciones: (A) sí · (B) solo totales, sin detalle por salonero.
- Recomendación: **B.**
- ¿Firma?: OK.

**D8 — Catálogo único por código**
- Opciones: (A) tabla nueva de categorías por familia y código · (B) seguir con `product_map` por nombre y
  solo limpiar duplicados.
- Recomendación: **A.** B deja viva la causa de fondo de los errores del Mix.
- ¿Firma?: **Sí** (esquema).

**D9 — Ingesta del descuento por línea**
- Opciones: (A) ahora, en paralelo a la Fase 2 · (B) en la Fase 4.
- Recomendación: **A.** Es lo que le falta a la quinta pregunta y además sirve para medir el Club.
- ¿Firma?: **Sí** (puente, Edge y esquema).

**D10 — Semana**
- Opciones: (A) lunes a domingo · (B) domingo a sábado.
- Recomendación: **A** (ya es la del motor y la del resumen semanal).
- ¿Firma?: OK.

## 11. Fuera de alcance

- Construir cualquier parte de esto.
- Mi Rendimiento, Resumen diario y semanal, y el reporte mensual por correo: usan los mismos indicadores y
  conviene que adopten `periodos.ts` e `indicadores.ts` después de la Fase 1.
- Caja, propinas y archivos sagrados.
