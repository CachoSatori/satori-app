# Satori App — Roadmap a producto óptimo

De dashboard de analítica a sistema operativo del restaurante.
**Satori Sushi Bar · Santa Teresa & Nosara, Costa Rica · Actualizado 2026-06-05**

---

## 0. Dónde estamos hoy (honesto)

Satori App no es un POS. Hoy es una capa de inteligencia de negocio que se monta sobre el POS existente: las ventas entran por import XLS (export del POS actual), y sobre esos datos la app calcula todo lo demás.

**Lo que ya funciona en producción (maduro):**

| Dominio | Estado |
|---|---|
| Ventas / analítica | ✅ 16 vistas (Hoy, Mix, Análisis, MenuEng, Evaluación, ICP, Saloneros, Metas…) |
| Propinas | ✅ pool por turno, coberturas (persistidas en DB), verificación, quincenal, pool cocina, stats, registro de turnos atrasados (fecha+turno) con bloqueo de duplicados, edición completa desde Historial (modal, incl. cobertura) |
| Caja | ✅ turnos (Caja Diaria: proveedores + pagos operativos), cierre del día 2 fases (TC config, retiro a banco), movimientos (Cuenta P&L por mov., Banco→Caja Fuerte, ajustes de cierre), pendientes agrupados por proveedor + comprobante PNG, resumen mensual, descartar turno / deshacer cierre |
| **Ingesta por foto (IA)** | ✅ **Bandeja operativa**: foto de factura/comprobante → Claude Haiku 4.5 (multi-doc, esquema CR) → genera el movimiento solo; revisión humana en manuscritas/baja confianza |
| Finanzas / P&L | ✅ presupuesto vs real automático desde caja/ventas; cuenta contable explícita por movimiento; retiros/ajustes fuera del P&L |
| Reportes | ✅ diario, semanal, mensual unificado, emails automáticos (ventas+propinas) |
| Admin | ✅ empleados, puntos por rol, tipo de cambio, horas trabajadas |
| Datos históricos | ✅ 2023→hoy migrados y verificados |
| SOPs | ✅ CRUD + **19 procedimientos reales migrados** (caja, servicio, delivery, pagos, manager) con render legible |
| Usuarios / Auth | ✅ login + **auto-registro de empleados** + aprobación del owner (rol + activación) por pantalla Admin |
| Inventario / Recetas | 🟡 UI completa pero VACÍA — tablas sin datos ni lógica de consumo |

**Arquitectura:** React 19 + TS + Vite · Supabase (Postgres + RLS + Edge Functions) · PWA.
Code-splitting por módulo. Despliegue automático en push a main.
**Hardening (2026-06-03):** TS `strict` activado · ErrorBoundary raíz · tokens de diseño globales ·
RLS endurecida (escritura por rol en sops/ventas/exchange) · rutas gateadas por rol · auto-update PWA.

**Hotfixes y limpieza (2026-06-05):** Propinas — fix del cierre (`savePayouts` UPDATE por id, bug NOT NULL `session_id`) + quitada la verificación de pool (Propinas = solo cálculo/reparto), **en producción**. Auditoría `audit/cleanup-nocturna` reconciliada y **mergeada** (`as never`→0). Caja — fix `onMovAdded` (refresca en vez de inyectar fila fantasma al borrar/editar pago) en `chore/limpiar-y-docs`. **Cierre del día:** la lógica correcta es el **saldo de Caja Fuerte por ledger** (canónico `satori-caja`); el intento `fix/caja-cierre-cf` (snapshot del remanente previo) se **descartó** por doble-conteo y la rama se borró. El fix real se valida primero en el **módulo Prueba** (simulador read-only) con un helper compartido `saldoCajaFuerte`.

**El gran límite estructural:** la app consume datos del POS, no los genera. Por eso depende de un import manual y no tiene control sobre la operación en tiempo real. El roadmap apunta a cerrar ese círculo.

---

## 1. Visión: las 3 capas

```
CAPA 3 — CRECIMIENTO   Fidelización · Chatbot WhatsApp · Delivery · Reservas · Marketing
─────────────────────────────────────────────────────────────────────────────────────────
CAPA 2 — OPERACIÓN     POS nativo · Inventario activo · Recetas/COGS · KDS
─────────────────────────────────────────────────────────────────────────────────────────
CAPA 1 — INTELIGENCIA  Ventas · Propinas · Caja · Reportes  ◀── HOY (✅)
```

Hoy tenemos sólida la Capa 1. El roadmap construye la Capa 2 (que convierte a Satori en el sistema de registro, no solo el que lee) y luego la Capa 3 (crecimiento y relación con el cliente).

---

## 2. Roadmap por fases

Orden por dependencia + retorno.
**Tallas:** S (días) · M (1–2 sprints) · L (3–5 sprints) · XL (programa de varios meses)

---

### FASE 0 — Cierre de pendientes actuales · S

Lo que ya está construido pero necesita un último paso para rendir.

- Aplicar `supabase/migrations/003_tips_email_cron.sql` (cron emails propinas día 1/15)
- Cargar costos unitarios reales (UI lista: Ventas → Config → Costos, inline o CSV) → enciende food cost en MenuEng
- DNS SiteGround para enviar emails desde `@satoricostarica.com` (hoy sale de `onboarding@resend.dev`)
- Definir metas mensuales en todos los meses para que el reporte mensual compare contra objetivo
- **Hardening: hang del refresh de token** — cuando la sesión vence, el cliente Supabase puede colgar una request (escrituras de caja/bandeja). Mitigado con timeouts + aviso; **RCA en `HANG-RCA.md`, fix de fondo diseñado, pendiente de aprobación**. Optimizar también la recarga post-cierre (hoy refetch de ~1.2k movimientos).
- **Cierre del día por ledger** — implementar el helper compartido `saldoCajaFuerte(movements)` (regla del canónico `satori-caja`) y enchufarlo al "debería quedar" del cierre, **previa validación en el módulo Prueba**. Que `CashResumen` use el mismo helper (una sola verdad del saldo).
- **Módulo "Prueba" (admin-only)** — simulador read-only con datos reales, sin escribir; primer uso: cierre de Caja Fuerte.
- **Tipos de movimiento faltantes en el turno de Caja** — definir con el dueño cuáles agregar.
- (Opcional) **entorno preview/staging** para pruebas visuales antes de producción.

**Valor:** completa el círculo de lo ya invertido. Esfuerzo casi nulo.

---

### FASE 1 — Inventario activo + Recetas + COGS real · L

La UI ya existe; falta datos + la lógica que lo conecta a las ventas. Es la base de la rentabilidad real.

#### 1.1 Carga inicial de inventario · S
- Cargar ingredientes (nombre, unidad, stock actual, stock mínimo, costo/unidad, proveedor)
- Import CSV masivo (mismo patrón que costos de productos)

#### 1.2 Recetas (Bill of Materials) · M
- Constructor de receta: producto vendido → lista de ingredientes × cantidad
- Costo teórico automático: la receta calcula `costo_unitario` del producto → reemplaza la carga manual
- Vincular `product_map` ↔ `recipes` por nombre

#### 1.3 Consumo automático (depletion) · M
- Al registrarse ventas del día, descontar ingredientes según receta × unidades vendidas
- Movimiento de inventario automático por cada venta
- Food cost teórico vs real: comparar consumo esperado vs compras reales (merma)

#### 1.4 Alertas y compras · M
- Alerta de stock bajo (≤ mínimo) en HomePage y módulo
- Orden de compra sugerida por proveedor
- Integración con Caja: aprobar una compra genera el `egreso_mercaderia` y baja stock al recibir

**Valor:** food cost preciso, control de merma, evita quiebres de stock.
**Depende de:** Fase 0 (costos) — aunque las recetas luego automatizan el costo.

---

### FASE 2 — Fidelización / CRM de clientes · L

Net new. No requiere POS para arrancar. El número de teléfono actúa como ID universal — conecta WhatsApp, delivery, reservas y visitas presenciales en un solo perfil.

> **Contexto de diseño (sesión 2026-06-02):** El chatbot de WhatsApp (Fase 2B más abajo) es el principal canal de captación de datos de clientes. Cada cliente que escribe al bot queda registrado automáticamente. La tarjeta Apple/Google Wallet es el canal de fidelización sin fricción — el cliente no descarga ninguna app. El iPhone del encargado con la cámara escanea el QR de la tarjeta para sumar puntos en visitas presenciales.

#### 2.1 Base de clientes · M

**Tabla nueva en Supabase: `customers`**

```sql
customers (
  id              uuid primary key default gen_random_uuid(),
  phone           text unique not null,        -- ID natural, viene de WhatsApp
  name            text,
  email           text,
  birth_date      date,
  channel_origin  text,                        -- 'whatsapp' | 'presencial' | 'manual'
  first_seen      timestamptz default now(),
  last_seen       timestamptz,
  total_visits    int default 0,
  total_spent_crc numeric default 0,
  points          int default 0,
  tier            text default 'nuevo',        -- 'nuevo' | 'regular' | 'vip' | 'embajador'
  wallet_pass_id  text,                        -- ID del .pkpass emitido
  notes           text,
  active          boolean default true
)
```

**Tabla nueva: `customer_interactions`**

```sql
customer_interactions (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid references customers(id),
  type          text,     -- 'delivery' | 'reserva' | 'presencial' | 'puntos_canje'
  channel       text,     -- 'whatsapp' | 'opentable' | 'qr_scan' | 'manual'
  amount_crc    numeric,
  points_earned int,
  points_spent  int,
  reference_id  text,     -- ID del pedido, reserva, etc.
  created_at    timestamptz default now()
)
```

- Alta rápida desde caja o admin; búsqueda por teléfono
- Perfil individual con historial completo de interacciones

#### 2.2 Programa de puntos · M

**Reglas de acumulación (configurables en Admin):**
- Por monto gastado: X puntos por cada ₡1.000
- Por visita: bonus fijo por primera visita del mes
- Por cumpleaños: bonus en el mes de cumpleaños
- Por referido: puntos cuando un referido hace su primera compra

**Tiers sugeridos:**

| Tier | Criterio | Beneficio |
|---|---|---|
| Nuevo | Primera visita | Tarjeta digital |
| Regular | 3+ visitas o ₡25.000 acumulado | 5% descuento acumulación |
| VIP | 10+ visitas o ₡80.000 acumulado | Acceso prioritario, 10% descuento |
| Embajador | VIP + referidos activos | Beneficios exclusivos, trato personalizado |

**Canje de puntos:**
- Descuento en cuenta
- Cortesías (roll gratuito, bebida, postre)
- Experiencias (omakase para 2, cena con el chef)

#### 2.3 Tarjeta digital Apple Wallet + Google Wallet · M

**Cómo funciona:**
1. Cliente hace pedido/reserva por WhatsApp (primera vez)
2. Bot pregunta: "¿Querés tu tarjeta Satori con tus puntos?"
3. Servidor genera un archivo `.pkpass` personalizado vía PassKit API (o desarrollo propio)
4. Cliente recibe link "Agregar a Wallet" — un tap, tarjeta en el celular
5. La tarjeta se actualiza en tiempo real con cada visita

**Qué muestra la tarjeta:**
- Logo Satori con diseño de marca
- Nombre del cliente
- Puntos acumulados (actualización en tiempo real)
- Tier actual (Nuevo / Regular / VIP / Embajador)
- Código QR único para escanear en el local
- Notificación push automática al sumar puntos, subir de tier o recibir un beneficio
- **Geo-fence:** aparece en pantalla de bloqueo cuando el cliente entra al restaurante

**Stack técnico:**
- Plataforma: PassKit ($30-80/mes todo incluido) o desarrollo propio con `@walletpass/pass-js`
- Hosting del pass server: Supabase Edge Function o Railway
- Apple: archivo `.pkpass` + certificado de PassType ID (Apple Developer Program, ya existente si hay Capacitor)
- Android: Google Wallet Objects API (`.gpay` format)

**Implementación recomendada:** empezar con PassKit para validar adopción, migrar a desarrollo propio si el volumen lo justifica.

#### 2.4a QR de auto-registro de clientes · ✅ HECHO (2026-06-03)

El cliente se registra solo escaneando un QR (no requiere Wallet ni app):
- Pestaña **"QR registro"** en Clientes (gerencia): genera el QR del formulario público
  `/registro` (CrmQR.tsx + lib qrcode), descargar PNG / copiar link → compartir por WhatsApp.
- Página pública **`/registro`** (RegistroCliente.tsx, sin login, mobile-first): nombre + teléfono
  (email/cumple opcionales) → crea el cliente con channel_origin='whatsapp'. Maneja duplicados.
- Migration 007: policy de insert anónimo. **Probado end-to-end (HTTP 201).**
- Es el arranque de la base de clientes SIN depender de WhatsApp API ni Wallet.

#### 2.4b Lector QR en Satori App (pantalla del encargado) · S — pendiente (necesita Wallet 2.3)

Pantalla dedicada en la app para el encargado de turno:
- Abre la cámara del iPhone desde la app
- Escanea el QR de la tarjeta Wallet del cliente
- Muestra el perfil del cliente: nombre, tier, puntos, última visita
- Botón "Registrar visita" → suma puntos, actualiza `last_seen`, envía push al cliente
- Opción de agregar nota o ajuste manual de puntos

**Hardware:** ninguno adicional. El iPhone que ya tienen sirve.

**Opción futura NFC (Fase 2.5):**
Si se quiere la experiencia "acercar el celular sin tocar pantalla", se necesita un lector NFC VAS certificado como el **DotOrigin VTAP100** (~$150). Requiere certificado NFC de Apple (trámite aparte). No es necesario para lanzar — el QR funciona exactamente igual.

#### 2.5 Módulo CRM en Satori App · M

Nuevo módulo accesible para Owner y Manager:

**Vista principal — lista de clientes:**
- Tabla con filtros: Todos / Nuevos (últimos 7d) / Frecuentes / En riesgo (+30d sin visita) / Por tier
- Búsqueda por nombre o teléfono
- Exportar CSV

**Perfil individual:**
- Datos personales, canal de origen, tier, puntos
- Historial completo de interacciones (delivery, reservas, presencial)
- Total gastado, ticket promedio, frecuencia de visita
- Botón "Enviar mensaje WhatsApp" (abre wa.me con el número)

**Dashboard métricas de fidelización:**

| Sección | Métricas |
|---|---|
| Adquisición | Clientes nuevos / semana, canal de origen, conversión WhatsApp → tarjeta |
| Retención | Clientes activos (30d), frecuencia promedio, clientes en riesgo |
| Valor | LTV, ticket promedio por tier, top 20 por gasto total |
| Puntos | Emitidos vs canjeados, distribución por tier, próximos a vencer |
| Comportamiento | Delivery vs presencial, hora/día preferido, productos más pedidos por tier |

**Valor de esta fase:** repetición de clientes, dato propio de demanda, base para campañas dirigidas, métricas reales de CLV.
**Depende de:** nada bloqueante. Se potencia mucho cuando exista el bot de WhatsApp (captación automática).

---

### FASE 2B — Chatbot WhatsApp: Delivery + Reservas · L

> **Contexto de diseño (sesión 2026-06-02):** Canal único que atiende delivery y reservas de mesa. Elimina comisiones de apps externas (25-30% por pedido). Registra automáticamente a los clientes en el CRM. Se integra con Supabase existente. El número de teléfono del chat es la llave que une todo el ecosistema de fidelización.

#### Stack técnico

| Pieza | Tecnología | Costo mensual |
|---|---|---|
| WhatsApp Business API | Twilio | ~$15-40 según volumen |
| Servidor del bot | Node.js en Railway/Render | ~$5-10 |
| Pagos delivery | Stripe (Payment Links) | 2.9% + $0.30/transacción |
| Reservas | OpenTable API (ver abajo) | Sin costo adicional |
| Base de datos | Supabase existente | $0 adicional |
| **Total estimado** | **~200 pedidos + 100 reservas/mes** | **~$30-60/mes** |

**Comparación:** Uber Eats / Rappi cobran 25-30% por pedido. En 200 pedidos de ₡12.000 promedio → ~₡720.000/mes en comisiones. El chatbot propio cuesta menos de ₡30.000/mes.

#### Estructura del bot — máquina de estados

```
INICIO
  ├── DELIVERY
  │     ├── ELIGIENDO_CATEGORIA
  │     ├── ELIGIENDO_PRODUCTO
  │     ├── CONFIRMAR_ITEM
  │     ├── CART_REVIEW
  │     ├── OFERTA_BEBIDAS          ← siempre antes de confirmar
  │     ├── PIDIENDO_DIRECCION
  │     ├── ESPERANDO_PAGO         ← Stripe Payment Link
  │     └── PEDIDO_CONFIRMADO      ← notificación cliente + grupo interno
  │
  └── RESERVAS
        ├── PIDIENDO_FECHA
        ├── PIDIENDO_PERSONAS
        ├── MOSTRANDO_SLOTS        ← OpenTable API
        ├── ELIGIENDO_SLOT
        ├── PIDIENDO_NOMBRE
        └── RESERVA_CONFIRMADA     ← notificación cliente + OpenTable

Estados de error:
  TIMEOUT (20 min sin respuesta) → reinicio
  INPUT_INVALIDO (reintento x2) → reinicio con aviso
  PAGO_FALLIDO → ofrecer reintento
  FUERA_DE_HORARIO → informar y ofrecer reserva
```

**Tabla nueva en Supabase: `bot_sessions`**

```sql
bot_sessions (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,          -- vincula con customers.phone
  state        text not null,
  cart         jsonb default '[]',     -- [{product_id, name, qty, price}]
  address      text,
  total_crc    numeric,
  stripe_link  text,
  stripe_paid  boolean default false,
  ot_slot_id   text,                   -- OpenTable slot seleccionado
  created_at   timestamptz default now(),
  expires_at   timestamptz,            -- now() + 20 min
  customer_id  uuid references customers(id)
)
```

#### Integración OpenTable

- **API oficial:** REST, requiere aprobación como partner (~3-4 semanas — iniciar este trámite antes que el desarrollo)
- **Endpoints clave:**
  - `GET /availability` — consulta slots disponibles para fecha + personas
  - `POST /reservations` — crea la reserva
  - `DELETE /reservations/{id}` — cancela
- **Portal partner:** `opentable.com/restaurant-solutions/api-partners`
- **Sandbox disponible** para desarrollo antes de la aprobación final

#### Flujo de conversación — Delivery (resumen)

```
Bot: "Hola! Satori 🍣 — Delivery o Reserva?"
  → Delivery
Bot: [categorías del menú]
  → Elige rolls
Bot: [productos con precio]
  → Agrega Spicy Tuna Roll
Bot: "¿Agregás algo más?"
  → No, continuar
Bot: "Antes de confirmar — ¿sumamos algo de tomar?"   ← SIEMPRE
  → Cerveza artesanal
Bot: "¿Dirección de entrega?"
  → [dirección]
Bot: "Resumen: Spicy Tuna + Cerveza + delivery = ₡12.900. Pagar: [link Stripe]"
  → [cliente paga]
Bot: "¡Confirmado! Pedido #ST-2847 · 35-45 min"
  → Notificación automática al grupo interno de Satori
```

#### Flujo de conversación — Reserva (resumen)

```
Bot: "¿Para qué fecha? (ej: 20/06)"
Bot: "¿Cuántas personas?"
Bot: "Disponibilidad 20/06 para 4: 7:00PM / 7:30PM / 8:00PM / 8:30PM"
  → Elige 7:30PM
Bot: "¿Nombre para la reserva?"
Bot: "✅ Confirmado — Satori Santa Teresa · 20 jun · 7:30PM · 4 personas · #R-0492"
```

#### Integración con CRM (Fase 2)

- Al primer mensaje del cliente → crear/actualizar `customers` con su phone
- Al confirmar pedido → crear `customer_interactions` con tipo `delivery`
- Al confirmar reserva → crear `customer_interactions` con tipo `reserva`
- Si el cliente no tiene tarjeta Wallet → ofrecer al final de la primera interacción
- Si el cliente ya tiene tarjeta → actualizar puntos automáticamente

#### Plan de implementación

| Semana | Actividad | Responsable |
|---|---|---|
| 1 | Solicitar cuenta Twilio + aprobación Meta (1-7 días). Iniciar trámite OpenTable (3-4 semanas). Abrir cuenta Stripe. Definir menú de delivery (15-20 productos de lanzamiento). | Socios |
| 2-3 | Desarrollo: flujo delivery completo, integración Stripe, flujo reservas con OpenTable, notificaciones al equipo, integración con tabla `customers`. | Desarrollo |
| 4 | Pruebas internas con el equipo. Ajuste de textos, tiempos, manejo de errores. | Equipo Satori |
| 5 | Lanzamiento con grupo reducido. Monitoreo activo. | Todos |

> ⚠️ **Cuello de botella:** la aprobación de OpenTable como partner tarda 3-4 semanas. Iniciar ese trámite desde el principio, en paralelo con todo lo demás.

**Alcance de lanzamiento recomendado:** solo delivery, solo los 15-20 platos más pedidos, solo pago con tarjeta. Un menú amplio de primera puede confundir. Se expande una vez adoptado.

**Valor:** cero comisiones por pedido, captación automática de clientes al CRM, reservas sin intermediarios, disponibilidad 24h.
**Depende de:** Fase 2 (tabla `customers`) para el CRM — aunque puede lanzar en paralelo sin CRM y conectarlo después.

---

### FASE 2C — Finanzas / Contabilidad (P&L estilo QuickBooks) · L

> **Contexto (sesión 2026-06-03):** Hoy los gastos/costos se manejan en QuickBooks. Objetivo:
> traer ese P&L a Satori App para tener **presupuesto vs real** dentro del mismo sistema y
> migrar los históricos. Punto de partida: `budget 2026.xlsx` (export QB) — Net Earnings
> proyectado ₡66.2M/2026.

#### 2C.1 Plan de cuentas + presupuesto · ✅ HECHO (foundation)
- Migration `006_finance.sql`: tablas `finance_accounts` (plan de cuentas jerárquico con códigos
  5200/5320/7150…), `finance_budget` (presupuesto × cuenta × mes), `finance_actuals` (reales). RLS.
- **Budget 2026 importado** desde QuickBooks: 60 cuentas, 516 líneas (43 hojas × 12 meses).
- Módulo `/finanzas` (財): vista P&L — Ingresos → Costo de ventas → Utilidad bruta → Gastos →
  Utilidad neta, por mes o año, con columnas **Presupuesto · Real · Variación** (FinanzasModule.tsx).
- APLICAR migration 006 en Supabase para activar el módulo.

#### 2C.2 Migrar reales históricos (años anteriores) · M
- Import de transacciones reales por cuenta/mes a `finance_actuals` (CSV/Excel desde QB).
- Mapear las cuentas QB → `finance_accounts` (matching por código/nombre).
- Cargar 2023/2024/2025 para comparar año contra año.

#### 2C.3 Conexión con datos vivos de Satori · ✅ HECHO (v1)
- **Ingresos automáticos** ✅: `ventas_dias` → Ventas Salón/Delivery reales por mes.
- **Egresos de Caja** ✅: `cash_movements` mapeados por tipo (mercadería→Food 5200, personal→Staff
  Wages 6200, operativo→Insumos 7120, socios→Consumos Dueños). getLiveActuals(year).
- La columna "Real" del P&L ya se llena sola desde lo que registra la app (+ suma manual si la hay).
- **v2 ✅ HECHO**: mapeo FINO por subcategoría → cuenta QB exacta (Gas→7780, Agua→7760, Luz→7770,
  Músicos→7500, Seguridad→7200, Mantenimiento→Repairs, Licor→5330, Salarios→6200…). Correcciones:
  propinas por tarjeta EXCLUIDAS (pass-through, no gasto); Músicos van a Música, no a Operativo.
- **Pendiente (v3)**: food cost desde Inventario (recetas, Fase 1) en vez de "mercadería" de caja;
  separar CCSS/INS/aguinaldos de salarios cuando la nómina tenga su propia fuente; opción de elegir
  la cuenta del P&L directamente al cargar un gasto en Caja (mapeo 100% contable).

#### 2C.4 Edición y reportes · M
- Editar presupuesto inline (por cuenta/mes), crear cuentas nuevas.
- Export del P&L (PDF/imprimir), comparativo presupuesto vs real con alertas de desvío.
- Estado de resultados anual + mensual; márgenes (%) por línea como QuickBooks.

**Valor:** P&L y control de costos dentro de Satori, presupuesto vs real automático, base para
decisiones financieras sin depender de QuickBooks.
**Depende de:** nada para arrancar (2C.1 ya hecho). El "Real" automático se potencia con Fase 1 (food cost) y la Caja ya existente.

---

### FASE 3 — POS nativo (el gran salto) · XL

Convierte a Satori en el sistema de registro. Reemplaza el import XLS: las ventas, propinas y caja se generan dentro de la app en tiempo real.

> ⚠️ **Decisión estratégica previa (buy vs build):** construir un POS es un programa grande y conlleva factura electrónica de Hacienda CR (obligatoria). Alternativa: integrarse vía API con el POS actual en vez de reemplazarlo. Definir esto antes de arrancar la Fase 3.

#### 3.1 Catálogo / Menú · M
- Productos vendibles desde `product_map` (precio, categoría, modificadores, disponibilidad)
- Gestión de modificadores (extra, sin, término) y combos

#### 3.2 Mesas y salón · M
- Mapa del salón, estado de mesa (libre/ocupada/cuenta pedida), unir/dividir mesas
- Asignación de salonero a mesa (alimenta directo las métricas de saloneros)

#### 3.3 Toma de orden (app de mesero) · L
- Orden por mesa, agregar/quitar ítems, notas a cocina, enviar
- Multi-dispositivo, offline-first (la conexión en Santa Teresa puede fallar)

#### 3.4 KDS — Kitchen Display System · M
- Pantalla de cocina/barra con comandas en tiempo real, marcar preparado/entregado
- Tiempos de preparación por estación

#### 3.5 Cobro y cierre de cuenta · L
- Split de cuenta, métodos (efectivo/tarjeta/SINPE/Bitcoin)
- Propina en el cobro → alimenta `tip_sessions` automáticamente
- Venta → `ventas_dias` directo (elimina el import XLS)
- Efectivo → `cash_sessions` directo
- **Integración con fidelización:** identificar cliente al cobrar → suma puntos automáticamente

#### 3.6 Factura electrónica (Hacienda CR) · L
- Comprobante electrónico (FE/TE), XML firmado, envío a Hacienda, contingencia
- Requisito legal para operar un POS en Costa Rica

**Valor:** fin del import manual, datos en tiempo real, control total de la operación, una sola fuente de verdad.
**Depende de:** decisión buy/build + Fases 1 y 2 idealmente listas.

---

### FASE 4 — Canales de crecimiento · L

Sobre el POS nativo (o el catálogo, si se hace antes).

- **Pedido online / QR menú:** carta digital por QR en mesa, pedido sin mesero
- **Delivery ampliado:** integración con apps (Uber Eats, etc.) o pedido directo desde web
- **Marketing automation:** promos por temporada, recuperación de clientes dormidos (ya tenemos Resend + datos de CRM), campañas por tier/segmento
- **Competencias gamificadas:** extender el sistema de competencias de saloneros a clientes (retos mensuales, badges, premios)

---

### FASE 5 — Madurez operativa y financiera · L (continuo)

Lo que hace la operación escalable y auditable.

- **Planificación de turnos:** scheduling ligado a empleados + horas reales ya registradas
- **Nómina / planilla:** sueldos + propinas + horas → export para pago (CCSS/INS si aplica)
- **Contabilidad / impuestos:** export para contador, conciliación, declaración IVA
- **Multi-local:** arquitectura para 2+ sucursales (Santa Teresa + Nosara) con consolidado
- **BI / tablero ejecutivo:** dashboards configurables, comparativas, alertas inteligentes
- **Auditoría y backups:** log de acciones sensibles, respaldos automáticos, retención de datos
- **Hardening PWA:** offline real, sincronización en background, instalación nativa

---

## 3. Dependencias (resumen visual)

```
Fase 0 (pendientes) ──▶ Fase 1 (Inventario/Recetas/COGS)
                                    │
Fase 2  (Fidelización/CRM)          │
Fase 2B (Chatbot WhatsApp) ─────────┼──▶ Fase 3 (POS nativo) ──▶ Fase 4 (Canales)
                                    │                                    │
                                    └────────────────────────────────────┴──▶ Fase 5
```

- **Fase 0 y Fase 2/2B son independientes** → se pueden hacer ya, en paralelo.
- **Fase 2B (bot)** se potencia con Fase 2 (CRM), pero puede lanzar sin ella y conectarse después.
- **Fase 1** desbloquea el food cost real y prepara el "stock baja al vender" del POS.
- **Fase 3 (POS)** es el cuello: gran esfuerzo + decisión legal. Todo lo de arriba la potencia, no la bloquea.

---

## 4. Recomendación de secuencia

1. **Ahora:** Fase 0 (días) — cobrar lo ya invertido.
2. **Próximas semanas:** Fase 2 (CRM/Fidelización) + Fase 2B (Chatbot) en paralelo — independientes, generan dato propio de clientes desde el día 1.
3. **Siguiente trimestre:** Fase 1 (Inventario/Recetas) — máximo retorno sobre infraestructura existente; food cost real.
4. **Decisión estratégica:** evaluar buy vs build del POS (integrar con POS actual vía API o construir nativo + factura electrónica).
5. **Programa mayor:** Fase 3 (POS) y luego Fases 4–5.

> **Quick win de mayor impacto/esfuerzo inmediato:** Fase 2B (chatbot). Elimina comisiones de plataformas, capta clientes en el CRM automáticamente y genera un canal propio de delivery y reservas en ~5 semanas. Usa la infraestructura Supabase que ya existe.

---

---

### FASE 2D — Pagos, conciliación e ingesta por foto · L  ◀ NUEVO (2026-06-04)

Objetivo: **que no falte ningún pago** y que la operación pase de *digitar* a *confirmar*.
Diseño técnico completo acordado con el dueño. La Fase A (modelo de datos) ya está en producción.

#### ✅ Fase A — Correcciones de modelo (hecha, 2026-06-04)
- **Retiro a banco = traspaso** (Caja Fuerte → Banco), fuera del P&L (antes `egreso_socios`).
- **`egreso_socios` no alimenta el P&L** (retiros/distribución = equity). "Consumos Dueños" solo por carga manual del contador.
- **Ingresos de caja selectos al P&L** (aceite/reciclaje/otros → cuenta nueva `otros_ingresos`, mig. 014). Ventas efectivo e "Ingreso de cambio" excluidos (no duplicar con POS / float).
- **Cuenta contable explícita** `cash_movements.account_id` (mig. 015) + selector "Cuenta P&L" en Movimientos. `getLiveActuals` la usa si está; si no, mapea por subcategoría. Cierra el hueco de alquiler/patentes/lavandería/suscripciones/etc.
- **Bitcoin** disponible como método de pago en proveedores (lista unificada `cashUtils.METODOS_PAGO`).

#### 🟡 Fase A — Pendiente (cleanup de datos)
- **Recategorizar histórico `egreso_socios`**: separar *deliverys* (repartidor externo → operativo `7100`/direct operating) de *retiros reales de socios*. ~105 movimientos importados bajo `egreso_socios`; requiere criterio del dueño/contador.
- Separar Gerencia (`6100`) de Staff (`6200`) en `egreso_personal`.
- Confirmar `caja_origen='Banco'` en compras por transferencia (PMT, guayafrut, Isleña, Pescados…) para que no toquen la caja física.
- ✅ Retiro de dueños **descuenta de Caja Fuerte** (traspaso Caja Fuerte → Banco; el saldo de CF resta los traspasos salientes). Las ventas en efectivo del cierre entran a Caja Fuerte.

#### ✅ Fase B — Bandeja + ingesta IA — **OPERATIVA EN PRODUCCIÓN** (2026-06-04)
> La foto de una factura/comprobante entra a la app, la IA la lee y **genera el movimiento solo**; el encargado revisa en Caja con las facturas físicas.
- ✅ Tabla `documents` + bucket Storage + RLS + `suppliers.aliases[]` (mig. 016).
- ✅ Edge Function `extract-document` (**Claude Haiku 4.5**, JSON estricto) **desplegada** + secret `ANTHROPIC_API_KEY` cargado + **probada end-to-end**. Modelo configurable por env `ANTHROPIC_MODEL` (Sonnet para más precisión).
- ✅ **Multi-documento**: una foto → `documentos[]` → N filas. Esquema CR rico (factura/proforma/comprobante/propinas/otro, clave FE, IVA 1%/13%, ítems 2 líneas, unidades, condicion_pago, banco, moneda USD).
- ✅ **Auto-genera el movimiento al subir** (si confianza ≥0.4 + cuadra + no requiere revisión). Manuscritas/baja confianza → quedan en Bandeja con aviso ⚠ + validación obligatoria. Crédito→pendiente; comprobante→concilia pendiente único o egreso; propinas→excluido del P&L; USD→TC del día.
- ✅ PWA **Share Target** (`public/sw-share.js`) + subida manual/cámara. Anti-duplicado SHA-256 / `clave_fe`.
- 🟡 Afinar el prompt con 8–10 fotos reales variadas por proveedor (BELCA, Isleña, PMT, Guayafrut, SINPE, LAFISE/BN, mariscos manuscritos).
- 🔭 Futuro: webhook WhatsApp Cloud API (Meta) como entrada alternativa.

#### ✅ Fase C — Auto-inventario (2026-06-04, en producción)
- ✅ Migración 017: `supplier_item_map` (mapeo aprendido proveedor↔ingrediente), `ingredient_prices` (historial), trazas `inventory_movements.document_id/cash_movement_id`, RLS (cajero carga inventario).
- ✅ **Inventario pendiente** en la Bandeja: facturas con el gasto ya creado → `InventoryStep` empareja cada ítem (mapeo aprendido por código → fuzzy → vincular/crear/no-inventario), **factor de conversión explícito**, entra stock + actualiza costo + guarda historial de precios, y **aprende** el mapeo para auto-emparejar la próxima factura del proveedor.
- ✅ Idempotente por `document_id` (no suma stock dos veces). El gasto NO se rehace (es de Fase B); pagar un comprobante no vuelve a tocar el stock.
- ✅ Trazabilidad: badge "📄 factura" en Movimientos de inventario; mini-historial de precios al editar un ingrediente. Catálogo de ingredientes se construye al vuelo.
- 🟡 Refinar `factor_conversion` por proveedor con uso real; cargar los ~30-40 insumos frecuentes acelera las primeras facturas.

#### 🔭 Fase D — Conciliación bancaria
- Import del resumen bancario → cada línea matchea comprobante/pendiente (monto+fecha+referencia) → **conciliación automática**: marca pagados y detecta pagos sin comprobante.

**Tablas/cambios pendientes:** `documents`, `suppliers.aliases[]`, bucket Storage. (`cash_movements.account_id` y `otros_ingresos` ya aplicados.)

---

## 5. Matriz impacto / esfuerzo

| Iniciativa | Impacto | Esfuerzo | Prioridad |
|---|---|---|---|
| Fase 0 — pendientes | Medio | S | 🔥 Ahora |
| Fase 1 — Inventario/Recetas/COGS | Alto | L | 🔥 Alta |
| Fase 2 — Fidelización / CRM | Alto | L | ⭐ Alta (paralelo) |
| Fase 2B — Chatbot WhatsApp | Alto | L | ⭐ Alta (paralelo) |
| Fase 2 + 2B juntas | Muy alto | L | ✨ Sinergia máxima |
| **Fase 2D — Pagos/conciliación + ingesta por foto** | **Muy alto** | **L** | **🔥 Fases A+B+C ✅ operativas; D (banco) pendiente** |
| Fase 3 — POS nativo | Muy alto | XL | 🧭 Estratégica |
| Fase 3.6 — Factura electrónica | Crítico (legal) | L | 🧭 con POS |
| Fase 4 — Canales | Alto | L | Después de POS |
| Fase 5 — Nómina/Contabilidad/Multi-local | Medio-alto | L+ | Continuo |

---

## 6. Decisiones pendientes del equipo

Estas decisiones no las puede tomar el desarrollo — requieren alineación entre socios:

| Decisión | Opciones | Impacto |
|---|---|---|
| Alcance del menú de delivery | 15-20 platos de lanzamiento | Define Fase 2B |
| Trámite OpenTable | Iniciar YA (tarda 3-4 semanas) | Crítico para Fase 2B |
| Tiers y beneficios de puntos | Definir reglas de acumulación/canje | Define Fase 2 |
| NFC vs QR para tarjeta Wallet | QR recomendado (sin hardware). NFC requiere lector ~$150 + certificado Apple | Define Fase 2 |
| POS: build vs buy/integrar | Construir propio vs integrar con el POS actual | Define Fase 3 |
| Sucursales: Santa Teresa y Nosara | ¿Misma base de datos o separadas? | Define Fase 5 |

---

*Documento vivo — actualizar con cada sprint completado.*
*Para el estado del sprint actual, ver `ESTADO.md`.*
