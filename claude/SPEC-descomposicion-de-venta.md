# SPEC — Descomposición de venta (por qué bajó / subió) · BORRADOR

> ⛔ **DISEÑO — NO INICIAR.** Después de P2. Solo lectura sobre `pos_ndf_*`. No toca IVA,
> `total_crc`, sagrados, caja, propinas, realtime, prod ni main. Autor: Ismael. Revisión técnica: Claude.
> Copia verbatim (v1) + revisión larga recuperables en `79b0aef`. v2 en `42a4962` (feat/analitica).

## 🔧 Revisión técnica — FIRMADA 2026-09-08 (verificada en código + resuelta por Ismael)

- **✅ Jornada = LOTE, no −7h.** `jornada.ts:251` → `fechaCR(apertura)` del lote (`agruparEnLotes`).
  El helper reutiliza `agruparEnLotes` / `agruparPorJornadaTurno`. **Los ancla de la query 64 se
  corrieron con −7h → recalcular por lote antes del test.**
- **✅ Mix = lista BLANCA `FAMILIAS_VALOR_SERVIDO = [2,3,4,5,13,16,29]`** (`mapTicket.ts:153`), la misma
  que `armarDia`. Afuera: 6 personal, 12 gift, 17 cortesía, 19 pax, 20–27 merch/extras, 28 dueños, 25 cajón.
- **✅ Familia 29 = GREENSEASON** (Nube viva: CSV + SKUs 1049–1054 en tipo 29). Alias `FAMILIA_BENTOS=29`
  del código VIEJO. `% promo` = familia 29 y/o SKUs 1049–1054. La 25 no entra. *(Aparte: el app hoy
  mislabela 29 como "Bentos" — limpieza chica de constante, no toca plata.)*
- **✅ Diagnóstico cubre SUBA y BAJA** (ver árbol). El módulo es "bajó / subió": no puede quedarse sin
  titular cuando creció.
- **✅ KPI 3 redondea como `armarDia`:** `Math.round(n(cantidad))` **por línea** antes de acumular
  (`cantidad` es numeric). Sumar crudo y redondear al final hace driftear el cross-check de unidades.
- **✅ Exclusión `677/678` = defensa en profundidad,** redundante con la whitelist (son familia 19) a
  propósito. `armarDia` lleva los dos filtros; el de código protege si un 677 aparece cargado bajo otra
  familia. NO simplificar.
- **✅ Ancla:** columna `jornadas` (noches con ≥1 ticket 222) por año.
- **✅ Turnos:** ids de `jornada.ts` — `manana` (111) / `tarde` (222) / `dia` (resto).
- El helper expone `descuadreCrc` (líneas vs header), como la lente A de Parte B.

**Prerrequisito:** `bebc9de` (paginación de líneas) está en `feat/analitica` e `integracion/analitica-staging`
pero NO en `staging`. Construir sobre la integración.

---

## Pregunta que responde

"Bajó / subió la neta" no es diagnóstico. El módulo muestra de qué palanca salió el movimiento: una frase
+ 6 números, por turno y por recorte comparable.

## Identidad

```
neta = jornadas × tickets_por_jornada × ticket_promedio
ticket_promedio     = neta / tickets
unidades_por_ticket = unidades / tickets     (sin 677 ni 678)
```

`jornadas` = noches con ≥1 ticket del turno, contadas por lote. 2 palancas + `unidades/ticket` (descompone
la 2). Nunca neta suelta como titular.

## Recorte de tiempo

- Jornada = fecha CR de la apertura del lote (`agruparEnLotes`). NO −7h.
- Turno v1 = `cajero_login`: `manana` (111) · `tarde` (222) · `dia` (resto). 388 es caja, no turno.
- Comparación default = mismos meses año anterior. Segunda = mismos N días. No "YTD vs año completo".

## Universo

- `pos_ndf_tickets.estado = 'C'`. Neta del ticket = `valor_servido_crc` (header); no re-sumar líneas
  para el total; el helper expone `descuadreCrc`.
- Unidades y mix = `pos_ndf_ticket_lines`, familias `FAMILIAS_VALOR_SERVIDO = [2,3,4,5,13,16,29]`,
  excluyendo `codigo_producto IN ('677','678')` (defensa en profundidad). Unidades: `Math.round` por línea.
- Local: `santa-teresa` salvo filtro.

## Los 6 KPIs (una fila = turno × recorte)

1. **Tickets / jornada** = tickets ÷ jornadas del turno (por lote).
2. **Ticket promedio** = Σ neta ÷ tickets (header).
3. **Unidades / ticket** = Σ `round(cantidad)` (whitelist, sin 677/678) ÷ tickets.
4. **Mix** = % de neta de líneas por familia (base whitelist, no header).
5. **% turno / día** = neta del turno ÷ neta del día (manana+tarde+dia).
6. **% promo** = % de neta de líneas de familia 29 (GreenSeason) y/o SKUs 1049–1054. (La 25 no entra.)

Δ vs recorte comparable, absoluta y %. Semáforo solo en 1 y 2. 4–6 contexto. KPIs 4/6 sobre neta de
**líneas** — rotularlo en la UI.

## Diagnóstico (una línea, cubre suba y baja). Prioridad, primera que aplique:

1. Tickets/jornada ≤ −15 % y ticket ≥ 0 % → **Menos mesas.** Quien vino gastó igual o más.
2. Tickets/jornada ≥ −5 % y ticket ≤ −15 % → Misma afluencia, ticket más chico.
3. Tickets y ticket ≤ −10 % → Menos mesas y menor gasto por mesa.
4. Neta ≤ −15 % y % promo < 5 % → La promo no explica la baja.
5. % turno tarde cae y manana no → Se cayó la noche, no el local.
6. **Espejo de crecimiento:** tickets/jornada ≥ +15 % y ticket ≥ 0 % → **Más mesas,** gastando igual o más.
7. **Catch-all (else real, SIN piso):** cualquier caso no cubierto, suba o baje → "Neta ΔX %.
   Tickets/jornada ΔY %. Ticket ΔZ %." Siempre hay titular.

## Mix — catálogo (nombres reales de `FAC_Clasificaciones`)

En el valor servido: 2 TAPAS · 3 SUSHI · 4 POSTRES · 5 BEBIDAS · 13 KIDS · 16 POKE · **29 GREENSEASON**.
Fuera: 6 personal · 12 gift · 17 cortesía · 19 pax · 20–27 merch/extras · 28 dueños · 25 cajón/promociones.
UI del mix: Comida vs Bebida vs Promo (29) vs Otros. Drill: 3, 5, 2, 16 + 29.

## Vista

Un bloque en analítica. Arriba: recorte + turno. Cuerpo compacto (frase de diagnóstico titular + 3
palancas + mix en una línea). Sin gráficos obligatorios en v1; si hay, dos barras (tickets/jornada y ticket).

## Fuera de alcance v1

BioTime/horas/productividad (Parte B saloneros); delivery como lente; PAX nativo; predicción/clima;
escritura; migraciones.

## Guardrails

- Rama `feat/analitica` (build sobre la integración, no staging). Aditivo. Solo SELECT.
- No tocar `cashUtils`, `tipCalculations`, `computeTotals`, `posFiscal`, cierres, IVA, `total_crc`.
- Tests: identidad neta ≈ tickets × ticket (±₡1); exclusión 677/678; whitelist de familias; `round`
  por línea en unidades; turno 111/222; jornada por lote; recorte sep–nov 24/25 reproduce los ancla
  (recalculados por lote); diagnóstico dispara en suba Y baja; **cross-check: neta/tickets/jornadas/
  unidades del helper = las del módulo migrado**.

## Cifras ancla (noche, cajero 222, sep–nov · header `pos_ndf_tickets`)

| Año | Tickets | Ticket prom | Neta | Jornadas |
|-----|---------|-------------|------|----------|
| 2024 | 3.180* | ₡26.238* | ₡83.435.771* | (contar por lote) |
| 2025 | 1.687* | ₡30.391* | ₡51.269.675* | (contar por lote) |

\* query 64 con −7h → **recalcular por lote.** Las dos definiciones difieren solo en los lotes del
BORDE del recorte: el que abre el 31-ago y cruza a septiembre, y el que abre el 30-nov y cruza a
diciembre — a lo sumo 2 lotes por año por turno. **Anotar el delta observado aunque dé 0:** si sale
mayor que un par de lotes, cambió otra cosa además de la definición de jornada. La forma (−46,9 %
tickets / +15,8 % ticket / −38,6 % neta → caso 1) se mantiene.

## Hallazgo que el SPEC no reabre

Green Season = familia 29 (SKUs 1049–1054, alta 2025-09-12, baja 2026-04-25). Almuerzo sep–nov 2025 vs
2024 subió (+24 % neta/jornada) — con el árbol nuevo, el turno mañana que creció SÍ tiene titular
(regla 6/7). Nota en el bloque promo, no feature.

## Firma

- Titular = frase de diagnóstico, cubre suba y baja (else sin piso). Jornada por lote. Mix por whitelist.
  `%promo` = 29 / SKUs GS. `round` por línea en unidades. 677/678 defensa en profundidad. Ancla con
  columna jornadas recalculada por lote (anotar delta del borde). Turnos manana/tarde/dia.
- ⛔ No iniciar hasta P2 + `bebc9de` en la rama de build. El prompt de P2 lleva jornada por lote y whitelist.

---

# Pendiente que sale de esta firma (NO es parte del módulo)

**Renombrar la familia 29 en el código: "Bentos" → GreenSeason.** La firma resolvió que 29 es
GREENSEASON; el código la llama bentos/almuerzo en tres lugares y eso hoy se VE en pantalla:

| Dónde | Qué dice |
|---|---|
| `mapTicket.ts:139` | `export const FAMILIA_BENTOS = 29` + el comentario "bentos / almuerzo" |
| `ventasEnVivoDatos.ts:68` | `29: 'Bentos'` — **la etiqueta del mix en «En vivo»** |
| `ventasEnVivoDatos.test.ts:167,185` | dos aserciones sobre la etiqueta `'Bentos'` |

Es rename puro: no toca plata, la familia 29 sigue entrando al valor servido exactamente igual y la
suma del mix sigue siendo el neto del día. Pero **cambia una etiqueta visible** en el mix de «En
vivo», así que se hace cuando el dueño lo pida, no de contrabando en un commit de docs. No bloquea el
módulo: el helper puede leer la familia 29 sin importar cómo se llame la constante.
