# SPEC — Descomposición de venta (por qué bajó / subió) · BORRADOR para firmar

> ⛔ **DISEÑO — NO INICIAR.** Se construye **después de P2** (todo el módulo Ventas alimentándose
> del PoS, no del xls). Solo lectura sobre `pos_ndf_*`. No toca IVA, `total_crc`, sagrados, caja,
> propinas, realtime, prod ni main. Autor: Ismael. Revisión técnica: Claude.
>
> **Prerrequisitos antes de construir:**
> 1. P2 cerrado (fuente PoS con corte ene-2024; 2023 estático desde xls/hist).
> 2. Fix de paginación de líneas en `posNdf.ts` (commit `bebc9de`) presente — sin él
>    `pos_ndf_ticket_lines` venía truncada y el mix daría mal.
>
> **Riesgo #1 (catálogo de familias) — CERRADO.** Tabla real: `FAC_Clasificaciones`
> (`CodigoTipoClasificacion`, `NombreClasificacion`). CSV confirmado: 2 tapas · 3 sushi ·
> 5 bebidas · 16 poke · 25 promociones · 29 greenseason; fuera 6/17/19/28. El mix usa
> `linea.familia = CodigoTipoClasificacion`, ya calza. Los ancla NO dependen de esta tabla:
> salen del header `pos_ndf_tickets` (query 64) y quedan firmados.

## Pregunta que responde

"Bajó la neta" no es un diagnóstico. El módulo muestra de qué palanca salió el movimiento, en una
frase + 6 números, por turno y por recorte comparable (mismos meses / mismos días / misma semana
del año anterior).

## Identidad (única, no se discute)

```
neta = jornadas × tickets_por_jornada × ticket_promedio
ticket_promedio       = neta / tickets
unidades_por_ticket   = unidades / tickets     (sin 677 ni 678)
```

- `jornadas` = días con ≥1 ticket de ese turno (mismo denominador que el KPI 1).
- La identidad tiene **2 palancas** (tickets/jornada, ticket promedio). `unidades/ticket`
  descompone la palanca 2, no la neta directa.
- Las palancas se muestran juntas. Nunca una neta suelta como KPI titular.

## Recorte de tiempo (firmado)

- Jornada = `((fecha_registra AT TIME ZONE 'America/Costa_Rica') - 7 hours)::date`. Igual que `jornada.ts`.
- Turno v1 = `cajero_login`: 111 mañana · 222 noche. Cualquier otro → bucket "otro" (no fila Bar).
  388 es caja, no turno.
- Comparación default = mismos meses del año anterior (sep–nov 25 vs sep–nov 24).
- Segunda comparación = mismos N días (día 8 del mes vs primeros 8 del mes año anterior y del mes
  anterior). Ya pedido en el reporte mensual.
- No comparar "YTD vs año completo".

## Universo

- `pos_ndf_tickets.estado = 'C'`.
- Neta del ticket = `valor_servido_crc` (la que ya usa analítica). No re-sumar líneas para el total.
- Unidades y mix = `pos_ndf_ticket_lines`. Excluir `codigo_producto IN ('677','678')` y las familias
  fuera del mix comercial (**6, 17, 19, 28**) del mix en ₡ y de unidades.
- Local: piloto (`santa-teresa`) salvo filtro.

## Los 6 KPIs (una fila = turno × recorte)

1. **Tickets / jornada** = tickets ÷ días con ≥1 ticket de ese turno. ¿Vinieron menos mesas?
2. **Ticket promedio** = Σ neta ÷ tickets (neta = header `valor_servido_crc`). ¿Gastaron menos por mesa?
3. **Unidades / ticket** = Σ cantidad (sin pax/cortesía) ÷ tickets. ¿Pidieron menos platos?
4. **Mix** = % de **neta de líneas** por familia (base: `pos_ndf_ticket_lines.monto`, NO el header).
   ¿Se fueron a lo barato?
5. **% turno / día** = neta del turno ÷ neta del día (111+222+otro). ¿Se cayó un turno o el local?
6. **% promo** = % de **neta de líneas** de las familias promo **{25 PROMOCIONES, 29 GREENSEASON}**
   (extensible). ¿La promo explica la baja? Regla: si < 5 % y la neta cayó > 15 %, la promo no es la causa.

Δ contra el recorte comparable: absoluta y %. Semáforo solo en 1 y 2 (son las palancas). 4–6 son contexto.

⚠️ KPIs 4 y 6 se calculan sobre **neta de líneas (productos)**, base distinta del header — rotularlo
así en la UI para que nadie lo lea contra la neta total.

## Diagnóstico automático (una línea). Prioridad, la primera que aplique:

1. Tickets/jornada ≤ −15 % y ticket ≥ 0 % → **Menos mesas.** Quien vino gastó igual o más.
2. Tickets/jornada ≥ −5 % y ticket ≤ −15 % → Misma afluencia, ticket más chico (mix o precios).
3. Tickets y ticket ≤ −10 % → Menos mesas y menor gasto por mesa.
4. Neta ≤ −15 % y % promo < 5 % → La promo no explica la baja.
5. % turno noche cae y mañana no → Se cayó la noche, no el local.

Nunca sumar mañana + noche como "un KPI de salonero". Son turnos distintos.

## Mix — catálogo de familias (VALIDADO contra `FAC_Clasificaciones`)

`FAC_Clasificaciones.CodigoTipoClasificacion` = `pos_ndf_ticket_lines.familia`:

| id | Nombre | Grupo UI |
|----|--------|----------|
| 3  | SUSHI ROLLS | Comida |
| 2  | TAPAS ASIATICAS | Comida |
| 16 | POKES BOWLS CEVICHES | Comida |
| 13 | KIDS MENU | Comida |
| 4  | POSTRES | Comida |
| 5  | BEBIDAS | Bebida |
| 29 | GREENSEASON | Promo / bebida |
| 25 | PROMOCIONES | Promo |
| 6, 17, 19, 28 | PERSONAL / CORTESÍAS / PAX / DUEÑOS | Fuera del mix comercial |
| resto | Otros | Otros |

UI del mix: Comida vs Bebida vs Promo vs Otros. Drill: familias grandes (3, 5, 2, 16) + 29.
El % se calcula sobre neta de líneas del turno, no sobre el header (el header incluye servicio).

## Vista

Un bloque en analítica, no un módulo nuevo. Arriba: recorte (preset sep–nov / dic–abr / mes / semana)
+ turno (mañana / noche / día). Cuerpo compacto:

```
Noche · sep–nov 2025 vs 2024
Neta −39 %   Tickets/jornada −47 %   Ticket +16 %
Diagnóstico: Menos mesas. Quien vino gastó igual o más.
Promo 3 % — no explica la baja.
Mix: sushi 42 % · bebidas 26 % · tapas 14 % · poke 10 %  (Δ pp vs año anterior)
```

Sin gráficos obligatorios en v1. Si hay gráfico: dos barras (tickets/jornada y ticket), no una neta sola.

## Fuera de alcance v1

BioTime / horas / productividad por mesero (es Parte B de saloneros); delivery `tipo='D'` como lente;
PAX nativo de factura (solo 677 si algún día se muestran cubiertos, no KPI titular); predicción, clima,
ocupación hotelera; escritura a la base; migraciones.

## Guardrails

- Rama `feat/analitica`. Aditivo. Solo SELECT.
- No tocar `cashUtils`, `tipCalculations`, `computeTotals`, `posFiscal`, cierres, IVA, `total_crc`.
- Tests: identidad neta ≈ tickets × ticket (tolerancia ₡1); exclusión 677/678; turno 111/222;
  recorte sep–nov 24/25 reproduce los ancla; diagnóstico 1 se dispara con esos números;
  **cross-check: la neta/tickets del helper coincide con la del módulo migrado para un turno/rango
  de muestra** (evitar un tercer agregador divergente).

## Cifras ancla (FIRMADAS — noche, cajero 222, sep–nov, jornada CR −7 h · header `pos_ndf_tickets`, query 64)

| Año | Tickets | Ticket prom | Neta |
|-----|---------|-------------|------|
| 2024 | 3.180 | ₡26.238 | ₡83.435.771 |
| 2025 | 1.687 | ₡30.391 | ₡51.269.675 |

Δ tickets −46,9 %. Δ ticket +15,8 %. Δ neta −38,6 %. Diagnóstico esperado: caso 1.
Familia 29 presente solo en 2025, ~3 % de neta de líneas noche. No dispara "la promo explica".
No dependen de la tabla de familias — salen del header.

## Hallazgo que el SPEC no reabre

Green Season (SKUs 1049–1054, alta 2025-09-12, baja 2026-04-25) no mueve el mediodía ni explica la
noche. El almuerzo sep–nov 2025 vs 2024 subió (+24 % neta/jornada). Nota en el bloque promo, no feature.

## Orden de build

1. Helper puro: recorte + jornada + agregados (tickets, neta, unidades) + Δ + diagnóstico. Tests con ancla.
2. Mix por familia + grupos. Test: % suman 100 ± 0,2.
3. Vista compacta (frase + 6 números + mix en una línea).
4. Presets de recorte (sep–nov, dic–abr, mes, semana, mismos N días).

## Firma

- **Titular del bloque = la frase de diagnóstico.** La neta con Δ va dentro de la frase, no como titular.
- Promo = {25, 29}. Dos netas rotuladas (header vs líneas). Exclusión {6,17,19,28}. No tercer
  agregador sin cross-check. No iniciar hasta P2 + paginación `bebc9de`.

---

# Revisión técnica — Claude, 2026-09-08

Contrastado contra el código en `feat/analitica` (`d39a788`). El diseño se sostiene; el problema
está en **tres puntos donde el SPEC dice "igual que el código" y no lo es**. Los dos primeros
bloquean la firma porque cambian números, no redacción.

## 🔴 1. La jornada del SPEC NO es la de `jornada.ts` — BLOQUEA

El SPEC define:

```
Jornada = ((fecha_registra AT TIME ZONE 'America/Costa_Rica') - 7 hours)::date. Igual que `jornada.ts`.
```

`jornada.ts` **no hace eso**. Define la jornada como la fecha CR del **primer ticket del LOTE de
cierre** (`cajero_login`, `fecha_cierra`) — ver `agruparEnLotes` → `jornada: fechaCR(apertura)`.
No hay ningún `- 7 hours` en el archivo.

El corte de 7 h es la definición **VIEJA**, y todavía vive en `posNdf.ts`
(`HORA_CORTE_JORNADA`, `businessDateDe`, `ventanaJornada`). P1a la reemplazó justamente porque
adivinaba por reloj: ahora el PoS dice explícitamente quién cerró la caja y cuándo, así que el día
lo define la APERTURA DEL LOTE, no la hora a la que cae cada factura.

**Por qué importa acá, y no es teórico:** las dos difieren en el turno que cruza la medianoche —
que es el turno 222, el del ancla. Un lote que abre 19:00 del 5 y cierra 01:30 del 6: con el lote,
todas sus facturas son del 5; con el −7 h, también. Pero un lote que abre 07:30 y una factura de
06:50 del día siguiente caen distinto. Y sobre todo: **`getDiasMapDesdePos` y `saloneroLentesDatos`
ya usan la definición de lote**. Un helper nuevo con −7 h sería exactamente *el tercer agregador
divergente que el propio SPEC prohíbe en sus guardrails*, y el cross-check que el SPEC pide fallaría
por diseño.

**Propuesta:** el SPEC adopta la definición de lote y reusa `agruparEnLotes` de `jornada.ts`. Si el
ancla (query 64) se calculó con `- 7 hours`, hay que **recalcularlo con lotes antes de firmarlo** —
si no, el test "reproduce los ancla" fija el número equivocado.

## 🔴 2. La exclusión `{6, 17, 19, 28}` no reconstruye la neta — BLOQUEA

El SPEC excluye del mix solo `{6, 17, 19, 28}`. La app define la neta con
`FAMILIAS_VALOR_SERVIDO = [2, 3, 4, 5, 13, 16, 29]` (lista blanca, no lista negra). Con la lista
negra del SPEC entrarían al mix, además: **12 gift cards · 20 ingredientes · 22 extras · merch
21/23/24/26/27 · 25 promociones · cajón 1, 9, 11, 15**.

Consecuencias concretas:

- El mix dejaría de sumar la neta. Hoy hay un invariante con test:
  *«la suma del mix ES el neto del día»* (`ventasEnVivoDatos.test.ts:189`), sostenido porque las
  claves de `CATEGORIA_FAMILIA` son **exactamente** `FAMILIAS_NETO`.
- Los % del mix no cerrarían en 100 contra ninguna base conocida, y el test que el SPEC pide
  («% suman 100 ± 0,2») pasaría igual, sobre una base distinta de la del resto de la app.

**Propuesta:** el mix usa la **lista blanca** `FAMILIAS_VALOR_SERVIDO`, no una lista negra. Si se
quiere ver promociones y merch, van como bloque aparte rotulado "fuera del neto", nunca dentro del
mismo 100 %.

## 🟠 3. La familia 29 es BENTOS en el código, no GREENSEASON

El SPEC la pone como *"29 GREENSEASON · Promo / bebida"* y la mete en `% promo`. El código dice
otra cosa: `FAMILIA_BENTOS = 29`, *"bentos / almuerzo"*, y en el mix es su propia categoría
(`29: 'Bentos'`). Entra al valor servido.

Y el SPEC se contradice solo: su propio hallazgo dice que Green Season son los **SKUs 1049–1054**,
o sea un puñado de productos, no una familia entera. Si 29 es la familia de bentos/almuerzo,
`% promo` estaría contando **todo el almuerzo como promo** — justo el turno que el SPEC dice que
SUBIÓ (+24 %).

**Antes de firmar hay que resolver cuál de las dos es 29** (el CSV de `FAC_Clasificaciones` manda).
Si es bentos, `% promo` debería salir de los SKUs 1049–1054, no de la familia.

Nota menor del mismo tema: la familia **25 no está en la neta** (`mapTicket.ts:151` la lista como
cajón/personal). Un `% promo` sobre neta de líneas con 25 adentro del numerador y afuera del
denominador no cierra.

## 🟠 4. Los ancla no permiten testear el KPI 1

El KPI titular es **tickets / jornada**, pero la tabla ancla trae `Tickets`, `Ticket prom` y `Neta`
— no `jornadas`. Con eso el test "reproduce los ancla" solo puede verificar tickets, no el KPI 1, y
el "diagnóstico 1 se dispara con esos números" queda apoyado en el supuesto de que 2024 y 2025
tuvieron la misma cantidad de noches operadas. Si 2025 abrió menos noches, Δ tickets/jornada ≠
−46,9 % y el caso 1 podría no dispararse.

**Propuesta:** agregar a la tabla ancla la columna `jornadas` de cada año.

## 🟡 5. El diagnóstico tiene un hueco sin regla

Las cinco reglas no cubren todo el plano. Ejemplo real y nada exótico: **tickets/jornada −20 % y
ticket −5 %** no dispara ninguna (la 1 pide ticket ≥ 0; la 3 pide los dos ≤ −10; la 2 pide
tickets ≥ −5). Sin una regla por defecto el bloque se queda sin su titular, que es *lo único* que
el SPEC declara como titular.

**Propuesta:** una regla 6 de fondo — *"Cayeron las dos palancas, ninguna domina"* con los dos Δ.

## 🟡 6. Vocabulario del turno

El SPEC llama **"otro"** al bucket de los logins que no son 111/222. El código ya lo llama
`TURNO_DIA = 'dia'`, etiqueta **"Día"** (`saloneroLentes.ts`), y la UI de Parte B ya lo muestra así.
Dos nombres para el mismo bucket en dos pantallas contiguas. Alinear a `'dia'`.

## ✅ Lo que verifiqué y está bien

- **La identidad cierra:** `jornadas × (tickets/jornadas) × (neta/tickets) = neta`. ✓
- **Los ancla son consistentes entre sí:** 83.435.771 / 3.180 = ₡26.237,66 y 51.269.675 / 1.687 =
  ₡30.391,03; los tres Δ (−46,9 % / +15,8 % / −38,6 %) reproducen. ✓
- **El prerrequisito `bebc9de` existe** y está en `feat/analitica` y en
  `integracion/analitica-staging`. ⚠️ **Todavía NO está en `staging`** (`db690f1`): si el módulo se
  construye sobre staging antes de mergear, el mix vuelve a leer líneas truncadas.
- **`estado = 'C'`, `valor_servido_crc` como neta del header y el turno por `cajero_login`**
  coinciden con lo que ya hace `getTicketsRango` / `turnoDeFactura`. ✓
- **"No re-sumar líneas para el total"** es la decisión correcta y ya tiene precedente: la lente A
  de Parte B expone `descuadreCrc` justamente para no tapar cuándo líneas y header no coinciden.
  El helper nuevo debería exponer lo mismo en vez de elegir una base en silencio.
