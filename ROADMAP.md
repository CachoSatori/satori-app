# Satori App — Roadmap a producto óptimo

> De **dashboard de analítica** a **sistema operativo del restaurante**.
> Satori Sushi Bar · Santa Teresa, Costa Rica · Actualizado 2026-06-02

---

## 0. Dónde estamos hoy (honesto)

Satori App **no es un POS**. Hoy es una **capa de inteligencia de negocio** que se monta
sobre el POS existente: las ventas entran por **import XLS** (export del POS actual),
y sobre esos datos la app calcula todo lo demás.

**Lo que ya funciona en producción (maduro):**

| Dominio | Estado |
|---|---|
| Ventas / analítica | ✅ 16 vistas (Hoy, Mix, Análisis, MenuEng, Evaluación, ICP, Saloneros, Metas…) |
| Propinas | ✅ pool por turno, coberturas, verificación, quincenal, pool cocina, stats |
| Caja | ✅ turnos, cierre 2 fases, movimientos, proveedores, resumen mensual |
| Reportes | ✅ diario, semanal, **mensual unificado**, emails automáticos (ventas+propinas) |
| Admin | ✅ empleados, puntos por rol, tipo de cambio, horas trabajadas |
| Datos históricos | ✅ 2023→hoy migrados y verificados |
| SOPs | ✅ CRUD de procedimientos |
| Inventario / Recetas | 🟡 **UI completa pero VACÍA** (tablas `ingredients`, `recipes`, `recipe_ingredients`, `inventory_movements` sin datos ni lógica de consumo) |

**Arquitectura:** React 19 + TS + Vite · Supabase (Postgres + RLS + Edge Functions) · PWA.
Code-splitting por módulo. Despliegue automático en push a `main`.

**El gran límite estructural:** la app *consume* datos del POS, no los *genera*. Por eso
depende de un import manual y no tiene control sobre la operación en tiempo real (mesas,
órdenes, stock que baja al vender). El roadmap apunta a cerrar ese círculo.

---

## 1. Visión: las 3 capas

```
   CAPA 3 — CRECIMIENTO      Fidelización · Online/Delivery · Reservas · Marketing
   ─────────────────────────────────────────────────────────────────────
   CAPA 2 — OPERACIÓN        POS nativo · Inventario activo · Recetas/COGS · KDS
   ─────────────────────────────────────────────────────────────────────
   CAPA 1 — INTELIGENCIA     Ventas · Propinas · Caja · Reportes   ◀── HOY (✅)
```

Hoy tenemos sólida la **Capa 1**. El roadmap construye la **Capa 2** (que convierte a
Satori en el *sistema de registro*, no solo el que lee) y luego la **Capa 3** (crecimiento).

---

## 2. Roadmap por fases

Orden por **dependencia + retorno**. Tallas: S (días) · M (1–2 sprints) · L (3–5 sprints) · XL (programa de varios meses).

### FASE 0 — Cierre de pendientes actuales · `S`
Lo que ya está construido pero necesita un último paso para rendir.

- [ ] Aplicar `supabase/migrations/003_tips_email_cron.sql` (cron emails propinas día 1/15)
- [ ] Cargar **costos unitarios reales** (UI lista: Ventas→Config→Costos, inline o CSV) → enciende food cost en MenuEng
- [ ] DNS SiteGround para enviar emails desde `@satoricostarica.com` (hoy sale de `onboarding@resend.dev`)
- [ ] Definir metas mensuales en todos los meses para que el reporte mensual compare contra objetivo

**Valor:** completa el círculo de lo ya invertido. Esfuerzo casi nulo.

---

### FASE 1 — Inventario activo + Recetas + COGS real · `L`
La UI ya existe; falta **datos + la lógica que lo conecta a las ventas**. Es la base de la rentabilidad real.

**1.1 Carga inicial de inventario** `S`
- Cargar ingredientes (nombre, unidad, stock actual, stock mínimo, costo/unidad, proveedor)
- Import CSV masivo (mismo patrón que costos de productos)

**1.2 Recetas (Bill of Materials)** `M`
- Constructor de receta: producto vendido → lista de ingredientes × cantidad
- **Costo teórico automático**: la receta calcula `costo_unitario` del producto → reemplaza la carga manual de costos
- Vincular `product_map` ↔ `recipes` por nombre

**1.3 Consumo automático (depletion)** `M`
- Al registrarse ventas del día, descontar ingredientes según receta × unidades vendidas
- Movimiento de inventario automático por cada venta
- **Food cost teórico vs real**: comparar consumo esperado vs compras reales (merma)

**1.4 Alertas y compras** `M`
- Alerta de stock bajo (≤ mínimo) en HomePage y módulo
- Orden de compra sugerida por proveedor
- **Integración con Caja**: aprobar una compra genera el `egreso_mercaderia` y baja stock al recibir

**Valor:** food cost preciso, control de merma, evita quiebres de stock, cierra el loop compra→stock→venta→costo.
**Depende de:** Fase 0 (costos) — aunque las recetas luego automatizan el costo.

---

### FASE 2 — Fidelización / CRM de clientes · `L`
Net new. No requiere POS para arrancar (el cajero/salonero identifica al cliente).

**2.1 Base de clientes** `M`
- Tabla `customers` (nombre, teléfono como ID natural, email, fecha nacimiento, notas)
- Alta rápida desde caja o desde un panel; búsqueda por teléfono

**2.2 Programa de puntos** `M`
- Acumulación por visita y/o por monto gastado (config de regla)
- Canje de puntos por descuentos/cortesías
- Historial de visitas y consumo por cliente

**2.3 Marketing y retención** `M`
- Segmentos (frecuentes, dormidos, cumpleañeros del mes)
- Campañas: email (ya tenemos Resend) / WhatsApp (link `wa.me` o API)
- Métricas: tasa de retorno, ticket promedio por cliente, CLV

**Valor:** repetición de clientes, dato propio de demanda, base para promociones dirigidas.
**Depende de:** nada bloqueante. Mejora mucho cuando exista POS (captura automática del cliente en la orden).

---

### FASE 3 — POS nativo (el gran salto) · `XL`
Convierte a Satori en el **sistema de registro**. Reemplaza el import XLS: las ventas, propinas
y caja se generan **dentro** de la app en tiempo real.

> ⚠️ **Decisión estratégica previa (buy vs build):** construir un POS es un programa grande
> y conlleva **factura electrónica de Hacienda CR** (obligatoria). Alternativa: integrarse vía
> API con el POS actual en vez de reemplazarlo. Definir esto **antes** de arrancar la Fase 3.

**3.1 Catálogo / Menú** `M`
- Productos vendibles desde `product_map` (precio, categoría, modificadores, disponibilidad)
- Gestión de modificadores (extra, sin, término) y combos

**3.2 Mesas y salón** `M`
- Mapa del salón, estado de mesa (libre/ocupada/cuenta pedida), unir/dividir mesas
- Asignación de salonero a mesa (alimenta directo las métricas de saloneros)

**3.3 Toma de orden (app de mesero)** `L`
- Orden por mesa, agregar/quitar ítems, notas a cocina, enviar
- Multi-dispositivo, **offline-first** (la conexión en Santa Teresa puede fallar)

**3.4 KDS — Kitchen Display System** `M`
- Pantalla de cocina/barra con comandas en tiempo real, marcar preparado/entregado
- Tiempos de preparación por estación

**3.5 Cobro y cierre de cuenta** `L`
- Split de cuenta, métodos (efectivo/tarjeta/SINPE/Bitcoin)
- **Propina en el cobro → alimenta `tip_sessions` automáticamente**
- **Venta → `ventas_dias` directo** (elimina el import XLS)
- **Efectivo → `cash_sessions` directo**

**3.6 Factura electrónica (Hacienda CR)** `L`
- Comprobante electrónico (FE/TE), XML firmado, envío a Hacienda, contingencia
- **Requisito legal** para operar un POS en Costa Rica

**Valor:** fin del import manual, datos en tiempo real, control total de la operación, una sola fuente de verdad.
**Depende de:** decisión buy/build + Fases 1 y 2 idealmente listas (stock baja al vender, cliente se captura en la orden).

---

### FASE 4 — Canales de crecimiento · `L`
Sobre el POS nativo (o el catálogo, si se hace antes).

- **Pedido online / QR menu**: carta digital por QR en mesa, pedido sin mesero
- **Delivery / para llevar**: integración con apps (Uber Eats, etc.) o pedido directo
- **Reservas**: reserva de mesa online + gestión de aforo, vinculada al mapa de salón
- **Marketing automation**: promos por temporada, recuperación de clientes dormidos

**Valor:** nuevos ingresos, menos dependencia de plataformas de terceros (comisiones).

---

### FASE 5 — Madurez operativa y financiera · `L` (continuo)
Lo que hace la operación escalable y auditable.

- **Planificación de turnos** (scheduling) ligada a empleados + horas reales que ya registramos
- **Nómina / planilla**: sueldos + propinas + horas → export para pago (CCSS/INS si aplica)
- **Contabilidad / impuestos**: export para contador, conciliación, declaración IVA
- **Multi-local**: arquitectura para 2+ sucursales con consolidado
- **BI / tablero ejecutivo**: dashboards configurables, comparativas, alertas inteligentes
- **Auditoría y backups**: log de acciones sensibles, respaldos automáticos, retención de datos
- **Hardening PWA**: offline real, sincronización en background, instalación nativa

---

## 3. Dependencias (resumen visual)

```
Fase 0 (pendientes) ──▶ Fase 1 (Inventario/Recetas/COGS)
                                     │
Fase 2 (Fidelización) ───────────────┼──▶ Fase 3 (POS nativo) ──▶ Fase 4 (Canales)
                                     │              │
                                     └──────────────┴──▶ Fase 5 (Madurez: nómina, contabilidad, multi-local)
```

- **Fase 0 y 2 son independientes** → se pueden hacer ya, en paralelo.
- **Fase 1 desbloquea** el food cost real y prepara el "stock baja al vender" del POS.
- **Fase 3 (POS) es el cuello**: gran esfuerzo + decisión legal (factura electrónica). Todo lo de arriba la potencia, no la bloquea.

---

## 4. Recomendación de secuencia

1. **Ahora:** Fase 0 (días) — cobrar lo ya invertido.
2. **Siguiente trimestre:** Fase 1 (Inventario/Recetas) — máximo retorno sobre infraestructura existente; food cost real.
3. **En paralelo:** Fase 2 (Fidelización) — independiente, genera dato propio de clientes.
4. **Decisión estratégica:** evaluar **buy vs build del POS** (integrar con POS actual vía API ó construir nativo + factura electrónica).
5. **Programa mayor:** Fase 3 (POS) y luego Fases 4–5.

> **Quick win de mayor impacto/esfuerzo:** Fase 1. La UI ya existe; falta datos + la lógica
> de consumo. Convierte el food cost de estimado a exacto y previene quiebres de stock — sin
> tocar la operación de cobro.

---

## 5. Matriz impacto / esfuerzo

| Iniciativa | Impacto | Esfuerzo | Prioridad |
|---|---|---|---|
| Fase 0 — pendientes | Medio | S | 🔥 Ahora |
| Fase 1 — Inventario/Recetas/COGS | **Alto** | L | 🔥 Alta |
| Fase 2 — Fidelización | Alto | L | ⭐ Alta (paralelo) |
| Fase 3 — POS nativo | **Muy alto** | XL | 🧭 Estratégica |
| Fase 3.6 — Factura electrónica | Crítico (legal) | L | 🧭 con POS |
| Fase 4 — Canales | Alto | L | Después de POS |
| Fase 5 — Nómina/Contabilidad/Multi-local | Medio-alto | L+ | Continuo |
```
