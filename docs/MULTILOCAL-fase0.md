# Multilocal fuera del Club — Fase 0 (borrador, sin aplicar)

> **Estado:** rama `claude/multilocal-fase0`, migración **091** sin aplicar en ninguna base. Usa como base las 12
> recomendaciones de `docs/MULTILOCAL-plan-caja.md` §14 (rama `claude/multilocal-plan-caja`), que **Ismael todavía no firmó**: cada una
> va marcada **[PROVISORIA]**. Si alguna cambia, cambia la migración antes de firmarla.

## Qué entra en la fase 0 (no toca sagrados ni plata)
| Pieza | Qué es | Decisión que usa |
|---|---|---|
| Catálogo único `locations` | La misma tabla de la mig 022 (staging ya la tiene); en prod se crea con `santa-teresa`. | 1 [PROVISORIA] |
| `location_id` (default `santa-teresa`) | En `cash_sessions`, `cash_movements`, `cash_cierres_dia` y `tip_sessions`. Default constante: no reescribe la tabla y todo lo de hoy queda en Santa Teresa. Sin renombrar nada (`local` sigue en `pos_ndf_*` y BioTime). | 11 [PROVISORIA] |
| `profile_locations` | Qué locales ve cada usuario (con «principal»). Sin filas = ve Santa Teresa: nadie pierde acceso. | 2 [PROVISORIA] |
| `mis_locales()` / `puede_ver_local()` | owner y contador: todos; el resto: los suyos (o Santa Teresa). | 2 [PROVISORIA] |
| RLS por local | Políticas **restrictivas** nuevas en las 4 tablas (AND con las de hoy, que no se tocan). | 2 [PROVISORIA] |

**Pruebas:** `scripts/sql/091_pruebas.sh` (solo staging, cada caso en una transacción descartada): mismas filas
(md5 de cada fila sin `location_id`), mismos totales, mismo saldo de Caja Fuerte y mismos cierres como postgres; owner,
manager, contador, cajero y salonero ven lo mismo antes y después; con un segundo local de prueba, manager y cajero
sin asignación no lo ven, owner y contador sí, y un manager asignado solo a ese local deja de ver Santa Teresa; una
escritura en un local ajeno la rechaza la RLS. **Rollback:** `scripts/sql/091_rollback.sql`.

## Las 12 decisiones, tal como las toma (o no) esta fase
| # | Decisión | En la fase 0 |
|---|---|---|
| 1 | Catálogo único `locations` | **Usada [PROVISORIA]** |
| 2 | Quién ve qué: manager/cajero los suyos; owner/contador todos | **Usada [PROVISORIA]** |
| 3 | Un rol por persona (+ cobertura por turno) | No cambia nada hoy [PROVISORIA] |
| 4 | Banco: una cuenta para la empresa | **Fuera** (plata, fase con firma) [PROVISORIA] |
| 5 | Proveedores y créditos: lista común | **Fuera** (plata) [PROVISORIA] |
| 6 | Puntos de propina por local | **Fuera** (plata) [PROVISORIA] |
| 7 | Pozo de propinas por local | **Fuera** (plata) [PROVISORIA] |
| 8 | Carta y temporadas por local | **Fuera** [PROVISORIA] |
| 9 | P&L por local y consolidado | **Fuera** [PROVISORIA] |
| 10 | Firma de los sagrados del cierre | **Fuera** (sagrado) |
| 11 | `location_id` en lo nuevo, sin renombrar | **Usada [PROVISORIA]** |
| 12 | Abrir el segundo local con F0–F4 | No aplica todavía [PROVISORIA] |

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
2. **No se abre un segundo local solo con la fase 0.** El cierre todavía mezclaría locales (único por fecha, «hay un
   turno abierto» global, `client_op_id` del ajuste que choca, pozo y cajas físicas sin local). Abrir otro local exige
   las fases con firma de la sección anterior, como mínimo cierre, pozo y cajas físicas.

## Convivencia con la 075 del Club (`claude/epic-tesla-pyo77m` @ `743732e`) — ⚠️ CHOQUE, sin resolver
Revisado el 08-nov, solo lectura del repo:
- **Hay DOS catálogos de locales, no uno.** La 075 no usa `locations`: su catálogo es `club_config` (`location_id text
  primary key`, `nombre`, `direccion`, `mapa_url`, `club_activo`, …). Sus `location_id` van **sin FK y sin default**
  a propósito («multi-local genérico», 075 líneas 9–11). La 091 (y la 022) usan `locations` (`id`, `name`,
  `is_active`). Ni las tablas ni las columnas coinciden (`id`/`name` contra `location_id`/`nombre`).
- **«Nuevo local» del Club no escribe en `locations`.** `club_local_crear` (075 L6143) inserta solo en `club_config`
  (y su trigger `club_config_alta` siembra marcadores y promociones). Un local dado de alta desde el Club **no existiría
  para caja y propinas**: la FK de la 091 rechazaría su `location_id`, y `mis_locales()` del owner (que lee `locations`)
  no lo listaría.
- **En staging conviven las dos** (la 022 y la 075 aplicadas); en prod hoy no hay ninguna.
- **La decisión 1 [PROVISORIA]** («`locations` como única fuente, con `club_config` colgando de ella») **pide cambiar la
  075**, que es del Club. No se toca sin acordarlo con Ismael y con la sesión del Club. Opciones, para decidir:
  - a) `club_config.location_id` con FK a `locations(id)`, y `club_local_crear` inserta primero en `locations`
    (cambia la 075; se alinea con la decisión 1);
  - b) la 091 usa `club_config` como catálogo (FK a `club_config(location_id)`) — pero entonces caja depende del
    esquema del Club, que no está en prod hasta el piloto;
  - c) dejar las dos y sincronizar con un trigger (`club_config` → `locations`): más piezas, fácil que diverjan.
  - Recomendación (provisoria): **a**, antes de que la 075 o la 091 lleguen a prod.

## Antes de firmar la 091
1. Que Ismael confirme (o cambie) las decisiones 1, 2 y 11, y **resolver el choque con la 075** (sección anterior).
2. Correr `scripts/sql/091_pruebas.sh` en staging (en la ventana nocturna) y anotar el resultado acá.
3. Va después de la 085, la 089 y la 090.
