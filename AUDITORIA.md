# Auditoría nocturna — Satori App

> Rama `audit/cleanup-nocturna` · NO mergeada · NO desplegada · sin tocar base de datos.
> Refactor de limpieza: preservar comportamiento (Caja/Propinas sagrados), build verde tras cada commit.

## Baseline (antes de tocar)

| Métrica | Valor |
|---|---|
| `tsc --noEmit` (strict) | ✅ 0 errores |
| Build vite | 222 ms (≈5.5 s total con `tsc -b`) |
| Archivos `.ts/.tsx` en `src` | 90 |
| LOC (`src`) | 24.834 |
| dependencies / devDependencies | 12 / 14 |
| `as any` | 0 |
| `as never` (workaround typing Supabase) | 151 |
| `@ts-ignore` / `@ts-expect-error` | 0 |
| `console.log` / `debugger` | 0 |
| `console.error/warn` | 13 (logging legítimo de errores) |
| TODO/FIXME | 0 |

**Chunks más grandes (gzip):** `index` 133 KB · `VentasHistorico` 103 KB · `VentasXLS` 119 KB (incluyen `xlsx` + `recharts`, ya lazy por ruta).

El proyecto ya estaba **sano de origen**: TS strict sin `any`/`ts-ignore`, sin `console.log` de debug, sin TODOs. La deuda principal es el patrón `as never` del cliente Supabase (tablas no incluidas en el tipo `Database`).

---

## Hallazgos (Fase 1-2)

### Dependencias sin uso (SEGURO remover)
| Dep | Uso en repo | Acción |
|---|---|---|
| `@capacitor/cli` | solo en package.json (sin config, sin imports) | remover |
| `@capacitor/core` | solo en package.json | remover |
| `date-fns` | solo en package.json (0 imports) | remover |
| `@types/dompurify` | está en `dependencies` (es type-only) | mover a `devDependencies` |

### Deuda de tipos
- `as never` ×151 — patrón `.from('tabla' as never)` / `.insert({...} as never)` porque el tipo `Database` no lista varias tablas (cash_*, tip_*, sops, documents, ingredients, etc.). **Riesgo de tocar: medio-alto** (regenerar tipos requiere CLI + podría diferir del esquema vivo y cambiar el build). → DOCUMENTAR, no refactor masivo.

### Exports muertos (verificados sin uso interno ni externo)
| Export | Archivo | Acción |
|---|---|---|
| `countInbox` | `shared/api/documents.ts` | ✅ removido (leftover) |
| `monthKeyCR` | `shared/utils/index.ts` | ✅ removido (huérfano) |
| `formatUSD` | `shared/utils/tipCalculations.ts` | DOCUMENTAR (módulo Propinas = sagrado) |
| `reopenTipSession` | `shared/api/tips.ts` | DOCUMENTAR (Propinas; posible feature futura "reabrir turno") |
| `getCashMovements` | `shared/api/cash.ts` | DOCUMENTAR (Caja = sagrado; superseded por `getAllCashMovements`) |
| `getMyProfile`, `updateProfileName` | `shared/api/auth.ts` | DOCUMENTAR (auth = sensible; no tocar) |
| `upsertActual` | `shared/api/finance.ts` | DOCUMENTAR (superficie de API prevista: carga manual del contador) |
| `findCustomerByPhone` | `shared/api/crm.ts` | DOCUMENTAR (posible lookup del chatbot futuro) |
| `PROPINA_ROLES`, `CAJEROS_IDS`, `hasInventoryForDocument` | varios | falsos positivos (sí se usan internamente) — conservar |

### Duplicación de constantes/utilidades
- **`fi` (formateador ₡)** reimplementado en 6 módulos, pese a existir `fi`/`fd` NaN-safe en `shared/utils/index.ts`.
  - ✅ Deduplicado en 3 módulos no-financieros (Admin/Horas, CRM x2).
  - DOCUMENTADO (no aplicado): `FinanzasModule` (P&L), `TipCocina` (Propinas), `InvFoodCost` (Food Cost) → en la lista negra del prompt (no tocar cálculos financieros), aunque el cambio sería camino-feliz idéntico. Recomendado hacerlo con supervisión.
- **`ROLE_LABELS`** definido en 8 archivos (HomePage, CashModule, InboxModule, MisPropinas, UserApprovals, RolePointsConfig, EmployeeHours, EmployeeList). Los valores **difieren** (subconjuntos de roles, singular vs plural). DOCUMENTAR → unificar en `shared/` con cuidado de no cambiar etiquetas visibles; 3 de los 8 están en módulos sagrados (Caja/Propinas). No aplicado.

### Deuda de tipos `as never` (×151)
Patrón `.from('tabla' as never)` / `.insert({...} as never)` porque el tipo `Database` (en `shared/types/database.ts`) no incluye varias tablas reales (cash_*, tip_*, sops, documents, ingredients, suppliers, finance_*, exchange_rates, etc.).
- **Causa:** el tipo `Database` quedó desactualizado respecto al esquema vivo (varias migraciones se aplicaron por Management API).
- **No aplicado** (riesgo medio-alto): regenerar `Database` con `supabase gen types` y reemplazar los `as never` por tipos reales. Mejora fuerte de seguridad de tipos, pero podría revelar mismatches y cambiar el build. Requiere supervisión + verificación tabla por tabla.

### Esquema vivo vs repo (solo documentado — NADA mutado)
- Migraciones en repo: 001→017. Algunas se aplicaron por Management API y el repo puede no reflejar 1:1 el esquema vivo. La `003` ya estaba marcada redundante en el ROADMAP.
- `Supplier.aliases` se agregó al tipo TS en esta sesión (la columna existe en DB por mig. 016).
- No se detectaron `col(...)` con fallbacks de nombres de columna problemáticos en una revisión de muestra.

---

## Matriz de hallazgos (severidad × riesgo × acción)
| Hallazgo | Sev | Riesgo de tocar | Acción |
|---|---|---|---|
| Deps sin uso (@capacitor x2, date-fns) | baja | seguro | ✅ aplicado |
| `@types/dompurify` en deps | baja | seguro | ✅ aplicado |
| Exports muertos (countInbox, monthKeyCR) | baja | seguro | ✅ aplicado |
| `fi` duplicado (3 módulos no-financ.) | baja | seguro | ✅ aplicado |
| `fi` duplicado (Finanzas/Propinas/FoodCost) | baja | medio (financiero) | 📋 documentado |
| `ROLE_LABELS` ×8 | media | medio (valores difieren + sagrado) | 📋 documentado |
| `as never` ×151 (tipos Supabase) | media | alto (regenerar tipos) | 📋 documentado |
| Exports muertos en módulos sagrados/sensibles | baja | medio | 📋 documentado |
| Esquema vivo vs migraciones del repo | media | alto (datos/DDL) | 📋 documentado — NO tocar |

## Aplicado en esta rama (commits atómicos)
1. `chore:` remover deps sin uso (@capacitor/cli, @capacitor/core, date-fns) + @types/dompurify a devDeps
2. `chore:` remover exports muertos (countInbox, monthKeyCR)
3. `refactor:` usar formateador `fi` compartido en CRM y Admin/Horas

## NO aplicado (lista negra → recomendaciones con plan)
- **Regenerar tipos Supabase** (`as never` ×151): correr `supabase gen types typescript --project-id yiczgdtirrkdvohdquzf` → reemplazar el `Database` de `shared/types/database.ts` → ir quitando `as never` archivo por archivo con build verde entre cada uno. Con supervisión.
- **Unificar `ROLE_LABELS`**: crear `shared/constants/roles.ts` con el set canónico (revisando que cada etiqueta visible quede igual), reemplazar los 8. Cuidar Caja/Propinas.
- **`fi` en módulos financieros**: mismo dedup, pero validar a ojo que ningún monto de Caja/Propinas/P&L/Food Cost cambie (camino feliz es idéntico).
- **Esquema/datos/RLS**: cualquier corrección va por migración revisada por el dueño, nunca en esta rama.
- **Hang del refresh de token** (ver ESTADO): mitigado con timeouts; la causa raíz (re-login transparente / reconexión del cliente Supabase) requiere diseño y pruebas con supervisión.

## Bugs encontrados
- Ninguno **inequívoco** que rompa cálculos. El proyecto está sano (TS strict sin `any`, sin `console.log`, sin TODOs). El único riesgo operativo conocido es el **hang del refresh de token** (ya mitigado con timeouts), no un bug de lógica.
