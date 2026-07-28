# Prompt para Claude Code — Etapa 2 · Paso 1: vínculo empleado↔ventas + matar el selector

> ⚠️ **TOCA ESQUEMA → requiere firma del dueño antes de aplicar a la base.** Todo en **staging**.
> Sagrados intactos. Aditivo, null-safe y reversible. NO `db push` sin firma explícita.

## Objetivo
Que el empleado de piso vea **solo sus propios datos**, sin poder elegir a otro. Hoy Mi Rendimiento adivina el
nombre por heurística y muestra un **selector "Tu nombre:"** que deja cambiar de persona. Se reemplaza por un
**vínculo explícito hecho en Admin**: cada empleado guarda el **nombre-de-ventas exacto** (la clave tal cual
aparece en el XLS del turno), y Mi Rendimiento se ata a ese nombre.

## Contexto verificado (no re-descubrir)
- `employees` (mig 001): `id, full_name, role, profile_id, is_active`. Ya hay `linkProfileToEmployee` y
  `getEmployeeByProfileId` (`src/shared/api/admin.ts`). El Wrap ya carga el `employee` del perfil logueado
  (`MiRendimientoWrap.tsx:41`).
- El nombre-de-ventas real sale de `allSaloneros(dias)` (`ventasUtils.ts:73`) = claves de `dias.saloneros` (ej. "NACHO"),
  y **no necesariamente coincide** con `employees.full_name`. Por eso hace falta un campo explícito.
- El selector vive en `MiRendimiento.tsx:233-239`; el estado en `:84` (`salName`/`setSalName`); la heurística en `:76-82`.

## Alcance (hacer exactamente esto)

1. **Migración `050_employee_ventas_nombre.sql` (aditiva).**
   - `alter table public.employees add column if not exists ventas_nombre text;` (nullable, sin default).
   - **Verificá el número real:** usá el siguiente entero al último archivo en `supabase/migrations/` (hoy el último es
     `049`; `047` está RESERVADA para proveedores). Nombre plano de 3 dígitos, **sin sufijo** (recordá el bug de
     ordenamiento `NNN` vs `NNNx` del CLI documentado en `ESTADO.md §c`).
   - **RLS:** ninguna nueva. La tabla ya permite lectura del propio empleado (`getEmployeeByProfileId` ya la usa) y
     escritura de owner desde Admin. Agregar columna hereda las policies.
   - **NO aplicar a la base sin firma.** Dejá la migración lista; el dueño decide el `db push` en staging.

2. **Tipos + API.**
   - `Employee += ventas_nombre?: string | null` (`database.ts`), null-safe.
   - `supabase.gen.ts`: `employees` Row/Insert/Update += `ventas_nombre` (lo que produciría el regen).
   - `updateEmployee`: extender el `payload` para aceptar `ventas_nombre`.

3. **Admin — editor de empleado (`src/modules/admin/EmployeeList.tsx`).**
   - Agregar un campo **dropdown "Nombre en ventas"** poblado con `allSaloneros(dias)` (cargar `getVentasDias` +
     `allSaloneros` en el editor) para elegir el nombre **exacto** del XLS y evitar typos. Opción vacía "— sin vincular —" (null).
   - Guardar con `updateEmployee(id, { ventas_nombre })`. Mostrar el valor actual.

4. **Mi Rendimiento — matar el selector y atar al vínculo.**
   - `activeName = employee?.ventas_nombre ?? inferredName ?? ''` (el `employee` ya llega por props).
   - **Eliminar** el `<select>` "Tu nombre:" (`:233-239`) y el estado `salName`/`setSalName` (`:84-85`).
   - **Fallback null-safe:** si `ventas_nombre` es null, se mantiene la heurística actual (nada se rompe para empleados
     aún no vinculados); si tampoco hay match → arranca en Propinas como hoy (`isTipsFirst`).

## Restricciones / guardrails
- **STAGING** únicamente. `main`/prod solo se leen. **Firma del dueño** para el esquema; sin firma **no** hay `db push`.
- **Sagrados byte-idénticos** (`tipCalculations.ts` 7603ba5a · `cashUtils.ts` b597c697 · `posFiscal.ts` a3fd445f). No tocarlos.
- Aditivo, **null-safe**, **reversible** (columna nullable; el selector removido es solo UI).
- Sin tocar la matemática de propinas/ventas ni otras rutas. No mezclar con los cambios de ruteo (van en prompt aparte).

## Criterios de aceptación
- Un empleado con `ventas_nombre` seteado ve **solo lo suyo**, **sin selector** visible.
- Un empleado sin `ventas_nombre` sigue funcionando por heurística (o arranca en Propinas). Cero regresión.
- Desde Admin se puede setear/cambiar/limpiar el nombre-de-ventas desde el dropdown de nombres reales.
- `VITE_APP_ENV=production npm run build` → **EXIT 0** (recordá: `tsc --noEmit` es falso verde). Suite verde. ESLint de los archivos tocados limpio.
- Sagrados diff **VACÍO**. Migración lista pero **no aplicada** (espera firma).
- Rama nueva desde `staging` → review del asesor → validación del dueño en staging.

## Nota de numeración
Esta migración toma la **050**. La futura `metas_personales` (Etapa 2, tanda aparte) pasa a **051** — corrige el SPEC viejo que decía "048".
