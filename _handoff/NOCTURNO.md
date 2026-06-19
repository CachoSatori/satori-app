# Corrida nocturna — satori-app — 2026-06-19

Tarea: secuencial Fase 0 → 1 → 2 → 3. Guardrails: nada a `main`, cero prod, sagrados intactos,
DDL solo aditivo, verde antes de cada commit, **parar en Fase 0 si la migración da error**.

## RESUMEN: PARADO EN FASE 0 (🔴). Fases 1, 2 y 3 NO ejecutadas.

La migración 038 **NO se pudo aplicar** a staging por un bloqueo de historial preexistente, y la
única salida que ofrece el CLI exige reescribir el historial de una migración de PLATA (035, de
propina-pool) — prohibido por los guardrails. Honrando el "PARÁ" explícito de la Fase 0, **no toqué
nada más** y no avancé a las fases siguientes. **La base de staging quedó SIN cambios.**

---

## FASE 0 — Aplicar 038 a STAGING → 🔴 BLOQUEADA (sin mutaciones)

- Proyecto linkeado verificado = `hwiatgicyyqyezqwldia` (STAGING, no prod). ✓
- `supabase migration list --linked` (read-only): **038 es la única migración local pendiente**, PERO
  el remoto tiene **035** (solo en rama `propina-pool`, sin merge — es propina→pool, **PLATA**) y un
  **009** fantasma (artefacto de orden por el baseline `0095`).
- `supabase db push --linked --dry-run` (read-only, **no aplica nada**): se niega con
  *"Remote migration versions not found in local migrations directory"* y sugiere
  `supabase migration repair --status reverted 009 035` + `supabase db pull`.
- **No ejecuté esa remediación:** marcar 035 como "revertida" miente sobre el estado real (035 SÍ está
  aplicada en staging) y toca una migración de plata → fuera de alcance y contra los guardrails.
- Sin `psql` ni password de la DB → no pude aplicar SOLO el SQL de 038 por fuera de `db push`.
- Log completo con evidencia y opciones de desbloqueo: **[_handoff/038-apply.log](038-apply.log)**.

**Para desbloquear (decisión humana):** OPCIÓN A (recomendada) — aplicar el SQL de 038 desde el SQL
Editor del dashboard de **staging** (es aditiva e idempotente) y luego `supabase migration repair
--status applied 038`; o dar el password de la DB de staging. OPCIÓN B — decidir qué hacer con
035/009 en el historial y recién ahí `db push`. Tras aplicar: regenerar tipos y verificar columnas
`factura_verified_by/at`, policy `cash_movements_contador_insert`, función `mark_factura_verified`.

## FASE 1 — Caché del Service Worker → ⏸️ NO EJECUTADA (parado en Fase 0)
## FASE 2 — Refresco de token al volver el foco → ⏸️ NO EJECUTADA (parado en Fase 0)
## FASE 3 — Etapa 2 scaffold (rama feat/bandeja-etapa2) → ⏸️ NO EJECUTADA (parado en Fase 0)

---

## (1) Qué quedó en STAGING para que la dueña pruebe físicamente
**NADA NUEVO esta corrida.** El deploy de staging sigue en el commit previo (`a1bf59d`): Bandeja
Etapa 1 + enlace proveedor + visibilidad pendientes + fechas CR (lo del handoff anterior). Los dos
caminos que enciende la 038 (el **contador** registrando desde la Bandeja y el botón **"✓ Verificar"**)
**siguen apagados** porque 038 no se aplicó (gating por RLS, esperado).

## (2) Qué quedó en feat/bandeja-etapa2 sin mergear
**NADA.** La rama no se creó (Fase 3 no se ejecutó por el stop en Fase 0).

## (3) Fases que pararon en rojo
**Fase 0 (🔴)** — bloqueo de historial de migraciones, detallado arriba y en `038-apply.log`. Necesita
una decisión humana (no automatizable sin violar guardrails). Fases 1–3 quedaron ⏸️ por el stop.

> Nota: las Fases 1 (headers no-cache del SW) y 2 (refresco de token en visibilitychange) **NO dependen
> de la 038** y son seguras de correr aparte. Si se prefiere, pueden ejecutarse sin esperar a 038 —
> pero esta corrida respetó el "PARÁ" explícito de la Fase 0 y no avanzó.
