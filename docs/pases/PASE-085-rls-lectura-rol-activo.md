# Paquete de pase a PROD · mig 085 `rls_lectura_rol_activo` (SEC-01c)

> **Estado: preparado, SIN ejecutar.** Lo firma Ismael después de la auditoría. Nada de este documento
> se corrió en prod salvo la **lectura de solo lectura del catálogo** (respaldo, §3).
> Rama: `claude/rls-is-active`. En staging desde el 08/11 07:17 CR (ledger de staging 80 → 81 en ese paso).

## 1. Qué hace
Las lecturas «para todos» de cinco tablas dejan de responder a una cuenta **inactiva** que conserva su
contraseña. La condición nueva es `get_my_role() is not null`, porque desde la 069 `get_my_role()` devuelve
null si la cuenta está inactiva.

| Tabla | Policy | Antes (`USING`) | Después (`USING`) |
|---|---|---|---|
| employees | «Todos ven empleados activos» | `is_active = true` | `is_active = true and get_my_role() is not null` |
| tip_entries | «Todos ven entradas de propinas» | `true` | `get_my_role() is not null` |
| tip_sessions | «Todos ven sesiones de propinas» | `true` | `get_my_role() is not null` |
| role_tip_points | «Todos ven puntos por rol» | `true` | `get_my_role() is not null` |
| exchange_rates | «Todos ven tipos de cambio» | `true` | `get_my_role() is not null` |
| exchange_rates | `exchange_rates_read` | `true` | `get_my_role() is not null` |
| profiles | «Solo owners crean/editan perfiles» (ALL) | `USING get_my_role() = 'owner'`, `WITH CHECK` null | igual `USING` + **`WITH CHECK` explícito** igual |

**Lo que no cambia:**
- **Usuarios activos:** ven exactamente lo mismo.
- **«Perfil propio visible»:** el propio perfil se sigue viendo con la cuenta inactiva (decisión de Ismael).
- **Anon:** sigue sin permiso de leer esas tablas.

## 2. Orden respecto del puente (regla de numeración, ESTADO.md)
1. **Primero el puente, con sus números:** la **081** (`pos_ndf_campos_factura`) y la **082**
   (`pos_ndf_ingesta_transaccional`). Al 08/11, prod termina en la **080**.
2. **Después la 085**, con su número: queda arriba de la 082.
3. **Si la 085 tuviera que pasar antes que el puente**, lo decide Ismael. Las dos salidas posibles:
   - la 085 espera al puente;
   - la 085 entra primero, y entonces la 081 y la 082 quedan ≤ 085 y toman el bloque de pase (150+).

## 3. Precondiciones (todas antes de mergear)
- [ ] **Firma de Ismael** sobre este paquete, después de la auditoría.
- [ ] **Ledger de prod:** la 085 libre y **último < 085**. Con el orden del §2, el último tiene que ser la 082.
- [ ] **Catálogo de prod igual al respaldo:**
  - las 7 policies del §1 existen, con las condiciones de la columna «Antes»;
  - RLS activa en las 6 tablas (`employees`, `tip_entries`, `tip_sessions`, `role_tip_points`, `exchange_rates`, `profiles`).
  - Leído el 08/11 15:20 UTC, solo lectura, y **coincide**: prod está igual a como estaba staging antes de la 085.
  - Respaldo completo **fuera del repo**: `respaldo_catalogo_prod_antes_085_2026-11-08T15-20-24Z.json`,
    sha256 `4db2c15b5847e9b73459ce0a5ef538cdf2ed3293f7d3ec4f27fc5d41bba90b58`.
  - Contenido: ledger (55 filas, último 080), RLS de las 6 tablas, `get_my_role()` completo y las **16 policies** de esas tablas.
  - Re-leerlo el día del pase y comparar. Si algo cambió, **frenar**: un `alter policy` sobre una policy que no
    existe hace fallar la migración, y Branching queda en `MIGRATIONS_FAILED`.
- [ ] **Rama:** al día con `main` y gate verde, incluido `supabase/migraciones.test.ts` (la 085 está registrada).
- [ ] **Horario:** fuera de 19–22 h CR, y ninguna otra sesión mergeando a `main`.
- [ ] **`085_pruebas.sh` corrido otra vez en staging con el cambio de este paquete** (pendiente). No se validó
  todavía porque la sesión del Club estaba usando staging; hoy solo está verificado que el script no tiene errores de sintaxis.

## 4. SQL exacto
- **Archivo:** `supabase/migrations/085_rls_lectura_rol_activo.sql`,
  sha256 `9e3005a592b23836852d7f9bf31837f747208f35a073599cd2c8811cf31475fd`.
  Es el mismo que se aplicó en staging; su fila del ledger de staging es idéntica byte a byte.
- **Contenido:** una transacción con 7 sentencias `alter policy` (las de la tabla del §1). Sin datos y sin otros objetos.
- **Cómo se aplica (plan a):** **el merge del PR a `main`**. Supabase Branching la aplica y escribe la fila
  `085` en el ledger. No se aplica a mano.

## 5. Verificación después del merge
1. **Branching:** el log del run tiene que decir `Applying migration... file=085_rls_lectura_rol_activo.sql`.
2. **Ledger de prod:** `count` + 1 y `max(version) = '085'`. Los `statements` de la 085 tienen que ser iguales al archivo.
3. **Catálogo:** las 7 policies con las condiciones de la columna «Después» del §1. Las otras 9 policies de esas
   tablas, **sin cambios** contra el respaldo.
4. **Pruebas en prod con sesiones simuladas** (`scripts/sql/085_pruebas.sh yiczgdtirrkdvohdquzf`): **en prod solo
   lee**. No simula al owner inactivo ni prueba editar otro perfil, porque las dos cosas escriben. Esperado:

   | Caso | employees · tip_entries · tip_sessions · role_tip_points · exchange_rates | profiles |
   |---|---|---|
   | owner, manager, contador, cajero, salonero **activos** | **los mismos conteos que antes** (correr el script también **antes** del merge y comparar) | owner/manager: todos; el resto: el propio |
   | manager **inactivo** (hay 2 en prod) | **0** en las cinco | 1 (el propio) |
   | anon | sin permiso (42501), igual que antes | — |

5. **Pantalla:** Ismael (owner) abre Caja y Propinas; alguien con rol de salonero abre Mi Rendimiento. Tienen
   que ver lo de siempre.

## 6. Rollback (todo en la misma ventana; nadie más pushea a `main` mientras tanto)
1. **En prod, en una transacción** (Management API, confirmando el ref de prod antes):
   - `scripts/sql/085_rollback.sql` (sha256 `99ffeedc155b8464253f1dfc449b20b37a99dee9853424d3c273477a3dfc312e`):
     vuelve las 6 lecturas a sus condiciones de antes y recrea «Solo owners crean/editan perfiles» sin
     `WITH CHECK`;
   - además, `delete from supabase_migrations.schema_migrations where version = '085';`.
2. **Enseguida, revert del merge en `main`** (saca el `.sql`). Si el archivo se queda en `main`, el próximo push
   la vuelve a aplicar. Si se revierte el `.sql` sin borrar la fila del ledger, Branching falla en cada push (pasó con
   la 074).
3. **Verificar:**
   - el log de Branching del revert dice «All migrations are up to date»;
   - las 16 policies quedan iguales al respaldo del §3;
   - `085_pruebas.sh` en prod da los conteos de antes.

## 7. Matriz de pruebas registrada en staging (08/11, sesiones simuladas, cada caso en una transacción con rollback)
En staging no había cuentas activas de manager, contador, barman ni cocina. Los conteos son de la base de staging.

**Antes de la 085 (07:16 CR):**

| Caso | employees | tip_entries | tip_sessions | role_tip_points | exchange_rates | profiles | edita otro perfil |
|---|---|---|---|---|---|---|---|
| owner activo | 45 | 17 | 3 | 7 | 3 | 10 | 1 |
| owner inactivo (simulado) | 21 | 17 | 3 | 7 | 3 | 1 | 0 |
| manager inactivo | 21 | 17 | 3 | 7 | 3 | 1 | 0 |
| cajero activo | 21 | 17 | 3 | 7 | 3 | 1 | 0 |
| cajero inactivo | 21 | 17 | 3 | 7 | 3 | 1 | 0 |
| salonero activo | 21 | 17 | 3 | 7 | 3 | 1 | 0 |
| salonero inactivo | 21 | 17 | 3 | 7 | 3 | 1 | 0 |
| anon | 42501 (sin permiso) | | | | | | |

**Después de la 085 (07:17 CR):**

| Caso | employees | tip_entries | tip_sessions | role_tip_points | exchange_rates | profiles | edita otro perfil |
|---|---|---|---|---|---|---|---|
| owner activo | 45 | 17 | 3 | 7 | 3 | 10 | 1 |
| owner inactivo (simulado) | **0** | **0** | **0** | **0** | **0** | 1 | 0 |
| manager inactivo | **0** | **0** | **0** | **0** | **0** | 1 | 0 |
| cajero activo | 21 | 17 | 3 | 7 | 3 | 1 | 0 |
| cajero inactivo | **0** | **0** | **0** | **0** | **0** | 1 | 0 |
| salonero activo | 21 | 17 | 3 | 7 | 3 | 1 | 0 |
| salonero inactivo | **0** | **0** | **0** | **0** | **0** | 1 | 0 |
| anon | 42501 (sin permiso), igual | | | | | | |

**Conclusión:** las cuentas inactivas pasaron a 0 filas, las activas quedaron igual, y el WITH CHECK explícito no
le cambió nada al owner activo.

## 8. Pendiente antes de la firma
- **Volver a correr `085_pruebas.sh` en staging** con el cambio de este paquete (en prod solo lee), cuando staging esté libre.
- **Probar `085_rollback.sql` en staging** dentro de una transacción con rollback: aplicar el rollback, comparar las
  16 policies con el respaldo y descartar. Mismo criterio: staging libre.
