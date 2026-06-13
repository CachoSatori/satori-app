# SPEC — Gaps de comanda priorizados (para decidir, NO implementado)

> Tres hallazgos nuevos que surgen del análisis de competidores (`SPEC-COMPETIDORES-PoS.md`) y de la
> operación real. **Ninguno está implementado.** Cada uno marcado **⏳ pendiente de profundizar /
> decidir** con su impacto, el estado actual de Satori y un boceto de alcance.

---

## 1. Comp vs Void — separar el regalo intencional de la anulación por error  ⏳  🟡 (impacto P&L)

**Problema**: hoy Satori solo tiene **Void** (anular ítem enviado = `kitchen_status 'anulado'`, mig
029). Pero "anular" mezcla dos cosas distintas para la contabilidad:
- **Void** (error / no se hizo): el ítem **no se preparó** → no consume inventario, no es venta, no
  cuesta. Es lo que hoy hace `voidOrderItem`.
- **Comp** (cortesía / regalo intencional): el ítem **SÍ se hizo y se entregó gratis** → consume
  inventario (impacta COGS), no genera ingreso, y debe ir a un **reporte de cortesías** para el P&L
  (saber cuánto se regala y por qué).

**Estado Satori**: solo Void. Un ítem regalado hoy se "anula" → desaparece como si no se hubiera
hecho, lo que **subestima el costo real** (la cocina sí gastó el insumo).

**Alcance a profundizar** (no ejecutar):
- Aditivo: `kitchen_status` o un flag `comped boolean` + `comp_reason` + `comped_by` en
  `pos_order_items` (separado de `void_reason`). Permiso de gerencia (mismo patrón `requireManager`).
- En la cuenta: el comp NO suma al total (igual que void) PERO queda contabilizado como cortesía.
- Reporte de cortesías por período/motivo/responsable para el P&L.
- Cuando exista depletion de inventario (`SPEC-LAVU-OPERACION.md` §5.1): el comp **sí** descuenta
  ingrediente; el void **no**.
- **Decisión de la dueña**: ¿motivos de comp? (cliente VIP, error de cocina ya servido, marketing…),
  ¿quién autoriza?, ¿tope diario?

**Severidad**: 🟡 (no urgente operativamente, importante para la verdad del P&L). Toca esquema
(aditivo) → análisis + acuerdo antes de cualquier sprint.

---

## 2. Disparo por tiempo de preparación (fire-by-prep-time) — salida coordinada  ⏳  🟡 (dato ya existe)

**Problema**: al marchar una mesa, todo entra a la cola del KDS al mismo tiempo; los ítems rápidos
(una bebida, una entrada simple) salen antes que los lentos (un roll elaborado) → la mesa recibe la
comida desincronizada.

**Patrón (Toast)**: cada ítem tiene **tiempo de prep**; el sistema retrasa el disparo de los rápidos
para que TODO salga junto ("fire-by-prep-time" / coordinated firing).

**Estado Satori**: el campo **`prep_time_min` YA existe** en la ficha del producto (mig 025) y se
captura — pero el KDS **no lo usa**. El KDS ordena por subcategoría y prioridad de postres, no por
tiempo objetivo de salida.

**Alcance a profundizar** (no ejecutar):
- Cálculo puro (testeable): dado un conjunto de ítems marchados con su `prep_time_min`, calcular el
  **momento de disparo** de cada estación = (tiempo objetivo de salida) − (prep del ítem), tomando el
  más lento como ancla.
- KDS: mostrar el ítem como "en espera de disparo" hasta su momento, luego activarlo; o un indicador
  de "arrancá esto ahora para salir junto".
- **Sagrado-adyacente**: NO toca plata; sí cambia el comportamiento del KDS → requiere validación
  física con la cocina real (los tiempos del CSV son estimados).
- **Decisión**: ¿salida coordinada por mesa o por curso? ¿se respeta el escalonado de cursos actual?

**Severidad**: 🟡 (alto valor en servicio, dato ya presente, riesgo medio porque cambia el KDS).

---

## 3. Revenue centers — atribución de venta por área (salón / barra / terraza)  ⏳  🟡

**Problema**: la dueña quiere saber cuánto vende cada **área física** (salón vs barra vs terraza vs
eventos), no solo cuánto vende cada salonero o cada producto.

**Patrón (Toast)**: cada venta se etiqueta con un **revenue center** configurable; los reportes
desglosan ingreso por área.

**Estado Satori**: la orden tiene `channel` (salon/barra/delivery) — sirve para el servicio 10% por
canal, **pero no es un "centro de ingreso" configurable por mesa/zona** ni hay reporte por área. El
editor de salón ya ubica mesas/decor por coordenadas pero sin "zona" nombrada.

**Alcance a profundizar** (no ejecutar):
- Aditivo: `revenue_center` (o `zona`) en `salon_tables` (ej. "Terraza", "Barra", "Salón interior") y
  snapshot en `pos_orders` al abrir. Editable desde el editor de salón.
- Reporte de ventas por revenue center (reusa los pagos/órdenes ya existentes, agregados por zona).
- **No confundir con `channel`** (que es salon/barra/delivery para el cálculo fiscal del servicio):
  el revenue center es geográfico/contable y puede coexistir.
- **Decisión de la dueña**: ¿qué zonas?, ¿una mesa puede cambiar de zona?, ¿la terraza paga servicio?

**Severidad**: 🟡 (valor de gestión, aditivo, bajo riesgo técnico). Decisión de taxonomía de zonas
primero.

---

## Prioridad sugerida (a confirmar con la dueña/asesor)
1. **Comp vs Void** — corrige la verdad del costo (P&L); aditivo, permiso ya existe.
2. **Revenue centers** — reporte por área; aditivo, bajo riesgo; necesita definir zonas.
3. **Fire-by-prep-time** — mejor servicio; dato ya presente; requiere validar tiempos reales con cocina.

Ver también: `SPEC-COMPETIDORES-PoS.md` (origen de estos gaps) y `../SPEC-LAVU-FLUJO-MESA.md`
(semáforo de paridad de la comanda).
