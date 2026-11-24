# SPEC — Ventas v2 · fase 3.1: catálogo único de productos desde el PoS

**Estado:** PROPUESTA (24-nov-2026), escrita contra `main` = `9312c23`. Desarrolla la fila 3.1 de
[SPEC-ventas-v2.md](./SPEC-ventas-v2.md) (§0, §8 y §9) con las decisiones **D8** (catálogo único por código, firmada
el 17-nov) y **D17** (el catálogo sale del PoS; a mano solo «cuántas personas rinde», 23-nov).
**No autoriza código ni esquema.** La migración 196 de §6 es una propuesta escrita dentro de este documento: el
archivo no existe en `supabase/migrations/` y no se aplicó en ninguna base. Necesita la **firma del dueño** (🖊️).
El dueño no estaba disponible al escribirla: lo que hubo que suponer está marcado **Supuesto** (lista en §9.4) y lo
que le toca decidir está en §9.3.

**Cómo se verificó:** lecturas de solo lectura en staging (`hwiatgic…`, `begin read only` … `rollback`) para medir
los datos (§7.1), y la migración con su batería en un Postgres 16 local y vacío (el método de
`scripts/sql/193_base_local.sql`), en una transacción que termina en `rollback` (§8.1). **La corrida completa en
staging quedó NO PROBADA:** el conector pidió una confirmación que nadie pudo responder y, por la regla 14 de
`ESTADO.md`, no se reintentó ni se reescribió el SQL. Prod no se tocó ni se leyó.

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

Un **catálogo único por código**, que **sale solo del PoS** (código, nombre, familia y categoría), por local, y una
función de lectura `pos_ventas_productos` que devuelve las ventas ya sumadas por producto. Nadie clasifica a mano.
Lo único que una persona carga es **cuántas personas rinde** un producto (D17); el costo llega con Inventario.

La 3.1 **no cambia ningún número en pantalla**: deja listo el dato para la 3.2 («Productos» definitiva).

### 1.3 Qué cambia para el usuario, por rol

| Rol | Con el PR 3.1a (esquema y lector) | Con el PR 3.1b (pantalla) |
|---|---|---|
| Dueño | Nada visible | En Ventas → Ajustes ya no está «Productos»; aparece **«Rinde»**: una lista corta de los productos que rinden más de una persona, con buscador para sumar otro. «Mix» e «Ing. Menú» siguen igual hasta la 3.2 |
| Encargado (manager) | Nada visible | Lo mismo, solo de su local |
| Contador | Nada visible | Nada (no veía «Ajustes → Productos» y no ve «Rinde») |
| Salonero, cajero y resto | Nada | Nada. Mi Rendimiento sigue leyendo lo de hoy (§5) |

## 2. Fuente y modelo

### 2.1 De dónde sale cada dato

| Dato | Fuente | Quién lo escribe |
|---|---|---|
| Código, nombre y familia del producto | Cada línea de factura del PoS (`pos_ndf_ticket_lines.codigo_producto`, `nombre`, `familia`) | El disparador de §4.4, solo |
| Nombre de la familia y su categoría | La tabla de familias del PoS (`FAC_Clasificaciones`), cargada por la migración (§6) | La migración; nadie desde la app |
| Cuántas personas rinde | Una persona, en «Ajustes → Rinde» | `pos_producto_rinde_guardar` (§4.3) |
| Costo | **No entra en la 3.1.** Llega con Inventario (§2.4) | — |

### 2.2 Tres niveles, siempre en el mismo orden

El PoS manda **un solo nivel** de clasificación: la familia (un número). **Supuesto S1:** la «categoría» de D17 es
el grupo al que pertenece la familia, que ya existe en el código (`mapCategoria` de `mapTicket.ts`) y en las
cuentas firmadas. Queda así:

**Categoría → Familia → Producto**, ordenado por categoría (orden fijo), después por el orden de la familia y
después por nombre.

| Orden | Categoría | Familias de Santa Teresa | ¿Es venta neta? |
|---|---|---|---|
| 1 | `comida` | 2, 3, 16, 13, 4, 29 | Sí |
| 2 | `bebida` | 5 | Sí |
| 3 | `extras` | 22 | Sí |
| 4 | `otros` | 11, 15, 25 y cualquier familia sin fila (1, 9, 27…) | Sí |
| 5 | `merch` | 21, 23, 24, 26 | Sí |
| 6 | `giftcard` | 12 | Sí |
| 7 | `pax` | 19 | Sí |
| 8 | `duenos` | 28 | Sí |
| 9 | `cortesia` | 17 | **No** |
| 10 | `personal` | 6 | **No** |
| 11 | `ingredientes` | 20 | **No** |

- La categoría **no redefine nada**: comida = {2, 3, 4, 13, 16, 29} y bebida = {5} son los conjuntos de §4.1 de la
  SPEC de Ventas v2; fuera de la venta = {6, 17, 20} es `FAMILIAS_NO_VENTA` (`netaVenta.ts`, firmada). La función
  de §3 lleva ese conjunto escrito, igual que la 190 y la 193, y una prueba cuida que las tres categorías de abajo
  coincidan con él (§8).
- Una familia que el PoS manda y no tiene fila se muestra **«Familia N»** dentro de `otros`, con un aviso. No se
  pierde plata ni se esconde.
- Los nombres de familia se muestran como están en el PoS.

### 2.3 Lo único editable: «cuántas personas rinde»

- **Qué es (Supuesto S2, decisión D-1):** el `multiplicador` de hoy con otro nombre. Una botella que rinde 4
  cuenta como 4 bebidas en «bebidas por persona», en el precio por ítem y en la popularidad de la ingeniería de
  menú. **No** suma personas a la factura ni toca la venta por persona (D4, firmada).
- **Cómo se guarda:** tabla aparte `pos_producto_ajustes (local, codigo, rinde_personas)`, separada del catálogo
  porque la escriben manos distintas: el catálogo lo escribe una máquina y se puede rehacer entero desde las
  facturas; el ajuste lo escribe una persona y no se puede rehacer. Sin fila = rinde 1. Valores de 2 a 20 (el
  tope que ya tiene la pantalla de hoy). Guarda quién y cuándo lo cambió por última vez.
- **Por dónde se escribe:** una sola puerta, `pos_producto_rinde_guardar`, que valida el rol, el local del manager,
  el rango y que el código exista. La API no puede escribir la tabla directo.
- **Qué se hereda:** los `multiplicador` mayores que 1 que ya están en `product_map` pasan por nombre a su código
  (§7.2).

### 2.4 El costo, cuando llegue Inventario

No hay columna de costo en la 196, a propósito: un costo cambia en el tiempo y necesita vigencia y origen (receta
o carga a mano), que son diseño de Inventario ([SPEC-inventario-v0](../inventario/SPEC-inventario-v0.md), F3
«Recetas → consumo teórico»). Lo que esta spec deja preparado:

- La clave para colgarlo: `(local, codigo)` de `pos_productos`. Hoy las recetas se atan al producto **por nombre**
  (`InvRecetas.tsx` → `product_map.costo_unitario`); con el catálogo por código se atan por código.
- Forma sugerida, a definir en la spec de Inventario: `pos_producto_costos (local, codigo, desde, costo, origen)`.
- Ojo para Nosara: el catálogo de **insumos** de Inventario apunta a «un solo código para los dos locales»
  (D-INV-5); los **productos del PoS** son por local, porque cada local tiene su PoS con su numeración. Una receta
  compartida va a necesitar su código en cada local.
- Mientras tanto «Ing. Menú» sigue leyendo `product_map.costo_unitario` como hoy (decisión D-6).

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
| `productos` | `[codigo, nombre, familia, canal, unidades, monto_cts, facturas]` | El mix del período. Una fila por (código, familia de la línea, canal). `codigo` null = línea sin código, agrupada por nombre |
| `meses` | `[mes 'AAAA-MM', familia, canal, unidades, monto_cts]` | El gráfico de 12 meses por categoría (D5) con un solo pedido |
| `catalogo` | `[codigo, nombre, familia, rinde, visto_desde, visto_hasta]` | Nombre y familia vigentes y «rinde». Trae lo vendido en el período más lo visto desde 90 días antes de `p_desde` (para «Sin ventas en el período») |
| `familias` | `[familia, nombre, categoria, orden]` | Rótulos y orden |
| `sin_lineas` | `{facturas, cts}` | Facturas sin ninguna línea guardada: su `valor_servido_crc`, aparte |
| `neta_cts` | número | Σ `monto_cts` de las líneas con familia null o fuera de {6, 17, 20}, más `sin_lineas.cts` |

**Reglas (las mismas de la 190; las cuida la batería):**

- `monto_cts` = Σ por línea de `floor(monto × 100 + 0,5)`: céntimos enteros.
- `unidades` = Σ por línea de `floor(cantidad + 0,5)` (el `Math.round` de la app). Vienen **todas** las familias,
  también las que no son venta; la pantalla decide qué muestra.
- **La plata sigue a la familia de la línea,** no a la del catálogo. Si un código cambió de familia, en el período
  aparece una fila por familia; la pantalla lo muestra una sola vez, en su familia vigente. Así
  **`neta_cts` = Σ `dias[].neta_cts` de `pos_ventas_resumen` para el mismo local y rango, al céntimo**: «Productos»
  cierra contra «Resumen».
- El nombre de `productos` es el de las líneas del período; el que se muestra es el de `catalogo` (el vigente).
- Tres bases de comparación = tres llamados en paralelo (período y dos bases): dentro del tope de 3 pedidos.

**Lo que no trae, a propósito:** la dimensión salonero (la ficha del salonero sigue con su lector) y el día (el
detalle por día está en «Resumen»). Si la 3.2 los necesita, es una función hermana, no un cambio de esta.

## 4. Tablas

### 4.1 `pos_familias` — familias del PoS por local

| Columna | Tipo | Nota |
|---|---|---|
| `local` | `text not null` | Slug del local |
| `familia` | `integer not null` | Número de la familia en el PoS |
| `nombre` | `text not null` | Sin espacios sobrantes, no vacío |
| `categoria` | `text not null` | Una de las 11 de §2.2 (`check`) |
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
| `rinde_personas` | `integer not null` | Entre 2 y 20 (`check`). Rinde 1 = sin fila |
| `actualizado_en` | `timestamptz not null` | |
| `actualizado_por` | `uuid` | `auth.uid()` de quien lo guardó; null = heredado por la migración |

**RLS de las tres:** activada. Una sola política por tabla, de **lectura**: owner y contador activos, y el manager
solo en sus locales (`puede_ver_local`). **Ninguna política de escritura** y sin permisos de `insert`, `update` ni
`delete` para la API: el catálogo lo escribe el disparador y el ajuste, la función. `anon` no tiene nada.

### 4.4 Cómo se refresca el catálogo: disparador

**Elegido:** un disparador `after insert … for each statement` en `pos_ndf_ticket_lines`, con tabla de transición.
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
   plata y las unidades salen igual; solo faltaría el nombre vigente y el «rinde» de ese código, y
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
| `pos_producto_rinde_guardar` | Sí | Solo sus locales | `42501` | `42501` | Sin `execute` |
| `pos_catalogo_refrescar`, `pos_catalogo_absorber` | No (solo `service_role`) | No | No | No | No |
| Escribir las tablas por la API | No | No | No | No | No |

- `pos_ndf_*` **siguen cerradas a gerencia** (regla 6 de `ESTADO.md`): la 196 no les cambia ninguna política;
  solo les suma el disparador.
- Las funciones nuevas **nacen** limitando al manager a su local (como la 193). La deuda de la 067, la 080 y la
  190 sigue aparte (backlog, con firma).
- **Supuesto S3:** «rinde» lo editan owner y manager, que son quienes hoy entran a «Ajustes → Productos»
  (`ventasTabs.ts`); el contador solo lo ve en los reportes (decisión D-7).
- **El personal no lee el catálogo nuevo.** Mi Rendimiento sigue como hoy: `product_map` (lectura para todo rol
  activo, migración 093) y la función de la 194, que cruza por nombre. Se pasa al catálogo por código en la 3.6,
  con otra migración firmada (§10).
- Las pantallas siguen el reparto de §6 de la SPEC de Ventas v2: sin cambios, salvo que «Ajustes — productos» pasa
  a llamarse «Ajustes — rinde», con los mismos roles.

## 6. Migración PROPUESTA `196_pos_catalogo_productos.sql`

> **No es un archivo del repo.** Se copia a `supabase/migrations/` recién en el PR 3.1a, con la firma. Número: 196,
> el próximo libre del bloque 150–199 (`ESTADO.md`, 24-nov; ningún PR abierto lo usa). Si al mergear ya está
> tomado, se renumera al siguiente libre en el mismo PR. El PR 3.1a también la registra en
> `supabase/migraciones-reservadas.json` y en la tabla de `ESTADO.md`, y trae su `PASE-196`.

```sql
-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 196 · Ventas v2 3.1: catálogo único por código desde el PoS + `pos_ventas_productos`   ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- PROPUESTA. Sin firma no se crea el archivo en supabase/migrations ni se aplica en ninguna base.
-- D8 (catálogo único por código) y D17 (el catálogo sale del PoS; a mano solo «cuántas personas rinde»).
--
-- Agrega (no reemplaza nada vivo; por eso no lleva guarda de md5, R13):
--   1. `pos_familias`          (local, familia)  → nombre de la familia del PoS y su categoría.
--   2. `pos_productos`         (local, codigo)   → nombre y familia vigentes de cada producto visto en facturas.
--   3. `pos_producto_ajustes`  (local, codigo)   → lo ÚNICO que se carga a mano: `rinde_personas` (2 a 20).
--   4. `pos_catalogo_absorber` + disparador en `pos_ndf_ticket_lines` (AFTER INSERT, por sentencia): mantiene 2.
--      Nunca frena la ingesta: si falla, avisa (WARNING) y la factura entra igual.
--   5. `pos_catalogo_refrescar(p_local)`: la misma regla sobre toda la historia (carga inicial y reparación).
--   6. `pos_ventas_productos(p_local, p_desde, p_hasta)` → jsonb de SOLO LECTURA para «Productos».
--   7. `pos_producto_rinde_guardar(p_local, p_codigo, p_rinde)`: la única puerta de escritura de 3.
--
-- NO toca `pos_ndf_*` (salvo sumar el disparador), `product_map`, la 067, la 190, la 193 ni la 194.
-- NO devuelve medios de pago, mesas, saloneros ni `clase_ingreso` (regla 6 de ESTADO).
-- Vuelta atrás: scripts/sql/196_rollback.sql. Pruebas: scripts/sql/196_pruebas.sql (terminan en ROLLBACK).

-- ── 0. Guarda: si algo de esto ya existe, se para sin tocar nada ─────────────────────────
do $guarda196$
declare
  o text;
begin
  if to_regprocedure('public.puede_ver_local(text)') is null or to_regprocedure('public.get_my_role()') is null then
    raise exception '196: falta puede_ver_local (091) o get_my_role';
  end if;
  foreach o in array array['public.pos_familias', 'public.pos_productos', 'public.pos_producto_ajustes'] loop
    if to_regclass(o) is not null then
      raise exception '196: % ya existe: se para sin tocar nada', o;
    end if;
  end loop;
  foreach o in array array['public.pos_catalogo_absorber(uuid[])', 'public.pos_catalogo_registrar()',
                           'public.pos_catalogo_refrescar(text)', 'public.pos_ventas_productos(text,date,date)',
                           'public.pos_producto_rinde_guardar(text,text,integer)'] loop
    if to_regprocedure(o) is not null then
      raise exception '196: % ya existe: se para sin tocar nada', o;
    end if;
  end loop;
end
$guarda196$;

-- ── 1. Familias del PoS por local ────────────────────────────────────────────────────────
create table public.pos_familias (
  local     text    not null,
  familia   integer not null,
  nombre    text    not null check (nombre = btrim(nombre) and nombre <> ''),
  categoria text    not null check (categoria in ('comida', 'bebida', 'extras', 'otros', 'merch', 'giftcard',
                                                  'pax', 'duenos', 'cortesia', 'personal', 'ingredientes')),
  orden     integer not null default 999,
  primary key (local, familia)
);
comment on table public.pos_familias is
  'Mig 196. Familias del PoS (FAC_Clasificaciones) por local: nombre y categoría. La carga la migración; nadie la edita desde la app. Una familia sin fila se muestra «Familia N» en «otros».';

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
  'Mig 196. Catálogo único por (local, código) del PoS. Lo escribe SOLO el disparador de pos_ndf_ticket_lines (y pos_catalogo_refrescar). Nombre y familia = los de la factura más reciente. visto_* = día CR de la primera y la última factura (cualquier estado) que lo trae.';

-- ── 3. Lo único que se carga a mano ──────────────────────────────────────────────────────
create table public.pos_producto_ajustes (
  local           text        not null,
  codigo          text        not null,
  rinde_personas  integer     not null check (rinde_personas between 2 and 20),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid,
  primary key (local, codigo),
  foreign key (local, codigo) references public.pos_productos (local, codigo)
);
comment on table public.pos_producto_ajustes is
  'Mig 196. Cuántas personas rinde un producto (combo, botella para compartir). Sin fila = 1. Se escribe solo por pos_producto_rinde_guardar (owner; manager de su local).';

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
    raise warning '196 pos_catalogo_registrar: % (%)', sqlerrm, sqlstate;
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

-- Familias de santa-teresa. Los nombres son los del PoS; los marcados «POR CONFIRMAR» se leen en la PC del
-- PoS (solo lectura) antes del pase. Categoría: la que ya usan las cuentas firmadas (comida 2,3,4,13,16,29 ·
-- bebida 5 · fuera de la venta 6, 17 y 20).
insert into public.pos_familias (local, familia, nombre, categoria, orden) values
  ('santa-teresa',  2, 'TAPAS ASIATICAS',      'comida',       10),
  ('santa-teresa',  3, 'SUSHI ROLLS',          'comida',       20),
  ('santa-teresa', 16, 'POKES BOWLS CEVICHES', 'comida',       30),
  ('santa-teresa', 13, 'KIDS MENU',            'comida',       40),
  ('santa-teresa',  4, 'POSTRES',              'comida',       50),
  ('santa-teresa', 29, 'GREENSEASON',          'comida',       60),
  ('santa-teresa',  5, 'BEBIDAS',              'bebida',       10),
  ('santa-teresa', 22, 'EXTRAS',               'extras',       10),
  ('santa-teresa', 11, 'MENU AÑO NUEVO',       'otros',        10),  -- POR CONFIRMAR
  ('santa-teresa', 15, 'EVENTOS TERRAZA',      'otros',        20),  -- POR CONFIRMAR
  ('santa-teresa', 25, 'PROMOCIONES',          'otros',        30),  -- POR CONFIRMAR
  ('santa-teresa', 21, 'TSHIRTS',              'merch',        10),
  ('santa-teresa', 23, 'T-GORRAS',             'merch',        20),
  ('santa-teresa', 24, 'T-DARUMAS',            'merch',        30),
  ('santa-teresa', 26, 'T-STICKERS',           'merch',        40),
  ('santa-teresa', 12, 'GIFT CARDS',           'giftcard',     10),
  ('santa-teresa', 19, 'A PAX',                'pax',          10),
  ('santa-teresa', 28, 'XX DUEÑOS',            'duenos',       10),
  ('santa-teresa', 17, 'X CORTESIAS',          'cortesia',     10),
  ('santa-teresa',  6, 'PERSONAL',             'personal',     10),
  ('santa-teresa', 20, 'INGREDIENTES',         'ingredientes', 10);

-- «Rinde» que ya estaba cargado en product_map (por nombre) → por código. Si varios códigos comparten el
-- nombre, lo heredan todos (es lo que hoy pasa al cruzar por nombre). Se listan en el PASE para revisar.
insert into public.pos_producto_ajustes (local, codigo, rinde_personas, actualizado_por)
select distinct on (p.local, p.codigo) p.local, p.codigo, least(pm.multiplicador, 20), null
from public.product_map pm
join public.pos_productos p on upper(btrim(p.nombre)) = upper(btrim(pm.nombre))
where pm.multiplicador >= 2
order by p.local, p.codigo, pm.multiplicador desc;

-- ── 6. Ventas por producto (solo lectura) ────────────────────────────────────────────────
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
  pr as (
    -- La plata sigue a la familia DE LA LÍNEA (así cierra contra la neta de la 190 al céntimo).
    select l.codigo, max(l.nombre) as nombre, l.familia, l.canal,
           sum(l.unidades) as unidades, sum(l.monto_cts) as monto_cts, count(distinct l.ticket_id) as facturas
    from l
    group by l.codigo, case when l.codigo is null then upper(coalesce(l.nombre, '')) end, l.familia, l.canal
  ),
  ms as (
    select to_char(l.dia, 'YYYY-MM') as mes, l.familia, l.canal,
           sum(l.unidades) as unidades, sum(l.monto_cts) as monto_cts
    from l group by 1, 2, 3
  ),
  sl as (
    -- Facturas sin ninguna línea guardada: la 190 cuenta su `valor_servido_crc`. Acá van aparte.
    select count(*) as facturas, coalesce(sum(floor(coalesce(t.valor_servido_crc, 0) * 100 + 0.5)), 0) as cts
    from t where not exists (select 1 from l where l.ticket_id = t.id)
  ),
  cat as (
    -- El catálogo que la pantalla necesita: lo vendido en el período + lo visto desde 90 días antes.
    select p.codigo, p.nombre, p.familia, coalesce(a.rinde_personas, 1) as rinde, p.visto_desde, p.visto_hasta
    from public.pos_productos p
    left join public.pos_producto_ajustes a on a.local = p.local and a.codigo = p.codigo
    where p.local = p_local
      and (p.visto_hasta >= p_desde - 90 or p.codigo in (select pr.codigo from pr))
  )
  select jsonb_build_object(
    'productos', coalesce((select jsonb_agg(jsonb_build_array(pr.codigo, pr.nombre, pr.familia, pr.canal,
                             pr.unidades, pr.monto_cts, pr.facturas)
                           order by pr.codigo nulls last, pr.nombre, pr.familia, pr.canal) from pr), '[]'::jsonb),
    'meses',     coalesce((select jsonb_agg(jsonb_build_array(ms.mes, ms.familia, ms.canal, ms.unidades, ms.monto_cts)
                           order by ms.mes, ms.familia, ms.canal) from ms), '[]'::jsonb),
    'catalogo',  coalesce((select jsonb_agg(jsonb_build_array(cat.codigo, cat.nombre, cat.familia, cat.rinde,
                             cat.visto_desde, cat.visto_hasta) order by cat.codigo) from cat), '[]'::jsonb),
    'familias',  coalesce((select jsonb_agg(jsonb_build_array(f.familia, f.nombre, f.categoria, f.orden)
                           order by f.familia) from public.pos_familias f where f.local = p_local), '[]'::jsonb),
    'sin_lineas', (select jsonb_build_object('facturas', sl.facturas, 'cts', sl.cts) from sl),
    'neta_cts',  (select coalesce(sum(l.monto_cts) filter (where l.familia is null or l.familia not in (6, 17, 20)), 0)
                  from l) + (select sl.cts from sl)
  ) into v_out;

  return v_out;
end;
$function$;
revoke all on function public.pos_ventas_productos(text, date, date) from public, anon;
grant execute on function public.pos_ventas_productos(text, date, date) to authenticated;
comment on function public.pos_ventas_productos(text, date, date) is
  'Mig 196. Ventas v2 Productos: por (código, familia de la línea, canal) unidades, céntimos y facturas; por mes × familia × canal; catálogo con «rinde»; familias con categoría; neta_cts = la de la 190. Solo facturas C, día CR. Sin medios de pago. Owner/manager/contador; manager solo sus locales.';

-- ── 7. La única puerta de escritura de «rinde» ───────────────────────────────────────────
create function public.pos_producto_rinde_guardar(p_local text, p_codigo text, p_rinde integer)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rol public.user_role := public.get_my_role();
  v_cod text := nullif(btrim(p_codigo), '');
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
  if not exists (select 1 from public.pos_productos p where p.local = p_local and p.codigo = v_cod) then
    raise exception 'Producto desconocido' using errcode = '22023';
  end if;

  if p_rinde = 1 then
    delete from public.pos_producto_ajustes a where a.local = p_local and a.codigo = v_cod;
  else
    insert into public.pos_producto_ajustes as a (local, codigo, rinde_personas, actualizado_por)
    values (p_local, v_cod, p_rinde, auth.uid())
    on conflict (local, codigo) do update set
      rinde_personas = excluded.rinde_personas, actualizado_en = now(), actualizado_por = excluded.actualizado_por;
  end if;
end;
$function$;
revoke all on function public.pos_producto_rinde_guardar(text, text, integer) from public, anon;
grant execute on function public.pos_producto_rinde_guardar(text, text, integer) to authenticated;
comment on function public.pos_producto_rinde_guardar(text, text, integer) is
  'Mig 196. Guarda cuántas personas rinde un producto (1 = borra el ajuste; 2 a 20). Owner; manager solo de sus locales.';
```

### 6.1 Vuelta atrás propuesta `scripts/sql/196_rollback.sql`

```sql
-- 196 · vuelta atrás. ANTES: guardar lo que cargó una persona (no se puede rehacer):
--   select * from public.pos_producto_ajustes order by local, codigo;
-- Y, en el mismo momento, el PR que saca el .sql de main (si queda, Branching lo reaplica). Si la 196 ya está
-- en el ledger de prod, el .sql NO se borra (regla 10): la vuelta atrás es una migración nueva con este cuerpo.
drop trigger if exists trg_pos_catalogo_registrar on public.pos_ndf_ticket_lines;
drop function if exists public.pos_ventas_productos(text, date, date);
drop function if exists public.pos_producto_rinde_guardar(text, text, integer);
drop function if exists public.pos_catalogo_refrescar(text);
drop function if exists public.pos_catalogo_registrar();
drop function if exists public.pos_catalogo_absorber(uuid[]);
drop table if exists public.pos_producto_ajustes;
drop table if exists public.pos_productos;
drop table if exists public.pos_familias;
```

`product_map` y la 194 no se tocan en ningún momento, así que al volver atrás todo queda como hoy.

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

**Tres avisos sobre esta foto:**

1. En staging `product_map` **no se refresca desde prod** (tiene 8 columnas del PoS propio que prod no tiene;
   `scripts/refresh-staging/PLAN.md`). Las cifras de `product_map` de prod pueden ser otras: el `PASE-196` repite
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
| `tipo` | **Se deja ir** | Lo reemplaza la categoría de la familia. Los dos vocabularios mezclados dejan de importar: nadie más lee esa columna después de la 3.6. Lo único que una persona marcaba a mano y la familia no sabía (`cortesia`, `personal`) ya viene por familia (17 y 6) |
| `clasificacion`, `subclasificacion` | **Se dejan ir** (decisión D-2) | El PoS manda un solo nivel. Es la pérdida real de la 3.1: hoy bebidas se abre en 14 subclasificaciones cargadas a mano; con el catálogo del PoS es una sola familia de 282 productos |
| `multiplicador` | `pos_producto_ajustes.rinde_personas` | Pasa si es ≥ 2, cruzando por nombre sin mirar mayúsculas ni espacios. **Varios códigos con ese nombre:** lo heredan todos (es lo que hoy pasa al cruzar por nombre). **Dos filas que solo difieren en mayúsculas:** gana el mayor. **Mayor que 20:** queda en 20. **Sin producto en el PoS:** no pasa. **0, 1 o null:** rinde 1, sin fila |
| `costo_unitario` | **Se queda en `product_map`** hasta Inventario (§2.4) | «Ing. Menú» lo sigue leyendo. No se copia por código ahora para no fijar un costo sin vigencia en una tabla nueva |

**Un caso que cambia a propósito y hay que mirar en el pase:** hoy el multiplicador no se aplica igual en todos
lados. «Mix» e «Ing. Menú» lo aplican a todo producto; `aggSalonero` (bebidas por persona) solo a las bebidas que
una persona clasificó con el vocabulario de la app (`tipoDeFamilia`). Las 4 filas de staging tienen `tipo`
«SUSHI ROLLS», así que hoy cuentan doble en «Mix» y **no** en bebidas por persona (no son bebidas). Con el catálogo
nuevo la regla es una sola: «rinde» se aplica a las unidades del producto donde la SPEC lo pide (§4.1 de Ventas
v2). Eso se resuelve en la 3.2, con su prueba de paridad y sus excepciones firmadas; la 3.1 solo traslada el dato.

### 7.3 Pasos

1. **PASE-196, lecturas previas (solo lectura, staging y prod):** las de §7.1, más la lista de códigos que van a
   heredar «rinde» (código, nombre y valor) para que el dueño la mire, y los nombres de las familias leídos en la
   PC del PoS (solo lectura) contra la carga de §6.
2. **3.1a:** entra la 196. El catálogo se llena desde la historia y los «rinde» se heredan. `product_map` queda
   intacto y nada lo lee distinto.
3. **3.1b:** «Ajustes → Productos» deja de existir y nadie más escribe `tipo`, `clasificacion` ni
   `subclasificacion`. `product_map` queda **congelado**: lo siguen leyendo «Mix», «Ing. Menú», Mi Rendimiento y
   la 194; lo único que todavía lo escribe es el botón de Recetas que sincroniza el costo.
4. **3.2:** «Productos» definitiva lee `pos_ventas_productos`. Paridad contra el «Mix» viejo antes de retirarlo.
5. **3.6 (migración aparte, firma):** la función de la 194 pasa a cruzar «rinde» por código; `product_map` deja de
   leerse desde Ventas. Recién ahí se decide si la tabla se archiva (no se borra nada sin decisión del dueño).

## 8. Pruebas

### 8.1 SQL: batería en transacción descartada

`scripts/sql/196_pruebas.sql` (anexo A), con el patrón de la 193: `begin` → migración → casos con un local
ficticio y sus propias facturas → vuelta atrás → `rollback`. Corre en staging o en un Postgres vacío con
`scripts/sql/193_base_local.sql` + la 190.

**Resultado en Postgres 16 local (24-nov): 52 casos, todos como se esperaba.** Lo que cubre:

| Grupo | Qué prueba |
|---|---|
| Carga inicial | El catálogo tiene tantas filas como códigos hay en las líneas; correr `pos_catalogo_refrescar` otra vez no escribe nada; los «rinde» heredados son los esperados (varios códigos con un nombre lo heredan todos; gana el mayor; lo que no existe en el PoS no pasa) |
| Disparador | Alta con la primera factura · código con espacios se guarda limpio · línea sin código no entra · nombre nuevo en una factura más reciente pisa · factura vieja reingestada no pisa y sí corre `visto_desde` · otro local no se mezcla |
| Cierre | `neta_cts` = Σ `dias[].neta_cts` de la 190 · Σ `meses` = Σ `productos` · factura sin líneas va a `sin_lineas` · anulada no cuenta · factura de las 23:30 CR entra y la de las 00:10 del día siguiente no |
| Validaciones | 732 días y rango invertido → `22023` |
| Permisos | Owner y contador leen función y tablas · manager: local ajeno → `42501` y 0 filas · salonero, cajero y sin sesión → `42501` y 0 filas · `anon` sin `execute` ni `select` · nadie escribe las tablas por la API, ni el owner · contador no guarda «rinde» · rinde 0, 21 o código desconocido → `22023` · rinde 1 borra la fila |
| Vuelta atrás | Después de `196_rollback.sql` no queda ninguna tabla, función ni disparador |

**Mutaciones (romper a propósito; cada una hizo caer lo que dice):**

| Mutación | Qué cae |
|---|---|
| La familia 17 cuenta como venta | El cierre contra la 190 |
| Se cuentan las facturas anuladas | El cierre contra la 190 |
| El día corta un día después | El cierre contra la 190 (entra la factura de las 00:10) |
| No se suman las facturas sin líneas | El cierre contra la 190 |
| El manager pide cualquier local | «manager: local ajeno» |
| El contador puede guardar «rinde» | «contador no guarda rinde» |
| Una factura vieja pisa el nombre | «factura vieja no pisa» |
| La política de lectura queda abierta | Salonero y manager ven filas que no deben |
| El disparador sin el bloque que captura errores | «La ingesta entra con el catálogo roto» |

**NO PROBADO, queda para el PR 3.1a en staging:** la corrida completa con el volumen real (cuánto tarda la carga
inicial sobre ~234 mil líneas, cuánto dura el bloqueo de `pos_ndf_ticket_lines` al crear el disparador y cuánto
tarda la función con un año), y el cierre contra la 190 con datos reales en ayer, mes a la fecha, último mes
cerrado y un año. La batería ya trae esos casos.

### 8.2 Vitest (PR 3.1a y 3.1b)

| Archivo | Qué cuida | Qué fallaría si se rompe |
|---|---|---|
| `src/shared/api/posNdf.contrato196.test.ts` | Lee el `.sql` (patrón de `contrato067` y `contrato191`): firma, orden de cada arreglo, y que no nombre medios de pago, mesa, salonero ni `clase_ingreso` | Alguien suma una columna de pago, o cambia el orden y la app lee «unidades» donde va «monto» |
| `src/modules/ventas/catalogoPos.test.ts` | Módulo puro nuevo: orden categoría → familia → nombre; familia sin fila → «Familia N» en `otros`; un código con dos familias en el período se muestra una vez; línea sin código; nombre vigente del catálogo | El catálogo sale desordenado o un producto aparece dos veces |
| Mismo archivo | `FAMILIAS_NO_VENTA` de `netaVenta.ts` = el conjunto escrito en el `.sql` = las familias de categoría `cortesia`, `personal` e `ingredientes` de la carga | Una definición firmada queda en dos lugares que no coinciden |
| `src/modules/ventas/__paridad__/productos31.paridad.test.ts` | Las mismas facturas ficticias por el camino viejo (`armarDia`) y por la forma de la función nueva dan la misma neta por familia y canal, al céntimo | «Productos» deja de cerrar contra «Resumen» |
| `src/modules/ventas/ventasTabs.test.ts` | «Rinde»: owner y manager; contador no. `?tab=ajustes&v=productos` y `?tab=config` abren «Rinde» respetando el rol | Un rol ve lo que no debe o un enlace guardado se rompe |
| `VentasRinde.render.test.tsx` | Lista solo los que rinden más de 1; guardar llama a la función con local y código; el manager no ve otro local; valores fuera de 1–20 no se envían | Se guarda un «rinde» inválido o en el local equivocado |
| `src/productMapCongelado.test.ts` | Lista cerrada de archivos que todavía importan `getProductMap` o escriben `product_map`; solo puede achicarse | Código nuevo vuelve a depender del catálogo por nombre |
| `supabase/migraciones.test.ts` (existente) | La 196 registrada, en su bloque y sin repetir | Número duplicado o sin registrar |

Fechas: las pruebas que usan «hoy» fijan el reloj a las 23:30 CR.

## 9. Riesgos, vuelta atrás y decisiones

### 9.1 Riesgos

| Riesgo | Qué tan grave | Cómo se cuida |
|---|---|---|
| El disparador rompe o frena la ingesta del PoS | Alto si pasara: es la evidencia de las ventas | Captura todo error (probado); casi nunca escribe; humo del pase = latido del PoS y facturas entrando antes y después |
| Bloqueo de `pos_ndf_ticket_lines` al crear el disparador y hacer la carga inicial | Bajo: segundos, y el agente reintenta | Medirlo en staging en el 3.1a; pase en la franja libre, fuera del servicio |
| Los nombres de familia marcados «POR CONFIRMAR» (11, 15, 25) salen de un solo producto que coincide | Medio: un rótulo equivocado en un reporte de gerencia | Prerrequisito del pase: leerlos en la PC del PoS. Las familias 1, 9 y 27 no se cargan: salen «Familia N» |
| Se pierde la subclasificación cargada a mano (bebidas en 14 grupos) | Medio para quien mira el mix de bebidas | Decisión D-2; no se borra nada de `product_map` |
| El PoS cambia el nombre o la familia de un código | Bajo (no pasó nunca en los datos) | Gana la factura más reciente; la plata sigue a la familia de cada línea, así que la neta no se mueve |
| Entre la 3.1b y la 3.2, un producto nuevo de merch o cortesía no tiene quién lo clasifique en el «Mix» viejo | Bajo y corto: cae en «otros» del Mix viejo, la venta total no cambia | Mergear la 3.1b pegada a la 3.2, o juntas |
| Cambiar un «rinde» mueve hacia atrás las cifras por persona de todo el histórico | Bajo; hoy el multiplicador ya se comporta así | Queda quién y cuándo. Historial completo de cambios: fuera de alcance (§10) |
| Prod no es igual a staging en `product_map` | Medio | Lecturas previas en prod dentro del PASE, antes de la firma |

### 9.2 Vuelta atrás

- **3.1a:** `196_rollback.sql` (§6.1) y, en el mismo momento, el PR que saca el `.sql` de `main`; si ya está en el
  ledger de prod, el `.sql` se queda y la vuelta atrás es una migración nueva (regla 10). Antes, guardar
  `pos_producto_ajustes`. Como nada viejo se toca, la app queda exactamente como hoy.
- **Solo el disparador,** si diera problemas: `drop trigger trg_pos_catalogo_registrar on public.pos_ndf_ticket_lines`
  (con firma). El catálogo deja de actualizarse, la lectura sigue dando bien la plata, y
  `pos_catalogo_refrescar` lo pone al día cuando se reponga.
- **3.1b:** revert del merge; «Ajustes → Productos» vuelve y `product_map` está como se dejó.

### 9.3 Decisiones para el dueño

La opción recomendada va primero.

| # | Decisión | Opciones | ¿Firma? |
|---|---|---|---|
| **D-1** | Qué quiere decir «cuántas personas rinde» | **A (recomendada):** es el multiplicador de hoy: el producto cuenta como N unidades en bebidas por persona, precio por ítem y popularidad. No toca personas ni venta por persona · B: suma personas a la factura (cambia la venta por persona D4, que está firmada) | A: no · B: sí |
| **D-2** | El PoS manda un solo nivel (familia); la subclasificación cargada a mano se pierde | **A (recomendada):** aceptar un nivel. Si quiere abrir bebidas (cervezas, vinos, cocteles), se crean esas familias **en el PoS**, que es la fuente, y aparecen solas · B: conservar la subclasificación de hoy congelada, solo para leer (los productos nuevos quedan sin grupo) · C: reglas por código en la app (vuelve a ser clasificar a mano) | A: no · B y C: sí (esquema) |
| **D-3** | Familias 11, 15 y 25 (menús especiales, eventos, promociones) | **A (recomendada):** categoría «otros», como cuentan hoy; ningún número se mueve · B: pasarlas a comida o bebida (mueve la relación comida/bebida y bebidas por persona) | A: no · B: sí |
| **D-4** | De dónde salen los nombres de las familias | **A (recomendada):** los carga la migración, confirmados en la PC del PoS; después, en un PR aparte, la ingesta guarda el nombre que el agente ya manda (toca la Edge `ingest-ndf` = prod) · B: el dueño los edita en Ajustes | A: sí, con la 196; la Edge, su propia firma · B: sí |
| **D-5** | Dónde se edita «rinde» | **A (recomendada):** «Ajustes → Rinde», lista corta de los que rinden más de 1, con buscador. El catálogo completo, solo para leer, llega en «Productos» con la 3.2 · B: el catálogo completo en Ajustes con la columna «Rinde» editable | No (OK + validación física) |
| **D-6** | El costo cargado a mano, hasta que llegue Inventario | **A (recomendada, es D17 al pie de la letra):** se deja de cargar a mano; los costos ya cargados quedan y «Ing. Menú» los sigue mostrando; se actualizan solo desde Recetas · B: dejar editable solo el costo hasta Inventario | No (OK + validación física) |
| **D-7** | Quién edita «rinde» | **A (recomendada):** dueño y encargado de su local, como hoy · B: solo el dueño | Va con la firma de la 196 |
| **D-8** | Cómo se mantiene el catálogo al día | **A (recomendada):** disparador en las líneas del PoS, con las protecciones de §4.4 · B: cron cada tanto (demora y un job más que cuidar) | Sí, es la 196 |
| **D-9** | **Firma de la migración 196** sobre el SHA del PR 3.1a: 3 tablas, 1 disparador en `pos_ndf_ticket_lines`, 5 funciones, carga de familias y herencia de «rinde» | **Firmar después de** las lecturas previas en prod y la corrida en staging · no firmar | **Sí** |

### 9.4 Supuestos (el dueño no estaba disponible)

| # | Supuesto | Dónde pesa |
|---|---|---|
| S1 | «Categoría» = el grupo de la familia (comida, bebida, merch…), porque el PoS no manda otro nivel | §2.2 |
| S2 | «Rinde» = el multiplicador de hoy; no toca personas | §2.3, D-1 |
| S3 | «Rinde» lo editan owner y manager; el contador no | §5, D-7 |
| S4 | «Ajustes → Productos» se reemplaza por «Ajustes → Rinde» | §1.3, D-5 |
| S5 | El costo a mano se deja de cargar con la 3.1b | §2.4, D-6 |
| S6 | El orden de las familias dentro de comida es el de la carta: tapas, rolls, pokes, kids, postres, GreenSeason | §6 |
| S7 | «Activo» para «Sin ventas en el período» = visto en una factura en los 90 días anteriores al período | §3 |
| S8 | Los códigos son por local; Nosara tendrá los suyos cuando tenga PoS | §4.2 |

### 9.5 PRs

| PR | Qué | Agente | Requiere |
|---|---|---|---|
| **3.1a** | Archivo de la 196, rollback, batería con mutaciones, registro del número, `PASE-196`, lector `getVentasProductos` en `posNdf.ts`, módulo puro `catalogoPos.ts` y sus pruebas. Sin pantalla. Título «⛔ NO MERGEAR sin OK —» | Opus + verificador independiente (esquema y permisos) | **Firma** (D-9) |
| **3.1b** | «Ajustes → Rinde»; se retira `VentasConfig.tsx`; guía 6.4 e inventario de guías | Opus | OK + validación física |
| 3.2 | «Productos» definitiva (§5.2 de Ventas v2) sobre `pos_ventas_productos` | Opus + verificador | OK + validación física |

## 10. Fuera de alcance

- **La pantalla «Productos» definitiva** (mix, suben y bajan, ingeniería de menú, canal): es la 3.2.
- **Costo, margen y recetas por código:** con Inventario (§2.4).
- **Retirar `product_map`** y pasar Mi Rendimiento y la función de la 194 al catálogo por código: 3.6, con su
  migración y su firma.
- **Guardar el nombre de la familia desde la ingesta** (Edge `ingest-ndf` y `pos_ndf_ingest`): PR aparte, con firma.
- **Subfamilias, modificadores y tamaños:** el PoS no manda la relación (SPEC de Ventas v2 §13, pregunta 2).
- **Ventas por producto y salonero**, y por día: no las trae esta función.
- **Historial de cambios de «rinde»** (solo queda el último cambio).
- **Catálogo de Nosara:** la estructura es por local desde el día uno; la carga de sus familias entra cuando
  tenga PoS.
- **Catálogo del PoS propio** (`menu_families`, `menu_categories`, columnas extra de `product_map` en staging): otro
  proyecto.
- **La deuda multi-local de la 067, la 080 y la 190,** y cerrar `ventas_comps_write` al contador: backlog, con firma.
- **Archivos sagrados:** no se toca ninguno. `netaVenta.ts` no es sagrado, pero su definición está firmada y no cambia.

## Anexo A — batería propuesta `scripts/sql/196_pruebas.sql`

Va entre el cuerpo de la 196 y el de `196_rollback.sql`, todo dentro de un `begin` … `rollback`. `pg_temp.como`
cambia de usuario (un perfil activo de cada rol); `pg_temp.p` guarda el resultado o el error de cada caso. Los
casos «paridad» con `santa-teresa` necesitan los datos de staging; en un Postgres vacío dan 0 = 0.

```sql
-- ── PRUEBAS 196 (dentro de la transacción descartada) ──
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
select pg_temp.p('ajustes_heredados', $$select count(*)::text || ' / rinde ' || coalesce(string_agg(distinct rinde_personas::text, ','), '-') from public.pos_producto_ajustes$$);
select pg_temp.p('familias_sin_fila', $$select coalesce(string_agg(distinct p.familia::text, ',' order by p.familia::text), '-') from public.pos_productos p where not exists (select 1 from public.pos_familias f where f.local = p.local and f.familia = p.familia)$$);
select pg_temp.p('no_venta_coincide', $$select (array_agg(familia order by familia))::text from public.pos_familias where categoria in ('personal', 'cortesia', 'ingredientes')$$);
select set_config('p196.t0', clock_timestamp()::text, true);
select pg_temp.p('refrescar_2da_vez_filas', $$select public.pos_catalogo_refrescar('santa-teresa')::text$$);
select pg_temp.p('refrescar_ms', $$select round(extract(epoch from clock_timestamp() - current_setting('p196.t0')::timestamptz) * 1000)::text$$);

-- Disparador, con un local ficticio
insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, valor_servido_crc)
values ('prueba-196', 'A', '2026-11-20 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-196', 'B', '2026-11-22 12:00-06', 'C', 'delivery', 'cajero', false, 'ok', 0),
       ('prueba-196', 'V', '2026-11-10 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-196', 'X', '2026-11-21 12:00-06', 'X', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-196', 'S', '2026-11-21 13:00-06', 'C', 'salon', 'salonero', true, 'ok', 1234.5),
       ('prueba-196', 'N', '2026-11-23 23:30-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-196', 'M', '2026-11-24 00:10-06', 'C', 'salon', 'salonero', true, 'ok', 0);
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, x.cod, x.nom, x.cant, x.monto, x.fam
from (values ('A', '9001', 'ROLL FICTICIO', 2, 7000, 3), ('A', '9002', 'TRAGO FICTICIO', 1, 3000, 5),
             ('A', null, 'SIN CODIGO', 1, 500, 22), ('A', '9003', 'CORTESIA FICTICIA', 1, 4000, 17),
             ('A', '9004', 'PERSONAL FICTICIO', 1, 2000, 6), ('A', '9005', 'ING FICTICIO', 1, 100.5, 20),
             ('A', ' 9006 ', 'CON ESPACIOS', 1, 0, null)) x(fac, cod, nom, cant, monto, fam)
join public.pos_ndf_tickets t on t.local = 'prueba-196' and t.numero_factura = x.fac;
select pg_temp.p('trg_alta', $$select string_agg(codigo || '=' || nombre || '/' || coalesce(familia::text, 'null') || '/' || visto_desde || '..' || visto_hasta, ' | ' order by codigo) from public.pos_productos where local = 'prueba-196'$$);
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, '9001', 'ROLL FICTICIO NUEVO', 1, 3500, 3 from public.pos_ndf_tickets t where t.local = 'prueba-196' and t.numero_factura = 'B';
select pg_temp.p('trg_nombre_nuevo', $$select nombre || ' ' || visto_desde || '..' || visto_hasta from public.pos_productos where local = 'prueba-196' and codigo = '9001'$$);
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, '9001', 'ROLL VIEJO', 1, 1000, 2 from public.pos_ndf_tickets t where t.local = 'prueba-196' and t.numero_factura = 'V';
select pg_temp.p('trg_factura_vieja_no_pisa', $$select nombre || '/' || familia || ' ' || visto_desde || '..' || visto_hasta from public.pos_productos where local = 'prueba-196' and codigo = '9001'$$);
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, '9001', 'ROLL FICTICIO NUEVO', 1, case t.numero_factura when 'X' then 9999 when 'N' then 100 else 200 end, 3
from public.pos_ndf_tickets t where t.local = 'prueba-196' and t.numero_factura in ('X', 'N', 'M');
select pg_temp.p('otro_local_no_se_mezcla', $$select count(*)::text from public.pos_productos where local = 'santa-teresa' and codigo in ('9001', '9002', '9003', '9004', '9005', '9006') and nombre like '%FICTICI%'$$);

-- Función, como owner
select pg_temp.como('owner');
select pg_temp.p('owner_ficticio', $$select jsonb_build_object('neta_cts', j->'neta_cts', 'sin_lineas', j->'sin_lineas', 'productos', j->'productos', 'meses', j->'meses', 'catalogo', j->'catalogo')::text from (select public.pos_ventas_productos('prueba-196', '2026-11-01', '2026-11-23') j) x$$);
select pg_temp.p('paridad_190_ficticio', $$select (public.pos_ventas_productos('prueba-196', '2026-11-01', '2026-11-23')->>'neta_cts') || ' vs ' || (select sum((e->>1)::numeric) from jsonb_array_elements(public.pos_ventas_resumen('prueba-196', '2026-11-01', '2026-11-23')->'dias') e)$$);
select pg_temp.p('mutacion_sumar_fam17', $$select (select sum((e->>5)::numeric) from jsonb_array_elements(public.pos_ventas_productos('prueba-196', '2026-11-01', '2026-11-23')->'productos') e where (e->>2) is null or (e->>2)::int not in (6, 20))::text$$);
select pg_temp.p('paridad_190_ayer', $$select (public.pos_ventas_productos('santa-teresa', '2026-11-23', '2026-11-23')->>'neta_cts') = (select coalesce(sum((e->>1)::numeric), 0) from jsonb_array_elements(public.pos_ventas_resumen('santa-teresa', '2026-11-23', '2026-11-23')->'dias') e)::text$$);
select pg_temp.p('paridad_190_mes_a_la_fecha', $$select ((public.pos_ventas_productos('santa-teresa', '2026-11-01', '2026-11-23')->>'neta_cts') = (select coalesce(sum((e->>1)::numeric), 0) from jsonb_array_elements(public.pos_ventas_resumen('santa-teresa', '2026-11-01', '2026-11-23')->'dias') e)::text)::text$$);
select pg_temp.p('paridad_190_octubre', $$select ((public.pos_ventas_productos('santa-teresa', '2026-10-01', '2026-10-31')->>'neta_cts') = (select coalesce(sum((e->>1)::numeric), 0) from jsonb_array_elements(public.pos_ventas_resumen('santa-teresa', '2026-10-01', '2026-10-31')->'dias') e)::text)::text$$);
select set_config('p196.t1', clock_timestamp()::text, true);
select pg_temp.p('paridad_190_anio', $$select ((j->>'neta_cts') = (select coalesce(sum((e->>1)::numeric), 0) from jsonb_array_elements(public.pos_ventas_resumen('santa-teresa', '2025-11-24', '2026-11-23')->'dias') e)::text)::text || ' productos=' || jsonb_array_length(j->'productos') || ' meses=' || jsonb_array_length(j->'meses') || ' catalogo=' || jsonb_array_length(j->'catalogo') || ' sin_lineas=' || (j->'sin_lineas'->>'facturas') || ' bytes=' || length(j::text) from (select public.pos_ventas_productos('santa-teresa', '2025-11-24', '2026-11-23') j) x$$);
select pg_temp.p('anio_ms_las_dos', $$select round(extract(epoch from clock_timestamp() - current_setting('p196.t1')::timestamptz) * 1000)::text$$);
select set_config('p196.t2', clock_timestamp()::text, true);
select pg_temp.p('solo_productos_731_dias', $$select length(public.pos_ventas_productos('santa-teresa', '2024-11-24', '2026-11-23')::text)::text$$);
select pg_temp.p('solo_productos_731_ms', $$select round(extract(epoch from clock_timestamp() - current_setting('p196.t2')::timestamptz) * 1000)::text$$);
select pg_temp.p('cierre_meses_vs_productos', $$select ((select sum((e->>4)::numeric) from jsonb_array_elements(j->'meses') e) = (select sum((e->>5)::numeric) from jsonb_array_elements(j->'productos') e))::text from (select public.pos_ventas_productos('santa-teresa', '2026-10-01', '2026-11-23') j) x$$);
select pg_temp.p('rango_732', $$select public.pos_ventas_productos('santa-teresa', '2024-11-22', '2026-11-23')::text$$);
select pg_temp.p('rango_invertido', $$select public.pos_ventas_productos('santa-teresa', '2026-11-23', '2026-11-22')::text$$);
select pg_temp.p('owner_lee_tabla', $$select count(*)::text from public.pos_productos$$);
select pg_temp.p('owner_insert_directo', $$insert into public.pos_producto_ajustes (local, codigo, rinde_personas) values ('prueba-196', '9002', 3) returning 'entró'$$);
select pg_temp.p('owner_update_catalogo', $$update public.pos_productos set nombre = 'HACK' where local = 'prueba-196' returning 'entró'$$);
select public.pos_producto_rinde_guardar('prueba-196', ' 9002 ', 6);
select pg_temp.p('owner_rinde_6', $$select (select rinde_personas::text || ' por=' || (actualizado_por is not null)::text from public.pos_producto_ajustes where local = 'prueba-196' and codigo = '9002')$$);
select pg_temp.p('rinde_en_catalogo', $$select (select e->>3 from jsonb_array_elements(public.pos_ventas_productos('prueba-196', '2026-11-01', '2026-11-23')->'catalogo') e where e->>0 = '9002')$$);
select pg_temp.p('owner_rinde_21', $$select public.pos_producto_rinde_guardar('prueba-196', '9002', 21)::text$$);
select pg_temp.p('owner_rinde_0', $$select public.pos_producto_rinde_guardar('prueba-196', '9002', 0)::text$$);
select pg_temp.p('owner_rinde_desconocido', $$select public.pos_producto_rinde_guardar('prueba-196', '9999', 2)::text$$);
select public.pos_producto_rinde_guardar('prueba-196', '9002', 1);
select pg_temp.p('owner_rinde_1_borra', $$select (select count(*)::text from public.pos_producto_ajustes where local = 'prueba-196')$$);

select pg_temp.como('contador');
select pg_temp.p('contador_funcion', $$select (public.pos_ventas_productos('santa-teresa', '2026-11-23', '2026-11-23') ? 'productos')::text$$);
select pg_temp.p('contador_lee_tabla', $$select count(*)::text from public.pos_productos$$);
select pg_temp.p('contador_rinde', $$select public.pos_producto_rinde_guardar('prueba-196', '9002', 2)::text$$);
select pg_temp.como('manager');
select pg_temp.p('manager_locales', $$select public.mis_locales()::text$$);
select pg_temp.p('manager_local_ajeno', $$select (public.pos_ventas_productos('prueba-196', '2026-11-23', '2026-11-23') ? 'productos')::text$$);
select pg_temp.p('manager_rinde_local_ajeno', $$select public.pos_producto_rinde_guardar('prueba-196', '9002', 2)::text$$);
select pg_temp.p('manager_tabla_local_ajeno', $$select count(*)::text from public.pos_productos where local = 'prueba-196'$$);
select pg_temp.p('manager_tabla_total', $$select count(*)::text from public.pos_productos$$);
select pg_temp.como('salonero');
select pg_temp.p('salonero_funcion', $$select public.pos_ventas_productos('santa-teresa', '2026-11-23', '2026-11-23')::text$$);
select pg_temp.p('salonero_tablas', $$select (select count(*) from public.pos_productos)::text || '/' || (select count(*) from public.pos_familias) || '/' || (select count(*) from public.pos_producto_ajustes)$$);
select pg_temp.p('salonero_rinde', $$select public.pos_producto_rinde_guardar('santa-teresa', '9002', 2)::text$$);
select pg_temp.p('salonero_refrescar', $$select public.pos_catalogo_refrescar('santa-teresa')::text$$);
select pg_temp.como('cajero');
select pg_temp.p('cajero_funcion', $$select public.pos_ventas_productos('santa-teresa', '2026-11-23', '2026-11-23')::text$$);
select pg_temp.como('nadie');
select pg_temp.p('anon_privilegios', $$select has_function_privilege('anon', 'public.pos_ventas_productos(text,date,date)', 'execute')::text || has_function_privilege('anon', 'public.pos_producto_rinde_guardar(text,text,integer)', 'execute')::text || has_table_privilege('anon', 'public.pos_productos', 'select')::text || has_function_privilege('authenticated', 'public.pos_catalogo_absorber(uuid[])', 'execute')::text$$);
select pg_temp.p('sin_sesion_funcion', $$select public.pos_ventas_productos('santa-teresa', '2026-11-23', '2026-11-23')::text$$);

-- Mutación: el catálogo roto NO frena la ingesta
alter function public.pos_catalogo_absorber(uuid[]) rename to pos_catalogo_absorber_roto;
select pg_temp.p('ingesta_con_catalogo_roto', $$with i as (insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia) select t.id, '9050', 'ENTRA IGUAL', 1, 1, 3 from public.pos_ndf_tickets t where t.local = 'prueba-196' and t.numero_factura = 'A' returning 1) select (select count(*) from i)::text || ' línea; en catálogo: ' || (select count(*) from public.pos_productos where codigo = '9050')$$);
alter function public.pos_catalogo_absorber_roto(uuid[]) rename to pos_catalogo_absorber;
select public.pos_catalogo_refrescar('prueba-196');
select pg_temp.p('refrescar_repara', $$select 'en catálogo: ' || (select count(*) from public.pos_productos where codigo = '9050')$$);
```
