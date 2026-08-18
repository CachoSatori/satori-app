# SPEC — Módulo "Salarios" (Satori App)

**Fecha:** 2026-08-17 · **Autor:** Claude (asesor) · **Estado:** CONGELADO a nivel diseño (R1–R14 + enmiendas A1–A7 §9 + reglas de proceso §10). Cada fase requiere **firma explícita de Ismael** antes de que CC aplique nada (toca DINERO y ESQUEMA). Fondo y diagnóstico: `claude/ANALISIS-planilla-salarios-y-nomina.md`.

> ✅ **FIRMADO por Ismael (2026-08-17).** SPEC aprobado. Redondeo **half-up** (colón entero) confirmado. Fixture **Q1_Ago** confirmado como ancla de Fase 2. **Fase 0 habilitada** para Claude Code (pendiente: lista maestra de empleados + credenciales Postgres BioTime para Fase 1).

Reemplaza la planilla anual de Excel (10% de servicio + pago por hora + comprobantes + % sobre ventas + liquidaciones). Fuente única por dato: **horas ← BioTime**, **tarifas ← ficha del empleado**, **10% ← POS/fiscal**, **ventas ← POS**, **propina ← módulo Tips**.

---

## 0. Alcance y NO-alcance

**Construye:** sección nueva **Salarios** con (a) ficha de tarifas por empleado, (b) ingesta de horas desde BioTime, (c) reparto diario del 10% de servicio, (d) cálculo de salario por hora + feriado + fijo + bono, (e) reporte quincenal + comprobante, (f) consolidado por empleado (horas + 10% + propina), (g) % de salarios sobre ventas, (h) liquidaciones (vacaciones + aguinaldo).

**NO toca:**
- **Sagrados** (`tipCalculations.ts`, `cashUtils.ts`, `posFiscal.ts`, lógica de cierres/posFiscal): byte-idénticos.
- **Módulo Tips:** solo se **lee** (para la columna propina del consolidado). No se modifica su matemática.
- **`posFiscal.ts`:** el 10% se **consume** de ahí (`computeTotals().servicio`), **nunca se recalcula** en Salarios.
- **Caja / propinas / proveedores:** intactos.

---

## 1. Resoluciones firmadas (R1–R12)

- **R1 — 10% ≠ propina.** Son flujos distintos. El 10% (obligatorio) se reparte diario por horas; la propina (voluntaria) sigue en Tips. No se mezclan ni se doble-cuentan.
- **R2 — Sección nueva "Salarios".** No se extiende Tips.
- **R3 — Todos los empleados.** El maestro `employees` se puebla con **todos** los del restaurante, cada uno con su tarifa/hora.
- **R4 — Elegir quién recibe el 10%.** Flag `participa_servicio` por empleado (Y/N), editable, igual que la columna del Excel.
- **R5 — Pool del 10% automático del POS.** Derivado de las ventas del día (todas pasan por el POS — R6). No se digita.
- **R6 — POS = 100% de las ventas.** Confirmado por Ismael. El pool del 10% del POS es completo.
- **R7 — Horas desde BioTime por PostgreSQL directo.** No hay API (no se paga). Puente de solo lectura → Supabase. Horas **exactas** (con minutos).
- **R8 — Feriados: calendario oficial CR + edición manual.** Precargado, editable, se pueden agregar días. Horas en día feriado (paga doble) → ×2.
- **R9 — Consolidado por empleado.** Total por empleado y período en **horas + 10% + propina**. La propina se lee de Tips; la propina de **cocina (pozo)** se divide **en partes iguales** entre los cocineros del período.
- **R10 — Período quincenal + cálculo fuera de fecha.** Quincena estándar (1–15 / 16–fin) + período **ad-hoc** por rango de fechas (para liquidar a alguien que se va antes de la fecha de pago).
- **R11 — Liquidaciones.** Apartado para calcular liquidación **completa o proporcional** de **vacaciones y aguinaldo** (fórmulas legales CR §6; validación del contador antes de construir).
- **R12 — Propina por horas de BioTime = FUTURO, no v1.** Hoy Tips usa horas redondeadas; BioTime es exacto → descuadrarían. Salarios usa BioTime; Tips queda como está hasta decidir la unificación.
- **R13 — Redondeo: colón entero.** Todo pago final (salario, aporte 10%, liquidación) se redondea a **colón entero**.
- **R14 — Liquidación completa o parcial.** El apartado permite calcular la liquidación **completa** o **llenar/incluir solo los componentes necesarios** (con entrada manual donde el contador lo indique).

**Pendiente del contador (NO bloquea Fases 0/1; el núcleo de Fase 2 es en bruto de todos modos):**
- **Bruto vs neto (deducciones CCSS/renta) — Ismael consulta al contador.** Working default v1 = **bruto** (como el Excel). El cálculo núcleo (horas + 10% + feriado + fijo) ya es bruto; las deducciones serían una **capa adicional posterior**, no cambian Fases 0/1 ni el núcleo de Fase 2.
- **Vacaciones — modelo exacto — Ismael consulta al contador** (afecta solo Fase 5).

---

## 2. Modelo de datos (esquema Supabase)

Todas las escrituras a tablas con plata van por **RPC `SECURITY DEFINER`** (RLS solo-SELECT), owner/manager, idempotentes por `client_op_id` — mismo patrón que proveedores (mig 053/054).

### 2.1 Extender `employees` (Fase 0)
```
hourly_rate_crc     numeric   default 0      -- tarifa por hora (0 = no cobra por hora)
fixed_salary_crc    numeric   default 0      -- salario fijo por quincena (ej. Rosaura); 0 = no aplica
participa_servicio  boolean   default true   -- Y/N del reparto del 10% (R4)
biotime_emp_code    text      unique null    -- código del empleado en BioTime (R7)
fecha_ingreso       date      null           -- para liquidación/vacaciones/aguinaldo (Fase 5)
```
Aditivas, null-safe, no rompen el flujo actual.

### 2.2 `time_punches` — marcas crudas de BioTime (Fase 1)
```
id               uuid pk
biotime_txn_id   bigint unique     -- id de la transacción en BioTime → IDEMPOTENCIA (on conflict do nothing)
emp_code         text              -- código crudo del reloj
employee_id      uuid null fk employees   -- resuelto por biotime_emp_code (null = sin mapear)
punch_at         timestamptz       -- hora exacta de la marca (tz America/Costa_Rica)
punch_state      text              -- 'in' | 'out' (o el código nativo de BioTime, normalizado)
terminal         text null
raw              jsonb             -- fila original de BioTime (auditoría)
synced_at        timestamptz default now()
```
Crudo e inmutable. Las horas por día se **derivan** de acá (no se digitan).

### 2.3 `work_days` — horas por empleado/día (derivado, Fase 1)
```
employee_id  uuid fk
work_date    date
hours        numeric        -- emparejando in/out del día (posibles pares múltiples)
es_feriado   boolean        -- work_date ∈ feriados con paga_doble (R8)
source       text           -- 'biotime' | 'manual' (override auditable)
pk (employee_id, work_date)
```
Se recalcula desde `time_punches`. Permite override manual (marca `source='manual'`, auditado).

### 2.4 `feriados` — calendario (Fase 2)
```
fecha       date pk
nombre      text
paga_doble  boolean default true    -- feriado de pago obligatorio → ×2
origen      text                     -- 'oficial' | 'manual'
```
Se precargan los oficiales CR del año; editable; se pueden agregar (R8).

### 2.5 `salary_periods` — períodos de pago (Fase 2)
```
id            uuid pk
tipo          text        -- 'quincena' | 'adhoc' | 'liquidacion'
fecha_ini     date
fecha_fin     date
estado        text        -- 'abierto' | 'cerrado' | 'reabierto'  (A2)
created_by    uuid
closed_by     uuid null · closed_at timestamptz null
reopened_by   uuid null · reopened_at timestamptz null · reopen_motivo text null   -- A2: reapertura auditada
```
Quincena estándar o rango ad-hoc (R10). Cierre/reapertura = owner/manager (A2).

### 2.6 `salary_lines` — nómina calculada por empleado/período (Fase 2, snapshot al cerrar)
```
id                 uuid pk
period_id          uuid fk
employee_id        uuid fk
horas_normales     numeric
horas_feriado      numeric
pago_horas         numeric      -- horas_normales × tarifa
pago_feriado       numeric      -- horas_feriado × tarifa × 2
aporte_servicio    numeric      -- 10% repartido (§3.2)
salario_fijo       numeric
bono               numeric
total              numeric
snapshot           jsonb        -- desglose diario del 10% (auditoría)
```
Congela el cálculo al cerrar el período (como el comprobante de proveedores congela su snapshot).

### 2.7 `liquidaciones` (Fase 5)
```
id              uuid pk
employee_id     uuid fk
estado          text        -- 'draft' | 'confirmada'  (A4: no se paga desde draft)
fecha_calculo   date
fecha_ingreso   date
fecha_salida    date
incluye_aguinaldo boolean · incluye_vacaciones boolean    -- A4: completa o parcial
aguinaldo       numeric
vacaciones_dias numeric
vacaciones_monto numeric
override         boolean · monto_final numeric            -- A4: override manual + monto final
formula_ref     text        -- A4: fórmula de referencia usada
detalle         jsonb
created_by      uuid        -- A4: quién calculó
```

---

## 3. Cálculo (fórmulas exactas)

### 3.1 Horas por jornada (desde BioTime)
**"Día" en Salarios = jornada operativa** (día del negocio con corte ~05:00 CR, A1), **no** día civil — un turno que cierra a las 2am cuenta entero en la jornada que abrió. Emparejar marcas `in`/`out` de la misma jornada. `hours = Σ (out − in)` de los pares. Exacto, con minutos. Si la jornada es feriado con `paga_doble`, esas horas van al bucket `horas_feriado`. `work_days.work_date` = fecha de la jornada (= `session_date` del POS).

### 3.2 Reparto del 10% por jornada (idéntico al Excel, verificado)
Por cada **jornada** del período (día operativo, misma unidad que las horas — A1/§3.1):
```
pool_jor         = Σ servicio de las órdenes POS de esa jornada           (computeTotals().servicio)
horas_part_jor   = Σ horas de los empleados con participa_servicio=Y que trabajaron esa jornada
aporte(emp, jor) = participa(emp) ? pool_jor × (horas(emp,jor) / horas_part_jor) : 0    (0 si horas_part_jor=0)
```
```
aporte_servicio(emp) = Σ_jornada aporte(emp, jornada)      -- sobre las jornadas del período
```
Regla exacta del Excel: el que no participa no entra ni al numerador ni al denominador; jornada sin horas o sin pool → 0 (A1: el pool de esa jornada no se reparte ni se arrastra).

### 3.3 Salario del período
```
pago_horas   = horas_normales × hourly_rate_crc
pago_feriado = horas_feriado  × hourly_rate_crc × 2          (solo días paga_doble)
total = pago_horas + pago_feriado + aporte_servicio + fixed_salary_crc + bono
```
Un empleado puede tener tarifa/hora **y** salario fijo **y** 10% a la vez (caso Rosaura en el Excel). v1 = **bruto** (sin deducciones; ver pendiente-contador §1). **Redondeo final a colón entero, half-up (R13/A6);** intermedios del 10% con decimales, se redondea solo el total.

### 3.4 Consolidado por empleado (R9)
```
total_recibido(emp, período) = salario_total(emp)          -- horas + feriado + 10% + fijo + bono
                             + propina_individual(emp)      -- Σ tip_entries.payout_crc del período (Tips)
                             + propina_cocina_parte(emp)    -- si es cocina: pozo_cocina_período / #cocineros_del_período
```
La propina se **lee** de Tips (fuente única). Cocina = pozo dividido en partes iguales entre los cocineros que trabajaron el período.

### 3.5 Liquidación (Fase 5 — fórmulas legales CR, validar con contador)
- **Aguinaldo:** `Σ salarios brutos (1 dic → 30 nov) ÷ 12`. Proporcional al retiro = `1/12 de lo devengado en el período trabajado`. (Exento de CCSS.)
- **Vacaciones:** derecho ≈ `1 día por mes trabajado` (2 semanas por cada 50 semanas). Proporcional = `meses_trabajados × 1 día × (salario_mensual ÷ 30)`. (CCSS 10,5% aplica.)
- **Componentes opcionales (R14 — completa o parcial):** preaviso, cesantía (Art. 29) y días trabajados pendientes. El apartado permite **incluirlos o no** y **entrada manual** donde el contador lo indique; se puede calcular la liquidación completa o solo la parte necesaria.

> Nota legal: estas son fórmulas de referencia del Código de Trabajo CR; **no** son asesoría legal/contable. El contador valida el cálculo real (incl. bruto/neto y modelo de vacaciones) antes de usarlo para pagar.

---

## 4. Puente BioTime → Supabase (Fase 1)

**Arquitectura:** servicio chico (Node o Python) que corre **en la PC de BioTime** (o en la misma LAN). Cada 2–5 min:
1. Conecta al **PostgreSQL de BioTime** con **usuario de SOLO LECTURA**.
2. `SELECT` incremental de la tabla de transacciones (`biotime_txn_id > último_sincronizado`).
3. Normaliza y **empuja** a Supabase vía Edge Function `ingest-punches` (valida un secreto compartido; service-role del lado servidor).
4. Inserta en `time_punches` con `on conflict (biotime_txn_id) do nothing` → idempotente.

**Seguridad (no negociable):**
- A BioTime **solo se lee, nunca se escribe** (usuario read-only).
- **Salida-only:** el puente sale hacia Supabase; **no se abre ningún puerto** entrante ni se expone la base a internet.
- Secreto del Edge Function fuera del repo.
- Si la PC se apaga: BioTime guarda las marcas; sincronizan al reconectar.

**Prerrequisito de Ismael (bloquea Fase 1):** credenciales del Postgres de BioTime (host/puerto/usuario/clave) o acceso a la PC para sacarlas + confirmar nombre real de la tabla/columnas de transacciones (se inspecciona una vez con DBeaver/pgAdmin). Sin el esquema real de BioTime, el puente no se puede finalizar.

**Mapeo:** `employees.biotime_emp_code ↔ punch.emp_code`. Códigos sin mapear caen a una bandeja "sin asignar" para resolver desde la app.

### 4.1 Dónde corre el puente y cómo se valida (BioTime vive en OTRA PC)
El Postgres de BioTime vive en la **PC del reloj** (la del local), no en la Mac de Ismael ni en esta sesión. Por eso:
- **El puente corre EN la PC de BioTime** (o en otra máquina **de la misma red local** — un mini-PC/Raspberry siempre encendido). Es donde alcanza el Postgres por `localhost`/IP local. La Mac de Ismael **solo se usa para que CC escriba el código**; la ejecución es allá.
- **Inspección (una vez, prerequisito):** en esa PC (o vía **AnyDesk** — Ismael ya lo tiene), conectarse al Postgres con DBeaver/pgAdmin, ubicar la tabla de marcas + columnas, y **exportar una muestra chica** (unas marcas) para dársela a CC. Con eso CC arma el puente sin necesitar acceso vivo desde la Mac.
- **Validación:** correr el puente en esa PC apuntando a su Postgres → sube un lote de prueba a Supabase → comparar contra un **reporte de BioTime del mismo día**. Debe cuadrar.
- **Multi-local (Santa Teresa + Nosara):** si hay **un BioTime por local**, hay **un puente por local** (cada uno empuja a la misma Supabase, con su `terminal`/local marcado). *A confirmar: ¿uno o dos BioTime?*

---

## 5. UI — sección "Salarios"

Pestañas:
1. **Empleados / Tarifas** — tabla editable: tarifa/hora, salario fijo, participa 10% (Y/N), código BioTime, fecha ingreso. (Owner/manager.)
2. **Feriados** — calendario CR precargado + agregar/editar (R8).
3. **Horas** — horas por empleado/día (de BioTime), con override manual auditado + bandeja "sin mapear".
4. **Período / Reporte** — elegir quincena o rango ad-hoc → tabla de salarios + comprobante por empleado (PNG/WhatsApp, reutiliza `comprobante.ts`).
5. **Consolidado** — por empleado y período: horas + 10% + propina = total recibido (R9).
6. **% sobre ventas** — costo laboral / ventas (semana/mes), enlazado al P&L (`finance.ts`, `a6200`).
7. **Liquidaciones** — liquidación **completa o parcial** (R14): vacaciones + aguinaldo (+ opcional preaviso/cesantía/días), completa o proporcional, con entrada manual donde aplique (Fase 5).

---

## 6. Fases, entregable y criterios de aceptación

Cada fase: rama → CC ejecuta → revisión asesor (read-only) → Ismael valida en staging → firma → (prod aparte). Toca dinero/esquema ⇒ **firma por fase**.

| Fase | Entregable | Aceptación |
|---|---|---|
| **0 — Maestro** | Extender `employees` (§2.1) + UI tarifas + cargar todos los empleados | Todos los empleados con tarifa/flag; build+tests verdes; sagrados intactos |
| **1 — Puente horas** | Usuario read-only en BioTime + puente + `ingest-punches` + `time_punches`/`work_days` | Horas de la app vs **reporte real de BioTime** de un día = cuadran |
| **2 — Salarios núcleo** | Feriados + reparto 10% (§3.2) + salario (§3.3) + período quincena/ad-hoc + reporte + comprobante | **Fixture `Q1_Ago` (§9 A5):** aporte 10% por empleado = Excel ± ₡1; Σ = ₡1.060.891; Karen/Judith = ₡0 (participa=N) |
| **3 — Consolidado** | Vista horas + 10% + propina por empleado (lee Tips; cocina pozo ÷ igual) | Propina cruza con Tips; cocina reparte parejo; totales cuadran |
| **4 — % sobre ventas** | Costo laboral / ventas (semana/mes) en P&L | % coincide con salarios/ventas del período |
| **5 — Liquidaciones** | Vacaciones + aguinaldo (completa/proporcional) + componentes opcionales, **completa o parcial** (R14) | Validado por el **contador** contra un caso real |

Orden y dependencias: 0 → 1 → 2 → {3, 4} → 5. La 3 y la 4 pueden ir en paralelo tras la 2.

---

## 7. Guardrails no negociables

- **Dinero + esquema = firma de Ismael** antes de aplicar. Nada a `main` sin su validación física.
- **Sagrados byte-idénticos** (`tipCalculations 7603ba5a` · `cashUtils b597c697` · `posFiscal a3fd445f`).
- **10% se consume de `posFiscal`**, no se recalcula.
- **Tips solo lectura** (consolidado). Su matemática no se toca.
- **BioTime solo lectura**, salida-only, sin exponer nada a internet.
- **Escrituras con plata** por RPC `SECURITY DEFINER` (RLS solo-SELECT), owner/manager, idempotentes por `client_op_id`.
- **Migraciones:** numeración a coordinar en el pase (055+), staging primero (`db push`), prod aparte (Branching auto-aplica en `main`).
- **Snapshots inmutables** al cerrar período/liquidación (auditable, como proveedores).

---

## 8. Estado de las definiciones (2026-08-17)

1. **Bruto vs neto** → **Ismael consulta al contador.** Working default v1 = bruto. No bloquea Fases 0/1 ni el núcleo de Fase 2.
2. **Vacaciones — modelo exacto** → **Ismael consulta al contador.** Solo afecta Fase 5.
3. **Liquidación — alcance** → **RESUELTO (R14):** completa o parcial; vacaciones + aguinaldo + opcionales (preaviso/cesantía/días), con entrada manual.
4. **Cocineros del pozo** → **RESUELTO (R9):** pozo de cocina ÷ partes iguales entre los cocineros del período. *(Verificar fuente del pozo contra `pozo.ts` en Fase 3.)*
5. **Redondeo** → **RESUELTO (R13):** colón entero.

Nada de lo pendiente bloquea el arranque: **Fase 0 y Fase 1 pueden empezar ya**; el núcleo de Fase 2 (horas + 10% + feriado, en bruto) también. Solo la **capa de deducciones** y la **Fase 5** esperan al contador.

---

## 9. Enmiendas de endurecimiento (A1–A7, firmadas 2026-08-17)

No reabren R1–R14; las precisan.

### A1 — Casos borde del 10% y de las marcas
- **Día con pool > 0 y 0 horas de participantes:** el pool de ese día **NO se reparte** — se pierde, **no se arrastra** a otro día. (Evita inventar un destinatario.)
- **Marca `in` sin `out` (o `out` sin `in`):** ese par **no genera horas**; el día cae a **bandeja de revisión** con `hours=0` hasta un **override manual auditado** (`work_days.source='manual'`).
- **Turno que cruza medianoche = JORNADA, no día civil (CORREGIDO 2026-08-17):** un turno que empieza de noche y termina de madrugada **NO se parte**; todas sus horas van a la **jornada en que abrió**. Se usa un **corte horario configurable (~05:00 CR):** cualquier marca entre 00:00 y el corte pertenece a la jornada del día anterior. Cubre el caso real (cocina cierra 11pm, días largos hasta 00:30, eventos hasta 3am). El **pool del 10% usa la MISMA jornada** (coherencia horas↔pool↔ventas). Se **alinea al `session_date` del POS/caja**, que hoy se asigna a mano en la apertura y ya atraviesa la medianoche (verificado en `CashTurno.tsx`). *Confirmar el corte exacto con Ismael.*
- **Empleado sin `biotime_emp_code`:** no entra al cálculo automático; solo con `work_days source='manual'` (auditado). Aparece en **bandeja "sin mapear"**.

### A2 — Cierre de período (evento de plata)
- **Cerrar período:** solo owner/manager.
- Al cerrar se generan **`salary_lines` inmutables** (snapshot). **Los comprobantes solo salen de períodos cerrados.**
- **Bono:** se carga **antes** del cierre (editable con período abierto). Post-cierre, solo vía reapertura.
- **Reabrir período:** solo owner/manager + **motivo obligatorio** + auditoría (quién/cuándo/por qué). Al reabrir, las `salary_lines` **dejan de ser pagables** hasta un nuevo cierre.
- `salary_periods.estado`: `'abierto' | 'cerrado' | 'reabierto'` + `closed_by/closed_at`, `reopened_by/reopened_at/reopen_motivo`.

### A3 — Identidades y maestro (Fase 0)
- **Nunca casar por nombre.** Clave = `employees.id` + `biotime_emp_code`. (El Excel casa por nombre y ya produjo drift: en `Q1_Ago` la fila de salario fijo ₡450.000 —de **Rosaura** en el maestro— aparece rotulada "Nacho". Ese error no se puede repetir.)
- `biotime_emp_code` **UNIQUE cuando no es null** (índice único parcial).
- **`is_active=false`:** no entra a cálculos nuevos; **el historial de períodos cerrados se conserva** (no se borra).
- **Carga inicial:** lista maestra única (nombre app, tarifa, fijo, `participa_servicio`, `biotime_emp_code`, `fecha_ingreso`). **Validar duplicados de código BioTime antes de persistir.**

### A4 — Liquidación completa o parcial (amplía R14)
- Puede ser **completa o parcial:** aguinaldo sí/no, vacaciones sí/no, montos con **override manual**.
- Toda liquidación guarda: **quién calculó, la fórmula de referencia usada, si hubo override y el monto final.**
- **No se "paga" desde un draft:** requiere confirmación explícita (`estado: 'draft' → 'confirmada'`).

### A5 — Ancla de aceptación de Fase 2 (fixture real)
Fixture = **`Q1_Ago`** (última quincena real completa del Excel; tiene matriz diaria e importes cargados).

- **Invariante del pool:** `Σ aporte_10%(todos) = impuesto total de la quincena`. En el Excel: impuesto Q1_Ago = **₡1.060.891**, Σ repartido = ₡1.060.890,79 (cuadra al redondeo). Total horas participantes = **1027,8**.
- **Casos obligatorios del reparto 10%** (independientes de la tarifa — se validan ya):

  | Empleado | Aporte 10% esperado | Nota |
  |---|---|---|
  | Seles | ₡111.441 | participa=Y |
  | María Sushi | ₡99.505 | participa=Y |
  | Lester | ₡91.630 | participa=Y |
  | **Karen** | **₡0** | participa=**N** (trabajó 120 h y NO recibe) — negativo |
  | **Judith Pila** | **₡0** | participa=**N** — negativo |

  **Criterio:** con los mismos inputs (horas por empleado/día + pool del POS), el aporte 10% por empleado = Excel **± ₡1** (colón entero).
- **Pago por hora:** depende de la **tarifa vigente en esa quincena**. Ismael confirma las tarifas as-of `Q1_Ago` (o si igualan las actuales) para validar esa columna; el reparto del 10% no depende de tarifas y se valida de una.

### A6 — Redondeo
- Todo monto de **pago final** (salario, aporte 10% por empleado, liquidación) en **colón entero**, **half-up** (redondeo comercial: 0,5 sube). Se fija half-up.
- Los **intermedios** del 10% (aporte por día) pueden llevar decimales; **solo el total por empleado/período se redondea** al final (evita acumular error).

### A7 — Bruto provisional
- **v1 = bruto** (sin CCSS/renta), **explícito como provisional** hasta confirmación del contador.
- **No bloquea Fase 0–2.** Deducciones = fase posterior (capa aparte, no cambia el núcleo).

---

## 10. Reglas de proceso (efectividad)

- **Una fase = un prompt = criterios de aceptación medibles = validación física de Ismael** antes de pasar a la siguiente.
- **No reabrir R1–R14 en prompts de construcción.** Si algo cambia → **enmienda corta al SPEC + nueva firma**, no se improvisa en el prompt.
- **Fases con migración:** CC entrega **primero el SQL/diff del esquema** (para revisión/firma); la **UI después**.
- **Temas "consultar contador" no bloquean fases anteriores.** Marcar siempre *bloquea Fase N / no bloquea Fase M*.
- **Migraciones:** verificar número libre en staging (**055+**) antes de escribir; no chocar con otras ramas (`metas_personales`, etc.). Staging por `db push`; prod aparte.
- **Cada entrega de CC** cierra con: rama, commit, diff, build/tests/lint, hashes de sagrados y confirmación de que `main` no se movió.
