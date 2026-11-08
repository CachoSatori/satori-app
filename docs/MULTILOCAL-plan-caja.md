# Plan multilocal · caja, cierre, propinas, empleados, ventas y BioTime (08-nov-2026)

> **Solo plan.** Este documento no trae código, migraciones ni cambios en ninguna base. Nada se implementa sin la
> firma del dueño, fase por fase.
>
> **Punto de partida:** el relevamiento del Club (`docs/MULTILOCAL-relevamiento.md`, rama `claude/club-wallet`),
> la migración del Club `075_club_satori_esquema.sql` (sección LC-ML), la `022` del PoS propio (solo en `staging`)
> y las migraciones de `main` @ `407ddf8`.
>
> **Regla del dueño (08-nov):** nada atado a un local por nombre. Los locales salen de datos y abrir uno nuevo no
> pide código. Este plan la cumple: ninguna migración, función ni pantalla nombra un local.

---

## 0. Resumen en una tabla

| Área | ¿Lleva local? | Cómo | ¿Toca un sagrado? |
|---|---|---|---|
| Catálogo de locales | es el catálogo | `public.locations` (la de la `022`), con el formato de slug del Club | no |
| Caja (`cash_sessions`, `cash_movements`) | **sí** | columna `location_id` + filtro en `shared/api/cash.ts` | no (los sagrados reciben la lista ya filtrada) |
| Cierre (`cash_cierres_dia`, pozo) | **sí** | `location_id` + único `(location_id, session_date)` + RPC con `p_location` | **sí**: RPC del cierre y `client_op_id` del ajuste → **firma** |
| Propinas (`tip_sessions`) | **sí** | `location_id` | no |
| Propinas (`tip_entries`) | no (hereda de la sesión) | `session_id` ya la ata | no |
| Puntos (`role_tip_points`) | **sí** | PK `(location_id, role)` | no (`calcTurno` recibe los puntos del local) |
| Empleados (`employees`) | no como columna | tabla `employee_locations` (una persona, varios locales) | no |
| Usuarios (`profiles`) | no como columna | tabla `profile_locations` (quién ve qué local) | no |
| Ventas PoS (`pos_ndf_*`) | **ya lo tiene** (`local`) | sin cambio de esquema; RPC chequean acceso al local | no |
| Ventas legado (`ventas_hist`, `ventas_dias`, `ventas_metas`) | **sí** | `location_id` en la clave | no |
| BioTime (`time_punches`, `work_days`, `payroll_config`) | **ya lo tiene** (`local`, solo staging) | código BioTime por local; validar locales contra datos | no |
| Finanzas (`finance_accounts`) | no (plan de cuentas único) | — | no |
| Finanzas (`finance_budget`, `finance_actuals`, `accounting_entries`) | **sí** | `location_id` | `accounting_entries` es plata firmada → **firma** |
| `suppliers`, `exchange_rates`, `product_map` | no (por ahora) | globales | no — ver decisiones |

---

## 1. El modelo de local (se reusa, no se inventa)

Hoy conviven tres piezas que ya usan **el mismo slug** (`'^[a-z0-9-]{2,40}$'`):

| Pieza | Dónde | Estado |
|---|---|---|
| `public.locations (id text pk, name, is_active, …)` | mig `022` (PoS propio) | **solo staging**; siembra dos locales por nombre |
| `club_config.location_id` + `club_activo` + `club_local()` | mig `075` (Club) | solo staging hasta el piloto |
| columna `local text` en `pos_ndf_*` (prod), `time_punches`, `work_days`, `payroll_config` (staging) | migs `062`, `056`, `057` | en uso; sus comentarios ya dicen «mismos valores que `public.locations.id`» |

**Propuesta: una sola fuente, `public.locations`.**

- La migración del catálogo hace `create table if not exists` **con la misma forma que la `022`** (así en staging
  no choca) y le suma: el chequeo de formato del Club (`location_id ~ '^[a-z0-9-]{2,40}$'`), `nombre` visible y una
  bandera **por módulo**: `caja_activa boolean not null default false` (como `club_activo` del Club). La zona horaria
  queda en `America/Costa_Rica` fija (los dos locales están en el mismo país); si algún día hace falta, es una columna más.
- **Sin INSERT por nombre en la migración.** El alta de un local es un INSERT documentado en el runbook (igual que el
  paso 4b del RUNBOOK del Club). En staging, la fila que sembró la `022` se reusa; solo hay que poner `caja_activa`.
- **El local por defecto se resuelve como en el Club** (`club_local()`): «el único local con la caja activa». Con
  cero o con dos o más, la base pide elegir y no supone ninguno. Así un INSERT viejo sin local sigue funcionando
  mientras haya un solo local, y deja de funcionar (con un error claro) el día que haya dos.
- **Columnas nuevas: `location_id text not null references locations(id)`**, el nombre del Club y del PoS propio.
  Las tablas que ya tienen `local` (PoS y BioTime) **no se renombran**: mismo valor, otro nombre de columna, y
  renombrar rompería el puente y el agente en producción.
- Lo del Club (`club_config.location_id → locations.id` como FK) lo decide el frente del Club en su bloque; este
  plan no lo toca.

**Por qué un trigger y no un `default`:** Postgres no admite una subconsulta en un `default`, y un `default
'<slug>'` es justo lo que la regla prohíbe (el relevamiento ya marcó los de `062` y `056`). El trigger
`before insert` completa `location_id` con el local resuelto si viene null.

**Funciones auxiliares nuevas** (SECURITY DEFINER, `search_path` fijo, guarda NULL-segura como SEC-01b):

| Función | Qué hace |
|---|---|
| `local_operativo(p_location text)` | Con dato: valida que exista y tenga la caja activa. Sin dato: el único local activo, o error. Copia el patrón de `club_local()`. |
| `puede_ver_local(p_location text)` | `true` para owner y contador activos; para el resto, si hay fila en `profile_locations`. La usan las policies y las RPC. |
| `mis_locales()` | La lista que alimenta el selector de la app. |

---

## 2. Caja (Caja Diaria, movimientos, cajas físicas)

**Tablas reales** (mig `001`, `013`, `015`, `018`, `021`, `038`, `041`, `052`):
`cash_sessions` (turnos de Caja Diaria), `cash_movements` (con `session_id` opcional desde la `013`, `account_id`
desde la `015`, `client_op_id` único desde la `021`), `movement_deletions` (`039`), `movement_edits` (`052`).

| Tema | Plan |
|---|---|
| Columna | `location_id` en `cash_sessions` y `cash_movements`. `movement_deletions` y `movement_edits` **no**: apuntan a un movimiento que ya la tiene. |
| Movimientos con turno | El local del movimiento tiene que ser el de su turno: chequeo en el trigger (`session_id` no null → mismo `location_id`). |
| Movimientos de día (sin turno, `013`) | Llevan su propio `location_id` (los escribe el cierre del local). |
| Únicos | `client_op_id` sigue **global** (es un UUID; no choca entre locales). No hay otro único en caja. |
| «Un solo turno abierto» | Hoy `getOpenCashSession()` trae **cualquier** turno abierto. Pasa a «el turno abierto **del local**». |
| Cajas físicas (`Caja Fuerte`, `Caja Proveedores`, `Registradora`) | Son por local: el saldo se calcula con los movimientos del local. **Banco**: ver decisiones (¿una cuenta para todos?). |
| Traspasos entre locales | No existen hoy. Propuesta: no permitirlos en la v1; si hacen falta, son dos movimientos (egreso en uno, ingreso en otro) con una referencia común. |
| Offline (`shared/offline/outbox.ts`) | La operación guarda `location_id` **al encolarse** (el local elegido en ese momento), no al sincronizar. |
| Realtime (`020`) | La suscripción filtra por `location_id=eq.<local>`. |

**Sagrados:** `cashUtils.ts` (`saldoCajaFuerte`, `isEgreso`, …) y `pozo.ts` son funciones puras que reciben una
lista de movimientos. **No se tocan:** la lista llega ya filtrada por local desde `shared/api/cash.ts`. Constantes
como `PROPINAS_POR_PAGAR_DESDE` o `POZO_CORTE` siguen siendo de Santa Teresa; un local nuevo arranca después de esas
fechas, así que no lo afectan (verificarlo con un test, sin tocar el archivo).

---

## 3. Cierre del día y pozo

**Tablas y funciones reales:** `cash_cierres_dia` (creada fuera de migraciones, baseline `0095`; `close_op_id` y
`unique (session_date)` en la `071`; `primer_conteo_*` en la `074`), RPC `cerrar_dia_completo`,
`deshacer_cierre_dia`, `cierre_ajuste_op_id`, `delete_movement_cascade` (`039`/`044`/`053`), y en el cliente
`CashCierre.tsx`, `cierrePozo.ts`, `borrarDia.ts`, `diasSinCierre.ts`.

| Tema | Plan |
|---|---|
| Columna | `location_id` en `cash_cierres_dia`. |
| Único | `cash_cierres_dia_session_date_key (session_date)` → `(location_id, session_date)`. La `071` ya lo anota. Se crea el nuevo **antes** de borrar el viejo. |
| `cerrar_dia_completo` | Nueva firma con `p_location`. Adentro: el lock de la fila, «hay un turno abierto» y «la Caja Diaria del día está cerrada» pasan a mirar **solo el local**. La firma vieja queda y resuelve el local con `local_operativo(null)` hasta que el cliente nuevo esté en todos lados. |
| **`client_op_id` del ajuste** | Hoy es `hash('cierre-ajuste-{fecha}-{moneda}')`. **Con dos locales el mismo día, el ajuste del segundo choca con el del primero** (el único de `client_op_id` es global) y se tomaría como «ya aplicado». Propuesta: Santa Teresa conserva **exactamente** la fórmula de hoy (los históricos no cambian) y los demás locales usan `'cierre-ajuste-{local}-{fecha}-{moneda}'`. Hay que cambiarlo igual en la base (`cierre_ajuste_op_id`) y en el cliente (`cierreAjusteOpId` de `cash.ts`). |
| `deshacer_cierre_dia`, «Borrar TODO el día» | Eligen por fecha → pasan a fecha **y local**. |
| Pozo (`cierrePozo.ts`) | `fechaAperturaPozo`, `basePozoParaCierre`, `deberiaPozo` reciben movimientos y sesiones: se les pasan **los del local**. Cada local tiene su «Apertura pozo». |
| Días sin cierre (`diasSinCierre.ts`, `jornadasConVentas.ts`) | Ya reciben `local` para el PoS; se les pasa el local elegido y los cierres de ese local. |
| Correo del cierre (Edge `cierre-email`) | El asunto y el cuerpo sacan el nombre del local de `locations`. |

> ⚠️ **Sagrado: la lógica del cierre.** La RPC `cerrar_dia_completo` / `deshacer_cierre_dia`, la fórmula del
> `client_op_id` del ajuste y cualquier cambio en `CashCierre.tsx` que no sea pasar el local **necesitan la firma
> explícita del dueño**. El plan está armado para que el cambio sea un **filtro alrededor** (qué filas entran), nunca
> un cambio en **cómo se calcula** (montos, tolerancia, «debería»).

---

## 4. Propinas

**Tablas reales:** `tip_sessions` (`001`; `shift_type` y pools en `002`; `pool_barra_electronico_crc` en `046`;
`pool_total_crc` en `051`), `tip_entries` (`001`; `covered_role` en `008`; `client_op_id` en `021`;
`unique (session_id, employee_id)`), `role_tip_points` (`001`, PK `role`; `recibe_propina` en `048`).

| Tema | Plan |
|---|---|
| `tip_sessions` | `location_id`. La sesión abierta, el historial y la quincena se filtran por local. |
| `tip_entries` | **Sin columna**: la sesión ya define el local. Un único `(session_id, employee_id)` ya es por local. |
| `role_tip_points` | **Por local**: PK `role` → `(location_id, role)`. El backfill copia las filas actuales a Santa Teresa; al dar de alta un local se copian como punto de partida (las edita el owner). |
| Quién entra al reparto | El selector de empleados del turno muestra los habilitados en el local (`employee_locations`), con opción de sumar a alguien de otro local (cubre un turno). |
| Pagos de propina en caja | `propinaPago.ts` y `CashPendientes`: el egreso va a la caja del local de la sesión. |
| «Mis propinas» del empleado | Ve sus entradas de todos los locales donde trabajó (la policy `empleado_ve_sus_entradas` no cambia). |

> ⚠️ **Sagrado: `tipCalculations.ts` (`calcTurno`).** No cambia: recibe las líneas y los puntos **del local** de la
> sesión. Cualquier cambio adentro necesita la firma del dueño.

---

## 5. Empleados y usuarios (¿una persona en dos locales?)

**Hoy:** `profiles` (1:1 con `auth.users`, un `role`, `is_active`; guardas de la `068`; `get_my_role()` mira
`is_active` desde la `069`), `employees` (puede no tener cuenta; `pos_name` en `050`, `pos_login` único en `062`;
en staging `biotime_emp_code` único en `055`).

**Propuesta: la persona es una sola fila; el local es una relación.**

| Tabla nueva | Columnas | Para qué |
|---|---|---|
| `profile_locations` | `profile_id`, `location_id`, `principal boolean` | **Qué locales ve un usuario** en la app. El principal es el que abre por defecto. Owner y contador no la necesitan (ven todos). |
| `employee_locations` | `employee_id`, `location_id`, `activo` | **Dónde trabaja** un empleado (listas de propinas, horas, reportes). Una persona puede estar en dos. |

- **El rol sigue siendo uno por persona** (`profiles.role`). Un cajero de un local que en el otro hace de salonero se
  resuelve con `covered_role` en la propina del turno, como hoy. Si el dueño quiere roles distintos por local, es otra
  decisión (ver lista) y cambia `get_my_role()` → mucho más grande.
- **Logins del PoS:** cada local tiene su PoS con su numeración. `employees.pos_login` único **global** puede chocar
  (el login 23 de un local y el 23 del otro). Pasa a `employee_locations.pos_login`, único por `(location_id, pos_login)`.
- **Salario:** el pay run sigue siendo global (`salary_periods.local` ya es solo etiqueta en la `056`).
- **Pantallas:** Admin → Empleados suma «Locales» (chips); Admin → Usuarios suma «Locales que ve» y el principal.

---

## 6. Ventas

| Pieza | Hoy | Plan |
|---|---|---|
| `pos_ndf_tickets`, `pos_ndf_ticket_lines`, `pos_ndf_open`, `pos_ndf_cursor` | ya tienen `local`; únicos `(local, numero_factura)`, `(local, clave)`, PK `local` | **Sin cambio de esquema.** Sacar el `default 'santa-teresa'` de `pos_ndf_tickets.local` (el puente siempre lo manda). |
| RPC `pos_ventas_tickets_rango`, `pos_ventas_latido` (`067`), `pos_prompax_agregado` (`080`) | reciben `p_local`, chequean rol | Sumar `puede_ver_local(p_local)`. `pos_ventas_lineas` filtra por los tickets que ya pasaron ese chequeo. |
| `ventas_hist` (PK `session_date`), `ventas_dias` (upsert por `session_date`), `ventas_metas` (PK `key`), `ventas_comps` | sin local | `location_id`; claves `(location_id, session_date)` y `(location_id, key)`. El upsert de `shared/api/ventas.ts` cambia su `onConflict`. |
| `LOCALES` y `type LocalId` en `src/modules/ventas/ventasEnVivoTypes.ts` | lista cerrada de dos | `LocalId = string`; la lista sale de `mis_locales()`. |
| `LOCAL_POR_DEFECTO` (`ventasDiasDesdePos.ts`), `useState('santa-teresa')` (`VentasEnVivo.tsx`), Prom/PAX (`VentasPromPaxExplicado.tsx`) | fijo | El local del contexto de la app (§8). |
| `temporadas.ts` | temporadas de un local | Pasan a datos por local (tabla chica o columna JSON en `locations`). |
| `product_map` | global | Global en la v1 (ver decisiones si las cartas difieren). |

> ⚠️ **Sagrado: `posFiscal.ts` (`computeTotals`, solo en `staging`).** El PoS propio ya nace con `location_id`
> (`022`); `computeTotals` no sabe de locales y **no tiene por qué**. No se toca.

---

## 7. BioTime (`ingest-punches`) y horas

Todo esto vive **solo en `staging`** (migs `055`–`061`, Edge `supabase/functions/ingest-punches`).

| Tema | Hoy | Plan |
|---|---|---|
| `time_punches` | `local` + único `(local, biotime_id)` | Bien como está. |
| `work_days` | PK `(employee_id, work_date, local)`, **`default 'santa-teresa'`** | Sacar el default; la carga manual elige el local. |
| `payroll_config` | PK `local` | Bien como está. |
| `employees.biotime_emp_code` | **único global** | Cada local tiene **su** BioTime con sus códigos: el `4` de un reloj y el `4` del otro son personas distintas. Pasa a `employee_locations.biotime_emp_code`, único por `(location_id, código)`. La Edge resuelve el empleado con `(local, emp_code)`. |
| `LOCALES = new Set([...])` en la Edge (`index.ts:41`) | lista cerrada | Validar contra `locations` (activo), igual que la corrección del puente en `claude/puente-locales-genericos`. |
| `derivar_work_days(p_desde, p_hasta, p_local)` | ya por local | Sin cambio. |

**Coordinación:** estos cambios van **con el pase de Salarios a prod**, no antes. Regla operativa 2 de `ESTADO.md`:
ningún PR a `main` con `supabase/functions/` hasta cerrar el ítem 11.

---

## 8. Pantallas

| Dónde | Cambio |
|---|---|
| Encabezado de la app | **Selector de local** («Satori · <nombre>»). Con un solo local habilitado no se muestra. Se recuerda en el navegador (comodidad, no dato). |
| Contexto | Un `LocalProvider` junto a `useAuth`: local elegido + `mis_locales()`. Todo `shared/api/*.ts` lo recibe y filtra (≈40 consultas en `cash.ts`, 18 en `tips.ts`, 12 en `ventas.ts`, 7 en `admin.ts`). |
| Caja (`CashModule`, `CashTurno`, `CashMovimientos`, `CashPendientes`, `CashProveedores`, `CashResumen`, `CashCierre`, `AlertaDiasSinCierre`) | Leen y escriben en el local elegido. **Escribir siempre exige un local concreto**, nunca «Todos». |
| Propinas (`TipsModule`, `TipHistory`, `TipQuincenal`, `TipStats`, `TipCocina`) | Igual. |
| Ventas (`VentasEnVivo`, `VentasHoy`, `ReporteMensual`, Prom/PAX, Mi Rendimiento) | El local del contexto; el owner puede ver «Todos» en lectura. |
| Resumen (`ResumenDiario`, `ResumenSemanal`, `ReporteMensual`), Inicio (`HomePage`) | Por local, con vista consolidada para owner/contador. |
| Admin (`EmployeeList`, `NuevoEmpleado`, `RolePointsConfig`, `UserApprovals`, `EmployeeHours`) | Locales por empleado y por usuario; puntos por local. |
| Textos con el nombre del local (lista en §5 del relevamiento: `CashModule.tsx:152`, `comprobante.ts:118`, `LoginPage.tsx:32`, …) | Salen de `locations.nombre`. |

**Guías de uso:** cada fase que cambie pantallas actualiza su guía en `docs/sop-app/` **en el mismo PR**
(`6.1 Acceso y roles`, `6.2 Caja`, `6.3 Propinas`, `6.4 Ventas y Dashboard`, `6.5 Mi Rendimiento`, `6.6 Admin`),
con `verificado_en_commit`.

---

## 9. Seguridad (RLS)

| Tabla | Hoy | Después |
|---|---|---|
| `cash_sessions`, `cash_movements`, `cash_cierres_dia` | por rol (`001`, `012`, `038`, `073`) | **misma condición de rol `and puede_ver_local(location_id)`** en lectura y en `with check`. |
| `tip_sessions` | por rol + «sesión abierta» | ídem; «empleados ven la sesión abierta» pasa a «de un local suyo». |
| `tip_entries` | gerencia / el propio empleado | gerencia: `puede_ver_local` de la sesión; el propio empleado: sin cambio. |
| `role_tip_points` | lectura autenticada, escritura owner | sin cambio de rol; filas por local. |
| `pos_ndf_*` | owner/manager/contador | sumar `puede_ver_local(local)`. Sigue cerrada al resto (regla 6). |
| `profile_locations`, `employee_locations` | — | lectura: el propio + gerencia; escritura: **solo owner** (como las guardas de la `068`). |
| `locations` | (staging: lectura autenticada) | lectura autenticada; escritura solo owner. |

- **La RLS se activa al final** (fase 4), cuando la app ya manda el local. Antes, todos los usuarios tienen un solo
  local y el filtro no cambiaría nada.
- Las RPC SECURITY DEFINER (`067`, `080`, `cerrar_dia_completo` es INVOKER) chequean `puede_ver_local` adentro.
- **Los permisos se prueban con usuarios reales de cada rol** (regla 4), no con «Ver como».

---

## 10. Migración de datos (todo a Santa Teresa)

**Orden por tabla** (cada paso re-ejecutable; se corre en staging, se verifica, y en prod **a mano antes del
merge**, regla 1 de `ESTADO.md`):

| Paso | Qué | Idempotencia |
|---|---|---|
| 0 | **Respaldo** de las tablas (JSON a Drive, como en los pases anteriores) y conteo de filas. | — |
| 1 | Alta del local en `locations` **por runbook** (INSERT, no en la migración) y `caja_activa = true`. | `on conflict do nothing` |
| 2 | `add column if not exists location_id text` (nullable) + FK a `locations` `not valid`. | `if not exists` |
| 3 | Trigger `before insert`: si `location_id` es null → `local_operativo(null)`. Desde acá la app vieja sigue andando. | `create or replace` + `drop trigger if exists` |
| 4 | **Backfill:** `update … set location_id = local_operativo(null) where location_id is null`, por lotes en `cash_movements`. Aborta si no hay exactamente un local activo. | `where … is null` |
| 5 | Verificar `count(*) where location_id is null = 0`; `validate constraint` de la FK; `set not null`. | chequeo previo |
| 6 | Únicos: crear el nuevo (`(location_id, session_date)`, `(location_id, role)`, …) **antes** de borrar el viejo. | `if not exists` |
| 7 | (Fase 4) Policies nuevas, borrando las viejas en la misma transacción. | `drop policy if exists` |

**Rollback** (un `scripts/sql/0NN_rollback.sql` por migración, como siempre):
policies viejas restauradas desde el respaldo → único viejo recreado → `drop not null` → `drop trigger` → `drop
column`. **Solo es limpio mientras exista un solo local con datos.** Cuando un segundo local tenga filas, el
rollback de columnas ya no aplica (se perdería a qué local pertenece cada fila): desde ahí el rollback es de la app,
no de la base. Y la regla 10: nunca sacar de `main` el `.sql` de algo que ya está en el ledger de prod.

---

## 11. Numeración de migraciones

- Todo esto es del **bloque CAJA / operación: 087–099** (`supabase/migraciones-reservadas.json`, `ESTADO.md` →
  «Numeración de migraciones»). La **087** ya la usa la propuesta de auditoría de `employees`
  (`claude/employees-audit`).
- **Los números se asignan al implementar**, uno por PR, con el siguiente libre del bloque en ese momento, y se
  registran en `asignadas` del JSON y en la tabla de `ESTADO.md` **en el mismo PR** (el gate lo exige). Este plan
  no reserva números.
- Cálculo grueso: 6 a 8 migraciones. Si el bloque no alcanza (088–099 son 12 y lo comparte con Salarios, PoS propio y
  seguridad), se pide un bloque nuevo **antes** de usarlo (regla 1).
- Los cambios de BioTime/Salarios van con la numeración que le toque al pase de Salarios. Al ir a prod, lo que quede
  ≤ al último del ledger se renumera al bloque de PASE (150–199) (regla 3).

---

## 12. Fases y estimación

**Supuestos de la estimación:** horas de desarrollo con Claude Code, incluyendo tests, rollback, aplicación y
verificación en staging, y actualización de la guía de `docs/sop-app/`. **No incluye** el tiempo del dueño
(decisiones, firmas, pruebas físicas), ni esperas por la ventana sin servicio (19–22 h), ni el pase de Salarios en sí.
Rango = sin sorpresas / con sorpresas típicas (drift de prod, tests que ajustar).

| Fase | Qué | Cambia comportamiento | Firma | Horas |
|---|---|---|---|---|
| **F0** | Decisiones (§13) + `locations` en prod con `caja_activa`, `local_operativo()`, `puede_ver_local()`, `mis_locales()`, `profile_locations`, `employee_locations` (vacías). | no | sí (esquema) | 6–9 |
| **F1** | Columna + trigger + backfill + NOT NULL + únicos nuevos en caja, cierre, propinas, puntos y ventas legado. La app actual sigue igual (el trigger completa). | no | sí | 14–20 |
| **F2** | App: `LocalProvider`, selector, `shared/api/*` filtra y manda el local, outbox y realtime por local, `LOCALES` desde datos, textos con el nombre del local. | sí (invisible con un local) | sí | 24–34 |
| **F3** | Cierre por local: `cerrar_dia_completo` / `deshacer` con `p_location`, `client_op_id` del ajuste, «Borrar el día», pozo y días sin cierre por local. | sí | **sí, sagrado** | 10–14 |
| **F4** | RLS por local + RPC de ventas con `puede_ver_local` + pantallas de Admin (locales de usuarios y empleados, puntos por local). Pruebas con un usuario real por rol. | sí | sí | 12–16 |
| **F5** | Empleados y BioTime por local (staging, con el pase de Salarios): `pos_login` y `biotime_emp_code` por local, `ingest-punches` valida contra datos, sin default en `work_days`. | sí | sí | 12–18 |
| **F6** | Reportes: consolidado «Todos» para owner/contador, `monthly-report` y `cierre-email` por local, P&L por local (`finance_budget`, `finance_actuals`, `accounting_entries`). | sí | sí (P&L) | 12–18 |
| **F7** | Encender el segundo local: alta por runbook en staging, ensayo de un día completo (turno → propinas → cierre), después prod. | sí | sí | 6–8 |
| | **Total** | | | **96–137** |

**Orden y dependencias:** F0 → F1 → F2 → F3 → F4 → F7. F5 corre en paralelo atada al pase de Salarios. F6 puede
empezar después de F2. **Abrir el segundo local (F7) exige F0–F4**; F5 si ese local usa BioTime y F6 si se
quieren los reportes consolidados desde el día uno.

---

## 13. Riesgos

| Riesgo | Mitigación |
|---|---|
| Choque del `client_op_id` del ajuste del cierre entre locales (§3). | F3 antes de abrir el segundo local; Santa Teresa conserva la fórmula. |
| `getOpenCashSession()` y el chequeo de turno abierto del cierre miran **todos** los locales: un turno abierto en uno bloquearía el cierre del otro. | F2 + F3. |
| Operaciones encoladas offline de una app vieja (sin local) que sincronizan con dos locales activos. | El trigger rechaza con error claro; la app nueva se despliega y se asienta **antes** de encender el segundo local. |
| Staging ya tiene dos locales activos en `locations` (sembrados por la `022`). | La resolución usa `caja_activa`, no `is_active`; en staging se enciende solo uno hasta F7. |
| Drift de prod: `cash_cierres_dia`, `ventas_*` se crearon fuera de migraciones (baseline `0095`); puede haber únicos o policies que no están en el repo. | Leer el catálogo de prod (solo lectura) antes de escribir cada migración de F1. |
| Backfill largo en `cash_movements` bloqueando la caja en servicio. | Por lotes y fuera de 19–22 h. |
| Rollback imposible una vez que hay datos de dos locales. | Documentado; F7 con un día de ensayo en staging. |
| Códigos de BioTime y logins del PoS que se repiten entre locales. | F5 antes de conectar el reloj o el PoS del segundo local. |
| Sagrados tocados «sin querer» al pasar el local. | Verificación por hash de blob (regla 8) en cada PR: `cashUtils.ts`, `tipCalculations.ts`, `posFiscal.ts` iguales. |

---

## 14. Decisiones abiertas para el dueño

1. **Catálogo:** ¿`public.locations` (la de la `022`) como única fuente, con `club_config` colgando de ella? (propuesta: sí).
2. **¿Quién ve qué?** ¿El manager de un local ve el otro? ¿El contador ve todos? (propuesta: manager y cajero solo los suyos; owner y contador todos).
3. **Rol por persona o por local:** ¿alcanza un rol por persona + `covered_role` por turno? (propuesta: sí; roles por local es mucho más grande).
4. **Banco:** ¿una sola caja «Banco» para la empresa o una por local?
5. **Proveedores y créditos a proveedores:** ¿globales (la misma lista para los dos) o por local?
6. **Puntos de propina:** ¿tabla de puntos por local o una sola para todos?
7. **Pozo de propinas:** ¿un pozo por local (propuesta) o se comparte alguna vez?
8. **Carta y temporadas:** ¿`product_map` y las temporadas son iguales en los dos locales o cada uno tiene las suyas?
9. **P&L:** ¿presupuesto y reales por local, consolidado, o los dos?
10. **Firma de los sagrados en F3:** RPC del cierre y fórmula del `client_op_id` del ajuste (Santa Teresa sin cambios).
11. **Nombre de la columna:** `location_id` en lo nuevo y `local` donde ya existe, sin renombrar (propuesta: sí).
12. **Orden:** ¿se abre el segundo local con F0–F4 y los reportes consolidados llegan después, o se espera a F6?
