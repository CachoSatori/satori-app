# Pase a PROD de la mig 190 `pos_ventas_resumen` (origen club/puente 134)

> **⛔ Esquema: firma del dueño sobre el SHA exacto.** Decisión firmada el 18-nov-2026 10:36 -06:00 («1. B firmo»):
> función nueva de SOLO LECTURA para que Ventas v2 («Resumen», #290, y después «Tiempos») no baje decenas de miles de
> facturas y líneas en «Año a la fecha» o «Temporada». Esa firma es la de la idea; el pase necesita la firma sobre el SHA.
> Si algo no coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Orden:** primero #290 (`claude/ventas-v2-resumen`) a `main`; después este PR (su base es esa rama). Sin la
>   función, la app de #290 sigue andando por la 067; con la función y sin este código, nadie la llama.
> - **Ledger:** exactamente 1 fila `190` con su `name` (`pos_ventas_resumen`).
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§4 y §5).

## 1. Qué pasa y qué no
**Pasa:** una función **nueva** `public.pos_ventas_resumen(text, date, date) → jsonb`, `SECURITY DEFINER`,
`search_path = public, pg_temp`, `STABLE`. Rol adentro: owner, manager, contador activos; el resto **42501**. EXECUTE:
`revoke` de `public` y `anon`, `grant` a `authenticated`. Devuelve, para un tramo `[desde, hasta]` (ventana de lectura
igual a `ventanaRangoJornadas`: un día antes y dos después):
- `dias`: por día CR de factura, neta / IVA / servicio / delivery en céntimos crudos, PAX y facturas;
- `facturas`: las de salón, con lo que pide la venta por persona D4 (neta, pax, parte de familia 28, total, caja, cierre);
- `lotes`: (caja, cierre, apertura) de todas las facturas de la ventana, para el día y turno de sesión.

App: `resumenV2Datos.ts` la usa (un pedido por tramo de ≤ 366 días); si la base contesta «la función no existe»,
vuelve sola a la lectura de la 067. Otro error (42501, red) no se tapa.

**No pasa:** medios de pago, vuelto, `clase_ingreso`, `numero_pedido`, mesas o nombres (regla 6); ninguna policy ni
tabla nueva; `pos_ndf_*` siguen cerradas a gerencia; ningún dato; sagrados intactos; ninguna Edge.

## 2. Prerrequisitos
- #290 mergeado y con su verificación (la función es para su pantalla).
- Ledger de prod = **189** (leído el 18-nov en solo lectura). Si hay otra migración en cola, la 190 va después y se
  revisa que nadie más haya tomado el 190.
- Prod (solo lectura, 18-nov): `to_regprocedure('public.pos_ventas_resumen(text, date, date)')` = null; escala de
  `pos_ndf_ticket_lines.monto`, `iva_crc`, `servicio_crc`, `valor_servido_crc` ≤ 2 (los céntimos son exactos).

## 3. Pruebas (antes de aplicar, R15)
- **Staging (`hwiatgic…`), transacción descartada** (`begin … rollback`, 18-nov): batería de
  `scripts/sql/190_pruebas.sql` (casos 00–07) **8/8 ok**, contra un cálculo por factura hecho por otro camino
  (subconsultas, sin los CTE de la función), octubre 2026. El caso 08 (rollback dentro de la batería) **no se corrió por
  la MCP**: la herramienta pide confirmación para `drop`/`delete` y no se forzó. Queda para `190_pruebas.py --psql`.
- **Mutaciones** (en la misma transacción descartada, sobre la función creada): `sin_rol` → cae 05 · `lotes_solo_salon`
  → cae 03 · `sin_dia_atras` → caen 02 y 03 · `anon` → cae 05. `sin_familias` **no muerde con datos reales**: las líneas
  de las familias 6/17/20 vienen en ₡0 (may–nov 2026); la cuida `src/modules/ventas/resumenV2Agregado.test.ts`.
- **Paridad con prod (solo lectura)**: el cuerpo de la función corrido en `begin read only … rollback` para los 6 tramos
  de Ayer, Mes a la fecha y Año a la fecha (ancla 2026-11-18), contra el camino de la 067 con las mismas facturas y
  líneas de prod: días, TOTAL = suma de días, facturas, PAX, conteos y personas de la venta por persona, alerta de
  mesas sin pax: **idénticos** en el período y en todas sus bases. Valor de la venta por persona: idéntico, salvo dos
  bases de un día con 2·10⁻¹⁰ de diferencia de coma flotante (mismo número al colón). Arnés:
  `scripts/paridad-resumen/190_paridad.test.ts` (los datos no van al repo).
- **Tiempo** (prod, `explain analyze`, un tramo de un año = 12.036 facturas, 75.188 líneas): **0,27 s** en la base. La
  primera versión (`in (select …)`) recorría la tabla de líneas entera: 1,7 s; se pasó a `= any (array(...))`.

## 4. Antes del merge (prod, solo lectura, `begin read only` … `rollback`)
- Ledger: última = **189** (o la que diga ESTADO si entró otra antes). Si ya hay una `190`, **no se mergea**.
- `to_regprocedure('public.pos_ventas_resumen(text, date, date)')` = null.

## 5. Después del merge (prod, solo lectura)
- Ledger: 1 fila `190` / `pos_ventas_resumen`; check «Supabase Preview» en success con «All migrations are up to date».
- Catálogo: `prosecdef` = true, `proconfig` = `{search_path=public, pg_temp}`, `provolatile` = `s`, devuelve `jsonb`;
  `has_function_privilege('anon', …, 'execute')` = false; `authenticated` = true; sin `grantee = 0` (public) en el ACL.
- **Humo** (`begin read only`, como owner con `set_config('request.jwt.claims', …)` + `set local role authenticated`):
  `pos_ventas_resumen('santa-teresa', <ayer>, <ayer>)` trae las tres listas; Σ `dias[*][6]` = facturas C del día CR;
  como un usuario salonero (si hay uno de prueba) → 42501. Después = antes en todo lo demás (no escribe nada).
- App: «Ventas → Resumen» con «Año a la fecha» carga en ~2–3 s (antes ~10–15 s) y los números no cambian.

## 6. Criterios de parada
- Ledger distinto del esperado, la función ya existe o Branching en rojo: **no se sigue**, se avisa.
- §5 distinto (un rol que no es gerencia entra, `anon` con EXECUTE, números de la pantalla distintos): se para y se
  decide la vuelta atrás. No se arregla a mano.

## 7. Vuelta atrás
`scripts/sql/190_rollback.sql` (borra la función y la fila `190`; no hay datos). **En el mismo momento**, un PR que saca
el `.sql` de `main` (regla 10). La app no se rompe: sin la función vuelve sola a la lectura de la 067 (más lenta).

## 8. Firma y bitácora
| Cuándo (-06:00) | Quién | Qué |
|---|---|---|
| 2026-11-18 10:36 | dueño | Firma la idea («1. B firmo»): función de solo lectura para el Resumen |
| 2026-11-18 | agente | Batería en staging (transacción descartada) 8/8, mutaciones, paridad con prod en solo lectura |
| | verificador | Revisión independiente (pedida en el PR) |
| | dueño | Firma de esquema sobre el SHA exacto (OK de merge) |
| | control | §4 y §5 |
