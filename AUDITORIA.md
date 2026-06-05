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

### (se completa abajo en las fases siguientes)
