# Pase a PROD de la mig 192 `propinas_cada_uno_lo_suyo` (origen club/puente 137)

> **⛔ Permisos/plata: firma del dueño sobre el SHA exacto.** Decisión del dueño, 18-nov-2026 12:55 -06:00: «en
> propinas sí, cada uno tiene que poder ver solo lo que se llevaron ellos, no lo del equipo». Esa es la firma de la
> idea; el pase necesita la firma sobre el SHA. Si algo no coincide, **se para y se avisa**.
>
> - **Número:** 192 (origen 137), la próxima en entrar. La 191 (#292) ya está en prod (ledger 191, leído el 18-nov).
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Orden:** #292 ya está en `main` (`0ff023f`): esconde para el personal las comparaciones con el equipo en Mi
>   Rendimiento, incluido el «Equipo (benchmark)» del ICP. Sin dependencias pendientes.
> - **Ledger:** exactamente 1 fila `192` con su `name` (`propinas_cada_uno_lo_suyo`).
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§4 y §5).

## 1. Qué pasa y qué no
**Pasa (solo LECTURA de `tip_entries`):**
- Se borra la policy «Todos ven entradas de propinas» (`get_my_role() is not null`, de la 073/085).
- `tip_entries_lee_gestion`: owner, manager, cajero, contador activos leen todas las filas (como hoy).
- `tip_entries_lee_lo_propio`: cualquier otro rol activo lee SOLO las filas de los empleados atados a su perfil
  (`employees.profile_id = auth.uid()`, activos o no).
- Helper `propinas_mis_empleados() → uuid[]`, `SECURITY DEFINER`, `search_path = public, pg_temp`, `STABLE`; vacío si el
  rol no está activo; EXECUTE solo `authenticated`.
- Guarda R13: aborta si las policies vivas de `tip_entries` no son exactamente las dos de hoy (md5) o si el helper ya
  existe.

**No pasa:** `tip_entries_op_write` (owner/manager/cajero escriben) igual; `tip_sessions` igual (pozos del turno, sin
desglose por persona); ningún cálculo de propinas ni de cierres; sagrados intactos (`tipCalculations.ts`,
`cashUtils.ts`, `cierrePozo.ts`); ninguna Edge; ningún dato; la app no cambia de llamada.

## 2. Prerrequisitos
- #292 en `main` (hecho: `0ff023f`).
- Prod (solo lectura, 18-nov): ledger = **191** (re-leído el 18-nov tras #292); `tip_entries` con 2 policies, md5 `a4d0a0e9aacc129de8d082c512aeeb3c`
  (lectura) y `da4dc6bf46cdceb8966878214e7405cd` (op_write); helper ausente. Staging: mismas dos huellas.

## 3. Pruebas (antes de aplicar)
- **Postgres 16 local** (base armada con `local_armar_base.sh` + `192_preludio_local.sql`, que deja `tip_entries` como
  prod): `python3 scripts/sql/192_pruebas.py --local "dbname=…" --mutar todas` → **28/28** y las 6 mutaciones muerden:
  `personal_todo` (caen 6), `contador_afuera` (1), `inactivo_ve` (2), `solo_activos` (3), `anon_ejecuta` (2),
  `guarda_floja` (1). Owner/manager/cajero también leen por `op_write` (FOR ALL): sacarlos de la lista no muerde.
- **Staging (`hwiatgic…`), transacción descartada: NO PROBADO por la MCP.** La herramienta pide confirmación para
  `drop policy`/DDL aunque termine en `rollback`, y en la sesión del agente se canceló sola. Se corre pegando
  `python3 scripts/sql/192_pruebas.py --armar --compacto` en una sola consulta (termina en `ROLLBACK`) desde una sesión
  que pueda confirmar. Esperado: `{"total": 28, "ok": 28, "fallan": []}`.
- **Staging, solo lectura (18-nov), JWT de un salonero de prueba:** hoy ve **22/22** filas de **12** empleados (con
  horas, puntos, cobrado y propina generada) y **0** propias: la fuga está.

## 4. Antes del merge (prod, solo lectura)
`scripts/sql/192_humo.sql` (`begin read only` … `rollback`; solo conteos y huellas). Leído el 18-nov:
- 2 policies con las huellas de §2, helper ausente, ledger 190 (re-leído después de #292: ledger 191, mismas huellas, helper ausente).
- Un salonero activo con empleado (JWT simulado): ve **2.178** filas de **34** empleados; propias **146**.
Si las huellas no coinciden, el ledger no es 191 o ya hay una `192`: **no se mergea**.

## 5. Después del merge (prod, solo lectura)
- Ledger: 1 fila `192` / `propinas_cada_uno_lo_suyo`; «Supabase Preview» en success con «All migrations
  are up to date».
- `192_humo.sql`: 3 policies (`tip_entries_lee_gestion`, `tip_entries_lee_lo_propio`, `tip_entries_op_write` con la
  misma huella `da4dc6bf…`), helper presente, `total` igual que antes, **`salonero_ve` = `salonero_propias`** (146 o
  más si se cerró un turno) y `salonero_empleados_distintos` = 1.
- App (validación física): un salonero en «Mi Rendimiento → ¥ Propinas» ve sus mismas quincenas y montos que antes;
  el encargado/cajero en «Propinas» ve Turno actual, Historial, Quincenal, Estadísticas y Cocina igual que antes; el
  contador, Historial igual.

## 6. Criterios de parada
- Ledger distinto del esperado, huellas distintas o Branching en rojo: **no se sigue**, se avisa.
- §5 distinto (gestión ve menos filas que antes, el salonero ve filas ajenas o pierde las suyas): se para y se decide la
  vuelta atrás. No se arregla a mano.

## 7. Vuelta atrás
`scripts/sql/192_rollback.sql`, **como migración nueva hacia adelante** (regla 10): se copia a
`supabase/migrations/NNN_propinas_vuelve_085.sql` con el siguiente número libre del bloque de pase, con firma, y entra
por merge → Branching. Devuelve la policy de la 085 (lo verifica por md5) y borra el helper. El `.sql` de la 192 se
queda. OJO: reabre la fuga. La app no cambia de llamada.

## 8. Firma y bitácora
| Cuándo (-06:00) | Quién | Qué |
|---|---|---|
| 2026-11-18 12:55 | dueño | Decide: «en propinas sí, cada uno tiene que poder ver solo lo que se llevaron ellos» |
| 2026-11-18 | agente | Lecturas en prod y staging (solo lectura); batería local 28/28 + 6 mutaciones; staging con DDL no corrido (MCP) |
| | verificador | Revisión independiente (pedida en el PR) |
| | dueño | Firma sobre el SHA |
