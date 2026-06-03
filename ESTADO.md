# Satori App — Estado del proyecto

> Restaurant POS analytics dashboard · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> Última actualización: 2026-06-03 (Fase 1 completa · Fase 2.1/2.2/2.3/2.5 · overhaul de UI)

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
- Cuenta de la compu principal (caja+propinas): rol **cajero** (solo operar).

## Módulos (TODOS completos y en producción)
### Ventas (売)
Hoy (delta vs ayer + Regalías + Ticket/item + vs General + contexto día-semana + compartir),
Mix (7 secciones, comparar, productos sin ventas), Análisis (quarterly/quincenal/YoY/proyección),
Calendario (DOW avg + listado mensual), MenuEng (matriz ⭐🐄🎯🐕),
Evaluación (consistencia/tendencia/racha + tabla scorecard + selector período + imprimir),
ICP (índice conversión propina), Saloneros (tarjetas + tabla ordenable),
Cajeros, Contabilidad, Metas, Competencias, XLS (batch + drag-drop), Config (bulk edit cascading), Histórico

### Propinas / Tips (心) — ✅ AUDITADO CONTRA FLUJO OPERATIVO REAL — listo para reemplazar Excel
- Turno: coberturas dinámicas (picker + badge COB) **persistidas en DB** (columna `tip_entries.covered_role`, migration 008) → el rol cubierto y sus puntos sobreviven al recargar y en el Historial. Verificación pool con tipo+motivo si dif >₡500 (bloquea cierre + persiste en notas), banner turno activo
- Datáfono individual por empleado de sala (propina ₡/$); bar/cocina reciben del pool
- Pool: general por puntos (efectivo + datáfonos de sala) **+** pool barra repartido por horas entre bartenders del turno. Barra muestra desglose Pool barra + Servicio en la fila
- Cierre AM/PM independiente (cada sesión se abre y cierra por separado)
- Registrar propinas atrasadas: al abrir turno se elige **fecha + turno (AM/PM)**, no solo el día actual. **Bloqueo de duplicados**: nunca crea sesión si ya existe registro (abierto o cerrado) para esa fecha+turno → aviso + "Ir a Historial"
- Historial: monto visible sin click + botón Ver → modal con desglose. **Edición dentro del mismo modal** (mini-formulario tipo creación: pools efectivo ₡/$, pool barra, por empleado check+horas+datáfono **+ selector "Cubrió como"**, reparto recalculado en vivo) — sin salir de Historial ni reabrir el turno. Acciones: editar/eliminar/copiar. Sesiones pre-mayo sin datáfono se manejan sin romper (generado ₡0)
- Quincenal, Stats (desglose AM/PM por empleado + top earners + **datáfono Generó vs Recibió** del mes). Ambos **cargan sus propios cálculos** del mes (fetch entradas + calcHistory) — ya NO dependen de visitar Historial primero (antes Stats salía vacío)
- Cocina (admin): pool semanal de cocina, reparto por semana ISO, Selena entra al pool pero no recibe (TipCocina.tsx)

### Caja / Cash (金) — ✅ AUDITADO CONTRA FLUJO OPERATIVO REAL — listo para reemplazar Excel
- Turno: apertura **dual** (registradora/servicio + caja proveedores) con TC dinámico ₡/$
- Dos cajas físicas separadas: los pagos a proveedor en efectivo salen de la **Caja Proveedores**, no de la registradora. Conciliación en vivo (fondo − pagos = restante)
- Caja proveedores abierta todo el día (AM y PM registran pagos); no se cierra por turno — se concilia en el Cierre del día
- Pago a proveedor por **modal** (proveedor/monto ₡-$/método/factura); lista más reciente arriba con editar/eliminar
- Cierre por turno: verificación de la registradora (fondo + ingresos − egresos efectivo) vs conteo
- Cierre del día (2 FASES): mediodía se sella → noche con separaciones (Caja Diaria mañana/Registradora/Remanente CF)
  + verificación automática (diferencia >₡500 exige tipo+motivo). Tabla: cash_cierres_dia
- Integración Caja↔Propinas: al cerrar propinas se registra egreso_personal (Registradora) por el payout
- Movimientos, Proveedores, Pendientes
- Resumen (filtro mes + ingresos por método + egresos por subcategoría + tendencia mensual 6m)

### Otros
- MiRendimiento (人): vista salonero — Hoy/Historial/Semana/Competencias + metas personales
- MisPropinas (¥): tabla mensual histórica por empleado + Q1/Q2
- Resumen Diario (navegación días ‹›  + botón compartir WhatsApp) + Resumen Semanal (compartir)
- Reporte Mensual unificado (/reporte-mensual): ventas+propinas+caja de un mes en 1 vista, selector de mes, compartir + imprimir (ReporteMensual.tsx en resumen/)
- Admin: Empleados (bulk import en masa), Puntos por rol, Tipo cambio, Horas trabajadas, Email reports (cron día 1)
- SOPs / Procedimientos (書): CRUD + búsqueda + categorías. **19 SOPs reales migrados** (2026-06-03)
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
