# Multilocal fuera del Club — Fase 0 (borrador, sin aplicar)

> **Estado:** rama `claude/multilocal-fase0` (encima de `main`, separada de la 089 y la 090), migración **091** sin
> aplicar en ninguna base. Usa las 12 decisiones de `docs/MULTILOCAL-plan-caja.md` §14 (rama
> `claude/multilocal-plan-caja`), **aprobadas por Ismael el 08-nov**. Ismael confirmó también que **el selector de
> local existirá antes de abrir otra sucursal**.

## Qué entra en la fase 0 (no toca sagrados ni plata)
| Pieza | Qué es | Decisión |
|---|---|---|
| Catálogo único `locations` | La misma tabla de la mig 022 (staging ya la tiene); en prod se crea con `santa-teresa`. | 1 |
| `location_id` (default `santa-teresa`) | En `cash_sessions`, `cash_movements`, `cash_cierres_dia` y `tip_sessions`. Default constante: no reescribe la tabla y todo lo de hoy queda en Santa Teresa. Sin renombrar nada (`local` sigue en `pos_ndf_*` y BioTime). | 11 |
| `profile_locations` | Qué locales ve cada usuario (con «principal»). Sin filas = ve Santa Teresa: nadie pierde acceso. | 2 |
| `mis_locales()` / `puede_ver_local()` | owner y contador: todos; el resto: los suyos (o Santa Teresa). | 2 |
| RLS por local | Políticas **restrictivas** nuevas en las 4 tablas (AND con las de hoy, que no se tocan). | 2 |

**Pruebas:** `scripts/sql/091_pruebas.sh` (solo staging, cada caso en una transacción descartada): mismas filas
(md5 de cada fila sin `location_id`), mismos totales, mismo saldo de Caja Fuerte y mismos cierres como postgres; owner,
manager, contador, cajero y salonero ven lo mismo antes y después; con un segundo local de prueba, manager y cajero
sin asignación no lo ven, owner y contador sí, y un manager asignado solo a ese local deja de ver Santa Teresa; una
escritura en un local ajeno la rechaza la RLS. **Rollback:** `scripts/sql/091_rollback.sql`.

## Las 12 decisiones (aprobadas por Ismael el 08-nov), tal como las toma (o no) esta fase
| # | Decisión | En la fase 0 |
|---|---|---|
| 1 | Catálogo único `locations` | **Usada** |
| 2 | Quién ve qué: manager/cajero los suyos; owner/contador todos | **Usada** |
| 3 | Un rol por persona (+ cobertura por turno) | No cambia nada hoy |
| 4 | Banco: una cuenta para la empresa | **Fuera** (plata, fase con firma) |
| 5 | Proveedores y créditos: lista común | **Fuera** (plata) |
| 6 | Puntos de propina por local | **Fuera** (plata) |
| 7 | Pozo de propinas por local | **Fuera** (plata) |
| 8 | Carta y temporadas por local | **Fuera** |
| 9 | P&L por local y consolidado | **Fuera** |
| 10 | Firma de los sagrados del cierre | **Fuera** (sagrado) |
| 11 | `location_id` en lo nuevo, sin renombrar | **Usada** |
| 12 | Abrir el segundo local con F0–F4 | No aplica todavía |

## Lo que queda para fases con firma
**Cierre y pozo (sagrados, decisión 10):**
- El único de `cash_cierres_dia` pasa de `(session_date)` a `(location_id, session_date)` (crear el nuevo antes de
  borrar el viejo).
- `cerrar_dia_completo` y `deshacer_cierre_dia` con `p_location`: el lock, «hay un turno abierto» y «la Caja Diaria
  está cerrada» miran solo el local.
- `client_op_id` del ajuste: hoy `hash('cierre-ajuste-{fecha}-{moneda}')`; con dos locales el mismo día choca.
  Santa Teresa conserva la fórmula; los demás suman el local.
- `cierrePozo.ts`, `pozo.ts`: reciben los movimientos y sesiones **del local** (filtro afuera, sin cambiar adentro).
  «Apertura pozo» por local.
- «Borrar TODO el día», días sin cierre, correo del cierre por local.

**Cajas físicas y plata:**
- Saldos de Caja Fuerte, Caja Proveedores y Registradora por local (`cashUtils.ts` recibe la lista ya filtrada).
- Banco (decisión 4), proveedores y créditos (5), `role_tip_points` por local (6), pozo de propinas por local (7).
- `getOpenCashSession()` y el «un solo turno abierto»: por local (hoy un turno abierto de un local bloquearía el cierre
  del otro).
- Outbox offline y realtime filtrados por local.

**Empleados y ventas:**
- `employee_locations` (dónde trabaja cada uno) y `pos_login` / `biotime_emp_code` únicos por local.
- Ventas: RPC con chequeo de local; `LOCALES` de la app desde la base.

**Pantallas:**
- Selector de local y contexto en la app; todas las lecturas de `shared/api` filtran por el local elegido.

## ⛔ Gates (Ismael, 08-nov)
1. **El día que haya selector de local, `location_id` pierde el default.** En el mismo PR que agregue el selector de
   local en la app, las 4 columnas pasan a `NOT NULL` **sin default** (`alter column location_id drop default`), para
   que ningún movimiento, turno, cierre o sesión de propinas caiga en Santa Teresa por omisión. Hasta ese día el
   default existe solo para que la app de hoy (que no manda el local) siga igual.
2. **No se abre un segundo local solo con la fase 0.** El cierre todavía mezclaría locales: `cerrar_dia_completo` y
   `deshacer_cierre_dia` son **SECURITY INVOKER** (verificado en prod el 08-nov), así que con dos locales un owner o
   contador —que ven todos— cerraría viendo los dos; además el único es por fecha, «hay un turno abierto» es global,
   el `client_op_id` del ajuste choca, y pozo y cajas físicas no tienen local. Abrir otro local exige
   las fases con firma de la sección anterior, como mínimo cierre, pozo y cajas físicas.

## Convivencia con la 075 del Club (`claude/epic-tesla-pyo77m` @ `743732e`): catálogo único — opción a (decidida)
Revisado el 08-nov, solo lectura del repo. **El choque:**
- Había **dos catálogos de locales**: la 075 usa `club_config` (`location_id text primary key`, `nombre`, `direccion`,
  `mapa_url`, `club_activo`, …; sus `location_id` van sin FK y sin default a propósito), y la 091 (como la 022) usa
  `locations` (`id`, `name`, `is_active`). Ni las tablas ni las columnas coinciden.
- **«Nuevo local» del Club** (`club_local_crear`, 075 L6143) insertaba solo en `club_config`: un local dado de alta desde
  el Club no existiría para caja y propinas (la FK de la 091 lo rechazaría y `mis_locales()` no lo listaría).

**Decisión de Ismael (08-nov): opción a.**
- **`locations` es el único catálogo.** `club_config.location_id` pasa a tener FK a `locations(id)`.
- **«Nuevo local» del Club crea primero el local en `locations`** (id y nombre) y después su fila de `club_config`.
- Las columnas no se renombran: `locations.id` / `locations.name` y `club_config.location_id` / `club_config.nombre`
  conviven (el nombre del local vive en `locations.name`; si el Club necesita el suyo, queda como dato del Club).

**Cuándo y quién:** se implementa **después del pase del lunes 09-nov**, **coordinado con la sesión del Club** (la 075
es suya: el cambio de la 075 y de `club_local_crear` lo hace o lo acuerda esa sesión). Orden propuesto: primero
`locations` en la base que corresponda (la 091 o una migración propia), después la FK y el cambio de
`club_local_crear` en el Club, en el mismo pase, para que no quede un `club_config` apuntando a un local inexistente.

## Antes de firmar la 091
1. Implementar la opción a del catálogo con la sesión del Club (sección anterior), después del pase del lunes.
2. Correr `scripts/sql/091_pruebas.sh` en staging (en la ventana nocturna) y anotar el resultado acá.
3. Va después de la 085, la 089 y la 090.
