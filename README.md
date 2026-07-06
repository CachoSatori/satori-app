# Satori App

Aplicación operativa de Satori Sushi Bar · Santa Teresa, Costa Rica.

## Stack
- React + TypeScript (Vite)
- Supabase (PostgreSQL, Auth, RLS)
- Capacitor (iOS + Android + Desktop)

## Setup local

```bash
npm install
# Crear .env.local con:
# VITE_SUPABASE_URL=https://yiczgdtirrkdvohdquzf.supabase.co
# VITE_SUPABASE_ANON_KEY=tu_anon_key
npm run dev
```

## Módulos

Estado real (actualizado 2026-07): **todo en PROD (`main`) salvo el PoS**, que vive solo en `staging` (diferido, bloqueado por el pilar de sesión/auth).

| Módulo | Estado |
|---|---|
| Supabase + Auth + Roles | ✅ En prod |
| Propinas (pool del turno + historial) | ✅ En prod |
| Ventas / analítica (KPIs, metas) | ✅ En prod |
| Caja (turnos, cierre en 2 fases, movimientos, pendientes) | ✅ En prod |
| Finanzas / P&L | ✅ En prod |
| Reportes + emails automáticos | ✅ En prod |
| Admin (empleados, config, tipo de cambio) | ✅ En prod |
| Inventario (stock, ingredientes, recetas, revisión) | ✅ En prod |
| Bandeja + unificación Bandeja↔Caja (foto+IA, Revisión de inventario) | ✅ En prod (ola 2026-07) |
| Realtime · Offline (outbox) | ✅ En prod |
| **PoS** (comandero, KDS, cobro/splits, ticket + FE SIM, inventario activo COGS) | 🧪 Solo staging — diferido |

> Estado detallado, migraciones y pendientes → [ESTADO.md](ESTADO.md) · [ROADMAP.md](ROADMAP.md) · [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).
