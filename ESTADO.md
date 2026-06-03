# Satori App — Estado del proyecto

> Restaurant POS analytics dashboard · Satori Sushi Bar, Santa Teresa, Costa Rica
> Última actualización: 2026-06-02 (post-sprint: 6 tareas)

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
- Turno: coberturas dinámicas (picker + badge COB), verificación pool con tipo+motivo si dif >₡500 (bloquea cierre + persiste en notas), banner turno activo
- Historial: filtros (mes + empleado), editar/reabrir sesión cerrada (reopenTipSession)
- Quincenal, Stats (desglose AM/PM por empleado + top earners)
- Cocina (admin): pool semanal de cocina, reparto por semana ISO, Selena entra al pool pero no recibe (TipCocina.tsx)

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
- Reporte Mensual unificado (/reporte-mensual): ventas+propinas+caja de un mes en 1 vista, selector de mes, compartir + imprimir (ReporteMensual.tsx en resumen/)
- Admin: Empleados (bulk import en masa), Puntos por rol, Tipo cambio, Horas trabajadas, Email reports (cron día 1)
- SOPs (CRUD + búsqueda + categorías)
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
  · tablas customers, customer_interactions, loyalty_config, loyalty_rewards · src/modules/crm/

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

## ── SPRINT COMPLETADO (6 tareas) ──
Todas ✅ HECHO · build verde · pusheadas a main

1. ✅ ReporteMensual unificado — src/modules/resumen/ReporteMensual.tsx (ruta /reporte-mensual, card en Home)
2. ✅ EmployeeHours — fetch 24 meses, selector de año, fila de totales (src/modules/admin/EmployeeHours.tsx)
3. ✅ Registro de turno propinas — verificación ₡500 con tipo+motivo que bloquea cierre + persiste en notas
4. ✅ Email propinas día 1/15 — Edge fn ya tenía template; migration 003 programa el cron (APLICAR en Supabase)
5. ✅ Pool semanal cocina — TipCocina.tsx (pestaña Cocina admin, exclusión Selena)
6. ✅ UI carga costos — VentasConfig: import CSV + tabla paginada 50/pág + filtro clasificación; food cost se activa solo

(Previo: ✅ VentasICP extendido — Horas, Prop/turno, Prop/hora)

## Pendientes generales (necesitan acción del usuario)
- DNS SiteGround para email desde @satoricostarica.com (hoy sale de onboarding@resend.dev)
- APLICAR migration 003_tips_email_cron.sql en Supabase (cron de emails de propinas día 1/15)
- APLICAR migration 004_customers.sql en Supabase (activa el módulo Clientes/CRM)
- APLICAR migration 005_loyalty.sql en Supabase (activa reglas de puntos + recompensas)
- Cargar los costos unitarios reales (la UI ya está: Ventas→Config→Costos, inline o import CSV)
