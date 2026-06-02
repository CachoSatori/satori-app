# Satori App — Estado del proyecto

> Restaurant POS analytics dashboard · Satori Sushi Bar, Santa Teresa, Costa Rica
> Última actualización: 2026-06-02

## Stack & deploy
- React 19 + TypeScript + Vite · Supabase (PostgreSQL + PostgREST + Auth + RLS) · PWA
- Repo: github.com/CachoSatori/satori-app — push a `main` despliega
- Supabase project ref: `yiczgdtirrkdvohdquzf`
- Management token (para queries SQL directas): guardado en sesiones previas
- Owner profile id: 48ef8af5-25d9-4990-a0b0-5140026da2ba (Cacho)
- Build/verificar: `cd /Users/ismaelgutierrezpechemiel/Downloads/satori-app && npm run build`

## Módulos (TODOS completos y en producción)
### Ventas (売)
Hoy (delta vs ayer + Regalías + Ticket/item + vs General + contexto día-semana + compartir),
Mix (7 secciones, comparar, productos sin ventas), Análisis (quarterly/quincenal/YoY/proyección),
Calendario (DOW avg + listado mensual), MenuEng (matriz ⭐🐄🎯🐕),
Evaluación (consistencia/tendencia/racha + tabla scorecard + selector período + imprimir),
ICP (índice conversión propina), Saloneros (tarjetas + tabla ordenable),
Cajeros, Contabilidad, Metas, Competencias, XLS (batch + drag-drop), Config (bulk edit cascading), Histórico

### Propinas / Tips (心)
- Turno: coberturas dinámicas (picker + badge COB), verificación pool (✅/⚠), banner turno activo
- Historial: filtros (mes + empleado), editar/reabrir sesión cerrada (reopenTipSession)
- Quincenal, Stats (desglose AM/PM por empleado + top earners)

### Caja / Cash (金)
- Turno (apertura con TC dinámico ₡/$)
- Cierre del día (2 FASES): mediodía se sella → noche con separaciones (Caja Diaria/Registradora/Remanente CF)
  + verificación automática (diferencia >₡500 exige tipo+motivo). Tabla: cash_cierres_dia
- Movimientos, Proveedores, Pendientes
- Resumen (filtro mes + ingresos por método + egresos por subcategoría + tendencia mensual 6m)

### Otros
- MiRendimiento (人): vista salonero — Hoy/Historial/Semana/Competencias + metas personales
- MisPropinas (¥): tabla mensual histórica por empleado + Q1/Q2
- Resumen Diario (navegación días ‹›  + botón compartir WhatsApp) + Resumen Semanal (compartir)
- Admin: Empleados (bulk import en masa), Puntos por rol, Tipo cambio, Horas trabajadas, Email reports (cron día 1)
- SOPs (CRUD + búsqueda + categorías), Inventario (Stock/Ingredientes/Recetas/Movimientos — VACÍO sin datos)
- HomePage: dashboard con métricas reales en vivo (ventas/propinas/caja del día en las tarjetas)

## Datos cargados en DB (migración histórica COMPLETA)
- ventas_dias: 151 días (2026, vía XLS)
- ventas_hist: 1096 días (2023-2025)
- product_map: 695 productos clasificados (tipo→clas→subcl)  ·  costo_unitario = 0 (PENDIENTE)
- tip_sessions: 137 cerradas (Ene-May 2026) + actuales  ·  tip_entries: 878 = ₡10,611,341
- cash_movements: 1116 (1106 históricos Ene-May + 10 actuales) — created_at corregido a fecha real
- cash_sessions: 137 históricas  ·  suppliers: 38  ·  employees: 24
- Fuentes CSV importadas: "movimientos" (1106 rows) + "propinas_turnos" (138 turnos con datos_json)

## Arquitectura clave
- Code splitting: cada tab es lazy() chunk (bundle 800KB→6KB shell)
- Cascading dropdowns derivados de product_map (no hardcoded)
- Pending-changes queue pattern para batch saves
- Sticky headers + botón 🏠 flotante universal (navegación en todos los módulos)
- Email cron: pg_net extension + net.http_post (corregido). Próximos: 15 Jun y 1 Jul 8am
- Compartir: navigator.share (mobile→WhatsApp) con fallback clipboard

## ── TAREA EN CURSO: 4 mejoras post-migración ──
Orden de prioridad, ejecutar todas y avisar al terminar:

### 1. ✅ HECHO — VentasICP extendido
Archivo: src/modules/ventas/VentasICP.tsx
- getAttendanceHistory(6→12) meses
- empTipMap ahora acumula hours además de payout/shifts
- icpData agrega: hours, propTurno (payout/shifts), propHora (payout/hours)
- Tabla: nuevas columnas Horas, Prop/turno (teal), Prop/hora (gold)
- BUILD OK

### 2. ⏳ EN PROGRESO — Reporte mensual unificado
Crear página nueva que combine ventas + propinas + caja de un mes en 1 vista.
- Selector de mes
- Sección ventas (total, PAX, prom/PAX, mejor día), propinas (pool, top earners),
  caja (ingresos/egresos/neto, por subcategoría)
- Botón compartir + imprimir
- Ruta nueva en App.tsx, lazy loaded. Sugerencia: src/modules/resumen/ReporteMensual.tsx
- Considerar agregar al HomePage o como tab en Resumen

### 3. ⏳ PENDIENTE — Verificar EmployeeHours
Archivo: src/modules/admin/EmployeeHours.tsx (ya existe, 260 líneas)
- Usa getAttendanceHistory + tip_entries.hours_worked — confirmar que con los datos
  históricos ahora cargados (878 entries) muestre bien las horas por empleado/mes
- Posible: extender meses cargados, agregar totales

### 4. ⏳ PENDIENTE — Costo unitario / Food cost
- product_map.costo_unitario está en 0 para los 483 productos comida/bebida
- Crear UI o guía para que el usuario cargue costos (en VentasConfig o nueva tab)
- Una vez con costos: activar food cost % en VentasMenuEng (ya tiene la lógica preparada)

## Pendientes generales (necesitan acción del usuario)
- DNS SiteGround para email desde @satoricostarica.com (hoy sale de onboarding@resend.dev)
- Cargar costos unitarios de productos
