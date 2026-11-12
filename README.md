# Satori App

Sistema operativo de Satori Sushi Bar · Santa Teresa y Nosara, Costa Rica.

## Stack
- React + TypeScript (Vite), instalable como PWA (funciona sin conexión, con cola de envío)
- Supabase (PostgreSQL, Auth, RLS, Realtime, Edge Functions, Storage)
- Producción: GitHub Pages desde `main` · Staging: Cloudflare Pages desde `staging`
- Club Satori (página pública): `club-web/`, en Cloudflare Pages + un Worker

## Setup local

Se desarrolla contra **staging**, nunca contra producción. Los refs de los dos proyectos de Supabase y las
reglas para tocar una base están en [STAGING.md](STAGING.md) y [ESTADO.md](ESTADO.md).

```bash
npm install
# Crear .env.local con los datos del proyecto de STAGING:
# VITE_APP_ENV=staging
# VITE_SUPABASE_URL=https://<ref-de-staging>.supabase.co
# VITE_SUPABASE_ANON_KEY=<anon key de staging>
npm run dev
```

Chequeos antes de un PR:

```bash
bash -c 'set -o pipefail; VITE_APP_ENV=production npm run build'   # el único build que vale como gate
npm test
npm run lint
```

## Módulos

| Módulo | Dónde está |
|---|---|
| Caja (turnos, cierre del día, movimientos, proveedores, pendientes) | Producción |
| Bandeja de facturas (foto + IA) | Producción |
| Propinas (pool del turno, historial, quincenal) | Producción |
| Ventas desde el PoS (Hoy, En vivo, Saloneros, Análisis, Histórico, Metas) | Producción |
| Mi Rendimiento (la casa del empleado) | Producción |
| Resumen, Semana, Reporte mensual, Finanzas | Producción |
| Inventario, Clientes (CRM) | Producción |
| Procedimientos (SoP) | Producción |
| Club Satori (referentes, cupones, canjes, Local Club) | Producción desde el 11-nov-2026; el local se enciende aparte |
| Admin (empleados, configuración) | Producción |
| PoS propio (comandero, KDS, cobro), Salarios y BioTime | Solo staging |

El estado al día, las migraciones y los pendientes están en [ESTADO.md](ESTADO.md),
[ROADMAP.md](ROADMAP.md) y [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md). El índice de la documentación,
en [docs/README.md](docs/README.md). Las reglas del repo (es público), en [CLAUDE.md](CLAUDE.md).
