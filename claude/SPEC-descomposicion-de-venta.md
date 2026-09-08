# SPEC — Descomposición de venta (por qué bajó / subió) · BORRADOR

> ⛔ **DISEÑO — NO INICIAR.** Después de P2. Solo lectura sobre `pos_ndf_*`. No toca IVA,
> `total_crc`, sagrados, caja, propinas, realtime, prod ni main. Autor: Ismael. Revisión técnica: Claude.
> La v1 verbatim + la revisión larga quedan en el historial (`79b0aef`, `feat/analitica`).

## 🔧 Revisión técnica — verificada en código 2026-09-08 (cerrar antes de firmar)

Tres correcciones de fondo (cambian números, no redacción). Verificadas contra el repo:

- **🔴 Jornada = LOTE, no −7h.** `jornada.ts:251` → `jornada: fechaCR(apertura)` (fecha CR de la
  apertura del lote de cierre, vía `agruparEnLotes`). NO hay `−7 hours`. El −7h es la definición
  vieja, viva solo en `posNdf.ts` (`businessDateDe`). El helper DEBE usar `agruparEnLotes` (como
  `getDiasMapDesdePos`/`saloneroLentesDatos`) o es el tercer agregador que el SPEC prohíbe. Los
  ancla tickets/ticket/neta casi no se mueven (turno por `cajero_login`, trimestre entero), pero el
  **conteo de jornadas** (KPI 1) se saca por lote.
- **🔴 Exclusión = lista BLANCA.** La app usa `FAMILIAS_VALOR_SERVIDO = [2,3,4,5,13,16,29]`
  (`mapTicket.ts:153`), no la lista negra `{6,17,19,28}`. El mix debe correr sobre esa misma
  whitelist o rompe el invariante testeado "mix = neto del día".
- **🟠 Familia 29 SIN RESOLVER.** En el código 29 = **BENTOS/almuerzo** (`FAMILIA_BENTOS=29`,
  `CATEGORIA_FAMILIA[29]='Bentos'`, test "29 bentos ENTRA" al valor servido). El CSV de
  `FAC_Clasificaciones` dijo 29=greenseason. El hallazgo del SPEC dice GS = SKUs 1049–1054
  (productos, no familia). **Pendiente:** confirmar en el CSV `NombreClasificacion` de 29 y bajo qué
  familia caen los SKUs 1049–1054. Hasta entonces, el KPI `%promo` NO se puede construir. Además:
  familia **25 no está en el valor servido**, así que `promo={25,29}` no cierra.

Menores (anotados, no bloquean): falta columna `jornadas` por año en el ancla para testear el KPI 1;
hueco en el árbol de diagnóstico (tickets/jornada −20% con ticket −5% no dispara ninguna regla → falta
regla de fondo); bucket "otro" en el SPEC = `'dia'`/"Día" en el código y Parte B; el helper debería
exponer `descuadreCrc` (líneas vs header), como la lente A de Parte B, en vez de elegir base en silencio.

**Prerrequisito técnico:** `bebc9de` (paginación de líneas) está en `feat/analitica` e
`integracion/analitica-staging` pero NO en `staging` (`db690f1`). Construir sobre la integración; sobre
staging el mix vuelve a leer líneas truncadas.

---

## Pregunta que responde

"Bajó la neta" no es un diagnóstico. El módulo muestra de qué palanca salió el movimiento, en una
frase + 6 números, por turno y por recorte comparable.

## Identidad (única)

```
neta = jornadas × tickets_por_jornada × ticket_promedio
ticket_promedio     = neta / tickets
unidades_por_ticket = unidades / tickets     (sin 677 ni 678)
```

- `jornadas` = días con ≥1 ticket de ese turno (mismo denominador que el KPI 1), **contados por lote**.
- 2 palancas (tickets/jornada, ticket promedio). `unidades/ticket` descompone la palanca 2.
- Nunca una neta suelta como KPI titular.

## Recorte de tiempo

- **Jornada = fecha CR de la apertura del lote de cierre (`agruparEnLotes`, igual que `jornada.ts`).**
  NO −7h.
- Turno v1 = `cajero_login`: 111 mañana · 222 noche. Cualquier otro → bucket **`'dia'`** (no fila Bar).
  388 es caja, no turno.
- Comparación default = mismos meses del año anterior. Segunda = mismos N días. No "YTD vs año completo".

## Universo

- `pos_ndf_tickets.estado = 'C'`.
- Neta del ticket = `valor_servido_crc` (header). No re-sumar líneas para el total. El helper expone
  `descuadreCrc` (líneas vs header) para no tapar discrepancias.
- Unidades y mix = `pos_ndf_ticket_lines`, **familias `FAMILIAS_VALOR_SERVIDO = [2,3,4,5,13,16,29]`**
  (misma whitelist que la app), excluyendo `codigo_producto IN ('677','678')`.
- Local: piloto (`santa-teresa`) salvo filtro.

## Los 6 KPIs (una fila = turno × recorte)

1. **Tickets / jornada** = tickets ÷ jornadas del turno (contadas por lote). ¿Menos mesas?
2. **Ticket promedio** = Σ neta ÷ tickets (header `valor_servido_crc`). ¿Menos por mesa?
3. **Unidades / ticket** = Σ cantidad (whitelist, sin 677/678) ÷ tickets. ¿Menos platos?
4. **Mix** = % de neta de líneas por familia (base whitelist, NO el header). ¿A lo barato?
5. **% turno / día** = neta del turno ÷ neta del día (111+222+dia). ¿Un turno o el local?
6. **% promo** = ⚠️ **BLOQUEADO** hasta resolver qué es la familia 29 y cómo entra 25 (ver revisión).

Δ vs recorte comparable, absoluta y %. Semáforo solo en 1 y 2. 4–6 contexto. KPIs 4/6 sobre neta de
**líneas**, base distinta del header — rotularlo en la UI.

## Diagnóstico automático (una línea). Prioridad:

1. Tickets/jornada ≤ −15 % y ticket ≥ 0 % → **Menos mesas.** Quien vino gastó igual o más.
2. Tickets/jornada ≥ −5 % y ticket ≤ −15 % → Misma afluencia, ticket más chico.
3. Tickets y ticket ≤ −10 % → Menos mesas y menor gasto por mesa.
4. Neta ≤ −15 % y % promo < 5 % → La promo no explica (⚠️ depende del KPI 6, hoy bloqueado).
5. % turno noche cae y mañana no → Se cayó la noche, no el local.
6. **(FALTA — regla de fondo)** cualquier otro caso con neta ≤ −10 % → describir las dos palancas sin
   etiqueta ("Tickets X %, ticket Y %"), para que el bloque siempre tenga titular.

## Mix — catálogo (VALIDAR nombres contra `FAC_Clasificaciones`; 29 en disputa)

`CodigoTipoClasificacion` = `pos_ndf_ticket_lines.familia`. En el valor servido: 2,3,4,5,13,16,29.

| id | Código app | Grupo UI |
|----|-----------|----------|
| 3 | SUSHI ROLLS | Comida |
| 2 | TAPAS ASIATICAS | Comida |
| 16 | POKES BOWLS CEVICHES | Comida |
| 13 | KIDS MENU | Comida |
| 4 | POSTRES | Comida |
| 5 | BEBIDAS | Bebida |
| 29 | **Bentos (código) / ¿greenseason? (CSV)** — SIN RESOLVER | ¿Comida o Promo? |
| 25 | PROMOCIONES — **fuera del valor servido** | (no entra al mix de neto) |
| 6, 17, 19, 28 | PERSONAL / CORTESÍAS / PAX / DUEÑOS | Fuera |
| resto | Otros | Otros |

## Vista

Un bloque en analítica. Arriba: recorte + turno. Cuerpo compacto (frase de diagnóstico titular + 3
palancas + mix en una línea). Sin gráficos obligatorios en v1.

## Fuera de alcance v1

BioTime/horas/productividad (Parte B saloneros); delivery como lente; PAX nativo; predicción/clima;
escritura; migraciones.

## Guardrails

- Rama `feat/analitica` (build sobre la integración, no staging). Aditivo. Solo SELECT.
- No tocar `cashUtils`, `tipCalculations`, `computeTotals`, `posFiscal`, cierres, IVA, `total_crc`.
- Tests: identidad neta ≈ tickets × ticket (±₡1); exclusión 677/678; whitelist de familias; turno
  111/222; jornada por lote; recorte sep–nov 24/25 reproduce los ancla; diagnóstico dispara;
  **cross-check: neta/tickets/jornadas del helper = las del módulo migrado** para un turno/rango.

## Cifras ancla (noche, cajero 222, sep–nov · header `pos_ndf_tickets`, query 64)

| Año | Tickets | Ticket prom | Neta | Jornadas |
|-----|---------|-------------|------|----------|
| 2024 | 3.180 | ₡26.238 | ₡83.435.771 | **(falta — contar por lote)** |
| 2025 | 1.687 | ₡30.391 | ₡51.269.675 | **(falta — contar por lote)** |

Δ tickets −46,9 %. Δ ticket +15,8 %. Δ neta −38,6 %. Diagnóstico esperado: caso 1.
Tickets/ticket/neta salen del header y sobreviven al cambio de definición de jornada; el conteo de
jornadas hay que agregarlo (por lote) para poder testear el KPI 1.

## Hallazgo que el SPEC no reabre

Green Season (SKUs 1049–1054, alta 2025-09-12, baja 2026-04-25) no mueve el mediodía ni explica la
noche. Almuerzo sep–nov 2025 vs 2024 subió (+24 % neta/jornada). Nota, no feature. (Relacionado con la
disputa del 29: si 29 fuera greenseason y estuviera en el valor servido, chocaría con esto.)

## Firma

- Titular = frase de diagnóstico. La neta con Δ va dentro de la frase.
- **Bloqueos abiertos:** jornada por lote (no −7h) · exclusión por whitelist · resolver familia 29 y
  el KPI %promo · agregar jornadas al ancla · regla de diagnóstico de fondo. No iniciar hasta P2 +
  bebc9de en la rama de build.

---

# Delta de revisión sobre esta v2 — Claude, 2026-09-08

Los tres bloqueos de la v1 quedaron incorporados bien; no tengo nada que agregarles. Tres cosas
nuevas, una de ellas real:

## 🟠 El árbol de diagnóstico no tiene ninguna regla para cuando SUBIÓ

El módulo se llama "por qué bajó **/ subió**", y el titular del bloque es la frase de diagnóstico.
Pero las seis reglas son todas de caída: 1, 2 y 3 tienen umbrales `≤` sobre las palancas; la 4 pide
`neta ≤ −15 %`; la 5 es "cae la noche"; y la 6 —la de fondo, que se agregó justamente para que
siempre haya titular— arranca en `neta ≤ −10 %`.

Con eso, **un trimestre que creció se queda sin titular**, que es lo único que el SPEC declara como
titular. Y no es hipotético: el propio hallazgo del SPEC dice que el almuerzo sep–nov 2025 subió
+24 % neta/jornada — o sea el primer recorte que alguien va a mirar en el turno mañana no tendría
frase.

**Propuesta:** la regla 6 no debería tener piso, sino ser el `else` real del árbol —
`describir las dos palancas sin etiqueta` para **cualquier** caso no cubierto, suba o baje. Y, si se
quiere el espejo de la 1 para crecimiento, una regla `tickets/jornada ≥ +15 % y ticket ≥ 0 %` →
*"Más mesas, gastando igual o más"*.

## 🟡 `Σ cantidad` del KPI 3 tiene que redondear igual que `armarDia`

`pos_ndf_ticket_lines.cantidad` es `numeric`, y `armarDia` la consume como
`Math.round(n(l.cantidad))` por línea antes de acumular. Si el helper suma la cantidad cruda y
redondea al final, el cross-check de unidades contra el módulo migrado va a driftear por líneas con
decimales. Es una línea de código, pero conviene que esté escrita en el SPEC porque el test de
cross-check la va a encontrar tarde.

## 🟡 La exclusión `677/678` es redundante con la whitelist, y está bien que lo sea

677 y 678 son familia 19 (A PAX), que ya queda fuera de `FAMILIAS_VALOR_SERVIDO`. O sea el filtro
por código no saca nada que la whitelist no haya sacado. **No lo quiten igual:** `armarDia` también
lleva los dos filtros, y el de código es el que protege si algún día un 677 aparece cargado bajo
otra familia. Solo vale la pena que el SPEC diga que es defensa en profundidad y no una segunda
condición necesaria, para que nadie lo "simplifique" después.

## Sobre "los ancla casi no se mueven"

De acuerdo, con una precisión para cuando se recalculen: las dos definiciones difieren solo en los
lotes del **borde** del recorte (el que abre el 31-ago y cruza a septiembre, y el que abre el 30-nov
y cruza a diciembre). Son a lo sumo dos lotes por año por turno. Cuando se recalcule el ancla con
lotes, conviene anotar el delta observado aunque sea 0 — si sale más grande que un par de lotes, es
señal de que algo más cambió y no la definición de jornada.
