# SPEC-UI — Módulo Empleados (referencia de diseño)

- **Estado:** referencia viva **v3 (congelada · pago corregido)** · **piloto ejecutado y mergeado a staging**. Acompaña al **HTML navegable** (artifact `claude.ai/code/artifact/8418b5a0…` + archivo `docs/prototipos/nomina-satori-v3.html`). **No es construcción** — es la meta de estructura y diseño. Fecha: 2026-08-28.
- **Regla:** cuando algo pida decisión, se plantea de a una (a/b/c + recomendación).

## Dirección visual (a evaluar para toda la app)
Paleta: teal profundo (`#0C6E6B`) + dorado (`#A9791F`) + **plum** (`#6C4A86`) reservado al 10% de servicio; neutros con bias teal; semantic ok/warn/crit aparte del acento. Tipografía: **Fraunces** (display/cifras), **Hanken Grotesk** (UI), **JetBrains Mono** (₡ tabular). Tono: premium, operativo, claro/oscuro. **Piloto ejecutado:** rama `claude/ui-salarios-nomina-v3-ghb3lw` (desde `origin/staging`), solo piel + evolución de la grilla de pago, antes de decidir extender la dirección a Caja y al resto de la app.

## Tres conceptos de plata — NUNCA mezclar nombres ni cuentas
1. **IVA 13% = impuesto.** Va en la factura / `posFiscal`. **No se reparte** al equipo. **No aparece** en la grilla de nómina. La columna del 10% **nunca** se llama "IVA" ni "impuesto de ventas".
2. **10% de servicio = cargo de salón/barra** (delivery no). **Sí se reparte** al equipo y **sí va al banco** con el salario.
3. **Propina (pozo) = módulo Propinas** (ya construido). **No es el 10%.** Por ahora se paga **solo en efectivo**; no va al banco.

## Cómo se PAGA (firmado)
- **Horas + 10% de servicio → transferencia bancaria**, en el mismo pago de quincena.
- **Propina → por ahora solo efectivo.**
- **"A pagar"** (archivo del banco) = **Total horas + 10% de servicio.**
- **Propinas NO van al banco.**
- **Ingreso total** (informativo) = horas + 10% de servicio + propinas.
- **Costo laboral** (bloque aparte) = salarios + 10% de servicio + pozo + CCSS + liquidaciones.
- **DEROGADO:** la frase "el 10% nunca va al banco" queda **sin efecto**. El 10% de servicio **sí** va al banco con el salario; solo las **propinas** quedan fuera del banco.

## Cómo se REPARTE el 10% de servicio (firmado)
Reparto **por DÍA**, no un prorrateo único de toda la quincena. Por cada día del período:

```
pool  = 10% de servicio de ESE día   (no IVA, no pozo)
denom = Σ horas de ese día de quienes participan (participa = true)
cuota_persona = (pool / denom) × horas_persona_de_ese_día
```

La columna **"10% serv."** de la quincena = **suma de las cuotas diarias**. **Guarda:** si `denom = 0` en un día, la cuota de ese día es ₡0 — nunca dividir por cero.

**Fuente del servicio (hoy):** el `pool` del día sale de **`ventas_dias`** (el XLS de ventas diario, subido y bien contabilizado), donde la columna **Servicio** ya viene **sin IVA y sin delivery** (verificado en `xlsParser.ts`: *"Salon = has service charge, delivery = no"*). **No** se lee de `posFiscal`. El día que el POS quede fino, se cambia la fuente sin tocar la fórmula.

**Alcance por local (firmado):** el reparto es **por local** por diseño. **Hoy la app opera solo en Santa Teresa**, así que el pozo diario **es** el de Santa Teresa: global y por-local son el mismo número. El split real por local y la **selección de local** (ver estadísticas / pagar nómina por local) llegan con el **backend multi-local** (un usuario por local, todos los módulos) + POS — **fase futura**. El código ya deja el gancho: si algún día el pool se abre por local, el denominador se abre con él.

## Quién entra al reparto (firmado — no reabrir)
- En **alta/ficha** del empleado: **flag `participa` sí/no del 10% de servicio** (`employees.participa_servicio`, mig 055, `boolean default true`).
- `participa = false` → no entra al `denom` ni cobra servicio (ej.: cocina). En la grilla su columna va en "—".

## Pestañas
1. **Personal** — primer filtro **Local** (Santa Teresa / Nosara / Todos) — **meta multi-local; hoy ST-única y `employees` no guarda local, así que el filtro llega con Nosara.** Rol partido en **Departamento** (Salón / Cocina / Barra / otros) + **Puesto** (salonero, runner, calientes, sushi, bacha, limpieza…).
2. **Ficha** — Departamento + Puesto; **WhatsApp y correo obligatorios** (comprobantes); **flag `participa del 10% de servicio`**; **regla de horario, 3 tipos:** a) **único** · b) **cortado** (2 bloques el mismo día) · c) **flexible** (sin hora techo). El formulario **cambia según el tipo**. **Los impares de BioTime siempre avisan** — la regla propone cómo completar, no silencia la alerta.
3. **Tarifas** — versionada por fecha efectiva (sin cambios).
4. **Horas** — bandeja de revisión de fichajes del período. **Selector de período** (ver / crear / editar / eliminar-anular). Un impar se **corrige**, se **aplica la regla** o se **deja pendiente**. **No se cierra el período con impares abiertos.**
5. **Propinas** — solo lectura; el reparto lo hace el módulo Propinas. **No es el 10% de servicio.**
6. **Período de pago** — **selector de período** (ver / crear / editar / anular, con **motivo** si ya hubo movimiento). **Grilla, en este orden:** `Nombre | Horas | Total horas (₡) | 10% serv. | A pagar | Propinas | Ingreso total`. **A pagar = Total horas + 10% de servicio** (lo que sale al banco). **Ingreso total** = Total horas + 10% de servicio + Propinas (informativo). **Costo laboral del período** en **bloque aparte**: `salarios + 10% servicio + pozo + CCSS/cargas + liquidaciones = costo real`.
7. **Liquidaciones** *(nuevo)* — flujo al despido/salida: días/horas, preaviso, cesantía (según motivo), aguinaldo proporcional, vacaciones proporcionales. **Entra al costo laboral y al historial.** Cada persona liquidada tiene **un solo estado** (coherente Liquidaciones ↔ Historial).
8. **Historial** — pagos, comprobantes, cambios de tarifa, correcciones de horas y **liquidaciones** (quién / cuándo / qué).

## Estado de decisiones

### Firmado (Ismael)
Los **tres conceptos de plata** (IVA ≠ 10% servicio ≠ propina); **reglas de pago** (horas + 10% al banco; propina en efectivo; A pagar = horas + 10% servicio); **reparto del 10% por día** con la fórmula de arriba; **reparto por local** por diseño (hoy ST-única → pozo = ST); **fuente del 10% = `ventas_dias` (XLS)** hoy, POS cuando quede fino; **flag `participa`** en la ficha; estructura de pestañas y columnas; costo laboral aparte; liquidación como flujo propio; dirección visual como piloto en staging.

### Ejecutado en el piloto (rama `claude/ui-salarios-nomina-v3-ghb3lw`) → mergeado a staging
- 10% de servicio en `src/shared/api/salarios.ts` (`repartoServicioDia`, `servicioDelPeriodo`, `getServicioPorDia` — **SELECT-only** sobre `ventas_dias`). **No** en `tipCalculations`.
- Grilla v3 evolucionada (7 columnas); **A pagar = grilla = Excel del banco = registro**, amarrado por test (redondeo por partes).
- `participa_servicio` ya existía (mig 055, default `true`); desglose persistido en `salary_lines.aporte_servicio` (mig 056). **0 migraciones nuevas.**
- **Sagrados byte-idénticos** (`posFiscal`, `tipCalculations`, `cashUtils`); gate `build` + `test` verde; sin `any` nuevo.
- Reparto **global = Santa Teresa** (correcto hoy, ST-única). Por-local real: fase multi-local.
- **PARTE A:** `docs/prototipos/nomina-satori-v3.html` **commiteado a staging** (`6228445`).
- Estado en staging: `059eedb` (piloto) + `6228445` (doc). `main` = `3e54aa4` intacto.

### Pendiente de dato (no bloquea)
- **Base de CCSS / cargas sociales:** el ≈26% del costo laboral es **placeholder** y **no está en el camino del pago al banco** (solo en el bloque de costo laboral). Se ajusta al % real (patrono + obrero) antes de confiar en el costo laboral.

### Pendiente (fase futura, no ahora)
- **Multi-local (Nosara):** backend para manejar los dos locales juntos, usuario por local, y **selección de local** para estadísticas y nómina. Recién ahí el reparto del 10% se parte por local de verdad y el filtro Local de Personal cobra sentido.
- **Pulido de maqueta:** (2) Ana (Nosara) también en Período de pago y Propinas; (7) selector de período con crear/editar/anular "de mentira".

### Pendiente de SPEC propio
- Reglas CR de **liquidación** (cesantía / preaviso según renuncia vs despido con/sin causa; aguinaldo; vacaciones proporcionales) — su propio SPEC firmado.

## Reglas vigentes
No construir para **prod** hasta SPEC + datos firmados. `posFiscal` (10%), `tipCalculations` (pozo) y `cashUtils` son **sagrados**: no se reescriben. El cálculo del 10% de servicio es **lógica nueva de salarios** — no toca `tipCalculations` (esa es la propina), para no re-mezclar en código lo que separamos en concepto.

**Gobernanza staging vs prod:** staging existe para **avanzar** — se construye y se corrige ahí sin ritual de firma por cada toque de plata. Se **frena en staging solo ante un cambio grande** (migración pesada, reescritura de caja/cascada/`posFiscal`, o algo irreversible). **Prod (main)** sigue con ritual + firma + validación física de Ismael.
