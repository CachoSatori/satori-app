# SPEC (mejora, **DIFERIDA**) — Reorganización UI: «Ventas por turno» + Saloneros por empleado

> ## ⛔ NO INICIAR TODAVÍA
>
> **Estado: ANOTADA.** Ismael pidió dejar esto registrado como mejora de specs, pero la
> **prioridad inmediata es P2** (que todo el módulo Ventas se alimente del PoS y no del xls).
> Esta mejora **se retoma después de P2**.
>
> Si estás leyendo esto para arrancar a construir: verificá primero que P2 esté cerrado.

**Fuente:** feedback sobre la pestaña «Saloneros x línea» (Parte B) con datos del **30-ago-2026** —
*«toda la información pero súper desordenada»*.

---

## Diagnóstico (qué está desordenado hoy)

La info de Parte B **es correcta**, pero está partida en dos lugares que no conversan:

- **«Saloneros x línea»** — dos lentes (Venta propia por línea / Mesa propia por factura) en
  tablas separadas, cortadas por turno (Mañana·almuerzo / Tarde·noche), con filas Caja / Sin
  código / Total del turno. Muy densa: el lector tiene que cruzar **dos tablas y dos turnos a
  mano** para entender a UNA persona.

- **«Saloneros» (la vieja)** — KPIs de jornada completa + ranking, con **otra fuente** (el mesero
  del pedido, no el de la línea).

El dato existe; lo que falta es una organización que responda **dos preguntas distintas por
separado**: *«¿cómo fue el turno?»* y *«¿cómo vendió cada quién?»*.

---

## Mejora 1 — KPI / vista «Ventas por turno»

**La unidad es el turno, no la persona.** Un bloque por turno (Mañana·almuerzo / Tarde·noche) que
se lea de un vistazo y responda:

- **Quiénes trabajaron** ese turno (los saloneros con líneas/mesas en el turno).
- **Cómo vendió el turno:** venta neta del turno, PAX, ticket promedio, prom/pax.
- **Bebidas por PAX** (ratio de bebidas / comensales del turno).
- **Qué se vendió:** top productos del turno y **combinaciones** (qué se pide junto — insumo para
  Ing. Menú / Mix, pero resumido acá).
- **Promedios del turno** como línea de contexto, para comparar personas contra el turno.

**Objetivo:** que el gerente entienda **el turno como unidad operativa**, sin leer una tabla por
persona.

---

## Mejora 2 — Sección «Saloneros» dividida por empleado

**La unidad es la persona.** Una tarjeta/bloque por empleado, y adentro:

- **Sus métricas por turno** (no solo el total del día): cómo vendió en Mañana·almuerzo vs
  Tarde·noche.
- **Las dos líneas que hoy están separadas, juntas bajo la persona:**
  - **Venta por línea** (venta propia — el ranking).
  - **Venta por mesa** (mesa propia — contexto).
- **Un resumen del promedio de la persona:** su prom/pax, su ticket promedio, su aporte.

**Objetivo:** abrir un empleado y ver **todo lo suyo en un solo lugar**, ya cruzado por turno, sin
saltar entre dos tablas.

---

## Restricciones que se heredan de Parte B (v1, YA FIRMADAS)

**No se cambian sin nueva firma:**

- **PAX = solo artículo `677`** (no `678`×2).
- **Turnos v1** = mañana (`111`) / noche (`222`) / día (el resto). **Sin fila Bar** (`388` es solo
  caja).
- **Ranking = venta propia** (la línea). **Mesa propia** = dueño del `677`; sin PAX → mayoría de
  neta; ticket promedio = **neta entera**.
- **Las dos columnas/lentes NO se suman.**
- **Mapa de códigos:** ROSAURA `{01, 235}` · ESTEBAN `{023, 555}` · `02` genérico · `111`/`222`/
  `388` caja · `null` otro.
- **Sagrados no se tocan.** IVA / servicio / valor servido tal como quedaron.

> Dónde vive cada una hoy: los turnos y el mapa de cajas en `src/shared/ndf/jornada.ts`; el mapa
> de códigos y la unificación de personas en `src/shared/ndf/personasNdf.ts`; las dos lentes y sus
> desempates en `src/modules/ventas/saloneroLentes.ts`. Las tres son puras y tienen tests que
> fijan estas reglas — reusarlas, no reimplementarlas.

---

## Fuente

Cuando se construya, esta vista debe leer **del PoS** (`pos_ndf_ticket_lines` + tickets, vía
`saloneroLentes.ts` / `ventasDiasDesdePos.ts`), **no del xls**. O sea: **se hace después de P2**,
sobre la fuente ya migrada.

---

## Fuera de alcance de esta nota

- **No** es una migración de datos ni toca esquema.
- **No** define el layout final (tarjetas vs tabla plegable): eso se decide al retomar, con Ismael
  viéndolo en staging.
