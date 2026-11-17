# Auditoría del módulo Ventas — noviembre 2026

**Fecha:** 16-nov-2026 · **Alcance:** `src/modules/ventas/` (18 vistas), sobre `main` `064a042`, mirando también
la rama `claude/ventas-desde-pos` (`0515017`), que saca el Excel y la Paridad.
**Método:** lectura de código, consultas de **solo lectura** a prod y una reproducción local del error del Mix.
**No se tocó** código de la app, ninguna base ni ningún archivo sagrado. La propuesta está en
[SPEC-ventas-v2.md](SPEC-ventas-v2.md) y la maqueta en [maqueta-ventas-v2.html](maqueta-ventas-v2.html).

> **Privacidad (repo público):** este documento no trae montos ni nombres. La evidencia de datos va en
> porcentajes, conteos de productos y nombres de categorías del menú.

## 1. Resumen

1. **El Mix repite filas por un error de claves de React, no por los datos.** Una categoría que tiene productos de
   dos tipos (hoy `GREENSEASON`: comida y bebida) se dibuja en dos secciones con la misma clave. Cada clic en
   cualquier categoría deja una fila huérfana más. Reproducido: 2 → 8 filas en 6 clics. El arreglo son 6 líneas
   (§3) y va en un PR aparte, antes que todo lo demás.
2. **Las comparaciones del mes en curso están mal planteadas en 5 lugares.** Con datos reales de prod, la primera
   quincena de noviembre «cae 39 %» contra octubre completo y en realidad **sube 47 %** contra los mismos 15 días
   de octubre. Contra el año anterior, «cae 60 %» contra el mes completo y en realidad cae entre 6 % y 11 %.
3. **El mismo indicador da números distintos según la pestaña.** «Prom/PAX» tiene cuatro fórmulas y «Salón» tres.
4. **El módulo trae toda la historia al navegador** (unas 41 mil facturas y 232 mil líneas, en más de 200 pedidos
   en fila) para sumarla ahí. Ya existe una función que agrega en la base y casi no se usa.
5. **«¿Cuánto regalo o descuento?» hoy no se puede contestar bien:** el descuento por factura llega en 0 en todas
   las facturas desde 2024, y las secciones de cortesías, personal y Local Club del Mix quedan vacías con el PoS.
6. **Sobran pantallas y faltan respuestas:** 18 vistas con 9 selectores de período distintos. «Histórico» no
   aporta nada propio; «Competencias» no tiene ni una competencia cargada; «Ing. Menú» no tiene ni un costo.

## 2. Hallazgos priorizados

Prioridad: **P0** = da un número o una pantalla falsos hoy · **P1** = confunde o esconde algo importante ·
**P2** = deuda que conviene pagar con el rediseño · **P3** = prolijidad.

### P0

| # | Hallazgo | Evidencia | Arreglo |
|---|---|---|---|
| P0-1 | **Mix: filas repetidas al expandir.** Claves de React repetidas entre secciones | `VentasMix.tsx:646`, `:677`, `:709` (ver) y `:870`, `:900`, `:935` (comparar); causa en §3 | PR aparte, §3.4 |
| P0-2 | **Comparación injusta: período en curso contra período completo** | «Año vs Año» `VentasAnalisis.tsx:126` (año en curso contra año entero), `:158-159` (mes), `:195` (trimestre); «Detalle anual» `:280` (mes contra mes anterior) y `:368` (quincena); «Mix → Comparar» (`VentasMix.tsx:224-231`, meses enteros) | Motor de períodos «a la fecha» (SPEC §3) |

**Evidencia de P0-2 (prod, solo lectura, venta neta, 1–15 nov 2026):**

| Comparación | Lo que da |
|---|---|
| Contra octubre **completo** (lo que hace hoy la app) | −39 % |
| Contra el **1–15 de octubre** (mismos días) | **+47 %** |
| Contra noviembre 2025 **completo** (lo que hace hoy la app) | −60 % |
| Contra el **1–15 de noviembre 2025** (mismas fechas) | −6 % |
| Contra el año anterior **alineado por día de semana** (2–16 nov 2025) | −11 % |

La diferencia entre las dos últimas filas es el efecto del día de semana: en los últimos 12 meses el sábado
vende 15 % más que el día promedio y el jueves 8 % menos.

### P1

| # | Hallazgo | Evidencia | Arreglo |
|---|---|---|---|
| P1-1 | **«Prom/PAX» con cuatro fórmulas.** Salón ÷ pax del día; total del mesero ÷ su pax; total de meseros ÷ pax de meseros; neta total ÷ pax | `ventasUtils.ts:273`, `:327`, `:395`; `VentasAnalisis.tsx:120`, `:228`, `:285`; `VentasContabilidad.tsx:40` | Una sola definición, la firmada en `docs/SPEC-prompax-explicado.md` §5 (SPEC §4) |
| P1-2 | **«Salón» con tres definiciones.** Meseros + caja-salón; solo meseros (con su delivery adentro); meseros sin su delivery + caja-salón | `VentasHoy.tsx:338` y `:392`; `VentasSaloneros.tsx:130`; `VentasHistorico.tsx:99`; `VentasContabilidad.tsx:117` (`getDayStats`) | Salón = canal de la factura, siempre |
| P1-3 | **Mix: el total no es la venta.** Los productos solo traen las familias 2, 3, 4, 5, 13, 16 y 29; la neta suma además merch, gift cards, promociones y dueños. En oct-2026 el Mix fue el 99,0 % de la neta. El rótulo dice «Total Mix» en una vista y «Total ventas» en la otra | `ventasEnVivoDatos.ts:295`; `VentasMix.tsx` (KPIs de ver y de comparar) | Rotular «comida y bebida» y mostrar la línea «otros» que cierra contra la neta |
| P1-4 | **Mix: cinco secciones muertas con el PoS.** «Personal», «Cortesías», «Comensales», «Local Club» y «Merchandising» no pueden tener filas: esas familias no llegan a los productos. Lo mismo el bloque «Regalías, Personal & Desconocidos» de «Hoy» | `VentasMix.tsx:37-45`; `ventasEnVivoDatos.ts:295`; `VentasHoy.tsx:557-569` | Pregunta propia «¿Cuánto regalo?» leyendo las familias 6, 17, 28 y `regalia_crc` |
| P1-5 | **Mix: dos vocabularios de categoría.** La curada (`BEBIDAS`, `SUSHI ROLLS`…) y la de familia (`Bebidas`, `Rolls`…) conviven: en oct-2026 aparecen `BEBIDAS` y `Bebidas` como dos categorías. Además, sin subclasificación la subcategoría se llama igual que la categoría | `ventasEnVivoDatos.ts:73-81`; `ventasUtils.ts:167-186`; `VentasMix.tsx:107` | Catálogo único por código de producto (SPEC §8) |
| P1-6 | **Mix: «Delivery» no es el canal.** Es «lo que vendieron las dos cajas de turno». El delivery de un mesero cuenta como salón y el salón cobrado en caja como delivery; «Ventas» usa el canal de la factura | `VentasMix.tsx:79-95` contra `ventasUtils.ts:232-262` | Canal de la factura |
| P1-7 | **Mix: el pie no cuadra con sus propios porcentajes.** El pie suma todas las secciones y dice «100 %» fijo; los porcentajes se calculan sobre un total que excluye cortesías y comensales. La sección «Local Club» filtra por tipo **o** por nombre de categoría, así que un producto puede contarse en dos secciones | `VentasMix.tsx:42`, `:123`, `:639`, `:766`, `:997` | Un solo total, calculado una vez |
| P1-8 | **Descuentos: el dato no existe.** `descuento_crc` vale 0 en el 100 % de las facturas desde ene-2024 y la clase `descuento` nunca aparece. Ya estaba anotado en `SPEC-analisis-ventas-integrado.md` §6 (#3 y #4) | Consulta a prod, 35 meses | Ingesta del descuento por línea (firma) |
| P1-9 | **Rendimiento: la historia entera viaja al navegador.** 14 de 17 vistas disparan la carga completa: ~41 mil facturas y ~232 mil líneas, de a 200 facturas por pedido, en fila | `ventasTabs.ts` (`VISTAS_CON_FONDO`); `posNdf.ts:259-278`; `VentasModule.tsx` (`pedirFondo`) | Agregar en la base: `pos_prompax_agregado` (mig 080) ya lo hace para un caso |
| P1-10 | **Proyección del mes y del año: lineal.** Venta ÷ días con datos × días del mes. Cuenta el día de hoy, a medio hacer, como día entero; no mira el día de semana ni la temporada. El total proyectado del año usa el mes en curso **sin proyectar**. El rótulo «Mes en curso — meta» muestra la meta del año | `ventasUtils.ts:597-601`; `VentasAnalisis.tsx:404-405`, `:425`, `:441` | Proyección por ritmo de día de semana, sobre días cerrados (SPEC §4.3) |
| P1-11 | **«Hoy» compara un día a medio hacer contra el día anterior entero.** Desde que la fuente es el PoS, el último día cargado es el día en curso | `VentasHoy.tsx:43-46`, `:70-74` | «Hoy» = día en curso contra la misma hora; «Ayer» = último día cerrado |
| P1-12 | **Nueve selectores de período distintos**, cada uno con su valor por defecto: último día; 7/15/30 días; mes; año; rango libre; mes o año entero; 12 semanas; temporada | `VentasSaloneros.tsx:23-29`, `VentasHistorico.tsx:36-42`, `VentasCajeros.tsx:18-23`, `VentasMix.tsx`, `VentasContabilidad.tsx`, `VentasEvaluacion.tsx:128-133`, `VentasICP.tsx`, `VentasPromPaxExplicado.tsx`, `VentasAnalisis.tsx` | Un selector global que se conserva al cambiar de vista |

### P2

| # | Hallazgo | Evidencia |
|---|---|---|
| P2-1 | **«Ing. Menú» no puede funcionar:** 0 de 712 productos tienen costo cargado. Además usa la mediana y el margen en %, no el método Kasavana–Smith (regla del 70 % y margen en ₡) | `product_map` en prod; `VentasMenuEng.tsx:130-140` |
| P2-2 | **«Competencias» no se usa:** 0 filas en `ventas_comps`. «Metas»: 11 meses de meta del restaurante; 0 de margen y 0 metas individuales | Consulta a prod |
| P2-3 | **«Histórico» no aporta nada propio** (§4) | `VentasHistorico.tsx` |
| P2-4 | **Fechas con la hora de la máquina y no la de Costa Rica** | `VentasAnalisis.tsx:31`, `:397`, `:400`, `:416`; `ReporteMensual.tsx:77` |
| P2-5 | **Multi-local a medias:** el local es una constante (`santa-teresa`) salvo en «En vivo». Metas y catálogo no tienen local | `ventasDiasDesdePos.ts:33`; `VentasEnVivo.tsx:151`; tablas `ventas_metas`, `product_map` |
| P2-6 | **Calidad del dato que la pantalla no avisa:** 12,7 % de las facturas de salón de oct-2026 sin pax; sin salonero en la factura antes de 2025; hora de apertura de la mesa solo desde nov-2026; 2023 solo como resumen diario | Consultas a prod |
| P2-7 | **Facturas en estado `X` desde oct-2026** (3 % en octubre, 17 % del 1 al 16 de noviembre). Casi todas son «sin cobro» o «dueños» con regalía. Ventas las ignora; hay que confirmar que es lo esperado y de dónde se leen las regalías | Consulta a prod; `ventasEnVivoDatos.ts:189-195` |
| P2-8 | **Mix, menores:** «Expandir todo» queda desincronizado al cambiar de período (`:192`, `:289`); el identificador de fila borra tildes y eñes y puede chocar (`:263`); el buscador filtra filas pero no recalcula totales; un año que solo tiene resumen se puede elegir y sale vacío (`:207-210`); el tipo de un producto lo fija el primer día que aparece (`ventasDiasDesdePos.ts:103`) | `VentasMix.tsx` |
| P2-9 | **«Hoy»: el promedio del mismo día de semana promedia promedios** (no pondera por personas) | `VentasHoy.tsx:86` |
| P2-10 | **`getProductMap` no pone límite:** hoy son 712 filas y PostgREST corta en 1.000 sin avisar | `shared/api/ventas.ts:102-103` |

### P3

- Colores fuera de la paleta del estándar (`#c890e8`, `#d4a84b`, `#4a9a6a`…), emojis en botones y etiquetas en
  mayúsculas: `VentasMix.tsx:26`, `VentasMenuEng.tsx:43-60`.
- Estilos en línea en casi todas las vistas; archivos de más de 1.000 líneas (`VentasMix`, `VentasEnVivo`,
  `MiRendimiento`).
- El gráfico de «Histórico» dibuja una línea por salonero y por día: con 6 a 9 personas no se lee.

## 3. Mix: causa raíz

### 3.1 Qué pasa

La tabla del Mix se arma recorriendo **secciones** (Bebidas, Comidas, Merchandising, Personal, Local Club,
Cortesías, Comensales) y, dentro de cada una, las **categorías** que tienen algún producto de esa sección
(`VentasMix.tsx:596-720`). Una categoría con productos de dos tipos aparece en dos secciones. Las filas llevan
como clave solo el nombre de la categoría:

```tsx
// VentasMix.tsx:646 — la misma clave en «Bebidas» y en «Comidas»
<tr key={`clas-${cId}`}
```

Lo mismo pasa con las subcategorías (`:677`) y los productos (`:709`), y en la tabla de «Comparar» (`:870`,
`:900`, `:935`).

Con dos filas hermanas de igual clave, React pierde la cuenta: al reconciliar guarda las filas viejas en un mapa
por clave (la segunda pisa a la primera), reutiliza una, crea otra nueva y **nunca borra** la que quedó pisada.
Cada vez que la lista cambia de forma —al expandir o colapsar **cualquier** categoría— queda una fila huérfana
más en pantalla.

### 3.2 Evidencia en los datos de prod

| Dato | Valor |
|---|---|
| Categorías del catálogo con más de un tipo | 1 de 21: `GREENSEASON` (29 productos: comida y bebida) |
| Lo mismo en staging | 13 categorías con más de un tipo (de 720 productos): ahí el error salta mucho más seguido |
| `GREENSEASON` en el Mix de oct-2026 | 20 productos vendidos: 19 de comida y 1 de bebida; 3,4 % del Mix |
| Categorías duplicadas por vocabulario en oct-2026 | `BEBIDAS` (106 productos, curada) y `Bebidas` (6 productos, de familia) |
| Categorías donde la subcategoría repite el nombre | `TAPAS ASIATICAS`, `POSTRES`, `PROMOCIONES`, `Bebidas` |

Por eso «a veces» falla: solo en los meses donde se vendió algo de `GREENSEASON` de los dos tipos, y solo
después de tocar alguna categoría.

### 3.3 Reproducción

Prueba local temporal (no se sube): se montó `VentasMix` con 5 productos ficticios, uno de bebida y uno de
comida en `GREENSEASON`, y se hizo clic 6 veces en otra categoría.

| | Filas «GREENSEASON» tras cada clic | Avisos de React por clave repetida |
|---|---|---|
| Código actual | 2 → 3 → 4 → 5 → 6 → 7 → 8 | 7 |
| Con la sección en la clave | 2 → 2 → 2 → 2 → 2 → 2 → 2 | 0 |

### 3.4 Arreglo propuesto (PR aparte y prioritario)

Solo `VentasMix.tsx` y su prueba; no cambia ningún número.

1. **Claves con la sección** en las seis filas: `clas-${sec.label}-${cId}`, `sub-${sec.label}-${sId}`,
   `prod-${sec.label}-${sId}-${p.nombre}`.
2. **Estado abierto/cerrado con la sección:** hoy `openClas` guarda solo la categoría, así que abrir
   `GREENSEASON` en «Comidas» la abre también en «Bebidas». El identificador pasa a `${sec.label}/${clas}`.
3. **Identificador sin pérdida:** `slugify` (`:263`) convierte tildes, eñes y símbolos en `_`. Usar el nombre
   tal cual (o `encodeURIComponent`).
4. **Prueba que muerde** (`VentasMix.render.test.tsx`): una categoría con dos tipos, 6 clics, y exigir que la
   cantidad de filas no cambie y que React no avise de claves repetidas. Mutación: volver a la clave vieja → cae.
5. **Mismo PR, sin riesgo:** el pie usa el mismo total que los porcentajes (P1-7) y «Expandir todo» se
   reinicia al cambiar de período (P2-8).

Lo que **no** entra en ese PR: el vocabulario de categorías (P1-5), el delivery por canal (P1-6) y las
secciones muertas (P1-4). Cambian números o pantallas y van con el rediseño.

**Qué va a ver el encargado:** la misma tabla, sin filas repetidas. `GREENSEASON` sigue apareciendo una vez en
«Bebidas» y una vez en «Comidas», ahora cada una se abre por separado.

## 4. Histórico: evaluación

**Qué muestra hoy** (`VentasHistorico.tsx`):

| Bloque | ¿Está en otra vista? |
|---|---|
| Rango: 7 / 15 / 30 días / 3 meses / Todo / fechas libres | «Saloneros» y «Cajeros» tienen casi lo mismo |
| Venta neta, Salón, PAX, Prom/PAX, Beb/PAX, Ratio C/B | Sí: «Hoy», «Saloneros», «Ventas» |
| Gráfico de Prom/PAX por día, una línea por salonero | Parecido en «Evaluación» (por semana) |
| Top 10 de productos del rango | Sí: «Hoy» (por día) y «Mix» (por mes) |

**Veredicto:** el dueño tiene razón. Lo único que no está en otro lado es **elegir un rango libre para los
indicadores generales**, y eso es una función del selector, no una pantalla.

**Propuesta:** sacar la pestaña y la entrada de menú «Histórico», sin perder nada:

- el rango libre pasa al selector global (SPEC §3);
- los seis indicadores pasan a «¿Cómo voy?»;
- la evolución de la venta por persona de cada salonero pasa a «¿Quién vende?», por semana;
- el top de productos pasa a «¿Qué vende?».

Las otras cuatro vistas que hoy cuelgan de la entrada «Histórico» (Calendario, Mix, Ventas, Cajeros) se
reparten según el mapa de la SPEC §7.

## 5. Vista por vista

| Vista | Qué muestra | De dónde | Observaciones |
|---|---|---|---|
| Hoy | Último día cargado: venta, salón, delivery, cajas, indicadores, ranking, top de productos, mensaje para WhatsApp | Días del PoS (90 días) | P1-11, P1-2, P1-4, P2-9 |
| En vivo | Día en curso: cobrado, cuentas abiertas, mesas, ritmo por hora, turnos | Tablas del PoS directo (excepción de la regla 6) | La mejor resuelta. Único selector de local |
| Saloneros | Ranking por rango relativo al último día | Días del PoS | P1-1, P1-12 |
| Por línea | Dos lentes: quién cargó la línea y de quién es la mesa | Función propia | Bien documentada; valiosa y escondida |
| Evaluación | Consistencia, tendencia, racha, % de meta, 12 semanas | Días del PoS | Depende de metas individuales, que nadie cargó (P2-2) |
| ICP | Propina electrónica ÷ venta, por mes | Días del PoS + propinas | Definición firmada (regla 5). Solo por mes |
| Competencias | Puntos por producto | `ventas_comps` | Sin uso (P2-2) |
| Análisis | Año contra año, detalle anual con **quincenas**, proyección, Prom/PAX explicado | Días + resumen histórico; función 080 | P0-2, P1-10, P2-4. La tabla quincenal existe, pero al fondo de «Detalle anual» |
| Histórico | §4 | Días del PoS | Sacar |
| Calendario | Promedio por día de semana y detalle por fecha, mejor y peor día | Días + resumen | Útil; repite el bloque de día de semana de «Ventas» y «Cajeros» |
| Mix | Categoría → subcategoría → producto; comparar hasta 6 meses | Días del PoS + catálogo | P0-1, P1-3 a P1-7, P2-8 |
| Ventas | Tabla contable del mes: bruta, IVA, servicio, neta, salón, delivery, pax; CSV; reporte | Días + resumen | La más confiable para el contador. P1-1, P1-2 |
| Cajeros | Cajas de turno, delivery, atribución por línea | Días del PoS | Es «canal», no «personas» |
| Ing. Menú | Cuadrantes | Días + costo del catálogo | P2-1 |
| Metas | Meta mensual, margen, metas de desempeño | `ventas_metas` | Sin local (P2-5) |
| Cargar XLS, Paridad | — | — | Se retiran en `claude/ventas-desde-pos` |
| Productos | Tipo, categoría, multiplicador, costo | `product_map` | Por nombre, no por código (P1-5) |

**Coherencia de totales entre vistas** (mismo período, misma fuente):

| Número | ¿Coincide? |
|---|---|
| Venta neta: «Hoy», «Ventas», «Histórico», «Análisis», «Calendario» | Sí: todas salen de `armarDia` → `getDayStats` |
| Venta neta contra «Total Mix» | No (P1-3) |
| «Salón» | No (P1-2) |
| «Delivery»: «Ventas» contra «Mix» y «Cajeros» | No (P1-6) |
| «Prom/PAX» | No (P1-1) |
| PAX | Sí, salvo «Saloneros», que no cuenta el pax de caja (a propósito) |

**Hora de Costa Rica:** el día de la venta es el día CR de la factura, en todo el módulo. No hay facturas de
madrugada (0 % en oct-2026), así que día calendario y día de trabajo coinciden. Quedan los casos de P2-4.

## 6. Qué cambia con «todo del PoS» (`claude/ventas-desde-pos`)

- **Se van** «Cargar XLS», «Paridad» y el Excel como respaldo. Bien: una sola fuente.
- **Corte:** el PoS arranca el 5-ene-2024. 2023 queda solo como resumen diario (`ventas_hist`), sin productos
  ni saloneros. La v2 tiene que decir «sin comparación» cuando el período comparado cae antes del corte.
- **El día de hoy entra** en los datos: toda comparación tiene que separar «días cerrados» de «hoy en curso».
- **Sin respaldo:** si el PoS no se puede leer, la pantalla queda vacía y avisa. Correcto.
- **Lo que no arregla:** P0-1, P0-2 y todos los P1 siguen igual en esa rama.

## 7. Lo que ya existe y hay que aprovechar

- **`periodosPromPax.ts` y `temporadas.ts`:** motor puro de períodos y comparaciones (mes, semana ISO,
  temporada, rango; período anterior y año anterior con la semana alineada 364 días). Le faltan quincena,
  «a la fecha» y año a la fecha.
- **`pos_prompax_agregado` (mig 080):** agrega en la base por día, franja, salonero y canal, con contrato
  probado contra `netaVenta.ts`. Es la base de «¿Cómo voy?», «¿Quién vende?» y «¿Cuándo vendo?» sin traer líneas.
- **`SPEC-analisis-ventas-integrado.md`** (3-nov): ya define la regla «a la fecha», las temporadas y los datos
  que faltan. La v2 la extiende a todo el módulo; no la contradice.
- **`docs/club-satori/ESTANDAR-reportes.md`:** paleta, tipografía y reglas de tabla y gráfico.
- **Skill de análisis:** definición de neta, trampas conocidas (turno ≠ hora, «total» casi siempre es salón).

## 8. Consultas usadas (solo lectura, prod `yiczgdti…`)

Todas agregadas y con filtro de fechas; ninguna devuelve filas de clientes ni de personas.

1. Catálogo: productos por tipo y por categoría; categorías con más de un tipo.
2. Mix de ago–oct 2026 clasificado como lo hace la app (catálogo curado, si no familia): categorías por sección.
3. Octubre 2026 por estado de factura: Mix ÷ neta, % fuera de salón, % sin pax, % con descuento.
4. Facturas por mes desde 2024: estados, descuento, clase de ingreso, saloneros, hora de apertura.
5. Volumen total de facturas y líneas; filas de `ventas_comps`; meses con meta.
6. Primera quincena de nov-2026 contra las cinco bases de comparación; índice por día de semana (12 meses).
