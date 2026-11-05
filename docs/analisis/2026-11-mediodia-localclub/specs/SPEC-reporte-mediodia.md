# SPEC v2 — «Reporte de mediodía» (menú ejecutivo vs carta) · 2026-11-03

> **Anexo de `claude/SPEC-analisis-ventas-integrado.md`** (pestaña Mediodía, §3.2). La SPEC integrada manda en la comparación de períodos, la arquitectura, las fases y los datos que faltan.

> Sale del análisis del 03/11. Reporte: Doc «Estrategia de mediodía». Consultas y hallazgos: `claude/SQL-analisis-mediodia.md` (Q0–Q10).
> **EN ESPERA**, como «Prom/PAX explicado»: necesita el arreglo de roles (SEC-01) y comparte el RPC de agregado.
> El módulo puro + tests puede avanzar antes, en rama aparte.
> v2: suma pax reconstruido, margen por persona, pax nuevos estimados y cumplimiento por salonero.

## 1. Qué es
Modo nuevo en **Ventas → Análisis**: «Mediodía». Responde:
- Cuánto pesa el menú ejecutivo en la mañana.
- Cuánto deja cada persona, en venta y en margen, según pida menú o carta.
- Si el menú trae personas nuevas o solo cambia lo que piden.
- Qué platos se piden.
- Si el equipo cumple la política vigente.

**Roles:** owner, manager y contador, **activos**. **Acceso:** solo lectura; no toca caja, propinas ni sagrados.

## 2. Filtros
Los de SPEC-prompax-explicado §3:
- **Local** y **período:** rango, mes, semana o temporada.
- **Comparar contra:** período anterior, mismo período del año anterior o mismo tramo de temporada.
- **Turno:** por defecto, mañana.
- **Temporadas:** el módulo único de §4 de ese SPEC.

## 3. Catálogo (fuente de verdad en código, un solo módulo)
- **Menú ejecutivo** = `familia = 29`.
- **Bebidas del menú**, que cuentan como bebida y no como plato:
  - 1048 Smoothie lunch
  - 1049 Asahi green
  - 1050 Pilsen green
  - 1051 Imperial green
  - 1052 Coca green
  - 1053 Coca zero green
  - 1054 Fresca green
  - 1055 Club soda
  - 310 Bento lemonade
- **Extras del menú:** 1077 Extra lunch. No es plato, no es bebida y no marca la mesa como «con menú».
- **Bento Box:** se carga como 4 líneas de componente (nombre contiene «BENTO»). **1 box = Σ cantidad ÷ 4.**
- **Secciones del Bento** (mapa código → sección):

| Sección | Componentes |
|---|---|
| 1 · Entrada | Gyoza 309, Edamame 581, Korokke 127 |
| 2 · Frío | Sashimi atún 575, Hosomaki 574, Ensalada 576 |
| 3 · Roll | Satori 569, Spicy 307, California 313, Veggie 568 |
| 4 · Caliente | Teriyaki 567, Tonkatsu 570, Tempura 584 |

- **Producto nuevo de la familia 29 sin mapa:** cuenta como plato del menú y se **avisa**.
- **Pares de canibalización** (menú → carta):

| Menú | Carta |
|---|---|
| Bowl Teriyaki Lunch | Pollo Teriyaki |
| Sakura Poke | Poke Wave |
| Ceviche Tico-Nikkei | Ceviche Peruano |
| Sushi Duo | California roll |

## 4. Métricas
- **Neta, día CR, `estado='C'`, canal salón:** como en toda la app (netaVenta.ts).
- **Mesa con menú** = ticket con al menos un plato del menú.
- **Pax reconstruido** (módulo propio, reutilizable por Prom/PAX explicado):
  - **Mesa con pax:** se usa su pax.
  - **Mesa sin pax:** pax estimado = promedio de pax de las mesas con pax de la **ventana de calibración**, con la misma combinación (turno, con/sin menú, platos 0–6, bebidas 0–6).
    - Plato = familias 3, 13, 16 y platos del menú; el Bento cuenta 1.
    - Bebida = familia 5 + bebidas del menú.
  - **Celda con menos de 5 mesas:** promedio por (turno, menú, platos). Si no hay ninguna, 1.
  - **Ventana de calibración:** desde 2025-09-01 (pax bien cargado). Constante en código.
  - **Validación que se muestra:** sesgo % y error medio por mesa, calculados sobre las mesas con pax del período.
  - **Aceptación del modelo:** error ≤ 0,6 pax/mesa en la mañana y sesgo entre −8 % y +5 %.
- **Prom/pax** = neta ÷ pax reconstruido.
- **Prom/pax limpio** = solo mesas con pax. Se muestra al lado, rotulado.
- **Margen por persona** = (neta − costo) ÷ pax.
  - **Costo de cada línea:** costo unitario del plato × cantidad, desde una tabla de costos (§6).
  - **Sin costo:** se usa un % por familia (comida 22 %, bebida 33 %, menú 37 %), rotulado «estimado».
  - **Indicador:** % de la neta con costo real.
- **Umbral de conveniencia** = brecha ÷ (margen del menú + brecha), con brecha = margen por pax de carta − margen por pax de menú. Hoy da ≈ 43 %.
- **Pax nuevos estimados** = pax reales del período − pax esperados.
  - **Pax esperados** = pax del mismo período del año anterior × (1 + variación de la mañana en los 2 meses previos al período, contra el año anterior).
  - **Se muestran** como % de los pax en mesas con menú, contra el umbral.
  - **Escenario alternativo:** la variación de la noche como tendencia. Si los dos escenarios difieren en el signo, se muestra «no concluyente».
- **Agregados:** % de mesas con bebida, entrada y postre; bebidas por mesa; pax por mesa. Por tipo de mesa y día de la semana.
- **Canales (v2.1):** % de pedidos con menú en salón con salonero, salón cargado por caja, delivery y para llevar.
  - El delivery es el **indicador de demanda recurrente**: el menú no se ofrece por WhatsApp.
- **Recurrentes (v2.1):** personas Local Club (856) e Invitado (857) por turno y tipo de mesa, como % de los pax.
  - Si en la mañana la carga es baja (< 3 % de los pax), se muestra «dato no cargado al mediodía» en vez de un %.
- **Cumplimiento:** % de mesas con menú por salonero y mes (caja = sin salonero), contra el objetivo de la política vigente. El objetivo es un parámetro.
- **Descomposición** del Δ prom/pax en mezcla y rendimiento por grupo menú / sin menú. Es la fórmula y el test 1e-9 de SPEC-prompax §6.2.
- **Ranking de platos de la mañana:** platos, por 100 pax, % de mesas, neta, neta por plato, margen por plato y par de carta.
- **Bento por sección:** unidades por componente y costo medio por box.

## 5. Pantalla
1. **Tarjetas:** personas (reconstruido) · prom/pax · margen por persona con menú / sin menú · % de pax en mesas con menú. Todas con la comparación.
2. **«¿Conviene el menú?»:** pax nuevos estimados (%) contra el umbral, en lenguaje simple, y el aviso de «no concluyente» cuando corresponde.
3. **Línea mensual:** prom/pax reconstruido de la mañana, con la noche en gris.
   - **Hitos v1 fijos:** 2025-07-01 Bento, 2025-09-01 menú completo, 2026-02-20 «solo a pedido».
4. **Tablas:** por tipo de mesa · margen · ranking · Bento por sección · cumplimiento por salonero · día de la semana. Export CSV de cada una.
5. **Avisos:**
   - Familia 29 sin mapa.
   - % de la neta sin costo real > 10 %.
   - Sesgo del modelo fuera de rango.
   - Mesas sin pax > 5 % en el período.

## 6. Datos y seguridad
- **RPC de agregado de Prom/PAX explicado** + `con_menu` + conteos por ticket (platos, bebidas) para el pax reconstruido.
- **RPC de productos:** `pos_mediodia_productos(local, desde, hasta, turno)`.
- **Costos:** tabla nueva `costos_producto(local, codigo_producto, costo_unitario, vigente_desde, fuente)`. Se carga desde el CoGS (Satori_CoGS.xlsx / costeo del PoS).
  - **Esquema:** toca la base, así que necesita **firma**.
  - **v1 sin tabla:** CSV versionado en el repo, leído por el módulo puro.
- **Seguridad:** validación de rol en la base (`role` + `is_active`). La migración se aplica a mano con firma. Nada en `supabase/functions/`.
- **Límite de 100 filas:** toda consulta del SQL Editor lleva `limit` explícito. El editor agrega `limit 100` en silencio.

## 7. Aceptación (prod 03/11, Santa Teresa, salón, mañana)
- **Pax reconstruido** (prom/pax):

| Período | Prom/pax |
|---|---|
| 2024 | 12.753 |
| ene–jun 2025 | 11.956 |
| jul–nov 2025 | 10.700 |
| dic 2025 – feb 2026 | 10.476 |
| mar–oct 2026 | 11.232 |

  Pax jul–nov 2025 = 1.666 (+40 % contra 2024). Error medio en 2024: 0,47–0,72 pax/mesa.
- **Prom/pax limpio:** dic–feb 10.438 → mar–oct 2026 11.345. La descomposición da +906 = mezcla +1.474 · menú −295 · sin menú −273.
- **% de pax en mesas con menú:** dic–feb 72,0 %, mar–oct 2026 39,1 %.
- **Margen por persona** (con la tabla de costos del 03/11):

| Período | Carta | Menú |
|---|---|---|
| jul–nov 2025 | 11.001 | 6.048 |
| mar–jul 2026 | 9.922 | 5.496 |

- **Pax nuevos jul–nov 2025:** ~510 de 698 (73 %).
- **Cumplimiento ago-2026:** caja 67,5 %, 032 46,2 %, 026 41,2 % de mesas con menú.
- **Ranking mar–oct 2026:** Bento 305 boxes (17,7 % de mesas), Casado 122, Bowl Teriyaki Lunch 102.
- **0 diferencias:** Σ neta del reporte = neta de Ventas para el mismo rango y turno.

- **Ronda 5** (`claude/SQL-analisis-mediodia-ronda5.md`):
  - **Delivery de la mañana con menú:** 35–58 % antes y después del 20-feb.
  - **Noche con menú, sep–nov 2025:** 23–42 % de los pax eran Local Club, contra ~10 % en carta.

## 8. Fuera de alcance (v1)
Nosara · hitos editables (v2, junto con la tabla de temporadas). Locales al mediodía: el dato ya existe (LOCAL CLUB 856), pero no se carga en la mañana. Es un cambio de operación, no de sistema. BOXING (1075, familia 19) es el cargo de empaque de delivery (confirmado el 03/11).

## 9. Ideas para otros reportes (con estos mismos datos)
- **Pax reconstruido en toda la app.** Hoy el prom/pax histórico de la noche también está inflado: 20–36 % de mesas sin pax antes de sep-2025.
- **Agregados por salonero.** % de mesas con entrada o postre por salonero, para coaching de venta sugerida.
- **Ingeniería de menú.** Matriz de popularidad × margen de toda la carta con la tabla de costos (estrellas, caballos, puzzles, perros).
- **Ingesta del PoS.** `descuento_crc`, `dolares_*` y `electronico_crc` llegan siempre en 0: revisar el bridge si se quieren descuentos (Local Club) y pago en dólares (turista).
