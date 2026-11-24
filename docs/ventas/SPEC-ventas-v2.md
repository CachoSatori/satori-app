# SPEC — Ventas v2: el módulo ordenado por preguntas

**Estado:** SPEC **CERRADA** (23-nov-2026). Reemplaza al PR #246, que se cerró sin merge el 19-nov: la versión
del 16/17-nov vivía solo en la rama `claude/spec-ventas-v2` (`aa01749`) y el código de `main` ya la citaba.
Todo lo que dice «hecho» se verificó contra `main` = `e7903cd` (§0). «Cerrada» quiere decir que el diseño de
las fases 0 a 3 ya no se discute; lo único que queda por decidir está en §10.3. No autoriza código por sí
sola: cada PR necesita el OK del dueño, y los que tocan esquema, su firma.
**Insumos:** `docs/analisis/2026-11-mediodia-localclub/specs/SPEC-analisis-ventas-integrado.md` (3-nov), que
esta SPEC extiende a todo el módulo · `docs/SPEC-prompax-explicado.md` · `docs/club-satori/ESTANDAR-reportes.md` ·
la guía `docs/sop-app/6.4 Ventas y Dashboard.md` · la auditoría del módulo y la maqueta del 16-nov (quedaron en
la rama `claude/spec-ventas-v2`, no en `main`) · la ENTREGA G-010 del Auditor (23-nov), contrastada contra el
repo en §13.

## 0. Estado real por fase (23-nov-2026, `main` = `e7903cd`)

Verificado en el código y en los PRs, no en los handoffs. «Evidencia» es el archivo o la migración que lo prueba.

| Fase | Qué | PR (merge, hora CR) | Estado | Evidencia en `main` |
|---|---|---|---|---|
| 0.1 | Mix sin filas repetidas | #247 (17-nov) | **Hecha** | `VentasMix.claves.render.test.tsx`, `mixPorFamilia.test.ts` |
| 0.2 | Hora CR en Análisis | #274 (17-nov) | **Hecha** | `VentasAnalisis.aLaFecha.render.test.tsx` (reloj de noche: 23:30 CR) |
| 1.1 | Motor de períodos | #256 (17-nov) | **Hecha** | `periodos.ts`, `periodos.test.ts` |
| 1.2 | Indicadores: venta por persona con pax estimado y alerta de mesas sin pax | #258 (17-nov) | **Hecha** | `indicadores.ts` (`ventaPorPersona`, `estimadorPorNeta`, `alertaMesasSinPax`) |
| 1.3 | «A la fecha» en Análisis y Mix; una sola venta por persona | #274 (17-nov) | **Hecha**, con un resto | `aLaFecha.ts`, `VentasAnalisis.aLaFecha.render.test.tsx`, `VentasMix.aLaFecha.render.test.tsx`. Resto: las vistas viejas usan la fórmula única **sin** personas estimadas (`ventaPorPersonaDeTotales`); la estimación solo está en Resumen, Tiempos y el correo de cierre. Se cierra en la 3.5 |
| 2.1 | Barra global + «Resumen» | #290 y #291 (18-nov) | **Hecha**, con un resto | `BarraVentasV2.tsx`, `barraVentasV2.ts`, `VentasResumen.tsx`, `resumenV2.ts`; migración 190 (`pos_ventas_resumen`, en prod). Resto: «Qué explica el cambio» sigue en «Análisis» (§5.1 ítem 6) → 3.5 |
| 2.2 | Meta y proyección del mes | #293 (18-nov) | **Hecha** | `proyeccion.ts`, bloque «Meta de {mes}» de `VentasResumen.tsx` |
| 2.3 | «Tiempos» | #294 (18-nov) y #297 (18-nov, sin «índice») | **Hecha**, con un resto | `VentasTiempos.tsx`, `tiemposV2.ts`; migración 193 (`pos_ventas_tiempos`, `pos_mesas_internas`, en prod). Resto: «Meses y temporadas» (§5.4 ítem 4) → 3.5; fechas especiales → 4.x |
| 2.4 | Alerta de mesas sin pax en el correo diario y en Mi Rendimiento | — | **Parcial** | En pantalla sí: «Ayer: mesas sin pax» por salonero en Resumen (`alertaDeAyer`). El correo de cierre solo dice el % de personas estimadas (`supabase/functions/cierre-email/plantilla.ts`), sin la lista por salonero. Mi Rendimiento no avisa nada |
| 3.1 | `pos_ventas_productos` + catálogo único por código | — | **Falta** (firma). Spec con las decisiones del 24-nov: [SPEC-3.1-catalogo.md](./SPEC-3.1-catalogo.md) | No hay migración ni función. El Mix sigue con `product_map` por nombre + familia del PoS (`fusionarProductMap`) |
| 3.2 | «Productos» | — | **Falta** | Siguen «Mix», «Ing. Menú» y «Productos» (catálogo) como vistas viejas |
| 3.3 | «Equipo» | 3.5.4 (PR en borrador, 23-nov) | **En revisión** | `VentasEquipo.tsx`, `equipoV2.ts`: «Saloneros» y «Evaluación» juntas en «Equipo» con la barra global; «Por línea», «ICP», «Cajas y canales» y «Competencias» como sub-vistas. La migración 194 es de Mi Rendimiento, no de esta pantalla |
| 3.4 | `pos_ventas_regalias` + «Regalías» | — | **Falta** (firma) | No hay pantalla ni función. Lo que hay hoy: el bloque «Regalías, Personal & Desconocidos» de «Hoy» y tres secciones del Mix |
| 3.5 | Unificación en las 5 pestañas | — | **Falta. Es la próxima tarea** (decisión del 23-nov) | `ventasTabs.ts`: 19 vistas en 10 entradas. Alcance y criterios en §12 |
| 4.x | Costos, margen, costo primo, RevPASH, fechas especiales | — | **Falta** | — |

**Lo que también entró y no estaba en el plan del 17-nov:** correo quincenal «Ventas por día» para el contador
(Edge `ventas-dia-contador`, días 1 y 16) · cada persona lee solo sus ventas del PoS (migración 191) · Mi
Rendimiento compara con el equipo en agregados (migración 194) y ya usa `periodos.ts` e `indicadores.ts` ·
«Mesas internas» en Ajustes (migración 193).

**Descuento del PoS (D9):** el agente en vivo lee el descuento de cada línea desde el 17-nov (rama del agente,
`578f38c`) y lo manda **sumado por factura**: en `main` existe `pos_ndf_tickets.descuento_crc`, no un descuento
por línea. El backfill del histórico no tiene constancia en `main` (el PR #252 sigue abierto, en borrador). Lo
que eso cambia para «Regalías» está en §4.4.

## 1. Idea

Ventas llegó a tener 19 vistas ordenadas por **tipo de reporte** (Histórico, Mix, Análisis, Calendario…). Para
usarlo hay que saber en cuál está cada número, y cada vista vieja tiene su propio selector de fechas.

La v2 lo ordena por **las cinco preguntas** que se hace quien mira el negocio, con **un solo selector de
período y de comparación** arriba, que se conserva al pasar de una pregunta a otra:

| Pestaña | Qué contesta |
|---|---|
| **Resumen** | Venta, personas, venta por persona, meta y proyección, contra una base justa |
| **Productos** | Mix por categoría y producto, lo que sube y lo que baja, ingeniería de menú |
| **Equipo** | Saloneros, cajas y canales |
| **Tiempos** | Día de semana, hora, turno, quincena, temporada, calendario |
| **Regalías** | Descuentos, cortesías, consumo del personal y de los dueños, anulaciones |

Aparte quedan **En vivo** (el servicio en curso; no lleva selector) y **Ajustes** (metas, catálogo, mesas internas).

**Reglas de diseño:**

1. **Nunca se compara un período en curso contra uno completo.** Si el período no terminó, la base se recorta
   a los mismos días y el rótulo dice «a la fecha».
2. **Un número, una definición.** Cada indicador tiene una fórmula (§4) y se calcula en un solo lugar.
3. **Cada pantalla abre con su conclusión** en una frase, y después el número protagonista (estándar de reportes §1).
4. **Lo que no se puede medir se dice:** «sin comparación», «dato incompleto», nunca 0 ni −100 %.
5. **No se pierde información:** todo lo que hoy se ve tiene destino en el mapa de §12.2.
6. **Se agrega en la base,** no en el navegador.
7. **Cada cambio es un solo %, y dice contra qué y qué fechas** («▲ +4,2 % vs mes anterior a la misma fecha
   (1–17 oct)»). Nada de índices base 100 ni de medidas que haya que explicar (pedido del dueño, 18-nov).

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
- **Semana Santa y feriados móviles:** ninguna base los alinea. Fase 4: lista de fechas especiales que marca el
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

### 3.6 Cómo quedó construida la barra (18-nov, `barraVentasV2.ts`)

Lo de §3.2 a §3.4 vale como regla; en pantalla se simplificó a pedido del dueño (18-nov):

- **Un solo «Período»:** Hoy · Ayer · Semana · Quincena · Mes · Año a la fecha · Temporada · Rango. «Mes» con el
  mes en curso **es** el mes a la fecha (no hay una opción aparte). «‹» y «›» mueven el período entero.
- **Un solo «Comparar con»:** la base anterior con su nombre concreto («Mes anterior a la misma fecha»), «Año
  pasado, mismo día de semana», «Año pasado, mismas fechas» o **«Los dos»** (por defecto; D3).
- La barra vive en la dirección de la página y **se conserva al cambiar de pestaña**. Debajo, en gris, el
  período en palabras con las fechas de cada base.
- «Resumen» abre en **Ayer**; «Tiempos», si se entra directo, en **Mes**.
- Falta: la lista de fechas especiales (Semana Santa, feriados) → 4.x.

## 4. Indicadores: definición exacta

Fuente: `pos_ndf_tickets` (`t`) y `pos_ndf_ticket_lines` (`l`), solo facturas `estado = 'C'`, día CR de
`fecha_registra`, por local. La lectura va siempre por funciones (regla 6 de `ESTADO.md`), sin medios de pago.

### 4.1 Ventas y personas

| Indicador | Fórmula | Nota |
|---|---|---|
| **Venta neta** | Σ `l.monto` con `l.familia` fuera de {6, 17, 20} | Definición firmada (`netaVenta.ts`). Sin IVA ni servicio |
| Venta bruta | Neta + Σ `t.iva_crc` + Σ `t.servicio_crc` | Para el contador |
| **Personas** | Σ pax de la factura (artículo pax si es mayor que 0; si no, `t.pax`) | Es el PAX de Contabilidad: solo personas cargadas |
| Facturas | Cantidad de facturas cerradas | |
| **Venta por persona** | Neta de salón ÷ personas de salón (`t.canal = 'salon'`). Personas = cargadas + **estimadas** para las mesas sin pax | **La única** (D4, firmada el 17-nov; `indicadores.ts`). La cifra dice «incluye X % estimado». Quedan afuera, enteras, las mesas de dueños y las regalías totales. Día y turno son los de la caja abierta, no los del reloj |
| Cuenta promedio | Neta ÷ facturas | Por canal: en delivery es el indicador principal |
| Venta por día abierto | Neta ÷ días abiertos | Para períodos de distinto largo |
| **Salón / Delivery / Llevar / Barra** | Neta por `t.canal` | Canal de la factura, nunca «lo que cobró la caja» |
| Bebidas por persona | Unidades de familia 5 en salón ÷ personas de salón | |
| Relación comida/bebida | Neta de comida ÷ neta de bebida (familias 2, 3, 4, 13, 16, 29 contra 5) | |
| Participación en el mix | Neta del grupo ÷ neta de comida y bebida | Con la línea «otros» (merch, gift cards, promociones) que cierra contra la neta |

La variante «limpia» (solo mesas con pax) de la versión del 16-nov **no se construye**: el dueño pidió un
solo número en todos lados (17-nov).

### 4.2 Personas que venden

| Indicador | Fórmula | Nota |
|---|---|---|
| Venta del salonero | Neta de las facturas con su `salonero_login` | Lente «mesa». La lente «línea» sigue en «Por línea» |
| Venta por persona del salonero | Su neta de salón ÷ sus personas | Contra el equipo en el mismo período **y turno** |
| ICP | Propina electrónica declarada ÷ neta de sus mesas | Regla 5 de `ESTADO.md`, sin cambios |
| Venta sugerida | % de mesas con entrada, con postre y con segunda bebida | 4.x (necesita el catálogo único) |
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
«año a la fecha contra el año anterior a la misma fecha». Hecha en `proyeccion.ts` (2.2). Mientras convivan,
«Metas» y «Análisis» → «Proyección» siguen con la cuenta lineal: se retiran en la 3.5 (§12.4, excepción 2).

### 4.4 Regalos, descuentos y anulaciones

| Indicador | Fórmula | Disponible hoy (23-nov) |
|---|---|---|
| Cortesías | Σ valor de las líneas de familia 17 + `regalia_crc` | Parcial: falta revisar las regalías que quedan como factura anulada (auditoría del 16-nov, P2-7) |
| Consumo del personal | Líneas de familia 6 | Sí, a precio cargado |
| Consumo de dueños | Familia 28 y clase `duenos` | Sí |
| **Descuento** | `t.descuento_crc`: la suma del descuento de las líneas de la factura, que manda el agente | **Parcial.** Llega por factura desde el 17-nov. El histórico depende del backfill (sin constancia en `main`). **Por línea no se guarda** |
| Descuento por programa | % del descuento sobre la factura (descuento ÷ (neta + descuento)) contra el % de cada programa del local, con la misma tolerancia que usa el reporte de descuentos del Club | No. Se define en la 3.4. Una factura con descuento en solo algunas líneas queda «sin clasificar» hasta que haya descuento por línea (4.x) |
| % regalado | (Cortesías + descuentos) ÷ (neta + cortesías + descuentos) | Con la 3.4 |
| Anulaciones | Facturas `X`: cantidad, por día y por caja | **Dato sí, pantalla no.** Las `X` se guardan (el agente relee las facturas provisionales de las últimas 36 horas), pero toda función que lee Ventas filtra `C` |
| **Refacturas** | Anulada (`X`) cuya mesa o pedido tiene otra factura cerrada en la misma jornada | No. Entra con la 3.4; definición en D13 (§10.3, decidida 23-nov) |

**Límites del dato, a medir con una consulta de solo lectura antes de la 3.4:** desde qué fecha hay facturas
`X` guardadas (el backfill histórico lee solo cerradas) · si la anulada conserva su monto o queda en ₡0 (en el
caso medido el 7-nov quedaba en ₡0: entonces se informa cantidad, no valor) · cuántas facturas tienen
`descuento_crc` desde el 17-nov y si el backfill se corrió.

### 4.5 Fase 4 (necesitan datos que hoy no están)

Margen por plato y **margen de contribución** para toda la carta (costo por producto: hoy se carga a mano en
«Productos» → «₡ Costos» y la cobertura es parcial), **costo primo** (costo de lo vendido + planilla),
**RevPASH** (asientos y horas abiertas), fechas especiales, descuento por línea, mix con modificadores
(§13, pregunta 2) y frecuencia de visita del socio (Club Satori). El tiempo de mesa ya está (2.3), por tamaño
de mesa.

## 5. Pantallas

Barra fija en todas (§3.6): **Local** (aparece con más de un local) · **Período** con flechas · **Comparar
con**. Debajo, en gris, el período en palabras: «1 al 17 de noviembre (17 días) contra el mes anterior a la
misma fecha (1–17 oct) y contra el año pasado, mismo día de semana (2–18 nov 2025). Hoy, en curso, no entra.»

### 5.1 Resumen

1. **Bajada:** una frase armada con los datos. «Vas 9 % arriba del mes anterior a la misma fecha y 7 % abajo
   del año pasado. Entra más gente; gasta casi lo mismo.» **Hecho.**
2. **Cuatro cifras,** cada una con su cambio contra cada base elegida: venta neta · personas · venta por
   persona · cuenta promedio. **Hecho.**
3. **Meta del mes:** avance, ritmo, proyección con rango y necesario por día. **Hecho** (2.2).
4. **Gráfico por día:** barras del período y la línea de la base alineada. **Hecho.**
5. **Quincenas:** *no se repite acá.* Viven en «Tiempos» (§5.4 ítem 3, las últimas 12) y el período
   «Quincena» de la barra da la quincena en curso. Cierre de diseño del 23-nov: una cifra, un lugar.
6. **Qué explica el cambio:** 1 a 3 frases de la descomposición de «Prom/PAX explicado», con el detalle a un
   clic. **Falta → 3.5** (hoy vive en «Análisis»).
7. **Contabilidad:** la tabla por día (bruta, IVA, servicio, neta, salón, delivery, personas) y el CSV.
   **Hecho.** Falta sumar la columna de venta por persona del día y el botón «🖨 Reporte» del mes → 3.5.
8. **Calidad del dato:** aviso solo si algo pasa el umbral (facturas de salón sin pax > 5 %, PoS sin lecturas).
   **Hecho.**
9. **Ayer: mesas sin pax,** por salonero, y cuántas se cargaron enteras desde la caja. **Hecho.**
10. **Salón en detalle** (desplegable): precio promedio por plato y por bebida, bebidas por persona, relación
    comida/bebida, unidades de comida y de bebida y los productos más vendidos del período (estos, hasta que
    exista «Productos» en la 3.2), más el botón 📤 para compartir el resumen. Es lo que hoy muestra «Hoy».
    **Falta → 3.5.**

### 5.2 Productos

1. **Bajada:** la categoría que más movió el mix.
2. **Mix por categoría:** participación, cambio en puntos contra cada base, venta y unidades. Se abre a
   subcategoría y producto. **Cada categoría aparece una sola vez** (catálogo único, §8).
3. **Suben y bajan:** los cinco productos que más ganaron y más perdieron venta contra la base.
4. **Sin ventas en el período:** la lista de hoy, solo de productos activos.
5. **Ingeniería de menú (Kasavana–Smith):** por categoría de comida. Popular si su participación en unidades
   supera 0,70 ÷ cantidad de platos; rentable si su margen en ₡ supera el promedio ponderado. Hasta que haya
   costos de toda la carta (4.x) muestra el eje de popularidad y dice cuántos productos tienen costo.
6. **Canal:** el mismo mix filtrado por salón, delivery o llevar.
7. **Extras e ingredientes:** una fila propia que cierra contra la neta, abierta por código. Sin relación con
   el plato al que acompañan: el PoS no la manda (§13, pregunta 2).

Todo esto llega con la 3.1 y la 3.2. Hasta entonces la pestaña «Productos» muestra «Mix» e «Ing. Menú» tal
como están hoy (§12.3).

### 5.3 Equipo

1. **Equipo:** una fila por salonero: venta, personas, venta por persona contra el equipo de su turno, bebidas
   por persona, relación comida/bebida, precio por ítem, ICP, días trabajados, consistencia, tendencia y racha.
   Muestra chica en gris. Junta «Saloneros» y «Evaluación».
   **Cómo quedó en el 3.5.4 (`equipoV2.ts`):** abre con «Ayer» (el «Ranking del día» de la vieja «Hoy»). Venta,
   personas, Prom/PAX cargado, bebidas por persona, comida/bebida, precio por plato y ticket por ítem salen del
   lector de siempre (`aggSalonero`, lo mismo que «Saloneros»; paridad en `__paridad__/equipo354.paridad.test.tsx`).
   La venta por persona es la D4 (190, la misma lectura que «Resumen») y «contra el equipo de su turno» la compara
   con la del equipo en los mismos turnos de caja, ponderada por sus personas en cada turno. Consistencia,
   tendencia y racha son la cuenta de «Evaluación» sobre los días del período (la tendencia, 7 contra 7, solo con
   14 días trabajados o más). ICP del período por la regla 5 de `ESTADO.md`, del local elegido. Muestra chica:
   menos de 10 personas por día del período, hasta 30 (con «Ayer», 10: si no, todo el ranking del día iría en gris). Arriba, la venta por persona y las personas del equipo contra las bases.
2. **Ficha del salonero:** tendencia de 12 semanas, sus productos, comparación contra las bases.
3. **Por línea:** las dos lentes de hoy, sin cambios.
4. **ICP:** el de hoy, del restaurante y por salonero.
5. **Cajas y canales:** lo de «Cajeros»: cajas de turno, delivery, cuenta promedio, atribución por línea y
   detalle diario.
6. **Competencias:** se mantiene acá, con su alta y su baja adentro, como hoy (D6: sin invertir en ella).

### 5.4 Tiempos

1. **Día de semana:** promedio por día de cada día de la semana y **su % contra el mismo día de semana de la
   base**. Sin índice (retirado el 18-nov, #297). **Hecho.**
2. **Hora y turno:** mapa de calor día × hora (hora CR de la factura; mediodía hasta las 16:59, noche desde
   las 17:00) y venta por turno. Franja por **hora**, no por turno de caja (trampa conocida). **Hecho.**
3. **Quincenas:** tabla de las últimas 12, cada una con venta, venta por día abierto, personas y su cambio.
   **Hecho.**
4. **Meses y temporadas:** el comparativo año contra año, mes por mes y por trimestre, con el mes en curso
   **a la fecha** y rotulado. **Hecho en el 3.5.3** (reemplaza a «Análisis» → «Año vs Año», mismas cuentas). Por
   temporada: el período «Temporada» de la barra (ver §12.4, nota del 3.5.3).
5. **Calendario:** el detalle por fecha, con mejor y peor día. **Hecho.** Fechas especiales → 4.x.
6. **Tiempo sentado, por tamaño de mesa** (1–2, 3–4, 5–6, 7 o más): cantidad de mesas, mediana y promedio, con
   lo que quedó afuera. **Hecho.** Ojo conocido: las cuentas divididas llegan sin pedido y quedan afuera, así
   que las mesas grandes están subrepresentadas.

### 5.5 Regalías

1. **Bajada:** % de lo servido que no se cobró a precio de lista.
2. **Por tipo:** cortesías, personal, dueños, descuentos por programa: valor, % de la venta y cambio.
3. **Por salonero y por día:** dónde se concentran.
4. **Anulaciones y refacturas:** cantidad por día y por caja (§4.4).
5. **Aviso de dato pendiente** mientras falte algo: la pantalla muestra lo que hay y dice qué falta.
6. **Control de la quincena** (pedido del 18-nov): por quincena, el total y la lista de lo que se cerró como
   regalía total, crédito o mesa interna, con lugar para anotar el motivo. La anotación se guarda: tabla nueva,
   va con la firma de la 3.4. Antes de construirlo hay que fijar con el dueño qué dato del PoS es «crédito».

### 5.6 En vivo y Ajustes

- **En vivo:** sin cambios de contenido.
- **Ajustes:** Metas (por local), Productos (catálogo y costos) y Mesas internas.

## 6. Qué ve cada rol

No cambia ningún permiso: es el mismo reparto de `ventasTabs.ts`, pasado a las pantallas nuevas. **Una excepción,
decidida por el dueño el 23-nov (D18; a las 21:40 CR solo el ranking, corregida a las 22:35 CR):** el contador ve
**todo** «Equipo» → «Equipo» igual que gerencia —el ranking, las columnas de evaluación, el ICP por salonero y la
ficha de 12 semanas—, porque funciona casi como gerente general y analiza los datos para decidir
(`veDetalleEquipo` en `ventasTabs.ts` incluye al contador). **D18 ampliada (dueño, 23-nov ~23:50 CR):** también ve
«Equipo» → «Por línea» completa y «Equipo» → «Competencias» **solo para mirar**: no aparecen «+ Nueva» ni «×», y
`saveComp` / `deleteComp` rechazan su rol antes de tocar la base aunque una pantalla lo intentara
(`puedeEditarCompetencias`, `src/shared/permisosCompetencias.ts`: owner y manager). Fuera de la entrada «Equipo» no ve
nada que antes no viera. Es permiso de pantalla y de la capa de la API: sin RLS ni migración (las propinas, empleados y
líneas del PoS que lee son los mismos que ya lee en «ICP» y en «Equipo»; la política `ventas_comps_write` de la 011
todavía deja escribir al contador: cerrarlo en la base es una migración aparte, con firma).

| Pantalla | owner | manager | contador |
|---|---|---|---|
| Resumen | Sí | Sí | Sí (con «Detalle por día» desplegado) |
| Productos — mix | Sí | Sí | Sí |
| Productos — ingeniería de menú | Sí | Sí | No |
| Equipo — equipo: el ranking (venta, personas, venta por persona, vs su turno, bebidas, comida/bebida, precios) | Sí | Sí | **Sí** (D18, dueño 23-nov) |
| Equipo — equipo: evaluación (ICP por fila, % meta, días, consistencia, tendencia, racha) y ficha del salonero | Sí | Sí | **Sí** (D18, dueño 23-nov 22:35 CR) |
| Equipo — por línea | Sí | Sí | **Sí, completa** (D18 ampliada, dueño 23-nov ~23:50 CR) |
| Equipo — competencias | Sí (crea y da de baja) | Sí (crea y da de baja) | **Solo mira** (D18 ampliada: sin «+ Nueva» ni «×»; la API rechaza su escritura) |
| Equipo — ICP, cajas y canales | Sí | Sí | Sí |
| Tiempos | Sí | Sí | Sí |
| Regalías | Sí | Sí | **Sí, completa** (D7, 17-nov) |
| En vivo | Sí | Sí | Sí |
| Ajustes — metas | Sí | Sí | Sí |
| Ajustes — productos | Sí | Sí | No |
| Ajustes — mesas internas | Sí (edita) | Sí (solo ve) | No |

El manager solo ve su local; el owner ve todos. Salonero y cajero siguen sin entrar a Ventas: lo suyo es «Mi
Rendimiento».

**Ritmo sugerido:** cada mañana, «Resumen» con **Ayer** · lunes, **Semana** · días 1 y 16, **Quincena** ·
primer día del mes, **Mes** · con cada cambio de carta, «Productos».

## 7. Mapa viejo → nuevo

El mapa exacto, vista por vista y cifra por cifra, está en **§12.2** (reemplaza la tabla del 16-nov).

## 8. Datos y arquitectura

- **Agregados en la base.** Funciones de solo lectura, con rol validado adentro (`role` + `is_active`) y
  local como parámetro, sin medios de pago:
  1. `pos_prompax_agregado` (migración 080): día × franja × salonero × canal. La usa «Prom/PAX explicado».
  2. `pos_ventas_resumen` (migración 190, en prod): por día, por factura de salón y por lote de caja. La usan
     «Resumen» y «Tiempos».
  3. `pos_ventas_tiempos` y `pos_ventas_internas` (migración 193, en prod): horas, tiempo sentado y facturas
     de mesas internas.
  4. **Falta** `pos_ventas_productos` (3.1): período × canal → código, nombre, familia, unidades, neta.
  5. **Falta** `pos_ventas_regalias` (3.4): día × tipo × salonero → cantidad y valor; incluye las `X`.
- **Catálogo único.** La categoría se resuelve por **código de producto**, no por nombre: una tabla de
  categorías (familia del PoS → categoría y subcategoría de la carta, con excepciones por código). Reemplaza la
  fusión por nombre y termina con los dos vocabularios. Lleva migración y firma (D8, firmada; 3.1).
- **Módulos puros con pruebas:** `periodos.ts`, `indicadores.ts`, `proyeccion.ts`, `resumenV2.ts`,
  `tiemposV2.ts` (hechos); `menuEng.ts` (con la 3.2).
- **Multi-local desde el día uno:** local en la barra, en cada función, en metas y en el catálogo. Nosara
  aparece sola cuando tenga PoS. **Deuda conocida, a saldar antes de Nosara** (migración con firma): las
  funciones 067, 080 y 190 no limitan al manager a su local (la 193 sí, con `puede_ver_local`), y la lista de
  mesas internas la lee un manager de cualquier local (ítem del backlog en `PROMPT-CONTINUACION.md`).
- **Rendimiento (aceptación):** ninguna pantalla nueva trae líneas crudas; «Resumen» con un año de datos abre
  con 3 pedidos o menos.
- **Sagrados:** no se toca ninguno. `netaVenta.ts` no es sagrado, pero su definición está firmada: no cambia.

## 9. Plan por fases (PRs chicos), al 23-nov

| Fase | PR | Qué | Toca | ¿Firma? | Estado |
|---|---|---|---|---|---|
| 0 | 0.1 | Arreglo del Mix | — | — | Hecha (#247) |
| 0 | 0.2 | Fechas en hora CR en Análisis | — | — | Hecha (#274) |
| 1 | 1.1 | `periodos.ts` | — | — | Hecha (#256) |
| 1 | 1.2 | `indicadores.ts` | — | — | Hecha (#258) |
| 1 | 1.3 | «A la fecha» en Análisis y Mix | — | — | Hecha (#274) |
| 2 | 2.1 | Barra global + «Resumen» | — | — | Hecha (#290, #291) |
| 2 | 2.2 | Meta y proyección | — | — | Hecha (#293) |
| 2 | 2.3 | «Tiempos» | — | — | Hecha (#294, #297) |
| 2 | 2.4 | Lo que falta de la alerta de mesas sin pax: la lista por salonero en el correo de cierre y el aviso propio en Mi Rendimiento (cada uno ve solo lo suyo) | Edge `cierre-email` (se despliega al mergear: regla 2 de `ESTADO.md`) + pantalla del personal | OK + validación física | **Parcial.** No bloquea la 3.5 |
| 3 | **3.5** | **Unificación en las 5 pestañas** (§12), en cinco PRs: 3.5.1 menú y redirecciones · 3.5.2 Resumen completo · 3.5.3 Tiempos completo · 3.5.4 Equipo (la 3.3 de antes) · 3.5.5 limpieza | Navegación, pantallas, guía 6.4. Sin esquema | OK + validación física en cada PR | **Próxima** |
| 3 | 3.1 | `pos_ventas_productos` + catálogo único | **Migración** | **Firma** | Falta |
| 3 | 3.2 | «Productos» definitiva (§5.2) | Pantalla | OK + validación física | Falta; espera la 3.1 |
| 3 | 3.4 | `pos_ventas_regalias` + «Regalías» definitiva (§5.5): descuentos, anulaciones y refacturas, control de la quincena | **Migración** + pantalla | **Firma** | Falta |
| 3 | 3.6 | Retiro final: «Mix», «Ing. Menú» y el catálogo por nombre; el shell deja de bajar los 90 días | Navegación + limpieza | OK + validación física | Falta; espera 3.2 y 3.4 |
| 4 | 4.x | Costos de toda la carta y margen (con Inventario y recetas) · costo primo (con horarios y salarios) · RevPASH · fechas especiales · descuento por línea · mix con modificadores · venta por área · locales lado a lado (con Nosara) | Puente, esquema | **Firma** cada uno | Falta |

**Orden:** 3.5 → 3.1 → 3.2 → 3.4 → 3.6. La 2.4 va en paralelo cuando haya un hueco. La 3.3 del plan del 17-nov
deja de existir como fase aparte: es el PR 3.5.4.

Cada PR de pantalla dice en concreto qué va a ver el encargado y actualiza la guía SOP en el mismo PR.

## 10. Decisiones

### 10.1 Cerradas el 17 y 18 de noviembre (no se reabren)

| # | Decisión | Qué se decidió |
|---|---|---|
| D1 | Estructura | Cinco pestañas: Resumen · Productos · Equipo · Tiempos · Regalías, más En vivo y Ajustes |
| D2 | Hasta qué día llega «a la fecha» | Hasta ayer; hoy va aparte |
| D3 | Bases por defecto | Período anterior equivalente + año anterior alineado por día de semana. «Mismas fechas» a un clic y en el CSV del contador |
| D4 | Venta por persona | Una sola: neta de salón ÷ personas de salón, con las mesas sin pax estimadas y rotulado «incluye X % estimado». Firmada |
| D5 | Mix → Comparar | Dos bases + gráfico de 12 meses por categoría (reemplaza la tabla de hasta 6 períodos). Llega con la 3.2 |
| D6 | Competencias | Se mantiene, reubicada en «Equipo», sin invertir en ella |
| D7 | Contador y «Regalías» | La ve completa (el 16-nov la recomendación era «solo totales»; el dueño eligió todo) |
| D8 | Catálogo único por código | Sí. Firmada; se aplica con la 3.1 |
| D9 | Descuento del PoS | Sí, ya. Firmada; el agente lo lee desde el 17-nov (§0) |
| D10 | Semana | Lunes a domingo |
| — | Mesas sin pax | Alerta diaria por salonero en Resumen, en el correo diario y en Mi Rendimiento (2.4) |
| — | Día y turno de una factura | Los de la caja abierta en ese momento, no los del reloj |
| — | Mesas internas | Son venta en todo; solo salen del tiempo sentado y de la alerta de mesas sin pax. Lista en Ajustes |
| — | «Tiempos» | Sin índice: un % simple contra la base. Barra con un solo «Período» y un solo «Comparar con» |
| — | Control de la quincena | Va en la 3.4 (§5.5 ítem 6) |
| — | Refacturas | Se suma el indicador (§4.4); la definición exacta, en D13 |
| — | Fuente | Todo Ventas lee del PoS; sin Excel ni Paridad |

D1 a D4 y D10 constan en el código y en la guía 6.4. De D5 a D8 la constancia es el registro de decisiones del
coordinador (fuera del repo); esta tabla pasa a ser la referencia en el repo.

### 10.2 Cerradas el 23 de noviembre

| Decisión | Qué se decidió |
|---|---|
| Ver los dos locales lado a lado | **Más adelante, con Nosara** (se suma con el PoS propio). Todo se sigue construyendo multi-local |
| % de mano de obra y venta por hora trabajada | **Fuera de Ventas v2:** va con el módulo de horarios |
| Qué sigue en Ventas | **La 3.5** (unificar las vistas viejas en las 5 pestañas) es la próxima tarea de construcción |

### 10.3 Decididas por el dueño el 23-nov

| # | Decisión | Qué implica |
|---|---|---|
| **D11** | **A** — «Regalías» aparece desde la 3.5 con lo que hoy existe (cortesías, consumo del personal, dueños y «desconocidos» del período) y un aviso de lo que falta (descuentos por programa, anulaciones y refacturas, por salonero) | Entra en el 3.5.2; OK + validación física. Sin esquema |
| **D12** | **A** — el botón «→ Caja» de «Hoy» se retira con la vista | Se borra quien lo llama; ningún sagrado se toca. Va en el 3.5.2 |
| **D13** | **A** — dos cifras: **anulaciones** (toda factura anulada) y, adentro, **refacturas** (anulada cuya mesa o pedido tiene otra factura cerrada en la misma jornada) | La función que las lee entra con la 3.4 (firma) |
| **D14** | **A** — descuento sobre sus mesas (%) en «Equipo» con la 3.4; tiempo sentado por salonero en 4.x | Sin cambios en la 3.5 |
| **D15** | Se **retira «Histórico»** (sin uso real según el dueño). Los datos viejos quedan en la base; las comparaciones contra el año anterior salen del PoS | Va en el 3.5.2, con «Hoy» y «Ventas» |
| **D16** | **Santa Teresa primero** en todo selector o lista de locales (y por defecto). Hoy Nosara aparece primero estando inactivo. Regla general: locales activos primero, Santa Teresa por defecto; sigue todo multi-local | Arreglo aparte, ya (no espera la 3.5) |
| **D17** | **«Ajustes → Productos» (catálogo manual) desaparece.** El catálogo sale del PoS (código, nombre, familia y categoría), sin clasificar a mano, siempre **ordenado por familia y categoría**. Lo único editable: **cuántas personas rinde** un producto (combo, botella para compartir) para la venta por persona; el costo, cuando llegue Inventario | Entra en la 3.1 (catálogo único por código, D8, firma). Hasta la 3.1 la vista queda como está |
| **D18** | (23-nov 21:40 CR, **corregida a las 22:35 CR**, cambia §6) — el **contador ve TODO «Equipo» igual que gerencia**: ranking, columnas de evaluación, ICP por salonero y ficha de 12 semanas (funciona casi como gerente general y analiza los datos para decidir). A las 21:40 se había anotado solo el ranking | En el 3.5.4: `veDetalleEquipo` incluye al contador. Sus enlaces viejos `?tab=saloneros` y `?tab=evaluacion` abren ahí. **Ampliada el 23-nov ~23:50 CR:** también «Por línea» completa y «Competencias» solo para mirar (sin «+ Nueva» ni «×»; `saveComp`/`deleteComp` rechazan su rol: `puedeEditarCompetencias`). Fuera de la entrada «Equipo» no ve nada nuevo. Sin RLS ni migración (la base todavía le permite escribir `ventas_comps`: migración aparte, con firma) |

## 11. Fuera de alcance

- **Ver los dos locales lado a lado:** más adelante, con Nosara (§10.2).
- **% de mano de obra y venta por hora trabajada:** con el módulo de horarios (§10.2). Las horas existen fuera
  de Ventas (las del reparto de propinas, que ya muestra «ICP»); cruzarlas es de ese módulo.
- **Tiempos de cocina:** no hay fuente. El PoS manda la apertura del pedido y la hora de cobro; las líneas no
  traen hora y no hay pantalla de cocina que registre cuándo sale un plato. Lo que sí se mide es el tiempo
  sentado (§5.4 ítem 6), que no es lo mismo.
- **Ventas por zona o plano del salón:** no hay plano ni catálogo de zonas. Lo único que llega es el código de
  área crudo de la factura y la mesa. Una «venta por área» con ese código es posible y barata: queda en 4.x.
- **Mix con modificadores y tamaños (tipo PMIX):** el PoS no manda la relación entre el extra y su plato (§13).
- **Clientes recurrentes por tarjeta y comparación contra otros restaurantes:** no (privacidad; no hay dato).
- Mi Rendimiento, «Resumen» del día (`/resumen`), «Semana» y el reporte mensual: son otras pantallas. Mi
  Rendimiento ya usa `periodos.ts` e `indicadores.ts`; las otras tres conviene que los adopten después de la 3.5.
- Caja, propinas y archivos sagrados.

## 12. Fase 3.5 — Unificación: alcance y criterios de aceptación

### 12.1 Qué es

Dejar el menú de Ventas en **siete entradas** y que cada cifra de las vistas viejas tenga un solo lugar. No
lleva migración ni Edge, y no cambia ningún permiso. Lo que depende de la 3.1 y la 3.4 (firma) queda esperando
dentro de su pestaña nueva (§12.3).

Menú final, en este orden:

| Entrada | Sub-vistas al terminar la 3.5 |
|---|---|
| **Resumen** | — |
| **Productos** | «Mix» · «Ing. Menú» (las de hoy, hasta la 3.2) |
| **Equipo** | «Equipo» · «Por línea» · «ICP» · «Cajas y canales» · «Competencias» |
| **Tiempos** | — |
| **Regalías** | — (desde el 3.5.2, D11 = A) |
| **En vivo** | — |
| **Ajustes** | «Metas» · «Productos» · «Mesas internas» |

`/ventas` sin más abre «Resumen» con el período «Ayer», para los tres roles.

### 12.2 Mapa exacto: cada vista vieja y cada cifra

| Vista de hoy (`?tab=`) | Qué muestra | Destino | PR | Dirección nueva del enlace viejo |
|---|---|---|---|---|
| Hoy (`hoy`) | Venta total, salón y delivery del día | «Resumen», período «Ayer» (con ‹ › se va día por día) | 3.5.2 | `?tab=resumen&p=ayer` |
| | Ventas de salón, PAX, Prom/PAX | «Resumen», cuatro cifras | 3.5.2 | |
| | Prom/Plato, Prom/Bebida, Bebidas/PAX, Ratio C/B, Comidas, Bebidas | «Resumen» → «Salón en detalle» | 3.5.2 | |
| | Ranking de saloneros del día | «Equipo», período «Ayer» | 3.5.4 | |
| | Top Productos | «Resumen» → «Salón en detalle» (los más vendidos del período). Con la 3.2 pasa a «Productos» | 3.5.2 | |
| | Regalías, Personal & Desconocidos | «Regalías» (D11) | 3.5.2 | |
| | Barra de la meta | «Resumen» → «Meta de {mes}» | 3.5.2 | |
| | «Contexto {día}» (promedio de las 4 últimas) | Lo reemplaza la base «mismo día de la semana pasada» y «Tiempos» → «Día de semana» | 3.5.2 | |
| | 📤 compartir | «Resumen» → «Salón en detalle» | 3.5.2 | |
| | «→ Caja» | D12 | 3.5.2 | |
| En vivo (`envivo`) | Todo | Igual | — | igual |
| Ventas (`ventas`) | Bruta, IVA, servicio, neta, salón, delivery, PAX, Prom/PAX; detalle por día; CSV; «🖨 Reporte» | «Resumen» → «Detalle por día» (se suma Prom/PAX por día y el botón del reporte) | 3.5.2 | `?tab=resumen&p=mesALaFecha` |
| | Promedio por día de semana | «Tiempos» → «Día de semana» | 3.5.3 | |
| Histórico (`historico`) | Rango libre | Barra → «Rango» | 3.5.2 | `?tab=resumen&p=rango` (últimos 30 días hasta ayer) |
| | Venta neta, salón, PAX, Prom/PAX, Beb/PAX, Ratio C/B | «Resumen» (cifras y «Salón en detalle») | 3.5.2 | |
| | Prom/PAX — evolución (general y por salonero) | «Equipo» → ficha del salonero y fila del equipo | 3.5.4 | |
| | Top productos del período | «Resumen» → «Salón en detalle». Con la 3.2 pasa a «Productos» | 3.5.2 | |
| Análisis (`analisis`) → Año vs Año | Comparativo mensual, total a la fecha y año completo, trimestres | «Tiempos» → «Meses y temporadas» | 3.5.3 | `?tab=tiempos&p=anioALaFecha` |
| Análisis → Detalle anual | Neta, bruta, IVA, servicio, PAX, Prom/PAX por mes y por quincena | «Resumen» con período «Año a la fecha» o «Mes» + «Tiempos» → «Quincenas» | 3.5.2 | |
| | Margen % y margen ₡ (con el % de margen bruto que carga el contador) | «Resumen» con período «Mes»: al pie de «Detalle por día», junto al total | 3.5.2 | |
| Análisis → Proyección | Real, proyectado, meta, vendido hasta ayer | «Resumen» → «Meta de {mes}». Se retira la proyección anual lineal (§4.3) | 3.5.2 | |
| Análisis → Prom/PAX explicado | Por turno, día de semana, salonero y semana; rendimiento y mezcla; CSV | «Resumen» → «Qué explica el cambio», completo a un clic | 3.5.2 | |
| Calendario (`calendario`) | Promedios por día de semana | «Tiempos» → «Día de semana» | 3.5.3 | `?tab=tiempos&p=mesALaFecha` (3.5.3: abría con el mes en curso desplegado; `mes` sin día es el último cerrado) |
| | Detalle por fecha (ventas, PAX, Prom/PAX) | «Tiempos» → «Calendario» y «Resumen» → «Detalle por día» | 3.5.3 | |
| Saloneros (`saloneros`) | Ranking en tarjetas o tabla: ventas, PAX, Prom/PAX, Beb/PAX, Ratio C/B, Prom/plato, Prom/bebida, Ticket/ítem; fila GENERAL | «Equipo» → «Equipo» | 3.5.4 | `?tab=equipo&p=ayer` (abría el último día) |
| Evaluación (`evaluacion`) | Días, % meta, consistencia, tendencia, racha; tendencia de 12 semanas | «Equipo» → «Equipo» (columnas) y ficha del salonero | 3.5.4 | `?tab=equipo&p=rango&desde=&hasta=` (abría los últimos 30 días: los 30 que terminan ayer) |
| Por línea (`salolineas`) | Lente A (venta propia) y Lente B (mesa propia) | «Equipo» → «Por línea», igual | 3.5.4 | `?tab=equipo&v=lineas` |
| ICP (`icp`) | ICP del restaurante y por salonero, tendencia, turnos, horas, cobrado del reparto | «Equipo» → «ICP», igual | 3.5.4 | `?tab=equipo&v=icp` |
| Cajeros (`cajeros`) | Total por caja, delivery, otros canales, cuenta promedio, atribución por línea, detalle diario | «Equipo» → «Cajas y canales» | 3.5.4 | `?tab=equipo&v=cajas` |
| | Promedio por día de semana | «Tiempos» → «Día de semana» | 3.5.3 | |
| Competencias (`competencias`) | Lista, alta y baja | «Equipo» → «Competencias», igual | 3.5.4 | `?tab=equipo&v=competencias` |
| Mix (`mix`) | Ver período y comparar | «Productos» → «Mix», igual hasta la 3.2 | 3.5.1 | `?tab=productos` |
| Ing. Menú (`menueng`) | Cuadrantes, cobertura de costos, food cost | «Productos» → «Ing. Menú», igual hasta la 3.2 | 3.5.1 | `?tab=productos&v=menu` |
| Metas (`metas`) | Cargar meta mensual, % de margen bruto, metas de performance e individuales | «Ajustes» → «Metas» | 3.5.1 | `?tab=ajustes` |
| | Seguimiento: proyección, falta para la meta, esfuerzo diario, meta por día | «Resumen» → «Meta de {mes}» | 3.5.2 | |
| Productos (`config`) | Clasificación, multiplicador y costos | «Ajustes» → «Productos» | 3.5.1 | `?tab=ajustes&v=productos` |
| Mesas internas (`internas`) | Lista por local | «Ajustes» → «Mesas internas» | 3.5.1 | `?tab=ajustes&v=internas` |
| Resumen, Tiempos | — | Iguales | — | iguales |
| `paridad`, `xls` (retiradas el 16-nov) | — | Abren «Resumen» | 3.5.1 | `/ventas` |

Los nombres de `tab` y `v` de la columna de la derecha son los de referencia; si el PR necesita otro, cambia
la tabla en el mismo PR. Una redirección reemplaza la dirección (no suma un paso al botón «Atrás») y respeta
el rol: si el rol no ve el destino, abre «Resumen». Entre la 3.5.1 y el PR que retira una vista, el enlace
viejo abre esa vista como sub-vista de su pestaña nueva; al retirarla pasa a la dirección de la tabla.

**Direcciones mientras conviven (3.5.1, `ventasTabs.ts` → `CLAVE_V`):** `?tab=<entrada>&v=<sub-vista>`, sin `v`
para la primera sub-vista de la entrada. Las vistas que todavía no se retiran usan: `?tab=resumen&v=hoy` ·
`&v=ventas` · `&v=historico` · `&v=analisis` · `?tab=equipo` (Saloneros) · `?tab=equipo&v=evaluacion` ·
`?tab=tiempos&v=calendario`. Las de la tabla para «Mix», «Ing. Menú», «Por línea», «ICP», «Cajeros»,
«Competencias», «Metas», «Productos» y «Mesas internas» ya son las definitivas.

**Desde el 3.5.2:** «Hoy», «Ventas» e «Histórico» se retiraron: sus `?tab=` viejos y las direcciones del 3.5.1
(`?tab=resumen&v=hoy|ventas|historico`) abren «Resumen» con el período con que abría la vista vieja:
`?tab=resumen&p=ayer` · `&p=mesALaFecha` (el mes en curso; `mes` sin día es el último cerrado) · `&p=rango&desde=&hasta=`
con los 30 días que terminan ayer (revisión del verificador del #336).
«Análisis», ya solo con «Año vs Año», pasa a ser sub-vista de «Tiempos» (`?tab=tiempos&v=analisis`; también abre ahí
`?tab=resumen&v=analisis`) para que «Resumen» quede sin sub-pestañas, como dice §12.4; en la 3.5.3 pasa a
`?tab=tiempos&p=anioALaFecha`. «Regalías» es `?tab=regalias`.

**Desde el 3.5.3:** «Análisis» y «Calendario» se retiraron y «Tiempos» quedó sin sub-pestañas. `?tab=analisis`,
`?tab=resumen&v=analisis` y `?tab=tiempos&v=analisis` abren `?tab=tiempos&p=anioALaFecha`; `?tab=calendario` y
`?tab=tiempos&v=calendario` abren `?tab=tiempos&p=mesALaFecha` (el período con que abre «Tiempos»: el mes en curso,
como abría «Calendario»). Una retirada solo se reconoce en la entrada donde vivió (`RETIRADAS[x].desde`).
**Nota del 3.5.3 (dónde la SPEC no encajó):** §5.4 ítem 4 se llama «Meses y temporadas», pero su descripción y
§12.4 piden solo año contra año por mes y por trimestre; por temporada no hay tabla, solo una línea que lleva al
período «Temporada» de la barra.

**DECISIÓN DEL DUEÑO, 23-nov-2026 21:19 CR (3.5.3):**
- (a) El detalle día por día de 2023 (que mostraba «Calendario» desde `ventas_hist`) **queda sin destino**: se deja
  ir, como «Histórico» en el 3.5.2. La barra arranca en el PoS (5-ene-2024); los totales de 2023 por mes, por
  trimestre y por año siguen en «Meses y temporadas». Es una excepción firmada a la regla de diseño 5 de §1 («no se pierde
  información»).
- (b) 2023 se muestra **solo para Santa Teresa**, porque `ventas_hist` no tiene columna de local (es el resumen
  diario viejo, de antes del PoS, cuando Santa Teresa era el único local). Con otro local elegido, 2023 no aparece.
  Es correcto así.

**Desde el 3.5.4:** «Saloneros» y «Evaluación» se retiraron; las dos están en «Equipo» → «Equipo» (`?tab=equipo`,
vista `equipo`). Sus `?tab=` viejos y sus direcciones de sub-vista (`?tab=equipo&v=saloneros|evaluacion`) abren «Equipo»
con el período con que abría la vista vieja: `&p=ayer` y `&p=rango` con los 30 días que terminan ayer. «Cajeros»
se llama «Cajas y canales» (misma vista, `v=cajas`). El contador ve «Equipo» completo, con evaluación, ICP y ficha (D18), «Por línea» completa y «Competencias» solo para
mirar (D18 ampliada, 23-nov ~23:50 CR).

### 12.3 Qué entra sin la 3.1 ni la 3.4, y qué queda esperando

**Entra ahora (sin esquema):** el menú y las redirecciones · todo «Resumen» · todo «Tiempos» · todo «Equipo» ·
«Ajustes» · «Regalías» con lo que hoy existe (D11 = A). Las cifras que necesitan líneas (bebidas por
persona, relación comida/bebida, precio por ítem, top de productos) siguen saliendo del lector de hoy, sin
cambiar la cuenta.

**Queda esperando:**

| Qué | Espera | Mientras tanto |
|---|---|---|
| «Productos» con la barra global, catálogo por código, «Suben y bajan», gráfico de 12 meses (D5), fila de extras | 3.1 (firma) → 3.2 | «Mix» e «Ing. Menú» de hoy como sub-vistas, con su selector propio y una línea que lo dice: «Esta vista todavía usa su propio selector de fechas» |
| «Regalías» con descuentos por programa, anulaciones y refacturas, por salonero y control de la quincena | 3.4 (firma) | Lo de D11 |
| Que el shell deje de bajar los 90 días y la historia completa | 3.2 y 3.4 → 3.6 | Se bajan solo al abrir «Mix», «Ing. Menú», «Ajustes → Productos» o lo que todavía los use |
| Descuento por salonero en «Equipo» (D14) | 3.4 | — |

### 12.4 PRs y orden

| PR | Qué hace | Qué ve el encargado |
|---|---|---|
| **3.5.1 Menú y redirecciones** | Seis entradas: Resumen · Productos · Equipo · Tiempos · En vivo · Ajustes («Regalías» se suma en el 3.5.2, D11 = A). Las vistas viejas pasan, **sin tocarlas**, a ser sub-vistas de su pestaña nueva: «Resumen» lleva al lado «Hoy», «Ventas», «Histórico» y «Análisis»; «Tiempos» lleva «Calendario»; «Equipo» lleva «Saloneros», «Por línea», «Evaluación», «ICP», «Cajeros» y «Competencias»; «Productos» lleva «Mix» e «Ing. Menú»; «Ajustes» lleva «Metas», «Productos» y «Mesas internas». Redirecciones. Arranque en «Resumen» | Entra a Ventas y ve 6 botones en lugar de 10. Abre en «Resumen» con lo de ayer, no en «Hoy». Todo lo de antes sigue, con el mismo nombre, adentro de la pestaña que le corresponde. Sus enlaces guardados siguen abriendo |
| **3.5.2 Resumen completo** | §5.1 ítems 6, 7 y 10, y la pestaña «Regalías» con el bloque de «Hoy» llevado al período (D11 = A). Se retiran «Hoy», «Ventas», «Histórico» y, de «Análisis», «Detalle anual», «Proyección» y «Prom/PAX explicado» | «Resumen» ya no tiene botones al lado y aparece «Regalías» en el menú. Para ver un día, elige «Ayer» y usa las flechas. «Qué explica el cambio» y el detalle del salón están en la misma pantalla. La proyección es una sola |
| **3.5.3 Tiempos completo** | §5.4 ítem 4. Se retiran «Análisis» → «Año vs Año» y «Calendario» | «Tiempos» suma «Meses y temporadas»: el año contra el anterior, mes por mes, con el mes en curso a la fecha. «Análisis» y «Calendario» ya no están |
| **3.5.4 Equipo** | §5.3: «Saloneros» y «Evaluación» se juntan en «Equipo», con la barra global; «Por línea», «ICP», «Cajas y canales» y «Competencias» quedan como sub-vistas | Una tabla del equipo con todas las columnas, con el mismo período y la misma comparación que «Resumen». Toca un salonero y ve su ficha |
| **3.5.5 Limpieza** | Borra los componentes retirados y sus pruebas; el shell baja los 90 días solo donde hace falta; guía 6.4 e inventario finales | Nada nuevo. Ventas abre más rápido |

**Orden:** 3.5.1 primero (resuelve el menú, que es lo que más confunde, sin mover un número). Después 3.5.2,
3.5.3 y 3.5.4: hasta dos en paralelo. El 3.5.2 y el 3.5.3 tocan los dos «Análisis»: el segundo en mergear
trae `main` antes. 3.5.5 al final. Cada uno con su validación física.

**Agentes:** Opus para los cinco (los ve el personal); verificador independiente en 3.5.2 y 3.5.4 (pantallas
nuevas con cifras); Sonnet para la guía si va en commit aparte.

### 12.5 Criterios de aceptación (verificables)

Valen para el estado final de la 3.5; cada PR cumple los que le tocan y lo dice en su descripción.

1. **Menú.** `entradasVisibles('owner')` devuelve exactamente Resumen · Productos · Equipo · Tiempos · Regalías
   · En vivo · Ajustes, en ese orden (Regalías desde el 3.5.2, D11 = A). El menú lateral de la app muestra las mismas.
   Prueba en `ventasTabs.test.ts` y `VentasModule.nav.render.test.tsx`.
2. **Arranque.** `/ventas` sin `tab` abre «Resumen» con «Ayer» para owner, manager y contador; al contador, con
   «Detalle por día» desplegado.
3. **Redirecciones.** Cada `?tab=` viejo de §12.2 abre su destino, reemplazando la dirección. Prueba
   parametrizada: cada `tab` viejo × cada rol. Un `tab` que el rol no veía antes sigue sin verse.
4. **No se pierde información.** Cada fila de §12.2 se tilda en el PR que retira la vista, con una captura de
   staging de dónde quedó la cifra. Una fila sin destino visible bloquea el PR.
5. **Cada % nombra su base y sus fechas.** Prueba de render: todo cambio en pantalla lleva al lado el nombre de
   la base y su rango («vs mes anterior a la misma fecha (1–17 oct)»). Ningún «vs anterior» a secas.
6. **Sin índice.** Ninguna pantalla de Ventas muestra una medida base 100 ni la palabra «índice», salvo el
   nombre propio del ICP («Índice de Conversión de Propina»). Prueba sobre el texto pintado.
7. **Paridad.** Antes de retirar una vista, el PR muestra, con datos ficticios en la prueba y con una tabla de
   staging, que la pantalla nueva da **lo mismo al colón** que la vieja en tres períodos (ayer, mes a la fecha,
   último mes cerrado) para: venta neta, bruta, IVA, servicio, salón, delivery, personas y facturas; y por
   salonero: venta y personas. La prueba vive en `src/modules/ventas/__paridad__/`.
   **Excepciones firmadas (el número cambia a propósito y el PR lo dice):**
   1. Venta por persona: la vista vieja no estima las mesas sin pax; la nueva sí (D4). Se muestran las dos
      cifras y el % estimado.
   2. Meta y proyección: la nueva pondera por día de semana; la lineal y la anual se retiran (§4.3).
   3. «Contexto {día}» de «Hoy»: lo reemplaza la comparación contra el mismo día de la semana pasada.
8. **Permisos iguales que hoy.** La tabla de §6, probada por (rol × sub-vista) en `ventasTabs.test.ts` y
   recorrida en staging con un usuario real de cada rol (regla 4). El contador ve «Regalías» completa (D7) y
   ve «Equipo» → «Equipo» completo, con evaluación, ICP por fila y ficha (D18, 22:35), «Por línea» completa y
   «Competencias» solo para mirar (D18 ampliada, ~23:50); no ve «Ing. Menú», ni «Ajustes → Productos» ni
   «Mesas internas» (de «Ajustes» ve solo «Metas»). El manager ve solo su local y no cambia las mesas internas. Sin migración ni cambio de RLS.
9. **Multi-local.** Toda pantalla con barra lleva el selector de local; ningún archivo nuevo fija el local
   salvo como valor por defecto.
10. **La barra se conserva** al pasar entre Resumen, Equipo y Tiempos (período, día y bases), y queda en la
    dirección de la página.
11. **Fechas.** «Hoy» es `todayCR()`; las pruebas fijan el reloj a las 23:30 CR.
12. **Rendimiento.** Abrir Resumen, Tiempos o Equipo no dispara la carga de los 90 días
    (`VentasModule.carga.render.test.tsx`).
13. **Guía SOP 6.4** actualizada en el mismo PR, con `verificado_en_commit`, y el inventario de guías al día.
14. **Qué ve el encargado,** en concreto, en la descripción de cada PR (el texto de §12.4 es la base).
15. **Pruebas que muerden.** En cada PR, al menos: quitar una redirección → cae; cambiar el rol de una
    sub-vista → cae; sumar una factura anulada a la paridad → cae; comparar el mes en curso contra el mes
    anterior completo → cae (ya existe).
16. **Sagrados** con el mismo hash; nada bajo `supabase/`; gate en verde.
17. **Recorrido en staging** por rol con capturas (`satori-verificar`) antes de pedir la validación física.

## 13. Respuestas a la ENTREGA G-010 (23-nov), contrastadas contra el repo

| Pregunta del Auditor | Respuesta | Evidencia |
|---|---|---|
| 1. ¿Las horas fichadas se pueden cruzar con ventas? | Las horas existen fuera de Ventas. Decidido el 23-nov: el % de mano de obra y la venta por hora trabajada van con el módulo de horarios | «ICP» ya muestra turnos y horas del reparto de propinas (`VentasICP.tsx`) |
| 2. ¿El PoS guarda modificadores y tamaños usables para un mix tipo PMIX? | **A medias.** Los extras y los ingredientes llegan como **líneas sueltas** de la factura (familias 22 y 20; el agente además lee las marcas «es extra» y «compuesto» del detalle, y las usa solo para no contarlas como unidad). **No llega qué plato acompañan** ni un campo de tamaño: si la carta tiene tamaños, solo pueden estar como códigos de producto distintos (no verificado contra el catálogo del PoS). **Se puede** (3.2): extras e ingredientes como fila propia, por código, con unidades y venta. **Queda en 4.x:** el mix «plato + su modificador», que necesita que el puente lea esa relación, si el PoS la guarda (hay que mirarlo en la PC del PoS, solo lectura) | `supabase/migrations/062_pos_ndf_ingesta.sql` (`pos_ndf_ticket_lines`: sin vínculo entre líneas), `src/shared/ndf/mapTicket.ts` (`no_cuenta_unidad`, familias 20 y 22) |
| 3. ¿Dónde está la SPEC? | En este archivo. Nunca había llegado a `main`: el PR #246 se cerró sin merge | Este PR |
| 4. ¿El indicador de refacturas ya se ve? | **No.** Está decidido (17-nov) pero ninguna pantalla lo muestra: todas las funciones que leen Ventas filtran facturas cerradas. El dato existe (las anuladas se guardan). Entra con la 3.4, en «Regalías» → «Anulaciones y refacturas»; la definición, en D13 | Migraciones 067, 080, 190, 193 y 194 (`estado = 'C'`); `src/shared/api/posNdf.ts` |
| 5. ¿Hay pantalla de cocina o plano por zonas con dato? | **No.** Tiempos de cocina: sin fuente (las líneas no traen hora). Zonas: sin plano ni catálogo; solo el código de área crudo de la factura. Las dos, fuera de alcance (§11); «venta por área» queda anotada en 4.x | `supabase/migrations/081_pos_ndf_campos_factura.sql` (`area_factura`), `pos_ndf_ticket_lines` sin fecha |
| 6. ¿La 3.5 tiene fecha? | Es la **próxima tarea** de construcción de Ventas (23-nov). Alcance, orden y criterios en §12 | §10.2 |

**Huecos que marcó el Auditor y cómo quedan:** locales lado a lado → más adelante, con Nosara · mano de obra →
módulo de horarios · mix con modificadores → fila de extras en la 3.2, el resto en 4.x · salonero contra el
promedio con descuentos y tiempo de mesa → D14 · zonas y cocina → fuera de alcance.

**Lo que se toma tal cual:** unificar ya en las 5 pestañas; un solo % por cifra, con la base y sus fechas; no
reponer el índice; «Ing. Menú» a Productos y «Prom/PAX explicado» a Resumen.

**Una corrección al Auditor:** la alerta de mesas sin pax está en pantalla, pero no completa en el correo ni
en Mi Rendimiento (2.4 parcial, §0).
