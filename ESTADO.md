# Satori App — Estado del proyecto

> Restaurant POS analytics dashboard · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> Última actualización: 2026-06-04 (Caja v2 · ledger real · Fase A finanzas · Bandeja IA multi-doc desplegada)

## 🧹 Auditoría de limpieza (rama `audit/cleanup-nocturna`, sin mergear)
Auditoría nocturna autónoma (Pase 1 + Pase 2), rama aparte, sin tocar la base (excepto generar tipos read-only). Aplicado seguro: −4 deps sin uso, exports muertos, dedup de `fi`/`ROLE_LABELS`(8→1)/helper day-level. **Titular A:** tipos Supabase regenerados del esquema vivo → `as never` **151→2** (los 2 son bug-candidatos documentados en Caja). **Titular B:** RCA del "se queda pensando" en `HANG-RCA.md` (refresh de token frágil) + fix seguro (storageKey propio del cliente de ManagerOverride) + diseño de fondo para aprobar. Caja/Propinas sin cambio de cálculo. Detalle: `AUDITORIA.md`, `HANG-RCA.md`, `RESUMEN-MAÑANA.md`.

## 🆕 Novedades 2026-06-04

### Caja v2 (rediseño operativo)
- **Caja Diaria = solo proveedores** (se quitó "Registradora"; la maneja el PoS). Top cards y verificación del turno unificados en una sola caja física. Fondo inicial viene por carryover del cierre anterior.
- **Cierre del turno**: solo pide efectivo ₡/$ (se quitaron Caja Fuerte y Depósito banco).
- **Cierre del día**: efectivo real ₡ = ventas PoS ₡ − dólares al **TC configurable** (último de `exchange_rates`, editable, sellado en Fase 1). Único egreso = **propinas** + **retiro de dueños a banco**. Verificación de dólares. Bloqueado si hay un turno abierto. Genera movimientos de ventas en el ledger (Fase 3).
- `cash_movements.session_id` nullable → movimientos a nivel día (ventas del cierre, retiros, importación).

### Datos reales cargados (vía Management API)
- **Ledger real importado**: 1234 movimientos (ene–jun 2026) verificados contra Excel (₡54.884.640 / $70.614). Sesiones placeholder "Importado histórico" por fecha para que el Resumen mensual los agrupe.
- **Ajuste de apertura Caja Fuerte**: saldo real al 04/06 = **₡534.750 / $1.054** (egreso de ajuste por el histórico pre-2022 no capturado).
- **Proveedores**: 39 activos de la planilla (upsert sin duplicar) + 14 deudas pendientes reales (₡641.904). Pendientes anteriores saldados por transferencia.
- **Propinas mayo**: empleados duplicados fusionados (12 vacíos borrados); turnos faltantes pendientes de cargar (ver archivo `filas_faltantes_mayo`). MAXI reactivado (barman).

### Propinas
- **Estadísticas**: promedio de pool separado por turno (Prom. general / Prom. AM / Prom. PM) — los pools AM/PM son muy distintos y el promedio general distorsionaba.

### Caja → Pendientes (vista nueva)
- **Facturas agrupadas por proveedor** (fecha, turno, ₡/$, referencia/nota, total). Pagar **individual**, **seleccionar cuáles** (checkbox) o **marcar todos**. **Descargar comprobante PNG** (Canvas) de las seleccionadas o todas, para enviar al proveedor. A prueba de NaN.

### Bandeja de documentos — ingesta por foto con IA (Fase 2D-B v2) — OPERATIVA ✅
- Módulo **Bandeja** (`/inbox`, tile en Home con badge): subís/compartís foto de factura/comprobante → la IA de visión la lee.
- **Migración 016**: tabla `documents` + bucket Storage `documents` + RLS + `suppliers.aliases[]`.
- **Edge Function `extract-document`** (Deno → Anthropic visión, **Claude Haiku 4.5**, JSON estricto). **Desplegada** + secret `ANTHROPIC_API_KEY` cargado + **probada end-to-end** (lee proveedor/total/ítems/clave FE/método). Modelo por env `ANTHROPIC_MODEL`.
- **Multi-documento**: una foto puede traer varias facturas → `documentos[]` → N filas en `documents`. Esquema CR rico: factura/proforma/comprobante/propinas/otro, clave FE 50 díg., IVA 1%/13% por línea, ítems en 2 líneas, unidades (K/UN/CJ/GL), `condicion_pago`, banco/referencia, moneda USD.
- **Auto-genera el movimiento al subir** (lo pidió el dueño): si confianza ≥0.4, cuadra y no requiere revisión → crea el movimiento solo (factura→cuenta por pagar; crédito→pendiente; comprobante→concilia pendiente único o egreso). El encargado revisa todo en Caja → Movimientos con las facturas físicas. Manuscritas/baja confianza/no cuadra → quedan en Bandeja con aviso **⚠ revisar** + checkbox de validación obligatorio.
- **PWA Share Target** (WhatsApp → Satori, `public/sw-share.js`) + subida manual/cámara. Anti-duplicado SHA-256 / clave FE.
- **Propinas** (recibo de tips) → no es gasto del P&L. **USD** → guarda dólares + TC del día.

### Auto-inventario desde la Bandeja (Fase 2D-C) ✅
- Migración 017: `supplier_item_map` (mapeo aprendido), `ingredient_prices` (historial), trazas en `inventory_movements`.
- Bandeja → **"Inventario pendiente"**: facturas con gasto creado → `InventoryStep` empareja ítem↔ingrediente (mapeo aprendido por código del proveedor → fuzzy → vincular/crear/no-inventario), **factor de conversión explícito**, entra stock + costo + historial de precios, y **aprende** para auto-emparejar la próxima. Idempotente por `document_id`. Trazas: badge "📄 factura" en movimientos + historial de precios al editar ingrediente. El catálogo se construye al vuelo.

### Caja — mejoras operativas (2026-06-04)
- **Caja Fuerte** muestra ₡ **y** $. Tarjeta **"Ajustes de cierre"** = suma de las diferencias de los cierres del día (ver si netean a cero a fin de mes); el ajuste de apertura ya no la ensucia.
- **Pagos operativos** en el turno (delivery → cuenta 7100, operativo, salario en efectivo) — salen de la Caja Diaria. Orden de Caja Diaria: Ingresos adicionales (compacto) → Pagos a proveedores → Pagos operativos.
- **"+ Nuevo movimiento"** en Movimientos: Banco→Caja Fuerte (suma al saldo), retiro, egresos sueltos. Selector **Cuenta P&L** por movimiento.
- **Pendientes agrupados por proveedor** (fecha/turno/₡/$/ref, total) con pago individual/selectivo/total y **descarga de comprobante PNG**.
- **TC al abrir turno** = el de Admin (`exchange_rates`). **Cajero** agregado a Puntos por rol (propinas).
- **Descartar turno** (Caja Diaria) y **Deshacer cierre** (Cierre del día) con contraseña de manager — para errores de fecha / empezar de 0.
- **Datos**: deliverys históricos recategorizados a operativo (7100); directorio de proveedores depurado (no-proveedores desactivados).
- **Timeout en apertura/cierre del turno** (15s) + en la Bandeja: si la sesión de login vence, el cliente Supabase puede colgar una request (refresh de token); ahora surge un aviso "recargá la app y reintentá" en vez de quedar girando. ⚠️ Pendiente de fondo: investigar el hang del refresh de token (afecta cualquier escritura tras sesión vencida).

### Fase A finanzas (modelo de pagos/P&L) — ver ROADMAP Fase 2D
- Retiro a banco = **traspaso** (fuera del P&L). `egreso_socios` ya no alimenta el P&L. **Ingresos de caja selectos** (aceite/reciclaje) → cuenta `otros_ingresos` (mig. 014). **`cash_movements.account_id`** (mig. 015) + selector "Cuenta P&L". **Bitcoin** en métodos de proveedor.
- **Pendiente** (en ROADMAP): recategorizar histórico `egreso_socios` (deliverys vs retiros), separar gerencia/staff, y todo el sistema de **ingesta por foto** (Fases B/C/D).

## Stack & deploy
- React 19 + TypeScript + Vite · Supabase (PostgreSQL + PostgREST + Auth + RLS) · PWA
- Repo: github.com/CachoSatori/satori-app — push a `main` despliega
- Supabase project ref: `yiczgdtirrkdvohdquzf`
- Management token (para queries SQL directas): guardado en sesiones previas
- Owner profile id: 48ef8af5-25d9-4990-a0b0-5140026da2ba (Cacho)
- Build/verificar: `cd /Users/ismaelgutierrezpechemiel/Downloads/satori-app && npm run build`

## ⚠️ SISTEMA DE DISEÑO (NO romper — costó iteraciones)
Tema **papel claro** dentro de los módulos (NO oscuro). Tokens en src/index.css :root.
- Fondos: `--t-paper`/`--vt-paper` (#f5f0e8 crema) = ÚNICO fondo de contenido. NO usar #fff ni #faf7f0 (tarjetas blancas se ven mal).
- Tarjetas oscuras de acento (KPI): `--t-ink`/`--vt-ink` (#0d0d0d) CON texto claro explícito.
- Texto: principal = ink (oscuro); muteado = `#5a5040`; NO usar #aaa (muy claro sobre papel).
- **Fuentes** (unificadas 2026-06 — `Syne` ELIMINADA de toda la app): el sistema de Propinas es el estándar para todo Satori → LETRAS/texto en `var(--font-sans)` (Noto Sans JP, fina, peso 300). NÚMEROS/montos/fechas en `'DM Mono'` (la fuente numérica de Propinas). Kanji/wordmark en `var(--font-serif)` (Noto Serif JP). NO reintroducir Syne ni fuentes del sistema (Arial/Helvetica).
- Dorado sobre papel: `#a07830` (no #c8a96e, muy claro). Teal `#2a7a6a`. Rojo `#c23b22`. Bordes `--t-border` (#d4cfc4).
- Inputs oscuros (#111 + texto claro) sobre papel = patrón OK probado.

## Estética unificada (estilo "dashboard") en TODOS los módulos
- Header: kanji + título (serif) + **badge de rol** (.role-badge) + botón ← Inicio.
- Nav: **barra oscura separada** (.vt-nav-tabs / .cd-nav-tabs) con tabs gris, activo dorado + subrayado.
  Ventas además tiene **etiquetas de grupo** (Operaciones/Equipo/Finanzas/Config) — .vt-nav-group.
- Selección de fecha: desplegable **.date-filter** (estilo del filtro de Propinas) en TODAS las pantallas
  con selección de mes (Ventas/Contabilidad, Mix, Ing.Menú, ICP, Evaluación, Caja/Resumen, Propinas, Food Cost).
  En Ventas/Mix/MenuEng: por año → botón "Todo {año}" + desplegable de meses, en horizontal.
- Proyección de ventas: componente MetaProgressBar.tsx (días, ₡actual/meta, %, proyección, meta diaria,
  promedio/día, esfuerzo req.) en pestaña HOY y Ventas — aparece si hay meta del mes cargada.
- **Listas de empleados con "recuadro"** (estilo de los empleados de Propinas): `.admin-table` es contenedor
  blanco con borde `--t-border`, filas separadas por línea + hover, nombre en negrita. Aplica a Admin →
  Empleados / Puntos por rol / Horas, y a las tablas de Stats de Propinas.

## Autenticación / Usuarios (2026-06-03)
- Login por correo + contraseña (Supabase Auth). LoginPage tiene toggle **Ingresar / Crear cuenta**.
- **Auto-registro**: el empleado se registra solo (nombre completo + correo + contraseña, `supabase.auth.signUp`).
  La cuenta **nace pendiente** (`profiles.is_active=false`, migration 009) → ve la pantalla "Cuenta pendiente"
  (App.tsx `PendingApproval`) y NO accede a nada hasta que la gerencia la habilite. Protege la página pública de registro.
- **Aprobación del owner**: Admin → pestaña **Usuarios** (UserApprovals.tsx): lista cuentas pendientes y activas,
  asigna **rol** y **Habilita/Deshabilita**. No te podés deshabilitar a vos mismo. Vincular a empleado (para "Mis
  Propinas") se hace en Admin → Empleados.
- Confirmación por correo **desactivada** en Auth (la cuenta entra al instante; el acceso lo da la aprobación).
- El correo queda en `profiles.email` para enviar reportes de pago a futuro.
- Cuenta de la compu principal (caja+propinas): rol **cajero** (solo operar). "Mis Propinas" oculto para cajero.
- **Rutas gateadas por rol** (App.tsx `PrivateRoute roles={...}`): además de ocultar tiles, cada ruta valida
  el rol del perfil y redirige al inicio si no corresponde (defensa por URL, sobre la RLS de la base).
- Admin → pestaña Usuarios muestra **badge rojo** con la cantidad de cuentas pendientes.

## PWA / Versionado
- `registerType: autoUpdate` + main.tsx: al abrir la app se busca versión nueva y, si el nuevo service
  worker toma control, **recarga una sola vez automáticamente** (guard anti-loop). Ya no hace falta "abrir y
  cerrar 2 veces" para ver lo último. El chequeo es solo al iniciar, no interrumpe el turno en curso.

## Módulos (TODOS completos y en producción)
### Ventas (売)
Hoy (delta vs ayer + Regalías + Ticket/item + vs General + contexto día-semana + compartir),
Mix (7 secciones, comparar, productos sin ventas), Análisis (quarterly/quincenal/YoY/proyección),
Calendario (DOW avg + listado mensual), MenuEng (matriz ⭐🐄🎯🐕),
Evaluación (consistencia/tendencia/racha + tabla scorecard + selector período + imprimir),
ICP (índice conversión propina), Saloneros (tarjetas + tabla ordenable),
Cajeros, Contabilidad, Metas, Competencias, XLS (batch + drag-drop), Config (bulk edit cascading), Histórico

### Propinas / Tips (心) — ✅ AUDITADO CONTRA FLUJO OPERATIVO REAL — listo para reemplazar Excel
- Turno: coberturas dinámicas (picker + badge COB) **persistidas en DB** (columna `tip_entries.covered_role`, migration 008). Regla: la cobertura usa el **rol efectivo (cubierto)** en TODO el cálculo → recibe los puntos de ese rol **Y entra al pool de barra** si cubrió en barra. Sobrevive al recargar, en el Historial y al editar. Verificación pool con tipo+motivo si dif >₡500 (bloquea cierre + persiste en notas), banner turno activo
- Datáfono individual por empleado de sala (propina ₡/$); bar/cocina reciben del pool
- Pool: general por puntos (efectivo + datáfonos de sala) **+** pool barra repartido por horas entre bartenders del turno. Barra muestra desglose Pool barra + Servicio en la fila
- Cierre AM/PM independiente (cada sesión se abre y cierra por separado)
- Registrar propinas atrasadas: al abrir turno se elige **fecha + turno (AM/PM)**, no solo el día actual. **Bloqueo de duplicados**: nunca crea sesión si ya existe registro (abierto o cerrado) para esa fecha+turno → aviso + "Ir a Historial"
- Historial: monto visible sin click + botón Ver → modal con desglose. **Edición dentro del mismo modal** (mini-formulario tipo creación: pools efectivo ₡/$, pool barra, por empleado check+horas+datáfono **+ selector "Cubrió como"**, reparto recalculado en vivo) — sin salir de Historial ni reabrir el turno. Acciones: editar/eliminar/copiar. Sesiones pre-mayo sin datáfono se manejan sin romper (generado ₡0)
- Quincenal, Stats (desglose AM/PM por empleado + top earners + **datáfono Generó vs Recibió** del mes). Ambos **cargan sus propios cálculos** del mes (fetch entradas + calcHistory) — ya NO dependen de visitar Historial primero (antes Stats salía vacío)
- Cocina (admin): pool semanal de cocina, reparto por semana ISO, Selena entra al pool pero no recibe (TipCocina.tsx)
- **Permisos**: `canOperate` (owner/manager/**cajero**) abre/edita/cierra el turno y carga coberturas — la cuenta de caja diaria opera propinas. `isManager` (owner/manager) queda para gestión: borrar sesiones, tabs Quincenal/Stats/Cocina, editar/eliminar en Historial. El cajero ve Historial en solo lectura.

### Caja / Cash (金) — ✅ AUDITADO CONTRA FLUJO OPERATIVO REAL — listo para reemplazar Excel
- Turno: apertura **dual** (registradora/servicio + caja proveedores) con TC dinámico ₡/$
- Dos cajas físicas separadas: los pagos a proveedor en efectivo salen de la **Caja Proveedores**, no de la registradora. Conciliación en vivo (fondo − pagos = restante)
- Caja proveedores abierta todo el día (AM y PM registran pagos); no se cierra por turno — se concilia en el Cierre del día
- Pago a proveedor por **modal** (proveedor/monto ₡-$/método/factura); lista más reciente arriba con editar/eliminar
- Cierre por turno: verificación de la registradora (fondo + ingresos − egresos efectivo) vs conteo
- Cierre del día (2 FASES): mediodía se sella → noche con separaciones (Caja Diaria mañana/Registradora/Remanente CF)
  + verificación automática (diferencia >₡500 exige tipo+motivo). Tabla: cash_cierres_dia
- Integración Caja↔Propinas: al cerrar propinas se registra egreso_personal (Registradora) por el payout
- **Cajero con acceso completo**: el rol cajero ve y opera TODAS las pestañas (Caja Diaria, Cierre del día, Movimientos, Proveedores, Pendientes, Resumen) — puede cerrar turnos/día y agregar proveedores. Lo único restringido: **eliminar registros guardados**.
- **Override de gerencia para eliminar** (src/shared/ManagerOverride.tsx): borrar un movimiento, desactivar un proveedor o quitar un pago YA guardado pide correo+contraseña de un owner/manager. Se verifica con un cliente Supabase temporal (persistSession=false) **sin tocar la sesión del cajero**. Para owner/manager logueado es instantáneo (sin pedir nada). Provider envuelve la app; hook `useManagerOverride()`.
- Movimientos, Proveedores, Pendientes
- Resumen (filtro mes + ingresos por método + egresos por subcategoría + tendencia mensual 6m)

### Otros
- MiRendimiento (人): vista salonero — Hoy/Historial/Semana/Competencias + metas personales
- MisPropinas (¥): tabla mensual histórica por empleado + Q1/Q2
- Resumen Diario (navegación días ‹›  + botón compartir WhatsApp) + Resumen Semanal (compartir)
- Reporte Mensual unificado (/reporte-mensual): ventas+propinas+caja de un mes en 1 vista, selector de mes, compartir + imprimir (ReporteMensual.tsx en resumen/)
- Admin: Empleados (bulk import en masa), Puntos por rol, Tipo cambio, Horas trabajadas, Email reports (cron día 1)
- SOPs / Procedimientos (書): CRUD + búsqueda + categorías. **20 SOPs reales migrados** (2026-06-03)
  desde Drive + carpeta local, estandarizados al formato Claude e insertados en la tabla `sops`
  (Montaje, Bienvenida, Servicio, Cobro/Separación, Créditos, Local Club, Link de Pago, SINPE/Bitcoin,
  Reservas, Pizarra, Delivery, SIPP, Cierre de Caja, Planilla Proveedores, Transferencias, Factura
  Electrónica, Reporte de Horas, Reportes de Ventas, Regalías). Demos placeholder desactivados.
  Render de markdown reescrito como parser real (encabezados, listas numeradas/viñetas, tablas, notas,
  negrita/código) — formato limpio de uso diario. created_by = owner.
- Inventario (Fase 1 COMPLETA en código, falta cargar datos reales):
  · Ingredientes: CRUD + import/export CSV masivo (1.1)
  · Recetas: BOM + costo teórico + ⇄ sincroniza costo_unitario a product_map → enciende food cost (1.2)
  · Consumo: motor de deducción por ventas del día, idempotente, preview + procesar (1.3)
  · Food Cost: teórico (COGS recetas) vs real (compras Caja) + merma + ajustes, por mes (1.3)
  · Movimientos: compra→Caja (genera egreso_mercaderia en turno abierto) (1.4)
  · Stock dashboard + alerta de stock en HomePage (sin stock / stock bajo) (1.4)
  · Orden de compra sugerida por proveedor (agrupa bajo-mínimo, qty a 2× min, copiar pedido) (1.4)
  → FASE 1 COMPLETA en código
- HomePage: dashboard con métricas reales en vivo (ventas/propinas/caja/stock del día en las tarjetas)
- Clientes / CRM (客) — Fase 2.1+2.2 (requiere migrations 004 y 005 aplicadas):
  · /clientes — búsqueda por teléfono/nombre, alta/edición rápida, perfil con agregados
  · puntos/visitas/gasto por interacción, tier sugerido (nuevo/regular/vip/embajador), historial
  · Fidelización (gerencia): reglas de puntos configurables (puntos/₡, bonus 1ª visita/cumple)
    + catálogo de recompensas; motor computeEarnedPoints; canje en el perfil (descuenta saldo)
  · Segmentos (2.3 parcial): cumpleañeros del mes, frecuentes/VIP, dormidos, nuevos
    + copiar lista + link wa.me por cliente (sin APIs externas)
  · Métricas (2.5): dashboard de fidelización — adquisición, retención, valor/LTV,
    puntos (emitidos/canjeados), comportamiento (CrmMetricas.tsx)
  · QR auto-registro (2.4): pestaña "QR registro" (gerencia) genera el QR del formulario
    público /registro (CrmQR.tsx, lib qrcode) para compartir por WhatsApp. El cliente
    escanea → formulario público RegistroCliente.tsx (sin login) → se crea en customers
    (channel_origin='whatsapp'). Policy de insert anónimo (migration 007). PROBADO end-to-end.
  · tablas customers, customer_interactions, loyalty_config, loyalty_rewards · src/modules/crm/
- Finanzas / P&L (財) — Fase 2C (requiere migration 006 aplicada):
  · /finanzas — Estado de Resultados estilo QuickBooks (Ingresos→COGS→Utilidad bruta→Gastos→Neta)
  · plan de cuentas jerárquico + budget 2026 importado de QB (Net proyectado ₡66.2M), por mes/año
  · columnas Presupuesto·Real·Variación. Falta: migrar reales históricos + conectar datos vivos (ventas/caja/inventario)
  · tablas finance_accounts, finance_budget, finance_actuals · src/modules/finanzas/

## Flujo operativo validado (2026-06-03)
Recorrido mental del día completo (Caja + Propinas) contra el flujo real del restaurante
(2 turnos AM/PM, encargado cierra cada uno, caja proveedores abierta todo el día, cada
salonero/bartender con su datáfono). Caja y Propinas quedan **listos para reemplazar el Excel**.

Pasos de prueba para confirmar en producción:
1. **Apertura AM** — abrir turno de caja: registrar fondo de registradora **y** fondo de caja
   proveedores por separado + TC. Verificar que aparecen las dos cajas en las top cards.
2. **Pagos a proveedor (AM y PM)** — agregar pagos por el modal (efectivo y transferencia).
   El efectivo descuenta de la **caja proveedores** (no de la registradora); la transferencia
   queda pendiente. La lista muestra el más reciente arriba; editar/eliminar funciona.
3. **Propinas del turno** — abrir sesión de propinas, cargar efectivo + datáfonos de sala +
   pool barra + horas. Confirmar que bartenders reciben pool general (por puntos) **+** pool
   barra (por horas) y que la fila muestra el desglose Pool barra / Servicio. Cerrar AM.
4. **Cierre de turno (registradora)** — contar la registradora: "debería quedar" = fondo +
   ingresos − egresos efectivo (propinas tarjeta/otros), **sin** pagos a proveedor. La caja
   proveedores se muestra como informativa (restante), no se cierra por turno.
5. **Cierre del día** — Fase 1 mediodía se sella; Fase 2 noche + conteo físico (separaciones:
   Caja Diaria mañana / Registradora / Remanente CF) + verificación. El resumen final muestra
   el Remanente de Caja Fuerte esperado y asigna el efectivo del día siguiente.

## Datos cargados en DB (migración histórica COMPLETA)
- ventas_dias: 151 días (2026, vía XLS)
- ventas_hist: 1096 días (2023-2025)
- product_map: 695 productos clasificados (tipo→clas→subcl)  ·  costo_unitario: UI de carga lista (inline + import CSV en Ventas→Config); food cost se activa solo al cargar
- tip_sessions: 137 cerradas (Ene-May 2026) + actuales  ·  tip_entries: 878 = ₡10,611,341
- cash_movements: 1116 (1106 históricos Ene-May + 10 actuales) — created_at corregido a fecha real
- cash_sessions: 137 históricas  ·  suppliers: 38  ·  employees: 24
- Fuentes CSV importadas: "movimientos" (1106 rows) + "propinas_turnos" (138 turnos con datos_json)

## Arquitectura clave
- Code splitting: cada tab es lazy() chunk (bundle 800KB→6KB shell)
- Cascading dropdowns derivados de product_map (no hardcoded)
- Pending-changes queue pattern para batch saves
- Sticky headers + botón 🏠 flotante universal (navegación en todos los módulos)
- Email cron: pg_net + net.http_post. Edge fn `monthly-report` envía ventas Y propinas.
  Cron día 1 08:00 CR (mes anterior, ambos) + día 15 08:00 CR (propinas quincenal mes en curso).
  Migration `supabase/migrations/003_tips_email_cron.sql` — APLICAR con acceso Supabase (service_role_key en Vault)
- Compartir: navigator.share (mobile→WhatsApp) con fallback clipboard

## ── ROADMAP — estado por fase (para revisar y decidir qué profundizar) ──
Detalle completo en ROADMAP.md. Resumen:

- **Fase 0 — Pendientes**: ⏳ depende del dueño (ver "Pendientes" abajo).
- **Fase 1 — Inventario/Recetas/COGS**: ✅ COMPLETA en código (1.1–1.4 + food cost teórico vs real).
  Falta sólo cargar datos reales (ingredientes/recetas/stock) — la UI ya está toda.
- **Fase 2 — Fidelización/CRM**:
  · 2.1 Base de clientes ✅ · 2.2 Programa de puntos ✅ · 2.3 Segmentos ✅ (parcial) · 2.5 Métricas ✅
  · 2.3 Tarjeta Apple/Google Wallet 🔴 (credenciales Apple Developer / Google Wallet API)
  · 2.4 Lector QR 🔴 (cámara real + deep-links GitHub Pages — testeo en dispositivo)
  · 2B Chatbot WhatsApp 🔴 (Twilio + Meta + OpenTable + Stripe)
- **Fase 3 — POS nativo**: 🔴 decisión buy-vs-build + factura electrónica Hacienda CR.

**Conclusión:** todo lo que NO depende de cuentas/credenciales externas está construido.
Lo que sigue necesita acción del dueño (trámites externos o decisión estratégica).

## ── SPRINT inicial (histórico, ✅ todo hecho) ──
1. ✅ ReporteMensual unificado — src/modules/resumen/ReporteMensual.tsx (ruta /reporte-mensual, card en Home)
2. ✅ EmployeeHours — fetch 24 meses, selector de año, fila de totales (src/modules/admin/EmployeeHours.tsx)
3. ✅ Registro de turno propinas — verificación ₡500 con tipo+motivo que bloquea cierre + persiste en notas
4. ✅ Email propinas día 1/15 — Edge fn ya tenía template; migration 003 programa el cron (APLICAR en Supabase)
5. ✅ Pool semanal cocina — TipCocina.tsx (pestaña Cocina admin, exclusión Selena)
6. ✅ UI carga costos — VentasConfig: import CSV + tabla paginada 50/pág + filtro clasificación; food cost se activa solo

(Previo: ✅ VentasICP extendido — Horas, Prop/turno, Prop/hora)

## Migraciones — TODAS APLICADAS en Supabase (2026-06-03, vía Management API)
- ✅ 004_customers (Clientes/CRM) · ✅ 005_loyalty (puntos+recompensas) · ✅ 006_finance (P&L + budget 2026)
- ✅ 007_customer_selfsignup (insert anónimo para auto-registro por QR) — probado HTTP 201
- ✅ 008_tips_covered_role (columna `tip_entries.covered_role` para persistir la cobertura de rol en propinas) — aplicada 2026-06-03
- ✅ 009_user_selfsignup (columna `profiles.email` + trigger: cuentas nuevas nacen `is_active=false` pendientes) — aplicada 2026-06-03. Además se desactivó la confirmación por correo en Auth (`mailer_autoconfirm=true`) vía Management API.
- ✅ 012_cajero_operativo_rls — el cajero puede escribir (operar) cash_sessions/movements/suppliers/tip_sessions/entries. Arregla que no podía registrar pagos/abrir turnos/agregar proveedores/borrar. Aplicada 2026-06-03.
- ✅ 011_ventas_exchange_rls — RLS de exchange_rates/product_map/ventas_* : lectura abierta, escritura solo owner/manager/contador. Aplicada 2026-06-03.
- ✅ 010_sops_rls — RLS de `sops`: lectura para todos, escritura solo owner/manager (antes cualquier autenticado podía escribir). Aplicada 2026-06-03.

## Auditoría de calidad / hardening (2026-06-03)
- **TS `strict` activado** (tsconfig.app + node) — 0 errores; el código ya era null-safe. Previene null-derefs / any implícitos a futuro.
- **ErrorBoundary** a nivel raíz (src/shared/ErrorBoundary.tsx) — un módulo que tire excepción ya no deja la app en blanco.
- **Tokens `--t-*` movidos a `:root`** (eran solo de `.tips-module`) — arregla el módulo SOPs (se veía oscuro/ilegible) y previene el bug para módulos futuros.
- **RLS SOPs endurecida** (migration 010).
- **RLS Ventas/exchange endurecida** (migration 011): `exchange_rates`, `product_map`, `ventas_dias/hist/comps/metas` → lectura abierta (intacta), escritura solo owner/manager/contador. Antes cualquier autenticado escribía.
- Código limpio: 0 console.log, 0 `as any`, lazy-loading + code-splitting, queries en paralelo (Promise.all).
- ⚠️ 003_tips_email_cron: era REDUNDANTE — ya existían crons `satori-monthly-report` (día 1) y
  `satori-quincenal-report` (día 15) que llaman a la edge fn `monthly-report` con body {} (tipo='ambos',
  envían ventas Y propinas, sin auth porque la fn es pública). Se eliminaron los crons duplicados de 003.
  · Mejora futura opcional: el cron día 15 manda body {} (mes anterior); para "quincenal del mes en curso"
    habría que pasarle month=mes actual. No crítico.

## Pendientes generales (necesitan acción del usuario)
- DNS SiteGround para email desde @satoricostarica.com (hoy sale de onboarding@resend.dev)
- Cargar los costos unitarios reales (la UI ya está: Ventas→Config→Costos, inline o import CSV)
- Definir meta mensual del mes en curso (Ventas→Metas) → enciende el bloque de proyección en HOY y Ventas
- Cargar datos de inventario reales (Inventario→Ingredientes import CSV, luego Recetas) → enciende COGS/food cost/consumo
