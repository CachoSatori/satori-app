# Análisis READ-ONLY — Vista del empleado (Mi Rendimiento): estado actual y Etapa 2

> **Sesión 2026-07-27 · diagnóstico, NO construcción.** Rama de trabajo: `staging` (`6e04d31`).
> Objetivo: mapear cómo está armada hoy la "casa del empleado" (métricas, metas, competencias)
> con evidencia del código (archivo + línea), para decidir la **Etapa 2** (metas personales
> self-serve + competencias enriquecidas). Cero código, cero migraciones, sagrados intactos.

## 0. Verificación de arranque (contra el repo real)

- `main = 1746fed` (PROD, solo lectura) · `staging = 6e04d31 = HEAD` · working tree limpio. **Coincide** con lo esperado.
- Sagrados byte-idénticos: `tipCalculations.ts` **7603ba5a** · `cashUtils.ts` **b597c697** · `posFiscal.ts` **a3fd445f** (solo-staging). **OK.**
- **Etapa 1 está en PROD y verificada:** los 5 archivos de Mi Rendimiento existen en `main` y son **byte-idénticos** a `staging`
  (`git diff main..staging` de `MiRendimiento*`/`miRendimiento*` = **vacío**). La ruta vive en prod con el rol correcto
  (`src/App.tsx:158`, roles `salonero,barman,barback,runner,cocina`) y el redirect viejo `/mis-propinas → /mi-rendimiento?tab=propinas` (`App.tsx:152`).
- ⚠️ **Deuda de docs (ya conocida):** la tabla (a) de `ESTADO.md` todavía cita `main c77ced0 / staging 02a012f` — hashes viejos.
  El header dice handoff 2026-07-27; las celdas de hash quedaron atrás. No afecta este análisis.

---

## 1. ROLES — dónde se definen y quién ve qué

**Enum de roles** — `src/shared/types/database.ts:6-17`:
`owner · contador · manager · cajero · salonero · barman · barback · runner · cocina · proveedor`.

**Constantes de rol para propina** — viven en el **sagrado** `src/shared/utils/tipCalculations.ts` (solo se leen):

- `BAR_ROLES = ['barman','barback']` (L4) — pool de barra.
- `NO_PROPINA_ROLES = ['barman','barback','cocina']` (L7) — sin campo de propina individual.
- `PROPINA_ROLES = ['salonero','runner','cajero','manager']` (L10) — con campo de propina individual.
- `ROL_ORDER` (L13) — orden de secciones.

Estas constantes son **estructurales** (quién tiene línea de propina). La **elegibilidad configurable** (mig 048,
`role_tip_points.recibe_propina`) es una capa aparte de datos: el manager quedó `recibe_propina=false` sin tocar la
matemática. Nota: `PROPINA_ROLES` incluye `manager`, pero la config lo excluye del roster — son dos planos distintos
(estructura vs. configuración), y está bien así.

**Ruteo por rol** — `src/App.tsx`:

| Ruta | Roles | Lectura |
|---|---|---|
| `/mi-rendimiento` (hub del empleado) | `salonero, barman, barback, runner, cocina` | **L158** |
| `/propinas` (TipsModule) | owner, manager, **cajero**, salonero, barman, barback, runner, cocina | L146 |
| `/caja` (CashModule) | owner, manager, **cajero**, contador | L147 |
| `/ventas` (dashboard gerencia + admin de metas/comps) | owner, manager, contador | L148 |
| `/inbox` (bandeja) | owner, manager, contador, **cajero** | L156 |

**El `cajero` va aparte, confirmado:** NO está en `/mi-rendimiento` (L158). Su casa es Caja + Bandeja + Propinas; es un
rol "de plata", no de rendimiento individual de mesa. Los 5 roles operativos de piso (salonero/barman/barback/runner/cocina)
entran al hub; dentro del hub, quién arranca dónde lo decide `isTipsFirst` (ver punto 2).

---

## 2. HUB "Mi Rendimiento" — arquitectura y las 6 pestañas

Tres archivos, todos en **prod**:

- `MiRendimientoWrap.tsx` (62 líneas) — **capa de datos**. Carga en paralelo (L29-52):
  - Ventas: `getVentasDias(365)` + `getProductMap()` + `getMetas()` + `getComps()` (L32). Si fallan, **no bloquean** (un cocina igual ve propinas, L34).
  - Propinas: `getEmployeeByProfileId(profile.id)` + `getAttendanceHistory(12)` (L41-45). Si no hay perfil vinculado → `noLink=true`.
- `MiRendimiento.tsx` (858 líneas) — **la UI**: período global + 6 pestañas + sub-componentes (`ResumenTab`, `ProductosTab`, `SemanaTab`, `PropinasTab`, `CompetenciasTab`).
- `miRendimientoUtils.ts` (240 líneas) — **helpers puros y testeados** (period, dowBreakdown, ICP, shiftMonth).

**Período global** (`MiRendimiento.tsx:96-110`): `Hoy · Esta semana · Este mes · Rango exacto`, default **Este mes**
(`useState<PeriodKind>('mes')`, L96). Reemplazó el fijo-60-días. Gobierna Resumen / Por día / Productos.

**Tipo de pestaña** (L46): `'resumen' | 'dia' | 'productos' | 'semana' | 'propinas' | 'competencias'`.

| Pestaña | Qué muestra | De dónde salen los datos |
|---|---|---|
| **心 Resumen** | KPIs del período (Ventas, Prom/PAX, Beb/PAX, Ratio C/B ₡ y uds, Prom/Plato, Prom/Bebida, Ticket/item) con **delta vs general** y **% de meta** coloreado; **ranking del día** si el período es 1 día; top productos. | `aggSalonero(name, …)` vs `aggGeneral(…)` sobre los **XLS del turno** (`ventas_dias`); `% de meta` de `getMeta` (punto 4); ranking L112-123. |
| **📅 Por día** | Tarjetas por día de semana (Prom/PAX, Beb/PAX, Ratio C/B), ★ mejor día, gráfico de barras, tabla yo-vs-resto. | `dowBreakdown` (`miRendimientoUtils.ts:111-156`) → `aggSalonero`/`aggGeneral` por día de semana; `bestDowIndex` (L159). |
| **🍱 Productos** | 3 bloques General/Comidas/Bebidas con toggle **₡ / uds**. | `myAgg.prods` clasificado por `ProductMap.tipo` (comida/bebida). |
| **🗓️ Semana** | Semanas calendario (actual + 4 previas). | Agregación por semana sobre `ventas_dias` (L132-152). |
| **¥ Propinas** | Selector de mes (‹ ›), **ICP electrónico + benchmark del equipo**, Q1/Q2, histórico. | `attendance` filtrado por `employee.id` (L159); ICP de `computeICP`/`icpVsTeam` (punto 3). |
| **🏆 Competencias** | Mis competencias activas con ranking, puntos, líder. | `getComps()` filtrado por `parts.includes(activeName)` (punto 5). |

**`isTipsFirst`** (L87): si no hay `activeName` **o** el rol es `cocina/runner/barback` → el hub arranca en **Propinas** y las
sub-vistas de ventas invitan a ir a esa pestaña (L283-288). Correcto para roles sin venta individual de mesa.

> **Estado real:** sólido y en prod. Es **100% display** sobre datos que ya existen. No agregó ni una migración
> (confirmado en `ESTADO.md §c`). El punto frágil es el **match por nombre** (punto 3), no la arquitectura.

---

## 3. MÉTRICAS — KPIs actuales y el match nombre↔empleado

**KPIs por empleado** (calculados en `ventasUtils.ts:aggSalonero`, L121-173, sobre los XLS del turno):
`promPax`, `promPlato`, `promBebida`, `ratioCB` (₡: com/beb), `ratioU` (uds: iCom/iBeb), `bebPax`, `promTicket`, más el
detalle de productos. El **benchmark** es `aggGeneral` (el restaurante) sobre las mismas fechas (delta "vs general").

**ICP electrónico** (`miRendimientoUtils.ts:168-220`): numerador = propina **electrónica GENERADA** por el empleado
(`tip_amount_crc + tip_amount_usd×TC`, `electronicTipCrc` L176), **no** el `payout_crc` (el reparto del pool, que mide
take-home). `computeICP = generado / ventas × 100` (L194); `icpVsTeam` compara contra el equipo (L211). Ambos números
(generado y cobrado) se muestran distintos, no se confunden.

**Ranking del día** (`MiRendimiento.tsx:112-123`): sólo cuando el período es **un día**; ordena `allSals` por `total`,
busca la posición de `activeName`. Es el "#N de M en ventas hoy".

**Match nombre↔empleado — el heurístico actual** (`MiRendimiento.tsx:76-84`):

1. `exact = allSals.find(n => n.toUpperCase() === profile.full_name.toUpperCase())` — match exacto del nombre completo.
2. Si no, `allSals.find(n => n.toUpperCase().startsWith(firstName))` — donde `firstName = full_name.split(' ')[0]`.
3. Si nada matchea → `activeName = ''` → el empleado cae a "propinas-primero".

`allSals` son las **claves del mapa `dias.saloneros[name]`** (los nombres tal como vienen en el XLS del PoS). O sea: **NO
hay campo de vínculo** entre `profiles` y el nombre del XLS; se resuelve por string. Toda la agregación depende de eso:
`aggSalonero` hace `dia.saloneros[name]` como lookup exacto (`ventasUtils.ts:129`). Consecuencias:

- Si el nombre del XLS no coincide con `full_name` (apodo, segundo nombre, tilde, "Ma." vs "María"), el empleado ve **cero
  ventas** y arranca en Propinas aunque sí haya vendido.
- El fallback por `startsWith(firstName)` puede **colisionar** entre dos empleados con el mismo primer nombre (agarra el primero de la lista).
- Es una decisión **firmada** del dueño (2026-07-17): en Etapa 1 se mantiene el match por nombre, sin campo nuevo.

---

## 4. METAS — de dónde sale el "% de meta" (y qué falta para self-serve)

**No es placeholder: hay metas reales, pero son de GERENCIA, no personales.**

- El "% de meta" del Resumen sale de `getMeta(metas, activeName, metric)` (`ventasUtils.ts:52-54`):
  `metas.salMetas?.[salName]?.[metric] ?? metas.global?.[metric] ?? 0`.
  El chip lo pinta `metaChip` (`MiRendimiento.tsx:398-402`) → `pctOfMeta = actual / m × 100`, coloreado por `metaCol` (L52).
  Métricas con chip: **ventas, promPax, bebPax, ratioCB, ticketItem** (L422-434).
- **Estructura de `Meta`** (`src/shared/types/ventas.ts:65-82`):
  - `restaurante`: `YYYY-MM → ₡` (meta mensual del local).
  - `margen`: `YYYY-MM → %`.
  - `global`: umbrales de KPI (promPax 15000, bebPax 1.2, ratioCB 3.0, ticketItem 7500, ventas 800000) — **defaults** si no hay fila.
  - `salMetas`: `Record<nombre, {promPax?, bebPax?, ratioCB?, ticketItem?, ventas?}>` — metas por salonero, **keyed por NOMBRE**.
- **Persistencia:** todo vive en **un solo JSONB**: tabla `ventas_metas`, una fila `key='all'` con `value` = el objeto `Meta`
  (`getMetas`/`saveMetas`, `api/ventas.ts:147-171`; DDL en `0095_drift_baseline.sql:76-80`, **presente en prod**).
- **RLS actual** (`011_ventas_exchange_rls.sql:20-30`): SELECT abierto a **todo** autenticado; INSERT/UPDATE/DELETE **solo
  owner/manager/contador**. → Un empleado **no puede** editar su meta; y al leer, lee el **blob entero** (las metas de todos).

**Qué está en prod:** metas por rol/gerencia (global + por-salonero por nombre), read-only para el empleado, coloreadas en el Resumen.

**Qué falta EXACTO para metas personales self-serve:**

1. **Tabla nueva `metas_personales` (mig 050)** — aditiva. Sugerido:
   `id · profile_id (FK a profiles) · periodo (YYYY-MM o rango) · metric o producto · target · created_by · timestamps`.
2. **RLS por empleado:** `USING (profile_id = auth.uid())` para SELECT/INSERT/UPDATE/DELETE del propio empleado
   (+ lectura de gerencia si se quiere supervisar). Esto es lo que hoy **no existe**: el modelo JSONB no tiene aislamiento por fila.
3. **UI de auto-servicio** en el hub (una pestaña "Mis metas") para fijar/editar la meta propia.
4. **Vínculo estable empleado↔ventas** si la meta es por producto/KPI medido sobre los XLS (hoy sólo hay match por nombre — ver punto 3).

> **Corrección de numeración (importante):** el SPEC dice "mig 048 metas_personales", pero **048 = elegibilidad de propina**
> y **049 = revoke SECDEF (B2)**. `047` está **reservada** para proveedores. → **`metas_personales` sería la mig 050**, no la 048.
> Verificado contra `supabase/migrations/` (última = 049) y `ESTADO.md §c`.

---

## 5. COMPETENCIAS — cómo están armadas hoy

**Modelo: las crea gerencia, el empleado las mira.** Ya funciona en prod, mismo patrón JSONB que metas.

- **Datos:** tabla `ventas_comps` (DDL `0095_drift_baseline.sql:82-88`, en prod), **una fila por competencia**, con JSONB `data`
  de tipo `Comp` (`types/ventas.ts:84-93`): `{ id, nombre, tipo (semanal|mensual|especial), inicio, fin, premio, prods:[{name,pts}], parts:[] }`.
- **API** (`api/ventas.ts:174-198`): `getComps` (lee y devuelve `data`), `saveComp` (delete-then-insert por `data->>id`), `deleteComp`.
- **Admin (gerencia):** `src/modules/ventas/VentasCompetencias.tsx`, dentro de `/ventas` (owner/manager/contador). Ahí se crean/editan.
- **Vista del empleado:** `CompetenciasTab` (`MiRendimiento.tsx:771-858`):
  - Filtra las competencias donde `comp.parts.includes(activeName)` (**por NOMBRE** otra vez, L774).
  - Calcula ranking client-side: por cada participante, `aggSalonero(sal, compDates, …)` y suma `qty × pts` de los productos de la
    competencia (L793-802). Muestra mi posición/puntos, líder y tabla completa. Ordena por estado (en curso → próxima → finalizada).
- **RLS:** igual que metas (`011`): lectura abierta autenticada, escritura owner/manager/contador.

**Qué está en prod:** competencias por producto con puntos, ranking en vivo, premio, estados. Sólidas.

**Qué habría que enriquecer para "ver competencias" como quiere el dueño (opciones, sin construir):**

- Competencias por **KPI** (no sólo por producto): Prom/PAX, ratio, upsell — hoy `prods:[{name,pts}]` sólo puntúa unidades vendidas.
- **Match robusto** empleado↔participante: hoy `parts` son nombres sueltos; si se agrega el vínculo estable (ver punto 3), el enganche deja de ser frágil.
- **Notificación / visibilidad** (banner "competencia activa", progreso hacia el premio) — hoy sólo aparece si el empleado entra a la pestaña.
- Historial de competencias pasadas con "qué gané".

---

## 6. Resumen: qué YA está en prod vs. qué falta (para la Etapa 2)

| Área | En PROD hoy | Falta para Etapa 2 | Impacto de esquema |
|---|---|---|---|
| **Métricas** | KPIs ricos + ICP electrónico + ranking + delta vs general, todo display. | Nada estructural. Opcional: vínculo estable empleado↔XLS para robustez. | Ninguno (o campo de vínculo → punto 3). |
| **Metas** | Metas de **gerencia** (global + por-salonero por nombre) en JSONB, read-only para el empleado. | **Metas personales self-serve**: tabla + RLS por empleado + UI. | **mig 050 `metas_personales` + RLS** (aditiva). |
| **Competencias** | Gerencia crea, empleado mira; ranking por producto/puntos, en prod. | Enriquecer: por KPI, match robusto, visibilidad/notificación. | Ninguno mínimo; **opcional** columnas nuevas si se cambia el modelo `Comp`. |

**Denominador común de toda la deuda:** el sistema se apoya en el **match por nombre** (metas `salMetas[name]`, competencias
`parts[name]`, ventas `saloneros[name]`). Cualquier Etapa 2 seria debería decidir primero si se agrega un **vínculo estable
empleado↔nombre-de-ventas** (campo en `profiles`/`employees` o tabla de alias). Sin eso, las metas personales y las competencias
por KPI heredan la fragilidad.

---

## 7. Opciones para la Etapa 2 (metas personales) — sin construir

**Opción A — Mínima (sólo metas personales, mantiene match por nombre).**
`mig 050 metas_personales(profile_id, periodo, metric, target, …)` + RLS `profile_id = auth.uid()` + pestaña "Mis metas".
Las metas se miden contra el KPI que ya calcula `aggSalonero` vía el nombre inferido. Rápida; hereda la fragilidad del nombre.

**Opción B — Robusta (metas personales + vínculo estable).**
Igual que A, **más** un campo/tabla de vínculo empleado↔nombre-de-ventas (elimina la heurística `startsWith`). Más trabajo,
pero deja parada la base para competencias por KPI y para reportes de gerencia confiables.

**Opción C — Modelo doble (personal + gerencia unificados).**
Migrar `salMetas` (hoy JSONB por nombre) a la misma tabla `metas_personales` con `origen: 'gerencia'|'personal'`, de modo que
el "% de meta" del Resumen y las metas self-serve salgan de una sola fuente con RLS. Es la más limpia a largo plazo pero toca
la lectura actual de metas (más superficie de cambio; requiere plan de migración de datos del blob).

> Recomendación de asesoría (para decisión del dueño, no ejecutada): **A** si se quiere entregar valor ya y medir demanda;
> **B** si el dueño ya sabe que quiere competencias por KPI y reportes de gerencia (el vínculo estable se paga una sola vez).
> **C** sólo cuando A/B estén probadas en prod.

---

## 8. Preguntas abiertas para el dueño

1. **Metas personales: ¿por producto, por KPI, o ambas?** El SPEC lo dejó "a definir al arrancar la Etapa 2". `aggSalonero` ya
   da los KPIs; las metas por producto son directas sobre `myAgg.prods`.
2. **¿Quién fija la meta personal?** ¿100% self-serve, o gerencia propone y el empleado acepta/ajusta? Cambia la RLS.
3. **Vínculo nombre↔empleado:** ¿seguimos con el match por nombre (decisión 2026-07-17) o esta Etapa 2 es el momento de agregar
   el campo de vínculo estable (Opción B)? Impacta metas y competencias por igual.
4. **Competencias:** ¿alcanza con lo actual (por producto/puntos) o el dueño quiere competencias por KPI y notificación de "hay
   competencia activa"?
5. **¿`salMetas` está poblado hoy en prod?** El mecanismo existe; si nadie lo cargó, el Resumen usa los `global` defaults. Se puede
   confirmar con una lectura **read-only firmada** (Management API, smoke 25006) antes de decidir si migrar el blob (Opción C).
6. **Alcance de RLS de lectura:** ¿la gerencia debe ver las metas personales de cada empleado (supervisión) o son privadas del empleado?

---

## 9. Guardrails de esta sesión (cumplidos)

- **Read-only.** Cero código de app, cero migraciones, cero cambios de plata/esquema. Sagrados byte-idénticos verificados.
- Todo el trabajo se apoyó en **código + tipos** (no se consultó la base). La única lectura de base sugerida (pregunta 8.5) queda
  **propuesta**, no ejecutada, y sería por el canal firmado read-only.
- Entregable: este documento en `staging`. **La Etapa 2 (construcción) se decide después, con el asesor y la firma del dueño (toca esquema).**
