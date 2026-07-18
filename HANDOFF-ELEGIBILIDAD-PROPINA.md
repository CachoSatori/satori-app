# Handoff — Elegibilidad de propina por ROL (configuración)

**Rama:** `feat/config-elegibilidad-propina-rol` (desde `staging`)
**Fecha:** 2026-07-17
**Objetivo:** que "recibir propina" sea configuración por rol (no hardcode). Un rol marcado *no recibe* no aparece en el roster del turno ni entra al pool. Aplicado a **MANAGER** (deja de recibir), **reversible** desde Admin. **Sin tocar la matemática sagrada.**

---

## Qué se construyó

1. **Esquema (mig 048, aditiva):** `role_tip_points.recibe_propina boolean not null default true`.
   - **Aplicada SOLO a staging** (ref `hwiatgicyyqyezqwldia`) por la Management API (`database/query`), **sin tocar `schema_migrations`**. Verificado: columna `boolean/NOT NULL/default true`, los 7 roles backfilleados a `true`.
   - **Flip de MANAGER → false** aplicado en staging como **dato de config** (idéntico a lo que hace el toggle de Admin; `points` intacto = 3.0). **Reversible** en un clic.
   - **NO aplicada a prod** (prod = `yiczgdtirrkdvohdquzf`, ni siquiera linkeado).

2. **Tipos/API:**
   - `RoleTipPoints += recibe_propina?: boolean | null` (null-safe).
   - `supabase.gen.ts`: `role_tip_points` Row/Insert/Update += `recibe_propina` (lo que produciría el regen post-migración).
   - `getRoleTipPoints` lo devuelve solo (usa `select('*')`).
   - Nueva `upsertRoleTipConfig(role, points, recibe_propina)` — upsert `onConflict 'role'` con **ambos** campos (mandar `points` evita reventar el NOT NULL en el INSERT propuesto).

3. **Admin (`RolePointsConfig.tsx`):** columna **"Recibe propina"** con toggle Sí/No por rol. Al guardar persiste puntos + flag juntos. Si está en "No", el input de puntos se atenúa/deshabilita.

4. **Roster del turno (`TipsModule.tsx`):** helper puro `eligibleRoster` excluye del roster los roles con `recibe_propina=false`, en los **3 caminos** (turno nuevo sin sesión, reset al crear, y turno abierto) **y en el picker de cobertura**. Los turnos **abiertos/cerrados NO se re-tocan**: en el camino de hidratación se preservan los empleados que ya tienen entrada (`keepIds`).

---

## Guardrails cumplidos

- **Sagrados diff VACÍO:** `tipCalculations.ts`, `computeTotals` (`posFiscal.ts`), `cashUtils.ts`. **No se reescribió** `PROPINA_ROLES/NO_PROPINA_ROLES/BAR_ROLES`. El rol excluido simplemente no genera línea → nunca recibe puntos; la fórmula no cambia.
- **Migración aditiva, default true** → cero cambio de comportamiento para el resto de roles. **Null-safe:** si el flag viniera null/ausente (cache viejo, sin migración) → se trata como `true` (nadie se excluye).
- **Reversible:** Admin → Puntos por rol → toggle "Recibe propina" a **Sí** re-incorpora el rol. Del manager no se borró nada (`points` intacto).
- **No se tocó** la autorización de gerencia por contraseña (`verify_manager_password`).

## Verificación

- **tsc -b / build prod** (`VITE_APP_ENV=production npm run build`): **EXIT 0**.
- **Tests nuevos (13):** `roleReceivesTips`/`eligibleRoster` (manager fuera del turno nuevo, reversible, preserva entradas previas, null-safe) + render de Admin (togglear manager a No → persiste `upsert('manager', 3, false)`; reversible).
- **Sagrados diff VACÍO.**

### Cómo probar en staging (end-to-end)
1. Admin → **Puntos por rol**: "Encargado" ya está en **No** (flip aplicado). Abrir **Propinas → nuevo turno**: el manager **no aparece** en el roster ni en cobertura.
2. **Reversible:** poner "Encargado" en **Sí** → guardar → nuevo turno: el manager **reaparece**.
3. **Turnos cerrados/históricos:** sin cambios (se reconstruyen de sus entradas guardadas).

## Notas para el review

- **Cobertura también filtrada:** un rol no-elegible tampoco aparece en el picker de "cobertura" (para que no se le pueda cargar propina por ningún camino). Si preferís permitir que un manager cubra un puesto elegible y reciba por ese rol, es un ajuste de una línea.
- **2 fallos PREEXISTENTES en la suite** (`CashMovimientos.buscarNull.test.tsx`): **no son de este cambio** (reproducidos en `staging` limpio). Es un bug de zona horaria del test (usa `new Date().toISOString()` UTC vs `todayCR()` CR): falla solo de noche en CR, cuando UTC ya pasó al día siguiente y el movimiento cae fuera de la ventana de 60 días. Fuera de alcance (módulo cash).
- **2 errores de lint PREEXISTENTES** en `TipsModule.tsx` (líneas 178 y 376, `react-hooks/purity` sobre `setState`/`Date.now()`): no los toqué; mis archivos lintean limpio.
- Tras aplicar a prod (con firma): regenerar/verificar `supabase.gen.ts` contra la base real.
