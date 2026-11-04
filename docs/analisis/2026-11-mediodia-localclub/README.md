# Análisis mediodía, menú y Local Club (nov 2026)

Análisis hecho entre el 29-oct y el 03-nov-2026 con datos del PoS Nube de Fuego (ago-2024 a oct-2026).
Objetivo: decidir qué hacer con el menú de mediodía (familia 29 GREENSEASON) y con el descuento Local Club.

**Reportes publicados (claude.ai):**
- **Para socios v2 (vigente):** https://claude.ai/artifact/866259kzSBznyP84UF6woj
- **Escenario 2027 con las propuestas:** resumen en [ESCENARIO-2027.md](ESCENARIO-2027.md) (el doc de Docs lo creó otra sesión; pedirle el link a Ismael)
- **Análisis completo (formato largo):** https://claude.ai/artifact/Exxrv4VfRnQ6MKwyh1vQUA
- **Programa de créditos y comisiones PM (conciliación):** https://claude.ai/artifact/9Ad3sbMcV4q2gMLfJbNXcq
- **Descuento al personal, mes a mes:** https://claude.ai/artifact/Y1BFGg8YjFPiNn4quamMPZ
- Para socios v1 (reemplazado): https://claude.ai/artifact/WtEwjaxWhDdDyqnpPMDt4o
- Resumen con detalle: https://claude.ai/artifact/2ZWjtnE72jC28A5kSvjQyf
- Estrategia de mediodía (detalle): https://claude.ai/artifact/UFxajJtFfVkVGHUHL5x8HG

Todo es **solo lectura**: nada de esto toca la base ni el código de la app.

---

## 0. Conclusiones vigentes (04-nov-2026)

1. **Menú de mediodía** (actualizado el 04-nov a la tarde, manda sobre r8). Con la hora real (Q27) y la noche como control:
   - Antes del menú los dos turnos se movían igual (−41 % y −42 %).
   - Con el menú, el mediodía le sacó entre 41 y 70 puntos a la noche.
   - **«Extra» por cada 100 personas que piden menú:** rango conservador de **22 a 44**.
     - Contra la noche daba 71–79, pero eso es un techo: le atribuye al menú el crecimiento propio del mediodía (la carta subió 30 % en baja 2026).
     - Ofrecido a todos, el efecto en margen va de −₡300k a ₡0/mes en baja y de −₡750k a ₡0 en alta.
   - **A pedido (desde el 20-feb-2026) suma:**
     - la gente siguió creciendo (+50 % en mar–ago, con la noche −10 %);
     - el ticket subió 8 % (₡10.440 → ₡11.260) y el margen por persona 14 % (₡7.220 → ₡8.240).
   - **Recomendación (opción C):**
     - Inserto impreso en baja (may → mediados de dic) y solo a pedido en alta.
     - Sacar del menú los platos que canibalizan la carta: Bowl Teriyaki, Sakura Poke, Ceviche Tico-Nikkei y Sushi Duo. Quedan Bento, Casado y Fish & Chips. Suma +₡35–160k/mes.
     - Bento al 35 % de costo: +₡35–65k/mes.
2. **El mediodía ganó clientela propia en 2026.** En temporada baja, la carta subió 30 % con la noche plana. Probablemente es boca a boca, porque no hay publicidad paga.
3. **El menú no le saca gente a la noche.**
   - La noche cae por turistas sin descuento desde may-2025, antes del menú.
   - El gasto por persona de noche no bajó.
   - En baja, a lo sumo unos 25 locales por mes podrían pasar de cenar a almorzar.
4. **VIP 10 % → 15 %: no trajo socios** (217 contra 204 por mes, separando las tarjetas de hotel con el reporte de créditos).
   - El relanzamiento como Local Club sí: +73 % en may–oct 2025 y +44 % en ene–abr 2026.
   - **Recomendación:** Local Club 2.0 al 10 % + regalo, presentado como relanzamiento. Ver [r9](rondas/r9-programa-creditos-PM.md).
5. **Programa de tarjetas y créditos:**
   - 1 crédito de ₡18.000 (confirmado) cada 6 personas.
   - Costo real ₡300–360k/mes con el gestor. Deja ₡1,0M de margen.
   - 172 créditos sin usar.
6. **Comisiones PM:**
   - Se cargaron ₡879k, contra ₡472k que justifica el PoS.
   - Quedan ₡301k por pagar. Hay que cruzar antes de pagar.
   - El canal casi se apagó en 2026.
7. **Personal 30 %:**
   - ₡58,8k/mes en 2026, +49 % contra 2025.
   - El 51 % va sin nombre.
   - **Propuesta:** código de empleado obligatorio y tope mensual.

8. **Escenario 2027:** ver [ESCENARIO-2027.md](ESCENARIO-2027.md). Sobre el presupuesto 2026, las propuestas suman +₡3,9 a 9,1M de margen por año.

> Si alguna cifra de la sección 1 o de r8 no coincide con esta, vale esta (más reciente).
> En r8 y en la sección 1 quedan como historia la recomendación de «menú fijo todo el año» y los 71–79 extra.

## 1. Resultados

### Peso de cada programa (nov 2025–oct 2026, promedio por mes, [scripts/share.py](scripts/share.py))

La venta de **salón** es de ₡27,0M/mes: ₡23,2M de noche y ₡3,7M al mediodía. El delivery y para llevar suman unos ₡2,9M/mes más (no incluidos).

**Noche**

| | Cliente común | Local Club | Tarjeta 10 % | Personal 30 % |
|---|---|---|---|---|
| % clientes | 76,7 % | 16,5 % | 6,0 % | 0,3 % |
| % venta de noche | 79,5 % | 13,8 % | 5,9 % | 0,2 % |
| Personas | 1.054 | 226 | 82 | 5 |
| Venta | ₡18,49M | ₡3,20M | ₡1,38M | ₡48k |
| Margen | ₡14,05M | ₡2,31M | ₡1,02M | ₡32k |
| Venta por persona | ₡17.544 | ₡14.166 (−19 %) | ₡16.809 (−4 %) | ₡10.158 |
| Margen por persona | ₡13.333 | ₡10.207 (−23 %) | ₡12.341 (−7 %) | ₡6.723 |
| Costo del descuento | — | ₡512k | ₡147k + créditos (₡55–115k) | ₡20–55k |

**Mediodía**

| | Carta | Menú |
|---|---|---|
| % personas del mediodía | 48 % | 52 % |
| % venta del mediodía | 59 % | 41 % |
| % venta de salón | 8,1 % | 5,7 % |
| Venta por persona | ₡14.395 | ₡9.440 |
| Margen por persona | ₡10.888 | ₡6.386 |

**Punto de equilibrio del menú:**
- Fórmula: nuevos ≥ (margen carta − margen menú) ÷ margen carta.
- Da entre 41 y 44 % según el período.

### Menú de mediodía

| Período (mañana) | Gasto promedio por persona |
|---|---|
| 2024 | ₡12.753 |
| ene–jun 2025 | ₡11.956 |
| jul–nov 2025 (con menú) | ₡10.700 |
| dic 2025–feb 2026 (con menú) | ₡10.476 |
| mar–oct 2026 (con menú) | ₡11.232 |

- Personas jul–nov 2025: por turno de caja +29 %; por hora real +4 %, mientras la noche caía 37 %.
- Margen por persona: carta ₡10.500–11.800, menú ₡5.900–6.500.
- Punto de equilibrio: el 44 % o más de las personas del menú tienen que ser clientes nuevos.
- **Efecto por mes (corregido con Q27, hora real y noche como control):**
  - Temporada baja 2025: +₡500k/mes, con 79 % de nuevos.
  - Temporada alta 2025-26: +₡1,0M/mes, con 71 % de nuevos.
  - La estimación anterior de la alta (−₡625k) usaba el turno de caja. Ver [rondas/r8-Q27-D14-D15.md](rondas/r8-Q27-D14-D15.md).
- Delivery: pedidos de mañana +21 % con la misma venta. Delivery de noche −33 % desde 2024.
- **Recomendación:**
  - Menú fijo en la carta todo el año (cambió con Q27), con 5 platos: Bento, Casado, Bowl Teriyaki, Sakura Poke y Sushi Duo. Se mide cada mes el mediodía contra la noche.
  - ₡1.000 más por plato (+₡130k/mes).
  - Combo con bebida (+₡50k/mes).
  - Corregir el costo del Bento (+₡20k/mes).

### Local Club y descuentos (noche)

| Grupo | Venta por persona | Margen por persona | Período |
|---|---|---|---|
| Sin descuento | ₡17.212 | ₡13.084 | mar–ago 2026 |
| Tarjeta 10 % | ₡16.384 | ₡12.026 | mar–ago 2026 |
| LC carta | ₡13.902 | ₡10.019 | mar–ago 2026 |
| LC menú | ₡13.912 | ₡9.135 | sep–oct 2025 |

**Comparación sep–oct 2025 (con menú LC) contra sep–oct 2026:**
- Personas LC por mes: 194 contra 131. El resto: 592 contra 611.
- Margen LC por mes: ₡2,12M contra ₡1,36M.
- Escenarios: el alto (+₡753k) no tiene respaldo por el efecto novedad del LC. La diferencia en diferencias da unos 41 LC nuevos por mes: **rango de +₡250 a 400k/mes**.

**Costo de los descuentos:**
- Costo del descuento LC: unos ₡514k/mes (mar–ago 2026) y ₡268k/mes (sep–oct 2026).
- VIP card de 10 % a 15 %: no trajo gente. Separando las tarjetas de hotel: 217 socios por mes en ene–abr 2024 y 204 en 2025. El relanzamiento como Local Club sí trajo gente (ver r9).
- Volver LC al 10 %:
  - Ahorra unos ₡170k/mes en alta y ₡90k en baja (unos ₡1,6M/año).
  - Deja de convenir si se pierde más del 7 % de las visitas LC.
  - Con un regalo (unos ₡400 por persona contra ₡820 del 5 % extra) el ahorro es unos ₡0,8M/año.

**Otros hallazgos:**
- Favoritos LC: Subarashi, Rainbow, Super Maguro, Pollo Teriyaki, Ginger Mint Lemonade y El Gusano/Margarita. Piden menos entradas y postres.
- Marcado de LC en caja: unos 20 % de las mesas LC no se marcan (40 % de las cerradas por caja).
- Tarjetas de hoteles y tiendas: el programa cuesta unos ₡300–360k/mes reales, con créditos y gestor, y deja unos ₡12.300 de margen por persona. Se mantiene (ver r9).
- Personal 30 % (D14):
  - ₡58,8k/mes de descuento en 2026, +49 % contra 2025. En jul–oct 2026, 5–8× lo de 2025.
  - El 51 % del descuento va en cuentas sin nombre. Ver r8.
- Créditos de tarjetas (ver §3):
  - Unos ₡263k/mes cerrados «a crédito». El PoS los cuenta como venta, y la app es igual al PoS.
  - La salida real es de ₡115k/mes como máximo (comida unos ₡55k, IVA unos ₡34k, servicio unos ₡26k).

**Recomendación:**
- LC al 10 % + regalo, como prueba de 2–3 meses medida contra el mismo mes del año anterior.
- Menú corto LC de noche en temporada baja (+₡250 a 400k/mes).
- Mantener las tarjetas.
- Que caja marque siempre LOCAL CLUB.
- Evaluar con el contador cerrar los créditos como regalía.

**Preguntas abiertas:**
- ¿El servicio de las mesas de crédito entra al reparto de propinas?
- El tratamiento del IVA de esas mesas (contador).

---

## 1b. Revisión independiente (04-nov-2026)

Ver [REVISION-auditoria-2026-11-04.md](REVISION-auditoria-2026-11-04.md): errores, riesgos e inconsistencias con su corrección. Lo más importante:
- turno de mediodía por hora: **hecho con Q27**, la conclusión del menú mejora (ver r8);
- moda de precio en meses con cambio de precio (mar-2025, oct-2026);
- escenario LC como rango de +₡250 a 400k/mes;
- unificar el costo del menú.

Ver también [research/](research/) ([mercado](research/mercado-gastronomico.md), [comportamiento del consumidor](research/comportamiento-consumidor.md)) con evidencia de mercado y de comportamiento del consumidor.

## 2. Definiciones (usarlas igual en specs y reportes futuros)

- **Neta:** suma de líneas `estado='C'`, excluyendo las familias 6 (PERSONAL), 17 (X CORTESÍAS) y 20 (Ingredientes). El día es en hora CR.
- **Turno:** ⚠️ el turno de caja no es confiable para separar mediodía y noche. Usar la hora real: mediodía = 6–16 h según `fecha_registra` (Q27).
- **Prom/pax reconstruido:**
  - Antes de sep-2025 muchas mesas no tienen pax.
  - Se estima con un modelo (error de unos 0,5 pax por mesa, sesgo de −2 % a −3 %). Ver [r4](rondas/r4-hallazgos.md)/[r5](rondas/r5-SQL-analisis-mediodia.md) y la SPEC vigente [docs/SPEC-prompax-explicado.md](../../SPEC-prompax-explicado.md) (v2.2).
- **Precio de lista:** la moda del precio unitario del producto en el mes.
- **Ratio de descuento por mesa:** neta ÷ valor a lista.
- **Clases de mesa:**

  | Clase | Regla |
  |---|---|
  | LC | Artículo 856 en la mesa, o ratio 0,80–0,87 |
  | Tarjeta 10 % | Ratio 0,88–0,93 |
  | Sin descuento | Ratio ≥ 0,97 |
  | Personal 30 % | Ratio 0,66–0,74 (solo en `share.py`) |
  | Otro | El resto |

  Artículo 857 = invitado.
- **Costo:**
  - Por producto: el CoGS 2026; si no hay, el `CostoUnitario` del PoS; si no hay, un % por familia (ver [scripts/costlib.py](scripts/costlib.py)).
  - Atajo para mesas: 24 % del valor a lista en carta y 32 % en mesas con menú.
  - Margen = neta − costo (sin mano de obra ni gastos fijos).
- **Temporada:** baja = mayo a mediados de diciembre; alta = mediados de diciembre a abril.

### Historia de descuentos (confirmada por Ismael)

| Período | Programa |
|---|---|
| Desde oct-2022 | Tarjetas de hoteles y tiendas: 10 % al cliente. Quien la entrega recibe 1 crédito de consumo cada 6 personas (₡12k → 14k → 16k → hoy ₡18k, confirmado), no efectivo |
| Desde mar-2024 | Club PM (concierges): 10 % del subtotal en efectivo y postre de cortesía para el cliente |
| Antes de abr-2025 | VIP card: un tiempo 10 % y otro 15 % |
| Desde 23-abr-2025 | Local Club 15 % (mayo 2025: promo de lanzamiento 20 %) |
| Siempre | 30 % = personal consumiendo fuera de servicio |
| Siempre | El LC no aplica al menú de mediodía |

## 3. Glosario PoS (SQL Server `ndf`) — lo que aprendimos

- **Descuento:**
  - Es por línea: `FAC_PedidosDet.Descuento` (%) con `TipoDescuento='P'`.
  - `FAC_FacturasDet.Descuento` es un monto en ₡.
  - Los campos de cabecera `FAC_Pedidos.Descuento/TipoDescuento/MontoDescuento` vienen vacíos.
- **Join** `FAC_PedidosDet` ↔ `FAC_Pedidos`: por `Periodo + Mes + Dia + NumeroPedido`. Si se hace solo por `NumeroPedido`, multiplica filas.
- **Campos de `FAC_Facturas`:** `CuentaCobrar` (cerrada «a crédito»), `MotivoRegalia`, `Efectivo`, `Tarjeta`, `Deposito`, `MontoElectronico`, `Cheque`, `NombreCliente`.
- **Campos de `FAC_FacturasDet`:** `IV`, `ImpS` (servicio), `CostoTotal`, `MontoTotal`.
- **Créditos de tarjetas:**
  - Son las facturas con `NombreCliente` LIKE '%CREDITO%'.
  - Según el período, se cierran «a crédito» (`CuentaCobrar>0`) o como regalía.
  - Query: D12 en [rondas/r7-SQL-analisis-descuentos-localclub.md](rondas/r7-SQL-analisis-descuentos-localclub.md).
- **Familias:**

  | Código | Familia |
  |---|---|
  | 6 | PERSONAL |
  | 17 | X CORTESÍAS |
  | 19 | A PAX |
  | 20 | Ingredientes |
  | 25 | PROMOCIONES |
  | 28 | XX DUEÑOS |
  | 29 | GREENSEASON (menú mediodía) |

- **Supabase:**
  - `pos_ndf_tickets` / `pos_ndf_ticket_lines` replican el PoS.
  - `clase_ingreso` (mig. 063) puede ser `cobrada`, `cortesia`, `duenos`, `sin_cobro` o null.
  - El SQL Editor corta en 100 filas: siempre poner `limit` explícito.

## 4. Huecos de datos (pendientes de ingesta)

Ver [specs/SPEC-analisis-ventas-integrado.md](specs/SPEC-analisis-ventas-integrado.md) §6. Principales:
- Ingerir el % de descuento por línea (`FAC_PedidosDet`).
- Ingerir `FAC_Facturas.CuentaCobrar`.
- Revisar `regalia_crc` en tickets `cortesia`.

## 5. Contenido de esta carpeta

| Carpeta | Qué tiene |
|---|---|
| [rondas/](rondas/) | Cada ronda de queries (Q0–Q27, D1–D16) con resultados e interpretación, en orden. r7 = descuentos, Local Club, créditos e IVA. r8 = mediodía por hora real y personal. r9 = programa de créditos, PM y VIP separada |
| [sql/](sql/) | Queries sueltas. [base.sql](sql/base.sql) = CTE base de clasificación de mesas (Q22–Q25) |
| [specs/](specs/) | [SPEC del análisis de ventas integrado](specs/SPEC-analisis-ventas-integrado.md) (fase futura en la app) y [reporte de mediodía](specs/SPEC-reporte-mediodia.md). La SPEC de prom/pax vigente es [docs/SPEC-prompax-explicado.md](../../SPEC-prompax-explicado.md) (v2.2) |
| [scripts/](scripts/) | Python (pandas) de costos y agregados. Correr desde esta carpeta: `python scripts/an_r7.py` |
| [datos/](datos/) | CSV exportados de las queries (agregados, sin datos personales de clientes) y planillas de costos |

### Cómo reproducir

1. Correr la query en DBeaver (PoS, solo lectura) o en el SQL Editor de Supabase PROD, con `limit` explícito.
2. Exportar a CSV en [datos/](datos/).
3. Correr el script correspondiente.

Para un análisis nuevo, crear `docs/analisis/<fecha>-<tema>/` con esta misma estructura.

**Regla:** no guardar teléfono, dirección, cédula ni nombres de clientes en CSV.
