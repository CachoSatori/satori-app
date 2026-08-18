# ANÁLISIS — Planilla de salarios + BioTime 8 → Módulo de nómina en Satori App

**Fecha:** 2026-08-17 · **Autor:** Claude (asesor) · **Estado:** Diagnóstico + decisiones firmadas + plan de fases. NADA construido. El SPEC se congela con el OK de Ismael.
**Insumo:** `informacion sobre planilla de pago de salarios y 10 empleados.xlsx` (40 hojas, planilla anual 2026).

> **Decisiones de Ismael (2026-08-17) — firmadas.** Ver §7. Resumen: (1) 10% servicio y propina son **flujos distintos**; (2) sección **nueva "Salarios"**; (3) pool 10% **automático del POS**; (4) BioTime **por PostgreSQL directo** (no hay API, no se paga); (5) **es prioridad**, ejecución limpia y por fases. Consolidado final por empleado = **horas + 10% + propina**. Hay que **cargar a TODOS los empleados** del restaurante.

---

## 1. Qué hace hoy la planilla (modelo real, verificado contra las fórmulas)

La planilla es un libro Excel anual con esta estructura:

- **INSTRUCCIONES** — explica la lógica (celdas amarillas = digitar, azules = automático, verdes = totales).
- **EMPLEADOS** — maestro de tarifas: `# · Nombre · Tarifa/Hora (₡) · Salario Fijo (₡) · Participa en 10% (Y/N)`. Hoy hay **37 empleados** (no 10). Casi todos son por hora; Rosaura es la única con salario fijo (₡450.000) y sin tarifa/hora.
- **Por cada mes:** `Q1_Mes`, `Q2_Mes` (las dos quincenas) y `RESUMEN_MES_Mes`.
- **RESUMEN_ANUAL** — consolida los 12 meses.
- **COMPROBANTES** — genera el recibo por empleado con `INDIRECT/MATCH` (elegís quincena + empleado).

### 1.1 Distribución del 10% de servicio — **es diaria y por horas**

La regla (de INSTRUCCIONES y confirmada en las fórmulas de `Q1_*`):

> Cada día, el impuesto de servicio de ese día se reparte **solo entre quienes trabajaron ese día** y **solo entre los que participan** (`EMPLEADOS.Participa = Y`), **en proporción a sus horas de ese día.**

Ejemplo del propio archivo: el 02/03 el impuesto fue ₡100.000, Seles trabajó 6 h y Nacho 4 h → Seles ₡60.000, Nacho ₡40.000. Deivin, que no trabajó, ₡0.

Fórmula por empleado (columna "10% ganado" de cada quincena):

```
aporte_10%(empleado) = Σ_día [ impuesto_día × (horas_empleado_día / horas_totales_participantes_día) ]
```

Con dos matices clave:
- El **denominador** (columna "Hrs Total" del día) suma **solo las horas de los que participan** (`Participa = Y`). Los `N` no entran ni al numerador ni al denominador.
- Si nadie trabajó / no hubo impuesto ese día, el término es 0 (protegido con `IF(hrs=0,0,...)`).

### 1.2 Cálculo del salario por quincena (Sección B de cada `Q*`)

```
pago_horas   = horas_normales × tarifa_hora           (las horas salen del total de la matriz diaria)
pago_feriado = horas_feriado  × tarifa_hora × 2        (feriado pagado doble — etiqueta "×2")
aporte_10%   = (fórmula de arriba)
salario_fijo = solo para quien lo tenga (Rosaura)
bono_extra   = manual
──────────────────────────────────────────────
TOTAL quincena = pago_horas + pago_feriado + aporte_10% + salario_fijo + bono
```

`RESUMEN_MES` = INDEX/MATCH por nombre sobre Q1+Q2. `RESUMEN_ANUAL` = suma de los 12 `RESUMEN_MES`. `COMPROBANTES` = recibo individual por `INDIRECT` a la hoja de la quincena.

### 1.3 De dónde salen las horas hoy

Se **teclean a mano** en la matriz diaria (una celda por empleado por día), a partir del reporte que bajan de **BioTime 8** (el lector de huella). Es decir: el dato ya existe digital en BioTime y se re-digita a mano en Excel.

---

## 2. Fragilidades del esquema actual (por qué un sistema baja el riesgo)

Todas verificadas en el archivo, no son hipótesis:

1. **Doble digitación masiva.** La matriz es 16 días × 20 empleados ≈ **320 celdas por quincena**, × 24 quincenas = miles de celdas/año, re-tecleando lo que BioTime ya tiene. Es la mayor superficie de error del proceso.
2. **Todo casado por NOMBRE.** Los resúmenes y comprobantes usan `MATCH(nombre)`. Hay nombres ambiguos: dos "Nacho" (Nacho / Nacho Manager), dos "Joaquin" (Joaquin / Joaquina Caja), "María Sushi" vs "María Cocina". `MATCH` devuelve **la primera coincidencia** → riesgo real de pagarle al empleado equivocado o duplicar.
3. **Encabezados desincronizados del maestro.** En la matriz, la columna rotulada "Karenli" en realidad apunta por fórmula a `EMPLEADOS!F24 = Jaime`. Las columnas están clavadas a filas fijas (5–24); si insertás o reordenás un empleado, todo se corre **en silencio**.
4. **Cobertura inconsistente entre capas.** Matriz Sección A = 20 empleados · Sección B ≈ 24 · RESUMEN_MES = 32 · RESUMEN_ANUAL = 34 · EMPLEADOS = 37. El empleado #37 (Fran Manager) **no fluye**. Además hay filas metidas a mano (Hector, Abel, **Moises** — que ni existe en EMPLEADOS).
5. **Sección B con valores pegados (no fórmula) y tarifa vieja.** Los montos de la quincena de muestra se calcularon con tarifa 4.000 para Seles cuando EMPLEADOS hoy dice 4.100. Los pagos están **desconectados** del maestro de tarifas.
6. **Errores aritméticos que nadie detecta.** Ej.: Abel muestra Total ₡18.360 con Pago Horas ₡73.500 (el total debería ser ≥ al pago de horas). Digitación manual sin validación.
7. **El 10% también se teclea a mano por día** — pero ese número la app **ya lo tiene** (POS / capa fiscal). Doble fuente = doble error.
8. **No hay ingresos en el libro** → hoy es imposible ver "% de salarios sobre ventas" sin cruzar a mano con otra fuente.

Conclusión: el modelo de negocio (10% diario por horas + pago por hora) es **claro y correcto**; el problema es el **vehículo** (Excel manual, casado por nombre, desincronizado). Es exactamente el tipo de proceso que un sistema con la fuente única (BioTime → app → POS) vuelve confiable.

---

## 3. Traer las horas de BioTime 8 sin "bajar reportes"

**Dato técnico confirmado:** BioTime 8.0/8.5 (ZKTeco) corre sobre **PostgreSQL por defecto** (el instalador ofrece "Default Database → PostgreSQL"; opcionalmente MS SQL Server / MySQL / Oracle). Y BioTime 8.5 **tiene API REST oficial** (existe el "API User Manual BioTime 8.5", ZKTeco, jul-2021).

### El obstáculo real
La PC del reloj (el "hardware") y su PostgreSQL viven en la **red local** del local. Satori App es **nube** (Supabase). "Verlo online desde el SQL" en vivo solo funciona **dentro de esa LAN**. Para verlo desde el celular, otra sede o la nube, hay que **replicar** los ponches a Supabase igual. Así que la pregunta no es "SQL vs reporte", es **cómo cruzar de la LAN a la nube de forma segura**.

### Opción recomendada — Puente que EMPUJA (local → nube)
Un servicio chico que corre en (o junto a) la PC del reloj y cada 2–5 min:
- Lee los ponches nuevos **por la API REST de BioTime** (patrón estándar: `POST /api-token-auth/` para sacar token → `GET /iclock/api/transactions/?start_time=…` con `emp_code`, `punch_time`, `punch_state`, terminal). *(Los paths exactos hay que confirmarlos contra el manual de API de tu versión.)*
- **Alternativa si la API no está licenciada:** lee directo la **tabla de transacciones del PostgreSQL** de BioTime con un SELECT incremental (por id o fecha).
- Inserta lo nuevo en una tabla `time_punches` de Supabase (vía Edge Function con service-role, idempotente por id de ponche).

Ventajas: **no abrís ningún puerto** hacia internet, funciona detrás de NAT / IP dinámica, la app lee Supabase como todo lo demás, queda casi en vivo, y es resiliente (si la PC se apaga, BioTime guarda los ponches y sincronizan al reconectar).
Costo: algo tiene que correr **siempre** en esa PC (servicio de Windows / tarea programada / script Node o Python).

### Opción NO recomendada — exponer BioTime a la nube
Port-forward o abrir la API/DB de BioTime hacia afuera. Es inseguro (base **biométrica** expuesta), frágil (IP dinámica) y, encima, las Edge Functions de Supabase no alcanzan fácil una red privada. Solo con túnel seguro (Tailscale / Cloudflare Tunnel) y aun así complica. Descartar salvo caso muy puntual.

### El "pegamento": mapeo de identidades
Cada empleado en BioTime tiene un código (`emp_code`). Se mapea **una sola vez** contra `employees.id` de Satori (nueva columna `biotime_emp_code`). Los ponches crudos (entrada/salida) se "pancean" a **horas por empleado por día**. Se guarda crudo **y** derivado (auditable).

---

## 4. Qué se agrega en la app

Verificado contra el repo (el repo manda): hoy `employees` tiene `id, full_name, role, profile_id, is_active, pos_name`. **No** tiene tarifas ni horas. Las horas por turno existen hoy solo en `tip_entries.hours_worked` (para propinas), digitadas a mano.

1. **Ficha del empleado (extender `employees`):** `hourly_rate_crc`, `fixed_salary_crc`, `participa_servicio` (bool), `biotime_emp_code`. Acá vive "el valor de la hora de cada empleado" que pediste.
2. **Ponches + horas:** `time_punches` (crudo del reloj) + cálculo de horas por empleado/día (emparejar in/out).
3. **Pool diario del 10%:** acá está la **sinergia grande** — la app ya tiene ventas (POS) y la capa fiscal (`posFiscal`, archivo sagrado) ya calcula el 10% de servicio. El pool diario puede salir **automático** de las ventas del día, en vez de teclearlo. Debe **consumir** el 10% que la capa fiscal ya produce, no recalcularlo.
4. **Reporte de salarios (semanal o quincenal):** `horas×tarifa + feriado×2 + aporte_10% (mismo reparto diario por horas) + salario_fijo + bono` = total por empleado por período, con comprobante por empleado (ya existe patrón de comprobante PNG/WhatsApp del módulo de proveedores → se reutiliza).
5. **% de salarios sobre ingresos:** como la app tiene **ambos lados** (salarios y ventas), sale solo: costo laboral / ventas por semana y por mes, y encaja con el P&L que ya existe (`finance.ts`, cuenta `a6200` Salarios).

Resultado: la planilla completa (37 empleados, matriz diaria, resúmenes, comprobantes, % sobre ventas) se reemplaza por un flujo con **una sola fuente de verdad** por dato: horas ← BioTime, tarifas ← ficha, 10% ← POS/fiscal, ventas ← POS.

---

## 5. Encaje con las reglas del proyecto (importante)

- **Toca DINERO (salarios) y ESQUEMA (tablas nuevas) → requiere tu firma explícita.** No se aplica nada sin ella.
- Es una **iniciativa nueva** (escala F4.x), **no** estabilización. Por la prioridad del proyecto (dejar sólido primero lo de producción: caja, proveedores, propinas), esto entra **como diseño ahora** y **construcción después** de cerrar lo de proveedores — salvo que decidas subir la prioridad.
- El 10% se **consume** de la capa fiscal (sagrada), no se recalcula.
- Método: diseño primero (SPEC), construcción en fases verificables con firma, staging antes que prod. El mismo que venimos usando.

---

## 6. Decisiones abiertas (para Ismael)

1. **10% de servicio ↔ módulo de propinas actual.** La app ya reparte **propinas** por puntos+horas por turno (módulo Tips). ¿El **10% de servicio** de la planilla es **otro flujo** (obligatorio, distinto de esas propinas), o es el mismo dinero con otro nombre? Esto define si construimos módulo nuevo o extendemos el de propinas. **Es el punto #1 a aclarar** (riesgo de doble conteo).
2. **Origen del pool 10% diario:** ¿automático desde ventas/POS (recomendado) o entrada manual como hoy, al menos en v1?
3. **BioTime:** ¿tenés la **API REST** activada/licenciada, o vamos por **lectura directa del PostgreSQL**? ¿La PC del reloj está siempre encendida y en red?
4. **Prioridad:** ¿lo dejo como **SPEC** listo para construir apenas cerremos proveedores, o va al backlog?

Mi recomendación: (1) confirmar que 10%≠propinas, (2) pool automático desde POS, (3) empezar por el puente BioTime→Supabase por API con fallback a Postgres, (4) SPEC ahora, construcción cuando cierre proveedores.

---

## 7. Decisiones firmadas por Ismael (2026-08-17)

1. **10% de servicio ≠ propina — son dos flujos distintos.**
   - **10% de servicio:** impuesto obligatorio que se cobra a cada mesa. Se reparte **diario, por horas**, y —como en el Excel— **se debe poder elegir quién recibe y quién no** (flag `participa_servicio` por empleado). Confirmado en el repo: `posFiscal.ts` ya calcula `servicio = 10% del neto` (salón/barra sí, delivery no).
   - **Propina:** tip **voluntario** del cliente. Se distribuye **de otra forma** (por puntos/rol, módulo Tips actual) e individual. Confirmado en el repo: `pos_payments.tip_crc` guarda la propina electrónica **aparte** del total (que ya incluye el 10%).
2. **Sección nueva "Salarios"** (no se mezcla con Tips). Ahí vive el 10% + el pago por hora.
3. **Cargar a TODOS los empleados.** Hoy en la app solo están salón/barra/encargado (porque en Tips la cocina entra como **pozo** que ellos se reparten). Salarios necesita a **todos** individualmente, con su tarifa/hora.
4. **Consolidado final por empleado.** Debe existir un lugar donde ver, por empleado y período, el **total que recibió: horas + 10% + propina**.
5. **Pool del 10% = automático desde el POS.**
6. **BioTime = PostgreSQL directo.** No tiene API hoy; si hay que pagarla, mejor Postgres. (Ver §8: qué es y cómo.)
7. **Prioridad ALTA, ejecución muy limpia y por fases.**
8. **Nota a futuro (no v1):** migrar la **propina** para que también use las horas de BioTime. Hoy NO, porque BioTime es exacto (minutos) y para propina se **redondean** las horas → descuadrarían. Salarios usa BioTime exacto; Tips sigue con su método actual hasta decidir la unificación.

---

## 8. Qué es "leer el PostgreSQL de BioTime" y cómo se hace

**Qué es.** BioTime no guarda las marcas de huella en un Excel: las guarda en una base de datos **PostgreSQL** que corre en esa misma PC. Cada vez que alguien marca, se inserta una fila (empleado, fecha-hora, entrada/salida, terminal) en una tabla (en BioTime suele llamarse `iclock_transaction`). "Bajar el reporte" es pedirle a BioTime que exporte esas filas a Excel/PDF. **Leer el Postgres directo** es saltarse ese paso: nos conectamos a la base y leemos las filas nosotros con una consulta (`SELECT`), en crudo, exacto y automatizable.

**Por qué conviene.** El dato sale exacto (con minutos), sin re-teclear, y un programa lo puede leer solo cada pocos minutos. Cero costo de licencia (la API se paga; leer el Postgres no).

**Cómo se arma (el "puente"):**
1. **Credenciales.** Al instalarse, BioTime creó la base con un usuario, una clave y un puerto (Postgres usa 5432 por defecto). Hay que averiguarlos (config de BioTime o quien lo instaló).
2. **Ubicar la tabla.** Confirmar el nombre real de la tabla de marcas y sus columnas (empleado, hora, tipo de marca). Se ve conectándose una vez con una herramienta tipo DBeaver o pgAdmin.
3. **Usuario de SOLO LECTURA.** Creamos en el Postgres de BioTime un usuario que solo pueda `SELECT`. Así el puente **jamás** puede dañar ni borrar nada. Regla de oro: a BioTime **solo se lo lee, nunca se le escribe**.
4. **El puente.** Un programa chico (Node o Python) que corre **en esa PC** (o en otra de la misma red): se conecta al Postgres local, lee las marcas **nuevas** desde la última que ya subió, y las manda a Supabase (a una tabla nueva `time_punches`). Corre solo cada 2–5 min (servicio de Windows o tarea programada).
5. **En Supabase.** Las marcas quedan en `time_punches`; de ahí la app arma las horas por empleado/día y todo lo demás.

**Cuidados:** solo lectura · **nada de abrir la base a internet** (el puente SALE hacia Supabase, no entra nadie de afuera) · idempotente (correrlo dos veces no duplica) · si la PC se apaga, BioTime guarda igual y sincroniza al reconectar.

**Riesgo a tener presente:** si en una actualización mayor ZKTeco cambia el nombre de la tabla/columnas, habría que ajustar el puente (riesgo bajo, mantenimiento puntual). Es el precio de no usar la API oficial.

**Para arrancar esta parte necesito:** (a) credenciales del Postgres de BioTime (o acceso a esa PC para sacarlas), (b) confirmar que la PC está **siempre encendida y en red**. Con eso CC arma el puente y lo probamos contra un día real (horas de la app vs reporte de BioTime = deben cuadrar).

---

## 9. Plan de construcción por fases (limpio y verificable)

Cada fase es chica, aislada y se valida en físico antes de seguir. Toca dinero/esquema → cada fase lleva tu firma.

- **Fase 0 — Maestro de empleados completo.** Extender `employees` con `hourly_rate_crc`, `fixed_salary_crc`, `participa_servicio` (bool) y `biotime_emp_code`; cargar a **todos** los empleados con su tarifa. *Sin esto no calcula nada.*
- **Fase 1 — Puente BioTime → Supabase (horas).** Postgres directo → `time_punches` → horas por empleado/día. **Verificación:** horas de la app vs reporte BioTime de un día = cuadran.
- **Fase 2 — Sección "Salarios" (núcleo).** 10% automático del POS repartido **diario por horas** (respetando `participa` Y/N) + pago por hora (BioTime exacto) + feriado ×2 + salario fijo + bono. Reporte semanal/quincenal + comprobante por empleado (se reutiliza el patrón PNG/WhatsApp de proveedores). **Verificación:** contra una quincena real del Excel.
- **Fase 3 — Consolidado por empleado.** Un lugar con el total por empleado y período: **horas + 10% + propina** (la columna propina se **lee** del módulo Tips; fuente única). Es "el cálculo final para el restaurante".
- **Fase 4 — % de salarios sobre ingresos.** Costo laboral / ventas por semana y mes; encaja con el P&L (`finance.ts`, cuenta `a6200` Salarios).
- **Futuro (post-v1) — Propina por horas de BioTime.** Unificar cuando lo decidas (ver §7.8).

---

## 10. Definiciones para cerrar antes de congelar el SPEC

Pocas, con mi default propuesto:

1. **Feriados (×2).** ¿Cómo se marca que un día es feriado para el doble pago? *Default:* marca manual de días feriado en Salarios (calendario CR precargado como ayuda). Y ¿el ×2 aplica a las horas trabajadas **ese día**? *Default:* sí, horas del día feriado ×2.
2. **Cobertura del POS.** ¿Hoy el **100%** de las ventas pasa por el POS propio, o todavía hay ventas por fuera? El pool automático del 10% es exacto para lo que está en el POS; si hay ventas fuera, definimos un complemento. *Default:* asumir POS = fuente del 10%, con aviso si un día no tiene ventas POS.
3. **Consolidado de cocina (propina).** La propina de cocina hoy es **pozo**. Para el "total por empleado", ¿mostramos el pozo como línea aparte o lo repartimos? *Default v1:* propina individual para quien la recibe individual; el pozo de cocina como línea separada hasta definir su reparto interno.
4. **Período de pago.** ¿Quincenal (1–15 / 16–fin), semanal, o ambos? *Default:* quincenal como el Excel, con opción de ver semanal.
