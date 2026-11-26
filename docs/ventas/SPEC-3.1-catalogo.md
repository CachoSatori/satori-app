# SPEC — Ventas v2 · fase 3.1: catálogo único de productos desde el PoS

**Estado:** PROPUESTA con las **decisiones del dueño del 24-nov-2026** (dos rondas) ya incorporadas (§9.3), escrita contra
`main` = `9312c23`. Desarrolla la fila 3.1 de [SPEC-ventas-v2.md](./SPEC-ventas-v2.md) (§0, §8 y §9) con las
decisiones **D8** (catálogo único por código, firmada el 17-nov) y **D17** (el catálogo sale del PoS, 23-nov).
**No autoriza código ni esquema.** La migración 198 de §6 es una propuesta escrita dentro de este documento: el
archivo no existe en `supabase/migrations/` y no se aplicó en ninguna base. Falta **la firma del dueño** (🖊️, D-9),
que va sobre el SHA del PR 3.1a. Donde el coordinador tuvo que interpretar una decisión dice **Lectura del
coordinador** (lista en §9.4); lo que sigue abierto para el dueño está en §9.3.1. La subcategoría del PoS
(cervezas, vinos, cocteles) **no** entra en la 198: va en la 3.1c, con su firma (§11).

**Cómo se verificó:** lecturas de solo lectura en staging (`hwiatgic…`) para medir los datos (§2.5 y §7.1), y la
migración con su batería en un Postgres 16 local y vacío (el método de `scripts/sql/193_base_local.sql`), en una
transacción que termina en `rollback` (§8.1). **La corrida completa en staging sigue NO PROBADA** (queda para el
PR 3.1a, antes de la firma). Prod no se tocó ni se leyó.

## 1. Problema y objetivo

### 1.1 El problema

Hoy un producto vendido se clasifica por **dos caminos que no coinciden**:

1. `product_map`: una tabla cargada a mano, con clave **el nombre** del producto (`tipo`, `clasificacion`,
   `subclasificacion`, `multiplicador`, `costo_unitario`). Se edita en «Ajustes → Productos» (`VentasConfig.tsx`).
2. La **familia** que trae cada línea del PoS (`pos_ndf_ticket_lines.familia`), con la que `armarDia` arma otro mapa.

`fusionarProductMap` (`ventasUtils.ts`) los junta campo por campo en el navegador. Consecuencias medidas en staging
el 24-nov (§7.1):

- **El nombre no identifica al producto:** 22 nombres del PoS los comparten dos o más códigos. El código sí: cada
  uno de los 704 códigos tiene un solo nombre y una sola familia en toda la historia.
- **Dos vocabularios en la misma columna:** de 720 filas de `product_map`, 178 tienen un `tipo` que la app entiende
  (`comida`, `bebida`…) y 542 tienen el **nombre de una familia del PoS** en mayúsculas («BEBIDAS», «SUSHI ROLLS»…),
  que ninguna pantalla sabe leer (lo escribió un import de la carta).
- **Catálogo que no cubre lo que se vende:** 64 códigos vendidos no tienen fila en `product_map`, y 100 filas no
  coinciden con ningún producto del PoS.
- **El Mix baja las líneas crudas** al navegador (90 días) para sumarlas; la regla 6 de diseño de Ventas v2 es
  agregar en la base.

### 1.2 El objetivo

Un **catálogo único por código**, que **sale solo del PoS** (código, nombre y familia), por local, y una función
de lectura `pos_ventas_productos` que devuelve las ventas ya sumadas por producto. Nadie tiene que clasificar para
que un producto aparezca bien: la categoría sale de su familia. Lo que una persona **puede** ajustar, por código
(decisiones del 24-nov), son dos cosas: **cuántas personas rinde** y la **categoría** cuando no es la de su
familia. El segundo nivel dentro de una categoría (cerveza, vino, cocteles clásicos, sin alcohol) **existe en el
PoS** y va a venir de ahí, no de una carga a mano: es la 3.1c (§11). El costo llega con Inventario.

La 3.1 **no cambia ningún número en pantalla**: deja listo el dato para la 3.2 («Productos» definitiva). Los
números que la decisión D-3 va a mover cuando la 3.2 lea el catálogo nuevo están en §2.5.

### 1.3 Qué cambia para el usuario, por rol

| Rol | Con el PR 3.1a (esquema y lector) | Con el PR 3.1b (pantalla) |
|---|---|---|
| Dueño | Nada visible | En Ventas → Ajustes, «Productos» pasa a ser **«Catálogo»** (D-5 = B): todos los productos del PoS del local, con buscador y filtros (categoría, familia, «los que cambié», «nuevos»). Por producto se editan dos cosas: **rinde** y **categoría**. Ya no se cargan tipo, clasificación, subclasificación ni costo. «Mix» e «Ing. Menú» siguen igual hasta la 3.2 |
| Encargado (manager) | Nada visible | Lo mismo, solo de su local |
| Contador | Nada visible | Nada (no veía «Ajustes → Productos» y no ve «Catálogo»; no edita, D-7) |
| Salonero, cajero y resto | Nada | Nada. Mi Rendimiento sigue leyendo lo de hoy (§5) |

## 2. Fuente y modelo

### 2.1 De dónde sale cada dato

| Dato | Fuente | Quién lo escribe |
|---|---|---|
| Código, nombre y familia del producto | Cada línea de factura del PoS (`pos_ndf_ticket_lines.codigo_producto`, `nombre`, `familia`) | El disparador de §4.4, solo |
| Nombre de la familia y su categoría por defecto | La tabla de familias del PoS (`FAC_Clasificaciones`), cargada por la migración (§6) y confirmada en la PC del PoS (D-4 = A) | Las filas, la categoría y el orden: la migración. **El nombre:** el owner desde «Ajustes → Catálogo» (`pos_familia_nombre_guardar`, mig 203; decisión del dueño 26-nov, opción A), sin historial de quién ni cuándo. La 3.1b se mergea junto con la 3.2 |
| Cuántas personas rinde y categoría propia | Una persona, en «Ajustes → Catálogo» | `pos_producto_ajuste_guardar` (§4.3) |
| Subcategoría (cerveza, vino, cocteles…) | **El PoS.** Hoy no llega a la app: el agente manda solo la familia de cada línea | **No entra en la 3.1a.** La trae el agente en la 3.1c (§11) |
| Costo | **No entra en la 3.1.** Queda en `product_map` y se actualiza desde Recetas (D-6 = A, §2.4) | — |

### 2.2 Categoría → familia → producto

El PoS manda hoy **un solo nivel** de clasificación: la familia (un número). Encima va la **categoría grande**
(comida, bebida y las demás de la tabla). **Decidido 24-nov (D-2 = C):** la categoría es **del producto**
(local, código): por defecto es la de su familia y una persona la puede cambiar por código.

**Categoría → Familia → Producto**, ordenado por categoría (orden fijo), después por el orden de la familia y
después por nombre. Cuando llegue la subcategoría del PoS (3.1c) se suma como una forma de abrir una familia
grande —bebida en cervezas, vinos, cocteles—, sin cambiar nada de lo de acá.

| Orden | Categoría | Familias de Santa Teresa que la traen por defecto | ¿Es venta neta? | ¿Una persona la puede elegir para un código? |
|---|---|---|---|---|
| 1 | `comida` | 2, 3, 16, 13, 4, 29 · 9 Grupo C (mixta), 11 y 15 (mixtas, §2.5) | Sí | Sí |
| 2 | `bebida` | 5 · 18 Y HAPPY HOUR · 25 y 1 (mixtas, §2.5) | Sí | Sí |
| 3 | `menu_especial` | Ninguna: solo por código (hoy, el 192) | Sí | Sí |
| 4 | `extras` | 22 | Sí | Sí |
| 5 | `otros` | 7 Grupo A (surf), 8 Grupo B (surf) y 14 PROMOCIONES, por código y hoy sin ventas · una familia que aparezca sin fila | Sí | Sí |
| 6 | `merch` | 21, 23, 24, 26 · 10 REMERAS · 27 T-XABANICOS | Sí | Sí |
| 7 | `giftcard` | 12 | Sí | No: la fija la familia |
| 8 | `pax` | 19 | Sí | No: la fija la familia |
| 9 | `duenos` | 28 | Sí | No: la fija la familia |
| 10 | `cortesia` (se muestra **«Regalías»**) | 17 X CORTESIAS | **No** | **No, nunca** |
| 11 | `personal` (consumo del personal, aparte) | 6 PERSONAL | **No** | **No, nunca** |
| 12 | `ingredientes` | 20 Ingredientes (sin ventas) | **No** | **No, nunca** |

**`menu_especial` (decidido 24-nov, segunda ronda):** categoría nueva para el **ítem por comensal de un menú
cerrado** (hoy, el código 192 del menú de año nuevo). Es venta neta como cualquier otra. **Por qué va tercera y no
entre `otros` y `merch`:** es venta gastronómica —un paquete de comida y bebida que no se puede partir— y se lee
al lado de comida y bebida; `extras`, `otros` y `merch` son lo que queda fuera de la carta. El orden vive en la
pantalla, no en la base: moverla es cambiar una lista. No entra en la relación comida/bebida (no es ninguna de
las dos) y en el mix es una línea propia que cierra contra la neta.

**La regla que no se negocia: la categoría nunca decide la venta.** Qué plata es venta lo decide **solo la familia
de la línea**: fuera de la venta = {6, 17, 20}, que es `FAMILIAS_NO_VENTA` (`netaVenta.ts`, firmada) y sigue
intacta. La categoría por código solo **reparte lo que ya es venta** entre comida, bebida y las demás; no puede
sacar ni meter un producto de la venta neta. La 198 lo cuida en tres lugares, y cada uno tiene su prueba (§8.1):

1. **La tabla** no acepta que una persona guarde `cortesia`, `personal` ni `ingredientes` (`check`), ni que una
   familia distinta de 6, 17 y 20 tenga una de esas tres categorías (y al revés).
2. **La función de guardado** rechaza con `22023` cualquier valor fuera de la lista, y también cambiarle la
   categoría a un producto de las familias 6, 17, 20, 12, 19 o 28.
3. **`pos_categoria_efectiva`**, la única definición de la categoría de una línea: si la línea es de las familias
   6, 17 o 20, su categoría es la de esa familia y lo cargado por código no opina.

Y por encima de las tres: `neta_cts` se calcula **sin mirar categorías**. En la batería, con las tres defensas
rotas a propósito a la vez, el reparto por categoría se rompe pero `neta_cts` sigue igual a la de la 190.

- **Decidido 24-nov (A-3 = A):** `giftcard`, `pax` y `duenos` no se eligen a mano ni se le cambian a un producto:
  esas familias tienen cuentas propias (personas, mesas de dueños).
- **Nombres leídos por el dueño en la PC del PoS (24-nov 15:43 CR) y decisiones (~15:50 CR):** la 198 carga las
  **29 familias** (1 a 29). La **familia 1 no existe en el PoS**: sus códigos vienen de una clasificación borrada; va
  como «(clasificación borrada)» y su categoría es por código (su único código, a bebida). **9 Grupo C (mixta) es mixta**
  (tapas, rolls, bebidas, postre): categoría por código como 11, 15 y 25 (A-2: un código nuevo toma la mayoría, hoy
  comida; sus dos códigos de la historia, a comida). **18 Y HAPPY HOUR → bebida · 10 REMERAS → merch · 17 X CORTESIAS
  → regalías** (no es venta; la fija la familia, como gift cards, pax y dueños) **· 6 PERSONAL → consumo del personal,
  aparte** (fuera de la venta neta de carta) **· 7 y 8 (Grupo A y B, surf) y 14 PROMOCIONES → por código** según lo que vendan
  (hoy no tienen ninguna línea: un código nuevo entra en `otros` hasta que alguien le ponga la suya) **· 20
  Ingredientes → sin ventas.** 7, 8, 10, 14 y 18 no tienen líneas hoy (staging y prod, solo lectura).
- **Rótulos neutros (decisión del dueño, 24-nov ~16:30 CR):** las familias 7, 8 y 9 llevan nombres de terceros y el
  repo es público: la 198 las carga como «Grupo A (surf)», «Grupo B (surf)» y «Grupo C (mixta)». El nombre real lo
  carga el dueño desde la app (Ajustes → Catálogo, 3.1b); hoy `pos_familias` no tiene puerta de escritura desde la
  app, así que la 3.1b tiene que traer una (owner, solo el nombre) o una carga con firma.
- **Regalías y personal no chocan con el modelo:** ya eran categorías fijas de la familia y fuera de la venta
  (`cortesia` = 17, `personal` = 6; `FAMILIAS_NO_VENTA`, firmada). **Forma mínima:** la clave de la base sigue siendo
  `cortesia` y la pantalla la rotula «Regalías» (3.1b); renombrar la clave tocaría el `check`, tres funciones y la
  app sin cambiar ningún número. Si el dueño prefiere la clave `regalias`, es un cambio de la 198 antes de la firma.
- Una familia **nueva** que el PoS mande antes de que alguien la cargue se muestra **«Familia N»** dentro de
  `otros`, con un aviso. No se pierde plata ni se esconde.
- Los nombres de familia se muestran como están en el PoS.
- La plata de cada línea sigue a la **familia de esa línea**; la categoría por código se aplica a las líneas que
  son venta. Si un mismo código tiene una línea en la familia 17 (un regalo), esa línea es cortesía aunque el
  producto esté marcado «bebida».

### 2.3 Lo que una persona carga por código: «rinde» y categoría

| Dato | Qué es | Valores | Por defecto (sin fila) |
|---|---|---|---|
| **Rinde** | **Decidido 24-nov (D-1 = A):** el `multiplicador` de hoy con otro nombre. Una botella que rinde 4 cuenta como 4 bebidas en «bebidas por persona», en el precio por ítem y en la popularidad de la ingeniería de menú. **No** suma personas a la factura ni toca la venta por persona (D4, firmada) | 1 a 20 | 1 |
| **Categoría** | La categoría grande del producto cuando **no** es la de su familia (D-2 = C, D-3) | `comida`, `bebida`, `menu_especial`, `extras`, `merch`, `otros` | La de su familia |

- **Cómo se guarda:** tabla aparte `pos_producto_ajustes (local, codigo, rinde_personas, categoria)`, separada
  del catálogo porque la escriben manos distintas: el catálogo lo escribe una máquina y se puede rehacer entero
  desde las facturas; el ajuste lo escribe una persona y no se puede rehacer. Sin fila = todo por defecto. Guarda
  quién y cuándo lo cambió por última vez.
- **Por dónde se escribe:** una sola puerta, `pos_producto_ajuste_guardar`, que recibe los dos valores juntos (la
  pantalla manda la ficha entera) y valida el rol, el local del manager, el rango, la lista de categorías y que
  el código exista. Si los dos quedan por defecto, borra la fila. La API no puede escribir la tabla directo.
- **Qué se hereda de `product_map`** (por nombre, §7.2): solo los `multiplicador` mayores que 1. La categoría
  **no** se hereda de `product_map.tipo` (dos vocabularios mezclados, §1.1): sale de la familia, salvo los
  códigos de §2.5.
- **Lo que no se carga a mano (decidido 24-nov, segunda ronda):** el subgrupo. La primera versión de esta spec
  lo proponía como texto editable heredado de `product_map.subclasificacion`; el dueño confirmó que ese segundo
  nivel **ya existe en el PoS**, así que viene de ahí (§11) y la 198 no trae ni la columna ni la herencia.

### 2.4 El costo, cuando llegue Inventario

**Decidido 24-nov (D-6 = A):** el costo a mano se deja de cargar con la 3.1b; los costos ya cargados quedan en
`product_map`, «Ing. Menú» los sigue mostrando y se actualizan solo desde Recetas.

No hay columna de costo en la 198, a propósito: un costo cambia en el tiempo y necesita vigencia y origen (receta
o carga a mano), que son diseño de Inventario ([SPEC-inventario-v0](../inventario/SPEC-inventario-v0.md), F3
«Recetas → consumo teórico»). Lo que esta spec deja preparado:

- La clave para colgarlo: `(local, codigo)` de `pos_productos`. Hoy las recetas se atan al producto **por nombre**
  (`InvRecetas.tsx` → `product_map.costo_unitario`); con el catálogo por código se atan por código.
- Forma sugerida, a definir en la spec de Inventario: `pos_producto_costos (local, codigo, desde, costo, origen)`.
- Ojo para Nosara: el catálogo de **insumos** de Inventario apunta a «un solo código para los dos locales»
  (D-INV-5); los **productos del PoS** son por local, porque cada local tiene su PoS con su numeración. Una receta
  compartida va a necesitar su código en cada local.

### 2.5 Familias 11, 15 y 25: cada código a su categoría (D-3)

**Decidido 24-nov (D-3):** el dueño dijo «todo está dentro de una gran primera categoría, comida o bebida, depende
dónde esté». Los productos de las familias 11 (menú de año nuevo), 15 (eventos de terraza) y 25 (promociones) no
van a «otros»: cada código lleva su categoría. **Segunda tanda (24-nov ~15:50 CR):** la 9 Grupo C (mixta) y la 1 (borrada)
también son mixtas: sus 3 códigos de la historia llevan la suya (166 y 207 de la 9 → comida; el 1 de la 1 →
bebida). En total, **85 códigos** con categoría escrita. **La lista de 82 códigos quedó confirmada por el dueño el 24-nov**
(segunda ronda), con dos cambios sobre la propuesta (698 y 740 a comida) y el 192 a `menu_especial`.

| Familia | Códigos | `comida` | `bebida` | `menu_especial` | Líneas (comida / bebida / menú) | Unidades (comida / bebida / menú) |
|---|---|---|---|---|---|---|
| 11 | 39 | 18 | 20 | 1 | 194 / 65 / 22 | 235 / 86 / 48 |
| 15 | 7 | 4 | 3 | — | 43 / 16 / — | 46 / 19 / — |
| 25 | 36 | 2 | 34 | — | 2 / 1.538 / — | 3 / 2.183 / — |
| **Total** | **82** | **24** | **57** | **1** | **239 / 1.619 / 22** | **284 / 2.288 / 48** |

(Staging, solo lectura, 24-nov; sin nombres. La lista con nombre va al `PASE-198`.)

| Familia | `comida` | `bebida` | `menu_especial` |
|---|---|---|---|
| 11 | 124, 125, 373, 679, 680, 681, 682, 685, 686, 687, 688, 689, 691, 692, 693, 694, 698, 740 | 235, 238, 245, 643, 700, 701, 702, 714, 722, 727, 728, 738, 742, 743, 746, 747, 750, 753, 757, 758 | 192 |
| 15 | 304, 306, 577, 579 | 308, 312, 455 | — |
| 25 | 930, 934 | 5, 519, 559, 695, 843, 844, 860, 861, 862, 863, 864, 866, 867, 870, 871, 872, 879, 880, 881, 882, 917, 918, 921, 922, 925, 926, 1026, 1027, 1036, 1037, 1038, 1056, 1057, 1062 | — |

- **Cómo queda en la base:** los 82 códigos llevan su categoría escrita, uno por uno, en `pos_producto_ajustes`
  (la carga la 198; `actualizado_por` null = cargado por la migración). Así un cambio posterior en la familia no
  los mueve.
- **Un código nuevo de esas familias (decidido 24-nov, A-2 = A):** toma la categoría de la mayoría de su familia
  —**11 → comida, 15 → comida, 25 → bebida, 9 → comida, 1 → bebida**; en 7, 8 y 14, sin historia, `otros`— y aparece en «Catálogo» bajo el filtro «nuevos» para que alguien lo
  confirme. El menú del próximo 31-dic va a traer códigos nuevos: el ítem por comensal de ese menú hay que pasarlo
  a `menu_especial` a mano (va a entrar como comida).

#### 2.5.1 El menú cerrado: un ítem con plata y 38 pasos en ₡0

Verificado en prod (solo lectura, por el coordinador) y en staging: en la familia 11 **solo el 192 tiene monto**
(22 líneas, 48 unidades: se factura por comensal). Los otros 38 códigos van en **₡0**: son los pasos del menú
(18 platos y 20 tragos), cargados para que cocina y barra los vean. Esos 38 siguen en comida o en bebida **solo
para contar unidades**.

Eso pide una regla para las unidades en ₡0, que hoy no existe. Cuánto pesan (staging, facturas cerradas):

| Grupo | Unidades | De las cuales en ₡0 |
|---|---|---|
| Familia 5 (bebida de hoy), en salón | 72.581 | 118 (0,2 %) |
| Familias de comida de hoy | 135.603 | 473 (0,3 %) |
| Familia 11, sin el 192 | 321 | 321 (todas) |
| Familia 25 | 2.186 | 250 |
| Familia 15 | 65 | 0 |

**Lo que hace la 198:** `pos_ventas_productos` devuelve, por producto, las `unidades` (todas) y aparte las
`unidades_cero` (las de líneas con monto ₡0). No decide nada: deja el dato. **La regla, decidida por el dueño el
24-nov ~15:50 CR (B-1 = A):** solo cuentan las unidades vendidas; las de ₡0 van aparte como «incluidas». Se aplica
en la 3.2, que es donde se ven estos números (`catalogoPos.ts` ya la trae: `unidadesVendidas`, `precioPorItemCts`):

| Indicador | Regla propuesta | Por qué |
|---|---|---|
| **Precio por ítem** | Monto ÷ **unidades vendidas** (unidades − unidades en ₡0). Un producto con todas sus unidades en ₡0 no tiene precio: se muestra «incluido», no «₡0» | Un paso de menú no vale ₡0; meterlo baja el precio promedio de la categoría sin que nadie haya vendido más barato |
| **Bebidas por persona** | Solo **unidades vendidas** de categoría bebida (× «rinde») ÷ personas de salón. Las incluidas se muestran aparte («+ N incluidas en menú») | Es un indicador de venta: un trago incluido en un menú cerrado no lo vendió nadie. Si no, el 31-dic infla el número de todo el salón |
| **Popularidad** (ingeniería de menú y mix por unidades) | **Todas** las unidades servidas, con las en ₡0 señaladas | Mide qué sale de cocina y de barra |
| **Margen** (ingeniería de menú) | Los productos sin precio quedan fuera de los ejes de precio y margen | No tienen venta propia; su costo es del ítem por comensal (Inventario) |
| **Personas** | No cambia | El 192 se factura por comensal pero no es de la familia 19: las personas siguen saliendo del pax de la factura |
| **Venta neta** | No cambia | Una línea en ₡0 suma ₡0 |

- La regla es una sola para toda la carta, no un caso especial del menú de año nuevo: también alcanza a una
  invitación cargada en ₡0 dentro de una familia de venta.
- **Costo de aplicarla:** «bebidas por persona» de hoy baja un pelo por las 118 unidades en ₡0 de la familia 5
  (−0,2 % en toda la historia; 29 unidades, −0,1 %, en los últimos 12 meses). Es un cambio de un número que ya se
  mira: va como excepción firmada de la 3.2.

#### 2.5.2 Qué números se mueven, y cuáles no

| Número | ¿Se mueve? | Cuánto (staging, preliminar) |
|---|---|---|
| **Venta neta total**, por día, por canal, venta por persona, personas, cuenta promedio | **No.** La neta la decide la familia de la línea; estas tres familias ya eran venta y lo siguen siendo | — |
| Relación comida/bebida y participación en el mix | Sí: la plata de las familias 15 y 25 pasa de «otros» a comida y a bebida. La de la familia 11 pasa entera a `menu_especial` y **no** toca la relación comida/bebida | Menos del 1 % de la neta de toda la historia; menos del 0,3 % en los últimos 12 meses |
| **Bebidas por persona** | Sí, sube: suma las unidades de los códigos de bebida de 15 y 25 | Con la regla de unidades vendidas: +1.920 sobre 72.463 en salón en toda la historia (+2,6 %); +180 sobre 23.267 en los últimos 12 meses (+0,8 %). Contando también las incluidas: +2.218 (+3,1 %) y +183 (+0,8 %) |
| Popularidad e ingeniería de menú por categoría | Sí: esos productos entran en el grupo de comida o de bebida | 82 códigos en la historia; 18 con venta en los últimos 12 meses |
| El día 31-dic | Sí: aparece la línea `menu_especial`; con la regla de ₡0, comida, bebida y bebidas por persona de esa noche no se distorsionan | Se mide en el PASE |

- **Cuándo se mueven:** con la **3.2**, que es la que lee el catálogo nuevo. La 3.1 no cambia ninguna pantalla.
- **Se mide antes de la firma:** el `PASE-198` del PR 3.1a trae el antes y el después, en **prod** y en solo
  lectura, de comida, bebida, `menu_especial`, «otros» y bebidas por persona para el último mes cerrado, los
  últimos 12 meses y el último 31-dic. Si prod tiene códigos de esas familias que no están en la lista, salen en
  esa lectura.
- **Concentración:** un solo código de la familia 25 (el 519) tiene 1.151 de las 1.880 líneas; se vendió hasta
  may-2026.
- **Cambia una definición escrita:** §4.1 de la SPEC de Ventas v2 define hoy comida = familias {2, 3, 4, 13, 16,
  29} y bebida = familia {5}. Con D-3 pasan a ser «líneas de venta cuya categoría es comida / bebida». La tabla de
  §4.1 se actualiza en el PR de la 3.2, que es donde el número cambia, con su prueba de paridad.

## 3. Función `pos_ventas_productos`

```sql
public.pos_ventas_productos(p_local text, p_desde date, p_hasta date) returns jsonb
```

| Aspecto | Definición |
|---|---|
| Parámetros | `p_local`: slug del local (`locations.id`). `p_desde`, `p_hasta`: días de Costa Rica, inclusivos |
| Qué lee | Facturas `estado = 'C'` del local cuyo día CR de `fecha_registra` cae en el rango, y sus líneas |
| Validaciones | Rol fuera de gerencia → `42501` · manager de otro local → `42501` · nulos o rango invertido → `22023` · más de 731 días → `22023` |
| Volatilidad | `stable`: solo lectura; corre dentro de `begin read only` (regla 4) |
| Seguridad | `security definer` (las `pos_ndf_*` siguen cerradas; el rol se valida adentro con `get_my_role()`, que exige `is_active`) |
| `search_path` | `public, pg_temp` |
| Quién la llama | `execute` solo para `authenticated`; revocado a `public` y `anon`. Adentro: owner, contador y manager de sus locales |
| Devuelve | `jsonb`, no `setof`: el tope de filas de PostgREST cortaría un año sin avisar (igual que la 190 y la 193) |
| No devuelve | Medios de pago, vuelto, mesas, saloneros, `clase_ingreso`, números de factura (regla 6) |

**Forma del resultado:**

| Clave | Cada elemento | Para qué |
|---|---|---|
| `productos` | `[codigo, nombre, familia, canal, unidades, monto_cts, facturas, categoria, unidades_cero]` | El mix del período. Una fila por (código, familia de la línea, canal). `codigo` null = línea sin código, agrupada por nombre. `categoria` = la **categoría efectiva** de esas líneas (§2.2). `unidades_cero` = las unidades de líneas con monto ₡0 (§2.5.1); están incluidas en `unidades` |
| `meses` | `[mes 'AAAA-MM', familia, canal, unidades, monto_cts, categoria]` | El gráfico de 12 meses por categoría (D5) con un solo pedido. Una fila por (mes, familia, canal, categoría efectiva) |
| `catalogo` | `[codigo, nombre, familia, rinde, visto_desde, visto_hasta, categoria]` | Nombre y familia vigentes, «rinde» y categoría vigente. Trae lo vendido en el período más lo visto desde 90 días antes de `p_desde` (para «Sin ventas en el período») |
| `familias` | `[familia, nombre, categoria, orden]` | Rótulos, orden y la categoría por defecto de la familia |
| `sin_lineas` | `{facturas, cts}` | Facturas sin ninguna línea guardada: su `valor_servido_crc`, aparte |
| `neta_cts` | número | Σ `monto_cts` de las líneas con familia null o fuera de {6, 17, 20}, más `sin_lineas.cts` |

**Reglas (las mismas de la 190; las cuida la batería):**

- `monto_cts` = Σ por línea de `floor(monto × 100 + 0,5)`: céntimos enteros.
- `unidades` = Σ por línea de `floor(cantidad + 0,5)` (el `Math.round` de la app). Vienen **todas** las familias,
  también las que no son venta; la pantalla decide qué muestra.
- **La categoría efectiva** la calcula `pos_categoria_efectiva`, la misma para `productos`, `meses` y `catalogo`:
  línea de las familias 6, 17 o 20 → `cortesia` / `personal` / `ingredientes`, siempre · familia de categoría
  `giftcard`, `pax` o `duenos` → esa · si no, la que una persona cargó para el código · si no, la de la familia ·
  si no, `otros`. Los valores nuevos van **al final** de cada arreglo: lo que ya leía una posición la sigue leyendo.
- **`neta_cts` no mira categorías.** Y cierra por los dos lados: Σ `monto_cts` de las filas de `productos` cuya
  categoría no es `cortesia`, `personal` ni `ingredientes`, más `sin_lineas.cts`, da `neta_cts` al céntimo.
- **La plata sigue a la familia de la línea,** no a la del catálogo. Si un código cambió de familia, en el período
  aparece una fila por familia; la pantalla lo muestra una sola vez, en su familia vigente. Así
  **`neta_cts` = Σ `dias[].neta_cts` de `pos_ventas_resumen` para el mismo local y rango, al céntimo**: «Productos»
  cierra contra «Resumen».
- El nombre de `productos` es el de las líneas del período; el que se muestra es el de `catalogo` (el vigente).
- Tres bases de comparación = tres llamados en paralelo (período y dos bases): dentro del tope de 3 pedidos.

**Lo que no trae, a propósito:** la dimensión salonero (la ficha del salonero sigue con su lector) y el día (el
detalle por día está en «Resumen»). Si la 3.2 los necesita, es una función hermana, no un cambio de esta.

### 3.1 Función `pos_catalogo_productos` (para «Ajustes → Catálogo»)

```sql
public.pos_catalogo_productos(p_local text) returns jsonb
```

La pantalla de Ajustes necesita **todo** el catálogo del local, no solo lo vendido en un período, y sin el tope de
filas de PostgREST (hoy son 704 productos; con mil ya cortaría sin avisar). Solo lectura, `stable`,
`security definer`; owner y contador, y el manager solo en sus locales; el resto `42501`.

| Clave | Cada elemento |
|---|---|
| `productos` | `[codigo, nombre, familia, categoria, categoria_propia, rinde, visto_desde, visto_hasta]`. `categoria` = la vigente; `categoria_propia` = la que cargó una persona (null = la de su familia) |
| `familias` | `[familia, nombre, categoria, orden]` |
| `categorias_editables` | `['comida', 'bebida', 'menu_especial', 'extras', 'merch', 'otros']`: lo que una persona puede elegir |
| `categorias_fijas` | Las seis que fija la familia: la pantalla muestra esos productos con la categoría bloqueada |

Las dos listas viajan con la respuesta para que la pantalla no guarde otra copia. Cuando llegue la 3.1c, la
subcategoría se suma al final de cada arreglo.

## 4. Tablas

### 4.1 `pos_familias` — familias del PoS por local

| Columna | Tipo | Nota |
|---|---|---|
| `local` | `text not null` | Slug del local |
| `familia` | `integer not null` | Número de la familia en el PoS |
| `nombre` | `text not null` | Sin espacios sobrantes, no vacío |
| `categoria` | `text not null` | Una de las 12 de §2.2 (`check`). Es la categoría **por defecto** de los productos de la familia. Otro `check`: es `cortesia`, `personal` o `ingredientes` **si y solo si** la familia es 17, 6 o 20 |
| `orden` | `integer not null default 999` | Orden dentro de la categoría |

Clave primaria `(local, familia)`. Sin más índices (son unas 20 filas por local).

### 4.2 `pos_productos` — el catálogo por código

| Columna | Tipo | Nota |
|---|---|---|
| `local` | `text not null` | Cada local tiene su PoS y su numeración |
| `codigo` | `text not null` | Sin espacios, no vacío, hasta 40 caracteres. Texto, como llega |
| `nombre` | `text not null` | El de la factura más reciente que lo trae |
| `familia` | `integer` | La de esa misma factura. Null si el PoS no la manda |
| `visto_desde`, `visto_hasta` | `date not null` | Día CR de la primera y la última factura (en cualquier estado) que lo trae |
| `actualizado_en` | `timestamptz not null` | Última vez que cambió la fila |

Clave primaria `(local, codigo)`. Índice `(local, familia)` para listar por familia. Sin clave foránea a
`pos_familias`: una familia desconocida no puede impedir que el producto se registre. Sin clave foránea a
`locations`, igual que `pos_ndf_*` y `pos_mesas_internas`.

Un producto **nunca se borra**: si deja de venderse, `visto_hasta` queda quieto y la pantalla lo trata como
inactivo.

### 4.3 `pos_producto_ajustes` — lo que carga una persona

| Columna | Tipo | Nota |
|---|---|---|
| `local`, `codigo` | `text not null` | Clave primaria y clave foránea a `pos_productos` |
| `rinde_personas` | `integer not null default 1` | Entre 1 y 20 (`check`) |
| `categoria` | `text` | Null = la de su familia. Si no, una de `comida`, `bebida`, `menu_especial`, `extras`, `merch`, `otros` (`check`). **Nunca** una categoría que no es venta |
| `actualizado_en` | `timestamptz not null` | |
| `actualizado_por` | `uuid` | `auth.uid()` de quien lo guardó; null = cargado por la migración |

Un `check` más: no hay filas vacías (rinde 1 y sin categoría = no hay fila).

**Esto es esquema nuevo respecto de la primera versión de la spec** (una columna, dos `check`, una categoría y
dos funciones más): entra en la misma 198 y en la misma firma (D-9).

**RLS de las tres:** activada. Una sola política por tabla, de **lectura**: owner y contador activos, y el manager
solo en sus locales (`puede_ver_local`). **Ninguna política de escritura** y sin permisos de `insert`, `update` ni
`delete` para la API: el catálogo lo escribe el disparador y el ajuste, la función. `anon` no tiene nada.

### 4.4 Cómo se refresca el catálogo: disparador

**Decidido 24-nov (D-8 = A):** un disparador `after insert … for each statement` en `pos_ndf_ticket_lines`, con tabla de transición.
La ingesta (`pos_ndf_ingest`, migración 082) inserta las líneas de un lote en una sola sentencia, así que el
disparador corre **una vez por lote**, no por línea. Llama a `pos_catalogo_absorber`, que es la única definición de
la regla; `pos_catalogo_refrescar(p_local)` aplica la misma sobre toda la historia (carga inicial y reparación).

| Opción | A favor | En contra | Veredicto |
|---|---|---|---|
| **Disparador** | El producto nuevo aparece con su primera factura, sin demora. Un solo objeto, igual en staging y en prod. Se prueba en una transacción descartada | Corre en el camino de la ingesta, que es evidencia de plata | **Elegido,** con las tres protecciones de abajo |
| Cron | No toca la ingesta | Demora hasta la próxima corrida. Es un objeto más que hay que agendar y vigilar por base: el proyecto ya tiene tres jobs con cuidado manual (el 4 «no volver a aplicar», el 8 «repetir la verificación», y la 189 omitida en staging por agendar con la URL de prod) | Descartado |
| Dentro de la función de lectura | Sin disparador ni cron | La lectura pasaría a escribir: deja de ser `stable`, no corre en `begin read only` (la forma de probar permisos, regla 4), y un contador que mira un reporte dispararía escrituras con permisos del dueño de la función | Descartado |

**Las tres protecciones del disparador:**

1. **Nunca frena la ingesta.** El llamado va en un bloque que captura cualquier error y lo deja como `WARNING` en
   el log de Postgres: la factura entra igual. Probado rompiendo la función a propósito (§8.1).
2. **Casi nunca escribe.** Solo inserta o actualiza si hay algo nuevo: código nuevo, otro nombre, otra familia, o un
   día fuera de `[visto_desde, visto_hasta]`. En un día normal es **una escritura por producto vendido ese día**,
   no una por línea.
3. **La lectura no depende de él.** `pos_ventas_productos` suma desde las líneas. Si el catálogo se atrasara, la
   plata, las unidades y la categoría salen igual; solo faltaría el nombre vigente de ese código, y
   `pos_catalogo_refrescar` lo repara sin perder nada.

**Reglas de `pos_catalogo_absorber`:**

- Registra el producto de **cualquier** factura (cerrada, provisional o anulada): si el PoS lo facturó, existe.
- **Nombre y familia: gana la factura más reciente** por `fecha_registra`, no la última en llegar. Reingestar una
  factura vieja (backfill) no pisa el nombre actual.
- Línea sin código o con código de más de 40 caracteres: no entra al catálogo; su venta sale igual en
  `productos` con `codigo` null.
- El código se guarda sin espacios a los costados; no se le quitan ceros a la izquierda (`'012'` y `'12'` serían
  dos productos, como en el PoS).

## 5. Permisos: qué ve cada rol

| Objeto | owner | manager | contador | Personal (salonero, cajero, barra, cocina) | `anon` |
|---|---|---|---|---|---|
| `pos_ndf_*` (sin cambios) | Lee | Lee | Lee | No | No |
| `pos_ventas_productos` | Todos los locales | Solo sus locales | Todos los locales | `42501` | Sin `execute` |
| `pos_familias`, `pos_productos`, `pos_producto_ajustes` (lectura directa) | Sí | Solo sus locales | Sí | 0 filas | Sin permiso |
| `pos_catalogo_productos` | Todos los locales | Solo sus locales | Todos los locales | `42501` | Sin `execute` |
| `pos_producto_ajuste_guardar` («rinde» y categoría) | Sí | Solo sus locales | `42501` | `42501` | Sin `execute` |
| `pos_catalogo_refrescar`, `pos_catalogo_absorber`, `pos_categoria_efectiva` | No (uso interno) | No | No | No | No |
| Escribir las tablas por la API | No | No | No | No | No |

- `pos_ndf_*` **siguen cerradas a gerencia** (regla 6 de `ESTADO.md`): la 198 no les cambia ninguna política;
  solo les suma el disparador.
- Las funciones nuevas **nacen** limitando al manager a su local (como la 193). La deuda de la 067, la 080 y la
  190 sigue aparte (backlog, con firma).
- **Decidido 24-nov (D-7 = A):** «rinde» y categoría los editan el dueño y el encargado **de su
  local**; el contador no edita (lo ve en los reportes). El encargado no puede leer ni tocar el catálogo de otro
  local: lo cuidan la función y la política de lectura, cada una con su prueba.
- **El personal no lee el catálogo nuevo.** Mi Rendimiento sigue como hoy: `product_map` (lectura para todo rol
  activo, migración 093) y la función de la 194, que cruza por nombre. Se pasa al catálogo por código en la 3.6,
  con otra migración firmada (§10).
- Las pantallas siguen el reparto de §6 de la SPEC de Ventas v2: sin cambios, salvo que «Ajustes — productos» pasa
  a llamarse «Ajustes — catálogo», con los mismos roles.

## 6. Migración PROPUESTA `198_pos_catalogo_productos.sql`

> **El archivo vive en el PR 3.1a (#357)** (`supabase/migrations/198_pos_catalogo_productos.sql`); este bloque es su
> copia al 24-nov tarde. **Número: 198.** Era la 196, pero la 197 entró antes a prod por Branching (#359, ledger
> prod = 197) y una versión menor que la última aplicada ya no entra: se renumeró en el mismo PR (archivo, vuelta
> atrás, pruebas, lecturas, PASE, registro y ESTADO). Si al mergear la 198 ya está tomada, se renumera otra vez al
> siguiente libre del bloque 150–199.
>
> **Qué trae (versión del 24-nov, con las decisiones):** 3 tablas, 1 disparador en `pos_ndf_ticket_lines`,
> 7 funciones, la carga de las 29 familias de Santa Teresa (nombres leídos por el dueño en la PC del PoS el 24-nov
> 15:43 CR; todos cargados), la herencia de
> «rinde» y la categoría de los 85 códigos de las familias mixtas (§2.5). **Sin subcategoría** (va en la 3.1c, §11). El bloque de abajo es **el mismo texto** que se corrió en el Postgres
> local (§8.1).

```sql
-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 198 · Ventas v2 3.1: catálogo único por código desde el PoS + `pos_ventas_productos`   ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- PR 3.1a (SPEC docs/ventas/SPEC-3.1-catalogo.md §6, PR #350). Entra a prod por merge → Branching, SOLO con la firma
-- del dueño (D-9) sobre el SHA del PR y con los nombres de familia leídos en la PC del PoS (docs/pases/PASE-198.md).
-- D8 (catálogo único por código), D17 (el catálogo sale del PoS) y las decisiones del 24-nov: D-2 = C (categoría
-- por código en la app), D-3 (las familias mixtas 1, 9, 11, 15 y 25 van a comida o bebida, código por código) y la categoría
-- `menu_especial` (el ítem por comensal de un menú cerrado). La SUBCATEGORÍA no entra acá: viene del PoS (3.1c).
--
-- Agrega (no reemplaza nada vivo; por eso no lleva guarda de md5, R13):
--   1. `pos_familias`          (local, familia)  → nombre de la familia del PoS y su categoría POR DEFECTO.
--   2. `pos_productos`         (local, codigo)   → nombre y familia vigentes de cada producto visto en facturas.
--   3. `pos_producto_ajustes`  (local, codigo)   → lo que carga una persona: `rinde_personas` (1 a 20) y `categoria`
--      (null = la de su familia).
--   4. `pos_catalogo_absorber` + disparador en `pos_ndf_ticket_lines` (AFTER INSERT, por sentencia): mantiene 2.
--      Nunca frena la ingesta: si falla, avisa (WARNING) y la factura entra igual.
--   5. `pos_catalogo_refrescar(p_local)`: la misma regla sobre toda la historia (carga inicial y reparación).
--   6. `pos_categoria_efectiva(familia de la línea, categoría de la familia, categoría del código)`: la ÚNICA
--      definición de qué categoría le toca a una línea.
--   7. `pos_ventas_productos(p_local, p_desde, p_hasta)` → jsonb de SOLO LECTURA para «Productos».
--   8. `pos_catalogo_productos(p_local)` → jsonb de SOLO LECTURA: el catálogo entero, para «Ajustes → Catálogo».
--   9. `pos_producto_ajuste_guardar(p_local, p_codigo, p_rinde, p_categoria)`: la única puerta de escritura de 3.
--
-- LA CATEGORÍA NUNCA DECIDE LA VENTA. Qué plata es venta lo decide SOLO la familia de la línea (fuera: 6, 17 y 20,
-- `FAMILIAS_NO_VENTA`, firmada). La categoría por código solo reparte lo que YA es venta entre comida, bebida y las
-- demás: no puede sacar ni meter un producto de la venta neta. Lo cuidan tres cosas: el `check` de 3 (una persona
-- no puede guardar `cortesia`, `personal` ni `ingredientes`), la función de 9 y `pos_categoria_efectiva`.
--
-- NO toca `pos_ndf_*` (salvo sumar el disparador), `product_map`, la 067, la 190, la 193 ni la 194.
-- NO devuelve medios de pago, mesas, saloneros ni `clase_ingreso` (regla 6 de ESTADO).
-- Vuelta atrás: scripts/sql/198_rollback.sql. Pruebas: scripts/sql/198_pruebas.sql (terminan en ROLLBACK).

-- ── 0. Guarda: si algo de esto ya existe, se para sin tocar nada ─────────────────────────
do $guarda198$
declare
  o text;
begin
  if to_regprocedure('public.puede_ver_local(text)') is null or to_regprocedure('public.get_my_role()') is null then
    raise exception '198: falta puede_ver_local (091) o get_my_role';
  end if;
  foreach o in array array['public.pos_familias', 'public.pos_productos', 'public.pos_producto_ajustes'] loop
    if to_regclass(o) is not null then
      raise exception '198: % ya existe: se para sin tocar nada', o;
    end if;
  end loop;
  foreach o in array array['public.pos_catalogo_absorber(uuid[])', 'public.pos_catalogo_registrar()',
                           'public.pos_catalogo_refrescar(text)', 'public.pos_categoria_efectiva(integer,text,text)',
                           'public.pos_ventas_productos(text,date,date)', 'public.pos_catalogo_productos(text)',
                           'public.pos_producto_ajuste_guardar(text,text,integer,text)'] loop
    if to_regprocedure(o) is not null then
      raise exception '198: % ya existe: se para sin tocar nada', o;
    end if;
  end loop;
end
$guarda198$;

-- ── 1. Familias del PoS por local ────────────────────────────────────────────────────────
create table public.pos_familias (
  local     text    not null,
  familia   integer not null,
  nombre    text    not null check (nombre = btrim(nombre) and nombre <> ''),
  categoria text    not null check (categoria in ('comida', 'bebida', 'menu_especial', 'extras', 'otros', 'merch',
                                                  'giftcard', 'pax', 'duenos', 'cortesia', 'personal',
                                                  'ingredientes')),
  orden     integer not null default 999,
  primary key (local, familia),
  -- Fuera de la venta = familias 6, 17 y 20, ni una más ni una menos (FAMILIAS_NO_VENTA, firmada).
  constraint pos_familias_no_venta_chk
    check ((familia in (6, 17, 20)) = (categoria in ('cortesia', 'personal', 'ingredientes')))
);
comment on table public.pos_familias is
  'Mig 198. Familias del PoS (FAC_Clasificaciones) por local: nombre y categoría por defecto de sus productos. La carga la migración; nadie la edita desde la app. Una familia sin fila se muestra «Familia N» en «otros».';

-- ── 2. Catálogo por código ───────────────────────────────────────────────────────────────
create table public.pos_productos (
  local          text        not null,
  codigo         text        not null check (codigo = btrim(codigo) and codigo <> '' and length(codigo) <= 40),
  nombre         text        not null check (nombre <> ''),
  familia        integer,
  visto_desde    date        not null,
  visto_hasta    date        not null,
  actualizado_en timestamptz not null default now(),
  primary key (local, codigo),
  check (visto_desde <= visto_hasta)
);
create index pos_productos_local_familia_idx on public.pos_productos (local, familia);
comment on table public.pos_productos is
  'Mig 198. Catálogo único por (local, código) del PoS. Lo escribe SOLO el disparador de pos_ndf_ticket_lines (y pos_catalogo_refrescar). Nombre y familia = los de la factura más reciente. visto_* = día CR de la primera y la última factura (cualquier estado) que lo trae.';

-- ── 3. Lo que carga una persona, por código ──────────────────────────────────────────────
-- Sin fila = todo por defecto: rinde 1 y la categoría de su familia.
create table public.pos_producto_ajustes (
  local           text        not null,
  codigo          text        not null,
  rinde_personas  integer     not null default 1 check (rinde_personas between 1 and 20),
  -- null = la de su familia. Una persona solo elige entre categorías que SON venta y no tienen otra regla
  -- colgada: nunca `cortesia`, `personal` ni `ingredientes` (fuera de la venta), ni `giftcard`, `pax` o `duenos`.
  categoria       text        check (categoria in ('comida', 'bebida', 'menu_especial', 'extras', 'merch', 'otros')),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid,
  primary key (local, codigo),
  foreign key (local, codigo) references public.pos_productos (local, codigo),
  constraint pos_producto_ajustes_algo_chk check (rinde_personas > 1 or categoria is not null)
);
comment on table public.pos_producto_ajustes is
  'Mig 198. Lo que una persona carga por producto: cuántas personas rinde (1 a 20) y la categoría si no es la de su familia (null = hereda). Sin fila = todo por defecto. Se escribe solo por pos_producto_ajuste_guardar (owner; manager de su local). La categoría nunca cambia qué es venta neta.';

-- ── RLS: gerencia activa lee; el manager, solo sus locales; nadie escribe por la API ─────
alter table public.pos_familias         enable row level security;
alter table public.pos_productos        enable row level security;
alter table public.pos_producto_ajustes enable row level security;

create policy pos_familias_leer on public.pos_familias
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador')
         or ((select public.get_my_role()) = 'manager' and public.puede_ver_local(local)));
create policy pos_productos_leer on public.pos_productos
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador')
         or ((select public.get_my_role()) = 'manager' and public.puede_ver_local(local)));
create policy pos_producto_ajustes_leer on public.pos_producto_ajustes
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador')
         or ((select public.get_my_role()) = 'manager' and public.puede_ver_local(local)));

revoke all on table public.pos_familias, public.pos_productos, public.pos_producto_ajustes from public, anon, authenticated;
grant select on table public.pos_familias, public.pos_productos, public.pos_producto_ajustes to authenticated;

-- ── 4. La regla del catálogo, en un solo lugar ───────────────────────────────────────────
-- De las líneas de esas facturas: por (local, código) → nombre y familia de la factura MÁS RECIENTE y el
-- primer y último día CR. Solo escribe si hay algo nuevo (código nuevo, otro nombre, otra familia o un día
-- fuera de [visto_desde, visto_hasta]): en un día normal, una escritura por producto.
create function public.pos_catalogo_absorber(p_ticket_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_n integer;
begin
  with n as (
    select t.local, btrim(l.codigo_producto) as codigo,
           coalesce(nullif(btrim(l.nombre), ''), btrim(l.codigo_producto)) as nombre,
           l.familia, t.fecha_registra,
           (t.fecha_registra at time zone 'America/Costa_Rica')::date as dia
    from public.pos_ndf_tickets t
    join public.pos_ndf_ticket_lines l on l.ticket_id = t.id
    where t.id = any (p_ticket_ids)
      and nullif(btrim(l.codigo_producto), '') is not null
      and length(btrim(l.codigo_producto)) <= 40
  ),
  a as (
    select local, codigo, min(dia) as desde, max(dia) as hasta from n group by local, codigo
  ),
  u as (
    select distinct on (local, codigo) local, codigo, nombre, familia
    from n
    order by local, codigo, fecha_registra desc, nombre, familia
  )
  insert into public.pos_productos as p (local, codigo, nombre, familia, visto_desde, visto_hasta)
  select a.local, a.codigo, u.nombre, u.familia, a.desde, a.hasta
  from a join u using (local, codigo)
  where not exists (select 1 from public.pos_productos q
                    where q.local = a.local and q.codigo = a.codigo
                      and q.nombre = u.nombre and q.familia is not distinct from u.familia
                      and q.visto_desde <= a.desde and q.visto_hasta >= a.hasta)
  on conflict (local, codigo) do update set
    nombre         = case when excluded.visto_hasta >= p.visto_hasta then excluded.nombre  else p.nombre  end,
    familia        = case when excluded.visto_hasta >= p.visto_hasta then excluded.familia else p.familia end,
    visto_desde    = least(p.visto_desde, excluded.visto_desde),
    visto_hasta    = greatest(p.visto_hasta, excluded.visto_hasta),
    actualizado_en = now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.pos_catalogo_absorber(uuid[]) from public, anon, authenticated;
grant execute on function public.pos_catalogo_absorber(uuid[]) to service_role;

-- El disparador: por sentencia (un llamado por lote de la ingesta, no por línea). Si el catálogo falla,
-- la factura entra igual: el catálogo es derivado y `pos_catalogo_refrescar` lo repara.
create function public.pos_catalogo_registrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  begin
    perform public.pos_catalogo_absorber(array(select distinct ticket_id from nuevas));
  exception when others then
    raise warning '198 pos_catalogo_registrar: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$function$;
revoke all on function public.pos_catalogo_registrar() from public, anon, authenticated;

create trigger trg_pos_catalogo_registrar
  after insert on public.pos_ndf_ticket_lines
  referencing new table as nuevas
  for each statement execute function public.pos_catalogo_registrar();

-- ── 5. Carga inicial y reparación ────────────────────────────────────────────────────────
create function public.pos_catalogo_refrescar(p_local text)
returns integer
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.pos_catalogo_absorber(array(select t.id from public.pos_ndf_tickets t where t.local = p_local))
$$;
revoke all on function public.pos_catalogo_refrescar(text) from public, anon, authenticated;
grant execute on function public.pos_catalogo_refrescar(text) to service_role;

select x.local, public.pos_catalogo_refrescar(x.local) as productos
from (select distinct local from public.pos_ndf_tickets) x;

-- Familias de santa-teresa: las 29 del PoS (`FAC_Clasificaciones`, leídas por el dueño el 24-nov 15:43 CR), menos las
-- que no existen. Nombres como están en el PoS. La 1 NO existe en el PoS: sus códigos vienen de una clasificación
-- borrada y se cargan con un rótulo propio. Ningún nombre puede quedar «POR CONFIRMAR» (lo frena una prueba del gate).
-- Categoría (decisiones del dueño, 24-nov ~15:50 CR): la que ya usan las cuentas firmadas (comida 2,3,4,13,16,29 ·
-- bebida 5 · fuera de la venta 6, 17 y 20) · 18 → bebida · 10 → merch · 17 → regalías (`cortesia`: no es venta,
-- fijada por la familia) · 6 → consumo del personal (`personal`: aparte, fuera de la venta neta de carta) · 20 sin
-- ventas. MIXTAS, categoría por código (D-3 y A-2): 1, 9, 11, 15 y 25 llevan acá la categoría de un código NUEVO
-- (la de la mayoría de sus líneas) y sus códigos de hoy la suya, uno por uno, más abajo. 7, 8 y 14 también van por
-- código, pero hoy no tienen ninguna venta: un código nuevo entra en `otros` hasta que alguien le ponga la suya.
insert into public.pos_familias (local, familia, nombre, categoria, orden) values
  ('santa-teresa',  2, 'TAPAS ASIATICAS',          'comida',       10),
  ('santa-teresa',  3, 'SUSHI ROLLS',              'comida',       20),
  ('santa-teresa', 16, 'POKES BOWLS CEVICHES',     'comida',       30),
  ('santa-teresa', 13, 'KIDS MENU',                'comida',       40),
  ('santa-teresa',  4, 'POSTRES',                  'comida',       50),
  ('santa-teresa', 29, 'GREENSEASON',              'comida',       60),
  ('santa-teresa', 11, 'MENU AÑO NUEVO',           'comida',       70),  -- mixta, por código
  ('santa-teresa', 15, 'EVENTOS TERRAZA',          'comida',       80),  -- mixta, por código
  ('santa-teresa',  9, 'Grupo C (mixta)',          'comida',       90),  -- mixta, por código · rótulo neutro (nombre real: Ajustes → Catálogo)
  ('santa-teresa',  5, 'BEBIDAS',                  'bebida',       10),
  ('santa-teresa', 18, 'Y HAPPY HOUR',             'bebida',       20),
  ('santa-teresa', 25, 'PROMOCIONES',              'bebida',       30),  -- mixta, por código (mismo nombre que la 14)
  ('santa-teresa',  1, '(clasificación borrada)',  'bebida',       40),  -- no existe en el PoS · por código
  ('santa-teresa', 22, 'EXTRAS',                   'extras',       10),
  ('santa-teresa',  7, 'Grupo A (surf)',           'otros',        10),  -- por código · rótulo neutro
  ('santa-teresa',  8, 'Grupo B (surf)',           'otros',        20),  -- por código · rótulo neutro
  ('santa-teresa', 14, 'PROMOCIONES',              'otros',        30),  -- por código
  ('santa-teresa', 21, 'TSHIRTS',                  'merch',        10),
  ('santa-teresa', 23, 'T-GORRAS',                 'merch',        20),
  ('santa-teresa', 24, 'T-DARUMAS',                'merch',        30),
  ('santa-teresa', 26, 'T-STICKERS',               'merch',        40),
  ('santa-teresa', 10, 'REMERAS',                  'merch',        50),
  ('santa-teresa', 27, 'T-XABANICOS',              'merch',        60),
  ('santa-teresa', 12, 'GIFT CARDS',               'giftcard',     10),
  ('santa-teresa', 19, 'A PAX',                    'pax',          10),
  ('santa-teresa', 28, 'XX DUEÑOS',                'duenos',       10),
  ('santa-teresa', 17, 'X CORTESIAS',              'cortesia',     10),
  ('santa-teresa',  6, 'PERSONAL',                 'personal',     10),
  ('santa-teresa', 20, 'Ingredientes',             'ingredientes', 10);

-- Lo que ya estaba decidido, por código, en UNA sola carga:
--   · «rinde»   = `product_map.multiplicador` ≥ 2 (tope 20), cruzando por nombre sin mirar mayúsculas ni espacios.
--     Si varios códigos comparten el nombre, heredan todos (es lo que hoy pasa al cruzar por nombre). Dos filas
--     de product_map que solo difieren en mayúsculas: gana el mayor.
--   · categoría = SOLO los códigos de las familias mixtas de santa-teresa: los 82 de 11, 15 y 25 (D-3, lista
--     confirmada por el dueño el 24-nov), comida o bebida uno por uno y el 192 (ítem por comensal del menú cerrado)
--     a `menu_especial`; los 2 de la 9 Grupo C (mixta) (comida) y el 1 de la 1 borrada (bebida), los únicos que hay en
--     staging y en prod (lectura del 24-nov). Solo se aplica si el código sigue en esas familias.
-- `product_map.subclasificacion` NO se hereda: la subcategoría viene del PoS (3.1c).
with pm as (
  select upper(btrim(nombre)) as nom, max(least(multiplicador, 20)) as rinde
  from public.product_map
  where multiplicador >= 2
  group by 1
),
cc as (
  select 'santa-teresa'::text as local, 'comida'::text as categoria, unnest(array[
    '124', '125', '373', '679', '680', '681', '682', '685', '686', '687', '688', '689', '691', '692', '693', '694', '698',
    '740',
    '304', '306', '577', '579',
    '930', '934',
    '166', '207']) as codigo
  union all
  select 'santa-teresa', 'bebida', unnest(array[
    '235', '238', '245', '643', '700', '701', '702', '714', '722', '727', '728', '738', '742', '743', '746', '747', '750',
    '753', '757', '758',
    '308', '312', '455',
    '5', '519', '559', '695', '843', '844', '860', '861', '862', '863', '864', '866', '867', '870', '871', '872', '879',
    '880', '881', '882', '917', '918', '921', '922', '925', '926', '1026', '1027', '1036', '1037', '1038', '1056',
    '1057', '1062',
    '1'])
  union all
  select 'santa-teresa', 'menu_especial', '192'
)
insert into public.pos_producto_ajustes (local, codigo, rinde_personas, categoria, actualizado_por)
select p.local, p.codigo, coalesce(pm.rinde, 1), cc.categoria, null
from public.pos_productos p
left join pm on pm.nom = upper(btrim(p.nombre))
left join cc on cc.local = p.local and cc.codigo = p.codigo and p.familia in (1, 9, 11, 15, 25)
where pm.rinde is not null or cc.categoria is not null;

-- ── 6. La categoría que le toca a una línea: UNA sola definición ─────────────────────────
-- 1.º La familia de la línea manda sobre lo que NO es venta (6, 17, 20): ahí ninguna categoría por código opina.
-- 2.º `giftcard`, `pax` y `duenos` las fija la familia (tienen sus propias cuentas).
-- 3.º Si no, la del código (si una persona la cargó); si no, la de la familia; si no, «otros».
create function public.pos_categoria_efectiva(p_familia integer, p_de_familia text, p_de_codigo text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_familia = 17 then 'cortesia'
    when p_familia = 6  then 'personal'
    when p_familia = 20 then 'ingredientes'
    when p_de_familia in ('giftcard', 'pax', 'duenos') then p_de_familia
    else coalesce(p_de_codigo, p_de_familia, 'otros')
  end
$$;
revoke all on function public.pos_categoria_efectiva(integer, text, text) from public, anon, authenticated;

-- ── 7. Ventas por producto (solo lectura) ────────────────────────────────────────────────
create function public.pos_ventas_productos(p_local text, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rol public.user_role := public.get_my_role();
  v_out jsonb;
begin
  if v_rol is null or v_rol not in ('owner', 'manager', 'contador') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_local is null or p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Parámetros inválidos' using errcode = '22023';
  end if;
  if p_hasta - p_desde > 730 then
    raise exception 'El rango no puede pasar de 731 días' using errcode = '22023';
  end if;
  if v_rol = 'manager' and not public.puede_ver_local(p_local) then
    raise exception 'No autorizado para este local' using errcode = '42501';
  end if;

  with t as materialized (
    -- Facturas C cuyo día CR cae en [desde, hasta] (Costa Rica no cambia la hora: el corte es exacto).
    select tk.id, tk.canal, tk.valor_servido_crc,
           (tk.fecha_registra at time zone 'America/Costa_Rica')::date as dia
    from public.pos_ndf_tickets tk
    where tk.local = p_local
      and tk.estado = 'C'
      and tk.fecha_registra >= (p_desde::timestamp at time zone 'America/Costa_Rica')
      and tk.fecha_registra <  ((p_hasta + 1)::timestamp at time zone 'America/Costa_Rica')
  ),
  l as materialized (
    select t.id as ticket_id, t.canal, t.dia,
           nullif(btrim(ln.codigo_producto), '') as codigo,
           nullif(btrim(ln.nombre), '')          as nombre,
           ln.familia,
           floor(coalesce(ln.cantidad, 0) + 0.5)        as unidades,   -- Math.round de la app, por línea
           floor(coalesce(ln.monto, 0) * 100 + 0.5)     as monto_cts   -- céntimos enteros, como la 190
    from t join public.pos_ndf_ticket_lines ln on ln.ticket_id = t.id
  ),
  pr0 as (
    -- La plata sigue a la familia DE LA LÍNEA (así cierra contra la neta de la 190 al céntimo).
    select l.codigo, max(l.nombre) as nombre, l.familia, l.canal,
           sum(l.unidades) as unidades, sum(l.monto_cts) as monto_cts, count(distinct l.ticket_id) as facturas,
           -- Unidades de líneas en ₡0 (pasos de un menú cerrado, invitaciones): se sirvieron, no se vendieron.
           coalesce(sum(l.unidades) filter (where l.monto_cts = 0), 0) as unidades_cero
    from l
    group by l.codigo, case when l.codigo is null then upper(coalesce(l.nombre, '')) end, l.familia, l.canal
  ),
  pr as (
    -- La categoría se resuelve sobre lo ya sumado (cientos de filas, no cientos de miles de líneas).
    select pr0.*, public.pos_categoria_efectiva(pr0.familia, f.categoria, a.categoria) as categoria
    from pr0
    left join public.pos_familias f on f.local = p_local and f.familia = pr0.familia
    left join public.pos_producto_ajustes a on a.local = p_local and a.codigo = pr0.codigo
  ),
  ms0 as (
    select to_char(l.dia, 'YYYY-MM') as mes, l.codigo, l.familia, l.canal,
           sum(l.unidades) as unidades, sum(l.monto_cts) as monto_cts
    from l group by 1, 2, 3, 4
  ),
  ms as (
    select ms0.mes, ms0.familia, ms0.canal,
           public.pos_categoria_efectiva(ms0.familia, f.categoria, a.categoria) as categoria,
           sum(ms0.unidades) as unidades, sum(ms0.monto_cts) as monto_cts
    from ms0
    left join public.pos_familias f on f.local = p_local and f.familia = ms0.familia
    left join public.pos_producto_ajustes a on a.local = p_local and a.codigo = ms0.codigo
    group by 1, 2, 3, 4
  ),
  sl as (
    -- Facturas sin ninguna línea guardada: la 190 cuenta su `valor_servido_crc`. Acá van aparte.
    select count(*) as facturas, coalesce(sum(floor(coalesce(t.valor_servido_crc, 0) * 100 + 0.5)), 0) as cts
    from t where not exists (select 1 from l where l.ticket_id = t.id)
  ),
  cat as (
    -- El catálogo que la pantalla necesita: lo vendido en el período + lo visto desde 90 días antes.
    -- Acá la categoría es la del producto HOY (por su familia vigente); la de `productos` es la de cada línea.
    select p.codigo, p.nombre, p.familia, coalesce(a.rinde_personas, 1) as rinde, p.visto_desde, p.visto_hasta,
           public.pos_categoria_efectiva(p.familia, f.categoria, a.categoria) as categoria
    from public.pos_productos p
    left join public.pos_producto_ajustes a on a.local = p.local and a.codigo = p.codigo
    left join public.pos_familias f on f.local = p.local and f.familia = p.familia
    where p.local = p_local
      and (p.visto_hasta >= p_desde - 90 or p.codigo in (select pr.codigo from pr))
  )
  select jsonb_build_object(
    'productos', coalesce((select jsonb_agg(jsonb_build_array(pr.codigo, pr.nombre, pr.familia, pr.canal,
                             pr.unidades, pr.monto_cts, pr.facturas, pr.categoria, pr.unidades_cero)
                           order by pr.codigo nulls last, pr.nombre, pr.familia, pr.canal) from pr), '[]'::jsonb),
    'meses',     coalesce((select jsonb_agg(jsonb_build_array(ms.mes, ms.familia, ms.canal, ms.unidades, ms.monto_cts,
                             ms.categoria)
                           order by ms.mes, ms.familia, ms.canal, ms.categoria) from ms), '[]'::jsonb),
    'catalogo',  coalesce((select jsonb_agg(jsonb_build_array(cat.codigo, cat.nombre, cat.familia, cat.rinde,
                             cat.visto_desde, cat.visto_hasta, cat.categoria)
                           order by cat.codigo) from cat), '[]'::jsonb),
    'familias',  coalesce((select jsonb_agg(jsonb_build_array(f.familia, f.nombre, f.categoria, f.orden)
                           order by f.familia) from public.pos_familias f where f.local = p_local), '[]'::jsonb),
    'sin_lineas', (select jsonb_build_object('facturas', sl.facturas, 'cts', sl.cts) from sl),
    -- La neta mira SOLO la familia de la línea: ninguna categoría por código entra en esta cuenta.
    'neta_cts',  (select coalesce(sum(l.monto_cts) filter (where l.familia is null or l.familia not in (6, 17, 20)), 0)
                  from l) + (select sl.cts from sl)
  ) into v_out;

  return v_out;
end;
$function$;
revoke all on function public.pos_ventas_productos(text, date, date) from public, anon;
grant execute on function public.pos_ventas_productos(text, date, date) to authenticated;
comment on function public.pos_ventas_productos(text, date, date) is
  'Mig 198. Ventas v2 Productos: por (código, familia de la línea, canal) unidades, céntimos, facturas, categoría y unidades en ₡0; por mes × familia × canal × categoría; catálogo con «rinde» y categoría; familias con su categoría por defecto; neta_cts = la de la 190 (la decide la familia de la línea, nunca la categoría). Solo facturas C, día CR. Sin medios de pago. Owner/manager/contador; manager solo sus locales.';

-- ── 8. El catálogo entero, para «Ajustes → Catálogo» (solo lectura) ──────────────────────
create function public.pos_catalogo_productos(p_local text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol not in ('owner', 'manager', 'contador') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_local is null then
    raise exception 'Parámetros inválidos' using errcode = '22023';
  end if;
  if v_rol = 'manager' and not public.puede_ver_local(p_local) then
    raise exception 'No autorizado para este local' using errcode = '42501';
  end if;

  return jsonb_build_object(
    -- `categoria` = la que vale hoy; `categoria_propia` = la que cargó una persona (null = la de su familia).
    'productos', coalesce((select jsonb_agg(jsonb_build_array(p.codigo, p.nombre, p.familia,
                             public.pos_categoria_efectiva(p.familia, f.categoria, a.categoria), a.categoria,
                             coalesce(a.rinde_personas, 1), p.visto_desde, p.visto_hasta)
                           order by p.codigo)
                           from public.pos_productos p
                           left join public.pos_producto_ajustes a on a.local = p.local and a.codigo = p.codigo
                           left join public.pos_familias f on f.local = p.local and f.familia = p.familia
                           where p.local = p_local), '[]'::jsonb),
    'familias',  coalesce((select jsonb_agg(jsonb_build_array(f.familia, f.nombre, f.categoria, f.orden)
                           order by f.familia) from public.pos_familias f where f.local = p_local), '[]'::jsonb),
    -- Lo que una persona puede elegir, y las categorías que fija la familia: la pantalla no guarda otra copia.
    'categorias_editables', jsonb_build_array('comida', 'bebida', 'menu_especial', 'extras', 'merch', 'otros'),
    'categorias_fijas',     jsonb_build_array('giftcard', 'pax', 'duenos', 'cortesia', 'personal', 'ingredientes')
  );
end;
$function$;
revoke all on function public.pos_catalogo_productos(text) from public, anon;
grant execute on function public.pos_catalogo_productos(text) to authenticated;
comment on function public.pos_catalogo_productos(text) is
  'Mig 198. Catálogo entero de un local para «Ajustes → Catálogo»: código, nombre, familia, categoría vigente, categoría cargada a mano, «rinde» y fechas. Solo lectura. Owner/manager/contador; manager solo sus locales.';

-- ── 9. La única puerta de escritura de lo que carga una persona ──────────────────────────
-- Guarda los DOS valores juntos (la pantalla manda la ficha entera): p_rinde 1 a 20 · p_categoria null = la de su
-- familia. Si los dos quedan por defecto, borra la fila.
create function public.pos_producto_ajuste_guardar(p_local text, p_codigo text, p_rinde integer, p_categoria text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rol     public.user_role := public.get_my_role();
  v_cod     text := nullif(btrim(p_codigo), '');
  v_fam     integer;
  v_cat_fam text;
begin
  if v_rol is null or v_rol not in ('owner', 'manager') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_rol = 'manager' and not public.puede_ver_local(p_local) then
    raise exception 'No autorizado para este local' using errcode = '42501';
  end if;
  if p_local is null or v_cod is null or p_rinde is null or p_rinde < 1 or p_rinde > 20 then
    raise exception 'Parámetros inválidos' using errcode = '22023';
  end if;
  if p_categoria is not null
     and p_categoria not in ('comida', 'bebida', 'menu_especial', 'extras', 'merch', 'otros') then
    raise exception 'Categoría fuera de la lista' using errcode = '22023';
  end if;

  select p.familia, f.categoria into v_fam, v_cat_fam
  from public.pos_productos p
  left join public.pos_familias f on f.local = p.local and f.familia = p.familia
  where p.local = p_local and p.codigo = v_cod;
  if not found then
    raise exception 'Producto desconocido' using errcode = '22023';
  end if;
  -- Lo que no es venta (6, 17, 20) y las familias con cuenta propia no se recategorizan a mano.
  if p_categoria is not null and (v_fam in (6, 17, 20) or v_cat_fam in ('giftcard', 'pax', 'duenos')) then
    raise exception 'La categoría de este producto la fija su familia' using errcode = '22023';
  end if;

  if p_rinde = 1 and p_categoria is null then
    delete from public.pos_producto_ajustes a where a.local = p_local and a.codigo = v_cod;
  else
    insert into public.pos_producto_ajustes as a (local, codigo, rinde_personas, categoria, actualizado_por)
    values (p_local, v_cod, p_rinde, p_categoria, auth.uid())
    on conflict (local, codigo) do update set
      rinde_personas = excluded.rinde_personas, categoria = excluded.categoria,
      actualizado_en = now(), actualizado_por = excluded.actualizado_por;
  end if;
end;
$function$;
revoke all on function public.pos_producto_ajuste_guardar(text, text, integer, text) from public, anon;
grant execute on function public.pos_producto_ajuste_guardar(text, text, integer, text) to authenticated;
comment on function public.pos_producto_ajuste_guardar(text, text, integer, text) is
  'Mig 198. Guarda lo que una persona carga de un producto: «rinde» (1 a 20) y categoría (null = la de su familia; solo comida, bebida, menu_especial, extras, merch u otros). Todo por defecto = borra el ajuste. Owner; manager solo de sus locales. No cambia qué es venta neta.';
```

### 6.1 Vuelta atrás propuesta `scripts/sql/198_rollback.sql`

```sql
-- 198 · vuelta atrás. ANTES: guardar lo que cargó una persona («rinde» y categoría; no se puede rehacer):
--   select * from public.pos_producto_ajustes order by local, codigo;
-- Y, en el mismo momento, el PR que saca el .sql de main (si queda, Branching lo reaplica). Si la 198 ya está
-- en el ledger de prod, el .sql NO se borra (regla 10): la vuelta atrás es una migración nueva con este cuerpo.
drop trigger if exists trg_pos_catalogo_registrar on public.pos_ndf_ticket_lines;
drop function if exists public.pos_ventas_productos(text, date, date);
drop function if exists public.pos_catalogo_productos(text);
drop function if exists public.pos_producto_ajuste_guardar(text, text, integer, text);
drop function if exists public.pos_categoria_efectiva(integer, text, text);
drop function if exists public.pos_catalogo_refrescar(text);
drop function if exists public.pos_catalogo_registrar();
drop function if exists public.pos_catalogo_absorber(uuid[]);
drop table if exists public.pos_producto_ajustes;
drop table if exists public.pos_productos;
drop table if exists public.pos_familias;
```

`product_map` y la 194 no se tocan en ningún momento, así que al volver atrás todo queda como hoy. Lo único que
se pierde es lo que una persona haya cargado en `pos_producto_ajustes` después del pase: por eso se guarda antes.

## 7. Plan de paso de `product_map` al catálogo nuevo

### 7.1 Qué hay hoy (staging, solo lectura, 24-nov)

| Medición | Valor |
|---|---|
| Líneas / facturas / locales con datos | 233.781 / 41.635 / uno solo (Santa Teresa) |
| Códigos distintos | 704, todos numéricos, de hasta 4 dígitos, sin ceros a la izquierda |
| Líneas sin código, sin nombre o sin familia | 0 / 0 / 0 |
| Códigos con más de un nombre / con más de una familia | 0 / 0 |
| **Nombres que comparten dos o más códigos** | **22** |
| Cantidades no enteras / negativas | 0 / 0 |
| Familias con ventas | 23 (la 5, bebidas, tiene 282 códigos) |
| Filas de `product_map` | 720 |
| …con `tipo` del vocabulario de la app (minúsculas) | 178: `bebida` 93 · `comida` 65 · `merchandising` 11 · `personal` 7 · `nofood` 1 · `cortesia` 1 |
| …con `tipo` = **nombre de una familia del PoS** (mayúsculas) | 542, en 20 valores: «BEBIDAS» 235, «TSHIRTS» 121, «SUSHI ROLLS» 42, «PERSONAL» 24… |
| Filas que coinciden por nombre exacto con **un** código | 601 |
| …con **varios** códigos | 19 |
| …con ninguno | 100 (7 coinciden si se ignoran mayúsculas y espacios; 93 no existen en el PoS) |
| Códigos vendidos sin fila en `product_map` | 64 |
| `multiplicador` distinto de 1 | **4 filas**, todas ×2, las cuatro con un solo código |
| `costo_unitario` mayor que 0 | 511 (438 con un código, 16 con varios, 57 con ninguno) |
| `clasificacion` / `subclasificacion` cargadas | 705 filas (22 valores) / 720 filas (57 valores); en bebidas, 4 y 14 |
| `subclasificacion` de `product_map` contra los códigos del PoS (cruce por nombre) | 646 códigos tienen una, en 54 valores (38 de ellos, el valor «1»). **No se hereda** (segunda ronda): la subcategoría viene del PoS (§11). El dato queda en `product_map` y sirve para contrastar lo que traiga el agente |
| Códigos de las familias 11, 15 y 25 | 39 + 7 + 36 = **82** (§2.5). En la 11 solo el 192 tiene monto; los otros 38 van en ₡0 |
| Familias con productos y sin nombre en ninguna tabla de la app | 1 (1 código, 8 líneas, ene-2025 a abr-2026) · 9 (2 códigos, 1 línea cada uno, may-2024, en ₡0) · 27 (1 código, 1 línea, dic-2024). Mismos datos en prod (solo lectura, por el coordinador) |
| Unidades de líneas en ₡0, facturas cerradas | Familia 5: 120 de 74.172 · comida: 473 de 135.603 · familia 11: 321 de 369 · familia 25: 250 de 2.186 (§2.5.1) |

**Tres avisos sobre esta foto:**

1. En staging `product_map` **no se refresca desde prod** (tiene 8 columnas del PoS propio que prod no tiene;
   `scripts/refresh-staging/PLAN.md`). Las cifras de `product_map` de prod pueden ser otras: el `PASE-198` repite
   estas lecturas en prod, en solo lectura, antes de la firma.
2. En staging hay dos tablas con nombre parecido, `menu_families` y `menu_categories`: son del PoS propio y no
   tienen nada que ver con esta spec. Por eso las tablas nuevas se llaman `pos_*`.
3. El agente ya calcula el nombre de la familia y su categoría (el ejemplo de `supabase/functions/ingest-ndf/README.md`
   trae `familia_nombre` y `categoria`), pero la ingesta no los guarda (`normalizarLinea`, migración 082). No se
   verificó contra el agente vivo.

### 7.2 Qué pasa con cada columna de `product_map`

| Columna | Destino | Regla y casos borde |
|---|---|---|
| `nombre` (clave) | `pos_productos (local, codigo)` | No se migra: el catálogo se arma desde las facturas. Las 100 filas sin producto en el PoS quedan solo en `product_map` |
| `tipo` | **Se deja ir** | Lo reemplaza la categoría, que sale de la familia y se ajusta por código (§2.2). No se hereda: tiene dos vocabularios mezclados. Lo único que una persona marcaba a mano y la familia no sabía (`cortesia`, `personal`) ya viene por familia (17 y 6) y **no** se puede marcar a mano |
| `clasificacion` | **Se deja ir** | En casi todas las filas repite el nombre de la familia del PoS, que ahora llega solo |
| `subclasificacion` | **Se deja ir** (**decidido 24-nov, segunda ronda**) | No se hereda ni se edita: el segundo nivel existe en el PoS y lo va a traer el agente (3.1c, §11). Lo cargado queda en `product_map`, congelado, hasta que la 3.6 decida si la tabla se archiva |
| `multiplicador` | `pos_producto_ajustes.rinde_personas` | Pasa si es ≥ 2, cruzando por nombre sin mirar mayúsculas ni espacios. **Varios códigos con ese nombre:** lo heredan todos (es lo que hoy pasa al cruzar por nombre). **Dos filas que solo difieren en mayúsculas:** gana el mayor. **Mayor que 20:** queda en 20. **Sin producto en el PoS:** no pasa. **0, 1 o null:** rinde 1 |
| `costo_unitario` | **Se queda en `product_map`** (**decidido 24-nov, D-6 = A**) | Se deja de cargar a mano; «Ing. Menú» lo sigue leyendo y se actualiza solo desde Recetas. No se copia por código ahora para no fijar un costo sin vigencia en una tabla nueva |

**Un caso que cambia a propósito y hay que mirar en el pase:** hoy el multiplicador no se aplica igual en todos
lados. «Mix» e «Ing. Menú» lo aplican a todo producto; `aggSalonero` (bebidas por persona) solo a las bebidas que
una persona clasificó con el vocabulario de la app (`tipoDeFamilia`). Las 4 filas de staging tienen `tipo`
«SUSHI ROLLS», así que hoy cuentan doble en «Mix» y **no** en bebidas por persona (no son bebidas). Con el catálogo
nuevo la regla es una sola: «rinde» se aplica a las unidades del producto donde la SPEC lo pide (§4.1 de Ventas
v2). Eso se resuelve en la 3.2, con su prueba de paridad y sus excepciones firmadas; la 3.1 solo traslada el dato.

### 7.3 Pasos

1. **PASE-198, lecturas previas (solo lectura, staging y prod), antes de la firma:** las de §7.1 · la lista de
   códigos que van a heredar «rinde» (código, nombre y valor) · la lista de los **85 códigos de las familias mixtas
   (1, 9, 11, 15 y 25)** con su categoría (código, nombre, líneas y unidades) y los códigos de esas familias que
   prod tenga y la lista no · el antes y el después de comida, bebida, `menu_especial`, «otros» y bebidas por
   persona (§2.5.2) · **los nombres de las familias leídos en la PC del PoS** (solo lectura) contra la carga de
   §6 (D-4 = A): leídos el 24-nov 15:43 CR y cargados en la 198.
   **Sin esos nombres la 198 no se firma:** una prueba frena cualquier «POR CONFIRMAR» (§8.2).
2. **3.1a:** corrida completa en staging y, con eso, **la firma (D-9) sobre el SHA del PR**. Entra la 198: el
   catálogo se llena desde la historia y se hereda lo cargado a mano. `product_map` queda intacto y nada lo lee
   distinto.
3. **3.1b:** «Ajustes → Productos» pasa a ser «Ajustes → Catálogo» y nadie más escribe `tipo`, `clasificacion`,
   `subclasificacion` ni `costo_unitario` a mano. (La 3.1c corre en paralelo, con su firma: no bloquea nada.) `product_map` queda **congelado**: lo siguen leyendo «Mix», «Ing. Menú», Mi Rendimiento y
   la 194; lo único que todavía lo escribe es el botón de Recetas que sincroniza el costo.
4. **3.2:** «Productos» definitiva lee `pos_ventas_productos`. Paridad contra el «Mix» viejo antes de retirarlo.
5. **3.6 (migración aparte, firma):** la función de la 194 pasa a cruzar «rinde» por código; `product_map` deja de
   leerse desde Ventas. Recién ahí se decide si la tabla se archiva (no se borra nada sin decisión del dueño).

## 8. Pruebas

### 8.1 SQL: batería en transacción descartada

`scripts/sql/198_pruebas.sql` (anexo A), con el patrón de la 193: `begin` → migración → casos con un local
ficticio y sus propias facturas → vuelta atrás → `rollback`. Corre en staging o en un Postgres vacío con
`scripts/sql/193_base_local.sql` + la 190.

**Resultado en Postgres 16 local (24-nov, versión con las dos rondas de decisiones): 96 resultados (92 casos y
4 tiempos), todos como se esperaba.** Lo que cubre:

| Grupo | Qué prueba |
|---|---|
| Carga inicial | El catálogo tiene tantas filas como códigos hay en las líneas; correr `pos_catalogo_refrescar` otra vez no escribe nada; lo heredado es lo esperado: «rinde» (varios códigos con un nombre lo heredan todos; gana el mayor; lo que no existe en el PoS no pasa) y la categoría de la lista de §2.5 —comida, bebida y el 192 a `menu_especial`— **solo** si el código está en las familias 11, 15 o 25 · qué familias quedaron con el nombre «POR CONFIRMAR» (hoy: 1, 9 y 27) |
| Disparador | Alta con la primera factura · código con espacios se guarda limpio · línea sin código no entra · nombre nuevo en una factura más reciente pisa · factura vieja reingestada no pisa y sí corre `visto_desde` · otro local no se mezcla |
| Cierre | `neta_cts` = Σ `dias[].neta_cts` de la 190 · Σ `meses` = Σ `productos` · factura sin líneas va a `sin_lineas` · anulada no cuenta · factura de las 23:30 CR entra y la de las 00:10 del día siguiente no |
| **La categoría no toca la neta** | Con una categoría cargada por código: `neta_cts` es la misma que antes y la misma que la 190 · Σ de `productos` (y de `meses`) con categoría de venta + `sin_lineas` = `neta_cts` · la línea de familia 17 de un producto marcado «comida» sigue siendo `cortesia` · todo otra vez después de todos los intentos de guardado |
| **`menu_especial`** | Un producto pasado a `menu_especial` sale con esa categoría, su plata **sigue en la neta** (igual a la 190) y el cierre por categoría sigue dando |
| **Unidades en ₡0** | Un paso de menú en ₡0 trae 3 unidades y 3 en cero; un producto vendido, 0 en cero; la línea sin familia en ₡0, 1 y 1 |
| Valores de categoría | `cortesia`, `personal`, `ingredientes`, `pax`, `giftcard`, `duenos`, en mayúsculas y vacía → `22023` · cambiarle la categoría a un producto de cortesía, de personal, a un ingrediente o a una gift card → `22023` (el «rinde» de esos productos sí se puede guardar) · ninguno de esos intentos deja nada guardado · por debajo de la función, la tabla tampoco acepta `cortesia` ni una fila vacía · una familia 17 no puede ser `comida` ni una familia 3 `cortesia` |
| Guardado | Los dos valores entran juntos y queda quién lo guardó · el catálogo los devuelve · rinde 0, 21 o null y código desconocido → `22023` · todo por defecto borra la fila |
| Validaciones | 732 días y rango invertido → `22023` |
| Permisos | Owner y contador leen funciones y tablas · **manager: en su local guarda y lee; en un local ajeno → `42501` en la lectura, en el catálogo y en el guardado, 0 filas, y no queda nada escrito** · **contador no guarda «rinde» ni categoría (`42501`)** · salonero, cajero y sin sesión → `42501` y 0 filas · `anon` sin `execute` ni `select` · nadie escribe las tablas por la API, ni el owner · nadie llama `pos_categoria_efectiva`, `pos_catalogo_absorber` ni `pos_catalogo_refrescar` por la API |
| Vuelta atrás | Después de `198_rollback.sql` no queda ninguna tabla, función ni disparador |

**Mutaciones (romper a propósito; 20 de 20 hicieron caer lo que dice):**

| Mutación | Qué cae |
|---|---|
| La familia 17 cuenta como venta | El cierre contra la 190 y los cierres por categoría (10 casos) |
| Se cuentan las facturas anuladas | El cierre contra la 190 (14) |
| El día corta un día después | El cierre contra la 190: entra la factura de las 00:10 (14) |
| No se suman las facturas sin líneas | El cierre contra la 190 (10) |
| **Una categoría por código pisa la familia de la línea** (se le saca a `pos_categoria_efectiva` la regla de 6, 17 y 20) | Σ por categoría de venta ≠ `neta_cts`, en `productos` y en `meses` (7) |
| **`menu_especial` deja de ser venta** (la función de categoría lo trata como cortesía) | «`menu_especial` es venta» y los cierres por categoría (6). `neta_cts` no se mueve |
| **El guardado no valida la lista de categorías** | Los ocho valores fuera de la lista dejan de dar `22023` (los frena el `check`, con otro código) |
| **El guardado deja cambiar la categoría de un producto de cortesía, personal, ingrediente o gift card** | Los cuatro casos y lo que queda guardado (7). El cierre por categoría contra la neta **sigue dando bien**: lo sostiene `pos_categoria_efectiva` |
| **Las tres defensas rotas a la vez** (sin `check`, sin lista, sin regla en la función de categoría) | 23 casos. `neta_cts` contra la 190 **no cae** en ninguno de sus cinco casos: la neta no mira categorías |
| Una familia fuera de 6, 17 y 20 puede ser `cortesia` (sin el `check` de `pos_familias`) | Los dos casos de familias y «fuera de la venta = {6, 17, 20}» |
| La categoría de la lista se aplica a un código que no está en 11, 15 ni 25 | «categoría solo en 11, 15 y 25» y el detalle de lo heredado |
| Las unidades en ₡0 cuentan todas las unidades | «unidades en ₡0» |
| El manager lee cualquier local (`pos_ventas_productos`) | «manager: local ajeno» |
| El manager lee el catálogo de cualquier local (`pos_catalogo_productos`) | «manager: catálogo de un local ajeno» |
| **El manager guarda en cualquier local** | «manager: guardado en un local ajeno» |
| **El contador puede guardar** | Los dos casos del contador (rinde y categoría) |
| El catálogo de Ajustes se abre a cualquier rol con sesión | «salonero: catálogo» |
| Una factura vieja pisa el nombre | «factura vieja no pisa» |
| La política de lectura queda abierta | Salonero y manager ven filas que no deben (3) |
| El disparador sin el bloque que captura errores | «La ingesta entra con el catálogo roto» (2) |

**NO PROBADO, queda para el PR 3.1a en staging:** la corrida completa con el volumen real (cuánto tarda la carga
inicial sobre ~234 mil líneas, cuánto dura el bloqueo de `pos_ndf_ticket_lines` al crear el disparador y cuánto
tarda la función con un año), el cierre contra la 190 con datos reales en ayer, mes a la fecha, último mes
cerrado y un año, y la herencia real (cuántos «rinde» y categorías entran, contra las cifras de §7.1 y §2.5). La
batería ya trae esos casos. En el Postgres local los casos de permisos usan un usuario activo de cada rol creado
para la prueba; en staging usan los usuarios reales de cada rol.

### 8.2 Vitest (PR 3.1a y 3.1b)

| Archivo | Qué cuida | Qué fallaría si se rompe |
|---|---|---|
| `src/shared/api/posNdf.contrato198.test.ts` | Lee el `.sql` (patrón de `contrato067` y `contrato191`): firma, orden de cada arreglo, y que no nombre medios de pago, mesa, salonero ni `clase_ingreso` | Alguien suma una columna de pago, o cambia el orden y la app lee «unidades» donde va «monto» |
| Mismo archivo | Las tres copias de la lista de categorías que una persona puede elegir (el `check` de la tabla, la función de guardado y `categorias_editables`) son iguales, y ninguna incluye `cortesia`, `personal` ni `ingredientes` | Alguien agrega una categoría en un lugar y no en los otros, o habilita marcar a mano algo que no es venta |
| Mismo archivo | **Ningún nombre de familia de la carga dice «POR CONFIRMAR»**, y toda familia de `FAMILIAS_CATALOGO` (`netaVenta.ts`) tiene su fila | La 198 llega a la firma con un nombre inventado o con una familia sin cargar |
| `src/modules/ventas/catalogoPos.test.ts` | Módulo puro nuevo: orden categoría → familia → nombre; familia sin fila → «Familia N» en `otros`; un código con dos familias en el período se muestra una vez; línea sin código; nombre vigente del catálogo; **la categoría de cada fila es la que manda la función** (la app no la recalcula); `menu_especial` va tercera; **unidades vendidas = unidades − unidades en ₡0**, y un producto con todas en ₡0 no tiene precio | El catálogo sale desordenado, un producto aparece dos veces, la app arma su propia regla de categoría, o un paso de menú aparece con precio ₡0 |
| Mismo archivo | `FAMILIAS_NO_VENTA` de `netaVenta.ts` = el conjunto escrito en el `.sql` = las familias de categoría `cortesia`, `personal` e `ingredientes` de la carga; y **con cualquier categoría por código, la neta que suma el módulo no cambia** (misma entrada con y sin categorías cargadas → misma neta) | Una definición firmada queda en dos lugares que no coinciden, o una categoría mueve la venta |
| `src/modules/ventas/__paridad__/productos31.paridad.test.ts` | Las mismas facturas ficticias por el camino viejo (`armarDia`) y por la forma de la función nueva dan la misma neta por familia y canal, al céntimo | «Productos» deja de cerrar contra «Resumen» |
| `src/modules/ventas/ventasTabs.test.ts` | «Catálogo»: owner y manager; contador no. `?tab=ajustes&v=productos` y `?tab=config` abren «Catálogo» respetando el rol | Un rol ve lo que no debe o un enlace guardado se rompe |
| `VentasCatalogo.render.test.tsx` | Lista todo el catálogo del local; el buscador y los filtros (categoría, familia, «los que cambié», «nuevos») filtran; guardar llama a la función con local, código y **los dos valores**; un producto de categoría fija muestra la categoría bloqueada; «volver a la de su familia» manda null; el manager no ve otro local; «rinde» fuera de 1–20 no se envía; no hay ningún campo de subcategoría; si la función devuelve error, la fila vuelve a su valor y se avisa | Se guarda un valor inválido, en el local equivocado, o se pisa un valor que la persona no tocó |
| `src/productMapCongelado.test.ts` | Lista cerrada de archivos que todavía importan `getProductMap` o escriben `product_map`; solo puede achicarse | Código nuevo vuelve a depender del catálogo por nombre |
| `supabase/migraciones.test.ts` (existente) | La 198 registrada, en su bloque y sin repetir | Número duplicado o sin registrar |

Fechas: las pruebas que usan «hoy» fijan el reloj a las 23:30 CR.

## 9. Riesgos, vuelta atrás y decisiones

### 9.1 Riesgos

| Riesgo | Qué tan grave | Cómo se cuida |
|---|---|---|
| El disparador rompe o frena la ingesta del PoS | Alto si pasara: es la evidencia de las ventas | Captura todo error (probado); casi nunca escribe; humo del pase = latido del PoS y facturas entrando antes y después |
| Bloqueo de `pos_ndf_ticket_lines` al crear el disparador y hacer la carga inicial | Bajo: segundos, y el agente reintenta | Medirlo en staging en el 3.1a; pase en la franja libre, fuera del servicio |
| Los nombres de familia marcados «POR CONFIRMAR» (11, 15, 25) salen de un solo producto que coincide | Medio: un rótulo equivocado en un reporte de gerencia | Prerrequisito del pase (D-4 = A): leerlos en la PC del PoS. Las familias 1, 9 y 27 no se cargan: salen «Familia N» |
| **Una categoría por código saca o mete plata de la venta neta** | Sería grave: la neta es la cifra de Contabilidad | No puede pasar por diseño: la neta la decide la familia de la línea y no mira categorías. Tres defensas con prueba y mutación (§2.2, §8.1); con las tres rotas a la vez la neta sigue igual a la de la 190 |
| **D-3 mueve comida/bebida y bebidas por persona** hacia atrás, en todo el histórico | Medio: cifras que el dueño ya miró cambian (poco: §2.5) | La neta total no cambia. Se mide antes y después en prod, en solo lectura, en el `PASE-198`, antes de la firma. El cambio se ve recién con la 3.2, con su prueba de paridad y su excepción firmada |
| Alguno de los 82 códigos quedó en la categoría equivocada | Bajo: se corrige en «Catálogo» en un toque y la neta no se mueve | La lista la confirmó el dueño el 24-nov; el PASE la muestra con nombres, contra prod |
| El ítem por comensal del próximo menú cerrado entra como comida (código nuevo de la familia 11) | Bajo a medio: la plata de esa noche aparece en comida hasta que alguien lo pase a `menu_especial` | Filtro «nuevos»; anotarlo en la guía 6.4 (3.1b) como paso de cada menú cerrado |
| La regla de unidades en ₡0 (§2.5.1) cambia «bebidas por persona» de hoy en −0,2 % | Bajo, pero es un número que ya se mira | Punto abierto B-1; va como excepción firmada de la 3.2, con su paridad |
| La 198 se firma con un nombre de familia sin confirmar | Medio: un rótulo inventado en un reporte | Marcador «POR CONFIRMAR» en la carga y una prueba que lo frena (§8.2) |
| Un código **nuevo** de las familias 11, 15 o 25 toma la categoría por defecto de su familia y no es la suya | Bajo a medio: pasa cada 31-dic y con cada promoción nueva | Filtro «nuevos» en «Catálogo» (visto por primera vez en los últimos 30 días). Punto abierto (§9.3.1) |
| Una persona le pone a un producto una categoría que no es | Bajo: mueve el mix, no la venta | Lista corta de categorías; queda quién y cuándo; «volver a la de su familia» |
| Entre la 3.2 y la 3.6, «bebidas por persona» de gerencia (catálogo nuevo) y la de Mi Rendimiento (función de la 194, por nombre) pueden diferir en lo que D-3 mueve | Bajo (§2.5) | Avisarlo en el PR de la 3.2; se iguala en la 3.6 |
| Hasta la 3.1c, bebida es una sola lista larga (282 productos en la familia 5), sin cervezas, vinos ni cocteles | Medio para quien mira el mix de bebidas: es menos de lo que hoy da la subclasificación cargada a mano | Decisión del dueño (el dato tiene que venir del PoS). «Mix» viejo sigue mostrando la subclasificación hasta la 3.2; conviene que la 3.1c llegue antes o junto con la 3.2 |
| El PoS cambia el nombre o la familia de un código | Bajo (no pasó nunca en los datos) | Gana la factura más reciente; la plata sigue a la familia de cada línea, así que la neta no se mueve |
| Entre la 3.1b y la 3.2, un producto nuevo de merch o cortesía no tiene quién lo clasifique en el «Mix» viejo | Bajo y corto: cae en «otros» del Mix viejo, la venta total no cambia | Mergear la 3.1b pegada a la 3.2, o juntas |
| Cambiar un «rinde» o una categoría mueve hacia atrás las cifras de todo el histórico | Bajo; hoy el multiplicador ya se comporta así | Queda quién y cuándo. Historial completo de cambios: fuera de alcance (§10) |
| Prod no es igual a staging en `product_map` | Medio | Lecturas previas en prod dentro del PASE, antes de la firma |

### 9.2 Vuelta atrás

- **3.1a:** `198_rollback.sql` (§6.1) y, en el mismo momento, el PR que saca el `.sql` de `main`; si ya está en el
  ledger de prod, el `.sql` se queda y la vuelta atrás es una migración nueva (regla 10). Antes, guardar
  `pos_producto_ajustes`. Como nada viejo se toca, la app queda exactamente como hoy.
- **Solo el disparador,** si diera problemas: `drop trigger trg_pos_catalogo_registrar on public.pos_ndf_ticket_lines`
  (con firma). El catálogo deja de actualizarse, la lectura sigue dando bien la plata, y
  `pos_catalogo_refrescar` lo pone al día cuando se reponga.
- **3.1b:** revert del merge; «Ajustes → Productos» vuelve y `product_map` está como se dejó. Lo cargado en
  «Catálogo» queda guardado en `pos_producto_ajustes` y no se pierde.

### 9.3 Decisiones del dueño (24-nov-2026, dos rondas)

| # | Decisión | Qué se decidió | Dónde quedó | ¿Firma? |
|---|---|---|---|---|
| **D-1** | Qué quiere decir «cuántas personas rinde» | **A — decidido 24-nov.** Es el multiplicador de hoy: el producto cuenta como N unidades. No toca personas ni la venta por persona | §2.3 | No |
| **D-2** | Un solo nivel del PoS o más | **C — decidido 24-nov,** ajustada en la segunda ronda. La **categoría** grande es por (local, código): por defecto la de su familia y editable por código. El **segundo nivel** (cerveza, vino, cocteles) **no** se carga a mano ni se hereda de `product_map`: existe en el PoS y viene de ahí (3.1c) | §2.2, §2.3, §4.3, §7.2, §11 | **Sí, esquema:** una columna y dos funciones más en la 198. La 3.1c, firma aparte |
| **D-3** | Familias 11, 15 y 25 | **Decidido 24-nov:** «todo está dentro de una gran primera categoría, comida o bebida, depende dónde esté». Cada código lleva su categoría. **Lista de 82 confirmada** (segunda ronda): 24 a comida, 57 a bebida y el 192 a la categoría nueva `menu_especial` | §2.5 | **Sí:** mueve comida/bebida y bebidas por persona. Va con la 198, después de medir |
| **D-4** | De dónde salen los nombres de las familias | **A — decidido 24-nov.** Los carga la migración, leídos en la PC del PoS. Segunda ronda: también los de las familias 1, 9 y 27 | §2.1, §2.2, §6, §7.3 | Sí, con la 198 |
| **D-5** | Dónde se edita | **B — decidido 24-nov.** Catálogo completo en Ajustes con buscador, con «rinde» y categoría editables por producto. Reemplaza «Ajustes → Rinde» | §1.3, §8.2, §9.5 | No (OK + validación física) |
| **D-6** | El costo cargado a mano | **A — decidido 24-nov.** Se deja de cargar; queda en `product_map` y se actualiza desde Recetas | §2.4, §7.2 | No (OK + validación física) |
| **D-7** | Quién edita | **A — decidido 24-nov.** Dueño y encargado de su local; el contador no | §5 | Va con la firma de la 198 |
| **D-8** | Cómo se mantiene el catálogo al día | **A — decidido 24-nov.** Disparador en las líneas del PoS, con las protecciones de §4.4 | §4.4 | Sí, es la 198 |
| **A-1** | La lista de 82 códigos | **Confirmada 24-nov** con dos cambios: 698 y 740 a comida. 308, 312 y 862 quedan en bebida | §2.5 | Con la 198 |
| **A-2** | Un código nuevo de las familias 11, 15 o 25 | **A — decidido 24-nov.** Toma la categoría de la mayoría de su familia y aparece en «nuevos» | §2.5 | Con la 198 |
| **A-3** | Qué categorías se eligen a mano | **A — decidido 24-nov.** Gift cards, pax y dueños las fija la familia. Se suma `menu_especial` a las que sí se eligen | §2.2 | Con la 198 |
| **A-4** | El subgrupo | **Decidido 24-nov:** ni texto libre ni lista en la app. Viene del PoS | §11 | 3.1c, firma aparte |
| **A-5** | Familias 1, 9 y 27 | **Decidido 24-nov:** tienen nombre en el PoS; se lee en la PC del PoS y se cargan en la 198 como las demás | §2.2, §6 | Con la 198 |
| **A-6** | Nombres y categorías de las familias del PoS | **Decidido 24-nov ~15:50 CR** (lectura de 15:43): 1 no existe (borrada, por código) · 9 Grupo C (mixta) mixta · 18 → bebida · 10 → merch · 17 → regalías · 6 → personal, aparte · 7, 8 y 14 → por código · 20 sin ventas | §2.2, §2.5, §6 | Con la 198 |
| **B-1** | Unidades en ₡0 | **A — decidido 24-nov ~15:50 CR.** Solo cuentan las vendidas; las de ₡0 aparte como «incluidas» | §2.5.1 | Con la 3.2 |
| **B-3** | Orden de `menu_especial` | **A — decidido 24-nov ~15:50 CR.** Tercera, al lado de comida y bebida | §2.2 | No (orden de pantalla) |
| **D-9** | **Firma de la migración 198** | **Pendiente.** Va sobre el SHA del PR 3.1a, **después** de las lecturas previas en prod (solo lectura), los nombres de familia que faltan copiar y la corrida en staging. Alcance: 3 tablas, 1 disparador en `pos_ndf_ticket_lines`, 7 funciones, carga de 29 familias, herencia de «rinde» y la categoría de 85 códigos | §6, §7.3 | **Sí** |

#### 9.3.1 Lo que sigue abierto para el dueño

| # | Punto | Opciones (recomendada primero) | ¿Cuándo? |
|---|---|---|---|
| B-2 | ~~Nombres de familia~~ **Cargados** (24-nov tarde): 7 Grupo A (surf) · 8 Grupo B (surf) (rótulos neutros) · 11 MENU AÑO NUEVO · 15 EVENTOS TERRAZA · 25 PROMOCIONES · 27 T-XABANICOS (merch) | — | Hecho |
| B-4 | **Firma D-9** | Sobre el SHA del PR 3.1a | Después del PASE, los nombres y la corrida en staging |
| B-5 | **Firma de la 3.1c** (agente en la PC del PoS + Edge `ingest-ndf` de prod + su migración) | Después del paso 0 y de su propia spec corta | Aparte; no bloquea la 3.1a |

### 9.4 Lecturas del coordinador y supuestos

Lo que no dijo el dueño con esas palabras. Los supuestos S1 a S5 y las lecturas L1 a L4 de las versiones
anteriores quedaron resueltos por las dos rondas del 24-nov.

| # | Lectura o supuesto | Dónde pesa |
|---|---|---|
| L5 | La categoría por código no puede sacar ni meter plata de la venta neta: lo que no es venta lo fija la familia de la línea | §2.2 |
| L6 | `menu_especial` se puede elegir a mano (hace falta para el ítem por comensal de cada menú cerrado nuevo) y va tercera en el orden | §2.2 |
| L7 | La categoría por defecto de las familias 1, 9 y 27 es bebida, comida y merch, por lo que venden sus 4 códigos | §2.2, §6 |
| L8 | La regla de unidades en ₡0 vale para toda la carta, no solo para la familia 11 | §2.5.1 |
| L9 | D-5: el catálogo completo reemplaza a «Ajustes → Productos» y se llama «Catálogo»; se edita en la fila, sin pantalla aparte | §1.3 |
| S6 | El orden de las familias dentro de comida es el de la carta: tapas, rolls, pokes, kids, postres, GreenSeason; después 11, 15 y 9. En bebida: 5, 25 y 1 | §6 |
| S7 | «Activo» para «Sin ventas en el período» = visto en una factura en los 90 días anteriores al período | §3 |
| S8 | Los códigos son por local; Nosara tendrá los suyos cuando tenga PoS. `product_map` no tiene local: el «rinde» que se hereda de ahí se aplica a los locales que existan el día del pase (hoy, uno) | §4.2, §7.2 |
| S9 | «Nuevo» en «Catálogo» = visto por primera vez en los últimos 30 días | §2.5 |

### 9.5 PRs

| PR | Qué | Agente | Requiere |
|---|---|---|---|
| **3.1a** | Archivo de la 198, rollback, batería con las 20 mutaciones (`198_pruebas.sql` + `198_pruebas.py`), registro del número, **`PASE-198`** (lecturas previas en prod en solo lectura, lista de los 85 códigos con nombre, antes y después de D-3, los nombres de familia leídos en la PC del PoS), corrida completa en staging, lectores `getVentasProductos` y `getCatalogoProductos` y `guardarAjusteProducto` en `posNdf.ts`, módulo puro `catalogoPos.ts` y sus pruebas. **Sin subcategoría.** Sin pantalla. Título «⛔ NO MERGEAR sin OK —» | Opus + verificador independiente (esquema, permisos y que la categoría no toque la neta) | **Firma** (D-9), sobre el SHA del PR, después del PASE y la corrida en staging |
| **3.1b** | «Ajustes → Catálogo» (`VentasCatalogo.tsx`): catálogo completo con buscador y filtros; «rinde» y categoría editables por producto. Se retira `VentasConfig.tsx` y la carga de costo a mano. Guía 6.4 e inventario de guías. Recorrida por rol en staging (`satori-verificar`) | Opus | OK + validación física |
| **3.1c** | Catálogo desde el agente, con la subcategoría del PoS (§11): paso 0 en la PC del PoS, agente, Edge `ingest-ndf` y una migración aparte. No bloquea la 3.1a ni la 3.1b | Fable (spec corta tras el paso 0) → Opus + verificador | **Firma aparte** (agente en la PC del PoS + Edge de prod + migración) |
| 3.2 | «Productos» definitiva (§5.2 de Ventas v2) sobre `pos_ventas_productos`. Acá se ve D-3 y se aplica la regla de unidades en ₡0 (B-1): actualiza §4.1 de la SPEC de Ventas v2 (comida, bebida, `menu_especial` y bebidas por persona) con su paridad y sus excepciones firmadas | Opus + verificador | OK + validación física |

## 10. Fuera de alcance

- **La pantalla «Productos» definitiva** (mix, suben y bajan, ingeniería de menú, canal): es la 3.2.
- **Costo, margen y recetas por código:** con Inventario (§2.4).
- **Retirar `product_map`** y pasar Mi Rendimiento y la función de la 194 al catálogo por código: 3.6, con su
  migración y su firma.
- **Guardar el nombre de la familia desde la ingesta** (Edge `ingest-ndf` y `pos_ndf_ingest`): PR aparte, con firma.
- **Modificadores y tamaños:** el PoS no manda la relación (SPEC de Ventas v2 §13, pregunta 2).
- **Ventas por producto y salonero**, y por día: no las trae esta función.
- **Historial de cambios de «rinde» y categoría** (solo queda el último cambio: quién y cuándo).
- **Editar familias desde la app** (nombre, orden o categoría por defecto de una familia): las carga la migración.
- **La subcategoría del PoS** (cerveza, vino, cocteles): fuera de la 198; es la 3.1c (§11).
- **Aplicar la regla de unidades en ₡0** a los indicadores: la 198 solo deja el dato; la regla entra con la 3.2.
- **Catálogo de Nosara:** la estructura es por local desde el día uno; la carga de sus familias entra cuando
  tenga PoS.
- **Catálogo del PoS propio** (`menu_families`, `menu_categories`, columnas extra de `product_map` en staging): otro
  proyecto.
- **La deuda multi-local de la 067, la 080 y la 190,** y cerrar `ventas_comps_write` al contador: backlog, con firma.
- **Archivos sagrados:** no se toca ninguno. `netaVenta.ts` no es sagrado, pero su definición está firmada y no cambia.

## 11. 3.1c — catálogo desde el agente (fuera de la 198)

**Decidido 24-nov (segunda ronda):** el segundo nivel de clasificación —dentro de bebida: cerveza, vino, cocteles
clásicos, sin alcohol— **existe en el PoS**. Hoy no llega a la app porque el agente manda solo la familia de cada
línea de factura, y lee el catálogo de productos del PoS (`FAC_Productos`) únicamente para armar el detalle de las
mesas abiertas (migraciones 064 y 065). Entonces la subcategoría no se carga a mano ni se arma una lista en la app:
**se trae del PoS.** La 3.1a sale sin ella.

Esta sección es el encargo, no la spec: la forma exacta depende del paso 0. **Nada de esto está en la 198.**

| Paso | Qué | Quién | Toca prod |
|---|---|---|---|
| **0** | **Localizar la subcategoría en la base del PoS.** Dónde la guarda: **POR CONFIRMAR** (una columna de `FAC_Productos`, un segundo nivel de `FAC_Clasificaciones` u otra tabla; **no se asume ningún nombre**). Traer: tabla y columnas, cuántos valores distintos hay, si todo producto tiene una, si cuelga del producto o de la familia, unas filas de ejemplo de bebida, y si el PoS marca productos inactivos. **En la misma visita:** los nombres de las familias 1, 9 y 27 y la confirmación de 11, 15 y 25 (B-2) | El dueño en la PC del PoS, guiado de a un paso, solo lectura | No (solo lectura en el PoS) |
| 1 | Spec corta de la 3.1c con lo que salió del paso 0: forma del dato, tabla, y qué pasa con nombre y familia cuando el catálogo los trae directo | Fable | No |
| 2 | **El agente manda el catálogo:** por producto, código, nombre, familia y subcategoría. Al arrancar y cuando cambia (o una vez por día). Solo lectura sobre el PoS. Vive en la rama del agente, no en `main` | Opus | Sí: instalar la versión nueva en la PC del PoS |
| 3 | **La Edge `ingest-ndf` recibe el catálogo** (mismo portón `x-ingest-secret`) y lo pasa a la base | Opus | Sí: versión nueva de una Edge de prod (regla 2) |
| 4 | **Migración aparte** (el número libre de ese momento, no la 198): guarda la subcategoría por (local, código) y su nombre. `pos_ventas_productos` y `pos_catalogo_productos` la devuelven **al final** de cada arreglo, sin mover lo que ya se lee | Opus + verificador | Sí: esquema |
| 5 | «Productos» (3.2) y «Catálogo» (3.1b) la muestran: bebida abierta en cervezas, vinos, cocteles. Solo lectura: en la app no se edita | Opus | No |

- **Firma aparte de la 198,** una sola para los pasos 2, 3 y 4: agente en la PC del PoS, Edge `ingest-ndf` de prod
  y migración. Primero en staging, con el agente de staging.
- **A decidir en su spec, no acá:** si con el catálogo del agente el nombre y la familia vigentes pasan a salir
  de ahí (cubriría también productos que nunca se vendieron) y el disparador de la 198 queda de respaldo; y si
  la subcategoría se guarda como columna de `pos_productos` o en tabla propia con su nombre.
- **Mientras tanto:** bebida es una sola lista ordenada por familia. `product_map.subclasificacion` queda
  congelada: no se hereda, no se edita y no aparece en pantallas nuevas; sirve para contrastar lo que traiga el
  agente (hoy: 646 códigos con valor, §7.1).
- **Orden recomendado:** que la 3.1c llegue antes o junto con la 3.2, para que «Productos» no pierda el detalle
  de bebidas que hoy muestra el «Mix» viejo.
- **Criterios de aceptación:** todo código vendido en los últimos 12 meses tiene subcategoría o un aviso de que el
  PoS no se la puso · la subcategoría nunca cambia qué es venta neta ni la categoría grande · si el agente no
  manda catálogo, la ingesta de facturas sigue igual · el catálogo no trae precios de costo ni datos de personas.

## Anexo A — batería propuesta `scripts/sql/198_pruebas.sql`

Va entre el cuerpo de la 198 y el de `198_rollback.sql`, todo dentro de un `begin` … `rollback`. `pg_temp.como`
cambia de usuario (un perfil activo de cada rol); `pg_temp.p` guarda el resultado o el error de cada caso. Los
casos «paridad» con `santa-teresa` necesitan los datos de staging; en un Postgres vacío dan 0 = 0. El local
ficticio trae sus propias familias, un mismo código (`9002`) vendido en la familia 5 y regalado en la 17 —el
caso que muestra que la categoría por código no toca lo que no es venta— y un paso de menú en ₡0 (`9008`). Para el PR 3.1a la batería pasa al
formato de la 193 (cada caso dice OK o FALLA) con su `198_pruebas.py --mutar todas`.

```sql
-- ── PRUEBAS 198 (dentro de la transacción descartada) ──
create temp table r (n serial, k text, v text) on commit drop;
grant all on r to public;
grant usage on sequence r_n_seq to public;

create function pg_temp.como(p_rol text) returns void language plpgsql as $f$
declare v uuid;
begin
  perform set_config('role', 'none', true);
  if p_rol = 'nadie' then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    return;
  end if;
  select id into v from public.profiles where role::text = p_rol and is_active order by id limit 1;
  if v is null then raise exception 'sin usuario de rol %', p_rol; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;

create function pg_temp.p(k text, q text) returns void language plpgsql as $f$
declare v text;
begin
  begin
    execute q into v;
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into r (k, v) values (k, coalesce(v, '<null>'));
end $f$;

select pg_temp.p('t_migracion_ms', $$select round(extract(epoch from clock_timestamp() - now()) * 1000)::text$$);
select pg_temp.p('catalogo_filas', $$select count(*)::text from public.pos_productos$$);
select pg_temp.p('codigos_en_lineas', $$select count(distinct (t.local, btrim(l.codigo_producto)))::text from public.pos_ndf_ticket_lines l join public.pos_ndf_tickets t on t.id = l.ticket_id where nullif(btrim(l.codigo_producto), '') is not null$$);
select pg_temp.p('ajustes_heredados', $$select count(*)::text || ' filas · rinde>1: ' || count(*) filter (where rinde_personas > 1) || ' · con categoría: ' || count(*) filter (where categoria is not null) || ' (comida ' || count(*) filter (where categoria = 'comida') || ', bebida ' || count(*) filter (where categoria = 'bebida') || ', menu_especial ' || count(*) filter (where categoria = 'menu_especial') || ')' from public.pos_producto_ajustes$$);
select pg_temp.p('heredados_detalle_local', $$select coalesce(string_agg(codigo || '=' || rinde_personas || '/' || coalesce(categoria, '-'), ' | ' order by codigo), '-') from public.pos_producto_ajustes where codigo in ('8001', '8002', '8003', '8004', '124', '192', '238', '519', '698', '930')$$);
select pg_temp.p('categoria_solo_en_11_15_25', $$select count(*)::text from public.pos_producto_ajustes a join public.pos_productos p using (local, codigo) where a.categoria is not null and p.familia is distinct from 11 and p.familia is distinct from 15 and p.familia is distinct from 25$$);
select pg_temp.p('familias_con_nombre_por_confirmar', $$select coalesce(string_agg(familia::text, ',' order by familia), '-') from public.pos_familias where nombre like 'POR CONFIRMAR%'$$);
select pg_temp.p('familia_17_no_puede_ser_comida', $$insert into public.pos_familias (local, familia, nombre, categoria) values ('prueba-198-x', 17, 'X', 'comida') returning 'entró'$$);
select pg_temp.p('familia_3_no_puede_ser_cortesia', $$insert into public.pos_familias (local, familia, nombre, categoria) values ('prueba-198-x', 3, 'X', 'cortesia') returning 'entró'$$);
select pg_temp.p('familias_sin_fila', $$select coalesce(string_agg(distinct p.familia::text, ',' order by p.familia::text), '-') from public.pos_productos p where not exists (select 1 from public.pos_familias f where f.local = p.local and f.familia = p.familia)$$);
select pg_temp.p('no_venta_coincide', $$select (array_agg(familia order by familia))::text from public.pos_familias where categoria in ('personal', 'cortesia', 'ingredientes')$$);
select set_config('p198.t0', clock_timestamp()::text, true);
select pg_temp.p('refrescar_2da_vez_filas', $$select public.pos_catalogo_refrescar('santa-teresa')::text$$);
select pg_temp.p('refrescar_ms', $$select round(extract(epoch from clock_timestamp() - current_setting('p198.t0')::timestamptz) * 1000)::text$$);

-- Disparador, con un local ficticio (y sus familias)
insert into public.pos_familias (local, familia, nombre, categoria, orden) values
  ('prueba-198', 2, 'FICTICIA 2', 'comida', 10), ('prueba-198', 3, 'FICTICIA 3', 'comida', 20),
  ('prueba-198', 5, 'FICTICIA 5', 'bebida', 10), ('prueba-198', 12, 'FICTICIA 12', 'giftcard', 10),
  ('prueba-198', 17, 'FICTICIA 17', 'cortesia', 10), ('prueba-198', 6, 'FICTICIA 6', 'personal', 10),
  ('prueba-198', 20, 'FICTICIA 20', 'ingredientes', 10);
insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, valor_servido_crc)
values ('prueba-198', 'A', '2026-11-20 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-198', 'B', '2026-11-22 12:00-06', 'C', 'delivery', 'cajero', false, 'ok', 0),
       ('prueba-198', 'V', '2026-11-10 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-198', 'X', '2026-11-21 12:00-06', 'X', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-198', 'S', '2026-11-21 13:00-06', 'C', 'salon', 'salonero', true, 'ok', 1234.5),
       ('prueba-198', 'N', '2026-11-23 23:30-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-198', 'M', '2026-11-24 00:10-06', 'C', 'salon', 'salonero', true, 'ok', 0);
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, x.cod, x.nom, x.cant, x.monto, x.fam
from (values ('A', '9001', 'ROLL FICTICIO', 2, 7000, 3), ('A', '9002', 'TRAGO FICTICIO', 1, 3000, 5),
             ('A', null, 'SIN CODIGO', 1, 500, 22), ('A', '9003', 'CORTESIA FICTICIA', 1, 4000, 17),
             ('A', '9004', 'PERSONAL FICTICIO', 1, 2000, 6), ('A', '9005', 'ING FICTICIO', 1, 100.5, 20),
             ('A', ' 9006 ', 'CON ESPACIOS', 1, 0, null), ('A', '9007', 'TARJETA FICTICIA', 1, 10000, 12),
             ('A', '9008', 'PASO DE MENU FICTICIO', 3, 0, 5),
             -- el mismo trago, regalado en una factura más vieja: esa línea es cortesía (17) y no es venta
             ('V', '9002', 'TRAGO FICTICIO', 1, 800, 17)) x(fac, cod, nom, cant, monto, fam)
join public.pos_ndf_tickets t on t.local = 'prueba-198' and t.numero_factura = x.fac;
select pg_temp.p('trg_alta', $$select string_agg(codigo || '=' || nombre || '/' || coalesce(familia::text, 'null') || '/' || visto_desde || '..' || visto_hasta, ' | ' order by codigo) from public.pos_productos where local = 'prueba-198'$$);
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, '9001', 'ROLL FICTICIO NUEVO', 1, 3500, 3 from public.pos_ndf_tickets t where t.local = 'prueba-198' and t.numero_factura = 'B';
select pg_temp.p('trg_nombre_nuevo', $$select nombre || ' ' || visto_desde || '..' || visto_hasta from public.pos_productos where local = 'prueba-198' and codigo = '9001'$$);
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, '9001', 'ROLL VIEJO', 1, 1000, 2 from public.pos_ndf_tickets t where t.local = 'prueba-198' and t.numero_factura = 'V';
select pg_temp.p('trg_factura_vieja_no_pisa', $$select nombre || '/' || familia || ' ' || visto_desde || '..' || visto_hasta from public.pos_productos where local = 'prueba-198' and codigo = '9001'$$);
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, '9001', 'ROLL FICTICIO NUEVO', 1, case t.numero_factura when 'X' then 9999 when 'N' then 100 else 200 end, 3
from public.pos_ndf_tickets t where t.local = 'prueba-198' and t.numero_factura in ('X', 'N', 'M');
select pg_temp.p('otro_local_no_se_mezcla', $$select count(*)::text from public.pos_productos where local = 'santa-teresa' and codigo in ('9001', '9002', '9003', '9004', '9005', '9006', '9007', '9008') and nombre like '%FICTICI%'$$);

-- Función, como owner
select pg_temp.como('owner');
select pg_temp.p('owner_ficticio', $$select jsonb_build_object('neta_cts', j->'neta_cts', 'sin_lineas', j->'sin_lineas', 'productos', j->'productos', 'meses', j->'meses', 'catalogo', j->'catalogo')::text from (select public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23') j) x$$);
select pg_temp.p('paridad_190_ficticio', $$select (public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23')->>'neta_cts') || ' vs ' || (select sum((e->>1)::numeric) from jsonb_array_elements(public.pos_ventas_resumen('prueba-198', '2026-11-01', '2026-11-23')->'dias') e)$$);
select pg_temp.p('mutacion_sumar_fam17', $$select (select sum((e->>5)::numeric) from jsonb_array_elements(public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23')->'productos') e where (e->>2) is null or (e->>2)::int not in (6, 20))::text$$);
select pg_temp.p('paridad_190_ayer', $$select (public.pos_ventas_productos('santa-teresa', '2026-11-23', '2026-11-23')->>'neta_cts') = (select coalesce(sum((e->>1)::numeric), 0) from jsonb_array_elements(public.pos_ventas_resumen('santa-teresa', '2026-11-23', '2026-11-23')->'dias') e)::text$$);
select pg_temp.p('paridad_190_mes_a_la_fecha', $$select ((public.pos_ventas_productos('santa-teresa', '2026-11-01', '2026-11-23')->>'neta_cts') = (select coalesce(sum((e->>1)::numeric), 0) from jsonb_array_elements(public.pos_ventas_resumen('santa-teresa', '2026-11-01', '2026-11-23')->'dias') e)::text)::text$$);
select pg_temp.p('paridad_190_octubre', $$select ((public.pos_ventas_productos('santa-teresa', '2026-10-01', '2026-10-31')->>'neta_cts') = (select coalesce(sum((e->>1)::numeric), 0) from jsonb_array_elements(public.pos_ventas_resumen('santa-teresa', '2026-10-01', '2026-10-31')->'dias') e)::text)::text$$);
select set_config('p198.t1', clock_timestamp()::text, true);
select pg_temp.p('paridad_190_anio', $$select ((j->>'neta_cts') = (select coalesce(sum((e->>1)::numeric), 0) from jsonb_array_elements(public.pos_ventas_resumen('santa-teresa', '2025-11-24', '2026-11-23')->'dias') e)::text)::text || ' productos=' || jsonb_array_length(j->'productos') || ' meses=' || jsonb_array_length(j->'meses') || ' catalogo=' || jsonb_array_length(j->'catalogo') || ' sin_lineas=' || (j->'sin_lineas'->>'facturas') || ' bytes=' || length(j::text) from (select public.pos_ventas_productos('santa-teresa', '2025-11-24', '2026-11-23') j) x$$);
select pg_temp.p('anio_ms_las_dos', $$select round(extract(epoch from clock_timestamp() - current_setting('p198.t1')::timestamptz) * 1000)::text$$);
select set_config('p198.t2', clock_timestamp()::text, true);
select pg_temp.p('solo_productos_731_dias', $$select length(public.pos_ventas_productos('santa-teresa', '2024-11-24', '2026-11-23')::text)::text$$);
select pg_temp.p('solo_productos_731_ms', $$select round(extract(epoch from clock_timestamp() - current_setting('p198.t2')::timestamptz) * 1000)::text$$);
select pg_temp.p('cierre_meses_vs_productos', $$select ((select sum((e->>4)::numeric) from jsonb_array_elements(j->'meses') e) = (select sum((e->>5)::numeric) from jsonb_array_elements(j->'productos') e))::text from (select public.pos_ventas_productos('santa-teresa', '2026-10-01', '2026-11-23') j) x$$);
select pg_temp.p('rango_732', $$select public.pos_ventas_productos('santa-teresa', '2024-11-22', '2026-11-23')::text$$);
select pg_temp.p('rango_invertido', $$select public.pos_ventas_productos('santa-teresa', '2026-11-23', '2026-11-22')::text$$);
select pg_temp.p('owner_lee_tabla', $$select count(*)::text from public.pos_productos$$);
select pg_temp.p('owner_insert_directo', $$insert into public.pos_producto_ajustes (local, codigo, rinde_personas) values ('prueba-198', '9002', 3) returning 'entró'$$);
select pg_temp.p('owner_update_catalogo', $$update public.pos_productos set nombre = 'HACK' where local = 'prueba-198' returning 'entró'$$);

-- «Rinde» y categoría por código (D-2 = C). La categoría NUNCA mueve la venta neta.
select pg_temp.p('neta_antes', $$select public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23')->>'neta_cts'$$);
select pg_temp.p('categorias_antes', $$select string_agg((e->>0) || '/' || coalesce(e->>2, 'null') || '=' || (e->>7), ' | ' order by e->>0, e->>2) from jsonb_array_elements(public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23')->'productos') e$$);
select public.pos_producto_ajuste_guardar('prueba-198', ' 9002 ', 6, 'comida');
select pg_temp.p('owner_guarda_los_dos', $$select (select rinde_personas::text || '/' || categoria || ' por=' || (actualizado_por is not null)::text from public.pos_producto_ajustes where local = 'prueba-198' and codigo = '9002')$$);
select pg_temp.p('categorias_despues', $$select string_agg((e->>0) || '/' || coalesce(e->>2, 'null') || '=' || (e->>7), ' | ' order by e->>0, e->>2) from jsonb_array_elements(public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23')->'productos') e$$);
select pg_temp.p('neta_no_cambia_con_categoria', $$select (public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23')->>'neta_cts') || ' vs ' || (select sum((e->>1)::numeric) from jsonb_array_elements(public.pos_ventas_resumen('prueba-198', '2026-11-01', '2026-11-23')->'dias') e)$$);
select pg_temp.p('venta_por_categoria_cierra_con_neta', $$select ((select sum((e->>5)::numeric) from jsonb_array_elements(j->'productos') e where (e->>7) not in ('cortesia', 'personal', 'ingredientes')) + (j->'sin_lineas'->>'cts')::numeric)::text || ' vs ' || (j->>'neta_cts') from (select public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23') j) x$$);
select pg_temp.p('meses_por_categoria_cierra_con_neta', $$select ((select sum((e->>4)::numeric) from jsonb_array_elements(j->'meses') e where (e->>5) not in ('cortesia', 'personal', 'ingredientes')) + (j->'sin_lineas'->>'cts')::numeric)::text || ' vs ' || (j->>'neta_cts') from (select public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23') j) x$$);
select pg_temp.p('comida_y_bebida_despues', $$select 'comida ' || coalesce(sum((e->>5)::numeric) filter (where e->>7 = 'comida'), 0) || ' · bebida ' || coalesce(sum((e->>5)::numeric) filter (where e->>7 = 'bebida'), 0) from jsonb_array_elements(public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23')->'productos') e$$);
select pg_temp.p('catalogo_trae_los_dos', $$select (select (e->>3) || '/' || (e->>6) from jsonb_array_elements(public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23')->'catalogo') e where e->>0 = '9002')$$);
-- `menu_especial`: es venta. El ítem por comensal va ahí; los pasos del menú (en ₡0) siguen en comida o bebida.
select public.pos_producto_ajuste_guardar('prueba-198', '9001', 1, 'menu_especial');
select pg_temp.p('menu_especial_es_venta', $$select 'menu_especial ' || coalesce(sum((e->>5)::numeric) filter (where e->>7 = 'menu_especial'), 0) || ' · comida ' || coalesce(sum((e->>5)::numeric) filter (where e->>7 = 'comida'), 0) from jsonb_array_elements(public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23')->'productos') e$$);
select pg_temp.p('neta_no_cambia_con_menu_especial', $$select (public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23')->>'neta_cts') || ' vs ' || (select sum((e->>1)::numeric) from jsonb_array_elements(public.pos_ventas_resumen('prueba-198', '2026-11-01', '2026-11-23')->'dias') e)$$);
select pg_temp.p('venta_por_categoria_cierra_con_menu_especial', $$select ((select sum((e->>5)::numeric) from jsonb_array_elements(j->'productos') e where (e->>7) not in ('cortesia', 'personal', 'ingredientes')) + (j->'sin_lineas'->>'cts')::numeric)::text || ' vs ' || (j->>'neta_cts') from (select public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23') j) x$$);
select pg_temp.p('unidades_en_cero', $$select string_agg((e->>0) || '/' || coalesce(e->>2, 'null') || '/' || (e->>3) || '=' || (e->>4) || ' u, ' || (e->>8) || ' en cero', ' | ' order by e->>0, e->>2, e->>3) from jsonb_array_elements(public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23')->'productos') e where e->>0 in ('9001', '9006', '9008')$$);
select pg_temp.p('categoria_cortesia', $$select public.pos_producto_ajuste_guardar('prueba-198', '9002', 6, 'cortesia')::text$$);
select pg_temp.p('categoria_personal', $$select public.pos_producto_ajuste_guardar('prueba-198', '9002', 6, 'personal')::text$$);
select pg_temp.p('categoria_ingredientes', $$select public.pos_producto_ajuste_guardar('prueba-198', '9002', 6, 'ingredientes')::text$$);
select pg_temp.p('categoria_pax', $$select public.pos_producto_ajuste_guardar('prueba-198', '9002', 6, 'pax')::text$$);
select pg_temp.p('categoria_giftcard', $$select public.pos_producto_ajuste_guardar('prueba-198', '9002', 6, 'giftcard')::text$$);
select pg_temp.p('categoria_duenos', $$select public.pos_producto_ajuste_guardar('prueba-198', '9002', 6, 'duenos')::text$$);
select pg_temp.p('categoria_en_mayusculas', $$select public.pos_producto_ajuste_guardar('prueba-198', '9002', 6, 'COMIDA')::text$$);
select pg_temp.p('categoria_vacia', $$select public.pos_producto_ajuste_guardar('prueba-198', '9002', 6, '')::text$$);
select pg_temp.p('categoria_a_producto_de_cortesia', $$select public.pos_producto_ajuste_guardar('prueba-198', '9003', 1, 'comida')::text$$);
select pg_temp.p('categoria_a_producto_de_personal', $$select public.pos_producto_ajuste_guardar('prueba-198', '9004', 1, 'comida')::text$$);
select pg_temp.p('categoria_a_ingrediente', $$select public.pos_producto_ajuste_guardar('prueba-198', '9005', 1, 'bebida')::text$$);
select pg_temp.p('categoria_a_gift_card', $$select public.pos_producto_ajuste_guardar('prueba-198', '9007', 1, 'comida')::text$$);
select pg_temp.p('rinde_a_producto_de_cortesia_si', $$select coalesce(public.pos_producto_ajuste_guardar('prueba-198', '9003', 2, null)::text, 'ok')$$);
select pg_temp.p('intentos_no_dejaron_nada', $$select (select string_agg(codigo || '=' || rinde_personas || '/' || coalesce(categoria, '-'), ' | ' order by codigo) from public.pos_producto_ajustes where local = 'prueba-198')$$);
select public.pos_producto_ajuste_guardar('prueba-198', '9006', 1, 'bebida');
select pg_temp.p('owner_rinde_21', $$select public.pos_producto_ajuste_guardar('prueba-198', '9002', 21, null)::text$$);
select pg_temp.p('owner_rinde_0', $$select public.pos_producto_ajuste_guardar('prueba-198', '9002', 0, null)::text$$);
select pg_temp.p('owner_rinde_null', $$select public.pos_producto_ajuste_guardar('prueba-198', '9002', null, null)::text$$);
select pg_temp.p('owner_producto_desconocido', $$select public.pos_producto_ajuste_guardar('prueba-198', '9999', 2, null)::text$$);
select pg_temp.p('catalogo_entero', $$select (j->'productos')::text || ' editables=' || (j->'categorias_editables')::text || ' fijas=' || (j->'categorias_fijas')::text from (select public.pos_catalogo_productos('prueba-198') j) x$$);
select pg_temp.p('neta_despues_de_todo', $$select (public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23')->>'neta_cts') || ' vs ' || (select sum((e->>1)::numeric) from jsonb_array_elements(public.pos_ventas_resumen('prueba-198', '2026-11-01', '2026-11-23')->'dias') e)$$);
select pg_temp.p('venta_por_categoria_cierra_despues_de_todo', $$select ((select sum((e->>5)::numeric) from jsonb_array_elements(j->'productos') e where (e->>7) not in ('cortesia', 'personal', 'ingredientes')) + (j->'sin_lineas'->>'cts')::numeric)::text || ' vs ' || (j->>'neta_cts') from (select public.pos_ventas_productos('prueba-198', '2026-11-01', '2026-11-23') j) x$$);
select public.pos_producto_ajuste_guardar('prueba-198', '9002', 1, null);
select public.pos_producto_ajuste_guardar('prueba-198', '9003', 1, null);
select pg_temp.p('todo_por_defecto_borra', $$select (select string_agg(codigo || '=' || rinde_personas || '/' || coalesce(categoria, '-'), ' | ' order by codigo) from public.pos_producto_ajustes where local = 'prueba-198')$$);

select pg_temp.como('contador');
select pg_temp.p('contador_funcion', $$select (public.pos_ventas_productos('santa-teresa', '2026-11-23', '2026-11-23') ? 'productos')::text$$);
select pg_temp.p('contador_lee_tabla', $$select count(*)::text from public.pos_productos$$);
select pg_temp.p('contador_catalogo', $$select jsonb_array_length(public.pos_catalogo_productos('prueba-198')->'productos')::text$$);
select pg_temp.p('contador_ajuste_rinde', $$select public.pos_producto_ajuste_guardar('prueba-198', '9002', 2, null)::text$$);
select pg_temp.p('contador_ajuste_categoria', $$select public.pos_producto_ajuste_guardar('santa-teresa', '8001', 1, 'comida')::text$$);
select pg_temp.como('manager');
select pg_temp.p('manager_locales', $$select public.mis_locales()::text$$);
select pg_temp.p('manager_local_ajeno', $$select (public.pos_ventas_productos('prueba-198', '2026-11-23', '2026-11-23') ? 'productos')::text$$);
select pg_temp.p('manager_ajuste_local_ajeno', $$select public.pos_producto_ajuste_guardar('prueba-198', '9002', 2, 'comida')::text$$);
select pg_temp.p('manager_catalogo_local_ajeno', $$select public.pos_catalogo_productos('prueba-198')::text$$);
select pg_temp.p('manager_local_ajeno_no_dejo_nada', $$select count(*)::text from public.pos_producto_ajustes where local = 'prueba-198' and codigo = '9002'$$);
select public.pos_producto_ajuste_guardar('santa-teresa', '8004', 2, 'bebida');
select pg_temp.p('manager_ajuste_en_su_local', $$select (select rinde_personas::text || '/' || categoria from public.pos_producto_ajustes where local = 'santa-teresa' and codigo = '8004')$$);
select pg_temp.p('manager_catalogo_su_local', $$select (select (e->>3) || '/' || (e->>4) || '/' || (e->>5) from jsonb_array_elements(public.pos_catalogo_productos('santa-teresa')->'productos') e where e->>0 = '8004')$$);
select pg_temp.p('manager_tabla_local_ajeno', $$select count(*)::text from public.pos_productos where local = 'prueba-198'$$);
select pg_temp.p('manager_tabla_total', $$select count(*)::text from public.pos_productos$$);
select pg_temp.como('salonero');
select pg_temp.p('salonero_funcion', $$select public.pos_ventas_productos('santa-teresa', '2026-11-23', '2026-11-23')::text$$);
select pg_temp.p('salonero_tablas', $$select (select count(*) from public.pos_productos)::text || '/' || (select count(*) from public.pos_familias) || '/' || (select count(*) from public.pos_producto_ajustes)$$);
select pg_temp.p('salonero_ajuste', $$select public.pos_producto_ajuste_guardar('santa-teresa', '8001', 2, null)::text$$);
select pg_temp.p('salonero_catalogo', $$select public.pos_catalogo_productos('santa-teresa')::text$$);
select pg_temp.p('salonero_refrescar', $$select public.pos_catalogo_refrescar('santa-teresa')::text$$);
select pg_temp.como('cajero');
select pg_temp.p('cajero_funcion', $$select public.pos_ventas_productos('santa-teresa', '2026-11-23', '2026-11-23')::text$$);
select pg_temp.como('nadie');
select pg_temp.p('anon_privilegios', $$select has_function_privilege('anon', 'public.pos_ventas_productos(text,date,date)', 'execute')::text || has_function_privilege('anon', 'public.pos_producto_ajuste_guardar(text,text,integer,text)', 'execute')::text || has_function_privilege('anon', 'public.pos_catalogo_productos(text)', 'execute')::text || has_function_privilege('authenticated', 'public.pos_categoria_efectiva(integer,text,text)', 'execute')::text || has_table_privilege('anon', 'public.pos_productos', 'select')::text || has_function_privilege('authenticated', 'public.pos_catalogo_absorber(uuid[])', 'execute')::text$$);
select pg_temp.p('sin_sesion_funcion', $$select public.pos_ventas_productos('santa-teresa', '2026-11-23', '2026-11-23')::text$$);
select pg_temp.p('sin_sesion_ajuste', $$select public.pos_producto_ajuste_guardar('santa-teresa', '8001', 2, null)::text$$);
-- Ni por debajo de la función (dueño de la base): el `check` de la tabla tampoco deja guardar una categoría que no es venta
select pg_temp.p('tabla_no_acepta_cortesia', $$insert into public.pos_producto_ajustes (local, codigo, categoria) values ('prueba-198', '9002', 'cortesia') returning 'entró'$$);
select pg_temp.p('tabla_no_acepta_fila_vacia', $$insert into public.pos_producto_ajustes (local, codigo) values ('prueba-198', '9002') returning 'entró'$$);

-- Mutación: el catálogo roto NO frena la ingesta
alter function public.pos_catalogo_absorber(uuid[]) rename to pos_catalogo_absorber_roto;
select pg_temp.p('ingesta_con_catalogo_roto', $$with i as (insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia) select t.id, '9050', 'ENTRA IGUAL', 1, 1, 3 from public.pos_ndf_tickets t where t.local = 'prueba-198' and t.numero_factura = 'A' returning 1) select (select count(*) from i)::text || ' línea; en catálogo: ' || (select count(*) from public.pos_productos where codigo = '9050')$$);
alter function public.pos_catalogo_absorber_roto(uuid[]) rename to pos_catalogo_absorber;
select public.pos_catalogo_refrescar('prueba-198');
select pg_temp.p('refrescar_repara', $$select 'en catálogo: ' || (select count(*) from public.pos_productos where codigo = '9050')$$);
```
