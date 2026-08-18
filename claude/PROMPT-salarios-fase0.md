# PROMPT para Claude Code — Salarios · Fase 0 (Maestro de empleados)

> Entregar a CC **solo con la firma de Ismael** (toca ESQUEMA). Base: `claude/SPEC-modulo-salarios.md` §2.1, §6, §9 (A3), §10. Trabajás en **rama desde `staging`**; Ismael valida en staging antes de merge.

## OBJETIVO
Preparar los **datos maestros** del módulo Salarios: extender `employees` con los campos de nómina y crear la sección **Salarios** con su primera pestaña, **Empleados / Tarifas** (tabla editable). **Sin cálculo de plata, sin puente BioTime, sin períodos, sin liquidaciones.**

## ORDEN DE ENTREGA (regla de proceso §10)
1. **Primero: el SQL / diff de esquema** (la migración) para revisión y firma.
2. **Después: la UI.** No mezclar ambos en un solo empujón sin revisar el esquema antes.

## CAMBIOS PERMITIDOS
1. **Migración aditiva** (número libre a verificar en staging, ~055; NO editar migraciones ya aplicadas). En `public.employees`, todo `add column if not exists`, null-safe:
   - `hourly_rate_crc numeric not null default 0`
   - `fixed_salary_crc numeric not null default 0`
   - `participa_servicio boolean not null default true`
   - `biotime_emp_code text`  → **índice único parcial:** `create unique index if not exists ... on employees(biotime_emp_code) where biotime_emp_code is not null` (A3: único cuando no es null)
   - `fecha_ingreso date`
   - **Solo STAGING** (`db push`, ref `hwiatgic`). NADA a `main`. Confirmá `supabase/.temp/project-ref` = hwiatgic antes de cualquier comando de DB.
2. **Tipos:** extender `Employee` en `src/shared/types/database.ts` (campos opcionales/null-safe).
3. **API (`src/shared/api/admin.ts`):** extender el update de empleado (o `updateEmployeePayroll(id, {...})`) para los nuevos campos — `update` normal sobre `employees`, sin RPC nueva. **Al guardar `biotime_emp_code`: rechazar duplicado** con mensaje claro (además del índice único que lo blinda en la base).
4. **UI — sección nueva "Salarios"** (módulo/route top-level, patrón `CashModule`/`TipsModule`), nav **solo owner/manager**. En esta fase, **una sola pestaña — Empleados / Tarifas**: tabla con nombre, rol, tarifa/hora, salario fijo, participa 10% (toggle Y/N), código BioTime, fecha ingreso. Edición y guardado por fila. Reusar estilo de `EmployeeList.tsx`. Mostrar/gestionar `is_active` (inactivo **no se borra**, solo se desactiva).

## GUARDRAILS (no negociable)
- **NO** tocar sagrados: `tipCalculations.ts` (`7603ba5a`), `cashUtils.ts` (`b597c697`), `posFiscal.ts` (`a3fd445f`) — byte-idénticos.
- **NO** tocar Tips, Caja, POS ni Proveedores. Nada de su matemática.
- **Sin lógica de plata:** nada de salario, 10%, horas ni BioTime en esta fase.
- **Nunca casar por nombre** (A3): la identidad es `employees.id` + `biotime_emp_code`.
- **NO hardcodear tarifas.** La carga la hace Ismael por la UI (o seed si pasa la lista). Defaults = 0 / true.
- Migración **solo aditiva**, **solo staging**. `main` intacto. Rama desde `staging`.
- `npm run build` EXIT 0. Tests verdes. ESLint delta 0.

## CRITERIOS DE ACEPTACIÓN
1. Migración aplicada a **staging**; `employees` con los 5 campos nuevos; empleados existentes intactos (defaults) — verificar con `select` de control.
2. Sección **Salarios** visible para owner/manager; se puede **editar y guardar** tarifa/hora, salario fijo, participa 10%, código BioTime, fecha ingreso; persiste tras refrescar.
3. **Código BioTime duplicado se rechaza** (probar: dos empleados con el mismo código → error, no se persiste).
4. **Empleado inactivo no se borra:** `is_active=false` lo saca de listas de cálculo futuras pero conserva la fila y su historial.
5. **Test** nuevo: guardado de campos de nómina (update + relectura) y rechazo de código BioTime duplicado.
6. Sagrados byte-idénticos. `main` intacto (mismo commit). Build/tests/lint verdes.
7. Reporte final: rama, commit, diff, build/tests, hashes de sagrados, confirmación de que `main` no se movió.

## FUERA DE ALCANCE (Fase 1+)
Puente BioTime, horas, reparto 10%, cálculo de salario, comprobante, consolidado, %-sobre-ventas, liquidaciones.

---

## LO QUE ISMAEL DEBE PREPARAR (para poblar Fase 0)
Una **lista maestra única** de empleados, un renglón por persona, con:
- **Nombre** (como se mostrará en la app).
- **Tarifa por hora (₡)** — 0 si no cobra por hora.
- **Salario fijo (₡)** — solo quien lo tenga (ej. Rosaura ₡450.000); 0 si no.
- **Participa del 10% (Sí/No)** — igual que la columna del Excel.
- **Código BioTime** (`emp_code`) — el número/ID de cada empleado en el lector de huella. **Sin duplicados.**
- **Fecha de ingreso** — para vacaciones/aguinaldo (Fase 5); si no la tenés a mano, se puede completar después.

> Tip: se puede exportar de EMPLEADOS del Excel + el listado de usuarios de BioTime para armar el cruce nombre↔código una sola vez.
