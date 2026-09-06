SPEC — Módulo Analítica PoS en tiempo real (visión y métricas)
Borrador de trabajo, 2026-09-02. Depende de acceso de lectura a la base `ndf` del PoS (pendiente: grant `db_datareader` a `ClienteConsulta`). Las métricas marcadas (necesita) se confirman contra el esquema real cuando tengamos acceso.
1. Ventaja estratégica: dos streams en vivo
Por primera vez Satori tendrá dos fuentes en tiempo real cruzables:

* Ventas (PoS `ndf`, en vivo): tickets, ítems, horas, salonero, mesa/pax, medio de pago.
* Trabajo (BioTime, en vivo): quién está fichado, cuándo, cuántas horas.

El cruce ventas × trabajo es lo que los PoS del mercado (Toast, Square, Lavu) no hacen bien porque no tienen el reloj integrado. Ahí está la ventaja competitiva.
2. Arquitectura (recomendada)
Mismo patrón probado que BioTime:

* Agente PoS (Node/TS, read-only) drena ventas de `ndf` → Supabase cada 1–5 min. Idempotente por id/fecha de ticket.
* La app lee de Supabase: rápido, desacoplado, con histórico propio. No expone la conexión al PoS ni depende de que esté arriba.
* "Siempre actualizado" = lag de minutos (perfecto para operación).
* Alternativa (app consulta el PoS directo) descartada: acopla y carga su servidor.
* Requiere mapear identidad salonero PoS → empleado Satori (como el `biotime_emp_code`).

2.1 Integración en la app (decisión 2026-09-02)

* NO se crea un módulo nuevo. La UI del live se integra en el módulo existente `src/modules/ventas/` como pestaña "En vivo".
* Tipos alineados a `DiaData` / `xlsParser.ts` (el modelo que ya consume ventas). Lo live-only extiende ese modelo de forma aditiva (campos opcionales). El artículo pax se excluye del mix.
* El feed del agente PoS apunta a la misma forma que hoy produce el import de xls (`ventas_dias` / `DiaData`) + detalle live → a futuro el PoS reemplaza el import manual de xls.
* Secuencia segura: primero la pestaña "En vivo" aditiva (nada del ventas actual cambia); después, con datos reales confirmados, se teje el live en la primera pestaña y el resto donde corresponda.

3. Catálogo de métricas
A. Ventas en vivo (corazón — arranque)

* Venta acumulada del día (₡), en vivo desde apertura.
* Ritmo por hora y proyección de cierre del día.
* Tickets (cantidad) y ticket promedio (₡).
* Pax / cubiertos y venta por pax (₡) — KPI central en gastronomía. Ver §3.F (doble fuente de pax).
* Comparativa vs mismo día de la semana pasada y promedio últimas 4 semanas.
* Por local (ST vs Nosara) lado a lado.

B. Producto (categorías / subcategorías)

* Ventas por categoría / subcategoría / producto (jerarquía). (necesita: catálogo con categoría/subcategoría)
* Top productos por unidades y por ₡.
* Mix de venta (% sushi / cocina / bebida / etc.).
* Ítems por ticket (indicador de upselling).
* Anulaciones / descuentos / cortesías (control de fugas de dinero). (necesita: voids/descuentos)
* Menu engineering (estrella / vaca / incógnita / perro). (necesita: costo por producto — fase posterior)
* ⚠️ El "artículo pax" NO es venta real — hay que excluirlo de todas las métricas de producto/ingreso y usarlo solo como conteo de comensales (ver §3.F).

C. Tiempo / ritmo / turnos

* Curva de ventas por hora (heatmap del día).
* Turnos reales (mañana/noche por corte horario) y diferencia de consumo entre turnos.
* Horas pico y patrón por día de la semana.
* Rotación de mesa / tiempo de permanencia. (necesita: apertura y cierre de mesa)

D. Labor × Ventas (el cruce — lo más potente)

* Costo laboral en vivo: personas fichadas ahora + costo/hora acumulado.
* Labor cost % = costo laboral / ventas (KPI rey; meta típica 25–35%).
* Ventas por hora-persona (SPLH) = ₡ vendidos / horas trabajadas.
* Staffing vs demanda: dotación vs venta por franja (detecta sobre/sub-staffing).
* Venta por salonero y venta por pax por salonero.
* Rendimiento salonero × franja horaria (en qué horario cada uno vende más/mejor). (necesita: salonero en el ticket + mapping)
* Propinas vs ventas por salonero (ya parcial en el sistema).

E. Salud financiera del día (gerencia)

* Bruto / neto / IVA 13% / servicio 10%.
* Medios de pago (efectivo, tarjeta…) → cuadre con la caja diaria de Satori. (necesita: medio de pago por ticket)
* Descuentos / cortesías / anulaciones como % de venta.
* (Futuro) Prime cost = labor + costo de mercadería (el KPI definitivo en gastronomía).

F. Pax — doble fuente + calidad de dato (palanca operativa)
Hay dos formas de registrar comensales, y hoy no coinciden:

* Pax nativo del PoS: campo en la mesa, no obligatorio → mal cargado por los saloneros, sin confirmación.
* "Artículo pax": producto que se timbra para contar comensales. Hoy es el más confiable y visible.

Estrategia:

* Fuente primaria de pax = artículo pax (mientras el nativo no sea confiable). La venta por pax se calcula con esta.
* Capturar también el pax nativo para comparar.
* Indicador de calidad/adopción por salonero: % de mesas con pax nativo cargado y % de match nativo vs artículo. → Es la evidencia para exigir el uso correcto y, cuando el nativo llegue al 100%, eliminar el artículo pax.
* ⚠️ Identificar el artículo pax en el catálogo (nombre/código) y excluirlo de ingresos y del mix de producto. Confirmar si tiene precio (si no es ₡0, distorsiona la venta y hay que restarlo).

G. Cierre de caja en efectivo asistido (Fase B — TOCA PLATA, firma)
Al hacer el cierre de sistema, con la venta en efectivo del PoS en vivo + los movimientos de caja que ya tiene Satori, el sistema calcula solo el efectivo esperado:
Efectivo esperado en caja = fondo + ventas en efectivo (PoS) − pagos a proveedores − otros egresos

* Muestra "deberías tener ₡X en caja fuerte", el cajero cuenta el físico y se ve el descuadre al instante.
* Reduce fricción del cierre y da trazabilidad total del efectivo (prioridad del proyecto).
* Dependencias: medio de pago por ticket (PoS) + movimientos de caja (proveedores/egresos, ya en Satori).
* ⚠️ Toca dinero y roza módulos/archivos sagrados (caja diaria, `cashUtils`, `computeTotals`, `posFiscal`). → Mini-spec aparte, con firma y diseño cuidadoso. No entra en el scaffold a ciegas.

H. Combos / market basket / upselling (Fase C)
Con el detalle ítem por ticket (cierre por mesa):

* Análisis de afinidad: pares/tríos de productos que aparecen juntos (support, confidence, lift) — el "combo real" que arman los clientes.
* Attach rate: % de tickets con bebida / postre / entrada → dónde se está dejando plata.
* Descomposición del ticket promedio por categoría → el por qué del promedio.
* Recomendaciones de upselling: "cuando piden X, sugerir Y" (por lift). Productos ancla para armar combos.
* Dependencia: datos a nivel ítem por ticket (cierre por mesa).

4. Dependencias / incógnitas (a confirmar con el esquema)

* ¿El ticket trae pax nativo, salonero, mesa, medio de pago?
* Identificar el "artículo pax" en el catálogo (nombre/código) y si tiene precio.
* ¿Hay catálogo con categoría/subcategoría? ¿jerarquía o plano?
* ¿Se registran anulaciones / descuentos / cortesías?
* ¿Timestamps de apertura/cierre de mesa? ¿detalle ítem por ticket accesible?
* Clave incremental para el agente (id de ticket / fecha).
* Mapping salonero PoS → empleado Satori.

5. Fases

* Fase A (hoy) — Ventas en vivo del día (pestaña "En vivo" dentro de ventas, aditiva): acumulado, ritmo/hora, tickets, ticket promedio, venta por pax (vía artículo pax), por categoría, comparativa vs histórico, por local. Incluir indicador de calidad de pax por salonero. → Objetivo: abrir y ver la venta actualizada, siempre.
* Fase B — Cruce con labor (costo laboral en vivo, labor cost %, SPLH, staffing vs demanda) + cierre de caja en efectivo asistido (§3.G, mini-spec con firma). Tejer el live en las pestañas existentes de ventas.
* Fase C — Rendimiento por salonero × franja, combos/upselling (§3.H), menu engineering, rotación de mesa, prime cost. Retiro del artículo pax cuando el nativo esté al 100%.

6. Riesgos / reglas

* Solo lectura, consultas livianas e incrementales (no cargar el server del PoS).
* Identidad salonero (mapping) — igual que pasó con BioTime.
* Excluir el artículo pax de ingresos (no contaminar ventas).
* La pestaña "En vivo" es aditiva: no cambia el comportamiento actual de ventas ni el parsing de `xlsParser` hasta confirmar datos reales. Tejer el live en las pestañas existentes recién con datos confirmados.
* El cierre de caja asistido (§3.G) toca plata y archivos sagrados → firma + mini-spec, nunca en el scaffold a ciegas.
* No mezclar con archivos sagrados ni con la caja hasta validar el cuadre de medios de pago.
* Estabilizar Fase A antes de sumar B/C.
