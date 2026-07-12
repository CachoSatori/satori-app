# Research PoS — Gap Analysis contra el ROADMAP de Satori (Fase 3)

> Satori App · 2026-07-10 · Cruce del research (fichas + mejores prácticas, todo con fuente verificada)
> contra el estado REAL del repo (ROADMAP.md / ESTADO.md @ main 6c65f25).
> **Veredictos: 🏆 YA-SUPERIOR · ✅ VALIDADO (ya planificado, el mercado lo confirma) · ➕ REPLICAR (nuevo) · 🔧 MEJORAR (existe, falta algo) · ❌ DESCARTAR.**
> **✅ FIRMADO POR EL DUEÑO 2026-07-10** (lista de 6, veredictos A-E, descartes D1-D4 y priorización). La ejecución de cada ítem C sigue pidiendo firma al implementar.

---

## A. Dónde Satori YA es superior al mercado SMB (no tocar, defender)

| # | Ítem | Evidencia del research |
|---|---|---|
| A1 | 🏆 **Pooling de propinas automático por puntos/roles/coberturas, sin paywall** | Toast nativo NO distribuye (solo sugiere; automatizar = add-on pago); Square lo encierra en Plus/Premium; Lightspeed ni lo tiene. Satori lo hace solo, gratis, con coberturas — mejor que los 3. |
| A2 | 🏆 **Efectivo/electrónico en propinas (recién a prod):** la casa solo debe lo electrónico, pagado como movimiento real trazable | Es el neteo del Shift Review de Toast + el pay-out etiquetado de Square, unificados en la vía-real de Satori. Ninguno de los 6 lo tiene tan integrado caja↔propinas. |
| A3 | 🏆 **Cierre con integridad de plata:** 2 fases + conteo físico + gate de ajuste con motivo+contraseña + ajuste como movimiento del ledger (Opción B) | El umbral gerencial de Toast (Over/Short Max) ya existe en Satori (mig 045). El anti-patrón de Toast (auto-close que captura sin propina) valida la regla Satori de confirmación humana. |
| A4 | 🏆 **Ingesta de facturas foto+IA integrada a caja e inventario** | Es xtraCHEF (el add-on premium de Toast), pero nativo y conectado al flujo de caja. En SMB nadie lo da integrado. |
| A5 | 🏆 **Escrituras de caja durables** (outbox idempotente, nunca colgada/descartada) | Ningún doc de los 6 promete el invariante que Satori ya testea (`cash.durability.test.ts`). |

## B. Decisiones del ROADMAP que el research VALIDA (seguir igual, con refuerzo)

| # | Ítem del ROADMAP | Validación |
|---|---|---|
| B1 | ✅ **HUB LOCAL (F5)** — mini-PC como servidor LAN | **Los 3 líderes lo hacen:** Toast (hub local sync), TouchBistro (red local cableada), Simphony (CAPS obligatorio, 1 por propiedad). No es sobre-ingeniería: es EL patrón de la industria. Recomendación: subirlo conceptualmente — el hub es parte de la ARQUITECTURA (sesión/offline), no una feature tardía. |
| B2 | ✅ **`locations` desde el diseño (F1)** | Simphony EMC confirma que multi-local se diseña desde el modelo de datos, no se parchea. |
| B3 | ✅ **PILAR de auth ANTES del rollout del PoS** | CAPS/hub demuestran que multi-dispositivo se resuelve con una capa local + jerarquía clara, no con retry del cliente. |
| B4 | ✅ **KDS propio simple en TVs/mini-PC** | TouchBistro TERCERIZÓ su KDS con hardware cautivo — señal de que un KDS simple y enfocado es la meta correcta; no ambicionar de más. |
| B5 | ✅ **Reglas transversales** (transferencia de mesa con atribución; el último turno no cierra con mesas vivas) | TouchBistro vende la transferencia de mesa como feature premium; Satori ya la especificó con atribución de métricas — mejor. |
| B6 | ✅ **F1.2-1.4 Inventario: recetas → depleción → costo** + SPEC unificación §19 (P&L por línea) | Es exactamente el recipe-costing de xtraCHEF Pro (lo que Toast cobra aparte). La dirección es correcta y valiosa. |

## C. Ideas NUEVAS a considerar (➕ replicar / 🔧 mejorar — cada una espera firma)

| # | Idea (fuente) | Qué es | Esfuerzo estimado | Cuándo |
|---|---|---|---|---|
| C1 | 🔧 **"Tips owing" por EMPLEADO** (Lightspeed) | Vista del pasivo de propinas por persona (hoy Satori lo tiene por turno). Con la base ef/elec nueva, es una agregación de lo existente. | S | Post-ventana, cuando quieran |
| C2 | 🔧 **Historial de over/short del cierre** (Toast) | Reporte agregado de diferencias de cierre (frecuencia, monto, tendencia). Los datos YA existen (movimientos de ajuste); falta la vista. | S | Con el próximo lote de reportes |
| C3 | ➕ **Email automático del Cierre del Día al owner** (Square) | El resumen del cierre (el mismo del popup nuevo) por correo. Infraestructura de emails ya existe. | S | Post-ventana |
| C4 | 🔧 **Config multi-local con herencia-y-override** (Simphony EMC) | Al diseñar el PILAR/multi-tenant: config a nivel empresa → local → estación, con override selectivo. Es un patrón de MODELO DE DATOS para el diseño del pilar, no una feature ya. | Entra en el diseño del PILAR | Diseño del PILAR |
| C5 | ➕ **Umbral de red configurable para pasar a offline** (Simphony) | En el PoS: si la señal/latencia cae bajo umbral, la tablet pasa sola a modo offline sin esperar el timeout. Encaja con la máquina de estados de realtime ya construida. | M | Con el PoS (F2+) |
| C6 | ➕ **Edición remota del plano de salón con sync** (TouchBistro) | El editor de salón de F1 editable desde cualquier dispositivo con sync al local. | Detalle de F1 | F1 |
| C7 | ➕ **Fichaje (clock in/out) + costo laboral en vivo** (TouchBistro/Toast) | No existe en Satori (horas se cargan a mano en propinas). Un fichaje simple alimentaría propinas + P&L laboral. **Decisión de producto nueva.** | M | Post-PoS, si el dueño lo quiere |
| C8 | ➕ **Mini-cierre por salonero estilo Shift Review** (Toast) | Ya diseñado como "Mi Turno" en operación-roles #3 — el research lo confirma y sugiere sumarle el neteo (sus propinas electrónicas vs su efectivo). | Ya diseñado; ajustar spec | Con el PoS |
| C9 | ➕ **Posteo a folio de huésped (patrón OPERA)** (Simphony) | Para la ambición hotelera: diseñar (no construir) cómo un consumo de restaurante postea a una cuenta maestra externa con desglose. Referencia para el diseño multi-tenant. | Diseño futuro | Visión hotelería |

## D. Qué DESCARTAR con criterio (❌)

| # | Ítem | Por qué |
|---|---|---|
| D1 | ❌ Cierre de día 100% automático (Toast 4am) | Anti-patrón demostrado para el contexto Satori: captura plata sin confirmación (propinas perdidas al batch). La regla Satori — la plata la confirma un humano — se mantiene. |
| D2 | ❌ Pooling "al momento de abrir el cheque" (Toast) | Atribución injusta en cambios de turno; el modelo por turno+puntos de Satori es superior. |
| D3 | ❌ KDS con hardware dedicado/cautivo (TouchBistro) | Contra el principio de Satori de hardware barato (TVs + mini-PC). |
| D4 | ❌ Features de plata como add-on pago | Si Satori algún día se vende a terceros, la caja/arqueo va en el plan base (validado por Fudo: el arqueo está hasta en su plan mínimo). |

## E. Huecos del research (honestos — posibles próximas pasadas)

1. **Facturación electrónica CR/LatAm** — NO quedó cubierto con verificación. Ya existe como tarea F0 del ROADMAP ("matriz de decisión de emisores certificados CR") y es MÁS urgente que este research: bloquea F3. Recomendación: sesión dedicada propia.
2. **Quejas reales de usuarios** de los 6 — los claims de reviews no sobreviven verificación adversarial; si el dueño quiere este ángulo, se hace como lectura direccional (sin rango de "verificado").
3. **Pricing completo** (solo Fudo verificado) y **KDS/multi-local de Square y Lightspeed**.

---

## Priorización recomendada (para discutir con el dueño — NO firmada)

1. **Cola ya firmada primero** (sin cambio): rojo/huérfanos → reconciliación del ledger → hora-CR.
2. **Quick wins del research** (S, sin esquema): C2 (historial over/short) + C3 (email del cierre) — un solo lote de reportes.
3. **C1 (tips owing por empleado)** — S, aprovecha la base ef/elec recién pasada a prod.
4. **Al diseñar el PILAR**: incorporar C4 (herencia/override) y B1 (hub como pieza de la arquitectura) al documento de diseño.
5. **Con el PoS (F2-F3)**: C5 (umbral de red), C6 (plano remoto), C8 (Mi Turno con neteo).
6. **Decisión de producto aparte**: C7 (fichaje) — la abre el dueño si le interesa.
