# Revisión independiente del análisis — 04-nov-2026

Revisión hecha por un agente aparte que no participó del análisis.

**Qué hizo:**
- Volvió a correr `share.py` y `an_r7.py`.
- Recalculó cifras desde `datos/r7/q21.csv`, `q24`, `q25`, `q20` y `q2`.

**Resultado:** las cifras clave reproducen exacto. Los problemas están en la interpretación, no en la aritmética.

**Estado:**
- ✅ = ya corregido en los reportes y el README.
- 🔲 = pendiente.

## Errores

1. 🔲 **Moda del precio en meses con cambio de precio** (`sql/base.sql:17-21`).
   - **Síntoma:** las mesas normales de noche con ratio ≥1,03 son el 21,6 % en mar-2025 y el 6,7 % en oct-2026. Lo normal es alrededor del 1 %.
   - En oct-2026 aparecen 23 mesas con ratio 0,91–0,93 y ₡20,1k por pax. Es precio viejo leído como «tarjeta 10 %».
   - Por eso «tarjeta 10,5 % en sep–oct 2026» y sus ₡18.853 por persona están inflados.
   - **Corrección:** tomar el precio de lista por día o semana, o el `PrecioVenta` de catálogo del PoS. Si no, excluir los meses con cambio de precio.
   - **Detalle:** `mode()` desempata hacia el valor más bajo. En productos con poca venta puede tomar como lista el precio con descuento.
2. ✅ **«Venta total ₡27,0M/mes» es solo salón.** Falta el delivery y para llevar, unos ₡2,9M/mes (Q15).
3. ✅ **330 y 331 invertidos en el README.** Lo correcto es 331 en ene–abr 2024 y 330 en 2025.
4. 🔲 **r5:124-129 compara períodos de distinto largo:** 282 LC en 3 meses contra 165 en 2. Hay que pasarlo a cifras por mes.
5. ✅ **«Ningún LC de menú es nuevo… no pasó» no se sostiene.** Dentro de 2025, el LC de carta bajó de 213/mes (jul–ago) a 150/mes (sep–oct) cuando apareció el menú. Hubo algo de canibalización.
6. ✅ **«+₡1.000 por plato = +₡130k/mes» supone que no se pierde ningún plato.** Ahora está marcado como algo a probar.
7. 🔲 **Reproducibilidad:**
   - `datos/q5.csv` es la v1, cortada en 99 filas. Falta la v2.
   - `rondas/r3.sql:86` no tiene `limit`.
   - La hora de corte de turno no está documentada.

## Riesgos de interpretación

- ✅ **LC sep–oct 2025 contra 2026 (+₡753k):** el escenario alto no tiene respaldo, porque en 2025 el LC era nuevo (pico en jun-2025).
  - Con diferencia en diferencias, usando jul–ago como período sin menú en los dos años, da unos 41 LC incrementales por mes.
  - Los meses varían ±25 % y solo hay 87 pax con menú, así que se presenta como rango: +₡250 a 400k/mes.
- ✅ **«73 % nuevos» en el mediodía de temporada baja** (resuelto con Q27):
  - Por hora real y con la noche como control da 79 % en baja y 71 % en alta. El temor de que bajara a ~46 % no se confirmó, porque el turno de caja también ponía mesas de mediodía en la noche antes de may-2025.
  - Lo que sigue es el hallazgo original de la revisión:
  - `q24` muestra que en may–dic 2025 hay 97+24 mesas de «mañana» entre las 17 y las 22 h, contra 1 antes y 30 en 2026. Eso infla el pax de mañana de 2025.
  - Corregido, la estimación podría bajar a alrededor del 46 %, muy cerca del umbral de 41–44 %.
  - Ya está marcado en el reporte. Falta rehacer el conteo por hora con Q27.
- **Punto de equilibrio:**
  - La fórmula está bien, pero usa el margen promedio de carta. Los que se pasan al menú probablemente gastan menos, así que el umbral real es menor.
  - El margen no incluye mano de obra, que pesa si el menú solo se ofrece en temporada baja.
- **VIP card de 10 % a 15 %:**
  - Es una sola ventana de 4 meses.
  - El balde de 10 % mezcla VIP con tarjetas de hotel, que dependen del turismo.
  - Parte del «LC retuvo locales» puede ser gente de tarjeta de hotel que pasó al 15 %.
- ✅ **«% clientes LC» cuenta a todas las personas de la mesa.** Los socios son unos 0,7 por pax; el resto son invitados.
- **Créditos:** las 11 mesas canjeadas por mes caen en «sin descuento» como venta normal.
- **Correlación −0,72 entre mediodía y noche:** con 16 meses y estacionalidad compartida no prueba causa. En el reporte quedó como contexto, no como prueba.

## Inconsistencias numéricas

- **Margen por persona del menú:** hay tres versiones.

  | Fuente | Carta | Menú | Umbral |
  |---|---|---|---|
  | r4 | 9,9–11,0k | 5,5–6,1k | — |
  | r6 | 10,5–11,8k | 5,9–6,5k | — |
  | `share.py` | 10.888 | 6.386 | 41,3 % |

  La diferencia viene del costo del menú: 32 % sobre la lista (atajo), 33–35 % de la neta (costlib) o 37 % (fampct de la familia 29). Hay que unificarlo.
- **LC sep–oct:**

  | Fuente | 2025 | 2026 |
  |---|---|---|
  | r5 | 215 | 116 |
  | r7 | 156 + 59 | 116 |
  | README | 194/mes | 131/mes |

  Son definiciones distintas: personas con 856, o pax en mesas con 856 o ratio 0,80–0,87.
- **El LC pesa «~10 %» de los pax de noche** en r5 y 16,5 % en el README, por la misma diferencia de definición.
- **Universos distintos:**
  - Q19 excluye las familias 6, 17 y 20.
  - Q21 y siguientes también excluyen la 19, dejan fuera `cantidad≤0` y filtran por `con_servicio`.
- **«Alta y media» en r7:563 (mar–ago 2026)** no coincide con la definición de temporada (alta = dic–abr).
- **Bento ÷ 4:** falla si el Veggie Bento va en una sola línea.

## Huecos, por prioridad

1. **Frecuencia de visita por socio LC.** `IDCliente`/`CodigoCliente` existen en `FAC_Pedidos` (r6). Es clave antes de bajar el LC a 10 %.
2. **Diseño causal con datos por día:**
   - Diferencia en diferencias con un período sin menú.
   - Controles por día de semana, feriados y lluvia.
   - Intervalos de confianza para los escenarios.
3. **Elasticidad de precio,** usando como experimentos naturales los cambios de precio de dic-2024, mar-2025 y oct-2026.
4. **Efecto por salonero:** cuánto ofrece cada uno el menú, qué % de entrada y postre logra, y quién marca el LC.
5. **Ingeniería de menú** (margen × popularidad). Ya hay una primera versión en el reporte completo.
6. **Valor de los invitados del LC y costo de mano de obra del menú.**
7. **Nosara, y el delivery** en los márgenes de LC y del menú.

## Lo que está sólido

- **Joins y horario:** la CTE base no tiene fan-out y el join de D8 v2 está bien corregido. La hora de CR es consistente y hay `limit` explícito desde Q5 v2.
- **Clasificación por ratio:** queda validada, con modas de 0,85 y 0,90. D6 explica el 75–90 % del descuento.
- **Atajo de costo:** funciona. El sesgo es de ₡250 por pax o menos.
- **Reproducibilidad del README:** las cifras salen exactas desde los CSV.
- **La caída del mediodía en sep–oct 2026** (−33 % de pax contra −6 % de la noche) sugiere que el menú sí trae gente. La magnitud se confirma con Q27.
